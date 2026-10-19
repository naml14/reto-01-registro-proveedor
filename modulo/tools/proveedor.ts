/**
 * Bonus 9.4: las mismas herramientas que usa la aplicacion, importables sin el
 * servidor. No es una copia: es un reexport del modulo real, para que no haya
 * versiones divergentes.
 *
 *   import { registroHerramientas } from "./modulo/tools/proveedor.ts";
 */

export * from "../../src/tools/proveedor.ts";
