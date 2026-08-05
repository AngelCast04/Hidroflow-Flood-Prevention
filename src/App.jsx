import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import useRainData from "./hooks/useRainData";
import useRiskData, { enrichRowsWithRisk } from "./hooks/useRiskData";
import MapaET from "./components/MapaET";
import GraficaMensual from "./components/GraficaMensual";
import PanelDatos from "./components/PanelDatos";
import InfoSheet from "./components/InfoSheet";
import PronosticoSmn from "./components/PronosticoSmn";
import useSmnForecast from "./hooks/useSmnForecast";
import { matchSmnMunicipio } from "./utils/matchSmnMunicipio";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./index.css";
import { CloudRain, MessageCircle, X, Send, Bot, Info, Map as MapIcon, CalendarDays } from "lucide-react";

export default function App() {
  const [isSearching, setIsSearching] = useState(false);
  const { data: rainData, loading, loadError, latestDate, getPointSeries } = useRainData();
  const { data: riskData } = useRiskData(rainData);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const activeLayer = "lluvia";
  const [mainView, setMainView] = useState("monitor");
  const [showInfo, setShowInfo] = useState(false);
  const smnForecast = useSmnForecast();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "bot",
      content:
        "Hola. Soy el asistente de HydroFlow Flood Prevention. Puedo explicar el riesgo por lluvia, acumulados recientes y medidas preventivas por municipio.",
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const mapPoints = useMemo(() => {
    return riskData.map((row) => ({ ...row }));
  }, [riskData]);

  const handlePointClick = (p) => {
    if (!p) return;
    const series = enrichRowsWithRisk(getPointSeries(p.lat, p.lon))
      .map((it) => ({
        ...it,
        YEAR: Number(it.YEAR),
        Month: Number(it.Month),
        Day: Number(it.Day),
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    const latest = series[series.length - 1];
    let year = selectedYear ?? latest?.YEAR;
    let month = selectedMonth ?? latest?.Month;
    let day = selectedDay ?? latest?.Day;

    let found = series.find((s) => s.YEAR === year && s.Month === month && s.Day === day);

    if (!found) {
      found = latest;
      year = found?.YEAR;
      month = found?.Month;
      day = found?.Day;
    }

    setSelectedYear(year);
    setSelectedMonth(month);
    setSelectedDay(day);
    setSelectedPoint({ ...found, lat: p.lat, lon: p.lon, series });
  };

  const buildContext = useCallback(() => {
    if (!selectedPoint) return "No hay punto seleccionado en este momento.";
    const lines = [
      `Municipio: ${selectedPoint.municipio || "Tabasco"}`,
      `Fecha (dataset histórico): ${selectedPoint.fecha}`,
      `Lluvia mm: ${Number(selectedPoint.lluvia_mm || 0).toFixed(2)}`,
      `Evapotranspiración mm/día: ${Number.isFinite(Number(selectedPoint.ET_CALCULADA)) ? Number(selectedPoint.ET_CALCULADA).toFixed(2) : "N/A"}`,
      `GWETPROF: ${Number.isFinite(Number(selectedPoint.gwetprof)) ? Number(selectedPoint.gwetprof).toFixed(2) : "N/A"}`,
      `Acumulado 3d mm: ${Number(selectedPoint.acumulado_3d_mm || 0).toFixed(2)}`,
      `Acumulado 7d mm: ${Number(selectedPoint.acumulado_7d_mm || 0).toFixed(2)}`,
      `Balance diario P-ET mm: ${Number.isFinite(Number(selectedPoint.balance_mm)) ? Number(selectedPoint.balance_mm).toFixed(2) : "N/A"}`,
      `Excedente 7d mm: ${Number(selectedPoint.excedente_7d_mm || 0).toFixed(2)}`,
      `Excedente 15d mm: ${Number(selectedPoint.excedente_15d_mm || 0).toFixed(2)}`,
      `Excedente 30d mm: ${Number(selectedPoint.excedente_30d_mm || 0).toFixed(2)}`,
      `Riesgo actual: ${selectedPoint.nivel_riesgo || "N/A"}`,
      `Riesgo por lluvia: ${selectedPoint.nivel_riesgo_lluvia || "N/A"}`,
      `Riesgo por excedente: ${selectedPoint.nivel_riesgo_excedente || "N/A"}`,
      `Pendiente: ${selectedPoint.pendiente_clase || "N/A"}`,
      `Uso de suelo: ${selectedPoint.uso_suelo || "N/A"}`,
      `Distancia a rio m: ${selectedPoint.distancia_rio_m ?? "N/A"}`,
    ];

    const smnMun = matchSmnMunicipio(
      selectedPoint.municipio,
      smnForecast.municipalities
    );
    if (smnMun?.days?.length) {
      lines.push("--- Pronóstico SMN (3 días, fuente independiente del CSV) ---");
      smnMun.days.forEach((d) => {
        lines.push(
          `Día +${d.ndia}: prec ${d.prec?.toFixed(1)} mm, prob ${d.probprec}%, tmax ${d.tmax}°C, tmin ${d.tmin}°C`
        );
      });
      lines.push(`Acumulado pronosticado 3d: ${smnMun.precTotal3d?.toFixed(1)} mm`);
    } else if (smnForecast.data) {
      lines.push("Pronóstico SMN: sin coincidencia de municipio para este punto.");
    }

    lines.push("Nota: Es un sistema de apoyo, no reemplaza alertas oficiales.");
    return lines.join("\n");
  }, [selectedPoint, smnForecast.municipalities, smnForecast.data]);

  const handleSendMessage = async () => {
    if (!input.trim()) return;
    setIsSearching(true);

    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: input, contextoTexto: buildContext() }),
      });
      const { respuesta, error } = await res.json();
      if (error) throw new Error(error);
      setMessages((prev) => [...prev, { role: "bot", content: respuesta }]);
    } catch (err) {
      const mensajeError = err.message || "Error desconocido";
      setMessages((prev) => [
        ...prev,
        { role: "bot", content: `Error tecnico: ${mensajeError}. Intenta de nuevo.` },
      ]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleChangeDate = useCallback((year, month, day) => {
    if (!selectedPoint?.series) return;
    let found = selectedPoint.series.find(
      (s) => s.YEAR === year && s.Month === month && s.Day === day
    );
    if (!found) {
      found = selectedPoint.series.find((s) => s.YEAR === year && s.Month === month);
    }
    if (!found) return;
    setSelectedYear(found.YEAR);
    setSelectedMonth(found.Month);
    setSelectedDay(found.Day);
    setSelectedPoint((prev) => ({ ...found, lat: prev.lat, lon: prev.lon, series: prev.series }));
  }, [selectedPoint]);

  const seriesForPlot = useMemo(() => {
    if (!selectedPoint?.series) return [];
    const year = selectedYear ?? selectedPoint.YEAR;
    return selectedPoint.series
      .filter((s) => s.YEAR === year)
      .map((s) => ({
        YEAR: s.YEAR,
        Month: s.Month,
        Day: s.Day,
        Mes: s.Mes,
        lluvia: Number(s.lluvia_mm || 0),
        acumulado7d: Number(s.acumulado_7d_mm || 0),
        et: Number.isFinite(Number(s.ET_CALCULADA)) ? Number(s.ET_CALCULADA) : null,
        label: `${s.Day}/${s.Mes}`,
      }));
  }, [selectedPoint, selectedYear]);

  return (
<div className="min-h-screen lg:h-screen flex flex-col lg:overflow-hidden">

{/* NAVBAR */}
<header className="navbar-glass h-16 sticky top-0 z-50">
  <div className="max-w-[1800px] mx-auto h-full flex items-center justify-between px-6 relative">
    
    {/* LOGO */}
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-blue-500/10">
        <CloudRain className="w-6 h-6 text-blue-400"/>
      </div>

      <span className="font-semibold text-lg tracking-wide text-blue-300">
        HydroFlow Flood Prevention
      </span>
    </div>

    {/* BOTON INFO */}
    <button
      onClick={() => setShowInfo(true)}
      className="
      flex items-center gap-2
      px-3 py-2
      rounded-lg
      bg-slate-800/50
      border border-slate-700
      text-slate-300
      hover:bg-blue-600/20
      hover:text-blue-300
      transition
      "
    >
      <Info size={18}/>
      <span className="hidden sm:inline text-sm">Info</span>
    </button>

  </div>
</header>

{showInfo && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">

    <div className="
    relative
    w-[90%] max-w-md
    bg-gradient-to-b
    from-slate-900
    to-slate-800
    border border-blue-500/20
    shadow-2xl
    rounded-2xl
    p-6
    text-center
    ">

      {/* cerrar */}
      <button
        onClick={() => setShowInfo(false)}
        className="absolute top-3 right-3 text-slate-400 hover:text-white"
      >
        <X size={18}/>
      </button>

      {/* icono */}
      <div className="flex justify-center mb-3">
        <div className="p-3 rounded-xl bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
          <CloudRain className="w-7 h-7 text-blue-400"/>
        </div>
      </div>

      {/* titulo */}
      <h2 className="text-xl font-semibold text-blue-300">
        HydroFlow Flood Prevention
      </h2>

      <p className="text-sm text-slate-400 mb-4">
        Plataforma de monitoreo y prevencion de riesgo de inundaciones
      </p>

      {/* autores */}
      <div className="space-y-1 text-sm text-slate-200">
        <p>Angel Gabriel Tadeo Castellano</p>
        <p>Zona de Análisis: Región Chontalpa, Tabasco</p>
      </div>

      {/* asesor */}
      <div className="mt-4 pt-4 border-t border-slate-700 text-xs text-slate-400">
        Asesor: 
        Dr. Carlos González Zacarias
        Dr. Arturo Corona Ferreira
      </div>

    </div>
  </div>
)}


{/* DASHBOARD */}
<div className="
flex-1
grid
grid-cols-1
lg:grid-cols-[280px_1fr_280px]
xl:grid-cols-[320px_1fr_320px]
gap-6
p-4
lg:p-6
max-w-[1800px]
mx-auto
w-full
min-h-0
overflow-visible lg:overflow-hidden
">

{/* CHAT PANEL */}
<div className="
order-3
lg:order-3
hidden
lg:flex
flex-col
dashboard-chat-card overflow-hidden
">

  <div className="p-4 border-b border-slate-800 flex items-center gap-2">
    <Bot size={18}/>
    <span className="font-semibold text-sm">Asistente de prevencion</span>
  </div>

  <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-minimal">
    {messages.map((m,i)=>(
      <div
        key={i}
        className={`flex ${m.role==="user" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`p-3 rounded-xl text-sm max-w-[85%] break-words ${
            m.role==="user" ? "bg-gradient-to-r from-blue-700 to-cyan-600" : "bg-slate-800"
          }`}
        >
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {m.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    ))}

    {isSearching && (
      <div className="flex justify-start animate-pulse">
        <div className="bg-slate-700/50 p-3 rounded-xl text-xs text-blue-300 flex items-center gap-2">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
          Analizando contexto hidrometeorologico...
        </div>
      </div>
    )}

    <div ref={scrollRef}/>
  </div>

  <div className="p-3 border-t border-slate-800 flex gap-2">
    <input
      value={input}
      onChange={(e)=>setInput(e.target.value)}
      onKeyDown={(e)=>e.key==="Enter" && handleSendMessage()}
      className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none"
      placeholder="Pregunta sobre riesgo, lluvia o prevencion..."
    />
    <button
      onClick={handleSendMessage}
      className="bg-gradient-to-r from-blue-600 to-cyan-500 p-2 rounded-lg hover:bg-blue-500 transition"
    >
      <Send size={16}/>
    </button>
  </div>

</div>
<button
onClick={()=>setIsChatOpen(true)}
className="z-50 lg:hidden fixed bottom-6 right-6 bg-blue-600 p-4 rounded-full shadow-xl"
>
<MessageCircle size={20}/>
</button>
{isChatOpen && (
<div className="fixed inset-0 bg-black/60 backdrop-blur z-50 flex lg:hidden">

<div className="w-full bg-slate-900 h-full flex flex-col">

<div className="p-4 border-b border-slate-800 flex justify-between items-center">
<span className="font-semibold">Asistente de prevencion</span>

<button onClick={()=>setIsChatOpen(false)}>
<X/>
</button>
</div>

<div className="flex-1 overflow-y-auto p-4 space-y-4">

{messages.map((m,i)=>(
<div
key={i}
className={`flex ${m.role==="user" ? "justify-end" : "justify-start"}`}
>
<div
className={`p-3 rounded-xl text-sm max-w-[85%] break-words ${
m.role==="user" ? "bg-blue-600" : "bg-slate-800"
}`}
>
<div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {m.content}
            </ReactMarkdown>
          </div>
</div>
</div>
))}

{isSearching && (
<div className="flex justify-start animate-pulse">
<div className="bg-slate-700/50 p-3 rounded-xl text-xs text-blue-300">
Analizando contexto...
</div>
</div>
)}

</div>

<div className="p-3 border-t border-slate-800 flex gap-2">

<input
value={input}
onChange={(e)=>setInput(e.target.value)}
onKeyDown={(e)=>e.key==="Enter" && handleSendMessage()}
className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
placeholder="Pregunta sobre riesgo..."
/>

<button
onClick={handleSendMessage}
className="bg-blue-600 p-2 rounded-lg"
>
<Send size={16}/>
</button>

</div>

</div>
</div>
)}


{/* MAPA + GRÁFICA / PRONÓSTICO SMN */}
<div className="
order-1
lg:order-2
flex flex-col gap-4 min-w-0 min-h-0
">

  <div className="flex gap-2 p-1 rounded-xl bg-slate-900/80 border border-slate-800 shrink-0">
    <button
      type="button"
      onClick={() => setMainView("monitor")}
      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition ${
        mainView === "monitor"
          ? "bg-blue-600/30 text-blue-200 border border-blue-500/40"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      <MapIcon size={16} />
      Monitoreo histórico
    </button>
    <button
      type="button"
      onClick={() => setMainView("forecast")}
      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition ${
        mainView === "forecast"
          ? "bg-cyan-600/25 text-cyan-200 border border-cyan-500/40"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      <CalendarDays size={16} />
      Pronóstico SMN
    </button>
  </div>

  {mainView === "monitor" ? (
    <>
      {!loading && !loadError && latestDate && (
        <p className="text-xs text-slate-500 shrink-0">
          Última fecha en dataset: <span className="text-slate-300">{latestDate}</span> · {mapPoints.length} puntos
        </p>
      )}
      <div className="h-[55vh] lg:flex-[1.5] lg:h-auto dashboard-card overflow-hidden">
        {loading
          ? <div className="p-6 text-slate-300 text-sm animate-pulse">Cargando dataset diario (~83k registros)…</div>
          : loadError
            ? <div className="p-6 text-red-300 text-sm space-y-2">
                <p>{loadError}</p>
                <p className="text-slate-500 text-xs">
                  Con el API: <code className="text-blue-300">npm start</code> +{" "}
                  <code className="text-blue-300">npm run start:client</code>. Respaldo:{" "}
                  <code className="text-blue-300">public/data/DATASET_UPDATE.csv</code>.
                </p>
              </div>
            : mapPoints.length === 0
              ? <div className="p-6 text-amber-300 text-sm">No hay puntos para mostrar en el mapa.</div>
              : <MapaET
              puntosRaw={mapPoints}
              onPointClick={handlePointClick}
              selectedCoords={selectedPoint ? { lat: selectedPoint.lat, lon: selectedPoint.lon } : null}
            />
        }
      </div>

      <div className="h-[30vh] lg:flex-[1] lg:h-auto min-w-0 dashboard-card overflow-visible">
        <GraficaMensual series={seriesForPlot}/>
      </div>

      <InfoSheet selectedPoint={selectedPoint} activeLayer={activeLayer} />
    </>
  ) : (
    <div className="flex-1 min-h-[50vh] lg:min-h-0 dashboard-card overflow-hidden">
      <PronosticoSmn
        linkedMunicipio={selectedPoint?.municipio}
        data={smnForecast.data}
        loading={smnForecast.loading}
        error={smnForecast.error}
        reload={smnForecast.reload}
      />
    </div>
  )}

</div>


{/* PANEL DATOS */}
<div className="
order-2
lg:order-1
dashboard-card overflow-hidden
">

{selectedPoint ? (
  <PanelDatos
    selectedPoint={selectedPoint}
    selectedYear={selectedYear}
    selectedMonth={selectedMonth}
    selectedDay={selectedDay}
    onChangeDate={handleChangeDate}
  />
) : (
  <div className="p-6 text-gray-400">
    Selecciona un punto para ver metricas de riesgo.
  </div>
)}

</div>

</div>

</div>
);
}
