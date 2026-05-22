import { useMemo, useState, useEffect } from "react";

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * p))
  );
  return sortedValues[idx];
}

function formatNum(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "N/A";
  return Number(value).toFixed(digits);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function MetricCard({ label, value, unit, progress = 0, color = "bg-sky-500" }) {
  const pct = Math.round(clamp01(progress) * 100);
  return (
    <div className="bg-slate-950/60 rounded p-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">{label}</span>
        <span className="text-white font-medium">
          {value} {unit}
        </span>
      </div>
      <div className="h-2 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Badge({ label, tone = "slate" }) {
  const toneClass = {
    slate: "bg-slate-800 text-slate-200",
    blue: "bg-blue-600/40 text-blue-200",
    green: "bg-emerald-600/40 text-emerald-200",
    yellow: "bg-yellow-600/40 text-yellow-100",
    orange: "bg-orange-600/40 text-orange-100",
    red: "bg-red-600/40 text-red-100",
  }[tone];

  return <span className={`px-2 py-1 rounded text-[11px] ${toneClass}`}>{label}</span>;
}

export default function InfoSheet({ selectedPoint, activeLayer }) {
  const [sheet, setSheet] = useState("lluvia");

  useEffect(() => {
    if (activeLayer === "lluvia") setSheet("lluvia");
  }, [activeLayer]);

  const series = selectedPoint?.series || [];

  const rainStats = useMemo(() => {
    if (!selectedPoint || !series.length) return null;
    const month = Number(selectedPoint.Month);
    const sameMonth = series
      .filter((s) => Number(s.Month) === month)
      .map((s) => Number(s.lluvia_mm))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    if (!sameMonth.length) return null;

    const avg = sameMonth.reduce((acc, n) => acc + n, 0) / sameMonth.length;
    const p90 = percentile(sameMonth, 0.9);
    const current = Number(selectedPoint.lluvia_mm || 0);
    const anomaly = avg > 0 ? ((current - avg) / avg) * 100 : 0;

    const idx = series.findIndex(
      (s) => Number(s.YEAR) === Number(selectedPoint.YEAR) && Number(s.Month) === month
    );
    const prev = idx > 0 ? Number(series[idx - 1].lluvia_mm || 0) : null;
    const trend =
      prev == null
        ? "Sin referencia previa"
        : current > prev
          ? "Subiendo"
          : current < prev
            ? "Bajando"
            : "Estable";

    return { avg, p90, current, anomaly, trend };
  }, [selectedPoint, series]);

  const etStats = useMemo(() => {
    if (!selectedPoint) return null;
    const lluvia = Number(selectedPoint.lluvia_mm || 0);
    const et = Number(selectedPoint.ET_CALCULADA);
    if (!Number.isFinite(et)) return { balance: null, lectura: "Evapotranspiración no disponible" };

    const balance = lluvia - et * 30;
    let lectura = "Balance intermedio";
    if (balance >= 40) lectura = "Exceso hídrico (posible saturación)";
    else if (balance <= -20) lectura = "Déficit hídrico";

    return { balance, lectura };
  }, [selectedPoint]);

  const riskTone = useMemo(() => {
    const risk = selectedPoint?.nivel_riesgo;
    if (risk === "Muy alto") return "red";
    if (risk === "Alto") return "orange";
    if (risk === "Medio") return "yellow";
    if (risk === "Bajo") return "green";
    return "slate";
  }, [selectedPoint?.nivel_riesgo]);

  const trendTone = useMemo(() => {
    if (!rainStats?.trend) return "slate";
    if (rainStats.trend === "Subiendo") return "orange";
    if (rainStats.trend === "Bajando") return "blue";
    if (rainStats.trend === "Estable") return "green";
    return "slate";
  }, [rainStats?.trend]);

  if (!selectedPoint) {
    return (
      <div className="dashboard-card p-3 text-xs text-slate-400">
        Selecciona un punto para ver las sheets de información (lluvia, riesgo y evapotranspiración).
      </div>
    );
  }

  return (
    <div className="dashboard-card p-3 text-xs space-y-3">
      <div className="flex gap-2">
        {[
          { id: "lluvia", label: "Sheet lluvia" },
          { id: "riesgo", label: "Sheet riesgo" },
          { id: "et", label: "Sheet evapotranspiración" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSheet(tab.id)}
            className={`px-2 py-1 rounded ${
              sheet === tab.id ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {sheet === "lluvia" && (
        <div className="space-y-2 text-slate-300">
          <div className="flex items-center gap-2">
            <Badge label={`Tendencia: ${rainStats?.trend || "N/A"}`} tone={trendTone} />
            <Badge label={`Anomalía: ${formatNum(rainStats?.anomaly, 1)}%`} tone="blue" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <MetricCard
              label="Lluvia actual"
              value={formatNum(selectedPoint.lluvia_mm)}
              unit="mm"
              progress={(Number(selectedPoint.lluvia_mm || 0)) / 120}
              color="bg-sky-500"
            />
            <MetricCard
              label="Acumulado 72h"
              value={formatNum(selectedPoint.acumulado_3d_mm)}
              unit="mm"
              progress={(Number(selectedPoint.acumulado_3d_mm || 0)) / 160}
              color="bg-cyan-500"
            />
            <MetricCard
              label="Acumulado 7 días"
              value={formatNum(selectedPoint.acumulado_7d_mm)}
              unit="mm"
              progress={(Number(selectedPoint.acumulado_7d_mm || 0)) / 280}
              color="bg-indigo-500"
            />
            <MetricCard
              label="Media histórica (mes)"
              value={formatNum(rainStats?.avg)}
              unit="mm"
              progress={(Number(rainStats?.avg || 0)) / 120}
              color="bg-emerald-500"
            />
          </div>

          <div className="bg-slate-950/60 rounded p-2">
            <div className="flex items-center justify-between text-slate-300">
              <span>Posición vs P90 histórico</span>
              <span className="text-white font-medium">
                {formatNum(rainStats?.current)} / {formatNum(rainStats?.p90)} mm
              </span>
            </div>
            <div className="h-2 bg-slate-800 rounded mt-1 overflow-hidden">
              <div
                className="h-full bg-orange-500"
                style={{
                  width: `${Math.round(
                    clamp01(
                      (Number(rainStats?.current || 0)) / Math.max(Number(rainStats?.p90 || 1), 1)
                    ) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {sheet === "riesgo" && (
        <div className="space-y-2 text-slate-300">
          <div className="flex items-center justify-between bg-slate-950/60 rounded p-2">
            <span>Nivel de riesgo</span>
            <Badge label={selectedPoint.nivel_riesgo || "N/A"} tone={riskTone} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <MetricCard
              label="Índice base"
              value={selectedPoint.indice_riesgo_base ?? "N/A"}
              unit=""
              progress={(Number(selectedPoint.indice_riesgo_base || 0)) / 8}
              color="bg-rose-500"
            />
            <MetricCard
              label="Distancia a río"
              value={selectedPoint.distancia_rio_m ?? "N/A"}
              unit="m"
              progress={1 - clamp01((Number(selectedPoint.distancia_rio_m || 0)) / 3000)}
              color="bg-blue-500"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Badge label={`Pendiente: ${selectedPoint.pendiente_clase || "N/A"}`} tone="slate" />
            <Badge label={`Uso de suelo: ${selectedPoint.uso_suelo || "N/A"}`} tone="slate" />
          </div>

          <div className="text-slate-400">
            Semáforo combinado a partir de lluvia reciente + vulnerabilidad local.
          </div>
        </div>
      )}

      {sheet === "et" && (
        <div className="space-y-2 text-slate-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <MetricCard
              label="Evapotranspiración calculada"
              value={formatNum(selectedPoint.ET_CALCULADA)}
              unit="mm/día"
              progress={(Number(selectedPoint.ET_CALCULADA || 0)) / 8}
              color="bg-emerald-500"
            />
            <MetricCard
              label="Humedad de perfil del suelo"
              value={formatNum(selectedPoint.gwetprof)}
              unit=""
              progress={Number(selectedPoint.gwetprof || 0)}
              color="bg-teal-500"
            />
          </div>

          <div className="bg-slate-950/60 rounded p-2 space-y-1">
            <div className="flex items-center justify-between">
              <span>Balance lluvia - evapotranspiración</span>
              <span className="text-white font-medium">{formatNum(etStats?.balance)} mm/mes</span>
            </div>
            <div className="h-2 bg-slate-800 rounded overflow-hidden">
              <div
                className={Number(etStats?.balance) >= 0 ? "h-full bg-emerald-500" : "h-full bg-amber-500"}
                style={{ width: `${Math.round(clamp01(Math.abs(Number(etStats?.balance || 0)) / 120) * 100)}%` }}
              />
            </div>
            <div className="text-slate-400">{etStats?.lectura || "N/A"}</div>
          </div>
        </div>
      )}
    </div>
  );
}

