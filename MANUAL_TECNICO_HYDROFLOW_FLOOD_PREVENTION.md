# Manual técnico — HydroFlow Flood Prevention

**Versión del documento:** 1.0  
**Alcance:** Descripción de la evolución del proyecto desde la base orientada a evapotranspiración agrometeorológica hacia una plataforma de **monitoreo y apoyo a la prevención de riesgo por inundación**, incluyendo integración del dataset `Evapotranspiracion RP.csv`, cálculo de ET₀ y asistente conversacional.

---

## 1. Objetivo del reenfoque

El producto **HydroFlow Flood Prevention** concentra el MVP en:

- Visualización **geoespacial** de indicadores relacionados con **lluvia**, **riesgo relativo** y **serie histórica**.
- **Panel** con métricas comprensibles (acumulados, humedad de perfil, ET₀, riesgo).
- **Gráfica** de series temporales (lluvia, acumulado móvil a 7 meses, ET₀).
- **Asistente** que explica riesgo y medidas preventivas con **lenguaje claro**, sin sustituir alertas oficiales.

La guía de producto y fases está alineada conceptualmente con `README.md` (MVP: mapa + panel + chat).

---

## 2. Stack y estructura relevante

| Capa | Tecnología |
|------|------------|
| Frontend | React (Create React App), Tailwind CSS |
| Mapas | Leaflet, react-leaflet, leaflet.heat |
| Gráficas | Recharts |
| Datos tabulares | Papa Parse (CSV en `public/data/`) |
| Chat serverless | Netlify Functions (`netlify/functions/chat.js`) |
| Configuración Netlify | `netlify.toml` → directorio de funciones `netlify/functions` |

**Archivos principales modificados o añadidos:**

| Ruta | Rol |
|------|-----|
| `src/App.jsx` | Orquestación: hooks, mapa, panel, gráfica, chat, contexto para el asistente |
| `src/hooks/useRainData.js` | Carga y normalización del CSV ancho; acumulados; ET₀ |
| `src/hooks/useRiskData.js` | Índice base estático + nivel de riesgo combinado |
| `src/utils/calcEt0Monthly.js` | Cálculo mensual de ET₀ (FAO Penman–Monteith simplificado) |
| `src/components/MapaET.jsx` | Mapa, capas, heatmap de lluvia, marcadores y tooltips |
| `src/components/PanelDatos.jsx` | Selectores año/mes y tarjetas de métricas |
| `src/components/GraficaMensual.jsx` | Series: lluvia, acumulado 7 meses, ET₀ |
| `netlify/functions/chat.js` | Embedding + chat; system prompt orientado a inundación |
| `public/data/Evapotranspiracion RP.csv` | Dataset operativo (formato PARAMETRO × meses) |

**Nota:** `src/hooks/useETdata.js` permanece en el repositorio como legado del flujo anterior con `evapotranspiracion_completa.csv`; la aplicación actual usa `useRainData` + `useRiskData`.

---

## 3. Formato del dataset y pipeline de datos

### 3.1 Estructura del CSV

El archivo **`public/data/Evapotranspiracion RP.csv`** tiene filas por combinación:

- `PARAMETRO` (código MERRA-2 / similar)
- `YEAR`, `LAT`, `LON`
- Valores mensuales en columnas `JAN` … `DEC` (y `ANN`, no usado en el pivote mensual)

### 3.2 Parámetros consumidos en frontend

| PARAMETRO | Uso en la app |
|-----------|----------------|
| `PRECTOTCORR` | Precipitación mensual corregida → `lluvia_mm` |
| `GWETPROF` | Humedad de perfil del suelo (0–1) → panel y tooltip |
| `T2M` | Temperatura media 2 m (°C) → cálculo ET₀ |
| `RH2M` | Humedad relativa 2 m (%) → cálculo ET₀ |
| `ALLSKY_SFC_SW_DWN` | Radiación solar superficial (MJ m⁻² día⁻¹) → ET₀; si falta o es inválida (p. ej. -999), se estima |
| `PS` | Presión superficial (kPa en el CSV; el código valida rango ~50–115) → ET₀ |
| `WS10M` | Viento a 10 m (m s⁻¹), convertido a 2 m → ET₀ |

### 3.3 Pivote y clave temporal

`useRainData.js` agrupa por **`lat_lon_year_month`**, fusionando todos los `PARAMETRO` en un único registro mensual por punto.

Ordenación: año, mes, luego coordenadas (para series consistentes por estación).

### 3.4 Acumulados móviles

Sobre la serie **ordenada por tiempo** por cada par `(lat, lon)`:

- **`acumulado_3d_mm`**: suma de los últimos **3 meses** de `lluvia_mm` (etiqueta de producto “72 h” heredada; en datos mensuales representa ventana de **3 meses**).
- **`acumulado_7d_mm`**: suma de los últimos **7 meses** (análogo: ventana de **7 meses**).

*Recomendación técnica futura:* renombrar en UI a “acumulado 3 meses / 7 meses” o ingestar datos diarios si se requieren ventanas 72 h / 7 días literales.

### 3.5 Municipio mostrado

El CSV no incluye nombre de municipio. Se asigna **`municipio`** por **proximidad a centroides** definidos en `useRainData.js` (lista de municipios de Tabasco). Es una aproximación; para producción conviene capa vectorial oficial o campo `municipio` en el CSV.

---

## 4. Cálculo de evapotranspiración de referencia (ET₀)

### 4.1 Implementación

**Archivo:** `src/utils/calcEt0Monthly.js`  
**Función exportada:** `calcEt0Monthly({ latDeg, month, tMeanC, rhPct, rsMjM2Day, psKpa, ws10Ms })`

- Base metodológica: **FAO-56 Penman–Monteith** adaptado a **medias mensuales**.
- **Radiación extraterrestre** `Ra` según latitud y día juliano representativo del mes.
- **Rs** (radiación de onda corta): si el valor del CSV es válido, se usa; si no, **Rs ≈ 0.45 × Ra** (aproximación para cielo nublado cuando faltan datos o hay sentinela -999).
- **Viento:** `WS10M` → velocidad a 2 m con factor tipo perfil logarítmico (`u2 ≈ 0.747 × u10`); si falta viento, se usa valor por defecto moderado.
- **Salida:** `ET_CALCULADA` en **mm día⁻¹** (promedio mensual expresado como tasa diaria equivalente).

### 4.2 Integración

Tras el pivote, cada fila mensual recibe **`ET_CALCULADA`** si existen al menos `T2M` y `RH2M`; el resto de variables mejoran la física del término radiativo y aerodinámico.

### 4.3 Visualización

- **Panel:** “ET₀ calculada (FAO Penman–Monteith)”.
- **Gráfica:** eje derecho, serie `et` (verde).
- **Mapa:** tooltip con ET₀.
- **Chat:** línea `ET0 mm/día` en el contexto inyectado.

---

## 5. Modelo de riesgo (MVP)

**Archivo:** `src/hooks/useRiskData.js`

### 5.1 Componente “estructural” (sintético)

Por coordenadas se derivan (no vienen del CSV):

- Clase de pendiente aproximada por latitud.
- Uso de suelo aproximado por longitud.
- Distancia a río aproximada a partir de `lon`.
- **`indice_riesgo_base`**: suma de puntajes (compatible con el esquema del README).

### 5.2 Nivel de riesgo combinado

Se combinan **`indice_riesgo_base`** con **`acumulado_3d_mm`** y **`acumulado_7d_mm`** mediante umbrales **calibrados para magnitudes mensuales** de precipitación (no para mm en 72 h reales).

Categorías: **Bajo**, **Medio**, **Alto**, **Muy alto**.

### 5.3 Limitaciones explícitas

- Sin modelado hidráulico ni niveles de río.
- Umbrales y capas sintéticas deben validarse con expertos locales.
- El sistema es **apoyo a la decisión**, no alerta oficial.

---

## 6. Interfaz: mapa, capas y gráfica

### 6.1 Mapa (`MapaET.jsx`)

- **Centrado** según promedio de puntos o valor por defecto en Tabasco.
- **Capas** (selector en `App.jsx`): `lluvia`, `riesgo`, `historico` (afectan opacidad / heatmap).
- **Heatmap** (`leaflet.heat`): intensidad ligada a `lluvia_mm` cuando la capa es de lluvia.
- **Marcadores** circulares con color según **`nivel_riesgo`**.
- **Tooltip:** lat/lon, lluvia, GWETPROF, ET₀, acumulado 3-meses, riesgo.

### 6.2 Gráfica (`GraficaMensual.jsx`)

- Eje izquierdo: **lluvia** (área + línea) y **acumulado 7 meses** (línea naranja).
- Eje derecho: **ET₀** (línea verde).
- Scroll horizontal según longitud de la serie.

### 6.3 Panel (`PanelDatos.jsx`)

- Selectores de **año** y **mes** sobre la serie del punto seleccionado.
- Métricas: lluvia, acumulados, pendiente (sintética), GWETPROF, distancia a río (sintética), ET₀, bloque de **riesgo de inundación** y municipio asignado.

---

## 7. Asistente conversacional

### 7.1 Frontend (`App.jsx`)

- Construye **`contextoTexto`** con: municipio, fecha, lluvia, ET₀, GWETPROF, acumulados, nivel de riesgo, factores sintéticos y nota legal.
- **POST** a `/api/chat` con `{ prompt, contextoTexto }`.

### 7.2 API de chat (Render / Node)

1. Genera **embedding** con OpenAI (`text-embedding-3-small`).
2. Llama a **chat completions** (`gpt-4o-mini`) con **system prompt** orientado a:
   - Explicación de riesgo hidrometeorológico.
   - Diferenciación histórico / monitoreo / pronóstico.
   - Recomendaciones preventivas generales.
   - Evitar afirmaciones absolutas y recordar límites del dato.

**Requisitos de despliegue:** variable de entorno `OPENAI_API_KEY` en Render.

**Desarrollo local:** ejecutar `node server.js` (API en `http://localhost:3001`) y el frontend con `npm run start:client`. CRA hace proxy de `/api/*` a `http://localhost:3001`.

---

## 8. Cómo ejecutar y construir

```bash
npm install
npm start          # http://localhost:3000
npm run build      # salida en build/
```

Datos estáticos: colocar o actualizar **`public/data/Evapotranspiracion RP.csv`**; CRA sirve `public/` en la raíz `/`.

---

## 9. Evolución respecto al HydroFlow original

| Antes (orientación) | Después (Flood Prevention) |
|---------------------|----------------------------|
| CSV largo de ET y variables agrometeorológicas por mes (`useETdata` + `evapotranspiracion_completa.csv`) | CSV ancho multi-`PARAMETRO` + `useRainData` |
| Mapa centrado en heatmap de ET | Mapa con lluvia, riesgo y ET₀ en tooltip |
| Panel de variables tipo estación meteorológica agrícola | Panel de riesgo, lluvia, GWETPROF, ET₀ |
| Chat vía URL remota + Supabase + contexto agro | Chat local a Netlify + contexto de inundación |
| Sin cálculo explícito ET en el nuevo CSV | ET₀ FAO con T2M, RH2M, radiación, PS, WS10M |

---

## 10. Próximos pasos técnicos sugeridos

1. **Datos:** archivo `lluvia_diaria.csv` y `riesgo_static.csv` según README, con columnas explícitas de municipio.
2. **Coherencia temporal:** renombrar o recalcular acumulados si el negocio exige 24 h / 72 h / 7 d reales.
3. **Riesgo:** sustituir reglas sintéticas por capas geoespaciales reales (DEM, uso de suelo, distancia a cauces).
4. **ET:** validar ET₀ mensual frente a estaciones o a `ET_CALCULADA` del pipeline anterior.
5. **Desarrollo:** documentar uso de `netlify dev` para probar el chat en local.

---

*Fin del manual técnico.*
