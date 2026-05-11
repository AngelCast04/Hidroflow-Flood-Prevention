import { useMemo } from "react";

const BASE_SLOPE_SCORE = 2;

function slopeClassFromLat(lat) {
  if (lat < 17.8) return "baja";
  if (lat < 18.2) return "media";
  return "alta";
}

function landUseFromLon(lon) {
  const normalized = Math.abs(Math.round(lon * 1000)) % 3;
  if (normalized === 0) return "urbano";
  if (normalized === 1) return "agricola";
  return "vegetacion";
}

function baseRiskIndex(lat, lon) {
  const slopeClass = slopeClassFromLat(lat);
  const use = landUseFromLon(lon);
  const riverDistance = Math.max(150, Math.round(Math.abs(lon + 93.5) * 5500));

  const slopeScore = slopeClass === "baja" ? BASE_SLOPE_SCORE : slopeClass === "media" ? 1 : 0;
  const useScore = use === "urbano" ? 2 : 1;
  const riverScore = riverDistance < 500 ? 3 : riverDistance < 1200 ? 2 : 1;

  return {
    pendiente_clase: slopeClass,
    uso_suelo: use,
    distancia_rio_m: riverDistance,
    indice_riesgo_base: slopeScore + useScore + riverScore,
  };
}

function riskLevel(indiceBase, acu3, acu7) {
  // Ajuste de umbrales para series mensuales PRECTOTCORR.
  if (acu7 > 90 || acu3 > 45 || indiceBase >= 7) return "Muy alto";
  if (acu3 > 30 || acu7 > 65 || indiceBase >= 5) return "Alto";
  if (acu3 > 15 || acu7 > 40 || indiceBase >= 3) return "Medio";
  return "Bajo";
}

export default function useRiskData(rainData) {
  const data = useMemo(() => {
    return (rainData || []).map((row) => {
      const staticRisk = baseRiskIndex(row.lat, row.lon);
      const nivel_riesgo = riskLevel(
        staticRisk.indice_riesgo_base,
        Number(row.acumulado_3d_mm || 0),
        Number(row.acumulado_7d_mm || 0)
      );

      return {
        fecha: row.fecha,
        lat: row.lat,
        lon: row.lon,
        municipio: row.municipio,
        ...staticRisk,
        acumulado_3d_mm: row.acumulado_3d_mm,
        acumulado_7d_mm: row.acumulado_7d_mm,
        gwetprof: row.gwetprof,
        ET_CALCULADA: row.ET_CALCULADA,
        nivel_riesgo,
      };
    });
  }, [rainData]);

  return { data };
}
