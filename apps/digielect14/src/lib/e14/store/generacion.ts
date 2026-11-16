/**
 * R-27 (H-17, auditoría 2026-11-16) — GUARDAS DE GENERACIÓN del disparo
 * (H1/H2 de la auditoría de A3), extraídas de la ex tienda-dios para que los
 * slices `captura.ts` (dispararEscaneo) y `analisis.ts` (cancelar/interrumpir)
 * compartan el MISMO estado de módulo sin importarse entre sí.
 *
 * Token de GENERACIÓN del disparo (H1/H2): la bandera única anterior dejaba
 * de valer en cuanto la interrupción devolvía la vista a "escanear" con el
 * pipeline todavía en vuelo: un disparo nuevo podía consumir la cancelación
 * del viejo — o el viejo adoptar su acta en mitad del escaneo nuevo. Cada
 * dispararEscaneo se queda con su generación y solo toca el estado si sigue
 * siendo la VIGENTE.
 */
/** ¿QUIÉN canceló? El botón del operador ("operador") o el ocultamiento de
 *  la app ("interrumpida" — interrumpirAnalisis desde AnalyzingView). Con
 *  "interrumpida", un desenlace tardío VÁLIDO se ADOPTA (A3.3). */
export type CancelacionEnVuelo = {
  generacion: number;
  motivo: "operador" | "interrumpida";
};

let generacionEscaneo = 0;
/** Pipelines del bridge vivos AHORA (incluye los huérfanos de una
 *  interrupción). La bandera del store solo se apaga cuando llega a 0: si el
 *  disparo nuevo termina antes que el viejo, el viejo no puede reabrir la
 *  auto-captura con el wasm todavía ocupado (H2). */
let pipelinesEnVuelo = 0;
/** Cancelación dirigida a UNA generación (el pipeline del bridge no tiene
 *  abort — el desenlace TARDÍO se descarta al resolver: sin acta fantasma,
 *  sin actasSesion+1, sin rescate del watchdog). Se limpia cuando la consume
 *  la generación a la que apunta; jamás una posterior. */
let cancelacionEnVuelo: CancelacionEnVuelo | null = null;

/** Reserva la GENERACIÓN del disparo nuevo (el token que decide si su
 *  desenlace puede seguir escribiendo el estado). */
export function siguienteGeneracion(): number {
  return ++generacionEscaneo;
}

/** ¿`generacion` sigue siendo la VIGENTE? (un disparo nuevo tomó la posta →
 *  el pipeline viejo quedó huérfano y NO escribe nada — H1). */
export function esGeneracionVigente(generacion: number): boolean {
  return generacion === generacionEscaneo;
}

/** Un pipeline del bridge más en vuelo (se abre al entrar a dispararEscaneo). */
export function abrirPipeline(): void {
  pipelinesEnVuelo += 1;
}

/** Un pipeline menos. `true` cuando NO queda NINGUNO vivo — solo entonces se
 *  apaga la bandera `analisisEnVuelo` del store: el viejo puede seguir
 *  cerrando mientras el nuevo ya terminó (H2). */
export function cerrarPipeline(): boolean {
  pipelinesEnVuelo = Math.max(0, pipelinesEnVuelo - 1);
  return pipelinesEnVuelo === 0;
}

/** Registra una cancelación dirigida a la generación VIGENTE (botón del
 *  operador o ocultamiento de la app). */
export function cancelarGeneracionVigente(motivo: CancelacionEnVuelo["motivo"]): void {
  cancelacionEnVuelo = { generacion: generacionEscaneo, motivo };
}

/** La cancelación pendiente SI apunta a `generacion` (null si no hay o si es
 *  de otra generación — la de un disparo nuevo jamás la consume el viejo). */
export function cancelacionPara(generacion: number): CancelacionEnVuelo | null {
  return cancelacionEnVuelo?.generacion === generacion ? cancelacionEnVuelo : null;
}

/** Consume/limpia la cancelación SOLO si apunta a `generacion` (una
 *  cancelación de otra generación queda intacta para su dueño). */
export function olvidarCancelacion(generacion: number): void {
  if (cancelacionEnVuelo?.generacion === generacion) cancelacionEnVuelo = null;
}
