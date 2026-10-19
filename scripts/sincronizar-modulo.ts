/**
 * Sincroniza el modulo reutilizable (bonus 9.4) con las fuentes de verdad de la
 * aplicacion, para que no existan copias divergentes:
 *
 *   agent/prompt.md                 -> modulo/agent.md
 *   src/knowledge/registro-proveedor.md -> modulo/skill/registro-proveedor/SKILL.md
 *
 * Las herramientas NO se copian: modulo/tools/proveedor.ts las reexporta.
 *
 *   bun run scripts/sincronizar-modulo.ts
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "..");

const prompt = await readFile(path.join(RAIZ, "agent", "prompt.md"), "utf8");
const conocimiento = await readFile(path.join(RAIZ, "src", "knowledge", "registro-proveedor.md"), "utf8");

const agentMd = `---
description: Agente conversacional de registro como proveedor de Periferia IT Group. Prepara formularios, cruza con el repositorio maestro y arma el paquete para firma.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt.trim()}
`;

const skillMd = `---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia IT Group. Úsala cuando el agente deba interpretar el país, los sinónimos de campo, la vigencia de soportes o el cierre humano.
---

${conocimiento.trim()}
`;

await mkdir(path.join(RAIZ, "modulo", "skill", "registro-proveedor"), { recursive: true });
await writeFile(path.join(RAIZ, "modulo", "agent.md"), agentMd, "utf8");
await writeFile(
  path.join(RAIZ, "modulo", "skill", "registro-proveedor", "SKILL.md"),
  skillMd,
  "utf8",
);

console.log("modulo/agent.md y modulo/skill/registro-proveedor/SKILL.md sincronizados.");
