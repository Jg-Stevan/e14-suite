"use client";

/**
 * R-26 (H-18, auditoría 2026-11-16 · decisión D-2) — STAGE 2/5 extraído del
 * runner masivo: PIPELINE DE INTENTOS (D63-A/B · D66 · D65 · WAVE3 §B).
 * Movido VERBATIM de runner.ts (mismo orden, mismos literales — las anclas QA
 * de la caracterización §E se reposicionaron a ESTE archivo); solo el cuerpo
 * se descompone en sub-tareas de ≤80 líneas con un estado de trabajo
 * explícito. Aquí viven TAMBIÉN las constantes del watchdog (WATCHDOG_*_MS)
 * y el contador de rescates de la corrida — su único consumidor es esta fase
 * (el runner solo las REINICIA al arrancar).
 *
 * El BUCLE DE INTENTOS del pipeline real: origen del archivo (D63-A,
 * re-apuntado a escaneo si viaPdf — D63-A2) → pre-proceso deskew (D63-B,
 * descarta el master precalentado si el corregido manda) → master del
 * intento (D66 — intento 1 consume el precalentado; reintentos hornean
 * fresco) → escanearActa del bridge con el presupuesto restante del
 * watchdog (D65) → rescate RECHAZADA-BAJO (WAVE3 §B, UNA 2ª pasada con
 * workers frescos) → reintento del ERROR REAL (KIT e14-error-real-reintento-v1,
 * misma 2ª pasada). El error sale por `error` SOLO agotado el reintento
 * (ver abajo). Función PURA salvo efectos (bridge/store/logger/worker-kill):
 * recibe ctx y devuelve ctx nuevo — jamás muta el que recibe.
 */
import { getBridge } from "../../get-bridge";
// KIT e14-masiva-ux-v1 (T4): tipo con el presupuesto de timeout opcional
// (intersección LOCAL en el bridge — kit §1 prohíbe tocar bridge.ts).
import { type OpcionesEscaneoConTimeout } from "../../scanner-core-bridge";
// D66 — KIT e14-decode-unico-precalor-v1 (T1/T3): maestro único a escala de
// trabajo + precalor de la cola (consumo T3.3 + prefetch re-apuntado).
import { maestroDeImagen, type MaestroImagen } from "../archivos";
import { descartarMaestro } from "../precalor";
import {
  clasificarOrigenDeArchivo,
  type OrigenVeredicto,
} from "@jg-stevan/scanner-core/dominio/origen-escaneo"; // D63-A — detector de origen (KIT escaneo-compartido-v1: vive en el paquete)
import { preProcesoEscaneo, type PreProcesoEscaneo } from "../deskew"; // D63-B — pre-proceso de escaneos (kit e63b-deskew-escaneo-v1)
// WAVE3 §B — ORDEN-WAVE3-remoto-rescate-obs-v1: predicado PURO del rescate
// anti-falso-rechazo (RECHAZADA-BAJO intermitente — reintento, no rotaciones).
import { procedeRescateRechazo } from "../rescate";
import { storeMasiva } from "../store-api";
import { marcarVida, vidaDe } from "../runner-vida";
import {
  actaTimeoutWatchdog,
  correrIntento,
  esVeredictoTimeout,
  etapaDeSenal,
  matarYRecrearWorkers,
} from "../runner-watchdog";
import { planGamaActual } from "../../gama";
import { leerRegistroRaw } from "../cola";
import { decodificarQrDeCapture } from "../identidad-qr";
import { prefactaActa } from "../prefacta";
import type { Acta, EtapaAnalisis } from "../../types";
import { motivoCorto, type CtxPipeline, type CtxProcesarUno, type SalidaPipelineIntentos } from "./contexto";
import type { FilaMasiva, RegistroMasiva } from "../tipos";
import { logger } from "../../../logger";

// ─── D65 — KIT e14-progreso-watchdog-dedup-v1 (T1): WATCHDOG HUMANO ───
// Antes (e14-masiva-ux-v1 T4): presupuesto ÚNICO de 120 s — un colgado moría
// CIEGO una vez (informe 20261020-122235: 3 actas ~175 s, 8.7 min de cola
// congelada, `tiempos: null` sin etapa ni duración — el «se detiene a medio
// camino»). Ahora cada INTENTO tiene presupuesto propio y UN reintento:
const WATCHDOG_MS = 75_000;
const WATCHDOG_INTENTOS = 2;
const WATCHDOG_GRACIA_MS = 5_000;
// · WATCHDOG_MS (75 s) — presupuesto de CADA intento: el pipeline real mide
//   ~21 s total (OCR 12.5-22.6 s domina); 75 s ≈ 3× el peor caso real — un
//   intento que lo vence ya no es lentitud, es un colgaje. El flujo
//   individual sigue en 15 s (default de escanearActa — intacto).
// · WATCHDOG_INTENTOS (2) — intento original + 1 REINTENTO automático del
//   MISMO procesado ya iniciado por el mantenedor (NO re-encola nada nuevo — D45
//   intacto; criterios/score intactos). Al vencer: etapa capturada, workers
//   del intento muertos y re-creados (detección OpenCV + OCR RapidOCR), y
//   UN relanzamiento. Si el reintento también vence → MISMO veredicto de
//   hoy (ILEGIBLE - TIEMPO DE PROCESADO EXCEDIDO, score 0) con trazas
//   watchdog/etapaAlMorir/elapsedMs persistidas (T1.4 — nada de inventar).
// · WATCHDOG_GRACIA_MS — gracia de la carrera EXTERNA sobre WATCHDOG_MS:
//   cubre colgajes FUERA del bridge (origen/pre-proceso) que su timeout no ve.

/** KIT e14-gama-adaptativa-v1 (D74) — presupuesto del intento EFECTIVO:
 *  WATCHDOG_MS (75 s) se calibró con el peor caso del mantenedor (PC — el p95
 *  real de RECHAZADA-BAJO medía 30-46 s); en gama BAJO/MEDIA el p95 puede
 *  rozarlo y un kill FALSO paga workers muertos + re-OCR completo (coste
 *  doble) por «lentitud» que no era colgaje. Con el flag adaptativo ON el
 *  presupuesto se escala por tier (MEDIO 90 s · BAJO 105 s); flag OFF /
 *  ALTO ⇒ la base. La CONSTANTE queda byte-idéntica (ancla QA RED LINE 3
 *  qa-watchdog-relectura/qa-qr-identidad) y manda como PISO — el plan solo
 *  puede ESCALAR hacia arriba (jamás acorta el presupuesto histórico):
 *  este wrapper escala los 2 puntos de consumo de abajo (timeoutMs del
 *  bridge + carrera externa). */
function watchdogMsEfectivo(): number {
  return Math.max(WATCHDOG_MS, planGamaActual().watchdogMs);
}

// WAVE3 §B — rescate anti-falso-rechazo: rescates YA LANZADOS en ESTA
// corrida (techo MAX_RESCATES_CORRIDA — kit §B.1). Se reinicia en
// iniciarRunner (cada corrida arranca de cero) — el runner lo pide por
// función (R-26: el contador vive con su único consumidor).
let rescatesCorrida = 0;

/** Reset del techo de rescates (lo llama iniciarRunner al arrancar corrida). */
export function reiniciarRescatesDeCorrida(): void {
  rescatesCorrida = 0;
}

/** Desenlace clasificado de UN intento (correrIntento — runner-watchdog). */
type ResultadoIntento = Awaited<ReturnType<typeof correrIntento>>;

/** Decisión de UN intento para el bucle de la fase:
 *  · "desenlace" — break (el bridge resolvió un desenlace REAL).
 *  · "reintento" — continue (rescate WAVE3 §B o error real con cupo).
 *  · "error-agotado" — break + errorIntento (catch de siempre).
 *  · "muerte" — el intento murió por watchdog (traza + reintento si queda). */
type DecisionIntento = "desenlace" | "reintento" | "error-agotado" | "muerte";

/** Estado de trabajo del bucle de intentos — las sombras locales del stage
 *  original (R-26): las sub-tareas lo comparten por referencia (viajan en el
 *  ctx de salida — inmutable). El archivo del intento: el 1.º usa el archivo
 *  re-leído de IDB (el prefetch del original ya no existe — D66 re-apuntó ese
 *  trabajo al precalor: dispararPrefetch→asegurarMaestro). Los REINTENTOS
 *  re-leen el registro: instancia FRESCA del File — la decodeMemo del bridge
 *  es POR INSTANCIA y el intento muerto pudo envenenar la suya con un decode
 *  colgado (el fallback honesto de v1 se conserva si IDB falla). */
interface EstadoIntentos {
  fila: FilaMasiva;
  veredictoOrigen: OrigenVeredicto | null;
  preProceso: PreProcesoEscaneo | null;
  actaBruta: Acta | null;
  senal: { etapa: EtapaAnalisis; fraccion: number } | null;
  errorIntento: { error: unknown } | null;
  maestroDesenlace: MaestroImagen | null;
  decodeMasterMs: number | null;
  intentoDesenlace: number;
  archivoIntento: File;
  preOcrMs: number | null;
  tPreOcrIntento: number;
  preOcrOrigenMs: number;
  preOcrDeskewMs: number;
  preOcrMasterMs: number;
  preOcrPasadas: number;
  watchdogUsados: number;
  etapaAlMorir: string | null;
  elapsedMuerteMs: number | null;
  rescateLanzado: boolean;
  entradaPrecalor: { maestro: MaestroImagen; precalorMs: number } | null;
  registro: RegistroMasiva;
}

/** KIT e14-error-real-reintento-v1 — recuperación del intento muerto (PUNTO
 *  ÚNICO: antes vivía inline solo para el watchdog). */
async function prepararReintento(estado: EstadoIntentos): Promise<void> {
  await matarYRecrearWorkers(); // workers + OCR frescos (misma infra T1.2)
  try {
    // D41 — lectura RAW: solo se consumen `archivo` (File) para el reintento
    // — sin dataURLs que materializar.
    const fresco = await leerRegistroRaw(estado.fila.id);
    if (fresco.archivo instanceof File) {
      estado.registro = fresco;
      estado.archivoIntento = fresco.archivo;
    }
  } catch {
    /* IDB caído — el reintento usa la instancia actual (honesto) */
  }
}

/** D63-A/A2/B — origen del archivo + deskew + disciplina de memoria del
 *  master precalentado. Devuelve el veredicto de origen del intento. */
async function prepararBloquesPreOcr(estado: EstadoIntentos): Promise<OrigenVeredicto> {
  // ── D63-A — KIT e63a-origen-escaneo-v1 (punto ÚNICO del kit, T1/T2):
  // origen del archivo — detector heurístico conservador (origen.ts),
  // calculado UNA vez por fila AL INICIO del pipeline. SOLO visibilidad:
  // no alimenta score/gate (calibra D63-B/D63-C). Falla → null (el
  // detector jamás tumba el pipeline). Traza aditiva propia (contrato
  // D51: solo-AÑADIR) + campos en el diagnóstico (parche D57 de abajo).
  // D65: bloque AJENO byte-idéntico — el REINTENTO lo re-ejecuta (los
  // workers del intento anterior ya fueron muertos y re-creados).
  const tOrigenSeg = performance.now(); // D44-R1
  let veredictoOrigen: OrigenVeredicto = await clasificarOrigenDeArchivo(estado.archivoIntento);
  estado.preOcrOrigenMs += Math.round(performance.now() - tOrigenSeg);
  logger.info(
    `[e14] origen=${veredictoOrigen.origen ?? "null"} senales=${veredictoOrigen.senales ?? "null"}`,
  );
  // ── D63-A2 — KIT e14-d63a2-deskew-pipeline-v1 (T1): calibración por
  // CONSTRUCCIÓN — una fila nacida de un PDF (viaPdf, rama PDF del
  // store) ES un escaneo aunque el detector D63-A por señales no lo
  // diga (un E-14 impreso a sangre NO tiene borde blanco de escáner:
  // evidencia F1, informe 200613 — 10 null con borde-no-blanco). Las
  // señales de píxel del detector QUEDAN (honestidad D57) como prefijo
  // `pdf-render+…`. SIM y captura individual JAMÁS traen viaPdf (campo
  // de MASIVA — nace SOLO en la rama PDF de agregarFiles).
  if (estado.fila.viaPdf && veredictoOrigen.origen !== "escaneo") {
    veredictoOrigen = {
      origen: "escaneo",
      senales: `pdf-render+${veredictoOrigen.senales}`,
    };
    logger.info(
      `[e14] origen pdf-render → escaneo (señales píxel preservadas: ${veredictoOrigen.senales})`,
    );
  }

  // ── D63-B — KIT e63b-deskew-escaneo-v1 (bloque de PRE-PROCESO, T2/T3):
  // SOLO escaneos (origen del detector D63-A) — detección de ángulo sobre
  // la banda del encabezado + deskew selectivo (|θ| ≥ 0.3° y ≤ 10°) con
  // resample de alta calidad + limpieza suave del punto blanco. Fotos y
  // escaneos rectos+limpios pasan el archivo ORIGINAL byte-idéntico (memo
  // de decode del bridge intacta — cero cambios). El pipeline consume el
  // master corregido (T2.2); el original duerme en IDB sin cambios.
  // D65: bloque AJENO byte-idéntico (ídem D63-A — se re-ejecuta).
  const tDeskewSeg = performance.now(); // D44-R1
  estado.preProceso = await preProcesoEscaneo(estado.archivoIntento, veredictoOrigen.origen);
  estado.preOcrDeskewMs += Math.round(performance.now() - tDeskewSeg);
  if (veredictoOrigen.origen === "escaneo") {
    logger.info(
      `[e14] preproceso skewGrados=${estado.preProceso.skewGrados ?? "null"} deskewMs=${estado.preProceso.deskewMs ?? "null"} limpiezaMs=${estado.preProceso.limpiezaMs ?? "null"} limpieza=${estado.preProceso.limpieza} aplicado=${estado.preProceso.aplicado} decodeMs=${estado.preProceso.decodeMs ?? "null"}`,
    );
  }
  // ── D63-A2 (T0) — DISCIPLINA DE MEMORIA: si el CORREGIDO manda, el
  // master precalentado de esta fila muere AQUÍ (descartado por la vía
  // del precalor + referencia local soltada — NUNCA huérfano). El
  // precalor sigue decodificando el ORIGINAL en la espera (sin cambios
  // — simplicidad del kit): las filas PDF aplicadas pierden el
  // beneficio del precalor (doble decode por fila escaneada — coste
  // CONOCIDO y documentado: el OCR domina con ~13 s).
  if (estado.preProceso?.aplicado && estado.entradaPrecalor) {
    logger.info(
      `[e14] precalor fila=${estado.fila.id} descartado fuente=corregido precalorMs=${estado.entradaPrecalor.precalorMs}`,
    );
    descartarMaestro(estado.fila.id); // vía del precalor (idempotente — defensa)
    estado.entradaPrecalor = null; // soltar el blob YA (no al fin del scope)
  }
  return veredictoOrigen;
}

/** D66 — KIT e14-decode-unico-precalor-v1 (T1.2/T1.5): MASTER del intento.
 *  Intento 1 consume el master PRECALENTADO (T3.3 — el decode ya vivió en la
 *  espera; entradaPrecalor se consumió ANTES de marcar PROCESANDO).
 *  Reintentos (intento ≥ 2): horneado FRESCO del archivoIntento — el File fue
 *  re-leído de IDB (D65) y el intento muerto pudo envenenar la decodeMemo
 *  por-instancia del master anterior. Sin master (decode imposible) →
 *  fallback HONESTO: el bridge recibe archivoIntento tal cual (AC-P3). */
async function horneaMasterDelIntento(
  estado: EstadoIntentos,
  intento: number,
): Promise<{ maestro: MaestroImagen | null; decodeMsIntento: number | null }> {
  const tMaestro = Date.now();
  // ── D63-A2 (T0): FUENTE del master — el CORREGIDO del pre-proceso
  // (D63-B) cuando aplicó; el original en los demás casos. El bloque
  // D63-B calcula preProceso.archivo PERO la fusión D65/D66 lo dejó
  // desconectado (solo sus métricas llegaban — hallazgo del worklog
  // D65, orden del mantenedor: despertarlo AQUÍ y NADA más). El master
  // único D66 queda VERDADERO: el pipeline sigue consumiendo UN master
  // (`maestro?.archivo ?? archivoIntento` del bridge, sin tocar).
  const fuenteMaestro: File = estado.preProceso?.aplicado
    ? estado.preProceso.archivo
    : estado.archivoIntento;
  const tMasterSeg = performance.now(); // D44-R1
  const maestro: MaestroImagen | null =
    intento === 1 && !estado.preProceso?.aplicado
      ? (estado.entradaPrecalor?.maestro ??
        (await maestroDeImagen(fuenteMaestro, { nombre: estado.fila.nombre })))
      : await maestroDeImagen(fuenteMaestro, { nombre: estado.fila.nombre });
  estado.preOcrMasterMs += Math.round(performance.now() - tMasterSeg);
  const decodeMsIntento = maestro
    ? intento === 1 && estado.entradaPrecalor
      ? 0 // T3.3/T4: precalentada → el decode ya pasó en la espera
      : Math.max(1, Math.round(Date.now() - tMaestro))
    : null;
  if (maestro) {
    logger.info(
      `[e14] decode-maestro fila=${estado.fila.id} intento=${intento} ms=${decodeMsIntento} origen=${maestro.origenDecode} precalentada=${intento === 1 && !!estado.entradaPrecalor} ${maestro.ancho}x${maestro.alto}${estado.preProceso?.aplicado ? " fuente=corregido" : ""}`,
    );
  }
  return { maestro, decodeMsIntento };
}

/** T4/D65 — arma las opciones del bridge para ESTE intento (la intersección
 *  LOCAL OpcionesEscaneoConTimeout — bridge.ts intacto). */
function armarOpcionesMasiva(
  estado: EstadoIntentos,
  veredictoOrigen: OrigenVeredicto,
  maestro: MaestroImagen | null,
  tIntento: number,
): OpcionesEscaneoConTimeout {
  return {
    objetivo: null, // A4 — la clasificación REAL manda (viene del OCR)
    intento: 1, // A6 — semántica de PRIMERA captura (el watchdog NO es re-captura)
    maxIntentos: 4, // fallos → RECHAZADA repetible / rescate por recorte manual
    fuente: "ARCHIVO", // A5 — MASIVA SIEMPRE archivo
    archivo: maestro?.archivo ?? estado.archivoIntento, // D66 — el master (fallback: original)
    // D63-C — KIT e63c-quad-gate-escaneo-v1: origen del detector D63-A
    // alimenta T1 (quad página-completa) y T2 (gate del marco impreso).
    // SIM y el flujo individual JAMÁS lo traen (nada de escaneos les aplica).
    origenActa: veredictoOrigen.origen,
    // e66 (P4): la señal auditable viaja al bridge — "exif-camara"
    // omite el probe de rotaciones (orientación ya horneada por el
    // EXIF del core; aplicado=0 SIEMPRE — evidencia del mantenedor).
    origenSenales: veredictoOrigen.senales,
    // P2 (plan masiva — brief Agente A): el caller es el runner MASIVA
    // — el bridge OMITE la brújula QR (su payload no se consume aquí;
    // la rotación la cubren deskew D63-B + probe e66/e70 + rescate §B).
    // Intersección LOCAL OpcionesEscaneoConTimeout — bridge.ts intacto.
    desdeMasiva: true,
    // R10 — M10-fin: el runner INYECTA el decodificador QR (la MISMA
    // función que ya importa la capa 0 — import intacto) — el bridge
    // ya NO lo importa (fin de la ÚLTIMA dependencia invertida
    // núcleo→masiva). Necesario para las filas con `origen=null` (duda
    // honesta del detector D63-A): hoy caen en la rama tier-base del
    // bridge y su señal qrCam alimenta el veto ya-enviada post-OCR
    // (H1, abajo). Con `origenActa` presente el guard isMasiva la OMITE
    // igual que siempre (capa 0 manda).
    decodificadorQrCam: decodificarQrDeCapture,
    // KIT e14-ocr-nativo-v1 (FASE 2): el acta que el sidecar ya está
    // horneando (o horneó) para ESTE archivo. WeakMap por instancia → si
    // la capa 0 la disparó, es LA MISMA promesa y el bridge no espera un
    // segundo ida. Se omite en ESCANEOS (el bridge les pone quad de
    // identidad y el marco impreso manda su gate — el warp nativo les
    // vendría ancho) y cuando D63-B aplicó su corregido (el fotograma
    // que el bridge decodifica ya no es el que enviamos: otro quad).
    // La FASE 1 (det+rec nativo dentro del OCR escalonado) sí les aplica
    // a ambos — lo que aquí se apaga es el atajo de geometría, no el
    // motor. Sidecar mudo → null → pipeline JS de siempre.
    actaNativa:
      veredictoOrigen?.origen === "escaneo" || estado.preProceso?.aplicado
        ? undefined
        : prefactaActa(estado.fila.id, maestro?.archivo ?? estado.archivoIntento),
    onProgreso: (p) => {
      estado.senal = { etapa: p.etapa, fraccion: p.progreso }; // etapa al morir (T1.4)
      marcarVida(estado.fila.id, p); // señal de vida (T3 — throttle 250 ms)
    },
    // D65 (T1): presupuesto del INTENTO — lo RESTANTE de WATCHDOG_MS (el
    // pre-proceso ya gastó lo suyo; el timeout del bridge dispara SU acta
    // de timeout exactamente en la frontera del intento).
    timeoutMs: Math.max(5_000, watchdogMsEfectivo() - (Date.now() - tIntento)),
  };
}

/** WAVE3 §B — ¿procede el rescate RECHAZADA-BAJO de ESTA corrida? (cupo:
 *  1 por fila — el predicado exige intento===1 — + MAX_RESCATES_CORRIDA). */
function procedeRescateDeCorrida(estado: EstadoIntentos, intento: number, acta: Acta): boolean {
  return procedeRescateRechazo(acta, {
    intento,
    rescatesCorrida,
    forzarDedupOff: estado.fila.forzarDedupOff,
  });
}

/** Clasifica el desenlace del intento despachado (acta/error/tope → decisión
 *  del bucle). El veredicto-timeout del bridge (y el tope de la carrera
 *  externa) caen a "muerte": traza del watchdog + reintento si queda cupo. */
async function procesarResultadoIntento(
  estado: EstadoIntentos,
  intento: number,
  maestro: MaestroImagen | null,
  decodeMsIntento: number | null,
  resultado: ResultadoIntento,
): Promise<DecisionIntento> {
  if (resultado.tipo === "acta") {
    estado.actaBruta = resultado.acta;
    // D66: el desenlace nació de ESTE master — fija sus trazas.
    estado.maestroDesenlace = maestro;
    estado.decodeMasterMs = decodeMsIntento;
    estado.intentoDesenlace = intento;
    if (!esVeredictoTimeout(resultado.acta)) {
      // WAVE3 §B — ORDEN-WAVE3-remoto-rescate-obs-v1 (feat/rescate-
      // rechazo-v1): RECHAZADA-BAJO en el intento 1 es INTERMITENTE
      // (OCR bajo presión — evidencia lotes 7/8/9: las MISMAS actas
      // dieron score 10 FUERTE después; el probe jamás rotó) → UNA
      // 2ª pasada del paso desenlace con workers frescos (la
      // maquinaria EXISTENTE del bucle — nada nuevo de OCR). Cupos:
      // 1 por fila (el predicado exige intento===1) +
      // MAX_RESCATES_CORRIDA por corrida. Si el reintento también
      // RECHAZA → se acepta el rechazo (honesto, sin inventar).
      // forzarDedupOff manda SIEMPRE (RL-e65b-6 — escape del mantenedor).
      if (procedeRescateDeCorrida(estado, intento, resultado.acta)) {
        rescatesCorrida += 1;
        estado.rescateLanzado = true;
        logger.info(`[e14] rescate-rechazo fila=${estado.fila.id} intento=2`);
        await matarYRecrearWorkers(); // workers frescos (misma infra T1.2)
        return "reintento"; // 2ª pasada del MISMO paso desenlace — el bucle re-ejecuta
      }
      return "desenlace"; // desenlace REAL (comportamiento de siempre)
    }
    // veredicto-timeout del bridge → el intento MURIÓ (cae al final del
    // loop: traza + kill de workers + reintento si queda cupo).
    return "muerte";
  }
  if (resultado.tipo === "error") {
    // KIT e14-error-real-reintento-v1 — el error REAL rompía directo a
    // fila ERROR mientras que el timeout (más lento) sí se reintentaba.
    // Bajo carga eso es lo que mataba actas del lote: con poolWorkers=2
    // el OCR es un SINGLETON compartido y rapidOcrReiniciar() suelta las
    // sesiones SIN mirar reconocimientosEnVuelo ⇒ el watchdog de una
    // acta ajena le deja a ESTA una sesión muerta («CANNOT RUN
    // INFERENCE. INVALID SESSION ID» / «ORTRun() error_code 1»). Es
    // TRANSITORIO por construcción: EL MISMO reintento del watchdog (matar y
    // re-crear, File fresco) y una 2.ª pasada. Cupo: el propio bucle
    // (intento < WATCHDOG_INTENTOS ⇒ máx. 1 por fila). Si el reintento
    // también falla → MISMO veredicto de siempre (fila ERROR, honesto).
    if (intento < WATCHDOG_INTENTOS) {
      logger.info(
        `[e14] error-real fila=${estado.fila.id} intento=${intento}/${WATCHDOG_INTENTOS} → reintento (${motivoCorto(resultado.error)})`,
      );
      await prepararReintento(estado);
      return "reintento";
    }
    estado.errorIntento = resultado; // agotó el reintento → catch de siempre
    return "error-agotado";
  }
  return "muerte"; // resultado.tipo === "tope" → el bridge nunca respondió: intento muerto.
}

/** Traza + trazas del watchdog del intento muerto. Devuelve si queda cupo
 *  para el reintento (D65 T1.3: a los 2 intentos, veredicto de siempre). */
function trazarMuerteWatchdog(estado: EstadoIntentos, intento: number, tIntento: number): boolean {
  estado.watchdogUsados = intento;
  estado.etapaAlMorir = etapaDeSenal(estado.senal);
  estado.elapsedMuerteMs = Date.now() - tIntento;
  logger.info(
    `[e14] watchdog fila=${estado.fila.id} intento=${intento}/${WATCHDOG_INTENTOS} etapa=${estado.etapaAlMorir ?? "null"} elapsed=${estado.elapsedMuerteMs}ms`,
  );
  return intento < WATCHDOG_INTENTOS;
}

/** ctx enriquecido del stage — la MISMA spread de las DOS salidas del
 *  monolito (fallo:false y fallo:true — R-26 la unifica; el objeto
 *  resultante es idéntico campo por campo). */
function ctxDeIntentos(ctxEntrada: CtxPipeline, estado: EstadoIntentos): CtxProcesarUno {
  return {
    ...ctxEntrada,
    registro: estado.registro,
    entradaPrecalor: estado.entradaPrecalor,
    veredictoOrigen: estado.veredictoOrigen,
    preProceso: estado.preProceso,
    actaBruta: estado.actaBruta,
    maestroDesenlace: estado.maestroDesenlace,
    decodeMasterMs: estado.decodeMasterMs,
    intentoDesenlace: estado.intentoDesenlace,
    preOcrMs: estado.preOcrMs,
    tPreOcrIntento: estado.tPreOcrIntento,
    preOcrOrigenMs: estado.preOcrOrigenMs,
    preOcrDeskewMs: estado.preOcrDeskewMs,
    preOcrMasterMs: estado.preOcrMasterMs,
    preOcrPasadas: estado.preOcrPasadas,
    watchdogUsados: estado.watchdogUsados,
    etapaAlMorir: estado.etapaAlMorir,
    elapsedMuerteMs: estado.elapsedMuerteMs,
    rescateLanzado: estado.rescateLanzado,
  };
}

/** UN intento del bucle (preparación → despacho → clasificación), con el
 *  catch del ERROR REAL (un reintento con maquinaria fresca antes de
 *  sentenciar — NUNCA es muerte de watchdog). */
async function correrIntentoDelBucle(
  estado: EstadoIntentos,
  intento: number,
  tIntento: number,
): Promise<DecisionIntento> {
  try {
    const veredictoOrigen = await prepararBloquesPreOcr(estado);
    const { maestro, decodeMsIntento } = await horneaMasterDelIntento(estado, intento);
    const opcionesMasiva = armarOpcionesMasiva(estado, veredictoOrigen, maestro, tIntento);
    // KIT e14-etapas-preocr-v1 (D43): cierre del tramo pre-OCR del intento
    // (capa-0 + origen + deskew + master) — justo ANTES de despachar el
    // bridge. Acumula reintentos (intento ≥ 2 re-armó arriba).
    estado.preOcrMs = (estado.preOcrMs ?? 0) + Math.round(performance.now() - estado.tPreOcrIntento);
    estado.preOcrPasadas += 1; // D44-R4 — pasada completa del muro (reintento = re-armó)
    const resultado = await correrIntento(
      getBridge().escanearActa(opcionesMasiva),
      watchdogMsEfectivo() + WATCHDOG_GRACIA_MS,
    );
    return await procesarResultadoIntento(estado, intento, maestro, decodeMsIntento, resultado);
  } catch (err) {
    // KIT e14-error-real-reintento-v1 — el throw del cuerpo (decode,
    // pre-proceso o el propio bridge re-lanzando) es el MISMO error real
    // de arriba: un reintento con la maquinaria fresca antes de sentenciar.
    // NUNCA es muerte de watchdog.
    if (intento < WATCHDOG_INTENTOS) {
      logger.info(
        `[e14] error-real fila=${estado.fila.id} intento=${intento}/${WATCHDOG_INTENTOS} (throw) → reintento (${motivoCorto(err)})`,
      );
      await prepararReintento(estado);
      return "reintento";
    }
    estado.errorIntento = { error: err };
    return "error-agotado";
  }
}

/** STAGE 2/5 — pipeline de intentos (R-26: cuerpo del monolito, subtareas
 *  arriba). El fallo viaja tipado con TODO su ctx: procesarUno lo vuelve
 *  fila ERROR — la cola sigue. */
export async function fasePipelineIntentos(ctxEntrada: CtxPipeline): Promise<SalidaPipelineIntentos> {
  const estado: EstadoIntentos = {
    fila: ctxEntrada.fila,
    veredictoOrigen: ctxEntrada.veredictoOrigen,
    preProceso: ctxEntrada.preProceso,
    actaBruta: ctxEntrada.actaBruta,
    senal: null, // la etapa al morir es la del INTENTO que muere
    errorIntento: null,
    maestroDesenlace: ctxEntrada.maestroDesenlace,
    decodeMasterMs: ctxEntrada.decodeMasterMs,
    intentoDesenlace: ctxEntrada.intentoDesenlace,
    archivoIntento: ctxEntrada.archivo,
    preOcrMs: ctxEntrada.preOcrMs,
    tPreOcrIntento: ctxEntrada.tPreOcrIntento,
    preOcrOrigenMs: ctxEntrada.preOcrOrigenMs,
    preOcrDeskewMs: ctxEntrada.preOcrDeskewMs,
    preOcrMasterMs: ctxEntrada.preOcrMasterMs,
    preOcrPasadas: ctxEntrada.preOcrPasadas,
    watchdogUsados: ctxEntrada.watchdogUsados,
    etapaAlMorir: ctxEntrada.etapaAlMorir,
    elapsedMuerteMs: ctxEntrada.elapsedMuerteMs,
    rescateLanzado: ctxEntrada.rescateLanzado,
    entradaPrecalor: ctxEntrada.entradaPrecalor,
    registro: ctxEntrada.registro,
  };
  try {
    // (bucle movido VERBATIM de procesarUno — mismo orden, mismos literales)
    for (let intento = 1; intento <= WATCHDOG_INTENTOS; intento += 1) {
      const tIntento = Date.now();
      // KIT e14-etapas-preocr-v1 (D43): intentos ≥ 2 re-pagan origen/deskew/
      // master (D65 — bloques del reintento byte-idénticos) → re-armar el
      // cronómetro pre-OCR. La matanza/re-creación de workers ENTRE intentos
      // NO es pre-OCR (costo del watchdog) — queda fuera por construcción.
      if (intento > 1) estado.tPreOcrIntento = performance.now();
      estado.senal = null; // la etapa al morir es la del INTENTO que muere
      // Reintento del watchdog: MISMA acta → el % global CONSERVA el máximo
      // alcanzado (monotónico — no vuelve a 0; la etiqueta de fase sí vuelve
      // a PREPARANDO para contar la historia del reintento).
      storeMasiva()
        .getState()
        .marcarProgreso(estado.fila.id, { etapa: "preparando", fracGlobal: vidaDe(estado.fila.id).frac });
      const decision = await correrIntentoDelBucle(estado, intento, tIntento);
      if (decision === "desenlace" || decision === "error-agotado") break;
      if (decision === "reintento") continue;
      // "muerte" — la traza del watchdog + reintento si queda cupo (T1.2:
      // matar y re-crear los workers del intento y relanzar UNA vez. El
      // reintento es del MISMO procesado ya iniciado por el mantenedor —
      // no re-encola nada nuevo — D45 intacto; criterios/score intactos).
      if (!trazarMuerteWatchdog(estado, intento, tIntento)) break;
      await prepararReintento(estado);
    }
    if (estado.errorIntento) throw estado.errorIntento.error;
    if (!estado.actaBruta) {
      // Colgaje FUERA del bridge (origen/pre-proceso) en TODOS los intentos:
      // el veredicto de SIEMPRE con la MISMA forma del acta de timeout del
      // bridge (score 0 — nada inventado).
      estado.actaBruta = actaTimeoutWatchdog(estado.fila.id);
    }
    // WAVE3 §B — traza del rescate SALVADOR: el reintento produjo un
    // desenlace ≠ RECHAZADA (honesto — solo cuando el rescate corrió).
    if (
      estado.rescateLanzado &&
      estado.actaBruta.status !== "RECHAZADA" &&
      !esVeredictoTimeout(estado.actaBruta)
    ) {
      logger.info(`[e14] rescate-rechazo OK fila=${estado.fila.id}`);
    }
    const actaBruta = estado.actaBruta; // garantizada por el fallback de arriba
    return { fallo: false, ctx: { ...ctxDeIntentos(ctxEntrada, estado), actaBruta } };
  } catch (err) {
    // R-20 (rastro del catch): el fallo NO se traga — viaja TIPADO con todo
    // su ctx ({fallo, ctx, error}); procesarUno lo vuelve fila ERROR y la
    // cola sigue (la traza del error concreto la escribió el intento que
    // murió — ver logger de trazarMuerteWatchdog/error-real arriba).
    return { fallo: true, ctx: ctxDeIntentos(ctxEntrada, estado), error: err };
  }
}
