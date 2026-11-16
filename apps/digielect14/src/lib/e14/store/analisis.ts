/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE ANÁLISIS: el desenlace del
 * pipeline (actaActual, progreso, banderas de vuelo) y sus acciones —
 * analisisCompletado (auto-envío D4), el rescate post-timeout (e67), la
 * salida del ANALIZANDO estancado (Ola 3.2 U4) y la interrupción por
 * ocultamiento (KIT e14-remediacion-movil-v1 A3). Extraído de la ex
 * tienda-dios: mismo estado, mismas acciones, cero cambio de comportamiento.
 */
import { getBridge } from "../get-bridge";
import type { Acta, HistorialRow } from "@jg-stevan/scanner-core/dominio/types";
import type { AvisoOperador } from "../errores";
import { logger } from "../../logger";
import { cancelarGeneracionVigente } from "./generacion";
import { idHistorial, registrarEnvio, tituloPaginaActual } from "./envio";
import type { E14Get, E14Set, E14Store } from "./tipos";

/** KIT e14-optimizacion-v1 (T5): ids de acta ya contados en motivosNoEnvio —
 *  el recorte re-evaluado (analisisCompletado corre 2× con el mismo acta)
 *  no duplica. En memoria de sesión: se resetea al recargar, igual que el
 *  historial (kit §3-T5 — PROHIBIDO persistir). */
export const contadosNoEnvio = new Set<string>();

/** Slice análisis: estado inicial + desenlaces del pipeline. */
export function crearAnalisis(
  set: E14Set,
  get: E14Get,
): Pick<
  E14Store,
  | "actaActual"
  | "paginaObjetivo"
  | "progresoAnalisis"
  | "analisisResuelto"
  | "analisisEnVuelo"
  | "actasSesion"
  | "motivosNoEnvio"
  | "analisisCompletado"
  | "rescatarActaPostTimeout"
  | "cancelarAnalisis"
  | "interrumpirAnalisis"
  | "contarMotivoNoEnvioActa"
> {
  const bridge = getBridge();
  return {
    actaActual: null,
    paginaObjetivo: null,
    progresoAnalisis: null,
    analisisResuelto: false,
    analisisEnVuelo: false,
    actasSesion: 0,
    // KIT e14-optimizacion-v1 (T5): contador de sesión arranca vacío.
    motivosNoEnvio: {},

    // ─── Ola 3.2 (U4): cancelar el análisis estancado ───
    cancelarAnalisis: () => {
      if (get().vista !== "analizando") return;
      // El desenlace tardío del pipeline se descarta al resolver (sin abort
      // real en el bridge) — dirigido a LA generación en vuelo.
      cancelarGeneracionVigente("operador");
      // "Acta RECHAZADA con nota de diagnóstico": durante ANALIZANDO aún no
      // existe objeto Acta (el bridge no resolvió) — el registro HONESTO del
      // desenlace es la fila de historial RESCANEO_REQUERIDO (la MISMA que
      // estampa un rechazo real, analisisCompletado §F-6) con la nota en el
      // título + el contador de motivos no-envío. La página queda pendiente
      // de re-escaneo (solicitudesRescaneo +1) — jamás un fantasma ENVIADA.
      const fila: HistorialRow = {
        id: idHistorial(),
        titulo: `${tituloPaginaActual(get)} — CANCELADA POR EL OPERADOR`,
        estado: "RESCANEO_REQUERIDO",
        hora: bridge.horaHistorial(),
      };
      logger.info(
        "[e14] análisis cancelado por el operador (estancamiento) — nota: cancelada por el operador tras estancamiento",
      );
      const motivos = get().motivosNoEnvio;
      set({
        vista: "escanear",
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
        solicitudesRescaneo: get().solicitudesRescaneo + 1,
        historial: [fila, ...get().historial],
        motivosNoEnvio: {
          ...motivos,
          "rechazo:cancelada-por-operador":
            (motivos["rechazo:cancelada-por-operador"] ?? 0) + 1,
        },
      });
    },

    // ─── KIT e14-remediacion-movil-v1 (A3 — P0 #4): interrupción honesta ───
    // Espejo de cancelarAnalisis con motivo EXPLÍCITO: la app pasó a segundo
    // plano en mitad del análisis (los setTimeout quedan congelados y
    // performance.now() sigue avanzando — al volver, el watchdog dispararía
    // una RECHAZADA 0.0 sin haber analizado nada, informe §7). Aquí el
    // desenlace es «INTERRUMPIDA — repetir la foto», jamás un rechazo mudo.
    interrumpirAnalisis: () => {
      if (get().vista !== "analizando") return;
      // El desenlace tardío del pipeline se descarta/adopta al resolver (sin
      // abort real en el bridge) — solo para ESTA generación: si el operador
      // ya lanzó otro escaneo, el viejo no puede pisarlo (H1).
      cancelarGeneracionVigente("interrumpida");
      const fila: HistorialRow = {
        id: idHistorial(),
        titulo: `${tituloPaginaActual(get)} — INTERRUMPIDA`,
        estado: "RESCANEO_REQUERIDO",
        hora: bridge.horaHistorial(),
      };
      logger.info(
        "[e14] análisis interrumpido por ocultamiento — desenlace explícito: interrumpida",
      );
      const motivos = get().motivosNoEnvio;
      set({
        vista: "escanear",
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
        solicitudesRescaneo: get().solicitudesRescaneo + 1,
        historial: [fila, ...get().historial],
        motivosNoEnvio: {
          ...motivos,
          "rechazo:interrumpida-en-vuelo":
            (motivos["rechazo:interrumpida-en-vuelo"] ?? 0) + 1,
        },
        avisoVisor: {
          tipo: "info",
          motivo: "ANALISIS_INTERRUMPIDO",
          accion: null,
          ts: Date.now(),
        } satisfies AvisoOperador,
      });
    },

    // ─── e67-watchdog-rescate-v1 (cambio B): RESCATE POST-TIMEOUT ───
    rescatarActaPostTimeout: (vencida, real, tiempoRealMs) => {
      // Guarda de identidad POR REFERENCIA (espejo mejorarFotoActa): si el
      // usuario re-disparó, limpió o abrió otra acta, actaActual ya NO es
      // el acta que el watchdog rechazó → el rescate se descarta (jamás
      // pisa una captura nueva).
      if (get().actaActual !== vencida) {
        logger.info("[e14] rescate post-timeout omitido (la vista ya avanzó)", {
          actaId: real.id,
        });
        return;
      }
      // Solo desenlaces VÁLIDOS rescatan (el gate ya decidió dentro del
      // pipeline): RECHAZADA/EN_REVISION_HUMANA tardíos quedan como están
      // (correcto — caso C del kit: no se rescata lo inválido).
      if (real.status !== "OPTIMA" && real.status !== "ADVERTENCIA") {
        logger.info("[e14] pipeline terminó inválido tras timeout", {
          actaId: real.id,
          status: real.status,
          score: real.score,
        });
        return;
      }
      // Provenance honesto: el acta viaja marcada (scoreRescatadoPor/
      // tiempoRealMs — campos aditivos e67) y SIN rechazo (el rechazo era
      // del watchdog, no del gate).
      const rescatada: Acta = {
        ...real,
        rechazo: null,
        scoreRescatadoPor: "post-timeout",
        tiempoRealMs,
      };
      logger.info("[e14] RESCATE post-timeout", {
        actaId: rescatada.id,
        score: rescatada.score,
        tiempoRealMs,
      });
      // Deshacer el RESCANEO_REQUERIDO que analisisCompletado estampó para
      // el rechazo (350 ms tras resolver el watchdog) — SOLO si la ÚLTIMA
      // fila del historial sigue siendo ese rechazo de ESTA página (el
      // usuario no avanzó); si no matchea, se conserva (jamás borrar de más).
      const historial = [...get().historial];
      const primera = historial[0];
      const deshaceFila =
        !!primera &&
        primera.estado === "RESCANEO_REQUERIDO" &&
        primera.titulo === tituloPaginaActual(get);
      if (deshaceFila) historial.shift();
      set({
        actaActual: rescatada,
        ...(deshaceFila
          ? {
              historial,
              solicitudesRescaneo: Math.max(0, get().solicitudesRescaneo - 1),
            }
          : {}),
      });
      // Desenlace POR LA MISMA RUTA del flujo normal (analisisCompletado):
      // OPTIMA → auto-envío D4 (registrarEnvio + ENVIADA); ADVERTENCIA →
      // motivo no-envío + REVISIÓN. En "analizando" NO se llama: el propio
      // AnalyzingView dispara analisisCompletado leyendo actaActual YA
      // rescatada (doble llamada = doble registrarEnvio — jamás).
      if (get().vista !== "analizando") void get().analisisCompletado();
    },

    analisisCompletado: async () => {
      const { actaActual } = get();
      if (!actaActual) return;
      // C-10 — obs sin PII: acta que entra a REVISIÓN sin payload QR
      // («qr_ausente» — contador uso, el flush lo hace el subsistema). SIM
      // no cuenta (la demo jamás contamina la señal de campo).
      if (actaActual.qrPayload == null && actaActual.fuente !== "SIMULACION") {
        try {
          const uso = await import("../obs/uso");
          void uso.registrarUso("revision", "qr_ausente");
        } catch {
          /* la obs jamás rompe el flujo */
        }
      }
      // D4: ÓPTIMA (≥8) se envía automáticamente al capturar. Offline → el
      // estado persistente vive en la NUBE del TopBar (roja) + la cola de
      // RESUMEN (redesign-stitch §4.3).
      if (actaActual.status === "OPTIMA") {
        const hora = bridge.horaEnvio();
        await registrarEnvio(set, get, tituloPaginaActual(get));
        set({
          actaActual: {
            ...get().actaActual!,
            status: "ENVIADA",
            enviadoAutomaticamente: hora,
          },
          vista: "revision",
        });
        return;
      }
      // KIT e14-optimizacion-v1 (T5), extraído a contarMotivoNoEnvioActa por
      // e14-carga-masiva-v1 (T3.2): contador «por qué no se envió» — espejo
      // pasivo de desenlaces YA ocurridos (todas las ramas no-OPTIMA). SOLO
      // aquí (kit §3-T5): el recorte re-evaluado no duplica (Set
      // contadosNoEnvio por id). Claves byte-idénticas al refactor.
      get().contarMotivoNoEnvioActa(actaActual);
      if (actaActual.status === "RECHAZADA") {
        const fila: HistorialRow = {
          id: idHistorial(),
          titulo: tituloPaginaActual(get),
          estado: "RESCANEO_REQUERIDO",
          hora: bridge.horaHistorial(),
        };
        set({
          solicitudesRescaneo: get().solicitudesRescaneo + 1,
          historial: [fila, ...get().historial],
        });
        // §F-6 (SPEC-camara-funcional) → redesign-stitch §4.3: el motivo del
        // rechazo ya vive PERSISTENTE en la REVISIÓN (píldora de estado +
        // banner + píldora flotante de la tarjeta con el motivo REAL:
        // INCOMPLETA/BAJO/GENÉRICO — D1/PR #33). Sin toast.
      }
      set({ vista: "revision" });
    },

    contarMotivoNoEnvioActa: (acta) => {
      // Lógica EXTRAÍDA de analisisCompletado (kit e14-optimizacion-v1 T5,
      // A2) por e14-carga-masiva-v1 (T3.2) — MISMAS claves, mismo Set
      // anti-dup por id, mismo incremento: byte-idéntico (kit §5-T3.2).
      if (contadosNoEnvio.has(acta.id)) return;
      let clave: string | null = null;
      if (acta.status === "ADVERTENCIA") {
        const techo = acta.diagnostico?.score?.techos[0];
        clave = techo ? `advertencia:${techo}` : "advertencia:sin-diag";
      } else if (acta.status === "EN_REVISION_HUMANA") {
        const nivel = acta.clasificacion?.nivel;
        clave = nivel ? `revision:clasif-${nivel}` : "revision:sin-diag";
        // KIT e63f-autoenvio-v1 (F0 — balde fino, solo-aditivo): clave NUEVA
        // `revision:clasif-<nivel>:<motivo>` con el motivo EXACTO del
        // clasificador (clasifDebil — puesto-lugar/tipo/mesa-registro/ruta).
        // Las claves viejas (`revision:clasif-<nivel>`) quedan INTACTAS y
        // siguen contando byte-idénticas (nada que las consume se rompe).
        const motivo = acta.clasificacion?.clasifDebil;
        if (nivel && motivo) {
          const actualesFino = get().motivosNoEnvio;
          const claveFina = `revision:clasif-${nivel}:${motivo}`;
          set({
            motivosNoEnvio: {
              ...actualesFino,
              [claveFina]: (actualesFino[claveFina] ?? 0) + 1,
            },
          });
        }
      } else if (acta.status === "RECHAZADA") {
        clave = `rechazo:${acta.rechazo?.tipo.toLowerCase() ?? "desconocido"}`;
      }
      if (clave) {
        contadosNoEnvio.add(acta.id);
        const actuales = get().motivosNoEnvio;
        set({
          motivosNoEnvio: { ...actuales, [clave]: (actuales[clave] ?? 0) + 1 },
        });
      }
    },
  };
}
