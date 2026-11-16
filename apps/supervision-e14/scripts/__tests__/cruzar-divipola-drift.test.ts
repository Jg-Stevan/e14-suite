/**
 * scripts/__tests__/cruzar-divipola-drift.test.ts — R-39 (sabotaje controlado)
 *
 * El cruce DIVIPOLA contra la fuente oficial (`scripts/cruzar-divipola.ts`)
 * es un gate de seguridad electoral: su detección de drift contra el
 * snapshot congelado (`docs/archivo/divipola-snapshot-oficial.md`) es lo
 * único que separa «catálogo internamente consistente» de «catálogo igual
 * a la fuente oficial». Un detector de drift roto (o recalibrado por
 * error) dejaría el gate en verde ante un catálogo alterado — exactamente
 * el estado que el hueco §6.4 de la auditoría señala como posible y sin
 * detector.
 *
 * Este test congela el comportamiento del detector contra los artefactos
 * REALES del repo (catálogo versionado + snapshot firmado, sin red):
 *
 *   1. el snapshot del doc de archivo se parsea (kind correcto);
 *   2. el catálogo real contra el snapshot real → SIN DRIFT (verde);
 *   3. SABOTAJE del catálogo (1 mesa alterada) → DRIFT detectado;
 *   4. SABOTAJE del snapshot (digest trucado) → DRIFT detectado;
 *   5. el reordenamiento de registros NO es drift (canonico ordena por
 *      idEnlace — el digest es semántico, no posicional);
 *   6. el doc sin fence máquina NO produce snapshot (null honesto).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  canonico,
  parsearSnapshot,
  verificarDrift,
  type Snapshot,
} from "../cruzar-divipola";

const RAIZ_SCRIPTS = resolve(import.meta.dir, "..");
const RUTA_CATALOGO = resolve(
  RAIZ_SCRIPTS,
  "../src/modules/supervision/data/divipola-exterior.json",
);
const RUTA_SNAPSHOT = resolve(RAIZ_SCRIPTS, "../docs/archivo/divipola-snapshot-oficial.md");

const catalogo: Array<Record<string, unknown>> = JSON.parse(readFileSync(RUTA_CATALOGO, "utf8"));
const snapshot = parsearSnapshot(readFileSync(RUTA_SNAPSHOT, "utf8"));

/** Copia del catálogo con UNA mutación quirúrgica (el puesto que decimos). */
function sabotearCatalogo(mutacion: (r: Record<string, unknown>) => void): Array<Record<string, unknown>> {
  const copia = catalogo.map((r) => ({ ...r }));
  mutacion(copia[0]);
  return copia;
}

/** El snapshot real con el digest canónico reemplazado por un valor ajeno. */
function sabotearSnapshot(): Snapshot {
  const clon = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
  clon.catalogo.sha256_canonico = "0".repeat(64);
  return clon;
}

describe("R-39 — detector de drift del cruce DIVIPOLA (sabotaje controlado)", () => {
  it("el snapshot real del doc de archivo se parsea con el kind correcto", () => {
    expect(snapshot).not.toBeNull();
    expect(snapshot?.kind).toBe("snapshot-divipola-exterior");
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.catalogo.sha256_canonico).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot?.catalogo.registros).toBe(949);
  });

  it("el catálogo REAL contra el snapshot REAL → SIN DRIFT (el gate está en verde hoy)", () => {
    expect(snapshot).not.toBeNull();
    const lineas = verificarDrift(snapshot as Snapshot, catalogo as never);
    expect(lineas.some((l) => l.startsWith("✓ SIN DRIFT"))).toBe(true);
    expect(lineas.some((l) => l.startsWith("✗ DRIFT"))).toBe(false);
  });

  it("SABOTAJE del catálogo (1 mesa alterada) → DRIFT detectado", () => {
    expect(snapshot).not.toBeNull();
    const antes = canonico(catalogo as never);
    const alterado = sabotearCatalogo((r) => {
      r.totalMesas = (r.totalMesas as number) + 1;
    });
    // El digest cambia (la mutación es semántica, no cosmética).
    expect(canonico(alterado as never)).not.toBe(antes);
    // Y el detector lo reporta — esta es la aserción que congelar la lógica.
    const lineas = verificarDrift(snapshot as Snapshot, alterado as never);
    expect(lineas.some((l) => l.startsWith("✗ DRIFT"))).toBe(true);
    expect(lineas.join("\n")).toContain("re-cruzar en vivo y volver a correr --congelar");
  });

  it("SABOTAJE del snapshot (digest reemplazado) → DRIFT detectado", () => {
    const lineas = verificarDrift(sabotearSnapshot(), catalogo as never);
    expect(lineas.some((l) => l.startsWith("✗ DRIFT"))).toBe(true);
  });

  it("reordenar los registros NO es drift (canonico ordena por idEnlace)", () => {
    expect(snapshot).not.toBeNull();
    const revuelto = [...catalogo].reverse();
    const lineas = verificarDrift(snapshot as Snapshot, revuelto as never);
    expect(lineas.some((l) => l.startsWith("✓ SIN DRIFT"))).toBe(true);
  });

  it("un doc sin fence máquina parsea a null (sin snapshot congelado)", () => {
    expect(parsearSnapshot("# doc sin bloque máquina\n")).toBeNull();
  });
});
