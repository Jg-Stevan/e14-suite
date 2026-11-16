/**
 * R-28 (H-18, auditoría 2026-11-16) — FACHADA DELGADA. Este archivo fue
 * durante años el segundo módulo más grande del repo (2.649 líneas mezclando
 * protocolo, ciclo de vida y adaptación de tipos alrededor de
 * RealCoreBridge, ~1.098 líneas) y se particionó por responsabilidad en
 * `./bridge/` (move-only, sin cambios de comportamiento — la
 * caracterización `__tests__/scanner-core-bridge.caracterizacion.test.ts`
 * corrió verde ANTES y sigue verde DESPUÉS):
 *
 *   bridge/protocolo.ts        — contratos de mensajes (opciones, gate,
 *                                parciales, campos §3.1, DETALLE_*, Pasos*
 *                                de la inyección FASE F) + piezas puras de
 *                                la traza (fmtClasif, senalDeContenido).
 *   bridge/captura.ts          — ciclo de vida de la ENTRADA: memo de decode,
 *                                grab del <video>, SIMULACIÓN (cache de
 *                                assets), quad identidad, warm-up del worker.
 *   bridge/calidad.ts          — el score del ACTA (§S.0/§4.1): recorte del
 *                                bbox, señales hi-res, scoreDeCalidad y
 *                                marcas de esquina.
 *   bridge/ocr.ts              — motores: RapidOCR escalonado, cascada
 *                                Tesseract best (GO-B), bandas dirigidas.
 *   bridge/progreso.ts         — conRampa (progreso interpolado).
 *   bridge/pipeline-recorte.ts — cuerpo del RECORTE (L5 §7.5) con los dos
 *                                métodos de la clase inyectados.
 *   bridge/real-core-bridge.ts — la clase RealCoreBridge (L2/L3 §5).
 *
 * La API pública es EXACTA a la de siempre (cero cambios para consumidores):
 * los re-exports de abajo replican el superficie exportada del monolito.
 * NOTA: el módulo NO está vigilado por CONTRATO.json (verificado 2026-11).
 */
export { RealCoreBridge } from "./bridge/real-core-bridge";
export type { EntradaPipeline } from "./bridge/captura";
export type { InfoCrop } from "./bridge/calidad";
export type { TrazaOcr } from "./bridge/ocr";
export type {
  OpcionesEscaneoConTimeout,
  ResultadoGate,
  ParcialPipeline,
  PasosCaptura,
  PasosCalidad,
  PasosOcr,
  PasosGate,
  PasosPipelineL2,
} from "./bridge/protocolo";
