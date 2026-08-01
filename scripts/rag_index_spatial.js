/* eslint-disable no-console */
/**
 * Indexa DATASET_UPDATE.csv (diario) a Supabase (pgvector) para RAG.
 *
 * Formato esperado:
 *   YEAR,DOY,LAT,LON,...,PRECTOTCORR,PS,WS10M,GWETPROF,GWETROOT
 *
 * Requiere env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY  (server-side)
 * - OPENAI_API_KEY            (para embeddings)
 *
 * Uso:
 *   npm run rag:index:spatial
 */

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

const CSV_CANDIDATES = [
  path.join(__dirname, "..", "public", "data", "DATASET_UPDATE.csv"),
  path.join(__dirname, "..", "data", "power_cache", "DATASET_POWER.csv"),
];

const MUNICIPALITY_CENTROIDS = [
  { name: "Villahermosa", lat: 17.9892, lon: -92.9475 },
  { name: "Cárdenas", lat: 18.001, lon: -93.375 },
  { name: "Comalcalco", lat: 18.2637, lon: -93.221 },
  { name: "Cunduacán", lat: 18.0655, lon: -93.1738 },
  { name: "Huimanguillo", lat: 17.8374, lon: -93.3839 },
  { name: "Paraíso", lat: 18.3969, lon: -93.2147 },
];

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getMunicipalityFromCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "Tabasco";
  let nearest = MUNICIPALITY_CENTROIDS[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const m of MUNICIPALITY_CENTROIDS) {
    const km = distanceKm(lat, lon, m.lat, m.lon);
    if (km < bestKm) {
      bestKm = km;
      nearest = m;
    }
  }
  return nearest?.name || "Tabasco";
}

function toNumber(x) {
  if (x === null || x === undefined || x === "") return null;
  const raw = String(x).trim().toUpperCase();
  if (!raw || raw === "N/A" || raw === "NA") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= -998) return null;
  return n;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function stats(values) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = sorted.reduce((s, x) => s + x, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    min: sorted[0],
  };
}

function resolveCsvPath() {
  for (const p of CSV_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function embedText(apiKey, text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(`OpenAI embeddings error (${r.status}): ${JSON.stringify(json)}`);
  }
  return json?.data?.[0]?.embedding;
}

function buildPointChunk(p, rain, gwet) {
  const years = Array.from(p.years).sort((a, b) => a - b);
  const yearMin = years[0];
  const yearMax = years[years.length - 1];
  const lines = [
    `Punto de monitoreo diario (Chontalpa / Tabasco)`,
    `Municipio aproximado: ${p.municipio}`,
    `Coordenadas: lat ${p.lat}, lon ${p.lon}`,
    `Fuente: DATASET_UPDATE (NASA POWER / MERRA-2, diario)`,
    `Cobertura: ${yearMin}–${yearMax} (${rain?.n ?? 0} días con lluvia válida)`,
  ];
  if (rain) {
    lines.push(
      `Lluvia diaria PRECTOTCORR (mm/día): media=${rain.mean.toFixed(2)}, p90=${rain.p90.toFixed(2)}, max=${rain.max.toFixed(2)}, min=${rain.min.toFixed(2)}`
    );
  }
  if (gwet) {
    lines.push(
      `Humedad de perfil GWETPROF (0–1): media=${gwet.mean.toFixed(2)}, p90=${gwet.p90.toFixed(2)}, max=${gwet.max.toFixed(2)}`
    );
  }
  lines.push(
    `Uso sugerido: explicar riesgo por lluvia acumulada, saturación relativa y estacionalidad local.`
  );
  return {
    source: "DATASET_UPDATE.csv",
    chunk: lines.join("\n"),
    metadata: {
      tipo: "punto_diario",
      municipio: p.municipio,
      lat: p.lat,
      lon: p.lon,
      yearMin,
      yearMax,
      dias: rain?.n ?? 0,
    },
  };
}

function buildMunicipioChunk(name, points) {
  const allRain = [];
  const allGwet = [];
  const years = new Set();
  for (const p of points) {
    allRain.push(...p.lluviaVals);
    allGwet.push(...p.gwetVals);
    p.years.forEach((y) => years.add(y));
  }
  const rain = stats(allRain);
  const gwet = stats(allGwet);
  const yearList = Array.from(years).sort((a, b) => a - b);
  if (!rain) return null;

  const lines = [
    `Resumen municipal diario — ${name} (Chontalpa, Tabasco)`,
    `Puntos de grilla agregados: ${points.length}`,
    `Fuente: DATASET_UPDATE (NASA POWER / MERRA-2)`,
    `Cobertura: ${yearList[0]}–${yearList[yearList.length - 1]}`,
    `Lluvia diaria (mm/día): media=${rain.mean.toFixed(2)}, p90=${rain.p90.toFixed(2)}, max=${rain.max.toFixed(2)}`,
  ];
  if (gwet) {
    lines.push(
      `GWETPROF promedio del municipio (0–1): media=${gwet.mean.toFixed(2)}, p90=${gwet.p90.toFixed(2)}`
    );
  }
  lines.push(
    `Contexto: zona de llanura aluvial susceptible a inundaciones; usar para comparar municipios y orientar prevención comunitaria.`
  );

  return {
    source: "DATASET_UPDATE.csv",
    chunk: lines.join("\n"),
    metadata: {
      tipo: "municipio_diario",
      municipio: name,
      puntos: points.length,
      yearMin: yearList[0],
      yearMax: yearList[yearList.length - 1],
    },
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!openaiKey) {
    throw new Error("Falta OPENAI_API_KEY para generar embeddings.");
  }

  const csvPath = resolveCsvPath();
  if (!csvPath) {
    throw new Error(
      `No se encontró DATASET_UPDATE.csv. Buscado en:\n${CSV_CANDIDATES.join("\n")}`
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log("Leyendo CSV diario:", csvPath);
  const csv = fs.readFileSync(csvPath, "utf8");
  const parsed = Papa.parse(csv, { header: true, dynamicTyping: false, skipEmptyLines: true });
  const rows = parsed.data || [];

  const points = new Map();

  for (const r of rows) {
    const year = toNumber(r.YEAR);
    const doy = toNumber(r.DOY);
    const lat = toNumber(r.LAT);
    const lon = toNumber(r.LON);
    const lluvia = toNumber(r.PRECTOTCORR);
    const gwet = toNumber(r.GWETPROF);

    if (!Number.isFinite(year) || !Number.isFinite(doy) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    // Sin lluvia válida no aporta al resumen de precipitación
    if (!Number.isFinite(lluvia)) continue;

    const key = `${lat}_${lon}`;
    if (!points.has(key)) {
      points.set(key, {
        lat,
        lon,
        municipio: getMunicipalityFromCoords(lat, lon),
        years: new Set(),
        lluviaVals: [],
        gwetVals: [],
      });
    }
    const p = points.get(key);
    p.years.add(year);
    p.lluviaVals.push(lluvia);
    if (Number.isFinite(gwet)) p.gwetVals.push(gwet);
  }

  console.log(`Puntos encontrados: ${points.size}`);

  const docs = [];
  const byMunicipio = new Map();

  for (const p of points.values()) {
    const rain = stats(p.lluviaVals);
    const gwet = stats(p.gwetVals);
    if (!rain) continue;

    docs.push(buildPointChunk(p, rain, gwet));

    if (!byMunicipio.has(p.municipio)) byMunicipio.set(p.municipio, []);
    byMunicipio.get(p.municipio).push(p);
  }

  for (const [name, pts] of byMunicipio.entries()) {
    const munDoc = buildMunicipioChunk(name, pts);
    if (munDoc) docs.push(munDoc);
  }

  console.log(`Docs a indexar: ${docs.length} (${points.size} puntos + ${byMunicipio.size} municipios)`);
  if (!docs.length) {
    throw new Error("No se generaron documentos. Revisa que PRECTOTCORR tenga valores válidos.");
  }

  // Evita duplicar si se corre el script varias veces sobre la misma fuente
  console.log("Eliminando chunks previos de DATASET_UPDATE.csv (si existen)...");
  const { error: delError } = await supabase
    .from("rag_chunks")
    .delete()
    .eq("source", "DATASET_UPDATE.csv");
  if (delError) {
    console.warn("No se pudieron borrar chunks previos (¿tabla/RLS?):", delError.message);
  }

  const batchSize = 25;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    console.log(`Embedding + insert batch ${i}..${i + batch.length - 1}`);

    const rowsToInsert = [];
    for (const d of batch) {
      const embedding = await embedText(openaiKey, d.chunk);
      rowsToInsert.push({ ...d, embedding });
    }

    const { error } = await supabase.from("rag_chunks").insert(rowsToInsert);
    if (error) throw error;
  }

  console.log("Indexación RAG diaria completada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
