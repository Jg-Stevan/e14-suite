"use client";

/**
 * R-26 (H-18, auditoría 2026-11-16 · decisión D-2) — STAGE 1/5 extraído del
 * runner masivo: CAPA 0 IDENTIDAD QR PRE-OCR (e63m/D30/D40/e65b). Movido
 * VERBATIM de runner.ts (mismo orden, mismos literales — las anclas QA de la
 * caracterización §E se reposicionaron a ESTE archivo); solo el cuerpo se
 * descompone en sub-tareas de ≤80 líneas con un estado de trabajo explícito.
 *
 * CAPA 0 IDENTIDAD QR PRE-OCR (punto ÚNICO del kit — ANTES de despachar OCR:
 *  det/cls/rec y la cadena dhash visual quedan río abajo) ─── El QR es DATO
 *  LEÍDO (banco #72: GO 88.2% decode, 0 colisiones, gemelas agrupan por
 *  payload EXACTO). Llave = IGUALDAD EXACTA de payload (sin umbrales, sin
 *  fuzzy — RED LINES 5/10). Decisión por el estado del original:
 *  · payload null → pipeline normal INTACTO (dhash + OCR + capa 2 e63k).
 *  · payload NUEVO → se registra (mapa del lote en store) y SIGUE normal
 *    (el ORIGINAL paga el OCR, como hoy).
 *  · payload VISTO + original con desenlace final → reutilizarResultado
 *    (maquinaria EXACTA — desenlace clonado, sin doble envío, comparten
 *    hash) con token aditivo `dedup=qr`; OCR JAMÁS se paga.
 *  · payload VISTO + original EN VUELO (PROCESANDO) → APLAZADA `capa0=qr`:
 *    espera acotada SOLO-LECTURA (QR_ESPERA_INTERVALO_MS ×
 *    QR_ESPERA_INTENTOS — sin timers globales); techo vencido →
 *    reproceso completo honesto.
 *  · Fallback sagrado: reutilizarResultado→false → pipeline completo.
 *    Dedup JAMÁS inventa: falso-positivo = NO-GO. La capa 0 JAMÁS throw
 *    (cualquier falla → sin-payload → normal).
 *  ─── D30 — KIT e14-qr-heredado-v1: HERENCIA del payload (punto ÚNICO) ───
 *  Si el SONDEO de ingesta (worker e73) o el PRE-SCAN de «PROCESAR COLA»
 *  (e107) ya leyeron el QR de ESTA fila, el payload viaja en fila.qrPrevio
 *  y la capa 0 lo HEREDA — sin fileToCaptureDataUrl (decode completo del
 *  original) ni ladder (peor caso documentado sin QR: ~15-17 s SYNC).
 *  Igualdad EXACTA del payload (Reed-Solomon — no hay «casi el mismo
 *  payload», RED LINE 10): el prescan YA confiaba en ese payload para
 *  marcar DUPLICADA/YA-ENVIADA, heredarlo para la identidad es
 *  estrictamente MENOS riesgo. Fallback sagrado: qrPrevio AUSENTE (flags
 *  OFF, abort honesto, recarga, fila sin lectura) ⇒ decode de hoy
 *  byte-idéntico. Todo el bloque de decisión consume qrPayload IGUAL que ayer.
 *  Función PURA salvo los efectos de siempre (store/IDB/logger/mapas):
 *  recibe ctx y devuelve ctx nuevo; JAMÁS muta el que recibe.
 */
import { asegurarMaestro, peekMaestro } from "../precalor";
import { guardarRegistro, leerRegistroRaw } from "../cola";
import {
  enviadaPorPayload, // e65b — KIT e65b-historico-enviadas-v1 (T-4): capa 0 contra el histórico
  marcarYaEnviada, // e65b (T-4): marca YA-ENVIADA vía "payload" (exportada en T-2d)
  originalQrDePayload,
  registrarQrPayload,
} from "../store";
import { storeMasiva } from "../store-api";
import { fileToCaptureDataUrl } from "@jg-stevan/scanner-core/core/image-processor";
import {
  decodificarQrDeCapture,
  decodificarQrPrevioDeCapture,
  esperarDesenlaceQr,
} from "../identidad-qr";
// La constante se pide AL módulo puro, no a identidad-qr: cruzaba el ciclo
// store↔runner y bun la enlazaba como «export not found» (funciones hoisted:
// no; `export const` tardío: sí). Doc en qr-pixeles:QR_PREVIO_LADO_LARGO.
import { QR_PREVIO_LADO_LARGO } from "@jg-stevan/scanner-core/qr/qr-pixeles";
import { prefactaActa, prefactaQr } from "../prefacta";
import type { ActaNativa } from "../../ocr/nativo";
import { qrCorto } from "../../qr-zxing";
// R1.2 — KIT qr-cache-negativa-v1: la CAPA 0 que terminó null (cadena
// completa, sin presupuesto vencido) se recuerda por SHA-256 de los bytes —
// las siguientes corridas del MISMO archivo saltan el ladder (2-3 ms).
import {
  cacheNegativaQuitar,
  cacheNegativaRegistrar,
  cacheNegativaTiene,
} from "../qr-cache-negativa";
// KIT e14-gama-adaptativa-v1 (D74) — plan de gama de la capa 0.
import { planGamaActual, type PlanGama } from "../../gama";
import { leerFlags } from "../../flags";
import {
  decodificarQrCapa0Worker,
  type FasesCapa0, // R1.4-b — KIT qr-fases-telemetria-v1 (tipo puro — se borra al compilar)
} from "../capa0-qr.client"; // D40 — KIT e14-capa0-qr-worker-v1
import { conExclusionMutua, reutilizarResultado, proximaFilaPendiente, type CtxPipeline, type DesenlaceStage } from "./contexto";
import type { FilaMasiva, RegistroMasiva } from "../tipos";
import { logger } from "../../../logger";

/** Estado de trabajo de la capa 0 — las sombras locales del stage original
 *  (R-26): las sub-tareas lo comparten por referencia y MUERE al salir del
 *  stage (el ctx de salida se construye INMUTABLE al final — el ctx recibido
 *  jamás se muta). Los 2 primeros flags internos (cadena/presupuesto) son
 *  SOLO del ladder: deciden la escritura de la caché negativa aquí mismo. */
interface EstadoCapa0 {
  qrPayload: string | null;
  qrHeredado: boolean;
  qrEstadoCapa0: "leido" | "sin-payload" | null;
  registro: RegistroMasiva; // R1.2 — el stage puede re-limpiar la traza qrSinPayload
  cadenaCapa0Completa: boolean;
  presupuestoVencidoCapa0: boolean;
  viaCacheNegativa: boolean;
  cacheNegativaEscrita: boolean;
  qrTierCapa0: string | null;
  qrMsCapa0: number | null;
  qrFasesCapa0: FasesCapa0 | null;
  qrFinCapa0: string | null;
  qrZxingMs: number | null;
  qrPresupuestoMsCapa0: number | null;
}

/** KIT e14-ocr-nativo-v1 (FASE 2 · UN SOLO DECODE): el acta se dispara sobre
 *  el File del MASTER (`maestro.archivo`), que es EXACTAMENTE la instancia
 *  que el bridge decodifica como `fotoOriginal`. Sin master a mano (fila 0,
 *  precalor en vuelo o build caído) se usa el original: LA MISMA foto y el
 *  mismo aspect — lo único que se pierde es compartir el decode. */
function dispararRelayPrefacta(fila: FilaMasiva): void {
  // KIT e14-ocr-nativo-v1 (FASE 2) — EL RELÉ: encolar el acta de N+1 JUSTO
  // DESPUÉS de lanzar la de N (el orden importa: encolada antes, la fila
  // actual esperaba la de al lado — medido, PRE-OCR subió de 58.7 s a 1 m
  // 27 s). Como `prefacta.ts` encadena de a UNA ida, la de N+1 arranca en
  // cuanto aterriza la de N = el minuto exacto en que el navegador se queda
  // solo con sus ~4 s (decode/calidad/gate/envío) y el sidecar ya no compite
  // por los 4 núcleos de la máquina del mantenedor. Nunca dos idas a la vez,
  // nunca el sidecar parado.
  // El master de N+1 se ESPERA (es el mismo trabajo que el pipeline haría en
  // stage 2 — aquí solo se hace antes y compartido: `asegurarMaestro` une las
  // dos corridas en vuelo); si aún así no aparece, el acta se dispara sobre
  // el original leído crudo. Fire-and-forget: IDB caído → la capa 0 de N+1 la
  // dispara ella sola (comportamiento de hoy). Coste 0 con el flag OFF.
  const proxima = proximaFilaPendiente(fila.id);
  if (proxima) {
    void asegurarMaestro(proxima.id)
      .then((m) => {
        if (m) {
          prefactaActa(proxima.id, m.archivo);
          return;
        }
        return leerRegistroRaw(proxima.id).then((r) => {
          if (r.archivo instanceof File) prefactaActa(proxima.id, r.archivo);
        });
      })
      .catch(() => {});
  }
}

/** D30 — HERENCIA del payload (qrPrevio del sondeo/prescan o el acta nativa
 *  del sidecar). true = la herencia RESOLVIÓ (el ladder NO corre — ni la
 *  caché negativa se consulta: un null nativo jamás escribe la caché). */
async function heredarPayloadPrevio(
  fila: FilaMasiva,
  archivo: File,
  estado: EstadoCapa0,
  prefActa: Promise<ActaNativa | null> | undefined,
  tQrCapa0: number,
): Promise<boolean> {
  const qrPrevio = fila.qrPrevio;
  // El payload nativo SOLO se espera cuando nada más lo daba gratis (sin
  // herencia qrPrevio de sondeo/prescan): ese camino cuesta 0 ms y pagar 5 s
  // de sidecar por encima sería peor. `prefActa` nulo → null inmediato.
  const herenciaQr =
    qrPrevio || !prefActa ? null : await prefactaQr(fila.id, peekMaestro(fila.id)?.archivo ?? archivo);
  if (qrPrevio) {
    estado.qrPayload = qrPrevio;
    estado.qrHeredado = true; // D44-R2 — explícito: heredó (no pagó decode ni ladder)
    logger.info(
      `[e14] capa0-qr hereda-payload fila=${fila.id} nombre=${fila.nombre} (sondeo/prescan — sin re-decode)`,
    );
    return true;
  }
  if (herenciaQr?.payload) {
    // D30 (mismo criterio de confianza): igualdad EXACTA del payload — el
    // QR es Reed-Solomon, lo que zxing-cpp leyó sobre el warp nativo ES el
    // payload, no un candidato. La escalera jsQR no se paga y `cadenaCapa0
    // _Completa` queda FALSE a propósito: un null nativo jamás escribe la
    // caché negativa (no prueba que jsQR tampoco pueda).
    estado.qrPayload = herenciaQr.payload;
    estado.qrHeredado = true;
    logger.info(
      `[e14] capa0-qr hereda-nativo fila=${fila.id} nombre=${fila.nombre} ms=${Math.round(performance.now() - tQrCapa0)} payload=${qrCorto(herenciaQr.payload)} (acta del sidecar — ladder omitido)`,
    );
    return true;
  }
  if (herenciaQr?.autoritativo) {
    // El sidecar respondió y NO leyó QR — pero su barrido ya cubrió el warp
    // Y el fotograma completo (zxing-cpp, 3 pasadas cada uno), así que el
    // hecho es suficientemente fuerte para no pagar la escalera. MEDIDO en
    // una foto real (página 2 de un acta: no lleva QR): la escalera
    // tardó 22,3 s con hard-kill del worker, respawn, tiers de zoom y rescate
    // vencido, y terminó exactamente igual — sin payload. En una máquina de 4
    // núcleos esos segundos son, además, el acta del vecino más lenta. NO se
    // escribe la caché negativa: el hecho no lo produjo jsQR (D30 sigue en pie).
    logger.info(
      `[e14] capa0-qr sin-payload nativo fila=${fila.id} nombre=${fila.nombre} ms=${Math.round(performance.now() - tQrCapa0)} (sidecar barrió warp+original — ladder omitido)`,
    );
    return true;
  }
  return false;
}

/** R1.2 — KIT qr-cache-negativa-v1: consulta ANTES del ladder. Hit ⇒
 *  2-3 ms (misma economía de la herencia positiva qrPrevio — D30).
 *  Fuentes del hecho: (a) la traza PERSISTIDA de este registro
 *  (qrSinPayload — sobrevive la recarga) o (b) el Map de SESIÓN del
 *  módulo (re-encolado del MISMO archivo — llave = SHA-256 de los
 *  bytes, fila.hashBytes estampado por cadenaDedup). Escapes sagrados:
 *  flag qrCacheNegativa OFF y forzarDedupOff (PROCESAR IGUAL) JAMÁS
 *  consultan — el mantenedor manda. */
function saltaPorCacheNegativa(fila: FilaMasiva, registro: RegistroMasiva): boolean {
  return (
    leerFlags().qrCacheNegativa &&
    !fila.forzarDedupOff &&
    (registro?.qrSinPayload === true ||
      (registro?.hashBytes != null && cacheNegativaTiene(registro.hashBytes)) ||
      (fila.hashBytes != null && cacheNegativaTiene(fila.hashBytes)))
  );
}

/** D40 — KIT e14-capa0-qr-worker-v1: el carril pesado de la capa 0
 *  (decode del blob + ladder + barridos + nitidez + binarizada +
 *  rotaciones + rescate) corre en WORKER dedicado jsQR-only
 *  (capa0-qr.worker.js — qr-pixeles.ts) — el peor caso SIN QR
 *  (~15-17 s SYNC documentado en identidad-qr.ts) deja de congelar
 *  el hilo UI en los dispositivos que menos lo aguantan. El tier
 *  zxing (wasm — RED LINE del worker e73) queda en MAIN como
 *  SOLO-rescate si el worker no leyó nada (cobertura EXACTA).
 *  Kill-switch capa0QrWorker=false / feature-detect fallida /
 *  hard-kill ⇒ camino de hoy byte-idéntico (decode main + cadena
 *  completa con SU presupuesto de gama). Devuelve viaWorker. */
async function decodificarViaWorker(
  fila: FilaMasiva,
  archivo: File,
  estado: EstadoCapa0,
  captureQr: string | null,
  planQr: PlanGama,
): Promise<boolean> {
  // KIT qr-previo-barrido-v1 — con el pase barato YA corrido (`captureQr`
  // en mano) el worker repite SUS mismos tiers — fases medidas en gpu9:
  // decode 694 + base jsQR 7 352 + recorte600 275 + barrido 647 — y muere
  // a latigazos: 8,3-8,4 s `fin=vencido` en CADA acta sin QR del lote
  // (0.1 % de acierto). El worker existe para no congelar el UI con jsQR;
  // el previo ya pagó ese pato en main. Con previo corrido se OMITE el
  // worker y se va DIRECTO a la cadena de main (rotaciones + rescate 4096
  // + presupuesto de gama intactos — cobertura por adición, jamás por
  // sustracción). Kill-switch del mantenedor: {"qrPrevioRapido":false} = el
  // worker de hoy byte-idéntico.
  if (!(!estado.qrPayload && leerFlags().capa0QrWorker && captureQr === null)) {
    return false;
  }
  const rWorker = await decodificarQrCapa0Worker(archivo, {
    ladoLargo: planQr.qrLadoLargo,
    rescate4096: planQr.qrRescate4096,
    presupuestoMs: planQr.qrPresupuestoMs,
  });
  if (!rWorker) return false;
  // R1.1/R1.4 — el reló venció (null = corte, la caché R1.2 NO
  // cachea) + telemetría del tier ganador (RespuestaCapa0).
  estado.presupuestoVencidoCapa0 = rWorker.presupuestoVencido !== false;
  estado.qrTierCapa0 = rWorker.tier ?? null;
  estado.qrMsCapa0 = typeof rWorker.ms === "number" ? rWorker.ms : null;
  // R1.4-b — telemetría por fase + causa del fin (undefined =
  // bundle v≤2 / catch — NO se exporta, jamás inventar).
  estado.qrFasesCapa0 = rWorker.fases ?? null;
  estado.qrFinCapa0 = rWorker.fin ?? null;
  estado.qrPayload = rWorker.payload;
  logger.info(
    `[e14] capa0-qr worker fila=${fila.id} nombre=${fila.nombre} tier=${rWorker.tier ?? "null"} ms=${rWorker.ms} fin=${rWorker.fin ?? "-"} fases=${rWorker.fases ? JSON.stringify(rWorker.fases) : "-"} payload=${estado.qrPayload ? qrCorto(estado.qrPayload) : "-"}`,
  );
  if (!estado.qrPayload) {
    // Solo el tier que el worker no puede cargar (wasm) — sin
    // re-pagar los barridos jsQR (ya corrieron en el worker).
    // R1.4-b — CRONOMETRADO: es el hueco preOcrQrMs − qrMs del
    // informe (fileToCaptureDataUrl decodifica el original COMPLETO
    // + la cadena zxing de main — 2,5-4,5 s medidos 2026-10-30).
    const tZxing = performance.now();
    const capture = captureQr ?? (await fileToCaptureDataUrl(archivo));
    const qrQr = await decodificarQrDeCapture(capture, {
      soloZxing: true,
      ladoLargo: planQr.qrLadoLargo,
      // KIT e75-qr-zoom-zbar-v1 — kill-switch del mantenedor (flag
      // qrZoomTl): el tier ZOOM TL + zbar es main-only, justo aquí
      // donde ya corre el otro tier wasm (cobertura aditiva).
      zoomTl: leerFlags().qrZoomTl,
    });
    estado.qrZxingMs = Math.round(performance.now() - tZxing);
    estado.qrPayload = qrQr?.payload ?? null;
  }
  return true;
}

/** Cadena de MAIN (decode + ladder + rescate — el camino de hoy). Solo corre
 *  cuando el worker NO corrió y el previo rápido no leyó nada. */
async function decodificarCadenaMain(
  archivo: File,
  estado: EstadoCapa0,
  captureQr: string | null,
  planQr: PlanGama,
): Promise<void> {
  const capture = captureQr ?? (await fileToCaptureDataUrl(archivo));
  // KIT e14-gama-adaptativa-v1 (D74) — la CAPA 0 recibe el plan de
  // gama: flag OFF / ALTO ⇒ {2048, rescate ON, sin presupuesto} =
  // llamada byte-idéntica a hoy. BAJO ⇒ 1600 + sin rescate 4096 +
  // presupuesto 5 s; MEDIO ⇒ 2048 + rescate + presupuesto 8 s — el
  // peor caso SIN QR (~15-17 s SYNC documentado en identidad-qr.ts)
  // deja de congelar la UI en los dispositivos que menos lo aguantan.
  // KIT qr-postprevio-corta-v1 — cuando el pase barato YA corrió y
  // falló (captureQr en mano), la cadena larga repite SU esfuerzo a
  // otro tamaño: medido en gpu12 la acta SIN QR (084939) pagó 4,9 s de
  // previo + 10,0 s de cadena main (los tiers sin guard de reló) =
  // 15,7 s para declarar null. Con el flag ON (default = MEJORA) se
  // paga SOLO el salto 1600→2048 (ladder base + recorte TL) y la
  // cadena NO se declara completa ⇒ NO envenena la caché negativa
  // (R1.2 pide cadena agotada de verdad). Kill-switch:
  // {"qrCapa0PostPrevioCorta":false} = cadena de hoy byte-idéntica.
  const postPrevioCorto = captureQr !== null && leerFlags().qrCapa0PostPrevioCorta;
  const qrQr = await decodificarQrDeCapture(capture, {
    ladoLargo: planQr.qrLadoLargo,
    rescate4096: planQr.qrRescate4096,
    presupuestoMs: planQr.qrPresupuestoMs,
    // KIT e75-qr-zoom-zbar-v1 — kill-switch del mantenedor (flag qrZoomTl,
    // default true = MEJORA): ZOOM TL re-escalado + zbar antes del
    // rescate 4096 (lab: 3 páginas del escáner rescatadas).
    zoomTl: leerFlags().qrZoomTl,
    postPrevio: postPrevioCorto,
  });
  estado.qrPayload = qrQr?.payload ?? null;
  estado.cadenaCapa0Completa = !postPrevioCorto;
}

/** El LADDER completo (previo rápido → worker → cadena main) con SU try/catch
 *  sagrado: la capa 0 jamás tumba el pipeline. */
async function correrLadderQr(
  fila: FilaMasiva,
  archivo: File,
  estado: EstadoCapa0,
): Promise<void> {
  try {
    const planQr = planGamaActual();
    // R1.4-b — sello del presupuesto REAL de esta escalera (snapshot al
    // inicio — el informe de gama puede cambiar después).
    estado.qrPresupuestoMsCapa0 = planQr.qrPresupuestoMs ?? null;
    // KIT e14-qr-previo-rapido-v1 — el pase barato ANTES de la escalera.
    // Medido (bench `gpu5b`, 2026-11-03, camino navegador): la capa 0 paga
    // 10-19 s POR ACTA — worker jsQR agotado hasta el hard-kill (8-9,5 s) +
    // rescate zxing de main (2-10 s) — y el payload casi siempre está en el
    // sitio de siempre. El previo (jsQR base + recorte TL zxing + ZOOM TL,
    // ~1-2 s) lee ESE MISMO payload; cuando falla, debajo corre la cadena
    // de hoy INTACTA (aditivo por construcción: jamás quita cobertura).
    // El capture del original se REUSA en el rescate zxing / camino main
    // (hoy se decodificaba dos veces). JAMÁS lanza.
    let captureQr: string | null = null;
    if (leerFlags().qrPrevioRapido) {
      const tPrevio = performance.now();
      captureQr = await fileToCaptureDataUrl(archivo);
      estado.qrPayload = await decodificarQrPrevioDeCapture(captureQr, {
        ladoLargo: QR_PREVIO_LADO_LARGO,
        zoomTl: leerFlags().qrZoomTl,
      });
      logger.info(
        `[e14] qr-previo fila=${fila.id} ms=${Math.round(performance.now() - tPrevio)} payload=${estado.qrPayload ? qrCorto(estado.qrPayload) : "-"}`,
      );
    }
    const viaWorker = await decodificarViaWorker(fila, archivo, estado, captureQr, planQr);
    if (!viaWorker && !estado.qrPayload) {
      await decodificarCadenaMain(archivo, estado, captureQr, planQr);
    }
    // R1.1/R1.2 — la cadena llegó al final SIN throw. Ruta main: la API
    // no expone "vencido" ⇒ con presupuesto configurado es conservador
    // (posible corte → la caché NO cachea); sin presupuesto la cadena
    // SIEMPRE se agota (vencido imposible → cacheable).
    if (estado.qrPayload || !captureQr) estado.cadenaCapa0Completa = true;
    if (!viaWorker) estado.presupuestoVencidoCapa0 = planQr.qrPresupuestoMs != null;
  } catch {
    estado.qrPayload = null; // la capa 0 jamás tumba el pipeline (fallback limpio)
  }
}

/** e64-qr T-0.2 — estampar el estado en la fila viva (chip de la
 *  bandeja — kit literal vía actualizarFila; el mutador real del store,
 *  mismo patrón de precalentada/dedup). SOLO presencia, JAMÁS payload. */
function estamparQrEstado(fila: FilaMasiva, estado: EstadoCapa0): void {
  estado.qrEstadoCapa0 = estado.qrPayload ? "leido" : "sin-payload";
  storeMasiva()
    .getState()
    .actualizarFila(fila.id, { qrEstado: estado.qrEstadoCapa0 });
}

/** R1.2 — REGISTRO/DEPURACIÓN de la caché negativa y limpieza de la traza
 *  vieja del registro: SOLO se registra cuando (a) la cadena corrió COMPLETA
 *  sin throw, (b) terminó null REAL (sin corte por reló), (c) no fue un skip
 *  de la propia caché, (d) el flag ON y (e) el dedup del mantenedor
 *  respetado. Llave = SHA-256 de los bytes (registro.hashBytes — cadenaDedup;
 *  sin hash ⇒ sin caché, conservador). El sondeo/prescan (parciales) JAMÁS
 *  escriben aquí. Si ESTA corrida leyó payload: la entrada negativa (si
 *  existía) muere y la traza sin-payload previa del registro muere AQUÍ (los
 *  writes intermedios heredan el spread limpio — honestidad: el hecho
 *  cambió). El final (registroListo) re-limpia por si un re-leer de watchdog
 *  trajo la traza vieja de IDB. */
function sellarCacheNegativa(fila: FilaMasiva, estado: EstadoCapa0): void {
  const { registro } = estado;
  if (
    !estado.qrPayload &&
    estado.cadenaCapa0Completa &&
    !estado.presupuestoVencidoCapa0 &&
    !estado.viaCacheNegativa &&
    !fila.forzarDedupOff &&
    leerFlags().qrCacheNegativa
  ) {
    const hashCache = registro?.hashBytes ?? fila.hashBytes ?? null;
    if (hashCache) {
      cacheNegativaRegistrar(hashCache);
      estado.cacheNegativaEscrita = true;
      storeMasiva()
        .getState()
        .actualizarFila(fila.id, { qrSinPayload: true });
      logger.info(
        `[e14] capa0-qr cache-negativa REGISTRA sha=${hashCache.slice(0, 8)} fila=${fila.id} (próxima pasada del MISMO archivo salta el ladder)`,
      );
    }
  }
  if (estado.qrPayload) {
    const hashCache = registro?.hashBytes ?? fila.hashBytes ?? null;
    if (hashCache) cacheNegativaQuitar(hashCache);
  }
  if (estado.qrPayload && registro && registro.qrSinPayload) {
    const regSinTraza: RegistroMasiva = { ...registro };
    delete regSinTraza.qrSinPayload;
    estado.registro = regSinTraza;
  }
}

/** ctx enriquecido de la capa 0 — la MISMA spread de los 4 retornos
 *  resuelto:true del monolito (R-26 la unifica; el objeto resultante es
 *  idéntico campo por campo). */
function ctxResueltoCapa0(ctx: CtxPipeline, estado: EstadoCapa0): DesenlaceStage {
  return {
    resuelto: true,
    ctx: {
      ...ctx,
      registro: estado.registro,
      qrPayload: estado.qrPayload,
      qrHeredado: estado.qrHeredado,
      qrEstadoCapa0: estado.qrEstadoCapa0,
      viaCacheNegativa: estado.viaCacheNegativa,
      cacheNegativaEscrita: estado.cacheNegativaEscrita,
      qrTierCapa0: estado.qrTierCapa0,
      qrMsCapa0: estado.qrMsCapa0,
      qrFasesCapa0: estado.qrFasesCapa0,
      qrFinCapa0: estado.qrFinCapa0,
      qrZxingMs: estado.qrZxingMs,
      qrPresupuestoMsCapa0: estado.qrPresupuestoMsCapa0,
    },
  };
}

/** Reutilización vía la maquinaria EXACTA de reutilizarResultado (la
 *  fila viaja como DUPLICADA con dupOf del original). El token
 *  `dedup=qr` + qrPayload se estampan DESPUÉS (post-write honesto: si
 *  el fallback salta, la traza nunca mintió — reutilizarResultado ya
 *  re-leyó el registro y clonó el desenlace; OCR JAMÁS se pagó). */
async function reutilizarViaQr(
  fila: FilaMasiva,
  estado: EstadoCapa0,
  qrPayload: string,
  originalQr: FilaMasiva,
): Promise<boolean> {
  const payloadQrCorto = qrCorto(qrPayload);
  const tQr = Date.now();
  const filaGemela: FilaMasiva = { ...fila, estado: "DUPLICADA", dupOf: originalQr.id };
  if (!(await reutilizarResultado(filaGemela, tQr))) return false;
  try {
    // D41 — lectura RAW: spread base del re-save (dedup/qrPayload/qrEstado
    // son escalares — sin dataURLs que materializar).
    const regQr = await leerRegistroRaw(fila.id);
    await guardarRegistro({
      ...regQr,
      dedup: "qr",
      qrPayload,
      // KIT e14-tiempos-v2 (D44-R2): la herencia viaja con el write.
      ...(estado.qrHeredado ? { qrHeredado: true } : {}),
      // e64-qr T-0.2: el estado viaja con el write (sobrevive recarga).
      qrEstado: "leido",
    });
  } catch {
    /* IDB caído — la fila ya está LISTA con el desenlace (honesto) */
  }
  logger.info(
    `[e14] capa0-qr reutiliza ${payloadQrCorto} fila=${fila.id} original=${originalQr.id}`,
  );
  return true;
}

/** Payload SIN original de sesión — e65b (T-4): YA-ENVIADA histórica (ledger)
 *  o registro de la ORIGINAL en el mapa del lote (sección crítica e71). */
async function resolverPayloadSinOriginal(
  ctx: CtxPipeline,
  fila: FilaMasiva,
  estado: EstadoCapa0,
  qrPayload: string,
  payloadQrCorto: string,
): Promise<DesenlaceStage | null> {
  // e65b (T-4): payload ya ENVIADO según el HISTÓRICO (ledger —
  // sobrevive vaciar/recargas, D-e65b-1) → YA-ENVIADA sin OCR.
  // forzarDedupOff manda SIEMPRE (RL-e65b-6 — el escape del mantenedor es
  // sagrado). La marca viaja con aceptarProcesando: esta fila ya fue
  // marcada PROCESANDO al entrar al pipeline (M-e65b-3). Jamás se
  // apunta a sí misma (defensivo — el re-encolado nace con id nuevo).
  if (!fila.forzarDedupOff) {
    const enviadaHist = await enviadaPorPayload(qrPayload);
    if (
      enviadaHist &&
      enviadaHist.id !== fila.id &&
      (await marcarYaEnviada(
        fila.id,
        enviadaHist.id,
        "payload",
        undefined,
        undefined,
        qrPayload,
        true,
      ))
    ) {
      logger.info(
        `[e14] capa0-qr ya-enviada-historico ${payloadQrCorto} fila=${fila.id} hist=${enviadaHist.id}`,
      );
      return ctxResueltoCapa0(ctx, estado); // sin OCR, sin envío — YA-ENVIADA jamás vuelve a siguientePendiente (T-5 e65)
    }
  }
  // ORIGINAL — payload nuevo en el lote (o auto-registrado: la fila ya
  // carryaba el payload de una pasada previa / entrada muerta re-apuntada).
  // e71 (Opt-3) — SECCIÓN CRÍTICA con RE-CHEQUEO: con 2 actas en vuelo,
  // DOS filas del MISMO payload podían ver el mapa vacío y registrar
  // AMBAS (Map.set sobrescribiría la original — mapa corrupto). Dentro
  // del mutex la segunda ve el registro de la primera y NO pisa: paga
  // SU OCR con desenlace propio y la capa 2 (mutexada) decide — el
  // mapa queda consistente SIEMPRE.
  await conExclusionMutua(async () => {
    const idEnMapa = originalQrDePayload(qrPayload);
    if (!idEnMapa || idEnMapa === fila.id) {
      registrarQrPayload(qrPayload, fila.id);
    }
  });
  logger.info(`[e14] capa0-qr original ${payloadQrCorto} fila=${fila.id}`);
  return null;
}

/** Original de sesión PRESENTE — decisión por su estado (LISTA/DUPLICADA →
 *  reutiliza; PROCESANDO → APLAZADA con espera acotada; resto → reproceso
 *  completo honesto). */
async function resolverOriginalViva(
  ctx: CtxPipeline,
  fila: FilaMasiva,
  estado: EstadoCapa0,
  qrPayload: string,
  payloadQrCorto: string,
  originalQr: FilaMasiva,
): Promise<DesenlaceStage | null> {
  if (fila.forzarDedupOff) {
    // El mantenedor pulsó PROCESAR IGUAL — las capas 0/1/2 lo respetan SIEMPRE
    // (misma doctrina e63k): reproceso completo, nada se reutiliza.
    logger.info(
      `[e14] capa0-qr reprocesa-completo ${payloadQrCorto} fila=${fila.id} forzarDedupOff`,
    );
    return null;
  }
  if (originalQr.estado === "LISTA" || originalQr.estado === "DUPLICADA") {
    // Original con desenlace FINAL → reutiliza (el OCR jamás se paga).
    if (await reutilizarViaQr(fila, estado, qrPayload, originalQr)) {
      return ctxResueltoCapa0(ctx, estado);
    }
    logger.info(
      `[e14] capa0-qr fallback fila=${fila.id} reprocesa-completo reutilizarResultado=false`,
    );
    return null;
  }
  if (originalQr.estado === "PROCESANDO") {
    // Original EN VUELO → APLAZADA `capa0=qr` (maquinaria aplazada de
    // e63k con motivo NUEVO): espera acotada SOLO-LECTURA del estado.
    logger.info(
      `[e14] capa0-qr aplazada ${payloadQrCorto} fila=${fila.id} original=${originalQr.id}`,
    );
    const desenlaceQr = await esperarDesenlaceQr(() =>
      storeMasiva().getState().filas.find((f) => f.id === originalQr.id)?.estado ?? "AUSENTE",
    );
    if (desenlaceQr === "reutiliza") {
      if (await reutilizarViaQr(fila, estado, qrPayload, originalQr)) {
        return ctxResueltoCapa0(ctx, estado);
      }
      logger.info(
        `[e14] capa0-qr fallback fila=${fila.id} reprocesa-completo reutilizarResultado=false`,
      );
      return null;
    }
    // Techo vencido (o el original salió del vuelo por otra puerta):
    // reproceso completo HONESTO — como si no hubiera gemela.
    logger.info(
      `[e14] capa0-qr techo-vencido reprocesa-completo fila=${fila.id} original=${originalQr.id}`,
    );
    return null;
  }
  // Original sin desenlace final ni en vuelo (PENDIENTE/ERROR) →
  // reproceso completo honesto (la gemela paga SU OCR, como hoy).
  logger.info(
    `[e14] capa0-qr reprocesa-completo ${payloadQrCorto} fila=${fila.id} original=${originalQr.id} estado=${originalQr.estado}`,
  );
  return null;
}

/** Decisión de dedup de la capa 0 por el payload leído (igualdad EXACTA). */
async function resolverDedupPorPayload(
  ctx: CtxPipeline,
  fila: FilaMasiva,
  estado: EstadoCapa0,
): Promise<DesenlaceStage | null> {
  const { qrPayload } = estado;
  if (qrPayload == null) return null; // acotado (la closure no hereda narrowing)
  const payloadQrCorto = qrCorto(qrPayload);
  const idOriginalQr = originalQrDePayload(qrPayload);
  const originalQr =
    idOriginalQr && idOriginalQr !== fila.id
      ? (storeMasiva().getState().filas.find((f) => f.id === idOriginalQr) ?? null)
      : null;
  if (!originalQr) {
    return resolverPayloadSinOriginal(ctx, fila, estado, qrPayload, payloadQrCorto);
  }
  return resolverOriginalViva(ctx, fila, estado, qrPayload, payloadQrCorto, originalQr);
}

/** STAGE 1/5 — capa 0 QR pre-OCR (R-26: cuerpo del monolito, subtareas
 *  arriba). Función PURA salvo los efectos de siempre (store/IDB/logger/
 *  mapas): recibe ctx y devuelve ctx nuevo; JAMÁS muta el que recibe. */
export async function faseCapa0Qr(ctx: CtxPipeline): Promise<DesenlaceStage> {
  const fila = ctx.fila;
  const archivo = ctx.archivo;
  const estado: EstadoCapa0 = {
    qrPayload: ctx.qrPayload,
    qrHeredado: ctx.qrHeredado,
    qrEstadoCapa0: ctx.qrEstadoCapa0,
    registro: ctx.registro, // R1.2 — el stage puede re-limpiar la traza qrSinPayload
    cadenaCapa0Completa: false,
    presupuestoVencidoCapa0: false,
    viaCacheNegativa: ctx.viaCacheNegativa,
    cacheNegativaEscrita: ctx.cacheNegativaEscrita,
    qrTierCapa0: ctx.qrTierCapa0,
    qrMsCapa0: ctx.qrMsCapa0,
    qrFasesCapa0: ctx.qrFasesCapa0,
    qrFinCapa0: ctx.qrFinCapa0,
    qrZxingMs: ctx.qrZxingMs,
    qrPresupuestoMsCapa0: ctx.qrPresupuestoMsCapa0,
  };
  const tQrCapa0 = performance.now(); // D44-R1 — el bloque capa-0 se cronometra ENTERO
  // KIT FASE 2: disparar el acta-completa AL INICIO del stage (clave = ID de
  // fila — el pipeline consume LA MISMA ida aunque el master D66 sea otro
  // File; ver prefacta.ts). Con el flag `actaNativa` apagado esto es `null`
  // sin fetch ni decode: coste 0.
  const prefActa = prefactaActa(
    fila.id,
    peekMaestro(fila.id)?.archivo ?? archivo,
  );
  if (prefActa && leerFlags().actaNativa) {
    dispararRelayPrefacta(fila);
  }
  const saltoHerencia = await heredarPayloadPrevio(fila, archivo, estado, prefActa, tQrCapa0);
  if (!saltoHerencia && saltaPorCacheNegativa(fila, estado.registro)) {
    estado.viaCacheNegativa = true;
    logger.info(
      `[e14] capa0-qr cache-negativa fila=${fila.id} nombre=${fila.nombre} (sin-payload conocido — ladder omitido, 2-3 ms)`,
    );
  } else if (!saltoHerencia) {
    await correrLadderQr(fila, archivo, estado);
  }
  estamparQrEstado(fila, estado);
  sellarCacheNegativa(fila, estado);
  let resuelto: DesenlaceStage | null = null;
  if (!estado.qrPayload) {
    logger.info(`[e14] capa0-qr sin-payload fila=${fila.id} nombre=${fila.nombre}`);
  } else {
    resuelto = await resolverDedupPorPayload(ctx, fila, estado);
  }
  // D44-R1 — cierre del bloque capa-0 (herencia/ladder + dedup + APLAZADA).
  const preOcrQrMs = Math.round(performance.now() - tQrCapa0);
  if (resuelto) return resuelto;
  return {
    resuelto: false,
    ctx: {
      ...ctx,
      registro: estado.registro,
      qrPayload: estado.qrPayload,
      qrHeredado: estado.qrHeredado,
      qrEstadoCapa0: estado.qrEstadoCapa0,
      preOcrQrMs,
      viaCacheNegativa: estado.viaCacheNegativa,
      cacheNegativaEscrita: estado.cacheNegativaEscrita,
      qrTierCapa0: estado.qrTierCapa0,
      qrMsCapa0: estado.qrMsCapa0,
      qrFasesCapa0: estado.qrFasesCapa0,
      qrFinCapa0: estado.qrFinCapa0,
      qrZxingMs: estado.qrZxingMs,
      qrPresupuestoMsCapa0: estado.qrPresupuestoMsCapa0,
    },
  };
}
