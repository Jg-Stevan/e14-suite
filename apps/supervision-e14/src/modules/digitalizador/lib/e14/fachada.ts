/**
 * R-22 (H-19, auditoría 2026-11-16) — FACHADA de componentes → motor.
 *
 * La fisura única de capa del repo: modal-revisor (componente) importaba
 * DIRECTO de @jg-stevan/scanner-core/dominio/divipol, sin el guard eslint
 * que digielect14 sí tiene para la misma frontera. Esta fachada replica el
 * patrón 7.5/A4 del hermano (src/lib/e14/fachada.ts de digi): los
 * componentes consumen el motor SOLO por aquí, y el guard
 * no-restricted-imports de eslint.config.mjs (nuevo en el mismo commit)
 * lo exige en error.
 *
 * Inventario EXACTO de lo que los componentes importan (modal-revisor;
 * re-exporta SOLO eso — nada nuevo «por si acaso»).
 */
export {
  cargarDivipol,
  mesasDePuesto,
  municipiosDe,
  puestosDe,
  zonasDe,
} from "@jg-stevan/scanner-core/dominio/divipol";
export type { DivipolBase } from "@jg-stevan/scanner-core/dominio/divipol";
