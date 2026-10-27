/**
 * demo.ts - verificacion sin modelo (PRD 6.6).
 *
 * Ejecuta todos los casos de fixtures/reto-01/casos/ llamando DIRECTAMENTE a las
 * herramientas, sin consumir ningun modelo de lenguaje. Demuestra determinismo
 * y robustez: el mismo comando produce el mismo resultado en cada ejecucion.
 *
 *   bun install && bun run demo.ts
 */

import path from "node:path";

import { RepositorioFS } from "./src/infrastructure/repositorio-fs.ts";
import { registroHerramientas, type ContextoHerramienta } from "./src/tools/proveedor.ts";

const RAIZ = path.resolve(import.meta.dir);
const ctx: ContextoHerramienta = { directory: RAIZ, sessionId: "demo" };

const repositorio = new RepositorioFS(RAIZ);
await repositorio.limpiarOut();

const herramientas = new Map(registroHerramientas().map((herramienta) => [herramienta.nombre, herramienta]));

/** Envoltorio JSON devuelto por la ejecución directa de una herramienta. */
interface ResultadoHerramienta {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Ejecuta una herramienta registrada sin pasar por un modelo de lenguaje.
 * @param nombre Nombre visible de la herramienta registrada.
 * @param args Argumentos que se entregan a su validador y ejecutor.
 * @returns Resultado JSON parseado de la herramienta.
 * @throws Error si la herramienta no está registrada o devuelve JSON inválido.
 */
async function llamar(nombre: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const herramienta = herramientas.get(nombre);
  if (herramienta === undefined) {
    throw new Error(`Herramienta no registrada: ${nombre}`);
  }
  const salida = await herramienta.execute(args, ctx);
  return JSON.parse(salida) as ResultadoHerramienta;
}

/** Convierte un arreglo desconocido en una lista de cadenas para el reporte de consola. */
function lista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map((item) => String(item)) : [];
}

/** Imprime un encabezado de sección y su separador en la consola. */
function seccion(titulo: string): void {
  console.log("");
  console.log(titulo);
  console.log("-".repeat(titulo.length));
}

const casos = await repositorio.listarCasos();
console.log(`Verificacion del reto 01 - Registro como Proveedor`);
console.log(`Casos encontrados: ${casos.join(", ")}`);
console.log(`Salida en: out/ (se limpia al inicio)`);

const fallos: string[] = [];
const resumenCasos: {
  caso: string;
  pais: string;
  formato: string;
  llenos: number;
  confirmar: number;
  faltantes: number;
  listo: boolean;
  bloqueos: string[];
}[] = [];

for (const caso of casos) {
  seccion(`CASO ${caso}`);

  const solicitud = await llamar("proveedor_leer_solicitud", { caso });
  if (!solicitud.ok) {
    console.log(`  ERROR leyendo la solicitud: ${solicitud.error}`);
    fallos.push(`${caso}: leer_solicitud -> ${solicitud.error}`);
    continue;
  }
  const datos = solicitud.data ?? {};
  const campos = lista((datos.campos as { etiqueta?: string }[] | undefined)?.map((c) => c.etiqueta));
  const soportes = lista(datos.soportes);
  console.log(`  Pais: ${datos.pais} | Cliente: ${datos.cliente} | Formato: ${datos.formato}`);
  console.log(`  Campos solicitados: ${campos.length} | Soportes exigidos: ${soportes.length}`);

  const mapeo = await llamar("proveedor_mapear_campos", { caso, campos });
  if (!mapeo.ok) {
    console.log(`  ERROR mapeando campos: ${mapeo.error}`);
    fallos.push(`${caso}: mapear_campos -> ${mapeo.error}`);
    continue;
  }
  const datosMapeo = mapeo.data ?? {};
  const llenos = (datosMapeo.llenos as { etiqueta: string; valor: string; ruta_origen: string }[]) ?? [];
  const faltantes = (datosMapeo.faltantes as { etiqueta: string; motivo?: string }[]) ?? [];
  const confirmar = (datosMapeo.requiere_confirmacion as { etiqueta: string; nota?: string }[]) ?? [];

  console.log(`  Llenos: ${llenos.length} | Requieren confirmacion: ${confirmar.length} | Faltantes: ${faltantes.length}`);
  for (const campo of confirmar) {
    console.log(`    ? ${campo.etiqueta} - ${campo.nota ?? "revisar"}`);
  }
  for (const campo of faltantes) {
    console.log(`    - ${campo.etiqueta} - ${campo.motivo ?? "sin dato en el maestro"}`);
  }

  const formulario = await llamar("proveedor_generar_formulario", { caso });
  const rutaFormulario = String((formulario.data as { ruta?: string } | undefined)?.ruta ?? "");
  if (formulario.ok) {
    console.log(`  Formulario generado: ${rutaFormulario}`);
  } else {
    console.log(`  Formulario: ${formulario.error}`);
    if (!String(formulario.error).includes("formato no soportado")) {
      fallos.push(`${caso}: generar_formulario -> ${formulario.error}`);
    }
  }

  const paquete = await llamar("proveedor_armar_paquete", { caso });
  if (!paquete.ok) {
    console.log(`  ERROR armando el paquete: ${paquete.error}`);
    fallos.push(`${caso}: armar_paquete -> ${paquete.error}`);
    continue;
  }
  const datosPaquete = paquete.data ?? {};
  const checklist = (datosPaquete.checklist ?? {}) as {
    soportes?: { tipo_exigido: string; estado: string; vigencia_hasta: string | null }[];
    bloqueos?: string[];
    listo_para_firma?: boolean;
  };
  const bloqueos = checklist.bloqueos ?? [];
  const listo = datosPaquete.listo_para_firma === true;

  console.log(`  Paquete: ${String(datosPaquete.ruta)} (listo_para_firma: ${listo ? "si" : "no"})`);
  for (const soporte of checklist.soportes ?? []) {
    console.log(`    [${soporte.estado.padEnd(8)}] ${soporte.tipo_exigido} (vigencia: ${soporte.vigencia_hasta ?? "sin fecha"})`);
  }
  if (bloqueos.length > 0) {
    console.log(`  Bloqueos: ${bloqueos.join(" | ")}`);
  }

  // RN4: el envio se rechaza sin confirmacion explicita.
  const envio = await llamar("proveedor_simular_envio", { caso, confirmado: false });
  if (envio.ok) {
    console.log("  ERROR: el envio simulado no deberia ejecutarse sin confirmacion");
    fallos.push(`${caso}: simular_envio se ejecuto sin confirmacion`);
  } else {
    console.log(`  Envio sin confirmacion rechazado correctamente: ${envio.error}`);
  }

  resumenCasos.push({
    caso,
    pais: String(datos.pais ?? ""),
    formato: String(datos.formato ?? ""),
    llenos: llenos.length,
    confirmar: confirmar.length,
    faltantes: faltantes.length,
    listo,
    bloqueos,
  });
}

seccion("RESUMEN");
console.log(
  "caso".padEnd(24) +
    "pais".padEnd(6) +
    "fmt".padEnd(8) +
    "llenos".padEnd(8) +
    "conf".padEnd(6) +
    "falt".padEnd(6) +
    "listo_para_firma",
);
for (const item of resumenCasos) {
  console.log(
    item.caso.padEnd(24) +
      item.pais.padEnd(6) +
      item.formato.padEnd(8) +
      String(item.llenos).padEnd(8) +
      String(item.confirmar).padEnd(6) +
      String(item.faltantes).padEnd(6) +
      (item.listo ? "si" : `no (${item.bloqueos.join("; ")})`),
  );
}

seccion("ARCHIVOS GENERADOS");
const casosResueltos = resumenCasos.map((item) => item.caso);
for (const caso of casosResueltos) {
  console.log(`  out/${caso}/`);
}
console.log("  out/log.jsonl");

if (fallos.length > 0) {
  console.log("");
  console.log("FALLOS:");
  for (const fallo of fallos) console.log(`  - ${fallo}`);
  process.exit(1);
}

console.log("");
console.log("Verificacion superada: 0 fallos.");
