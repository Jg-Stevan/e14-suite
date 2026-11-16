import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // R-22 (H-19, auditoría 2026-11-16) — guard de capa: los COMPONENTES del
  // módulo digitalizador no tocan el motor directamente (misma frontera que
  // digielect14 defiende en error desde 7.5/A4). El consumo pasa por
  // src/modules/digitalizador/lib/e14/fachada.ts.
  {
    files: ["src/modules/digitalizador/components/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@jg-stevan/scanner-core", "@jg-stevan/scanner-core/*"],
          message:
            "Los componentes no tocan el motor: re-exporta desde src/modules/digitalizador/lib/e14/fachada.ts (R-22, mismo patrón 7.5/A4 del hermano).",
        }],
      }],
    },
  },
  // KIT carga-masiva-supervision-v1 (D27): el módulo digitalizador
  // trasplantado (src/modules/digitalizador/**) llega con las reglas de su
  // repo origen (digielect14) — se conservan para no reescribir el motor.
  // R1: reglas con SCOPE — SOLO aplican al módulo digitalizador; el resto
  // del repo (app, components, modules/supervision, modules/perfil-dispositivo)
  // usa las reglas estándar de eslint-config-next sin relajar.
  {
    files: ["src/modules/digitalizador/**"],
    rules: {
      // TypeScript
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/no-unused-disable-directive": "off",

      // React (reglas del repo origen — ver eslint.config.mjs de digielect14)
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/prop-types": "off",
      "react-compiler/react-compiler": "off",

      // Next.js
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",

      // General
      "prefer-const": "warn",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-debugger": "error",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-irregular-whitespace": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-mixed-spaces-and-tabs": "off",
      "no-redeclare": "off",
      "no-undef": "off",
      "no-unreachable": "error",
      "no-useless-escape": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor del motor digitalizador (D27): jsQR UMD vendido byte-exacto +
    // assets del core copiados (opencv/detection-worker/onnxruntime) — JS de
    // terceros/minificado, no código fuente del repo (mismo criterio del
    // repo origen).
    // R7b (M10-fin): el vendor jsQR se MOVIO de masiva/vendor a vendor/ del
    // nucleo (git mv byte-idéntico) — el ignore viaja con el activo.
    "src/modules/digitalizador/lib/e14/vendor/**",
    "public/vendor/**",
    "public/scanner/**",
    "public/wasm/**",
    // Infraestructura local y artefactos generados (no código del producto).
    "node_modules/**",
    ".next/**",
    "out/**",
    "dist/**",
    "skills/**",
  ]),
]);

export default eslintConfig;
