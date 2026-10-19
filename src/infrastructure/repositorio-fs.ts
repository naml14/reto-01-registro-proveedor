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

export class RepositorioFS implements RepositorioProveedor {
  readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = raiz;
  }

  private absoluta(relativa: string): string {
    return path.join(this.raiz, relativa);
  }

  private validarCaso(caso: string): string {
    if (!PATRON_CASO.test(caso)) {
      throw new Error(`Caso inexistente: "${caso}". Use el nombre de una carpeta de fixtures/reto-01/casos/.`);
    }
    return caso;
  }

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

  async leerSolicitud(caso: string): Promise<Solicitud> {
    const id = this.validarCaso(caso);
    return this.leerJSON<Solicitud>(`${BASE_CASOS}/${id}/solicitud.json`);
  }

  async leerPlantillaCeldas(caso: string): Promise<CeldaPlantilla[]> {
    const id = this.validarCaso(caso);
    return this.leerJSON<CeldaPlantilla[]>(`${BASE_CASOS}/${id}/plantilla-celdas.json`);
  }

  async leerPlantillaCampos(caso: string): Promise<{ etiqueta: string; obligatorio: boolean }[]> {
    const id = this.validarCaso(caso);
    return this.leerJSON(`${BASE_CASOS}/${id}/plantilla-campos.json`);
  }

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

  async leerSoportesExigidos(caso: string): Promise<string[]> {
    const id = this.validarCaso(caso);
    return this.leerJSON<string[]>(`${BASE_CASOS}/${id}/soportes-exigidos.json`);
  }

  async leerMaestro(): Promise<Record<string, unknown>> {
    return this.leerJSON<Record<string, unknown>>(`${BASE_REPOSITORIO}/maestro.json`);
  }

  async leerGlosario(): Promise<Record<string, string>> {
    return this.leerJSON<Record<string, string>>("fixtures/reto-01/glosario-campos.json");
  }

  async leerIndiceSoportes(): Promise<SoporteMaestro[]> {
    return this.leerJSON<SoporteMaestro[]>(`${BASE_REPOSITORIO}/soportes/index.json`);
  }

  async leerSoporte(archivo: string): Promise<string | null> {
    try {
      return await readFile(this.absoluta(`${BASE_REPOSITORIO}/soportes/${archivo}`), "utf8");
    } catch {
      return null;
    }
  }

  rutaAbsoluta(relativa: string): string {
    return this.absoluta(relativa);
  }

  async escribir(relativa: string, contenido: string | Uint8Array): Promise<string> {
    const destino = this.absoluta(relativa);
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, contenido);
    return destino;
  }

  async copiar(origenRelativo: string, destinoRelativo: string): Promise<string> {
    const origen = this.absoluta(origenRelativo);
    const destino = this.absoluta(destinoRelativo);
    await mkdir(path.dirname(destino), { recursive: true });
    await copyFile(origen, destino);
    return destino;
  }

  async limpiarOut(): Promise<void> {
    const destino = this.absoluta("out");
    await rm(destino, { recursive: true, force: true });
    await mkdir(destino, { recursive: true });
  }
}
