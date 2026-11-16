/** Ítem 3.3: motor del sidecar en el paquete; URL de S inyectada
 * (flags.ocrNativoUrl — validador SEC-10: solo localhost). */
import { configurarNativo } from "@jg-stevan/scanner-core/ocr/motores/nativo";
import { leerFlags } from "../flags";

// H-44 (TRAY-C-07): la URL puede traer `?token=<hex>` — el token efímero que
// el sidecar imprime al arrancar y el operador pega en el override de
// `ocrNativoUrl`. El cliente del paquete lo separa y lo manda como header
// `x-sidecar-token` en los POST (/salud no lo exige); aquí solo entra por si
// el flag trae query, que no debe romper NINGUNA URL derivada.
try {
  configurarNativo(leerFlags().ocrNativoUrl ?? null);
} catch {
  // flags ilegibles al armar el módulo ⇒ sin sidecar (null): el WASM de siempre queda de motor
  configurarNativo(null);
}

export * from "@jg-stevan/scanner-core/ocr/motores/nativo";

/**
 * P-21 (plan 2026-11-12) — sondeo DIRECTO a una URL de sidecar, SIN tocar la
 * configuración del motor.
 *
 * La tarjeta del acelerador lo usa mientras está CAÍDO: al desarmar el flag en
 * runtime (`configurarNativo(null)`), la sonda del core (`ladoNativoDisponible`)
 * contestaría `false` sin salir a la red — el sidecar muerto quedaría
 * irrecuperable aunque el proceso volviera. Este sondeo va directo a la URL
 * original y deja la decisión de RE-ARMAR en la tarjeta (que reconfigura solo
 * con veredicto positivo — jamás a ciegas, para no pagar el timeout del motor
 * muerto en la siguiente acta).
 *
 * Mismo contrato que la sonda del core: 1 GET /salud, timeout corto, jamás
 * lanza (fallo de red / JSON raro / abort = false).
 */
export async function sondearUrlSidecarDirecta(
  url: string,
  timeoutMs = 1_200,
): Promise<boolean> {
  // H-44 — la URL puede traer `?token=`: /salud NO lo exige, así que se
  // STRIP antes de concatenar (con query adentro el path quedaría
  // `…?token=…/salud`, que es un 404 silencioso para la sonda).
  const base = url.split("?")[0].replace(/\/+$/, "");
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/salud`, {
      cache: "no-store",
      signal: control.signal,
      // Chrome 142+: sin esto el fetch a 127.0.0.1 desde el sitio público
      // puede quedar bloqueado por mixed content antes de pedir el permiso.
      targetAddressSpace: "loopback",
    } as RequestInit & { targetAddressSpace: "loopback" });
    if (!res.ok) return false;
    const j = (await res.json()) as Record<string, unknown>;
    return j?.ok === true;
  } catch {
    return false;
    // la sonda ES un boolean: cualquier fallo (red/JSON/abort) = sidecar caído — jamás throw
  } finally {
    clearTimeout(timer);
  }
}
