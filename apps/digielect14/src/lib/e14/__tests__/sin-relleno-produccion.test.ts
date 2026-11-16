/**
 * Guardarraíl anti-relleno (auditoría 2026-11-11, fase 5 / T5.1).
 *
 * El acta DEMO del motor (`ACTA_MOCK`) se colaba en pantalla y en el sobre
 * del hub: título «ROMA - CONSULADO», candidatos con votos, jurados con
 * nombre y un barcode inventado. Este test impide la regresión por las dos
 * vías que la auditoría marcó:
 *
 *  1. GUARDA DE FUENTE — `scanner-core-bridge.ts` no menciona `ACTA_MOCK`.
 *  2. COMPORTAMIENTO — `mapearActaAPuente` sin `codigoBarras` produce una
 *     `impresion` SIN la clave `barcode` (nunca un id de seguimiento falso).
 *  3. LISTA DE PERMITIDOS — `ACTA_MOCK` solo puede existir donde nace (seed
 *     del motor) o en el comentario del motor; un import nuevo en la app
 *     hace roja la puerta.
 *
 * R-30 (H-25) — AMPLIACIÓN de los puntos ciegos: el walk ahora incluye
 * `.js`/`.mjs` (excluyendo vendor), los PRODUCTORES de datos demo están
 * enumerados (modo SIM + simularImagen del store, catálogo de la galería,
 * seed del motor — si uno se mueve, el guard obliga a tocar la lista a
 * propósito), las fixtures de la galería SIM solo pueden cargarse desde el
 * catálogo y los directorios de fixtures se congelan archivo por archivo
 * (cualquier extensión nueva — .png/.webp/… — de un productor nuevo revienta).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  mapearActaAPuente,
  type ActaMapeable,
} from "../puente/mapear";

const RAIZ = process.cwd();

function leer(rutaRelativa: string): string {
  return readFileSync(join(RAIZ, rutaRelativa), "utf-8");
}

/** Archivos .ts/.tsx/.js/.mjs bajo una raíz, excluyendo tests, node_modules
 *  y vendor (R-30/H-25: .js/.mjs — los productores de datos demo pueden
 *  colarse por un script — y `vendor`, código tercerizado con contrato
 *  propio, p. ej. el jsQR del motor). */
function archivosFuente(raizRelativa: string): string[] {
  const salida: string[] = [];
  const visitar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada === "__tests__" || entrada === "vendor") continue;
      const ruta = join(dir, entrada);
      const info = statSync(ruta);
      if (info.isDirectory()) {
        visitar(ruta);
      } else if (/\.(ts|tsx|js|mjs)$/.test(entrada) && !/\.test\.(ts|tsx|js|mjs)$/.test(entrada)) {
        salida.push(ruta);
      }
    }
  };
  visitar(join(RAIZ, raizRelativa));
  return salida;
}

/** Archivos que HOY pueden mencionar ACTA_MOCK y por qué. */
const MENCIONES_PERMITIDAS = new Map<string, string>([
  [
    "../../packages/scanner-core/src/dominio/seed.ts",
    "definición del acta de demostración del motor (consumida solo por SIM)",
  ],
  [
    "../../packages/scanner-core/src/dominio/clasificador.ts",
    "comentario del motor vendorizado que cita la convención de ubicación",
  ],
]);

/** Acta mínima mapeable: join DIVIPOL completo + foto procesada. */
function actaMapeable(extra: Partial<ActaMapeable> = {}): ActaMapeable {
  return {
    id: "test-1",
    titulo: "ACTA SIN IDENTIFICAR",
    ubicacion: {
      departamento: "—",
      municipio: "—",
      zona: "—",
      puesto: "—",
      mesa: "001",
    },
    tipo: "SIN CLASIFICAR",
    pagina: { index: 1, total: 1 },
    candidatos: [],
    firmas: [],
    score: 7.5,
    status: "ADVERTENCIA",
    rechazo: null,
    intento: 1,
    maxIntentos: 4,
    fotoProcesada: "data:image/png;base64,AAAA",
    clasificacion: {
      departamento: { codigo: "88", nombre: "ARCHIPIELAGO DE SAN ANDRES" },
      municipio: { codigo: "495", nombre: "ITALIA" },
      zona: { codigo: "10" },
      puesto: { codigo: "02", nombre: "Roma - Consulado" },
      mesa: 1,
      tipo: "TRANSMISION",
      pagina: { index: 1, total: 1 },
      kit: null,
      nivel: "AUTO",
      confianzas: { departamento: 1, municipio: 1, puesto: 1, tipo: 1 },
    },
    ...extra,
  };
}

describe("T5.1 — sin relleno en producción (digielect14)", () => {
  test("scanner-core-bridge.ts ya NO menciona el acta de demostración", () => {
    expect(leer("src/lib/e14/scanner-core-bridge.ts")).not.toContain("ACTA_MOCK");
  });

  test("mapearActaAPuente sin codigoBarras → impresion SIN la clave barcode", async () => {
    const entrada = await mapearActaAPuente(actaMapeable());
    expect(entrada).not.toBeNull();
    expect(entrada).not.toHaveProperty("impresion.barcode");
    expect(Object.keys(entrada!.impresion)).not.toContain("barcode");
  });

  test("mapearActaAPuente con codigoBarras REAL lo conserva (control)", async () => {
    const entrada = await mapearActaAPuente(
      actaMapeable({ codigoBarras: "8801-495-10-02-001-3" }),
    );
    expect(entrada?.impresion.barcode).toBe("8801-495-10-02-001-3");
  });

  test("ACTA_MOCK solo se menciona en los sitios permitidos", () => {
    const infractores: string[] = [];
    for (const raiz of ["src", "../../packages/scanner-core/src"]) {
      for (const archivo of archivosFuente(raiz)) {
        if (!readFileSync(archivo, "utf-8").includes("ACTA_MOCK")) continue;
        const relativa = relative(RAIZ, archivo).replace(/\\/g, "/");
        if (!MENCIONES_PERMITIDAS.has(relativa)) infractores.push(relativa);
      }
    }
    expect(infractores).toEqual([]);
  });
});

// ─── R-30 (H-25) — vigilancia anti-relleno AMPLIADA ─────────────────────────
//
// El guard original tenía puntos ciegos: el walk solo miraba .ts/.tsx (un
// productor de datos demo colado como script .mjs pasaba inadvertido) y los
// productores NUEVOS (otro módulo que cargue fixtures, otro import del seed)
// no quedaban vigilados. Esta suite congela la superficie demo completa del
// móvil: quién la produce, qué archivos cargan las fixtures y qué archivos
// demo existen en el árbol.

/** PRODUCTORES de datos demo conocidos del móvil (ruta → rol). Si uno se
 *  mueve o se elimina, el test obliga a actualizar esta lista A PROPÓSITO
 *  (nada de productores de demo sin vigilar). */
const PRODUCTORES_DEMO: ReadonlyArray<[string, string]> = [
  [
    "src/lib/e14/store/simulacion.ts",
    "modo SIM + simularImagen (guion demo — overlay de vista D6, jamás datos reales)",
  ],
  [
    "src/lib/e14/simulacion-imagenes.ts",
    "catálogo de la galería «Simulación» (fixtures sim-*)",
  ],
  [
    "../../packages/scanner-core/src/dominio/seed.ts",
    "ACTA_MOCK / mesasIniciales / guionDePuesto del motor (solo modo SIM)",
  ],
];

/** Archivos que HOY pueden cargar las fixtures de la galería SIM
 *  (`@/assets/simuladas/`) y por qué: solo el catálogo. */
const MENCIONES_PERMITIDAS_SIMULADAS = new Map<string, string>([
  [
    "src/lib/e14/simulacion-imagenes.ts",
    "catálogo de la galería (imports estáticos de thumbs + cargadores dinámicos S-6)",
  ],
]);

/** Ningún archivo de producción puede mencionar las fixtures `acta-sim-*`:
 *  hoy SOLO las cita un comentario de un test (excluido del walk) — la
 *  lista de permitidos vive VACÍA a propósito. */
const MENCIONES_PERMITIDAS_ACTA_SIM: string[] = [];

/** Fixtures demo que HOY viven en el árbol — EXACTAS: ninguna más (ni otro
 *  nombre, ni otra extensión: .png/.webp/… de un productor nuevo también
 *  revienta aquí). */
const FIXTURES_ASSETS_SIM = [
  "acta-sim-baja.jpg",
  "acta-sim-extra-1.jpg",
  "acta-sim-extra-2.jpg",
  "acta-sim-intermedia.jpg",
];
const FIXTURES_SIMULADAS = [
  "sim-color.jpg",
  // Thumb heredado junto a su original (histórico del kit — el resto vive
  // en thumbs/): se congela donde está.
  "sim-color.thumb.jpg",
  "sim-inclinada.jpg",
  "sim-normal.jpg",
  "sim-recorte-inferior.jpg",
  "sim-recorte-superior.jpg",
  "sim-rotada.jpg",
  "sim-sombras.jpg",
];
const FIXTURES_SIMULADAS_THUMBS = [
  "sim-color.thumb.jpg",
  "sim-inclinada.thumb.jpg",
  "sim-normal.thumb.jpg",
  "sim-recorte-inferior.thumb.jpg",
  "sim-recorte-superior.thumb.jpg",
  "sim-rotada.thumb.jpg",
  "sim-sombras.thumb.jpg",
];

describe("R-30 (H-25) — vigilancia anti-relleno ampliada (digielect14)", () => {
  test("los productores de datos demo conocidos siguen existiendo (vigilancia consciente)", () => {
    // La lista ES la vigilancia: si un productor se mueve/elimina, este
    // test obliga a actualizarla a propósito en el mismo commit.
    const faltantes = PRODUCTORES_DEMO.filter(
      ([ruta]) => !existsSync(join(RAIZ, ruta)),
    ).map(([ruta]) => ruta);
    expect(faltantes).toEqual([]);
  });

  test("las fixtures de la galería SIM solo se cargan desde el catálogo", () => {
    const infractores: string[] = [];
    for (const archivo of archivosFuente("src")) {
      if (!readFileSync(archivo, "utf-8").includes("@/assets/simuladas")) continue;
      const relativa = relative(RAIZ, archivo).replace(/\\/g, "/");
      if (!MENCIONES_PERMITIDAS_SIMULADAS.has(relativa)) infractores.push(relativa);
    }
    expect(infractores).toEqual([]);
  });

  test("nadie en producción menciona las fixtures acta-sim-* (lista de permitidos VACÍA)", () => {
    const infractores: string[] = [];
    for (const archivo of archivosFuente("src")) {
      if (!readFileSync(archivo, "utf-8").includes("acta-sim-")) continue;
      const relativa = relative(RAIZ, archivo).replace(/\\/g, "/");
      if (!MENCIONES_PERMITIDAS_ACTA_SIM.includes(relativa)) infractores.push(relativa);
    }
    expect(infractores).toEqual([]);
  });

  test("los directorios de fixtures demo contienen EXACTAMENTE los archivos conocidos", () => {
    // Cualquier archivo NUEVO en los directorios de fixtures (otro nombre u
    // OTRA EXTENSIÓN — .png, .webp, .pdf…) es un productor de datos demo
    // sin vigilar: el guard original solo miraba código, nunca los assets.
    expect(readdirSync(join(RAIZ, "src/assets")).sort()).toEqual(
      [...FIXTURES_ASSETS_SIM, "simuladas"].sort(),
    );
    expect(readdirSync(join(RAIZ, "src/assets/simuladas")).sort()).toEqual(
      [...FIXTURES_SIMULADAS, "thumbs"].sort(),
    );
    expect(
      readdirSync(join(RAIZ, "src/assets/simuladas/thumbs")).sort(),
    ).toEqual([...FIXTURES_SIMULADAS_THUMBS].sort());
  });
});
