/**
 * Capa de infraestructura: generador de formularios PDF (P1).
 * El PRD acepta un PDF generado (no un AcroForm) que reproduzca todos los
 * campos con etiqueta y valor en el orden dado por la plantilla.
 */

import { writeFile } from "node:fs/promises";
import PDFDocument from "pdfkit";

import type { CampoPdf } from "../application/ports.ts";

export type { CampoPdf };

export async function generarPdf(destino: string, campos: CampoPdf[]): Promise<void> {
  // Fechas fijas en la metadata: el PDF debe ser identico entre ejecuciones.
  const documento = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: "Formulario de registro como proveedor",
      Author: "Reto 01 - Periferia IT Group",
      Creator: "Agente conversacional Registro como Proveedor",
      Producer: "pdfkit",
      CreationDate: new Date("2026-01-01T00:00:00Z"),
      ModDate: new Date("2026-01-01T00:00:00Z"),
    },
  });
  const trozos: Buffer[] = [];

  documento.on("data", (trozo: Buffer) => {
    trozos.push(trozo);
  });
  const terminado = new Promise<void>((resolver, rechazar) => {
    documento.on("end", () => resolver());
    documento.on("error", (error: Error) => rechazar(error));
  });

  documento.fontSize(14).text("Formulario de registro como proveedor", { align: "left" });
  documento.moveDown(0.4);
  documento
    .fontSize(8)
    .fillColor("#555555")
    .text("Generado por el agente conversacional - Reto 01 Periferia IT Group. Documento sin firma: requiere la firma del representante legal.");
  documento.moveDown(1);

  for (const campo of campos) {
    if (documento.y > 690) {
      documento.addPage();
    }
    documento.fontSize(10).fillColor("#222222").text(campo.etiqueta, { width: 480 });
    documento.fontSize(10).fillColor("#000000").text(campo.valor ?? "-", { width: 480 });
    documento.moveDown(0.3);
  }

  documento.end();
  await terminado;
  await writeFile(destino, Buffer.concat(trozos));
}
