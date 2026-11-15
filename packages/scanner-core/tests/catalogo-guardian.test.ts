/**
 * Test guardián del catálogo DIVIPOL servido (H-44 / C-6 del plan de cierre
 * 2026-11-12): tras el dedup queda UNA sola copia versionada del catálogo —
 * `public/e14/divipol.json` (la que sirve la app) — y los tests del paquete la
 * consumen por ruta relativa. Este guardián fija su md5 para que las copias de
 * los DOS repos (digielect14 y supervision-e14) no deriven entre sí: si el
 * catálogo cambia, el cambio se propaga a ambos repos en el mismo commit
 * (misma regla de espejo que el motor) y se actualiza el hash de abajo junto
 * con el golden (`fixtures/contrato-motor.json`, campo divipolMd5).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import type { DivipolBase } from "../src/dominio/divipol";
import { DIVIPOL_CRUDO, RUTAS_DIVIPOL } from "./divipol-servido";

// md5 de `apps/<app>/public/e14/divipol.json` (copias idénticas por app).
const MD5_FIJADO = "8d4b0963057b2e8d0b0db179b8f5ddb2";

describe("guardián del catálogo DIVIPOL (una sola copia servida)", () => {
  test("todas las apps sirven el catálogo con el md5 fijado", () => {
    for (const ruta of RUTAS_DIVIPOL) {
      const crudo = readFileSync(ruta, "utf8");
      expect(createHash("md5").update(crudo, "utf8").digest("hex")).toBe(MD5_FIJADO);
    }
  });

  test("el catálogo servido parsea como DivipolBase (índice dep → nodo)", () => {
    const base = JSON.parse(DIVIPOL_CRUDO) as DivipolBase;
    const departamentos = Object.keys(base);
    expect(departamentos.length).toBeGreaterThan(0);
    for (const dep of departamentos) {
      expect(base[dep]).toBeTypeOf("object");
    }
  });
});
