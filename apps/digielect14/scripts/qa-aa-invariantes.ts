/**
 * QA headless — INVARIANTES AA de accesibilidad (R-31, auditoría 2026-11-16:
 * separación del histórico `qa-aa-quickwins` en invariantes de BLOQUEO y
 * pines cosméticos de aviso). Sin red, sin DOM, determinista — source-scan
 * estático (patrón lección 3A.1: readFile + ok() + remate final OK). ANCLA
 * POR PATRÓN, jamás por número de línea.
 *
 *   bun scripts/qa-aa-invariantes.ts
 *
 * INVARIANTES (este archivo — gate de BLOQUEO):
 *   1. Grises AA (C1): en src/components/** hay 0 líneas con co-ocurrencia
 *      text-(slate|gray)-(500|600) + token de tamaño ≤ 12 px en la MISMA
 *      línea de clases. (R-31 corrigió la única violación real: el pie de
 *      GaleriaiaSimulacion a 10 px en slate-500.)
 *   2. Rojo crit (M4): primitives.tsx con 0 ef4444 y ≥ 4 E52222; y
 *      PanelDev/VistaErrores/ActasView/ResumenView AÚN contienen ef4444
 *      (migración incompleta prohibida en AMBAS direcciones — sobre
 *      superficie oscura el #E52222 EMPEORARÍA el contraste).
 *   3. Táctiles (M1): ResumenView sin min-h-[40px] y con min-h-[44px].
 *
 * Los pines cosméticos históricos (residuales «pactados» de ReviewView) viven
 * en `qa-aa-cosmeticos.ts` como AVISO no bloqueante.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

let pasadas = 0;
let fallos = 0;
function ok(cond: boolean, etiqueta: string): void {
  console.log(`${cond ? "OK" : "FAIL"} · ${etiqueta}`);
  pasadas++;
  if (!cond) fallos++;
}

/** Lee un archivo del repo relativo a la raíz; null si no existe. */
async function leer(ruta: string): Promise<string | null> {
  try {
    return await readFile(join(process.cwd(), ruta), "utf8");
  } catch {
    return null;
  }
}

/** Lista recursiva de .tsx bajo src/components (source-scan del check 1). */
async function tsxDe(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await tsxDe(rel)));
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const GRIS = /text-(?:slate|gray)-(?:500|600)/;
const PEQUE = /text-\[(?:9|9\.5|10|10\.5|11)px\]|text-xs\b/;

async function main(): Promise<void> {
  // ── 1 · Grises AA: 0 co-ocurrencias gris ≤12px en src/components/** ──────
  const componentes = await tsxDe("src/components");
  let coocurrentes = 0;
  for (const f of componentes) {
    const src = (await leer(f)) ?? "";
    for (const linea of src.split("\n")) {
      if (GRIS.test(linea) && PEQUE.test(linea)) coocurrentes++;
    }
  }
  ok(
    coocurrentes === 0,
    `0 líneas con gris 500/600 + texto ≤ 12 px en src/components/** (${componentes.length} .tsx escaneados — C1 del kit §B)`,
  );

  // ── 2 · Rojo crit: #E52222 SOLO en primitives; los oscuros intactos ──────
  const primitives = (await leer("src/components/e14/primitives.tsx")) ?? "";
  ok(!primitives.includes("ef4444"), "primitives.tsx con 0 ef4444 (M4 — migración completa)");
  ok(
    (primitives.match(/E52222/g) ?? []).length >= 4,
    "primitives.tsx con ≥ 4 E52222 (crit bg/text/shadow/rgba — blanco-sobre-rojo 4.58:1 pasa AA)",
  );
  const oscuros: [string, string][] = [
    ["PanelDev", "src/components/e14/dev/PanelDev.tsx"],
    ["VistaErrores", "src/components/e14/dev/VistaErrores.tsx"],
    ["ActasView", "src/components/e14/screens/ActasView.tsx"],
    ["ResumenView", "src/components/e14/screens/ResumenView.tsx"],
  ];
  for (const [nombre, ruta] of oscuros) {
    const src = (await leer(ruta)) ?? "";
    ok(
      src.includes("ef4444"),
      `${nombre} AÚN contiene ef4444 (superficie oscura ≈5.5:1 — oscurecerlo EMPEORARÍA; §C quirúrgico)`,
    );
  }

  // ── 3 · Targets táctiles: 44 px, SOLO min-h (§D) ─────────────────────
  const resumen = (await leer("src/components/e14/screens/ResumenView.tsx")) ?? "";
  ok(
    !resumen.includes("min-h-[40px]") && resumen.includes("min-h-[44px]"),
    "ResumenView sin min-h-[40px] y con min-h-[44px] (REINICIAR JORNADA — M1)",
  );

  // ── resultado ────────────────────────────────────────────────────────────
  console.log(`\nQA aa-invariantes: ${pasadas - fallos}/${pasadas} OK`);
  if (fallos > 0) process.exit(1);
}

void main();
