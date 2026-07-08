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
  // Umbrales para acumulados diarios (3 y 7 días), alineados con ventana SMN.
  if (acu7 > 200 || acu3 > 80 || indiceBase >= 7) return "Muy alto";
  if (acu3 > 50 || acu7 > 140 || indiceBase >= 5) return "Alto";
  if (acu3 > 25 || acu7 > 80 || indiceBase >= 3) return "Medio";
  return "Bajo";
}

export function enrichRowsWithRisk(rows) {
  return (rows || []).map((row) => {
    const staticRisk = baseRiskIndex(row.lat, row.lon);
    const nivel_riesgo = riskLevel(
      staticRisk.indice_riesgo_base,
      Number(row.acumulado_3d_mm || 0),
      Number(row.acumulado_7d_mm || 0)
    );

    return {
      ...row,
      ...staticRisk,
      nivel_riesgo,
    };
  });
}

export default function useRiskData(rainData) {
  const data = useMemo(() => enrichRowsWithRisk(rainData), [rainData]);

  return { data };
}
