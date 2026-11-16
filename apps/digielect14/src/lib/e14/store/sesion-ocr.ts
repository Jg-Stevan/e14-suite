/**
 * R-27 (H-17, auditoría 2026-11-16) — SALUD DEL MOTOR OCR (KIT
 * e14-remediacion-movil-v1, A4 — P0 #21): el evento de obs del fallo de
 * sesión del motor (familia bad_alloc de ONNX Runtime). Extraído de la ex
 * tienda-dios junto al resto del slice captura: lo consume dispararEscaneo
 * cuando reinicia el runtime y reintenta.
 */
/** Evento de obs `ocr:sesion-fallida` — la sesión del motor OCR murió.
 *  Cuenta como evidencia de presión de memoria (#16) y deja el fallo
 *  observable por evento (AC de A4). Jamás lanza (§2.4). */
export async function emitirSesionFallida(err: unknown, reiniciado: boolean): Promise<void> {
  try {
    const { appendEvento } = await import("@jg-stevan/scanner-core/obs-base/buffer");
    const { idSesion, idDispositivo, appVersion } = await import("@jg-stevan/scanner-core/obs-base/identidad");
    const mensaje = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "desconocido");
    await appendEvento({
      tipo: "warn",
      ts: Date.now(),
      sesion: idSesion(),
      dispositivo: idDispositivo(),
      appVersion: appVersion(),
      datos: {
        mensaje: `ocr:sesion-fallida reinicio=${reiniciado ? 1 : 0} — ${mensaje.slice(0, 300)}`,
        stack: (err instanceof Error ? err.stack ?? "" : "").slice(0, 2000),
        tipo: "OcrSesionFallida",
        archivo: null,
        digest: mensaje.slice(0, 80),
        breadcrumbs: [],
      },
    });
  } catch {
    /* la observabilidad jamás rompe la recuperación */
  }
}
