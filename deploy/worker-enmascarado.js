/**
 * Worker de Cloudflare para ENMASCARAR el origen.
 *
 * Publica el agente en un hostname que no revela el dominio interno ni la IP
 * del VPS, por ejemplo:
 *
 *   https://registro-proveedor.<tu-cuenta>.workers.dev
 *
 * El Worker reenvia cada peticion al agente y devuelve la respuesta tal cual
 * (el chat es una API JSON: /api/chat, /api/health, /api/sessions/:id).
 *
 * COMO USARLO
 * 1. Cloudflare -> Workers & Pages -> Create -> Worker -> "Hello World" -> Edit code.
 * 2. Pegar este archivo (el `export default` es obligatorio).
 * 3. Deploy. La URL sale en el panel: <nombre-del-worker>.<cuenta>.workers.dev
 * 4. Opcional: en el panel del Worker -> Settings -> Domains -> Add a custom domain
 *    para publicarlo en un dominio propio.
 *
 * NOTA SOBRE EL ORIGEN
 * ORIGEN apunta por defecto al puerto publicado del contenedor (193.34.69.237:3000),
 * que es la via que ya funciona sin depender de Traefik ni del DNS.
 * Si prefieres que el Worker pase por el dominio, cambia ORIGEN por
 * "https://agente.electrondevnaml.dev".
 */

/** URL del backend al que se reenvían las solicitudes del Worker. */
const ORIGEN = "http://193.34.69.237:3000";

export default {
  /**
   * Reenvía método, ruta, query, cabeceras y cuerpo al origen y devuelve su respuesta.
   * Ante un error de conexión responde con HTTP 502 y un sobre JSON.
   * @param {Request} request Solicitud recibida por Cloudflare.
   * @param {unknown} env Entorno de ejecución del Worker, no utilizado por esta implementación.
   * @param {unknown} ctx Contexto de ejecución del Worker, no utilizado por esta implementación.
   * @returns {Promise<Response>} Respuesta del origen o error JSON 502.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const destino = `${ORIGEN}${url.pathname}${url.search}`;

    const cabeceras = new Headers(request.headers);
    // El origen no necesita saber de donde viene la peticion.
    cabeceras.delete("host");
    cabeceras.delete("cf-connecting-ip");
    cabeceras.set("x-forwarded-host", url.hostname);

    try {
      const respuesta = await fetch(destino, {
        method: request.method,
        headers: cabeceras,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });

      const salientes = new Headers(respuesta.headers);
      salientes.set("x-masked-by", "cloudflare-worker");

      return new Response(respuesta.body, {
        status: respuesta.status,
        statusText: respuesta.statusText,
        headers: salientes,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `No se pudo contactar el agente: ${error instanceof Error ? error.message : "error desconocido"}`,
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
  },
};
