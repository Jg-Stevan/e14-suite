"use client";

/**
 * R-26 (H-18, auditoría 2026-11-16 · decisión D-2) — STAGE 3/5 extraído del
 * runner masivo: DESENLACE (e63f · e63k · e72-P2.1v2). Movido VERBATIM de
 * runner.ts (mismo orden, mismos literales — las anclas QA de la
 * caracterización §E se reposicionaron a ESTE archivo); solo el cuerpo se
 * descompone en sub-tareas de ≤80 líneas. Aquí vive TAMBIÉN el tope de la
 * re-lectura interna (RELECTURA_TOPE_MS) — su único consumidor es esta fase.
 *
 * DESENLACE del pipeline: parche D57 del diagnóstico del actaBruta (esperaMs
 *  + origen/deskew del ÚLTIMO intento) → guard anti-zombi M8 → RE-LECTURA
 *  INTERNA (e63f — UNA pasada, conTope RELECTURA_TOPE_MS, traza console.info
 *  ANCLA QA) → CAPA 2 IDENTIDAD (e63k — mutexada, DUPLICADA con SU PROPIO
 *  desenlace) → resolución del falso-positivo visual → DEDUP POR CONTENIDO
 *  (e72 P2.1-v2 — reutiliza o DUPLICADA propia). Los `return` (M8/dups) salen
 *  como resuelto:true — el finally del orquestador limpia igual; cualquier
 *  throw cae al MISMO catch de procesarUno (jamás tumba la cola). Las trazas
 *  de los re-saves salen del PUNTO ÚNICO trazasPostMortemDe (subset de cada
 *  sitio, byte-idéntico). Función PURA salvo los efectos de siempre
 *  (store/IDB/logger/workers): recibe ctx y devuelve ctx nuevo — jamás muta
 *  el que recibe.
 */
import { getBridge } from "../../get-bridge";
import { storeMasiva } from "../store-api";
import { guardarRegistro } from "../cola";
// e63f — KIT e63f-autoenvio-v1 (F2): re-lectura interna pre-«repetir-primero».
// Lógica pura en masiva/relectura.ts (testeable headless); aquí solo la
// orquestación: re-OCR del MISMO bitmap (reconocerTexto — cap fino) +
// re-clasificar con la base divipol.
import { clasificarCabecera } from "@jg-stevan/scanner-core/dominio/clasificador";
import { cargarDivipol } from "@jg-stevan/scanner-core/dominio/divipol";
import { desenlaceTrasRelectura, procedeRelecturaInterna } from "../relectura";
// e63k — KIT e63k-capa2-identidad-v1 (F1.4): CAPA 2 de dedup por IDENTIDAD
// impresa (código 1D consensuado — identidad.ts es lógica pura; aquí solo la
// orquestación post-OCR, punto ÚNICO del kit).
import { identidadDeActa, type IdentidadActa } from "../identidad";
// e63g — PLAN e63g-e63h-ruta-unica (E1/F0): tope de la re-lectura interna —
// tríada {vencido} | {valor} | {error}, jamás throw (tope.ts es lógica
// pura; aquí solo la orquestación del bloque relectura).
import { conTope } from "../tope";
import { hacerThumb } from "../runner-thumbs";
import { marcarFila } from "../runner-vida";
import { matarYRecrearWorkers } from "../runner-watchdog";
import { esperarDesenlaceOriginal } from "../runner-dedup";
import { tituloDeActa, paginaDeActa, type FilaMasiva, type RegistroMasiva } from "../tipos";
import {
  conExclusionMutua,
  reutilizarResultado,
  trazasPostMortemDe,
  type CtxPostPipeline,
  type CtxProcesarUno,
  type SalidaDesenlace,
} from "./contexto";
import type { Acta } from "../../types";
import { logger } from "../../../logger";

// ─── e63g — PLAN e63g-e63h-ruta-unica (E1/F0): TOPE DE LA RE-LECTURA ───
// La re-lectura interna (e63f F2) corre FUERA del watchdog D65 (solo
// presupuesta el pipeline del intento): un colgaje de reconocerTexto ahí
// dejaba la cola esperando PARA SIEMPRE (sin veredicto, sin error, sin
// reintento posible — agujero latente desde e63f; no disparó en 181622).
// Presupuesto PROPIO y SEPARADO del watchdog: 45 s ≈ 2× el peor caso real
// del re-OCR a cap fino (~22 s) — vencido eso ya no es lentitud, es
// colgaje. Vencido: workers muertos y re-creados (misma infraestructura
// del watchdog), veredicto de la 1.ª lectura INTACTO y CERO reintentos.
const RELECTURA_TOPE_MS = 45_000;

/** D57 (T1): parche INMUTABLE del diagnóstico (kit §4-T1). ADITIVO — no
 *  toca score/status/gate; si el diagnóstico no existe (no debería: el
 *  bridge lo monta en todo desenlace fuera de SIM), se omite el campo.
 *  D63-A (T2): las trazas de origen viajan en el MISMO parche (aditivas,
 *  al final del contrato D57 — origen/origenSenales, ver origen.ts).
 *  D65: veredictoOrigen/preProceso son del ÚLTIMO intento ejecutado (si el
 *  desenlace existe, al menos un intento completó sus bloques D63). */
function parchearDiagnosticoDesenlace(ctx: CtxPostPipeline): Acta {
  const { actaBruta, veredictoOrigen, preProceso, esperaMs } = ctx;
  return actaBruta.diagnostico != null
    ? {
        ...actaBruta,
        diagnostico: {
          ...actaBruta.diagnostico,
          tiempos: { ...actaBruta.diagnostico.tiempos, esperaMs },
          origen: veredictoOrigen?.origen ?? null,
          origenSenales: veredictoOrigen?.senales ?? null,
          // D63-B (T2/T3): trazas del pre-proceso de escaneos (aditivas,
          // al final del contrato — null cuando no aplicó/no es escaneo).
          skewGrados: preProceso?.skewGrados ?? null,
          deskewMs: preProceso?.deskewMs ?? null,
          limpieza: preProceso?.limpieza ?? null,
          // D63-A2 (T0): provenance del master que el bridge CONSUMIÓ —
          // "corregido" (deskew aplicado) | "original". Aditivo al final
          // del contrato D57; el informe T2 lo consume como
          // preprocesoAplicado (bool, presente si origen escaneo).
          // preProceso existe SIEMPRE en MASIVA (nulo para no-escaneos →
          // "original") — null solo si no hay diagnóstico (jamás inventar).
          maestroFuente: preProceso
            ? preProceso.aplicado
              ? ("corregido" as const)
              : ("original" as const)
            : null,
        },
      }
    : actaBruta;
}

/** e63f/e63g — RE-LECTURA INTERNA antes de «repetir-primero»: SUGERIDA/MANUAL
 *  con captura PERFECTA (score ≥ 8 ∧ lectura FUERTE ∧ gate completa) no
 *  vuelve a capturar: se RE-LEE el MISMO bitmap (reconocerTexto — re-warp
 *  con el quad horneado SIN re-detección + rapidocr a cap fino DET_CAP_PROD,
 *  la pasada-2 del escalonado) → re-clasificar → re-evaluar el gate
 *  (desenlaceTrasRelectura). AUTO → OPTIMA → autoenvío normal más abajo; si
 *  no → revisión humana como hoy. UNA pasada MÁXIMA (RED LINE 5) y el humano
 *  NUNCA la ve (intento de LECTURA, no de captura — el «repetir-primero»
 *  físico del flujo individual NO cambia). NUNCA aplica a RECHAZADAS por
 *  calidad (score < 6.5 — ahí re-escanear SÍ ayuda), ADVERTENCIA (red line)
 *  ni gate incompleta. Trazas aditivas: token ` RelecturaInterna=` (D51) y
 *  flag `relectura` en la fila. Cualquier falla interna (runtime OCR, base
 *  divipol) deja el veredicto de siempre — jamás empeora.
 *
 *  e63g (E1/F0): el bloque va envuelto en conTope (RELECTURA_TOPE_MS) — era
 *  el ÚNICO await de la fila sin presupuesto propio (el watchdog D65 no lo
 *  cubre) y un colgaje de reconocerTexto congelaba la cola PARA SIEMPRE.
 *  Tríada: valor → desenlace de la re-lectura; error → sin-cambio (como el
 *  catch de siempre); VENCIDO → matarYRecrearWorkers() + veredicto de la
 *  1.ª lectura INTACTO (actaDesenlace sigue siendo `acta`) + token `tope`
 *  (D51 aditivo) + CERO reintentos. La traza SIEMPRE (también con tope). */
async function correrRelecturaInterna(
  fila: FilaMasiva,
  acta: Acta,
): Promise<{ actaDesenlace: Acta; relecturaDesenlace: "auto" | "sin-cambio" | null }> {
  let actaDesenlace = acta;
  let relecturaDesenlace: "auto" | "sin-cambio" | null = null;
  if (procedeRelecturaInterna(acta)) {
    const tRelectura = performance.now();
    const r = await conTope(
      (async () => {
          const textoRe = await getBridge().reconocerTexto(acta);
          const clasifRe = clasificarCabecera(textoRe, await cargarDivipol());
          return desenlaceTrasRelectura(acta, textoRe, clasifRe);
        })(),
        RELECTURA_TOPE_MS,
      );
    let relecturaToken: "auto" | "sin-cambio" | "tope" | null = null;
    if (r.vencido) {
      // Tope vencido — infraestructura muerta y re-creada (misma doctrina
      // del watchdog T1.2); el VEREDICTO de la 1.ª lectura queda intacto.
      // La relectura JAMÁS reintenta (red line): sin-cambio y fuera.
      await matarYRecrearWorkers();
      relecturaDesenlace = "sin-cambio";
      relecturaToken = "tope";
    } else if ("valor" in r) {
      actaDesenlace = r.valor.acta;
      relecturaDesenlace = r.valor.desenlace;
      relecturaToken = r.valor.desenlace;
    } else {
      relecturaDesenlace = "sin-cambio";
      relecturaToken = "sin-cambio";
    }
    // console.info LITERAL — ancla QA (qa-watchdog-relectura.ts Bloque 3:
    // «traza SIEMPRE» grepea console.info( en este bloque). No migra al logger.
    console.info(
      `[e14] relectura-interna fila=${fila.id} ms=${Math.round(performance.now() - tRelectura)} RelecturaInterna=${relecturaToken}`,
    );
  }
  return { actaDesenlace, relecturaDesenlace };
}

/** e63k — ¿original por identidad? OTRA fila (f.id !== fila.id) con la MISMA
 *  identidadActa (13 dígitos = formulario+PAG — P1 y P2 del mismo formulario
 *  son actas DISTINTAS, nunca se deduplican entre sí) en estado
 *  LISTA|DUPLICADA; la de agregadaEn MÍNIMA es la original. */
function encontrarOriginalIdentidad(fila: FilaMasiva, identidad: IdentidadActa): FilaMasiva | null {
  return (
    storeMasiva()
      .getState()
      .filas.filter(
        (f) =>
          f.id !== fila.id &&
          f.serie != null &&
          f.serie.slice(0, 13) === identidad.identidadActa &&
          (f.estado === "LISTA" || f.estado === "DUPLICADA"),
      )
      .sort((a, b) => a.agregadaEn - b.agregadaEn)[0] ?? null
  );
}

/** e71 (Opt-3) — SECCIÓN CRÍTICA de la capa 2 (kit: «encolar la verificación
 *  de dedup en un solo hilo»): DOS filas con la MISMA serie aterrizando
 *  juntas veían AMBAS «sin original» y se enviaban DOBLE. Dentro del mutex la
 *  segunda ve la marca de la primera → DUPLICADA — el envío doble es
 *  IMPOSIBLE por construcción. El thumb/IDB (~50 ms) dentro de la sección:
 *  el OCR queda fuera (paralelo de verdad).
 *
 *  DUPLICADA por identidad — SU PROPIO desenlace (no el de la original): NO
 *  reenvía, NO borra, revisión disponible. La capa 2 decide por CUALQUIER
 *  status del desenlace (un dup RECHAZADO por blur de la misma acta también
 *  es dup) → return ANTES del envío y del contador (kit §1.4-5). El guard
 *  anti-zombi M8 ya corrió antes en el flujo (la fila está viva al llegar
 *  aquí) — NO se duplica. */
async function marcarDuplicadaPorIdentidad(
  ctx: CtxPostPipeline,
  fila: FilaMasiva,
  registro: RegistroMasiva,
  actaDesenlace: Acta,
  identidad: IdentidadActa,
): Promise<{ marcada: boolean; original: FilaMasiva | null }> {
  let originalSalida: FilaMasiva | null = null;
  const marcada = await conExclusionMutua(async () => {
    const original = encontrarOriginalIdentidad(fila, identidad);
    if (!original) return false;
    originalSalida = original;
    const thumbIdentidad = await hacerThumb(
      actaDesenlace.fotoProcesada ?? actaDesenlace.fotoOriginal,
    );
    await guardarRegistro({
      ...registro,
      estado: "DUPLICADA",
      dupOf: original.id,
      acta: actaDesenlace,
      thumb: thumbIdentidad,
      serie: identidad.serie,
      dedup: "identidad",
      infoTitulo: tituloDeActa(actaDesenlace),
      // e63m + e64-qr T-0.2 — trazas post-mortem de ESTA fila (qrPayload
      // + qrEstado): PUNTO ÚNICO trazasPostMortemDe (subset de ESTE sitio
      // — sin heredado/watchdog/rescate — byte-idéntico a ayer).
      ...trazasPostMortemDe(ctx, {}),
    });
    marcarFila(fila.id, {
      estado: "DUPLICADA",
      dupOf: original.id,
      statusActa: actaDesenlace.status,
      score: actaDesenlace.score,
      nivel: actaDesenlace.clasificacion?.nivel ?? null,
      pagina: paginaDeActa(actaDesenlace),
      infoTitulo: tituloDeActa(actaDesenlace),
      motivo: actaDesenlace.rechazo?.tipo ?? null,
      thumb: thumbIdentidad,
      enviadaAuto: false,
      // e63k (decisión declarada en el REPORTE §1): la serie TAMBIÉN al
      // mapa en memoria (regla general del kit — el mapa de identidad de
      // la sesión ve esta fila aunque la original se haya quitado).
      serie: identidad.serie,
      error: null,
    });
    logger.info(
      `[e14] dedup-identidad fila=${fila.id} serie=${identidad.identidadActa} original=${original.id}`,
    );
    return true;
  });
  return { marcada, original: originalSalida };
}

/** Falso-positivo visual EVITADO (el caso 3992/3993 de la consola del
 *  mantenedor — QA §3.2): la banda visual 3..6 la había dejado sospechosa y
 *  la serie impresa demuestra que es OTRA acta → resolución final
 *  "sin-match" en el registroListo de abajo (conservando dedupDistancia y
 *  dedupVisualDe del write aplazado — post-mortem). La fila sigue al envío
 *  normal — SU desenlace, NUNCA el de otra. La traza vive en el REGISTRO
 *  (kit §1.2 — dedupVisualDe es de RegistroMasiva; el store no la restaura
 *  a la fila). Solo se RESUELVE una banda que SIGUE aplazada
 *  (registro.dedup === "visual-aplazada"): jamás revertir un veredicto
 *  "identidad" previo (el mantenedor pudo PROCESAR IGUAL una dup real — su
 *  traza queda intacta). */
function detectarFalsoPositivoEvitado(
  fila: FilaMasiva,
  registro: RegistroMasiva,
  identidad: IdentidadActa | null,
  originalIdentidad: FilaMasiva | null,
): boolean {
  const dedupVisualDeAplazada = registro?.dedupVisualDe ?? null;
  const falsoPositivoEvitado =
    identidad != null &&
    originalIdentidad == null &&
    dedupVisualDeAplazada != null &&
    registro?.dedup === "visual-aplazada";
  if (falsoPositivoEvitado) {
    logger.info(
      `[e14] dedup-identidad fila=${fila.id} falso-positivo-visual evitado serie=${identidad!.serie} original-visual=${dedupVisualDeAplazada}`,
    );
  }
  return falsoPositivoEvitado;
}

/** e72 — gemelas por hashBytes exacto (whitelist de estados — T-5 e65: la
 *  literal YA-ENVIADA jamás se escribe en el runner — el QA la veta;
 *  AUSENTE/ERROR/ya-enviada quedan fuera por construcción: sin acta copiable
 *  no hay resolución posible). La gemela en vuelo cuenta SOLO si es ANTERIOR
 *  (agregadaEn menor): esperar a una POSTERIOR sería esperarla a ELLA que
 *  espera por ESTA — deadlock imposible por construcción. */
function buscarGemelasHash(
  fila: FilaMasiva,
  hashNeto: string,
): { originalLista: FilaMasiva | null; originalEnVuelo: FilaMasiva | null } {
  const gemelasHash = storeMasiva()
    .getState()
    .filas.filter(
      (f) =>
        f.id !== fila.id &&
        f.hashBytes === hashNeto &&
        (f.estado === "PENDIENTE" ||
          f.estado === "PROCESANDO" ||
          f.estado === "LISTA" ||
          f.estado === "DUPLICADA"),
    )
    .sort((a, b) => a.agregadaEn - b.agregadaEn);
  const originalLista =
    gemelasHash.find((f) => f.estado === "LISTA") ?? null;
  const originalEnVuelo =
    gemelasHash.find(
      (f) =>
        (f.estado === "PENDIENTE" || f.estado === "PROCESANDO") &&
        f.agregadaEn < fila.agregadaEn,
    ) ?? null;
  return { originalLista, originalEnVuelo };
}

/** Copia por la maquinaria P2.1 (reutilizarResultado — la copia hereda
 *  DUPLICADA o RECHAZADA). Si la gemela cierta aún no aterriza (profunda en
 *  la cola/vuelo) → esperar su desenlace (mismo guard acotado de la rama
 *  DUPLICADA) y copiar: la OCR de ESTA fila ya se pagó (precio de la race) —
 *  el desenlace correcto sigue siendo el de la original. */
async function copiarPorContenido(
  fila: FilaMasiva,
  originalLista: FilaMasiva | null,
  originalEnVuelo: FilaMasiva | null,
): Promise<boolean> {
  const tNet = Date.now();
  let copiado = false;
  if (originalLista != null) {
    const filaGemela: FilaMasiva = {
      ...fila,
      estado: "DUPLICADA",
      dupOf: originalLista.id,
    };
    copiado = await reutilizarResultado(filaGemela, tNet);
  }
  if (!copiado && originalEnVuelo != null) {
    if (await esperarDesenlaceOriginal(fila.id, originalEnVuelo.id)) {
      const filaGemela: FilaMasiva = {
        ...fila,
        estado: "DUPLICADA",
        dupOf: originalEnVuelo.id,
      };
      copiado = await reutilizarResultado(filaGemela, tNet);
    }
  }
  return copiado;
}

/** e72 (c) — Sin original resoluble (gemela QUITADA en la carrera / «v2»
 *  por dHash de bytes distintos / gemela desaparecida) → DUPLICADA con SU
 *  PROPIO desenlace (revisión disponible — cero envío, cero contador; el OCR
 *  pagado fue el precio de la race y el informe lo muestra honesto con sus
 *  tiempos reales). La voluntad del mantenedor manda: una fila QUITADA en la
 *  espera no resucita registro. */
async function persistirDuplicadaContenido(
  ctx: CtxPostPipeline,
  fila: FilaMasiva,
  registro: RegistroMasiva,
  actaDesenlace: Acta,
  identidad: IdentidadActa | null,
  originalLista: FilaMasiva | null,
  originalEnVuelo: FilaMasiva | null,
): Promise<void> {
  const thumbNet = await hacerThumb(
    actaDesenlace.fotoProcesada ?? actaDesenlace.fotoOriginal,
  );
  await guardarRegistro({
    ...registro,
    estado: "DUPLICADA",
    acta: {
      ...actaDesenlace,
      status: "DUPLICADA",
      enviadoAutomaticamente: null,
      ...(actaDesenlace.diagnostico
        ? {
            diagnostico: {
              ...actaDesenlace.diagnostico,
              status: "DUPLICADA" as const,
            },
          }
        : {}),
    },
    thumb: thumbNet,
    infoTitulo: tituloDeActa(actaDesenlace),
    ...(identidad ? { serie: identidad.serie } : {}),
    // e63m + e64-qr T-0.2 + WAVE3 §B (la DUPLICADA tras un rescate cuenta
    // como SALVADA — desenlace final ≠ RECHAZADA, traza honesta del
    // informe): PUNTO ÚNICO trazasPostMortemDe (subset de ESTE sitio —
    // byte-idéntico a ayer).
    ...trazasPostMortemDe(ctx, { rescate: "salvado" }),
  });
  marcarFila(fila.id, {
    estado: "DUPLICADA",
    dupOf: originalLista?.id ?? originalEnVuelo?.id ?? null,
    statusActa: "DUPLICADA",
    score: actaDesenlace.score,
    nivel: actaDesenlace.clasificacion?.nivel ?? null,
    pagina: paginaDeActa(actaDesenlace),
    infoTitulo: tituloDeActa(actaDesenlace),
    motivo: actaDesenlace.rechazo?.tipo ?? null,
    thumb: thumbNet,
    enviadaAuto: false,
    ...(identidad ? { serie: identidad.serie } : {}),
    error: null,
  });
  logger.info(
    `[e14] dedup fila=${fila.id} desenlace-contenido DUPLICADA v2=${registro.dedup === "v2"} gemela=${originalLista?.id ?? originalEnVuelo?.id ?? "sin-original"} (sin envío propio)`,
  );
  // NO registrarEnvioMasiva NI contarMotivoNoEnvioActa (patrón capa-2)
}

/** ctx enriquecido del desenlace — la MISMA spread de los retornos del
 *  monolito (R-26 la unifica; el objeto resultante es idéntico campo por
 *  campo — la dup de capa-2 viaja con el falsoPositivoEvitado HEREDADO del
 *  ctx, que a esa altura sigue siendo el inicial). */
function ctxTrasDesenlace(
  ctx: CtxProcesarUno,
  acta: Acta,
  actaDesenlace: Acta,
  relecturaDesenlace: "auto" | "sin-cambio" | null,
  identidad: IdentidadActa | null,
  falsoPositivoEvitado: boolean,
): CtxProcesarUno & { actaParcheada: Acta; actaDesenlace: Acta } {
  return {
    ...ctx,
    actaParcheada: acta,
    actaDesenlace,
    relecturaDesenlace,
    identidad,
    falsoPositivoEvitado,
  };
}

/** STAGE 3/5 — desenlace (R-26: cuerpo del monolito, subtareas arriba). */
export async function faseDesenlace(ctx: CtxPostPipeline): Promise<SalidaDesenlace> {
  const fila = ctx.fila;
  const registro = ctx.registro;
  // (bloque movido VERBATIM de procesarUno — mismo orden, mismos literales)
  const acta = parchearDiagnosticoDesenlace(ctx);
  // FIX M8 (auditoría 2-c): la decisión del mantenedor manda TAMBIÉN para el
  // ENVÍO — si quitó la fila mientras el OCR corría, el desenlace NO se
  // transmite (antes registrarEnvioMasiva corría ANTES del guard: fila de
  // historial + completadas + hueco archivado de un acta descartado).
  if (!storeMasiva().getState().filas.some((f) => f.id === fila.id))
    return { resuelto: true, ctx: { ...ctx, actaParcheada: acta, actaDesenlace: acta } };
  const { actaDesenlace, relecturaDesenlace } = await correrRelecturaInterna(fila, acta);
  const identidad = identidadDeActa(actaDesenlace);
  let originalIdentidad: FilaMasiva | null = null;
  // forzarDedupOff (el mantenedor pulsó PROCESAR IGUAL) manda sobre la capa 2.
  if (identidad && !fila.forzarDedupOff) {
    const { marcada, original } = await marcarDuplicadaPorIdentidad(
      ctx,
      fila,
      registro,
      actaDesenlace,
      identidad,
    );
    originalIdentidad = original;
    if (marcada) {
      // NO registrarEnvioMasiva NI contarMotivoNoEnvioActa (kit §1.4-5)
      return {
        resuelto: true,
        ctx: ctxTrasDesenlace(ctx, acta, actaDesenlace, relecturaDesenlace, identidad, ctx.falsoPositivoEvitado),
      };
    }
  }
  const falsoPositivoEvitado = detectarFalsoPositivoEvitado(fila, registro, identidad, originalIdentidad);
  // ─── e72 — P2.1-v2: el veredicto de dedup por CONTENIDO manda sobre el
  // envío ─── Segundo plano de la MISMA race del smoke del mantenedor
  // (imagen9/imagen10): la fila llegó AL DESENLACE con el veredicto puesto
  // (traza «v2» de cadenaDedup — cinta cierta, estampada aunque el guard
  // anti-zombi bloqueara la marca pre-OCR) o con una gemela EXACTA (hashBytes
  // sha256 idéntico) ya resuelta. El desenlace NUNCA envía: resolver por la
  // maquinaria P2.1 o, sin original resoluble, DUPLICADA con SU PROPIO
  // desenlace (doctrina capa-2 e63k: revisión disponible, cero envío, cero
  // contador). LA ORIGINAL JAMÁS CAE AQUÍ: su traza es «sin-match» (la cadena
  // es FIFO — sus candidatas son ANTERIORES) y una gemela en cola
  // (DUPLICADA/PENDIENTE posterior) sin traza v2 no activa el guard.
  // forzarDedupOff (PROCESAR IGUAL) manda SIEMPRE (RL-e65b-6 — el escape del
  // mantenedor es sagrado).
  if (!fila.forzarDedupOff && registro != null && registro.hashBytes != null) {
    const hashNeto: string = registro.hashBytes;
    const { originalLista, originalEnVuelo } = buscarGemelasHash(fila, hashNeto);
    if (registro.dedup === "v2" || originalLista != null) {
      const copiado = await copiarPorContenido(fila, originalLista, originalEnVuelo);
      if (copiado)
        return {
          resuelto: true,
          ctx: ctxTrasDesenlace(ctx, acta, actaDesenlace, relecturaDesenlace, identidad, falsoPositivoEvitado),
        };
      if (!storeMasiva().getState().filas.some((f) => f.id === fila.id)) {
        return {
          resuelto: true,
          ctx: ctxTrasDesenlace(ctx, acta, actaDesenlace, relecturaDesenlace, identidad, falsoPositivoEvitado),
        };
      }
      await persistirDuplicadaContenido(ctx, fila, registro, actaDesenlace, identidad, originalLista, originalEnVuelo);
      return {
        resuelto: true,
        ctx: ctxTrasDesenlace(ctx, acta, actaDesenlace, relecturaDesenlace, identidad, falsoPositivoEvitado),
      };
    }
  }
  return {
    resuelto: false,
    ctx: ctxTrasDesenlace(ctx, acta, actaDesenlace, relecturaDesenlace, identidad, falsoPositivoEvitado),
  };
}
