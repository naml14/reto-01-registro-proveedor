/**
 * Backend: API HTTP y ciclo del agente (prompt -> modelo -> herramientas -> respuesta).
 *
 * Reglas del ciclo (PRD 6.3):
 *  CA1 tope de iteraciones por turno
 *  CA2 el modelo no afirma valores que no salieron de una herramienta
 *  CA3 confirmacion humana: el turno termina en pregunta y el front la resalta
 *  CA4 toda llamada queda en el historial visible y en out/log.jsonl
 *  CA5 un error se muestra en lenguaje claro y la sesion no muere
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { pideConfirmacion, resumirResultado } from "./domain/reglas.ts";
import type { DefinicionHerramienta, LlamadaRegistrada, Mensaje } from "./llm/adapter.ts";
import { crearAdaptador } from "./llm/fabrica.ts";
import { registroHerramientas } from "./tools/proveedor.ts";

const RAIZ = path.resolve(import.meta.dir, "..");
const MAX_ITERACIONES = Number.parseInt(process.env.MAX_ITERACIONES ?? "25", 10);
const MAX_TOKENS_SESION = Number.parseInt(process.env.MAX_TOKENS_SESION ?? "120000", 10);
const PUERTO = Number.parseInt(process.env.PORT ?? "3000", 10);
// 0.0.0.0 es obligatorio en contenedores: si el proceso escucha solo en
// localhost, el proxy del VPS no puede alcanzar la aplicacion.
const HOST = process.env.HOST ?? "0.0.0.0";

const promptSistema = await readFile(path.join(RAIZ, "agent", "prompt.md"), "utf8");
const adaptador = crearAdaptador(promptSistema, RAIZ);
const herramientas = registroHerramientas();
const definiciones: DefinicionHerramienta[] = herramientas.map((herramienta) => ({
  nombre: herramienta.nombre,
  descripcion: herramienta.descripcion,
  esquema: herramienta.jsonSchema,
}));

interface ToolCallVisible {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado: string;
  ok: boolean;
}

interface Sesion {
  id: string;
  mensajes: Mensaje[];
  toolCalls: ToolCallVisible[];
  tokensEstimados: number;
  creada: string;
}

const sesiones = new Map<string, Sesion>();

function obtenerSesion(id: string): Sesion {
  const existente = sesiones.get(id);
  if (existente !== undefined) return existente;
  const sesion: Sesion = {
    id,
    mensajes: [],
    toolCalls: [],
    tokensEstimados: 0,
    creada: new Date().toISOString(),
  };
  sesiones.set(id, sesion);
  return sesion;
}

function estimarTokens(mensajes: Mensaje[]): number {
  let caracteres = 0;
  for (const mensaje of mensajes) {
    caracteres += mensaje.contenido.length;
  }
  return Math.ceil(caracteres / 4);
}

function cabecerasCors(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

async function manejarChat(cuerpo: { sessionId?: string; message?: string }): Promise<Response> {
  const mensaje = (cuerpo.message ?? "").trim();
  if (mensaje === "") {
    return Response.json({ error: "Falta el mensaje" }, { status: 400, headers: cabecerasCors() });
  }

  const sessionId =
    (cuerpo.sessionId ?? "").trim() || `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sesion = obtenerSesion(sessionId);

  // Tope de gasto por sesion: nadie puede gastar la clave sin limite.
  if (sesion.tokensEstimados > MAX_TOKENS_SESION) {
    sesion.mensajes = [];
    sesion.toolCalls = [];
    sesion.tokensEstimados = 0;
    return Response.json(
      {
        reply:
          "Se alcanzo el tope de tokens de esta sesion y el historial se limpio. Empecemos de nuevo: indicame el caso a procesar.",
        toolCalls: [],
        needsConfirmation: false,
        sessionId,
      },
      { headers: cabecerasCors() },
    );
  }

  sesion.mensajes.push({ rol: "user", contenido: mensaje });

  const toolCalls: ToolCallVisible[] = [];
  const ctx = { directory: RAIZ, sessionId };
  let reply = "";
  let needsConfirmation = false;

  for (let iteracion = 0; iteracion < MAX_ITERACIONES; iteracion += 1) {
    let respuesta;
    try {
      respuesta = await adaptador.responder(sesion.mensajes, definiciones);
    } catch (error) {
      reply = `No pude consultar al proveedor del modelo: ${
        error instanceof Error ? error.message : "error desconocido"
      }. La sesion sigue viva, puedes reintentar.`;
      break;
    }

    if (respuesta.llamadas.length === 0) {
      reply = respuesta.texto;
      break;
    }

    const registradas: LlamadaRegistrada[] = [];
    const resultados: { nombre: string; id: string; contenido: string }[] = [];

    for (const [indice, llamada] of respuesta.llamadas.entries()) {
      const id = `call_${iteracion}_${indice}_${llamada.nombre}`;
      registradas.push({ nombre: llamada.nombre, argumentos: llamada.argumentos, id });

      const herramienta = herramientas.find((item) => item.nombre === llamada.nombre);
      let salida: string;

      if (herramienta === undefined) {
        salida = JSON.stringify({ ok: false, error: `Herramienta desconocida: ${llamada.nombre}` });
      } else {
        const validado = herramienta.objeto.safeParse(llamada.argumentos);
        if (!validado.success) {
          const detalle = validado.error.issues
            .map((issue) => `${issue.path.join(".") || "argumento"}: ${issue.message}`)
            .join("; ");
          salida = JSON.stringify({
            ok: false,
            error: `Argumentos invalidos para ${llamada.nombre}. ${detalle}`,
          });
        } else {
          try {
            salida = await herramienta.execute(validado.data as Record<string, unknown>, ctx);
          } catch (error) {
            salida = JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Error inesperado en la herramienta",
            });
          }
        }
      }

      const ok = salida.includes('"ok":true');
      toolCalls.push({
        nombre: llamada.nombre,
        argumentos: llamada.argumentos,
        resultado: resumirResultado(salida, 320),
        ok,
      });
      resultados.push({ nombre: llamada.nombre, id, contenido: salida });
    }

    sesion.mensajes.push({
      rol: "assistant",
      contenido: respuesta.texto,
      llamadas: registradas,
      bloquesCrudos: respuesta.bloquesCrudos,
    });
    for (const resultado of resultados) {
      sesion.mensajes.push({
        rol: "tool",
        contenido: resultado.contenido,
        nombre: resultado.nombre,
        id: resultado.id,
      });
    }
  }

  if (reply === "") {
    reply = `Alcance el tope de ${MAX_ITERACIONES} iteraciones del turno. Esto es lo que hay hasta ahora: ${toolCalls.length} llamadas a herramientas.`;
  }

  sesion.mensajes.push({ rol: "assistant", contenido: reply });
  sesion.toolCalls.push(...toolCalls);
  sesion.tokensEstimados = estimarTokens(sesion.mensajes);

  needsConfirmation =
    pideConfirmacion(reply) ||
    toolCalls.some((llamada) => llamada.resultado.toLowerCase().includes("requiere confirmacion"));

  return Response.json(
    { reply, toolCalls, needsConfirmation, sessionId, iteracionesUsadas: toolCalls.length },
    { headers: cabecerasCors() },
  );
}

const ESTATICOS: Record<string, { archivo: string; tipo: string }> = {
  "/": { archivo: "web/index.html", tipo: "text/html; charset=utf-8" },
  "/index.html": { archivo: "web/index.html", tipo: "text/html; charset=utf-8" },
  "/app.js": { archivo: "web/app.js", tipo: "text/javascript; charset=utf-8" },
  "/styles.css": { archivo: "web/styles.css", tipo: "text/css; charset=utf-8" },
};

const servidor = Bun.serve({
  hostname: HOST,
  port: PUERTO,
  async fetch(peticion: Request): Promise<Response> {
    const url = new URL(peticion.url);
    const ruta = url.pathname;

    if (peticion.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cabecerasCors() });
    }

    if (ruta === "/api/health") {
      return Response.json(
        { ok: true, provider: adaptador.id, model: adaptador.modelo, modo: adaptador.id },
        { headers: cabecerasCors() },
      );
    }

    if (peticion.method === "POST" && ruta === "/api/chat") {
      let cuerpo: { sessionId?: string; message?: string };
      try {
        cuerpo = (await peticion.json()) as { sessionId?: string; message?: string };
      } catch {
        return Response.json({ error: "Cuerpo JSON invalido" }, { status: 400, headers: cabecerasCors() });
      }
      return manejarChat(cuerpo);
    }

    if (peticion.method === "GET" && ruta.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(ruta.slice("/api/sessions/".length));
      const sesion = sesiones.get(id);
      if (sesion === undefined) {
        return Response.json({ error: "Sesion no encontrada" }, { status: 404, headers: cabecerasCors() });
      }
      return Response.json(
        {
          sessionId: sesion.id,
          creada: sesion.creada,
          mensajes: sesion.mensajes,
          toolCalls: sesion.toolCalls,
        },
        { headers: cabecerasCors() },
      );
    }

    const estatico = ESTATICOS[ruta];
    if (estatico !== undefined) {
      try {
        const contenido = await readFile(path.join(RAIZ, estatico.archivo));
        return new Response(contenido, { headers: { "content-type": estatico.tipo } });
      } catch {
        return new Response("No encontrado", { status: 404 });
      }
    }

    return new Response("No encontrado", { status: 404 });
  },
});

console.log(`Agente Registro como Proveedor escuchando en http://${HOST}:${servidor.port}`);
console.log(`Proveedor: ${adaptador.id} (modelo: ${adaptador.modelo})`);
if (adaptador.id === "guiado") {
  console.log(
    "Sin clave de proveedor en el entorno: se activo el modo determinista. Defina ANTHROPIC_API_KEY o OPENAI_API_KEY para usar el LLM.",
  );
}

// Cierre ordenado: en un contenedor Coolify el redeploy manda SIGTERM.
for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    console.log(`${senal} recibido, cerrando el servidor.`);
    void servidor.stop(true).then(() => process.exit(0));
  });
}
