import { ComposedChart, Line, XAxis, YAxis, Tooltip, Area, ResponsiveContainer } from "recharts";

function TooltipInfo({ active, label, payload }) {
  if (!active || !payload?.length) return null;

  const getValue = (key) => {
    const entry = payload.find((p) => p?.dataKey === key);
    const v = Number(entry?.value);
    return Number.isFinite(v) ? v : null;
  };

  const lluvia = getValue("lluvia");
  const acumulado7d = getValue("acumulado7d");
  const et = getValue("et");

  return (
    <div className="bg-white/95 text-slate-800 rounded-md shadow-lg px-3 py-2 text-xs leading-tight min-w-[210px]">
      <div className="font-semibold text-sm mb-1">{label}</div>
      <div className="text-sky-600 font-medium">lluvia : {lluvia == null ? "N/A" : `${lluvia.toFixed(2)} mm/día`}</div>
      <div className="text-orange-600 font-medium">
        acumulado7d : {acumulado7d == null ? "N/A" : `${acumulado7d.toFixed(2)} mm`}
      </div>
      <div className="text-emerald-600 font-medium">
        Evapotranspiración : {et == null ? "N/A" : `${et.toFixed(2)} mm/día`}
      </div>
    </div>
  );
}

export default function GraficaMensual({ series }) {
  if (!series || series.length === 0)
    return (
      <div className="p-4 text-sm text-gray-400">
        Selecciona un punto para ver la serie temporal.
      </div>
    );

  // Volvemos al ancho extendido original para que la serie no se comprima.
  const chartWidth = Math.max(series.length * 4, 800);

  return (
    <div className="w-full h-full p-4 flex flex-col bg-gradient-to-b from-slate-900/80 to-slate-900/40 rounded-2xl">
      <h3 className="text-base font-semibold mb-2">
        Serie diaria {series[0]?.YEAR || ""} — lluvia, acumulado 7 días y evapotranspiración
      </h3>

      <div className="flex-1 w-full overflow-x-auto overflow-y-visible scroll-minimal">
        <div style={{ width: chartWidth }} className="h-full">
        <ResponsiveContainer width="100%" height="100%">

            <ComposedChart
              data={series}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >

              {/* DEGRADADO */}
              <defs>
                <linearGradient id="rainGradient" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.55}/>
  <stop offset="50%" stopColor="#38bdf8" stopOpacity={0.25}/>
  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0}/>
</linearGradient>
              </defs>

              <XAxis
                dataKey="label"
                tick={{ fontSize: 9 }}
                interval="preserveStartEnd"
                minTickGap={20}
              />

              <YAxis yAxisId="left" domain={[0, "auto"]} />
              <YAxis yAxisId="right" orientation="right" domain={[0, "auto"]} width={52} />

              <Tooltip
                content={<TooltipInfo />}
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ zIndex: 50 }}
              />

              {/* AREA DEGRADADA */}
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="lluvia"
                fill="url(#rainGradient)"
                stroke="none"
                baseValue={0}
                connectNulls
                tooltipType="none"
                fillOpacity={1}
              />

              {/* LINEA */}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="lluvia"
                stroke="#38bdf8"
                style={{ filter: "drop-shadow(0 0 8px rgba(56,189,248,0.9))" }}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                yAxisId="left"
                type="monotone"
                dataKey="acumulado7d"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                yAxisId="right"
                type="monotone"
                dataKey="et"
                stroke="#34d399"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />

            </ComposedChart>

        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
