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

export interface PeticionAnthropic {
  url: string;
  cabeceras: Record<string, string>;
  cuerpo: Record<string, unknown>;
}

/**
 * Construye la peticion al endpoint compatible con Anthropic.
 * Es una funcion pura: se puede probar sin red y sin credencial real.
 */
export function construirPeticionAnthropic(params: {
  clave: string;
  urlBase: string;
  modelo: string;
  promptSistema: string;
  mensajes: Mensaje[];
  herramientas: DefinicionHerramienta[];
  estiloAuth: "x-api-key" | "bearer";
}): PeticionAnthropic {
  const cabeceras: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": params.clave,
    "anthropic-version": "2023-06-01",
  };
  // MiniMax acepta ambos y da precedencia a Authorization; Anthropic solo usa x-api-key.
  if (params.estiloAuth === "bearer") {
    cabeceras["authorization"] = `Bearer ${params.clave}`;
  }

  return {
    url: `${params.urlBase}/v1/messages`,
    cabeceras,
    cuerpo: {
      model: params.modelo,
      max_tokens: 4096,
      system: params.promptSistema,
      messages: aMensajesAnthropic(params.mensajes),
      tools: params.herramientas.map((herramienta) => ({
        name: herramienta.nombre,
        description: herramienta.descripcion,
        input_schema: herramienta.esquema,
      })),
    },
  };
}

export class AdaptadorAnthropic implements AdaptadorLLM {
  readonly id: string;
  readonly modelo: string;

  constructor(
    private readonly clave: string,
    modelo: string,
    private readonly promptSistema: string,
    private readonly urlBase = "https://api.anthropic.com",
    id = "anthropic",
    private readonly estiloAuth: "x-api-key" | "bearer" = "x-api-key",
  ) {
    this.id = id;
    this.modelo = modelo;
  }

  private aMensajes(mensajes: Mensaje[]): unknown[] {
    return aMensajesAnthropic(mensajes);
  }

  async responder(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const peticion = construirPeticionAnthropic({
      clave: this.clave,
      urlBase: this.urlBase,
      modelo: this.modelo,
      promptSistema: this.promptSistema,
      mensajes,
      herramientas,
      estiloAuth: this.estiloAuth,
    });

    const respuesta = await fetch(peticion.url, {
      method: "POST",
      headers: peticion.cabeceras,
      body: JSON.stringify(peticion.cuerpo),
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

    return { texto, llamadas, bloquesCrudos: datos.content ?? [] };
  }
}
