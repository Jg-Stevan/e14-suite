/**
 * CARACTERIZACIÓN (R-28 + R-29, auditoría 2026-11-16) — scanner-core-bridge.ts.
 *
 * Congela el COMPORTAMIENTO OBSERVABLE del módulo ANTES de particionarlo en
 * `bridge/` (R-28). Reglas del juego:
 *  · Los CASOS no cambian con el refactor — si el detalle interno se muda, SOLO
 *    se actualizan imports/rutas de este archivo (nunca las aserciones).
 *  · Se testea lo determinista SIN navegador: funciones puras del mapeo §4,
 *    gate §4.2, construcción de acta, watchdogs y la API pública de
 *    RealCoreBridge, mockeando las dependencias de borde (paquete
 *    scanner-core, motores OCR, pipeline L2) — mismo patrón que
 *    ocr-cascada.test.ts / cola-dedupe.test.ts.
 *  · Los valores esperados se congelaron ejecutando el código ORIGINAL: son la
 *    especificación viva (techos 7.9/6.4/4.9, piso lectura 8.5, copy de
 *    rechazo, formato de trazas D51, semilla honesta §1.2…).
 *
 * Acceso a los helpers internos: `pasosPipelineL2()` ES el contrato público de
 * inyección (FASE F — el cuerpo de §5 en pipeline.ts los consume), y los
 * métodos privados se alcanzan por cast (TypeScript privado es compile-time).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks de borde (hoisted — afectan a TODO el archivo) ──────────────────
// El pipeline L2 (cuerpo de §5) se mockea: su contrato ya tiene golden propio
// (gate.paridad) y aquí solo interesa el ALAMBRE del bridge.
vi.mock("../pipeline", () => ({
  correrPipelineL2: vi.fn(),
}));

// image-processor: se mockean las funciones de CANVAS/worker; nivelPorPuntaje
// y puntajeCalidad (fórmula §4.1) quedan REALES — scoreDeCalidad las consume.
vi.mock("@jg-stevan/scanner-core/core/image-processor", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@jg-stevan/scanner-core/core/image-processor")
  >();
  return {
    ...actual,
    fileToCaptureDataUrl: vi.fn(),
    processImage: vi.fn(),
    evaluateQuality: vi.fn(),
    detectDocumentEdgesDetail: vi.fn(),
  };
});

// image-utils: canvas/decode simulados (entorno node, sin DOM).
vi.mock("@jg-stevan/scanner-core/dominio/image-utils", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@jg-stevan/scanner-core/dominio/image-utils")
  >();
  return {
    ...actual,
    loadImageMemo: vi.fn(),
    procesadaVaciaDataUrl: vi.fn(),
    canvasCon: vi.fn(),
  };
});

// Motor OCR de producción: sesión + reconocer mockeados, caps reales.
vi.mock("../ocr/rapidocr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ocr/rapidocr")>();
  return {
    ...actual,
    rapidOcrInit: vi.fn(),
    rapidOcrReconocer: vi.fn(),
  };
});

// Tesseract (intento 1 de la cascada) — jamás debe correr aquí.
vi.mock("../ocr/tesseract", () => ({
  tessReconocer: vi.fn(async () => {
    throw new Error("tesseract no debe correr en caracterización");
  }),
}));

// Probe de orientación: null = no aplica rotación (§2.1 paso 4).
vi.mock("../orientacion", () => ({
  probeOrientacion: vi.fn(async () => null),
  rotarDataUrl: vi.fn(async (d: string) => d),
}));

// Worker OpenCV: SSR/worker muerto por default (false inmediato).
vi.mock("@jg-stevan/scanner-core/core/detector-client", () => ({
  getScannerWorker: vi.fn(() => null),
  warmUpScannerWorker: vi.fn(),
}));

// Integridad: marcasEsquina → null («sin medida honesta no se condena»).
vi.mock("@jg-stevan/scanner-core/dominio/integridad", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@jg-stevan/scanner-core/dominio/integridad")
  >();
  return {
    ...actual,
    marcasEsquina: vi.fn(async () => null),
  };
});

// Completitud (GUARD-BORDE): verificación sana por defecto.
vi.mock("@jg-stevan/scanner-core/dominio/completitud", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@jg-stevan/scanner-core/dominio/completitud")
  >();
  return {
    ...actual,
    verificarCompletitud: vi.fn(async () => ({
      completa: true,
      fondo: false,
      sospecha: null,
      tintaFilo: false,
      densidades: [],
      perdonLado: null,
    })),
  };
});

// Marcadores de votos: zona con tinta.
vi.mock("@jg-stevan/scanner-core/dominio/marcadores", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@jg-stevan/scanner-core/dominio/marcadores")
  >();
  return {
    ...actual,
    medirZonaVotos: vi.fn(async () => ({ hayVotos: true, densidadVotosPct: 4.2 })),
  };
});

// DIVIPOL: base VACÍA (determinista — sin red): la clasificación degrada a
// SUGERIDA con parciales crudos, camino MANUAL puro en campo.
vi.mock("@jg-stevan/scanner-core/dominio/divipol", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@jg-stevan/scanner-core/dominio/divipol")
  >();
  return {
    ...actual,
    cargarDivipol: vi.fn(async () => ({})),
  };
});

import { RealCoreBridge } from "../scanner-core-bridge";
import type {
  OpcionesEscaneoConTimeout,
  PasosPipelineL2,
} from "../scanner-core-bridge";
import { correrPipelineL2 } from "../pipeline";
import { fileToCaptureDataUrl, processImage, evaluateQuality, detectDocumentEdgesDetail } from "@jg-stevan/scanner-core/core/image-processor";
import { loadImageMemo, procesadaVaciaDataUrl, canvasCon } from "@jg-stevan/scanner-core/dominio/image-utils";
import { rapidOcrInit, rapidOcrReconocer } from "../ocr/rapidocr";
import { getScannerWorker } from "@jg-stevan/scanner-core/core/detector-client";
import { logger } from "@jg-stevan/scanner-core/dominio/logger";
import type { ClasificacionE14 } from "@jg-stevan/scanner-core/dominio/clasificador";
import type { Acta, ProgresoAnalisis } from "@jg-stevan/scanner-core/dominio/types";
import type { PageQuality, Quad } from "@jg-stevan/scanner-core/core/types";
import { IMAGENES_SIMULADAS } from "../simulacion-imagenes";

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Calidad del core 80/80/80 excellent (bruto 8.0 — sin caps de level). */
const CALIDAD_80: PageQuality & { sharpnessHi: number; contrastPapel: number } = {
  level: "excellent",
  sharpness: 80,
  brightness: 80,
  contrast: 80,
  label: "EXCELENTE",
  sharpnessHi: 0,
  contrastPapel: 0,
};

/** OCR con el que la clasificación (base vacía) sale SUGERIDA · pág 1/2 ·
 *  tipo TRANSMISIÓN · señal FUERTE (5 anclas) · sin 2.ª pasada. */
const TEXTO_OCR = [
  "TARJETA ELECTORAL E-14",
  "REGISTRADURIA NACIONAL",
  "TRANSMISIÓN",
  "MESA: 001",
  "SUMA TOTAL",
  "LUGAR DE VOTACION: PUESTO PRINCIPAL",
  "Ver.: 1 Pag.: 1 de 2",
  "202610271234567",
].join("\n");

const QUAD_TEST: Quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

const CLASIF_AUTO: ClasificacionE14 = {
  departamento: { codigo: "88", nombre: "CONSULADOS" },
  municipio: { codigo: "335", nombre: "ITALIA" },
  zona: { codigo: "05" },
  puesto: { codigo: "02", nombre: "ROMA - CONSULADO" },
  mesa: 1,
  tipo: "TRANSMISION",
  pagina: { index: 1, total: 2 },
  kit: 399,
  nivel: "AUTO",
  confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
  parciales: { cabecera: true, mesa: 1, tipo: "TRANSMISION" },
  codigoUnico: null,
  avisos: [],
  kitFuente: null,
  clasifDebil: null,
};

/** Acta mínima para recortar/revelar/reconocerTexto. */
function actaBase(extra: Partial<Acta> = {}): Acta {
  return {
    id: "acta-fixture-1",
    titulo: "TITULO ORIGINAL",
    ubicacion: { departamento: "d", municipio: "m", zona: "z", puesto: "p", mesa: "001" },
    tipo: "SIN CLASIFICAR",
    pagina: { index: 1, total: 2 },
    candidatos: [],
    firmas: [
      { nombre: "—", jurado: "JURADO 1", estado: "OK" },
      { nombre: "—", jurado: "JURADO 2", estado: "OK" },
      { nombre: "—", jurado: "JURADO 3", estado: "OK" },
    ],
    score: 5,
    status: "RECHAZADA",
    rechazo: { tipo: "ILEGIBLE", detalle: "x" },
    intento: 2,
    maxIntentos: 4,
    fuente: "ARCHIVO",
    fotoOriginal: "data:image/jpeg;base64,ORIGINAL",
    fotoProcesada: "data:image/jpeg;base64,VIEJA",
    ocrTexto: "viejo",
    motor: "canvas",
    quadDetectado: QUAD_TEST,
    rotation: 0,
    filtro: "bw",
    ...extra,
  } as Acta;
}

/** Canvas falso: gris plano 128 (señales hi-res 0/0) + toDataURL espiado. */
function canvasPlano() {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
      return { data };
    },
    putImageData: vi.fn(),
  };
  return (w: number, h: number) => ({
    width: w,
    height: h,
    getContext: () => ctx,
    toDataURL: vi.fn(
      (mime: string, q?: number) => `data:${mime};base64,MOCK;q=${q ?? "-"}`,
    ),
  });
}

/** Puntos de acceso a las piezas internas (contrato FASE F + casts). */
function pasos(): PasosPipelineL2 {
  return (new RealCoreBridge() as unknown as {
    pasosPipelineL2: () => PasosPipelineL2;
  }).pasosPipelineL2();
}
function privados() {
  return new RealCoreBridge() as unknown as {
    evaluarGate: (
      score: number,
      ocrTexto: string,
      clasificacion: ClasificacionE14,
      intento: number,
      maxIntentos: number,
    ) => { status: string; rechazo: Acta["rechazo"]; clasificacion: ClasificacionE14 | null };
    construirActa: (
      opciones: OpcionesEscaneoConTimeout,
      parcial: Record<string, unknown>,
      campos: Record<string, unknown>,
    ) => Acta;
    firmasPorStatus: (
      firmas: Acta["firmas"],
      status: Acta["status"],
    ) => Acta["firmas"];
  };
}

const optsEscaneo = (extra: Partial<OpcionesEscaneoConTimeout> = {}): OpcionesEscaneoConTimeout => ({
  objetivo: null,
  intento: 1,
  maxIntentos: 3,
  fuente: "ARCHIVO",
  ...extra,
});

// ─── Setup común ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadImageMemo).mockResolvedValue({
    naturalWidth: 100,
    naturalHeight: 200,
  } as unknown as HTMLImageElement);
  vi.mocked(procesadaVaciaDataUrl).mockResolvedValue(false);
  const plano = canvasPlano();
  vi.mocked(canvasCon).mockImplementation((w: number, h: number) =>
    plano(w, h) as unknown as HTMLCanvasElement,
  );
  vi.mocked(evaluateQuality).mockResolvedValue(CALIDAD_80 as PageQuality);
  vi.mocked(fileToCaptureDataUrl).mockResolvedValue("data:image/jpeg;base64,DECODE");
  vi.mocked(rapidOcrInit).mockResolvedValue({} as never);
  vi.mocked(rapidOcrReconocer).mockResolvedValue({
    texto: TEXTO_OCR,
    confMedia: 0.9,
    msDet: 10,
    msRec: 20,
    msCrops: 5,
    nBoxes: 3,
    lineas: [{ texto: "x" }],
    msRunRec: 2,
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ─── §4.1 scoreDeCalidad — el mapeo core→score 0-10 ────────────────────────

describe("caracterización · scoreDeCalidad (mapeo §4.1)", () => {
  it("métricas excellent con señales → bruto redondeado a 1 decimal (hi-res manda)", () => {
    const p = pasos();
    // sharpnessHi 100 > sharpness 60 → usa 100 y RECALCULA el level con la
    // fórmula del paquete (puntaje 96 → excellent): (100·0.4+90·0.3+95·0.3)/10
    // = 9.55 → 9.6.
    const score = p.scoreDeCalidad(
      { ...CALIDAD_80, sharpness: 60, brightness: 90, contrast: 95, sharpnessHi: 100 },
      { ocrLegible: true, identificada: true, conSenal: true },
    );
    expect(score).toBe(9.6);
  });

  it("level fair ENTRADO → techo ADVERTENCIA 7.9 (el level manda sobre el bruto)", () => {
    const p = pasos();
    const score = p.scoreDeCalidad(
      { ...CALIDAD_80, level: "fair" },
      { ocrLegible: true, identificada: true, conSenal: true },
    );
    expect(score).toBe(7.9);
  });

  it("level poor → techo RECHAZADA 6.4", () => {
    const p = pasos();
    const score = p.scoreDeCalidad(
      { ...CALIDAD_80, level: "poor" },
      { ocrLegible: true, identificada: true, conSenal: true },
    );
    expect(score).toBe(6.4);
  });

  it("SIN señal de contenido (§D1) → techo 4.9 aunque las métricas sean 8.0", () => {
    const p = pasos();
    const score = p.scoreDeCalidad(CALIDAD_80, {
      ocrLegible: true,
      identificada: true,
      conSenal: false,
    });
    expect(score).toBe(4.9);
  });

  it("pisoPerfecto (lectura FUERTE + anclas + tinta) → 10 EXACTO aun con brillo 10", () => {
    const p = pasos();
    const score = p.scoreDeCalidad(
      { ...CALIDAD_80, brightness: 10, sharpnessHi: 95, contrastPapel: 80 },
      { ocrLegible: true, identificada: true, conSenal: true, pisoPerfecto: true },
    );
    expect(score).toBe(10);
  });

  it("OCR legible pisa el contraste bajo (piso 80 — «el OCR manda» §X.1)", () => {
    const p = pasos();
    // contraste crudo 22 + contrastPapel 30 + ocrLegible → contrasteEf 80:
    // bruto (70·0.4+70·0.3+80·0.3)/10 = 7.3; level recalculado (puntaje 73
    // → good, sin techo).
    const score = p.scoreDeCalidad(
      { ...CALIDAD_80, sharpness: 70, brightness: 70, contrast: 22, contrastPapel: 30 },
      { ocrLegible: true, identificada: false, conSenal: true },
    );
    expect(score).toBe(7.3);
  });

  it("SIN ocrLegible NO aplica el piso de contraste (80 queda en 22)", () => {
    const p = pasos();
    const con = p.contrasteEfectivoDe(
      { ...CALIDAD_80, contrast: 22, contrastPapel: 30 } as never,
      false,
    );
    const sin = p.contrasteEfectivoDe(
      { ...CALIDAD_80, contrast: 22, contrastPapel: 30 } as never,
      true,
    );
    expect(con).toBe(30); // max(22, 30, 0)
    expect(sin).toBe(80); // max(22, 30, 80)
  });
});

// ─── §4.2 evaluarGate — desenlace status/rechazo/clasificación ─────────────

describe("caracterización · evaluarGate (gate §4.2)", () => {
  it("score ≥ 6.5 + AUTO → status por score (OPTIMA/ADVERTENCIA) y clasificación persistida", () => {
    const b = privados();
    const optima = b.evaluarGate(8, TEXTO_OCR, CLASIF_AUTO, 1, 3);
    expect(optima.status).toBe("OPTIMA");
    expect(optima.rechazo).toBeNull();
    expect(optima.clasificacion).toBe(CLASIF_AUTO);
    expect(b.evaluarGate(7, TEXTO_OCR, CLASIF_AUTO, 1, 3).status).toBe("ADVERTENCIA");
  });

  it("score ≥ 6.5 + SUGERIDA/MANUAL → EN_REVISION_HUMANA «repetir-primero» sin rechazo", () => {
    const b = privados();
    const r = b.evaluarGate(9.5, TEXTO_OCR, { ...CLASIF_AUTO, nivel: "MANUAL" }, 1, 3);
    expect(r.status).toBe("EN_REVISION_HUMANA");
    expect(r.rechazo).toBeNull();
    expect(r.clasificacion).not.toBeNull();
  });

  it("score < 6.5 con intentos → RECHAZADA por CALIDAD; GENERICO si el OCR leyó, ILEGIBLE si no", () => {
    const b = privados();
    const conTexto = b.evaluarGate(6, TEXTO_OCR, CLASIF_AUTO, 1, 3);
    expect(conTexto.status).toBe("RECHAZADA");
    expect(conTexto.rechazo).toEqual({
      tipo: "GENERICO",
      detalle: "SCORE INSUFICIENTE PARA TRANSMISIÓN",
    });
    expect(conTexto.clasificacion).toBeNull();
    const sinTexto = b.evaluarGate(6, "", CLASIF_AUTO, 1, 3);
    expect(sinTexto.rechazo).toEqual({
      tipo: "ILEGIBLE",
      detalle: "CÓDIGO DE BARRAS Y CABECERA NO DETECTADOS",
    });
  });

  it("score < 6.5 al AGOTAR intentos → contingencia C4 automática (EN_REVISION_HUMANA)", () => {
    const b = privados();
    const r = b.evaluarGate(6, TEXTO_OCR, CLASIF_AUTO, 3, 3);
    expect(r.status).toBe("EN_REVISION_HUMANA");
    expect(r.rechazo?.tipo).toBe("GENERICO");
  });
});

// ─── construirActa — semilla honesta §1.2 + campos reales §3.1 ─────────────

describe("caracterización · construirActa (acta al nacer)", () => {
  it("sin clasificación → SIN relleno de demo: título/ubicación/tipo honestos y página del objetivo", () => {
    const b = privados();
    const acta = b.construirActa(
      optsEscaneo({ objetivo: { mesaId: "MESA 07", tipo: "TRANSMISIÓN", pagina: 2 } }),
      {},
      { score: 7, status: "ADVERTENCIA", rechazo: null },
    );
    expect(acta.titulo).toBe("ACTA SIN IDENTIFICAR");
    expect(acta.ubicacion).toEqual({
      departamento: "—",
      municipio: "—",
      zona: "—",
      puesto: "—",
      mesa: "007",
    });
    expect(acta.tipo).toBe("SIN CLASIFICAR");
    expect(acta.pagina).toEqual({ index: 2, total: 2 });
    expect(acta.candidatos).toEqual([]);
    expect(acta.codigoBarras).toBeUndefined();
  });

  it("id = acta-{Date.now()}-{contador} y el contador avanza POR INSTANCIA", () => {
    const b = privados();
    const a1 = b.construirActa(optsEscaneo(), {}, { score: 1, status: "RECHAZADA", rechazo: null });
    const a2 = b.construirActa(optsEscaneo(), {}, { score: 1, status: "RECHAZADA", rechazo: null });
    const ts = Date.now();
    expect(a1.id).toMatch(new RegExp(`^acta-${ts}-1$`));
    expect(a2.id).toMatch(new RegExp(`^acta-${ts}-2$`));
  });

  it("qrCam: leido → payload+estado · null → solo estado · undefined → campos AUSENTES", () => {
    const b = privados();
    const campos = { score: 8, status: "OPTIMA" as const, rechazo: null };
    const leido = b.construirActa(optsEscaneo(), { qrCam: { payload: "abc" } }, campos);
    expect(leido.qrPayload).toBe("abc");
    expect(leido.qrEstado).toBe("leido");
    const sinPayload = b.construirActa(optsEscaneo(), { qrCam: null }, campos);
    expect(sinPayload.qrPayload).toBeUndefined();
    expect(sinPayload.qrEstado).toBe("sin-payload");
    const sinQr = b.construirActa(optsEscaneo(), {}, campos);
    expect(sinQr.qrPayload).toBeUndefined();
    expect(sinQr.qrEstado).toBeUndefined();
  });

  it("defaults de los campos reales: filtro bw · motor canvas · rotation 0 · metricas desde calidad", () => {
    const b = privados();
    const acta = b.construirActa(
      optsEscaneo({ fuente: "CAMARA" }),
      { fotoOriginal: "data:o" },
      {
        score: 8,
        status: "OPTIMA",
        rechazo: null,
        calidad: { level: "good", sharpness: 40, brightness: 50, contrast: 60, label: "X" },
        fotoProcesada: "data:p",
        ocrTexto: "t",
      },
    );
    expect(acta.filtro).toBe("bw");
    expect(acta.motor).toBe("canvas");
    expect(acta.rotation).toBe(0);
    expect(acta.metricas).toEqual({ sharpness: 40, brightness: 50, contrast: 60 });
    expect(acta.recortada).toBe(false);
    expect(acta.recorteLado).toBeNull();
    expect(acta.fotoOriginal).toBe("data:o");
    expect(acta.fotoProcesada).toBe("data:p");
  });

  it("firmas coherentes con el estado: ADVERTENCIA→TENUE · RECHAZADA→NO_DETECTADO · resto OK", () => {
    const b = privados();
    const f = actaBase().firmas;
    expect(b.firmasPorStatus(f, "ADVERTENCIA")[1].estado).toBe("TENUE");
    expect(b.firmasPorStatus(f, "RECHAZADA")[1].estado).toBe("NO_DETECTADO");
    expect(b.firmasPorStatus(f, "OPTIMA")[1].estado).toBe("OK");
    expect(b.firmasPorStatus(f, "OPTIMA")[0].estado).toBe("OK");
    // menos de 2 firmas → intactas
    expect(b.firmasPorStatus([f[0]], "RECHAZADA")).toEqual([f[0]]);
  });

  it("clasificación AUTO TRANSMISIÓN/DELEGADOS → título real + tipo SENADO/CÓNSUL", () => {
    const b = privados();
    const acta = b.construirActa(optsEscaneo(), {}, {
      score: 8,
      status: "OPTIMA",
      rechazo: null,
      clasificacion: CLASIF_AUTO,
    });
    expect(acta.tipo).toBe("SENADO DE LA REPÚBLICA");
    expect(acta.clasificacion).toBe(CLASIF_AUTO);
    expect(acta.pagina).toEqual({ index: 1, total: 2 }); // la de la clasificación
    const delegados = b.construirActa(optsEscaneo(), {}, {
      score: 8,
      status: "OPTIMA",
      rechazo: null,
      clasificacion: { ...CLASIF_AUTO, tipo: "DELEGADOS" },
    });
    expect(delegados.tipo).toBe("CÓNSUL/EMBAJADOR");
  });
});

// ─── Traza §4.6 + señal de contenido §D1 ───────────────────────────────────

describe("caracterización · fmtClasif y senalDeContenido (traza §4.6)", () => {
  it("fmtClasif: traza canónica dep/mun/zon/std/mesa/pag/tipo/nivel (+cod/av)", () => {
    const p = pasos();
    expect(p.fmtClasif(CLASIF_AUTO)).toBe(
      "dep:88,mun:335,zon:05,std:02,mesa:001,pag:1/2,tipo:T,nivel:AUTO",
    );
    expect(p.fmtClasif(null)).toBe("sin-clasificar");
    expect(
      p.fmtClasif({ ...CLASIF_AUTO, mesa: null, tipo: null, pagina: null, avisos: ["A", "B"] }),
    ).toBe("dep:88,mun:335,zon:05,std:02,mesa:?,pag:?,tipo:-,nivel:AUTO,av:A+B");
    expect(
      p.fmtClasif({ ...CLASIF_AUTO, codigoUnico: { crudo: "399-x" } as never }),
    ).toContain(",cod:399-x");
  });

  it("senalDeContenido: cabecera E-14 o lecturas crudas del clasificador (la bolsa de papas NO)", () => {
    const p = pasos();
    const sinSenal: ClasificacionE14 = { ...CLASIF_AUTO, parciales: undefined };
    expect(p.senalDeContenido("bolsa de papas texto ficticio del empaque", sinSenal)).toBe(false);
    expect(p.senalDeContenido("texto genérico", sinSenal)).toBe(false);
    expect(p.senalDeContenido("algo E-14 impreso", sinSenal)).toBe(true);
    expect(p.senalDeContenido("nada", { ...CLASIF_AUTO, parciales: { cabecera: true, mesa: null, tipo: null } })).toBe(true);
    expect(p.senalDeContenido("nada", { ...CLASIF_AUTO, parciales: { cabecera: false, mesa: 3, tipo: null } })).toBe(true);
    expect(p.senalDeContenido("nada", { ...CLASIF_AUTO, parciales: { cabecera: false, mesa: null, tipo: "DELEGADOS" } })).toBe(true);
  });
});

// ─── escanearActa — resolución de entrada (L3 §5) + watchdog §5 ────────────

describe("caracterización · escanearActa (entrada, inyección FASE F y watchdog)", () => {
  it("CÁMARA sin captura y ARCHIVO sin imagen → errores EXACTOS", async () => {
    const b = new RealCoreBridge();
    await expect(
      b.escanearActa(optsEscaneo({ fuente: "CAMARA", frameActual: null })),
    ).rejects.toThrow("SIN CAPTURA PARA ANALIZAR (fuente CÁMARA)");
    await expect(b.escanearActa(optsEscaneo({ fuente: "ARCHIVO" }))).rejects.toThrow(
      "SIN IMAGEN PARA ANALIZAR (fuente ARCHIVO)",
    );
  });

  it("CÁMARA con frame vivo → grab síncrono a JPEG 0.92 como entrada dataUrl", async () => {
    const b = new RealCoreBridge();
    const video = { readyState: 2, videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
    const capturas: unknown[] = [];
    vi.mocked(correrPipelineL2).mockImplementation(async (_o, entrada, _p, _e, _s) => {
      capturas.push(entrada);
      return actaBase({ score: 8, status: "OPTIMA", rechazo: null });
    });
    const acta = await b.escanearActa(optsEscaneo({ fuente: "CAMARA", frameActual: video }));
    expect(acta.status).toBe("OPTIMA");
    expect(capturas[0]).toEqual({ dataUrl: "data:image/jpeg;base64,MOCK;q=0.92" });
  });

  it("archivo → entra tal cual; escaneoId esc-*; pasos inyectados completos; progreso reenviado", async () => {
    const b = new RealCoreBridge();
    const archivo = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    let parcialRecibido: Record<string, unknown> | null = null;
    let emitirRecibido: ((p: { etapa: string; progreso: number }) => void) | null = null;
    let pasosRecibidos: PasosPipelineL2 | null = null;
    vi.mocked(correrPipelineL2).mockImplementation(async (_o, _e, parc, emit, pas) => {
      parcialRecibido = parc as Record<string, unknown>;
      emitirRecibido = emit as typeof emitirRecibido;
      pasosRecibidos = pas;
      return actaBase({ id: "acta-del-pipeline" });
    });
    const progreso: unknown[] = [];
    const acta = await b.escanearActa(
      optsEscaneo({ archivo, onProgreso: (p) => progreso.push(p) }),
    );
    expect(acta.id).toBe("acta-del-pipeline");
    expect(vi.mocked(correrPipelineL2)).toHaveBeenCalledWith(
      expect.anything(),
      { archivo },
      expect.objectContaining({ escaneoId: expect.stringMatching(/^esc-[\d.]+$/) }),
      expect.any(Function),
      expect.any(Object),
    );
    // El contrato de inyección FASE F: los 22 pasos documentados.
    expect(Object.keys(pasosRecibidos!).sort()).toEqual([
      "DETALLE_BAJO",
      "DETALLE_ILEGIBLE",
      "DETALLE_INCOMPLETA",
      "DETALLE_SIN_VOTOS",
      "TECHO_ESCUDO_FONDO",
      "TECHO_SIN_SENAL",
      "calidadDeActa",
      "conRampa",
      "construirActa",
      "contrasteEfectivoDe",
      "decodeArchivoMemo",
      "esperarWorkerCaliente",
      "esquinasDeActa",
      "evaluarGate",
      "fmtClasif",
      "ocrBanda",
      "ocrBandaInferior",
      "quadIdentidad",
      "reconocerRapidOcrCascada",
      "reconocerRapidOcrEscalonado",
      "scoreDeCalidad",
      "senalDeContenido",
    ]);
    // El emit del bridge reenvía el progreso mientras NO esté vencido.
    emitirRecibido!({ etapa: "DECODE", progreso: 0.5 });
    expect(progreso).toEqual([{ etapa: "DECODE", progreso: 0.5 }]);
  });

  it("SIMULACIÓN sin elección → PRIMERA imagen del catálogo, servida como File y CACHEADA (1 fetch)", async () => {
    const b = new RealCoreBridge();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["jpg"], { type: "image/jpeg" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const entradas: unknown[] = [];
    vi.mocked(correrPipelineL2).mockImplementation(async (_o, entrada) => {
      entradas.push(entrada);
      return actaBase();
    });
    await b.escanearActa(optsEscaneo({ fuente: "SIMULACION" }));
    await b.escanearActa(optsEscaneo({ fuente: "SIMULACION" }));
    const primera = IMAGENES_SIMULADAS[0];
    expect(fetchMock).toHaveBeenCalledTimes(1); // caché por id
    for (const e of entradas) {
      const archivo = (e as { archivo: File }).archivo;
      expect(archivo).toBeInstanceOf(File);
      expect(archivo.name).toBe(primera.nombre);
      expect(archivo.type).toBe("image/jpeg");
    }
  });

  it("watchdog: presupuesto vencido → acta RECHAZADA 0.0 ILEGIBLE por TIEMPO (no revienta la UI)", async () => {
    const b = new RealCoreBridge();
    vi.mocked(correrPipelineL2).mockImplementation(
      () => new Promise<Acta>(() => {}), // worker colgado
    );
    const progreso: unknown[] = [];
    const acta = await b.escanearActa(
      optsEscaneo({ archivo: new File(["x"], "colgado.jpg"), timeoutMs: 30, onProgreso: (p) => progreso.push(p) }),
    );
    expect(acta.status).toBe("RECHAZADA");
    expect(acta.score).toBe(0);
    expect(acta.rechazo).toEqual({ tipo: "ILEGIBLE", detalle: "TIEMPO DE PROCESADO EXCEDIDO" });
    expect(acta.firmas[1].estado).toBe("NO_DETECTADO");
    expect(acta.fuente).toBe("ARCHIVO");
    expect(progreso).toEqual([]); // nada se emite tras vencer
  });

  it("rescate tardío (e67 cambio B): el desenlace válido post-timeout viaja por onRescateTardio con ms reales", async () => {
    const b = new RealCoreBridge();
    const tardia = actaBase({ id: "acta-tardia", score: 9, status: "OPTIMA", rechazo: null });
    vi.mocked(correrPipelineL2).mockImplementation(
      () =>
        new Promise<Acta>((resolve) => {
          setTimeout(() => resolve(tardia), 80);
        }),
    );
    const rescates: Array<{ acta: Acta; ms: number }> = [];
    const acta = await b.escanearActa(
      optsEscaneo({
        archivo: new File(["x"], "tardia.jpg"),
        timeoutMs: 25,
        onRescateTardio: (a, ms) => rescates.push({ acta: a, ms }),
      }),
    );
    expect(acta.status).toBe("RECHAZADA"); // el watchdog resolvió primero
    await new Promise((r) => setTimeout(r, 120));
    expect(rescates).toHaveLength(1);
    expect(rescates[0].acta.id).toBe("acta-tardia");
    expect(rescates[0].ms).toBeGreaterThanOrEqual(80);
  });
});

// ─── recortar (L5 §7.5) ─────────────────────────────────────────────────────

describe("caracterización · recortar (L5 §7.5)", () => {
  it("sin fotoOriginal → rechazo EXACTO", async () => {
    const b = new RealCoreBridge();
    await expect(
      b.recortar(actaBase({ fotoOriginal: undefined }), QUAD_TEST),
    ).rejects.toThrow("SIN FOTO ORIGINAL PARA RECORTAR");
  });

  it("timeout del recorte (30 s) → acta vencida CON el recorte ya horneado, gate intacto", async () => {
    vi.useFakeTimers();
    const b = new RealCoreBridge();
    vi.mocked(processImage).mockResolvedValue({
      processed: "data:image/jpeg;base64,RECORTE-NUEVO",
      precision: { engine: "worker" },
    } as never);
    // El OCR cuelga: solo el warp (etapa 1) alcanza a hornear el parcial.
    vi.mocked(rapidOcrReconocer).mockImplementation(() => new Promise(() => {}));
    const promesa = b.recortar(actaBase({ titulo: "TITULO ORIGINAL" }), QUAD_TEST, undefined, 90);
    const acta = await vi.advanceTimersByTimeAsync(30_000).then(() => promesa);
    expect(acta.status).toBe("RECHAZADA");
    expect(acta.score).toBe(0);
    expect(acta.rechazo).toEqual({ tipo: "ILEGIBLE", detalle: "TIEMPO DE PROCESADO EXCEDIDO" });
    // KIT recorte-manual T1: el parcial del warp MANDA sobre la foto vieja.
    expect(acta.fotoProcesada).toBe("data:image/jpeg;base64,RECORTE-NUEVO");
    expect(acta.quadDetectado).toBe(QUAD_TEST);
    expect(acta.rotation).toBe(90);
    expect(acta.procesadaVacia).toBe(false);
    // Identidad + invariante del gate (RECHAZADA ⇒ sin clasificación).
    expect(acta.titulo).toBe("TITULO ORIGINAL");
    expect(acta.intento).toBe(2);
    expect(acta.firmas[1].estado).toBe("NO_DETECTADO");
    expect(acta.clasificacion).toBeUndefined();
  });

  it("camino feliz → acta ACTUALIZADA con gate re-evaluado, identidad intacta y log D51", async () => {
    const b = new RealCoreBridge();
    const infoLogger = vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.mocked(processImage).mockImplementation(async (_foto, _quad, filtro) =>
      ({
        processed: `data:image/jpeg;base64,PROC-${filtro}`,
        precision: { engine: "worker" },
      }) as never,
    );
    const acta = await b.recortar(actaBase(), QUAD_TEST, undefined, 90, null, true);
    // Gate re-evaluado completo: score bruto 8.0 → piso lectura FUERTE 8.5;
    // clasificación SUGERIDA (base vacía) → EN_REVISION_HUMANA sin rechazo.
    expect(acta.status).toBe("EN_REVISION_HUMANA");
    expect(acta.score).toBe(8.5);
    expect(acta.rechazo).toBeNull();
    expect(acta.clasificacion?.nivel).toBe("SUGERIDA");
    expect(acta.ocrTexto).toBe(TEXTO_OCR);
    expect(acta.metricas).toEqual({ sharpness: 80, brightness: 80, contrast: 80 });
    expect(acta.motor).toBe("worker");
    expect(acta.fotoProcesada).toBe("data:image/jpeg;base64,PROC-bw");
    expect(acta.quadDetectado).toBe(QUAD_TEST);
    expect(acta.rotation).toBe(90);
    // Identidad (el rescate D20 NO consume intento).
    expect(acta.id).toBe("acta-fixture-1");
    expect(acta.intento).toBe(2);
    expect(acta.maxIntentos).toBe(4);
    expect(acta.fuente).toBe("ARCHIVO");
    expect(acta.titulo).toBe("TITULO ORIGINAL"); // sin clasif AUTO → no reescribe
    expect(acta.firmas[1].estado).toBe("OK"); // EN_REVISION_HUMANA ≠ ADVERTENCIA/RECHAZADA
    expect(acta.recorteManualSinTinta).toBeUndefined(); // procesada CON tinta
    // Log-contrato D51 del recorte (tokens estables del contrato).
    const linea = infoLogger.mock.calls.map((c) => String(c[0])).find((s) => s.startsWith("[e14] recorte"));
    expect(linea).toBeDefined();
    expect(linea).toContain("[e14] recorte ARCHIVO total=");
    expect(linea).toContain("lectura=FUERTE");
    expect(linea).toContain("anclas=5");
    expect(linea).toContain("piso10=0");
    expect(linea).toContain("ocrIn=original");
    expect(linea).toContain("crop=85x170");
    expect(linea).toContain("metricas={sharpness:80 brightness:80 contrast:80 contEff:80 level:excellent}");
    expect(linea).toContain("clasif={dep:?,mun:?,zon:?,std:?,mesa:001,pag:1/2,tipo:T,nivel:SUGERIDA}");
    expect(linea).toContain("manual=1");
    expect(linea).toContain("diag=1");
    expect(acta.diagnostico).toBeDefined();
    infoLogger.mockRestore();
  });

  it("recorte MANUAL de foto sin tinta → recorteManualSinTinta (T3) y el aviso vive en el acta", async () => {
    const b = new RealCoreBridge();
    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.mocked(procesadaVaciaDataUrl).mockResolvedValue(true);
    const acta = await b.recortar(actaBase(), QUAD_TEST, undefined, 0, null, true);
    expect(acta.procesadaVacia).toBe(true);
    expect(acta.recorteManualSinTinta).toBe(true);
  });
});

// ─── revelar (F2 §F2.2) y reconocerTexto (F-OCR) ───────────────────────────

describe("caracterización · revelar / reconocerTexto / mejorarResolucion", () => {
  it("revelar: solo processImage (sin re-OCR), con quad del acta y manual: true", async () => {
    const b = new RealCoreBridge();
    await expect(b.revelar(actaBase({ fotoOriginal: undefined }), "bw")).rejects.toThrow(
      "SIN FOTO ORIGINAL PARA FILTRAR",
    );
    vi.mocked(processImage).mockResolvedValue({
      processed: "data:image/jpeg;base64,FILTRADA",
    } as never);
    const acta = await b.revelar(actaBase({ rotation: 180 }), "original");
    expect(vi.mocked(processImage)).toHaveBeenCalledWith(
      "data:image/jpeg;base64,ORIGINAL",
      QUAD_TEST,
      "original",
      180,
      { manual: true },
    );
    expect(acta.fotoProcesada).toBe("data:image/jpeg;base64,FILTRADA");
    expect(acta.filtro).toBe("original");
    expect(acta.score).toBe(5); // intacto — el gate ya resolvió
  });

  it("reconocerTexto: sin foto procesada → error; con original+quad lee el recorte SIN filtro (PROD-1)", async () => {
    const b = new RealCoreBridge();
    await expect(b.reconocerTexto(actaBase({ fotoProcesada: undefined }))).rejects.toThrow(
      "SIN FOTO PROCESADA PARA RECONOCER TEXTO",
    );
    // Regla PROD-1 §4.3: re-warp "original" + OCR del motor único.
    vi.mocked(processImage).mockResolvedValue({
      processed: "data:image/jpeg;base64,SIN-FILTRO",
    } as never);
    const texto = await b.reconocerTexto(actaBase());
    expect(vi.mocked(processImage)).toHaveBeenCalledWith(
      "data:image/jpeg;base64,ORIGINAL",
      QUAD_TEST,
      "original",
      0,
    );
    expect(vi.mocked(rapidOcrReconocer)).toHaveBeenCalledWith(
      expect.anything(),
      "data:image/jpeg;base64,SIN-FILTRO",
      undefined,
    );
    expect(texto).toBe(TEXTO_OCR);
    // Fallback (sin fotoOriginal): OCR directo de la procesada de hoy.
    vi.mocked(rapidOcrReconocer).mockClear();
    vi.mocked(processImage).mockClear();
    const textoFallback = await b.reconocerTexto(actaBase({ fotoOriginal: undefined }));
    expect(vi.mocked(processImage)).not.toHaveBeenCalled();
    expect(vi.mocked(rapidOcrReconocer)).toHaveBeenCalledWith(
      expect.anything(),
      "data:image/jpeg;base64,VIEJA",
      undefined,
    );
    expect(textoFallback).toBe(TEXTO_OCR);
  });

  it("mejorarResolucion: quad RE-DETECTADO sobre la foto nueva y fotoOriginal REEMPLAZADA (G3)", async () => {
    const b = new RealCoreBridge();
    vi.spyOn(logger, "info").mockImplementation(() => {});
    const QUAD_NUEVO = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    vi.mocked(detectDocumentEdgesDetail).mockResolvedValue({ quad: QUAD_NUEVO, origen: "sobel" } as never);
    const acta = await b.mejorarResolucion(actaBase(), "data:image/jpeg;base64,FULL-RES");
    expect(vi.mocked(detectDocumentEdgesDetail)).toHaveBeenCalledWith("data:image/jpeg;base64,FULL-RES");
    expect(acta.fotoOriginal).toBe("data:image/jpeg;base64,FULL-RES");
    expect(acta.quadDetectado).toBe(QUAD_NUEVO);
    expect(acta.status).toBe("EN_REVISION_HUMANA"); // gate completo re-evaluado
    expect(acta.id).toBe("acta-fixture-1"); // identidad de captura
  });
});

// ─── Horas de sesión (dosDigitos) ───────────────────────────────────────────

describe("caracterización · horaEnvio / horaHistorial", () => {
  it("HH:MM:SS y HH:MM con dos dígitos", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 16, 9, 5, 7));
    const b = new RealCoreBridge();
    expect(b.horaEnvio()).toBe("09:05:07");
    expect(b.horaHistorial()).toBe("09:05");
  });
});

// ─── decodeArchivoMemo (perf/decode-once A5) ───────────────────────────────

describe("caracterización · decodeArchivoMemo (memo por instancia de File)", () => {
  it("el MISMO File se decodifica UNA sola vez (misma promesa)", async () => {
    const p = pasos();
    const f = new File(["x"], "a.jpg");
    const [d1, d2] = await Promise.all([p.decodeArchivoMemo(f), p.decodeArchivoMemo(f)]);
    expect(vi.mocked(fileToCaptureDataUrl)).toHaveBeenCalledTimes(1);
    expect(d1).toBe("data:image/jpeg;base64,DECODE");
    expect(d2).toBe(d1);
  });

  it("decode FALLIDO → la entrada sale de la memo y el reintento re-decodifica", async () => {
    const p = pasos();
    const f = new File(["y"], "b.jpg");
    vi.mocked(fileToCaptureDataUrl)
      .mockRejectedValueOnce(new Error("decode roto"))
      .mockResolvedValue("data:image/jpeg;base64,SEGUNDO");
    await expect(p.decodeArchivoMemo(f)).rejects.toThrow("decode roto");
    await expect(p.decodeArchivoMemo(f)).resolves.toBe("data:image/jpeg;base64,SEGUNDO");
    expect(vi.mocked(fileToCaptureDataUrl)).toHaveBeenCalledTimes(2);
  });
});

// ─── conRampa (progreso interpolado §5) ────────────────────────────────────

describe("caracterización · conRampa (progreso interpolado)", () => {
  it("emite fracción ×0.95 mientras espera y entrega el valor real al resolver", async () => {
    const p = pasos();
    const eventos: number[] = [];
    const valor = await p.conRampa(
      new Promise<string>((res) => setTimeout(() => res("LISTO"), 300)),
      200,
      (f) => ({ etapa: "OCR", progreso: f }),
      (pr: ProgresoAnalisis) => eventos.push(pr.progreso),
    );
    expect(valor).toBe("LISTO");
    expect(eventos.length).toBeGreaterThanOrEqual(1); // ticks de 140 ms
    expect(eventos.length).toBeLessThanOrEqual(2);
    for (const e of eventos) {
      expect(e).toBeGreaterThan(0);
      expect(e).toBeLessThanOrEqual(0.95);
    }
    const antes = eventos.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(eventos.length).toBe(antes); // el intervalo se limpió
  });

  it("autolímite 20× (auditoría 2-a #7): promesa colgada → el ramp SE APAGA solo", async () => {
    vi.useFakeTimers();
    const p = pasos();
    const eventos: number[] = [];
    void p.conRampa(
      new Promise<never>(() => {}),
      100,
      (f) => ({ etapa: "OCR", progreso: f }),
      (pr: ProgresoAnalisis) => eventos.push(pr.progreso),
    );
    await vi.advanceTimersByTimeAsync(140 * 20); // maxTicks = ceil(2000/140) = 15
    expect(eventos.length).toBe(15);
    expect(eventos.every((e) => e <= 0.95)).toBe(true);
  });
});

// ─── esperarWorkerCaliente (KIT masiva-ux T1) ──────────────────────────────

describe("caracterización · esperarWorkerCaliente (warm-up con tope)", () => {
  it("SSR/worker muerto → false inmediato (fallback Sobel manda)", async () => {
    const p = pasos();
    vi.mocked(getScannerWorker).mockReturnValue(null as never);
    await expect(p.esperarWorkerCaliente(5_000)).resolves.toBe(false);
  });

  it("worker ya listo → true sin esperar; warm-up dentro del tope → true; tope vencido → false", async () => {
    const p = pasos();
    vi.mocked(getScannerWorker).mockReturnValue({ isReady: true } as never);
    await expect(p.esperarWorkerCaliente(1)).resolves.toBe(true);
    // No ready → warmUp → activo con waitReady lento (20 ms) y tope 5 ms.
    const activo = { isReady: false, waitReady: () => new Promise<boolean>((r) => setTimeout(() => r(true), 20)) };
    vi.mocked(getScannerWorker).mockReturnValue(activo as never);
    await expect(p.esperarWorkerCaliente(5)).resolves.toBe(false); // el tope vence
    const rapido = { isReady: false, waitReady: () => Promise.resolve(true) };
    vi.mocked(getScannerWorker).mockReturnValue(rapido as never);
    await expect(p.esperarWorkerCaliente(5_000)).resolves.toBe(true);
  });
});

// ─── calidadDeActa (FASE S §S.0/S.1 — el score mide el ACTA, no la mesa) ───

describe("caracterización · calidadDeActa (recorte del bbox + fallback)", () => {
  it("bbox del quad (+3% por lado, clamp) en px reales; señales hi-res del MISMO recorte", async () => {
    const p = pasos();
    const info: { w: number; h: number; fallback: boolean } = { w: 0, h: 0, fallback: false };
    const calidad = await p.calidadDeActa("data:o", QUAD_TEST, info);
    // quad 0.1-0.9 en 100×200 → bbox 80×160 +3% → 82.4→82 px… con margen
    // redondeado: minX=0.1-pad0.024=0.076 → sx=8; sw=(0.924-0.076)*100=85.
    expect(info.fallback).toBe(false);
    expect(info.w).toBe(85);
    expect(info.h).toBe(170);
    expect(vi.mocked(evaluateQuality)).toHaveBeenCalledWith(expect.objectContaining({ width: 85 }));
    // canvas plano 128 → señales hi-res 0/0 (degradación honesta).
    expect(calidad.sharpnessHi).toBe(0);
    expect(calidad.contrastPapel).toBe(0);
    expect(calidad.level).toBe("excellent");
  });

  it("bbox degenerado → fallback al frame completo (evaluateQuality sobre la FOTO)", async () => {
    const p = pasos();
    const info: { w: number; h: number; fallback: boolean } = { w: 0, h: 0, fallback: false };
    const degenerado: Quad = [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ];
    const calidad = await p.calidadDeActa("data:o", degenerado, info);
    expect(info.fallback).toBe(true);
    expect(info.w).toBe(0);
    expect(info.h).toBe(0);
    expect(vi.mocked(evaluateQuality)).toHaveBeenCalledWith("data:o");
    expect(calidad.sharpness).toBe(80);
  });
});
