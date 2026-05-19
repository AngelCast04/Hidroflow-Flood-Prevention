# Manual técnico — HydroFlow Flood Prevention

**Versión del documento:** 1.1  
**Fecha de revisión:** mayo 2026  
**Alcance:** Arquitectura, dataset ampliado, pipeline de datos, UI actual, API de chat, RAG y despliegue en **Render**.

---

## 1. Objetivo del producto

**HydroFlow Flood Prevention** es un MVP web que concentra:

- Visualización **geoespacial** de **lluvia** (mapa con heatmap y marcadores).
- **Panel** e **Info sheets** con métricas de lluvia, humedad de perfil, evapotranspiración de referencia y **riesgo relativo**.
- **Gráfica** de series temporales mensuales.
- **Asistente** (`POST /api/chat`) que explica riesgo y medidas preventivas con lenguaje claro.

El sistema es **apoyo a la decisión**; no reemplaza alertas de Protección Civil u organismos oficiales.

---

## 2. Stack y despliegue

| Capa | Tecnología |
|------|------------|
| Frontend | React 19 (Create React App), Tailwind CSS |
| Mapas | Leaflet, react-leaflet, leaflet.heat |
| Gráficas | Recharts |
| CSV | Papa Parse (`public/data/`) |
| API / estáticos | Express (`server.js`) |
| IA | OpenAI (embeddings `text-embedding-3-small`, chat `gpt-4o-mini`) |
| RAG (opcional) | Supabase + pgvector (`rag_chunks`, `match_rag_chunks`) |
| **Plataforma de despliegue** | **[Render](https://render.com)** Web Service Node (`render.yaml`) |

**Eliminado respecto a versiones anteriores:** `netlify/`, `netlify.toml`, funciones serverless en Netlify. Toda la API vive en `server.js`.

### 2.1 `render.yaml`

| Campo | Valor |
|-------|--------|
| `buildCommand` | `npm install --no-audit --no-fund && npm run build` |
| `startCommand` | `npm start` → `node server.js` |
| `NODE_VERSION` | `20.18.0` |
| Variables | `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (sync manual en panel Render) |

En producción, Express sirve `build/` y atiende `/api/chat`. No hace falta un servicio estático separado.

### 2.2 Desarrollo local

| Proceso | Comando | Puerto |
|---------|---------|--------|
| API + estáticos (modo prod local) | `node server.js` o `npm start` tras `npm run build` | 3001 |
| Solo frontend CRA | `npm run start:client` | 3000 |

`package.json` define `"proxy": "http://localhost:3001"` para que CRA reenvíe `/api/*` al servidor Node en desarrollo.

Variables: ver `.env.example` (`OPENAI_API_KEY`, `SUPABASE_*`).

---

## 3. Estructura de código relevante

| Ruta | Rol |
|------|-----|
| `src/App.jsx` | Hooks, mapa, panel, gráfica, chat, `InfoSheet`, contexto del asistente |
| `src/hooks/useRainData.js` | Carga CSV, pivote multi-parámetro, acumulados, ET, municipio |
| `src/hooks/useRiskData.js` | Índice base + `nivel_riesgo` |
| `src/utils/calcEt0Monthly.js` | Evapotranspiración de referencia (FAO Penman–Monteith mensual) |
| `src/components/MapaET.jsx` | Mapa lluvia, heatmap, marcadores, tooltip reducido |
| `src/components/PanelDatos.jsx` | Selectores año/mes y tarjetas |
| `src/components/GraficaMensual.jsx` | Series con scroll horizontal y tooltip personalizado |
| `src/components/InfoSheet.jsx` | Sheets visuales: lluvia, riesgo, evapotranspiración |
| `server.js` | `POST /api/chat`, CORS, RAG, `express.static(build)` |
| `scripts/rag_index_spatial.js` | Indexación espacial del CSV en Supabase |
| `supabase/rag.sql` | Esquema vectorial |
| `public/data/Evapotranspiracion RP.csv` | Dataset operativo |

**Legado (no usado en runtime):** `src/hooks/useETdata.js`, referencias a `evapotranspiracion_completa.csv`.

---

## 4. Dataset y pipeline de datos

### 4.1 Archivo y volumen

- **Ruta:** `public/data/Evapotranspiracion RP.csv`
- **Filas de datos:** ~12 150 (más cabecera)
- **Horizonte temporal:** años **1981–2025** (por punto y parámetro)
- **Zona:** grilla sobre Tabasco y puntos costeros adyacentes (coordenadas `LAT`, `LON`)

### 4.2 Formato

Cabecera:

```text
PARAMETRO,YEAR,LAT,LON,JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC,ANN
```

Cada fila es un parámetro MERRA-2 (o equivalente) en un año y celda; los meses son columnas numéricas. `ANN` no participa en el pivote mensual del frontend.

### 4.3 Parámetros presentes en el CSV (10)

| PARAMETRO | Significado |
|-----------|-------------|
| `PRECTOTCORR` | Precipitación total corregida (mensual) |
| `GWETPROF` | Fracción de humedad de perfil |
| `GWETROOT` | Fracción de humedad en zona radicular |
| `T2M` | Temperatura del aire a 2 m |
| `T2MDEW` | Temperatura de punto de rocío a 2 m |
| `RH2M` | Humedad relativa a 2 m |
| `QV2M` | Razón de mezcla de vapor |
| `ALLSKY_SFC_SW_DWN` | Radiación solar superficial (todas las condiciones de cielo) |
| `PS` | Presión superficial |
| `WS10M` | Velocidad del viento a 10 m |

Ampliación respecto al MVP inicial: el archivo incorpora variables adicionales (`GWETROOT`, `QV2M`, `T2MDEW`) útiles para futuras mejoras de balance hídrico y humedad.

### 4.4 Parámetros consumidos en frontend (7)

| PARAMETRO | Campo interno | Uso |
|-----------|---------------|-----|
| `PRECTOTCORR` | `lluvia_mm` | Mapa, panel, acumulados, riesgo |
| `GWETPROF` | `gwetprof` | Panel, InfoSheet, contexto chat |
| `T2M` | `t2m_c` | Cálculo evapotranspiración |
| `RH2M` | `rh2_pct` | Cálculo evapotranspiración |
| `ALLSKY_SFC_SW_DWN` | radiación | ET; si inválida (-999), se estima |
| `PS` | `ps_kpa` | ET (rango validado ~50–115 kPa) |
| `WS10M` | `ws10_m_s` | ET (convertido a 2 m) |

Implementación del pivote: `useRainData.js` (agrupación por `lat_lon_year_month`).

### 4.5 Carga robusta del CSV

El hook intenta rutas candidatas, por ejemplo:

- `/data/Evapotranspiracion%20RP.csv`
- `/data/Evapotranspiracion RP.csv`

Validaciones:

1. Respuesta HTTP correcta.
2. El cuerpo **no** es HTML de fallback (`<!doctype html>`).
3. Las primeras líneas contienen `PARAMETRO,YEAR,LAT,LON`.

Si ninguna ruta es válida, `loading` termina en `false` y la UI muestra fecha de corte **N/A**.

### 4.6 Acumulados móviles

Por cada par `(lat, lon)`, serie ordenada por año y mes:

| Campo | Cálculo | Nota de producto |
|-------|---------|------------------|
| `acumulado_3d_mm` | Suma últimos **3 meses** de `lluvia_mm` | Etiqueta heredada “3d”; en datos mensuales = 3 meses |
| `acumulado_7d_mm` | Suma últimos **7 meses** | Análogo para “7d” |

### 4.7 Municipio

No viene en el CSV. `useRainData.js` asigna `municipio` por **distancia mínima** a centroides aproximados (lista de municipios de Tabasco y Ciudad del Carmen). Para producción se recomienda capa INEGI o campo explícito en datos.

---

## 5. Evapotranspiración de referencia

**Archivo:** `src/utils/calcEt0Monthly.js`  
**Salida:** `ET_CALCULADA` (mm/día equivalente mensual)

- Metodología: **FAO-56 Penman–Monteith** con medias mensuales.
- Radiación extraterrestre `Ra` por latitud y día representativo del mes.
- `Rs` del CSV o, si falta, `Rs ≈ 0.45 × Ra`.
- Viento: `WS10M` → 2 m (`u2 ≈ 0.747 × u10`).

**UI:** el término mostrado al usuario es **“Evapotranspiración”** (panel, gráfica, tooltip de mapa, InfoSheet, chat).

---

## 6. Modelo de riesgo (MVP)

**Archivo:** `src/hooks/useRiskData.js`

### 6.1 Componente estructural (sintético)

Por coordenadas se derivan aproximaciones de:

- `pendiente_clase`
- `uso_suelo`
- `distancia_rio_m`
- `indice_riesgo_base` (suma de puntajes)

### 6.2 Nivel combinado

`nivel_riesgo`: **Bajo**, **Medio**, **Alto**, **Muy alto** — función de `indice_riesgo_base`, `acumulado_3d_mm` y `acumulado_7d_mm` con umbrales ajustados a magnitudes **mensuales** de precipitación.

### 6.3 Dónde se muestra el riesgo

- **Panel** e **InfoSheet** (sheet “riesgo”).
- **Contexto del chat** (`buildContext` en `App.jsx`).
- **No** en el selector de capas del mapa (el mapa quedó fijado en lluvia).

---

## 7. Interfaz de usuario

### 7.1 Mapa (`MapaET.jsx`)

| Aspecto | Comportamiento actual |
|---------|------------------------|
| Capa activa | Fija: **`lluvia`** (`activeLayer = "lluvia"` en `App.jsx`; sin selector histórico/riesgo en mapa) |
| Heatmap | Intensidad = `lluvia_mm` (`leaflet.heat`) |
| Marcadores | `CircleMarker`; color y radio según umbrales de `lluvia_mm` (≥80, ≥50, ≥25 mm) |
| Tooltip | **Lat**, **Lon**, **Evapotranspiración** (mm/día) — sin duplicar panel |
| Punto seleccionado | Radio +2 px |

### 7.2 Panel (`PanelDatos.jsx`)

Selectores de año y mes; tarjetas: lluvia, acumulados, GWETPROF, evapotranspiración, bloque de riesgo, municipio.

### 7.3 Info sheets (`InfoSheet.jsx`)

Tres vistas con barras y badges:

1. Sheet **lluvia**
2. Sheet **riesgo**
3. Sheet **evapotranspiración**

Visible cuando hay `selectedPoint`.

### 7.4 Gráfica (`GraficaMensual.jsx`)

- Series: lluvia (área), acumulado 7 meses (línea), evapotranspiración (eje derecho).
- Ancho mínimo `max(n × 20, 800)` px con **scroll horizontal**.
- Tooltip compacto: lluvia, acumulado7d, evapotranspiración.
- Contenedor con `overflow-visible` para no recortar tooltips.

---

## 8. Asistente conversacional

### 8.1 Frontend

- `buildContext()` inyecta: municipio, fecha, lluvia, evapotranspiración, GWETPROF, acumulados, nivel de riesgo, factores sintéticos, nota legal.
- `fetch("/api/chat", { prompt, contextoTexto })`.

### 8.2 Backend (`server.js`)

1. Embedding OpenAI del prompt + contexto.
2. (Opcional) `match_rag_chunks` en Supabase si hay `SUPABASE_URL` y clave (`SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_ANON_KEY`).
3. Chat completion con system prompt orientado a riesgo hidrometeorológico y prevención.

**Errores frecuentes en local:** ejecutar solo CRA sin `node server.js` → proxy ECONNREFUSED en `/api/chat`.

---

## 9. RAG espacial

1. Aplicar `supabase/rag.sql` en el proyecto Supabase.
2. Variables: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `npm run rag:index:spatial` — lee el mismo CSV, genera embeddings y persiste en `rag_chunks`.

El indexado es **opcional** para arrancar la app; el mapa y el panel funcionan solo con el CSV estático.

---

## 10. Cómo construir y ejecutar

```bash
npm install
npm run build    # genera build/
npm start        # Express en PORT (default 3001) sirve build + API
```

Solo frontend en desarrollo (con API en paralelo):

```bash
node server.js          # terminal 1
npm run start:client    # terminal 2 → http://localhost:3000
```

Datos: actualizar `public/data/Evapotranspiracion RP.csv`; CRA expone `public/` en la raíz `/`.

---

## 11. Evolución respecto al HydroFlow original

| Antes | Ahora (Flood Prevention) |
|-------|---------------------------|
| CSV largo ET + `useETdata` | CSV ancho 10 parámetros + `useRainData` (7 activos) |
| Netlify Functions para chat | `server.js` en Render |
| Mapa ET / capas múltiples | Mapa fijo en lluvia + riesgo en panel/sheets |
| Sin ET₀ en pipeline nuevo | FAO-56 con T2M, RH2M, Rs, PS, WS10M |
| Pocos parámetros en dataset | + `GWETROOT`, `QV2M`, `T2MDEW` en archivo |

---

## 12. Próximos pasos técnicos

1. Ingestar `lluvia_diaria.csv` y `riesgo_static.csv` con municipio explícito (ver README).
2. Renombrar acumulados en UI o pasar a series diarias/horarias.
3. Sustituir riesgo sintético por DEM, uso de suelo y distancia real a cauces.
4. Exponer `GWETROOT`, `QV2M`, `T2MDEW` en panel o modelo de saturación.
5. Calibrar umbrales de riesgo con eventos históricos y expertos locales.
6. Pronóstico 24–72 h e integración con fuentes oficiales.

---

*Fin del manual técnico.*
