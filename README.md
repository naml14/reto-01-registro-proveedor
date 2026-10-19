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
bun test            # 22 pruebas: reglas de dominio (RN1, HU-1/HU-2, RN3, CA3) y formato de mensajes de los adaptadores de LLM
bunx tsc --noEmit   # typecheck estricto, sin `any`
bun run smoke http://localhost:3000   # verificacion de extremo a extremo contra una instancia viva
```

`scripts/smoke-test.ts` comprueba 7 cosas contra una URL: salud del backend, front de chat,
estáticos, ciclo del agente (leer → mapear → generar → armar), confirmación humana con envío
simulado y consulta del historial de sesión. Sale con código 0 si todo pasa. Es el mismo guion que
va a usar la defensa, así que **si el smoke test pasa, la URL sirve**.

## 4. Enlace para probar

### 4.1 Despliegue en el VPS con Coolify (recomendado para la defensa)

El proyecto incluye `Dockerfile` y `.dockerignore`, así que el despliegue es reproducible: el
servidor construye la imagen desde cero, no copia nada de tu PC.

En Coolify (Application → New Resource → Docker Compose / Dockerfile):

| Campo | Valor |
|---|---|
| Repositorio | el repo donde subiste el proyecto (el `reto-01` de este zip, o el repo de Git) |
| Build Pack / Dockerfile | `Dockerfile` (incluido) |
| Puerto interno | `3000` (Coolify lo inyecta como variable `PORT`, el servidor la lee) |
| Dominio | el subdominio de la defensa, p. ej. `registro.periferia-ficticia.com` |
| Variables de entorno | `ANTHROPIC_API_KEY` (opcional) y `FECHA_EJECUCION` si quieres fijar la fecha |
| Réplicas | **1** (las sesiones viven en memoria; con 2 réplicas el historial se parte) |
| Health check | el del `Dockerfile`: `GET /api/health` |

El proceso escucha en `0.0.0.0` (`HOST`), que es lo que necesita el proxy del VPS. El contenedor
también trae `HEALTHCHECK` y cierre ordenado por `SIGTERM`, para que el redeploy de Coolify no
deje conexiones colgadas.

**Verifica el despliegue en 30 segundos**, desde tu máquina o por SSH en el VPS:

```bash
bun run scripts/smoke-test.ts https://tu-dominio
```

Imprime 7 verificaciones (salud, front, estáticos, ciclo del agente, confirmación humana e
historial) y sale con código 0 solo si todas pasan. Es exactamente lo que va a hacer la
defensa, así que si el smoke test pasa, la URL sirve.

### 4.2 Alternativas

**Enlace actual de la defensa (túnel público):**

```
https://requested-comfort-smart-aaa.trycloudflare.com
```

Es un *quick tunnel* de Cloudflare sobre `http://localhost:3000`: sin cuenta, sin registro y sin
interstitial. **La URL cambia cada vez que se levanta el túnel y depende de que tu PC siga
encendida**: sirve como respaldo, pero para la defensa conviene el VPS.

Para regenerarlo:

```bash
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
# o, sin instalar nada
npx --yes untun --port 3000
```

| Opción | Cómo | Nota |
|---|---|---|
| VPS + Coolify | `Dockerfile` del repo | URL estable, no depende de tu PC |
| Local | `bun run dev` → http://localhost:3000 | Válido para la defensa si no hay despliegue en vivo |
| Túnel efímero | `cloudflared tunnel --url http://localhost:3000` | URL pública en segundos, sin cuenta; cambia al reiniciar |

Si no hay despliegue disponible, el PRD §9.3 acepta correrlo en local en la defensa con **-10**.

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
├── scripts/                     # sincronización del módulo, empaquetado y smoke test
├── tests/                       # pruebas de reglas de dominio y de adaptadores
├── Dockerfile                   # imagen de producción (VPS / Coolify)
├── .dockerignore
├── demo.ts                      # verificación sin modelo
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
