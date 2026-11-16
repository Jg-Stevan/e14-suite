/**
 * KIT e14-sidecar-instalable-v1 (D81) — contrato del sondeo nativo.
 *
 * Cubre lo que la tarjeta «ACELERADOR NATIVO» necesita y lo que el lote
 * necesita que NO se rompa:
 *  · la memoria del sondeo (SALUD_TTL_MS) — un sidecar apagado no le cobra un
 *    timeout a cada acta;
 *  · `invalidarSondaNativo()` — sin él, el botón REINTENTAR releería un
 *    `ok:false` con hasta 15 s de vida y la tarjeta no se movería;
 *  · los campos crudos de `/salud` (motor/pid/version/sesiones) llegan a la UI;
 *  · EL PUERTO: el default de `native/servidor.py` y el de la flag son DOS
 *    archivos distintos que tienen que coincidir. Un exe que escucha en 8765 y
 *    una app que pregunta en 8766 es un fallo 100 % silencioso — la tarjeta
 *    diría «ausente» para siempre. Se fija aquí, no por lectura humana.
 *
 * Sin `window`: `leerOverridesFlagsRaw` envuelve el localStorage en try/catch,
 * así que en el proceso de bun las flags quedan en sus DEFAULTS — que es
 * exactamente el estado que un visitante descarga y ejecuta.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  actaNativa,
  configurarNativo,
  invalidarSondaNativo,
  ladoNativoDisponible,
  ocrNativo,
  saludNativo,
  urlLadoNativo,
} from "../nativo";

const SALUD = {
  ok: true,
  version: "e14-ocr-nativo-v1",
  motor: "v5",
  pid: 4242,
  sesiones: 2,
};

let llamadas: string[] = [];
/** Cabeceras de cada fetch (H-44 — el contrato del token viaja aquí). */
let cabeceras: Array<Record<string, string> | undefined> = [];
let respuesta: (() => Promise<Response>) | null = null;

const fetchFalso = (entrada: RequestInfo | URL, init?: RequestInit) => {
  llamadas.push(String(entrada));
  cabeceras.push(init?.headers as Record<string, string> | undefined);
  return respuesta
    ? respuesta()
    : Promise.resolve(
        new Response(JSON.stringify(SALUD), {
          headers: { "content-type": "application/json" },
        }),
      );
};

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  llamadas = [];
  cabeceras = [];
  respuesta = null;
  invalidarSondaNativo();
  globalThis.fetch = fetchFalso as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  invalidarSondaNativo();
});

describe("nativo — sondeo de salud", () => {
  test("urlLadoNativo() trae la flag y sin slash final", () => {
    const url = urlLadoNativo();
    expect(url).toBe("http://127.0.0.1:8765");
  });

  test("el default de la flag coincide con el --puerto default del sidecar", async () => {
    const fuente = await Bun.file(
      `${import.meta.dir}/../../../../../../../native/servidor.py`,
    ).text();
    const m = /--puerto",\s*type=int,\s*default=(\d+)/.exec(fuente);
    expect(m).not.toBeNull();
    expect(urlLadoNativo()).toBe(`http://127.0.0.1:${m![1]}`);
  });

  test("/salud bueno → true y los campos crudos quedan disponibles", async () => {
    expect(await ladoNativoDisponible()).toBe(true);
    const s = saludNativo();
    expect(s?.motor).toBe("v5");
    expect(s?.pid).toBe(4242);
    expect(s?.sesiones).toBe(2);
    expect(s?.version).toBe("e14-ocr-nativo-v1");
    expect(s?.ok).toBe(true);
  });

  test("el veredicto se memoriza: dos llamadas, un fetch", async () => {
    await ladoNativoDisponible();
    await ladoNativoDisponible();
    expect(llamadas.length).toBe(1);
  });

  test("invalidarSondaNativo() corta la memoria (el botón REINTENTAR)", async () => {
    await ladoNativoDisponible();
    invalidarSondaNativo();
    expect(saludNativo()).toBeNull();
    await ladoNativoDisponible();
    expect(llamadas.length).toBe(2);
  });

  test("sidecar muerto → false, memorizado como negativo y sin lanzar", async () => {
    respuesta = () => Promise.reject(new Error("conn refused"));
    expect(await ladoNativoDisponible()).toBe(false);
    expect(saludNativo()?.ok).toBe(false);
    // El negativo TAMBIÉN se memoriza: sin esto, cada acta del lote pagaría
    // 1,2 s de timeout contra un puerto que no contesta.
    expect(await ladoNativoDisponible()).toBe(false);
    expect(llamadas.length).toBe(1);
  });

  test("responde basura → false (jamás un estado que mienta)", async () => {
    respuesta = () => Promise.resolve(new Response("no es json", { status: 200 }));
    expect(await ladoNativoDisponible()).toBe(false);
    expect(saludNativo()?.motor).toBeNull();
  });
});

describe("nativo — token efímero del sidecar (H-44, TRAY-C-07)", () => {
  // El override del operador pega el token IMPRESO por el arranque del
  // sidecar como ?token= de la URL; el cliente lo pela y lo manda como
  // header x-sidecar-token en los POST. /salud no lo conoce ni lo necesita.
  const CON_TOKEN = "http://127.0.0.1:8765?token=deadbeefcafe0123";
  const OK_OCR = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ texto: "x", conf: 1, detMs: 1, recMs: 1, nBoxes: 1, nLineas: 1 }),
        { headers: { "content-type": "application/json" } },
      ),
    );

  afterEach(() => {
    // El estado del módulo (urlNativo/tokenNativo) es GLOBAL en el proceso
    // de bun donde corren TODAS las suites: se restaura el default (la flag
    // sin token) para no envenenar a las demás.
    configurarNativo("http://127.0.0.1:8765");
  });

  test("urlLadoNativo conserva el ?token= (la tarjeta re-arma con él) y la sonda va a la URL limpia", async () => {
    configurarNativo(CON_TOKEN);
    // urlLadoNativo() es lo que la tarjeta congela al montar y usa para
    // RE-ARMAR (`configurarNativo(url)`): con la base pelada el re-arme
    // perdería el token y los POST caerían a 401/WASM sin decir nada.
    expect(urlLadoNativo()).toBe(CON_TOKEN);
    // El ?token= NUNCA puede llegar al path del fetch (`…?token=x/salud`
    // sería un 404 silencioso de la sonda).
    await ladoNativoDisponible();
    expect(llamadas[0]).toBe("http://127.0.0.1:8765/salud");
  });

  test("POST /ocr manda el token como header x-sidecar-token", async () => {
    configurarNativo(CON_TOKEN);
    respuesta = OK_OCR;
    const salida = await ocrNativo("data:image/jpeg;base64,AAAA", 1280);
    expect(salida?.texto).toBe("x");
    expect(llamadas[0]).toBe("http://127.0.0.1:8765/ocr");
    expect(cabeceras[0]?.["x-sidecar-token"]).toBe("deadbeefcafe0123");
    expect(cabeceras[0]?.["content-type"]).toBe("application/json");
  });

  test("POST /acta manda el MISMO header", async () => {
    configurarNativo(CON_TOKEN);
    respuesta = () =>
      Promise.resolve(
        new Response(JSON.stringify({ procesada: "data:", texto: "x", conf: 1 }), {
          headers: { "content-type": "application/json" },
        }),
      );
    const salida = await actaNativa("data:image/jpeg;base64,AAAA");
    expect(salida?.texto).toBe("x");
    expect(llamadas[0]).toBe("http://127.0.0.1:8765/acta");
    expect(cabeceras[0]?.["x-sidecar-token"]).toBe("deadbeefcafe0123");
  });

  test("sin token en la URL no viaja el header (sidecar viejo intacto)", async () => {
    configurarNativo("http://127.0.0.1:8765");
    respuesta = OK_OCR;
    await ocrNativo("data:image/jpeg;base64,AAAA", 1280);
    expect(cabeceras[0]?.["x-sidecar-token"]).toBeUndefined();
  });

  test("401 de token → null (caída al WASM), jamás lanza", async () => {
    configurarNativo(CON_TOKEN);
    respuesta = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "token", detalle: "…" }), { status: 401 }),
      );
    expect(await ocrNativo("data:image/jpeg;base64,AAAA", 1280)).toBeNull();
    expect(await actaNativa("data:image/jpeg;base64,AAAA")).toBeNull();
  });
});
