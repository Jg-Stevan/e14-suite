import { describe, expect, it } from "vitest";

import { BYTES_MOTOR, RECURSOS_MOTOR, urlMotor } from "./offline";

describe("KIT e14-motor-offline-v1 — paquete de campo", () => {
  it("es una lista fija same-origin, sin URLs externas ni duplicados", () => {
    const rutas = RECURSOS_MOTOR.map((r) => r.ruta);
    expect(new Set(rutas).size).toBe(rutas.length);
    for (const r of RECURSOS_MOTOR) {
      expect(r.ruta.startsWith("/")).toBe(true);
      expect(r.ruta).not.toMatch(/^[a-z]+:\/\//i);
      expect(r.bytes).toBeGreaterThan(0);
      expect(urlMotor(r)).toContain(r.ruta);
      expect(urlMotor(r)).not.toMatch(/^[a-z]+:\/\/(?!localhost)/i);
    }
  });

  it("cubre OpenCV, ONNX, RapidOCR, Tesseract y workers", () => {
    const grupos = new Set(RECURSOS_MOTOR.map((r) => r.grupo));
    expect(grupos).toEqual(
      new Set(["opencv", "onnx", "rapidocr", "tesseract", "workers"]),
    );
  });

  it("pesa lo que el operador verá antes de descargar (40-60 MB)", () => {
    const mb = BYTES_MOTOR / 1_048_576;
    expect(mb).toBeGreaterThan(40);
    expect(mb).toBeLessThan(60);
  });
});
