/**
 * Guard de resolución de decisiones D-n (H-09 / R-07, auditoría 2026-11-16).
 *
 * D65 era la 15ª decisión más citada del código (68 refs — incluida el
 * «umbral D65» de Hamming ≤ 6 que cita el puente del móvil) y NO tenía fila
 * en ningún registro; D72 era la otra huérfana. La numeración es POR REPO y
 * divergió con la consolidación, así que este guard no adivina: exige que
 * toda `D<n>` citada en `src/` de las DOS apps y del paquete resuelva en
 * ALGUNO de los dos registros del monorepo (ADR de supervision o DECISIONS
 * de digielect14). Citar una D nueva sin registrarla vuelve el guard rojo.
 *
 * Convención: una cita `D63-A2` resuelve con cualquier fila cuyo ID empieza
 * por `D63` (la base numérica manda — los sufijos -A2/-sup/-dig son
 * calificadores de repo/kit documentados en cada registro).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ_REPO = join(process.cwd(), "..", "..");

/** Archivos .ts/.tsx bajo una raíz, excluyendo node_modules y builds. */
function archivosFuente(raizRelativa: string): string[] {
  const salida: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada === ".next" || entrada === "dist") continue;
      const ruta = join(dir, entrada);
      const info = statSync(ruta);
      if (info.isDirectory()) visitar(ruta);
      else if (/\.(ts|tsx)$/.test(entrada)) salida.push(ruta);
    }
  };
  visitar(join(RAIZ_REPO, raizRelativa));
  return salida;
}

const PATRON_CITA = /\bD(\d{1,3})(?![\d])/g;

/** Bases numéricas D<n> citadas en un árbol, con un archivo testigo cada una. */
function citasD(raizRelativa: string): Map<string, string> {
  const citas = new Map<string, string>();
  for (const ruta of archivosFuente(raizRelativa)) {
    const texto = readFileSync(ruta, "utf8");
    for (const coincidencia of texto.matchAll(PATRON_CITA)) {
      const base = `D${coincidencia[1]}`;
      if (!citas.has(base)) citas.set(base, ruta.replace(RAIZ_REPO + "/", ""));
    }
  }
  return citas;
}

/** IDs de fila de un registro de decisiones («| D65 | …», «| D63-A2 | …»). */
function filasRegistro(rutaRelativa: string): string[] {
  const texto = readFileSync(join(RAIZ_REPO, rutaRelativa), "utf8");
  return Array.from(texto.matchAll(/^\|\s*(D[\dA-Za-z\-.]+)\s*\|/gm), (m) => m[1]);
}

const REGISTROS = [
  "apps/supervision-e14/docs/adr/README.md",
  "apps/digielect14/docs/DECISIONS.md",
  "docs/adr/INDICE.md",
];

const ARBOLES = [
  "apps/supervision-e14/src",
  "apps/digielect14/src",
  "packages/scanner-core/src",
];

describe("resolución de decisiones D-n citadas en el código (H-09)", () => {
  const idsRegistrados = REGISTROS.flatMap(filasRegistro);

  test("los tres registros del monorepo existen y tienen filas D", () => {
    expect(idsRegistrados.length).toBeGreaterThan(50);
  });

  for (const arbol of ARBOLES) {
    test(`toda D-n citada en ${arbol} resuelve en un registro`, () => {
      const sinResolver: string[] = [];
      for (const [base, testigo] of citasD(arbol)) {
        const resuelve = idsRegistrados.some((id) => id === base || id.startsWith(`${base}-`));
        if (!resuelve) sinResolver.push(`${base} (citada en ${testigo})`);
      }
      expect(sinResolver).toEqual([]);
    });
  }

  test("las reconstruidas D65 y D72 existen en el registro de supervision", () => {
    const filasSup = filasRegistro("apps/supervision-e14/docs/adr/README.md");
    expect(filasSup).toContain("D65");
    expect(filasSup).toContain("D72");
  });
});
