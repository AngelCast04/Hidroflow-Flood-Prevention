# HydroFlow Flood Prevention

**Documentación operativa** para hidrólogos, ingenieros ambientales y desarrolladores que operan o extienden la plataforma.

| Campo | Valor |
| --- | --- |
| Producto | Sistema de apoyo a la decisión (SAD) para riesgo hidrometeorológico |
| Zona de análisis | Región **Chontalpa**, Tabasco, México |
| Repositorio | [Hidroflow-Flood-Prevention](https://github.com/AngelCast04/Hidroflow-Flood-Prevention.git) |
| Versión del documento | 2.0 (Octubre 2026) |
| Resolución temporal operativa | **Diaria** (no mensual) |
| Despliegue | Web Service Node en [Render](https://render.com) |

HydroFlow concentra precipitación observada (NASA POWER), evapotranspiración de referencia FAO-56, un balance hídrico simplificado \(P - ET_0\), un semáforo de riesgo híbrido, pronóstico oficial SMN-CONAGUA a 3 días y un asistente conversacional. Es **apoyo técnico-comunitario**: no sustituye alertas de Protección Civil, CONAGUA ni modelado hidráulico de cauces.

---

## 1. Propósito y alcance

### 1.1 Qué resuelve

La Chontalpa es una llanura costera de baja pendiente, con drenaje lento, suelos saturables y exposición a lluvias intensas del golfo. El producto permite:

1. **Monitorear** lluvia diaria y acumulados de 3 y 7 días en seis puntos municipales.
2. **Estimar** la demanda atmosférica de agua (\(ET_0\)) con Penman–Monteith FAO-56.
3. **Cuantificar** excedente hídrico acumulado (\(P - ET_0\)) a 7, 15 y 30 días como proxy de saturación.
4. **Clasificar** un nivel de riesgo relativo (Bajo / Medio / Alto / Muy alto) combinando lluvia, vulnerabilidad sintética del sitio y excedente.
5. **Contrastar** el histórico con el **pronóstico municipal SMN** a 72 h.
6. **Explicar** el estado hidrometeorológico en lenguaje claro (asistente con contexto del punto seleccionado).

### 1.2 Qué no hace (límites de diseño)

| No incluido | Implicación operativa |
| --- | --- |
| Enrutamiento hidráulico (HEC-RAS, SWMM, Saint-Venant) | No hay niveles de río, hidrogramas ni manchas de inundación |
| DEM, uso de suelo INEGI ni distancia real a cauces | La vulnerabilidad estructural es **sintética** (ver §6.1) |
| Infiltración física (Green–Ampt, SCS-CN calibrado) | El balance es \(P - ET_0\), no un modelo de humedad de raíz |
| Alertas oficiales | El semáforo es relativo al dataset; no es un aviso de Protección Civil |
| Resolución sub-kilométrica | NASA POWER / MERRA-2 es grilla gruesa (~0.5°); puntos cercanos pueden compartir valores |

---

## 2. Zona de estudio

Seis puntos NASA POWER cubren el núcleo de la Chontalpa. El pronóstico SMN añade Jalpa de Méndez y Nacajuca (sin serie POWER propia en el MVP).

| Municipio | Lat | Lon | Rol |
| --- | --- | --- | --- |
| Cunduacán | 18.0672 | −93.1763 | Punto POWER |
| Comalcalco | 18.2445 | −93.2013 | Punto POWER |
| Villahermosa | 17.9845 | −92.9203 | Punto POWER (referencia metropolitana) |
| Paraíso | 18.3932 | −93.2076 | Punto POWER (franja costera) |
| Cárdenas | 17.9896 | −93.3794 | Punto POWER |
| Huimanguillo | 17.8442 | −93.3978 | Punto POWER |
| Jalpa de Méndez | — | — | Solo pronóstico SMN |
| Nacajuca | — | — | Solo pronóstico SMN |

Definición en código: `POWER_POINTS` en `lib/nasaPower.js` y `CHONTALPA_MUNICIPIOS` en `src/utils/matchSmnMunicipio.js`.

El municipio mostrado en panel **no viene en el CSV**. Se asigna por distancia haversine al centroide más cercano (`MUNICIPALITY_CENTROIDS` en `useRainData.js`). Para operación institucional conviene sustituirlo por una capa INEGI o un campo explícito.

---

## 3. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | React 19 (Create React App), Tailwind CSS 3 |
| Mapas | Leaflet, react-leaflet, leaflet.heat |
| Gráficas | Recharts |
| Parseo CSV | Papa Parse |
| API | Express (`server.js`, puerto `PORT` o 3001) |
| Datos climáticos | NASA POWER Daily Point API (comunidad `AG`) |
| Pronóstico | SMN-CONAGUA webservice `method=1` (gzip JSON, `ides=27` Tabasco) |
| IA | OpenAI: embeddings `text-embedding-3-small`, chat `gpt-4o-mini` |
| RAG (opcional) | Supabase + pgvector (`match_rag_chunks`) |
| Runtime | Node **20.x** (`engines`: `>=20 <25`) |

---

## 4. Arquitectura

```
┌─────────────────────────────┐          /api/*           ┌─────────────────────────────────┐
│  React (CRA)                │ ────────────────────────► │  Express  server.js             │
│  puerto 3000 (dev)          │  proxy en desarrollo      │  puerto 3001 / PORT             │
│                             │                           │                                 │
│  useRainData                │  GET  /api/power/daily    │  lib/nasaPower.js               │
│  useRiskData                │  GET  /api/power/meta     │  lib/smnForecast.js             │
│  useSmnForecast             │  GET  /api/forecast/…     │  OpenAI + Supabase (chat/RAG)   │
│  Mapa / Panel / Gráfica     │  POST /api/chat           │  static: build/ + public/data/  │
└─────────────────────────────┘                           └──────────────┬──────────────────┘
                                                                         │
                    NASA POWER · SMN-CONAGUA · OpenAI · (Supabase)
```

En **producción** un solo proceso sirve el `build/` de React y la API. En **desarrollo** se corren dos procesos: Express y CRA (`proxy` → `http://localhost:3001`).

### 4.1 Flujo de datos del monitor

1. El cliente pide CSV diario a `GET /api/power/daily`.
2. Si falla (sin servidor, red, 502), cae a CSV estático en `public/data/`.
3. `useRainData` pivotea filas → series por punto, calcula \(ET_0\), balance y ventanas móviles.
4. `useRiskData` añade vulnerabilidad sintética y el semáforo híbrido.
5. El mapa muestra el **último día** de cada punto; al hacer clic se carga la serie completa (1981 → presente).

Orden de carga (`useRainData.js`):

1. `/api/power/daily`
2. `/data/DATASET_UPDATE.csv`
3. `/data/Evapotranspiracion RP.csv` (legado mensual; se rechaza si no trae `YEAR,DOY`)

---

## 5. Fuentes de datos

### 5.1 NASA POWER (preferente, diario)

| Atributo | Detalle |
| --- | --- |
| Endpoint NASA | `https://power.larc.nasa.gov/api/temporal/daily/point` |
| Comunidad | `AG` (agroclimatología) |
| Rango | 1981-01-01 → **ayer UTC** (POWER suele ir 1–2 días atrasado) |
| Caché local | `data/power_cache/DATASET_POWER.csv` + `meta.json` (gitignored) |
| TTL memoria | 6 h; sync incremental en segundo plano |
| Semilla en deploy | `public/data/DATASET_UPDATE.csv` (sí va al repositorio) |
| Sync manual | `npm run power:sync` · histórico completo: `npm run power:sync -- --full` |

Parámetros descargados:

| Código POWER | Magnitud | Unidad típica | Uso en HydroFlow |
| --- | --- | --- | --- |
| `PRECTOTCORR` | Precipitación total corregida | mm/día | Lluvia, acumulados, riesgo, balance |
| `T2M` | Temperatura del aire a 2 m | °C | \(ET_0\) (T media diaria) |
| `RH2M` | Humedad relativa a 2 m | % | Déficit de vapor \(e_s - e_a\) |
| `ALLSKY_SFC_SW_DWN` | Radiación solar de onda corta | MJ m⁻² día⁻¹ | \(R_s\) en Penman–Monteith |
| `PS` | Presión superficial | kPa | Constante psicrométrica \(\gamma\) |
| `WS10M` | Viento a 10 m | m/s | Convertido a \(u_2\) |
| `GWETPROF` | Humedad volumétrica del perfil | fracción 0–1 | Panel / InfoSheet (indicador, no entra al semáforo) |
| `T2MDEW`, `QV2M`, `GWETROOT` | Rocío, humedad específica, humedad radicular | — | Descargados; **no** se usan aún en UI ni en riesgo |

Cabecera unificada:

```text
YEAR,DOY,LAT,LON,ALLSKY_SFC_SW_DWN,T2M,T2MDEW,RH2M,QV2M,PRECTOTCORR,PS,WS10M,GWETPROF,GWETROOT
```

Valores centinela NASA (`≤ −998`, `N/A`) se tratan como ausentes.

### 5.2 Pronóstico SMN-CONAGUA (3 días)

| Atributo | Detalle |
| --- | --- |
| Origen | Webservice SMN `method=1` (payload gzip → JSON nacional) |
| Filtro | `ides = "27"` (Tabasco) |
| UI | Solo municipios Chontalpa |
| Caché viva | 15 min en memoria |
| Respaldo | `public/data/forecast_tabasco.json` (y `build/` tras el build) |
| Forzar refresh | `GET /api/forecast/tabasco?refresh=1` |

Campos por día municipal: `prec` (mm), `probprec` (%), `tmax`/`tmin` (°C), viento, cubierta nubosa, descripción de cielo. El backend agrega `precTotal3d`, `maxPrecDay` y `maxProbprec`.

El pronóstico es **independiente** del CSV POWER: no se fusiona al semáforo histórico. Sirve de horizonte de 72 h y se inyecta al chat si el municipio coincide.

Aviso cualitativo en UI (`forecastAdvisory`):

| Condición | Nivel |
| --- | --- |
| Acumulado 3 d ≥ 80 mm **o** un día ≥ 50 mm | Atención elevada |
| Acumulado ≥ 40 mm **o** un día ≥ 25 mm **o** probabilidad ≥ 70 % | Precaución |
| Resto | Condición moderada |

---

## 6. Modelo hidrometeorológico

Toda la cadena diaria vive en `src/hooks/useRainData.js` + `src/utils/calcEt0Daily.js` + `src/hooks/useRiskData.js`.

### 6.1 Evapotranspiración de referencia \(ET_0\) (FAO-56)

Archivo: `src/utils/calcEt0Daily.js`.

Se implementa Penman–Monteith para **cultivo de referencia** (pasto, albedo 0.23), en mm/día:

\[
ET_0 = \frac{0.408\,\Delta\,(R_n - G) + \gamma\,\frac{900}{T+273}\,u_2\,(e_s-e_a)}{\Delta + \gamma\,(1+0.34\,u_2)}
\]

| Símbolo | Cómo se obtiene en el código |
| --- | --- |
| \(T\) | `T2M` (°C). No hay Tmax/Tmin diarios: se aproximan \(T\pm 5\) °C solo para radiación neta de onda larga |
| \(e_s\) | \(0.6108\,\exp(17.27\,T/(T+237.3))\) kPa |
| \(e_a\) | \((RH/100)\,e_s\) |
| \(R_a\) | Radiación extraterrestre FAO-56 con latitud y DOY |
| \(R_s\) | POWER; si falta o es inválida: \(R_s \approx 0.45\,R_a\) |
| \(R_{n,s}\) | \(R_s(1-0.23)\) |
| \(R_{nl}\) | Stefan–Boltzmann con \(e_a\) y \(R_s/R_{so}\) acotado a [0.3, 1.0] |
| \(G\) | 0 (flujo de calor en suelo despreciable a paso diario) |
| \(P\) | `PS`; si está fuera de 50–115 kPa se usa 101.3 kPa |
| \(\gamma\) | \(0.000665\,P\) |
| \(u_2\) | \(u_{10} \times 0.747\) (perfil logarítmico FAO, z = 10 m → 2 m). Si falta viento: 2 m/s |

**Notas para el técnico:**

- Es \(ET_0\) de referencia, no \(ET_c\) de cultivo ni evaporación de lámina libre. En llanura tabasqueña saturada, \(ET_0\) suele ser un techo razonable de la demanda; no representa evapotranspiración real bajo estrés hídrico.
- Al no disponer de Tmax/Tmin, el término de onda larga es aproximado. La magnitud diaria típica en trópico húmedo (~3–6 mm/día) es coherente, pero no sustituye una estación agroclimática.
- `calcEt0Monthly.js` queda como **legado**; el runtime usa solo el cálculo diario.

### 6.2 Balance diario y excedente acumulado

Para cada día \(t\) y punto:

\[
B_t = P_t - ET_{0,t}
\]

- \(B_t > 0\): excedente (lluvia supera la demanda atmosférica; proxy de recarga / escorrentía potencial).
- \(B_t < 0\): déficit (no genera alerta de inundación).

Ventanas móviles (incluye el día actual):

| Variable | Ventana | Definición |
| --- | --- | --- |
| `acumulado_3d_mm` | 3 días | \(\sum P\) |
| `acumulado_7d_mm` | 7 días | \(\sum P\) |
| `excedente_7d_mm` | 7 días | \(\sum B\) (déficits sí restan) |
| `excedente_15d_mm` | 15 días | \(\sum B\) |
| `excedente_30d_mm` | 30 días | \(\sum B\) |

En el **semáforo por excedente** solo cuenta el pico **positivo** de esas tres ventanas. Un mes seco no dispara inundación.

Interpretación en InfoSheet (balance de **un** día):

- \(B \ge 15\) mm/día → “Exceso hídrico (posible saturación)”
- \(B \le -3\) mm/día → “Déficit hídrico”
- resto → “Balance intermedio”

Eso es una lectura puntual; el riesgo de saturación de mediano plazo lo llevan los excedentes 7/15/30 d.

### 6.3 Modelo de riesgo híbrido

Archivo: `src/hooks/useRiskData.js`.

El nivel final es el **más severo** de dos lecturas independientes (enfoque preventivo, no promedio):

```
nivel_riesgo = max( nivel_lluvia+vulnerabilidad , nivel_excedente )
```

#### A. Vulnerabilidad estructural (sintética — no GIS)

Se deriva de lat/lon con reglas deterministas, **no** de un DEM ni de hidrografía real:

| Factor | Regla | Puntaje |
| --- | --- | --- |
| Pendiente | lat &lt; 17.8 → baja; &lt; 18.2 → media; resto alta | baja = 2, media = 1, alta = 0 (más peso a terreno plano) |
| Uso de suelo | \(\lvert\mathrm{round}(lon\times 1000)\rvert \bmod 3\) | urbano = 2, agrícola/vegetación = 1 |
| Distancia a río | \(\max(150, \mathrm{round}(\lvert lon+93.5\rvert\times 5500))\) m | &lt; 500 m = 3; &lt; 1200 m = 2; resto = 1 |

`indice_riesgo_base` = suma (rango típico 2–7). Debe reemplazarse por DEM + uso de suelo + distancia a cauces reales antes de uso operativo.

#### B. Riesgo por lluvia + índice base

| Nivel | Condición (OR) |
| --- | --- |
| Muy alto | acumulado 7 d > 200 mm **o** 3 d > 80 mm **o** índice ≥ 7 |
| Alto | 3 d > 50 mm **o** 7 d > 140 mm **o** índice ≥ 5 |
| Medio | 3 d > 25 mm **o** 7 d > 80 mm **o** índice ≥ 3 |
| Bajo | resto |

Umbrales pensados para **mm diarios** (lluvias tropicales de Tabasco), no para series mensuales.

#### C. Riesgo por excedente hídrico

`peak = max(exc7⁺, exc15⁺, exc30⁺)`

| peak (mm) | Nivel |
| --- | --- |
| ≤ 50 | Bajo |
| 50–100 | Medio |
| 100–200 | Alto |
| > 200 | Muy alto |

Estos cortes son **documentales / de ingeniería de MVP**. Requieren calibración con eventos históricos (2017, 2020, etc.) y criterio de Protección Civil / CONAGUA Tabasco.

La UI desglosa `nivel_riesgo_lluvia` y `nivel_riesgo_excedente` para que el técnico vea qué componente manda.

---

## 7. Interfaz

Dos vistas (`mainView` en `src/App.jsx`): **Monitor** y **Pronóstico**.

### 7.1 Monitor

| Bloque | Archivo | Comportamiento |
| --- | --- | --- |
| Mapa | `MapaET.jsx` | Capa fija de lluvia. Heatmap = `acumulado_7d_mm`. Marcadores coloreados por umbrales 40 / 80 / 120 mm. Tooltip: lat, lon, lluvia, acumulados, \(ET_0\) |
| Panel | `PanelDatos.jsx` | Selectores año / mes / **día**. Tarjetas: lluvia, acumulados 3d y 7d, GWETPROF, \(ET_0\), riesgo, municipio |
| Info sheets | `InfoSheet.jsx` | Tres pestañas: lluvia (anomalía vs media del mes, P90 histórico), riesgo híbrido, \(ET_0\) + balance diario |
| Gráfica | `GraficaMensual.jsx` | Serie **diaria del año** seleccionado: lluvia, acumulado 7 d, \(ET_0\) (eje derecho), scroll horizontal |

### 7.2 Pronóstico

`PronosticoSmn.jsx`: selector municipal Chontalpa, tarjetas a 3 días, aviso cualitativo, botón Actualizar (`?refresh=1`). Si hay un punto del mapa seleccionado, se intenta emparejar el municipio (normalización NFD, sin acentos).

### 7.3 Asistente

`buildContext()` envía al backend: municipio, fecha, lluvia, \(ET_0\), GWETPROF, acumulados, balance, excedentes, ambos niveles de riesgo, factores sintéticos y, si hay match, el pronóstico SMN de 3 días. El modelo responde con nivel, factores, recomendaciones y límites del dato (`temperature: 0.2`).

---

## 8. API (`server.js`)

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/chat` | Body `{ prompt, contextoTexto }`. Embedding → RAG opcional → `gpt-4o-mini`. Respuesta `{ respuesta, embedding, rag }` |
| `GET` | `/api/forecast/tabasco` | JSON SMN Tabasco. `?refresh=1` ignora caché |
| `GET` | `/api/power/daily` | CSV unificado. `?refresh=1` fuerza sync. Cabeceras `X-Power-*` |
| `GET` | `/api/power/meta` | Metadatos de caché POWER (`lastEnd`, `rows`, `source`) |
| estático | `/data/*` | CSV de respaldo |
| estático | `/*` | SPA (`build/index.html`) |

Al arrancar: `warmSmnCache()` y `warmPowerCache()` (siembra desde `DATASET_UPDATE.csv` y completa el hueco hasta ayer).

---

## 9. RAG (opcional)

El chat funciona **sin** Supabase. Si hay `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (o anon):

1. Se embede `prompt + contexto`.
2. RPC `match_rag_chunks` (top 6 fragmentos).
3. Los chunks se inyectan al system prompt como evidencia.

Indexado:

```bash
npm run rag:index:spatial
```

El script lee `public/data/DATASET_UPDATE.csv` (o la caché POWER), resume estadísticas espaciales por punto y genera embeddings. Fallos de RAG **no** bloquean el chat.

---

## 10. Mapa de archivos

| Ruta | Rol |
| --- | --- |
| `src/App.jsx` | Orquestación: hooks, contexto del chat, vistas monitor/pronóstico |
| `src/hooks/useRainData.js` | Ingesta CSV, \(ET_0\), balance, ventanas, municipio |
| `src/hooks/useRiskData.js` | Semáforo híbrido |
| `src/hooks/useSmnForecast.js` | Cliente pronóstico |
| `src/utils/calcEt0Daily.js` | FAO-56 diario |
| `src/utils/matchSmnMunicipio.js` | Filtro Chontalpa + emparejado de nombres |
| `src/components/MapaET.jsx` | Mapa lluvia |
| `src/components/PanelDatos.jsx` | Métricas y fecha |
| `src/components/InfoSheet.jsx` | Sheets lluvia / riesgo / ET |
| `src/components/GraficaMensual.jsx` | Serie diaria |
| `src/components/PronosticoSmn.jsx` | UI SMN |
| `lib/nasaPower.js` | Cliente POWER, caché, sync |
| `lib/smnForecast.js` | Cliente SMN, gzip, respaldos |
| `server.js` | API + estáticos |
| `scripts/sync_nasa_power.js` | CLI de sync |
| `scripts/cache_smn_tabasco.js` | Snapshot SMN en el `build` |
| `scripts/rag_index_spatial.js` | Indexado vectorial |
| `public/data/DATASET_UPDATE.csv` | Semilla / respaldo diario |
| `render.yaml` | Blueprint Render |
| `src/hooks/useETdata.js`, `calcEt0Monthly.js` | Legado; no alimentan el runtime |

---

## 11. Desarrollo local

Requisito: **Node 20+**.

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY para el chat
```

**Terminal 1** — API (calienta caché POWER y SMN):

```bash
npm start
```

**Terminal 2** — frontend con proxy a `:3001`:

```bash
npm run start:client
```

| Script | Uso |
| --- | --- |
| `npm start` | Express: API + `build/` (puerto 3001) |
| `npm run start:client` | CRA en `:3000` |
| `npm run build` | Compila React y cachea pronóstico SMN de respaldo |
| `npm run power:sync` | Sync incremental NASA POWER |
| `npm run power:sync -- --full` | Rehace 1981 → ayer |
| `npm run rag:index:spatial` | Indexa fragmentos en Supabase |

Si solo corre CRA **sin** Express, fallan `/api/*` y el monitor usa el CSV de `public/data/` (si existe). El chat y el pronóstico vivo no estarán disponibles.

`data/power_cache/` y `data/nasa_power_test/` están en `.gitignore`.

Variables:

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `OPENAI_API_KEY` | Chat | Embeddings + respuestas |
| `SUPABASE_URL` | No | RAG |
| `SUPABASE_ANON_KEY` | No | Lectura vectorial |
| `SUPABASE_SERVICE_ROLE_KEY` | Indexado | `rag:index:spatial` (solo servidor) |

---

## 12. Despliegue en Render

Blueprint `render.yaml`: Web Service Node, `NODE_VERSION=20.18.0`.

- **Build:** `npm install --no-audit --no-fund && npm run build`
- **Start:** `npm start` → `node server.js`

En el primer arranque, `warmPowerCache()` siembra desde `DATASET_UPDATE.csv` y completa hasta ayer con NASA POWER. El CSV estático sigue como fallback del frontend si la API falla.

Plan gratuito de Render: el disco es efímero; la caché POWER se pierde entre deploys y se regenera desde la semilla + sync.

---

## 13. Calibración y uso profesional

Antes de decisiones operativas, un técnico del área debería:

1. **Validar \(P\)** contra estaciones SMN / CONAGUA locales (POWER es reanálisis, no pluviómetro).
2. **Validar \(ET_0\)** contra una estación con Tmax/Tmin, viento a 2 m y radiación (o FAO ETo calculator).
3. **Recalibrar umbrales** de lluvia (80 / 50 / 25 mm en 3 d; 200 / 140 / 80 mm en 7 d) y de excedente (50 / 100 / 200 mm) con avenidas históricas de la Chontalpa.
4. **Sustituir** pendiente, uso de suelo y distancia a río por capas reales (INEGI, CONAGUA, LiDAR).
5. **No usar** el semáforo como cota de inundación ni como tiempo de concentración.
6. Tratar GWETPROF como indicador de humedad de perfil MERRA-2, no como contenido gravimétrico de un perfil edáfico medido.

---

## 14. Limitaciones y roadmap

- Vulnerabilidad estructural sintética hasta integrar GIS.
- Umbrales de excedente pendientes de calibración local.
- Resolución gruesa POWER: homogeneidad espacial artificial entre municipios vecinos.
- Sin hidráulica de río ni drenaje urbano.
- `GWETROOT`, `T2MDEW` y `QV2M` ya están en el dataset y no se explotan.
- Roadmap sugerido: más puntos espaciales, DEM + cauces, job programado de `power:sync`, fusión controlada pronóstico–histórico, y un módulo de saturación con `GWETPROF`/`GWETROOT`.

---

## 15. Licencia y uso

Herramienta de apoyo técnico-comunitario. Validar umbrales y recomendaciones con autoridades locales (Protección Civil, CONAGUA, ayuntamientos de la Chontalpa) antes de cualquier decisión operativa.
