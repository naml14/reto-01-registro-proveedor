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

/** Error de dominio que incluye la ruta de los valores preparados para un formato no implementado. */
export class ErrorFormatoNoSoportado extends Error {
  /** Ruta del artefacto alternativo preparado antes de emitir este error. */
  readonly ruta: string;

  /**
   * @param mensaje Mensaje legible que explica por qué no se generó el formato.
   * @param ruta Ruta del artefacto alternativo generado, si existe.
   */
  constructor(mensaje: string, ruta: string) {
    super(mensaje);
    this.name = "ErrorFormatoNoSoportado";
    this.ruta = ruta;
  }
}

/** Opciones que ajustan la evaluación del servicio sin cambiar sus reglas de negocio. */
export interface OpcionesServicio {
  /** Fecha de ejecucion para evaluar vigencias. Vacio = fecha de cada caso (determinista). */
  fechaEjecucion?: string;
}

/** Ubicación y formato del formulario generado. */
export interface ResultadoFormulario {
  /** Ruta relativa del formulario generado. */
  ruta: string;
  /** Formato del archivo generado. */
  formato: Formato;
}

/** Ubicación y estado de preparación del paquete para firma. */
export interface ResultadoPaquete {
  /** Ruta relativa del directorio del paquete. */
  ruta: string;
  /** Estado derivado de soportes presentes, ausentes o vencidos. */
  listo_para_firma: boolean;
  /** Detalle de soportes, campos y bloqueos. */
  checklist: ChecklistPaquete;
}

/**
 * Orquesta los casos de uso de registro de proveedor mediante puertos de repositorio y generación.
 * Mantiene las reglas de dominio fuera del servidor y de los adaptadores de LLM.
 */
export class ServicioRegistroProveedor {
  /**
   * @param repo Puerto para leer casos y escribir los artefactos.
   * @param generadores Adaptadores que producen PDF y Excel.
   * @param opciones Configuración opcional, incluida la fecha de referencia global.
   */
  constructor(
    private readonly repo: RepositorioProveedor,
    private readonly generadores: GeneradorFormularios,
    private readonly opciones: OpcionesServicio = {},
  ) {}

  /**
   * Elige la fecha global configurada o, en su ausencia, la fecha del caso.
   * @param fechaCaso Fecha declarada en la solicitud.
   * @returns Fecha usada para evaluar vigencias.
   */
  private fechaReferencia(fechaCaso: string): string {
    const global = this.opciones.fechaEjecucion?.trim();
    return global !== undefined && global !== "" ? global : fechaCaso;
  }

  /** @returns Identificadores de los casos disponibles en el repositorio. */
  async listarCasos(): Promise<string[]> {
    return this.repo.listarCasos();
  }

  /**
   * HU-1: obtiene qué pide el cliente, en qué país y en qué formato, junto con sus soportes.
   * @param caso Identificador del directorio de fixtures.
   * @returns Vista de solicitud consumida por el agente.
   * @throws Error si no se puede leer la solicitud, la plantilla o los soportes exigidos.
   */
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

  /**
   * HU-2: cruza etiquetas con el maestro usando el glosario y las reglas del país.
   * @param caso Identificador del directorio de fixtures.
   * @param campos Etiquetas concretas; si se omiten o están vacías, usa todos los campos de la plantilla.
   * @returns Campos clasificados como llenos, faltantes o pendientes de confirmación.
   * @throws Error si no puede leer los datos y catálogos requeridos.
   */
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

  /**
   * HU-3: genera el formulario solicitado o prepara valores copiables para el formato portal.
   * @param caso Identificador del directorio de fixtures.
   * @returns Ruta y formato del archivo generado.
   * @throws ErrorFormatoNoSoportado Para portal, después de escribir el archivo de valores copiables.
   * @throws Error Si falla la lectura de datos o la generación del archivo.
   */
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

  /**
   * HU-4: arma el paquete con formulario, soportes disponibles, checklist y borrador de correo.
   * @param caso Identificador del directorio de fixtures.
   * @returns Ruta del paquete y checklist con su estado para firma.
   * @throws Error si una lectura o escritura del paquete falla; los errores de formato portal se conservan como artefacto alternativo.
   */
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

  /**
   * RN4: escribe una constancia local de envío simulado; nunca envía correo real.
   * @param caso Identificador del directorio de fixtures.
   * @param confirmado Debe ser `true` tras una confirmación humana explícita.
   * @returns Ruta del archivo de simulación.
   * @throws Error si no hay confirmación o si no se puede escribir el archivo.
   */
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

  /**
   * Selecciona valores disponibles para rellenar el formulario.
   * @param mapeo Resultado del cruce de campos.
   * @returns Valores de campos llenos o pendientes de confirmación, indexados por etiqueta.
   */
  private valoresPorEtiqueta(mapeo: ResultadoMapeo): Map<string, string> {
    const valores = new Map<string, string>();
    for (const campo of [...mapeo.llenos, ...mapeo.requiere_confirmacion]) {
      if (campo.valor !== null) {
        valores.set(campo.etiqueta, campo.valor);
      }
    }
    return valores;
  }

  /**
   * Escribe una lista de valores para copiar manualmente en el portal del cliente.
   * @param caso Identificador del caso.
   * @param ruta Destino relativo del archivo Markdown.
   * @param mapeo Resultado del cruce de campos.
   */
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

  /**
   * Renderiza el checklist que explica campos, soportes y bloqueos del paquete.
   * @param caso Identificador del caso.
   * @param solicitud Datos visibles de la solicitud.
   * @param fechaReferencia Fecha usada para evaluar vigencias.
   * @param soportes Evaluación de soportes exigidos.
   * @param mapeo Clasificación de campos solicitados.
   * @param bloqueos Motivos que impiden pasar a firma.
   * @param listoParaFirma Estado calculado según los soportes.
   * @param copiados Archivos de soporte incluidos en el paquete.
   * @param rutaFormulario Ruta del formulario o del archivo alternativo.
   * @returns Contenido Markdown del checklist.
   */
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

  /**
   * Renderiza el correo pendiente de envío para revisión y envío por una persona.
   * @param solicitud Datos del cliente, destinatario y asunto.
   * @param soportes Estado de los soportes requeridos.
   * @param rutaFormulario Ruta del formulario preparado.
   * @param copiados Soportes disponibles incluidos en el paquete.
   * @param fechaReferencia Fecha del caso o fecha global configurada.
   * @returns Borrador en Markdown; no realiza ningún envío.
   */
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
