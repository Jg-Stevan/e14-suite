/**
 * R-27 (H-17, auditoría 2026-11-16) — SLICE AVISOS DEL VISOR: la franja
 * persistente de errores/información del operador (KIT errores-operador-v1,
 * plan 3.1 — U1/C5). Extraído de la ex tienda-dios: los de tipo "error" NO se
 * autodestruyen (bloque 4.3.1) — salen por Reintentar o descartar.
 */
import type { E14Set, E14Store } from "./tipos";

/** Slice avisos: estado inicial + montar/descartar el aviso del visor. */
export function crearAvisos(
  set: E14Set,
): Pick<E14Store, "avisoVisor" | "mostrarAvisoVisor" | "descartarAvisoVisor"> {
  return {
    // KIT errores-operador-v1 (plan 3.1): sin aviso al arrancar.
    avisoVisor: null,

    // ─── KIT errores-operador-v1 (plan 3.1): aviso del visor ───
    mostrarAvisoVisor: (aviso) =>
      set({ avisoVisor: { ...aviso, ts: Date.now() } }),

    /** Descarta el aviso del visor (botón × de la franja). */
    descartarAvisoVisor: () => set({ avisoVisor: null }),
  };
}
