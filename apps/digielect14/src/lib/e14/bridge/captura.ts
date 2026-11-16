/**
 * R-28 (H-18, auditoría 2026-11-16) — partición de scanner-core-bridge.ts:
 * CAPTURA — todo lo que RESUELVE la ENTRADA del pipeline (L3 §5 CAMARA + F1
 * SIMULACIÓN) y el warm-up del worker OpenCV. Move-only: byte a byte con el
 * original (solo cambian las rutas de import).
 */
import { fileToCaptureDataUrl } from "@jg-stevan/scanner-core/core/image-processor";
// KIT e14-masiva-ux-v1 (T1): mecanismo de warm-up del worker OpenCV que ya
// expone el core (el mismo que ScanView.tsx:757 invoca al montar) — la
// detección al importar espera al worker en vez de caer al Sobel de una.
import {
  getScannerWorker,
  warmUpScannerWorker,
} from "@jg-stevan/scanner-core/core/detector-client";
import type { Quad } from "@jg-stevan/scanner-core/core/types";
import { canvasCon } from "@jg-stevan/scanner-core/dominio/image-utils";
import {
  IMAGENES_SIMULADAS,
  imagenSimuladaPorId,
  type ImagenSimuladaId,
} from "../simulacion-imagenes";
import { opcionesRescateHeic } from "../flags";
import { CALIDAD_JPEG_REVISION } from "../politica/umbrales";
import { logger } from "../../logger"; // SPRINT-A A6 — console→logger (mensajes byte-idénticos)

/** Memo de decode POR INSTANCIA de File (WeakMap — GC-friendly, no retiene
 *  blobs; Kit e14-masiva-tiempos-v1 PR-2). El mismo File JAMÁS se decodifica
 *  dos veces: un re-intento del pipeline sobre el MISMO archivo golpea la
 *  memo (~0 ms). TRANSPARENTE para todos los flujos: misma promesa, mismo
 *  resultado; si el decode falla, la entrada sale de la memo y el siguiente
 *  intento re-decodifica (jamás bloquea). */
const decodeMemo = new WeakMap<File, Promise<string>>();

export function decodeArchivoMemo(file: File): Promise<string> {
  let p = decodeMemo.get(file);
  if (!p) {
    p = fileToCaptureDataUrl(file, opcionesRescateHeic());
    decodeMemo.set(file, p);
    void p.catch(() => {
      // Rastro vía 1 del ADR (cosmético interno): el fallo del decode ya
      // se propaga al llamador por la promesa devuelta; esto solo limpia
      // la memo para no cachear el rechazo — reintentar re-decodea.
      if (decodeMemo.get(file) === p) decodeMemo.delete(file);
    });
  }
  return p;
}

// SPRINT-A (perf/decode-once-v1) A5: el export precargarDecodeArchivo fue
// eliminado — DEAD desde D66 (el prefetch del runner se re-apuntó a
// asegurarMaestro; 0 anclas en scripts/, 0 usos en src). La memo interna
// decodeArchivoMemo sigue viva (el pipeline la usa).

/**
 * Grab del <video> a RESOLUCIÓN DEL STREAM (§5 CAMARA): canvas de
 * videoWidth×videoHeight → JPEG 0.92. Síncrono (~10 ms) — se llama ANTES de
 * que el visor se desmonte, mientras el stream sigue vivo.
 */
export function capturarFrame(video: HTMLVideoElement): string | null {
  try {
    const canvas = canvasCon(video.videoWidth, video.videoHeight); // SPRINT-A A3 — factory
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.drawImage(video, 0, 0);
    // 7.1: CALIDAD_JPEG_REVISION (0.92) desde politica/umbrales.ts.
    return canvas.toDataURL("image/jpeg", CALIDAD_JPEG_REVISION);
  } catch {
    // el grab del visor es un camino de captura: null → el flujo sigue sin foto de revisión
    logger.debug("[e14] frame del visor no capturado (canvas/decode falló)", {
      w: video.videoWidth,
      h: video.videoHeight,
    });
    return null;
  }
}

/** Entrada del pipeline: File (ARCHIVO o foto CÁMARA) o dataUrl ya crudo.
 *  §D8.2 (SPEC-e14-score-ocr Rev. 3): el flag «sin recorte automático» viaja
 *  con el ASSET de SIMULACIÓN dentro de la entrada (parámetro interno
 *  privado — OpcionesEscaneo queda INTACTO, nada público nuevo). */
export type EntradaPipeline = { archivo: File; sinRecorte?: boolean } | { dataUrl: string };

/**
 * SIMULACIÓN = pipeline real sobre las imágenes incluidas en el repo
 * (src/assets/simuladas, elegidas desde la galería del visor). MISMO camino
 * que IMPORTAR: File → fileToCaptureDataUrl (F-IMPORT: EXIF/12MP) y de ahí
 * orientación, completitud, esquinas, OCR y gate reales — sin score inyectado
 * ni atajos. La imagen y sus datos de tarjeta viven en ./simulacion-imagenes
 * (fuente única). Caché POR ID a nivel de módulo para no re-descargar una
 * imagen ya servida.
 * Los src se cargan con `import()` DINÁMICO vía cargador del módulo de
 * metadatos — el `.src` ya resuelve el basePath del deploy estático.
 */
interface EntradaSim {
  archivo: File;
}
const entradasSimCache = new Map<ImagenSimuladaId, EntradaSim>();
export async function entradaSimDeImagen(id: ImagenSimuladaId): Promise<EntradaSim> {
  const cache = entradasSimCache.get(id);
  if (cache) return cache;
  // Fallback defensivo: un id desconocido sirve la primera imagen.
  const imagen = imagenSimuladaPorId(id) ?? IMAGENES_SIMULADAS[0];
  const { default: asset } = await imagen.cargar();
  const res = await fetch(asset.src);
  if (!res.ok) throw new Error("SIMULACIÓN: no se pudo cargar la imagen incluida");
  const entrada: EntradaSim = {
    archivo: new File([await res.blob()], imagen.nombre, { type: "image/jpeg" }),
  };
  entradasSimCache.set(imagen.id, entrada);
  return entrada;
}

/** §D8.3 (SPEC-e14-score-ocr Rev. 3): quad IDENTIDAD — «el recorte es la
 *  foto entera». Con sinRecorte la detección de bordes NO corre y el quad
 *  (fracciones 0-1 de la foto) cubre TODO el encuadre: se imprime en el log
 *  como hoy (traza de auditoría) y alimenta el editor (recorte manual real
 *  sobre la foto completa) y revelar/filtros (mismo quad). */
export const QUAD_IDENTITY: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** KIT e14-masiva-ux-v1 (T1): ¿el worker OpenCV está listo para detectar?
 *  Si no, espera su warm-up con TOPE (warmUpScannerWorker/waitReady del
 *  core — nunca tumba el pipeline: false = continuar como hoy, fallback
 *  Sobel manda). SSR/worker muerto → false inmediato. */
export async function esperarWorkerCaliente(topeMs: number): Promise<boolean> {
  try {
    const cliente = getScannerWorker();
    if (cliente?.isReady) return true;
    warmUpScannerWorker(); // crea/reanima el worker si no existe (idempotente)
    const activo = getScannerWorker();
    if (!activo) return false;
    return await Promise.race([
      activo.waitReady(),
      new Promise<boolean>((res) => setTimeout(() => res(false), topeMs)),
    ]);
  } catch {
    // worker muerto o SSR: false → continuar como hoy, el fallback Sobel manda
    return false;
  }
}
