/**
 * Adaptador compatible con la API de chat de OpenAI (tambien sirve para
 * proveedores compatibles: Groq, Together, OpenRouter, LM Studio).
 * Solo se usa la clave del backend, leida de variable de entorno.
 */

import type { AdaptadorLLM, DefinicionHerramienta, LlamadaHerramienta, Mensaje, RespuestaLLM } from "./adapter.ts";

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
    const salida: unknown[] = [{ role: "system", content: this.promptSistema }];
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
      llamadas.push({ nombre, argumentos });
    }

    return { texto, llamadas };
  }
}
