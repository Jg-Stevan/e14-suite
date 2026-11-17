/**
 * KIT e14-post-det-worker-v1 (R-45) — TEST del cliente del postproceso DB.
 *
 * Acotado y honesto: en bun NO hay `window` (el guard del cliente devuelve
 * false — `dbPostprocessEnWorkerHabilitado()`), así que `dbPostprocessRemoto`
 * ejercita SIEMPRE el fallback local. El ancla es exactamente la que pide el
 * kit: el fallback local es EL MISMO módulo puro — misma entrada sintética,
 * mismo resultado que llamar `dbPostprocess` a mano. La ruta en worker (el
 * round-trip real) no es simulable en bun sin DOM; su contrato de mensajes se
 * ancla por composición: el worker llama a ESTE MISMO `dbPostprocess`
 * (test de caracterización del supervisor) y el cliente degrada a él.
 *
 * Doctrina "jamás throw": el cliente promete jamás lanzar hacia `inferDet`
 * — el test también ejercita entradas degeneradas (pred vacío) que deben
 * resolver (a cajas vacías), no rechazar.
 */
import { describe, expect, test } from "bun:test";
import { dbPostprocess } from "../src/ocr/db-postprocess";
import {
  dbPostprocessEnWorkerHabilitado,
  dbPostprocessRemoto,
} from "../src/ocr/db-postprocess-client";

const OPS: Parameters<typeof dbPostprocess>[3] = {
  w: 64,
  h: 64,
  ratioW: 1,
  ratioH: 1,
  padTop: 0,
  ratioWDet: 1,
  ratioHDet: 1,
};

/** pred 64×64 con un bloque "tinta" (1.0) rodeado de papel (0.0): un
 *  componente que el DB postproceso debe detectar como UNA caja. */
function predConBloque(): Float32Array {
  const pw = 64;
  const ph = 64;
  const pred = new Float32Array(pw * ph);
  for (let y = 20; y <= 40; y++) {
    for (let x = 12; x <= 50; x++) pred[y * pw + x] = 1;
  }
  return pred;
}

describe("db-postprocess-client · fallback local == módulo puro", () => {
  test("sin window (bun headless) la ruta en worker está deshabilitada", () => {
    expect(dbPostprocessEnWorkerHabilitado()).toBe(false);
  });

  test("dbPostprocessRemoto == dbPostprocess con pred sintético (misma referencia de módulo)", async () => {
    const pred = predConBloque();
    const local = dbPostprocess(pred, 64, 64, OPS, 640, 640);
    const remoto = await dbPostprocessRemoto(pred, 64, 64, OPS, 640, 640);
    expect(remoto.nBoxes).toBe(local.nBoxes);
    expect(remoto.nBoxes).toBe(1);
    expect(remoto.boxesFuente).toEqual(local.boxesFuente);
  });

  test("pred vacío (sin tinta) — degradación honesta: resuelve a 0 cajas, jamás throw", async () => {
    const pred = new Float32Array(64 * 64);
    const remoto = await dbPostprocessRemoto(pred, 64, 64, OPS, 640, 640);
    expect(remoto.nBoxes).toBe(0);
    expect(remoto.boxesFuente).toEqual([]);
  });
});
