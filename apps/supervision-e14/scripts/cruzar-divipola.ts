/**
 * R-39 (auditoría 2026-11-16 §6.4) — CRUCE del catálogo DIVIPOLA exterior
 * contra la FUENTE OFICIAL.
 *
 * Hueco que cierra: la consistencia interna del catálogo estaba congelada
 * por test (`data/__tests__/catalogo-divipola.test.ts`: 949 puestos · 67
 * países · Σ 3.670 mesas, exacto al dígito), pero NADIE lo había cruzado
 * contra la fuente externa — internamente consistente y externamente
 * equivocado era un estado posible y sin detector.
 *
 *   bun scripts/cruzar-divipola.ts             # cruce (en vivo si la fuente responde; si no, drift vs snapshot)
 *   bun scripts/cruzar-divipola.ts --congelar  # registra el snapshot FIRMADO en docs/archivo/divipola-snapshot-oficial.md
 *
 * FUENTES OFICIALES QUE INTENTA (en orden, 30 s de timeout cada una):
 *   1. Visor ciudadano E14 2026 de la Registraduría — el MISMO bundle
 *      DIVIPOL que documenta `apps/digielect14/scripts/gen-divipol.mjs`
 *      como "fuente de verdad" (SPEC-e14-cabecera-clasificación §1):
 *      https://e14segundavueltapresidente.registraduria.gov.co/assets/temis/divipol_json/departmentsTree.json
 *      El WAF del portal bloquea navegadores headless pero responde con
 *      User-Agent de navegador. De aquí se extrae el depto 88 (CONSULADOS)
 *      registro a registro: puesto + mesas — cruce COMPLETO.
 *   2. DIVIPOLA del DANE en datos.gov.co (códigos de municipios) — se
 *      consulta para DEJAR CONSTANCIA de que la nomenclatura DANE no
 *      publica el catálogo exterior (cod_dpto 88 = San Andrés en DANE;
 *      los consulados son convención E14 de la Registraduría).
 *   3. Portal registraduria.gov.co — referencia HUMANA: los puestos del
 *      exterior se publican en PDF; el WAF devuelve 403 a clientes
 *      no-navegador (por eso el plan B del snapshot firmado).
 *
 * PLAN B (snapshot firmado): si la fuente oficial en vivo no es
 * descargable (WAF/red/PDF), `--congelar` registra en
 * `docs/archivo/divipola-snapshot-oficial.md` un bloque JSON con fecha,
 * SHA-256 del catálogo versionado (bytes crudos + serialización canónica),
 * SHA-256 de la extracción oficial depto-88 (cuando la fuente respondió)
 * y las URLs de referencia. El cruce por defecto detecta DRIFT del
 * catálogo contra ese snapshot (re-serialización canónica → mismo digest
 * = mismo contenido semántico; el digest de bytes crudos, además, detecta
 * reformateos).
 *
 * GATE (exit code): 0 = sin violaciones · 1 = violación (estructura rota,
 * drift vs snapshot, o diferencias contra la fuente oficial) · 2 = error
 * de ejecución (I/O). NOTA: si no hay fuente en vivo NI snapshot congelado,
 * el cruce externo es IMPOSIBLE y el script falla honesto (exit 1) — correr
 * `--congelar` primero.
 *
 * SIN dependencias nuevas (regla del repo): fetch + node:crypto +
 * `node:fs/promises`. La validación estructural es la MISMA del runtime —
 * importa `domain/divipola.ts` (módulo puro, sin I/O) para que este gate y
 * el adaptador no puedan divergir.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validarCatalogoDivipola,
  type RegistroDivipolaJson,
} from "../src/modules/supervision/domain/divipola";

// ─── Rutas y números esperados (kit SUP-5 §2.4 / D21) ───────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUTA_CATALOGO = resolve(__dirname, "../src/modules/supervision/data/divipola-exterior.json");
const RUTA_SNAPSHOT = resolve(__dirname, "../docs/archivo/divipola-snapshot-oficial.md");

const ESPERADO_REGISTROS = 949;
const ESPERADO_PAISES = 67;
const ESPERADO_MESAS = 3_670;
/** Rango exterior documentado (§2.1) — usado por el test del catálogo. */
const MESAS_MAX = 159;
/** Formato D22: depto(2)_mun(3)_zona(3)_puesto(2). */
const RE_ID_ENLACE = /^\d{2}_\d{3}_\d{3}_\d{2}$/;

const UA_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const FUENTE_VISOR =
  "https://e14segundavueltapresidente.registraduria.gov.co/assets/temis/divipol_json/departmentsTree.json";
const FUENTE_DANE = "https://www.datos.gov.co/resource/gdxc-w37w.json?cod_dpto=88&%24limit=200";
const REFERENCIAS_HUMANAS = [
  "https://e14segundavueltapresidente.registraduria.gov.co/ (visor oficial E14 — en navegador)",
  "https://www.registraduria.gov.co/ (portal: puestos del exterior en PDF)",
];

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** Registro oficial extraído del visor (misma forma que el catálogo — comparable campo a campo). */
type RegistroOficial = RegistroDivipolaJson;

/** Forma del bundle departmentsTree.json (solo lo que se usa del depto 88). */
interface ArbolVisor {
  data: {
    departmentsTree: {
      edges: Array<{
        node: {
          idDepartmentCode: string;
          departmentName: string;
          municipalities: Array<{
            municipalityCode: string;
            municipalityName: string;
            zones: Array<{
              idZoneCode: string;
              stands: Array<{ standCode: string; standName: string; countTable: number }>;
            }>;
          }>;
        };
      }>;
    };
  };
}

/** Bloque máquina del snapshot (el único contrato que el modo cruce re-parsea). */
export interface Snapshot {
  kind: "snapshot-divipola-exterior";
  version: 1;
  generado: string;
  metodo: string;
  catalogo: {
    archivo: string;
    bytes: number;
    sha256_raw: string;
    sha256_canonico: string;
    registros: number;
    paises: number;
    mesas: number;
  };
  fuente_oficial: {
    nombre: string;
    url_maquina: string;
    consultada: string | null;
    sha256_extraccion_depto88: string | null;
    departamentos: number | null;
    registros_88: number | null;
    paises_88: number | null;
    mesas_88: number | null;
    disponible_en_vivo: boolean;
  };
  referencias_humanas: string[];
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

const sha256 = (texto: string): string =>
  createHash("sha256").update(texto, "utf8").digest("hex");

/** Clave y orden de campos FIJOS → serialización canónica comparable entre
 * catálogo y fuente oficial (una diferencia semántica = digest distinto).
 * Exportada SOLO para el test de sabotaje (R-39): el drift-congelado es un
 * gate de seguridad electoral y su detector debe estar ejercitado por la
 * suite — una regresión silenciosa aquí dejaría el gate decorativo. */
export function canonico(registros: readonly RegistroOficial[]): string {
  const ordenados = [...registros].sort((a, b) =>
    a.idEnlace < b.idEnlace ? -1 : a.idEnlace > b.idEnlace ? 1 : 0
  );
  return JSON.stringify(
    ordenados.map((r) => ({
      idEnlace: r.idEnlace,
      codigoDepartamento: r.codigoDepartamento,
      codigoMunicipio: r.codigoMunicipio,
      nombreMunicipio: r.nombreMunicipio,
      codigoZona: r.codigoZona,
      codigoPuesto: r.codigoPuesto,
      nombre: r.nombre,
      totalMesas: r.totalMesas,
    }))
  );
}

/** Descarga con UA de navegador. El WAF del portal es errático con la
 * huella TLS de bun (a veces responde en 2 s, a veces cuelga) — se hace
 * UN reintento y luego se cae a `curl -sSL`, el transporte que el propio
 * repo documenta para esta URL (gen-divipol.mjs, SPEC §1). */
async function descargar(url: string, timeoutMs = 30_000): Promise<string> {
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA_NAVEGADOR, Accept: "application/json,*/*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch (e) {
      if (intento === 2) {
        // Fallback curl (documentado en gen-divipol.mjs para esta fuente).
        const proc = Bun.spawn(["curl", "-sSL", "--max-time", "45", "-H", `User-Agent: ${UA_NAVEGADOR}`, url], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const salida = await new Response(proc.stdout).text();
        const codigo = await proc.exited;
        if (codigo === 0 && salida.length > 0) return salida;
        throw new Error(`fetch: ${(e as Error).message} · curl: exit ${codigo}`);
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }
  throw new Error("inalcanzable");
}

/** Extrae el depto 88 (CONSULADOS) del bundle del visor, registro a registro.
 * Convención de zonas: el visor publica `idZoneCode` de 2 dígitos ("05") y
 * el catálogo usa 3 ("005") — se rellena a 3 antes de formar el idEnlace
 * (D22), igual que hace el join del digitalizador. */
function extraerExteriorVisor(bruto: string): {
  departamentos: number;
  nombreDepartamento: string;
  registros: RegistroOficial[];
} {
  // Limpiar basura previa al primer '{' (patrón verificado de gen-divipol.mjs).
  const arbol = JSON.parse(bruto.slice(bruto.indexOf("{"))) as ArbolVisor;
  const edges = arbol.data.departmentsTree.edges;
  const d88 = edges.find((e) => e.node.idDepartmentCode === "88");
  if (!d88) throw new Error("depto 88 (CONSULADOS) ausente del bundle oficial");
  const registros: RegistroOficial[] = [];
  for (const mun of d88.node.municipalities) {
    for (const zona of mun.zones) {
      const codigoZona = zona.idZoneCode.padStart(3, "0");
      for (const puesto of zona.stands) {
        registros.push({
          idEnlace: `88_${mun.municipalityCode}_${codigoZona}_${puesto.standCode}`,
          codigoDepartamento: "88",
          codigoMunicipio: mun.municipalityCode,
          nombreMunicipio: mun.municipalityName,
          codigoZona,
          codigoPuesto: puesto.standCode,
          nombre: puesto.standName,
          totalMesas: puesto.countTable,
        });
      }
    }
  }
  return { departamentos: edges.length, nombreDepartamento: d88.node.departmentName, registros };
}

// ─── [1] Validación estructural del catálogo ────────────────────────────────

interface ResultadoEstructura {
  ok: boolean;
  lineas: string[];
  registros: RegistroDivipolaJson[];
}

function validarEstructura(brutos: unknown[]): ResultadoEstructura {
  const lineas: string[] = [];
  const error = (mensaje: string): ResultadoEstructura => ({
    ok: false,
    lineas: [...lineas, `✗ ${mensaje}`],
    registros: [],
  });

  // La MISMA validación estricta del runtime (campos exactos, anchos fijos,
  // idEnlace congruente y único) — al fallar lanza con el índice culpable.
  let registros: RegistroDivipolaJson[];
  try {
    registros = validarCatalogoDivipola(brutos);
  } catch (e) {
    return error(`validación estricta del dominio: ${(e as Error).message}`);
  }
  lineas.push(`✓ validación estricta del dominio (8 campos, anchos fijos, idEnlace congruente y único)`);

  if (registros.length !== ESPERADO_REGISTROS) {
    return error(`registros: ${registros.length} ≠ ${ESPERADO_REGISTROS} (kit §2.4)`);
  }
  lineas.push(`✓ ${ESPERADO_REGISTROS} registros — exacto (kit §2.4)`);

  const paises = new Set(registros.map((r) => r.nombreMunicipio));
  if (paises.size !== ESPERADO_PAISES) {
    return error(`países (municipios únicos): ${paises.size} ≠ ${ESPERADO_PAISES}`);
  }
  lineas.push(`✓ ${ESPERADO_PAISES} países — exacto`);

  const mesas = registros.reduce((suma, r) => suma + r.totalMesas, 0);
  if (mesas !== ESPERADO_MESAS) {
    return error(`Σ totalMesas: ${mesas} ≠ ${ESPERADO_MESAS}`);
  }
  lineas.push(`✓ Σ totalMesas = ${ESPERADO_MESAS.toLocaleString("es-CO")} — exacto`);

  const ajenos = registros.filter((r) => r.codigoDepartamento !== "88");
  if (ajenos.length > 0) {
    return error(`${ajenos.length} registros con depto ≠ "88" (primero: ${ajenos[0].idEnlace})`);
  }
  lineas.push(`✓ depto "88" = CONSULADOS en todos los registros`);

  const malEnlace = registros.filter((r) => !RE_ID_ENLACE.test(r.idEnlace));
  if (malEnlace.length > 0) {
    return error(`${malEnlace.length} idEnlace fuera del formato dept_mun_zona3_puesto2 (primero: ${malEnlace[0].idEnlace})`);
  }
  lineas.push(`✓ idEnlace con formato dept(2)_mun(3)_zona(3)_puesto(2)`);

  const fueraRango = registros.filter((r) => r.totalMesas < 1 || r.totalMesas > MESAS_MAX);
  if (fueraRango.length > 0) {
    return error(`${fueraRango.length} puestos con totalMesas fuera de [1, ${MESAS_MAX}] (primero: ${fueraRango[0].idEnlace} = ${fueraRango[0].totalMesas})`);
  }
  lineas.push(`✓ totalMesas en rango [1, ${MESAS_MAX}] (exterior §2.1)`);

  // Sin duplicados (idEnlace, mesa): cada registro EXPANDE sus mesas
  // 1..totalMesas (la clave de join del dominio es `${idEnlace}::${mesa}`
  // — D22/D24); los 3.670 pares deben ser únicos.
  const pares = new Set<string>();
  for (const r of registros) {
    for (let mesa = 1; mesa <= r.totalMesas; mesa++) pares.add(`${r.idEnlace}::${mesa}`);
  }
  if (pares.size !== mesas) {
    return error(`pares (idEnlace, mesa) únicos: ${pares.size} ≠ ${mesas} expandidos — hay duplicados`);
  }
  lineas.push(`✓ ${pares.size.toLocaleString("es-CO")} pares (idEnlace, mesa) únicos — sin duplicados`);

  return { ok: true, lineas, registros };
}

// ─── [2] Snapshot: lectura (drift) y escritura (--congelar) ─────────────────

const MARCADOR_FENCE = "snapshot-divipola-exterior";

/** El snapshot vive en un fence ```json del doc de archivo; el bloque se
 * identifica por su campo `kind` (mismo marcador que la constante).
 * Exportada SOLO para el test de sabotaje (R-39). */
export function parsearSnapshot(doc: string): Snapshot | null {
  const fences = doc.match(/```json\s*\n([\s\S]*?)```/g) ?? [];
  for (const fence of fences) {
    const cuerpo = fence.replace(/^```json\s*\n/, "").replace(/```\s*$/, "");
    try {
      const dato = JSON.parse(cuerpo) as Snapshot;
      if (dato?.kind === MARCADOR_FENCE) return dato;
    } catch {
      // fence ajeno — seguir buscando.
    }
  }
  return null;
}

/** Comparación de digest canónico contra el snapshot congelado. Exportada
 * SOLO para el test de sabotaje (R-39): el caso «catálogo alterado» y el
 * caso «snapshot alterado» se congelan en la suite. */
export function verificarDrift(snapshot: Snapshot, registros: RegistroDivipolaJson[]): string[] {
  const lineas: string[] = [];
  const canonicoActual = sha256(canonico(registros));
  if (canonicoActual === snapshot.catalogo.sha256_canonico) {
    lineas.push(`✓ SIN DRIFT: el catálogo es semánticamente idéntico al snapshot congelado (${snapshot.generado})`);
  } else {
    lineas.push(`✗ DRIFT semántico: el catálogo cambió desde el snapshot (${snapshot.generado})`);
    lineas.push(`  snapshot: sha256_canonico = ${snapshot.catalogo.sha256_canonico}`);
    lineas.push(`  actual:   sha256_canonico = ${canonicoActual}`);
    lineas.push(`  → si el cambio es legítimo (fuente oficial actualizada), re-cruzar en vivo y volver a correr --congelar`);
  }
  if (snapshot.fuente_oficial.disponible_en_vivo && snapshot.fuente_oficial.sha256_extraccion_depto88) {
    lineas.push(
      `  referencia congelada de la fuente oficial: extracción depto 88 con sha256 ${snapshot.fuente_oficial.sha256_extraccion_depto88.slice(0, 16)}… (${snapshot.fuente_oficial.registros_88} registros · ${snapshot.fuente_oficial.paises_88} países · ${snapshot.fuente_oficial.mesas_88} mesas)`
    );
  }
  return lineas;
}

// ─── [3] Cruce registro a registro contra la fuente oficial ─────────────────

interface ResultadoCruce {
  sinDiferencias: boolean;
  lineas: string[];
}

function cruzar(catalogo: RegistroDivipolaJson[], oficial: RegistroOficial[]): ResultadoCruce {
  const lineas: string[] = [];
  const porIdCatalogo = new Map(catalogo.map((r) => [r.idEnlace, r]));
  const porIdOficial = new Map(oficial.map((r) => [r.idEnlace, r]));

  const paisesOficial = new Set(oficial.map((r) => r.nombreMunicipio));
  const mesasOficial = oficial.reduce((suma, r) => suma + r.totalMesas, 0);
  lineas.push(`  catálogo: ${catalogo.length} registros · ${new Set(catalogo.map((r) => r.nombreMunicipio)).size} países · ${catalogo.reduce((s, r) => s + r.totalMesas, 0)} mesas`);
  lineas.push(`  oficial:  ${oficial.length} registros · ${paisesOficial.size} países · ${mesasOficial} mesas`);

  const soloEnOficial = oficial.filter((r) => !porIdCatalogo.has(r.idEnlace));
  const soloEnCatalogo = catalogo.filter((r) => !porIdOficial.has(r.idEnlace));
  if (soloEnOficial.length > 0) {
    lineas.push(`  ✗ ${soloEnOficial.length} puestos en la fuente oficial que FALTAN en el catálogo:`);
    for (const r of soloEnOficial.slice(0, 10)) lineas.push(`      + ${r.idEnlace} · ${r.nombre} (${r.nombreMunicipio}, ${r.totalMesas} mesas)`);
    if (soloEnOficial.length > 10) lineas.push(`      … y ${soloEnOficial.length - 10} más`);
  }
  if (soloEnCatalogo.length > 0) {
    lineas.push(`  ✗ ${soloEnCatalogo.length} puestos en el catálogo que NO EXISTEN en la fuente oficial:`);
    for (const r of soloEnCatalogo.slice(0, 10)) lineas.push(`      − ${r.idEnlace} · ${r.nombre} (${r.nombreMunicipio}, ${r.totalMesas} mesas)`);
    if (soloEnCatalogo.length > 10) lineas.push(`      … y ${soloEnCatalogo.length - 10} más`);
  }

  // Campos comparados en los puestos compartidos (todo menos idEnlace,
  // que ya es la clave — y sus segmentos van implícitos en él).
  const CAMPOS = ["codigoMunicipio", "nombreMunicipio", "codigoZona", "codigoPuesto", "nombre", "totalMesas"] as const;
  const conDiferencias: string[] = [];
  for (const rCat of catalogo) {
    const rOfi = porIdOficial.get(rCat.idEnlace);
    if (!rOfi) continue;
    for (const campo of CAMPOS) {
      if (rCat[campo] !== rOfi[campo]) {
        conDiferencias.push(`  ✗ ${rCat.idEnlace} · ${campo}: catálogo=${JSON.stringify(rCat[campo])} ≠ oficial=${JSON.stringify(rOfi[campo])}`);
      }
    }
  }
  if (conDiferencias.length > 0) {
    lineas.push(`  ✗ ${conDiferencias.length} diferencias de campo en puestos compartidos:`);
    for (const d of conDiferencias.slice(0, 20)) lineas.push(`    ${d}`);
    if (conDiferencias.length > 20) lineas.push(`    … y ${conDiferencias.length - 20} más`);
  }

  // Veredicto canónico: mismo digest = mismo contenido semántico al 100 %.
  const digestCat = sha256(canonico(catalogo));
  const digestOfi = sha256(canonico(oficial));
  const sinDiferencias = soloEnOficial.length === 0 && soloEnCatalogo.length === 0 && conDiferencias.length === 0 && digestCat === digestOfi;
  if (sinDiferencias) {
    lineas.push(`  ✓ 0 DIFERENCIAS: los 949 registros son idénticos campo a campo (digest canónico ${digestCat.slice(0, 16)}…)`);
  } else if (soloEnOficial.length === 0 && soloEnCatalogo.length === 0 && conDiferencias.length === 0) {
    lineas.push(`  ✗ digest canónico distinto pese a diff vacío (revisar orden/campos): ${digestCat.slice(0, 16)}… ≠ ${digestOfi.slice(0, 16)}…`);
  }
  return { sinDiferencias, lineas };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const congelar = process.argv.includes("--congelar");
  console.log("═══ R-39 · CRUCE DIVIPOLA EXTERIOR vs FUENTE OFICIAL ═══");
  console.log(`modo: ${congelar ? "--congelar (registro de snapshot firmado)" : "cruce (en vivo + drift vs snapshot)"}\n`);

  // Catálogo versionado: se lee como TEXTO crudo (digest de bytes) y como
  // JSON (conteos y cruce).
  const crudo = await readFile(RUTA_CATALOGO, "utf8");
  const brutos = JSON.parse(crudo) as unknown[];

  console.log("[1] Validación estructural del catálogo (misma regla del runtime)");
  const estructura = validarEstructura(brutos);
  for (const linea of estructura.lineas) console.log(`  ${linea}`);
  if (!estructura.ok) {
    console.log("\nVEREDICTO: ✗ ESTRUCTURA ROTA — el cruce externo no procede hasta arreglar el catálogo");
    return 1;
  }
  const registros = estructura.registros;
  const shaRaw = sha256(crudo);
  const shaCanonico = sha256(canonico(registros));

  // [2] Drift vs snapshot congelado (si existe).
  let snapshot: Snapshot | null = null;
  try {
    snapshot = parsearSnapshot(await readFile(RUTA_SNAPSHOT, "utf8"));
  } catch {
    // sin doc — se nota abajo.
  }
  console.log("\n[2] Drift del catálogo vs snapshot congelado");
  if (snapshot) {
    for (const linea of verificarDrift(snapshot, registros)) console.log(`  ${linea}`);
  } else {
    console.log("  (sin snapshot congelado — correr `bun scripts/cruzar-divipola.ts --congelar` para fijar la referencia)");
  }

  // [3] Fuentes oficiales — intentos en vivo.
  console.log("\n[3] Fuentes oficiales — intentos de descarga en vivo");
  let extraccion: { departamentos: number; nombreDepartamento: string; registros: RegistroOficial[] } | null = null;
  const intentos: Array<{ url: string; resultado: string }> = [];

  try {
    const bruto = await descargar(FUENTE_VISOR);
    extraccion = extraerExteriorVisor(bruto);
    intentos.push({ url: FUENTE_VISOR, resultado: `OK (${(bruto.length / 1_048_576).toFixed(2)} MB · ${extraccion.departamentos} departamentos · depto 88 "${extraccion.nombreDepartamento}" con ${extraccion.registros.length} puestos)` });
  } catch (e) {
    intentos.push({ url: FUENTE_VISOR, resultado: `FALLÓ: ${(e as Error).message}` });
  }
  // Constancia DANE: la DIVIPOLA clásica no trae consulados (88 = San Andrés).
  try {
    const bruto = await descargar(FUENTE_DANE, 20_000);
    const filas = JSON.parse(bruto.slice(bruto.indexOf("["))) as Array<Record<string, string>>;
    const nombres = filas.map((f) => f.nom_mpio ?? "?").slice(0, 3).join(", ");
    intentos.push({ url: FUENTE_DANE, resultado: `RESPONDE pero NO apta para el cruce: cod_dpto 88 = ${filas[0]?.dpto ?? "?"} (${nombres}) — la nomenclatura DANE no publica consulados; el exterior es convención E14 de la Registraduría` });
  } catch (e) {
    intentos.push({ url: FUENTE_DANE, resultado: `no accesible (${(e as Error).message}) — igualmente no apta: sin puestos del exterior` });
  }
  intentos.push({ url: REFERENCIAS_HUMANAS[1], resultado: "referencia HUMANA (PDF) — el WAF del portal devuelve 403 a clientes no-navegador" });
  for (const i of intentos) console.log(`  · ${i.url}\n      ${i.resultado}`);

  // [4] Cruce registro a registro (si la fuente oficial respondió).
  let cruceLimpio: boolean | null = null;
  console.log("\n[4] Cruce registro a registro contra la fuente oficial");
  if (extraccion) {
    const cruce = cruzar(registros, extraccion.registros);
    for (const linea of cruce.lineas) console.log(`  ${linea}`);
    cruceLimpio = cruce.sinDiferencias;
  } else {
    console.log("  (fuente oficial en vivo NO disponible — el gate externo queda en el drift vs snapshot del punto [2])");
  }

  // [5] --congelar: escribir el snapshot firmado. GUARDIA: si el cruce en
  // vivo dio diferencias, congelar sería firmar un catálogo equivocado —
  // se rehúsa y se queda en rojo.
  if (congelar) {
    console.log("\n[5] Congelando snapshot firmado");
    if (cruceLimpio === false) {
      console.log("  ✗ RECHAZADO: el cruce en vivo dio diferencias — congelar firmaría un catálogo equivocado. Reconciliar primero (ver [4]).");
    } else {
    const ahora = new Date().toISOString();
    const nuevoSnapshot: Snapshot = {
      kind: "snapshot-divipola-exterior",
      version: 1,
      generado: ahora,
      metodo: extraccion
        ? "cruce en vivo contra el bundle DIVIPOL del visor E14 de la Registraduría (departmentsTree.json, depto 88 CONSULADOS) + digests SHA-256 del catálogo versionado"
        : "plan B: digest SHA-256 del catálogo versionado (fuente oficial en vivo inaccesible desde el entorno de ejecución)",
      catalogo: {
        archivo: "src/modules/supervision/data/divipola-exterior.json",
        bytes: Buffer.byteLength(crudo, "utf8"),
        sha256_raw: shaRaw,
        sha256_canonico: shaCanonico,
        registros: registros.length,
        paises: new Set(registros.map((r) => r.nombreMunicipio)).size,
        mesas: registros.reduce((s, r) => s + r.totalMesas, 0),
      },
      fuente_oficial: {
        nombre: "Visor ciudadano E14 2026 — Registraduría (bundle DIVIPOL del visor)",
        url_maquina: FUENTE_VISOR,
        consultada: extraccion ? ahora : null,
        sha256_extraccion_depto88: extraccion ? sha256(canonico(extraccion.registros)) : null,
        departamentos: extraccion?.departamentos ?? null,
        registros_88: extraccion?.registros.length ?? null,
        paises_88: extraccion ? new Set(extraccion.registros.map((r) => r.nombreMunicipio)).size : null,
        mesas_88: extraccion ? extraccion.registros.reduce((s, r) => s + r.totalMesas, 0) : null,
        disponible_en_vivo: Boolean(extraccion),
      },
      referencias_humanas: REFERENCIAS_HUMANAS,
    };
    const doc = renderizarDocSnapshot(nuevoSnapshot, intentos, cruceLimpio);
    await mkdir(dirname(RUTA_SNAPSHOT), { recursive: true });
    await writeFile(RUTA_SNAPSHOT, doc, "utf8");
    console.log(`  ✓ snapshot firmado en apps/supervision-e14/docs/archivo/divipola-snapshot-oficial.md`);
    console.log(`    catálogo: sha256_canonico = ${nuevoSnapshot.catalogo.sha256_canonico.slice(0, 16)}…`);
    if (nuevoSnapshot.fuente_oficial.sha256_extraccion_depto88) {
      console.log(`    extracción oficial depto 88: sha256 = ${nuevoSnapshot.fuente_oficial.sha256_extraccion_depto88.slice(0, 16)}…`);
    }
    }
  }

  // Veredicto final. Jerarquía: diferencias en vivo > drift > imposible
  // verificar. `--congelar` exitoso (incluso sin cruce en vivo, plan B)
  // queda en verde: la referencia quedó fijada y el drift es el gate.
  console.log("\n═══ VEREDICTO ═══");
  const driftOk = snapshot ? shaCanonico === snapshot.catalogo.sha256_canonico : null;
  let veredicto = "✓ SIN VIOLACIONES";
  if (cruceLimpio === false) {
    veredicto = "✗ DIFERENCIAS contra la fuente oficial — revisar la lista [4] y reconciliar";
  } else if (driftOk === false) {
    veredicto = "✗ DRIFT vs snapshot congelado — ver [2]";
  } else if (!congelar && cruceLimpio === null && driftOk === null) {
    veredicto = "✗ CRUCE EXTERNO IMPOSIBLE: ni fuente en vivo ni snapshot congelado — correr `--congelar` y reintentar";
  }
  const detalle: string[] = [];
  detalle.push(`estructura ${estructura.ok ? "OK" : "ROTA"}`);
  if (driftOk !== null) detalle.push(`drift ${driftOk ? "0" : "detectado"}`);
  if (cruceLimpio !== null) detalle.push(`cruce en vivo ${cruceLimpio ? "0 diferencias" : "con diferencias"}`);
  if (congelar) detalle.push("snapshot congelado");
  console.log(`${veredicto} (${detalle.join(" · ")})`);
  const exito = !veredicto.startsWith("✗");
  return exito ? 0 : 1;
}

/** Cuerpo humano del doc de archivo + el fence máquina. */
function renderizarDocSnapshot(
  s: Snapshot,
  intentos: Array<{ url: string; resultado: string }>,
  cruceLimpio: boolean | null
): string {
  const fecha = s.generado.slice(0, 10);
  return `# Snapshot oficial del catálogo DIVIPOLA exterior (R-39)

> Registro de referencia congelada. El catálogo versionado
> (\`src/modules/supervision/data/divipola-exterior.json\`) está congelado por
> test (${s.catalogo.registros} puestos · ${s.catalogo.paises} países · ${s.catalogo.mesas.toLocaleString("es-CO")} mesas);
> este snapshot fija la referencia EXTERNA contra la que se detecta drift
> (\`bun scripts/cruzar-divipola.ts\`). Generado ${fecha}.

## Qué se cruzó, contra qué y cuándo

| Aspecto | Valor |
|---|---|
| Catálogo | \`${s.catalogo.archivo}\` (${s.catalogo.bytes.toLocaleString("es-CO")} bytes · sha256 raw \`${s.catalogo.sha256_raw.slice(0, 16)}…\`) |
| Contenido congelado | ${s.catalogo.registros} registros · ${s.catalogo.paises} países · ${s.catalogo.mesas.toLocaleString("es-CO")} mesas · sha256 canónico \`${s.catalogo.sha256_canonico.slice(0, 16)}…\` |
| Fuente oficial | ${s.fuente_oficial.nombre} |
| URL máquina | ${s.fuente_oficial.url_maquina} |
| Consultada | ${s.fuente_oficial.consultada ?? "(no accesible en el momento del congelamiento)"} |
| Extracción depto 88 | ${s.fuente_oficial.disponible_en_vivo ? `${s.fuente_oficial.registros_88} registros · ${s.fuente_oficial.paises_88} países · ${(s.fuente_oficial.mesas_88 ?? 0).toLocaleString("es-CO")} mesas · sha256 \`${s.fuente_oficial.sha256_extraccion_depto88?.slice(0, 16)}…\`` : "no disponible en vivo — plan B (digest del catálogo)"} |
| Resultado del cruce | ${cruceLimpio === null ? "no realizado (fuente en vivo inaccesible)" : cruceLimpio ? "**0 diferencias** — idéntico registro a registro y digest canónico igual" : "**CON DIFERENCIAS** — ver la salida del script"} |
| Método | ${s.metodo} |

### Intentos de descarga registrados (${fecha})

${intentos.map((i) => `- \`${i.url}\` → ${i.resultado}`).join("\n")}

### Referencias humanas

${s.referencias_humanas.map((r) => `- ${r}`).join("\n")}

### Condición de re-cruce

- **Obligatorio** si cambia el catálogo versionado (el script reporta DRIFT y
  sale en rojo) o al preparar cada release electoral: correr
  \`bun scripts/cruzar-divipola.ts\` (intenta la fuente en vivo) y, si el
  cruce está limpio, \`--congelar\` para mover la referencia.
- La validación ESTRUCTURAL (conteos, formato, unicidad) corre siempre — no
  depende de la red.
- Si la fuente oficial en vivo deja de responder (WAF/rotación de portal),
  el gate queda en la detección de drift contra este snapshot; actualizar la
  URL \`url_maquina\` requiere un nuevo congelamiento.

## Bloque máquina (no editar a mano — lo escribe \`--congelar\`)

\`\`\`json
${JSON.stringify(s, null, 2)}
\`\`\`
`;
}

// Solo corre el gate cuando el script se invoca como CLI — la importación
// del módulo (para el test de sabotaje R-39) NO debe disparar descargas en
// vivo ni process.exit() que mataría el test runner.
if (import.meta.main) {
  main()
    .then((codigo) => process.exit(codigo))
    .catch((error) => {
      console.error(`✗ error de ejecución: ${(error as Error).stack ?? error}`);
      process.exit(2);
    });
}
