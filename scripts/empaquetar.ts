/**
 * Empaqueta la entrega: reto-01-<apellido>.zip sin node_modules/, sin out/ y sin .env.
 * Incluye el historial de commits (.git) para que el repositorio llegue completo.
 *
 *   bun run scripts/empaquetar.ts [nombre.zip]
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const RAIZ = path.resolve(import.meta.dir, "..");
const NOMBRE = process.argv[2] ?? "reto-01-nelson.zip";
const DESTINO = path.resolve(RAIZ, "..", NOMBRE);

const EXCLUIDOS = new Set(["node_modules", "out", ".env", ".DS_Store"]);

function excluido(relativo: string): boolean {
  const partes = relativo.split("/");
  if (partes.some((parte) => EXCLUIDOS.has(parte))) return true;
  const nombre = path.basename(relativo);
  if (nombre === ".env" || nombre.startsWith(".env.")) return true;
  if (nombre.endsWith(".zip")) return true;
  return false;
}

async function recolectar(base: string, carpeta: string): Promise<string[]> {
  const encontrados: string[] = [];
  const entradas = await readdir(path.join(base, carpeta), { withFileTypes: true });
  for (const entrada of entradas) {
    const relativo = carpeta === "" ? entrada.name : `${carpeta}/${entrada.name}`;
    if (excluido(relativo)) continue;
    if (entrada.isDirectory()) {
      encontrados.push(...(await recolectar(base, relativo)));
    } else if (entrada.isFile()) {
      encontrados.push(relativo);
    }
  }
  return encontrados;
}

const archivos = await recolectar(RAIZ, "");
const zip = new JSZip();

for (const relativo of archivos) {
  const contenido = await readFile(path.join(RAIZ, relativo));
  zip.file(`reto-01/${relativo}`, contenido);
}

const buffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
});

await writeFile(DESTINO, buffer);
const tamanho = (await stat(DESTINO)).size;
console.log(`${NOMBRE} generado en ${DESTINO} (${archivos.length} archivos, ${(tamanho / 1024).toFixed(0)} KB)`);
