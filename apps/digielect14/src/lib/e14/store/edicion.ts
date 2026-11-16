/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE EDICIÓN (REVISIÓN): las
 * herramientas del editor sobre el acta en revisión — recorte manual
 * (KIT e14-recorte-manual-v1), rotación rápida, revelado de filtros (F2),
 * re-reconocimiento OCR (F-OCR) y el upgrade silencioso full-res (G3).
 * Extraído de la ex tienda-dios: mismo estado, mismas acciones, cero cambio
 * de comportamiento.
 */
import { getBridge } from "../get-bridge";
import { rotateProcessedDataUrl } from "@jg-stevan/scanner-core/dominio/image-utils";
import { ocrTextIsValid } from "@jg-stevan/scanner-core/core/ocr";
import { leerFlags } from "../flags";
import { logger } from "../../logger";
import { registrarEnvio, tituloPaginaActual } from "./envio";
import type { E14Get, E14Set, E14Store } from "./tipos";

// KIT e14-recorte-manual-v1 (T2): copy del aviso cuando el pipeline del
// RECORTE falla (error duro). Mismo tono corto/sin guía del repo (D1/gate-v2);
// se pinta como píldora en REVISIÓN — no hay toasts (redesign-stitch D2).
const MSG_RECORTE_FALLIDO = "NO SE PUDO RECORTAR — INTENTA DE NUEVO";

/** Guard anti doble-rotación (espejo del rotatingRef del lab L1054 — la
 *  rotación rápida es async y un doble tap giraría 180°). */
let rotandoFotoEnVuelo = false;

/** Slice edición: estado inicial + herramientas del editor. */
export function crearEdicion(
  set: E14Set,
  get: E14Get,
): Pick<
  E14Store,
  | "recortando"
  | "errorRecorte"
  | "revelando"
  | "aplicarRecorte"
  | "rotarFoto"
  | "cambiarFiltro"
  | "reconocerTextoActa"
  | "mejorarFotoActa"
> {
  const bridge = getBridge();
  return {
    recortando: false,
    // KIT e14-recorte-manual-v1 (T2): sin error de recorte al arrancar.
    errorRecorte: null,
    revelando: false,

    aplicarRecorte: async (quad, rotacionNueva) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        return false;
      }
      // FIX M5 (auditoría 2-b): guard SIMÉTRICO — un upgrade silencioso en
      // vuelo (revelando, ~15 s) compite por el wasm y su resolve tardío
      // sobrescribiría el acta recortada (mismo patrón que mejorarFotoActa).
      if (get().recortando || get().revelando) return false;
      // KIT e14-recorte-manual-v1 (T2): cada intento NACE sin error previo.
      set({ recortando: true, progresoAnalisis: null, errorRecorte: null });
      try {
        // RecorTE manual → pipeline §5 re-ejecutado con F5-MANUAL; el acta
        // conserva identidad (intento/fuente/paginación) — rescate sin intento.
        // F4/D37: la rotación LOCAL del editor se hornea en fotoProcesada.
        const acta = await bridge.recortar(
          actaActual,
          quad,
          (p) => set({ progresoAnalisis: p }),
          rotacionNueva,
          undefined,
          // KIT e14-esquinas-suaves-v1 (Q2): recorte del editor = decisión CON VISTA
          // (escudo-manual: la tinta al filo del crop manual nunca RECHAZA).
          true,
        );
        set({ actaActual: acta, progresoAnalisis: null });
        // G4 (KIT e14-gate-v2): flujo post-recorte NORMAL — el recorte
        // re-evalúa y si el gate da OPTIMA+AUTO se auto-envía como
        // CUALQUIER captura (mismo camino de analisisCompletado D4).
        // Adiós la excepción D20 «el rescate nunca se auto-envía»: sin
        // flag, sin banner de envío manual y sin CTA especial. La razón
        // de ser de D20 (no hay doble transmisión) se conserva por otra
        // vía: el recorte SOLO existe en actas NO enviadas.
        // KIT e14-autoenvio-recorte-v1: flag autoEnvioConRecorte — si
        // false, el recorte NUNCA auto-envía aunque pase a OPTIMA.
        const { autoEnvioConRecorte } = leerFlags();
        if (acta.status === "OPTIMA" && autoEnvioConRecorte) {
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
          // KIT e14-recorte-manual-v1 (T2): resolvió (éxito) — el editor
          // puede cerrarse.
          return true;
        }
        // El desenlace (SIGUE RECHAZADA / SIN_VOTOS / ADVERTENCIA…) vive
        // PERSISTENTE en la píldora de estado de la REVISIÓN (§4.3).
        // KIT e14-recorte-manual-v1 (T2): resolvió (incluye el timeout-
        // controlado — el acta RECHAZADA por tiempo ya muestra el recorte
        // horneado, T1). El editor SÍ se cierra.
        return true;
      } catch (err) {
        // KIT e14-recorte-manual-v1 (T2): el fallo DEJA DE SER SILENCIOSO —
        // razonable en consola + aviso visible con el mecanismo del repo
        // (sin toasts — redesign-stitch D2 los retiró): píldora en REVISIÓN.
        // El editor NO se cierra (onAplicar cierra solo con `true`) — el
        // mantenedor reintenta SIN perder su quad. El gate/score no cambian.
        logger.error("[e14] aplicarRecorte falló:", err);
        set({ progresoAnalisis: null, errorRecorte: MSG_RECORTE_FALLIDO });
        // Auto-limpieza ~6 s (guard por mensaje: no borra un error MÁS NUEVO).
        setTimeout(() => {
          if (get().errorRecorte === MSG_RECORTE_FALLIDO) set({ errorRecorte: null });
        }, 6000);
        return false;
      } finally {
        set({ recortando: false });
      }
    },

    rotarFoto: async () => {
      const { actaActual } = get();
      // Actas con foto procesada (D35: SIMULACIÓN también — el gate es la foto;
      // F-ROT-RAPID gira la PROCESADA sin re-ejecutar el pipeline).
      if (!actaActual?.fotoProcesada) return;
      if (rotandoFotoEnVuelo) return;
      rotandoFotoEnVuelo = true;
      try {
        // F-ROT-RAPID del lab (L1080): gira la PROCESADA sin re-ejecutar el
        // pipeline; la rotación queda HORNEADA (rotation += 90) para que el
        // PDF §6 y un eventual re-recorte la respeten.
        const { url } = await rotateProcessedDataUrl(actaActual.fotoProcesada, 90);
        set({
          actaActual: {
            ...actaActual,
            fotoProcesada: url,
            rotation: ((actaActual.rotation ?? 0) + 90) % 360,
          },
        });
      } catch {
        // La rotación fallida no cambia estado — el acta conserva su foto.
      } finally {
        rotandoFotoEnVuelo = false;
      }
    },

    cambiarFiltro: async (filtro) => {
      const { actaActual } = get();
      if (!actaActual?.fotoOriginal) {
        return;
      }
      if (get().revelando) return;
      set({ revelando: true });
      try {
        // F2/D36: revelar = SOLO processImage (sin re-OCR/re-calidad — igual
        // que setFilterOnPage del core); el acta conserva identidad por spread.
        const acta = await bridge.revelar(actaActual, filtro);
        // FIX M5 (auditoría 2-b): re-validación de identidad al resolver —
        // un recorte aplicado durante el revelado (~1-3 s) NO debe ser
        // sobrescrito por la foto SIN recorte de este resolve (patrón del
        // upgrade silencioso del lab, L1008 del propio store).
        if (get().actaActual !== actaActual) return;
        set({ actaActual: acta });
        // El feedback persistente es la PROPIA foto re-velada + el chip del
        // filtro activo en el sheet (§4.3 del redesign-stitch — sin toast).
      } catch {
        // el revelado es un preview: al fallar, el acta conserva la foto y el filtro anterior
        logger.debug("[e14] revelado del filtro falló — la foto anterior queda", { filtro });
        set({ actaActual: actaActual });
      } finally {
        set({ revelando: false });
      }
    },

    reconocerTextoActa: async () => {
      const { actaActual } = get();
      // Guard (spec §F2.1): sin foto procesada no hay nada que reconocer.
      // (El estado "corriendo" — ocrRunning del lab L347 — vive en ReviewView.)
      if (!actaActual?.fotoProcesada) {
        return;
      }
      try {
        const texto = await bridge.reconocerTexto(actaActual);
        // Fuente: apps/scanner-lab/src/components/scanner/EditorView.tsx L1380-1387
        // (ocrTextIsValid → guardar; «sin texto» se muestra persistente en el
        // propio sheet: contadores a 0 + nota OCR_NO_TEXT del lab).
        if (ocrTextIsValid(texto)) {
          set({ actaActual: { ...actaActual, ocrTexto: texto } });
        }
      } catch {
        // Error de reconocimiento: los contadores del sheet quedan como están.
      }
    },

    mejorarFotoActa: async (fotoNueva, objetivo) => {
      const { actaActual } = get();
      // Guardas del lab L1818-1832 (silenciosas — el upgrade JAMÁS rompe nada):
      // identidad de la captura (el usuario pudo re-disparar/editar), acta ya
      // enviada (nada que mejorar), recorte del editor en vuelo (el rescate manda).
      if (!actaActual || actaActual !== objetivo) return;
      if (actaActual.status === "ENVIADA") return;
      if (get().recortando || get().revelando) return;
      if (!actaActual.fotoOriginal) return;
      set({ revelando: true }); // RECORTAR queda fuera durante el re-proceso
      try {
        const acta = await bridge.mejorarResolucion(objetivo, fotoNueva, (p) =>
          set({ progresoAnalisis: p }),
        );
        // El usuario pudo actuar mientras el upgrade volaba (~15 s): solo
        // escribo si el acta SIGUE siendo la misma (misma identidad del lab).
        if (get().actaActual !== objetivo) return;
        set({ actaActual: acta, progresoAnalisis: null });
        // G4 (KIT e14-gate-v2) — MISMO patrón de aplicarRecorte: el upgrade
        // re-evalúa y si el gate da OPTIMA se auto-envía como CUALQUIER
        // captura (mismo camino de analisisCompletado D4).
        if (acta.status === "OPTIMA") {
          const hora = bridge.horaEnvio();
          await registrarEnvio(set, get, tituloPaginaActual(get));
          // FIX M7 (auditoría 2-b): NO teletransportar — el upgrade vuela
          // ~15 s en segundo plano; si el usuario ya navegó a ACTAS/RESUMEN
          // el acta se actualiza igual pero la vista NO se roba (el banner
          // de ENVIADA aparece cuando vuelva a REVISIÓN). Sin key `vista`:
          // cada vista conserva la suya.
          set({
            actaActual: {
              ...get().actaActual!,
              status: "ENVIADA",
              enviadoAutomaticamente: hora,
            },
          });
        }
      } catch {
        /* silencioso: el upgrade JAMÁS rompe nada (el acta queda como está) */
      } finally {
        set({ revelando: false });
      }
    },
  };
}
