# SOLUCION.md · Reto 01 · Agente conversacional "Registro como Proveedor"

Periferia IT Group · Equipo Perxia 2.0 · TypeScript (Bun) · 2026

---

## 1. El problema en una frase

El área administrativa de Periferia transcribe a mano, ocho a doce veces al mes, los datos
corporativos que **ya existen** en el repositorio maestro hacia el formulario de registro como
proveedor que pide cada cliente (Excel, PDF o portal), y le duele a la analista que pierde días
en una transcripción repetitiva con riesgo de error en datos sensibles (NIT, cuenta bancaria) y
en una cola de trabajo que retrasa la facturación.

El agente automatiza **la transcripción, el cruce y el armado**. La firma, el envío y el acceso a
portales siguen siendo de una persona.

## 2. Arquitectura

### 2.1 Diagrama

```
┌────────────────────┐   HTTP/JSON   ┌──────────────────────────────────────────┐
│  Front: chat       │ ────────────▶ │  Backend  src/server.ts                  │
│  web/index.html    │ ◀──────────── │  · ciclo del agente (prompt → modelo →    │
│  · historial       │               │    llamadas a herramienta → respuesta)   │
│  · tool calls      │               │  · tope de iteraciones (CA1)             │
│  · confirmación ⬤  │               │  · confirmación humana (CA3)             │
└────────────────────┘               │  · sesiones en memoria (sin BD)          │
                                     └───────┬──────────────────────┬────────────┘
                                             │                      │
                                  src/llm/ (adaptador)      src/tools/proveedor.ts
                                  anthropic | openai |      (zod + execute)
                                  guiado (sin LLM)                  │
                                             │                      ▼
                                             │            ┌────────────────────────┐
                                             │            │ application/           │
                                             │            │ casos de uso + puertos │
                                             │            └───────────┬────────────┘
                                             │                        ▼
                                             │            ┌────────────────────────┐
                                             │            │ domain/               │
                                             │            │ reglas puras RN1..RN3  │
                                             │            └────────────────────────┘
                                             │                        ▲
                                             │            ┌────────────────────────┐
                                             └───────────▶│ infrastructure/       │
                                                          │ fs | exceljs | pdfkit  │
                                                          └───────────┬────────────┘
                                                                      ▼
                                        fixtures/ (solo lectura)   out/ (escritura)
```

### 2.2 Dónde vive cada cosa (separación que evalúa el PRD)

| Preocupación | Ubicación | Por qué |
|---|---|---|
| **Comportamiento** (qué hace y cómo lo pide) | `agent/prompt.md` | Cambiar el tono, el flujo o las prohibiciones al modelo no toca una línea de TypeScript. |
| **Conocimiento** (proceso, país, sinónimos, vigencias) | `src/knowledge/registro-proveedor.md` + `src/domain/reglas.ts` | El conocimiento del proceso está separado de las instrucciones al modelo. |
| **Ejecución** (lo que toca el disco) | `src/infrastructure/` | Cambiar exceljs por otra librería no toca el dominio ni las herramientas. |
| **Exposición al modelo** | `src/tools/proveedor.ts` | Un solo punto donde se definen el nombre visible, el JSON Schema y el `execute`. |

### 2.3 Clean architecture aplicada

Las dependencias apuntan hacia adentro y solo en una dirección:

```
domain  ←  application  ←  infrastructure
   ↑            ↑                ↑
   └──────── tools/proveedor.ts ─┘        (tools depende de application e infrastructure)
                ↑
             server.ts
```

- `src/domain/` no importa nada del proyecto: solo tipos y funciones puras (`mapearCampos`,
  `evaluarSoportes`, `evaluarListoParaFirma`, `resolverRuta`, `normalizar`). Es la parte que se
  prueba en `tests/reglas.test.ts` sin tocar el disco.
- `src/application/` define los **puertos** (`RepositorioProveedor`, `GeneradorFormularios`) y los
  **casos de uso** (`ServicioRegistroProveedor`). No sabe si el maestro está en un JSON o en una
  base de datos.
- `src/infrastructure/` implementa esos puertos: `RepositorioFS`, `GeneradorFormulariosAdapter`
  (exceljs + pdfkit), `registroLog`.
- `src/tools/proveedor.ts` es la **capa de presentación hacia el modelo**: traduce el caso de uso
  al contrato `{ description, args: zod, execute }`.
- `src/llm/` es un **adaptador de salida**: `AdaptadorLLM` es una interfaz propia
  (`responder(mensajes, herramientas) → respuesta`). Cambiar de proveedor no toca el ciclo.

Regla práctica que se puede comprobar: `src/domain/` no importa `node:*`, `exceljs`, `pdfkit` ni
`fetch`; `src/application/` no importa `node:fs`.

## 3. El ciclo del agente

### 3.1 Bucle

```
POST /api/chat  { sessionId, message }
   │
   ├─▶ se añade el mensaje del usuario al historial de la sesión
   │
   └─▶ for iteración in 0..MAX_ITERACIONES (25)          ← CA1
         │
         ├─▶ adaptador.responder(historial, definiciones_de_herramientas)
         │      ├─ sin llamadas  → la respuesta del modelo ES la respuesta al usuario → fin
         │      └─ con llamadas  → se validan los argumentos con zod
         │
         ├─▶ por cada llamada:
         │      · zod.safeParse → si falla, se devuelve el error al modelo (no se ejecuta)
         │      · execute(args, ctx) → SIEMPRE devuelve string JSON {ok,data} | {ok,error}
         │      · se registra en out/log.jsonl y out/<caso>/log.jsonl        ← CA4, RN5
         │      · se guarda en el historial visible del chat                   ← CA4
         │
         └─▶ se devuelven los resultados al modelo y se repite
   │
   └─▶ respuesta al cliente: { reply, toolCalls[], needsConfirmation }
```

- **CA1 (tope de iteraciones).** `MAX_ITERACIONES` (25 por defecto, configurable). Si se agota, el
  agente responde con lo que tiene y con lo que falta, en lugar de cortar en silencio.
- **CA2 (el modelo no afirma valores).** El prompt lo prohíbe y el diseño lo hace innecesario:
  los valores solo existen dentro del `data` que devuelven las herramientas. Si el modelo inventa
  un NIT, ese NIT no está en ninguna herramienta y el resumen no lo puede mostrar. La única
  excepción controlada es el campo `requiere_confirmacion`, que se marca explícitamente para
  revisión humana.
- **CA3 (confirmación humana).** Dos barreras: (1) el modelo debe terminar el turno con una
  pregunta; el front la resalta con `needsConfirmation`. (2) la herramienta `simular_envio` exige
  `confirmado: true` y devuelve `{ok:false, error:"requiere confirmacion explicita"}` si no lo
  tiene. Sin confirmación, **no hay archivo y no hay envío**. La confirmación vale para el turno
  inmediatamente anterior (RN4).
- **CA4 (visibilidad).** Cada llamada queda en `toolCalls` de la respuesta de la API, en el
  historial de la sesión (`GET /api/sessions/:id`) y en `out/log.jsonl` y `out/<caso>/log.jsonl`.
- **CA5 (errores).** Un error de herramienta o de proveedor se devuelve al modelo como
  `{ok:false,error}` o se muestra en el chat en lenguaje claro; la sesión no muere. Un caso malo no
  impide el siguiente (verificado en `demo.ts` con los 4 casos).

### 3.2 Modo determinista (sin clave de proveedor)

`src/llm/guiado.ts` implementa la misma interfaz `AdaptadorLLM` y ejecuta el mismo ciclo con un
plan fijo: `leer_solicitud → mapear_campos → generar_formulario → armar_paquete → resumen con
pregunta de confirmación → simular_envio`. Los valores del resumen salen **de los resultados de las
herramientas**, no de una segunda fuente. Sirve para que el chat de la defensa funcione incluso sin
red o sin clave, y para reproducir la conversación del §11 del PRD de forma exacta.

## 4. Elección del modelo

| Aspecto | Decisión |
|---|---|
| Proveedor | **MiniMax** (plan M), modelo `MiniMax-M3.1-Flash`, por su endpoint **compatible con Anthropic** (`https://api.minimax.io/anthropic/v1/messages`). Alternativas en el código: **Anthropic**, **OpenAI o cualquier compatible**, y **modo determinista** si no hay credencial. |
| Por qué | (1) El endpoint compatible con Anthropia trae **tool calling nativo** (`tools` con `input_schema`, respuesta con bloques `tool_use`), que es exactamente el contrato que exige el PRD; es el protocolo que MiniMax recomienda. (2) El trabajo es de *extracción y estructuración* sobre textos cortos y muy tipados (glosario, plantillas, maestro): no hace falta el modelo más caro del mercado, sino uno que llame herramientas de forma estable y no invente. (3) El ciclo del agente no depende del proveedor: la interfaz `AdaptadorLLM` es propia y ya hay cuatro implementaciones. |
| Diseño | La interfaz `AdaptadorLLM` es propia: cambiar de proveedor es escribir un `responder()` más. `src/llm/minimax.ts` reutiliza el adaptador compatible con Anthropic, así que no hay duplicación de código entre MiniMax y Anthropic. |
| Seguridad | La credencial (Subscription Key del plan M) vive solo en el backend, leída de variable de entorno. No se expone en `/api/health` (solo devuelve `provider` y `model`), ni en el front, ni en el repositorio, ni en los logs. **Nunca se escribe en el `Dockerfile`**: una clave en una capa de imagen es legible con `docker history`. |

### 4.1 Análisis de costos (por caso procesado)

Supuestos: 1 caso ≈ 4 turnos (leer → mapear → generar → armar) + 1 turno de resumen; system
prompt ≈ 700 tokens; definiciones de las 5 herramientas ≈ 1.200 tokens; resultado de cada
herramienta ≈ 400–1.500 tokens; respuesta del modelo ≈ 300 tokens.

| Concepto | Tokens por caso |
|---|---|
| Entrada (prompt + herramientas + historial) | ≈ 12.000 |
| Salida (razonamiento + respuesta) | ≈ 1.500 |
| **Total por caso** | **≈ 13.500** |
| **Total por mes (8–12 casos)** | **≈ 110.000 – 160.000 tokens** |

**Con el plan M de MiniMax el costo no es por token sino por cuota incluida en la suscripción**:
lo que importa es el consumo. Con 8–12 casos al mes el agente consumiría del orden de
**0,1 – 0,2 millones de tokens al mes**, varios órdenes de magnitud por debajo de los planes de
pago por uso. El consumo real se lee en la consola de MiniMax (panel de uso) y, en el propio
agente, el tope `MAX_TOKENS_SESION` impide que una sesión desmedida agote la cuota.

Como referencia de mercado, con la lista pública de precios de Anthropic
(claude-sonnet-4-5: 3 USD/1M de entrada y 15 USD/1M de salida) el mismo trabajo costaría
≈ 0,06 USD por caso, es decir **≈ 0,5 – 0,7 USD al mes**; con MiniMax el plan M ya está pagado
adelantado y el agente consume una fracción marginal de la cuota.

Los topes que protegen la cuota: `MAX_ITERACIONES=25` corta el bucle, `MAX_TOKENS_SESION=120000`
cierra la sesión, y `src/llm/guiado.ts` (modo determinista) tiene costo **cero** y cubre la
verificación y la demo.

## 5. Diseño del formato "portal web" (P2, solo documentación)

El PRD pide el diseño, no la implementación. Lo que hace el agente hoy: responde
`formato no soportado` y produce `out/<caso>/valores-portal.md` con cada campo, su valor y su
estado, listo para copiar. El caso `pa-logistica-istmo` lo ejercita.

**Estrategia sugerida (por fases).**

1. **Fase 1 — semántica de portales (sin automatización).** Un catálogo de portales (URL, versión
   del formulario, mapa de campos → etiquetas del maestro, ruta del campo en el DOM) versionado en
   el repositorio. El agente resuelve los valores y genera un archivo de valores por portal, más
   un guion de pasos. La persona copia y pega. Es lo que ya hace la solución de este reto y cubre
   el 80 % del valor: el trabajo caro es el cruce de datos, no el clic.
2. **Fase 2 — RPA de navegador para portales estables.** Playwright con un perfil persistente por
   portal, un `selectors.json` versionado y assertions sobre el texto de cada campo antes de
   escribir. Solo para portales sin CAPTCHA ni MFA, con lista blanca explícita.
3. **Fase 3 — extensión de navegador.** La extensión corre en la sesión del usuario, con los
   permisos mínimos, y el agente prepara el "paquete de llenado" que la extensión aplica. Avoids
   storing credentials: the human is already logged in.

**Límites reales.** CAPTCHA y MFA rompen la automatización (y están bien: son el control de
seguridad del cliente). Los cambios de layout rompen los selectores, por eso el catálogo debe
versionar la versión del formulario y fallar cerrado si el DOM no coincide, en vez de escribir en
la celda equivocada. El MFA por SMS o token no se puede automatizar de forma aceptable.

**Dónde viven las credenciales.** Nunca en el repositorio, nunca en el prompt del modelo, nunca en
los logs ni en `out/`. Viven en el gestor de secretos de la organización (AWS Secrets Manager /
Vault / variable de entorno cifrada) y se inyectan en el navegador en tiempo de ejecución por la
persona que opera el portal, o se pide MFA al usuario en el momento. El modelo **nunca** ve
contraseñas: no tiene ninguna herramienta capaz de autenticarse.

**Qué hace el agente y qué hace el humano.**

| Agente | Humano |
|---|---|
| Resuelve los valores desde el maestro | Ingresa usuario y contraseña |
| Detecta qué campos pide el portal | Resuelve el CAPTCHA / MFA |
| Arma el archivo de valores y el checklist | Hace clic en "Enviar" |
| Detecta que el portal cambió y avisa | Firma y envía el paquete |

El mínimo humano: **ingreso de credenciales y clic en "Enviar"**, siempre.

## 6. Decisiones de diseño y trade-offs

### 6.1 Las herramientas recalculan el mapeo en lugar de confiar en el modelo

`generar_formulario` y `armar_paquete` reciben el caso y **recalculan** el cruce contra el
maestro. El `mapeo` que el modelo puede mandar es opcional y se ignora para el cálculo.

- **Descartado:** que el modelo pase los valores ya resueltos y que la herramienta los escriba.
- **Por qué:** el modelo es un sintetizador, no una fuente de datos; con esa opción, un error del
  modelo terminaba en el Excel del cliente sin que nadie lo notara. Con el recálculo, el valor que
  llega al formulario siempre viene del maestro y es trazable (`ruta_origen`).
- **Costo:** se recalcula el mapeo (milisegundos) y se pierde la posibilidad de que el modelo
  resuelva un caso que el glosario no cubre. Aceptable: la alternativa sería que el modelo invente.

### 6.2 Fecha de ejecución = fecha de la solicitud (determinista) en lugar de "hoy"

Al avaliar vigencias se usa la fecha de la solicitud del caso, con `FECHA_EJECUCION` como override.

- **Descartado:** usar `new Date()`.
- **Por qué:** el PRD exige que `demo.ts` produzca el mismo resultado en ejecuciones consecutivas.
  Con la fecha real, la respuesta cambia cada día (hoy, 19-10-2026, `camara_comercio` —vigente
  hasta 2026-09-30— y `parafiscales` ya estarían vencidos y ningún caso quedaría
  `listo_para_firma`). Con la fecha del caso, la evaluación es reproducible y auditable:
  "vigente respecto de la fecha en que el cliente pidió el registro".
- **Costo:** un soporte vencido hoy pero vigente el día de la solicitud se considera vigente. Se
  mitiga con la variable de entorno y con la nota de vigencia en el checklist.

### 6.3 Los formularios se **sintetizan**: los fixtures no traen `.xlsx` ni `.pdf`

La plantilla del fixture es solo una lista de coordenadas (`hoja`, `celda_etiqueta`,
`celda_valor`) o de etiquetas. No hay un libro de Excel ni un PDF de partida.

- **Descartado:** exigir el archivo original del cliente (no está en los fixtures y no se puede
  adivinar su maquetación).
- **Por qué:** el PRD es explícito en P1 ("se acepta un PDF generado"), y en P0 la evaluación es
  "escribir cada etiqueta y su valor exactamente en la hoja y celda indicadas". Se genera el libro
  con esas hojas y esas celdas exactas, con la etiqueta en su celda y el valor en su celda.
- **Costo:** no se conserva el diseño gráfico del cliente. En producción, el paso siguiente es
  enviar la plantilla original como *template* y llenarla con una librería que respete estilos
  (el puerto `GeneradorFormularios` está preparado para eso: cambiar de generador no toca el
  dominio ni las herramientas).

### 6.4 Front en HTML plano servido por el mismo proceso, sin framework

- **Descartado:** React + Vite (o Svelte/Vue).
- **Por qué:** el PRD evalúa que el chat "funcione", no el stack del front. Sin paso de build, el
  arranque es inmediato y la defensa no depende de que `npm run build` termine bien. El front sí
  cumple lo pedido: historial, campo de entrada, indicador de "pensando", **cada llamada a
  herramienta visible** (nombre, argumentos y resultado) y **resaltado de la confirmación**.
- **Costo:** sin componentes reutilizables ni estado tipado. Si el reto creciera, se migraría el
  front a un framework sin tocar el backend, porque la API (`/api/chat`) ya está definida por
  contrato JSON.

### 6.5 Modo determinista como proveedor de primera clase

- **Descartado:** dejar el chat inservible sin clave y limitarnos a `demo.ts`.
- **Por qué:** el entregable 3 es una URL donde el chat "pueda ser probada durante la defensa".
  Con el modo determinista, esa URL funciona siempre, incluso sin red, y el comportamiento del
  ciclo (herramientas, confirmación, trazabilidad) es idéntico al del modo LLM.
- **Costo:** una implementación más que mantener. Se compensa porque comparte la interfaz
  `AdaptadorLLM` y no duplica reglas: el plan es fijo, los valores no.

### 6.6 Alias de tipos de soporte en el conocimiento, no en el código de negocio

`certificado_cumplimiento_tributario` no existe en el índice de soportes; el cliente lo pide y el
repositorio tiene `parafiscales`. Sin una tabla de equivalencias, ese soporte quedaría *ausente* y
bloquearía la firma de un caso que en realidad tiene su soporte.

- **Descartado:** (a) no resolver el alias y bloquear el caso; (b) hardcodear el caso.
- **Por qué:** la tabla `ALIAS_SOPORTES` está en `src/domain/reglas.ts` (datos de negocio), el
  alias aplicado queda **anotado en el checklist** y el supuesto está documentado en §7. La opción
  (a) es defendible y es un cambio de una línea: basta con quitar el alias y el caso queda
  bloqueado con el motivo explícito.
- **Costo:** una equivalencia semántica que un humano debe validar. Por eso se documenta y se
  muestra en el checklist, no se aplica en silencio.

## 7. Supuestos que tomé

1. **Los fixtures son la variabilidad real** y el maestro está actualizado. En producción hace
   falta un dueño del dato y una fecha de actualización por clave.
2. **La fecha de ejecución por defecto es la fecha de la solicitud** (§6.2). Se puede forzar con
   `FECHA_EJECUCION`.
3. **`certificado_cumplimiento_tributario` ≈ `parafiscales`** (§6.6). Si la equivalencia no es
   correcta, el soporte debe quedar *ausente* y el caso bloqueado: se cambia quitando el alias.
4. **El identificador tributario de un cliente extranjero se llena con el NIT** y se marca
   `requiere_confirmacion` con la nota "identificador extranjero" (RN1 literal). El valor no se
   descarta: se entrega proposed y se deja a criterio de la analista.
5. **Un campo `requiere_confirmacion` se escribe en el formulario** con su valor propuesto, y a la
   vez se lista en el checklist para revisión. Un campo `faltante` se deja **en blanco**: nunca se
   escribe un valor inventado ni un texto que parezca un dato.
6. **Los datos numéricos se escriben en su forma cruda** (`98000000000`), sin formato de miles ni
   símbolo de moneda, para no introducir una conversión que el maestro no define.
7. **"El formato de salida lo define el cliente"**: `xlsx` → Excel, `pdf` → PDF generado, `portal`
   → valores copiables. El fixture de `pa-logistica-istmo` trae `plantilla-campos.json` aunque su
   formato es `portal`; se usa como lista de campos del portal.
8. **El envío es simulación local** (`ENVIO-SIMULADO.md`), nunca correo real, tal como pide el PRD.
9. **Sin base de datos**: las sesiones viven en memoria del proceso. Al reiniciar el servidor se
   pierden; el historial durable queda en `out/log.jsonl`.

## 8. Cobertura de historias de usuario

| HU | Estado | Qué falta para producción |
|---|---|---|
| **HU-1** Leer la solicitud | **Hecho** | Leer el correo real (MIME, adjuntos) en lugar del JSON normalizado. Los casos con PDF adjunto se parsearían con un extractor. |
| **HU-2** Mapear campos al maestro | **Hecho** | Glosario ampliado y, sobre todo, **aprendizaje de sinónimos**: cada etiqueta que el agente no reconoce debería proposes una equivalencia que un humano aprueba y queda en el glosario. |
| **HU-3** Generar el formulario | **Hecho** (P0 y P1) · **Parcial** (P2) | P0/P1: enviar la plantilla original del cliente y rellenar sobre ella conservando estilos. P2: portal automatizado (diseño en §5). |
| **HU-4** Armar el paquete para firma | **Hecho** | Firma electrónica, y adjuntar los soportes en el correo (hoy el borrador no se envía). |
| **HU-5** Manejo de errores | **Hecho** | Reintentos con backoff y cola de mensajes cuando el proveedor falla. |
| **HU-1..HU-5 en el chat** | **Hecho** | Streaming de tokens, historial paginado, métricas por sesión. |

**Fuera de alcance, por decisión del PRD:** portal web automatizado, firma electrónica,
integración real con correo, autenticación de usuarios y persistencia en base de datos.

## 9. Uso de IA para construir la solución

| Herramienta | Para qué | Qué aportó | Qué descarté y por qué |
|---|---|---|---|
| **Claude (agente de código, en IDE)** | Escribir la mayoría del código: dominio, casos de uso, herramientas, adaptadores, front y pruebas | Estructura inicial, redacción de los zod, del front y de las pruebas | — |
| **Claude (chat, sin IDE)** | Redactar `agent/prompt.md` y `src/knowledge/registro-proveedor.md` | Separar comportamiento y conocimiento, y hacer explícitas las prohibiciones (no inventar, confirmar, no filtrar datos bancarios) | Una versión que metía reglas de negocio dentro del prompt: se descartó porque las reglas viven en el dominio, no en el prompt |
| **Claude (chat)** | Revisar el PRD y extraer la lista de aceptacion del PRD | Detectar que `certificado_cumplimiento_tributario` no estaba en el índice de soportes y que las vigencias ya estaban vencidas | Nada relevante |
| **Asistente de IA genérico** | Ideas para la sección de portal web (§5) | Estructura de fases y lista de límites | Automatizar portales con CAPTCHA: se descartó por seguridad y porque el humano debe operar esos portales |

**Lo que se hizo a mano y no se delegó a la IA:** la decisión de que las herramientas recalculan el
mapeo, la elección de la fecha de ejecución por defecto, la tabla de alias de soportes y la
conclusión de que el NIT llena un campo extranjero con estado `requiere_confirmacion`. Son
decisiones de negocio: la IA puede proponerlas, pero la responsabilidad es de quien entrega.

**Regla que se aplicó durante todo el desarrollo:** la IA no inventó ni un solo valor de negocio.
Todos los datos que aparecen en un formulario salen de `fixtures/reto-01/repositorio/maestro.json`,
y todos los mensajes de error que ve la analista se probaron ejecutando el código.

## 10. Riesgos de producción y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **El modelo "completa" un campo faltante** con un valor plausible | Dato falso en un formulario que va firmado | Las herramientas son la única fuente; el valor se recalcula contra el maestro; el prompt lo prohíbe; los `faltantes` se listan en el checklist y quedan en blanco en el formulario |
| **Plantillas peores que las del fixture** (celdas movidas, campos duplicados) | Formulario mal diligenciado | Validar que cada celda de la plantilla existe antes de escribir; fallar cerrado con un error claro en lugar de escribir en la celda de al lado; catálogo versionado de plantillas por cliente |
| **Soporte vencido que el sistema no detecta** | Se envía un paquete con documentación inválida | Vigencia evaluada contra el índice, con fecha explícita en el checklist; bloqueo de `listo_para_firma`; alerta al vencer, no solo en el momento de usarlo |
| **Datos bancarios filtrados a un destinatario externo** | Incidente de seguridad y de cumplimiento | RN2: los datos bancarios solo se llenan si la plantilla los pide y nunca van en el borrador de correo; prueba que lo verifica |
| **Fuga de la clave del modelo** | Gasto no autorizado, o cuenta bloqueada por MiniMax (la documentación avisa que una clave publicada puede deshabilitarse automáticamente) | La credencial solo se lee de una variable de entorno del backend; nunca está en el front, el repositorio, los logs ni las respuestas de la API. **Nunca se escribe en el `Dockerfile`** (quedaría en las capas de la imagen): llega en runtime desde Coolify (Environment Variables), desde un `.env` con `chmod 600` en el VPS, o desde un secreto de Docker. `scripts/probar-proveedor.ts` verifica la clave **sin imprimirla**. `MAX_TOKENS_SESION` acota el gasto por sesión. |
| **Un caso manipulado (path traversal) lee archivos fuera del repo** | Fuga de datos | El nombre del caso se valida contra un patrón estricto y todas las rutas se resuelven desde `ctx.directory`; las herramientas no ejecutan comandos de shell |
| **Alta en un portal con CAPTCHA o MFA** | Bloqueo operativo | Fuera del alcance automatizado: el humano opera el portal con los valores ya resueltos (§5) |
| **La IA del modelo se equivoca al resumir** | La analista se gu��a por un resumen incorrecto | Todo dato del resumen viene del `data` de una herramienta; los paths de los artefactos se citan literalmente; el detalle completo está en `checklist.md` |
| **El agente se usa para enviar spam o envelopes massivos** | Abuso de la herramienta | El envío es simulación local; sin integración de correo no hay superficie de envío; las sesiones tienen tope de tokens |
| **Dependencia de un solo proveedor** | Caída del servicio | La interfaz `AdaptadorLLM` permite cambiar de proveedor con una implementación nueva; el modo determinista mantiene el chat vivo |

---

## Apéndice A · Evidencia de verificación

No es una declaración de intenciones: son los comandos ejecutados y su resultado.

| Qué se verificó | Comando | Resultado |
|---|---|---|
| Los 4 casos del reto, sin modelo | `bun run demo.ts` | 4/4 casos, 0 fallos, salida en `out/` |
| El envío se rechaza sin confirmación (RN4) | incluido en `demo.ts` | el caso reporta `requiere confirmacion explicita` |
| Reglas de dominio (RN1, HU-2, RN3, CA3) | `bun test` | 22 pruebas, 0 fallos |
| Formato del historial hacia los proveedores | `bun test` (adaptador) | Anthropic y OpenAI cubiertos con pruebas puras |
| Tipos, sin `any` | `bunx tsc --noEmit` | sin errores |
| El ZIP es autocontenido | `unzip` → `bun install` → `bun run demo.ts` en un directorio limpio | 0 fallos, 15/15 pruebas |
| Valores en las celdas exactas de la plantilla | lectura del `.xlsx` generado | `B3/C3` … `B15/C15` y hoja `Datos Bancarios` correctos |
| PDF legible | extracción de texto | etiqueta y valor en líneas separadas, sin solapamientos |
| Determinismo | dos ejecuciones seguidas | contenido idéntico (el `.xlsx` solo difiere en el timestamp interno del ZIP) |
| Instancia viva, extremo a extremo | `bun run scripts/smoke-test.ts <url>` | 7/7 verificaciones, local y por la URL pública |
| Petición a MiniMax sin tocarla | `bun test` (minimax) | endpoint `/anthropic/v1/messages`, `Authorization: Bearer`, `x-api-key`, cuerpo con `model`, `system` y `tools[].input_schema` |
| Selección de proveedor | `bun test` (minimax) | `minimax` con `MINIMAX_API_KEY`; prioridad en `auto`; `guiado` sin credencial |
| La credencial no se imprime | `scripts/probar-proveedor.ts` | el script reporta longitud y resultado, nunca el valor |
| Puerta de confirmación en el chat | guion del §11 del PRD | procesar → 4 tool calls + `needsConfirmation`; "envíalo" → `ENVIO-SIMULADO.md`; sin confirmación previa → vuelve a preguntar |

**Lo que no está verificado** (y por qué no importa para la defensa):

| Hueco | Por qué | Mitigación |
|---|---|---|
| Llamada real a la API del proveedor | No hay ninguna clave en el entorno | El formato del historial —la parte que más se rompe en silencio— está cubierto por pruebas; la llamada HTTP es un `fetch` con manejo de error explícito (CA5). El modo determinista cubre la demostración sin depender de la red. |
| Construcción de la imagen Docker | No hay Docker en la máquina de desarrollo | `Dockerfile` mínimo (`oven/bun:1.4.3-alpine`, `bun install --frozen-lockfile`, `HEALTHCHECK` incluido) y verificación de la instancia con `scripts/smoke-test.ts` después del deploy. |
| Deploy en el VPS | Es una operación del usuario | `bun run scripts/smoke-test.ts https://tu-dominio` da el veredicto en 30 segundos, con el mismo guion que usará la defensa. |
