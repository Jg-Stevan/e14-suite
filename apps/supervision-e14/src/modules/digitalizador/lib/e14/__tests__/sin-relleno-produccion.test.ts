/**
 * Guardarraíl anti-relleno (auditoría 2026-11-11, fase 5 / T5.2).
 *
 * Espejo del T5.1 de digielect14: el acta DEMO del motor se colaba en las
 * actas REALES del digitalizador (título «ROMA - CONSULADO», candidatos con
 * votos, jurados con nombre y barcode inventado) y las fotos reales de la
 * jornada seguían en el árbol. Este test congela el fallback honesto y las
 * dos retiradas:
 *
 *  1. COMPORTAMIENTO — sin clasificación, `construirActa` y
 *     `actaTimeoutWatchdog` producen «ACTA SIN IDENTIFICAR», ubicación «—»,
 *     `candidatos: []` y sin `codigoBarras`.
 *  2. FILESYSTEM — `assets/actas-demo/` no existe y ningún archivo bajo
 *     `src/` menciona el nombre de archivo real de la jornada.
 *  3. FUENTE — `acta-factory.ts` y `runner-watchdog.ts` no mencionan
 *     `ACTA_MOCK`.
 *
 * R-30 (H-25) — AMPLIACIÓN de los puntos ciegos: el walk ahora incluye
 * `.js`/`.mjs` bajo src/ (excluyendo vendor), `ACTA_MOCK` solo puede
 * mencionarse en la lista de permitidos del motor (espejo del T5.1 de
 * digielect14), los PRODUCTORES de datos demo están enumerados (si uno se
 * mueve, el guard obliga a tocar la lista a propósito) y el directorio de
 * fixtures demo se congela archivo por archivo (cualquier extensión nueva
 * — .png/.webp/… — de un productor nuevo revienta).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { OpcionesEscaneo } from "../bridge";
import { construirActa } from "../acta-factory";
import { actaTimeoutWatchdog } from "../masiva/runner-watchdog";

const RAIZ = process.cwd();

/** Nombre de archivo real retirado, armado por partes: este guardián no
 *  puede reintroducir el literal que vigila (el criterio V2 lo busca en
 *  TODO el árbol, tests incluidos). */
const NOMBRE_FOTO_RETIRADA = ["2026", "1028"].join("");

const OPCIONES: OpcionesEscaneo = {
  objetivo: null,
  intento: 1,
  maxIntentos: 4,
  fuente: "ARCHIVO",
};

function actaSinClasificacion() {
  return construirActa(OPCIONES, {}, {
    score: 7.5,
    status: "ADVERTENCIA",
    rechazo: null,
  });
}

/** Archivos .ts/.tsx/.js/.mjs/.json bajo una raíz, excluyendo node_modules,
 *  tests y vendor (el criterio V2 de la auditoría también excluye
 *  `__tests__`; R-30/H-25 añade .js/.mjs — los productores de datos demo
 *  pueden colarse por un script — y excluye `vendor`, que es código
 *  tercerizado vigilado por su propio contrato). */
function archivosFuente(raizRelativa: string): string[] {
  const salida: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada === "__tests__" || entrada === "vendor") continue;
      const ruta = join(dir, entrada);
      const info = statSync(ruta);
      if (info.isDirectory()) {
        visitar(ruta);
      } else if (
        /\.(ts|tsx|js|mjs|json)$/.test(entrada) &&
        !/\.test\.(ts|tsx|js|mjs)$/.test(entrada)
      ) {
        salida.push(ruta);
      }
    }
  };
  visitar(join(RAIZ, raizRelativa));
  return salida;
}

describe("T5.2 — fallback honesto (supervision-e14)", () => {
  test("construirActa sin clasificación: título/ubicación honestos, cero candidatos", () => {
    const acta = actaSinClasificacion();
    expect(acta.titulo).toBe("ACTA SIN IDENTIFICAR");
    expect(acta.ubicacion.departamento).toBe("—");
    expect(acta.ubicacion.municipio).toBe("—");
    expect(acta.ubicacion.zona).toBe("—");
    expect(acta.ubicacion.puesto).toBe("—");
    expect(acta.candidatos).toEqual([]);
    expect(acta.codigoBarras).toBeUndefined();
    expect(acta.firmas.every((f) => f.nombre === "—")).toBe(true);
  });

  test("actaTimeoutWatchdog: misma honestidad que la fábrica", () => {
    const acta = actaTimeoutWatchdog("fila-1");
    expect(acta.titulo).toBe("ACTA SIN IDENTIFICAR");
    expect(acta.ubicacion.departamento).toBe("—");
    expect(acta.candidatos).toEqual([]);
    expect(acta.codigoBarras).toBeUndefined();
    expect(acta.firmas.map((f) => f.nombre)).toEqual(["—", "—", "—"]);
  });

  test("las fotos reales del lote demo ya no viven en el árbol", () => {
    expect(
      existsSync(join(RAIZ, "src/modules/digitalizador/assets/actas-demo")),
    ).toBe(false);
  });

  test("ningún archivo bajo src/ menciona el nombre real de la foto retirada", () => {
    const infractores = archivosFuente("src")
      .filter((archivo) =>
        readFileSync(archivo, "utf-8").includes(NOMBRE_FOTO_RETIRADA),
      )
      .map((archivo) => relative(RAIZ, archivo).replace(/\\/g, "/"));
    expect(infractores).toEqual([]);
  });

  test("acta-factory.ts y runner-watchdog.ts no mencionan ACTA_MOCK", () => {
    for (const ruta of [
      "src/modules/digitalizador/lib/e14/acta-factory.ts",
      "src/modules/digitalizador/lib/e14/masiva/runner-watchdog.ts",
    ]) {
      expect(readFileSync(join(RAIZ, ruta), "utf-8")).not.toContain("ACTA_MOCK");
    }
  });
});

// ─── R-30 (H-25) — vigilancia anti-relleno AMPLIADA ─────────────────────────
//
// El guard original tenía puntos ciegos: solo miraba src/ del panel, solo
// .ts/.tsx/.json, el filename retirado era puntual y los productores de
// datos demo NUEVOS (otro fetch de fixtures, otro módulo que mencione el
// acta del motor) no quedaban vigilados. Esta suite congela la superficie
// demo completa del panel: quién la produce, qué archivos la mencionan y
// qué fixtures existen en el árbol.

/** Archivos que HOY pueden mencionar ACTA_MOCK y por qué (espejo del
 *  MENCIONES_PERMITIDAS del T5.1 de digielect14): la definición del motor
 *  y el comentario del motor vendorizado. Un archivo NUEVO que la mencione
 *  (p. ej. un import del acta demo fuera del modo SIM) hace roja la puerta. */
const MENCIONES_PERMITIDAS_ACTA_MOCK = new Map<string, string>([
  [
    "../../packages/scanner-core/src/dominio/seed.ts",
    "definición del acta de demostración del motor (consumida solo por SIM)",
  ],
  [
    "../../packages/scanner-core/src/dominio/clasificador.ts",
    "comentario del motor vendorizado que cita la convención de ubicación",
  ],
]);

/** PRODUCTORES de datos demo conocidos del panel (ruta → rol). Si uno se
 *  mueve o se elimina, el test obliga a actualizar esta lista A PROPÓSITO
 *  (nada de productores de demo sin vigilar). */
const PRODUCTORES_DEMO: ReadonlyArray<[string, string]> = [
  [
    "src/modules/digitalizador/lib/e14/actas-demo.ts",
    "lote DEMO ×4 de la bandeja (fetchActasDemo → fixtures acta-sim-*)",
  ],
  [
    "src/modules/digitalizador/lib/e14/sim-assets.ts",
    "muestras de la SIMULACIÓN de cámara (fixtures acta-sim-*)",
  ],
  [
    "src/modules/supervision/data/ancla-demo.ts",
    "ancla demo del panel (flag anclaDemoSupervision, default OFF)",
  ],
  [
    "src/modules/supervision/data/actas-mock.ts",
    "actas sembradas del mockup (gated por anclaDemoActiva)",
  ],
  [
    "src/modules/supervision/data/mock-repository.ts",
    "siembra del repositorio de supervisión (gated por anclaDemoActiva)",
  ],
  [
    "src/test-preload.ts",
    "activa el ancla demo para la suite (preload de bunfig.toml)",
  ],
  [
    "../../packages/scanner-core/src/dominio/seed.ts",
    "ACTA_MOCK del motor (solo la consume el modo SIM)",
  ],
];

/** Archivos que HOY pueden mencionar las fixtures demo (acta-sim-*) y por
 *  qué. flags.ts solo las cita en un comentario. */
const MENCIONES_PERMITIDAS_FIXTURES = new Map<string, string>([
  [
    "src/modules/digitalizador/lib/e14/actas-demo.ts",
    "productor del lote DEMO ×4 (imports de las fixtures)",
  ],
  [
    "src/modules/digitalizador/lib/e14/sim-assets.ts",
    "productor de las muestras de simulación (imports de las fixtures)",
  ],
  [
    "src/modules/digitalizador/lib/e14/flags.ts",
    "comentario del flag loteDemoLocal que documenta las fixtures",
  ],
]);

/** Fixtures demo que HOY viven en el árbol del digitalizador — EXACTAS:
 *  ninguna más (ni otro nombre, ni otra extensión: .png/.webp/… de un
 *  productor nuevo también revienta aquí). */
const FIXTURES_ASSETS_DEMO = [
  "acta-sim-baja.jpg",
  "acta-sim-extra-1.jpg",
  "acta-sim-extra-2.jpg",
  "acta-sim-intermedia.jpg",
];

describe("R-30 (H-25) — vigilancia anti-relleno ampliada (supervision-e14)", () => {
  test("ACTA_MOCK solo se menciona en los sitios permitidos (src/ + motor, .ts→.mjs)", () => {
    // El walk cubre AMBAS superficies (app + motor vendorizado) y TODAS las
    // extensiones de código (los productores de demo pueden ser scripts).
    const infractores: string[] = [];
    for (const raiz of ["src", "../../packages/scanner-core/src"]) {
      for (const archivo of archivosFuente(raiz)) {
        if (!readFileSync(archivo, "utf-8").includes("ACTA_MOCK")) continue;
        const relativa = relative(RAIZ, archivo).replace(/\\/g, "/");
        if (!MENCIONES_PERMITIDAS_ACTA_MOCK.has(relativa)) {
          infractores.push(relativa);
        }
      }
    }
    expect(infractores).toEqual([]);
  });

  test("los productores de datos demo conocidos siguen existiendo (vigilancia consciente)", () => {
    // La lista ES la vigilancia: si un productor se mueve/elimina, este
    // test obliga a actualizarla a propósito en el mismo commit.
    const faltantes = PRODUCTORES_DEMO.filter(
      ([ruta]) => !existsSync(join(RAIZ, ruta)),
    ).map(([ruta]) => ruta);
    expect(faltantes).toEqual([]);
  });

  test("las fixtures demo (acta-sim-*) solo se mencionan desde los sitios permitidos", () => {
    const infractores: string[] = [];
    for (const archivo of archivosFuente("src")) {
      if (!readFileSync(archivo, "utf-8").includes("acta-sim-")) continue;
      const relativa = relative(RAIZ, archivo).replace(/\\/g, "/");
      if (!MENCIONES_PERMITIDAS_FIXTURES.has(relativa)) {
        infractores.push(relativa);
      }
    }
    expect(infractores).toEqual([]);
  });

  test("el directorio de assets demo contiene EXACTAMENTE las 4 fixtures conocidas", () => {
    // Cualquier archivo NUEVO en el directorio de fixtures demo (otro nombre
    // u OTRA EXTENSIÓN — .png, .webp, .pdf…) es un productor de datos demo
    // sin vigilar: el guard original solo miraba código, nunca los assets.
    const dir = join(RAIZ, "src/modules/digitalizador/assets");
    const presentes = readdirSync(dir).sort();
    expect(presentes).toEqual([...FIXTURES_ASSETS_DEMO].sort());
  });
});
