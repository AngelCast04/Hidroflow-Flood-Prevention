const zlib = require("zlib");
const { promisify } = require("util");
const { spawnSync } = require("child_process");

const gunzip = promisify(zlib.gunzip);

const SMN_URL = "https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1";
const TABASCO_IDES = "27";
const CACHE_TTL_MS = 15 * 60 * 1000;

let cache = { at: 0, data: null };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchTabascoForecast() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, fromCache: true };
  }

  const compressed = await downloadSmnPayload();
  const jsonStr = (await gunzip(compressed)).toString("utf8");
  const all = JSON.parse(jsonStr);
  if (!Array.isArray(all)) {
    throw new Error("Respuesta SMN no es un arreglo JSON");
  }

  const tabasco = all.filter((r) => String(r.ides) === TABASCO_IDES);
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

  const payload = {
    updatedAt: new Date().toISOString(),
    cacheExpiresInSec: Math.round(CACHE_TTL_MS / 1000),
    source: "SMN-CONAGUA",
    method: 1,
    state: "Tabasco",
    ides: TABASCO_IDES,
    municipalityCount: municipalities.length,
    municipalities,
  };

  cache = { at: Date.now(), data: payload };
  return { ...payload, fromCache: false };
}

async function downloadSmnPayload() {
  try {
    const res = await fetch(SMN_URL);
    if (!res.ok) {
      throw new Error(`SMN respondió con estado ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const viaCurl = tryCurlDownload();
    if (viaCurl) return viaCurl;
    throw err;
  }
}

/** Fallback en entornos donde fetch falla por certificados TLS (común en Windows local). */
function tryCurlDownload() {
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const result = spawnSync(bin, ["-s", SMN_URL], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status === 0 && result.stdout?.length > 1000) {
    return result.stdout;
  }
  return null;
}

module.exports = { fetchTabascoForecast, CACHE_TTL_MS };
