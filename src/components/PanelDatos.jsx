import { useMemo } from "react";
import { CloudRain, AlertTriangle, TimerReset, Mountain, Droplets, Activity } from "lucide-react";

const MESES = [
  { value: 1, label: "ENE" },
  { value: 2, label: "FEB" },
  { value: 3, label: "MAR" },
  { value: 4, label: "ABR" },
  { value: 5, label: "MAY" },
  { value: 6, label: "JUN" },
  { value: 7, label: "JUL" },
  { value: 8, label: "AGO" },
  { value: 9, label: "SEP" },
  { value: 10, label: "OCT" },
  { value: 11, label: "NOV" },
  { value: 12, label: "DIC" }
];

export default function PanelDatos({ selectedPoint, selectedYear, selectedMonth, onChangeDate }) {

  // ✅ series estable
  const series = useMemo(() => {
    return selectedPoint?.series ?? [];
  }, [selectedPoint]);
  
  // 🔹 Años únicos disponibles
  const years = useMemo(() => {
    return [...new Set(series.map(s => s.YEAR))].sort((a, b) => b - a);
  }, [series]);

  // 🔹 Meses disponibles para el año seleccionado
  const months = useMemo(() => {
    const mesesDisponibles = series
      .filter(s => s.YEAR === selectedYear)
      .map(s => s.Month);

    return MESES.filter(m => mesesDisponibles.includes(m.value));
  }, [series, selectedYear]);

  const riskColor =
    selectedPoint?.nivel_riesgo === "Muy alto"
      ? "text-red-400"
      : selectedPoint?.nivel_riesgo === "Alto"
        ? "text-orange-400"
        : selectedPoint?.nivel_riesgo === "Medio"
          ? "text-yellow-300"
          : "text-emerald-400";

  return (
    <div className="p-5 space-y-5 lg:h-full lg:overflow-y-auto scroll-minimal">

      {/* SELECTORES */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400">Año</label>
          <select
            className="block mt-1 w-full p-2 rounded bg-slate-950 border border-slate-700 text-gray-200"
            value={selectedYear}
            onChange={(e) =>
              onChangeDate(Number(e.target.value), selectedMonth)
            }
          >
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-400">Mes</label>
          <select
            className="block mt-1 w-full p-2 rounded bg-slate-950 border border-slate-700 text-gray-200 mb-4"
            value={selectedMonth}
            onChange={(e) =>
              onChangeDate(selectedYear, Number(e.target.value))
            }
          >
            {months.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* DATOS */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <Dato
          icon={CloudRain}
          label="Lluvia estimada"
          valor={Number(selectedPoint.lluvia_mm || 0).toFixed(2)}
          unidad="mm"
        />

        <Dato
          icon={TimerReset}
          label="Acumulado 72h"
          valor={Number(selectedPoint.acumulado_3d_mm || 0).toFixed(2)}
          unidad="mm"
        />

        <Dato
          icon={TimerReset}
          label="Acumulado 7 días"
          valor={Number(selectedPoint.acumulado_7d_mm || 0).toFixed(2)}
          unidad="mm"
        />

        <Dato
          icon={Mountain}
          label="Pendiente"
          valor={selectedPoint.pendiente_clase || "N/A"}
          unidad=""
        />

        <Dato
          icon={Droplets}
          label="Humedad de perfil (GWETPROF)"
          valor={Number.isFinite(Number(selectedPoint.gwetprof)) ? Number(selectedPoint.gwetprof).toFixed(2) : "N/A"}
          unidad=""
        />

        <Dato
          icon={Mountain}
          label="Distancia a río"
          valor={selectedPoint.distancia_rio_m ?? "N/A"}
          unidad="m"
        />

        <Dato
          icon={Activity}
          label="ET₀ calculada (FAO Penman-Monteith)"
          valor={
            Number.isFinite(Number(selectedPoint.ET_CALCULADA))
              ? Number(selectedPoint.ET_CALCULADA).toFixed(2)
              : "N/A"
          }
          unidad="mm/día"
        />

        <div className="col-span-2 bg-slate-950/60 p-3 rounded flex gap-3 items-center mb-2">
          <AlertTriangle className={`w-6 h-6 ${riskColor}`} />
          <div>
            <div className="text-gray-400 text-sm">
              Riesgo de inundación actual
            </div>
            <div className="text-white font-semibold text-2xl">
              {selectedPoint.nivel_riesgo || "N/A"}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Índice base: {selectedPoint.indice_riesgo_base ?? "N/A"} | Municipio: {selectedPoint.municipio || "Tabasco"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dato({ icon: Icon, label, valor, unidad }) {
  return (
    <div className="bg-slate-950/60 p-3 rounded flex gap-3 items-center min-w-0">
      {Icon && <Icon className="w-5 h-5 text-blue-400 shrink-0" />}

      <div className="min-w-0">
        <div
          className="text-gray-400 text-xs truncate cursor-help"
          title={label}
        >
          {label}
        </div>

        <div className="text-white font-medium">
          {valor ?? "N/A"} {unidad}
        </div>
      </div>
    </div>
  );
}
