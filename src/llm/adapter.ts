/**
 * Adaptador de proveedor LLM: interfaz propia del proyecto.
 * Cambiar de proveedor no debe tocar el ciclo del agente (PRD 6.1).
 */

/**
 * Id de una llamada a herramienta. Se usa el del proveedor cuando lo da
 * (obligatorio para que el resultado de la herramienta pueda associarse);
 * si no, se genera uno local estable.
 */
/**
 * Devuelve el id del proveedor o construye un respaldo determinista para la llamada.
 * @param llamada Llamada de herramienta recibida.
 * @param iteracion Índice de iteración del ciclo del agente.
 * @param indice Posición de la llamada dentro de la respuesta actual.
 * @returns Id que debe reutilizarse al devolver el resultado al proveedor.
 */
export function idDeLlamada(llamada: LlamadaHerramienta, iteracion: number, indice: number): string {
  if (typeof llamada.id === "string" && llamada.id !== "") return llamada.id;
  return `call_${iteracion}_${indice}_${llamada.nombre}`;
}

/** Definición neutral de una herramienta que se envía a cualquier proveedor LLM. */
export interface DefinicionHerramienta {
  /** Nombre visible para el modelo: `proveedor_leer_solicitud`, etc. */
  nombre: string;
  /** Instrucción en lenguaje natural que explica cuándo usar la herramienta. */
  descripcion: string;
  /** JSON Schema de los argumentos aceptados. */
  esquema: Record<string, unknown>;
}

/** Invocación de herramienta solicitada por el modelo. */
export interface LlamadaHerramienta {
  /** Nombre de la herramienta solicitada por el modelo. */
  nombre: string;
  /** Argumentos sin validar recibidos del proveedor. */
  argumentos: Record<string, unknown>;
  /**
   * Id que asigno el proveedor a la llamada (tool_use / tool_call_id).
   * Es obligatorio reenviarlo tal cual en el resultado de la herramienta:
   * MiniMax responde "tool result's tool id(...) not found" si no coincide.
   */
  id?: string;
}

/** Respuesta normalizada que el ciclo del agente recibe de un adaptador. */
export interface RespuestaLLM {
  /** Texto que acompaña o concluye la respuesta. */
  texto: string;
  /** Invocaciones de herramienta pedidas por el modelo. */
  llamadas: LlamadaHerramienta[];
  /**
   * Bloques de contenido tal como los devolvio el proveedor. Se reenvian sin
   * tocar en el turno siguiente: los modelos con razonamiento (thinking) exigen
   * que el bloque y su firma se devuelvan identicos.
   */
  bloquesCrudos?: unknown[];
}

/** Llamada con un id garantizado para enlazarla con el resultado posterior. */
export interface LlamadaRegistrada extends LlamadaHerramienta {
  /** Id del proveedor o respaldo local que debe emparejarse con el resultado. */
  id: string;
}

/** Mensajes normalizados del historial, incluidos resultados de herramientas. */
export type Mensaje =
  | { rol: "user"; contenido: string }
  | {
      rol: "assistant";
      contenido: string;
      llamadas?: LlamadaRegistrada[];
      bloquesCrudos?: unknown[];
    }
  | { rol: "tool"; contenido: string; nombre: string; id: string };

/** Puerto común de los proveedores y del adaptador determinista local. */
export interface AdaptadorLLM {
  /** Identificador del proveedor o modo activo. */
  readonly id: string;
  /** Nombre del modelo reportado por el proveedor. */
  readonly modelo: string;
  /**
   * Envía el historial y el catálogo de herramientas al modelo.
   * @param mensajes Historial normalizado de la sesión.
   * @param herramientas Herramientas disponibles para invocación.
   * @returns Texto, llamadas y, si aplica, bloques originales que deben preservarse.
   * @throws Error si el proveedor rechaza la solicitud o la respuesta no puede procesarse.
   */
  responder(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>;
}
