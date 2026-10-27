/**
 * Capa de dominio: entidades y contratos de datos puros.
 * No depende de filesystem, red ni de ningun framework: solo tipos y reglas.
 */

/** Formatos que puede pedir el cliente para entregar el formulario. */
export type Formato = "xlsx" | "pdf" | "portal";

/** Resultado del cruce de un campo solicitado contra el maestro de datos. */
export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion";

/** Estado de disponibilidad y vigencia de un soporte requerido. */
export type EstadoSoporte = "presente" | "ausente" | "vencido";

/** Datos normalizados de la solicitud recibida por correo. */
export interface Solicitud {
  /** Identificador de la solicitud. */
  id: string;
  /** Remitente del correo que contiene la solicitud. */
  de: string;
  /** Destinatario del correo recibido. */
  para: string;
  /** Asunto original del correo. */
  asunto: string;
  /** Fecha de la solicitud, usada como referencia si no se configura otra. */
  fecha: string;
  /** Código del país al que corresponde el registro. */
  pais: string;
  /** Nombre del cliente solicitante. */
  cliente: string;
  /** Texto del correo de solicitud. */
  cuerpo: string;
  /** Formato de salida pedido por el cliente. */
  formato: Formato;
  /** Nombres de los archivos adjuntos asociados a la solicitud. */
  adjuntos: string[];
}

/** Campo pedido por el cliente, ya normalizado a la forma que consume el mapeo. */
export interface CampoPlantilla {
  /** Etiqueta del campo solicitada por el cliente. */
  etiqueta: string;
  /** Indica si la plantilla exige proporcionar el campo. */
  obligatorio: boolean;
  /** Solo para formato XLSX: hoja donde escribir la etiqueta y el valor. */
  hoja?: string;
  /** Solo para XLSX: coordenada de la celda de etiqueta. */
  celda_etiqueta?: string;
  /** Solo para XLSX: coordenada de la celda de valor. */
  celda_valor?: string;
}

/** Campo de la plantilla vinculado, o no, con una ruta del repositorio maestro. */
export interface CampoMapeado {
  /** Etiqueta solicitada por el cliente. */
  etiqueta: string;
  /** Clave o ruta resuelta en el maestro; null si no existe correspondencia. */
  clave_maestro: string | null;
  /** Clasificación del resultado del cruce. */
  estado: EstadoCampo;
  /** Valor tomado del repositorio maestro; null cuando no hay fuente. */
  valor: string | null;
  /** Ruta del dato en el maestro, conservada para trazabilidad (HU-2). */
  ruta_origen: string | null;
  /** Nivel de confianza asignado por la regla de mapeo. */
  confianza: number;
  /** Explicación legible cuando el campo necesita revisión. */
  nota?: string;
  /** Causa por la que no se encontró un valor. */
  motivo?: string;
}

/** Clasificación de todos los campos de una solicitud, agrupados por estado. */
export interface ResultadoMapeo {
  /** Campos con un valor disponible en la fuente maestra. */
  llenos: CampoMapeado[];
  /** Campos sin una fuente de datos resoluble. */
  faltantes: CampoMapeado[];
  /** Campos cuyo valor o equivalencia necesita revisión humana. */
  requiere_confirmacion: CampoMapeado[];
}

/** Contenido de un soporte leído desde el repositorio documental. */
export interface Soporte {
  /** Tipo documental normalizado. */
  tipo: string;
  /** Nombre del archivo fuente. */
  archivo: string;
  /** Fecha ISO de vencimiento; null indica vigencia indefinida. */
  vigencia_hasta: string | null;
  /** Código del país emisor. */
  pais_emisor: string;
  /** Descripción del contenido del soporte. */
  descripcion: string;
}

/** Resultado de comparar un soporte exigido con el índice y su fecha de vigencia. */
export interface SoporteEvaluado {
  /** Nombre del tipo solicitado en el caso. */
  tipo_exigido: string;
  /** Tipo del índice que satisfizo la solicitud; null si no se encontró. */
  tipo_resuelto: string | null;
  /** Disponibilidad y vigencia calculadas para la fecha de referencia. */
  estado: EstadoSoporte;
  /** Archivo fuente del soporte; null si está ausente. */
  archivo: string | null;
  /** Fecha de vencimiento del soporte; null indica que no vence. */
  vigencia_hasta: string | null;
  /** Descripción tomada del índice de soportes. */
  descripcion: string;
  /** Nota de resolución, por ejemplo, el alias aplicado. */
  nota?: string;
}

/** Entrada del índice maestro de soportes disponibles. */
export interface SoporteMaestro {
  /** Tipo documental usado para resolver los requisitos del caso. */
  tipo: string;
  /** Nombre de archivo relativo al repositorio de soportes. */
  archivo: string;
  /** Fecha ISO de vencimiento; null indica que no vence. */
  vigencia_hasta: string | null;
  /** Código del país emisor del documento. */
  pais_emisor: string;
  /** Descripción legible del soporte. */
  descripcion: string;
}

/** Estado final del paquete, incluidos faltantes, confirmaciones y bloqueos. */
export interface ChecklistPaquete {
  /** Estado de cada soporte exigido. */
  soportes: SoporteEvaluado[];
  /** Campos sin valor de fuente; se informan, pero no bloquean por sí solos. */
  campos_faltantes: CampoMapeado[];
  /** Campos cuyo valor requiere revisión humana. */
  campos_por_confirmar: CampoMapeado[];
  /** Motivos por los que el paquete no puede pasar a firma. */
  bloqueos: string[];
  /** True solo cuando no hay soportes ausentes ni vencidos. */
  listo_para_firma: boolean;
}

/** Vista de la solicitud que consume el agente, sin datos internos no necesarios. */
export interface DatosSolicitud {
  /** Código del país para las reglas de identificación tributaria. */
  pais: string;
  /** Nombre del cliente que solicita el registro. */
  cliente: string;
  /** Formato de salida solicitado. */
  formato: Formato;
  /** Campos que deben completarse en la plantilla. */
  campos: CampoPlantilla[];
  /** Tipos de soporte requeridos para el caso. */
  soportes: string[];
}
