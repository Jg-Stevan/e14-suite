/**
 * R-55 — DECISIONES DE RECEPCIÓN (aprobación/rechazo del supervisor sobre
 * entradas del log de recepción) — registro APPEND-ONLY en memoria de
 * sesión, con persistencia a través del snapshot del panel
 * (`snapshot-panel.ts`, store "meta", clave "decisiones-recepcion").
 *
 * QUÉ RESUELVE: cierra la brecha documentada en `actas-runtime.ts` (T8,
 * «BRECHA ABIERTA» → CERRADA 2026-11-19): la APROBACIÓN en Recepción hoy
 * produce un registro consultable por el repositorio — la TERCERA FUENTE
 * del gate de visibilidad (`actaVisibleEnMonitor`).
 *
 * GRANO Y UNIÓN: cada decisión es sobre UNA entrada de Recepción (1 foto =
 * 1 entrada, mismo grano del log). Al registrar se resuelve la entrada
 * contra `recepcion-log` y se estampa su clave de join D22
 * (`idEnlace` + `mesa`) DENTRO del registro de decisión — así el gate cruza
 * por `${idEnlace}::${mesa}` sin re-consultar el log y una decisión
 * rehidratada del snapshot sigue cruzando aunque su entrada ya no esté.
 * Una decisión sobre una entrada SIN_JOIN (`idEnlace === "—"`) se rechaza:
 * sin join confiable no hay destino que aprobar (honestidad D25).
 *
 * SEMÁNTICA: append-only — una entrada decidida JAMÁS se sobre-decide (la
 * UI deshabilita los botones; el módulo también defiende). RECHAZADA no
 * hace visible nada (solo APROBADA suma la tercera fuente); RECHAZADA
 * tampoco OCULTA nada que ya sea visible por las otras fuentes (envío
 * automático / sembradas) — el gate es aditivo por diseño.
 *
 * DOCTRINA: jamás throw (todo resultado es discriminado `{ok}`); un oyente
 * caído jamás rompe el registro; sin libs nuevas; sin backend (D8 — el
 * snapshot vive en IndexedDB LOCAL del panel, excepción documentada R-54).
 */

import { consultarRecepciones } from "./recepcion-log";

/** Decisión del supervisor sobre una entrada de recepción. */
export type DecisionRecepcion = "APROBADA" | "RECHAZADA";

/** Registro de una decisión (con la clave de join resuelta al registrar). */
export interface DecisionRegistrada {
  decision: DecisionRecepcion;
  /** Momento de la decisión (epoch ms). */
  ms: number;
  /** Clave de join D22 estampada desde la entrada — el cruce del gate. */
  idEnlace: string;
  mesa: string;
  /** Nota opcional del supervisor (trim vacío → no se guarda). */
  nota?: string;
}

/** Resultado discriminado — jamás throw (doctrina C1 del módulo). */
export type ResultadoDecision =
  | { ok: true; registro: DecisionRegistrada }
  | { ok: false; motivo: string };

type Oyente = () => void;

/** Estado mutable interno — append-only: una vez decidida, la entrada no se
 *  decide de nuevo (ni se reemplaza). */
const DECISIONES = new Map<string, DecisionRegistrada>();
const oyentes = new Set<Oyente>();

/** Snapshot PÚBLICO con identidad NUEVA en cada mutación: `useSyncExternalStore`
 *  compara por Object.is — si devolviéramos el Map mutable directo, un cambio
 *  no dispararía re-render. Reconstruido solo al notificar (barato: el mapa es
 *  chico — una decisión por entrada ADVERTENCIA decidida). */
let snapshotPublico: ReadonlyMap<string, DecisionRegistrada> = DECISIONES;

function notificar(): void {
  snapshotPublico = new Map(DECISIONES);
  for (const fn of oyentes) {
    try {
      fn();
    } catch {
      /* un oyente caído jamás rompe el registro */
    }
  }
}

/**
 * R-54 — la persistencia se agenda por IMPORT DINÁMICO: snapshot-panel lee
 * este módulo (extraer/fusionar) — un import estático aquí cerraría un ciclo
 * de inicialización. Fire-and-forget: un fallo del snapshot jamás rompe la
 * decisión (doctrina jamás throw).
 */
function agendarGuardado(): void {
  void import("./snapshot-panel")
    .then((m) => m.agendarGuardadoSnapshot())
    .catch(() => {
      /* sin snapshot disponible — la decisión vive en memoria (conservador) */
    });
}

/**
 * Registra UNA decisión sobre una entrada existente del log de recepción.
 * Valida: decisión conocida, entrada sin decisión previa, entrada existente
 * en el log y con join D22. Jamás lanza — resultado discriminado.
 */
export function registrarDecisionRecepcion(
  idEntrada: string,
  decision: DecisionRecepcion,
  nota?: string
): ResultadoDecision {
  if (decision !== "APROBADA" && decision !== "RECHAZADA") {
    return { ok: false, motivo: `decisión desconocida: ${String(decision)}` };
  }
  if (DECISIONES.has(idEntrada)) {
    // Append-only: la primera decisión manda (la UI deshabilita; el módulo
    // también defiende — dos supervisores, dos pestañas).
    return { ok: false, motivo: "la entrada ya tiene una decisión registrada" };
  }
  const entrada = consultarRecepciones().find((e) => e.id === idEntrada);
  if (!entrada) {
    return { ok: false, motivo: "la entrada no existe en el log de recepción" };
  }
  if (entrada.idEnlace === "—" || !entrada.mesa || entrada.mesa === "—") {
    // SIN_JOIN: sin destino confiable no hay nada que aprobar para el
    // monitor (jamás inventar ubicación — D25/D22).
    return { ok: false, motivo: "sin join D22 no hay decisión que cruzar" };
  }
  const notaLimpia =
    typeof nota === "string" && nota.trim() !== "" ? nota.trim() : undefined;
  const registro: DecisionRegistrada = {
    decision,
    ms: Date.now(),
    idEnlace: entrada.idEnlace,
    mesa: entrada.mesa,
    ...(notaLimpia !== undefined ? { nota: notaLimpia } : {}),
  };
  DECISIONES.set(idEntrada, registro);
  notificar();
  agendarGuardado();
  return { ok: true, registro };
}

/** Copia legible de las decisiones (identidad nueva solo tras una mutación). */
export function consultarDecisionesRecepcion(): ReadonlyMap<
  string,
  DecisionRegistrada
> {
  return snapshotPublico;
}

/** Suscripción a cambios (patrón del módulo: sin libs nuevas). */
export function suscribirseDecisionesRecepcion(fn: Oyente): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

/**
 * R-55 — TERCERA FUENTE del gate de visibilidad (`actaVisibleEnMonitor`):
 * ¿hay alguna decisión APROBADA cuya clave de join D22 sea esta? RECHAZADA
 * jamás hace visible (el gate es aditivo; una decisión de rechazo no oculta
 * lo ya visible por envío automático ni por las sembradas).
 */
export function hayAprobacionParaClaveJoin(
  idEnlace: string,
  mesa: string
): boolean {
  for (const d of snapshotPublico.values()) {
    if (
      d.decision === "APROBADA" &&
      d.idEnlace === idEnlace &&
      d.mesa === mesa
    ) {
      return true;
    }
  }
  return false;
}

// ─── R-54 — hooks de snapshot (los consume snapshot-panel.ts) ───────────────

/** Forma serializable de una decisión (la del Map + su id de entrada). */
export interface DecisionSnapshot {
  idEntrada: string;
  decision: DecisionRecepcion;
  nota?: string;
  ms: number;
  idEnlace: string;
  mesa: string;
}

/** Extracción para el snapshot (forma plana, lista para JSON). */
export function extraerDecisionesParaSnapshot(): DecisionSnapshot[] {
  const salida: DecisionSnapshot[] = [];
  for (const [idEntrada, d] of DECISIONES) {
    salida.push({
      idEntrada,
      decision: d.decision,
      ms: d.ms,
      idEnlace: d.idEnlace,
      mesa: d.mesa,
      ...(d.nota !== undefined ? { nota: d.nota } : {}),
    });
  }
  return salida;
}

/**
 * Fusión CONSERVADORA desde el snapshot (R-54): solo entradas AUSENTES en
 * memoria — jamás pisa lo más nuevo de la sesión viva. Devuelve cuántas
 * agregó (0 → silencioso, sin notificar).
 */
export function fusionarDecisionesDesdeSnapshot(
  listado: readonly DecisionSnapshot[]
): number {
  let agregadas = 0;
  for (const d of listado) {
    if (DECISIONES.has(d.idEntrada)) continue;
    DECISIONES.set(d.idEntrada, {
      decision: d.decision,
      ms: d.ms,
      idEnlace: d.idEnlace,
      mesa: d.mesa,
      ...(d.nota !== undefined ? { nota: d.nota } : {}),
    });
    agregadas += 1;
  }
  if (agregadas > 0) notificar();
  return agregadas;
}

/** Solo para pruebas (bun test comparte el registro de módulos entre suites). */
export function reiniciarDecisionesParaPrueba(): void {
  DECISIONES.clear();
  notificar();
}
