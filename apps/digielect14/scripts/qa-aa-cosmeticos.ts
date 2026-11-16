/**
 * QA headless — PINES COSMÉTICOS del kit AA (R-31, auditoría 2026-11-16).
 *
 *   bun scripts/qa-aa-cosmeticos.ts
 *
 * Estos checks anclaban el ESTILO puntual de dos componentes («conserva su
 * residual text-[13px] gray-500», «icono h-6 w-6 con su gris») — pines de
 * estado, no invariantes: cuando el componente se rediseña legítimamente (p.
 * ej. D69 modern-dark-redesign), el pin se rompe aunque NADA de accesibilidad
 * haya retrocedido, y el gate entero quedaba en rojo por cosmética. La
 * auditoría H-23 lo clasificó como «pines cosméticos frágiles».
 *
 * Desde R-31 son AVISO, no bloqueo: este script SIEMPRE sale 0 y reporta
 * WARN por cada pin que ya no aplica (con la pista de cuándo se rompió el
 * patrón). Las invariantes de accesibilidad de verdad viven en
 * `qa-aa-invariantes.ts` (gate de bloqueo).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let vigentes = 0;
let vencidos = 0;

/** Reporta un pin cosmético: vigente (sigue anclando) o vencido (drift). */
function pin(cond: boolean, etiqueta: string): void {
  if (cond) {
    console.log(`OK · ${etiqueta}`);
    vigentes++;
  } else {
    console.log(`WARN · pin cosmético vencido (no bloquea): ${etiqueta}`);
    vencidos++;
  }
}

async function leer(ruta: string): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), ruta), "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // ── Residuales «pactados» del kit §B (estado, no invariante) ────────────
  const review = (await leer("src/components/e14/screens/ReviewView.tsx")) ?? "";
  pin(
    /text-\[13px\][^\n]*text-gray-500/.test(review),
    "ReviewView conserva su residual text-[13px] gray-500 (pactado para e80 — VENCIÓ con el rediseño D69)",
  );
  const panelClas = (await leer("src/components/e14/PanelClasificacion.tsx")) ?? "";
  pin(
    /text-gray-500[^\n]*cursor-not-allowed|cursor-not-allowed[^\n]*text-gray-500/.test(panelClas),
    "PanelClasificacion conserva su gray-500 DISABLED (exento por WCAG 1.4.3)",
  );

  // ── Exclusión del icono (estado, no invariante) ─────────────────────────
  pin(
    /h-6 w-6[^\n]*text-gray-500/.test(review),
    "icono ReviewView (h-6 w-6) conserva su gris (exclusión verificada del auditor — VENCIÓ con el rediseño D69)",
  );

  // El remate lleva OK a propósito: check-quality.sh exige OK en la última
  // línea de cada harness (y este JAMÁS sale distinto de 0 — es aviso).
  console.log(
    `\nOK · QA aa-cosmeticos: ${vigentes} vigentes · ${vencidos} vencidos (AVISO — jamás bloquea; R-31)`,
  );
}

void main();
