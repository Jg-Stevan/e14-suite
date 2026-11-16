/**
 * Contrato md5 de los módulos D-only del digitalizador (H-02 / R-02,
 * auditoría 2026-11-16).
 *
 * Los `CONTRATO.json` de `core/` y `ui/` fijan el md5 (contenido en LF) de
 * cada módulo vendoreado de `web-scanner` que vive SOLO en esta app (sin
 * contraparte en el motor compartido). El validador histórico
 * (`scripts/qa-core-vendorizado.ts`) murió con la consolidación del monorepo
 * y los hashes quedaron mintiendo en silencio: 5/6 de core y 1/1 de ui
 * estaban vencidos.
 *
 * Este módulo es la ÚNICA fuente de la lista de módulos vigilados y del
 * cálculo del hash — la consumen el guard de pruebas
 * (`__tests__/contrato-md5.test.ts`) y el regenerador
 * (`scripts/gen-contrato-md5.ts`). Ritual al editar un módulo vigilado:
 * editar → `bun scripts/gen-contrato-md5.ts` → `bun run verificar`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Módulos D-only vendoreados de web-scanner (ver `core/LEEME.md`). No
 *  incluye los kits nativos de digi (vibrar, wake-lock): nacieron AQUÍ, no
 *  tienen procedencia externa que congelar. */
export const MODULOS_CORE_DONLY: readonly string[] = [
  "frame-loop.ts",
  "motion-stabilizer.ts",
  "pdf-export.ts",
  "pwa.ts",
  "quality.ts",
  "sensor-profiler.ts",
];

/** El árbol ui/ vendoreado (ver `ui/LEEME.md`). */
export const MODULOS_UI: readonly string[] = ["ZoomableVisor.tsx"];

/** md5 del contenido con finales de línea normalizados a LF — el hash es
 *  estable entre checkouts de Linux y Windows (`.gitattributes` fuerza LF,
 *  pero `core.autocrlf` puede materializar CRLF igual). */
export function md5ContenidoLf(contenido: string): string {
  return createHash("md5").update(contenido.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** md5 (LF) de un archivo del árbol fuente. */
export function md5DeArchivo(rutaAbsoluta: string): string {
  return md5ContenidoLf(readFileSync(rutaAbsoluta, "utf8"));
}
