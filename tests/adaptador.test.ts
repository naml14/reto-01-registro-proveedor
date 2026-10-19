/**
 * Pruebas de los adaptadores de proveedor.
 *
 * El camino de llamada real a la API (fetch) no se puede probar sin clave ni
 * red, pero la parte que mas se rompe en silencio -el formato del historial-
 * es pura y si queda cubierta aqui.
 */

import { describe, expect, test } from "bun:test";

import { aMensajesAnthropic, aMensajesOpenAI } from "../src/llm/mensajes.ts";
import { idDeLlamada } from "../src/llm/adapter.ts";
import type { Mensaje } from "../src/llm/adapter.ts";

const HISTORIAL: Mensaje[] = [
  { rol: "user", contenido: "Procesa el caso ec-corp-andina" },
  {
    rol: "assistant",
    contenido: "",
    llamadas: [{ id: "call_0", nombre: "proveedor_leer_solicitud", argumentos: { caso: "ec-corp-andina" } }],
  },
  { rol: "tool", contenido: '{"ok":true,"data":{}}', nombre: "proveedor_leer_solicitud", id: "call_0" },
  { rol: "assistant", contenido: "Listo. ¿Confirmas que simule el envio?" },
];

describe("adaptador Anthropic", () => {
  test("el id del proveedor se respeta en el emparejado de la herramienta", () => {
    // Si el id se regenera, el proveedor responde "tool result's tool id
    // (...) not found" y el ciclo se rompe en la segunda iteracion.
    expect(idDeLlamada({ nombre: "proveedor_leer_solicitud", argumentos: {}, id: "toolu_abc123" }, 0, 0)).toBe(
      "toolu_abc123",
    );
  });

  test("sin id del proveedor se genera uno local estable", () => {
    expect(idDeLlamada({ nombre: "proveedor_leer_solicitud", argumentos: {} }, 2, 1)).toBe(
      "call_2_1_proveedor_leer_solicitud",
    );
  });

  test("un mensaje de usuario va como bloque de texto", () => {
    const salida = aMensajesAnthropic([HISTORIAL[0]]);
    expect(salida).toEqual([
      { role: "user", content: [{ type: "text", text: "Procesa el caso ec-corp-andina" }] },
    ]);
  });

  test("una llamada del asistente va como tool_use con su id", () => {
    const salida = aMensajesAnthropic([HISTORIAL[1]]);
    const mensaje = salida[0] as { role: string; content: { type: string; id: string; name: string }[] };
    expect(mensaje.role).toBe("assistant");
    expect(mensaje.content[0].type).toBe("tool_use");
    expect(mensaje.content[0].id).toBe("call_0");
    expect(mensaje.content[0].name).toBe("proveedor_leer_solicitud");
  });

  test("un resultado de herramienta va como tool_result con el id de la llamada", () => {
    const salida = aMensajesAnthropic([HISTORIAL[2]]);
    const mensaje = salida[0] as { role: string; content: { type: string; tool_use_id: string }[] };
    expect(mensaje.role).toBe("user");
    expect(mensaje.content[0].type).toBe("tool_result");
    expect(mensaje.content[0].tool_use_id).toBe("call_0");
  });

  test("un mensaje de assistant sin texto no produce un bloque de texto vacio", () => {
    const salida = aMensajesAnthropic([HISTORIAL[1]]);
    const mensaje = salida[0] as { content: { type: string }[] };
    expect(mensaje.content.some((bloque) => bloque.type === "text")).toBe(false);
  });
});

describe("adaptador OpenAI", () => {
  test("el system prompt va primero y una sola vez", () => {
    const salida = aMensajesOpenAI(HISTORIAL, "PROMPT");
    expect(salida[0]).toEqual({ role: "system", content: "PROMPT" });
  });

  test("una llamada del asistente va como tool_calls con argumentos en JSON", () => {
    const salida = aMensajesOpenAI([HISTORIAL[1]], "PROMPT");
    const mensaje = salida[1] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    expect(mensaje.tool_calls[0].id).toBe("call_0");
    expect(mensaje.tool_calls[0].function.name).toBe("proveedor_leer_solicitud");
    expect(JSON.parse(mensaje.tool_calls[0].function.arguments)).toEqual({ caso: "ec-corp-andina" });
  });

  test("un resultado de herramienta lleva el tool_call_id", () => {
    const salida = aMensajesOpenAI([HISTORIAL[2]], "PROMPT");
    const mensaje = salida[1] as { role: string; tool_call_id: string };
    expect(mensaje.role).toBe("tool");
    expect(mensaje.tool_call_id).toBe("call_0");
  });
});
