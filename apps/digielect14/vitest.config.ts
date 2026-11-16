import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Overnight 2026-10-22 (Prioridad 2): suite unitaria para las partes PURAS
 * de lib/e14 (clasificador / completitud / divipol) — entorno node, sin DOM.
 * Las dependencias DOM de los módulos bajo test se mockean con vi.mock
 * (ver completitud.test.ts). NO cubre los QA de regresión (scripts/qa-*.ts),
 * que siguen corriendo con `bun scripts/qa-*.ts`.
 */
export default defineConfig({
  // Q-52 (plan 2026-11-12) — alias `@` → src/: tsconfig lo define y el test
  // de componente de ReviewView lo necesita (importa "@/lib/e14/store").
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Ola 2 §2.3 — cobertura INFORMATIVA (baseline medida por la fase 2:
    // 33,28 % sentencias · 29,46 % ramas). El informe solo se emite con
    // `vitest run --coverage`; el umbral sube con cada ola del plan (nunca
    // baja). La suite del paquete (bun test packages/scanner-core) corre
    // aparte (`bun run test:paquete`) y queda fuera de este include.
    coverage: {
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      thresholds: {
        // R-37 (auditoría 2026-11-16) — RATCHET medido: 19,86 % statements
        // con ESTA toolchain (vitest 5 + coverage-v8 5, medido 2026-11-16
        // sobre 404 pruebas): el piso sube de 17 a 19. La regla de la casa
        // sigue — cada ola que toque código sube el umbral o al menos no lo
        // baja. (El 33,28 % citado por una auditoría vieja jamás fue
        // reproducible con esta toolchain; el 17,08 % era el baseline de la
        // remediación.) En CI corre con --coverage (ci-movil.yml) y el
        // reporte se publica como artefacto.
        statements: 19,
      },
    },
  },
});
