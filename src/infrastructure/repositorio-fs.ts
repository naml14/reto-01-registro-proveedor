/**
 * Capa de infraestructura: implementacion del puerto de repositorio sobre el
 * sistema de archivos local. Es el unico lugar donde se conocen rutas fisicas.
 */

import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CampoPlantilla, Formato, Solicitud, SoporteMaestro } from "../domain/entidades.ts";
import type { CeldaPlantilla, RepositorioProveedor } from "../application/ports.ts";

const BASE_CASOS = "fixtures/reto-01/casos";
const BASE_REPOSITORIO = "fixtures/reto-01/repositorio";
const PATRON_CASO = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Implementa el repositorio del proceso sobre archivos locales y fixtures JSON.
 * Centraliza la resolución de rutas y las operaciones de lectura y escritura.
 */
export class RepositorioFS implements RepositorioProveedor {
  readonly raiz: string;

  /** @param raiz Directorio raíz del proyecto que contiene `fixtures/` y `out/`. */
  constructor(raiz: string) {
    this.raiz = raiz;
  }

  /** Resuelve una ruta relativa bajo la raíz configurada. */
  private absoluta(relativa: string): string {
    return path.join(this.raiz, relativa);
  }

  /** Valida el formato del identificador del caso antes de formar rutas de fixtures. */
  private validarCaso(caso: string): string {
    if (!PATRON_CASO.test(caso)) {
      throw new Error(`Caso inexistente: "${caso}". Use el nombre de una carpeta de fixtures/reto-01/casos/.`);
    }
    return caso;
  }

  /** Lee y parsea JSON; el genérico es una aserción y no valida el esquema en runtime. */
  private async leerJSON<T>(relativa: string): Promise<T> {
    const ruta = this.absoluta(relativa);
    try {
      const contenido = await readFile(ruta, "utf8");
      return JSON.parse(contenido) as T;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo leer ${relativa}: ${mensaje}`);
    }
  }

  /**
   * Lista los directorios de caso en orden alfabético.
   * @returns Nombres de carpetas bajo `fixtures/reto-01/casos`.
   * @throws Error si la carpeta no puede leerse.
   */
  async listarCasos(): Promise<string[]> {
    try {
      const entradas = await readdir(this.absoluta(BASE_CASOS), { withFileTypes: true });
      return entradas
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => entrada.name)
        .sort();
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      throw new Error(`No se pudo leer la carpeta de casos: ${mensaje}`);
    }
  }

  /** @param caso Identificador validado del caso. @returns Solicitud parseada desde `solicitud.json`. */
  async leerSolicitud(caso: string): Promise<Solicitud> {
    const id = this.validarCaso(caso);
    return this.leerJSON<Solicitud>(`${BASE_CASOS}/${id}/solicitud.json`);
  }

  /** @param caso Identificador validado del caso. @returns Coordenadas de la plantilla Excel. */
  async leerPlantillaCeldas(caso: string): Promise<CeldaPlantilla[]> {
    const id = this.validarCaso(caso);
    return this.leerJSON<CeldaPlantilla[]>(`${BASE_CASOS}/${id}/plantilla-celdas.json`);
  }

  /** @param caso Identificador validado del caso. @returns Campos definidos para plantillas PDF o portal. */
  async leerPlantillaCampos(caso: string): Promise<{ etiqueta: string; obligatorio: boolean }[]> {
    const id = this.validarCaso(caso);
    return this.leerJSON(`${BASE_CASOS}/${id}/plantilla-campos.json`);
  }

  /**
   * Normaliza la plantilla pedida a `CampoPlantilla` según el formato.
   * Para Excel marca cada celda como obligatoria; en los demás formatos conserva el indicador de la plantilla.
   * @param caso Identificador del caso.
   * @param formato Formato de salida solicitado.
   * @returns Campos en el orden de la plantilla.
   */
  async leerCampos(caso: string, formato: Formato): Promise<CampoPlantilla[]> {
    if (formato === "xlsx") {
      const celdas = await this.leerPlantillaCeldas(caso);
      return celdas.map((celda) => ({
        etiqueta: celda.etiqueta,
        obligatorio: true,
        hoja: celda.hoja,
        celda_etiqueta: celda.celda_etiqueta,
        celda_valor: celda.celda_valor,
      }));
    }
    const campos = await this.leerPlantillaCampos(caso);
    return campos.map((campo) => ({ etiqueta: campo.etiqueta, obligatorio: campo.obligatorio }));
  }

  /** @param caso Identificador validado del caso. @returns Tipos de soporte requeridos. */
  async leerSoportesExigidos(caso: string): Promise<string[]> {
    const id = this.validarCaso(caso);
    return this.leerJSON<string[]>(`${BASE_CASOS}/${id}/soportes-exigidos.json`);
  }

  /** @returns Datos parseados del maestro de proveedores. */
  async leerMaestro(): Promise<Record<string, unknown>> {
    return this.leerJSON<Record<string, unknown>>(`${BASE_REPOSITORIO}/maestro.json`);
  }

  /** @returns Equivalencias entre etiquetas de campo y rutas del maestro. */
  async leerGlosario(): Promise<Record<string, string>> {
    return this.leerJSON<Record<string, string>>("fixtures/reto-01/glosario-campos.json");
  }

  /** @returns Índice de soportes y fechas de vigencia disponibles. */
  async leerIndiceSoportes(): Promise<SoporteMaestro[]> {
    return this.leerJSON<SoporteMaestro[]>(`${BASE_REPOSITORIO}/soportes/index.json`);
  }

  /**
   * Lee el contenido de un soporte referenciado por su nombre en el índice.
   * @param archivo Nombre tomado del índice; este método no valida segmentos de ruta.
   * @returns Texto del soporte o `null` ante cualquier error de lectura.
   * @remarks El llamador debe proporcionar un nombre confiable del índice local.
   */
  async leerSoporte(archivo: string): Promise<string | null> {
    try {
      return await readFile(this.absoluta(`${BASE_REPOSITORIO}/soportes/${archivo}`), "utf8");
    } catch {
      return null;
    }
  }

  /** @param relativa Ruta relativa al proyecto. @returns Ruta absoluta resuelta desde `raiz`. */
  rutaAbsoluta(relativa: string): string {
    return this.absoluta(relativa);
  }

  /**
   * Crea los directorios padre y escribe el contenido indicado.
   * @param relativa Destino relativo al proyecto.
   * @param contenido Texto o bytes por escribir.
   * @returns Ruta absoluta del archivo creado.
   */
  async escribir(relativa: string, contenido: string | Uint8Array): Promise<string> {
    const destino = this.absoluta(relativa);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, contenido);
    return destino;
  }

  /**
   * Copia un archivo dentro del proyecto y crea el directorio de destino.
   * @param origenRelativo Ruta relativa del archivo de origen.
   * @param destinoRelativo Ruta relativa del archivo de destino.
   * @returns Ruta absoluta del destino.
   */
  async copiar(origenRelativo: string, destinoRelativo: string): Promise<string> {
    const origen = this.absoluta(origenRelativo);
    const destino = this.absoluta(destinoRelativo);
    await mkdir(path.dirname(destino), { recursive: true });
    await copyFile(origen, destino);
    return destino;
  }

  /** Elimina recursivamente `out/` y lo recrea vacío; borra sus archivos existentes. */
  async limpiarOut(): Promise<void> {
    const destino = this.absoluta("out");
    await rm(destino, { recursive: true, force: true });
    await mkdir(destino, { recursive: true });
  }
}
