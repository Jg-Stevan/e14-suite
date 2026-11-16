/**
 * Tests del detector de ORIGEN compartido (KIT e63a D63-A / e63d) —
 * señales puras: EXIF sintético + bitmaps sintéticos, sin DOM.
 */
import { describe, expect, test } from "bun:test";

import {
  clasificarOrigen,
  senalExifCamara,
  tintaAlFiloSimetrica,
  type OrigenBitmap,
} from "../src/dominio/origen-escaneo";

function bitmap(
  ancho: number,
  alto: number,
  pixel: (x: number, y: number) => [number, number, number],
): OrigenBitmap {
  const rgba = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * ancho + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return { ancho, alto, rgba };
}

/** JPEG mínimo: SOI + APP1 "Exif\0\0" + TIFF LE con Make inline. */
function jpegConMake(): Uint8Array {
  const tiff = new Uint8Array(26);
  tiff[0] = 0x49; // I
  tiff[1] = 0x49; // I (little endian)
  tiff[2] = 0x2a;
  tiff[3] = 0x00;
  tiff[4] = 0x08; // offset IFD0 = 8
  tiff[8] = 0x01; // IFD0: n entradas = 1
  tiff[10] = 0x0f; // tag 0x010F (Make)
  tiff[11] = 0x01;
  tiff[12] = 0x02; // type ASCII
  tiff[14] = 0x04; // count 4
  tiff[18] = 0x43; // C
  tiff[19] = 0x41; // A
  tiff[20] = 0x4d; // M
  const len = 2 + 6 + tiff.length;
  const jpeg = new Uint8Array(2 + 2 + len + 2);
  jpeg[0] = 0xff;
  jpeg[1] = 0xd8;
  jpeg[2] = 0xff;
  jpeg[3] = 0xe1;
  jpeg[4] = (len >> 8) & 0xff;
  jpeg[5] = len & 0xff;
  jpeg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"
  jpeg.set(tiff, 12);
  jpeg[jpeg.length - 2] = 0xff;
  jpeg[jpeg.length - 1] = 0xd9;
  return jpeg;
}

describe("senalExifCamara — señal de cámara sobre el prefijo del archivo", () => {
  test("JPEG con APP1 y Make → exif-camara", () => {
    expect(senalExifCamara(jpegConMake())).toBe("exif-camara");
  });

  test("contenedor HEIC/HEIF (ftyp) → heic", () => {
    const bytes = new Uint8Array(16);
    bytes.set([0, 0, 0, 24], 0);
    bytes.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    bytes.set([0x68, 0x65, 0x69, 0x63], 8); // heic
    expect(senalExifCamara(bytes)).toBe("heic");
  });

  test("PNG/bytes raros → null (lo decide el bitmap)", () => {
    expect(senalExifCamara(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBeNull();
    expect(senalExifCamara(new Uint8Array())).toBeNull();
  });
});

describe("clasificarOrigen — regla conservadora del kit", () => {
  test("EXIF de cámara manda sobre cualquier bitmap", () => {
    const escaneo = bitmap(300, 400, () => [255, 255, 255]);
    expect(clasificarOrigen(escaneo, "exif-camara")).toEqual({ origen: "foto", senales: "exif-camara" });
    expect(clasificarOrigen(escaneo, "heic")).toEqual({ origen: "foto", senales: "heic" });
  });

  test("sin bitmap → duda honesta (null)", () => {
    expect(clasificarOrigen(null, null)).toEqual({ origen: null, senales: "sin-exif+sin-bitmap" });
  });

  test("borde blanco uniforme + forma alargada E-14 → escaneo", () => {
    const b = bitmap(100, 300, () => [255, 255, 255]);
    const r = clasificarOrigen(b, null);
    expect(r.origen).toBe("escaneo");
    expect(r.senales).toContain("borde-blanco");
    expect(r.senales).toContain("ratio-e14");
  });

  test("tinta al filo simétrica sobre papel → escaneo ceñido", () => {
    // Rayas verticales negras/blancas en el filo superior e inferior.
    const b = bitmap(200, 600, (x, y) => {
      const enFilo = y < 2 || y >= 598;
      return enFilo && x % 2 === 0 ? [0, 0, 0] : [255, 255, 255];
    });
    expect(tintaAlFiloSimetrica(b)).toBe(true);
    expect(clasificarOrigen(b, null).origen).toBe("escaneo");
  });

  test("forma de foto estándar sin borde blanco → null honesto", () => {
    // 3:4 con textura gris (foto de documento sobre mesa).
    const b = bitmap(300, 400, (x, y) => {
      const v = 80 + ((x * 7 + y * 13) % 40);
      return [v, v, v];
    });
    expect(clasificarOrigen(b, null).origen).toBeNull();
  });
});
