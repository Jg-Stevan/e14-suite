"use client";

/**
 * R-26 (H-18, auditoría 2026-11-16 · decisión D-2 del plan 2026-11) — SPLIT del
 * runner masivo: CONTEXTO TIPADO compartido + piezas del runner que las TRES
 * fases extraídas (fase-capa0-qr.ts · fase-pipeline-intentos.ts ·
 * fase-desenlace.ts) y el orquestador (../runner.ts) consumen JUNTOS.
 *
 * Qué vive aquí (movido VERBATIM de runner.ts — mismo orden, mismos literales):
 *  · Los tipos del CTX explícito del split R8 (CtxProcesarUno y familia) y el
 *    PUNTO ÚNICO del estampado de trazas post-mortem (trazasPostMortemDe).
 *  · El mutex del dedup (mutexDedup/conExclusionMutua — kit e71 Opt-3).
 *  · motivoCorto (el runner y el pipeline de intentos lo comparten).
 *  · proximaFilaPendiente (el relé del acta nativa de la capa 0 y el prefetch
 *    D66 del runner lo comparten).
 *  · reutilizarResultado (la maquinaria de copia de duplicadas — la consumen
 *    la capa 0, el desenlace y el prólogo/orquestador del runner).
 *
 * Por qué UN módulo aparte: las fases importan estas piezas y el runner
 * importa las fases — dejarlas en runner.ts cerraría un ciclo runner↔fases, y
 * los ciclos con `export const`/`let` tardío ya mordieron en bun («export not
 * found» — ver la nota de QR_PREVIO_LADO_LARGO en el runner). Sentido ÚNICO:
 * fases/* → contexto.ts ← runner.ts (jamás al revés).
 */
import { identidadDeActa } from "../identidad";
import { guardarRegistro, leerRegistroRaw } from "../cola";
import { marcarFila } from "../runner-vida";
import { registrarMetricaCopia } from "../metricas";
import { storeMasiva } from "../store-api";
import { paginaDeActa, tituloDeActa, type FilaMasiva, type RegistroMasiva } from "../tipos";
import type { Acta } from "../../types";
import type { MaestroImagen } from "../archivos";
import type { OrigenVeredicto } from "@jg-stevan/scanner-core/dominio/origen-escaneo";
import type { PreProcesoEscaneo } from "../deskew";
import type { IdentidadActa } from "../identidad";
import type { FasesCapa0 } from "../capa0-qr.client"; // R1.4-b — tipo puro (se borra al compilar)
import { logger } from "../../../logger";

// ─── R8 · SPLIT de procesarUno (misión punto 3) — CTX EXPLÍCITO ───────────
// El orquestador (procesarUno) conserva: prólogo (rama DUPLICADA + precalor),
// el ÚNICO try/catch/finally (jamás tumbar la cola) y las estampadas del
// post-mortem hasta su unificación (stage 5). Cada STAGE es una función con
// el contexto explícito CtxProcesarUno: recibe ctx y devuelve ctx NUEVO
// (inmutable enriquecido — jamás muta el que recibe) o resuelto:true cuando
// el desenlace quedó resuelto sin seguir al pipeline (reutiliza/ya-enviada/
// guard M8/dedup contenido). Los stages viven en las fases/* y runner.ts
// (caracterización §E — anclas reposicionadas por R-26).
export interface CtxProcesarUno {
  // Insumos del orquestador (ningún stage los cambia).
  fila: FilaMasiva;
  archivo: File | null; // File garantizado tras el guard del try (CtxPipeline)
  registro: RegistroMasiva | null; // leído de IDB al entrar al try (CtxPipeline)
  esperaMs: number; // D57 — espera en cola → tInicio
  tsDespacho: number | null; // D44-R3
  tPreOcrIntento: number; // cronómetro del muro pre-OCR (se re-arma por intento)
  entradaPrecalor: { maestro: MaestroImagen; precalorMs: number } | null;
  // STAGE 1 — capa 0 QR (faseCapa0Qr).
  qrPayload: string | null; // e63m — llave OPACA (RED LINE 10)
  qrEstadoCapa0: "leido" | "sin-payload" | null; // e64-qr T-0.2 (SOLO-VISUAL)
  qrHeredado: boolean; // D44-R2 — heredó qrPrevio (sin decode ni ladder)
  preOcrQrMs: number | null; // D44-R1 — el bloque capa-0 entero
  // R1.1/R1.2/R1.4-b — telemetría de la CAPA 0 (integración remota main).
  viaCacheNegativa: boolean; // R1.2 — se SALTÓ el ladder POR la caché negativa
  cacheNegativaEscrita: boolean; // R1.2 — la caché fue ESCRITA en esta pasada
  qrTierCapa0: string | null; // R1.4 — tier ganador del worker (null = main/sin lectura)
  qrMsCapa0: number | null; // R1.4 — ms del worker (null honesto)
  qrFasesCapa0: FasesCapa0 | null; // R1.4-b — desglose por fase (null = sin worker/bundle viejo)
  qrFinCapa0: string | null; // R1.4-b — causa del fin de la cadena
  qrZxingMs: number | null; // R1.4-b — ms del rescate zxing de main
  qrPresupuestoMsCapa0: number | null; // R1.4-b — presupuesto REAL con el que corrió
  // STAGE 2 — pipeline de intentos (fasePipelineIntentos).
  preOcrMs: number | null; // D43 — el muro pre-OCR (null = jamás llegó al bridge)
  preOcrOrigenMs: number; // D63-A por intento (acumula reintentos)
  preOcrDeskewMs: number; // D63-B ídem
  preOcrMasterMs: number; // D66 ídem
  preOcrPasadas: number; // D44-R4 — pasadas del muro (1 = sin reintento)
  watchdogUsados: number; // D65 (T1.4)
  etapaAlMorir: string | null;
  elapsedMuerteMs: number | null;
  rescateLanzado: boolean; // WAVE3 §B — máx 1 por fila
  veredictoOrigen: OrigenVeredicto | null; // D63-A (del ÚLTIMO intento)
  preProceso: PreProcesoEscaneo | null; // D63-B (ídem)
  actaBruta: Acta | null; // desenlace crudo del pipeline (o acta de timeout)
  maestroDesenlace: MaestroImagen | null; // D66 — master que SÍ sirvió
  decodeMasterMs: number | null;
  intentoDesenlace: number;
  // STAGE 3 — desenlace (faseDesenlace: relectura + capa 2 + dedup contenido).
  actaParcheada: Acta | null; // desenlace parcheado D57 PRE-relectura — el thumb del stage 5 y el fallback del liviano consumen ESTE acta (byte-idéntico incluso con re-lectura: la re-lectura no cambia fotos)
  actaDesenlace: Acta | null; // post re-lectura (e63f)
  relecturaDesenlace: "auto" | "sin-cambio" | null;
  identidad: IdentidadActa | null; // e63k capa 2
  falsoPositivoEvitado: boolean; // e63k — banda aplazada resuelta sin-match
  // STAGE 4 — envío (faseEnvio).
  actaFinal: Acta | null; // post envío (ENVIADA) o desenlace de siempre
  enviadaAuto: boolean;
}

/** Ctx DENTRO del pipeline: el try garantizó registro (leído) y archivo (File
 *  por el guard instanceof) — los stages 1-5 lo exigen no-null. */
export type CtxPipeline = CtxProcesarUno & { registro: RegistroMasiva; archivo: File };

/** Resultado de UN stage: resuelto = desenlace ya resuelto (procesarUno
 *  return — el finally del orquestador limpia igual); si no, ctx enriquecido. */
export type DesenlaceStage = { resuelto: boolean; ctx: CtxProcesarUno; error?: unknown };

/** Salida del STAGE 2: sin error el ctx garantiza actaBruta (el fallback
 *  actaTimeoutWatchdog corrió — el orquestador consume Acta no-null, igual
 *  que hoy tras el `if (!actaBruta)`); con error el ctx viaja base y el
 *  orquestador espeja SOLO las trazas del post-mortem antes de re-lanzar. */
export type SalidaPipelineIntentos =
  | { fallo: false; ctx: CtxProcesarUno & { actaBruta: Acta } }
  | { fallo: true; ctx: CtxProcesarUno; error: unknown };

/** Ctx POST-pipeline: el stage 2 garantizó actaBruta (fallback del watchdog). */
export type CtxPostPipeline = CtxPipeline & { actaBruta: Acta };

/** Salida del STAGE 3: sin resuelto el ctx garantiza los DOS acta del
 *  desenlace (parcheada pre-relectura + post re-lectura) — el stage 4 las
 *  consume Acta no-null. */
export type SalidaDesenlace =
  | { resuelto: true; ctx: CtxProcesarUno }
  | {
      resuelto: false;
      ctx: CtxProcesarUno & { actaParcheada: Acta; actaDesenlace: Acta };
    };

/** Ctx POST-desenlace: el stage 3 garantizó los DOS acta del desenlace
 *  (parcheada pre-relectura + post re-lectura) al seguir al envío. */
export type CtxPostDesenlace = CtxPostPipeline & { actaParcheada: Acta; actaDesenlace: Acta };

/** Salida del STAGE 4: sin resuelto el ctx garantiza actaFinal (ENVIADA o el
 *  desenlace de siempre — el parche D61 con envioMs/remotoMs ya aplicado) —
 *  el stage 5 la consume Acta no-null. */
export type SalidaFaseEnvio =
  | { resuelto: true; ctx: CtxProcesarUno }
  | { resuelto: false; ctx: CtxProcesarUno & { actaFinal: Acta } };

/** Trazas post-mortem del re-save (el spread EXACTO que estampaban los 3
 *  sitios duplicados + registroListo — campo por campo opcional). */
export type TrazasPostMortem = {
  qrPayload?: string;
  qrHeredado?: true;
  qrEstado?: "leido" | "sin-payload";
  watchdog?: number;
  etapaAlMorir?: string;
  elapsedMs?: number;
  rescateRechazo?: "salvado" | "lanzado";
  qrCacheNegativa?: boolean; // R1.2 — skip del ladder por caché negativa
  qrSinPayload?: boolean; // R1.2 — hecho registrado (| undefined = re-limpieza)
  qrTier?: string | null; // R1.4 — tier ganador del worker
  qrMs?: number | null; // R1.4 — ms del worker
  qrFases?: FasesCapa0; // R1.4-b — desglose por fase
  qrFin?: string; // R1.4-b — causa del fin de la cadena
  qrZxingMs?: number; // R1.4-b — ms del rescate zxing de main
  qrPresupuestoMs?: number; // R1.4-b — presupuesto REAL de la escalera
};

/** PUNTO ÚNICO del estampado de trazas (misión punto 3 / C-1 de la zona:
 *  hoy el estampado vive en 3 sitios — re-saves de capa-2/dedup-contenido,
 *  registroListo y el catch — y cada traza nueva debía recordarse en todos).
 *  Los writes consumen ESTE builder: cada sitio declara qué subset estampa
 *  HOY, con las MISMAS condiciones byte-idénticas —
 *  · qrPayload/qrEstado: SIEMPRE que existan (todos los sitios).
 *  · heredado — stamp `qrHeredado: true` SOLO si la capa 0 heredó (false
 *    prematuro mentiría — registroListo/catch).
 *  · watchdog — stamp watchdog/etapaAlMorir/elapsedMs SOLO si
 *    watchdogUsados > 0 (catch).
 *  · rescate — "auto": salvado|lanzado por el status del desenlace
 *    (registroListo); "salvado" fijo (dup tras rescate cuenta como salvada);
 *    "lanzado" fijo (ERROR tardío); ausente = no estampa (re-saves de dup
 *    sin rescate en su traza).
 *  Añadir una traza nueva = UNA edición aquí. */
export function trazasPostMortemDe(
  ctx: CtxProcesarUno,
  subset: {
    heredado?: boolean;
    watchdog?: boolean;
    rescate?: "auto" | "salvado" | "lanzado";
    statusDesenlace?: Acta["status"];
    capa0Telemetria?: boolean; // R1.2/R1.4/R1.4-b — SOLO registroListo y el catch la estampan
    limpiaSinPayload?: boolean; // R1.2 — re-limpieza de la traza vieja (SOLO registroListo)
  },
): TrazasPostMortem {
  const { qrPayload, qrEstadoCapa0, qrHeredado, watchdogUsados, etapaAlMorir, elapsedMuerteMs, rescateLanzado } = ctx;
  return {
    ...(qrPayload ? { qrPayload } : {}),
    ...(subset.heredado && qrHeredado ? { qrHeredado: true } : {}),
    ...(qrEstadoCapa0 ? { qrEstado: qrEstadoCapa0 } : {}),
    ...(subset.watchdog && watchdogUsados > 0
      ? {
          watchdog: watchdogUsados,
          ...(etapaAlMorir != null ? { etapaAlMorir } : {}),
          ...(elapsedMuerteMs != null ? { elapsedMs: elapsedMuerteMs } : {}),
        }
      : {}),
    // R1.2/R1.4/R1.4-b — telemetría de la CAPA 0 (integración remota main):
    // SOLO registroListo y el catch del post-mortem la estampan (los re-saves
    // de dedup/capa-2 NO — byte-idéntico al monolito remoto). La re-limpieza
    // qrSinPayload:undefined es SOLO del registroListo (el catch del ERROR
    // jamás la tuvo).
    ...(subset.capa0Telemetria && ctx.viaCacheNegativa
      ? { qrCacheNegativa: true as const }
      : {}),
    ...(subset.capa0Telemetria && ctx.cacheNegativaEscrita
      ? { qrSinPayload: true as const }
      : {}),
    ...(subset.limpiaSinPayload && ctx.qrPayload && ctx.registro?.qrSinPayload
      ? { qrSinPayload: undefined }
      : {}),
    ...(subset.capa0Telemetria &&
    (ctx.qrTierCapa0 != null || ctx.qrMsCapa0 != null)
      ? { qrTier: ctx.qrTierCapa0, qrMs: ctx.qrMsCapa0 }
      : {}),
    ...(subset.capa0Telemetria && ctx.qrFasesCapa0
      ? { qrFases: ctx.qrFasesCapa0 }
      : {}),
    ...(subset.capa0Telemetria && ctx.qrFinCapa0 != null
      ? { qrFin: ctx.qrFinCapa0 }
      : {}),
    ...(subset.capa0Telemetria && ctx.qrZxingMs != null
      ? { qrZxingMs: ctx.qrZxingMs }
      : {}),
    ...(subset.capa0Telemetria && ctx.qrPresupuestoMsCapa0 != null
      ? { qrPresupuestoMs: ctx.qrPresupuestoMsCapa0 }
      : {}),
    ...(rescateLanzado && subset.rescate
      ? {
          rescateRechazo:
            subset.rescate === "auto"
              ? ((subset.statusDesenlace ?? "RECHAZADA") !== "RECHAZADA"
                  ? ("salvado" as const)
                  : ("lanzado" as const))
              : subset.rescate,
        }
      : {}),
  };
}

/** Mutex simple (kit Opt-3: «Mutex simple o encolar la verificación de
 *  dedup en un solo hilo») — promesa-cadena FIFO: cada sección crítica se
 *  encola detrás de la anterior y JAMÁS se intercala. Solo la protege lo
 *  que decide/marca dedup; el OCR y el precalor quedan FUERA (paralelos de
 *  verdad). */
let mutexDedup: Promise<void> = Promise.resolve();

export async function conExclusionMutua<T>(seccion: () => Promise<T>): Promise<T> {
  const anterior = mutexDedup;
  let liberar!: () => void;
  mutexDedup = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  await anterior;
  try {
    return await seccion();
  } finally {
    liberar();
  }
}

export function motivoCorto(err: unknown): string {
  const crudo = err instanceof Error ? err.message : String(err);
  const corto = crudo.replace(/\s+/g, " ").trim().slice(0, 48);
  return (corto || "ERROR DEL PIPELINE").toUpperCase();
}

/** La siguiente fila PENDIENTE en FIFO (temporales y la actual fuera) — el
 *  mismo criterio del prefetch D66, extrado para que el relé del acta nativa
 *  (capa 0) lo reutilice sin duplicar el filtro. */
export function proximaFilaPendiente(filaActualId: string) {
  return storeMasiva()
    .getState()
    .filas.filter(
      (f) =>
        f.estado === "PENDIENTE" &&
        f.id !== filaActualId &&
        !f.id.startsWith("masiva-temp-"),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn)[0];
}

// ─── R8 · reutilizarResultado (maquinaria de copia de duplicadas) ──────────

/** KIT e14-masiva-tiempos-v1 (PR-1): la fila DUPLICADA REUTILIZA el resultado
 *  de su original (kit §2 — copia registro+status+thumb, sin pipeline, sin
 *  contadores: el desenlace del acta gemela YA fue registrado con la
 *  original). El acta copiada se RE-IDENTIFICA con el id de ESTA fila
 *  (contrato de sincronizarAlVolver: acta.id === id de la fila abierta).
 *  Devuelve false ante CUALQUIER falta (original quitada/ERROR/sin acta) →
 *  la fila cae al reproceso completo — jamás inventar. */
export async function reutilizarResultado(fila: FilaMasiva, t0: number): Promise<boolean> {
  // e71 (Opt-3): leer original → decidir status → escribir copia es
  // SECCIÓN CRÍTICA de dedup — en el mutex JAMÁS se intercala con otra
  // verificación/marca (capa 0 / capa 2 / ingesta) aunque haya 2 actas en
  // vuelo. El cuerpo vive intacto en reutilizarResultadoCritica.
  return conExclusionMutua(() => reutilizarResultadoCritica(fila, t0));
}

/** e66 (P2) / e71 (P2.1) — deriva el ACTA COPIADA del acta del original:
 *  · original ENVIADA/OPTIMA (desenlace de envío) → DUPLICADA (regla e66
 *    intacta — la copia es un doble del enviado).
 *  · original RECHAZADA o CON rechazo → RECHAZADA heredada (el informe la
 *    cuenta en su rechazo real, jamás como «duplicada»).
 *  · resto (ADVERTENCIA / EN_REVISION_HUMANA sin rechazo) → DUPLICADA.
 *  Además (e66 P3.4 / e72): esperaMs PROPIO de la gemela (t0 − agregadaEn),
 *  totalMs = la copia en sí y ocrMs = 0 EXPLÍCITO (la copia JAMÁS paga
 *  OCR — guard e72). La serie también se deriva de la copia (e63k F1.4). */
function derivarActaCopia(
  actaOrigen: Acta,
  fila: FilaMasiva,
  t0: number,
  tCopia: number,
): { actaCopia: Acta; serieCopia: string | null } {
  const actaCopia = { ...actaOrigen, id: fila.id };
  const originalEnviada = actaCopia.status === "ENVIADA" || actaCopia.status === "OPTIMA";
  const copiaRechazada = !originalEnviada && !!actaCopia.rechazo;
  actaCopia.status = copiaRechazada ? "RECHAZADA" : "DUPLICADA";
  if (actaCopia.diagnostico) {
    actaCopia.diagnostico.status = actaCopia.status;
    // e66 (P3.4) — esperaMs PROPIO de la fila duplicada (t0 − agregadaEn),
    // NO el heredado de la original: la media de espera del informe ya no
    // cuenta la espera de la original DOS veces. ≥ 0 defensivo (D57 T1).
    if (actaCopia.diagnostico.tiempos) {
      actaCopia.diagnostico.tiempos.esperaMs = Math.max(0, t0 - fila.agregadaEn);
      // e72 — TIEMPOS PROPIOS de la copia (criterio del mantenedor: el segundo
      // del mismo archivo NO debe mostrar OCR): totalMs = la copia en sí
      // («casi 0» — la espera vive en esperaMs de arriba; totalMs jamás
      // incluye espera, contrato del informe) y ocrMs = 0 EXPLÍCITO (la
      // copia JAMÁS paga OCR — guard e72). El resto (procesoMs/calidadMs…)
      // queda heredado: describe el pipeline que produjo el desenlace
      // copiado (nulls jamás inventados).
      actaCopia.diagnostico.tiempos.totalMs = Date.now() - tCopia;
      actaCopia.diagnostico.tiempos.ocrMs = 0;
    }
  }
  actaCopia.enviadoAutomaticamente = null;
  // e63k (F1.4): derivar la serie del acta COPIADA (la gemela ES el mismo
  // papel — misma identidad). El mapa de identidad de futuras filas
  // también cubre gemelas copiadas.
  const serieCopia = identidadDeActa(actaCopia)?.serie ?? null;
  return { actaCopia, serieCopia };
}

/** D41 — construye el registro LISTA de la copia: las fotos del original
 *  viajan como BLOBS (nunca dataURLs — hoy las dataURLs materializadas del
 *  acta original re-entraban a compactarRegistro (atob de 2-16 MB) para
 *  volver a ser Blobs. Neto byte-idéntico: compactarRegistro sigue aplicando
 *  el cleanup §3 (DUPLICADA → fotoOriginalBlob fuera) y los registros
 *  legacy pre-e68 (dataURLs dentro del actaOrigen) se compactan igual al
 *  guardar). */
function construirRegistroCopia(
  registro: RegistroMasiva,
  original: RegistroMasiva,
  actaCopia: Acta,
  fila: FilaMasiva,
  serieCopia: string | null,
): RegistroMasiva {
  return {
    ...registro,
    estado: "LISTA",
    acta: actaCopia,
    thumb: original.thumb,
    // D59 — KIT e14-info-acta-filas-v1 (T2): la gemela ES el mismo acta →
    // mismo título (honesto — copia el desenlace, copia la info).
    infoTitulo: tituloDeActa(actaCopia),
    hashDedup: registro.hashDedup,
    // acotado por el guard del caller (reutilizarResultadoCritica: sin dupOf
    // NO hay copia — misma estrechura que el `if (!fila.dupOf) return false`)
    dupOf: fila.dupOf!,
    serie: serieCopia, // e63k — identidad de la copia (null = sin consenso, honesto)
    ...(original.fotoOriginalBlob
      ? { fotoOriginalBlob: original.fotoOriginalBlob }
      : {}),
    ...(original.fotoProcesadaBlob
      ? { fotoProcesadaBlob: original.fotoProcesadaBlob }
      : {}),
  };
}

/** Estampa la copia en la bandeja (marcarFila) + la métrica del turno de la
 *  copia (D34/D44-R3 — observadores pasivos, cero decisiones). */
function estamparFilaCopiada(
  fila: FilaMasiva,
  registro: RegistroMasiva,
  actaCopia: Acta,
  original: RegistroMasiva,
  serieCopia: string | null,
  t0: number,
): void {
  const ms = Date.now() - t0;
  logger.info(
    `[e14] dedup fila=${fila.id} dupOf=${fila.dupOf} reutiliza status=${actaCopia.status} score=${actaCopia.score ?? "-"} ms=${ms}`,
  );
  marcarFila(fila.id, {
    estado: "LISTA",
    statusActa: actaCopia.status, // e66 — DUPLICADA (ya no ENVIADA heredada)
    score: actaCopia.score,
    nivel: actaCopia.clasificacion?.nivel ?? null,
    pagina: paginaDeActa(actaCopia),
    infoTitulo: tituloDeActa(actaCopia), // D59 — KIT e14-info-acta-filas-v1 (T2)
    motivo: actaCopia.rechazo?.tipo ?? null,
    thumb: original.thumb,
    // e66 — DUPLICADA jamás es envío propio (plan P2): enviadaAuto=false
    // explícito — el ÚNICO productor de enviadaAuto=true sigue siendo el
    // desenlace real del pipeline (actaDesenlace, línea de abajo).
    enviadaAuto: false,
    envioEnCola: actaCopia.hashSha256 === "EN COLA",
    serie: serieCopia, // e63k — el mapa de identidad cubre gemelas copiadas
    error: null,
  });
  // D34 — métricas: la COPIA jamás pagó pipeline (guard e72) — totalMs
  // propio ≈0 y ocrMs=0 EXPLÍCITO como datos reales; etapas heredadas
  // quedan FUERA (no son trabajo de esta fila).
  registrarMetricaCopia({
    filaId: fila.id,
    nombre: fila.nombre,
    status: actaCopia.status,
    score: actaCopia.score,
    totalMs: actaCopia.diagnostico?.tiempos?.totalMs ?? null,
    esperaMs: actaCopia.diagnostico?.tiempos?.esperaMs ?? null,
    ocrMs: actaCopia.diagnostico?.tiempos?.ocrMs,
    dedup: registro.dedup,
    tsInicio: t0, // D44-R3 — el turno de la copia también es turno (solape)
  });
}

/** Sección crítica de reutilizarResultado (dentro del mutex — e71 Opt-3). */
async function reutilizarResultadoCritica(fila: FilaMasiva, t0: number): Promise<boolean> {
  if (!fila.dupOf) return false;
  // e72 — reloj de la COPIA en sí (lecturas+writes+thumb): alimenta el
  // totalMs PROPIO de la copia (abajo) — el duplicado muestra SU consumo en
  // el informe, no el del original (criterio del mantenedor e72).
  const tCopia = Date.now();
  try {
    // D41 — lecturas RAW: la copia no consume dataURLs del acta (las fotos
    // viajan como Blobs del original — abajo); el par materializar↔compactar
    // (FileReader + atob de 2-16 MB por registro, main thread) se elimina de
    // la marca de dedup MÁS frecuente del pipeline.
    const [registro, original] = await Promise.all([
      leerRegistroRaw(fila.id),
      leerRegistroRaw(fila.dupOf),
    ]);
    const actaOrigen = original.acta;
    if (!actaOrigen) return false; // original sin desenlace (ERROR/en vuelo)
    if (!storeMasiva().getState().filas.some((f) => f.id === fila.id)) return false;
    const { actaCopia, serieCopia } = derivarActaCopia(actaOrigen, fila, t0, tCopia);
    const registroListo = construirRegistroCopia(registro, original, actaCopia, fila, serieCopia);
    await guardarRegistro(registroListo);
    estamparFilaCopiada(fila, registro, actaCopia, original, serieCopia, t0);
    // e66 (D-e66-2) — REVERSA de e65b T-3b (mandato del plan P2): la gemela
    // REUTILIZADA ya NO alimenta el LEDGER histórico (el historial registra
    // SOLO envíos reales). Re-encolado de la gemela sigue protegido: su
    // payload-QR es el MISMO de la original (igualdad EXACTA, capa 0) y su
    // dhash cae dentro de la cinta cierta de la ENTRADA ya registrada de la
    // original (≤ 6) → YA-ENVIADA igual, cero re-OCR.
    return true;
  } catch {
    return false; // original fuera de la cola / IDB caído → reprocesa completo
  }
}
