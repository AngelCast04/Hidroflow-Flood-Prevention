-- RAG storage for HydroFlow Flood Prevention (Supabase / Postgres + pgvector)

-- 1) Enable pgvector
create extension if not exists vector;

-- 2) Table for chunks
create table if not exists public.rag_chunks (
  id bigserial primary key,
  source text not null,
  chunk text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists rag_chunks_source_idx on public.rag_chunks (source);
create index if not exists rag_chunks_metadata_gin on public.rag_chunks using gin (metadata);
create index if not exists rag_chunks_embedding_idx on public.rag_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 3) Match function (cosine similarity)
-- SECURITY DEFINER: permite usar la clave anon desde el servidor sin exponer SELECT directo a la tabla.
create or replace function public.match_rag_chunks(
  query_embedding vector(1536),
  match_count int default 6,
  filter jsonb default '{}'::jsonb
)
returns table (
  id bigint,
  source text,
  chunk text,
  metadata jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    rc.id,
    rc.source,
    rc.chunk,
    rc.metadata,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.rag_chunks rc
  where (filter = '{}'::jsonb or rc.metadata @> filter)
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_rag_chunks(vector, int, jsonb) from public;
grant execute on function public.match_rag_chunks(vector, int, jsonb) to anon, authenticated, service_role;

