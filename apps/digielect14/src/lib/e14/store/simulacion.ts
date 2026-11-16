/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE SIMULACIÓN: el MODO SIM (toggle
 * «SIM» de ACTAS) y el SIM VIVO (tick de 5 s que «sube» actas al guion demo)
 * — overlay de VISTA (D6 INTOCABLE): jamás escribe archivadas/puestoActual/
 * historial/completadas. Incluye la galería de imágenes simuladas, que corre
 * el MISMO pipeline de «Importar». Extraído de la ex tienda-dios: mismo
 * estado, mismas acciones, cero cambio de comportamiento.
 */
import { cargarDivipol, mesasDePuesto } from "@jg-stevan/scanner-core/dominio/divipol";
// KIT e14-sin-relleno-v1: el seed DEMO solo vive dentro del MODO SIMULACIÓN
// (toggle «SIM» de ACTAS). El arranque/jornada real nace SIEMPRE vacío —
// cero mesas falsas, cero progreso 12/9, cero historial de mentira.
import { guionDePuesto, mesasIniciales } from "@jg-stevan/scanner-core/dominio/seed";
// KIT e14-simulacion-imagenes-v1: catálogo de la galería «Simulación»
// (fuente única de título/descripción de cada imagen).
import { imagenSimuladaPorId } from "../simulacion-imagenes";
import { derivarMesasConDivipol, marcarPaginaOK, proximaPagina } from "./guion";
import type { E14Get, E14Set, E14Store } from "./tipos";

/** Slice simulación: estado inicial + toggle SIM + tick del SIM VIVO. */
export function crearSimulacion(
  set: E14Set,
  get: E14Get,
): Pick<
  E14Store,
  | "modoSimulacion"
  | "simCompleta"
  | "simUltima"
  | "alternarModoSimulacion"
  | "avanzarSimulacion"
  | "simularImagen"
> {
  return {
    modoSimulacion: false,
    simCompleta: false,
    simUltima: null,

    // KIT actas-vivas-paginas-v1 (FASE A): ENCENDER → guion FRESCO (seed
    // nuevo + SIM reiniciado — AC-SIM2); APAGAR → solo apaga. Overlay de
    // vista: no toca archivadas/puestoActual/historial/completadas (D6).
    // KIT e14-luz-sim-puntos-v1 (T-S): ENCENDER → guion del PUESTO REAL del
    // acta escaneada (puestoActual → DIVIPOL p.t mesas × 4 páginas, fresco
    // — AC-SIM2). Sin puesto real o sin t DIVIPOL → seed demo (como hoy).
    // APAGAR → solo apaga. Overlay de vista (Opción A): SOLO mesas/
    // simCompleta/simUltima — D6 (jamás archivadas/puestoActual/historial).
    // FIX M10 (auditoría 2-a, kit L6): APAGAR ahora RESTAURA el guion REAL
    // (derivado de archivadas+puestoActual) — antes el progreso FALSO del
    // SIM quedaba quemado en `mesas` (todas OK) y `proximaPagina` devolvía
    // null para el resto de la sesión: todo escaneo real perdía página
    // objetivo y RESUMEN mostraba el avance inventado como real.
    alternarModoSimulacion: () => {
      const encender = !get().modoSimulacion;
      if (!encender) {
        set({ modoSimulacion: false });
        const puesto = get().puestoActual;
        if (puesto) {
          // C-11 — RESTAURAR el guion REAL con el helper único (fix M10).
          void derivarMesasConDivipol(get().archivadas, puesto)
            .then((derivadas) => {
              // Solo si sigue APAGADO (no re-montó el guion SIM debajo).
              if (derivadas && !get().modoSimulacion) {
                set({ mesas: derivadas });
              }
            })
            .catch(() => {
              /* sin base → mesas queda como esté (degradación honesta) */
            });
        } else {
          // KIT e14-sin-relleno-v1: sin puesto real la vista vuelve al estado
          // REAL (vacío — «AÚN NO HAY ACTAS ESCANEADAS»), no al guion demo.
          set({ mesas: [] });
        }
        return;
      }
      // Puesto demo INMEDIATO (la vista nunca queda vacía mientras carga DIVIPOL).
      set({
        modoSimulacion: true,
        mesas: mesasIniciales(),
        simCompleta: false,
        simUltima: null,
      });
      const puesto = get().puestoActual;
      if (!puesto) return;
      const [dep, mun, zon, std] = puesto.clave.split("-");
      void cargarDivipol()
        .then((base) => {
          const total = mesasDePuesto(base, dep, mun, zon, std);
          // El mantenedor pudo APAGAR durante la carga (base en caché ~instantáneo,
          // pero el guard es obligatorio): solo aplica si sigue ON.
          if (!total || !get().modoSimulacion) return;
          set({ mesas: guionDePuesto(total), simCompleta: false, simUltima: null });
        })
        .catch(() => {
          /* sin base → el guion demo ya está montado (degradación honesta) */
        });
    },

    // KIT actas-vivas-paginas-v1 (FASE A): SIM VIVO — cada tick «sube» un
    // acta al guion demo (proximaPagina YA existe con la prioridad
    // EN_PROCESO > PENDIENTE > RESCANEO; el seed arranca en m2-D2 y el
    // puesto se completa ~8 ticks). D6: SOLO mesas (guion del puesto demo)
    // + feedback — jamás datos reales. Guion completo → simCompleta (el
    // tick de ACTAS se detiene SOLO).
    avanzarSimulacion: () => {
      const objetivo = proximaPagina(get().mesas);
      if (!objetivo) {
        if (!get().simCompleta) set({ simCompleta: true });
        return;
      }
      const mesas = marcarPaginaOK(get().mesas, objetivo);
      set({
        mesas,
        simUltima: `${objetivo.mesaId} · ${objetivo.tipo} P${objetivo.pagina} ✓`,
        simCompleta: mesas.every((m) => m.paginas.every((p) => p.estado === "OK")),
      });
    },

    simularImagen: (id) => {
      // KIT e14-simulacion-imagenes-v1: una imagen de la galería es UNA
      // captura del ciclo — reutiliza dispararEscaneo INTACTO (intento
      // vigente: continúa el ciclo si el acta previa sigue sin resolver,
      // ciclo nuevo → 1) para que REVISIÓN, banner, toast, historial, ACTAS y
      // contingencia C4 se comporten idénticos a las capturas reales. El
      // guard cubre el race de un double-tap: vista ya en "analizando" →
      // ignorado. La imagen se procesa EXACTAMENTE como «Importar»; el gate
      // decide con el score real.
      const imagen = imagenSimuladaPorId(id);
      if (!imagen || get().vista === "analizando") return;
      void get().dispararEscaneo(undefined, {
        imagenSimulada: imagen.id,
      });
    },
  };
}
