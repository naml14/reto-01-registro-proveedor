/** @fileoverview Interacción del chat en navegador mediante HTML nativo y Fetch API. */

const chat = document.getElementById("chat");
const formulario = document.getElementById("form");
const entrada = document.getElementById("entrada");
const boton = document.getElementById("enviar");
const listaToolCalls = document.getElementById("toolcalls");
const estado = document.getElementById("estado");
const aviso = document.getElementById("confirmacion");
const avisoTexto = document.getElementById("confirmacion-texto");

const sessionId = `s-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
let pensando = false;

/**
 * Escapa caracteres HTML antes de interpolar texto en `innerHTML`.
 * @param {unknown} texto Valor que se convertirá a texto.
 * @returns {string} Texto con `&`, `<` y `>` escapados.
 */
function escapar(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Añade una burbuja de mensaje al historial y desplaza el chat al final.
 * @param {string} texto Texto visible del mensaje.
 * @param {string} rol Clase CSS que identifica al emisor, por ejemplo `yo` o `bot`.
 * @returns {HTMLElement} Elemento `article` creado.
 */
function agregarMensaje(texto, rol) {
  const article = document.createElement("article");
  article.className = `mensaje ${rol}`;
  const cuerpo = document.createElement("div");
  cuerpo.className = "burbuja";
  cuerpo.textContent = texto;
  article.appendChild(cuerpo);
  chat.appendChild(article);
  chat.scrollTop = chat.scrollHeight;
  return article;
}

/** Añade al chat el indicador animado de espera. */
function mostrarPensando() {
  const article = document.createElement("article");
  article.className = "mensaje bot pensando";
  article.id = "pensando";
  article.innerHTML = '<div class="burbuja"><span class="punto"></span><span class="punto"></span><span class="punto"></span> procesando…</div>';
  chat.appendChild(article);
  chat.scrollTop = chat.scrollHeight;
}

/** Elimina del DOM el indicador de espera si sigue presente. */
function quitarPensando() {
  const elemento = document.getElementById("pensando");
  if (elemento) elemento.remove();
}

/**
 * Reemplaza la lista visible de llamadas a herramientas y escapa sus datos antes de insertarlos.
 * @param {Array<{nombre: string, ok: boolean, argumentos?: Object, resultado?: string}> | null | undefined} llamadas Llamadas devueltas por la API.
 */
function pintarToolCalls(llamadas) {
  if (!llamadas || llamadas.length === 0) return;
  listaToolCalls.innerHTML = "";
  for (const llamada of llamadas) {
    const item = document.createElement("li");
    item.className = llamada.ok ? "ok" : "error";
    const argumentos = JSON.stringify(llamada.argumentos ?? {});
    item.innerHTML = `
      <div class="tool-nombre">${escapar(llamada.nombre)}</div>
      <div class="tool-args">${escapar(argumentos)}</div>
      <div class="tool-resultado">${escapar(llamada.resultado ?? "")}</div>
    `;
    listaToolCalls.appendChild(item);
  }
}

/** Muestra el aviso de confirmación y desplaza la vista hasta él. */
function mostrarConfirmacion(texto) {
  aviso.classList.remove("oculto");
  avisoTexto.textContent = texto;
  aviso.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** Oculta el aviso y elimina el texto de confirmación anterior. */
function ocultarConfirmacion() {
  aviso.classList.add("oculto");
  avisoTexto.textContent = "";
}

/**
 * Consulta el proveedor y modelo activos para mostrarlos en el estado del chat.
 * Si el backend no responde, presenta un estado sin conexión.
 * @returns {Promise<void>} Promesa que finaliza después de actualizar el estado.
 */
async function consultarSalud() {
  try {
    const respuesta = await fetch("/api/health");
    const datos = await respuesta.json();
    estado.textContent = `proveedor: ${datos.provider} · modelo: ${datos.model}`;
  } catch {
    estado.textContent = "sin conexion con el backend";
  }
}

formulario.addEventListener(
  "submit",
  /**
   * Envía el mensaje actual, muestra respuesta y llamadas, y restaura los controles al terminar.
   * @param {SubmitEvent} evento Evento de envío del formulario.
   * @returns {Promise<void>} Promesa de la solicitud y actualización del chat.
   */
  async (evento) => {
  evento.preventDefault();
  const texto = entrada.value.trim();
  if (texto === "" || pensando) return;

  ocultarConfirmacion();
  agregarMensaje(texto, "yo");
  entrada.value = "";
  pensando = true;
  boton.disabled = true;
  mostrarPensando();

  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message: texto }),
    });
    const datos = await respuesta.json();
    quitarPensando();

    if (datos.error) {
      agregarMensaje(datos.error, "bot");
      return;
    }

    pintarToolCalls(datos.toolCalls);
    agregarMensaje(datos.reply, "bot");

    if (datos.needsConfirmation) {
      mostrarConfirmacion(datos.reply);
    }
  } catch (error) {
    quitarPensando();
    agregarMensaje(`No pude completar la peticion: ${error.message}`, "bot");
  } finally {
    pensando = false;
    boton.disabled = false;
    entrada.focus();
  }
});

consultarSalud();
