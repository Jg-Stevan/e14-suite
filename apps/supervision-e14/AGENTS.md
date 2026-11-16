# AGENTS.md — supervision-e14

Reglas para agentes IA (y personas) que editan este repo. El producto es el
panel de supervisión del ecosistema E-14 (monitoreo + carga masiva); trabaja
con **datos electorales reales**. Este repo es un workspace del monorepo
`e14-suite` (raíz: `../../`).

## Stack y comandos (verificados contra package.json)
- Next.js + TypeScript (export estático + Pages Function del wasm — D8/D80).
  Gestor de dependencias: **bun**, fijado en 1.4.2 en las 4 fuentes (raíz del
  monorepo: `engines` + `packageManager`; workflows del `.github/` raíz —
  R-03, auditoría 2026-11-16). No uses npm ni pnpm.
- Clon limpio (pasos ocultos — R-03): `bun install` desde la RAÍZ (con bun
  ≠ 1.4.x el lockfile v2 no parsea) → `cd apps/supervision-e14 && bun run
  preparar` (workers + vendor + assets SHA-256) ANTES de `bun test`. El linker
  de ESTA app es **hoisted** (`bunfig.toml`) — corre sus tests desde su propia
  carpeta para que bun lo respete.
- `bun run dev` — servidor en el puerto 3000 (ejecuta `preparar` antes).
- `bun run verificar` — preparar + typecheck + lint + test + test:paquete. **Es la puerta de salida**: nada se declara terminado sin este comando en verde, y se reporta su salida real.
- Unitario: `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:paquete` (suite del motor).

## Reglas del producto
- El módulo de supervisión **no lee votos**: muestra la foto y el encabezado impreso tal cual (regla D23). No inventes totales ni interpretes el contenido del acta.
- La validación es contra el catálogo oficial DIVIPOLA (`idEnlace`). Un dato que no está en el catálogo se marca como fallo, no se completa a mano.

## Privacidad e integridad
- Son datos electorales reales: no commitees actas, capturas ni credenciales.
- No añadas dependencias, telemetría ni servicios externos sin preguntarlo antes.
- Nunca `git push --force` ni reescritura de historial. Las purgas autorizadas
  (binarios, secretos) y sus SHAs previos están registradas en
  `docs/archivo/registro-consolidacion.md` de la RAÍZ del monorepo (R-15,
  auditoría 2026-11-16); la regla completa con sus requisitos (bundle `--all`,
  `--force-with-lease`, registro del SHA previo) vive en los AGENTS de digi y
  en las decisiones D85/D90 de `docs/adr/README.md`.
- No commitees binarios de `public/` (modelos `.onnx`, `traineddata.gz`, OpenCV, vendor). Van en `.gitignore` y los genera `bun run preparar`; si hace falta un asset nuevo, se declara en `scripts/assets.lock.json` con su SHA-256.
- El hub local (`scripts/hub-local.mjs`) exige **token de lectura** en el GET
  de datos desde R-09 (auditoría 2026-11-16): se imprime al arrancar junto a
  la clave admin y se pega en Configuración → «Token de lectura del hub».

## El motor (`packages/scanner-core`) — la paridad es ESTRUCTURAL

`digielect14` es el digitalizador MÓVIL de un puesto; este repo es el supervisor
masivo. **Ambos consumen EL MISMO paquete** `@jg-stevan/scanner-core` por
workspace — no hay copias vendorizadas que sincronizar, ni commits espejo, ni
cotejo de checkouts (el harness `qa-paridad-motor.ts` pre-monorepo se RETIRÓ).
Lo que además se comparte: el mismo `tesseract.js` con el mismo
`spa.traineddata`, las mismas ONNX PP-OCRv4 y el mismo `public/e14/divipol.json`.

- **El golden del contrato** vive en
  `packages/scanner-core/tests/fixtures/contrato-motor.json` (21 cabeceras
  SINTÉTICAS + la salida exacta del motor) y lo valida
  `packages/scanner-core/tests/contrato-motor.test.ts` — corre con
  `bun run test:paquete` (parte de `verificar`).
- **El golden NO se edita ni se regenera aquí.** Su única fuente es
  `digielect14/scripts/gen-contrato-motor.ts` (escribe directo al fixture del
  paquete — R-02/D-3). Si un cambio de negocio en ESTE repo pone el test rojo,
  la decisión es explícita: o se revierte, o se hace el mismo cambio de
  negocio en el MOTOR (`packages/scanner-core`) y se regenera desde digi.
  «Arreglar» el esperado a mano es lo que convertiría el contrato en decorativo.
- Diferencias legítimas ya declaradas (no son deuda): aquí `codigoUnicoE14` y la
  interfaz `SenalLectura` están exportadas porque las consumen los tests del
  lote, `PUBLIC_BASE` viene de `@/shared/env`, y `marcadores.ts` cita la
  procedencia de sus muestras con otras palabras.
- Lo que NO se porta del móvil a aquí: la cola/bandeja/runner de MASIVA del
  MÓVIL es otra (aquí la masiva es local, D94); el router por hardware y
  PP-OCRv5 (sidecar nativo) son de digi. Ver `docs/DECISIONS.md` de
  `digielect14` (D78/D80).

## Estilo
- Responde en español. Mantén los identificadores del repo como están.
- Commits convencionales en español, pequeños y atómicos.
- Los workflows de CI vivos viven SOLO en `.github/workflows/` de la RAÍZ
  (GitHub jamás ejecutó los anidados en `apps/*/.github/` — R-12). Los gates
  de esta app llegan a la raíz con `paths-filter`.
