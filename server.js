const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { fetchTabascoForecast, warmSmnCache } = require("./lib/smnForecast");
const { getPowerDailyCsv, warmPowerCache } = require("./lib/nasaPower");

const app = express();

app.use(express.json({ limit: "1mb" }));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

app.options("/api/chat", (_req, res) => {
  res.set(corsHeaders).status(200).send("");
});

app.post("/api/chat", async (req, res) => {
  try {
    const { prompt, contextoTexto } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Falta 'prompt' (string)." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Falta OPENAI_API_KEY en el servidor." });
    }

    // PASO 1: EMBEDDING
    const resEmbed = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: `${prompt}\n\n${contextoTexto || ""}`,
        model: "text-embedding-3-small",
      }),
    });

    const embedData = await resEmbed.json();
    if (!resEmbed.ok) {
      return res.set(corsHeaders).status(502).json({
        error: `OpenAI embeddings error (${resEmbed.status})`,
        details: embedData,
      });
    }
    const embedding = embedData?.data?.[0]?.embedding;

    // PASO 1.5: RAG (Supabase vector search)
    let ragSnippets = [];
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey && embedding) {
      try {
        const supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        });

        const { data, error } = await supabase.rpc("match_rag_chunks", {
          query_embedding: embedding,
          match_count: 6,
          filter: {},
        });

        if (error) throw error;
        ragSnippets = (data || [])
          .filter((r) => typeof r?.chunk === "string")
          .slice(0, 6)
          .map((r) => ({
            source: r.source,
            similarity: r.similarity,
            chunk: r.chunk,
            metadata: r.metadata,
          }));
      } catch (_e) {
        // Si falla RAG, continuamos sin bloquear el chat.
        ragSnippets = [];
      }
    }

    const ragBlock =
      ragSnippets.length > 0
        ? `\n\nFUENTES RECUPERADAS (RAG):\n${ragSnippets
            .map((s, idx) => {
              const muni = s?.metadata?.municipio ? ` | municipio: ${s.metadata.municipio}` : "";
              const coords =
                Number.isFinite(s?.metadata?.lat) && Number.isFinite(s?.metadata?.lon)
                  ? ` | lat ${s.metadata.lat}, lon ${s.metadata.lon}`
                  : "";
              return `\n[${idx + 1}] source: ${s.source}${muni}${coords}\n${s.chunk}`;
            })
            .join("\n")}\n`
        : "";

    // PASO 2: CHAT
    const resChat = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Eres un asistente de prevencion de inundaciones para Tabasco.

Objetivo:
- Explicar el riesgo hidrometeorologico con lenguaje claro.
- Usar el contexto tecnico recibido (municipio, fecha, acumulados, nivel de riesgo y vulnerabilidad).
- Dar recomendaciones preventivas generales y realistas.
- Usa las FUENTES RECUPERADAS (RAG) como evidencia cuando apliquen. Si no alcanzan para afirmar algo, dilo.

Reglas:
1) No hagas afirmaciones absolutas.
2) Diferencia historico, monitoreo actual y pronostico (si no hay pronostico, dilo).
3) Cuando el riesgo sea Alto o Muy alto, prioriza acciones concretas de prevencion comunitaria.
4) Incluye limites del dato: es apoyo a decision y no sustituye alertas oficiales de Proteccion Civil.
5) Si faltan datos, pide precision adicional de municipio/fecha.

Formato sugerido:
- Nivel de riesgo actual
- Factores que lo explican
- Recomendaciones de prevencion
- Limites/advertencias

CONTEXTO:
${contextoTexto || ""}${ragBlock}`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    const chatData = await resChat.json();
    if (!resChat.ok) {
      return res.set(corsHeaders).status(502).json({
        error: `OpenAI chat error (${resChat.status})`,
        details: chatData,
      });
    }
    const safeReply =
      chatData?.choices?.[0]?.message?.content ||
      "No pude generar respuesta en este momento. Intenta de nuevo.";

    res.set(corsHeaders).status(200).json({
      embedding,
      respuesta: safeReply,
      rag: ragSnippets,
    });
  } catch (error) {
    res.set(corsHeaders).status(500).json({ error: error?.message || "Error interno" });
  }
});

const apiJsonHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

app.options("/api/forecast/tabasco", (_req, res) => {
  res.set(apiJsonHeaders).status(200).send("");
});

app.get("/api/forecast/tabasco", async (_req, res) => {
  try {
    const payload = await fetchTabascoForecast();
    res.set(apiJsonHeaders).status(200).json(payload);
  } catch (error) {
    res.set(apiJsonHeaders).status(502).json({
      error: error?.message || "No se pudo obtener el pronóstico SMN",
    });
  }
});

app.options("/api/power/daily", (_req, res) => {
  res.set(apiJsonHeaders).status(200).send("");
});

/** CSV diario NASA POWER (6 puntos MVP). Query: ?refresh=1 fuerza sync. */
app.get("/api/power/daily", async (req, res) => {
  try {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const { csv, meta, fromCache, refreshing } = await getPowerDailyCsv({ refresh });
    res
      .set({
        ...apiJsonHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Power-Source": meta?.source || "nasa-power",
        "X-Power-From-Cache": fromCache ? "1" : "0",
        "X-Power-Refreshing": refreshing ? "1" : "0",
        "X-Power-Rows": String(meta?.rows ?? ""),
        "X-Power-Last-End": meta?.lastEnd || "",
        "X-Power-Updated-At": meta?.updatedAt || "",
      })
      .status(200)
      .send(csv);
  } catch (error) {
    res.set(apiJsonHeaders).status(502).json({
      error: error?.message || "No se pudo obtener datos NASA POWER",
    });
  }
});

app.options("/api/power/meta", (_req, res) => {
  res.set(apiJsonHeaders).status(200).send("");
});

app.get("/api/power/meta", async (_req, res) => {
  try {
    const { meta, fromCache, refreshing } = await getPowerDailyCsv();
    res.set(apiJsonHeaders).status(200).json({ ...meta, fromCache, refreshing });
  } catch (error) {
    res.set(apiJsonHeaders).status(502).json({
      error: error?.message || "No se pudo leer meta NASA POWER",
    });
  }
});

// Producción: servir el build de CRA y respaldo de datos en public/
const buildDir = path.join(__dirname, "build");
const publicDataDir = path.join(__dirname, "public", "data");

app.use("/data", express.static(publicDataDir));
app.use(express.static(buildDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(buildDir, "index.html"));
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  warmSmnCache();
  warmPowerCache();
});

