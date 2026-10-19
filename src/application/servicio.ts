/**
 * Capa de aplicacion: casos de uso del proceso "Registro como Proveedor".
 *
 * Reglas que se aplican aqui (no en el servidor, no en el prompt):
 *  - RN1 identificador tributario por pais
 *  - RN2 datos bancarios solo si la plantilla los pide
 *  - RN3 soporte ausente o vencido bloquea `listo_para_firma`
 *  - RN4 ninguna accion externa sin confirmacion explicita
 *  - RN5 toda ejecucion queda registrada
 */

import path from "node:path";

import type {
  CampoMapeado,
  ChecklistPaquete,
  DatosSolicitud,
  Formato,
  ResultadoMapeo,
  SoporteEvaluado,
} from "../domain/entidades.ts";
import { evaluarListoParaFirma, evaluarSoportes, mapearCampos as mapearCamposDominio } from "../domain/reglas.ts";
import type { GeneradorFormularios, RepositorioProveedor } from "./ports.ts";

/** El formato portal no se implementa (P2): se dejan los valores listos para copiar. */
export class ErrorFormatoNoSoportado extends Error {
  readonly ruta: string;

  constructor(mensaje: string, ruta: string) {
    super(mensaje);
    this.name = "ErrorFormatoNoSoportado";
    this.ruta = ruta;
  }
}

export interface OpcionesServicio {
  /** Fecha de ejecucion para evaluar vigencias. Vacio = fecha de cada caso (determinista). */
  fechaEjecucion?: string;
}

export interface ResultadoFormulario {
  ruta: string;
  formato: Formato;
}

export interface ResultadoPaquete {
  ruta: string;
  listo_para_firma: boolean;
  checklist: ChecklistPaquete;
}

export class ServicioRegistroProveedor {
  constructor(
    private readonly repo: RepositorioProveedor,
    private readonly generadores: GeneradorFormularios,
    private readonly opciones: OpcionesServicio = {},
  ) {}

  private fechaReferencia(fechaCaso: string): string {
    const global = this.opciones.fechaEjecucion?.trim();
    return global !== undefined && global !== "" ? global : fechaCaso;
  }

  async listarCasos(): Promise<string[]> {
    return this.repo.listarCasos();
  }

  /** HU-1: que pide el cliente, en que pais y en que formato. */
  async leerSolicitud(caso: string): Promise<DatosSolicitud> {
    const solicitud = await this.repo.leerSolicitud(caso);
    const campos = await this.repo.leerCampos(caso, solicitud.formato);
    const soportes = await this.repo.leerSoportesExigidos(caso);
    return {
      pais: solicitud.pais,
      cliente: solicitud.cliente,
      formato: solicitud.formato,
      campos,
      soportes,
    };
  }

  /** HU-2: cruce campo a campo contra el maestro. */
  async mapearCampos(caso: string, campos?: string[]): Promise<ResultadoMapeo> {
    const solicitud = await this.repo.leerSolicitud(caso);
    const etiquetas =
      campos !== undefined && campos.length > 0
        ? campos
        : (await this.repo.leerCampos(caso, solicitud.formato)).map((campo) => campo.etiqueta);
    const maestro = await this.repo.leerMaestro();
    const glosario = await this.repo.leerGlosario();
    return mapearCamposDominio({ etiquetas, maestro, glosario, pais: solicitud.pais });
  }

  /** HU-3: genera el formulario en el formato pedido. */
  async generarFormulario(caso: string): Promise<ResultadoFormulario> {
    const solicitud = await this.repo.leerSolicitud(caso);
    const mapeo = await this.mapearCampos(caso);
    const valores = this.valoresPorEtiqueta(mapeo);

    if (solicitud.formato === "portal") {
      const ruta = `out/${caso}/valores-portal.md`;
      await this.escribirValoresPortal(caso, ruta, mapeo);
      throw new ErrorFormatoNoSoportado(
        `formato no soportado: portal (P2). Los valores quedaron listos para copiar en ${ruta}`,
        ruta,
      );
    }

    if (solicitud.formato === "xlsx") {
      const plantilla = await this.repo.leerPlantillaCeldas(caso);
      const ruta = `out/${caso}/formulario.xlsx`;
      await this.generadores.generarXlsx(this.repo.rutaAbsoluta(ruta), plantilla, valores);
      return { ruta, formato: "xlsx" };
    }

    const plantilla = await this.repo.leerPlantillaCampos(caso);
    const ruta = `out/${caso}/formulario.pdf`;
    await this.generadores.generarPdf(
      this.repo.rutaAbsoluta(ruta),
      plantilla.map((campo) => ({ etiqueta: campo.etiqueta, valor: valores.get(campo.etiqueta) ?? null })),
    );
    return { ruta, formato: "pdf" };
  }

  /** HU-4: paquete con formulario, soportes, checklist y borrador de correo. */
  async armarPaquete(caso: string): Promise<ResultadoPaquete> {
    const solicitud = await this.repo.leerSolicitud(caso);
    const indice = await this.repo.leerIndiceSoportes();
    const exigidos = await this.repo.leerSoportesExigidos(caso);
    const fechaReferencia = this.fechaReferencia(solicitud.fecha);

    const soportes: SoporteEvaluado[] = evaluarSoportes({ exigidos, indice, fechaReferencia });
    const { listo_para_firma, bloqueos } = evaluarListoParaFirma(soportes);
    const mapeo = await this.mapearCampos(caso);

    const rutaPaquete = `out/${caso}/paquete`;

    // 1. El formulario dentro del paquete.
    let rutaFormulario = "";
    try {
      const generado = await this.generarFormulario(caso);
      rutaFormulario = generado.ruta;
    } catch (error) {
      if (error instanceof ErrorFormatoNoSoportado) {
        rutaFormulario = error.ruta;
      } else {
        throw error;
      }
    }
    if (rutaFormulario !== "") {
      await this.repo.copiar(rutaFormulario, `${rutaPaquete}/${path.basename(rutaFormulario)}`);
    }

    // 2. Copias de los soportes exigidos que existen.
    const copiados: string[] = [];
    for (const soporte of soportes) {
      if (soporte.estado !== "presente" || soporte.archivo === null) continue;
      const contenido = await this.repo.leerSoporte(soporte.archivo);
      if (contenido === null) continue;
      await this.repo.escribir(`${rutaPaquete}/soportes/${soporte.archivo}`, contenido);
      copiados.push(soporte.archivo);
    }

    // 3. Checklist y borrador de correo.
    await this.repo.escribir(
      `${rutaPaquete}/checklist.md`,
      this.armarChecklist(caso, solicitud, fechaReferencia, soportes, mapeo, bloqueos, listo_para_firma, copiados, rutaFormulario),
    );
    await this.repo.escribir(
      `${rutaPaquete}/borrador-correo.md`,
      this.armarBorradorCorreo(solicitud, soportes, rutaFormulario, copiados, fechaReferencia),
    );

    return {
      ruta: rutaPaquete,
      listo_para_firma,
      checklist: {
        soportes,
        campos_faltantes: mapeo.faltantes,
        campos_por_confirmar: mapeo.requiere_confirmacion,
        bloqueos,
        listo_para_firma,
      },
    };
  }

  /** RN4: sin confirmacion explicita no hay envio. */
  async simularEnvio(caso: string, confirmado: boolean): Promise<{ ruta: string }> {
    if (!confirmado) {
      throw new Error("requiere confirmacion explicita");
    }
    const solicitud = await this.repo.leerSolicitud(caso);
    const ruta = `out/${caso}/ENVIO-SIMULADO.md`;
    const contenido = [
      `# Envio simulado - ${solicitud.cliente}`,
      "",
      `- Fecha de simulacion: ${this.fechaReferencia(solicitud.fecha)}`,
      `- Destinatario: ${solicitud.de}`,
      `- Paquete: \`out/${caso}/paquete\``,
      "",
      "Este archivo es una simulacion local: el agente no envio ningun correo real.",
      "La firma y el envio los realiza el representante legal.",
      "",
    ].join("\n");
    await this.repo.escribir(ruta, contenido);
    return { ruta };
  }

  private valoresPorEtiqueta(mapeo: ResultadoMapeo): Map<string, string> {
    const valores = new Map<string, string>();
    for (const campo of [...mapeo.llenos, ...mapeo.requiere_confirmacion]) {
      if (campo.valor !== null) {
        valores.set(campo.etiqueta, campo.valor);
      }
    }
    return valores;
  }

  private async escribirValoresPortal(
    caso: string,
    ruta: string,
    mapeo: ResultadoMapeo,
  ): Promise<void> {
    const solicitud = await this.repo.leerSolicitud(caso);
    const todos: CampoMapeado[] = [...mapeo.llenos, ...mapeo.requiere_confirmacion, ...mapeo.faltantes];
    const lineas = [
      `# Valores listos para copiar - ${solicitud.cliente} (${solicitud.pais})`,
      "",
      "> Formato portal web: el agente no automatiza portales (P2). El humano ingresa",
      "> las credenciales y hace clic en Enviar. Estos valores son los que debe copiar.",
      "",
      "| Campo | Valor | Estado |",
      "| --- | --- | --- |",
    ];
    for (const campo of todos) {
      const valor = campo.valor ?? "(sin dato en el repositorio maestro)";
      lineas.push(`| ${campo.etiqueta} | ${valor} | ${campo.estado} |`);
    }
    lineas.push("");
    await this.repo.escribir(ruta, lineas.join("\n"));
  }

  private armarChecklist(
    caso: string,
    solicitud: { cliente: string; pais: string; formato: Formato },
    fechaReferencia: string,
    soportes: SoporteEvaluado[],
    mapeo: ResultadoMapeo,
    bloqueos: string[],
    listoParaFirma: boolean,
    copiados: string[],
    rutaFormulario: string,
  ): string {
    const lineas = [
      `# Checklist del paquete - ${solicitud.cliente}`,
      "",
      `- Caso: \`${caso}\``,
      `- Pais: ${solicitud.pais}`,
      `- Formato de salida: ${solicitud.formato}`,
      `- Fecha de ejecucion: ${fechaReferencia}`,
      `- Formulario: \`${rutaFormulario}\``,
      `- Estado: **${listoParaFirma ? "listo_para_firma" : "NO listo_para_firma"}**`,
      "",
      "## Soportes exigidos",
      "",
      "| Soporte pedido | Resuelto como | Estado | Archivo | Vigencia hasta | Nota |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const soporte of soportes) {
      lineas.push(
        `| ${soporte.tipo_exigido} | ${soporte.tipo_resuelto ?? "-"} | ${soporte.estado} | ${soporte.archivo ?? "-"} | ${soporte.vigencia_hasta ?? "sin vencimiento"} | ${soporte.nota ?? ""} |`,
      );
    }
    lineas.push("", `Copiados al paquete: ${copiados.length > 0 ? copiados.join(", ") : "ninguno"}`, "");

    lineas.push("## Campos llenados", "");
    if (mapeo.llenos.length === 0) {
      lineas.push("Ninguno.");
    } else {
      for (const campo of mapeo.llenos) {
        lineas.push(`- ${campo.etiqueta} = ${campo.valor ?? ""} (fuente: \`${campo.ruta_origen}\`)`);
      }
    }

    lineas.push("", "## Campos que requieren confirmacion humana", "");
    if (mapeo.requiere_confirmacion.length === 0) {
      lineas.push("Ninguno.");
    } else {
      for (const campo of mapeo.requiere_confirmacion) {
        lineas.push(
          `- ${campo.etiqueta} = ${campo.valor ?? "(sin valor)"} - ${campo.nota ?? "revisar"} (fuente: \`${campo.ruta_origen}\`)`,
        );
      }
    }

    lineas.push("", "## Campos faltantes (no inventados)", "");
    if (mapeo.faltantes.length === 0) {
      lineas.push("Ninguno.");
    } else {
      for (const campo of mapeo.faltantes) {
        lineas.push(`- ${campo.etiqueta} - ${campo.motivo ?? "sin dato en el maestro"}`);
      }
    }

    lineas.push("", "## Bloqueos para la firma", "");
    if (bloqueos.length === 0) {
      lineas.push("Ninguno: el paquete queda `listo_para_firma`.");
    } else {
      for (const bloqueo of bloqueos) {
        lineas.push(`- ${bloqueo}`);
      }
      lineas.push("", "Un soporte ausente o vencido bloquea la firma. Un campo faltante no la bloquea, pero queda listado arriba.");
    }
    lineas.push("");
    return lineas.join("\n");
  }

  private armarBorradorCorreo(
    solicitud: { cliente: string; de: string; asunto: string; formato: Formato },
    soportes: SoporteEvaluado[],
    rutaFormulario: string,
    copiados: string[],
    fechaReferencia: string,
  ): string {
    const presentes = soportes.filter((soporte) => soporte.estado === "presente");
    const pendientes = soportes.filter((soporte) => soporte.estado !== "presente");
    const lineas = [
      `# Borrador de correo - ${solicitud.cliente}`,
      "",
      `- Para: ${solicitud.de}`,
      `- Asunto: ${solicitud.asunto} - Registro como proveedor`,
      `- Fecha: ${fechaReferencia}`,
      "",
      "Estimados,",
      "",
      "Con base en su solicitud de registro como proveedor, preparamos el formulario diligenciado y el paquete de soportes para la firma del representante legal.",
      "",
      "Adjuntamos:",
      `- Formulario diligenciado (\`${rutaFormulario}\`).`,
    ];
    for (const archivo of copiados) {
      lineas.push(`- Soporte: ${archivo}.`);
    }
    if (pendientes.length > 0) {
      lineas.push("", "Pendiente antes del envio:");
      for (const soporte of pendientes) {
        lineas.push(
          `- ${soporte.tipo_exigido}: ${soporte.estado === "vencido" ? `vencido (vigencia hasta ${soporte.vigencia_hasta ?? "sin fecha"})` : "aun no disponible en el repositorio"}.`,
        );
      }
    }
    lineas.push(
      "",
      "Quedamos atentos a la devolucion del formulario firmado por el representante legal.",
      "",
      "Cordialmente,",
      "Periferia IT Group S.A.S.",
      "",
      "> Nota interna: este borrador no incluye datos bancarios (RN2). El envio real lo realiza una persona.",
      "",
    );
    return lineas.join("\n");
  }
}
