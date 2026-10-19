/**
 * Verificacion de una instancia desplegada (o local) desde fuera.
 *
 *   bun run scripts/smoke-test.ts [url]
 *
 * Es consciente del modo del agente:
 *
 *  - Modo determinista (sin credencial): se comprueba la secuencia exacta de
 *    herramientas (leer -> mapear -> generar -> armar), la confirmacion humana
 *    y el envio simulado.
 *  - Modo LLM (credencial configurada): no se exige una secuencia exacta de
 *    llamadas, porque la decide el modelo; se exige lo que si es un fallo
 *    objetivo: que el backend responda, que el front cargue, que el chat
 *    responda y que NO haya error del proveedor (por ejemplo, una credencial
 *    invalida). Asi el test no da falsos negativos en produccion.
 *
 * Sale con codigo 0 si todo pasa y 1 si algo falla.
 */

const URL_BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const CASO = "ec-corp-andina";

interface Resultado {
  nombre: string;
  ok: boolean;
  detalle: string;
}

const resultados: Resultado[] = [];
let modo = "desconocido";

function registrar(nombre: string, ok: boolean, detalle: string): void {
  resultados.push({ nombre, ok, detalle });
  console.log(`[${ok ? "OK  " : "FALLA"}] ${nombre} - ${detalle}`);
}

function informar(nombre: string, detalle: string): void {
  console.log(`[INFO ] ${nombre} - ${detalle}`);
}

async function peticion(ruta: string, opciones: RequestInit = {}): Promise<Response> {
  return fetch(`${URL_BASE}${ruta}`, { ...opciones, signal: AbortSignal.timeout(45_000) });
}

console.log(`Verificacion de ${URL_BASE}`);
console.log("");

// 1. Salud del backend: ademas determina en que modo esta el agente.
let health: { ok?: boolean; provider?: string; model?: string } = {};
try {
  const respuesta = await peticion("/api/health");
  health = (await respuesta.json()) as typeof health;
  const ok = respuesta.ok && health.ok === true;
  registrar("salud del backend", ok, `proveedor=${health.provider ?? "?"} modelo=${health.model ?? "?"}`);
  modo = health.provider === "guiado" ? "determinista" : "llm";
} catch (error) {
  registrar("salud del backend", false, `no respondio: ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`         modo del agente: ${modo}`);
console.log("");

// 2. Front de chat
try {
  const respuesta = await peticion("/");
  const html = await respuesta.text();
  const ok = respuesta.ok && html.includes("Agente Registro como Proveedor");
  registrar("front de chat", ok, `HTTP ${respuesta.status}, ${html.length} bytes`);
} catch (error) {
  registrar("front de chat", false, error instanceof Error ? error.message : String(error));
}

// 3. Recursos estaticos
for (const recurso of ["/app.js", "/styles.css"]) {
  try {
    const respuesta = await peticion(recurso);
    registrar(`recurso estatico ${recurso}`, respuesta.ok, `HTTP ${respuesta.status}`);
  } catch (error) {
    registrar(`recurso estatico ${recurso}`, false, error instanceof Error ? error.message : String(error));
  }
}

interface RespuestaChat {
  reply?: string;
  toolCalls?: { nombre: string; argumentos?: { confirmado?: boolean } }[];
  needsConfirmation?: boolean;
  error?: string;
}

// 4. Ciclo del agente: procesar el caso
const sessionId = `smoke-${Date.now().toString(36)}`;
let pasoProcesar = false;
try {
  const respuesta = await peticion("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, message: `Procesa el caso "${CASO}"` }),
  });
  const datos = (await respuesta.json()) as RespuestaChat;
  const reply = datos.reply ?? "";
  const llamadas = (datos.toolCalls ?? []).map((llamada) => llamada.nombre);

  if (!respuesta.ok) {
    registrar("ciclo del agente (procesar)", false, `HTTP ${respuesta.status}`);
  } else if (datos.error !== undefined) {
    registrar("ciclo del agente (procesar)", false, `error de la API: ${datos.error}`);
  } else if (reply.trim() === "") {
    registrar("ciclo del agente (procesar)", false, "el agente respondio vacio");
  } else if (/No pude consultar al proveedor|401|403|unauthorized|invalid.*key/i.test(reply)) {
    // Fallo objetivo: el proveedor rechazo la peticion (credencial, cuota o red).
    registrar("ciclo del agente (procesar)", false, `error del proveedor: ${reply.slice(0, 160)}`);
  } else if (modo === "determinista") {
    const esperadas = [
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_generar_formulario",
      "proveedor_armar_paquete",
    ];
    const faltan = esperadas.filter((nombre) => !llamadas.includes(nombre));
    const ok = faltan.length === 0 && datos.needsConfirmation === true && reply.includes(CASO);
    registrar(
      "ciclo del agente (procesar)",
      ok,
      ok
        ? `llamadas=${llamadas.length} confirmacion=${datos.needsConfirmation}`
        : `faltan llamadas: ${faltan.join(", ") || "ninguna"} | confirmacion=${datos.needsConfirmation}`,
    );
    pasoProcesar = ok;
  } else {
    // Modo LLM: la secuencia la decide el modelo. Solo es fallo si no hubo
    // respuesta o si el proveedor respondio con error.
    pasoProcesar = true;
    registrar(
      "ciclo del agente (procesar)",
      true,
      `el agente respondio (${reply.length} chars, ${llamadas.length} llamadas a herramientas)`,
    );
  }
} catch (error) {
  registrar("ciclo del agente (procesar)", false, error instanceof Error ? error.message : String(error));
}

// 5. Confirmacion humana
if (pasoProcesar) {
  try {
    const respuesta = await peticion("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message: "si, envia el paquete" }),
    });
    const datos = (await respuesta.json()) as RespuestaChat;
    const envio = (datos.toolCalls ?? []).find((llamada) => llamada.nombre === "proveedor_simular_envio");

    if (!respuesta.ok || datos.error !== undefined) {
      registrar("confirmacion humana (envio simulado)", false, `HTTP ${respuesta.status}`);
    } else if (modo === "determinista") {
      const ok = envio !== undefined && envio.argumentos?.confirmado === true;
      registrar(
        "confirmacion humana (envio simulado)",
        ok,
        ok ? "proveedor_simular_envio con confirmado=true" : "no se ejecuto el envio con confirmacion",
      );
    } else {
      const reply = datos.reply ?? "";
      const error = /No pude consultar al proveedor/i.test(reply);
      registrar(
        "confirmacion humana (envio simulado)",
        !error,
        error ? `error del proveedor: ${reply.slice(0, 160)}` : `el agente respondio (${reply.length} chars)`,
      );
    }
  } catch (error) {
    registrar("confirmacion humana (envio simulado)", false, error instanceof Error ? error.message : String(error));
  }
}

// 6. Historial de la sesion
try {
  const respuesta = await peticion(`/api/sessions/${sessionId}`);
  const datos = (await respuesta.json()) as { mensajes?: unknown[] };
  const ok = respuesta.ok && Array.isArray(datos.mensajes) && datos.mensajes.length > 0;
  registrar("historial de la sesion", ok, `HTTP ${respuesta.status}`);
} catch (error) {
  registrar("historial de la sesion", false, error instanceof Error ? error.message : String(error));
}

const fallos = resultados.filter((resultado) => !resultado.ok);
console.log("");
console.log(
  fallos.length === 0
    ? `Todo OK: ${resultados.length} verificaciones superadas en ${URL_BASE} (modo ${modo})`
    : `${fallos.length} de ${resultados.length} verificaciones fallaron`,
);
process.exit(fallos.length === 0 ? 0 : 1);
