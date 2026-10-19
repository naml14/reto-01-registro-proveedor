/**
 * Traduccion de mensajes al formato de cada proveedor.
 *
 * Son funciones puras y sin estado: se pueden probar sin red y sin clave.
 * El ciclo del agente no depende de como cada proveedor formatea el historial.
 */

import type { Mensaje } from "./adapter.ts";

/** Formato Messages API de Anthropic. */
export function aMensajesAnthropic(mensajes: Mensaje[]): unknown[] {
  const salida: unknown[] = [];

  for (const mensaje of mensajes) {
    if (mensaje.rol === "user") {
      salida.push({ role: "user", content: [{ type: "text", text: mensaje.contenido }] });
      continue;
    }

    if (mensaje.rol === "assistant") {
      // Si el proveedor devolvio bloques crudos (texto, tool_use, thinking), se
      // reenvian tal cual: es lo que exigen los modelos con razonamiento.
      if (mensaje.bloquesCrudos !== undefined && mensaje.bloquesCrudos.length > 0) {
        salida.push({ role: "assistant", content: mensaje.bloquesCrudos });
        continue;
      }
      const contenido: unknown[] = [];
      if (mensaje.contenido.trim() !== "") {
        contenido.push({ type: "text", text: mensaje.contenido });
      }
      for (const llamada of mensaje.llamadas ?? []) {
        contenido.push({
          type: "tool_use",
          id: llamada.id,
          name: llamada.nombre,
          input: llamada.argumentos,
        });
      }
      if (contenido.length > 0) {
        salida.push({ role: "assistant", content: contenido });
      }
      continue;
    }

    salida.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: mensaje.id, content: mensaje.contenido }],
    });
  }

  return salida;
}

/** Formato Chat Completions de OpenAI y compatibles. */
export function aMensajesOpenAI(mensajes: Mensaje[], promptSistema: string): unknown[] {
  const salida: unknown[] = [{ role: "system", content: promptSistema }];

  for (const mensaje of mensajes) {
    if (mensaje.rol === "user") {
      salida.push({ role: "user", content: mensaje.contenido });
      continue;
    }

    if (mensaje.rol === "assistant") {
      if (mensaje.contenido.trim() !== "") {
        salida.push({ role: "assistant", content: mensaje.contenido });
      }
      for (const llamada of mensaje.llamadas ?? []) {
        salida.push({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: llamada.id,
              type: "function",
              function: { name: llamada.nombre, arguments: JSON.stringify(llamada.argumentos) },
            },
          ],
        });
      }
      continue;
    }

    salida.push({ role: "tool", tool_call_id: mensaje.id, content: mensaje.contenido });
  }

  return salida;
}
