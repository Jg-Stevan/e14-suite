/**
 * Guard canónico de public/_headers del panel (H-13 · H-43 / R-21, auditoría
 * 2026-11-16 — espejo del guard de digielect14, que era el que traía el
 * bloque duplicado). Reglas congeladas:
 *  1. Ningún patrón aparece en más de un bloque (Pages NO combina bloques
 *     que casan con la misma ruta: gana el último — D78).
 *  2. Exactamente UN bloque /* con COOP/COEP (sin ellos el OCR WASM corre
 *     a 1 hilo sin error visible — verificado contra producción 2026-11-03).
 *  3. El CSP del bloque /* mantiene los orígenes críticos (self, sidecar
 *     loopback y hub del puente).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTENIDO = readFileSync(join(process.cwd(), "public/_headers"), "utf8");

/** Bloques del archivo: [{ patron, cabeceras }] (comentarios fuera). */
function bloques(): Array<{ patron: string; cabeceras: string[] }> {
  const salida: Array<{ patron: string; cabeceras: string[] }> = [];
  let actual: { patron: string; cabeceras: string[] } | null = null;
  for (const linea of CONTENIDO.split("\n")) {
    const texto = linea.trim();
    if (!texto || texto.startsWith("#")) continue;
    if (!linea.startsWith(" ") && !linea.startsWith("\t")) {
      if (actual) salida.push(actual);
      actual = { patron: texto, cabeceras: [] };
    } else if (actual) {
      actual.cabeceras.push(texto);
    }
  }
  if (actual) salida.push(actual);
  return salida;
}

describe("_headers del panel canónico (R-21)", () => {
  const bloquesActuales = bloques();

  test("cada patrón aparece en un SOLO bloque (Pages no los combina)", () => {
    const patrones = bloquesActuales.map((b) => b.patron);
    const repetidos = patrones.filter((p, i) => patrones.indexOf(p) !== i);
    expect(repetidos).toEqual([]);
  });

  test("exactamente un bloque /* y lleva COOP/COEP (OCR multihilo)", () => {
    const globales = bloquesActuales.filter((b) => b.patron === "/*");
    expect(globales.length).toBe(1);
    const plano = globales[0].cabeceras.join("\n");
    expect(plano).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(plano).toContain("Cross-Origin-Embedder-Policy: require-corp");
  });

  test("el CSP del bloque /* mantiene self, sidecar loopback y hub", () => {
    const csp = bloquesActuales
      .find((b) => b.patron === "/*")
      ?.cabeceras.find((c) => c.startsWith("Content-Security-Policy:"));
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("http://127.0.0.1:*");
    expect(csp).toContain("https://e14-puente.julistevan02.workers.dev");
  });
});
