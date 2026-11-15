"use client";

/**
 * KIT e14-sidecar-instalable-v1 (D81) — tarjeta ACELERADOR NATIVO.
 *
 * Qué resuelve: el sidecar le baja el lote de ~101,6 s a 40-58 s medidos, pero
 * solo si está corriendo, y `python native/servidor.py --puerto 8765` no es una
 * frase que un visitante elector vaya a escribir. Aquí el visitante ve EN UN
 * CLICK si su máquina ya tiene el motor y, si no, lo descarga.
 *
 * Doctrina intacta (la del cliente, `lib/e14/ocr/nativo.ts`): el sidecar es una
 * ACELERACIÓN, jamás un requisito. Esta tarjeta informa y descarga; NUNCA
 * bloquea el lote ni condiciona el gate. Un «no lo instales» deja la app
 * funcionando por WASM, que es lo que hoy hace todo el mundo.
 *
 * Por qué el botón REINTENTAR existe (y por qué llama a invalidarSondaNativo):
 * el sondeo cachea 15 s para no cobrarle un timeout a cada acta. Instalado el
 * .exe, ese caché es exactamente lo que dejaría la tarjeta diciendo «ausente»
 * frente a un sidecar que ya contesta. Sin invalidar, el click no hace nada.
 * El auto-reintento mientras está AUSENTE (REINTENTO_MS) cubre al que descarga
 * y vuelve sin leer la pantalla: la tarjeta se voltea sola.
 *
 * P-21 (plan 2026-11-12) — AUTO-APAGADO y aviso cuando el sidecar MUERE:
 * antes el re-sondeo solo corría en AUSENTE, así que un sidecar que se caía a
 * mitad de sesión quedaba «ACTIVO» para siempre (detección pasiva: solo el
 * fallback por llamada con TTL 15 s, sin aviso ni re-sondeo). Ahora el timer
 * vive SIEMPRE que la tarjeta está montada y la máquina de estados es:
 *
 *   probando ──ok──▶ activo ──/salud falla ×2 SEGUIDAS──▶ caído
 *      │                │  ▲                                 │
 *      └── !ok ──▶ ausente │  └──── /salud responde ◀────────┘ (re-armar)
 *
 * Al pasar a CAÍDO se DESARMA el flag EN RUNTIME (`configurarNativo(null)`):
 * la siguiente captura ya sale por WASM sin pagar el timeout del motor muerto
 * (45 s por acta — el per-acta del core sigue de red de seguridad, pero el
 * objetivo de P-21 es no llegar ahí). El override persistido de
 * localStorage/flags.json NO se toca: persistir `ocrNativoUrl: null` mataría
 * la tarjeta para siempre (url null → return null) y obligaría al visitante a
 * limpiar el override a mano tras reiniciar el .exe. Al volver a responder
 * /salud (sondeo DIRECTO a la URL original, sin re-armar a ciegas), la tarjeta
 * re-arma `configurarNativo(url)` sola y vuelve a ACTIVO.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  configurarNativo,
  invalidarSondaNativo,
  ladoNativoDisponible,
  permisoLoopbackNativo,
  saludNativo,
  sondearUrlSidecarDirecta,
  urlLadoNativo,
  type PermisoLoopback,
  type SaludNativo,
} from "@/modules/digitalizador/lib/e14/ocr/nativo";

/** El nombre del ZIP es un contrato a tres bandas: el asset de la release que
 *  sube `.github/workflows/sidecar-release.yml`, el que produce
 *  `scripts/empaquetar-sidecar.mjs` y el que arma la página de descarga. Un
 *  desalineamiento es un 404 silencioso en un link. Lo fija
 *  `__tests__/acelerador-tarjeta.test.ts`. */
export const ARCHIVO_SIDECAR = "supervision-e14-sidecar-win-x64.zip";

/** El ZIP (~108 MiB) no puede vivir como un asset > 25 MiB en Pages ni en una
 *  release privada (el visitante no tiene login). La página pública del panel
 *  baja las partes que deja el deploy y las reensambla en el navegador; el
 *  nombre del archivo sigue siendo el de `ARCHIVO_SIDECAR`. */
export const URL_DESCARGA_SIDECAR = "https://supervision-e14.pages.dev/descargas/sidecar/";

/** Re-sondeo en modo AUSENTE (el que descarga y no vuelve a mirar la pantalla)
 *  y vigilancia de vida en ACTIVO/CAÍDO (P-21). 15 s = lo mismo que vale el
 *  caché del sondeo. */
const REINTENTO_MS = 15_000;

/** P-21 — /salud debe fallar DOS veces seguidas antes de declarar CAÍDO: un
 *  solo timeout puede ser un anti-virus escaneando, un sleep del portátil o la
 *  ventana de arranque del .exe. Dos seguidas a 15 s = 30 s de sidecar mudo. */
const FALLOS_PARA_CAIDA = 2;

type Estado = "consulta" | "permiso" | "denegado" | "probando" | "activo" | "ausente" | "caido";

/** El prompt de Local Network Access puede tardar: el timeout corto de 1,2 s
 *  abortaría el fetch mientras el visitante decide. */
const PERMISO_TIMEOUT_MS = 20_000;

export function AceleradorNativo() {
  // P-21 — la URL se congela AL MONTAR: cuando el estado CAÍDO desarma el flag
  // en runtime (`configurarNativo(null)`), `urlLadoNativo()` pasaría a null y
  // una lectura fresca desmontaría la tarjeta — justo cuando más hace falta el
  // banner. La tarjeta vive mientras exista la URL del montaje.
  const [url] = useState(() => urlLadoNativo());
  const [estado, setEstado] = useState<Estado | null>(url ? "consulta" : null);
  const [salud, setSalud] = useState<SaludNativo | null>(null);
  const [reintentos, setReintentos] = useState(0);
  const vivoRef = useRef(true);
  const estadoRef = useRef<Estado | null>(url ? "consulta" : null);
  const permisoRef = useRef<PermisoLoopback | null>(null);
  const fallosRef = useRef(0);

  const sondear = useCallback(
    async (cortarCache: boolean, porGesto = false) => {
      const actual = estadoRef.current;
      if (!url) return false;
      // Chrome 142+ bloquea la ida a loopback hasta que el visitante conceda
      // el permiso. Si está en "prompt"/"denied", NO se puede sondear en
      // segundo plano: el fetch debe nacer de un click para que el navegador
      // muestre el aviso (y un bucle de reintentos lo volvería un bloqueo mudo).
      if (!porGesto && (permisoRef.current === "prompt" || permisoRef.current === "denied")) {
        return false;
      }
      if (cortarCache) invalidarSondaNativo();
      // En CAÍDO el flag está desarmado EN RUNTIME (urlBase() = null): la sonda
      // del core contestaría false sin tocar la red. Se sondea DIRECTO a la
      // URL original — detecta la vuelta del proceso sin re-armar el motor a
      // ciegas (si aún no responde, el pipeline sigue en WASM).
      const espera = porGesto ? PERMISO_TIMEOUT_MS : undefined;
      // CAÍDO/PERMISO/DENEGADO tienen el motor desarmado EN RUNTIME: la sonda
      // del core contestaría false sin tocar la red. Se va DIRECTO a la URL.
      const directo =
        actual === "caido" || actual === "permiso" || actual === "denegado";
      let ok = directo
        ? await sondearUrlSidecarDirecta(url, espera)
        : await ladoNativoDisponible(espera);
      if (directo && ok) {
        // La sonda directa no llena el detalle de /salud que pinta la tarjeta
        // (MOTOR/SESIONES/PID). Con el permiso ya concedido se rearma y se
        // hace la lectura normal; si esa fallara, no se declara activo.
        configurarNativo(url);
        invalidarSondaNativo();
        ok = await ladoNativoDisponible();
      }
      if (!vivoRef.current) return ok;

      // Un click es el único momento en que el navegador puede conceder el
      // permiso. Se relee el estado DESPUÉS del fetch: si sigue en prompt o
      // quedó denegado, la tarjeta lo dice en vez de mentir con «ausente».
      if (porGesto) {
        const permiso = await permisoLoopbackNativo();
        // Un fetch bueno prueba que el acceso funciona aunque la query siga
        // diciendo «prompt» (bug conocido del Permissions API con LNA): sin
        // esto, el vigilante P-21 de ACTIVO quedaría bloqueado para siempre.
        if (vivoRef.current) permisoRef.current = ok ? "granted" : permiso;
        if (!ok && (permiso === "prompt" || permiso === "denied")) {
          configurarNativo(null);
          const siguiente: Estado = permiso === "denied" ? "denegado" : "permiso";
          estadoRef.current = siguiente;
          setEstado(siguiente);
          return ok;
        }
      }
      setSalud(saludNativo());

      if (actual === "activo") {
        if (ok) {
          fallosRef.current = 0;
          return ok; // sigue ACTIVO, nada que repintar
        }
        fallosRef.current += 1;
        if (fallosRef.current >= FALLOS_PARA_CAIDA) {
          // P-21 — desarmar el flag EN RUNTIME: la SIGUIENTE captura sale por
          // WASM sin pagar el timeout del motor muerto. El override persistido
          // NO se toca (ver comentario del encabezado).
          configurarNativo(null);
          fallosRef.current = 0;
          estadoRef.current = "caido";
          setEstado("caido");
        }
        return ok; // un fallo suelto: sigue ACTIVO (optimista, no parpadea)
      }
      if (actual === "caido") {
        if (ok) {
          // Re-armar: el proceso volvió. El runtime vuelve a la URL original y
          // la tarjeta a ACTIVO — la próxima acta ya sale por CPU nativa.
          configurarNativo(url);
          estadoRef.current = "activo";
          setEstado("activo");
        }
        return ok;
      }
      // consulta / permiso / probando / ausente: el veredicto manda. Si venía
      // desarmado por falta de permiso, un OK vuelve a armar el motor.
      if (ok) configurarNativo(url);
      estadoRef.current = ok ? "activo" : "ausente";
      setEstado(ok ? "activo" : "ausente");
      return ok;
    },
    [url],
  );

  useEffect(() => {
    if (!url) return;
    vivoRef.current = true;
    // Primero el permiso. Si está en "prompt" no se toca la red: se pinta la
    // tarjeta con el botón que dispara el aviso de Chrome en un gesto real.
    void (async () => {
      const permiso = await permisoLoopbackNativo();
      if (!vivoRef.current) return;
      permisoRef.current = permiso;
      if (permiso === "prompt" || permiso === "denied") {
        configurarNativo(null);
        const siguiente: Estado = permiso === "denied" ? "denegado" : "permiso";
        estadoRef.current = siguiente;
        setEstado(siguiente);
        return;
      }
      void sondear(false);
    })();
    return () => {
      vivoRef.current = false;
    };
  }, [url, sondear]);

  // P-21 — el timer vive SIEMPRE que la tarjeta está montada (antes solo en
  // AUSENTE): en ACTIVO detecta la muerte del proceso; en CAÍDO vigila la
  // vuelta para re-armar sin recargar. En AUSENTE hace lo de siempre.
  useEffect(() => {
    if (
      !url ||
      estado === null ||
      estado === "consulta" ||
      estado === "permiso" ||
      estado === "denegado"
    ) {
      return;
    }
    const t = window.setInterval(() => void sondear(true), REINTENTO_MS);
    return () => window.clearInterval(t);
  }, [url, estado, sondear]);

  if (!url || estado === null) return null;

  const activo = estado === "activo";
  const caido = estado === "caido";
  const consulta = estado === "consulta" || estado === "probando";
  const permisoPendiente = estado === "permiso";
  const denegado = estado === "denegado";

  return (
    <div className="w-full space-y-1.5 border-t border-[#112b2a]/60 pt-2 text-left">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-400">
        <span className="flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              activo
                ? "bg-[#00e599] shadow-[0_0_8px_#10b981]"
                : consulta || permisoPendiente
                  ? "animate-pulse bg-amber-400"
                  : caido || denegado
                    ? "bg-red-400"
                    : "bg-gray-600"
            }`}
            aria-hidden
          />
          ACELERADOR NATIVO
        </span>
        <span
          className="font-mono text-[9px]"
          title={
            activo
              ? "El det+rec corre en CPU nativa (onnxruntime), no en WASM. Se vigila cada 15 s (P-21)."
              : caido
                ? "El sidecar dejó de responder 2 veces seguidas: el OCR volvió al WASM del navegador hasta que el proceso conteste de nuevo."
                : "El det+rec corre en WASM dentro del navegador"
          }
        >
          <span
            className={
              activo
                ? "text-[#00e599]"
                : caido || denegado
                  ? "text-red-300"
                  : consulta || permisoPendiente
                    ? "text-amber-300"
                    : "text-gray-500"
            }
          >
            {activo
              ? "CPU"
              : caido
                ? "CAÍDO"
                : denegado
                  ? "BLOQUEADO"
                  : permisoPendiente
                    ? "PERMISO"
                    : consulta
                      ? "…"
                      : "WASM"}
          </span>
        </span>
      </div>

      <div className="space-y-1 rounded border border-[#112b2a] bg-[#061214] p-2 font-mono text-[9px]">
        {activo && salud ? (
          <>
            <Linea k="MOTOR" v={salud.motor ?? "—"} />
            <Linea k="SESIONES" v={String(salud.sesiones || "—")} />
            <Linea k="PID" v={String(salud.pid ?? "—")} />
            <Linea k="SONDEO" v={`${salud.ms} ms`} />
          </>
        ) : consulta ? (
          <p className="text-gray-500">COMPROBANDO PERMISO DE RED LOCAL…</p>
        ) : permisoPendiente ? (
          <>
            <p className="font-bold text-amber-300">CHROME PIDE PERMISO DE RED LOCAL</p>
            <p className="text-gray-400">
              Chrome 142+ no deja que esta página hable con{" "}
              <span className="text-gray-300">{url}</span> hasta que lo autorices.
              Pulsa <span className="text-amber-300">PERMITIR ACCESO A RED LOCAL</span> y
              elige «Permitir» en el aviso del navegador.
            </p>
          </>
        ) : denegado ? (
          <>
            <p className="font-bold text-red-300">ACCESO A RED LOCAL BLOQUEADO</p>
            <p className="text-gray-400">
              Ábrelo con el candado de la barra de direcciones → Configuración del
              sitio → Red local / Loopback → Permitir. Luego pulsa{" "}
              <span className="text-gray-300">YA LO PERMITÍ — REINTENTAR</span>.
            </p>
          </>
        ) : caido ? (
          <>
            <p className="font-bold text-red-300">
              ACELERADOR NATIVO CAÍDO — usando OCR del navegador (WASM)
            </p>
            <p className="text-gray-400">
              El proceso en <span className="text-gray-300">{url}</span> dejó de
              responder 2 veces seguidas. El lote SIGUE saliendo — por WASM, más
              lento. Vuelve a arrancar{" "}
              <span className="text-gray-300">supervision-e14-sidecar.exe</span>{" "}
              y la tarjeta se re-arma sola.
            </p>
          </>
        ) : (
          <p className="text-gray-400">
            No hay nada escuchando en{" "}
            <span className="text-gray-300">{url}</span>. El lote igual sale —
            por WASM, más lento.
          </p>
        )}
      </div>

      {caido ? (
        <p
          role="alert"
          className="rounded border border-red-400/40 bg-[#2a0d12] px-2 py-1.5 text-[9px] font-bold uppercase leading-tight tracking-wider text-red-300"
        >
          OCR continúa por WASM — ni una acta se pierde
        </p>
      ) : null}

      {activo ? (
        <p className="text-[9px] uppercase tracking-wider text-[#00e599]/70" role="status">
          LISTO — LAS ACTAS SALEN POR CPU NATIVA
        </p>
      ) : estado === "ausente" || caido || permisoPendiente || denegado ? (
        <>
          <a
            href={URL_DESCARGA_SIDECAR}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-[#00e599]/40 bg-[#061e19] px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-wider text-[#00e599] shadow-[0_0_8px_rgba(0,229,153,0.12)] transition-all hover:bg-[#0c2f29] active:scale-[0.98]"
            title="Abre la página que arma el ZIP de Windows (~108 MiB) desde sus partes. No necesita Python, ni git, ni instalador."
          >
            {caido ? "BAJAR EL ZIP DE NUEVO" : "DESCARGAR ZIP (≈108 MiB)"}
          </a>
          <button
            type="button"
            onClick={() => {
              setReintentos((n) => n + 1);
              // Gesto real: es lo que permite a Chrome mostrar (o releer) el
              // permiso de red local. Sin gesto, el fetch se bloquea en silencio.
              void sondear(true, true);
            }}
            className={`min-h-[28px] w-full rounded border px-2 font-mono text-[9px] font-bold uppercase tracking-wider transition active:scale-[0.98] ${
              permisoPendiente
                ? "border-amber-400/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                : "border-[#112b2a] bg-[#071214] text-gray-400 hover:border-[#1b3f3e] hover:bg-[#0b191c] hover:text-white"
            }`}
            title={
              permisoPendiente
                ? "Chrome mostrará el aviso de acceso a red local; elige Permitir para que la tarjeta vea el sidecar"
                : denegado
                  ? "Tras permitir el acceso a red local en el candado del sitio, reintenta el sondeo"
                  : caido
                    ? "Sondear ya (salta el caché de 15 s): si el .exe ya contesta, la tarjeta se re-arma sola"
                    : "Volver a preguntar si el sidecar ya está corriendo (salta el cache de 15 s del sondeo)"
            }
          >
            {permisoPendiente
              ? "PERMITIR ACCESO A RED LOCAL"
              : denegado
                ? "YA LO PERMITÍ — REINTENTAR"
                : reintentos > 0
                  ? `REINTENTAR (${reintentos})`
                  : "YA LO PUSE — REINTENTAR"}
          </button>
          <p className="text-[9px] leading-tight text-gray-500">
            Descomprime la carpeta y ejecuta{" "}
            <span className="text-gray-400">supervision-e14-sidecar.exe</span>.
            Deja la ventana abierta: tarda 5-15 s en decir LISTO. SmartScreen lo
            frena la primera vez (binario sin firmar): «Más información →
            Ejecutar de todas formas».
          </p>
        </>
      ) : null}
    </div>
  );
}

function Linea({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-gray-400">
      <span>{k}:</span>
      <span className="font-bold text-gray-200">{v}</span>
    </div>
  );
}
