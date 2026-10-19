/**
 * Adaptador de proveedor LLM: interfaz propia del proyecto.
 * Cambiar de proveedor no debe tocar el ciclo del agente (PRD 6.1).
 */

export interface DefinicionHerramienta {
  /** Nombre visible para el modelo: proveedor_leer_solicitud, etc. */
  nombre: string;
  descripcion: string;
  /** JSON Schema de los argumentos. */
  esquema: Record<string, unknown>;
}

export interface LlamadaHerramienta {
  nombre: string;
  argumentos: Record<string, unknown>;
}

export interface RespuestaLLM {
  texto: string;
  llamadas: LlamadaHerramienta[];
}

export interface LlamadaRegistrada extends LlamadaHerramienta {
  id: string;
}

export type Mensaje =
  | { rol: "user"; contenido: string }
  | { rol: "assistant"; contenido: string; llamadas?: LlamadaRegistrada[] }
  | { rol: "tool"; contenido: string; nombre: string; id: string };

export interface AdaptadorLLM {
  readonly id: string;
  readonly modelo: string;
  responder(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>;
}
