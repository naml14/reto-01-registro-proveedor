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

La lista completa está en la sección 2. Para arrancar basta con:

```bash
bun install
cp env.example .env      # opcional: con .env defines la credencial del modelo
bun run dev              # front + backend en http://localhost:3000
```

## 2. Credencial del modelo (MiniMax): dónde va y cómo se verifica

La credencial del plan M es la **Subscription Key** que aparece en
[Facturación → M Plan](https://platform.minimax.io/console/plan). Se envía como token Bearer y
**no necesita Group ID**. El proyecto usa el endpoint **compatible con Anthropic**, que es el
recomendado por MiniMax y el que trae tool calling nativo:

```
POST https://api.minimax.io/anthropic/v1/messages
Authorization: Bearer <SUBSCRIPTION KEY>
```

Si prefieres el protocolo compatible con OpenAI: `MINIMAX_PROTOCOLO=openai` →
`https://api.minimax.io/v1/chat/completions`.

### Dónde va la clave (en este orden)

| # | Dónde | Cómo | Por qué |
|---|---|---|---|
| 1 | **Coolify (VPS)** | Application → Environment Variables → `MINIMAX_API_KEY` | Cifrada en el panel; se inyecta al contenedor en runtime; nunca pasa por el repo |
| 2 | **`.env` en el VPS** | `cp env.example .env`, pegas la clave, `chmod 600 .env` | Está en `.gitignore` y `.dockerignore`: no llega al repo ni a la imagen |
| 3 | **Secreto de Docker** | `echo -n "CLAVE" > /etc/docker/secrets/minimax_key && chmod 400 /etc/docker/secrets/minimax_key` | El archivo vive fuera del repositorio |

**Dónde nunca va:** en el chat, en el repositorio, en el `Dockerfile` (una clave escrita ahí
queda grabada en las capas de la imagen y se lee con `docker history`), en el front (cualquier
visitante del chat la vería), en los logs ni en `out/`. La propia documentación de MiniMax avisa
que una clave publicada puede ser deshabilitada automáticamente.

### Verifica la clave en 5 segundos

```bash
bun run scripts/probar-proveedor.ts
```

```
Credencial encontrada (180 caracteres, no se muestra).
[OK  ] credencial valida (GET /models -> 200)
       modelos disponibles: MiniMax-M3.1-Flash, MiniMax-M3, ...
[OK  ] modelo MiniMax-M3.1-Flash responde (HTTP 200): "OK"
```

El script **nunca imprime la clave**: solo dice si es válida y si el modelo responde.

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `LLM_PROVIDER` | `minimax` | `minimax` \| `anthropic` \| `openai` \| `auto`. `auto` toma la primera clave que encuentre. |
| `MINIMAX_API_KEY` | — | La Subscription Key. **Solo en el backend.** |
| `MINIMAX_PROTOCOLO` | `anthropic` | `openai` para usar el endpoint compatible con OpenAI. |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/anthropic` | Solo si usas un proxy o un gateway propio. |
| `LLM_MODEL_MINIMAX` | `MiniMax-M3.1-Flash` | Modelo (también `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.5`). |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Alternativas, si algún día se cambian. |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta → modelo por turno (CA1). |
| `MAX_TOKENS_SESION` | `120000` | Tope de tokens estimados por sesión: nadie gasta la clave sin límite. |
| `FECHA_EJECUCION` | vacío | Fecha para evaluar vigencias de soportes. Vacío = fecha de cada caso (determinista). |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Interfaz y puerto. `0.0.0.0` es obligatorio en contenedor. |

**Sin ninguna credencial configurada el chat sigue funcionando**: entra el *modo determinista*
(`src/llm/guiado.ts`), que recorre el mismo ciclo de herramientas con un plan fijo y redacta el
resumen con los valores que devuelven las herramientas. Sirve para la defensa y para correr el
proyecto sin depender de la red.

## 3. Verificación sin modelo (demo)

```bash
bun install && bun run demo.ts
```

Procesa los 4 casos de `fixtures/reto-01/casos/` llamando **directamente a las herramientas**, sin
consumir ningún modelo. Imprime por caso: país, cliente, formato, llenados / por confirmar /
faltantes, ruta del formulario, estado `listo_para_firma` y soportes presentes/ausentes/vencidos.
Además comprueba que el envío **se rechaza sin confirmación explícita**. Termina con código de
salida 1 si algún caso falla.

## 4. Pruebas

```bash
bun test            # 22 pruebas: reglas de dominio (RN1, HU-1/HU-2, RN3, CA3) y formato de mensajes de los adaptadores de LLM
bunx tsc --noEmit   # typecheck estricto, sin `any`
bun run smoke http://localhost:3000   # verificacion de extremo a extremo contra una instancia viva
```

`scripts/smoke-test.ts` comprueba 7 cosas contra una URL: salud del backend, front de chat,
estáticos, ciclo del agente (leer → mapear → generar → armar), confirmación humana con envío
simulado y consulta del historial de sesión. Sale con código 0 si todo pasa. Es el mismo guion que
va a usar la defensa, así que **si el smoke test pasa, la URL sirve**.

## 5. Enlace para probar

### 4.1 Despliegue en el VPS con Coolify (recomendado para la defensa)

El proyecto incluye `Dockerfile` y `.dockerignore`, así que el despliegue es reproducible: el
servidor construye la imagen desde cero, no copia nada de tu PC. **No necesitas Docker en tu
equipo**: Coolify construye en el VPS.

#### Paso 0 · Subir el código a GitHub (desde tu PC)

El repositorio ya es un repo git con 15 commits y **ya está publicado** en:

```
https://github.com/naml14/reto-01-registro-proveedor
```

Si necesitas republicarlo o cambiarlo:

```bash
cd E:/trabajo/periferia/reto-01
gh repo create reto-01-registro-proveedor --public --source=. --push
# o, sobre el repo que ya existe
git push origin main
```

El repo tiene la **raíz = la carpeta `reto-01`** (ahí están `Dockerfile`, `package.json`,
`bun.lock`, `src/`, `web/`, `fixtures/`). Si prefieres un repo privado, usa en Coolify la opción
**Private Repository (with Deploy Key)** y pega la clave pública que te muestre.

#### Paso 1 · New Resource

En Coolify v4: **Projects → New Resource → Public Repository** (columna "Git Based").

| Campo | Valor |
|---|---|
| Repository URL | `https://github.com/naml14/reto-01-registro-proveedor` |
| Branch | `main` |

Pulsa **Check repository** y luego **Continue**.

#### Paso 2 · Configuration

| Campo | Valor | Por qué |
|---|---|---|
| Build Pack | **Dockerfile** | El proyecto trae `Dockerfile` propio; fija `oven/bun:1.4.3-alpine` |
| Dockerfile Location | `/Dockerfile` | Está en la raiz del repo |
| Base Directory | *(vacio)* | La raiz del repo **es** la carpeta `reto-01` |
| Docker Context | `/` | |
| Port | `3000` | El servidor lee `PORT` |
| Health check path | `/api/health` | Lo usa Coolify y el `HEALTHCHECK` de la imagen |
| Replicas | `1` | Las sesiones viven en memoria |

#### Paso 3 · Environment Variables (aqui va la credencial)

Pestaña **Environment Variables** de la aplicación:

| Variable | Valor |
|---|---|
| `MINIMAX_API_KEY` | *(tu Subscription Key del plan M)* |
| `LLM_PROVIDER` | `minimax` |
| `LLM_MODEL_MINIMAX` | `MiniMax-M3.1-Flash` |
| `FECHA_EJECUCION` | *(vacio → fecha de cada caso, determinista)* |

Coolify guarda las variables cifradas en su panel y las inyecta al contenedor **en runtime**. La
clave **no** entra en el repo, ni en la imagen, ni en los logs. No la pongas en `Dockerfile`: ahi
queda grabada en las capas de la imagen y se lee con `docker history`.

#### Paso 4 · Dominio (esto es lo que hace la URL publica)

Pestaña **Domains**:

- Si tienes un dominio: crea un registro **A** apuntando al IP del VPS (ej. `agente.tudominio.com`)
  y añádelo en Domains. Coolify emite el certificado Let's Encrypt solo.
- Si no tienes dominio: el dominio por defecto de Coolify es `*.localhost`, que **no** es público.
  Publica el puerto directamente: en Domains añade `http://<IP_DEL_VPS>:8000` y abre el 8000 en el
  firewall del VPS (`ufw allow 8000/tcp`) y en el grupo de seguridad del cloud.

> El proxy de Coolify (Traefik) escucha en 80/443 y 8000; la aplicación habla con él por la red
> interna del servidor, por eso el contenedor debe escuchar en `0.0.0.0` (ya lo hace: `HOST=0.0.0.0`).

#### Paso 5 · Deploy y verificacion

**Deploy** → mira el log del build (debe instalar dependencias y arrancar el servidor) y luego,
desde tu maquina:

```bash
bun run scripts/smoke-test.ts https://agente.tudominio.com
```

7 verificaciones en 30 segundos. Si sale `Todo OK`, la URL de la defensa sirve.

#### Si el build falla

| Sintoma | Causa probable | Arreglo |
|---|---|---|
| `COPY failed: file not found` | Base Directory mal puesto | Dejalo vacio (la raiz del repo es `reto-01`) |
| `bun install` falla | `bun.lock` desincronizado | Sube el `bun.lock` al repo (ya esta versionado) |
| El contenedor arranca y cae | Falta `PORT` o el puerto no coincide | `PORT=3000` en Environment Variables y `Port = 3000` en Configuration |
| Responde 502 | La app escucha en `127.0.0.1` | Debe usar `HOST=0.0.0.0` (ya esta en el Dockerfile) |
| `401` del proveedor | Credencial mal pegada | `bun run scripts/probar-proveedor.ts` en el VPS |

### 4.2 Alternativas

**Enlace actual de la defensa (tunel publico, activo mientras el servidor siga arriba):**

```
https://replacement-judgment-brandon-became.trycloudflare.com
```

Es un *quick tunnel* de Cloudflare sobre `http://localhost:3000`: sin cuenta, sin registro y sin
interstitial. **La URL cambia cada vez que se levanta el tunel y depende de que tu PC siga
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

## 6. Estructura del repositorio

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

## 7. Uso en el chat

```
Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles
faltan, si el paquete está listo para firma y qué soportes debo actualizar.
No envíes nada todavía.
```

El chat muestra cada llamada a herramienta (nombre, argumentos y resultado), el indicador de
"pensando" y, cuando el agente pide confirmación, un aviso resaltado. Un segundo mensaje
("sí, envíalo") produce `out/<caso>/ENVIO-SIMULADO.md`; **nunca** un correo real.

## 8. Reglas del repositorio

- `out/`, `node_modules/` y `.env` no se versionan.
- `fixtures/` no se modifica.
- El módulo del bonus se regenera con `bun run scripts/sincronizar-modulo.ts` para que nunca
  diverja de las fuentes de verdad.
