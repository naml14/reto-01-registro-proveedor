/**
 * Capa de infraestructura: generador de formularios Excel (P0).
 * Los fixtures no traen un .xlsx real, solo la coordenada de cada celda,
 * asi que el formulario se sintetiza respecting la plantilla al pie de la letra.
 */

import ExcelJS from "exceljs";

import type { CeldaPlantilla } from "../application/ports.ts";

export type { CeldaPlantilla };

/**
 * Escribe cada etiqueta y su valor exactamente en la hoja y celda indicadas.
 * Un campo sin fuente queda vacio: el agente nunca inventa valores.
 */
export async function generarXlsx(
  destino: string,
  plantilla: CeldaPlantilla[],
  valoresPorEtiqueta: Map<string, string>,
): Promise<void> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Reto 01 - Registro como Proveedor (Periferia IT Group)";
  // Fechas fijas: el archivo debe ser byte a byte identico entre ejecuciones.
  libro.created = new Date("2026-01-01T00:00:00Z");
  libro.modified = new Date("2026-01-01T00:00:00Z");

  const hojas = new Map<string, ExcelJS.Worksheet>();
  for (const celda of plantilla) {
    let hoja = hojas.get(celda.hoja);
    if (hoja === undefined) {
      hoja = libro.addWorksheet(celda.hoja);
      hoja.columns = [
        { width: 34 },
        { width: 46 },
        { width: 46 },
        { width: 22 },
      ];
      hojas.set(celda.hoja, hoja);
    }
  }

  for (const celda of plantilla) {
    const hoja = hojas.get(celda.hoja);
    if (hoja === undefined) continue;

    const celdaEtiqueta = hoja.getCell(celda.celda_etiqueta);
    celdaEtiqueta.value = celda.etiqueta;
    celdaEtiqueta.font = { bold: true };

    const celdaValor = hoja.getCell(celda.celda_valor);
    celdaValor.value = valoresPorEtiqueta.get(celda.etiqueta) ?? "";
    celdaValor.alignment = { wrapText: true, vertical: "top" };
  }

  await libro.xlsx.writeFile(destino);
}
