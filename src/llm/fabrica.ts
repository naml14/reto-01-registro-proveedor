/**
 * Fabrica de adaptadores: decide el proveedor segun el entorno.
 *
 * Proveedores soportados:
 *   minimax   -> MiniMax (Anthropic-compatible). Recomendado por MiniMax.
 *   anthropic -> api.anthropic.com
 *   openai    -> api.openai.com o cualquier compatible (Groq, Together, OpenRouter, MiniMax v1)
 *   auto      -> el primero que encuentre una clave configurada
 *   guiado    -> sin clave: modo determinista local, el chat sigue funcionando
 */

import path from "node:path";

import type { AdaptadorLLM } from "./adapter.ts";
import { AdaptadorAnthropic } from "./anthropic.ts";
import { AdaptadorGuiado } from "./guiado.ts";
import { AdaptadorMiniMax, BASE_URL_ANTHROPIC_MINIMAX, BASE_URL_OPENAI_MINIMAX } from "./minimax.ts";
import { AdaptadorOpenAI } from "./openai.ts";

/** Lee la primera clave de MiniMax compatible con los nombres de entorno admitidos. */
function claveMinimax(): string | undefined {
  return process.env.MINIMAX_API_KEY?.trim() || process.env.MINIMAX_SUBSCRIPTION_KEY?.trim();
}

/**
 * Selecciona el adaptador según `LLM_PROVIDER` y las credenciales disponibles.
 * En `auto` prioriza MiniMax, luego Anthropic y OpenAI; sin clave usa modo guiado.
 *
 * @param promptSistema Instrucciones del agente que se envían a proveedores LLM.
 * @param raiz Directorio del proyecto, usado por el adaptador guiado.
 * @returns Adaptador listo para responder al ciclo del agente.
 */
export function crearAdaptador(promptSistema: string, raiz: string): AdaptadorLLM {
  const proveedor = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  const claveAnthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const claveOpenai = process.env.OPENAI_API_KEY?.trim();
  const claveMiniMax = claveMinimax();

  if (proveedor === "minimax" && claveMiniMax) {
    return crearMiniMax(claveMiniMax, promptSistema);
  }

  if (proveedor === "anthropic" && claveAnthropic) {
    return new AdaptadorAnthropic(
      claveAnthropic,
      process.env.LLM_MODEL_ANTHROPIC ?? "claude-sonnet-4-5",
      promptSistema,
      process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    );
  }

  if (proveedor === "openai" && claveOpenai) {
    return new AdaptadorOpenAI(
      claveOpenai,
      process.env.LLM_MODEL_OPENAI ?? "gpt-4.1-mini",
      promptSistema,
      process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    );
  }

  if (proveedor === "auto") {
    if (claveMiniMax) return crearMiniMax(claveMiniMax, promptSistema);
    if (claveAnthropic) {
      return new AdaptadorAnthropic(
        claveAnthropic,
        process.env.LLM_MODEL_ANTHROPIC ?? "claude-sonnet-4-5",
        promptSistema,
        process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      );
    }
    if (claveOpenai) {
      return new AdaptadorOpenAI(
        claveOpenai,
        process.env.LLM_MODEL_OPENAI ?? "gpt-4.1-mini",
        promptSistema,
        process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      );
    }
  }

  return new AdaptadorGuiado(path.resolve(raiz));
}

/**
 * MiniMax expone dos protocolos. El Anthropic-compatible es el recomendado y el
 * que usa tool calling con el mismo contrato de Anthropic; el OpenAI-compatible
 * se activa con MINIMAX_PROTOCOLO=openai.
 */
/** Construye el adaptador MiniMax con el protocolo elegido por `MINIMAX_PROTOCOLO`. */
function crearMiniMax(clave: string, promptSistema: string): AdaptadorLLM {
  const modelo = process.env.LLM_MODEL_MINIMAX ?? "MiniMax-M3.1-Flash";
  const protocolo = (process.env.MINIMAX_PROTOCOLO ?? "anthropic").toLowerCase();

  if (protocolo === "openai") {
    return new AdaptadorOpenAI(
      clave,
      modelo,
      promptSistema,
      process.env.MINIMAX_BASE_URL ?? BASE_URL_OPENAI_MINIMAX,
    );
  }

  return new AdaptadorMiniMax(
    clave,
    modelo,
    promptSistema,
    process.env.MINIMAX_BASE_URL ?? BASE_URL_ANTHROPIC_MINIMAX,
  );
}
