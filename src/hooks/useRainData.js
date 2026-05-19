import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import { calcEt0Monthly } from "../utils/calcEt0Monthly";

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

const MONTH_TO_DATE = (year, month) =>
  new Date(Date.UTC(year, Math.max(0, month - 1), 1)).toISOString().slice(0, 10);

/**
 * Cabeceras / puntos de referencia INEGI aproximados (Tabasco + Carmen en Camp. para grillas costeras).
 * Centla: municipio cuya cabecera es la ciudad de Frontera (no existe municipio "Frontera").
 */
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
  { name: "Catazajá", lat: 17.734, lon: -92.014},
  { name: "Emiliano Zapata", lat: 17.7425, lon: -91.7656 },
  { name: "Centla (Frontera)", lat: 18.5917, lon: -92.6486 },
  { name: "Balancán", lat: 17.799, lon: -91.534 },
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

  MUNICIPALITY_CENTROIDS.forEach((m) => {
    const km = distanceKm(lat, lon, m.lat, m.lon);
    if (km < bestKm) {
      bestKm = km;
      nearest = m;
    }
  });

  return nearest?.name || "Tabasco";
}

export default function useRainData() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const datasetCandidates = [
      "/data/Evapotranspiracion%20RP.csv",
      "/data/Evapotranspiracion RP.csv",
      "/data/evapotranspiracion_completa.csv",
    ];

    const parseCsv = (csv) => {
      Papa.parse(csv, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (result) => {
          const monthlyByPoint = new Map();

          (result.data || []).forEach((r) => {
            const year = Number(r.YEAR);
            const lat = Number(r.LAT);
            const lon = Number(r.LON);
            const parametro = String(r.PARAMETRO || "").trim().toUpperCase();

            if (!Number.isFinite(year) || !Number.isFinite(lat) || !Number.isFinite(lon) || !parametro) {
              return;
            }

            MONTHS.forEach(({ key, month, label }) => {
              const value = Number(r[key]);
              if (!Number.isFinite(value)) return;

              const pointMonthKey = `${lat}_${lon}_${year}_${month}`;
              if (!monthlyByPoint.has(pointMonthKey)) {
                monthlyByPoint.set(pointMonthKey, {
                  fecha: MONTH_TO_DATE(year, month),
                  YEAR: year,
                  Month: month,
                  Mes: label,
                  lat,
                  lon,
                  municipio: getMunicipalityFromCoords(lat, lon),
                  lluvia_mm: null,
                  gwetprof: null,
                  t2m_c: null,
                  rh2_pct: null,
                  rs_mj: null,
                  ps_kpa: null,
                  ws10_m_s: null,
                  ET_CALCULADA: null,
                });
              }

              const entry = monthlyByPoint.get(pointMonthKey);
              if (parametro === "PRECTOTCORR") entry.lluvia_mm = value;
              if (parametro === "GWETPROF") entry.gwetprof = value;
              if (parametro === "T2M") entry.t2m_c = value;
              if (parametro === "RH2M") entry.rh2_pct = value;
              if (parametro === "PS") entry.ps_kpa = value;
              if (parametro === "WS10M") entry.ws10_m_s = value;
              if (parametro === "ALLSKY_SFC_SW_DWN") {
                entry.rs_mj =
                  Number.isFinite(value) && value > -998 && value < 998 ? value : null;
              }
            });
          });

          const parsed = Array.from(monthlyByPoint.values())
            .filter((r) => Number.isFinite(r.lluvia_mm))
            .sort((a, b) => {
              const byYearMonth = a.YEAR - b.YEAR || a.Month - b.Month;
              if (byYearMonth !== 0) return byYearMonth;
              return a.lat - b.lat || a.lon - b.lon;
            })
            .map((row) => {
              const et =
                Number.isFinite(row.t2m_c) && Number.isFinite(row.rh2_pct)
                  ? calcEt0Monthly({
                      latDeg: row.lat,
                      month: row.Month,
                      tMeanC: row.t2m_c,
                      rhPct: row.rh2_pct,
                      rsMjM2Day: row.rs_mj,
                      psKpa: row.ps_kpa,
                      ws10Ms: row.ws10_m_s,
                    })
                  : null;
              return { ...row, ET_CALCULADA: et };
            });

          const rollingByPoint = new Map();
          const enriched = parsed.map((row) => {
            const key = `${row.lat}_${row.lon}`;
            const history = rollingByPoint.get(key) || [];
            history.push(row);

            const acumulado3d = history
              .slice(-3)
              .reduce((sum, item) => sum + (item.lluvia_mm || 0), 0);
            const acumulado7d = history
              .slice(-7)
              .reduce((sum, item) => sum + (item.lluvia_mm || 0), 0);

            rollingByPoint.set(key, history);

            return {
              ...row,
              acumulado_3d_mm: acumulado3d,
              acumulado_7d_mm: acumulado7d,
            };
          });

          setRows(enriched);
          setLoading(false);
        },
        error: () => setLoading(false),
      });
    };

    (async () => {
      for (const path of datasetCandidates) {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) continue;
          const csv = await res.text();
          // Si devuelve HTML (fallback de SPA), no es el dataset.
          if (/<!doctype html/i.test(csv)) continue;
          if (!/PARAMETRO,YEAR,LAT,LON/i.test(csv.slice(0, 200))) continue;
          parseCsv(csv);
          return;
        } catch (_e) {
          // Intentar siguiente ruta
        }
      }
      setLoading(false);
    })();
  }, []);

  const latestDate = useMemo(() => {
    if (!rows.length) return null;
    return rows[rows.length - 1].fecha;
  }, [rows]);

  return { data: rows, loading, latestDate };
}
