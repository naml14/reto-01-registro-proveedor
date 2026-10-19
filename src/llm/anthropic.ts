/**
 * Adaptador de Anthropic (Messages API).
 * Solo se usa la clave del backend, leida de variable de entorno.
 */

import type { AdaptadorLLM, DefinicionHerramienta, LlamadaHerramienta, Mensaje, RespuestaLLM } from "./adapter.ts";
import { aMensajesAnthropic } from "./mensajes.ts";

interface BloqueAnthropic {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export class AdaptadorAnthropic implements AdaptadorLLM {
  readonly id = "anthropic";
  readonly modelo: string;

  constructor(
    private readonly clave: string,
    modelo: string,
    private readonly promptSistema: string,
  ) {
    this.modelo = modelo;
  }

  private aMensajes(mensajes: Mensaje[]): unknown[] {
    return aMensajesAnthropic(mensajes);
  }

  async responder(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const cuerpo = {
      model: this.modelo,
      max_tokens: 4096,
      system: this.promptSistema,
      messages: this.aMensajes(mensajes),
      tools: herramientas.map((herramienta) => ({
        name: herramienta.nombre,
        description: herramienta.descripcion,
        input_schema: herramienta.esquema,
      })),
    };

    const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.clave,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(cuerpo),
    });

    if (!respuesta.ok) {
      const detalle = (await respuesta.text()).slice(0, 300);
      throw new Error(`El proveedor anthropic respondio ${respuesta.status}: ${detalle}`);
    }

    const datos = (await respuesta.json()) as { content?: BloqueAnthropic[] };
    let texto = "";
    const llamadas: LlamadaHerramienta[] = [];

    for (const bloque of datos.content ?? []) {
      if (bloque.type === "text" && typeof bloque.text === "string") {
        texto += bloque.text;
      }
      if (bloque.type === "tool_use" && typeof bloque.name === "string") {
        const entrada = bloque.input;
        llamadas.push({
          nombre: bloque.name,
          argumentos:
            entrada !== null && typeof entrada === "object"
              ? (entrada as Record<string, unknown>)
              : {},
        });
      }
    }

    return { texto, llamadas };
  }
}
