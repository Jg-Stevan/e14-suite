/**
 * Tests del detector de MARCO IMPRESO compartido (KIT e63c D63-C / e63d) —
 * funciones PURAS del paquete: bitmaps sintéticos, sin DOM.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluarMarcoDeBitmap,
  marcoPerdonadoPorLectura,
} from "../src/dominio/marco-escaneo";

function bitmapBlanco(ancho: number, alto: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(ancho * alto * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = 255;
  }
  return rgba;
}

function pintarFila(rgba: Uint8ClampedArray, ancho: number, y: number, desde: number, hasta: number, v = 0): void {
  for (let x = desde; x < hasta; x++) {
    const p = (y * ancho + x) * 4;
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
  }
}

function pintarColumna(rgba: Uint8ClampedArray, ancho: number, x: number, desde: number, hasta: number, v = 0): void {
  for (let y = desde; y < hasta; y++) {
    const p = (y * ancho + x) * 4;
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
  }
}

describe("evaluarMarcoDeBitmap — veredictos del marco impreso", () => {
  const ANCHO = 400;
  const ALTO = 700;

  test("4 líneas inset → completo con rect del formulario", () => {
    const rgba = bitmapBlanco(ANCHO, ALTO);
    const inset = 20;
    pintarFila(rgba, ANCHO, inset, inset, ANCHO - inset);
    pintarFila(rgba, ANCHO, ALTO - inset - 1, inset, ANCHO - inset);
    pintarColumna(rgba, ANCHO, inset, inset, ALTO - inset);
    pintarColumna(rgba, ANCHO, ANCHO - inset - 1, inset, ALTO - inset);
    const marco = evaluarMarcoDeBitmap(ANCHO, ALTO, rgba);
    expect(marco.veredicto).toBe("completo");
    expect(marco.rect).not.toBeNull();
    expect(marco.rect!.x0).toBeCloseTo(inset / ANCHO, 5);
    expect(marco.rect!.y0).toBeCloseTo(inset / ALTO, 5);
    expect(marco.rect!.x1).toBeCloseTo((ANCHO - inset - 1) / ANCHO, 5);
    expect(marco.rect!.y1).toBeCloseTo((ALTO - inset - 1) / ALTO, 5);
  });

  test("2 líneas inset → cortado (el escáner cortó contenido)", () => {
    const rgba = bitmapBlanco(ANCHO, ALTO);
    pintarFila(rgba, ANCHO, 20, 20, ANCHO - 20);
    pintarFila(rgba, ANCHO, ALTO - 21, 20, ANCHO - 20);
    expect(evaluarMarcoDeBitmap(ANCHO, ALTO, rgba).veredicto).toBe("cortado");
  });

  test("líneas en el filo opuestas → ceñido (corte geométrico, no bloquea)", () => {
    const rgba = bitmapBlanco(ANCHO, ALTO);
    for (let y = 0; y < 5; y++) pintarFila(rgba, ANCHO, y, 0, ANCHO);
    for (let y = ALTO - 5; y < ALTO; y++) pintarFila(rgba, ANCHO, y, 0, ANCHO);
    expect(evaluarMarcoDeBitmap(ANCHO, ALTO, rgba).veredicto).toBe("ceñido");
  });

  test("hoja lisa sin marco → no-encontrado", () => {
    const rgba = bitmapBlanco(ANCHO, ALTO);
    expect(evaluarMarcoDeBitmap(ANCHO, ALTO, rgba)).toEqual({
      veredicto: "no-encontrado",
      rect: null,
    });
  });

  test("bitmap inválido → no-encontrado (jamás tumba el pipeline)", () => {
    expect(evaluarMarcoDeBitmap(0, 0, new Uint8ClampedArray(0)).veredicto).toBe("no-encontrado");
    expect(evaluarMarcoDeBitmap(10, 10, new Uint8ClampedArray(4)).veredicto).toBe("no-encontrado");
  });
});

describe("marcoPerdonadoPorLectura — trío F0.2 (cortado + FUERTE + sección)", () => {
  test("cortado + lectura FUERTE + sin sección faltante → perdona", () => {
    expect(marcoPerdonadoPorLectura("cortado", "FUERTE", false)).toBe(true);
  });

  test("cualquier otra combinación NO perdona", () => {
    expect(marcoPerdonadoPorLectura("cortado", "FUERTE", true)).toBe(false);
    expect(marcoPerdonadoPorLectura("cortado", "MEDIA", false)).toBe(false);
    expect(marcoPerdonadoPorLectura("cortado", "DEBIL", false)).toBe(false);
    expect(marcoPerdonadoPorLectura("completo", "FUERTE", false)).toBe(false);
    expect(marcoPerdonadoPorLectura("ceñido", "FUERTE", false)).toBe(false);
    expect(marcoPerdonadoPorLectura("no-encontrado", "FUERTE", false)).toBe(false);
  });
});
