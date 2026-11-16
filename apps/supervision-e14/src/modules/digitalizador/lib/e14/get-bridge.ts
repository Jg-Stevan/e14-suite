/**
 * PUNTO ÚNICO DE INTERCAMBIO (SPEC §2) — R-24 (H-15): la fábrica del
 * singleton (CompositeBridge incluido) vive en el PAQUETE (crearGetBridge,
 * genérica sobre (Opciones, TipoActa)); el RealCoreBridge (composition root
 * de ESTA app — FASE 4 del mapa) se inyecta aquí, igual que el gemelo móvil
 * (digielect14/get-bridge.ts). Las vistas no se enteran.
 *
 * FASE LÓGICA L2 (§3.3, D17): se inyecta el RealCoreBridge (pipeline §5).
 * UX-REAL F1 (D35): SIMULACIÓN también pasa por el real — el MockBridge se
 * retiró (la fuente carga el acta E-14 incluida).
 */
import { crearGetBridge } from "@jg-stevan/scanner-core/dominio/get-bridge";
import { RealCoreBridge } from "./scanner-core-bridge";
import type { OpcionesEscaneo } from "./bridge";
import type { Acta } from "./types";

export const getBridge = crearGetBridge<OpcionesEscaneo, Acta>(
  () => new RealCoreBridge(),
);
