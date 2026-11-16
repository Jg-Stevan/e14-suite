/**
 * PUNTO ÚNICO DE INTERCAMBIO (SPEC §2) — fábrica del paquete (FASE 1).
 *
 * En los repos este módulo instanciaba el RealCoreBridge directamente; el
 * real es el composition root de CADA app (scanner-core-bridge.ts — FASE 4
 * del mapa, se queda por app). El paquete exporta la FÁBRICA: cada app crea
 * su getBridge inyectando su bridge real y las vistas no se enteran
 * (get-bridge sigue siendo el punto único de intercambio en cada repo).
 *
 * R-24 (H-15): genérica sobre (Opciones, TipoActa) — mismo parámetro del
 * bridge. Las apps con contrato local (el panel) instancian con SUS tipos;
 * digielect14 usa los defaults por inferencia.
 */
import {
  CompositeBridge,
  type ActaMinima,
  type E14Bridge,
  type OpcionesEscaneo,
} from "./bridge";
import type { Acta } from "./types";

export function crearGetBridge<
  Opciones extends OpcionesEscaneo = OpcionesEscaneo,
  TipoActa extends ActaMinima = Acta,
>(real: () => E14Bridge<Opciones, TipoActa>): () => E14Bridge<Opciones, TipoActa> {
  let instancia: E14Bridge<Opciones, TipoActa> | null = null;
  return () => {
    if (!instancia) {
      instancia = new CompositeBridge<Opciones, TipoActa>(real());
    }
    return instancia;
  };
}
