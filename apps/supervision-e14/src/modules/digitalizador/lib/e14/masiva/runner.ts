"use client";

/**
 * KIT e14-carga-masiva-v1 (T2): motor SECUENCIAL del módulo MASIVA — UNA
 * foto a la vez, SIEMPRE. Por qué secuencial y no en paralelo: el OCR es
 * wasm mono-hilo (GH Pages sin SAB — AUDITORIA §2); dos OCR en paralelo se
 * reparten el mismo CPU → NO hay ganancia y la UI sí sufre. Secuencial =
 * throughput máximo real (~1 acta / 15-18 s → 100 actas ≈ 25-30 min).
 *
 * REGLA DE ORO (kit §0): llama getBridge().escanearActa(...) igual que la
 * app normal — MISMO pipeline, MISMO gate, MISMO desenlace. Nunca escribe
 * actaActual, nunca navega vistas, NUNCA simula. La orquestación vive aquí;
 * el store del flujo normal solo ve las 3 acciones de integración (T3).
 *
 * R-26 (H-18, auditoría 2026-11-16 · decisión D-2 del plan 2026-11): este
 * archivo dejó de ser el orquestador-dios de 2.883 líneas — las TRES fases
 * grandes del pipeline (capa-0 QR · pipeline de intentos · desenlace) viven
 * en ./fases/ como stages propios con el contexto tipado compartido de
 * ./fases/contexto.ts; AQUÍ quedan el prólogo (rama DUPLICADA + precalor),
 * los stages 4-5 (envío · persistencia+métricas), el ÚNICO try/catch/finally
 * (jamás tumbar la cola) y el bucle del pool. Comportamiento byte-idéntico
 * (caracterización masiva-caracterizacion.test.ts — anclas re-posicionadas).
 */
import { getBridge } from "../get-bridge";
import { joinDeActa, useE14Store } from "@/modules/digitalizador/store/store-e14";
import { guardarRegistro, leerRegistroRaw } from "./cola";
import {
  enviadaPorPayload, // e65b — KIT e65b-historico-enviadas-v1 (T-4): capa 0 contra el histórico
  marcarYaEnviada, // e65b (T-4): marca YA-ENVIADA vía "payload" (exportada en T-2d)
  registrarEnviadaHistorico, // e65b — KIT e65b-historico-enviadas-v1 (T-3): hooks de envío
} from "./store";
// R8 — SPLIT del store (etapa 2): el runner ya NO importa useMasivaStore —
// consume el mini-store por INYECCIÓN (store.ts → cablearStoreMasiva; fin
// del ciclo store↔runner↔precalor). El resto de helpers del store sigue
// importándose de ./store hasta su propio split (dedup-marcas/dedup-índice).
import { storeMasiva } from "./store-api";
// WAVE3 §A.3 — ORDEN-WAVE3-remoto-rescate-obs-v1: cliente del ledger REMOTO
// (módulo aparte con inyección de fetch — cero fetch suelto en runner).
import {
  consultarEnvioRemoto,
  origenActual,
  registrarEnvioRemoto,
  sha256HexDeTexto,
} from "./ledger-remoto";
// §G.2 — ORDEN-WAVE3-add-envio-individual-v1: la red del momento del envío
// (parche D61 — envioRedTipo/envioDownlinkMbps junto al envioMs existente).
import { redActual } from "../obs/dispositivo";
import { paginaDeActa, tituloDeActa, type FilaMasiva, type RegistroMasiva } from "./tipos";
import type { Acta } from "../types";
// SPLIT C1 (refactor/runner-logger-v1 — movimiento puro) + R-26 (H-18,
// auditoría 2026-11-16 · decisión D-2): la infra del orquestador vive en
// runner-*.ts y las TRES fases grandes del pipeline en ./fases/ (imports
// UNIDIRECCIONALES — nadie importa al runner; detalle en
// docs/REPORTE-runner-logger-v1.md). Anclas QA: bucle del pool, bloque
// re-chequeo/aparcado del dedup y iniciar/pausar/rearrancar PERMANECEN
// aquí; las de las fases (WATCHDOG_*_MS, RELECTURA_TOPE_MS,
// mutexDedup/conExclusionMutua, reutilizarResultado*, bloque capa-0,
// relectura conTope, [e14] watchdog/origen/decode-maestro/dedup-identidad)
// se movieron VERBATIM a ./fases/* y la caracterización §E las
// re-posicionó ahí (comportamiento congelado INTACTO — solo su ubicación).
import { hacerThumb } from "./runner-thumbs";
import { esperarDesenlaceOriginal } from "./runner-dedup";
import { marcarFila, vidaDe, vidas } from "./runner-vida";
// D34 — KIT e14-metricas-corrida-v1: observador PASIVO de tiempos por acta
// (corrida inicia/fin + desenlace LISTA/ERROR + copia) — fire-and-forget,
// el pipeline NUNCA cambia por esto (metricas.ts §0).
import {
  cerrarCorridaMetrica,
  iniciarCorridaMetrica,
  registrarMetricaDesenlace,
  registrarMetricaEnvioRound, // D45 — la publicación al monitor aterrizó (re-put idempotente)
  registrarMetricaError,
} from "./metricas";
import { logger } from "../../logger";
// D66 — KIT e14-decode-unico-precalor-v1: prefetch RE-APUNTADO (D61) — el
// runner asegura el master de la próxima fila vía el precalor y consume el
// de la actual ANTES de marcar PROCESANDO (consumirMaestro — procesarUno).
import { asegurarMaestro, consumirMaestro } from "./precalor";
// KIT e14-gama-adaptativa-v1 (D74) — capa adaptativa de gama: el tier BAJO/
// MEDIO detectado aplica SOLO presupuestos de recursos (pool/watchdog/QR);
// el override manual del mantenedor manda y el flag masivaAdaptativoGama=false
// vuelve todo byte-idéntico a hoy.
import { flagsMasivaEfectivos } from "../gama";
import { leerFlags } from "../flags";
// R8 — re-apuntado directo al módulo canónico (fin del re-export temporal
// de R7b: identidad-qr ya no re-exporta qrCorto).
import { qrCorto } from "../qr-zxing";
// ─── R-26 (H-18 · D-2) — LAS TRES FASES GRANDES extraídas del ───────────────
// orquestador-dios (2.883 líneas → runner ORQUESTADOR): el contexto tipado
// compartido (CtxProcesarUno y familia + mutex + trazasPostMortemDe +
// reutilizarResultado + motivoCorto + proximaFilaPendiente) vive en
// ./fases/contexto.ts; los stages 1-3 en sus módulos propios. Los stages
// 4-5 (envío, persistencia+métricas) y el prólogo/catch/finally quedan
// AQUÍ — procesarUno los compone en orden (ver abajo).
import { faseCapa0Qr } from "./fases/fase-capa0-qr";
import {
  fasePipelineIntentos,
  reiniciarRescatesDeCorrida,
} from "./fases/fase-pipeline-intentos";
import { faseDesenlace } from "./fases/fase-desenlace";
import {
  motivoCorto,
  proximaFilaPendiente,
  reutilizarResultado,
  trazasPostMortemDe,
  type CtxPostDesenlace,
  type CtxProcesarUno,
  type DesenlaceStage,
  type SalidaFaseEnvio,
} from "./fases/contexto";

let corriendoFlag = false;
let stopFlag = false;
// e71 (Opt-3): el throttle del progreso pasa a POR-FILA (campo ultimoEn de
// VidaFila) — con 2 actas en vuelo cada una lleva SU cadencia de 250 ms.
// e63g FASE 1: ¿el mantenedor arrancó la cola ALGUNA VEZ en esta sesión? El
// re-arranque tras el swap temp→id solo procede en sesión viva (D45
// intacto: encolar en sesión fría JAMÁS procesa por sí solo).
let colaSesionIniciada = false;

// ─── e71 (Opt-3) — PARALELISMO + EXCLUSIÓN MUTUA (kit e71-consolidación) ───
/** Actas EN VUELO simultáneas. HISTORIA: e71 nació con 2 (benchmark del
 *  mantenedor); D31 — KIT e14-carril-qr-paralelo-v1 — baja el DEFAULT a 1: el
 *  OCR es wasm mono-hilo (GH Pages sin SAB — AUDITORIA §2), dos OCR en
 *  paralelo se reparten el mismo CPU → NO hay ganancia y la UI sí sufre
 *  (cabecera de este archivo). El slot liberado lo ocupa el CARRIL QR del
 *  prescan (prescanYIniciar — Fase 3 ANTES que Fase 1+2): mientras UNA acta
 *  paga su OCR completa, el prescan lee el QR del RESTO de la cola y marca
 *  DUPLICADA/YA-ENVIADA temprano — esas filas jamás llegan a pagar OCR.
 *  El override manual del mantenedor (e14-flags-overrides / flags.json
 *  `poolWorkers: 2`) restaura el pool doble de e71 byte-idéntico.
 *  KIT e14-gama-adaptativa-v1 (D74): el valor es EFECTIVO y se lee POR
 *  CORRIDA en bucle() (antes const de módulo — el plan puede refrescarse
 *  al montar MASIVA): en gama BAJO adaptativa baja a 1 — ídem arriba. El
 *  override manual del mantenedor MANDA (flagsMasivaEfectivos no pisa claves de
 *  e14-flags-overrides). */
function procesamientoConcurrenteEfectivo(): 1 | 2 {
  return flagsMasivaEfectivos().poolWorkers;
}

/** Filas RESERVADAS por el pool: nace ANTES de disparar el pipeline y
 *  muere en el finally del vuelo — cierra la ventana entre
 *  siguientePendiente() y el marcarFila(PROCESANDO) de procesarUno (sin
 *  reserva, el segundo worker tomaría la MISMA fila). */
const reservadas = new Set<string>();

// ─── C5 — DUPLICADAS APARCADAS (espera del dedup sin bloquear el pool) ────
// La rama DUPLICADA de procesarUno APARCA una copiable cuya original NO va
// delante en la FIFO (guard agregadaEn — ver el bloque C5 allí): el id entra
// AQUÍ y siguientePendiente lo salta (el slot del pool queda LIBERADO). El
// FIN DE LA OLA (bucle) RE-VISITA las aparcadas: copia si la original
// aterrizó durante la ola, o fallback honesto a PENDIENTE (reproceso) —
// cada aparcada se resuelve UNA vez (jamás reaparca: sin bucles). El set
// muere en esa re-visita; si la ola muere antes (pausa), la próxima ola (o
// rearrancarTrasEncolar) la re-visita igual.
const dedupAparcadas = new Set<string>();

/** Reset SOLO-TEST (masiva-caracterizacion.test.ts) — knip tiene los
 *  *.test.ts como entry (cero export muerto; mismo precedente de
 *  historico.__resetIndicePayloadParaTest). */
export function __resetAparcadasDedupParaTest(): void {
  dedupAparcadas.clear();
}

/** C-14 (plan 2026-11-11) — IDs EN VUELO del runner: la reserva nace ANTES
 *  del pipeline y muere en el finally del vuelo, así que un id presente aquí
 *  está genuinamente PROCESANDO en ESTA sesión. La restauración del store
 *  (`cargarFilas → recuperarCola`) lo consume para distinguir «procesando
 *  vivo» de «zombi de una caída» — sin este guard, re-montar la vista MASIVA
 *  a mitad de OCR re-armaba la fila a PENDIENTE 0 % (el rearme del informe).
 *  Snapshot barato y SIN acceso de escritura: el caller jamás muta el set. */
export function idsEnVuelo(): Set<string> {
  return new Set(reservadas);
}

/** Siguiente PENDIENTE o DUPLICADA (FIFO por agregadaEn) — el ORDEN vive en
 *  las filas livianas (mini-store), los DATOS viven en IDB (leerRegistro
 *  uno-a-uno). Las filas temporales (copia a IDB aún en vuelo — «GUARDANDO
 *  N…») se saltan: su id real llega al resolver agregarLote y el loop las
 *  toma en la siguiente pasada. KIT e14-masiva-tiempos-v1 (PR-1): las
 *  DUPLICADAS ENTRAN al loop — su procesamiento es la copia rápida (<1 s).
 *  e65-dedup-enviadas-v1 (T-5, D-e65-7): YA-ENVIADA JAMÁS entra — es
 *  SOLO-VISUAL (sin acta propia, sin envío): el filtro de abajo solo toma
 *  PENDIENTE/DUPLICADA, verificación del kit (cero código de runner). */
export function siguientePendiente(): FilaMasiva | null {
  const pendientes = storeMasiva()
    .getState()
    .filas.filter(
      (f) =>
        (f.estado === "PENDIENTE" || f.estado === "DUPLICADA") &&
        !f.id.startsWith("masiva-temp-") &&
        // e71 (Opt-3): una fila RESERVADA por otro worker del pool jamás
        // se toma dos veces (la reserva nace ANTES del pipeline y muere en
        // el finally del vuelo).
        !reservadas.has(f.id) &&
        // C5: las APARCADAS (original detrás en FIFO) no se toman — su
        // slot quedó liberado; el FIN DE LA OLA las re-visita.
        !dedupAparcadas.has(f.id),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn);
  return pendientes[0] ?? null;
}

// ─── R8 · STAGE 4/5 — faseEnvio (H1 · WAVE3 §A.3 · H2 · D61) ────────────────
/** ENVÍO del desenlace: veto ya-enviada POST-OCR (H1 — ledger local) → veto
 *  REMOTO (WAVE3 §A.3 — SHA-256 del payload, jamás el payload) → envío propio
 *  (registrarEnvioMasiva + métrica del roundtrip D45 + acta ENVIADA) → H2
 *  ledger de enviadas (llaves FRESCAS de la fila) → registro remoto
 *  fire-and-forget → parche D61 del diagnóstico (envioMs/remotoMs/red).
 *  Los vetos salen como resuelto:true (sin envío — el OCR pagado es costo
 *  hundido); cualquier throw cae al MISMO catch de procesarUno (jamás tumba
 *  la cola). Función PURA salvo los efectos de siempre (store/IDB/ledger/
 *  logger): recibe ctx y devuelve ctx nuevo — jamás muta el que recibe. */
async function faseEnvio(ctx: CtxPostDesenlace): Promise<SalidaFaseEnvio> {
  const fila = ctx.fila;
  const registro = ctx.registro;
  const actaDesenlace = ctx.actaDesenlace;
  const qrPayload = ctx.qrPayload;
  const identidad = ctx.identidad;
  // (bloque movido VERBATIM de procesarUno — mismo orden, mismos literales)
    // Desenlace → la MISMA vía que el flujo normal (T3.3/T3.2). El envío
    // automático reutiliza registrarEnvio (historial + completadas + hueco
    // archivado + cola offline); el resto cae al contador T5 con las
    // MISMAS claves.
    let actaFinal = actaDesenlace;
    let enviadaAuto = false;
    // D61 — KIT e14-tiempos-ocultos-v1 (T3): coste del ENVÍO del desenlace —
    // registrarEnvioMasiva (hash + historial + completadas + hueco archivado +
    // cola offline; la sección síncrona del envío). SOLO hay envío real ONLINE:
    // offline/EN COLA y no-OPTIMA → campo OMITIDO (jamás 0 falso — kit §2-T3).
    let envioMs: number | null = null;
    // WAVE3 G.5 — latencia del CHECK remoto (ledger D1 — §A.3). Estampa en
    // el MISMO parche D61 (viaja solo en envíos online — mismos nulls
    // honestos: sin check → omitido, jamás inventar).
    let remotoMs: number | null = null;
    // KIT auto-envio-umbral-v1 — palanca del mantenedor (flag autoEnvioUmbral):
    // · "optima" (default) = SOLO OPTIMA se autoenvía — byte-idéntico a hoy.
    // · "advertencia" = el auto-envío se EXTIENDE a ADVERTENCIA (6.5-7.9) con
    //   clasificación AUTO (ruta divipol completa ≥ 0.82 + mesa + tipo): el
    //   MISMO requisito que joinDeActa (publicarDesdeActa) ya exige para
    //   aterrizar en el monitor — una ADVERTENCIA sin AUTO cae al contador de
    //   motivos como siempre. TODA la maquinaria de vetos de abajo (H1
    //   ledger, remoto WAVE3, dedup) corre IDÉNTICA para ambos umbrales.
    // G5 (mantenedor, 2026-11-11): sin join DIVIPOL completo no hay envío — la
    // misma regla que publicarDesdeActa ya aplica al monitor. Evita marcar
    // ENVIADA un acta real sin clasificación.
    const enviableAuto =
      joinDeActa(actaDesenlace) !== null &&
      (actaDesenlace.status === "OPTIMA" ||
        (leerFlags().autoEnvioUmbral === "advertencia" &&
          actaDesenlace.status === "ADVERTENCIA" &&
          actaDesenlace.clasificacion?.nivel === "AUTO"));
    if (enviableAuto) {
      // HOTFIX H1 (fix/ya-enviada-veto-postocr-v1) — veto ya-enviada POST-OCR:
      // si el payload del QR (presente en el desenlace) ya pertenece a una
      // ENVIADA del histórico, el envío JAMÁS sale. La capa 0 consulta el
      // ledger pre-OCR (L543-562) pero SOLO en la rama sin original de sesión
      // (`if (!originalQr)`) — las rutas que llegan aquí CON payload en mano
      // (fallback de reutilizarResultado=false, original PENDIENTE/ERROR,
      // techo-vencido de la APLAZADA) hoy envían sin volver a consultar.
      // ADAPTACIÓN al árbol real (el kit cita `diag.qrPayload` — el bridge
      // OMITE qrCam en masiva, scanner-core-bridge L1156): las fuentes reales
      // del payload en el punto de envío son la capa 0 de ESTA corrida
      // (qrPayload local), el acta (futuro-proof — undefined hoy en masiva) y
      // el registro (payload persistido por una pasada previa del MISMO
      // registro — ERROR/DUPLICADA reprocesada). MISMA llave exacta y
      // maquinaria de capa0-qr (marcarYaEnviada via "payload") — RED LINES:
      // sin fuzzy. Índice caído → null conservador (RL-e65b-3): la fila sigue
      // su curso como hoy. forzarDedupOff manda SIEMPRE (RL-e65b-6 — el
      // escape del mantenedor es sagrado, mismas capas L543/L580).
      const diagQr =
        qrPayload ?? actaDesenlace.qrPayload ?? registro.qrPayload ?? null;
      if (diagQr && !fila.forzarDedupOff) {
        const enviadaPostOcr = await enviadaPorPayload(diagQr);
        if (enviadaPostOcr && enviadaPostOcr.id !== fila.id) {
          if (
            await marcarYaEnviada(
              fila.id,
              enviadaPostOcr.id,
              "payload",
              undefined,
              undefined,
              diagQr,
              true,
              "ya-enviada-postocr", // WAVE3 C.2 — puerta del veto AL FINAL (D57): distingue el veto post-OCR (OCR ya pagado)
            )
          ) {
            logger.info(
              `[e14] veto ya-enviada post-ocr ${qrCorto(diagQr)} fila=${fila.id} hist=${enviadaPostOcr.id}`,
            );
            // sin envío — el OCR pagado es costo hundido (caso raro)
            return { resuelto: true, ctx };
          }
        }
      }
      // WAVE3 §A.3 — veto ya-enviada REMOTO (ledger D1 en Cloudflare — la
      // garantía definitiva vive FUERA del navegador): el gap real del lote
      // 9 fue doble envío tras borrar IndexedDB + cambiar de origen. El
      // check SOLO usa el SHA-256 del payload (privacidad dura — jamás el
      // payload). MISMO escape del mantenedor: forzarDedupOff salta TAMBIÉN el
      // remoto (RL-e65b-6). Timeout 3 s / fallo → continuar como hoy
      // (doctrina del conservador: el remoto es una red EXTRA, jamás una
      // dependencia). El marcado fallido (IDB caído) también continúa.
      if (diagQr && !fila.forzarDedupOff) {
        const payloadHashRemoto = await sha256HexDeTexto(diagQr);
        if (payloadHashRemoto) {
          const tRemoto = Date.now();
          const remoto = await consultarEnvioRemoto(payloadHashRemoto);
          remotoMs = Date.now() - tRemoto;
          if (remoto && remoto.duplicado) {
            const marcadoRemoto = await marcarYaEnviada(
              fila.id,
              remoto.filaOriginal ?? "remoto",
              "payload-remoto", // WAVE3 §A.3/D57 — valor NUEVO AL FINAL
              undefined,
              undefined,
              diagQr,
              true,
            );
            if (marcadoRemoto) {
              logger.info(
                `[e14] veto ya-enviada REMOTO ${qrCorto(diagQr)} fila=${fila.id} remoto=${remoto.filaOriginal ?? "?"}`,
              );
              // sin envío — igual que H1 (costo OCR hundido)
              return { resuelto: true, ctx };
            }
          } else if (remoto === null) {
            logger.info("[e14] ledger remoto indisponible — continúo");
          }
        }
      }
      // KIT e14-masiva-ux-v1 (T3.2): el envío respeta la conexión del momento
      // (misma semántica que registrarEnvio para actaActual): OFFLINE →
      // hashSha256 "EN COLA" — la fila pinta «EN COLA» y refrescarEnviosTrasDrenaje
      // la drena al reconectar. Online → el hash lo maneja el flujo normal.
      const onlineAlEnviar = useE14Store.getState().online;
      const tEnvio = onlineAlEnviar ? performance.now() : 0;
      useE14Store.getState().registrarEnvioMasiva(actaDesenlace, (pub) => {
        // D45 — KIT e14-medicion-faltante-v1: la PUBLICACIÓN al monitor
        // aterrizó — este es el roundtrip REAL de red (envioMs de D61 solo
        // medía la sección síncrona, ≈1 ms). Observador pasivo: re-put
        // idempotente de la métrica (llega DESPUÉS del desenlace — fire-
        // and-forget, jamás bloquea ni tumba nada — RL-e65b-3).
        registrarMetricaEnvioRound({
          filaId: fila.id,
          envioRoundMs: pub.ms,
          envioEstado: pub.estado,
        });
      });
      actaFinal = {
        ...actaDesenlace, // e63f F2: el desenlace POST re-lectura manda (si AUTO → clasificación nueva viaja al envío)
        status: "ENVIADA",
        enviadoAutomaticamente: getBridge().horaEnvio(),
        ...(onlineAlEnviar ? {} : { hashSha256: "EN COLA" }),
      };
      enviadaAuto = true;
      // e65b (T-3a): el envío propio alimenta el LEDGER (historico.ts —
      // sobrevive vaciar/recargas, D-e65b-1) — fire-and-forget, jamás
      // bloquea ni tumba el envío (RL-e65b-2/3). El payload/serie VIVOS de
      // ESTA corrida mandan sobre los del registro leído (la capa 0 acaba
      // de decodificar el QR y la capa 2 la serie).
      // HOTFIX H2 (fix/ya-enviada-veto-postocr-v1) — el ledger lleva las
      // llaves FRESCAS de la fila: `registro` se leyó al ENTRAR al pipeline
      // (L427) y cadenaDedup persiste hashDedup/hashBytes DESPUÉS (carrera
      // ingesta×pipeline — el valor del snapshot viaja undefined). La fila
      // viva del store lleva lo que cadenaDedup estampó (guardarRegistro +
      // patchFila de la cadena). Sin estos campos el cinturón
      // dhash-vs-histórico D-e65-6 SALTA la entrada del índice
      // (`if (!h.hashDedup ...) continue`) — caso imagen10: una copia
      // re-saved a Hamming 0 de una enviada no era atrapada en ingesta.
      // Sin campos nuevos: completar la escritura de campos ya declarados
      // (EntradaHistorica.hashDedup/hashBytes — mismo contrato del índice).
      const filaViva = storeMasiva().getState().filas.find(
        (f) => f.id === fila.id,
      );
      void registrarEnviadaHistorico({
        id: fila.id,
        ts: Date.now(),
        hashBytes: filaViva?.hashBytes ?? registro.hashBytes,
        hashDedup: filaViva?.hashDedup ?? registro.hashDedup,
        payloadQr: qrPayload ?? undefined,
        serie: identidad?.serie ?? registro.serie ?? undefined,
      }).catch(() => {}); // fire-and-forget — jamás bloquea ni tumba el envío (RL-e65b-3)
      // WAVE3 §A.3 — registro REMOTO tras el envío local exitoso (junto al
      // H2, MISMA disciplina RL-e65b-3: fire-and-forget). Dirección del
      // riesgo asumida y documentada (kit §1): registrar DESPUÉS del envío —
      // un duplicado es detectable; un acta perdida no. SOLO online (offline
      // → el registro nace en refrescarEnviosTrasDrenaje). forzarDedupOff
      // salta TAMBIÉN el remoto (RL-e65b-6 — el escape del mantenedor manda).
      if (diagQr && onlineAlEnviar && !fila.forzarDedupOff) {
        const payloadRegistro = diagQr;
        const serieRegistro = identidad?.serie ?? registro.serie ?? undefined;
        const filaRegistro = fila.id;
        void (async () => {
          const payloadHash = await sha256HexDeTexto(payloadRegistro);
          if (!payloadHash) return; // sin crypto — sin registro (conservador)
          await registrarEnvioRemoto({
            payloadHash,
            serie: serieRegistro,
            filaId: filaRegistro,
            origenUrl: origenActual() ?? undefined,
          });
        })().catch(() => {});
      }
      if (onlineAlEnviar) envioMs = Math.round(performance.now() - tEnvio);
    } else {
      useE14Store.getState().contarMotivoNoEnvioActa(actaDesenlace);
    }
    // D61 (T3): parche INMUTABLE del diagnóstico con envioMs — MISMO patrón
    // del parche esperaMs de D57 (spread, solo si diagnostico != null). Va
    // ANTES de construir registroListo → viaja en la PRIMERA persistencia.
    if (envioMs != null && actaFinal.diagnostico != null) {
      // §G.2 — ORDEN-WAVE3-add-envio-individual-v1: la red del momento del
      // envío viaja JUNTO al envioMs D61 (mismo parche inmutable — mismos
      // nulls honestos: sin navigator.connection → null, jamás inventar).
      // WAVE3 G.5 — remotoMs (latencia del check del ledger) viaja en el
      // MISMO parche cuando el check corrió (omitido si no — jamás inventar).
      const redEnvio = redActual();
      actaFinal = {
        ...actaFinal,
        diagnostico: {
          ...actaFinal.diagnostico,
          tiempos: {
            ...actaFinal.diagnostico.tiempos,
            envioMs,
            ...(remotoMs != null ? { remotoMs } : {}),
          },
          envioRedTipo: redEnvio?.tipo ?? null,
          envioDownlinkMbps: redEnvio?.downlinkMbps ?? null,
        },
      };
    }
    return { resuelto: false, ctx: { ...ctx, actaFinal, enviadaAuto } };
}

// ─── R8 · STAGE 5/5 — fasePersistYMetrica (D35 · D59 · M14 · D61-T3 · D34) ──
/** PERSISTENCIA + MÉTRICAS del desenlace: thumb de la bandeja (D35) →
 *  registroListo (LISTA — con las trazas post-mortem del PUNTO ÚNICO
 *  trazasPostMortemDe) → persistencia con fallback liviano (FIX M14 — la fila
 *  JAMÁS pasa a ERROR tras un envío) + re-save del instrumento persistMs
 *  (D61-T3) → marcarFila LISTA → métrica del desenlace (D34, observador
 *  pasivo). Cualquier throw cae al MISMO catch de procesarUno (fila ERROR —
 *  la cola jamás se tumba). Función PURA salvo los efectos de siempre
 *  (store/IDB/métricas): recibe ctx y devuelve ctx nuevo — jamás muta el que
 *  recibe. */
async function fasePersistYMetrica(
  ctx: CtxPostDesenlace & { actaFinal: Acta },
): Promise<DesenlaceStage> {
  const fila = ctx.fila;
  const registro = ctx.registro;
  const actaParcheada = ctx.actaParcheada;
  const actaFinal = ctx.actaFinal;
  const enviadaAuto = ctx.enviadaAuto;
  const actaDesenlace = ctx.actaDesenlace;
  const identidad = ctx.identidad;
  const falsoPositivoEvitado = ctx.falsoPositivoEvitado;
  const relecturaDesenlace = ctx.relecturaDesenlace;
  const maestroDesenlace = ctx.maestroDesenlace;
  const decodeMasterMs = ctx.decodeMasterMs;
  const intentoDesenlace = ctx.intentoDesenlace;
  const entradaPrecalor = ctx.entradaPrecalor;
  const preOcrMs = ctx.preOcrMs;
  const preOcrQrMs = ctx.preOcrQrMs;
  const preOcrOrigenMs = ctx.preOcrOrigenMs;
  const preOcrDeskewMs = ctx.preOcrDeskewMs;
  const preOcrMasterMs = ctx.preOcrMasterMs;
  const preOcrPasadas = ctx.preOcrPasadas;
  const tsDespacho = ctx.tsDespacho;
  const qrHeredado = ctx.qrHeredado;
  // R1.2/R1.4/R1.4-b — telemetría de la capa 0 (integración remota main).
  const viaCacheNegativa = ctx.viaCacheNegativa;
  const qrTierCapa0 = ctx.qrTierCapa0;
  const qrMsCapa0 = ctx.qrMsCapa0;
  const qrFasesCapa0 = ctx.qrFasesCapa0;
  const qrFinCapa0 = ctx.qrFinCapa0;
  const qrZxingMs = ctx.qrZxingMs;
  const qrPresupuestoMsCapa0 = ctx.qrPresupuestoMsCapa0;
  // (bloque movido VERBATIM de procesarUno — mismo orden, mismos literales)
    // D35 — thumbMs: la miniatura de la bandeja es TRABAJO REAL del main
    // thread post-pipeline (decode completo + canvas + JPEG). Cronometrado
    // para decidir su destino (quitar/degradar) con datos del INFORME.
    const tThumb0 = performance.now();
    const thumb = await hacerThumb(actaParcheada.fotoProcesada ?? actaParcheada.fotoOriginal);
    const thumbMs = performance.now() - tThumb0;
    const registroListo: RegistroMasiva = {
      ...registro,
      estado: "LISTA",
      acta: actaFinal,
      thumb,
      // D59 — KIT e14-info-acta-filas-v1 (T2): título con la info reconocida
      // del desenlace REAL (persiste — desviación aditiva de thumb).
      infoTitulo: tituloDeActa(actaFinal),
      // e63k (F1.4): resolución final del FP visual evitado — "sin-match"
      // cierra la banda aplazada; dedupDistancia y dedupVisualDe quedan como
      // estaban (spread de arriba — post-mortem del falso positivo).
      ...(falsoPositivoEvitado ? { dedup: "sin-match" as const } : {}),
      // e63k (F1.4): regla general de persistencia de la serie (aplica
      // SIEMPRE que haya desenlace con identidad leída, también cuando NO
      // es dup — sirve al mapa de la cola y al informe). Ausente = sin
      // consenso (jamás inventar — RED LINE 2).
      ...(identidad ? { serie: identidad.serie } : {}),
      // D66 — KIT e14-decode-unico-precalor-v1 (T4): trazas de decodificación
      // ADITIVAS del master del DESENLACE (solo con master — sin él los
      // campos VIAJAN AUSENTES: registros previos/ERROR/fallback quedan como
      // hoy — jamás inventar). decodeMs top-level ≠ tiempos.decodeMs (D61 —
      // decode del archivo por el bridge; semánticas distintas, ambas honestas).
      ...(maestroDesenlace
        ? {
            decodeMs: decodeMasterMs ?? 0,
            origenDecode: maestroDesenlace.origenDecode,
            precalentada: intentoDesenlace === 1 && !!entradaPrecalor,
            precalorMs:
              intentoDesenlace === 1 ? (entradaPrecalor?.precalorMs ?? null) : null,
          }
        : {}),
      // e63m + D44-R2 + e64-qr T-0.2 + WAVE3 §B — trazas post-mortem del
      // registroListo (rescate "auto": salvado|lanzado por el status del
      // desenlace): PUNTO ÚNICO trazasPostMortemDe — byte-idéntico a ayer.
      ...trazasPostMortemDe(ctx, {
        heredado: true,
        rescate: "auto",
        statusDesenlace: actaDesenlace.status,
        capa0Telemetria: true,
        limpiaSinPayload: true,
      }),
    };
    // FIX M14 (auditoría 2-c): persistencia fallida TRAS el envío — la fila
    // NO pasa a ERROR (el acta SÍ se transmitió; una fila ERROR invita a
    // reprocesar → doble envío tras recarga) y el registro JAMÁS queda
    // PENDIENTE con el archivo (el reproceso automático re-enviaría).
    // Reintento MÍNIMO: estado LISTA + desenlace liviano, SIN el acta
    // completa (la causa típica del fallo es quota — el registro con acta
    // de ~15 MB no cabe; el liviano sí).
    // D61 — KIT e14-tiempos-ocultos-v1 (T3): la MISMA ventana mide ahora la
    // persistencia del desenlace (guardarRegistro principal + fallback
    // liviano — kit §2-T3): persistMs = coste REAL del write que el usuario
    // experimenta. Si ambos writes fallan, el campo se OMITE (sin dato —
    // jamás inventar).
    let persistMs: number | null = null;
    const tPersist = performance.now();
    try {
      await guardarRegistro(registroListo);
      persistMs = Math.round(performance.now() - tPersist);
    } catch {
      try {
        await guardarRegistro({ ...registro, estado: "LISTA", thumb });
        persistMs = Math.round(performance.now() - tPersist);
      } catch {
        /* IDB caída del todo — la fila vive honesta en memoria (LISTA);
           persistMs se omite (sin dato — jamás inventar). */
      }
    }
    // D61 (T3) — re-save de INSTRUMENTO (FUERA del desenlace): persistMs nace
    // DEL write que lo mide (paradoja del instrumento — no puede viajar dentro
    // de él). Con el valor ya medido, parchea el diagnóstico (patrón inmutable
    // de esperaMs) y re-persiste para que sobreviva la recarga (kit T5 — IDB).
    // Best-effort y SILENCIOSO: si falla, IDB se queda con el write 1 —
    // desenlace INTACTO (sin este campo; honesto). El liviano del fallback no
    // lleva acta → sin diagnóstico → no hay nada que parchear (omitido).
    if (persistMs != null && registroListo.acta?.diagnostico != null) {
      try {
        await guardarRegistro({
          ...registroListo,
          acta: {
            ...registroListo.acta,
            diagnostico: {
              ...registroListo.acta.diagnostico,
              tiempos: {
                ...registroListo.acta.diagnostico.tiempos,
                persistMs,
              },
            },
          },
        });
      } catch {
        /* el write 1 manda — persistMs viaja solo si este re-save cabe */
      }
    }
    marcarFila(fila.id, {
      estado: "LISTA",
      statusActa: actaFinal.status,
      score: actaFinal.score,
      nivel: actaFinal.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaFinal),
      infoTitulo: tituloDeActa(actaFinal), // D59 — KIT e14-info-acta-filas-v1 (T2)
      motivo: actaFinal.rechazo?.tipo ?? null,
      thumb,
      enviadaAuto,
      envioEnCola: actaFinal.hashSha256 === "EN COLA", // KIT e14-masiva-ux-v1 (T3.2)
      // e63f (F2): el desenlace pasó por la re-lectura interna (trazabilidad
      // — el detalle auto|sin-cambio vive en la traza RelecturaInterna=).
      relectura: relecturaDesenlace != null,
      // e63k (F1.4): serie impresa al mapa de la cola (identidad capa 2).
      serie: identidad?.serie ?? null,
      error: null,
    });
    // D34 — métricas por acta (observador pasivo — fire-and-forget): el
    // desglose de etapas YA existe en actaFinal.diagnostico.tiempos.
    registrarMetricaDesenlace({
      filaId: fila.id,
      nombre: fila.nombre,
      acta: actaFinal,
      sondeoQrMs: fila.sondeoQrMs,
      thumbMs,
      // KIT e14-etapas-preocr-v1 (D43): el muro pre-OCR sube al informe
      // (ausente si la fila jamás despachó el bridge — jamás inventar).
      ...(preOcrMs != null ? { preOcrMs } : {}),
      // KIT e14-tiempos-v2 (D44) — sub-desglose + trazas del despacho: los 4
      // sub-segmentos viajan JUNTOS cuando el muro corrió (con sus 0 reales —
      // master=0 = precalentada); qrHeredado true|false EXPLÍCITO (false =
      // pagó ladder — el dato de la palanca ①).
      ...(preOcrMs != null && preOcrQrMs != null
        ? {
            preOcrQrMs,
            preOcrOrigenMs,
            preOcrDeskewMs,
            preOcrMasterMs,
            qrHeredado,
          }
        : {}),
      // R1.2/R1.4 — trazas de la capa 0 al informe (aditivas — ausente =
      // sin dato honesto): skip por caché, tier ganador y ms del worker.
      ...(viaCacheNegativa ? { qrCacheNegativa: true } : {}),
      ...(qrTierCapa0 != null ? { qrTier: qrTierCapa0 } : {}),
      ...(qrMsCapa0 != null ? { qrMs: qrMsCapa0 } : {}),
      // R1.4-b — KIT qr-fases-telemetria-v1 (aditivos; ausente = sin dato):
      // desglose por fase + causa del fin + ms del rescate zxing de main.
      ...(qrFasesCapa0 ? { qrFases: qrFasesCapa0 } : {}),
      ...(qrFinCapa0 != null ? { qrFin: qrFinCapa0 } : {}),
      ...(qrZxingMs != null ? { qrZxingMs } : {}),
      ...(qrPresupuestoMsCapa0 != null
        ? { qrPresupuestoMs: qrPresupuestoMsCapa0 }
        : {}),
      ...(tsDespacho != null ? { tsInicio: tsDespacho } : {}),
      ...(preOcrPasadas > 1 ? { reintentosPreOcr: preOcrPasadas - 1 } : {}),
      dedup: registro?.dedup,
      // D45 — diagnóstico del dedup de ingesta (POR QUÉ sin-match): la traza
      // fresca del registroListo manda (el spread de arriba la trae de
      // cadenaDedup; el override "sin-match" de e63k solo toca `dedup`).
      ...(registroListo.dedupDetalle
        ? { dedupDetalle: registroListo.dedupDetalle }
        : {}),
    });
  return { resuelto: false, ctx };
}

/** Desenlace de UNA foto — byte a byte el pipeline real (kit §6-C: el
 *  desenlace DEBE ser idéntico al del IMPORTAR normal).
 *  D66 — KIT e14-decode-unico-precalor-v1: el pipeline recibe el MASTER
 *  (T1: un solo decodificado a escala de trabajo) — precalentado (T3.3:
 *  decode = 0 s) o recién horneado con `maestroDeImagen`; sin master →
 *  fallback HONESTO a la ruta de siempre (identidad AC-P3 intacta).
 *  WAVE2 B1: `export` SOLO-TEST (runner-rechequeo.test.ts) — el kit exige
 *  test conductual del re-chequeo post-reserva; knip tiene los *.test.ts
 *  como entry (cero export muerto). Comportamiento byte-idéntico. */
export async function procesarUno(filaEntrante: FilaMasiva): Promise<void> {
  // % global: cada acta NACE en 0 — su propio 0→100 del proceso COMPLETO
  // (reset aquí cubre TAMBIÉN el fallback de la rama DUPLICADA de abajo).
  // e71 (Opt-3): estado POR-FILA — con 2 actas en vuelo, cada una lleva su
  // propio 0→100 sin contaminarse (la limpieza vive en el finally).
  vidas.set(filaEntrante.id, {
    frac: 0,
    ocrPasada: 1,
    ocrFracPrev: 0,
    ultimoEn: 0,
  });
  // KIT e14-masiva-tiempos-v1 (PR-1): rama DEDUP — copia del resultado de la
  // original (<1 s). Si la original no sirve, la fila cae al pipeline
  // completo AQUÍ MISMO (fallback honesto — el mantenedor nunca pierde la foto).
  let fila = filaEntrante;
  // WAVE2 B1 — re-chequeo post-reserva: la referencia del snapshot puede estar
  // vieja — cadenaDedup (ingesta background FIFO) pudo marcar DUPLICADA la fila
  // entre siguientePendiente() y aquí. El duplicado JAMÁS paga probe+OCR
  // (kit e71 literal; e72: totalMs de la copia ≈ 0). Re-lectura del estado REAL
  // del store — si ya está marcada, entra por la rama de reuso de abajo.
  const filaFresca = storeMasiva()
    .getState()
    .filas.find((f) => f.id === filaEntrante.id);
  if (
    filaFresca &&
    filaFresca.estado === "DUPLICADA" &&
    fila.estado !== "DUPLICADA"
  ) {
    logger.info(
      `[e14] dedup fila=${fila.id} re-chequeo post-reserva → reuso (carrera cerrada)`,
    );
    fila = { ...fila, estado: "DUPLICADA", dupOf: filaFresca.dupOf ?? null };
  }
  if (fila.estado === "DUPLICADA") {
    marcarFila(fila.id, { estado: "PROCESANDO", error: null });
    const t0 = Date.now();
    if (await reutilizarResultado(fila, t0)) return;
    // e72 — GUARD de ingesta × pool: reutilizar falló con la original VIVA
    // pero SIN desenlace — la race del smoke del mantenedor (imagen9/imagen10
    // idénticas en un lote EN VUELO): la ingesta marcó «instantanea sha256»
    // al instante, pero el pool reservó la copia ANTES de que la original
    // aterrizara y el fallback de abajo la mandaba al REPROCESO COMPLETO
    // (32 s de OCR pagados + desenlace ENVIADA propio). Si la original está
    // EN COLA o EN VUELO → ESPERAR su desenlace (sondeo ligero, techo
    // generoso) y copiar: el duplicado JAMÁS paga OCR (kit e71 literal —
    // totalMs de la copia ≈ 0, criterio del mantenedor). QUITAR/ERROR/techo → el
    // fallback honesto de abajo queda intacto.
    //
    // C5 — GUARD agregadaEn de la espera (MISMO patrón del guard P2.1-v2 de
    // la resolución post-OCR de abajo): la original SOLO se espera si va
    // DELANTE en la FIFO (agregadaEn menor). Antes se esperaba a CUALQUIER
    // original viva: si la original estaba DETRÁS (o la cola congelada/
    // pausada — post-mortem 20261020-122235), el slot del pool quedaba
    // BLOQUEADO hasta el techo (10 min) por un desenlace que no llegaba.
    // Ahora, original copiable pero NO delante → APARCAR (abajo): la fila
    // vuelve a DUPLICADA, el slot se libera YA, la ola sigue y la aparcada
    // se RE-VISITA al terminar la ola (revisitarDuplicadaAparcada — copia si
    // la original aterrizó, o el fallback honesto de abajo). El techo de la
    // espera activa NO cambia (esperarDesenlaceOriginal, 10 min): el
    // comportamiento observable SOLO cambia en el caso patológico (original
    // detrás / cola congelada): antes slot bloqueado ×10 min; ahora slot
    // liberado al instante + re-visita al cierre de la ola.
    if (fila.dupOf) {
      const original = storeMasiva()
        .getState()
        .filas.find((f) => f.id === fila.dupOf);
      // Whitelist COPIABLE (T-5 e65 — la MISMA de esperarDesenlaceOriginal):
      // AUSENTE/ERROR/ya-enviada quedan fuera por construcción (sin acta
      // copiable no hay resolución posible — esa espera responde rápido).
      const copiable =
        original != null &&
        (original.estado === "PENDIENTE" ||
          original.estado === "PROCESANDO" ||
          original.estado === "LISTA" ||
          original.estado === "DUPLICADA");
      if (
        copiable &&
        // LISTA ya ES desenlace: si reutilizar falló arriba el registro no
        // tiene acta (IDB inconsistente) — el sondeo de la espera jamás la
        // vería llegar (estado terminal) → aparcado, no espera.
        original.estado !== "LISTA" &&
        original.agregadaEn >= fila.agregadaEn
      ) {
        // APARCAR: soltar el slot (procesarUno resuelve → el finally del
        // vuelo libera la reserva) y dejar la fila DUPLICADA en la bandeja
        // (honesto: ES una duplicada esperando a SU original).
        dedupAparcadas.add(fila.id);
        marcarFila(fila.id, { estado: "DUPLICADA", error: null });
        logger.info(
          `[e14] dedup fila=${fila.id} dupOf=${fila.dupOf} aparcada original-detras slot-liberado`,
        );
        return;
      }
      if (await esperarDesenlaceOriginal(fila.id, fila.dupOf)) {
        if (await reutilizarResultado(fila, t0)) return;
      }
    }
    // Fallback: des-marcar y reprocesar como fila normal (mismo pase).
    fila = { ...fila, estado: "PENDIENTE", dupOf: null };
    marcarFila(fila.id, { estado: "PENDIENTE", dupOf: null });
    try {
      // D41 — lectura RAW: solo spread base del re-save (sin dataURLs que
      // materializar — la fila es PENDIENTE, sin acta/fotos).
      const registro = await leerRegistroRaw(fila.id);
      await guardarRegistro({ ...registro, estado: "PENDIENTE", dupOf: undefined });
    } catch {
      /* IDB caído — la fila ya está PENDIENTE en memoria (honesto) */
    }
    logger.info(`[e14] dedup fila=${fila.id} sin-original reprocesa-completo`);
  }
  // D66 — KIT e14-decode-unico-precalor-v1 (T3.3): consumir el MASTER
  // precalentado ANTES de marcar PROCESANDO (orden crítico: el precalor
  // descarta masters de filas que dejan de ser PENDIENTE — si marcáramos
  // primero, la suscripción descartaría el master que estamos a punto de
  // consumir). decode = 0 s — el coste ya vivió en precalorMs durante la
  // espera en cola. Un master se consume UNA vez; el chip PREPARADA muere
  // con la fila al pasar a PROCESANDO.
  // D63-A2 (T0): si el pre-proceso aplicó (deskew), el master precalentado
  // NO alimenta el pipeline y la referencia se SUELTA DENTRO de
  // fasePipelineIntentos (disciplina de memoria — el blob muere YA, no al
  // fin del scope: el OCR domina con ~13 s por fila).
  const entradaPrecalor = consumirMaestro(fila.id);
  if (entradaPrecalor) {
    logger.info(
      `[e14] precalor fila=${fila.id} consumido precalorMs=${entradaPrecalor.precalorMs} origen=${entradaPrecalor.maestro.origenDecode}`,
    );
  }
  marcarFila(fila.id, { estado: "PROCESANDO", error: null, precalentada: false });
  // D65 (T3): señal de vida INICIAL — "preparando" (origen/pre-proceso van
  // primero; el bridge emite la suya apenas arranca). fracGlobal = 0: el
  // proceso del acta acaba de nacer (UN % para TODO el proceso).
  storeMasiva()
    .getState()
    .marcarProgreso(fila.id, { etapa: "preparando", fracGlobal: vidaDe(fila.id).frac });

  // ─── R8 · SPLIT — CTX inicial del pipeline (inmutable: los stages devuelven
  // ctx NUEVO; el orquestador reasigna la referencia). Creado ANTES del try:
  // el catch del post-mortem también lee las trazas (qrPayload/watchdog/…). ───
  let ctx: CtxProcesarUno = {
    fila,
    archivo: null,
    registro: null,
    esperaMs: 0,
    tsDespacho: null,
    tPreOcrIntento: 0,
    entradaPrecalor,
    qrPayload: null,
    qrEstadoCapa0: null,
    qrHeredado: false,
    preOcrQrMs: null,
    viaCacheNegativa: false,
    cacheNegativaEscrita: false,
    qrTierCapa0: null,
    qrMsCapa0: null,
    qrFasesCapa0: null,
    qrFinCapa0: null,
    qrZxingMs: null,
    qrPresupuestoMsCapa0: null,
    preOcrMs: null,
    preOcrOrigenMs: 0,
    preOcrDeskewMs: 0,
    preOcrMasterMs: 0,
    preOcrPasadas: 0,
    watchdogUsados: 0,
    etapaAlMorir: null,
    elapsedMuerteMs: null,
    rescateLanzado: false,
    veredictoOrigen: null,
    preProceso: null,
    actaBruta: null,
    maestroDesenlace: null,
    decodeMasterMs: null,
    intentoDesenlace: 0,
    actaParcheada: null,
    actaDesenlace: null,
    relecturaDesenlace: null,
    identidad: null,
    falsoPositivoEvitado: false,
    actaFinal: null,
    enviadaAuto: false,
  };
  let registro: RegistroMasiva | null = null;
  // (los espejos de trazas del post-mortem MURIERON con el stage 5/5: el
  // catch estampa desde el CTX fresco de los stages — PUNTO ÚNICO
  // trazasPostMortemDe; tsDespacho vive en ctx desde el despacho D44-R3.)
  try {
    // D41 — lectura RAW: el pipeline solo consume `archivo` y escribe el
    // desenlace NUEVO encima (el acta vieja, si existiera, se reemplaza
    // wholesale — jamás se lee su dataURL); materializar las fotos del
    // registro era FileReader de 2-16 MB por fila en el hilo UI.
    registro = await leerRegistroRaw(fila.id);
    const archivo = registro.archivo;
    // IDB clona el File original (sigue siendo File — structured clone de
    // File API). El guard honesto evita alimentar al bridge con un Blob
    // genérico (OpcionesEscaneo.archivo espera File — A5).
    if (!(archivo instanceof File)) throw new Error("ARCHIVO_FUERA_DE_LA_COLA");

    // KIT e14-masiva-tiempos-v1 (PR-2): la instancia del File de SIEMPRE —
    // base de origen/pre-proceso (D63-A/B corren sobre el ORIGINAL: EXIF y
    // márgenes viven ahí; el master es un re-encode sin EXIF).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- NO es código muerto: ancla del QA e63m (qa-qr-identidad.ts:353 grepea esta línea para «bloque capa 0 ANCLA»)
    const archivoPipeline = archivo;

    // D57 — KIT e14-instrumentos-espera-v1 (T1): espera en cola → inicio del
    // pipeline. tInicio capturado antes del PRIMER intento (kit §4-T1):
    // esperaMs = tInicio − fila.agregadaEn (≥ 0 defensivo — jamás inventar).
    // SOLO masiva lo llena (el flujo individual no tiene espera de cola).
    const tInicio = Date.now();
    const esperaMs = Math.max(0, tInicio - fila.agregadaEn);

    // ─── KIT e14-etapas-preocr-v1 (D43) — preOcrMs: el MURO entre el fin de
    // la espera de cola y el arranque del pipeline del bridge ─── Hoy es
    // INVISIBLE en el informe (esperaMs cierra AQUÍ; totalMs nace DENTRO del
    // bridge) — evidencia del informe 2026-10-30: 6-10 s/acta sin mantenedor.
    // Cronómetro OBSERVADOR PASIVO (solo medir — jamás cambia decisiones):
    // intento 1 arranca YA (incluye la capa-0 QR completa); los reintentos
    // (watchdog/rescate) re-pagan origen/deskew/master → se ACUMULAN (T1).
    // KIT e14-etapas-preocr-v1 (D43) — preOcrMs: el MURO entre el fin de la
    // espera de cola y el arranque del pipeline del bridge. Cronómetro
    // OBSERVADOR PASIVO (solo medir — jamás cambia decisiones): intento 1
    // arranca YA (incluye la capa-0 QR completa — el cronómetro vive en ctx);
    // los reintentos re-pagan origen/deskew/master → se ACUMULAN (T1).
    ctx = { ...ctx, preOcrMs: null, tPreOcrIntento: performance.now(), tsDespacho: tInicio }; // intento 1: incluye la capa-0 (T1) + despacho D44-R3

    // ─── R8 · STAGE 1/5 (split de procesarUno — misión punto 3): CAPA 0 QR ───
    // El bloque entero (decode + dedup por payload + APLAZADA + ya-enviada)
    // vive en faseCapa0Qr (./fases/fase-capa0-qr.ts — R-26) — MISMA gestión de catch: el stage corre
    // DENTRO de este try y cualquier throw cae al MISMO catch (fila ERROR,
    // la cola jamás se tumba). Los `return` del bloque (reutiliza /
    // ya-enviada-histórico) salen como resuelto:true (el finally limpia igual).
    // ctx inmutable enriquecido: el stage devuelve ctx NUEVO, nunca muta el suyo.
    const r1 = await faseCapa0Qr({ ...ctx, registro, archivo, esperaMs });
    if (r1.resuelto) return;
    ctx = r1.ctx;
    if (r1.ctx.registro) registro = r1.ctx.registro; // R1.2 — el stage re-limpió la traza qrSinPayload (el hecho cambió)
    // ─── R8 · STAGE 2/5 (split de procesarUno): PIPELINE DE INTENTOS ───
    // Origen (D63-A) + deskew (D63-B) + master (D66) + puente + watchdog (D65)
    // + rescate (WAVE3 §B) — el bucle de intentos vive en fasePipelineIntentos
    // (./fases/fase-pipeline-intentos.ts — R-26).
    // El error REAL (y cualquier throw del bucle) sale por r2.error: el stage
    // envuelve su cuerpo en try/catch para VOLCAR el ctx fresco (trazas del
    // intento que murió — watchdog/etapaAlMorir/registro re-leído) antes de
    // que el orquestador re-lanze al MISMO catch de siempre (jamás se traga).
    const r2 = await fasePipelineIntentos({ ...ctx, registro, archivo });
    if (r2.fallo) {
      // Camino del ERROR REAL: adoptar el ctx fresco (trazas del intento que
      // murió — watchdog/etapaAlMorir/registro re-leído) y re-lanzar al MISMO
      // catch de siempre, que estampa desde el ctx (PUNTO ÚNICO).
      ctx = r2.ctx;
      if (r2.ctx.registro) registro = r2.ctx.registro; // el reintento re-leyó de IDB
      throw r2.error;
    }
    ctx = r2.ctx;
    if (r2.ctx.registro) registro = r2.ctx.registro; // el reintento re-leyó de IDB
    // ─── R8 · STAGE 3/5 (split de procesarUno): DESENLACE ───
    // Parche D57 del desenlace + guard M8 + re-lectura interna (e63f) +
    // capa 2 identidad (e63k) + falso-positivo evitado + dedup por contenido
    // (e72 P2.1-v2) — el bloque vive en faseDesenlace (./fases/fase-desenlace.ts
    // — R-26). Los `return`
    // del bloque (M8/dups) salen como resuelto:true (el finally del
    // orquestador limpia igual); cualquier throw cae al MISMO catch de siempre
    // (fila ERROR — la cola jamás se tumba).
    const r3 = await faseDesenlace({ ...ctx, registro, archivo, actaBruta: r2.ctx.actaBruta });
    if (r3.resuelto) return;
    ctx = r3.ctx;

    // ─── R8 · STAGE 4/5 (split de procesarUno): ENVÍO ───
    // Veto H1 + veto remoto + envío propio + ledger H2 + registro remoto +
    // parche D61 — el bloque vive en faseEnvio (arriba). Los vetos salen como
    // resuelto:true (el finally del orquestador limpia igual); cualquier
    // throw cae al MISMO catch de siempre (fila ERROR — la cola jamás se
    // tumba).
    const r4 = await faseEnvio({
      ...ctx,
      registro,
      archivo,
      actaBruta: r2.ctx.actaBruta,
      actaDesenlace: r3.ctx.actaDesenlace,
      actaParcheada: r3.ctx.actaParcheada,
    });
    if (r4.resuelto) return;
    ctx = r4.ctx;

    // ─── R8 · STAGE 5/5 (split de procesarUno): PERSISTENCIA + MÉTRICAS ───
    // Thumb (D35) + registroListo (LISTA, trazas del PUNTO ÚNICO) +
    // persistencia con fallback liviano (FIX M14) + re-save del instrumento
    // persistMs (D61-T3) + marcarFila LISTA + métrica del desenlace (D34) —
    // el bloque vive en fasePersistYMetrica (arriba). ÚLTIMO stage: el
    // orquestador no consume su salida; cualquier throw cae al MISMO catch de
    // siempre (fila ERROR — la cola jamás se tumba).
    await fasePersistYMetrica({
      ...ctx,
      registro,
      archivo,
      actaBruta: r2.ctx.actaBruta,
      actaDesenlace: r3.ctx.actaDesenlace,
      actaParcheada: r3.ctx.actaParcheada,
      actaFinal: r4.ctx.actaFinal,
    });
  } catch (err) {
    // Errores de IDB/decode/pipeline NUNCA tumban la UI (kit §3): la
    // entrada pasa a ERROR con motivo corto (repetible — quitar y
    // re-soltar la foto vuelve a encolarla).
    // FIX M8-b (auditoría 2-c): el guard anti-zombi TAMBIÉN en el catch —
    // re-persistir el registro de una fila QUITADA lo revivía al recargar.
    if (!storeMasiva().getState().filas.some((f) => f.id === fila.id)) return;
    // D59 — KIT e14-info-acta-filas-v1 (T2): la fila ERROR NUNCA muestra
    // título viejo (infoTitulo: null — limpiar en el catch).
    marcarFila(fila.id, {
      estado: "ERROR",
      error: motivoCorto(err),
      infoTitulo: null,
      thumb: undefined,
    });
    // D34 — métricas: desenlace ERROR (totalMs null — jamás inventar).
    registrarMetricaError({
      filaId: fila.id,
      nombre: fila.nombre,
      error: motivoCorto(err),
      sondeoQrMs: fila.sondeoQrMs,
      // KIT e14-tiempos-v2 (D44) — post-mortem honesto: qrHeredado SOLO true
      // (false prematuro mentiría — la capa 0 pudo no correr); el contador de
      // re-arms y el tsInicio viajan si alcanzaron a nacer.
      ...(ctx.tsDespacho != null ? { tsInicio: ctx.tsDespacho } : {}),
      ...(ctx.qrHeredado ? { qrHeredado: true } : {}),
      // R1.2/R1.4/R1.4-b — post-mortem del ERROR (aditivos; ausente = sin dato).
      ...(ctx.viaCacheNegativa ? { qrCacheNegativa: true } : {}),
      ...(ctx.qrTierCapa0 != null ? { qrTier: ctx.qrTierCapa0 } : {}),
      ...(ctx.qrMsCapa0 != null ? { qrMs: ctx.qrMsCapa0 } : {}),
      ...(ctx.qrFasesCapa0 ? { qrFases: ctx.qrFasesCapa0 } : {}),
      ...(ctx.qrFinCapa0 != null ? { qrFin: ctx.qrFinCapa0 } : {}),
      ...(ctx.qrZxingMs != null ? { qrZxingMs: ctx.qrZxingMs } : {}),
      ...(ctx.qrPresupuestoMsCapa0 != null
        ? { qrPresupuestoMs: ctx.qrPresupuestoMsCapa0 }
        : {}),
      ...(ctx.preOcrPasadas > 1
        ? { reintentosPreOcr: ctx.preOcrPasadas - 1 }
        : {}),
    });
    if (registro) {
      try {
        await guardarRegistro({
          ...registro,
          estado: "ERROR",
          // e63m + D44-R2 + e64-qr T-0.2 + D65 (T1.4) + WAVE3 §B — trazas del
          // post-mortem (heredado solo-true + watchdog>0 + rescate "lanzado"
          // fijo en un ERROR tardío): PUNTO ÚNICO trazasPostMortemDe — el
          // catch estampa desde el CTX fresco de los stages, byte-idéntico.
          ...trazasPostMortemDe(ctx, {
            heredado: true,
            watchdog: true,
            rescate: "lanzado",
            capa0Telemetria: true,
          }),
        });
      } catch {
        /* IDB otra vez — la fila ya quedó ERROR en memoria (honesto) */
      }
    }
  } finally {
    // e71 (Opt-3): la vida de ESTA fila muere con ella (Map por-fila).
    vidas.delete(fila.id);
    const progreso = storeMasiva().getState().progreso;
    if (progreso?.id === fila.id) storeMasiva().setState({ progreso: null });
  }
}

/** C5 — RE-VISITA de UNA duplicada aparcada (fin de la ola — la llama
 *  bucle()). Copia si la original ya aterrizó durante la ola; si sigue sin
 *  desenlace, cae al fallback HONESTO de la rama DUPLICADA (des-marcar a
 *  PENDIENTE — la MISMA ola la reprocesa completa por la puerta de siempre).
 *  JAMÁS espera ni reaparca: una aparcada se resuelve exactamente UNA vez
 *  (terminación garantizada del bucle). QUITADA en el aparcado → nada (la
 *  voluntad del mantenedor manda — misma regla de esperarDesenlaceOriginal). */
async function revisitarDuplicadaAparcada(fila: FilaMasiva): Promise<void> {
  if (!storeMasiva().getState().filas.some((f) => f.id === fila.id)) return;
  marcarFila(fila.id, { estado: "PROCESANDO", error: null });
  if (await reutilizarResultado(fila, Date.now())) return;
  marcarFila(fila.id, { estado: "PENDIENTE", dupOf: null });
  try {
    // D41 — lectura RAW: solo spread base del re-save (sin dataURLs que
    // materializar — idéntico al fallback de la rama DUPLICADA).
    const registro = await leerRegistroRaw(fila.id);
    await guardarRegistro({ ...registro, estado: "PENDIENTE", dupOf: undefined });
  } catch {
    /* IDB caído — la fila ya está PENDIENTE en memoria (honesto) */
  }
  logger.info(`[e14] dedup fila=${fila.id} sin-original reprocesa-completo`);
}

async function bucle(): Promise<void> {
  // e71 (Opt-3) — PARALELISMO 2 WORKERS (kit e71-consolidación, benchmark
  // aprobado): pool de PROCESAMIENTO_CONCURRENTE actas EN VUELO. La fila se
  // RESERVA antes de disparar su pipeline (ventana entre siguientePendiente
  // y el marcarFila PROCESANDO de procesarUno — el segundo worker jamás la
  // toma). El bucle espera a que un slot se libere (Promise.race) y al
  // final espera a las filas en vuelo (el finally del runner apaga solo
  // cuando TODO aterrizó — mismo contrato del secuencial).
  const enVuelo = new Set<Promise<void>>();
  while (!stopFlag) {
    while (enVuelo.size >= procesamientoConcurrenteEfectivo()) {
      await Promise.race(enVuelo);
    }
    const fila = siguientePendiente();
    if (!fila) {
      // C5 — FIN DE LA OLA con aparcadas: RE-VISITA antes de romper (en
      // FIFO). Cada una copia (original aterrizada) o cae al fallback
      // honesto → PENDIENTE, que el `continue` re-entra a ESTA misma ola.
      // La re-visita jamás reaparca: siguiente pasada o rompe (todo
      // resuelto) o toma trabajo real — terminación garantizada.
      if (dedupAparcadas.size > 0) {
        const idsAparcadas = [...dedupAparcadas];
        dedupAparcadas.clear();
        const ordenadas = storeMasiva()
          .getState()
          .filas.filter((f) => idsAparcadas.includes(f.id))
          .sort((a, b) => a.agregadaEn - b.agregadaEn);
        for (const aparcada of ordenadas) {
          await revisitarDuplicadaAparcada(aparcada);
        }
        continue;
      }
      break;
    }
    reservadas.add(fila.id);
    // D66 — KIT e14-decode-unico-precalor-v1: prefetch RE-APUNTADO (D61) —
    // al iniciar N se asegura el MASTER de N+1 (decode oculto tras el OCR
    // de N, AC-P1 intacto) vía el precalor. El consumo vive en procesarUno
    // (consumirMaestro — el master de N pudo venir del precalor de la cola
    // ociosa o de este prefetch; DUPLICADA no consume master: es copia).
    dispararPrefetch(fila.id);
    const vuelo: Promise<void> = procesarUno(fila).finally(() => {
      reservadas.delete(fila.id);
      enVuelo.delete(vuelo);
    });
    enVuelo.add(vuelo);
  }
  await Promise.all(enVuelo);
}

/** D66 — KIT e14-decode-unico-precalor-v1 (prefetch D61 re-apuntado, T3.1):
 *  asegura el MASTER de la próxima fila pipeline-able (PENDIENTE, no temp,
 *  no DUPLICADA) con `ignorarOciosidad` — el decode de N+1 se esconde tras
 *  el OCR de N igual que hoy (AC-P1), pero produce el master que el
 *  pipeline SÍ consume (la memo del original quedó sin consumidor).
 *  Idempotente (asegurarMaestro no duplica) y jamás bloquea: si falla, la
 *  fila procesa con build inline o fallback (AC-P2). */
function dispararPrefetch(filaActualId: string): void {
  if (stopFlag) return;
  const proxima = proximaFilaPendiente(filaActualId);
  if (!proxima) return;
  void asegurarMaestro(proxima.id);
}

/** UN solo runner global (módulo singleton) — `iniciar()` double-call →
 *  no-op (kit §4 regla 1). */
export function iniciarRunner(): void {
  if (corriendoFlag) return;
  corriendoFlag = true;
  stopFlag = false;
  reiniciarRescatesDeCorrida(); // WAVE3 §B — techo del rescate por CORRIDA (R-26: el contador vive en fases/fase-pipeline-intentos.ts)
  colaSesionIniciada = true; // e63g FASE 1: sesión viva — el swap puede rearrancar
  storeMasiva().setState({ corriendo: true });
  iniciarCorridaMetrica(); // D34 — abre corrida de métricas (fire-and-forget)
  void bucle().finally(() => {
    corriendoFlag = false;
    // D34/D45 — cierra la corrida con su MOTIVO (drenada o pausa — stopFlag
    // manda: manual o auto-pausa de REVISIÓN; el informe ya no tiene fin=null
    // sin mantenedor).
    cerrarCorridaMetrica(stopFlag ? "pausa" : "drenada");
    storeMasiva().setState({ corriendo: false, progreso: null });
  });
}

/** Pausa MANUAL: stop = true — el OCR en vuelo TERMINA (no hay aborto a
 *  mitad de pipeline; la fila queda LISTA/ERROR y el loop no toma la
 *  siguiente). PROCESAR retoma donde iba. También lo llama la AUTO-PAUSA
 *  al abrir un acta en REVISIÓN (kit §4 regla 2 — el flujo de revisión usa
 *  el main thread y actaActual, no pelear). Reanudar es MANUAL (botón). */
export function pausarRunner(): void {
  stopFlag = true;
}

/** e63g — PLAN e63g-e63h-ruta-unica (E1/FASE 1): RE-ARRANQUE del bucle tras
 *  el swap temp→id real (lo llama `agregarFiles` del store). El agujero:
 *  `siguientePendiente` salta los ids `masiva-temp-` — si la copia a IDB
 *  aterriza DESPUÉS de que el bucle rompió (cola que se vació mientras el
 *  lote copiaba), las filas nuevas quedaban PENDIENTE para siempre.
 *  Guard IDEMPOTENTE (triple):
 *  · sesión fría (el mantenedor JAMÁS pulsó PROCESAR) → NO arranca (D45
 *    intacto: encolar no procesa por sí solo);
 *  · pausa activa (stopFlag — manual o auto-pausa de REVISIÓN) → NO
 *    arranca (reanudar es MANUAL — contrato del botón);
 *  · cola viva → iniciarRunner() es no-op (corriendoFlag) y el bucle vivo
 *    toma las nuevas en su siguiente pasada.
 *  El re-check va DIFERIDO (macrotask): cierra la ventana en la que el
 *  bucle rompe ENTRE el swap y este llamado — al disparar el timer el
 *  `finally` del bucle ya limpió corriendoFlag, y si hay pendientes
 *  reales el bucle renace exactamente por la puerta de siempre. */
export function rearrancarTrasEncolar(): void {
  if (!colaSesionIniciada || stopFlag) return;
  setTimeout(() => {
    if (stopFlag) return; // pausa llegando tarde — el mantenedor manda
    // C5: las APARCADAS también exigen ola (siguientePendiente las salta) —
    // el swap temp→id real de su original es exactamente la señal que las
    // resuelve (la re-visita del fin de ola copia o cae al fallback).
    if (siguientePendiente() || dedupAparcadas.size > 0) iniciarRunner();
  }, 0);
}
