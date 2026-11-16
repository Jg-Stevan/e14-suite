/**
 * FACHADA del estado global e14 (R-27, H-17 — auditoría 2026-11-16).
 *
 * Este módulo era una tienda-dios de ~2.074 líneas (62 campos, 31 acciones
 * mezclando navegación, simulación, análisis, persistencia IDB y avisos).
 * Quedó partido en SLICES de dominio bajo `src/lib/e14/store/`:
 *
 *   · tipos.ts        — el contrato (interfaz E14Store completa) + tipos
 *                       compartidos (Vista, ActaArchivada, PuestoActual…)
 *   · generacion.ts   — guardas de generación del disparo (H1/H2, A3)
 *   · sesion-ocr.ts   — obs del fallo de sesión del motor OCR (A4 — P0 #21)
 *   · guion.ts        — el guion de mesas (proximaPagina, derivación C-11)
 *   · navegacion.ts   — vista activa, destello y conexión
 *   · captura.ts      — fuentes del disparo + dispararEscaneo (pipeline)
 *   · analisis.ts     — desenlaces del pipeline (auto-envío, rescate e67,
 *                       cancelación/interrupción, motivos no-envío)
 *   · edicion.ts      — recorte, rotación, filtros, OCR y upgrade full-res
 *   · envio.ts        — registrarEnvio (punto único G.1), archivado de
 *                       huecos, envío manual y escalación a revisión humana
 *   · simulacion.ts   — MODO SIM (toggle + tick vivo + galería de imágenes)
 *   · avisos.ts       — aviso persistente del visor (errores-operador-v1)
 *   · persistencia.ts — jornada (arranque/reinicio, persister por
 *                       suscripción, cuota IDB 6.10, rehidratación 6.12)
 *
 * Composición (zustand v5, patrón de slices sobre UNA tienda): cada slice
 * es una función `crearX(set, get)` que devuelve su estado inicial y sus
 * acciones parciales; la fachada las esparce dentro del MISMO `create` —
 * todos los slices comparten set/get del estado COMPLETO (E14Store), sin
 * librerías extra y sin fusionar hooks.
 *
 * FACHADA PÚBLICA INTACTA: `useE14Store` (mismos 62 campos y 31 acciones,
 * mismos nombres) y los tipos re-exportados (`Vista`, `ActaArchivada`,
 * `PuestoActual`) — CERO cambios para los consumidores.
 *
 * Toda la data nace del bridge (D1) — las vistas nunca tocan el bridge
 * directamente. STITCH REDESIGN (SPEC-e14-redesign-stitch §4/D2): el sistema
 * de notificaciones flotantes queda ELIMINADO (estado + acción + call-sites).
 * El feedback vive en la UI persistente de estado (píldoras, nube, bloque
 * ENVIADO, franja del visor, feedback en botón).
 */
import { create } from "zustand";
import { crearNavegacion } from "./store/navegacion";
import { crearGuion } from "./store/guion";
import { crearCaptura } from "./store/captura";
import { crearAnalisis } from "./store/analisis";
import { crearEdicion } from "./store/edicion";
import { crearEnvio } from "./store/envio";
import { crearSimulacion } from "./store/simulacion";
import { crearAvisos } from "./store/avisos";
import { crearPersistencia, instalarPersister } from "./store/persistencia";
import type { E14Store } from "./store/tipos";

export type { Vista, ActaArchivada, PuestoActual } from "./store/tipos";

/** Tienda e14 — MISMA API pública que siempre (hook de selectores +
 *  getState/setState/subscribe). Los slices viven en ./store/. */
export const useE14Store = create<E14Store>((set, get) => ({
  ...crearNavegacion(set, get),
  ...crearGuion(),
  ...crearCaptura(set, get),
  ...crearAnalisis(set, get),
  ...crearEdicion(set, get),
  ...crearEnvio(set, get),
  ...crearSimulacion(set, get),
  ...crearAvisos(set),
  ...crearPersistencia(set, get),
}));

// KIT L6: el persister por suscripción se instala en el MISMO momento que
// tenía el bloque a pie de módulo del store original — justo tras crear la
// tienda, con sus guards de entorno (window/indexedDB) dentro del slice.
instalarPersister(useE14Store);
