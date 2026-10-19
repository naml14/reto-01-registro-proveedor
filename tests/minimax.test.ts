/**
 * Pruebas del adaptador de MiniMax y de la seleccion de proveedor.
 *
 * No se hace ninguna llamada de red: se verifica el request que se construiria
 * (endpoint, cabeceras de autenticacion, cuerpo y tool calling) contra lo que
 * documenta platform.minimax.io.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { construirPeticionAnthropic } from "../src/llm/anthropic.ts";
import { crearAdaptador } from "../src/llm/fabrica.ts";
import { AdaptadorMiniMax, BASE_URL_ANTHROPIC_MINIMAX } from "../src/llm/minimax.ts";
import type { DefinicionHerramienta, Mensaje } from "../src/llm/adapter.ts";

const HERRAMIENTAS: DefinicionHerramienta[] = [
  {
    nombre: "proveedor_leer_solicitud",
    descripcion: "Lee la solicitud de un caso.",
    esquema: {
      type: "object",
      properties: { caso: { type: "string", description: "Nombre del caso" } },
      required: ["caso"],
    },
  },
];

const MENSAJES: Mensaje[] = [{ rol: "user", contenido: "Procesa el caso ec-corp-andina" }];

describe("adaptador MiniMax", () => {
  test("usa el endpoint Anthropic-compatible recomendado por MiniMax", () => {
    const adaptador = new AdaptadorMiniMax("clave-de-prueba", "MiniMax-M3.1-Flash", "PROMPT");
    expect(adaptador.id).toBe("minimax");
    expect(adaptador.modelo).toBe("MiniMax-M3.1-Flash");
    expect(BASE_URL_ANTHROPIC_MINIMAX).toBe("https://api.minimax.io/anthropic");
  });

  test("la peticion va a /anthropic/v1/messages con la Subscription Key como Bearer", () => {
    const peticion = construirPeticionAnthropic({
      clave: "clave-de-prueba",
      urlBase: BASE_URL_ANTHROPIC_MINIMAX,
      modelo: "MiniMax-M3.1-Flash",
      promptSistema: "PROMPT",
      mensajes: MENSAJES,
      herramientas: HERRAMIENTAS,
      estiloAuth: "bearer",
    });

    expect(peticion.url).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(peticion.cabeceras["authorization"]).toBe("Bearer clave-de-prueba");
    expect(peticion.cabeceras["x-api-key"]).toBe("clave-de-prueba");
    expect(peticion.cabeceras["content-type"]).toBe("application/json");
  });

  test("el cuerpo lleva modelo, system prompt y las herramientas con input_schema", () => {
    const peticion = construirPeticionAnthropic({
      clave: "clave-de-prueba",
      urlBase: BASE_URL_ANTHROPIC_MINIMAX,
      modelo: "MiniMax-M3.1-Flash",
      promptSistema: "PROMPT",
      mensajes: MENSAJES,
      herramientas: HERRAMIENTAS,
      estiloAuth: "bearer",
    });

    const cuerpo = peticion.cuerpo as {
      model: string;
      system: string;
      max_tokens: number;
      tools: { name: string; description: string; input_schema: { type: string } }[];
    };

    expect(cuerpo.model).toBe("MiniMax-M3.1-Flash");
    expect(cuerpo.system).toBe("PROMPT");
    expect(cuerpo.max_tokens).toBe(4096);
    expect(cuerpo.tools).toHaveLength(1);
    expect(cuerpo.tools[0].name).toBe("proveedor_leer_solicitud");
    expect(cuerpo.tools[0].input_schema.type).toBe("object");
  });

  test("Anthropic real no recibe cabecera Authorization, solo x-api-key", () => {
    const peticion = construirPeticionAnthropic({
      clave: "clave-de-prueba",
      urlBase: "https://api.anthropic.com",
      modelo: "claude-sonnet-4-5",
      promptSistema: "PROMPT",
      mensajes: MENSAJES,
      herramientas: HERRAMIENTAS,
      estiloAuth: "x-api-key",
    });

    expect(peticion.url).toBe("https://api.anthropic.com/v1/messages");
    expect(peticion.cabeceras["authorization"]).toBeUndefined();
    expect(peticion.cabeceras["x-api-key"]).toBe("clave-de-prueba");
    expect(peticion.cabeceras["anthropic-version"]).toBe("2023-06-01");
  });
});

describe("seleccion de proveedor", () => {
  const originales = { ...process.env };

  afterEach(() => {
    process.env = { ...originales };
  });

  test("con MINIMAX_API_KEY el proveedor elegido es minimax", () => {
    process.env.LLM_PROVIDER = "minimax";
    process.env.MINIMAX_API_KEY = "clave-de-prueba";
    const adaptador = crearAdaptador("PROMPT", process.cwd());
    expect(adaptador.id).toBe("minimax");
    expect(adaptador.modelo).toBe("MiniMax-M3.1-Flash");
  });

  test("en modo auto, la Subscription Key de MiniMax tiene prioridad", () => {
    process.env.LLM_PROVIDER = "auto";
    process.env.MINIMAX_API_KEY = "clave-de-prueba";
    process.env.ANTHROPIC_API_KEY = "otra-clave";
    const adaptador = crearAdaptador("PROMPT", process.cwd());
    expect(adaptador.id).toBe("minimax");
  });

  test("sin ninguna credencial se activa el modo determinista", () => {
    process.env.LLM_PROVIDER = "auto";
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_SUBSCRIPTION_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const adaptador = crearAdaptador("PROMPT", process.cwd());
    expect(adaptador.id).toBe("guiado");
  });
});
