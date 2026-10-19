/**
 * Adaptador de proveedor LLM: interfaz propia del proyecto.
 * Cambiar de proveedor no debe tocar el ciclo del agente (PRD 6.1).
 */

/**
 * Id de una llamada a herramienta. Se usa el del proveedor cuando lo da
 * (obligatorio para que el resultado de la herramienta pueda associarse);
 * si no, se genera uno local estable.
 */
export function idDeLlamada(llamada: LlamadaHerramienta, iteracion: number, indice: number): string {
  if (typeof llamada.id === "string" && llamada.id !== "") return llamada.id;
  return `call_${iteracion}_${indice}_${llamada.nombre}`;
}

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
  /**
   * Id que asigno el proveedor a la llamada (tool_use / tool_call_id).
   * Es obligatorio reenviarlo tal cual en el resultado de la herramienta:
   * MiniMax responde "tool result's tool id(...) not found" si no coincide.
   */
  id?: string;
}

export interface RespuestaLLM {
  texto: string;
  llamadas: LlamadaHerramienta[];
  /**
   * Bloques de contenido tal como los devolvio el proveedor. Se reenvian sin
   * tocar en el turno siguiente: los modelos con razonamiento (thinking) exigen
   * que el bloque y su firma se devuelvan identicos.
   */
  bloquesCrudos?: unknown[];
}

export interface LlamadaRegistrada extends LlamadaHerramienta {
  id: string;
}

export type Mensaje =
  | { rol: "user"; contenido: string }
  | {
      rol: "assistant";
      contenido: string;
      llamadas?: LlamadaRegistrada[];
      bloquesCrudos?: unknown[];
    }
  | { rol: "tool"; contenido: string; nombre: string; id: string };

export interface AdaptadorLLM {
  readonly id: string;
  readonly modelo: string;
  responder(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>;
}
