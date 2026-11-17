/**
 * MÉTRICAS DEL FEED de recepción (Ronda C, R2/R3/R5 del plan
 * PLAN-DISENOS-VS-IMPLEMENTACION.md) — cálculo PURO sobre el log:
 * sin estado propio, sin suscripciones, sin React (frontera de dominio).
 *
 *   · RITMO / THROUGHPUT — llegadas en la ventana móvil de 60 s,
 *     expresadas en actas/min (R2).
 *   · PICO — máximo ritmo de la sesión: para cada llegada, cuántas cayeron
 *     en SU ventana de 60 s hacia atrás — sort O(n log n) + two-pointer
 *     O(n) (R-53: el comentario decía «O(n²)» por una versión anterior del
 *     cálculo; la implementación vigente nunca fue cuadrática).
 *     R-53(b) — el sort corre SOLO cuando la LISTA cambia (llegadas);
 *     por cada tick del reloj (1 s) la llamada reutiliza el orden cached.
 *   · FLUJO — 60 buckets de 1 s (barritas del sparkline, R3).
 *   · LATENCIA MEDIA — media de (fecha − fechaOrigen) sobre las filas que
 *     traen telemetría de origen (R5); sin datos → null (honestidad).
 *
 * Determinista respecto a (entradas, ahora): el «ahora» lo inyecta el
 * consumidor (reloj vivo canónico — useSyncExternalStore). El chip del
 * ritmo es relativo al pico: ≥75% ÓPTIMO, ≥45% ESTABLE, resto LENTO.
 */

import type { EntradaRecepcion } from "./recepcion-log";

/** Tono del chip RITMO (relativo al pico de la sesión). */
export type TonoRitmo = "OPTIMO" | "ESTABLE" | "LENTO" | "SIN_DATOS";

export interface MetricasFeed {
  /** Llegadas de los últimos 60 s (actas/min). */
  ritmo: number;
  /** Máximo ritmo alcanzado en la sesión (actas/min). */
  pico: number;
  /** Etiqueta del chip: ÓPTIMO / ESTABLE / LENTO / SIN DATOS. */
  tono: TonoRitmo;
  /** 60 buckets de 1 s — índice 0 = hace 59 s, índice 59 = segundo actual. */
  buckets: number[];
  /** Media de (fecha − fechaOrigen) en segundos; null si ninguna fila la trae. */
  latenciaMedia: number | null;
  /** C-07 — pares REALES (fechaOrigen presente y coherente) con los que se
   * calculó la media: la vista solo muestra el indicador con ≥ 2 muestras
   * (con una sola, una «media» sería un invento estadístico). */
  latenciaMuestras: number;
  /** Llegadas contadas en la ventana (para el «N en cola» del feed). */
  llegadasVentana: number;
}

const VENTANA_MS = 60_000;
const BUCKETS = 60;

// ─── R-53(b) — caché incremental del orden cronológico ──────────────────
// La vista llama esta función POR CADA TICK del reloj (1 s) con la MISMA
// lista (el `ahora` cambia, la lista no — `fuente` es un memo con identidad
// estable entre llegadas). Re-sortear por tick es trabajo repetido: la caché
// (clave = REFERENCIA del array + length) conserva el orden cronológico y el
// sort O(n log n) solo corre cuando llegan entradas nuevas (referencia
// nueva) o la lista mutó in place (length distinto). La función queda PURA
// desde fuera: misma firma, mismo resultado, jamás muta la entrada.
//
// Asumisión documentada: el consumidor pasa COPIAS inmutables
// (`consultarRecepciones()` devuelve `[...ENTRADAS]`) — una mutación in
// place con idéntico length (patológica) no invalidaría la caché; el
// sistema real jamás la produce (el log es append-only vía unshift + copia).
let cacheRef: readonly EntradaRecepcion[] | null = null;
let cacheLength = -1;
let cacheFechas: number[] | null = null;

/** Fechas del log en orden cronológico ASCENDENTE (caché por referencia). */
function fechasOrdenadas(entradas: readonly EntradaRecepcion[]): number[] {
  if (
    cacheRef === entradas &&
    cacheLength === entradas.length &&
    cacheFechas !== null
  ) {
    return cacheFechas;
  }
  // Copia (`.map`) antes del sort: jamás se toca el array del consumidor.
  const fechas = entradas.map((e) => e.fecha).sort((a, b) => a - b);
  cacheRef = entradas;
  cacheLength = entradas.length;
  cacheFechas = fechas;
  return fechas;
}

export function calcularMetricasFeed(
  entradas: readonly EntradaRecepcion[],
  ahora: number
): MetricasFeed {
  // Ventana móvil de 60 s (todas las filas cuentan; la semilla de ingesta
  // quedó a 24–34 min — fuera de ventana por diseño).
  let llegadasVentana = 0;
  for (const e of entradas) {
    if (e.fecha > ahora - VENTANA_MS && e.fecha <= ahora) llegadasVentana += 1;
  }

  // Pico histórico: mejor ventana de 60 s anclada en cada llegada
  // (two-pointer sobre el orden cronológico — O(n) por tick, R-53(b)).
  let pico = 0;
  if (entradas.length > 0) {
    const fechas = fechasOrdenadas(entradas);
    let j = 0;
    for (let k = 0; k < fechas.length; k++) {
      while (fechas[k]! - fechas[j]! > VENTANA_MS) j++;
      const enVentana = k - j + 1;
      if (enVentana > pico) pico = enVentana;
    }
  }

  // Chip relativo al pico (documentado en el encabezado del módulo).
  const ratio = pico > 0 ? llegadasVentana / pico : 0;
  const tono: TonoRitmo =
    pico === 0 ? (llegadasVentana > 0 ? "OPTIMO" : "SIN_DATOS")
    : ratio >= 0.75 ? "OPTIMO"
    : ratio >= 0.45 ? "ESTABLE"
    : "LENTO";

  // Buckets de flujo: 1 barra = 1 segundo (los vacíos pisan la línea base).
  const baseSegundo = Math.floor(ahora / 1000);
  const buckets = new Array<number>(BUCKETS).fill(0);
  for (const e of entradas) {
    const segundo = Math.floor(e.fecha / 1000);
    const offset = baseSegundo - segundo;
    if (offset >= 0 && offset < BUCKETS) buckets[BUCKETS - 1 - offset] += 1;
  }

  // Latencia media solo con telemetría de origen (fecha ≥ fechaOrigen).
  let suma = 0;
  let muestras = 0;
  for (const e of entradas) {
    if (e.fechaOrigen === undefined) continue;
    if (e.fecha < e.fechaOrigen) continue; // dato incoherente → fuera
    suma += e.fecha - e.fechaOrigen;
    muestras += 1;
  }

  return {
    ritmo: llegadasVentana,
    pico,
    tono,
    buckets,
    latenciaMedia: muestras > 0 ? suma / muestras / 1000 : null,
    latenciaMuestras: muestras,
    llegadasVentana,
  };
}
