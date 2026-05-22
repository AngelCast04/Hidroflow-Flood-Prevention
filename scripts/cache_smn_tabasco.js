/**
 * Tras npm run build, intenta guardar pronóstico Tabasco en build/forecast_tabasco.json
 * para que Render sirva respaldo si SMN falla en runtime.
 */
const path = require("path");
const { writeFallbackSnapshot } = require("../lib/smnForecast");

const out = path.join(__dirname, "..", "build", "forecast_tabasco.json");

writeFallbackSnapshot(out)
  .then((p) => {
    console.log("[cache_smn_tabasco] OK:", p);
  })
  .catch((e) => {
    console.warn("[cache_smn_tabasco] Omitido (sin red o SMN bloqueado):", e.message);
    process.exit(0);
  });
