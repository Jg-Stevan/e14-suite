"use client";

/** FASE 2: cliente unificado del paquete + kill-switch de S. El runner
 * pasa el presupuesto por opciones (plan de gama D74) — igual que hoy. */
import { configurarCapa0 } from "@jg-stevan/scanner-core/qr/capa0-qr.client";
import { leerFlags } from "../flags";

configurarCapa0({
  habilitado: () => {
    try {
      return leerFlags().capa0QrWorker;
    } catch {
      // flags ilegibles ⇒ default ON: sin flags no se desactiva la capa 0 del QR
      return true;
    }
  },
});

export * from "@jg-stevan/scanner-core/qr/capa0-qr.client";
