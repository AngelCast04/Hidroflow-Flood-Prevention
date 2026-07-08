import Papa from "papaparse";
import { useCallback, useEffect, useRef, useState } from "react";
import { calcEt0Daily } from "../utils/calcEt0Daily";

const MONTH_LABELS = [
  "", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SEP", "OCT", "NOV", "DIC",
];

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
  { name: "Balancán", lat: 17.799, lon: -91.534 },
  { name: "Jonuta", lat: 17.9833, lon: -92.1333 },
  { name: "Ciudad del Carmen", lat: 18.6508, lon: -91.8297 },
];

function parseNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!raw || raw.toUpperCase() === "N/A" || raw.toUpperCase() === "NA") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= -998) return null;
  return n;
}

function doyToParts(year, doy) {
  const date = new Date(Date.UTC(year, 0, doy));
  return {
    fecha: date.toISOString().slice(0, 10),
    Month: date.getUTCMonth() + 1,
    Day: date.getUTCDate(),
    Mes: MONTH_LABELS[date.getUTCMonth() + 1] || "",
  };
}

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

  MUNICIPALITY_CENTROIDS.forEach((m) => {
    const km = distanceKm(lat, lon, m.lat, m.lon);
    if (km < bestKm) {
      bestKm = km;
      nearest = m;
    }
  });

  return nearest?.name || "Tabasco";
}

function buildDailyRows(rawRows) {
  const byPoint = new Map();

  rawRows.forEach((r) => {
    const year = Number(r.YEAR);
    const doy = Number(r.DOY);
    const lat = Number(r.LAT);
    const lon = Number(r.LON);

    if (!Number.isFinite(year) || !Number.isFinite(doy) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }

    const lluvia_mm = parseNum(r.PRECTOTCORR);
    if (!Number.isFinite(lluvia_mm)) return;

    const { fecha, Month, Day, Mes } = doyToParts(year, doy);
    const key = `${lat}_${lon}`;

    if (!byPoint.has(key)) byPoint.set(key, []);
    byPoint.get(key).push({
      fecha,
      YEAR: year,
      DOY: doy,
      Month,
      Day,
      Mes,
      lat,
      lon,
      municipio: getMunicipalityFromCoords(lat, lon),
      lluvia_mm,
      gwetprof: parseNum(r.GWETPROF),
      gwetroot: parseNum(r.GWETROOT),
      t2m_c: parseNum(r.T2M),
      rh2_pct: parseNum(r.RH2M),
      rs_mj: parseNum(r.ALLSKY_SFC_SW_DWN),
      ps_kpa: parseNum(r.PS),
      ws10_m_s: parseNum(r.WS10M),
      ET_CALCULADA: null,
      acumulado_3d_mm: 0,
      acumulado_7d_mm: 0,
    });
  });

  const seriesByPoint = new Map();
  let globalLatest = null;

  byPoint.forEach((rows, key) => {
    rows.sort((a, b) => a.YEAR - b.YEAR || a.DOY - b.DOY);

    const enriched = rows.map((row, idx) => {
      const et =
        Number.isFinite(row.t2m_c) && Number.isFinite(row.rh2_pct)
          ? calcEt0Daily({
              latDeg: row.lat,
              doy: row.DOY,
              tMeanC: row.t2m_c,
              rhPct: row.rh2_pct,
              rsMjM2Day: row.rs_mj,
              psKpa: row.ps_kpa,
              ws10Ms: row.ws10_m_s,
            })
          : null;

      const slice3 = rows.slice(Math.max(0, idx - 2), idx + 1);
      const slice7 = rows.slice(Math.max(0, idx - 6), idx + 1);
      const acumulado3d = slice3.reduce((sum, item) => sum + (item.lluvia_mm || 0), 0);
      const acumulado7d = slice7.reduce((sum, item) => sum + (item.lluvia_mm || 0), 0);

      const entry = { ...row, ET_CALCULADA: et, acumulado_3d_mm: acumulado3d, acumulado_7d_mm: acumulado7d };
      if (!globalLatest || entry.fecha > globalLatest) globalLatest = entry.fecha;
      return entry;
    });

    seriesByPoint.set(key, enriched);
  });

  const mapRows = Array.from(seriesByPoint.values())
    .map((series) => series[series.length - 1])
    .filter(Boolean);

  return { seriesByPoint, mapRows, latestDate: globalLatest };
}

export default function useRainData() {
  const [mapRows, setMapRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [latestDate, setLatestDate] = useState(null);
  const seriesRef = useRef(new Map());

  const getPointSeries = useCallback((lat, lon) => {
    return seriesRef.current.get(`${lat}_${lon}`) || [];
  }, []);

  useEffect(() => {
    let cancelled = false;

    const datasetCandidates = [
      "/data/DATASET_UPDATE.csv",
      "/data/Evapotranspiracion%20RP.csv",
      "/data/Evapotranspiracion RP.csv",
    ];

    const finishWithError = (message) => {
      if (cancelled) return;
      setLoadError(message);
      setMapRows([]);
      setLatestDate(null);
      seriesRef.current = new Map();
      setLoading(false);
    };

    (async () => {
      for (const path of datasetCandidates) {
        if (cancelled) return;
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) continue;
          const csv = await res.text();
          if (/<!doctype html/i.test(csv)) continue;
          if (!/YEAR,DOY,LAT,LON/i.test(csv.slice(0, 300))) continue;

          const result = await new Promise((resolve, reject) => {
            Papa.parse(csv, {
              header: true,
              dynamicTyping: false,
              skipEmptyLines: true,
              complete: resolve,
              error: reject,
            });
          });

          if (cancelled) return;

          setTimeout(() => {
            if (cancelled) return;
            try {
              const { seriesByPoint, mapRows, latestDate: latest } = buildDailyRows(result.data || []);
              if (!mapRows.length) {
                finishWithError("El dataset diario no produjo puntos válidos.");
                return;
              }
              seriesRef.current = seriesByPoint;
              setMapRows(mapRows);
              setLatestDate(latest);
              setLoadError(null);
              setLoading(false);
            } catch (err) {
              finishWithError(err?.message || "Error al procesar el dataset diario.");
            }
          }, 0);
          return;
        } catch (_e) {
          // Intentar siguiente ruta
        }
      }
      finishWithError("No se encontró DATASET_UPDATE.csv. Verifica public/data/.");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { data: mapRows, loading, loadError, latestDate, getPointSeries };
}
