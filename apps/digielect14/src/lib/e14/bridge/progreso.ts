/**
 * R-28 (H-18, auditoría 2026-11-16) — partición de scanner-core-bridge.ts:
 * PROGRESO de análisis. Helper de emisión interpolada compartido por el
 * pipeline L2 (pipeline.ts, vía PasosPipelineL2) y el pipeline del recorte
 * (bridge/pipeline-recorte.ts). Move-only: byte a byte con el original.
 */
import type { ProgresoAnalisis } from "@jg-stevan/scanner-core/dominio/types";

/**
 * Emite progreso INTERPOLADO mientras una espera real del core está en vuelo
 * (decode/detect/proceso no exponen avance interno; el OCR sí lo reporta
 * real). La fracción se cap al 95% para que la resolución de la etapa
 * siempre produzca un salto visible en ANALIZANDO.
 */
export function conRampa<T>(
  promesa: Promise<T>,
  msEstimados: number,
  evento: (fraccion: number) => ProgresoAnalisis,
  emitir: (p: ProgresoAnalisis) => void,
): Promise<T> {
  const inicio = performance.now();
  // FIX (auditoría 2-a #7): autolímite del ramp — si la promesa envuelta
  // cuelga SIN resolver (worker OpenCV muerto), el intervalo seguía
  // disparando indefinidamente (un timer fugado por pipeline colgado; el
  // timeout externo recupera la UI pero no el timer). 20× el estimado es
  // inalcanzable en operación normal y cubre el peor caso real.
  let ticks = 0;
  const maxTicks = Math.ceil((msEstimados * 20) / 140);
  const timer = setInterval(() => {
    if (++ticks > maxTicks) {
      clearInterval(timer);
      return;
    }
    const f = Math.min(1, (performance.now() - inicio) / msEstimados);
    emitir(evento(f * 0.95));
  }, 140);
  return promesa.then(
    (valor) => {
      clearInterval(timer);
      return valor;
    },
    (error) => {
      clearInterval(timer);
      throw error;
    },
  );
}
