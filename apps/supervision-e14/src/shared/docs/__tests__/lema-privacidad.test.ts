/**
 * Guard del lema de privacidad de portada (H-07 / R-05, auditoría
 * 2026-11-16).
 *
 * El lema «100 % client-side» era exacto solo para el PROCESADO: la foto ya
 * procesada viaja como dataURL firmada (HMAC) al hub de producción — el
 * único destino externo del CSP. Este test congela la corrección: el README
 * del monorepo puede decir que el procesado es local, pero NO puede volver
 * a prometer en portada que nada sale del dispositivo sin decir dónde está
 * el matiz.
 *
 * Vive en la suite del panel porque es la app que recibe lo que el hub
 * sirve; el README que vigila es el de la RAÍZ del monorepo.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const README_RAIZ = join(process.cwd(), "..", "..", "README.md");
const readme = readFileSync(README_RAIZ, "utf8");

describe("lema de privacidad del README raíz (H-07)", () => {
  test("el claim de portada es el honesto: procesado local + foto firmada al hub", () => {
    expect(readme).toContain("procesado 100 % local");
    // El matiz crítico DEBE acompañar al claim, en el mismo documento.
    expect(readme).toContain("viaja firmada (HMAC)");
    expect(readme).toContain("al hub de producción");
  });

  test("el lema viejo que sobre-prometía no vuelve a portada", () => {
    // La formulación exacta anterior prometía de forma absoluta. Si alguien
    // la restaura tal cual, el guard se pone rojo hasta re-añadir el matiz.
    expect(readme).not.toMatch(/#\s*e14-suite[\s\S]{0,400}100 % client-side/);
  });

  test("la tabla de privacidad existe y declara qué sale y qué se queda", () => {
    expect(readme).toContain("Qué sale del dispositivo y qué se queda");
    expect(readme).toContain("| Foto procesada de la página del acta");
    expect(readme).toContain("Firmada HMAC-SHA256");
  });

  test("la exclusión del hub del monorepo está enlazada a su ADR", () => {
    expect(readme).toContain("docs/adr/2026-11-16-contrato-hub-e14-puente.md");
  });
});
