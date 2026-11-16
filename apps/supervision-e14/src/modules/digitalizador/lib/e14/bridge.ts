/**
 * E14Bridge — ADAPTADOR FINO del panel sobre el motor (R-24, H-15).
 *
 * El contrato base (PaginaObjetivo, OpcionesEscaneo, E14Bridge) y el
 * enrutador CompositeBridge viven en el PAQUETE
 * (`@jg-stevan/scanner-core/dominio/bridge`, genérico sobre
 * (Opciones, TipoActa) desde R-24). Este archivo declara SOLO lo específico
 * del panel — antes era un fork manual del 86,2 % del motor (auditoría
 * 2026-11-12), ahora el delta queda reducido a:
 *
 *  · OpcionesEscaneo — los CUATRO campos que SOLO la MASIVA del panel
 *    inyecta (origen/señales del detector D63-A, decodificador QR de cámara
 *    R10-M10-fin, acta completa del sidecar nativo KIT e14-ocr-nativo-v1
 *    FASE 2). El móvil (digielect14) consume la base del motor directa.
 *  · E14Bridge — la instanciación del genérico del motor con los tipos del
 *    PANEL (Acta con rechazo SUPERVISOR del supervisor y tiempos MASIVA).
 *
 * El singleton también es del paquete: get-bridge.ts usa `crearGetBridge`
 * (`@jg-stevan/scanner-core/dominio/get-bridge`), igual que el gemelo móvil.
 * Las vistas siguen sin enterarse (D17: get-bridge.ts punto único de
 * intercambio; E14Bridge sigue siendo la ÚNICA fuente de datos, SPEC §2 D1).
 */
import type { Acta, OrigenActa, DecodificadorQrCam } from "./types";
// KIT e14-ocr-nativo-v1 (FASE 2): el TIPO del acta-completa del sidecar (solo
// tipo — el cliente y su fetch viven en ocr/nativo.ts, importados por quien
// consume la promesa).
import type { ActaNativa } from "./ocr/nativo";
import type {
  E14Bridge as E14BridgeDelMotor,
  OpcionesEscaneo as OpcionesEscaneoDelMotor,
} from "@jg-stevan/scanner-core/dominio/bridge";

/** Página de mesa a la que apunta el próximo escaneo (D7) — la del motor. */
export type { PaginaObjetivo } from "@jg-stevan/scanner-core/dominio/bridge";

/** R-24: la base del motor + los CUATRO campos que SOLO el panel inyecta. */
export interface OpcionesEscaneo extends OpcionesEscaneoDelMotor {
  /** D63-A/D63-C — KIT e63a-origen-escaneo-v1: origen del archivo según el
   *  detector heurístico (`dominio/origen-escaneo.ts` del paquete). SOLO
   *  MASIVA lo llena (runner). "escaneo" activa el quad página-completa (T1)
   *  y el gate del marco impreso (T2) del kit D63-C; fotos/SIM/ausente =
   *  pipeline de siempre. */
  origenActa?: OrigenActa;
  /** e66 (P4) — señal AUDITABLE del detector (veredictoOrigen.senales — el
   *  runner ya la tenía en la traza y en el diagnóstico; ahora también viaja
   *  al pipeline). "exif-camara" = EXIF de cámara presente (el core ya horneó
   *  la orientación al decodificar) → el probe de rotaciones se OMITE
   *  (evidencia del mantenedor: aplicado=0 SIEMPRE en exif-camara, 4-10 s c/u).
   *  SOLO MASIVA lo llena (mismo criterio de origenActa); los flujos
   *  individual/video/recorte-manual corren el probe de siempre. */
  origenSenales?: string | null;
  /** R10 — M10-fin: DECODIFICADOR QR de cámara INYECTADO (e64-qr T-2.1,
   *  tiers "base"). Antes el bridge lo traía con un import DINÁMICO de
   *  masiva/identidad-qr — la ÚLTIMA dependencia invertida núcleo→masiva
   *  (PENDIENTE heredado de R7b). Ahora el caller que ya conoce identidad-qr
   *  lo provee aquí: el runner MASIVA lo inyecta SIEMPRE (decodificarQrDeCapture
   *  ya está en su bundle — filas con `origen=null`, duda honesta del detector
   *  D63-A, caen hoy en la rama tier-base del bridge y su señal qrCam viaja
   *  al veto ya-enviada post-OCR del runner H1) y el cableado del flujo
   *  individual/CÁMARA vive en su repo anfitrión. Ausente → la señal qrCam
   *  queda null (MISMA conducta del catch silencioso del kit: sin señal, el
   *  flujo de cámara sigue intacto). Firma mínima: DecodificadorQrCam
   *  (types.ts). El guard esMasiva (`origenActa != null`) la OMITE igual que
   *  hoy cuando la capa 0 del runner manda. */
  decodificadorQrCam?: DecodificadorQrCam;
  /** KIT e14-ocr-nativo-v1 (FASE 2) — ACTA COMPLETA del sidecar, INYECTADA por
   *  el runner MASIVA (prefetch `masiva/prefacta.ts`). Presente y resuelta →
   *  el pipeline se SALTA detección, warp, b/n, sondeo de orientación y OCR
   *  (los cuatro pasos más caros del WASM) y consume el quad, la procesada y
   *  el texto del sidecar. Calidad, esquinas, completitud, score, gate, dedup
   *  y envío siguen siendo del JS sobre ESA imagen. null / rechazo / flag OFF
   *  → el pipeline de siempre, byte-idéntico. */
  actaNativa?: Promise<ActaNativa | null>;
}

/** R-24: el contrato del motor instanciado con los tipos del panel. */
export type E14Bridge = E14BridgeDelMotor<OpcionesEscaneo, Acta>;
