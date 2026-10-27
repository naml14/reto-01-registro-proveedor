/**
 * Capa de aplicacion: puertos (contratos) que implementa la infraestructura.
 * Los casos de uso dependen de estas interfaces, nunca de node:fs, exceljs o fetch.
 */

import type { CampoPlantilla, Formato, Solicitud, SoporteMaestro } from "../domain/entidades.ts";

/** Celda de la plantilla Excel: donde va la etiqueta y donde va el valor. */
export interface CeldaPlantilla {
  hoja: string;
  celda_etiqueta: string;
  etiqueta: string;
  celda_valor: string;
}

/** Campo del formulario PDF: etiqueta y valor (null = sin dato). */
export interface CampoPdf {
  etiqueta: string;
  valor: string | null;
}

/**
 * Puerto de acceso a casos y archivos del proceso; los casos de uso dependen de este contrato, no del filesystem.
 * Las operaciones de lectura estructurada rechazan ante errores de E/S o datos ilegibles.
 */
export interface RepositorioProveedor {
  /** Raíz desde la que se resuelven las rutas del proyecto. */
  readonly raiz: string;
  /** @returns Nombres ordenados de los directorios de casos disponibles. */
  listarCasos(): Promise<string[]>;
  /** @param caso Nombre del directorio del caso. @returns Solicitud normalizada. */
  leerSolicitud(caso: string): Promise<Solicitud>;
  /** @param caso Nombre del caso. @returns Coordenadas de etiquetas y valores para Excel. */
  leerPlantillaCeldas(caso: string): Promise<CeldaPlantilla[]>;
  /** @param caso Nombre del caso. @returns Campos y obligatoriedad definidos para PDF o portal. */
  leerPlantillaCampos(caso: string): Promise<{ etiqueta: string; obligatorio: boolean }[]>;
  /** @param caso Nombre del caso. @param formato Formato pedido. @returns Campos con metadatos de plantilla cuando aplican. */
  leerCampos(caso: string, formato: Formato): Promise<CampoPlantilla[]>;
  /** @param caso Nombre del caso. @returns Tipos de soporte que el caso exige. */
  leerSoportesExigidos(caso: string): Promise<string[]>;
  /** @returns Datos del repositorio maestro. */
  leerMaestro(): Promise<Record<string, unknown>>;
  /** @returns Equivalencias entre etiquetas solicitadas y rutas del maestro. */
  leerGlosario(): Promise<Record<string, string>>;
  /** @returns Índice de soportes disponibles y sus vigencias. */
  leerIndiceSoportes(): Promise<SoporteMaestro[]>;
  /**
   * Lee un soporte por nombre.
   * @param archivo Nombre relativo del archivo del soporte.
   * @returns Contenido o `null` cuando el archivo no puede leerse.
   */
  leerSoporte(archivo: string): Promise<string | null>;
  /** @param relativa Ruta relativa al proyecto. @returns Ruta física correspondiente. */
  rutaAbsoluta(relativa: string): string;
  /**
   * Crea directorios necesarios y escribe contenido en la ruta indicada.
   * @param relativa Destino relativo a la raíz.
   * @param contenido Texto o bytes por escribir.
   * @returns Ruta física escrita.
   */
  escribir(relativa: string, contenido: string | Uint8Array): Promise<string>;
  /**
   * Copia un archivo y crea el directorio de destino si hace falta.
   * @param origenRelativo Archivo de origen relativo a la raíz.
   * @param destinoRelativo Archivo de destino relativo a la raíz.
   * @returns Ruta física de destino.
   */
  copiar(origenRelativo: string, destinoRelativo: string): Promise<string>;
  /** Elimina todo el directorio `out` y lo recrea vacío. */
  limpiarOut(): Promise<void>;
}

/** Puerto para generar los formatos admitidos que producen un archivo descargable. */
export interface GeneradorFormularios {
  /** Escribe etiquetas y valores en las celdas exactas indicadas por la plantilla. */
  generarXlsx(
    destino: string,
    plantilla: CeldaPlantilla[],
    valoresPorEtiqueta: Map<string, string>,
  ): Promise<void>;
  /** Escribe en un PDF los campos en el orden recibido; los valores nulos se representan vacíos. */
  generarPdf(destino: string, campos: CampoPdf[]): Promise<void>;
}
