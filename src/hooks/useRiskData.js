import { useMemo } from "react";

const BASE_SLOPE_SCORE = 2;

const RISK_RANK = { Bajo: 0, Medio: 1, Alto: 2, "Muy alto": 3 };

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

/** Riesgo por lluvia reciente + vulnerabilidad (MVP original). */
function riskLevelRain(indiceBase, acu3, acu7) {
  if (acu7 > 200 || acu3 > 80 || indiceBase >= 7) return "Muy alto";
  if (acu3 > 50 || acu7 > 140 || indiceBase >= 5) return "Alto";
  if (acu3 > 25 || acu7 > 80 || indiceBase >= 3) return "Medio";
  return "Bajo";
}

/**
 * Riesgo por excedente hídrico acumulado (P − ET₀), umbrales del modelo documental.
 * "Moderado" del documento se mapea a "Medio" para no romper la UI.
 * Solo se considera excedente positivo (déficit no genera alerta de inundación).
 */
function riskLevelSurplus(exc7, exc15, exc30) {
  const peak = Math.max(
    Math.max(0, Number(exc7) || 0),
    Math.max(0, Number(exc15) || 0),
    Math.max(0, Number(exc30) || 0)
  );
  if (peak > 200) return "Muy alto";
  if (peak > 100) return "Alto";
  if (peak > 50) return "Medio";
  return "Bajo";
}

function worseRisk(a, b) {
  return (RISK_RANK[a] ?? 0) >= (RISK_RANK[b] ?? 0) ? a : b;
}

/**
 * Híbrido: conserva lluvia + vulnerabilidad y une excedente P−ET₀ (FAO-56).
 * El nivel final es el más severo de ambas lecturas (enfoque preventivo).
 */
function riskLevelHybrid(indiceBase, acu3, acu7, exc7, exc15, exc30) {
  const porLluvia = riskLevelRain(indiceBase, acu3, acu7);
  const porExcedente = riskLevelSurplus(exc7, exc15, exc30);
  return {
    nivel_riesgo_lluvia: porLluvia,
    nivel_riesgo_excedente: porExcedente,
    nivel_riesgo: worseRisk(porLluvia, porExcedente),
  };
}

export function enrichRowsWithRisk(rows) {
  return (rows || []).map((row) => {
    const staticRisk = baseRiskIndex(row.lat, row.lon);
    const hybrid = riskLevelHybrid(
      staticRisk.indice_riesgo_base,
      Number(row.acumulado_3d_mm || 0),
      Number(row.acumulado_7d_mm || 0),
      Number(row.excedente_7d_mm || 0),
      Number(row.excedente_15d_mm || 0),
      Number(row.excedente_30d_mm || 0)
    );

    return {
      ...row,
      ...staticRisk,
      ...hybrid,
    };
  });
}

export default function useRiskData(rainData) {
  const data = useMemo(() => enrichRowsWithRisk(rainData), [rainData]);

  return { data };
}
