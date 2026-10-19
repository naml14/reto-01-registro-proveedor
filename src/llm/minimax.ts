/**
 * Adaptador de MiniMax.
 *
 * Protocolo: **Anthropic-compatible**, que es el que MiniMax recomienda
 * (https://platform.minimax.io/docs/api-reference/text-chat-anthropic).
 *
 *   Base URL : https://api.minimax.io/anthropic
 *   Endpoint : POST https://api.minimax.io/anthropic/v1/messages
 *   Auth     : Authorization: Bearer <Subscription Key>   (tiene precedencia sobre x-api-key)
 *   Modelos  : MiniMax-M3.1-Flash (por defecto), MiniMax-M3, MiniMax-M2.7, MiniMax-M2.5
 *
 * La credencial del plan M se llama Subscription Key (Facturacion > M Plan) y es distinta
 * de la API key de pago por uso, pero se usa igual: como token Bearer.
 *
 * El endpoint compatible con Anthropic soporta tool calling nativo
 * (tools con input_schema y bloques tool_use en la respuesta), que es justo el
 * contrato que necesita el ciclo del agente. Por eso este adaptador reutiliza
 * el de Anthropic: mismo formato de request, mismo formato de respuesta.
 *
 * Alternativa compatible con OpenAI: MINIMAX_PROTOCOLO=openai usa
 * https://api.minimax.io/v1/chat/completions con el adaptador de OpenAI.
 */

import { AdaptadorAnthropic } from "./anthropic.ts";

export const BASE_URL_ANTHROPIC_MINIMAX = "https://api.minimax.io/anthropic";
export const BASE_URL_OPENAI_MINIMAX = "https://api.minimax.io/v1";

export class AdaptadorMiniMax extends AdaptadorAnthropic {
  constructor(
    clave: string,
    modelo: string,
    promptSistema: string,
    urlBase: string = BASE_URL_ANTHROPIC_MINIMAX,
  ) {
    super(clave, modelo, promptSistema, urlBase, "minimax", "bearer");
  }
}
