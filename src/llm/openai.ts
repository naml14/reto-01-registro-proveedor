/**
 * Adaptador compatible con la API de chat de OpenAI (tambien sirve para
 * proveedores compatibles: Groq, Together, OpenRouter, LM Studio).
 * Solo se usa la clave del backend, leida de variable de entorno.
 */

import type { AdaptadorLLM, DefinicionHerramienta, LlamadaHerramienta, Mensaje, RespuestaLLM } from "./adapter.ts";
import { aMensajesOpenAI } from "./mensajes.ts";

export class AdaptadorOpenAI implements AdaptadorLLM {
  readonly id = "openai";
  readonly modelo: string;

  constructor(
    private readonly clave: string,
    modelo: string,
    private readonly promptSistema: string,
    private readonly urlBase = "https://api.openai.com/v1",
  ) {
    this.modelo = modelo;
  }

  private aMensajes(mensajes: Mensaje[]): unknown[] {
    return aMensajesOpenAI(mensajes, this.promptSistema);
  }

  async responder(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const cuerpo = {
      model: this.modelo,
      messages: this.aMensajes(mensajes),
      tools: herramientas.map((herramienta) => ({
        type: "function",
        function: {
          name: herramienta.nombre,
          description: herramienta.descripcion,
          parameters: herramienta.esquema,
        },
      })),
      tool_choice: "auto",
    };

    const respuesta = await fetch(`${this.urlBase}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.clave}`,
      },
      body: JSON.stringify(cuerpo),
    });

    if (!respuesta.ok) {
      const detalle = (await respuesta.text()).slice(0, 300);
      throw new Error(`El proveedor openai respondio ${respuesta.status}: ${detalle}`);
    }

    const datos = (await respuesta.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: unknown[] } }[];
    };
    const mensaje = datos.choices?.[0]?.message;
    const texto = mensaje?.content ?? "";
    const llamadas: LlamadaHerramienta[] = [];

    for (const llamada of (mensaje?.tool_calls ?? []) as {
      id?: string;
      function?: { name?: string; arguments?: string };
    }[]) {
      const nombre = llamada.function?.name;
      if (typeof nombre !== "string") continue;
      let argumentos: Record<string, unknown> = {};
      try {
        const parseado = JSON.parse(llamada.function?.arguments ?? "{}") as unknown;
        if (parseado !== null && typeof parseado === "object") {
          argumentos = parseado as Record<string, unknown>;
        }
      } catch {
        argumentos = {};
      }
      llamadas.push({
        nombre,
        argumentos,
        id: typeof llamada.id === "string" ? llamada.id : undefined,
      });
    }

    return { texto, llamadas };
  }
}
