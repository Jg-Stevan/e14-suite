/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE CAPTURA: las fuentes del
 * disparo (cámara/archivo/simulación), sus setters síncronos y el pipeline
 * del disparo (dispararEscaneo) con sus guardas de generación (H1/H2) y el
 * rescate del motor OCR caído (KIT e14-remediacion-movil-v1 A4 — el evento
 * de obs vive en ./sesion-ocr). Extraído de la ex tienda-dios: mismo
 * estado, mismas acciones, cero cambio de comportamiento.
 */
import { getBridge } from "../get-bridge";
import type { Acta, FuenteCaptura, HistorialRow } from "@jg-stevan/scanner-core/dominio/types";
// e67-watchdog-rescate-v1 (cambio B): el tipo de opciones con presupuesto y
// rescate post-timeout — MISMO patrón del runner MASIVA (variable tipada →
// sin excess-check en la llamada al bridge).
import { type OpcionesEscaneoConTimeout } from "../scanner-core-bridge";
import { MAX_INTENTOS_ESCANEO } from "../politica/umbrales"; // 7.1/C3 — única fuente de los números del producto
// KIT errores-operador-v1 (plan 3.1 — C5/U1): clasificador de errores del
// pipeline → motivo de operador + forma del aviso del visor.
import {
  clasificarErrorPipeline,
  esFalloMemoriaMotor,
  type AvisoOperador,
} from "../errores";
import { logger } from "../../logger";
import { proximaPagina } from "./guion";
import { emitirSesionFallida } from "./sesion-ocr";
import {
  abrirPipeline,
  cancelacionPara,
  cerrarPipeline,
  esGeneracionVigente,
  olvidarCancelacion,
  siguienteGeneracion,
} from "./generacion";
import { idHistorial, tituloPaginaActual } from "./envio";
import type { E14Get, E14Set, E14Store } from "./tipos";

/** Slice captura: estado inicial + setters + disparo del escaneo. */
export function crearCaptura(
  set: E14Set,
  get: E14Get,
): Pick<
  E14Store,
  | "fuente"
  | "archivoPendiente"
  | "framePendiente"
  | "importPendiente"
  | "autoCapturaDesarmada"
  | "setFuente"
  | "setArchivoPendiente"
  | "setImportPendiente"
  | "setFramePendiente"
  | "setAutoCapturaDesarmada"
  | "dispararEscaneo"
  | "repetirFoto"
> {
  const bridge = getBridge();
  return {
    // §D1 (SPEC-e14-simulacion-scores): la app SIEMPRE arranca en CÁMARA
    // (fuente por defecto del producto — pill AUTO activa, visor vivo u
    // overlay §E del PR #33 sin permiso). Nunca se persiste la última fuente.
    fuente: "CAMARA",
    archivoPendiente: null,
    framePendiente: null,
    // KIT e14-remediacion-movil-v1: bandera del IMPORTAR (D4) apagada y la
    // auto-captura armada (A4 solo la desarma si el motor cae).
    importPendiente: false,
    autoCapturaDesarmada: false,

    setFuente: (fuente) => set({ fuente }),

    setArchivoPendiente: (archivo) => set({ archivoPendiente: archivo }),

    // KIT e14-remediacion-movil-v1 (D4): bandera SÍNCRONA — set() de Zustand
    // es síncrono, así que nace en el onChange ANTES de cualquier await.
    setImportPendiente: (v) => set({ importPendiente: v }),

    setAutoCapturaDesarmada: (v) => set({ autoCapturaDesarmada: v }),

    setFramePendiente: (frame) => set({ framePendiente: frame }),

    dispararEscaneo: async (intentoParam?, sim?) => {
      // FIX M4 (auditoría 2-b): guard IN-FLIGHT — un disparo durante el
      // análisis en curso (IMPORTAR mientras takePhoto vuela hasta 8 s,
      // doble tap del obturador, el timeout de despacharCaptura llegando
      // tarde) lanzaba un 2º pipeline concurrente: doble OCR compitiendo
      // por el wasm, actasSesion +2. La vista "analizando" se setea
      // SÍNCRONAMENTE al entrar → el guard cierra la carrera.
      // KIT e14-remediacion-movil-v1 (D4 — P2 #24): el guard dejo de ser
      // mudo — si quien chocó con él es un ARCHIVO importado (la auto-captura
      // ganó la carrera), el operador ve el aviso explícito «Se analizó la
      // cámara, no tu archivo» (cero descartes silenciosos).
      if (get().vista === "analizando") {
        if (get().importPendiente) {
          set({ importPendiente: false });
          get().mostrarAvisoVisor({
            tipo: "info",
            motivo: "CAPTURA_AUTO_GANO_CARRERA",
            accion: null,
          });
        }
        return;
      }
      // H2 (auditoría de A3): jamás dos pipelines sobre las MISMAS sesiones
      // ORT. Sin la cola global activa, la segunda inferencia concurrente
      // puede no regresar jamás (ver conTurnoOcr). Este guard cubre el
      // pipeline HUÉRFANO tras cancelar/interrumpir: la vista ya volvió a
      // "escanear" pero el bridge sigue trabajando.
      if (get().analisisEnVuelo) {
        // El IMPORTAR que chocó aquí NO quedó pendiente: se suelta la
        // bandera (si no, la auto-captura quedaría bloqueada para siempre).
        set({ importPendiente: false });
        get().mostrarAvisoVisor({
          tipo: "info",
          motivo: "ANALISIS_ANTERIOR_EN_CIERRE",
          accion: null,
        });
        return;
      }
      const { mesas, fuente, archivoPendiente, framePendiente, actaActual: previa } = get();
      // KIT e14-simulacion-imagenes-v1: una imagen de la galería SIEMPRE corre
      // la fuente SIMULACION (el bridge resuelve el File por `imagenSimulada`).
      // No toca archivoPendiente ni framePendiente — los guards de fuentes
      // reales NO aplican (la galería funciona en los 3 modos, sin cámara
      // viva). Sin `sim`, nada cambia.
      const simActiva = sim?.imagenSimulada != null;
      const fuenteEfectiva: FuenteCaptura = simActiva ? "SIMULACION" : fuente;
      // §7 (SPEC-rediseno-revision): el conteo cuenta CAPTURAS del ciclo de
      // repetición. Una captura SIN intento explícito (importar/disparo del
      // scanner) continúa el ciclo si el acta previa sigue sin resolver
      // (RECHAZADA, o EN_REVISION_HUMANA «repetir-primero» antes de agotar);
      // ciclo nuevo (ENVIADA/OPTIMA/ADVERTENCIA/contingencia agotada) → 1.
      // REPETIR FOTO (repetirFoto) siempre pasa el intento explícito +1.
      const intento =
        intentoParam ??
        (previa &&
        (previa.status === "RECHAZADA" ||
          (previa.status === "EN_REVISION_HUMANA" && previa.intento < previa.maxIntentos))
          ? previa.intento + 1
          : 1);
      // L2: en fuente ARCHIVO el disparo necesita imagen (REPETIR FOTO vuelve
      // al picker en vez de reventar el pipeline sin archivo). El aviso vive
      // ahora en la franja del visor de ScanView (pre-check de la vista).
      if (fuenteEfectiva === "ARCHIVO" && !archivoPendiente) {
        set({ vista: "escanear" });
        return;
      }
      // L3: la fuente CÁMARA necesita una captura (foto ZSL/nativa ya en el
      // store) o el video vivo para el grab del frame. REPETIR FOTO vuelve al
      // visor (la cámara se reinicia al reactivar la vista) — espejo de D23.
      // (aviso en la franja del visor de ScanView, §4 del redesign-stitch)
      if (fuenteEfectiva === "CAMARA" && !archivoPendiente && !framePendiente) {
        set({ vista: "escanear" });
        return;
      }
      const objetivo = proximaPagina(mesas);
      // H1/H2: cada disparo es una GENERACIÓN nueva. El estado que este
      // pipeline escriba al resolver solo vale si sigue siendo la vigente.
      const miGeneracion = siguienteGeneracion();
      abrirPipeline();
      set({
        vista: "analizando",
        actaActual: null,
        progresoAnalisis: null,
        analisisResuelto: false,
        // KIT errores-operador-v1 (plan 3.1): el operador ACTUÓ (re-disparó)
        // → el aviso de error previo sale de la franja.
        avisoVisor: null,
        // KIT e14-remediacion-movil-v1 (D4): el disparo ARRANCÓ de verdad →
        // la bandera síncrona del IMPORTAR cumple su ciclo y se apaga.
        importPendiente: false,
        analisisEnVuelo: true,
      });
      try {
        // e67-watchdog-rescate-v1 (cambio B): variable tipada — MISMO patrón
        // del runner MASIVA (OpcionesEscaneoConTimeout; sin excess-check).
        // · actaVencida captura el acta RECHAZADA por tiempo al resolver la
        //   promesa; el rescate SIEMPRE llega después (microtareas FIFO:
        //   la continuación del await corre antes que cualquier
        //   .then tardío del pipeline) — la referencia está lista.
        // · SIM JAMÁS rescata (§9.2 espejo — desenlace inyectado, nada
        //   tardío que valga la pena; el callback ni se pasa).
        let actaVencida: Acta | null = null;
        const opcionesEscaneo: OpcionesEscaneoConTimeout = {
          objetivo,
          intento,
          maxIntentos: MAX_INTENTOS_ESCANEO, // 7.1 — única fuente (politica/umbrales.ts)
          fuente: fuenteEfectiva,
          archivo: simActiva ? undefined : (archivoPendiente ?? undefined),
          frameActual:
            !simActiva && fuenteEfectiva === "CAMARA" ? framePendiente : undefined,
          // KIT e14-simulacion-imagenes-v1: SOLO la imagen elegida — sin
          // `simular` ni `scoreSimulado`: el pipeline corre idéntico a
          // «Importar» y el score lo mide el OCR real.
          imagenSimulada: simActiva ? sim!.imagenSimulada : undefined,
          onProgreso: (p) => {
            // Un disparo nuevo ya tomó la posta: el progreso del viejo no
            // puede mover el anillo del nuevo (H1).
            if (esGeneracionVigente(miGeneracion)) set({ progresoAnalisis: p });
          },
          // e67 (cambio B): rescate post-timeout — SOLO flujos reales. Si el
          // pipeline terminó VÁLIDO después del rechazo por tiempo, el
          // desenlace real (score/gate del pipeline) revierte el rechazo.
          ...(simActiva
            ? {}
            : {
                onRescateTardio: (real: Acta, tiempoRealMs: number) => {
                  // Pipeline viejo tras un disparo nuevo: jamás rescata sobre
                  // el estado del escaneo vigente (H1).
                  if (!esGeneracionVigente(miGeneracion)) return;
                  if (actaVencida) {
                    get().rescatarActaPostTimeout(actaVencida, real, tiempoRealMs);
                  }
                },
              }),
        };
        // KIT e14-remediacion-movil-v1 (A4 — P0 #21): el fallo de sesión del
        // motor OCR (familia bad_alloc de ONNX Runtime) deja de condenar la
        // app: se clasifica, se reinicia el runtime REAL (release de sesiones
        // + singleton fuera — antes SIN llamadores) y se reintenta UNA vez.
        // Si el reintento vuelve a fallar, el catch externo monta el estado
        // explícito MEMORIA_AGOTADA con botón Recargar (nunca una cadena de
        // reintentos automáticos condenados).
        const acta = await (async (): Promise<Acta> => {
          try {
            return await bridge.escanearActa(opcionesEscaneo);
          } catch (errPrimero) {
            if (!esFalloMemoriaMotor(errPrimero)) throw errPrimero;
            logger.error(
              "[e14] sesión OCR caída (familia bad_alloc) — reinicio real del motor + 1 reintento",
              errPrimero,
            );
            void emitirSesionFallida(errPrimero, true);
            try {
              const { rapidOcrReiniciar } = await import("../ocr/rapidocr");
              await rapidOcrReiniciar();
            } catch {
              /* el reinicio es best-effort — el reintento decide */
            }
            // Desarmar la AUTO-CAPTURA hasta interacción del operador — fin
            // del bucle condenado de ~6 s. La bandera es PERSISTENTE (H3):
            // el re-arme D9 al reabrir la cámara la respeta.
            set({ autoCapturaDesarmada: true });
            try {
              return await bridge.escanearActa(opcionesEscaneo);
            } catch (errSegundo) {
              // segundo fallo: ya emitido a obs — se relanza al catch externo que monta MEMORIA_AGOTADA
              void emitirSesionFallida(errSegundo, false);
              throw errSegundo;
            }
          }
        })();
        // Ola 3.2 (U4): el operador canceló durante el análisis → el desenlace
        // TARDÍO se descarta completo: no adopta el acta, no cuenta
        // actasSesion, no deja analisisResuelto encendido y deja actaVencida
        // en null (un rescate tardío del watchdog no tiene a quién rescatar).
        // KIT e14-remediacion-movil-v1 (A3): si quien canceló fue el
        // OCULTAMIENTO (interrumpida) y el pipeline terminó VÁLIDO pese a
        // todo, el rescate MANDA — el desenlace real se adopta y el acta
        // legible jamás se pierde por ocultar la app.
        const cancelacion = cancelacionPara(miGeneracion);
        const cancelada = cancelacion != null;
        if (cancelada) olvidarCancelacion(miGeneracion);
        // Disparo NUEVO en marcha: este pipeline quedó huérfano — su
        // desenlace no escribe NADA del escaneo vigente (H1).
        if (!esGeneracionVigente(miGeneracion)) return;
        if (cancelada) {
          const interrumpida = cancelacion?.motivo === "interrumpida";
          if (
            interrumpida &&
            (acta.status === "OPTIMA" || acta.status === "ADVERTENCIA")
          ) {
            logger.info(
              "[e14] pipeline terminó válido pese a la interrupción — el rescate manda (A3.3)",
              { actaId: acta.id, score: acta.score },
            );
            set({
              actaActual: { ...acta, scoreRescatadoPor: "post-interrupcion" },
              paginaObjetivo: objetivo,
              actasSesion: get().actasSesion + 1,
              analisisResuelto: true,
              archivoPendiente: null,
              avisoVisor: null,
            });
            void get().analisisCompletado();
            return;
          }
          logger.info(
            interrumpida
              ? "[e14] escaneo interrumpido por ocultamiento — desenlace tardío descartado"
              : "[e14] escaneo cancelado por el operador — desenlace tardío descartado",
          );
          return;
        }
        actaVencida = acta;
        set({
          actaActual: acta,
          paginaObjetivo: objetivo,
          actasSesion: get().actasSesion + 1,
          analisisResuelto: true,
          archivoPendiente: null,
        });
        // D7 (SPEC-rediseno-revision §7.5): contingencia automática al
        // AGOTAR intentos — el sistema escala solo (C4), sin botón manual:
        // fila de historial. Con intento < max NO hay historial (aún es
        // «repetir-primero"). El aviso persistente vive en la píldora de
        // estado REVISIÓN HUMANA de la REVISIÓN (redesign-stitch §4.3).
        if (acta.status === "EN_REVISION_HUMANA" && intento >= acta.maxIntentos) {
          const fila: HistorialRow = {
            id: idHistorial(),
            titulo: tituloPaginaActual(get),
            estado: "REVISION_HUMANA",
            hora: bridge.horaHistorial(),
          };
          set({ historial: [fila, ...get().historial] });
        }
      } catch (err) {
        // FIX M3 (auditoría 2-a): el fallo del pipeline deja de ser mudo —
        // mismo patrón del kit e14-recorte-manual-v1 (T2): razonable en
        // consola. La UI vuelve al visor (los guards de entrada ya cubren
        // lo previsible; esto cubre lo imprevisto: asset SIM caído, decode
        // de archivo corrupto, video no listo).
        logger.error("[e14] dispararEscaneo falló:", err);
        // KIT errores-operador-v1 (plan 3.1 — U1/C5): el fallo YA NO regresa
        // mudo — se clasifica a motivo de operador y sube el aviso
        // PERSISTENTE del visor (franja con Reintentar/descartar; los avisos
        // de error no se autodestruyen — bloque 4.3.1). Jamás se expone el
        // stack al operador (el log conserva el detalle para ti).
        // Cancelación en vuelo + rechazo tardío del pipeline: NO es un fallo
        // que el operador deba ver — vuelve al visor en silencio.
        const cancelacionError = cancelacionPara(miGeneracion);
        const cancelada = cancelacionError != null;
        if (cancelada) olvidarCancelacion(miGeneracion);
        // Mismo guard que la resolución: un fallo del pipeline viejo no
        // devuelve la vista ni avisa sobre el escaneo vigente (H1).
        if (!esGeneracionVigente(miGeneracion)) return;
        set({
          vista: "escanear",
          progresoAnalisis: null,
          analisisResuelto: false,
          ...(cancelada
            ? {}
            : esFalloMemoriaMotor(err)
              ? {
                  // KIT e14-remediacion-movil-v1 (A4): el estado explícito con
                  // botón RECARGAR — única salida honesta tras reinicio+reintento.
                  avisoVisor: {
                    tipo: "error",
                    motivo: "MEMORIA_AGOTADA",
                    accion: "recargar",
                    ts: Date.now(),
                  } satisfies AvisoOperador,
                }
              : {
                  avisoVisor: {
                    tipo: "error",
                    motivo: clasificarErrorPipeline(err),
                    accion: "reintentar",
                    ts: Date.now(),
                  } satisfies AvisoOperador,
                }),
        });
      } finally {
        // Solo cuando no queda NINGÚN pipeline vivo se apaga la bandera: el
        // viejo puede seguir cerrando mientras el nuevo ya terminó (H2).
        if (cerrarPipeline()) set({ analisisEnVuelo: false });
      }
    },

    repetirFoto: () => {
      const { actaActual: previa } = get();
      // FIX M2 (auditoría 2-a): §7 — el ciclo de repetición CIERRA con
      // ADVERTENCIA/ENVIADA/OPTIMA/contingencia agotada → repetir desde ahí
      // abre ciclo NUEVO (intento 1). Solo RECHAZADA (y EN_REVISION_HUMANA
      // «repetir-primero» bajo el tope) CONTINÚA el ciclo: intento+1 con
      // TOPE maxIntentos. Antes un intento explícito sin tope fabricaba
      // «INTENTO 5 DE 4» + una fila REVISION_HUMANA nueva por cada intento
      // extra (dispararEscaneo L696 cree que es contingencia C4).
      const continuaCiclo =
        previa &&
        (previa.status === "RECHAZADA" ||
          (previa.status === "EN_REVISION_HUMANA" &&
            previa.intento < previa.maxIntentos));
      const intento = continuaCiclo
        ? Math.min((previa?.intento ?? 0) + 1, previa?.maxIntentos ?? 4)
        : 1;
      void get().dispararEscaneo(intento);
    },
  };
}
