/**
 * Capa de dominio: normalizacion de texto y resolucion de rutas del maestro.
 * El maestro usa claves en snake_case y algunas rutas anidadas con punto
 * (por ejemplo "contacto_comercial.email" o "ingresos_ultimo_ano.valor").
 */

import type { SoporteMaestro } from "./entidades.ts";

/** Etiqueta del identificador tributario que espera cada país según RN1. */
export const ETIQUETA_TRIBUTARIA_POR_PAIS: Record<string, string> = {
  CO: "NIT",
  EC: "RUC",
  PE: "RUC",
  PA: "RUC",
  HN: "RTN",
};

/**
 * Normaliza texto para comparar etiquetas: elimina diacríticos, convierte a minúsculas y colapsa espacios.
 *
 * @param texto Texto de origen.
 * @returns Texto normalizado para búsquedas en el glosario.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resuelve una ruta con puntos dentro del maestro sin asumir la forma de sus valores.
 *
 * @param maestro Objeto raíz del repositorio maestro.
 * @param ruta Ruta separada por puntos, por ejemplo `contacto.email`.
 * @returns El valor encontrado o `undefined` si una parte no existe o no es un objeto.
 */
export function resolverRuta(maestro: unknown, ruta: string): unknown {
  let actual: unknown = maestro;
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

/**
 * Construye un índice normalizado del glosario: etiqueta normalizada → clave del maestro.
 *
 * @param glosario Mapeo de etiquetas originales a claves o rutas del maestro.
 * @returns Índice consultable con la forma normalizada de cada etiqueta.
 */
export function indiceGlosario(glosario: Record<string, string>): Map<string, string> {
  const indice = new Map<string, string>();
  for (const [etiqueta, clave] of Object.entries(glosario)) {
    indice.set(normalizar(etiqueta), clave);
  }
  return indice;
}

/**
 * Convierte un valor del maestro al texto que se escribe en el formulario.
 * Las cadenas se conservan, los escalares se convierten con `String` y los objetos se serializan como JSON.
 *
 * @param valor Valor obtenido del maestro.
 * @returns Representación textual del valor; los valores nulos o ausentes producen una cadena vacía.
 */
export function formatearValor(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (valor === null || valor === undefined) return "";
  return JSON.stringify(valor);
}

/**
 * Compara fechas ISO (`YYYY-MM-DD`) lexicográficamente, equivalente al orden cronológico para ese formato.
 *
 * @param vigenciaHasta Fecha de vencimiento; `null` o una cadena vacía significan que no vence.
 * @param fechaReferencia Fecha contra la que se evalúa la vigencia.
 * @returns `true` solo si la fecha de vencimiento precede a la fecha de referencia.
 */
export function fechaEsVencida(vigenciaHasta: string | null, fechaReferencia: string): boolean {
  if (vigenciaHasta === null || vigenciaHasta.trim() === "") return false;
  return vigenciaHasta < fechaReferencia;
}

/**
 * Indexa soportes por tipo, tras convertir el tipo a minúsculas y quitar espacios externos.
 * Si hay tipos duplicados, la última entrada reemplaza a las anteriores.
 *
 * @param soportes Entradas leídas del índice maestro.
 * @returns Mapa de tipo normalizado a soporte.
 */
export function indiceSoportes(soportes: SoporteMaestro[]): Map<string, SoporteMaestro> {
  const indice = new Map<string, SoporteMaestro>();
  for (const soporte of soportes) {
    indice.set(soporte.tipo.toLowerCase().trim(), soporte);
  }
  return indice;
}
