/**
 * Capa de infraestructura: adaptador que implementa el puerto de generadores
 * de formularios sobre exceljs y pdfkit.
 */

import type { CampoPdf, CeldaPlantilla, GeneradorFormularios } from "../application/ports.ts";
import { generarPdf } from "./generador-pdf.ts";
import { generarXlsx } from "./generador-xlsx.ts";

export class GeneradorFormulariosAdapter implements GeneradorFormularios {
  async generarXlsx(
    destino: string,
    plantilla: CeldaPlantilla[],
    valoresPorEtiqueta: Map<string, string>,
  ): Promise<void> {
    await generarXlsx(destino, plantilla, valoresPorEtiqueta);
  }

  async generarPdf(destino: string, campos: CampoPdf[]): Promise<void> {
    await generarPdf(destino, campos);
  }
}
