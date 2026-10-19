# Reto 01 · Agente conversacional "Registro como Proveedor"

Periferia IT Group · Equipo Perxia 2.0 · Pruebas técnicas de IA

Agente que recibe la solicitud de registro como proveedor de un cliente, cruza los campos
pedidos con el repositorio maestro de Periferia, genera el formulario en el formato que pide el
cliente (Excel o PDF) y arma el paquete con soportes, checklist y borrador de correo, listo para
la firma del representante legal. **El agente prepara y pregunta; nunca firma ni envía.**

---

## 1. Levantar en local

Requisitos: **Bun 1.x** o **Node 20+** (probado en Bun 1.4.3).

```bash
bun install
cp env.example .env      # opcional: con .env defines la clave del modelo
bun run dev              # front + backend en http://localhost:3000
```

Un solo comando (`bun run dev`) levanta el backend y sirve el front de chat. Arranca en menos de
2 segundos en máquina limpia: no hay paso de build, el front es HTML plano servido por el mismo
proceso.

> El archivo de variables de entorno se llama `env.example` (no `.env.example`) porque el entorno
> de trabajo bloquea la escritura de rutas sensibles. El contenido es el que pide el PRD: nombres
> de variable y valores vacíos. Se copia con `cp env.example .env`.

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `anthropic` \| `openai` \| `auto`. `auto` usa Anthropic si hay `ANTHROPIC_API_KEY`, OpenAI si hay `OPENAI_API_KEY`. |
| `ANTHROPIC_API_KEY` | — | Clave del modelo. **Solo en el backend.** Nunca en el front, el repo, los logs ni las respuestas de la API. |
| `OPENAI_API_KEY` | — | Alternativa (o cualquier API compatible: Groq, Together, OpenRouter, LM Studio) vía `OPENAI_BASE_URL`. |
| `LLM_MODEL_ANTHROPIC` | `claude-sonnet-4-5` | Modelo de Anthropic. |
| `LLM_MODEL_OPENAI` | `gpt-4.1-mini` | Modelo de OpenAI. |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta → modelo por turno (CA1). |
| `MAX_TOKENS_SESION` | `120000` | Tope de tokens estimados por sesión: nadie gasta la clave sin límite. |
| `FECHA_EJECUCION` | vacío | Fecha para evaluar vigencias de soportes. Vacío = fecha de cada caso (determinista). |
| `PORT` | `3000` | Puerto HTTP. |

**Sin ninguna clave configurada el chat sigue funcionando**: entra el *modo determinista*
(`src/llm/guiado.ts`), que recorre el mismo ciclo de herramientas con un plan fijo y redacta el
resumen con los valores que devuelven las herramientas. Sirve para la defensa y para correr el
proyecto sin depender de la red.

## 2. Verificación sin modelo (demo)

```bash
bun install && bun run demo.ts
```

Procesa los 4 casos de `fixtures/reto-01/casos/` llamando **directamente a las herramientas**, sin
consumir ningún modelo. Imprime por caso: país, cliente, formato, llenados / por confirmar /
faltantes, ruta del formulario, estado `listo_para_firma` y soportes presentes/ausentes/vencidos.
Además comprueba que el envío **se rechaza sin confirmación explícita**. Termina con código de
salida 1 si algún caso falla.

## 3. Pruebas

```bash
bun test            # 15 pruebas de las reglas de dominio (RN1, HU-1/HU-2, RN3, CA3)
bunx tsc --noEmit   # typecheck estricto, sin `any`
```

## 4. Enlace para probar

| Opción | Cómo | Nota |
|---|---|---|
| Local | `bun run dev` → http://localhost:3000 | Válido para la defensa si no hay despliegue en vivo |
| Túnel efímero | `bun run tunel` (o `npx untun --port 3000`) | URL pública en segundos, sin cuenta; cambia al reiniciar |
| Deploy | `bun run start` en Render / Railway / Fly / Vercel | URL estable; requiere cuenta y token del proveedor |

El enlace usado en la defensa se anota en el correo de respuesta. Si no hay deploy disponible,
el PRD §9.3 acepta correrlo en local en la defensa con **-10**.

## 5. Estructura del repositorio

```
reto-01/
├── agent/prompt.md              # COMPORTAMIENTO: el system prompt, fuera del código
├── src/
│   ├── domain/                  # REGLAS puras: entidades, mapeo, RN1..RN3
│   ├── application/             # CASOS DE USO + puertos (interfaces)
│   ├── infrastructure/          # ADAPTADORES: fs, exceljs, pdfkit, log
│   ├── tools/proveedor.ts       # EXPOSICIÓN AL MODELO: zod + execute
│   ├── llm/                     # adaptador de proveedor + implementaciones
│   ├── knowledge/               # CONOCIMIENTO del proceso
│   └── server.ts                # API HTTP + ciclo del agente
├── web/                         # front de chat (HTML plano, sin build)
├── fixtures/reto-01/            # entregado por Periferia, no se modifica
├── out/                         # generado en ejecución (no se versiona)
├── modulo/                      # bonus 9.4: agente empaquetado
├── scripts/                     # sincronización del módulo
├── demo.ts                      # verificación sin modelo
├── tests/                       # pruebas de reglas de dominio
├── env.example                  # variables requeridas, sin valores
├── README.md
└── SOLUCION.md
```

Dependencias: `zod` (obligatoria por el PRD), `exceljs` (escritura de `.xlsx`), `pdfkit`
(generación de `.pdf`). Justificación en `SOLUCION.md` §6.

## 6. Uso en el chat

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

El chat muestra cada llamada a herramienta (nombre, argumentos y resultado), el indicador de
"pensando" y, cuando el agente pide confirmación, un aviso resaltado. Un segundo mensaje
("sí, envíalo") produce `out/<caso>/ENVIO-SIMULADO.md`; **nunca** un correo real.

## 7. Reglas del repositorio

- `out/`, `node_modules/` y `.env` no se versionan.
- `fixtures/` no se modifica.
- El módulo del bonus se regenera con `bun run scripts/sincronizar-modulo.ts` para que nunca
  diverja de las fuentes de verdad.
