/**
 * Capa de infraestructura: registro de ejecuciones en JSONL.
 * CA4: toda llamada a herramienta queda en out/log.jsonl.
 * RN5: toda ejecucion deja registro en out/<caso>/log.jsonl.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Registro JSONL de una ejecución de herramienta. */
export interface EntradaLog {
  /** Marca temporal ISO de la ejecución. */
  ts: string;
  /** Identificador del caso o null para operaciones globales. */
  caso: string | null;
  /** Nombre interno de la herramienta. */
  herramienta: string;
  /** Resultado booleano de la ejecución. */
  ok: boolean;
  /** Resumen breve, sin el contenido completo del resultado. */
  resumen: string;
}

/**
 * Añade una entrada a los logs global y, si hay caso, al log específico.
 * Los errores de logging se ignoran deliberadamente para no interrumpir la herramienta.
 *
 * @param raiz Raíz del proyecto.
 * @param caso Identificador del caso; al omitirse solo se escribe el log global.
 * @param herramienta Nombre de la herramienta ejecutada.
 * @param ok Indica si la ejecución terminó correctamente.
 * @param resumen Texto breve del resultado o del error.
 */
export async function registrarLog(
  raiz: string,
  caso: string | undefined,
  herramienta: string,
  ok: boolean,
  resumen: string,
): Promise<void> {
  const entrada: EntradaLog = {
    ts: new Date().toISOString(),
    caso: caso ?? null,
    herramienta,
    ok,
    resumen,
  };
  const linea = `${JSON.stringify(entrada)}\n`;

  const destinos = [path.join(raiz, "out", "log.jsonl")];
  if (caso !== undefined && caso !== "") {
    destinos.push(path.join(raiz, "out", caso, "log.jsonl"));
  }

  for (const destino of destinos) {
    try {
      await mkdir(path.dirname(destino), { recursive: true });
      await appendFile(destino, linea);
    } catch {
      // El log nunca debe tumbar la ejecucion de una herramienta.
    }
  }
}
