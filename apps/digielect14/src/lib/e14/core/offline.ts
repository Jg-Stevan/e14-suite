/**
 * KIT e14-motor-offline-v1 — preparación del motor OCR para campo.
 *
 * El SW cacheaba el motor OCR recién en el PRIMER uso (cache-on-first-use) y
 * el pre-warm de la vista de escaneo es fire-and-forget: si el equipo sale a
 * campo antes de que termine, el primer acta offline pierde el rescate
 * Tesseract y la cascada degrada a una lectura débil (medido en el A13:
 * 8.5/10 online → 4.9/10 offline con la MISMA imagen).
 *
 * Esta precarga es EXPLÍCITA y VERIFICABLE: lista FIJA same-origin, descarga
 * con `cache: "no-store"` a un CacheStorage propio, concurrencia acotada y
 * comprobación final recurso por recurso. El SW consulta ese cache antes de
 * la red, así que sirve igual con la app recién abierta sin conexión.
 *
 * Seguridad: jamás cachea respuestas opacas, errores ni URLs fuera del
 * origen; no toca actas, flags ni credenciales — solo assets del motor.
 *
 * Si se cambia un asset del motor, subir el sufijo de CACHE_MOTOR_OFFLINE
 * (v1 → v2): el cache viejo queda huérfano y el SW lo ignora.
 */
import { PUBLIC_BASE } from "@/shared/env";

export const CACHE_MOTOR_OFFLINE = "e14-motor-offline-v1";
const META_KEY = "e14.motorOffline.v1";

export type GrupoMotor = "opencv" | "onnx" | "rapidocr" | "tesseract" | "workers";

export interface RecursoMotor {
  /** Ruta bajo PUBLIC_BASE (siempre relativa al origen, sin CDN). */
  ruta: string;
  /** Peso esperado (bytes del build) — progreso y estimación de datos. */
  bytes: number;
  grupo: GrupoMotor;
}

export const RECURSOS_MOTOR: readonly RecursoMotor[] = [
  // OpenCV del detector de bordes (el puente legado carga el core 4.12).
  { ruta: "/vendor/opencv-4.5.5.js", bytes: 2_803, grupo: "opencv" },
  { ruta: "/vendor/opencv-4.12.0-core.js", bytes: 10_872_779, grupo: "opencv" },
  // Runtime ONNX de RapidOCR.
  { ruta: "/vendor/onnxruntime/ort-wasm-simd-threaded.mjs", bytes: 24_738, grupo: "onnx" },
  { ruta: "/vendor/onnxruntime/ort-wasm-simd-threaded.wasm", bytes: 14_848_852, grupo: "onnx" },
  // Modelos PP-OCRv4.
  { ruta: "/models/rapidocr/ppocr_keys.txt", bytes: 26_249, grupo: "rapidocr" },
  { ruta: "/models/rapidocr/ch_PP-OCRv4_det_infer.onnx", bytes: 4_745_517, grupo: "rapidocr" },
  { ruta: "/models/rapidocr/ch_ppocr_mobile_v2.0_cls_infer.onnx", bytes: 585_532, grupo: "rapidocr" },
  { ruta: "/models/rapidocr/ch_PP-OCRv4_rec_infer.onnx", bytes: 10_857_958, grupo: "rapidocr" },
  // Tesseract (intento 1 de la cascada) — ambos núcleos: SIMD y no-SIMD.
  { ruta: "/models/tess/4.0.0_fast/spa.traineddata.gz", bytes: 1_137_561, grupo: "tesseract" },
  { ruta: "/vendor/tesseract/worker.min.js", bytes: 123_724, grupo: "tesseract" },
  { ruta: "/vendor/tesseract/tesseract-core-simd-lstm.wasm.js", bytes: 3_938_657, grupo: "tesseract" },
  { ruta: "/vendor/tesseract/tesseract-core-lstm.wasm.js", bytes: 3_938_277, grupo: "tesseract" },
  // Workers del pipeline (las URLs versionadas son las que pide el cliente).
  { ruta: "/scanner/detection-worker.js?v=8", bytes: 71_012, grupo: "workers" },
  { ruta: "/scanner/capa0-qr.worker.js?v=5", bytes: 138_492, grupo: "workers" },
  { ruta: "/scanner/db-postprocess.worker.js", bytes: 3_939, grupo: "workers" },
  { ruta: "/scanner/fallback-canvas.worker.js", bytes: 11_931, grupo: "workers" },
  { ruta: "/scanner/heartbeat.worker.js", bytes: 5_005, grupo: "workers" },
] as const;

export const BYTES_MOTOR = RECURSOS_MOTOR.reduce((s, r) => s + r.bytes, 0);

export interface EstadoMotorOffline {
  /** CacheStorage disponible en este navegador/contexto. */
  soportado: boolean;
  listo: boolean;
  faltantes: string[];
  hechos: number;
  total: number;
  bytes: number;
  bytesTotal: number;
  actualizadoEn: number | null;
  sinRed: boolean;
}

export interface ProgresoMotor {
  hechos: number;
  total: number;
  bytes: number;
  bytesTotal: number;
  actual: string;
}

export interface OpcionesPreparacion {
  onProgreso?: (p: ProgresoMotor) => void;
  signal?: AbortSignal;
}

/** URL absoluta same-origin del recurso (PUBLIC_BASE incluido). */
export function urlMotor(r: RecursoMotor): string {
  return `${PUBLIC_BASE}${r.ruta}`;
}

function esSameOrigin(url: string): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    // URL inválida: no es candidata a cache
    return false;
  }
}

function leerMeta(): number | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { actualizadoEn?: unknown };
    return typeof v.actualizadoEn === "number" ? v.actualizadoEn : null;
  } catch {
    // meta corrupta o storage bloqueado: sin fecha, el cache sigue mandando
    return null;
  }
}

function guardarMeta(actualizadoEn: number): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ actualizadoEn, bytes: BYTES_MOTOR }));
  } catch {
    /* almacenamiento lleno o bloqueado — el cache sigue siendo la verdad */
  }
}

function cacheDisponible(): boolean {
  return typeof caches !== "undefined" && typeof fetch === "function";
}

/** Estado REAL del paquete: cada recurso debe estar en el CacheStorage. */
export async function estadoMotorOffline(): Promise<EstadoMotorOffline> {
  const base: EstadoMotorOffline = {
    soportado: cacheDisponible(),
    listo: false,
    faltantes: RECURSOS_MOTOR.map((r) => r.ruta),
    hechos: 0,
    total: RECURSOS_MOTOR.length,
    bytes: 0,
    bytesTotal: BYTES_MOTOR,
    actualizadoEn: leerMeta(),
    sinRed: typeof navigator !== "undefined" && navigator.onLine === false,
  };
  if (!base.soportado) return base;
  const cache = await caches.open(CACHE_MOTOR_OFFLINE);
  const faltantes: string[] = [];
  let bytes = 0;
  for (const r of RECURSOS_MOTOR) {
    const hit = await cache.match(urlMotor(r));
    if (hit && hit.ok) bytes += r.bytes;
    else faltantes.push(r.ruta);
  }
  return {
    ...base,
    listo: faltantes.length === 0,
    faltantes,
    hechos: RECURSOS_MOTOR.length - faltantes.length,
    bytes,
  };
}

/**
 * Descarga y verifica el paquete completo. Idempotente: los recursos que ya
 * están en el cache no se vuelven a pedir. Concurrencia 2 para no saturar
 * equipos de gama baja; cancelable; jamás deja una respuesta parcial como
 * válida (la verificación final manda).
 */
export async function prepararMotorOffline(
  opciones: OpcionesPreparacion = {},
): Promise<EstadoMotorOffline> {
  if (!cacheDisponible()) {
    const e = await estadoMotorOffline();
    return { ...e, soportado: false };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ...(await estadoMotorOffline()), sinRed: true };
  }
  // Best-effort: reduce el riesgo de desalojo del cache bajo presión de RAM.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* el navegador decide */
  }

  const cache = await caches.open(CACHE_MOTOR_OFFLINE);
  const cola: RecursoMotor[] = [];
  let hechos = 0;
  let bytes = 0;
  for (const r of RECURSOS_MOTOR) {
    const url = urlMotor(r);
    const hit = esSameOrigin(url) ? await cache.match(url) : null;
    if (hit && hit.ok) {
      hechos += 1;
      bytes += r.bytes;
    } else {
      cola.push(r);
    }
  }
  const total = RECURSOS_MOTOR.length;
  opciones.onProgreso?.({
    hechos,
    total,
    bytes,
    bytesTotal: BYTES_MOTOR,
    actual: cola[0]?.ruta ?? "",
  });

  const fallos: string[] = [];

  const descargar = async (r: RecursoMotor): Promise<void> => {
    const url = urlMotor(r);
    if (!esSameOrigin(url)) {
      fallos.push(r.ruta);
      return;
    }
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: opciones.signal,
    });
    // Solo respuestas propias y completas: nada opaco, nada de error.
    if (!res.ok || res.type === "opaque") {
      fallos.push(r.ruta);
      return;
    }
    await cache.put(url, res);
    hechos += 1;
    bytes += r.bytes;
    opciones.onProgreso?.({ hechos, total, bytes, bytesTotal: BYTES_MOTOR, actual: r.ruta });
  };

  const trabajadores = Array.from({ length: 2 }, async () => {
    while (cola.length > 0) {
      if (opciones.signal?.aborted) return;
      const r = cola.shift();
      if (!r) return;
      try {
        await descargar(r);
      } catch {
        // cancelado por el usuario: no es un fallo del recurso
        if (!opciones.signal?.aborted) fallos.push(r.ruta);
      }
    }
  });
  await Promise.all(trabajadores);

  const estado = await estadoMotorOffline();
  if (estado.listo) guardarMeta(Date.now());
  return estado;
}
