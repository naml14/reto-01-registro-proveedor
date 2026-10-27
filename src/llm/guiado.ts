/**
 * Adaptador determinista (modo sin LLM).
 *
 * Existe para que el chat de la defensa funcione sin depender de una clave de
 * proveedor: recorre el mismo ciclo de herramientas (leer -> mapear -> generar
 * -> armar -> confirmar -> enviar) y redacta el resumen con los valores que
 * devuelve cada herramienta. Los valores SIEMPRE vienen de las herramientas.
 */

import { readdirSync } from "node:fs";
import path from "node:path";

import type { AdaptadorLLM, DefinicionHerramienta, Mensaje, RespuestaLLM } from "./adapter.ts";

/** Estructura parcial de resultados de herramienta consumidos por el modo guiado. */
interface DatosHerramienta {
  [clave: string]: unknown;
}

const AFIRMATIVO = /^\s*(si|sí|yes|ok|okay|dale|de acuerdo|confirmo|confirmá|adelante|hazlo|listo)\b/i;
const ORDEN_ENVIO = /(env[ií]a|enviar|simul\w*|despach\w*)/i;

/**
 * Lista los directorios de fixtures que el modo determinista puede procesar.
 * @param raiz Raíz del proyecto.
 * @returns Casos ordenados o una lista vacía si no se puede leer el directorio.
 */
function listarCasos(raiz: string): string[] {
  try {
    return readdirSync(path.join(raiz, "fixtures", "reto-01", "casos"), { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => entrada.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Adaptador local determinista que recorre las herramientas sin invocar un proveedor LLM.
 * Requiere confirmación en un turno posterior antes de simular el envío.
 */
export class AdaptadorGuiado implements AdaptadorLLM {
  /** Identificador que reporta el backend para el modo sin proveedor externo. */
  readonly id = "guiado";
  /** Etiqueta visible para el modo local determinista. */
  readonly modelo = "determinista";
  /** Casos descubiertos al construir el adaptador. */
  private readonly casos: string[];

  /** @param raiz Raíz del proyecto donde se encuentran los casos de fixtures. */
  constructor(private readonly raiz: string) {
    this.casos = listarCasos(raiz);
  }

  /** Extrae del historial los resultados JSON exitosos de las herramientas. */
  private resultados(mensajes: Mensaje[]): Map<string, DatosHerramienta> {
    const mapa = new Map<string, DatosHerramienta>();
    for (const mensaje of mensajes) {
      if (mensaje.rol !== "tool") continue;
      try {
        const parseado = JSON.parse(mensaje.contenido) as { ok?: boolean; data?: DatosHerramienta };
        if (parseado.ok === true && parseado.data !== undefined) {
          mapa.set(mensaje.nombre, parseado.data);
        }
      } catch {
        // Un resultado ilegible se ignora: el ciclo sigue.
      }
    }
    return mapa;
  }

  /** Busca en el texto el primer identificador de caso disponible. */
  private detectarCaso(texto: string): string | null {
    const normalizado = texto.toLowerCase();
    for (const caso of this.casos) {
      if (normalizado.includes(caso.toLowerCase())) return caso;
    }
    return null;
  }

  /** Recupera el caso ya trabajado mirando la llamada a leer_solicitud del historial. */
  /** Recupera del historial el caso de la última llamada a `proveedor_leer_solicitud`. */
  private casoDeResultados(mensajes: Mensaje[]): string | null {
    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
      const mensaje = mensajes[indice];
      if (mensaje.rol !== "assistant") continue;
      for (const llamada of mensaje.llamadas ?? []) {
        if (llamada.nombre === "proveedor_leer_solicitud") {
          const caso = llamada.argumentos.caso;
          if (typeof caso === "string" && caso !== "") return caso;
        }
      }
    }
    return null;
  }

  /** Comprueba si el último mensaje del asistente con contenido pidió confirmación explícita. */
  private pideConfirmacionPrevia(mensajes: Mensaje[]): boolean {
    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
      const mensaje = mensajes[indice];
      if (mensaje.rol === "assistant" && mensaje.contenido.trim() !== "") {
        return /\?/.test(mensaje.contenido) && /confirm/i.test(mensaje.contenido);
      }
    }
    return false;
  }

  /**
   * Produce la siguiente respuesta o llamada siguiendo el flujo local leer→mapear→generar→armar.
   * La simulación de envío solo se solicita si el usuario responde afirmativamente tras una pregunta previa.
   *
   * @param mensajes Historial normalizado de la sesión.
   * @param _herramientas Catálogo recibido por compatibilidad con `AdaptadorLLM`; el modo guiado no lo consulta.
   * @returns Texto final o la llamada de herramienta que corresponde al siguiente paso.
   */
  async responder(mensajes: Mensaje[], _herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const ultimoUsuario = [...mensajes].reverse().find((mensaje) => mensaje.rol === "user");
    const textoUsuario = ultimoUsuario?.contenido ?? "";
    const resultados = this.resultados(mensajes);
    const caso = this.detectarCaso(textoUsuario) ?? this.casoDeResultados(mensajes);

    if (caso === null) {
      return {
        texto: `No identifique el caso. Casos disponibles: ${this.casos.join(", ")}. Indica por ejemplo: "Procesa el caso ec-corp-andina".`,
        llamadas: [],
      };
    }

    // 1. Si el envio ya se simulo, se informa y se cierra el turno.
    if (resultados.has("proveedor_simular_envio")) {
      const envio = resultados.get("proveedor_simular_envio") ?? {};
      return {
        texto: `Envio simulado de "${caso}" registrado en ${String(envio.ruta ?? "out/")}. No se envio ningun correo real: la firma y el envio los hace el representante legal.`,
        llamadas: [],
      };
    }

    // 2. Primero se procesa el caso: leer -> mapear -> generar -> armar.
    if (!resultados.has("proveedor_leer_solicitud")) {
      return { texto: "", llamadas: [{ nombre: "proveedor_leer_solicitud", argumentos: { caso } }] };
    }

    const solicitud = resultados.get("proveedor_leer_solicitud") ?? {};
    const campos = Array.isArray(solicitud.campos)
      ? solicitud.campos
          .map((campo) => (campo as { etiqueta?: unknown }).etiqueta)
          .filter((etiqueta): etiqueta is string => typeof etiqueta === "string")
      : [];

    if (!resultados.has("proveedor_mapear_campos")) {
      return {
        texto: "",
        llamadas: [{ nombre: "proveedor_mapear_campos", argumentos: { caso, campos } }],
      };
    }

    if (!resultados.has("proveedor_generar_formulario")) {
      return {
        texto: "",
        llamadas: [{ nombre: "proveedor_generar_formulario", argumentos: { caso } }],
      };
    }

    if (!resultados.has("proveedor_armar_paquete")) {
      return {
        texto: "",
        llamadas: [{ nombre: "proveedor_armar_paquete", argumentos: { caso } }],
      };
    }

    // 3. El caso ya esta procesado: se decide si toca simular el envio.
    const afirmativo = AFIRMATIVO.test(textoUsuario);
    const confirmacionPrevia = this.pideConfirmacionPrevia(mensajes);
    const pideEnvio = ORDEN_ENVIO.test(textoUsuario) || (afirmativo && confirmacionPrevia);

    if (pideEnvio) {
      if (confirmacionPrevia) {
        return {
          texto: "",
          llamadas: [{ nombre: "proveedor_simular_envio", argumentos: { caso, confirmado: true } }],
        };
      }
      return {
        texto: `Para enviar necesito una confirmacion explicita tuya. ¿Confirmas que simule el envio del paquete de "${caso}"?`,
        llamadas: [],
      };
    }

    return { texto: this.resumen(caso, solicitud, resultados), llamadas: [] };
  }

  /**
   * Resume los resultados de las herramientas con campos, soportes y estado de firma.
   * @param caso Identificador procesado.
   * @param solicitud Resultado de lectura de la solicitud.
   * @param resultados Resultados exitosos indexados por nombre de herramienta.
   * @returns Resumen de texto que termina solicitando confirmación para simular envío.
   */
  private resumen(
    caso: string,
    solicitud: DatosHerramienta,
    resultados: Map<string, DatosHerramienta>,
  ): string {
    const mapeo = resultados.get("proveedor_mapear_campos") ?? {};
    const formulario = resultados.get("proveedor_generar_formulario") ?? {};
    const paquete = resultados.get("proveedor_armar_paquete") ?? {};

    const llenos = Array.isArray(mapeo.llenos) ? (mapeo.llenos as DatosHerramienta[]) : [];
    const faltantes = Array.isArray(mapeo.faltantes) ? (mapeo.faltantes as DatosHerramienta[]) : [];
    const porConfirmar = Array.isArray(mapeo.requiere_confirmacion)
      ? (mapeo.requiere_confirmacion as DatosHerramienta[])
      : [];
    const checklist = (paquete.checklist ?? {}) as DatosHerramienta;
    const bloqueos = Array.isArray(checklist.bloqueos) ? (checklist.bloqueos as string[]) : [];
    const listo = paquete.listo_para_firma === true;

    const lineas: string[] = [];
    lineas.push(
      `Caso ${caso} | ${String(solicitud.pais ?? "?")} | ${String(solicitud.cliente ?? "?")} | formato ${String(solicitud.formato ?? "?").toUpperCase()}`,
    );
    lineas.push("");
    lineas.push(
      `Campos: ${llenos.length} llenados, ${porConfirmar.length} por confirmar, ${faltantes.length} faltantes.`,
    );
    lineas.push(`Formulario: ${String(formulario.ruta ?? "no generado")}`);
    lineas.push(`Paquete: ${String(paquete.ruta ?? "no armado")} (listo_para_firma: ${listo ? "si" : "no"})`);

    if (porConfirmar.length > 0) {
      const detalle = porConfirmar
        .map((campo) => `${String(campo.etiqueta)} (${String(campo.nota ?? "revisar")})`)
        .join(", ");
      lineas.push(`Requieren tu confirmacion: ${detalle}`);
    }
    if (faltantes.length > 0) {
      const detalle = faltantes.map((campo) => String(campo.etiqueta)).join(", ");
      lineas.push(`Faltantes (no inventados): ${detalle}`);
    }
    if (bloqueos.length > 0) {
      lineas.push(`Bloqueos para la firma: ${bloqueos.join("; ")}`);
    } else {
      lineas.push("Soportes a actualizar: ninguno.");
    }
    lineas.push("");
    lineas.push(
      `¿Confirmas que simule el envio del paquete de "${caso}"? En este reto el envio es una simulacion local: no se manda ningun correo.`,
    );
    return lineas.join("\n");
  }
}
