/**
 * Prueba de credenciales del proveedor. NO imprime la clave: solo dice si funciona.
 *
 *   bun run scripts/probar-proveedor.ts
 *
 * Hace dos llamadas minimas:
 *   1. GET  /v1/models  -> valida la credencial (Bearer) sin gastar tokens
 *   2. POST /v1/chat/completions con un hola -> valida que el modelo responde
 *
 * Pensado para pegar la clave en el VPS y comprobar en 5 segundos que todo esta
 * bien, antes de levantar el agente.
 */

const PROVEEDOR = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
const MODELO =
  process.env.LLM_MODEL_MINIMAX ??
  process.env.LLM_MODEL_ANTHROPIC ??
  process.env.LLM_MODEL_OPENAI ??
  "MiniMax-M3.1-Flash";

const clave =
  process.env.MINIMAX_API_KEY?.trim() ||
  process.env.MINIMAX_SUBSCRIPTION_KEY?.trim() ||
  process.env.ANTHROPIC_API_KEY?.trim() ||
  process.env.OPENAI_API_KEY?.trim() ||
  "";

if (clave === "") {
  console.error("No hay ninguna credencial en el entorno.");
  console.error("Defina MINIMAX_API_KEY (Subscription Key del plan M) en el .env del servidor.");
  process.exit(2);
}

console.log(`Credencial encontrada (${clave.length} caracteres, no se muestra).`);
console.log(`Proveedor configurado: ${PROVEEDOR} | modelo: ${MODELO}`);
console.log("");

const cabeceras: Record<string, string> = {
  "content-type": "application/json",
  authorization: `Bearer ${clave}`,
  "x-api-key": clave,
};

const esMiniMax = PROVEEDOR === "minimax" || process.env.MINIMAX_API_KEY !== undefined;
const baseUrl = esMiniMax
  ? (process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1")
  : (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1");

// 1. Listar modelos: valida la credencial sin consumir tokens.
try {
  const respuesta = await fetch(`${baseUrl}/models`, { headers: cabeceras, signal: AbortSignal.timeout(20_000) });
  const cuerpo = (await respuesta.text()).slice(0, 400);
  if (respuesta.ok) {
    let modelos: string[] = [];
    try {
      const datos = JSON.parse(cuerpo) as { data?: { id: string }[] };
      modelos = (datos.data ?? []).map((modelo) => modelo.id);
    } catch {
      modelos = [];
    }
    console.log(`[OK  ] credencial valida (GET /models -> ${respuesta.status})`);
    if (modelos.length > 0) {
      console.log(`       modelos disponibles: ${modelos.slice(0, 8).join(", ")}`);
    }
  } else {
    console.error(`[FALLA] GET /models -> HTTP ${respuesta.status}: ${cuerpo}`);
  }
} catch (error) {
  console.error(`[FALLA] GET /models: ${error instanceof Error ? error.message : String(error)}`);
}

// 2. Una llamada minima al modelo.
try {
  const respuesta = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({
      model: MODELO,
      messages: [{ role: "user", content: "Responde solo: OK" }],
      max_tokens: 16,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const cuerpo = await respuesta.text();
  if (respuesta.ok) {
    const datos = JSON.parse(cuerpo) as { choices?: { message?: { content?: string } }[] };
    const texto = (datos.choices?.[0]?.message?.content ?? "").slice(0, 80);
    console.log(`[OK  ] modelo ${MODELO} responde (HTTP ${respuesta.status}): "${texto}"`);
  } else {
    console.error(`[FALLA] POST /chat/completions -> HTTP ${respuesta.status}: ${cuerpo.slice(0, 300)}`);
  }
} catch (error) {
  console.error(`[FALLA] POST /chat/completions: ${error instanceof Error ? error.message : String(error)}`);
}
