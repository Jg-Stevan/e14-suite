/**
 * R-54 — SNAPSHOT DE SESIÓN DEL PANEL (persistencia LOCAL mínima, IndexedDB).
 *
 * QUÉ ES: el estado en memoria del panel (actas runtime, log de recepción,
 * huellas anti-reproceso y decisiones de Recepción) sobrevive AHORA la
 * recarga de la página mediante un snapshot en IndexedDB LOCAL con
 * rehidratación perezosa al montar. Sin backend, sin red, sin export
 * estático nuevo.
 *
 * D8-excepción (2026-11-19, R-54): persistencia local IndexedDB del panel —
 * no cambia el export estático ni introduce backend.
 *
 * NOTA PARA EL ADR DEL PANEL (lista para copiar a docs/adr — este archivo
 * es su fuente):
 *   · Decisión — el panel de supervision persiste su sesión en IndexedDB
 *     LOCAL (`e14-panel-sesion-v1`) y la rehidrata de forma conservadora al
 *     montar. Excepción DOCUMENTADA de D8 ("memoria de sesión, recargar
 *     restablece"): persistencia LOCAL del panel, no remota.
 *   · Alcance — actas runtime (máx 200, clave `${idEnlace}::${mesa}`), log
 *     de recepción (máx 2.000 entradas más recientes), huellas anti-reproceso
 *     (P-22: SHA-256 + qrPayload + dhash64 por identidad de página) y
 *     decisiones de Recepción (R-55, store "meta", clave
 *     "decisiones-recepcion").
 *   · Excepción explícita dentro de la excepción — los dataURL de fotos
 *     (`srcFoto`) se serializan TAL CUAL: el panel corre en el PC del
 *     observatorio, el snapshot JAMÁS sale por red (ni fetch, ni beacon, ni
 *     WebSocket) y la cuota se acota con los límites duros de arriba. Es la
 *     misma disciplina LOCAL del ledger de masiva, con el límite L7 matizado
 *     para su caso de uso (aquí la foto ES el dato que el supervisor vio).
 *   · Fusion conservador — la rehidratación SOLO añade claves ausentes en
 *     memoria: lo que la sesión viva ya tiene (más nuevo) jamás se pisa.
 *   · Fallos — todo el módulo es jamás-throw: sin window/document/IndexedDB
 *     (SSR, bun test — incluso con el window falso de hub-local.test.ts) o
 *     ante cualquier error de IDB, las operaciones devuelven false y el
 *     panel sigue en memoria (mismo gesto conservador RL-e65b-3 de masiva).
 *
 * FORMA DE LOS STORES (versión 1):
 *   · "actas"     — keyPath "clave": { clave, acta: ActaRealLista }
 *   · "recepcion" — keyPath "id":   EntradaRecepcion tal cual
 *   · "meta"      — keyPath "clave": { clave: "cabecera" | "huellas-pagina" |
 *                   "decisiones-recepcion", ... }
 *
 * CUÁNDO SE ESCRIBE: tras cada publicación del embudo (publicarActaMasiva)
 * y tras cada decisión de Recepción, con DEBOUNCE de 2 s (timer de módulo)
 * — así las ráfagas (lote demo ×4) escriben UNA vez. El borrado explícito
 * solo ocurre en reiniciarDemoPanel (acción de usuario): la prueba vacía
 * (vaciarActasRuntimeParaPrueba) jamás toca el snapshot.
 *
 * CUÁNDO SE LEE: una sola vez por sesión — la primera llamada a
 * `suscribirseActasRuntime`/`consultarActaRuntime` dispara
 * `rehidratarSnapshotPanel()` (fire-and-forget: las funciones del runtime
 * son sincrónicas por contrato, el fusion conservador aterriza cuando la
 * promesa resuelve y notifica por los canales de siempre).
 */

import type { ActaRealLista } from "./actas-reales/actas-reales";
import {
  extraerActasParaSnapshot,
  extraerHuellasParaSnapshot,
  fusionarDesdeSnapshot,
  type HuellaPaginaSnapshot,
} from "./actas-runtime";
import {
  consultarRecepciones,
  fusionarRecepcionesDesdeSnapshot,
  type EntradaRecepcion,
} from "./recepcion-log";
import {
  extraerDecisionesParaSnapshot,
  fusionarDecisionesDesdeSnapshot,
  type DecisionRecepcion,
} from "./decisiones-recepcion";

const DB_NOMBRE = "e14-panel-sesion-v1";
const DB_VERSION = 1;
const STORE_ACTAS = "actas"; // keyPath "clave"
const STORE_RECEPCION = "recepcion"; // keyPath "id"
const STORE_META = "meta"; // keyPath "clave" (kv)

/** Clave del registro de decisiones de Recepción dentro del store "meta". */
export const CLAVE_DECISIONES = "decisiones-recepcion";

/** Límites duros de cuota (documentados en el ADR-copy del encabezado). */
export const LIMITE_ACTAS = 200;
export const LIMITE_RECEPCION = 2000;

/** Retraso del guardado con debounce (ráfagas del embudo → UNA escritura). */
export const RETRASO_GUARDADO_MS = 2000;

// ─── Contratos del snapshot (JSON puro — testeable sin IndexedDB) ───────────

export interface RegistroActaSnapshot {
  clave: string;
  acta: ActaRealLista;
}

export interface RegistroDecisionSnapshot {
  idEntrada: string;
  decision: DecisionRecepcion;
  nota?: string;
  ms: number;
  idEnlace: string;
  mesa: string;
}

/** Estado vivo del panel en su forma serializable (lo arman los módulos). */
export interface EstadoVivoPanel {
  actas: RegistroActaSnapshot[];
  recepcion: EntradaRecepcion[];
  huellas: HuellaPaginaSnapshot[];
  decisiones: RegistroDecisionSnapshot[];
}

/** Snapshot completo (la forma de los stores, plana para round-trip JSON). */
export interface SnapshotPanel {
  version: 1;
  /** Epoch ms de la escritura (diagnóstico; la rehidratación no lo usa). */
  ms: number;
  actas: RegistroActaSnapshot[];
  recepcion: EntradaRecepcion[];
  huellas: HuellaPaginaSnapshot[];
  decisiones: RegistroDecisionSnapshot[];
}

// ─── Funciones PURAS de serialización (sin DOM/IDB — test directo) ──────────

/**
 * Recorta las actas al límite duro: las PRIMERAS `limite` en orden de
 * inserción del runtime (≈ orden de publicación; el runtime no guarda
 * timestamps por acta — el orden de llegada es la señal disponible).
 */
export function recortarActas(
  actas: RegistroActaSnapshot[],
  limite: number = LIMITE_ACTAS
): RegistroActaSnapshot[] {
  return actas.slice(0, Math.max(0, limite));
}

/**
 * Recorta el log de recepción a las `limite` MÁS RECIENTES (el log llega
 * más-nuevas-primero — `unshift` en recepcion-log).
 */
export function recortarRecepcion(
  entradas: EntradaRecepcion[],
  limite: number = LIMITE_RECEPCION
): EntradaRecepcion[] {
  return entradas.slice(0, Math.max(0, limite));
}

/**
 * Serializa el estado vivo a la forma del snapshot. Pura: no lee módulos,
 * no toca DOM — la entrada llega completa (los límites se aplican aquí).
 */
export function serializarSnapshotPanel(
  estado: EstadoVivoPanel,
  ms: number
): SnapshotPanel {
  return {
    version: 1,
    ms,
    actas: recortarActas(estado.actas),
    recepcion: recortarRecepcion(estado.recepcion),
    huellas: estado.huellas,
    decisiones: estado.decisiones,
  };
}

// ─── Validación por ítem (conservador: lo malformado se salta, no aborta) ──

const ESTADOS_VALIDOS: ReadonlySet<string> = new Set([
  "PUBLICADA",
  "BLOQUEADA",
  "SIN_JOIN",
  "DUPLICADA",
]);

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function esActaValida(v: unknown): v is ActaRealLista {
  if (!esObjeto(v)) return false;
  return (
    typeof v.idEnlace === "string" &&
    v.idEnlace !== "" &&
    typeof v.mesa === "string" &&
    v.mesa !== "" &&
    esObjeto(v.fotos) &&
    esObjeto(v.impresion)
  );
}

function esEntradaValida(v: unknown): v is EntradaRecepcion {
  if (!esObjeto(v)) return false;
  return (
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.fecha === "number" &&
    Number.isFinite(v.fecha) &&
    typeof v.estado === "string" &&
    ESTADOS_VALIDOS.has(v.estado)
  );
}

function esHuellaValida(v: unknown): v is HuellaPaginaSnapshot {
  if (!esObjeto(v)) return false;
  return (
    typeof v.identidad === "string" &&
    v.identidad !== "" &&
    typeof v.huella === "string" &&
    typeof v.idRecepcion === "string"
  );
}

function esDecisionValida(v: unknown): v is RegistroDecisionSnapshot {
  if (!esObjeto(v)) return false;
  return (
    typeof v.idEntrada === "string" &&
    v.idEntrada !== "" &&
    (v.decision === "APROBADA" || v.decision === "RECHAZADA") &&
    typeof v.ms === "number" &&
    typeof v.idEnlace === "string" &&
    typeof v.mesa === "string"
  );
}

/**
 * Deserializa + valida un snapshot crudo (lo que sale de los stores o de un
 * JSON). Top-level malformado → null (nada que fusionar). Ítem malformado →
 * se salta ese ítem (el resto sigue — conservador, jamás throw).
 */
export function deserializarSnapshotPanel(bruto: unknown): SnapshotPanel | null {
  if (!esObjeto(bruto)) return null;
  if (bruto.version !== 1) return null;
  const actasCrudo = Array.isArray(bruto.actas) ? bruto.actas : [];
  const recepcionCrudo = Array.isArray(bruto.recepcion) ? bruto.recepcion : [];
  const huellasCrudo = Array.isArray(bruto.huellas) ? bruto.huellas : [];
  const decisionesCrudo = Array.isArray(bruto.decisiones)
    ? bruto.decisiones
    : [];
  const actas = actasCrudo.filter(
    (r): r is RegistroActaSnapshot =>
      esObjeto(r) && typeof r.clave === "string" && r.clave !== "" && esActaValida(r.acta)
  );
  const recepcion = recepcionCrudo.filter((e): e is EntradaRecepcion =>
    esEntradaValida(e)
  );
  const huellas = huellasCrudo.filter((h): h is HuellaPaginaSnapshot =>
    esHuellaValida(h)
  );
  const decisiones = decisionesCrudo.filter(
    (d): d is RegistroDecisionSnapshot => esDecisionValida(d)
  );
  return {
    version: 1,
    ms: typeof bruto.ms === "number" ? bruto.ms : 0,
    actas,
    recepcion,
    huellas,
    decisiones,
  };
}

// ─── Guard de entorno (el mismo gesto conservador de todo el módulo) ────────

/**
 * ¿Estamos en un navegador REAL con IndexedDB? SSR (window/document
 * ausentes) y bun test (no hay document ni indexedDB — ni siquiera con el
 * window falso que instala hub-local.test.ts) → false: el snapshot es un
 * no-op silencioso y el panel vive SOLO en memoria, como siempre.
 */
function entornoDisponible(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof indexedDB !== "undefined"
  );
}

// ─── IndexedDB (mismo patrón de historico.ts de masiva: singleton) ──────────

let dbSingleton: IDBDatabase | null = null;

/** Abrir (singleton) — patrón abrirCola()/abrirHistorico(). Rechazo CLARO;
 *  el caller traga (jamás throw hacia fuera). */
function abrirSnapshot(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbSingleton) {
      resolve(dbSingleton);
      return;
    }
    if (typeof indexedDB === "undefined") {
      reject(new Error("SIN_INDEXEDDB"));
      return;
    }
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ACTAS)) {
        db.createObjectStore(STORE_ACTAS, { keyPath: "clave" });
      }
      if (!db.objectStoreNames.contains(STORE_RECEPCION)) {
        db.createObjectStore(STORE_RECEPCION, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "clave" });
      }
    };
    req.onsuccess = () => {
      dbSingleton = req.result;
      // Higiene: conexión cerrada por el navegador → el próximo abrir re-crea.
      dbSingleton.onclose = () => {
        dbSingleton = null;
      };
      resolve(dbSingleton);
    };
    req.onerror = () => reject(req.error ?? new Error("IDB_NO_ABRIO"));
    req.onblocked = () => reject(new Error("IDB_BLOQUEADA"));
  });
}

function escribirStores(s: SnapshotPanel, db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ACTAS, STORE_RECEPCION, STORE_META], "readwrite");
    const actas = tx.objectStore(STORE_ACTAS);
    const recepcion = tx.objectStore(STORE_RECEPCION);
    const meta = tx.objectStore(STORE_META);
    // Escritura COMPLETA por versión: clear + put (el snapshot es la verdad
    // de la sesión al momento del guardado — no un delta).
    actas.clear();
    recepcion.clear();
    meta.clear();
    for (const r of s.actas) actas.put(r);
    for (const e of s.recepcion) recepcion.put(e);
    meta.put({ clave: "cabecera", version: s.version, ms: s.ms });
    meta.put({ clave: "huellas-pagina", huellas: s.huellas });
    meta.put({ clave: CLAVE_DECISIONES, decisiones: s.decisiones });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB_SNAPSHOT_PUT"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB_SNAPSHOT_PUT_ABORTADA"));
  });
}

function leerStores(db: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ACTAS, STORE_RECEPCION, STORE_META], "readonly");
    const pedir = (store: string) =>
      new Promise<unknown[]>((res, rej) => {
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res((req.result ?? []) as unknown[]);
        req.onerror = () => rej(req.error ?? new Error("IDB_SNAPSHOT_GETALL"));
      });
    Promise.all([
      pedir(STORE_ACTAS),
      pedir(STORE_RECEPCION),
      pedir(STORE_META),
    ])
      .then(resolve)
      .catch(reject);
    tx.onerror = () => reject(tx.error ?? new Error("IDB_SNAPSHOT_GETALL_TX"));
  });
}

// ─── API pública (todas jamás-throw: fallo = warn + false) ──────────────────

/**
 * Guarda el snapshot de la sesión (actas + recepción + huellas + decisiones)
 * en IndexedDB LOCAL. Devuelve true si la escritura aterrizó; false si el
 * entorno no está disponible o la escritura falló (jamás lanza).
 */
export async function guardarSnapshotPanel(): Promise<boolean> {
  if (!entornoDisponible()) return false;
  try {
    const estado: EstadoVivoPanel = {
      actas: recortarActas(extraerActasParaSnapshot()),
      recepcion: recortarRecepcion(consultarRecepciones()),
      huellas: extraerHuellasParaSnapshot(),
      decisiones: extraerDecisionesParaSnapshot(),
    };
    const snapshot = serializarSnapshotPanel(estado, Date.now());
    const db = await abrirSnapshot();
    await escribirStores(snapshot, db);
    return true;
  } catch (error) {
    console.warn(
      `[e14] snapshot del panel: no se pudo guardar (${String(error)}) — la sesión sigue en memoria`
    );
    return false;
  }
}

/**
 * Rehidrata el panel desde el snapshot (UNA sola vez por sesión): fusión
 * conservadora — solo claves AUSENTES en memoria (el estado vivo manda).
 * Devuelve true si fusionó al menos un registro; false si ya corrió, si no
 * hay snapshot servible o si algo falló (jamás lanza).
 */
let rehidratacionCorrida = false;

export async function rehidratarSnapshotPanel(): Promise<boolean> {
  if (rehidratacionCorrida) return false;
  rehidratacionCorrida = true;
  if (!entornoDisponible()) return false;
  try {
    const db = await abrirSnapshot();
    const [actasCrudo, recepcionCrudo, metaCrudo] = await leerStores(db);
    const metaRegistros = Array.isArray(metaCrudo) ? metaCrudo : [];
    const huellasCrudo = metaRegistros.find(
      (r): r is { clave: string; huellas: unknown } =>
        esObjeto(r) && r.clave === "huellas-pagina"
    )?.huellas;
    const decisionesCrudo = metaRegistros.find(
      (r): r is { clave: string; decisiones: unknown } =>
        esObjeto(r) && r.clave === CLAVE_DECISIONES
    )?.decisiones;
    const snapshot = deserializarSnapshotPanel({
      version: 1,
      actas: actasCrudo,
      recepcion: recepcionCrudo,
      huellas: huellasCrudo,
      decisiones: decisionesCrudo,
    });
    if (!snapshot) return false;
    const agregadas = fusionarDesdeSnapshot(snapshot.actas, snapshot.huellas);
    const recepcionAgregada = fusionarRecepcionesDesdeSnapshot(snapshot.recepcion);
    const decisionesAgregadas = fusionarDecisionesDesdeSnapshot(snapshot.decisiones);
    const total = agregadas + recepcionAgregada + decisionesAgregadas;
    if (total > 0) {
      console.info(
        `[e14] snapshot del panel: rehidratado (actas ${agregadas} · recepción ${recepcionAgregada} · decisiones ${decisionesAgregadas})`
      );
    }
    return total > 0;
  } catch (error) {
    console.warn(
      `[e14] snapshot del panel: no se pudo rehidratar (${String(error)}) — sesión en blanco`
    );
    return false;
  }
}

/**
 * Borra el snapshot PERSISTIDO (no la memoria). ÚNICO llamador de producción:
 * reiniciarDemoPanel (acción de usuario — evita que la recarga resucite el
 * rastro demo). La prueba vacía (vaciarActasRuntimeParaPrueba) JAMÁS llama
 * aquí. Jamás lanza.
 */
export async function borrarSnapshotPanel(): Promise<boolean> {
  if (!entornoDisponible()) return false;
  try {
    const db = await abrirSnapshot();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_ACTAS, STORE_RECEPCION, STORE_META], "readwrite");
      tx.objectStore(STORE_ACTAS).clear();
      tx.objectStore(STORE_RECEPCION).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IDB_SNAPSHOT_BORRAR"));
      tx.onabort = () => reject(tx.error ?? new Error("IDB_SNAPSHOT_BORRAR_ABORTADA"));
    });
    return true;
  } catch (error) {
    console.warn(
      `[e14] snapshot del panel: no se pudo borrar (${String(error)})`
    );
    return false;
  }
}

// ─── Debounce del guardado (timer de módulo — una escritura por ráfaga) ─────

let temporizadorGuardado: ReturnType<typeof setTimeout> | null = null;

/**
 * Agenda `guardarSnapshotPanel()` dentro de RETRASO_GUARDADO_MS (2 s).
 * Guard de entorno ANTES de agendar: en SSR/bun test ni siquiera se crea el
 * timer (el registro de módulos de bun test es compartido — nada de timers
 * colgados). Re-agendar reinicia el retraso (ráfaga → una escritura).
 */
export function agendarGuardadoSnapshot(): void {
  if (!entornoDisponible()) return;
  if (temporizadorGuardado !== null) clearTimeout(temporizadorGuardado);
  temporizadorGuardado = setTimeout(() => {
    temporizadorGuardado = null;
    void guardarSnapshotPanel();
  }, RETRASO_GUARDADO_MS);
}
