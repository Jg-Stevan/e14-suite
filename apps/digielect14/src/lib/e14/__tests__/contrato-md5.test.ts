/**
 * Guard del contrato md5 de los módulos D-only (H-02 / R-02, auditoría
 * 2026-11-16): los CONTRATO.json de core/ y ui/ estuvieron mintiendo en
 * silencio (5/6 + 1/1 hashes vencidos) porque el validador histórico murió
 * con la consolidación del monorepo.
 *
 * Este test congela el contrato contra los archivos reales: cualquier edición
 * de un módulo vigilado pone el guard en rojo hasta que se regenere
 * deliberadamente (`bun scripts/gen-contrato-md5.ts`). Se usa comparación
 * ESTRICTA de mapas completos: `toStrictEqual` exige las mismas claves con
 * los mismos valores (sin huecos que `toEqual` tragaba por `undefined`).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MODULOS_CORE_DONLY,
  MODULOS_UI,
  md5DeArchivo,
} from "../contrato-donly";

const RAIZ = process.cwd();

interface ContratoCore {
  nota: string;
  modulos: Record<string, string>;
}

interface ContratoUi {
  modulos: Record<string, string>;
}

function md5Reales(directorio: string, archivos: readonly string[]): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const archivo of archivos) {
    salida[archivo] = md5DeArchivo(join(RAIZ, "src/lib/e14", directorio, archivo));
  }
  return salida;
}

describe("contrato md5 · módulos D-only de core/ (H-02)", () => {
  const contrato = JSON.parse(
    readFileSync(join(RAIZ, "src/lib/e14/core/CONTRATO.json"), "utf8"),
  ) as ContratoCore;

  test("los hashes declarados son EXACTAMENTE los md5 (LF) de los archivos reales", () => {
    expect(md5Reales("core", MODULOS_CORE_DONLY)).toStrictEqual(contrato.modulos);
  });

  test("cada módulo vigilado existe de verdad (sin entradas huérfanas)", () => {
    expect(Object.keys(contrato.modulos).sort()).toStrictEqual([...MODULOS_CORE_DONLY].sort());
  });
});

describe("contrato md5 · árbol ui/ vendoreado (H-02)", () => {
  const contrato = JSON.parse(
    readFileSync(join(RAIZ, "src/lib/e14/ui/CONTRATO.json"), "utf8"),
  ) as ContratoUi;

  test("los hashes declarados son EXACTAMENTE los md5 (LF) de los archivos reales", () => {
    expect(md5Reales("ui", MODULOS_UI)).toStrictEqual(contrato.modulos);
  });

  test("el árbol vigilado es el declarado en ui/LEEME.md (un solo componente)", () => {
    expect(Object.keys(contrato.modulos).sort()).toStrictEqual([...MODULOS_UI].sort());
  });
});
