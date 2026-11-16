/**
 * Regenerador de los CONTRATO.json de módulos D-only (H-02 / R-02).
 *
 *   bun scripts/gen-contrato-md5.ts          # reescribe los dos CONTRATO.json
 *   bun scripts/gen-contrato-md5.ts --check  # sale 1 si están vencidos
 *
 * Los hashes son md5 del contenido en LF (misma definición del LEEME de
 * core/ y ui/). El guard de pruebas `__tests__/contrato-md5.test.ts` congela
 * el contrato contra los archivos reales; este script es el paso deliberado
 * de "aceptar el cambio" tras editar un módulo vigilado.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MODULOS_CORE_DONLY,
  MODULOS_UI,
  md5DeArchivo,
} from "../src/lib/e14/contrato-donly";

const RAIZ = new URL("../", import.meta.url);

interface BloqueOrigen {
  repo: string;
  commit: string;
  version: string;
}

interface ContratoCore {
  origen: BloqueOrigen;
  nota: string;
  compartidos: string[];
  modulos: Record<string, string>;
}

interface ContratoUi {
  "//": string;
  origen: BloqueOrigen;
  modulos: Record<string, string>;
}

const rutaCore = fileURLToPath(new URL("src/lib/e14/core/CONTRATO.json", RAIZ));
const rutaUi = fileURLToPath(new URL("src/lib/e14/ui/CONTRATO.json", RAIZ));

/** Mantiene `origen`/`nota` (documentan procedencia — siguen ciertos) y
 *  recalcula SOLO los hashes y el comentario de regeneración. */
function regenCore(actual: ContratoCore): string {
  const modulos: Record<string, string> = {};
  for (const archivo of MODULOS_CORE_DONLY) {
    modulos[archivo] = md5DeArchivo(
      fileURLToPath(new URL(`src/lib/e14/core/${archivo}`, RAIZ)),
    );
  }
  const nuevo: ContratoCore = { ...actual, modulos };
  return JSON.stringify(nuevo, null, 2) + "\n";
}

function regenUi(actual: ContratoUi): string {
  const modulos: Record<string, string> = {};
  for (const archivo of MODULOS_UI) {
    modulos[archivo] = md5DeArchivo(
      fileURLToPath(new URL(`src/lib/e14/ui/${archivo}`, RAIZ)),
    );
  }
  const nuevo: ContratoUi = {
    ...actual,
    "//":
      "md5 (LF) de cada archivo de ui/ — ver LEEME.md. Regenerar con `bun scripts/gen-contrato-md5.ts`.",
    modulos,
  };
  return JSON.stringify(nuevo, null, 2) + "\n";
}

const coreNuevo = regenCore(JSON.parse(readFileSync(rutaCore, "utf8")) as ContratoCore);
const uiNuevo = regenUi(JSON.parse(readFileSync(rutaUi, "utf8")) as ContratoUi);

if (process.argv.includes("--check")) {
  let vencidos = 0;
  for (const [ruta, nuevo, etiqueta] of [
    [rutaCore, coreNuevo, "core"],
    [rutaUi, uiNuevo, "ui"],
  ] as const) {
    const viejo = readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
    if (viejo !== nuevo) {
      console.error(`FAIL · CONTRATO.json de ${etiqueta} NO refleja los archivos reales — regenerar`);
      vencidos++;
    } else {
      console.log(`OK · CONTRATO.json de ${etiqueta} coherente`);
    }
  }
  process.exit(vencidos > 0 ? 1 : 0);
}

writeFileSync(rutaCore, coreNuevo, "utf8");
writeFileSync(rutaUi, uiNuevo, "utf8");
console.log(`escrito ${rutaCore}`);
console.log(`escrito ${rutaUi}`);
