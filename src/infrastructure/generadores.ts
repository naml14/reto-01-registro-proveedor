/**
 * Capa de infraestructura: adaptador que implementa el puerto de generadores
 * de formularios sobre exceljs y pdfkit.
 */

import type { CampoPdf, CeldaPlantilla, GeneradorFormularios } from "../application/ports.ts";
import { generarPdf } from "./generador-pdf.ts";
import { generarXlsx } from "./generador-xlsx.ts";

/** Adapta las funciones concretas PDF y Excel al puerto de generación de formularios. */
export class GeneradorFormulariosAdapter implements GeneradorFormularios {
  /**
   * Delega la creación del libro a ExcelJS.
   * @param destino Ruta absoluta de salida.
   * @param plantilla Coordenadas de celdas indicadas por el caso.
   * @param valoresPorEtiqueta Valores disponibles para cada etiqueta.
   */
  async generarXlsx(
    destino: string,
    plantilla: CeldaPlantilla[],
    valoresPorEtiqueta: Map<string, string>,
  ): Promise<void> {
    await generarXlsx(destino, plantilla, valoresPorEtiqueta);
  }

  /**
   * Delega la creación del documento a PDFKit.
   * @param destino Ruta absoluta de salida.
   * @param campos Campos en el orden que se mostrarán.
   */
  async generarPdf(destino: string, campos: CampoPdf[]): Promise<void> {
    await generarPdf(destino, campos);
  }
}
