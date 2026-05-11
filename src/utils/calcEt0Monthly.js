/**
 * ET0 mensual en mm/día según FAO-56 (Penman-Monteith) adaptado a promedios mensuales,
 * usando: temperatura media (T2M), humedad (RH2M), radiación (ALLSKY_SFC_SW_DWN),
 * viento en 10 m (convertido a 2 m) y presión superficial (PS kPa).
 * Si falta algún número clave devuelve null.
 */

function isValidNumber(v) {
  return Number.isFinite(v) && v > -500;
}

/** Día medio del mes (dia del año, 1-365). */
function julianMiddleDay(month) {
  const mid = [
    null, 15, 46, 74, 105, 135, 166, 196, 227, 257, 288, 318, 344,
  ];
  return mid[month] ?? 172;
}

function extraterrestrialRa(latDeg, julianDay) {
  const Gsc = 0.082;
  const lat = (latDeg * Math.PI) / 180;
  const phi = (2 * Math.PI) / 365;
  const d = julianDay;
  const Dr = 1 + 0.033 * Math.cos(phi * d);
  const sigma = 0.409 * Math.sin(((2 * Math.PI * d) / 365) - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(sigma))));
  const Ra =
    (((24 * 60) / Math.PI) * Gsc * Dr) *
    (ws * Math.sin(lat) * Math.sin(sigma) + Math.cos(lat) * Math.cos(sigma) * Math.sin(ws));
  return Ra > 0 ? Ra : null;
}

function satVaporPressureKpa(tC) {
  return 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));
}

/** u10 (m/s) a u2 usando perfil logarítmico estándar (FAO approx). */
export function wind10mTo2m(u10) {
  if (!Number.isFinite(u10) || u10 < 0) return null;
  return u10 * 0.747;
}

/**
 * ET0 mm/día. latDeg en decimal.
 */
export function calcEt0Monthly({
  latDeg,
  month,
  tMeanC,
  rhPct,
  rsMjM2Day,
  psKpa,
  ws10Ms,
}) {
  if (!Number.isFinite(latDeg)) return null;
  if (!Number.isFinite(tMeanC) || !Number.isFinite(rhPct)) return null;

  const T = tMeanC;
  const RH = Math.min(100, Math.max(0, rhPct));

  const jd = julianMiddleDay(month);
  const Ra = extraterrestrialRa(latDeg, jd);
  if (!Number.isFinite(Ra) || Ra <= 0) return null;

  let Rs =
    isValidNumber(rsMjM2Day) && rsMjM2Day <= 996 && rsMjM2Day >= 0
      ? rsMjM2Day
      : null;

  /** Si falta Rs (p.ej. -999 en serie), usar fracción de Ra típica de cielo nublado tropical. */
  if (Rs == null) {
    Rs = 0.45 * Ra;
  }
  const P =
    Number.isFinite(psKpa) && psKpa > 50 && psKpa < 115
      ? psKpa
      : 101.3;

  let u10 = ws10Ms;
  if (!Number.isFinite(u10) || u10 < 0) u10 = 2;
  const u2 = wind10mTo2m(u10);
  if (u2 === null) return null;

  const albedoRef = 0.23;
  const RnS = Rs * (1 - albedoRef);

  const es = satVaporPressureKpa(T);
  const ea = (RH / 100) * es;

  const TmaxGuess = T + 5;
  const TminGuess = T - 5;
  const TmaxK = TmaxGuess + 273.16;
  const TminK = TminGuess + 273.16;
  const sigma = 4.903e-9;

  const Rso = Ra * (0.75 + 2e-5 * 0);
  let ratio = Rso > 1e-6 ? Rs / Rso : 0.8;
  ratio = Math.max(0.3, Math.min(1.0, ratio));

  const Rnl =
    -sigma *
    ((Math.pow(TmaxK, 4) + Math.pow(TminK, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) *
    (1.35 * ratio - 0.35);

  const Rn = RnS + Rnl;
  const G = 0;

  const delta =
    (4098 *
      satVaporPressureKpa(Math.max(-50, Math.min(60, T)))) /
    Math.pow(T + 237.3, 2);

  const gamma = 0.000665 * P;

  const termRad = (0.408 * delta * Math.max(Rn - G, 0)) /
    Math.max(delta + gamma * (1 + 0.34 * u2), 1e-8);
  const termAero =
    ((gamma * 900 * u2 * (es - ea)) / Math.max(T + 273.16, 1)) /
    Math.max(delta + gamma * (1 + 0.34 * u2), 1e-8);

  const ET0 = termRad + termAero;
  if (!Number.isFinite(ET0) || ET0 < 0) return null;
  return ET0;
}
