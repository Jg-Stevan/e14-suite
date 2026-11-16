#!/usr/bin/env bun
/**
 * R-41 (auditoría 2026-11-16 §6.7) — GRAFO DE DEPENDENCIAS y GATE de ciclos.
 *
 * Hueco que cierra: knip cayó por memoria en la auditoría y no hubo
 * alternativa (madge/dependency-cruiser no entraron) — las fronteras de
 * paquete se veían sanas POR MUESTREO, no por análisis. Este script es el
 * análisis: un escáner propio de imports ES/TS (regex, sin dependencias
 * nuevas — YAGNI) que construye el grafo módulo a módulo y lo agrega a
 * nivel de ÁRBOL (app→app, app→paquete, paquete→app).
 *
 *   bun scripts/analisis-grafo.mjs      (o: node scripts/analisis-grafo.mjs)
 *
 * QUÉ ESCANEA: apps/digielect14/src · apps/supervision-e14/src ·
 * packages/scanner-core/src (.ts/.tsx/.mts/.mjs/.js). Los vendors bundle
 * (jsQR.js) son UMD sin imports ES — quedan como nodos hoja, sin ruido.
 *
 * GATE (exit 1 si falla — es el gate del CI, .github/workflows/ci-analisis.yml):
 *   (a) DIP: CERO aristas paquete→app — el motor (scanner-core) JAMÁS
 *       importa de las apps; las apps consumen el motor, nunca al revés.
 *   (b) CERO ciclos ENTRE árboles — un ciclo que atraviese la frontera
 *       app↔paquete es una inversión de la dependencia (y con (a) ya es
 *       imposible; (b) además cubriría un app↔app mutuo).
 *
 * INFORMATIVO (no rompe el build): ciclos INTERNOS de un árbol — el código
 * de app tiene ciclos deliberados y documentados (runner↔precalor↔store);
 * el plan solo exige gate en ciclos NUEVOS entre packages/ y apps/. Se
 * listan los clústeres (SCC >1 módulo) para que un ciclo NUEVO sea visible
 * en el diff del reporte.
 *
 * Resolución de especificadores (sin bundler — reglas del repo):
 *   · "./x" "../x"       → relativo al archivo, probando extensiones
 *                          .ts .tsx .mts .mjs .js .json e index.* (y CSS/
 *                          assets tal cual: son hojas del grafo);
 *   · "@/x"              → alias de tsconfig de la APP que importa → su src/;
 *   · "@jg-stevan/scanner-core[/sub]" → exports map del paquete → src/
 *                          (raíz → src/index.ts; workers/assets/scripts
 *                          también aceptados como subpaths del paquete);
 *   · lo demás (react, bun:test, node:*) → EXTERNA (contada, no gateada).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─── Definición de árboles ──────────────────────────────────────────────────

const ARBOLES = {
  "digielect14": {
    prefijo: join(RAIZ, "apps/digielect14"),
    escaneo: join(RAIZ, "apps/digielect14/src"),
  },
  "supervision-e14": {
    prefijo: join(RAIZ, "apps/supervision-e14"),
    escaneo: join(RAIZ, "apps/supervision-e14/src"),
  },
  "scanner-core": {
    prefijo: join(RAIZ, "packages/scanner-core"),
    escaneo: join(RAIZ, "packages/scanner-core/src"),
    paquete: "@jg-stevan/scanner-core", // exports: "." → src/index.ts, "./*" → src/*.ts
  },
};

const APPS = Object.keys(ARBOLES).filter((t) => t !== "scanner-core");
const EXTENSIONES_CODIGO = new Set([".ts", ".tsx", ".mts", ".mjs", ".js"]);

// ─── Escaneo de archivos ────────────────────────────────────────────────────

function caminar(directorio) {
  const archivos = [];
  for (const entrada of readdirSync(directorio)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      archivos.push(...caminar(ruta));
    } else {
      archivos.push(ruta);
    }
  }
  return archivos;
}

// ─── Extracción de imports (regex, con stripper de comentarios) ─────────────

/** Quita // y bloque *​/ SIN romper strings que contengan "//" (URLs). */
function sinComentarios(codigo) {
  let salida = "";
  let i = 0;
  const n = codigo.length;
  let comilla = null; // "'", '"', "`"
  while (i < n) {
    const c = codigo[i];
    if (comilla) {
      salida += c;
      if (c === "\\") {
        salida += codigo[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === comilla) comilla = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      comilla = c;
      salida += c;
      i++;
      continue;
    }
    if (c === "/" && codigo[i + 1] === "/") {
      while (i < n && codigo[i] !== "\n") i++;
      continue; // el \n lo copia la iteración siguiente
    }
    if (c === "/" && codigo[i + 1] === "*") {
      i += 2;
      while (i < n && !(codigo[i] === "*" && codigo[i + 1] === "/")) i++;
      i += 2;
      salida += " ";
      continue;
    }
    salida += c;
    i++;
  }
  return salida;
}

function extraerImports(codigo) {
  const limpio = sinComentarios(codigo);
  const especificadores = new Set();
  // import … from "x" · export … from "x" (incluye multilinea: from "…" al final)
  for (const m of limpio.matchAll(/\bfrom\s*["']([^"']+)["']/g)) especificadores.add(m[1]);
  // import("x") dinámico (\s* cubre salto de línea) — también typeof import("x")
  for (const m of limpio.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) especificadores.add(m[1]);
  // import "x" (side-effect) · require("x")
  for (const m of limpio.matchAll(/\bimport\s+["']([^"']+)["']/g)) especificadores.add(m[1]);
  for (const m of limpio.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) especificadores.add(m[1]);
  return [...especificadores];
}

// ─── Resolución ─────────────────────────────────────────────────────────────

const PROBAS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".json", ".css", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

function probe(rutaBase) {
  for (const ext of PROBAS) {
    const candidato = rutaBase + ext;
    if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  }
  return null;
}

function arbolDe(ruta) {
  for (const [nombre, def] of Object.entries(ARBOLES)) {
    if (ruta === def.prefijo || ruta.startsWith(def.prefijo + "/")) return nombre;
  }
  return null;
}

/** Resuelve un especificador desde `archivo` (con su árbol). Devuelve la
 * ruta absoluta del módulo objetivo, o null si es externo/irresoluble. */
function resolver(especificador, archivo, arbolArchivo) {
  const base = dirname(archivo);
  let objetivo = null;

  if (especificador.startsWith("./") || especificador.startsWith("../")) {
    objetivo = probe(resolve(base, especificador));
  } else if (especificador.startsWith("@/")) {
    // Alias de tsconfig de la app que importa: "@/*" → su src/*.
    objetivo = probe(join(ARBOLES[arbolArchivo].escaneo, especificador.slice(2)));
  } else if (especificador === ARBOLES["scanner-core"].paquete) {
    objetivo = probe(join(ARBOLES["scanner-core"].escaneo, "index.ts")); // exports "."
  } else if (especificador.startsWith(ARBOLES["scanner-core"].paquete + "/")) {
    const sub = especificador.slice(ARBOLES["scanner-core"].paquete.length + 1);
    // exports "./*" → "./src/*" (con y sin .ts); workers/assets/scripts/tests
    // caen en la proba por raíz del paquete.
    objetivo =
      probe(join(ARBOLES["scanner-core"].escaneo, sub)) ??
      probe(join(ARBOLES["scanner-core"].prefijo, sub));
  }

  if (objetivo) return objetivo;
  return null; // externa (react, bun:test, node:*) o irresoluble — se separa abajo
}

// ─── Construcción del grafo ─────────────────────────────────────────────────

/** id de nodo = ruta relativa al repo (estable entre corridas y SOs). */
const id = (rutaAbsoluta) => relative(RAIZ, rutaAbsoluta).replaceAll("\\", "/");

const nodos = new Map(); // id → { archivo, arbol, esCodigo, importaciones:Set<id> }
const externas = new Map(); // especificador → nº de aristas
const noResueltas = []; // { desde, especificador } — relativos que no resolvieron

function asegurarNodo(rutaAbsoluta) {
  const nid = id(rutaAbsoluta);
  if (!nodos.has(nid)) {
    const extension = nid.slice(nid.lastIndexOf("."));
    nodos.set(nid, {
      archivo: nid,
      arbol: arbolDe(rutaAbsoluta),
      esCodigo: EXTENSIONES_CODIGO.has(extension),
      importaciones: new Set(),
    });
  }
  return nodos.get(nid);
}

for (const [nombreArbol, def] of Object.entries(ARBOLES)) {
  for (const ruta of caminar(def.escaneo)) {
    const nodo = asegurarNodo(ruta);
    if (!nodo.esCodigo) continue; // json/css/assets: hojas, sin imports
    const codigo = readFileSync(ruta, "utf8");
    for (const esp of extraerImports(codigo)) {
      const objetivo = resolver(esp, ruta, nombreArbol);
      if (!objetivo) {
        if (esp.startsWith("./") || esp.startsWith("../") || esp.startsWith("@/")) {
          noResueltas.push({ desde: nodo.archivo, especificador: esp });
        } else {
          externas.set(esp, (externas.get(esp) ?? 0) + 1);
        }
        continue;
      }
      nodo.importaciones.add(asegurarNodo(objetivo).archivo);
    }
  }
}

// ─── Clasificación de aristas ───────────────────────────────────────────────

const aristas = []; // { desde, hacia, desdeArbol, haciaArbol, clase }
for (const nodo of nodos.values()) {
  for (const hacia of nodo.importaciones) {
    const destino = nodos.get(hacia);
    const clase =
      nodo.arbol === destino.arbol ? "intra"
      : destino.arbol === "scanner-core" ? "app→paquete"
      : nodo.arbol === "scanner-core" ? "paquete→app"
      : "app→app";
    aristas.push({ desde: nodo.archivo, hacia, desdeArbol: nodo.arbol, haciaArbol: destino.arbol, clase });
  }
}

const appAPaquete = aristas.filter((a) => a.clase === "app→paquete");
const paqueteAApp = aristas.filter((a) => a.clase === "paquete→app");
const appAApp = aristas.filter((a) => a.clase === "app→app");

// (b) ciclos ENTRE árboles: agregado por árbol + DFS con detección de ciclo.
const grafoArbol = new Map(Object.keys(ARBOLES).map((t) => [t, new Set()]));
for (const a of aristas) {
  if (a.desdeArbol && a.haciaArbol && a.desdeArbol !== a.haciaArbol) {
    grafoArbol.get(a.desdeArbol).add(a.haciaArbol);
  }
}
const ciclosEntreArboles = [];
{
  const visitando = new Set();
  const hechos = new Set();
  const pila = [];
  const dfs = (nodo) => {
    visitando.add(nodo);
    pila.push(nodo);
    for (const vecino of grafoArbol.get(nodo) ?? []) {
      if (visitando.has(vecino)) {
        const desde = pila.indexOf(vecino);
        ciclosEntreArboles.push([...pila.slice(desde), vecino].join(" → "));
      } else if (!hechos.has(vecino)) {
        dfs(vecino);
      }
    }
    pila.pop();
    visitando.delete(nodo);
    hechos.add(nodo);
  };
  for (const t of grafoArbol.keys()) if (!hechos.has(t)) dfs(t);
}

// Ciclos INTERNOS (informativos): componentes fuertemente conexas (Tarjan
// iterativo) por árbol — un SCC con >1 módulo es un clúster de ciclo.
function sccs(arbol) {
  const indices = new Map(), bajos = new Map(), enPila = new Set(), pila = [], salida = [];
  let contador = 0;
  const grafo = new Map();
  for (const a of aristas) {
    if (a.desdeArbol !== arbol || a.haciaArbol !== arbol) continue;
    if (!grafo.has(a.desde)) grafo.set(a.desde, []);
    grafo.get(a.desde).push(a.hacia);
  }
  const fuerte = (v) => {
    const trabajo = [[v, 0]];
    indices.set(v, contador); bajos.set(v, contador); contador++;
    pila.push(v); enPila.add(v);
    while (trabajo.length > 0) {
      const marco = trabajo[trabajo.length - 1];
      const u = marco[0];
      const vecinos = grafo.get(u) ?? [];
      if (marco[1] < vecinos.length) {
        marco[1] += 1;
        const w = vecinos[marco[1] - 1];
        if (!indices.has(w)) {
          indices.set(w, contador); bajos.set(w, contador); contador++;
          pila.push(w); enPila.add(w);
          trabajo.push([w, 0]);
        } else if (enPila.has(w)) {
          bajos.set(u, Math.min(bajos.get(u), indices.get(w)));
        }
      } else {
        trabajo.pop();
        if (trabajo.length > 0) {
          const padre = trabajo[trabajo.length - 1][0];
          bajos.set(padre, Math.min(bajos.get(padre), bajos.get(u)));
        }
        if (bajos.get(u) === indices.get(u)) {
          const componentes = [];
          let w;
          do {
            w = pila.pop();
            enPila.delete(w);
            componentes.push(w);
          } while (w !== u);
          if (componentes.length > 1) salida.push(componentes);
        }
      }
    }
  };
  for (const nodo of grafo.keys()) if (!indices.has(nodo)) fuerte(nodo);
  return salida;
}

// ─── Reporte ────────────────────────────────────────────────────────────────

const nodosPorArbol = Object.fromEntries(
  Object.keys(ARBOLES).map((t) => [t, [...nodos.values()].filter((n) => n.arbol === t).length])
);

console.log("═══ R-41 · ANÁLISIS DE GRAFO DE DEPENDENCIAS (gate de ciclos) ═══\n");
console.log(`Árboles escaneados: ${Object.keys(ARBOLES).join(" · ")}`);
console.log(`Módulos (nodos): ${nodos.size} — ${Object.entries(nodosPorArbol).map(([t, n]) => `${t}: ${n}`).join(" · ")}`);
console.log(
  `Aristas internas resueltas: ${aristas.length}` +
    Object.keys(ARBOLES).map((t) => ` (${t}: ${aristas.filter((a) => a.clase === "intra" && a.desdeArbol === t).length})`).join("")
);
console.log(
  `Aristas externas (npm/node): ${[...externas.values()].reduce((s, n) => s + n, 0)} en ${externas.size} paquetes — top: ${[...externas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => `${p} (${n})`).join(", ")}`
);
console.log(`Nodos hoja no-código (json/css/assets): ${[...nodos.values()].filter((n) => !n.esCodigo).length}`);
if (noResueltas.length > 0) {
  console.log(`\n⚠ IMPORTS RELATIVOS SIN RESOLVER (${noResueltas.length}) — revisar (no gatean):`);
  for (const nr of noResueltas.slice(0, 10)) console.log(`    ${nr.desde} → ${nr.especificador}`);
  if (noResueltas.length > 10) console.log(`    … y ${noResueltas.length - 10} más`);
}

console.log(`\n── Aristas ENTRE árboles (${appAPaquete.length + paqueteAApp.length + appAApp.length}) ──`);
console.log(`app→paquete (consumo legítimo — las apps usan el motor): ${appAPaquete.length}`);
for (const app of APPS) {
  const propias = appAPaquete.filter((a) => a.desdeArbol === app);
  console.log(`  ${app} → scanner-core: ${propias.length} aristas desde ${new Set(propias.map((a) => a.desde)).size} archivos`);
}
if (appAPaquete.length > 0) {
  console.log("  Detalle (origen → destino):");
  for (const a of appAPaquete.sort((x, y) => (x.desde < y.desde ? -1 : x.desde > y.desde ? 1 : x.hacia < y.hacia ? -1 : 1))) {
    console.log(`    ${a.desde} → ${a.hacia}`);
  }
}
console.log(`paquete→app (VIOLACIÓN DIP — el motor jamás importa de las apps): ${paqueteAApp.length}`);
for (const a of paqueteAApp) console.log(`    ✗ ${a.desde} → ${a.hacia}`);
console.log(`app→app (cada app es desplegable independiente): ${appAApp.length}`);
for (const a of appAApp) console.log(`    ⚠ ${a.desde} → ${a.hacia}`);

console.log("\n── Ciclos ENTRE árboles (gate) ──");
if (ciclosEntreArboles.length === 0) {
  console.log("✓ CERO ciclos entre árboles (el grafo agregado app/paquete es un DAG)");
} else {
  for (const c of ciclosEntreArboles) console.log(`✗ ciclo: ${c}`);
}

console.log("\n── Ciclos INTERNOS por árbol (informativos — documentados, NO gatean) ──");
let arbolesConCiclos = 0;
for (const t of Object.keys(ARBOLES)) {
  const clusters = sccs(t);
  if (clusters.length === 0) continue;
  arbolesConCiclos++;
  console.log(`  ${t}: ${clusters.length} clúster(es) de ciclo (SCC >1 módulo)`);
  for (const cluster of clusters) console.log(`    · ${[...cluster].sort().join(" ⇄ ")}`);
}
if (arbolesConCiclos === 0) console.log("  (ningún árbol tiene ciclos internos)");

// ─── Veredicto del gate ─────────────────────────────────────────────────────

console.log("\n═══ VEREDICTO DEL GATE ═══");
if (paqueteAApp.length === 0 && ciclosEntreArboles.length === 0) {
  console.log("✓ SIN VIOLACIONES — DIP limpio (0 paquete→app) y 0 ciclos entre árboles");
  console.log(`  ${nodos.size} módulos · ${aristas.length} aristas internas · ${appAPaquete.length} app→paquete (legítimas)`);
  process.exit(0);
} else {
  if (paqueteAApp.length > 0) console.log(`✗ VIOLACIÓN DIP: ${paqueteAApp.length} aristas paquete→app (ver arriba)`);
  if (ciclosEntreArboles.length > 0) console.log(`✗ CICLOS ENTRE ÁRBOLES: ${ciclosEntreArboles.length} (ver arriba)`);
  process.exit(1);
}
