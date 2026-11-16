/**
 * QA headless — CONTRASTE WCAG AA (R-38, auditoría 2026-11-16 §6.3: 0
 * cobertura de a11y). Sin red, sin DOM, determinista — source-scan estático
 * (patrón lección 3A.1: readFile + ok() + remate final OK, como
 * qa-aa-invariantes.ts).
 *
 *   bun scripts/qa-a11y-contraste.ts
 *
 * QUÉ HACE: extrae los PARES color-de-texto/fondo usados en los componentes
 * bajo src/components/e14/** (las pantallas críticas ESCANEAR/REVISIÓN/
 * RESUMEN/ANALIZANDO/ACTAS + el chrome que las viste) y verifica el ratio
 * de contraste WCAG 2.1: 4.5:1 texto normal, 3:1 texto grande (≥24 px, o
 * ≥18.66 px con font-bold/800/900) y 3:1 para gráficos (iconos/svg —
 * criterio 1.4.11, no 1.4.3). NOTA: la vista MasivaView NO existe en el
 * móvil (el módulo masiva se retiró — vive en el panel supervision-e14;
 * ver docs/DEUDA.md «Accesibilidad»).
 *
 * MODELO DE EXTRACCIÓN (aproximación documentada — es un AUDIT, no un
 * render): línea a línea, como qa-aa-invariantes:
 *   1. PAR DIRECTO: text-* y bg-* en la MISMA línea → par real de ese
 *      elemento (badges, chips, botones).
 *   2. PAR HEREDADO: text-* sin bg en la línea → el fondo del contenedor
 *      que la envuelve, reconstruido con una pila por indentación de los
 *      elementos con className + bg- (los contenedores del código
 *      formateado). Sin contenedor conocido → la raíz de la vista
 *      (#090d12; ScanView es #05080c — ver page.tsx/globals.css).
 *   3. ALFAS: bg-[#…]/15 y text-white/60 se componen sobre el fondo
 *      efectivo (blending sRGB estándar).
 * Limitaciones aceptadas (el triaje humano las registra en DEUDA.md):
 * variantes (hover:/disabled:) ignoradas, tamaños heredados del padre no
 * visibles en la línea (se asume texto normal — conservador), y las ramas
 * de ternarios se cuentan como pares potenciales (superestudio).
 *
 * PALETA: Tailwind v4 usa oklch — los valores se toman de
 * node_modules/tailwindcss/theme.css (4.3.5) y se convierten a sRGB con el
 * pipeline oklab→LMS→lineal→gamma. Los tokens brand-* son los de
 * src/app/globals.css (@theme). Un token SIN MAPEO revienta el gate (la
 * paleta de este script es un contrato vivo).
 *
 * PERDONADOS: los pares que ya fallan AA y están REGISTRADOS en
 * docs/DEUDA.md («Accesibilidad (R-38)») salen como WARN con su
 * referencia; el gate sigue VERDE. Cualquier par NUEVO bajo el umbral
 * revienta el check. Cuando un perdonado se remedia, el par pasa a OK por
 * sí solo y su entrada queda huérfana (inocua): se poda a mano por higiene.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// ── WCAG: color, luminancia y ratio ────────────────────────────────────────

type Rgb = { r: number; g: number; b: number }; // sRGB gamma-codificado 0..255

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** oklch(L% C H°) → sRGB gamma-codificado (pipeline Oklab de Björn Ottosson). */
function oklchARgb(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gam = lin.map((c) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(clamp01(c), 1 / 2.4) - 0.055,
  );
  return {
    r: Math.round(clamp01(gam[0]) * 255),
    g: Math.round(clamp01(gam[1]) * 255),
    b: Math.round(clamp01(gam[2]) * 255),
  };
}

function hexARgb(hex: string): Rgb {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Luminancia relativa WCAG 2.1 (entrada gamma-codificada 0..255). */
function luminancia(c: Rgb): number {
  const lin = [c.r, c.g, c.b].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: Rgb, b: Rgb): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Blending alfa estándar de CSS (sobre valores gamma-codificados). */
function componer(fg: Rgb, alfa: number, base: Rgb): Rgb {
  return {
    r: Math.round(alfa * fg.r + (1 - alfa) * base.r),
    g: Math.round(alfa * fg.g + (1 - alfa) * base.g),
    b: Math.round(alfa * fg.b + (1 - alfa) * base.b),
  };
}

const hex = (c: Rgb): string =>
  `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// ── Paleta: Tailwind v4 (theme.css 4.3.5, oklch) + tokens brand (globals.css)
// Valores oklch COPIADOS del theme.css instalado — no son los hex de v3. ────

const TW: Record<string, string> = {
  "slate-100": "oklch(96.8% 0.007 247.896)", "slate-200": "oklch(92.9% 0.013 255.508)",
  "slate-300": "oklch(86.9% 0.022 252.894)", "slate-400": "oklch(70.4% 0.04 256.788)",
  "slate-500": "oklch(55.4% 0.046 257.417)", "slate-600": "oklch(44.6% 0.043 257.281)",
  "slate-700": "oklch(37.2% 0.044 257.287)", "slate-800": "oklch(27.9% 0.041 260.031)",
  "slate-900": "oklch(20.8% 0.042 265.755)", "slate-950": "oklch(12.9% 0.042 264.695)",
  "gray-200": "oklch(92.8% 0.006 264.531)", "gray-300": "oklch(87.2% 0.01 258.338)",
  "gray-400": "oklch(70.7% 0.022 261.325)", "gray-500": "oklch(55.1% 0.027 264.364)",
  "gray-600": "oklch(44.6% 0.03 256.802)", "gray-700": "oklch(37.3% 0.034 259.733)",
  "gray-800": "oklch(27.8% 0.033 256.848)",
  "amber-300": "oklch(87.9% 0.169 91.605)", "amber-400": "oklch(82.8% 0.189 84.429)",
  "amber-500": "oklch(76.9% 0.188 70.08)", "amber-950": "oklch(27.9% 0.077 45.635)",
  "red-300": "oklch(80.8% 0.114 19.571)", "red-400": "oklch(70.4% 0.191 22.216)",
  "red-500": "oklch(63.7% 0.237 25.331)", "red-600": "oklch(57.7% 0.245 27.325)",
  "emerald-300": "oklch(84.5% 0.143 164.978)", "emerald-400": "oklch(76.5% 0.177 163.223)",
  "emerald-500": "oklch(69.6% 0.17 162.48)", "emerald-600": "oklch(59.6% 0.145 163.225)",
  "sky-300": "oklch(82.8% 0.111 230.318)", "sky-500": "oklch(68.5% 0.169 237.323)",
  "blue-600": "oklch(54.6% 0.245 262.881)", "yellow-400": "oklch(85.2% 0.199 91.936)",
  "green-400": "oklch(79.2% 0.209 151.711)", "green-500": "oklch(72.3% 0.219 149.579)",
};

const BRAND: Record<string, string> = {
  // src/app/globals.css — @theme (tema oscuro Stitch, única paleta permitida)
  "brand-black": "#090d12", "brand-viewfinder": "#05080c", "brand-surface": "#10161f",
  "brand-surfacelight": "#17222f", "brand-panel": "#0b1117", "brand-chip": "#121c26",
  "brand-border": "#1e293b", "brand-borderdim": "#15202b", "brand-green": "#10b981",
  "brand-greendark": "#064e3b", "brand-greenmuted": "#065f46",
};

const PALETA: Record<string, Rgb> = {
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 },
};
for (const [k, v] of Object.entries(TW)) {
  const m = /oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(v);
  if (!m) throw new Error(`oklch malformado en la paleta: ${k}`);
  PALETA[k] = oklchARgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
}
for (const [k, v] of Object.entries(BRAND)) PALETA[k] = hexARgb(v);

// ── Raíz (fondo de página) por vista — page.tsx: h-dvh bg-[#090d12]; ScanView
// monta su visor sobre bg-brand-viewfinder (#05080c). ───────────────────────

const RAIZ_DEFAULT = "#090d12";
const RAICES: Record<string, string> = {
  "src/components/e14/screens/ScanView.tsx": "#05080c",
};

// ── Pares CONOCIDOS-PERDONADOS: fallan AA y están registrados en
// docs/DEUDA.md § «Accesibilidad (R-38, auditoría 2026-11-16)». Clave:
// tokenTexto|hexFondo|cubeta (cubeta: texto | texto-grande | grafico). ─────

const PERDONADOS: Record<string, string> = {
  // A11Y-1 · CRÍTICO — ReviewView: chip (sm+) y línea colapsada (móvil) de la
  // capa 0 QR en gray-500 sobre superficie oscura. Texto informativo.
  "text-gray-500|#10161f|texto": "A11Y-1",
  "text-gray-500|#090d12|texto": "A11Y-1",
  // A11Y-2 · CRÍTICO — ReviewView: píldora RECHAZADA de la zona fija, blanco
  // sobre #ef4444 (11 px bold no alcanza el umbral de texto grande).
  "text-white|#ef4444|texto": "A11Y-2",
  // A11Y-3 · CRÍTICO — familia badge de error: #ef4444 sobre su propio tinte
  // /15 (RESCANEO en ResumenView ≈4.19 real sobre tarjeta; medido en dev).
  "text-[#ef4444]|#311d25|texto": "A11Y-3",
  "text-[#ef4444]|#2d191e|texto": "A11Y-3",
  // A11Y-4 · MEDIO — PrimaryBtn crit: el icono usa toneText.crit (#E52222)
  // sobre el MISMO fondo #E52222 del botón (1:1). Clave estática: el mapa.
  "text-[#e52222]|#090d12|texto": "A11Y-4",
  // A11Y-5 · MEDIO — TopBar, nube de transmisión: SOLO icono (1.4.11, umbral
  // 3:1 — pasa, pero al límite). El modelo la cuenta como texto.
  "text-brand-green|#064e3b|texto": "A11Y-5",
  "text-red-500|#391319|texto": "A11Y-5",
  // A11Y-6 · BAJO — solo modo desarrollador (PanelDev/SeccionRastreo).
  "text-slate-500|#151e2c|texto": "A11Y-6",
  "text-slate-500|#0b1117|texto": "A11Y-6",
  // A11Y-7 · BAJO (exento) — PanelClasificación: control DESHABILITADO
  // (WCAG 1.4.3 exime los controles inhabilitados).
  "text-gray-500|#0d1219|texto": "A11Y-7",
  // A11Y-8 · BAJO (decorativo) — AnalyzingView: pista del anillo de progreso
  // (svg aria-hidden; la pista debe ser sutil a propósito).
  "text-slate-800/80|#090d12|texto": "A11Y-8",
  // A11Y-9 · ARTEFACTO del modelo estático — el fondo real vive en OTRA línea
  // (objeto styles de PrimaryBtn: icono ok sobre verde = 7.68 OK) o el peor
  // fondo de la línea es el dot decorativo de un objeto de datos (ActasView:
  // chips reales sobre tintes /10-/20, todos ≥ 5.85 OK).
  "text-[#090d12]|#090d12|texto": "A11Y-9",
  "text-[#10b981]|#10b981|texto": "A11Y-9",
  "text-amber-400|#ffb900|texto": "A11Y-9",
  "text-slate-400|#62748e|texto": "A11Y-9",
};

// ── Parser de líneas ───────────────────────────────────────────────────────

const TAMANOS: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36,
  "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128,
};
const RE_TOKEN =
  /^(text|bg)-(white|black|brand-[a-z]+|[a-z]+-\d{2,3}|\[#[0-9a-fA-F]{3,8}\])(\/\d{1,3})?$/;
const RE_TAMANO_PX = /^text-\[(\d+(?:\.\d+)?)px\]$/;
const RE_TAMANO_NOMBRE = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/;
const RE_NEGRO_BOLD = /^font-(bold|extrabold|black)$/;

interface Token {
  util: "text" | "bg";
  nombre: string; // p. ej. "slate-400", "brand-green", "#10b981", "white"
  alfa: number; // 1 = opaco
}

function parseToken(palabra: string): Token | null {
  const m = RE_TOKEN.exec(palabra);
  if (!m) return null;
  let nombre = m[2];
  if (nombre.startsWith("[")) nombre = nombre.slice(1, -1); // [#10b981] → #10b981
  return { util: m[1] as "text" | "bg", nombre, alfa: m[3] ? Number(m[3].slice(1)) / 100 : 1 };
}

function rgbDe(t: Token): Rgb {
  if (t.nombre.startsWith("#")) return hexARgb(t.nombre);
  const c = PALETA[t.nombre];
  if (!c) throw new Error(`SIN_MAPEO: ${t.nombre}`);
  return c;
}

interface EntradaPila {
  openIndent: number; // indent de la línea de apertura del elemento
  color: Rgb;
}

interface ParAgg {
  token: string;
  fondo: Rgb;
  fondoOrigen: string; // descripción del fondo (token + composición)
  cubeta: "texto" | "texto-grande" | "grafico";
  umbral: number;
  valor: number;
  archivos: Map<string, number>;
  lineas: number[];
}

// ── Recolección de archivos ────────────────────────────────────────────────

async function tsxDe(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await tsxDe(rel)));
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out.sort();
}

async function main(): Promise<void> {
  const archivos = await tsxDe("src/components/e14");
  const pares = new Map<string, ParAgg>();
  const sinMapeo = new Set<string>();

  const registrar = (
    token: Token,
    tokenCrudo: string,
    fondo: Rgb,
    fondoOrigen: string,
    cubeta: ParAgg["cubeta"],
    umbral: number,
    archivo: string,
    linea: number,
  ): void => {
    const textoEfectivo =
      token.alfa >= 1 ? rgbDe(token) : componer(rgbDe(token), token.alfa, fondo);
    const valor = ratio(textoEfectivo, fondo);
    const clave = `${tokenCrudo.toLowerCase()}|${hex(fondo)}|${cubeta}`;
    let p = pares.get(clave);
    if (!p) {
      p = {
        token: tokenCrudo, fondo, fondoOrigen, cubeta, umbral, valor,
        archivos: new Map(), lineas: [],
      };
      pares.set(clave, p);
    }
    p.archivos.set(archivo, (p.archivos.get(archivo) ?? 0) + 1);
    if (p.lineas.length < 6) p.lineas.push(linea);
  };

  for (const archivo of archivos) {
    const src = await readFile(join(process.cwd(), archivo), "utf8");
    const lineas = src.split("\n");
    const raiz = hexARgb(RAICES[archivo] ?? RAIZ_DEFAULT);
    let pila: EntradaPila[] = [];
    let lastOpen = -1;

    for (let i = 0; i < lineas.length; i++) {
      const lineaCruda = lineas[i];
      const trimmed = lineaCruda.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (trimmed.startsWith(">")) continue; // ">" suelto del tag multilínea
      const indent = lineaCruda.length - lineaCruda.trimStart().length;
      const esCierre = trimmed.startsWith("</");
      const esAutoCierre = trimmed.endsWith("/>");
      const esApertura = /^<[A-Za-z]/.test(trimmed);
      if (esApertura) lastOpen = indent;

      // La pila solo conserva contenedores ABIERTOS por encima de esta línea.
      pila = pila.filter((e) => e.openIndent < indent);

      // Tokens de la línea (palabras: los prefijos hover:/lg:/… vienen con ':' y se descartan).
      const palabras = trimmed.split(/[\s"'`{}()=]+/).filter(Boolean);
      const textos: { t: Token; crudo: string }[] = [];
      const fondos: { t: Token; crudo: string }[] = [];
      let px: number | null = null;
      let bold = false;
      for (const p of palabras) {
        if (p.includes(":")) continue;
        const t = parseToken(p);
        if (t) {
          try {
            rgbDe(t);
          } catch (e) {
            sinMapeo.add((e as Error).message);
            continue;
          }
          (t.util === "text" ? textos : fondos).push({ t, crudo: p });
          continue;
        }
        const mp = RE_TAMANO_PX.exec(p);
        if (mp) { px = Number(mp[1]); continue; }
        if (RE_TAMANO_NOMBRE.test(p)) { px = TAMANOS[RE_TAMANO_NOMBRE.exec(p)![1]]; continue; }
        if (RE_NEGRO_BOLD.test(p)) bold = true;
      }
      if (textos.length === 0 && fondos.length === 0) continue;

      const esHoja = esCierre || esAutoCierre || trimmed.includes("</");
      const fondoPadre = pila.length > 0 ? pila[pila.length - 1].color : raiz;

      // Gráfico (1.4.11, umbral 3:1): iconos (componentes *Icon, <svg>) o decorativos (aria-hidden).
      const esGrafico =
        /\bIcon\b/.test(trimmed) || trimmed.includes("<svg") || trimmed.includes("aria-hidden") ||
        archivo.endsWith("icons.tsx");
      const cubeta: ParAgg["cubeta"] = esGrafico
        ? "grafico"
        : px != null && (px >= 24 || (px >= 18.66 && bold))
          ? "texto-grande"
          : "texto";
      const umbral = cubeta === "texto" ? 4.5 : 3;

      if (textos.length > 0 && fondos.length > 0) {
        // PAR DIRECTO: cada texto contra cada fondo de la línea; se reporta el PEOR.
        for (const { t, crudo } of textos) {
          let peor: { f: Rgb; v: number; origen: string } | null = null;
          for (const { t: bt, crudo: bcrudo } of fondos) {
            const f = bt.alfa >= 1 ? rgbDe(bt) : componer(rgbDe(bt), bt.alfa, fondoPadre);
            const textoEfectivo = t.alfa >= 1 ? rgbDe(t) : componer(rgbDe(t), t.alfa, f);
            const v = ratio(textoEfectivo, f);
            const origen = bt.alfa >= 1 ? bcrudo : `${bcrudo} sobre ${hex(fondoPadre)}→${hex(f)}`;
            if (!peor || v < peor.v) peor = { f, v, origen };
          }
          registrar(t, crudo, peor!.f, peor!.origen, cubeta, umbral, archivo, i + 1);
        }
      } else if (textos.length > 0) {
        for (const { t, crudo } of textos) {
          const origen =
            pila.length > 0
              ? `heredado ${hex(fondoPadre)}`
              : `raíz de vista ${hex(raiz)}`;
          registrar(t, crudo, fondoPadre, origen, cubeta, umbral, archivo, i + 1);
        }
      }

      // PUSH: contenedor con className + fondo (las hojas y los fragmentos de
      // ternario sin "className" no empujan — evita contaminar la pila).
      if (fondos.length > 0 && trimmed.includes("className") && !esHoja) {
        const bt = fondos[0].t;
        const color = bt.alfa >= 1 ? rgbDe(bt) : componer(rgbDe(bt), bt.alfa, fondoPadre);
        pila.push({ openIndent: esApertura ? indent : lastOpen, color });
      }
    }
  }

  // ── Reporte ──────────────────────────────────────────────────────────────
  let nOk = 0, nWarn = 0, nFail = 0;
  const filas: { estado: string; valor: number; texto: string }[] = [];
  for (const p of pares.values()) {
    const clave = `${p.token.toLowerCase()}|${hex(p.fondo)}|${p.cubeta}`;
    const donde = [...p.archivos.entries()]
      .map(([f, n]) => `${f.replace("src/components/e14/", "")}${n > 1 ? ` ×${n}` : ""}`)
      .join(", ");
    const ref = PERDONADOS[clave];
    const estado = p.valor >= p.umbral ? "OK" : ref ? `WARN(perdonado ${ref})` : "FAIL";
    if (estado === "OK") nOk++;
    else if (estado.startsWith("WARN")) nWarn++;
    else nFail++;
    // La clave va impresa en WARN/FAIL: es la que se copia a PERDONADOS al
    // registrar el hallazgo en DEUDA.md (o al corregirlo, se saca).
    filas.push({
      estado, valor: p.valor,
      texto:
        `${estado} · ${p.valor.toFixed(2)}:1 (umbral ${p.umbral}) · ${p.token} sobre ${p.fondoOrigen} · ${p.cubeta} · ${donde}` +
        (estado === "OK" ? "" : ` · clave: ${clave}`),
    });
  }
  filas.sort((a, b) => {
    const orden = (e: string) => (e === "FAIL" ? 0 : e.startsWith("WARN") ? 1 : 2);
    return orden(a.estado) - orden(b.estado) || a.valor - b.valor;
  });
  for (const f of filas) console.log(f.texto);

  if (sinMapeo.size > 0) {
    console.log("\nSIN MAPEO (la paleta de este script está incompleta):");
    for (const s of sinMapeo) console.log(`  · ${s}`);
  }

  const total = nOk + nWarn + nFail;
  console.log(
    `\nQA a11y-contraste: ${total} pares · ${nOk} OK · ${nWarn} WARN perdonados (DEUDA A11Y) · ${nFail} FAIL` +
      (sinMapeo.size > 0 ? ` · ${sinMapeo.size} sin mapeo` : ""),
  );
  if (nFail > 0 || sinMapeo.size > 0) {
    console.log("QA a11y-contraste: FALLÓ — pares bajo AA sin registrar (o paleta incompleta); ver lista arriba");
    process.exit(1);
  }
}

void main();
