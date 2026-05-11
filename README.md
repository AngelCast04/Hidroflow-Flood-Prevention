# HydroFlow Flood Prevention - Guia de Desarrollo

## Objetivo

Reenfocar HydroFlow (actualmente orientado a evapotranspiracion y agrometeorologia) hacia una plataforma que ayude a reducir riesgo de inundaciones mediante visualizacion, analisis y recomendaciones tecnicas.

## Despliegue en Render (reemplaza Netlify)

Este proyecto usa Create React App y un servidor Node (`server.js`) que:

- Sirve el frontend compilado (`build/`)
- Expone el API `POST /api/chat` (requiere `OPENAI_API_KEY`)
- Implementa RAG via Supabase (`rag_chunks` + `match_rag_chunks`)

### Opcion A (recomendada): Render Blueprint

1) Sube el repo a GitHub.
2) En Render, usa **Blueprint** y apunta al `render.yaml`.
3) Configura variables de entorno:
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (recomendada para el servidor)

Render ejecutara:

- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm start` (corre `node server.js`)

### Opcion B: Crear Web Service manual

En Render:

- **Type**: Web Service (Node)
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm start`
- **Environment Variables**: `OPENAI_API_KEY`

## Desarrollo local

En una terminal:

```bash
node server.js
```

En otra terminal:

```bash
npm run start:client
```

La app (CRA) hara proxy de `/api/*` hacia `http://localhost:3001`.

## RAG (Supabase + pgvector)

### 1) Crear esquema en Supabase

Ejecuta el SQL de:

- `supabase/rag.sql`

Esto crea la tabla `rag_chunks` y la función `match_rag_chunks`.

### 2) Indexar el dataset espacial (una sola vez)

Configura env vars localmente (o en CI):

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Luego:

```bash
npm run rag:index:spatial
```

El script toma `public/data/Evapotranspiracion RP.csv`, genera embeddings y guarda chunks en `rag_chunks`.

## 1) Definir alcance del MVP

Antes de programar, define:

- Zona geografica: Tabasco completo o municipios especificos.
- Horizonte temporal: historico, monitoreo diario, o pronostico corto (24-72 h).
- Caso de uso principal:
  - Monitoreo de lluvia y saturacion.
  - Mapa de vulnerabilidad.
  - Asistente de recomendaciones de prevencion.

Resultado esperado del MVP: mapa de riesgo + panel de metricas + chat explicativo.

## 2) Datos necesarios

### 2.1 Meteorologicos (dinamicos)

- Precipitacion (idealmente diaria u horaria).
- Acumulados: 24h, 72h, 7 dias.
- Opcional: ET y humedad para contexto.

### 2.2 Geoespaciales (estaticos)

- Pendiente/DEM.
- Uso de suelo (urbano, rural, vegetacion).
- Distancia a rios o cuerpos de agua.
- Limites municipales/localidades.

## 3) Estructura minima de archivos de datos

### `lluvia_diaria.csv`

Columnas sugeridas:

- `fecha`
- `lat`
- `lon`
- `municipio`
- `lluvia_mm`
- `acumulado_3d_mm`
- `acumulado_7d_mm`

### `riesgo_static.csv`

Columnas sugeridas:

- `lat`
- `lon`
- `municipio`
- `pendiente_clase`
- `uso_suelo`
- `distancia_rio_m`
- `indice_riesgo_base`

## 4) Reutilizacion de la arquitectura actual de HydroFlow

El proyecto ya tiene:

- App React con mapa y paneles.
- Carga de CSV con hooks (`useETdata`).
- Chat serverless en Netlify (`netlify/functions/chat.js`).
- Integracion con embeddings/Supabase.

Reenfoque:

- Crear hooks nuevos para lluvia/riesgo (`useRainData`, `useRiskData`).
- Adaptar componentes de mapa y panel para capas de inundacion.
- Cambiar prompt del asistente para analisis hidrometeorologico y prevencion.

## 5) Indicadores de riesgo (version inicial)

### 5.1 Riesgo por lluvia reciente (ejemplo)

- Alto: `acumulado_3d > 100 mm`
- Muy alto: `acumulado_7d > 200 mm`

### 5.2 Riesgo estructural (ejemplo por puntajes)

- Pendiente baja = +2
- Uso urbano = +2
- Distancia a rio < 500m = +3

`indice_riesgo_base = suma de puntajes`

### 5.3 Riesgo final (regla simple)

Combinar:

- `indice_riesgo_base`
- `acumulado_3d_mm`
- `acumulado_7d_mm`

Salida:

- Bajo / Medio / Alto (colores en mapa).

## 6) Diseno funcional de pantallas

### Vista principal

- Mapa con selector de capa:
  - Lluvia
  - Riesgo de inundacion
  - Historico
- Selector temporal (fecha/rango).

### Panel lateral

- Lluvia 24h, 72h, 7d.
- Indice de riesgo actual del punto seleccionado.
- Tendencia reciente.

### Grafica

- Serie temporal de lluvia y eventos extremos.

### Chat

- Explicacion de riesgo en lenguaje claro.
- Recomendaciones preventivas por municipio.

## 7) Rediseno del asistente (chat)

Cambiar enfoque del system prompt:

- De cultivo/siembra -> gestion de riesgo por inundacion.
- Instrucciones clave:
  - Explicar limites de los datos.
  - Distinguir historico vs pronostico.
  - Dar recomendaciones generales de prevencion.
  - Evitar afirmaciones absolutas.

Incluir contexto en cada consulta:

- Municipio, fecha, acumulados, nivel de riesgo, factores de vulnerabilidad.

## 8) Plan tecnico por fases

### Fase 1 - Datos y modelo basico

1. Preparar CSV de lluvia y CSV de riesgo estatico.
2. Validar calidad de datos (nulos, outliers, unidades).

### Fase 2 - Frontend

3. Crear hooks para nuevos datasets.
4. Adaptar mapa y leyendas de riesgo.
5. Adaptar panel y graficas.

### Fase 3 - Chat

6. Ajustar prompt del asistente y contexto inyectado.
7. Anadir respuestas con acciones preventivas.

### Fase 4 - Validacion

8. Probar con eventos historicos conocidos.
9. Ajustar umbrales y puntajes segun resultados.

## 9) Criterios de exito del MVP

- El mapa identifica claramente zonas con mayor riesgo relativo.
- El panel muestra metricas comprensibles para usuario no tecnico.
- El asistente explica "por que" de cada nivel de riesgo.
- El resultado coincide razonablemente con eventos historicos observados.

## 10) Riesgos y limitaciones

- Sin niveles de rio o modelacion hidrologica avanzada, el sistema da una aproximacion.
- Los umbrales iniciales deben calibrarse con expertos locales.
- Es apoyo a decision, no sustituto de alertas oficiales de proteccion civil.

## 11) Proximos pasos recomendados

- Integrar pronostico de lluvia 24-72h.
- Anadir capa de infraestructura critica (escuelas, hospitales, caminos).
- Evaluar incorporacion de niveles de rio.
- Publicar guia de uso y protocolo de respuesta comunitaria.

## Nota de implementacion

Esta guia esta disenada para aprovechar la base actual de HydroFlow y evolucionar de ET agricola hacia una herramienta practica de prevencion de inundaciones por etapas, empezando con un MVP funcional y escalable.
