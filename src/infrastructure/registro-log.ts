/**
 * Capa de infraestructura: registro de ejecuciones en JSONL.
 * CA4: toda llamada a herramienta queda en out/log.jsonl.
 * RN5: toda ejecucion deja registro en out/<caso>/log.jsonl.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface EntradaLog {
  ts: string;
  caso: string | null;
  herramienta: string;
  ok: boolean;
  resumen: string;
}

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
