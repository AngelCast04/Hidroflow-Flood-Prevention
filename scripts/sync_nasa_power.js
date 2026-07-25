/**
 * Sincroniza caché local NASA POWER (data/power_cache/).
 * Uso: npm run power:sync
 *      npm run power:sync -- --full
 */
const { syncPowerCache, cacheCsvPath, cacheMetaPath } = require("../lib/nasaPower");

const forceFull = process.argv.includes("--full");

syncPowerCache({ forceFull })
  .then((r) => {
    console.log("[power:sync] OK");
    console.log("  csv :", cacheCsvPath());
    console.log("  meta:", cacheMetaPath());
    console.log("  rows:", r.meta?.rows);
    console.log("  lastEnd:", r.meta?.lastEnd);
    console.log("  source:", r.meta?.source);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[power:sync] FAIL:", e.message);
    process.exit(1);
  });
