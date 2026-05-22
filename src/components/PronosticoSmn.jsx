import { useEffect, useMemo, useState } from "react";
import {
  CloudRain,
  RefreshCw,
  AlertTriangle,
  Thermometer,
  Wind,
  CalendarDays,
} from "lucide-react";
import { matchSmnMunicipio, forecastAdvisory } from "../utils/matchSmnMunicipio";

const DAY_LABELS = ["Hoy", "Mañana", "Pasado mañana"];

function advisoryTone(level) {
  if (level === "high") return "border-red-500/40 bg-red-950/30 text-red-200";
  if (level === "medium") return "border-amber-500/40 bg-amber-950/30 text-amber-100";
  if (level === "low") return "border-emerald-500/40 bg-emerald-950/30 text-emerald-100";
  return "border-slate-600 bg-slate-900/50 text-slate-300";
}

export default function PronosticoSmn({
  linkedMunicipio,
  data,
  loading,
  error,
  reload,
}) {
  const municipalities = data?.municipalities ?? [];
  const updatedAt = data?.updatedAt ?? null;
  const source = data?.source ?? "SMN-CONAGUA";
  const [selectedIdmun, setSelectedIdmun] = useState("");

  const linkedMatch = useMemo(
    () => matchSmnMunicipio(linkedMunicipio, municipalities),
    [linkedMunicipio, municipalities]
  );

  useEffect(() => {
    if (linkedMatch?.idmun) {
      setSelectedIdmun(String(linkedMatch.idmun));
    } else if (!selectedIdmun && municipalities[0]?.idmun) {
      setSelectedIdmun(String(municipalities[0].idmun));
    }
  }, [linkedMatch, municipalities, selectedIdmun]);

  const selected = useMemo(
    () => municipalities.find((m) => String(m.idmun) === String(selectedIdmun)),
    [municipalities, selectedIdmun]
  );

  const advisory = useMemo(() => forecastAdvisory(selected), [selected]);

  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString("es-MX", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

  if (loading) {
    return (
      <div className="p-6 text-slate-400 text-sm animate-pulse">
        Cargando pronóstico SMN para Tabasco…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-300 text-sm">{error}</p>
        <p className="text-slate-500 text-xs">
          En desarrollo ejecuta <code className="text-blue-300">node server.js</code> antes del
          frontend. El proxy evita CORS y descomprime el GZip del SMN.
        </p>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600/80 text-sm hover:bg-blue-500"
        >
          <RefreshCw size={14} />
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-5 space-y-4 lg:h-full lg:overflow-y-auto scroll-minimal">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-blue-300 flex items-center gap-2">
            <CalendarDays size={18} />
            Pronóstico 3 días — Tabasco
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Fuente: {source} · Actualizado: {updatedLabel}
            {data?.fromCache ? " (caché servidor)" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw size={14} />
          Actualizar
        </button>
      </div>

      {linkedMunicipio && (
        <p className="text-xs text-cyan-400/90">
          Punto del mapa asociado a: <strong>{linkedMunicipio}</strong>
          {linkedMatch ? ` → ${linkedMatch.nmun}` : " (sin coincidencia exacta en SMN)"}
        </p>
      )}

      <label className="block text-xs text-slate-400">
        Municipio
        <select
          value={selectedIdmun}
          onChange={(e) => setSelectedIdmun(e.target.value)}
          className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
        >
          {municipalities.map((m) => (
            <option key={m.idmun} value={String(m.idmun)}>
              {m.nmun}
            </option>
          ))}
        </select>
      </label>

      <div className={`rounded-xl border p-3 ${advisoryTone(advisory.level)}`}>
        <div className="flex items-center gap-2 font-medium text-sm">
          <AlertTriangle size={16} />
          {advisory.label}
        </div>
        <p className="text-xs mt-1 opacity-90">{advisory.hint}</p>
        {selected && (
          <p className="text-xs mt-2 opacity-80">
            Acumulado pronosticado 3 días:{" "}
            <strong>{selected.precTotal3d?.toFixed(1)} mm</strong>
          </p>
        )}
      </div>

      {selected && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {selected.days.map((day) => (
            <div
              key={`${selected.idmun}-${day.ndia}`}
              className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-3 space-y-2"
            >
              <div className="text-sm font-semibold text-slate-200">
                {DAY_LABELS[day.ndia] ?? `Día +${day.ndia}`}
              </div>
              <div className="text-[10px] text-slate-500">{day.dloc}</div>
              <div className="flex items-center gap-2 text-sky-300">
                <CloudRain size={14} />
                <span className="text-lg font-bold">{day.prec?.toFixed(1)}</span>
                <span className="text-xs">mm</span>
              </div>
              <div className="text-xs text-slate-400">
                Prob. lluvia: {day.probprec ?? 0}%
              </div>
              <div className="flex items-center gap-1.5 text-xs text-orange-200/90">
                <Thermometer size={12} />
                {day.tmin != null ? day.tmin.toFixed(0) : "—"}° –{" "}
                {day.tmax != null ? day.tmax.toFixed(0) : "—"}°C
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Wind size={12} />
                {day.velvien?.toFixed(1) ?? "—"} m/s {day.dirvienc}
              </div>
              <div className="text-[10px] text-slate-500 truncate" title={day.desciel}>
                {day.desciel}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-slate-600 border-t border-slate-800 pt-3">
        API: smn.conagua.gob.mx/tools/GUI/webservices/?method=1 · {data?.municipalityCount}{" "}
        municipios
      </div>
    </div>
  );
}
