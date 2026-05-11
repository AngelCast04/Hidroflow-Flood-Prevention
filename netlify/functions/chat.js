export async function handler(event) {

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders
    };
  }

  try {

    const { prompt, contextoTexto } = JSON.parse(event.body);

    const promptMejorado = prompt;

    // PASO 1: EMBEDDING
    const resEmbed = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        input: promptMejorado,
        model: "text-embedding-3-small"
      })
    });

    const embedData = await resEmbed.json();
    const embedding = embedData.data[0].embedding;

    // PASO 2: CHAT
    const resChat = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `Eres un asistente de prevencion de inundaciones para Tabasco.

Objetivo:
- Explicar el riesgo hidrometeorologico con lenguaje claro.
- Usar el contexto tecnico recibido (municipio, fecha, acumulados, nivel de riesgo y vulnerabilidad).
- Dar recomendaciones preventivas generales y realistas.

Reglas:
1) No hagas afirmaciones absolutas.
2) Diferencia historico, monitoreo actual y pronostico (si no hay pronostico, dilo).
3) Cuando el riesgo sea Alto o Muy alto, prioriza acciones concretas de prevencion comunitaria.
4) Incluye limites del dato: es apoyo a decision y no sustituye alertas oficiales de Proteccion Civil.
5) Si faltan datos, pide precision adicional de municipio/fecha.

Formato sugerido:
- Nivel de riesgo actual
- Factores que lo explican
- Recomendaciones de prevencion
- Limites/advertencias

CONTEXTO:
${contextoTexto}`},
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2
      })
    });

    const chatData = await resChat.json();
    const safeReply =
      chatData?.choices?.[0]?.message?.content ||
      "No pude generar respuesta en este momento. Intenta de nuevo.";

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        embedding,
        respuesta: safeReply
      })
    };

  } catch (error) {

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message
      })
    };

  }
}