/**
 * Pruebas de las reglas de dominio (bun test).
 * Cubren las reglas nombradas por el PRD: RN1 (identificador por pais),
 * HU-1/HU-2 (estados de campo y glosario) y RN3 (vigencia de soportes).
 */

import { describe, expect, test } from "bun:test";

import { evaluarListoParaFirma, evaluarSoportes, mapearCampos, pideConfirmacion } from "../src/domain/reglas.ts";
import { normalizar, resolverRuta } from "../src/domain/mapeo.ts";
import type { SoporteMaestro } from "../src/domain/entidades.ts";

const MAESTRO: Record<string, unknown> = {
  razon_social: "Periferia IT Group S.A.S.",
  nit: "900123456",
  digito_verificacion: "7",
  pais: "CO",
  ciudad: "Medellín",
  contacto_comercial: { email: "lgomez@periferia-ficticia.com" },
  ingresos_ultimo_ano: { valor: 98000000000, moneda: "COP", ano: 2025 },
  banco: { nombre: "Bancolombia S.A.", numero_cuenta: "03100012345", swift: "COLOCOBM" },
};

const GLOSARIO: Record<string, string> = {
  "Razón social": "razon_social",
  NIT: "nit",
  RUC: "nit",
  RTN: "nit",
  "Identificación tributaria": "nit",
  Ciudad: "ciudad",
  "Correo electrónico": "contacto_comercial.email",
  "Ingresos anuales": "ingresos_ultimo_ano.valor",
  Banco: "banco.nombre",
};

const SOPORTES: SoporteMaestro[] = [
  { tipo: "camara_comercio", archivo: "camara.txt", vigencia_hasta: "2026-09-30", pais_emisor: "CO", descripcion: "Camara" },
  { tipo: "parafiscales", archivo: "para.txt", vigencia_hasta: "2026-08-31", pais_emisor: "CO", descripcion: "Parafiscales" },
  { tipo: "rut", archivo: "rut.txt", vigencia_hasta: null, pais_emisor: "CO", descripcion: "RUT" },
];

describe("mapeo.ts", () => {
  test("normalizar quita acentos, minusculas y espacios extra", () => {
    expect(normalizar("  Razón   Social ")).toBe("razon social");
  });

  test("resolverRuta recorre rutas anidadas con punto", () => {
    expect(resolverRuta(MAESTRO, "contacto_comercial.email")).toBe("lgomez@periferia-ficticia.com");
    expect(resolverRuta(MAESTRO, "ingresos_ultimo_ano.valor")).toBe(98000000000);
  });

  test("resolverRuta devuelve undefined cuando la ruta no existe", () => {
    expect(resolverRuta(MAESTRO, "no.existe")).toBeUndefined();
  });
});

describe("reglas.ts - mapeo de campos (HU-2)", () => {
  test("un sinonimo del glosario queda lleno con su ruta de origen", () => {
    const resultado = mapearCampos({
      etiquetas: ["Correo electrónico"],
      maestro: MAESTRO,
      glosario: GLOSARIO,
      pais: "CO",
    });
    expect(resultado.llenos).toHaveLength(1);
    expect(resultado.llenos[0].valor).toBe("lgomez@periferia-ficticia.com");
    expect(resultado.llenos[0].ruta_origen).toBe("contacto_comercial.email");
  });

  test("una etiqueta sin sinonimo queda faltante y sin valor", () => {
    const resultado = mapearCampos({
      etiquetas: ["Referencias comerciales"],
      maestro: MAESTRO,
      glosario: GLOSARIO,
      pais: "CO",
    });
    expect(resultado.faltantes).toHaveLength(1);
    expect(resultado.faltantes[0].valor).toBeNull();
    expect(resultado.llenos).toHaveLength(0);
  });

  test("RN1: en Colombia el NIT queda lleno", () => {
    const resultado = mapearCampos({ etiquetas: ["NIT"], maestro: MAESTRO, glosario: GLOSARIO, pais: "CO" });
    expect(resultado.llenos[0].estado).toBe("lleno");
    expect(resultado.llenos[0].valor).toBe("900123456");
  });

  test("RN1: en Ecuador el RUC queda con el NIT pero requiere confirmacion", () => {
    const resultado = mapearCampos({ etiquetas: ["RUC"], maestro: MAESTRO, glosario: GLOSARIO, pais: "EC" });
    expect(resultado.llenos).toHaveLength(0);
    expect(resultado.requiere_confirmacion).toHaveLength(1);
    expect(resultado.requiere_confirmacion[0].valor).toBe("900123456");
    expect(resultado.requiere_confirmacion[0].nota).toContain("identificador extranjero");
  });

  test("RN1: en Honduras el RTN queda como identificador extranjero", () => {
    const resultado = mapearCampos({ etiquetas: ["RTN"], maestro: MAESTRO, glosario: GLOSARIO, pais: "HN" });
    expect(resultado.requiere_confirmacion[0].nota).toContain("identificador extranjero");
  });

  test("una etiqueta ambigua queda en requiere_confirmacion", () => {
    const resultado = mapearCampos({
      etiquetas: ["Identificación tributaria"],
      maestro: MAESTRO,
      glosario: GLOSARIO,
      pais: "EC",
    });
    expect(resultado.llenos).toHaveLength(0);
    expect(resultado.requiere_confirmacion[0].nota).toContain("RUC");
  });
});

describe("reglas.ts - soportes (RN3)", () => {
  test("un soporte vigente queda presente", () => {
    const resultado = evaluarSoportes({ exigidos: ["rut"], indice: SOPORTES, fechaReferencia: "2026-08-27" });
    expect(resultado[0].estado).toBe("presente");
  });

  test("un soporte con vigencia anterior a la fecha de ejecucion queda vencido", () => {
    const resultado = evaluarSoportes({
      exigidos: ["camara_comercio"],
      indice: SOPORTES,
      fechaReferencia: "2026-10-19",
    });
    expect(resultado[0].estado).toBe("vencido");
  });

  test("un alias de soporte se resuelve contra el indice", () => {
    const resultado = evaluarSoportes({
      exigidos: ["certificado_cumplimiento_tributario"],
      indice: SOPORTES,
      fechaReferencia: "2026-08-27",
    });
    expect(resultado[0].tipo_resuelto).toBe("parafiscales");
    expect(resultado[0].estado).toBe("presente");
  });

  test("un soporte ausente bloquea listo_para_firma", () => {
    const soportes = evaluarSoportes({
      exigidos: ["certificado_iso_9001"],
      indice: SOPORTES,
      fechaReferencia: "2026-08-27",
    });
    expect(soportes[0].estado).toBe("ausente");
    const veredicto = evaluarListoParaFirma(soportes);
    expect(veredicto.listo_para_firma).toBe(false);
    expect(veredicto.bloqueos[0]).toContain("ausente");
  });
});

describe("reglas.ts - confirmacion humana (CA3)", () => {
  test("una pregunta con palabra de confirmacion pide confirmacion", () => {
    expect(pideConfirmacion("¿Confirmas que simule el envio del paquete?")).toBe(true);
  });

  test("un resumen sin pregunta no pide confirmacion", () => {
    expect(pideConfirmacion("El paquete quedo listo_para_firma. Soportes a actualizar: ninguno.")).toBe(false);
  });
});
