/**
 * Catálogo DIVIPOL que sirven las apps del monorepo.
 *
 * En el layout anterior el paquete vivía DENTRO de la app y `../../../public`
 * resolvía a esa app. En e14-suite el motor es compartido: cada app conserva
 * su `public/e14/divipol.json` (copias idénticas) y los tests leen esas rutas.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_REPO = fileURLToPath(new URL("../../../", import.meta.url));

export const RUTAS_DIVIPOL = readdirSync(join(RAIZ_REPO, "apps"), { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => join(RAIZ_REPO, "apps", entrada.name, "public/e14/divipol.json"))
  .filter((ruta) => existsSync(ruta));

if (RUTAS_DIVIPOL.length === 0) {
  throw new Error("no se encontró apps/*/public/e14/divipol.json en el monorepo");
}

export const DIVIPOL_CRUDO = readFileSync(RUTAS_DIVIPOL[0], "utf8");
