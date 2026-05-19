# HydroFlow Flood Prevention

Plataforma web para **monitoreo y apoyo a la prevención de riesgo por inundación** en Tabasco (México). Evoluciona la base HydroFlow (evapotranspiración agrometeorológica) hacia visualización de lluvia, humedad de suelo, evapotranspiración de referencia (FAO Penman–Monteith), índice de riesgo relativo y un asistente conversacional.

**Repositorio:** [Hidroflow-Flood-Prevention](https://github.com/AngelCast04/Hidroflow-Flood-Prevention.git)

---

## Estado actual del MVP

| Área | Implementado |
|------|----------------|
| **Dataset** | `public/data/Evapotranspiracion RP.csv` (~12 150 filas, 10 parámetros MERRA-2, años **1981–2025**) |
| **Mapa** | Capa fija de **lluvia**: heatmap + marcadores por intensidad de precipitación; tooltip con lat, lon y evapotranspiración |
| **Panel** | Año/mes, lluvia, acumulados (3 y 7 meses), GWETPROF, riesgo, municipio aproximado |
| **Info sheets** | Paneles visuales (lluvia, riesgo, evapotranspiración) al seleccionar un punto |
| **Gráfica** | Serie mensual: lluvia, acumulado 7 meses, evapotranspiración (scroll horizontal, tooltip compacto) |
| **Riesgo** | `useRiskData`: índice base sintético + umbrales sobre acumulados mensuales |
| **Chat** | `POST /api/chat` vía `server.js` (OpenAI); RAG opcional con Supabase |
| **Despliegue** | **Render** (Web Service Node).|

---

## Dataset (`Evapotranspiracion RP.csv`)

Formato **ancho**: una fila por `PARAMETRO`, `YEAR`, `LAT`, `LON` y columnas mensuales `JAN`…`DEC` (+ `ANN`, no usada en el pivote).

### Parámetros en el archivo (10)

| PARAMETRO | Descripción breve |
|-----------|-------------------|
| `PRECTOTCORR` | Precipitación mensual corregida |
| `GWETPROF` | Humedad de perfil del suelo (0–1) |
| `GWETROOT` | Humedad en zona radicular |
| `T2M` | Temperatura media a 2 m |
| `T2MDEW` | Temperatura de punto de rocío a 2 m |
| `RH2M` | Humedad relativa a 2 m |
| `QV2M` | Razón de mezcla de vapor de agua |
| `ALLSKY_SFC_SW_DWN` | Radiación solar de onda corta en superficie |
| `PS` | Presión superficial |
| `WS10M` | Velocidad del viento a 10 m |

### Parámetros usados por la aplicación (7)

`PRECTOTCORR`, `GWETPROF`, `T2M`, `RH2M`, `ALLSKY_SFC_SW_DWN`, `PS`, `WS10M` → pivote en `useRainData.js`, cálculo de **evapotranspiración** (`ET_CALCULADA`, FAO-56) y acumulados móviles de lluvia a **3 y 7 meses**.

Los parámetros `GWETROOT`, `QV2M` y `T2MDEW` están en el CSV y quedan disponibles para ampliar el modelo sin cambiar el formato.

### Carga de datos

El hook prueba varias rutas (incl. codificación `%20` en el nombre del archivo) y valida que la respuesta no sea HTML del fallback de la SPA.

---

## Arquitectura

```
┌─────────────────┐     proxy /api/*      ┌──────────────────┐
│  React (CRA)    │ ────────────────────► │  server.js       │
│  puerto 3000    │   (solo desarrollo)   │  Express :3001   │
└─────────────────┘                       │  + build/ estático│
                                          │  POST /api/chat  │
                                          └────────┬─────────┘
                                                   │
                                          OpenAI (+ Supabase RAG opcional)
```

| Componente | Ruta / archivo |
|------------|----------------|
| Orquestación UI | `src/App.jsx` |
| Datos lluvia / ET | `src/hooks/useRainData.js` |
| Riesgo | `src/hooks/useRiskData.js` |
| ET₀ | `src/utils/calcEt0Monthly.js` |
| Mapa | `src/components/MapaET.jsx` |
| Panel | `src/components/PanelDatos.jsx` |
| Gráfica | `src/components/GraficaMensual.jsx` |
| Info sheets | `src/components/InfoSheet.jsx` |
| API producción | `server.js` |
| Blueprint Render | `render.yaml` |
| Esquema RAG | `supabase/rag.sql` |
| Indexado RAG | `scripts/rag_index_spatial.js` |

**Legado:** `src/hooks/useETdata.js` y `evapotranspiracion_completa.csv` ya no alimentan la app en runtime.

Documentación técnica ampliada: [`MANUAL_TECNICO_HYDROFLOW_FLOOD_PREVENTION.md`](MANUAL_TECNICO_HYDROFLOW_FLOOD_PREVENTION.md).

---

## Desarrollo local

Requisitos: **Node 20+** (ver `engines` en `package.json`).

**Terminal 1** — API y proxy de producción local:

```bash
npm install
node server.js
```

**Terminal 2** — frontend con proxy a `http://localhost:3001`:

```bash
npm run start:client
```

Copia `.env.example` → `.env.local` y define al menos `OPENAI_API_KEY` para probar el chat.

| Script | Uso |
|--------|-----|
| `npm start` | Producción: `node server.js` (sirve `build/` + API) |
| `npm run start:client` | Solo CRA en desarrollo |
| `npm run build` | Compila React en `build/` |
| `npm run rag:index:spatial` | Indexa puntos del CSV en Supabase |

---

## Despliegue en Render

El proyecto **ya no usa Netlify**. El despliegue oficial es un **Web Service Node** en [Render](https://render.com).

### Opción A (recomendada): Blueprint

1. Conecta el repositorio en Render.
2. Usa **Blueprint** apuntando a `render.yaml`.
3. Configura variables de entorno (panel de Render):

| Variable | Obligatoria | Uso |
|----------|-------------|-----|
| `OPENAI_API_KEY` | Sí (chat) | Embeddings + respuestas del asistente |
| `SUPABASE_URL` | No (RAG) | Búsqueda vectorial |
| `SUPABASE_ANON_KEY` | No (RAG) | Cliente en servidor; preferible `SUPABASE_SERVICE_ROLE_KEY` para indexado |
| `SUPABASE_SERVICE_ROLE_KEY` | Recomendada para indexar | Script `rag:index:spatial` e inserciones |

Render ejecuta:

- **Build:** `npm install --no-audit --no-fund && npm run build`
- **Start:** `npm start` → `node server.js`
- **Node:** `20.18.0` (`NODE_VERSION` en `render.yaml`)

### Opción B: Web Service manual

- **Type:** Web Service (Node)
- **Build Command:** `npm install --no-audit --no-fund && npm run build`
- **Start Command:** `npm start`
- Mismas variables de entorno que arriba.

> En desarrollo, si solo ejecutas `npm run start:client` sin `node server.js`, las llamadas a `/api/chat` fallan con error de proxy (ECONNREFUSED).

---

## RAG (Supabase + pgvector)

1. Ejecuta el SQL en `supabase/rag.sql` (tabla `rag_chunks`, función `match_rag_chunks`).
2. Configura `OPENAI_API_KEY`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Indexa una vez: `npm run rag:index:spatial`.

El chat enriquece el contexto con fragmentos similares cuando Supabase está configurado en el servidor.

---

## Interfaz (resumen)

- **Mapa:** solo visualización de **lluvia** (sin selector de capas histórico/riesgo en mapa).
- **Marcadores:** color/tamaño según `lluvia_mm` del último periodo disponible.
- **Tooltip mapa:** Lat, Lon, Evapotranspiración (mm/día).
- **Panel + InfoSheet:** métricas detalladas y sheets de lluvia, riesgo y evapotranspiración.
- **Etiquetas UI:** se usa **“Evapotranspiración”** en lugar de “ET/ET₀” en la interfaz.

---

## Limitaciones y próximos pasos

- Acumulados “3d/7d” en datos **mensuales** = ventanas de **3 y 7 meses**; conviene renombrar en UI o ingestar series diarias.
- Riesgo estructural (pendiente, uso de suelo, distancia a río) es **sintético** hasta integrar capas geoespaciales reales.
- Sin modelado hidráulico ni niveles de río: **apoyo a la decisión**, no sustituto de alertas oficiales.
- Roadmap: pronóstico 24–72 h, `lluvia_diaria.csv` / `riesgo_static.csv`, calibración de umbrales con expertos locales, uso de `GWETROOT` / `T2MDEW` en el panel.

---

## Licencia y uso

Herramienta de apoyo técnico-comunitario. Validar umbrales y recomendaciones con autoridades locales antes de decisiones operativas.
