/**
 * Verificacion de una instancia desplegada (o local) desde fuera.
 *
 *   bun run scripts/smoke-test.ts [url]
 *
 * Comprueba, en este orden: salud del backend, front, recursos estaticos,
 * ciclo completo del agente (procesar + confirmar + enviar) y consulta de la
 * sesion. Termina con codigo 0 si todo pasa y 1 si algo falla.
 *
 * Es el comando que hay que ejecutar despues de desplegar en el VPS: en menos
 * de un minuto dice si la URL de la defensa esta viva y completa.
 */

const URL_BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const CASO = "ec-corp-andina";

interface Resultado {
  nombre: string;
  ok: boolean;
  detalle: string;
}

const resultados: Resultado[] = [];

function registrar(nombre: string, ok: boolean, detalle: string): void {
  resultados.push({ nombre, ok, detalle });
  const marca = ok ? "OK  " : "FALLA";
  console.log(`[${marca}] ${nombre} - ${detalle}`);
}

async function peticion(ruta: string, opciones: RequestInit = {}): Promise<Response> {
  return fetch(`${URL_BASE}${ruta}`, { ...opciones, signal: AbortSignal.timeout(30_000) });
}

console.log(`Verificacion de ${URL_BASE}`);
console.log("");

// 1. Salud del backend
try {
  const respuesta = await peticion("/api/health");
  const datos = (await respuesta.json()) as { ok?: boolean; provider?: string; model?: string };
  const ok = respuesta.ok && datos.ok === true;
  registrar("salud del backend", ok, `proveedor=${datos.provider ?? "?"} modelo=${datos.model ?? "?"}`);
} catch (error) {
  registrar("salud del backend", false, `no respondio: ${error instanceof Error ? error.message : String(error)}`);
}

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

// 4. Ciclo del agente: procesar el caso
const sessionId = `smoke-${Date.now().toString(36)}`;
let pasoProcesar = false;
try {
  const respuesta = await peticion("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, message: `Procesa el caso "${CASO}"` }),
  });
  const datos = (await respuesta.json()) as {
    reply?: string;
    toolCalls?: { nombre: string }[];
    needsConfirmation?: boolean;
  };
  const llamadas = (datos.toolCalls ?? []).map((llamada) => llamada.nombre);
  const esperadas = [
    "proveedor_leer_solicitud",
    "proveedor_mapear_campos",
    "proveedor_generar_formulario",
    "proveedor_armar_paquete",
  ];
  const ok =
    respuesta.ok &&
    esperadas.every((nombre) => llamadas.includes(nombre)) &&
    datos.needsConfirmation === true &&
    (datos.reply ?? "").includes(CASO);
  pasoProcesar = ok;
  registrar("ciclo del agente (procesar)", ok, `llamadas=${llamadas.length} confirmacion=${datos.needsConfirmation}`);
} catch (error) {
  registrar("ciclo del agente (procesar)", false, error instanceof Error ? error.message : String(error));
}

// 5. Confirmacion humana: el envio simulado
if (pasoProcesar) {
  try {
    const respuesta = await peticion("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message: "si, envia el paquete" }),
    });
    const datos = (await respuesta.json()) as { toolCalls?: { nombre: string; argumentos: { confirmado?: boolean } }[] };
    const envio = (datos.toolCalls ?? []).find((llamada) => llamada.nombre === "proveedor_simular_envio");
    const ok = respuesta.ok && envio !== undefined && envio.argumentos.confirmado === true;
    registrar("confirmacion humana (envio simulado)", ok, envio ? "proveedor_simular_envio con confirmado=true" : "no se ejecuto el envio");
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
    ? `Todo OK: ${resultados.length} verificaciones superadas en ${URL_BASE}`
    : `${fallos.length} de ${resultados.length} verificaciones fallaron`,
);
process.exit(fallos.length === 0 ? 0 : 1);
