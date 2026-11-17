/**
 * F-PWA — instalación de la app (PWA) en el móvil.
 *
 * La instalación va por el canal OFICIAL del navegador: el aviso/banner de
 * instalación de Chrome (install prompt). ANTES este módulo interceptaba
 * `beforeinstallprompt` con `preventDefault()` para disparar un botón propio
 * («Instalar app»); desde KIT e14-instalacion-oficial-v1 esa interceptación y
 * la píldora personalizada se retiraron: Chrome muestra SU banner y la app no
 * lo suprime. En iOS Safari no existe prompt nativo — el usuario instala con
 * Compartir → Añadir a pantalla de inicio.
 *
 * Único trabajo restante: registrar el Service Worker (offline + banner de
 * nueva versión E-04).
 */

// R-46 — fuente única de la app (src/shared/env.ts): era env crudo inline.
import { PUBLIC_BASE } from "@/shared/env";

/** Registra el Service Worker (producción: https/distinto de localhost). */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // KIT e14-motor-offline-v1: localhost puede registrar el SW SOLO con opt-in
  // explícito (?sw=1 o localStorage e14.sw.local=1) para verificar el camino
  // real de producción (SW + precarga) sin ensuciar el dev por defecto.
  const esLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const optInLocal =
    esLocal &&
    (new URLSearchParams(window.location.search).has("sw") ||
      window.localStorage.getItem("e14.sw.local") === "1");
  if (window.location.protocol !== "https:" && !optInLocal) return; // el deploy (Cloudflare Pages) es https; localhost dev se salta
  const register = () => {
    navigator.serviceWorker.register(`${PUBLIC_BASE}/sw.js`).catch(() => {
      /* sin SW la app funciona igual (solo pierde el offline) */
    });
  };
  // B15: el listener "load" vive dentro de un efecto — si la hidratación
  // llega DESPUÉS del evento load (gama baja / red lenta), nunca dispara y
  // la app se queda sin offline. Si ya cargó, registrar inmediatamente.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
