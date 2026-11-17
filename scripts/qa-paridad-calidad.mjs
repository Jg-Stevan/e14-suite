#!/usr/bin/env bun
/**
 * scripts/qa-paridad-calidad.mjs — R-59 (2026-11-19): GATE ANTI-DRIFT de los
 * GEMELOS de calidad del E-14.
 *
 * Los dos módulos gemelos (~85-90 % similares, divergencia intencional
 * mínima):
 *   · apps/digielect14/src/lib/e14/bridge/calidad.ts            (móvil)
 *   · apps/supervision-e14/src/modules/digitalizador/lib/e14/calidad.ts (panel)
 *
 * La parte DOM (`calidadDeActa`, `esquinasDeActa`, `senalHiResDeCanvas`) NO es
 * ejecutable headless (canvas/getImageData), pero la DECISIÓN de calidad — lo
 * que alimenta el gate y el score — vive en dos funciones PURAS que sí lo son:
 *   · contrasteEfectivoDe(q, ocrLegible) — piso de legibilidad §X.1
 *   · scoreDeCalidad(q, senales)         — mapeo §4.1 con techos por level
 * Este script ejecuta UN SET COMPARTIDO de vectores de contrato (métricas
 * PageQualityV2 sintéticas: textura lisa, nitidez alta, acta recortada,
 * brillo extremo, tinta débil, sin señal, techos fair/poor…) contra AMBAS
 * implementaciones y exige PARIDAD EXACTA de decisión: misma entrada →
 * mismo contraste efectivo y mismo score (los números derivan de fórmulas
 * idénticas — 0.4/0.3/0.3 sobre señales v2 y techos 7.9/6.4/4.9 —, cualquier
 * diferencia es un drift de copy-paste, no una decisión de producto).
 *
 * SALIDA: 0 = paridad · 1 = drift (el workflow ci-paridad.yml lo gatea).
 * NOTA de cobertura: las funciones async con DOM (`calidadDeActa`,
 * `esquinasDeActa`) quedan FUERA del gate por diseño — su divergencia
 * conocida es solo de imports/comentarios (ver cabecera GEMELO de cada
 * archivo); si un día diverge su lógica de decisión, añadir aquí vectores
 * sobre métricas PURAS, nunca inventar resultados.
 */

const RAIZ = new URL("..", import.meta.url);

/** Import dinámico de AMBOS gemelos — solo funciones puras, sin DOM. */
const movil = await import(new URL("apps/digielect14/src/lib/e14/bridge/calidad.ts", RAIZ));
const panel = await import(
  new URL("apps/supervision-e14/src/modules/digitalizador/lib/e14/calidad.ts", RAIZ)
);

/** Vectores de contrato compartidos (R-59). `q` = PageQualityV2 sintética;
 *  `senales` = el paquete de señales legibilidad/identificación/señal de
 *  contenido/piso perfecto que recibe scoreDeCalidad. */
const VECTORES = [
  {
    nombre: "textura lisa (mesa oscura, papel al 30 % del cuadro)",
    q: { sharpness: 18, brightness: 30, contrast: 12, level: "poor", sharpnessHi: 8, contrastPapel: 20 },
    senales: { ocrLegible: false, identificada: false, conSenal: false },
  },
  {
    nombre: "textura lisa con OCR legible (piso §X.1 rescata)",
    q: { sharpness: 18, brightness: 30, contrast: 12, level: "poor", sharpnessHi: 8, contrastPapel: 20 },
    senales: { ocrLegible: true, identificada: false, conSenal: true },
  },
  {
    nombre: "nitidez alta (acta bien capturada, piso perfecto)",
    q: { sharpness: 92, brightness: 88, contrast: 70, level: "excellent", sharpnessHi: 95, contrastPapel: 80 },
    senales: { ocrLegible: true, identificada: true, conSenal: true, pisoPerfecto: true },
  },
  {
    nombre: "brillo extremo oscuro (interior/vidrio — piso T-D)",
    q: { sharpness: 80, brightness: 12, contrast: 30, level: "good", sharpnessHi: 84, contrastPapel: 70 },
    senales: { ocrLegible: true, identificada: true, conSenal: true },
  },
  {
    nombre: "brillo extremo quemado (contraste aplastado)",
    q: { sharpness: 75, brightness: 100, contrast: 15, level: "fair", sharpnessHi: 60, contrastPapel: 35 },
    senales: { ocrLegible: true, identificada: false, conSenal: true },
  },
  {
    nombre: "acta recortada (senales hi-res bajas, level fair)",
    q: { sharpness: 55, brightness: 65, contrast: 40, level: "fair", sharpnessHi: 40, contrastPapel: 45 },
    senales: { ocrLegible: false, identificada: false, conSenal: true },
  },
  {
    nombre: "sin señal de contenido (techo §D1 4.9)",
    q: { sharpness: 88, brightness: 90, contrast: 66, level: "excellent", sharpnessHi: 90, contrastPapel: 76 },
    senales: { ocrLegible: false, identificada: false, conSenal: false },
  },
  {
    nombre: "hi-res en 0 (fallback || a la nitidez del core)",
    q: { sharpness: 62, brightness: 58, contrast: 44, level: "good", sharpnessHi: 0, contrastPapel: 0 },
    senales: { ocrLegible: true, identificada: false, conSenal: true },
  },
  {
    nombre: "level fair con métricas buenas (techo ADVERTENCIA 7.9)",
    q: { sharpness: 96, brightness: 95, contrast: 80, level: "fair", sharpnessHi: 96, contrastPapel: 80 },
    senales: { ocrLegible: true, identificada: true, conSenal: true },
  },
  {
    nombre: "level poor (techo RECHAZADA 6.4)",
    q: { sharpness: 99, brightness: 99, contrast: 90, level: "poor", sharpnessHi: 99, contrastPapel: 90 },
    senales: { ocrLegible: true, identificada: true, conSenal: true },
  },
  {
    nombre: "tinta débil (contraste global bajo, papel rescata vía max)",
    q: { sharpness: 70, brightness: 82, contrast: 10, level: "good", sharpnessHi: 66, contrastPapel: 50 },
    senales: { ocrLegible: false, identificada: false, conSenal: true },
  },
];

/** Nombres canónicos de las exportaciones comparadas (contrato de este gate). */
const EXPORTS_ESPERADOS = ["contrasteEfectivoDe", "scoreDeCalidad"];
const errores = [];

for (const nombre of EXPORTS_ESPERADOS) {
  if (typeof movil[nombre] !== "function" || typeof panel[nombre] !== "function") {
    errores.push(`export faltante o no-función: ${nombre} (movil=${typeof movil[nombre]}, panel=${typeof panel[nombre]})`);
  }
}

let comparados = 0;
if (errores.length === 0) {
  console.log("── R-59 paridad de decisión — gemelos de calidad (movil ↔ panel)");
  for (const v of VECTORES) {
    // AMBOS lados de contrasteEfectivoDe (el piso §X.1 depende de ocrLegible).
    const cMovil = movil.contrasteEfectivoDe(v.q, v.senales.ocrLegible);
    const cPanel = panel.contrasteEfectivoDe(v.q, v.senales.ocrLegible);
    // AMBOS lados de scoreDeCalidad (misma entrada → misma decisión/puntuación).
    const sMovil = movil.scoreDeCalidad(v.q, v.senales);
    const sPanel = panel.scoreDeCalidad(v.q, v.senales);
    const par =
      cMovil === cPanel &&
      sMovil === sPanel &&
      typeof cMovil === "number" &&
      typeof sMovil === "number";
    comparados += 1;
    console.log(
      `${par ? "OK " : "DRIFT"}  ${v.nombre}\n      contraste movil=${cMovil} panel=${cPanel} · score movil=${sMovil} panel=${sPanel}`,
    );
    if (cMovil !== cPanel) {
      errores.push(`contrasteEfectivoDe difiere en «${v.nombre}»: movil=${cMovil} panel=${cPanel}`);
    }
    if (sMovil !== sPanel) {
      errores.push(`scoreDeCalidad difiere en «${v.nombre}»: movil=${sMovil} panel=${sPanel}`);
    }
  }
}

if (errores.length > 0) {
  console.error(`\nR-59 DRIFT — ${errores.length} desviación(es) en ${comparados} vector(es):`);
  for (const e of errores) console.error(`  · ${e}`);
  console.error("  Corrige el gemelo o documenta la divergencia INTENCIONAL con kit/comentario antes de subir el umbral.");
  process.exit(1);
}
console.log(`\nParidad EXACTA en ${comparados} vector(es) × 2 funciones — gemelos de calidad en línea.`);
