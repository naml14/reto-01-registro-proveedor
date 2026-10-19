/**
 * Capa de dominio: normalizacion de texto y resolucion de rutas del maestro.
 * El maestro usa claves en snake_case y algunas rutas anidadas con punto
 * (por ejemplo "contacto_comercial.email" o "ingresos_ultimo_ano.valor").
 */

import type { SoporteMaestro } from "./entidades.ts";

/** Etiqueta del identificador tributario que cada pais espera (RN1). */
export const ETIQUETA_TRIBUTARIA_POR_PAIS: Record<string, string> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
};

/**
 * Normaliza para comparar etiquetas: sin acentos, minusculas, espacios colapsados.
 * Permite que "Razon social" del cliente resuelva contra "Razón social" del glosario.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Resuelve una ruta con puntos dentro del maestro. Devuelve undefined si no existe. */
export function resolverRuta(maestro: unknown, ruta: string): unknown {
  let actual: unknown = maestro;
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

/** Indice normalizado del glosario: etiqueta normalizada -> clave del maestro. */
export function indiceGlosario(glosario: Record<string, string>): Map<string, string> {
  const indice = new Map<string, string>();
  for (const [etiqueta, clave] of Object.entries(glosario)) {
    indice.set(normalizar(etiqueta), clave);
  }
  return indice;
}

/** Convierte un valor del maestro en el texto que se escribe en el formulario. */
export function formatearValor(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (valor === null || valor === undefined) return "";
  return JSON.stringify(valor);
}

/** Compara fechas ISO (YYYY-MM-DD) de forma lexicografica, que es equivalente a cronologica. */
export function fechaEsVencida(vigenciaHasta: string | null, fechaReferencia: string): boolean {
  if (vigenciaHasta === null || vigenciaHasta.trim() === "") return false;
  return vigenciaHasta < fechaReferencia;
}

/** Indice de soportes por tipo normalizado. */
export function indiceSoportes(soportes: SoporteMaestro[]): Map<string, SoporteMaestro> {
  const indice = new Map<string, SoporteMaestro>();
  for (const soporte of soportes) {
    indice.set(soporte.tipo.toLowerCase().trim(), soporte);
  }
  return indice;
}
