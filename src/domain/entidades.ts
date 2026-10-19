/**
 * Capa de dominio: entidades y contratos de datos puros.
 * No depende de filesystem, red ni de ningun framework: solo tipos y reglas.
 */

export type Formato = "xlsx" | "pdf" | "portal";

export type EstadoCampo = "lleno" | "faltante" | "requiere_confirmacion";

export type EstadoSoporte = "presente" | "ausente" | "vencido";

export interface Solicitud {
  id: string;
  de: string;
  para: string;
  asunto: string;
  fecha: string;
  pais: string;
  cliente: string;
  cuerpo: string;
  formato: Formato;
  adjuntos: string[];
}

/** Campo pedido por el cliente, ya normalizado a la forma que consume el mapeo. */
export interface CampoPlantilla {
  etiqueta: string;
  obligatorio: boolean;
  /** Solo para formato xlsx: donde escribir la etiqueta y el valor. */
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

export interface CampoMapeado {
  etiqueta: string;
  clave_maestro: string | null;
  estado: EstadoCampo;
  /** Valor tomado del repositorio maestro. null cuando no hay fuente. */
  valor: string | null;
  /** Ruta del dato en el maestro (trazabilidad, HU-2). */
  ruta_origen: string | null;
  confianza: number;
  nota?: string;
  motivo?: string;
}

export interface ResultadoMapeo {
  llenos: CampoMapeado[];
  faltantes: CampoMapeado[];
  requiere_confirmacion: CampoMapeado[];
}

export interface Soporte {
  tipo: string;
  archivo: string;
  vigencia_hasta: string | null;
  pais_emisor: string;
  descripcion: string;
}

export interface SoporteEvaluado {
  tipo_exigido: string;
  tipo_resuelto: string | null;
  estado: EstadoSoporte;
  archivo: string | null;
  vigencia_hasta: string | null;
  descripcion: string;
  nota?: string;
}

export interface SoporteMaestro {
  tipo: string;
  archivo: string;
  vigencia_hasta: string | null;
  pais_emisor: string;
  descripcion: string;
}

export interface ChecklistPaquete {
  soportes: SoporteEvaluado[];
  campos_faltantes: CampoMapeado[];
  campos_por_confirmar: CampoMapeado[];
  bloqueos: string[];
  listo_para_firma: boolean;
}

export interface DatosSolicitud {
  pais: string;
  cliente: string;
  formato: Formato;
  campos: CampoPlantilla[];
  soportes: string[];
}
