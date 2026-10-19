/* Front de chat del agente. Sin framework: HTML plano + fetch. */

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

function escapar(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

function mostrarPensando() {
  const article = document.createElement("article");
  article.className = "mensaje bot pensando";
  article.id = "pensando";
  article.innerHTML = '<div class="burbuja"><span class="punto"></span><span class="punto"></span><span class="punto"></span> procesando…</div>';
  chat.appendChild(article);
  chat.scrollTop = chat.scrollHeight;
}

function quitarPensando() {
  const elemento = document.getElementById("pensando");
  if (elemento) elemento.remove();
}

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

function mostrarConfirmacion(texto) {
  aviso.classList.remove("oculto");
  avisoTexto.textContent = texto;
  aviso.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function ocultarConfirmacion() {
  aviso.classList.add("oculto");
  avisoTexto.textContent = "";
}

async function consultarSalud() {
  try {
    const respuesta = await fetch("/api/health");
    const datos = await respuesta.json();
    estado.textContent = `proveedor: ${datos.provider} · modelo: ${datos.model}`;
  } catch {
    estado.textContent = "sin conexion con el backend";
  }
}

formulario.addEventListener("submit", async (evento) => {
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
