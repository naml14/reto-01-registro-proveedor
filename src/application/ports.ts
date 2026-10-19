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

export interface RepositorioProveedor {
  readonly raiz: string;
  listarCasos(): Promise<string[]>;
  leerSolicitud(caso: string): Promise<Solicitud>;
  leerPlantillaCeldas(caso: string): Promise<CeldaPlantilla[]>;
  leerPlantillaCampos(caso: string): Promise<{ etiqueta: string; obligatorio: boolean }[]>;
  leerCampos(caso: string, formato: Formato): Promise<CampoPlantilla[]>;
  leerSoportesExigidos(caso: string): Promise<string[]>;
  leerMaestro(): Promise<Record<string, unknown>>;
  leerGlosario(): Promise<Record<string, string>>;
  leerIndiceSoportes(): Promise<SoporteMaestro[]>;
  leerSoporte(archivo: string): Promise<string | null>;
  rutaAbsoluta(relativa: string): string;
  escribir(relativa: string, contenido: string | Uint8Array): Promise<string>;
  copiar(origenRelativo: string, destinoRelativo: string): Promise<string>;
  limpiarOut(): Promise<void>;
}

/** Salida de los formatos soportados: Excel (P0) y PDF (P1). */
export interface GeneradorFormularios {
  generarXlsx(
    destino: string,
    plantilla: CeldaPlantilla[],
    valoresPorEtiqueta: Map<string, string>,
  ): Promise<void>;
  generarPdf(destino: string, campos: CampoPdf[]): Promise<void>;
}
