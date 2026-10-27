/**
 * Adaptador de Anthropic (Messages API).
 * Solo se usa la clave del backend, leida de variable de entorno.
 */

import type { AdaptadorLLM, DefinicionHerramienta, LlamadaHerramienta, Mensaje, RespuestaLLM } from "./adapter.ts";
import { aMensajesAnthropic } from "./mensajes.ts";

/** Fragmento relevante de la respuesta Messages API consumido por este adaptador. */
interface BloqueAnthropic {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** Solicitud HTTP construida en forma pura para el endpoint compatible con Anthropic. */
export interface PeticionAnthropic {
  /** Endpoint de Messages API. */
  url: string;
  /** Cabeceras HTTP, incluida la autenticación configurada. */
  cabeceras: Record<string, string>;
  /** Cuerpo serializable que se envía al proveedor. */
  cuerpo: Record<string, unknown>;
}

/**
 * Construye la petición al endpoint compatible con Anthropic.
 * Es una función pura: se puede probar sin red ni credencial real.
 *
 * @param params Credenciales, destino, modelo, contexto, mensajes y herramientas.
 * @param params.clave Clave que se usa en la cabecera de autenticación.
 * @param params.urlBase URL base del proveedor, sin el sufijo `/v1/messages`.
 * @param params.modelo Identificador del modelo.
 * @param params.promptSistema Instrucciones del sistema.
 * @param params.mensajes Historial normalizado de la conversación.
 * @param params.herramientas Herramientas y esquemas que se exponen al modelo.
 * @param params.estiloAuth Selecciona `x-api-key` o autenticación Bearer.
 * @returns URL, cabeceras y cuerpo listos para `fetch`.
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

/** Adapta Messages API de Anthropic y endpoints compatibles al contrato interno del agente. */
export class AdaptadorAnthropic implements AdaptadorLLM {
  /** Identificador del proveedor usado en mensajes de error y salud del backend. */
  readonly id: string;
  /** Modelo seleccionado para las solicitudes. */
  readonly modelo: string;

  /**
   * @param clave Secreto usado solo en la solicitud HTTP; no debe registrarse en logs.
   * @param modelo Modelo solicitado al proveedor.
   * @param promptSistema Instrucciones del agente.
   * @param urlBase URL base del endpoint compatible.
   * @param id Identificador visible del proveedor.
   * @param estiloAuth Esquema de autenticación requerido por el endpoint.
   */
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

  /** Convierte el historial al formato Messages API. */
  private aMensajes(mensajes: Mensaje[]): unknown[] {
    return aMensajesAnthropic(mensajes);
  }

  /**
   * Envía una solicitud y normaliza texto, tool calls y bloques originales de Anthropic.
   * @param mensajes Historial de la conversación.
   * @param herramientas Herramientas disponibles.
   * @returns Respuesta neutral para el ciclo del agente.
   * @throws Error si el endpoint responde fuera de 2xx o falla la petición.
   */
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
      throw new Error(`El proveedor ${this.id} respondio ${respuesta.status}: ${detalle}`);
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
          // El id del proveedor se reenvia tal cual: es lo que permite
          // emparejar el tool_result con su tool_use.
          id: typeof bloque.id === "string" ? bloque.id : undefined,
        });
      }
    }

    return { texto, llamadas, bloquesCrudos: datos.content ?? [] };
  }
}
