/**
 * Capa de dominio: reglas de negocio puras del proceso "Registro como Proveedor".
 *
 * RN1  Identificador tributario por pais; Periferia solo tiene NIT colombiano.
 * RN2  Los datos bancarios solo se llenan si la plantilla los pide.
 * RN3  Soporte ausente o vencido bloquea `listo_para_firma`; campo faltante no.
 * RN4  Ninguna accion externa sin confirmacion explicita del turno anterior.
 * RN5  Toda ejecucion deja registro en out/log.jsonl y out/<caso>/log.jsonl.
 */

import type { CampoMapeado, ResultadoMapeo, SoporteEvaluado, SoporteMaestro } from "./entidades.ts";
import {
  ETIQUETA_TRIBUTARIA_POR_PAIS,
  fechaEsVencida,
  formatearValor,
  indiceGlosario,
  indiceSoportes,
  normalizar,
  resolverRuta,
} from "./mapeo.ts";

/** Confianza minima para consideracion automatica (HU-2). */
export const CONFIANZA_MINIMA = 0.8;

/**
 * Sinonimos de tipo de soporte. El cliente nombra el documento con palabras
 * distintas a las del repositorio interno; el alias vive en el conocimiento
 * del proceso y se documenta como supuesto en SOLUCION.md.
 */
export const ALIAS_SOPORTES: Record<string, string> = {
  certificado_cumplimiento_tributario: "parafiscales",
  certificado_complimiento_tributario: "parafiscales",
  certificado_paz_y_salvo: "parafiscales",
  constancia_pago_obligaciones_laborales: "parafiscales",
  certificado_existencia_legal: "camara_comercio",
  certificado_existencia: "camara_comercio",
  registro_tributario: "rut",
};

/**
 * Resuelve el tipo pedido aplicando el alias del dominio, si existe.
 *
 * @param exigido Tipo de soporte indicado en la plantilla.
 * @returns Tipo normalizado y bandera que indica si se aplicó un alias.
 */
export function resolverTipoSoporte(exigido: string): { tipo: string; alias: boolean } {
  const base = exigido.toLowerCase().trim();
  const alias = ALIAS_SOPORTES[base];
  return alias ? { tipo: alias, alias: true } : { tipo: base, alias: false };
}

/**
 * Mapea las etiquetas pedidas contra el repositorio maestro usando el glosario.
 * Cada etiqueta termina en exactamente un estado: lleno | faltante | requiere_confirmacion.
 * El agente nunca inventa: sin fuente no hay valor.
 *
 * @param params Datos y catálogos necesarios para resolver las etiquetas.
 * @param params.etiquetas Etiquetas que se van a cruzar.
 * @param params.maestro Datos del repositorio maestro.
 * @param params.glosario Equivalencias entre etiquetas y rutas del maestro.
 * @param params.pais Código de país usado para interpretar la etiqueta tributaria.
 * @returns Campos separados en llenos, faltantes y pendientes de confirmación.
 */
export function mapearCampos(params: {
  etiquetas: string[];
  maestro: Record<string, unknown>;
  glosario: Record<string, string>;
  pais: string;
}): ResultadoMapeo {
  const glosarioIndexado = indiceGlosario(params.glosario);
  const etiquetaEsperada = ETIQUETA_TRIBUTARIA_POR_PAIS[params.pais] ?? "NIT";

  const llenos: CampoMapeado[] = [];
  const faltantes: CampoMapeado[] = [];
  const requiereConfirmacion: CampoMapeado[] = [];

  for (const etiqueta of params.etiquetas) {
    const clave = glosarioIndexado.get(normalizar(etiqueta));

    if (clave === undefined) {
      faltantes.push({
        etiqueta,
        clave_maestro: null,
        estado: "faltante",
        valor: null,
        ruta_origen: null,
        confianza: 0,
        motivo: "No existe sinonimo en el glosario de campos",
      });
      continue;
    }

    const valorCrudo = resolverRuta(params.maestro, clave);
    if (valorCrudo === undefined || valorCrudo === null || valorCrudo === "") {
      faltantes.push({
        etiqueta,
        clave_maestro: clave,
        estado: "faltante",
        valor: null,
        ruta_origen: clave,
        confianza: CONFIANZA_MINIMA,
        motivo: "La clave no existe o esta vacia en el repositorio maestro",
      });
      continue;
    }

    const valor = formatearValor(valorCrudo);

    if (clave === "nit") {
      const esEtiquetaDelPais = normalizar(etiqueta) === normalizar(etiquetaEsperada);
      if (params.pais === "CO" && esEtiquetaDelPais) {
        llenos.push({
          etiqueta,
          clave_maestro: clave,
          estado: "lleno",
          valor,
          ruta_origen: clave,
          confianza: 1,
        });
      } else if (!esEtiquetaDelPais) {
        requiereConfirmacion.push({
          etiqueta,
          clave_maestro: clave,
          estado: "requiere_confirmacion",
          valor,
          ruta_origen: clave,
          confianza: 0.6,
          nota: `Identificacion tributaria ambigua: en ${params.pais} corresponde ${etiquetaEsperada}`,
        });
      } else {
        requiereConfirmacion.push({
          etiqueta,
          clave_maestro: clave,
          estado: "requiere_confirmacion",
          valor,
          ruta_origen: clave,
          confianza: 0.9,
          nota: "identificador extranjero",
        });
      }
      continue;
    }

    llenos.push({
      etiqueta,
      clave_maestro: clave,
      estado: "lleno",
      valor,
      ruta_origen: clave,
      confianza: 1,
    });
  }

  return { llenos, faltantes, requiere_confirmacion: requiereConfirmacion };
}

/**
 * Evalúa los soportes exigidos contra el índice y la fecha de vigencia.
 * Los aliases se resuelven antes de buscar; un soporte ausente queda marcado como bloqueo potencial.
 *
 * @param params Requisitos, índice documental y fecha de referencia.
 * @param params.exigidos Tipos solicitados por el caso.
 * @param params.indice Soportes disponibles en el repositorio.
 * @param params.fechaReferencia Fecha de la solicitud o fecha explícita de ejecución.
 * @returns Un resultado por cada tipo exigido, en el mismo orden.
 */
export function evaluarSoportes(params: {
  exigidos: string[];
  indice: SoporteMaestro[];
  fechaReferencia: string;
}): SoporteEvaluado[] {
  const porTipo = indiceSoportes(params.indice);

  return params.exigidos.map((exigido) => {
    const { tipo, alias } = resolverTipoSoporte(exigido);
    const soporte = porTipo.get(tipo);

    if (soporte === undefined) {
      return {
        tipo_exigido: exigido,
        tipo_resuelto: null,
        estado: "ausente",
        archivo: null,
        vigencia_hasta: null,
        descripcion: "No existe en el repositorio de soportes",
        nota: alias ? `Alias aplicado: ${exigido} -> ${tipo}` : undefined,
      };
    }

    const vencido = fechaEsVencida(soporte.vigencia_hasta, params.fechaReferencia);
    return {
      tipo_exigido: exigido,
      tipo_resuelto: soporte.tipo,
      estado: vencido ? "vencido" : "presente",
      archivo: soporte.archivo,
      vigencia_hasta: soporte.vigencia_hasta,
      descripcion: soporte.descripcion,
      nota: alias ? `Alias aplicado: ${exigido} -> ${soporte.tipo}` : undefined,
    };
  });
}

/**
 * Aplica RN3: un soporte ausente o vencido bloquea la firma; los campos faltantes no se evalúan aquí.
 *
 * @param soportes Resultados de evaluación de los soportes exigidos.
 * @returns Indicador de disponibilidad para firma y motivos de bloqueo.
 */
export function evaluarListoParaFirma(soportes: SoporteEvaluado[]): {
  listo_para_firma: boolean;
  bloqueos: string[];
} {
  const bloqueos = soportes
    .filter((soporte) => soporte.estado !== "presente")
    .map((soporte) =>
      soporte.estado === "ausente"
        ? `Soporte ausente: ${soporte.tipo_exigido}`
        : `Soporte vencido: ${soporte.tipo_exigido} (vigencia hasta ${soporte.vigencia_hasta ?? "sin fecha"})`,
    );

  return { listo_para_firma: bloqueos.length === 0, bloqueos };
}

/**
 * El agente termina el turno con una pregunta cuando necesita una accion externa.
 * Heurística de detección para resaltar el estado en el front (CA3); no sustituye el consentimiento humano.
 *
 * @param texto Respuesta que se inspecciona.
 * @returns `true` si menciona una acción reconocida y contiene signo de pregunta.
 */
export function pideConfirmacion(texto: string): boolean {
  const normalizado = texto.toLowerCase();
  const mencionaAccion = /(confirm|autoriz|procedo|simulo|simular|env[ií]o|enviar)/.test(normalizado);
  const esPregunta = /\?/.test(texto);
  return mencionaAccion && esPregunta;
}

/**
 * Compacta el resultado de una herramienta para mostrarlo en el historial del chat.
 *
 * @param texto Resultado original.
 * @param largoMaximo Longitud máxima, incluido el carácter de elipsis cuando se trunca.
 * @returns Texto con espacios colapsados y, si hace falta, truncado.
 */
export function resumirResultado(texto: string, largoMaximo = 220): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= largoMaximo) return limpio;
  return `${limpio.slice(0, largoMaximo - 1)}…`;
}
