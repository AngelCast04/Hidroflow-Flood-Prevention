import { useEffect, useMemo, useState } from "react";
import {
  CloudRain,
  RefreshCw,
  AlertTriangle,
  Thermometer,
  Wind,
  CalendarDays,
} from "lucide-react";
import { matchSmnMunicipio, forecastAdvisory, isChontalpa } from "../utils/matchSmnMunicipio";

function parseSmnDloc(dloc) {
  if (!dloc || typeof dloc !== "string") return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2}))?/.exec(dloc);
  if (!m) return null;
  const [, y, mo, d, h = "0"] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffDays(date, today) {
  return Math.round(
    (startOfDay(date).getTime() - startOfDay(today).getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

function relativeDayLabel(offset) {
  if (offset === 0) return "Hoy";
  if (offset === 1) return "Mañana";
  if (offset === 2) return "Pasado mañana";
  if (offset > 2) return `En ${offset} días`;
  if (offset === -1) return "Ayer";
  return `Hace ${-offset} días`;
}

function formatLongDate(date) {
  if (!date) return "";
  return date.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}

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
  const allMunicipalities = useMemo(() => data?.municipalities ?? [], [data]);
  const updatedAt = data?.updatedAt ?? null;
  const source = data?.source ?? "SMN-CONAGUA";
  const [selectedIdmun, setSelectedIdmun] = useState("");

  const linkedMatch = useMemo(
    () => matchSmnMunicipio(linkedMunicipio, allMunicipalities),
    [linkedMunicipio, allMunicipalities]
  );

  // Solo Chontalpa; se conserva el municipio ligado al punto del mapa aunque quede fuera.
  const municipalities = useMemo(() => {
    const chontalpa = allMunicipalities.filter((m) => isChontalpa(m.nmun));
    const list =
      linkedMatch && !chontalpa.some((m) => String(m.idmun) === String(linkedMatch.idmun))
        ? [...chontalpa, linkedMatch]
        : chontalpa;
    return list.sort((a, b) => String(a.nmun).localeCompare(String(b.nmun), "es"));
  }, [allMunicipalities, linkedMatch]);

  useEffect(() => {
    if (linkedMatch?.idmun) {
      setSelectedIdmun(String(linkedMatch.idmun));
      return;
    }
    const stillListed = municipalities.some((m) => String(m.idmun) === String(selectedIdmun));
    if (!stillListed && municipalities[0]?.idmun) {
      setSelectedIdmun(String(municipalities[0].idmun));
    }
  }, [linkedMatch, municipalities, selectedIdmun]);

  const selected = useMemo(
    () => municipalities.find((m) => String(m.idmun) === String(selectedIdmun)),
    [municipalities, selectedIdmun]
  );

  const advisory = useMemo(() => forecastAdvisory(selected), [selected]);

  const today = useMemo(() => startOfDay(new Date()), []);

  const enrichedDays = useMemo(() => {
    if (!selected?.days?.length) return [];
    return selected.days
      .map((day) => {
        const date = parseSmnDloc(day.dloc);
        const offset = date ? diffDays(date, today) : null;
        return { ...day, date, offset };
      })
      .sort((a, b) => {
        if (a.date && b.date) return a.date - b.date;
        return (a.ndia ?? 0) - (b.ndia ?? 0);
      });
  }, [selected, today]);

  const upcomingDays = useMemo(
    () => enrichedDays.filter((d) => d.offset == null || d.offset >= 0),
    [enrichedDays]
  );

  const displayDays = upcomingDays.length > 0 ? upcomingDays : enrichedDays;
  const allInPast =
    enrichedDays.length > 0 &&
    enrichedDays.every((d) => d.offset != null && d.offset < 0);

  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString("es-MX", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

  if (loading) {
    return (
      <div className="p-6 text-slate-400 text-sm animate-pulse">
        Cargando pronóstico SMN para la Chontalpa…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-300 text-sm">{error}</p>
        <p className="text-slate-500 text-xs leading-relaxed">
          El pronóstico se obtiene en el servidor (<code className="text-blue-300">/api/forecast/tabasco</code>
          ). En Render el servicio debe usar <code className="text-blue-300">npm start</code> (no solo
          sitio estático). En local: <code className="text-blue-300">node server.js</code> y luego{" "}
          <code className="text-blue-300">npm run start:client</code>.
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
            Pronóstico 3 días — Chontalpa
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

      <p className="text-xs text-slate-400 leading-relaxed">
        Complementa el monitoreo histórico (MERRA-2) con pronóstico municipal SMN (~72 h).
      </p>

      {data?.warning && (
        <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-700/40 rounded-lg p-2">
          {data.warning}
        </p>
      )}

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

      {allInPast && (
        <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-700/40 rounded-lg p-2">
          El pronóstico almacenado corresponde a fechas pasadas. Pulsa “Actualizar” para
          intentar recuperar datos vigentes desde SMN.
        </p>
      )}

      {selected && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {displayDays.map((day) => (
            <div
              key={`${selected.idmun}-${day.dloc ?? day.ndia}`}
              className="rounded-xl border border-slate-700/80 bg-slate-950/60 p-3 space-y-2"
            >
              <div className="text-sm font-semibold text-slate-200">
                {day.offset != null ? relativeDayLabel(day.offset) : `Día +${day.ndia}`}
              </div>
              <div className="text-[10px] text-slate-400 capitalize">
                {formatLongDate(day.date) || day.dloc}
              </div>
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
        API: smn.conagua.gob.mx/tools/GUI/webservices/?method=1 · {municipalities.length} de{" "}
        {data?.municipalityCount} municipios (región Chontalpa)
      </div>
    </div>
  );
}
