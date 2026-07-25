export function normalizeMunicipio(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Municipios de la región Chontalpa (nombres normalizados como los publica SMN). */
export const CHONTALPA_MUNICIPIOS = [
  "cardenas",
  "comalcalco",
  "cunduacan",
  "huimanguillo",
  "jalpa de mendez",
  "nacajuca",
  "paraiso",
];

export function isChontalpa(name) {
  return CHONTALPA_MUNICIPIOS.includes(normalizeMunicipio(name));
}

/** Empareja el municipio del panel (centroides) con un registro del pronóstico SMN. */
export function matchSmnMunicipio(localName, municipalities = []) {
  if (!localName || !municipalities.length) return null;
  const n = normalizeMunicipio(localName);
  if (!n) return null;

  let hit = municipalities.find((m) => normalizeMunicipio(m.nmun) === n);
  if (hit) return hit;

  hit = municipalities.find((m) => {
    const smn = normalizeMunicipio(m.nmun);
    return smn.includes(n) || n.includes(smn);
  });
  return hit || null;
}

export function forecastAdvisory(municipality) {
  if (!municipality?.days?.length) {
    return { level: "info", label: "Sin datos", hint: "Selecciona un municipio." };
  }
  const total = municipality.precTotal3d ?? 0;
  const maxDay = municipality.maxPrecDay ?? 0;
  const maxProb = municipality.maxProbprec ?? 0;

  if (total >= 80 || maxDay >= 50) {
    return {
      level: "high",
      label: "Atención elevada",
      hint: "Lluvia pronosticada significativa en los próximos 3 días. Refuerza medidas preventivas.",
    };
  }
  if (total >= 40 || maxDay >= 25 || maxProb >= 70) {
    return {
      level: "medium",
      label: "Precaución",
      hint: "Posibles episodios de lluvia. Revisa drenajes y zonas bajas.",
    };
  }
  return {
    level: "low",
    label: "Condición moderada",
    hint: "Pronóstico sin acumulados extremos en la ventana de 3 días.",
  };
}
