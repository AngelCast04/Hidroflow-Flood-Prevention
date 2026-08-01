# HydroFlow Flood Prevention

Plataforma web para **monitoreo y apoyo a la prevención de riesgo por inundación** en la región **Chontalpa** (Tabasco, México). Evoluciona HydroFlow hacia visualización de lluvia diaria, humedad de suelo, evapotranspiración de referencia (FAO-56 Penman–Monteith), balance hídrico simplificado P - ET_0, índice de riesgo híbrido, pronóstico SMN y un asistente conversacional.

**Repositorio:** [Hidroflow-Flood-Prevention](https://github.com/AngelCast04/Hidroflow-Flood-Prevention.git)

---

## Estado actual del MVP


| Área              | Implementado                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Datos diarios** | Fuente preferente: NASA POWER vía `GET /api/power/daily` (6 puntos municipales). CSV estático en `public/data/` como **respaldo**. |
| **Zona**          | Chontalpa: Cunduacán, Comalcalco, Villahermosa, Paraíso, Cárdenas, Huimanguillo (+ Jalpa de Méndez y Nacajuca en pronóstico SMN).  |
| **Mapa**          | Capa de **lluvia**: heatmap + marcadores; tooltip con lat, lon, acumulados y evapotranspiración.                                   |
| **Panel**         | Año / mes / **día**, lluvia, acumulados 3d y 7d, GWETPROF, riesgo, municipio aproximado.                                           |
| **Info sheets**   | Lluvia, riesgo (híbrido) y ET; balance diario P - ET_0 y excedentes 7d / 15d / 30d.                                                |
| **Gráfica**       | Serie **diaria**: lluvia, acumulado 7d y evapotranspiración.                                                                       |
| **ET₀**           | `calcEt0Daily.js` (FAO-56) en runtime desde `useRainData.js`.                                                                      |
| **Riesgo**        | Híbrido en `useRiskData.js`: lluvia 3d/7d + vulnerabilidad del sitio + excedente hídrico acumulado (umbrales 50 / 100 / 200 mm).   |
| **Pronóstico**    | SMN-CONAGUA (`GET /api/forecast/tabasco`), selector filtrado a municipios de la **Chontalpa**.                                     |
| **Chat**          | `POST /api/chat` vía `server.js` (OpenAI); RAG opcional con Supabase.                                                              |
| **Despliegue**    | **Render** (Web Service Node).                                                                                                     |




---



## Fuentes de datos



### 1. Preferente — NASA POWER (diario)

- Endpoint interno: `GET /api/power/daily` (CSV unificado) y `GET /api/power/meta`
- Módulo: `lib/nasaPower.js` (caché en `data/power_cache/`, sync incremental)
- Sync manual: `npm run power:sync`
- Parámetros: `PRECTOTCORR`, `T2M`, `T2MDEW`, `RH2M`, `QV2M`, `ALLSKY_SFC_SW_DWN`, `PS`, `WS10M`, `GWETPROF`, `GWETROOT`
- Rango típico: 1981 → presente (diario)



### 2. Respaldo — CSV estático

Si la API no responde (sin `server.js`, red, etc.), `useRainData.js` intenta en orden:

1. `/api/power/daily`
2. `/data/DATASET_UPDATE.csv`
3. `/data/Evapotranspiracion RP.csv` (legado)

Formato unificado esperado:

```text
YEAR,DOY,LAT,LON,ALLSKY_SFC_SW_DWN,T2M,T2MDEW,RH2M,QV2M,PRECTOTCORR,PS,WS10M,GWETPROF,GWETROOT
```



### Parámetros usados en la app


| Variable                                          | Uso                                                         |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `PRECTOTCORR` → `lluvia_mm`                       | Mapa, acumulados, riesgo por lluvia                         |
| `T2M`, `RH2M`, `ALLSKY_SFC_SW_DWN`, `PS`, `WS10M` | Cálculo ET₀ (FAO-56)                                        |
| `GWETPROF`                                        | Panel / InfoSheet (humedad de perfil)                       |
| P - ET_0                                          | Balance diario + excedente 7/15/30 d → riesgo por excedente |


---



## Modelo de riesgo (híbrido)

No se reemplazó el MVP: se **unió** el balance hídrico al semáforo existente.

1. **Por lluvia + vulnerabilidad** — acumulados 3d/7d + índice base (pendiente, uso de suelo, distancia a río).
2. **Por excedente** — máximo de excedente positivo P - ET_0 a 7 / 15 / 30 días (Bajo ≤50, Medio ≤100, Alto ≤200, Muy alto >200).
3. **Nivel final** — el más severo de (1) y (2).

Archivo central: `src/hooks/useRiskData.js`.  
Balance diario en UI: `src/components/InfoSheet.jsx`.

---



## Arquitectura

```
┌─────────────────┐     proxy /api/*      ┌──────────────────────────────┐
│  React (CRA)    │ ────────────────────► │  server.js (Express :3001)   │
│  puerto 3000    │   (solo desarrollo)   │  POST /api/chat              │
└─────────────────┘                       │  GET  /api/forecast/tabasco  │
                                          │  GET  /api/power/daily|meta  │
                                          │  + build/ estático           │
                                          └──────────────┬───────────────┘
                                                         │
                              NASA POWER · SMN · OpenAI (+ Supabase RAG)
```


| Componente                     | Ruta / archivo                                       |
| ------------------------------ | ---------------------------------------------------- |
| Orquestación UI                | `src/App.jsx`                                        |
| Datos lluvia / ET / excedentes | `src/hooks/useRainData.js`                           |
| Riesgo híbrido                 | `src/hooks/useRiskData.js`                           |
| ET₀ diaria                     | `src/utils/calcEt0Daily.js`                          |
| Cliente NASA POWER             | `lib/nasaPower.js`                                   |
| Pronóstico SMN                 | `lib/smnForecast.js` + `src/hooks/useSmnForecast.js` |
| Filtro Chontalpa (SMN)         | `src/utils/matchSmnMunicipio.js`                     |
| Mapa                           | `src/components/MapaET.jsx`                          |
| Panel                          | `src/components/PanelDatos.jsx`                      |
| Gráfica                        | `src/components/GraficaMensual.jsx`                  |
| Info sheets                    | `src/components/InfoSheet.jsx`                       |
| Pronóstico UI                  | `src/components/PronosticoSmn.jsx`                   |
| API producción                 | `server.js`                                          |
| Sync POWER                     | `scripts/sync_nasa_power.js`                         |
| Blueprint Render               | `render.yaml`                                        |
| Esquema RAG                    | `supabase/rag.sql`                                   |


**Legado:** `src/hooks/useETdata.js` y `evapotranspiracion_completa.csv` ya no alimentan la app en runtime.

---



## Desarrollo local

Requisitos: **Node 20+** (ver `engines` en `package.json`).

**Terminal 1** — API (calienta caché POWER y SMN):

```bash
npm install
npm start
```

**Terminal 2** — frontend con proxy a `http://localhost:3001`:

```bash
npm run start:client
```

Copia `.env.example` → `.env.local` y define al menos `OPENAI_API_KEY` para probar el chat.


| Script                         | Uso                                                 |
| ------------------------------ | --------------------------------------------------- |
| `npm start`                    | Express: API + sirve `build/` (puerto 3001)         |
| `npm run start:client`         | Solo CRA en desarrollo (puerto 3000)                |
| `npm run build`                | Compila React en `build/` (+ caché SMN de respaldo) |
| `npm run power:sync`           | Sincroniza caché NASA POWER (`data/power_cache/`)   |
| `npm run power:sync -- --full` | Rehace histórico completo POWER                     |
| `npm run rag:index:spatial`    | Indexa puntos en Supabase                           |


> Si solo ejecutas `npm run start:client` sin el servidor, fallan `/api/*` y la app usa el **CSV de respaldo** (si existe).

La caché local `data/power_cache/` y `data/nasa_power_test/` están en `.gitignore` (no se suben al repo).

---



## Despliegue en Render

El despliegue oficial es un **Web Service Node** en [Render](https://render.com).

### Opción A (recomendada): Blueprint

1. Conecta el repositorio en Render.
2. Usa **Blueprint** apuntando a `render.yaml`.
3. Configura variables de entorno:


| Variable                    | Obligatoria              | Uso                                   |
| --------------------------- | ------------------------ | ------------------------------------- |
| `OPENAI_API_KEY`            | Sí (chat)                | Embeddings + respuestas del asistente |
| `SUPABASE_URL`              | No (RAG)                 | Búsqueda vectorial                    |
| `SUPABASE_ANON_KEY`         | No (RAG)                 | Cliente en servidor                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Recomendada para indexar | Script `rag:index:spatial`            |


Render ejecuta:

- **Build:** `npm install --no-audit --no-fund && npm run build`
- **Start:** `npm start` → `node server.js`
- **Node:** `20.18.0` (`NODE_VERSION` en `render.yaml`)



### Opción B: Web Service manual

- **Type:** Web Service (Node)
- **Build Command:** `npm install --no-audit --no-fund && npm run build`
- **Start Command:** `npm start`
- Mismas variables de entorno que arriba.

En el primer arranque, `warmPowerCache()` siembra desde `public/data/DATASET_UPDATE.csv` (incluido en el deploy) y completa el hueco hasta ayer con NASA POWER (sync incremental). El CSV sigue disponible como respaldo del front si la API falla.

---



## RAG (Supabase + pgvector)

1. Ejecuta el SQL en `supabase/rag.sql` (tabla `rag_chunks`, función `match_rag_chunks`).
2. Configura `OPENAI_API_KEY`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Indexa una vez: `npm run rag:index:spatial`.

El chat enriquece el contexto con fragmentos similares cuando Supabase está configurado en el servidor.

---



## Interfaz (resumen)

- **Mapa:** visualización de **lluvia** (heatmap + marcadores).
- **Panel + InfoSheet:** métricas diarias, riesgo híbrido, balance P - ET_0 y excedentes.
- **Pronóstico:** SMN a 3 días, solo municipios Chontalpa.
- **Chat:** contexto con lluvia, ET, excedentes, riesgo y pronóstico SMN si aplica.
- **Etiquetas UI:** se usa **“Evapotranspiración”** en la interfaz.

---



## Limitaciones y próximos pasos

- Riesgo estructural (pendiente, uso de suelo, distancia a río) es **sintético** hasta integrar capas geoespaciales reales.
- Umbrales de excedente (50 / 100 / 200 mm) toman el modelo documental; conviene **calibrarlos** con datos y expertos locales de Tabasco.
- MERRA-2 / POWER tiene resolución gruesa: puntos cercanos pueden compartir valores.
- Sin modelado hidráulico ni niveles de río: **apoyo a la decisión**, no sustituto de alertas oficiales.
- Roadmap: más puntos espaciales, capas GIS reales, uso de `GWETROOT` / `T2MDEW` en el panel, job programado de `power:sync` en producción.

---



## Licencia y uso

Herramienta de apoyo técnico-comunitario. Validar umbrales y recomendaciones con autoridades locales antes de decisiones operativas.