/* eslint-disable no-console */
/**
 * Indexa el dataset espacial (CSV) a Supabase (pgvector) para RAG.
 *
 * Requiere env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY  (server-side)
 * - OPENAI_API_KEY            (para embeddings)
 *
 * Uso:
 *   node scripts/rag_index_spatial.js
 */

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const { createClient } = require("@supabase/supabase-js");

const CSV_PATH = path.join(__dirname, "..", "public", "data", "Evapotranspiracion RP.csv");

const MONTHS = [
  { key: "JAN", month: 1, label: "ENE" },
  { key: "FEB", month: 2, label: "FEB" },
  { key: "MAR", month: 3, label: "MAR" },
  { key: "APR", month: 4, label: "ABR" },
  { key: "MAY", month: 5, label: "MAY" },
  { key: "JUN", month: 6, label: "JUN" },
  { key: "JUL", month: 7, label: "JUL" },
  { key: "AUG", month: 8, label: "AGO" },
  { key: "SEP", month: 9, label: "SEP" },
  { key: "OCT", month: 10, label: "OCT" },
  { key: "NOV", month: 11, label: "NOV" },
  { key: "DEC", month: 12, label: "DIC" },
];

// Centroides aproximados (mismo enfoque que useRainData.js)
const MUNICIPALITY_CENTROIDS = [
  { name: "Villahermosa", lat: 17.9892, lon: -92.9475 },
  { name: "Cárdenas", lat: 18.001, lon: -93.375 },
  { name: "Comalcalco", lat: 18.2637, lon: -93.221 },
  { name: "Cunduacán", lat: 18.0655, lon: -93.1738 },
  { name: "Huimanguillo", lat: 17.8374, lon: -93.3839 },
  { name: "Jalpa de Méndez", lat: 18.1763, lon: -93.0633 },
  { name: "Nacajuca", lat: 18.1719, lon: -92.9932 },
  { name: "Paraíso", lat: 18.3969, lon: -93.2147 },
  { name: "Teapa", lat: 17.5492, lon: -92.9512 },
  { name: "Macuspana", lat: 17.7569, lon: -92.5926 },
  { name: "Jalapa", lat: 17.7214, lon: -92.8063 },
  { name: "Tacotalpa", lat: 17.6072, lon: -92.8262 },
  { name: "Balancán", lat: 17.8064, lon: -91.1823 },
  { name: "Tenosique", lat: 17.4784, lon: -91.4328 },
  { name: "Catazajá", lat: 17.734, lon: -92.014 },
  { name: "Emiliano Zapata", lat: 17.7425, lon: -91.7656 },
  { name: "Centla (Frontera)", lat: 18.5917, lon: -92.6486 },
  { name: "Jonuta", lat: 17.9833, lon: -92.1333 },
  { name: "Ciudad del Carmen", lat: 18.6508, lon: -91.8297 },
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

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`No existe el CSV en ${CSV_PATH}`);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log("Leyendo CSV...");
  const csv = fs.readFileSync(CSV_PATH, "utf8");
  const parsed = Papa.parse(csv, { header: true, dynamicTyping: true, skipEmptyLines: true });
  const rows = parsed.data || [];

  // Agregación por punto (lat,lon): resumimos lluvia (PRECTOTCORR) por meses/años
  const points = new Map(); // key -> {lat,lon, municipio, years:Set, lluviaVals:number[]}

  for (const r of rows) {
    const year = toNumber(r.YEAR);
    const lat = toNumber(r.LAT);
    const lon = toNumber(r.LON);
    const parametro = String(r.PARAMETRO || "").trim().toUpperCase();
    if (!Number.isFinite(year) || !Number.isFinite(lat) || !Number.isFinite(lon) || !parametro) continue;
    if (parametro !== "PRECTOTCORR") continue;

    const key = `${lat}_${lon}`;
    if (!points.has(key)) {
      points.set(key, {
        lat,
        lon,
        municipio: getMunicipalityFromCoords(lat, lon),
        years: new Set(),
        lluviaVals: [],
      });
    }
    const p = points.get(key);
    p.years.add(year);

    for (const m of MONTHS) {
      const v = toNumber(r[m.key]);
      if (Number.isFinite(v)) p.lluviaVals.push(v);
    }
  }

  console.log(`Puntos encontrados: ${points.size}`);

  const docs = [];
  for (const p of points.values()) {
    const vals = p.lluviaVals.filter((x) => Number.isFinite(x));
    if (!vals.length) continue;
    vals.sort((a, b) => a - b);
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const p90 = vals[Math.floor(vals.length * 0.9)];
    const max = vals[vals.length - 1];

    const years = Array.from(p.years).sort((a, b) => a - b);
    const yearMin = years[0];
    const yearMax = years[years.length - 1];

    const chunk = [
      `Dataset espacial (punto de grilla)`,
      `Municipio aproximado: ${p.municipio}`,
      `Coordenadas: lat ${p.lat}, lon ${p.lon}`,
      `Serie: lluvia mensual PRECTOTCORR (mm/mes)`,
      `Cobertura de años: ${yearMin}–${yearMax} (según el CSV)`,
      `Estadísticos (mm/mes): media=${mean.toFixed(2)}, p90=${p90.toFixed(2)}, max=${max.toFixed(2)}`,
      `Uso sugerido: contexto local para explicar riesgo por acumulados y estacionalidad.`,
    ].join("\n");

    docs.push({
      source: "Evapotranspiracion RP.csv",
      chunk,
      metadata: { tipo: "punto_grilla", municipio: p.municipio, lat: p.lat, lon: p.lon, yearMin, yearMax },
    });
  }

  console.log(`Docs a indexar: ${docs.length}`);

  // Insert por lotes (con embeddings)
  const batchSize = 25;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    console.log(`Embedding + upsert batch ${i}..${i + batch.length - 1}`);

    const rowsToInsert = [];
    for (const d of batch) {
      const embedding = await embedText(openaiKey, d.chunk);
      rowsToInsert.push({ ...d, embedding });
    }

    const { error } = await supabase.from("rag_chunks").insert(rowsToInsert);
    if (error) throw error;
  }

  console.log("Indexación RAG completada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

