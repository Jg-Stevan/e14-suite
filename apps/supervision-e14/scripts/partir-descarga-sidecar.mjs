/**
 * partir-descarga-sidecar.mjs — publica el ZIP del sidecar sin un repo público.
 *
 * Cloudflare Pages rechaza archivos de más de 25 MiB y el ZIP del sidecar ronda
 * los 108 MiB. En vez de abrir un repositorio público solo para el binario, el
 * deploy parte el ZIP en trozos bajo `out/descargas/sidecar/` y la página
 * `/descargas/sidecar/` los reensambla en el navegador con `Blob`. Los nombres
 * llevan el SHA-256 del ZIP: un deploy nuevo no puede mezclar partes viejas.
 *
 * Uso: node scripts/partir-descarga-sidecar.mjs <zip> <dir-salida> [--parte-bytes=N]
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const LIMITE_PAGES = 25 * 1024 * 1024;
const PARTE_DEFAULT = 20 * 1024 * 1024;
const MIB = 1048576;

const [entrada, salida, ...resto] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error("uso: node scripts/partir-descarga-sidecar.mjs <zip> <dir-salida> [--parte-bytes=N]");
  process.exit(2);
}
if (!existsSync(entrada) || !statSync(entrada).isFile()) {
  console.error(`[descarga] ✘ no existe el ZIP: ${entrada}`);
  process.exit(1);
}

let parteBytes = PARTE_DEFAULT;
const flag = resto.find((a) => a.startsWith("--parte-bytes="));
if (flag) {
  parteBytes = Number(flag.slice("--parte-bytes=".length));
  if (!Number.isInteger(parteBytes) || parteBytes <= 0 || parteBytes > LIMITE_PAGES) {
    console.error(`[descarga] ✘ --parte-bytes debe ser un entero entre 1 y ${LIMITE_PAGES}`);
    process.exit(2);
  }
}

const bytes = readFileSync(entrada);
if (bytes.length === 0) {
  console.error("[descarga] ✘ el ZIP está vacío");
  process.exit(1);
}

const archivo = basename(entrada);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const etiqueta = sha256.slice(0, 12);
const partes = [];

// No borrar la carpeta entera: `out/descargas/sidecar/` ya contiene la página
// index.html que copió Next desde public/. Solo se retiran el manifiesto y las
// partes del build anterior.
mkdirSync(salida, { recursive: true });
for (const nombre of readdirSync(salida)) {
  if (nombre === "manifiesto.json" || nombre.includes(".parte")) {
    rmSync(join(salida, nombre), { force: true });
  }
}

for (let inicio = 0, n = 0; inicio < bytes.length; inicio += parteBytes, n += 1) {
  const nombre = `${archivo}.${etiqueta}.parte${String(n).padStart(2, "0")}`;
  writeFileSync(join(salida, nombre), bytes.subarray(inicio, inicio + parteBytes));
  partes.push(nombre);
}

const manifiesto = {
  version: 1,
  archivo,
  bytes: bytes.length,
  sha256,
  parteBytes,
  partes,
};
writeFileSync(join(salida, "manifiesto.json"), JSON.stringify(manifiesto));

console.log(
  `[descarga] ${archivo} · ${(bytes.length / MIB).toFixed(1)} MiB · ` +
    `${partes.length} partes de ${(parteBytes / MIB).toFixed(1)} MiB → ${salida}`,
);
