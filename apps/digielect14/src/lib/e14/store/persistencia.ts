/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE PERSISTENCIA: la jornada (KIT L6)
 * — arranque/reinicio, el persister por suscripción (una sola fuente), la
 * cuota del almacenamiento (Ola 6.10) y la re-hidratación pasiva entre
 * pestañas (Ola 6.12). Extraído de la ex tienda-dios: mismas claves IDB,
 * misma semántica, cero cambio de comportamiento.
 */
import {
  emitirJornadaCambiada,
  reclamarEdicionExclusiva,
  suscribirseAJornadaCambiada,
} from "../sincronia-pestanas";
import {
  cargarJornada,
  guardarActaEnRevision,
  guardarJornada,
  leerActaEnRevision,
  TOPE_HISTORIAL,
} from "../jornada";
import { clasificarErrorPipeline } from "../errores";
import type { Acta } from "@jg-stevan/scanner-core/dominio/types";
import { logger } from "../../logger";
import { contadosNoEnvio } from "./analisis";
import { derivarMesasConDivipol } from "./guion";
import type { E14Get, E14Set, E14Store, E14StoreApi } from "./tipos";

// ---------- KIT L6: estado del PERSISTER (módulo — declarado ANTES de que
// la fachada cree la tienda para excluir cualquier TDZ con HMR re-evaluando
// el módulo) ----------
let arrancada = false; // idempotencia de arrancarJornada (doble montaje incl.)
let persisterActivo = false; // gate multi-instancia (se abre al terminar arrancarJornada)
// FIX (hallazgo E2E #2): arranca en null (NO undefined) — igual que el
// actaActual inicial del store. Con undefined, el PRIMER set del arranque
// (ScanView montando, antes de que arrancarJornada lea el slot) disparaba
// la suscripción con actaActual=null ≠ undefined → limpiaba el slot del
// acta en revisión ANTES de poder restaurarlo (la recarga perdía el acta).
let ultimaActaPersistida: Acta | null | undefined = null;
let ultimoEstadoJson = "";

// ---------- Ola 6.12 (parte store): firma BARATA del suscriptor ----------
// Antes de serializar el estado completo se compara por REFERENCIA de los
// objetos persistidos + contadores escalares: un tick de progreso
// (progresoAnalisis) o cualquier set de UI NO debe pagar un
// JSON.stringify del estado. Zustand reemplaza los objetos en cada set →
// la identidad de referencia es el detector exacto de cambio por campo.
let ultimaFirmaBarata = "";
let refArchivadas: unknown = null;
let refHistorial: unknown = null;
let refMotivosNoEnvio: unknown = null;
let refPuestoActual: unknown = null;

// ---------- Ola 6.10 (parte store): cuota + persistencia del almacenamiento ----------
// jornada.ts traga sus errores de IDB internamente (archivo intocable para
// esta ola) → el rechazo QuotaExceeded jamás llega al call-site. El store
// cubre el hueco con dos redes: catch defensivo en las llamadas + sondeo
// navigator.storage.estimate() tras las escrituras GRANDES (slot del acta,
// 2.4–16.9 MB por acta) con umbral de alerta. Sin pérdida silenciosa: el
// aviso ALMACENAMIENTO_LLENO es accionable y persistente.
const UMBRAL_CUOTA = 0.9; // ≥90 % del origen → avisar
let ultimaVigilanciaCuota = 0; // throttle del sondeo estimate (60 s)

/** ¿el error ES de cuota? (por nombre o mensaje — cubre los 3 navegadores). */
function esErrorCuota(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown };
  const nombre = typeof e.name === "string" ? e.name.toLowerCase() : "";
  const mensaje = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    nombre === "quotaexceedederror" ||
    nombre === "ns_error_dom_quota_reached" ||
    /quota|almacenamiento lleno/.test(mensaje)
  );
}

/** Sube el aviso ALMACENAMIENTO_LLENO del visor (una vez — si ya está en
 *  pantalla no se re-monta; es persistente hasta descarte, 4.3.1). */
function avisarAlmacenamientoLleno(get: E14Get): void {
  try {
    if (get().avisoVisor?.motivo === "ALMACENAMIENTO_LLENO") return;
    get().mostrarAvisoVisor({
      tipo: "error",
      motivo: "ALMACENAMIENTO_LLENO",
      accion: null, // la acción es del mantenedor (enviar/eliminar) — solo descartable
    });
  } catch {
    /* regla de oro: el aviso jamás rompe la escritura */
  }
}

/** Red 1 del manejo de cuota: catch del call-site (por si un día jornada.ts
 * re-lanza; HOY traga dentro — ver comentario del bloque). */
function manejarErrorEscrituraIdb(get: E14Get, err: unknown): void {
  try {
    if (esErrorCuota(err) || clasificarErrorPipeline(err) === "ALMACENAMIENTO_LLENO") {
      logger.error("[e14] IDB sin cuota — jornada/slot sin persistir (aviso al operador)", err);
      avisarAlmacenamientoLleno(get);
      return;
    }
    // Otros fallos de IDB: la jornada vive en RAM (política del módulo) —
    // razonable en consola, sin aviso (no es algo que el operador pueda arreglar).
    logger.warn("[e14] escritura IDB falló (la jornada vive en RAM)", err);
  } catch {
    /* silencioso */
  }
}

/** Red 2 del manejo de cuota: sondeo estimate() tras las escrituras grandes
 *  (slot del acta). Throttle 60 s — estimate() es async y no es gratis. */
async function vigilarCuotaTrasEscrituraGrande(get: E14Get): Promise<void> {
  try {
    const ahora = Date.now();
    if (ahora - ultimaVigilanciaCuota < 60_000) return;
    ultimaVigilanciaCuota = ahora;
    if (typeof navigator === "undefined") return;
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota || est.usage == null) return;
    if (est.usage / est.quota < UMBRAL_CUOTA) return;
    logger.warn("[e14] cuota del origen ≥90 %", { usage: est.usage, quota: est.quota });
    avisarAlmacenamientoLleno(get);
  } catch {
    /* sin estimate() (Firefox privado) → nada — regla de oro */
  }
}

/** Ola 6.10: pide persistencia del almacenamiento UNA sola vez por sesión
 *  (guard con bandera de módulo). Sin la marca, el navegador puede expulsar
 *  la IDB de la jornada bajo presión de espacio (evicción best-effort). */
let persistAlmacenamientoPedido = false;
async function pedirPersistenciaAlmacenamiento(): Promise<void> {
  if (persistAlmacenamientoPedido) return;
  persistAlmacenamientoPedido = true;
  try {
    if (typeof navigator === "undefined") return;
    const storage = navigator.storage;
    if (!storage?.persist) return;
    const ya = await storage.persisted();
    if (!ya) await storage.persist();
  } catch {
    /* sin persist() o denegado → best-effort igual que hoy (regla de oro) */
  }
}

/** Ola 6.12: re-hidratación PASIVA de la jornada cuando OTRA pestaña avisa
 *  que persistió. Sobreescribe SOLO el estado liviano (jamás el acta en
 *  revisión ni la vista) y se salta a sí misma si hay un análisis en vuelo.
 *  Escritor simultáneo → último-escritor-gana (igual que hoy, sin locks). */
async function rehidratarJornadaPasiva(set: E14Set, get: E14Get): Promise<void> {
  try {
    const antes = get();
    if (antes.vista === "analizando") return; // pasiva: nada en vuelo
    const j = await cargarJornada();
    if (!j) return;
    set({
      archivadas: j.archivadas,
      puestoActual: j.puestoActual,
      historial: j.historial.slice(0, TOPE_HISTORIAL),
      completadas: j.completadas,
      asignadasHoy: Math.max(j.asignadasHoy, j.completadas),
      actasSesion: j.actasSesion,
      colaOffline: j.colaOffline,
      solicitudesRescaneo: j.solicitudesRescaneo,
      motivosNoEnvio: j.motivosNoEnvio,
    });
    // mesas DERIVADAS del puesto real (fix M10) — solo fuera del SIM. C-11:
    // mismo helper único (antes re-implementado aquí).
    const puesto = j.puestoActual;
    if (puesto && !get().modoSimulacion) {
      void derivarMesasConDivipol(j.archivadas, puesto)
        .then((derivadas) => {
          if (derivadas && !get().modoSimulacion) {
            set({ mesas: derivadas });
          }
        })
        .catch(() => {
          /* sin base → mesas queda como esté (degradación honesta) */
        });
    }
  } catch {
    /* regla de oro: la sincronía jamás rompe la app */
  }
}

/** Slice persistencia: estado inicial + arranque/reinicio de la jornada. */
export function crearPersistencia(
  set: E14Set,
  get: E14Get,
): Pick<E14Store, "asignadasHoy" | "arrancarJornada" | "reiniciarJornada"> {
  return {
    asignadasHoy: 0,

    // ---------- KIT L6: persistencia de la jornada ----------

    arrancarJornada: async () => {
      if (arrancada) return; // idempotente (StrictMode double-mount incl.)
      arrancada = true;
      // Ola 6.10 (parte store): persistencia del almacenamiento UNA vez
      // (init del store en cliente — el shell llama arrancarJornada al monte).
      void pedirPersistenciaAlmacenamiento();
      // Ola 6.12 (parte store): edición exclusiva entre pestañas. Sin lock →
      // aviso INFO pasajero (OTRA_PESTANA_ACTIVA) — nunca bloquea el arranque.
      try {
        const exclusiva = await reclamarEdicionExclusiva();
        if (!exclusiva) {
          get().mostrarAvisoVisor({
            tipo: "info",
            motivo: "OTRA_PESTANA_ACTIVA",
            accion: null,
          });
        }
      } catch {
        /* regla de oro: el lock jamás tumba el arranque */
      }
      // Ola 6.12: «jornada-cambiada» de OTRA pestaña → re-hidratar pasivo
      // (suscripción única — el guard `arrancada` hace el efecto idempotente).
      suscribirseAJornadaCambiada(() => {
        void rehidratarJornadaPasiva(set, get);
      });
      try {
        const j = await cargarJornada();
        if (!j) return; // arranque fresco (seed demo, como hoy)
        // El operador pudo disparar un escaneo antes de que la carga
        // resolviera (IDB lento): su actividad MANDA — no se pisa nada.
        if (get().actasSesion > 0 || get().actaActual) return;
        set({
          archivadas: j.archivadas,
          puestoActual: j.puestoActual,
          historial: j.historial,
          completadas: j.completadas,
          asignadasHoy: Math.max(j.asignadasHoy, j.completadas),
          actasSesion: j.actasSesion,
          colaOffline: j.colaOffline,
          solicitudesRescaneo: j.solicitudesRescaneo,
          motivosNoEnvio: j.motivosNoEnvio,
        });
        // mesas: DERIVADAS del puesto real (fix M10 — jamás el guion SIM).
        // C-11: mismo helper único (antes re-implementado aquí).
        const puesto = j.puestoActual;
        if (puesto && !get().modoSimulacion) {
          try {
            const derivadas = await derivarMesasConDivipol(j.archivadas, puesto);
            if (derivadas && !get().modoSimulacion) {
              set({ mesas: derivadas });
            }
          } catch {
            /* sin base → mesas queda en seed (degradación honesta) */
          }
        }
        // Acta que quedó a mitad de REVISIÓN (crash/recarga) — se restaura
        // con TODO: recorte, filtros y envío manual siguen intactos.
        const acta = await leerActaEnRevision();
        if (acta && !get().actaActual && get().actasSesion === j.actasSesion) {
          set({ actaActual: acta, vista: "revision" });
        }
      } catch {
        /* IDB caída → arranque fresco (la jornada vive en RAM, honesto) */
      } finally {
        // FIX (hallazgo E2E #3 — multi-instancia): el persister NO escribe
        // hasta que el arranque TERMINÓ. Antes, una segunda pestaña/instancia
        // que booteaba fresca sobrescribía la jornada persistida con su seed
        // ANTES de que cargarJornada pudiera restaurarla (la recarga en la
        // pestaña original perdía todo). Con el gate: toda instancia PRIMERO
        // restaura (o confirma que no hay nada) y solo entonces persiste.
        persisterActivo = true;
      }
    },

    reiniciarJornada: async () => {
      // El ciclo de intentos/estados en vuelo no sobrevive al reinicio.
      contadosNoEnvio.clear();
      set({
        vista: "escanear",
        actaActual: null,
        paginaObjetivo: null,
        progresoAnalisis: null,
        analisisResuelto: false,
        recortando: false,
        errorRecorte: null,
        revelando: false,
        // Jornada REAL a cero (nuevo día de votación) — KIT e14-sin-relleno-v1:
        // a cero HONESTO (sin seed demo; el demo solo con «SIM» encendido).
        archivadas: {},
        puestoActual: null,
        historial: [],
        completadas: 0,
        asignadasHoy: 0,
        actasSesion: 0,
        colaOffline: 0,
        solicitudesRescaneo: 0,
        motivosNoEnvio: {},
        // Overlays y guiones también nacen frescos.
        mesas: [],
        modoSimulacion: false,
        simCompleta: false,
        simUltima: null,
      });
      // Slot del acta en revisión FUERA (el estado liviano se re-persiste
      // fresco por el suscriptor de abajo).
      void guardarActaEnRevision(null);
    },
  };
}

// ---------- KIT L6: persistencia por SUSCRIPCIÓN (una sola fuente) ----------
// El estado liviano se persiste en cada cambio REAL (comparación por JSON —
// el tick del SIM solo toca mesas/simUltima/simCompleta, que NO están en el
// slice → cero escrituras espurias, D6 intacto). El acta en revisión se
// persiste por IDENTIDAD de referencia (stringify de ~14 MB en cada set
// sería prohibitivo — el cambio de referencia es el evento exacto).
// SIMULACIÓN jamás ocupa el slot del acta.
// La fachada llama a ESTA instalación justo después de crear la tienda
// (mismo momento que tenía el bloque a pie de módulo del store original).
export function instalarPersister(store: E14StoreApi): void {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  store.subscribe((s) => {
    // Gate multi-instancia: sin arranque completado no se persiste NADA
    // (ni el estado ni el slot del acta) — ver comentario del finally.
    if (!persisterActivo) return;
    // Ola 6.12 — GATE BARATO por referencias+contadores: un tick de progreso
    // (progresoAnalisis) o cualquier set de UI no paga stringify. Zustand
    // reemplaza los objetos en cada set → la referencia es el detector
    // exacto de cambio por campo (los escalares van por valor).
    const firmaBarata = `${s.completadas}|${s.asignadasHoy}|${s.actasSesion}|${s.colaOffline}|${s.solicitudesRescaneo}|${s.historial.length}`;
    if (
      firmaBarata !== ultimaFirmaBarata ||
      s.archivadas !== refArchivadas ||
      s.historial !== refHistorial ||
      s.motivosNoEnvio !== refMotivosNoEnvio ||
      s.puestoActual !== refPuestoActual
    ) {
      ultimaFirmaBarata = firmaBarata;
      refArchivadas = s.archivadas;
      refHistorial = s.historial;
      refMotivosNoEnvio = s.motivosNoEnvio;
      refPuestoActual = s.puestoActual;
      const estado = {
        version: 1,
        archivadas: s.archivadas,
        puestoActual: s.puestoActual,
        historial: s.historial.slice(0, TOPE_HISTORIAL),
        completadas: s.completadas,
        asignadasHoy: s.asignadasHoy,
        actasSesion: s.actasSesion,
        colaOffline: s.colaOffline,
        solicitudesRescaneo: s.solicitudesRescaneo,
        motivosNoEnvio: s.motivosNoEnvio,
      };
      const json = JSON.stringify(estado);
      if (json !== ultimoEstadoJson) {
        ultimoEstadoJson = json;
        // Ola 6.10: cuota con aviso accionable (sin pérdida silenciosa) ·
        // Ola 6.12: emitir «jornada-cambiada» SOLO tras persistir.
        void guardarJornada(estado)
          .then(() => {
            emitirJornadaCambiada();
          })
          .catch((err: unknown) => {
            manejarErrorEscrituraIdb(store.getState, err);
          });
      }
    }
    if (s.actaActual !== ultimaActaPersistida) {
      ultimaActaPersistida = s.actaActual;
      const persistible =
        s.actaActual && s.actaActual.fuente !== "SIMULACION" // chips/demo jamás ocupan el slot
          ? s.actaActual
          : null;
      // Ola 6.10: la escritura GRANDE del slot (fotos como Blobs) es la que
      // puede reventar la cuota → vigilancia estimate() tras escribir.
      void guardarActaEnRevision(persistible)
        .then(() => {
          return vigilarCuotaTrasEscrituraGrande(store.getState);
        })
        .catch((err: unknown) => {
          manejarErrorEscrituraIdb(store.getState, err);
        });
    }
  });
}
