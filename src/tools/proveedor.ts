/**
 * Capa de presentacion para el modelo: herramientas tipadas con zod.
 *
 * Contrato (PRD 6.2): cada herramienta es un objeto con `description`, `args`
 * (esquemas zod con `.describe()`) y `execute(args, ctx)` que devuelve un string
 * JSON `{ ok: true, data }` o `{ ok: false, error }` y NUNCA lanza.
 *
 * El nombre que ve el modelo es `<archivo>_<export>`: este archivo es
 * `proveedor.ts`, asi que se ven como `proveedor_leer_solicitud`, etc.
 */

import { z } from "zod";

import { ErrorFormatoNoSoportado, ServicioRegistroProveedor } from "../application/servicio.ts";
import { resumirResultado } from "../domain/reglas.ts";
import { GeneradorFormulariosAdapter } from "../infrastructure/generadores.ts";
import { RepositorioFS } from "../infrastructure/repositorio-fs.ts";
import { registrarLog } from "../infrastructure/registro-log.ts";

export interface ContextoHerramienta {
  /** Raiz del proyecto. Las rutas se resuelven siempre desde aqui, nunca absolutas. */
  directory: string;
  sessionId: string;
}

function crearServicio(ctx: ContextoHerramienta): ServicioRegistroProveedor {
  return new ServicioRegistroProveedor(
    new RepositorioFS(ctx.directory),
    new GeneradorFormulariosAdapter(),
    { fechaEjecucion: process.env.FECHA_EJECUCION },
  );
}

function resumir(data: unknown): string {
  return resumirResultado(JSON.stringify(data), 200);
}

async function ejecutarHerramienta(
  nombre: string,
  ctx: ContextoHerramienta,
  caso: string | undefined,
  accion: () => Promise<unknown>,
): Promise<string> {
  try {
    const data = await accion();
    await registrarLog(ctx.directory, caso, nombre, true, resumir(data));
    return JSON.stringify({ ok: true, data });
  } catch (error) {
    if (error instanceof ErrorFormatoNoSoportado) {
      await registrarLog(ctx.directory, caso, nombre, false, error.message);
      return JSON.stringify({ ok: false, error: error.message, data: { ruta: error.ruta } });
    }
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    await registrarLog(ctx.directory, caso, nombre, false, mensaje);
    return JSON.stringify({ ok: false, error: mensaje });
  }
}

// --------------------------------------------------------------------------
// 1. Leer la solicitud
// --------------------------------------------------------------------------
const argsLeerSolicitud = {
  caso: z
    .string()
    .describe(
      "Nombre de la carpeta del caso en fixtures/reto-01/casos/ (por ejemplo: co-industrias-delta, ec-corp-andina, hn-agroexport-sula, pa-logistica-istmo)",
    ),
};

export const leer_solicitud = {
  description:
    "Lee la solicitud de un caso (correo del cliente) y devuelve el pais, el cliente, el formato de salida pedido, la lista de campos solicitados y los soportes exigidos.",
  args: argsLeerSolicitud,
  async execute(
    args: z.infer<z.ZodObject<typeof argsLeerSolicitud>>,
    ctx: ContextoHerramienta,
  ): Promise<string> {
    return ejecutarHerramienta("leer_solicitud", ctx, args.caso, async () =>
      crearServicio(ctx).leerSolicitud(args.caso),
    );
  },
};

// --------------------------------------------------------------------------
// 2. Mapear campos contra el maestro
// --------------------------------------------------------------------------
const argsMapearCampos = {
  caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  campos: z
    .array(z.string())
    .optional()
    .describe(
      "Etiquetas exactas que pide el cliente, tal como aparecen en la plantilla. Si se omite, se usan todas las de la plantilla del caso.",
    ),
};

export const mapear_campos = {
  description:
    "Cruza cada campo solicitado con el repositorio maestro y lo clasifica en lleno (con la ruta del dato), faltante (no existe en el maestro) o requiere_confirmacion. No inventa valores.",
  args: argsMapearCampos,
  async execute(
    args: z.infer<z.ZodObject<typeof argsMapearCampos>>,
    ctx: ContextoHerramienta,
  ): Promise<string> {
    return ejecutarHerramienta("mapear_campos", ctx, args.caso, async () =>
      crearServicio(ctx).mapearCampos(args.caso, args.campos),
    );
  },
};

// --------------------------------------------------------------------------
// 3. Generar el formulario
// --------------------------------------------------------------------------
const argsGenerarFormulario = {
  caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  mapeo: z
    .array(
      z.object({
        etiqueta: z.string(),
        estado: z.enum(["lleno", "faltante", "requiere_confirmacion"]),
      }),
    )
    .optional()
    .describe(
      "Mapeo informado por el modelo. Es opcional: la herramienta recalcula el cruce contra el maestro, que es la unica fuente de valores.",
    ),
};

export const generar_formulario = {
  description:
    "Genera el formulario del caso en el formato pedido: Excel (.xlsx) para formato xlsx, PDF para formato pdf, o el archivo de valores copiables para formato portal (no soportado).",
  args: argsGenerarFormulario,
  async execute(
    args: z.infer<z.ZodObject<typeof argsGenerarFormulario>>,
    ctx: ContextoHerramienta,
  ): Promise<string> {
    return ejecutarHerramienta("generar_formulario", ctx, args.caso, async () =>
      crearServicio(ctx).generarFormulario(args.caso),
    );
  },
};

// --------------------------------------------------------------------------
// 4. Armar el paquete para firma
// --------------------------------------------------------------------------
const argsArmarPaquete = {
  caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
};

export const armar_paquete = {
  description:
    "Arma el paquete para firma del caso: copia el formulario, copia los soportes exigidos que existen, escribe checklist.md con soportes presentes/ausentes/vencidos y borrador-correo.md, y dice si queda listo_para_firma.",
  args: argsArmarPaquete,
  async execute(
    args: z.infer<z.ZodObject<typeof argsArmarPaquete>>,
    ctx: ContextoHerramienta,
  ): Promise<string> {
    return ejecutarHerramienta("armar_paquete", ctx, args.caso, async () =>
      crearServicio(ctx).armarPaquete(args.caso),
    );
  },
};

// --------------------------------------------------------------------------
// 5. Simular envio (sujeto a confirmacion humana)
// --------------------------------------------------------------------------
const argsSimularEnvio = {
  caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/"),
  confirmado: z
    .boolean()
    .describe(
      "true solo si la persona ya confirmo explicitamente el envio en su mensaje anterior. En cualquier otro caso debe ser false.",
    ),
};

export const simular_envio = {
  description:
    "Simula el envio del paquete escribiendo ENVIO-SIMULADO.md. Solo se ejecuta con confirmacion explicita de la persona; el agente nunca envia correo real.",
  args: argsSimularEnvio,
  async execute(
    args: z.infer<z.ZodObject<typeof argsSimularEnvio>>,
    ctx: ContextoHerramienta,
  ): Promise<string> {
    return ejecutarHerramienta("simular_envio", ctx, args.caso, async () =>
      crearServicio(ctx).simularEnvio(args.caso, args.confirmado),
    );
  },
};

// --------------------------------------------------------------------------
// Registro: de aqui sale el nombre visible `<archivo>_<export>` y el JSON Schema
// --------------------------------------------------------------------------
export const HERRAMIENTAS_PROVEEDOR = {
  leer_solicitud,
  mapear_campos,
  generar_formulario,
  armar_paquete,
  simular_envio,
} as const;

export type ExportProveedor = keyof typeof HERRAMIENTAS_PROVEEDOR;

export const PREFIJO_HERRAMIENTA = "proveedor";

interface HerramientaTipada {
  description: string;
  args: z.ZodRawShape;
  execute(args: Record<string, unknown>, ctx: ContextoHerramienta): Promise<string>;
}

export interface HerramientaRegistrada {
  nombre: string;
  descripcion: string;
  args: z.ZodRawShape;
  /** Objeto zod listo para validar los argumentos que envia el modelo. */
  objeto: z.ZodObject<z.ZodRawShape>;
  jsonSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ContextoHerramienta): Promise<string>;
}

/** Convierte los esquemas zod de los argumentos en JSON Schema para el proveedor LLM. */
export function esquemaJson(forma: z.ZodRawShape): Record<string, unknown> {
  try {
    return z.toJSONSchema(z.object(forma), { io: "input" }) as Record<string, unknown>;
  } catch {
    return { type: "object", properties: {}, additionalProperties: false };
  }
}

/** Registro de herramientas con su nombre visible para el modelo. */
export function registroHerramientas(): HerramientaRegistrada[] {
  return (Object.keys(HERRAMIENTAS_PROVEEDOR) as ExportProveedor[]).map((clave) => {
    const herramienta = HERRAMIENTAS_PROVEEDOR[clave] as unknown as HerramientaTipada;
    return {
      nombre: `${PREFIJO_HERRAMIENTA}_${clave}`,
      descripcion: herramienta.description,
      args: herramienta.args,
      objeto: z.object(herramienta.args),
      jsonSchema: esquemaJson(herramienta.args),
      execute: (args, ctx) => herramienta.execute(args, ctx),
    };
  });
}
