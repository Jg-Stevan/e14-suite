/**
 * Contrato de paridad del motor post-OCR (kit e14-motor-paridad-v1).
 *
 * El motor vive UNA vez en `packages/scanner-core` (D-monorepo): ambas apps lo
 * consumen por subpath `workspace:*` (`@jg-stevan/scanner-core/*`) — ya no
 * hay copias vendorizadas ni «hermano» que sincronizar. Comparten el MISMO
 * `tesseract.js` con el mismo `spa.traineddata` descomprimido, las mismas
 * ONNX PP-OCRv4 y la misma base DIVIPOL, y comparten TAMBIÉN el negocio que
 * decide el resultado final: `clasificador.ts`, `completitud.ts` y
 * `divipol.ts`. Este test fija ESE negocio con un golden generado por el
 * motor real (`bun scripts/gen-contrato-motor.ts`, que escribe directo a
 * `packages/scanner-core/tests/fixtures/contrato-motor.json`).
 *
 * Por qué un golden y no ejecutar las dos apps: un CI no puede correr las
 * dos apps a la vez. Con el golden, la mecánica es —
 *   · cambio de negocio que altera una clasificación → este test pone rojo
 *     → regenerar el golden con el generador de un paso y re-correr;
 *   · el generador exige que el golden nuevo sea estrictamente igual al
 *     anterior salvo los cambios de negocio revisados (--check para CI).
 *
 * R-16 (auditoría 2026-11-16): `toStrictEqual` desde siempre debió ser la
 * comparación — `toEqual` ignora campos `undefined` y un golden con huecos
 * podía pasar roto. El generador serializa con canon() (claves ordenadas,
 * sin undefined), así que el contrato SANO es estricto por construcción.
 *
 * NO cubre (y no pretende): el OCR sobre píxeles (necesita navegador/wasm),
 * el `puente/` (existe solo en digielect14) ni `quad`/`score` (salida de la
 * cascada, no del clasificador).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
  clasificarCabecera,
  claveDeMesa,
  claveDePuesto,
  faltaSeccionInferior,
  nombreExportacion,
  tituloYUbicacionDe,
  tipoPaginaDe,
} from "../src/dominio/clasificador";
import type { ClasificacionE14 } from "../src/dominio/clasificador";
import type { DivipolBase } from "../src/dominio/divipol";
import { statusDeScore, type ActaStatus } from "../src/dominio/types";
import { DIVIPOL_CRUDO } from "./divipol-servido";

interface DescriptorGolden {
  id: string;
  nota: string;
  ocr: string;
  esperado: ClasificacionE14;
  derivados: Record<string, unknown>;
}

interface Golden {
  version: number;
  divipolMd5: string;
  estados: Array<{ score: number; status: ActaStatus }>;
  descriptores: DescriptorGolden[];
}

const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/contrato-motor.json", import.meta.url), "utf8"),
) as Golden;

// H-44/C-6: el catálogo lo sirven las apps (apps/*/public/e14/divipol.json);
// el guardián (tests/catalogo-guardian.test.ts) fija su md5.
const BASE = JSON.parse(DIVIPOL_CRUDO) as DivipolBase;

/** Lo que el golden amarra DESPUÉS de clasificar (claves, nombre de export,
 *  título/ubicación y flag de recorte): funciones puras del mismo archivo. */
function derivadosDe(d: DescriptorGolden): Record<string, unknown> {
  const c = clasificarCabecera(d.ocr, BASE);
  return {
    claveMesa: claveDeMesa(c),
    clavePuesto: claveDePuesto(c),
    nombre: nombreExportacion(c),
    tipoPagina: c.tipo ? tipoPaginaDe(c.tipo) : null,
    tituloUbicacion: tituloYUbicacionDe(c),
    faltaSeccionInferior: faltaSeccionInferior(d.ocr, c.pagina),
  };
}

describe("contrato de motor · base DIVIPOL", () => {
  test("la base del repo es la misma sobre la que se generó el golden", () => {
    expect(createHash("md5").update(DIVIPOL_CRUDO, "utf8").digest("hex")).toBe(GOLDEN.divipolMd5);
  });

  test("el golden está en la versión del contrato que este test sabe leer", () => {
    expect(GOLDEN.version).toBe(1);
    expect(GOLDEN.descriptores.length).toBeGreaterThanOrEqual(10);
  });
});

describe("contrato de motor · clasificación (misma entrada ⇒ mismo resultado que masiva)", () => {
  // El golden se auto-mide con performance.now() (la escalera del score depende
  // del tiempo simulado), así que cada descriptor cuesta 392-602 ms solo. Con el
  // default de 5 s y los 24 workers en isolate, un pico de carga de la máquina lo
  // hacía TIMED OUT sin que el contrato cambiara: rojo falso.
  for (const d of GOLDEN.descriptores) {
    test(`${d.id} — ${d.nota}`, () => {
      expect(clasificarCabecera(d.ocr, BASE)).toStrictEqual(d.esperado);
      // toStrictEqual también aquí (R-16): el golden se serializa con canon()
      // sin undefined — un derivado nuevo con hueco grita en vez de pasar.
      expect(derivadosDe(d)).toStrictEqual(d.derivados);
    }, 30_000);
  }
});

describe("contrato de motor · escalera score→status", () => {
  test("los cantos 8 y 6.5 siguen siendo OPTIMA/ADVERTENCIA/RECHAZADA", () => {
    expect(GOLDEN.estados.map(({ score }) => ({ score, status: statusDeScore(score) }))).toStrictEqual(
      GOLDEN.estados,
    );
  });
});
