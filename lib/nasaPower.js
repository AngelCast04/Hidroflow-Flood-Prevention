/**
 * Cliente NASA POWER (daily/point) con caché local e sync incremental.
 * Formato de salida: CSV con YEAR,DOY,LAT,LON,... compatible con useRainData.
 */
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const POWER_BASE = "https://power.larc.nasa.gov/api/temporal/daily/point";
const PARAMETERS =
  "ALLSKY_SFC_SW_DWN,T2M,T2MDEW,RH2M,QV2M,PRECTOTCORR,PS,WS10M,GWETPROF,GWETROOT";
const COMMUNITY = "AG";
const HISTORIC_START = "19810101";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_GAP_MS = 1500;
const DOWNLOAD_TIMEOUT_MS = 180000;

const CSV_HEADER =
  "YEAR,DOY,LAT,LON,ALLSKY_SFC_SW_DWN,T2M,T2MDEW,RH2M,QV2M,PRECTOTCORR,PS,WS10M,GWETPROF,GWETROOT";

/** Puntos municipales MVP (Chontalpa / Tabasco). */
const POWER_POINTS = [
  { id: "cunduacan", name: "Cunduacán", lat: 18.0672, lon: -93.1763 },
  { id: "comalcalco", name: "Comalcalco", lat: 18.2445, lon: -93.2013 },
  { id: "villahermosa", name: "Villahermosa", lat: 17.9845, lon: -92.9203 },
  { id: "paraiso", name: "Paraíso", lat: 18.3932, lon: -93.2076 },
  { id: "cardenas", name: "Cárdenas", lat: 17.9896, lon: -93.3794 },
  { id: "huimanguillo", name: "Huimanguillo", lat: 17.8442, lon: -93.3978 },
];

let memory = { at: 0, csv: null, meta: null };
let syncPromise = null;

function cacheDir() {
  return path.join(__dirname, "..", "data", "power_cache");
}

function cacheCsvPath() {
  return path.join(cacheDir(), "DATASET_POWER.csv");
}

function cacheMetaPath() {
  return path.join(cacheDir(), "meta.json");
}

function seedDir() {
  return path.join(__dirname, "..", "data", "nasa_power_test");
}

function ensureCacheDir() {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ymdTodayUtc() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Preferir "ayer" UTC: POWER suele ir con 1–2 días de retraso. */
function ymdEndDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function addOneDayYmd(ymd) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function doyToYmd(year, doy) {
  const dt = new Date(Date.UTC(year, 0, doy));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Parsea CSV NASA (con o sin header -BEGIN HEADER-) o CSV unificado con LAT,LON.
 * Si lat/lon no vienen en filas, se inyectan desde point.
 */
function parsePowerCsv(text, point = null) {
  const lines = String(text || "").split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^YEAR,DOY,/i.test(lines[i].trim())) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const cols = lines[headerIdx].split(",").map((c) => c.trim());
  const latIdx = cols.findIndex((c) => c.toUpperCase() === "LAT");
  const lonIdx = cols.findIndex((c) => c.toUpperCase() === "LON");
  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("-")) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const year = Number(parts[0]);
    const doy = Number(parts[1]);
    if (!Number.isFinite(year) || !Number.isFinite(doy)) continue;

    const lat =
      latIdx >= 0 ? Number(parts[latIdx]) : point ? point.lat : NaN;
    const lon =
      lonIdx >= 0 ? Number(parts[lonIdx]) : point ? point.lon : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // Columnas NASA sin LAT/LON: YEAR,DOY + 10 params
    // Columnas unificadas: YEAR,DOY,LAT,LON + 10 params
    let values;
    if (latIdx >= 0 && lonIdx >= 0) {
      values = parts.slice(4);
    } else {
      values = parts.slice(2);
    }
    while (values.length < 10) values.push("");

    rows.push({
      YEAR: year,
      DOY: doy,
      LAT: lat,
      LON: lon,
      ymd: doyToYmd(year, doy),
      ALLSKY_SFC_SW_DWN: values[0],
      T2M: values[1],
      T2MDEW: values[2],
      RH2M: values[3],
      QV2M: values[4],
      PRECTOTCORR: values[5],
      PS: values[6],
      WS10M: values[7],
      GWETPROF: values[8],
      GWETROOT: values[9],
    });
  }
  return rows;
}

function rowsToCsv(rows) {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push(
      [
        r.YEAR,
        r.DOY,
        r.LAT,
        r.LON,
        r.ALLSKY_SFC_SW_DWN,
        r.T2M,
        r.T2MDEW,
        r.RH2M,
        r.QV2M,
        r.PRECTOTCORR,
        r.PS,
        r.WS10M,
        r.GWETPROF,
        r.GWETROOT,
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function maxYmdFromRows(rows) {
  let max = null;
  for (const r of rows) {
    if (!max || r.ymd > max) max = r.ymd;
  }
  return max;
}

function readMeta() {
  try {
    const p = cacheMetaPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_e) {
    return null;
  }
}

function writeMeta(meta) {
  ensureCacheDir();
  fs.writeFileSync(cacheMetaPath(), JSON.stringify(meta, null, 2), "utf8");
}

function readDiskCsv() {
  const p = cacheCsvPath();
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

function writeDiskCsv(csv) {
  ensureCacheDir();
  fs.writeFileSync(cacheCsvPath(), csv, "utf8");
}

function pointSeedFilename(point) {
  const map = {
    cunduacan: "Cunduacan_1981_2026.csv",
    comalcalco: "Comalcalco_1981_2026.csv",
    villahermosa: "Villahermosa_1981_2026.csv",
    paraiso: "Paraiso_1981_2026.csv",
    cardenas: "Cardenas_1981_2026.csv",
    huimanguillo: "Huimanguillo_1981_2026.csv",
  };
  return map[point.id] || null;
}

function publicDatasetPath() {
  return path.join(__dirname, "..", "public", "data", "DATASET_UPDATE.csv");
}

/**
 * Siembra caché desde el CSV de respaldo en public/data (sí va al repo / Render).
 * Luego el sync incremental completa hasta "ayer" vía NASA POWER.
 */
function trySeedFromPublicDataset() {
  const file = publicDatasetPath();
  if (!fs.existsSync(file)) return null;

  try {
    const text = fs.readFileSync(file, "utf8");
    const rows = parsePowerCsv(text);
    if (!rows.length) return null;

    rows.sort((a, b) => a.LAT - b.LAT || a.LON - b.LON || a.YEAR - b.YEAR || a.DOY - b.DOY);
    const csv = rowsToCsv(rows);
    const lastEnd = maxYmdFromRows(rows);
    const meta = {
      // updatedAt antiguo → fuerza refresh/sync al servir
      updatedAt: "1970-01-01T00:00:00.000Z",
      lastEnd,
      source: "seed:public/DATASET_UPDATE.csv",
      points: POWER_POINTS.length,
      rows: rows.length,
    };
    writeDiskCsv(csv);
    writeMeta(meta);
    memory = { at: 0, csv, meta };
    console.log(
      `[nasaPower] Caché sembrada desde public/data/DATASET_UPDATE.csv (${rows.length} filas, lastEnd=${lastEnd})`
    );
    return { csv, meta };
  } catch (e) {
    console.warn("[nasaPower] Seed desde public/data falló:", e.message);
    return null;
  }
}

/** Une descargas de prueba locales si aún no hay caché unificada. */
function trySeedFromTestDownloads() {
  const dir = seedDir();
  if (!fs.existsSync(dir)) return null;

  const all = [];
  for (const point of POWER_POINTS) {
    const name = pointSeedFilename(point);
    if (!name) continue;
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    all.push(...parsePowerCsv(text, point));
  }
  if (!all.length) return null;

  all.sort((a, b) => a.LAT - b.LAT || a.LON - b.LON || a.YEAR - b.YEAR || a.DOY - b.DOY);
  const csv = rowsToCsv(all);
  const lastEnd = maxYmdFromRows(all);
  const meta = {
    updatedAt: "1970-01-01T00:00:00.000Z",
    lastEnd,
    source: "seed:nasa_power_test",
    points: POWER_POINTS.length,
    rows: all.length,
  };
  writeDiskCsv(csv);
  writeMeta(meta);
  memory = { at: 0, csv, meta };
  console.log(`[nasaPower] Caché sembrada desde nasa_power_test (${all.length} filas)`);
  return { csv, meta };
}

/** Preferir seed versionado (public) y luego descargas de prueba locales. */
function trySeedAny() {
  return trySeedFromPublicDataset() || trySeedFromTestDownloads();
}

function startBackgroundSync() {
  if (syncPromise) return syncPromise;
  syncPromise = syncPowerCache()
    .catch((e) => console.warn("[nasaPower] refresh background falló:", e.message))
    .finally(() => {
      syncPromise = null;
    });
  return syncPromise;
}

function buildPointUrl(point, start, end) {
  const q = new URLSearchParams({
    parameters: PARAMETERS,
    community: COMMUNITY,
    longitude: String(point.lon),
    latitude: String(point.lat),
    start,
    end,
    format: "CSV",
  });
  return `${POWER_BASE}?${q.toString()}`;
}

async function fetchPointRange(point, start, end) {
  const url = buildPointUrl(point, start, end);
  const res = await axios.get(url, {
    timeout: DOWNLOAD_TIMEOUT_MS,
    responseType: "text",
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(
      `NASA POWER ${point.name} HTTP ${res.status}: ${String(res.data).slice(0, 200)}`
    );
  }
  return parsePowerCsv(res.data, point);
}

/**
 * Sync incremental: si hay caché, solo pide desde lastEnd+1; si no, histórico completo.
 */
async function syncPowerCache({ forceFull = false } = {}) {
  ensureCacheDir();

  let existingRows = [];
  let meta = readMeta();
  const disk = readDiskCsv();

  if (!forceFull && disk) {
    existingRows = parsePowerCsv(disk);
  } else if (!forceFull && !disk) {
    const seeded = trySeedAny();
    if (seeded) {
      existingRows = parsePowerCsv(seeded.csv);
      meta = seeded.meta;
    }
  }

  const end = ymdEndDate();
  let start = HISTORIC_START;
  if (!forceFull && meta?.lastEnd && meta.lastEnd.length === 8) {
    start = addOneDayYmd(meta.lastEnd);
  }

  if (start > end) {
    const csv = disk || rowsToCsv(existingRows);
    const freshMeta = {
      ...(meta || {}),
      updatedAt: new Date().toISOString(),
      lastEnd: meta?.lastEnd || maxYmdFromRows(existingRows) || end,
      source: "cache:up-to-date",
      points: POWER_POINTS.length,
      rows: existingRows.length,
    };
    writeMeta(freshMeta);
    memory = { at: Date.now(), csv, meta: freshMeta };
    return { csv, meta: freshMeta, fetched: false };
  }

  console.log(`[nasaPower] Sync ${start}→${end} para ${POWER_POINTS.length} puntos...`);
  const newRows = [];
  for (let i = 0; i < POWER_POINTS.length; i++) {
    const point = POWER_POINTS[i];
    const rows = await fetchPointRange(point, start, end);
    newRows.push(...rows);
    console.log(`[nasaPower]   ${point.name}: +${rows.length} días`);
    if (i < POWER_POINTS.length - 1) await sleep(REQUEST_GAP_MS);
  }

  // Deduplicar por LAT,LON,YEAR,DOY (nuevos ganan)
  const keyOf = (r) => `${r.LAT}_${r.LON}_${r.YEAR}_${r.DOY}`;
  const map = new Map();
  for (const r of existingRows) map.set(keyOf(r), r);
  for (const r of newRows) map.set(keyOf(r), r);

  const merged = Array.from(map.values());
  merged.sort((a, b) => a.LAT - b.LAT || a.LON - b.LON || a.YEAR - b.YEAR || a.DOY - b.DOY);

  const csv = rowsToCsv(merged);
  const lastEnd = maxYmdFromRows(merged) || end;
  const freshMeta = {
    updatedAt: new Date().toISOString(),
    lastEnd,
    syncedStart: start,
    syncedEnd: end,
    source: "nasa-power",
    points: POWER_POINTS.length,
    rows: merged.length,
    todayUtc: ymdTodayUtc(),
  };
  writeDiskCsv(csv);
  writeMeta(freshMeta);
  memory = { at: Date.now(), csv, meta: freshMeta };
  console.log(`[nasaPower] OK: ${merged.length} filas, lastEnd=${lastEnd}`);
  return { csv, meta: freshMeta, fetched: true };
}

function isMemoryFresh() {
  return memory.csv && Date.now() - memory.at < CACHE_TTL_MS;
}

function isMetaFresh(meta) {
  if (!meta?.updatedAt) return false;
  const t = Date.parse(meta.updatedAt);
  return Number.isFinite(t) && Date.now() - t < CACHE_TTL_MS;
}

/**
 * Obtiene CSV listo para el cliente.
 * En producción (Render): siembra desde public/data y completa con NASA POWER incremental.
 * El CSV estático permanece como respaldo en el front si /api/power/daily falla.
 */
async function getPowerDailyCsv({ refresh = false } = {}) {
  if (!refresh && isMemoryFresh()) {
    return { csv: memory.csv, meta: memory.meta, fromCache: true };
  }

  let disk = readDiskCsv();
  let meta = readMeta();

  // Sin caché en disco (típico en Render): sembrar desde public/data
  if (!disk) {
    const seeded = trySeedAny();
    if (seeded) {
      disk = seeded.csv;
      meta = seeded.meta;
    }
  }

  if (!refresh && disk && isMetaFresh(meta)) {
    memory = { at: Date.now(), csv: disk, meta };
    return { csv: disk, meta, fromCache: true };
  }

  if (!refresh && disk) {
    memory = { at: Date.now(), csv: disk, meta };
    startBackgroundSync();
    return { csv: disk, meta, fromCache: true, refreshing: true };
  }

  // Sin seed posible: sync bloqueante (histórico completo — lento)
  if (syncPromise) {
    const result = await syncPromise;
    return { csv: result.csv, meta: result.meta, fromCache: false };
  }

  syncPromise = syncPowerCache({ forceFull: refresh });
  try {
    const result = await syncPromise;
    return { csv: result.csv, meta: result.meta, fromCache: false };
  } finally {
    syncPromise = null;
  }
}

function warmPowerCache() {
  // Siempre intenta sembrar + sync incremental al arrancar (producción y local)
  getPowerDailyCsv()
    .then((r) => {
      console.log(
        `[nasaPower] warm OK (${r.meta?.rows ?? "?"} filas, source=${r.meta?.source || "?"}, lastEnd=${r.meta?.lastEnd || "?"})`
      );
      // Asegura completar hueco hasta ayer vía API
      return startBackgroundSync();
    })
    .then((r) => {
      if (r?.meta) {
        console.log(
          `[nasaPower] sync post-warm OK (lastEnd=${r.meta.lastEnd}, source=${r.meta.source})`
        );
      }
    })
    .catch((e) => {
      console.warn("[nasaPower] warm omitido:", e.message);
    });
}

module.exports = {
  POWER_POINTS,
  PARAMETERS,
  CSV_HEADER,
  getPowerDailyCsv,
  syncPowerCache,
  warmPowerCache,
  cacheCsvPath,
  cacheMetaPath,
};
