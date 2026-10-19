# Conocimiento del proceso: Registro como Proveedor

Este archivo es **conocimiento**, no código. El agente lo consulta cuando una regla de negocio
no está en el prompt. Los valores concretos viven en `fixtures/reto-01/repositorio/maestro.json`.

## 1. De dónde sale cada cosa

| Necesidad | Ubicación |
|---|---|
| Datos de Periferia (razón social, NIT, banco, representante legal…) | `fixtures/reto-01/repositorio/maestro.json` |
| Sinónimos de etiquetas → clave del maestro | `fixtures/reto-01/glosario-campos.json` |
| Soportes disponibles y su vigencia | `fixtures/reto-01/repositorio/soportes/index.json` |
| Texto de cada soporte | `fixtures/reto-01/repositorio/soportes/<archivo>` |
| Casos de prueba | `fixtures/reto-01/casos/<caso>/` |

## 2. Identificador tributario por país (RN1)

| País | Identificador que espera el cliente | Qué tiene Periferia |
|---|---|---|
| CO | NIT | NIT colombiano → se llena como `lleno` |
| EC | RUC | Solo hay NIT → se llena con el NIT y queda `requiere_confirmacion` (nota: "identificador extranjero") |
| PE | RUC | Igual que EC |
| PA | RUC | Igual que EC |
| HN | RTN | Igual que EC |

Si la etiqueta no corresponde al identificador del país (por ejemplo "Identificación tributaria"),
el campo queda `requiere_confirmacion` con la nota de a qué equivale en ese país.

## 3. Tipos de soporte y sus sinónimos

El cliente nombra el documento con sus propias palabras. Estas equivalencias están en
`ALIAS_SOPORTES` (código) y se documentan como supuesto en `SOLUCION.md`:

| Lo que pide el cliente | Soporte en el repositorio |
|---|---|
| `certificado_cumplimiento_tributario` | `parafiscales` |
| `constancia_pago_obligaciones_laborales` | `parafiscales` |
| `certificado_existencia_legal` / `certificado_existencia` | `camara_comercio` |
| `registro_tributario` | `rut` |

Sin alias, un tipo no listado en el índice queda **ausente** y bloquea la firma.

## 4. Vigencia de los soportes (RN3)

- `vigencia_hasta: null` → el soporte no vence.
- `vigencia_hasta` anterior a la fecha de ejecución → soporte **vencido**, bloquea la firma.
- Fecha de ejecución: por defecto la **fecha de la solicitud** (modo determinista, el mismo
  resultado en cada ejecución). Se puede forzar con la variable `FECHA_EJECUCION`.
- Soporte ausente o vencido → el paquete **no** queda `listo_para_firma`, y el bloqueo aparece
  en `checklist.md` y en el resumen del chat.

## 5. Estados de un campo

| Estado | Significado | Qué hace el agente |
|---|---|---|
| `lleno` | El dato existe en el maestro | Lo escribe en el formulario |
| `requiere_confirmacion` | El dato existe pero es ambiguo o extranjero | Lo escribe y lo lista para revisión humana |
| `faltante` | No hay dato en el maestro | **No escribe nada** y lo reporta |

Un campo `faltante` nunca bloquea la firma, pero queda en el checklist.

## 6. Reglas de llenado

- Los datos bancarios (banco, tipo de cuenta, número de cuenta, titular, SWIFT) se escriben
  **solo si la plantilla del cliente los pide** (RN2). Nunca van en el borrador de correo.
- El formato de salida lo manda el cliente: `xlsx` (Excel), `pdf` (PDF generado con etiqueta y
  valor en el orden de la plantilla) o `portal` (P2, no automatizable).
- Para `portal` el agente produce `out/<caso>/valores-portal.md` con los valores listos para
  copiar y responde `formato no soportado`. El ingreso de credenciales y el clic en "Enviar"
  los hace una persona.

## 7. Cierre humano

El agente prepara y pregunta. La firma del representante legal, el envío del correo y el ingreso
a portales son siempre decisiones humanas. `proveedor_simular_envio` solo escribe
`ENVIO-SIMULADO.md` en local, y solo tras confirmación explícita en el turno anterior.
