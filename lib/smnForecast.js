const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");
const { promisify } = require("util");
const { spawnSync } = require("child_process");
const axios = require("axios");

const gunzip = promisify(zlib.gunzip);

const SMN_URLS = [
  "https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1",
  "https://smn.conagua.gob.mx/webservices/?method=1",
];
const TABASCO_IDES = "27";
/** Caché en memoria de datos vivos. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Si solo hay respaldo viejo, reintentar SMN más seguido (p. ej. al pulsar Actualizar). */
const STALE_CACHE_TTL_MS = 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 90000;

let cache = { at: 0, data: null, stale: false };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fallbackPaths() {
  const root = path.join(__dirname, "..");
  return [
    path.join(root, "build", "forecast_tabasco.json"),
    path.join(root, "public", "data", "forecast_tabasco.json"),
  ];
}

function readFallbackSnapshot() {
  for (const filePath of fallbackPaths()) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.municipalities?.length) {
        return { ...parsed, fromCache: true, fromFallbackFile: true };
      }
    } catch (_e) {
      // siguiente ruta
    }
  }
  return null;
}

function persistFallbackSnapshot(payload) {
  const toSave = { ...payload };
  delete toSave.fromCache;
  delete toSave.stale;
  delete toSave.warning;
  delete toSave.fromFallbackFile;
  for (const filePath of fallbackPaths()) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(toSave));
      console.log("[SMN] Respaldo actualizado:", filePath);
    } catch (e) {
      console.warn("[SMN] No se pudo escribir respaldo", filePath, e.message);
    }
  }
}

function buildPayloadFromRows(tabasco) {
  const byMun = new Map();

  for (const row of tabasco) {
    const key = String(row.idmun);
    if (!byMun.has(key)) {
      byMun.set(key, {
        idmun: row.idmun,
        nmun: row.nmun,
        lat: num(row.lat),
        lon: num(row.lon),
        days: [],
      });
    }
    byMun.get(key).days.push({
      ndia: num(row.ndia) ?? 0,
      dloc: row.dloc,
      prec: num(row.prec) ?? 0,
      probprec: num(row.probprec) ?? 0,
      tmax: num(row.tmax),
      tmin: num(row.tmin),
      velvien: num(row.velvien),
      dirvienc: row.dirvienc,
      desciel: row.desciel,
      cc: num(row.cc),
    });
  }

  const municipalities = Array.from(byMun.values())
    .map((m) => {
      m.days.sort((a, b) => a.ndia - b.ndia);
      m.precTotal3d = m.days.reduce((sum, d) => sum + (d.prec || 0), 0);
      m.maxPrecDay = m.days.reduce((max, d) => Math.max(max, d.prec || 0), 0);
      m.maxProbprec = m.days.reduce((max, d) => Math.max(max, d.probprec || 0), 0);
      return m;
    })
    .sort((a, b) => String(a.nmun).localeCompare(String(b.nmun), "es"));

  return {
    updatedAt: new Date().toISOString(),
    cacheExpiresInSec: Math.round(CACHE_TTL_MS / 1000),
    source: "SMN-CONAGUA",
    method: 1,
    state: "Tabasco",
    ides: TABASCO_IDES,
    municipalityCount: municipalities.length,
    municipalities,
  };
}

async function parseSmnGzipBuffer(compressed) {
  const jsonStr = (await gunzip(compressed)).toString("utf8");
  const all = JSON.parse(jsonStr);
  if (!Array.isArray(all)) {
    throw new Error("Respuesta SMN no es un arreglo JSON");
  }
  const tabasco = all.filter((r) => String(r.ides) === TABASCO_IDES);
  if (!tabasco.length) {
    throw new Error("SMN no devolvió registros para Tabasco (ides=27)");
  }
  return buildPayloadFromRows(tabasco);
}

function memoryStillValid(forceRefresh) {
  if (forceRefresh || !cache.data) return false;
  const ttl = cache.stale ? STALE_CACHE_TTL_MS : CACHE_TTL_MS;
  return Date.now() - cache.at < ttl;
}

/**
 * @param {{ forceRefresh?: boolean }} [opts]
 * forceRefresh=true: ignora caché en memoria y vuelve a pedir a SMN (botón Actualizar).
 */
async function fetchTabascoForecast({ forceRefresh = false } = {}) {
  if (memoryStillValid(forceRefresh)) {
    return {
      ...cache.data,
      fromCache: true,
      stale: Boolean(cache.stale || cache.data.stale),
    };
  }

  let lastError = null;

  try {
    const compressed = await downloadSmnPayload();
    const payload = await parseSmnGzipBuffer(compressed);
    cache = { at: Date.now(), data: payload, stale: false };
    try {
      persistFallbackSnapshot(payload);
    } catch (_e) {
      // no bloquear respuesta viva
    }
    return { ...payload, fromCache: false, stale: false };
  } catch (err) {
    lastError = err;
    console.warn("[SMN] Descarga en vivo falló:", err.message);
  }

  // Si hay dato vivo reciente en memoria y el refresh falló, devolverlo
  if (cache.data && !cache.stale && !cache.data.fromFallbackFile) {
    return {
      ...cache.data,
      fromCache: true,
      stale: false,
      warning: `No se pudo refrescar desde SMN (${lastError?.message}). Mostrando última descarga válida.`,
    };
  }

  const fallback = readFallbackSnapshot();
  if (fallback) {
    const warning =
      `SMN no respondió en vivo (${lastError?.message || "error de red"}). ` +
      `Mostrando respaldo local del ${fallback.updatedAt || "archivo"} — puede tener fechas pasadas. ` +
      `Reintenta más tarde con Actualizar.`;
    cache = {
      at: Date.now(),
      data: { ...fallback, stale: true, warning },
      stale: true,
    };
    return {
      ...fallback,
      fromCache: true,
      fromFallbackFile: true,
      stale: true,
      warning,
    };
  }

  throw lastError || new Error("No se pudo obtener el pronóstico SMN");
}

async function downloadSmnPayload() {
  const errors = [];

  for (const url of SMN_URLS) {
    try {
      return await downloadViaAxios(url);
    } catch (e) {
      errors.push(`axios(${url}): ${e.message}`);
    }
    try {
      return await downloadViaHttps(url);
    } catch (e) {
      errors.push(`https(${url}): ${e.message}`);
    }
  }

  const viaCurl = tryCurlDownload(SMN_URLS[0]);
  if (viaCurl) return viaCurl;

  throw new Error(errors.join(" | ") || "Descarga SMN fallida");
}

async function downloadViaAxios(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: 64 * 1024 * 1024,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate",
      Referer: "https://smn.conagua.gob.mx/",
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const buf = Buffer.from(res.data);
  if (buf.length < 1000) throw new Error(`respuesta demasiado pequeña (${buf.length} B)`);
  // Detectar HTML de error
  const head = buf.slice(0, 20).toString("utf8").toLowerCase();
  if (head.includes("<!doctype") || head.includes("<html")) {
    throw new Error("SMN devolvió HTML en lugar de gzip");
  }
  return buf;
}

function downloadViaHttps(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
          Referer: "https://smn.conagua.gob.mx/",
        },
        timeout: DOWNLOAD_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (buf.length < 1000) reject(new Error("respuesta demasiado pequeña"));
          else resolve(buf);
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function tryCurlDownload(url) {
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const result = spawnSync(
    bin,
    [
      "-sL",
      "--max-time",
      "90",
      "-A",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "-H",
      "Referer: https://smn.conagua.gob.mx/",
      url,
    ],
    {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (result.status === 0 && result.stdout?.length > 1000) {
    const head = result.stdout.slice(0, 20).toString("utf8").toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html")) return null;
    return result.stdout;
  }
  return null;
}

/** Precalienta caché al arrancar el servidor (Render/producción). */
function warmSmnCache() {
  fetchTabascoForecast({ forceRefresh: true })
    .then((d) => {
      console.log(
        `[SMN] Caché lista: ${d.municipalityCount} municipios` +
          (d.stale ? " (respaldo)" : " (vivo)")
      );
    })
    .catch((e) => {
      console.warn("[SMN] Precarga fallida:", e.message);
    });
}

function writeFallbackSnapshot(targetPath) {
  return fetchTabascoForecast({ forceRefresh: true }).then((payload) => {
    if (payload.stale || payload.fromFallbackFile) {
      throw new Error(
        payload.warning ||
          "SMN no entregó datos vivos; no se sobrescribe el respaldo con datos viejos."
      );
    }
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const toSave = { ...payload };
    delete toSave.fromCache;
    delete toSave.stale;
    delete toSave.warning;
    delete toSave.fromFallbackFile;
    fs.writeFileSync(targetPath, JSON.stringify(toSave, null, 0));
    return targetPath;
  });
}

module.exports = {
  fetchTabascoForecast,
  warmSmnCache,
  writeFallbackSnapshot,
  CACHE_TTL_MS,
  STALE_CACHE_TTL_MS,
  readFallbackSnapshot,
};
