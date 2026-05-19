import React, { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import "leaflet.heat";
import { useMap } from "react-leaflet";

function FixMapResize() {
  const map = useMap();

  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 200);
  }, [map]);

  return null;
}

// Componente para animar el vuelo al punto seleccionado
/* function FlyToPoint({ center }) {
  const map = useMap()
  React.useEffect(() => {
    if (center) {
      map.flyTo(center, 8, { duration: 1.2 })
    }
  }, [center, map])
  return null
}*/
function HeatLayer({ puntos }) {
  const map = useMap();

  useEffect(() => {
    if (!puntos.length) return;

    const heatData = puntos.map((p) => [p.lat, p.lon, p.lluvia_mm || 0]);

    const heat = L.heatLayer(heatData, {
      radius: window.innerWidth < 640 ? 15 : 25,
      blur: 15,
      maxZoom: 10
    }).addTo(map);

    return () => {
      map.removeLayer(heat);
    };
  }, [puntos, map]);

  return null;
}

const riskStyle = {
  "Muy alto": { color: "#ef4444", radius: 10 },
  Alto: { color: "#f97316", radius: 9 },
  Medio: { color: "#facc15", radius: 8 },
  Bajo: { color: "#22c55e", radius: 7 },
};

export default function MapaET({ puntosRaw, onPointClick, selectedCoords, activeLayer }) {
  const puntos = useMemo(() => {
    if (!puntosRaw || !puntosRaw.length) return [];
    return puntosRaw;
  }, [puntosRaw]);

  const centro = useMemo(() => {
    if (puntos.length > 0) {
      const lat = puntos.reduce((sum, p) => sum + p.lat, 0) / puntos.length;
      const lon = puntos.reduce((sum, p) => sum + p.lon, 0) / puntos.length;
      return [lat, lon];
    }
    return [17.5, -91.25];
  }, [puntos]);

  return (
    <div className="relative z-0 w-full h-full dashboard-card overflow-hidden">
      <MapContainer
        center={centro}
        zoom={9}
        doubleClickZoom={false}
        tap={true}
        style={{ height: "100%", width: "100%" }}
        >
        <FixMapResize />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {activeLayer === "lluvia" && <HeatLayer puntos={puntos} />}

        {/*<FlyToPoint center={selectedCoords ? [selectedCoords.LAT, selectedCoords.LON] : null} />*/}

        {puntos.map((p, i) => {
          const style = riskStyle[p.nivel_riesgo] || riskStyle.Medio;
          const isSelected =
            selectedCoords &&
            selectedCoords.lat === p.lat &&
            selectedCoords.lon === p.lon;

          return (
            <CircleMarker
              key={i}
              center={[p.lat, p.lon]}
              radius={isSelected ? style.radius + 2 : style.radius}
              color={style.color}
              weight={2}
              fillColor={style.color}
              fillOpacity={0.7}
              eventHandlers={{
                click: () => onPointClick(p),
                touchstart: () => onPointClick(p),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.9}>
                <div className="text-sm">
                  <div><b>Lat:</b> {p.lat.toFixed(3)}</div>
                  <div><b>Lon:</b> {p.lon.toFixed(3)}</div>
                  <div><b>Lluvia:</b> {Number(p.lluvia_mm || 0).toFixed(1)} mm</div>
                  <div><b>GWETPROF:</b> {Number.isFinite(Number(p.gwetprof)) ? Number(p.gwetprof).toFixed(2) : "N/A"}</div>
                  <div><b>ET₀:</b> {Number.isFinite(Number(p.ET_CALCULADA)) ? Number(p.ET_CALCULADA).toFixed(2) + " mm/día" : "N/A"}</div>
                  <div><b>Acum 72h:</b> {Number(p.acumulado_3d_mm || 0).toFixed(1)} mm</div>
                  <div><b>Riesgo:</b> {p.nivel_riesgo}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
