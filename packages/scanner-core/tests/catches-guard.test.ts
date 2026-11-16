/**
 * Guard de catches con rastro (R-20 / H-21, auditoría 2026-11-16).
 *
 * EL HALLAZGO MAYOR de la auditoría: ~660 catches en código de producción,
 * 258 de ellos SIN NINGÚN rastro (ni comentario del porqué ni log) — la
 * REGLA DE ORO («el fallo jamás tumba la app») defendía tragarlos, pero sin
 * rastro el diagnóstico en jornada electoral era imposible.
 *
 * La política (docs/adr/politica-errores-catches.md): todo catch de
 * producción deja rastro por una de 4 vías — comentario del porqué ·
 * logger.debug (eliminado del bundle de producción) · logger.warn (viaja al
 * buffer obs) · estado visible en UI. Este guard congela la regla: un catch
 * cuyo cuerpo no tenga NI comentario NI llamada a logger/console lo pone
 * rojo, salvo que esté en la lista blanca con justificación.
 *
 * Corre en `bun test packages/scanner-core` — que es parte del `verificar`
 * de AMBAS apps (test:paquete), así que el gate alcanza a los tres árboles
 * en ambos CI (ci-movil y ci-panel).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ_REPO = join(import.meta.dir, "..", "..", "..");
const ARBOLES = [
  "apps/digielect14/src",
  "apps/supervision-e14/src",
  "packages/scanner-core/src",
];

/** Excepciones JUSTIFICADAS (archivo → línea → por qué puede estar desnudo).
 *  Vacía tras la campaña R-20: toda nueva entrada necesita justificación. */
const LISTA_BLANCA = new Map<string, string>([]);

/** Archivos .ts/.tsx bajo una raíz, excluyendo vendor y tests. */
function archivosFuente(raizRelativa: string): string[] {
  const salida: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada === "vendor" || entrada === ".next") continue;
      const ruta = join(dir, entrada);
      const info = statSync(ruta);
      if (info.isDirectory()) visitar(ruta);
      else if (/\.(ts|tsx)$/.test(entrada) && !/\.test\.(ts|tsx)$/.test(entrada)) {
        salida.push(ruta);
      }
    }
  };
  visitar(join(RAIZ_REPO, raizRelativa));
  return salida;
}

/** Cuerpo balanceado del catch que abre en `lineas[i]` (null si no abre ahí). */
function cuerpoCatch(lineas: string[], i: number): string | null {
  const apertura = /\bcatch\s*(?:\([^)]*\))?\s*\{/.exec(lineas[i]);
  if (!apertura) return null;
  const primera = lineas[i].slice(apertura.index + apertura[0].length);
  const trozos: string[] = [];
  let profundidad = 1;
  if (primera) {
    trozos.push(primera);
    profundidad += (primera.match(/\{/g) ?? []).length - (primera.match(/\}/g) ?? []).length;
  }
  let j = i;
  let vueltas = 0;
  while (profundidad > 0 && j + 1 < lineas.length && vueltas < 40) {
    j += 1;
    vueltas += 1;
    const linea = lineas[j];
    let visible = linea;
    for (let k = 0; k < linea.length; k++) {
      if (linea[k] === "{") profundidad += 1;
      else if (linea[k] === "}") {
        profundidad -= 1;
        if (profundidad === 0) {
          visible = linea.slice(0, k);
          break;
        }
      }
    }
    trozos.push(visible);
  }
  return trozos.join("\n");
}

interface CatchDesnudo {
  archivo: string;
  linea: number;
}

/** Todo catch de producción sin comentario NI log en el cuerpo. */
function catchesDesnudos(): CatchDesnudo[] {
  const desnudos: CatchDesnudo[] = [];
  for (const arbol of ARBOLES) {
    for (const ruta of archivosFuente(arbol)) {
      const lineas = readFileSync(ruta, "utf8").split("\n");
      for (let i = 0; i < lineas.length; i++) {
        if (!/\bcatch\s*(\{|\()/.test(lineas[i])) continue;
        const cuerpo = cuerpoCatch(lineas, i);
        if (cuerpo === null) continue;
        const tieneLog = /\b(?:logger|console)\.\w+\s*\(/.test(cuerpo);
        const tieneComentario = cuerpo.includes("//") || cuerpo.includes("/*");
        if (!tieneLog && !tieneComentario) {
          desnudos.push({ archivo: ruta.replace(RAIZ_REPO + "/", ""), linea: i + 1 });
        }
      }
    }
  }
  return desnudos;
}

describe("guard de catches con rastro (R-20 · política docs/adr/politica-errores-catches.md)", () => {
  test("0 catches desnudos (sin comentario del porqué ni log) en los 3 árboles", () => {
    const fueraDeLista = catchesDesnudos().filter(
      ({ archivo, linea }) => !LISTA_BLANCA.has(`${archivo}:${linea}`),
    );
    expect(
      fueraDeLista.map(({ archivo, linea }) => `${archivo}:${linea}`),
    ).toEqual([]);
  });

  test("la lista blanca no admitting entradas muertas (toda excepción sigue vigente)", () => {
    const desnudos = catchesDesnudos();
    for (const clave of LISTA_BLANCA.keys()) {
      const [archivo, lineaStr] = clave.split(":");
      const sigueDesnudo = desnudos.some(
        (d) => d.archivo === archivo && d.linea === Number(lineaStr),
      );
      // Si la entrada ya no corresponde a un catch desnudo, la entrada está
      // muerta y debe retirarse (el guard exige la lista mínima).
      expect(sigueDesnudo).toBe(true);
    }
  });
});
