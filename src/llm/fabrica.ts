/**
 * Fabrica de adaptadores: decide el proveedor segun el entorno.
 * Si no hay ninguna clave configurada, cae en el modo determinista (guiado),
 * de modo que el chat nunca queda sin funcionar.
 */

import path from "node:path";

import type { AdaptadorLLM } from "./adapter.ts";
import { AdaptadorAnthropic } from "./anthropic.ts";
import { AdaptadorGuiado } from "./guiado.ts";
import { AdaptadorOpenAI } from "./openai.ts";

export function crearAdaptador(promptSistema: string, raiz: string): AdaptadorLLM {
  const proveedor = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  const claveAnthropic = process.env.ANTHROPIC_API_KEY;
  const claveOpenai = process.env.OPENAI_API_KEY;

  if (proveedor === "anthropic" && claveAnthropic) {
    return new AdaptadorAnthropic(
      claveAnthropic,
      process.env.LLM_MODEL_ANTHROPIC ?? "claude-sonnet-4-5",
      promptSistema,
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
    if (claveAnthropic) {
      return new AdaptadorAnthropic(
        claveAnthropic,
        process.env.LLM_MODEL_ANTHROPIC ?? "claude-sonnet-4-5",
        promptSistema,
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
