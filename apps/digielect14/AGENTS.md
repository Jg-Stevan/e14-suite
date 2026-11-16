# AGENTS.md — digielect14

Reglas para agentes IA (y personas) que editan este repo. El producto es un
digitalizador de actas E-14 que corre en el navegador del celular; trabaja con
**datos electorales reales**. Este repo es un workspace del monorepo
`e14-suite` (raíz: `../../`).

## Comandos (verificados contra `package.json`)

- `bun install` — desde la RAÍZ del monorepo (workspaces bun). No uses npm ni pnpm.
- `bun run preparar` — materializa lo que no se versiona: vendor copiado de `node_modules` y modelos/OpenCV descargados con SHA-256 fijado (`scripts/assets.lock.json`). Un clon limpio lo necesita antes de `bun run test`.
- `bun run dev` — Next.js en el puerto 3000 (OCR a un hilo: `next dev` no emite
  cabeceras COOP/COEP, así que `crossOriginIsolated` es falso).
- `bun run verificar` — preparar + typecheck + lint + test + test:paquete. **Es la puerta de salida**: nada
  se declara terminado sin este comando en verde, y se reporta su salida real.
- `bun run build` — bundle de producción (el `prebuild` genera los workers).
- Sueltas: `bun run typecheck` · `bun run lint` · `bun run test` (vitest) ·
  `bun run test:paquete` (suite del motor, `bun test ../../packages/scanner-core`) · `bunx knip`.
- `bash scripts/check-quality.sh` — el gate completo (7 pasos: lo anterior más
  build, los 3 smoke de worker y los harnesses `scripts/qa-*.ts`). Lo que corre
  CI vive en `.github/workflows/` de la RAÍZ del monorepo.

## Entorno (bun 1.4.2 y finales de línea)

- **bun fijado en 1.4.2 en sus 4 fuentes** (R-03, auditoría 2026-11-16):
  `engines` y `packageManager` del `package.json` RAÍZ, y `bun-version` de los
  workflows del `.github/` raíz. Los smoke comparan los artefactos de
  `public/scanner/` byte a byte y el minificador de bun cambia entre
  versiones: subir bun sin regenerar los workers pone el gate rojo.
- Clon limpio del monorepo, pasos completos (los ocultos que mordían — R-03):
  1. `bun install` desde la RAÍZ. Con bun ≠ 1.4.x el lockfile v2 no parsea
     (`UnknownLockfileVersion`) y la re-resolución instala drift que rompe lint.
  2. `cd apps/digielect14 && bun run preparar` (vendor + assets SHA-256) ANTES
     de `bun run test`.
  3. El panel (`apps/supervision-e14`) usa linker **hoisted** (`bunfig.toml`
     propio); sus tests se corren desde SU carpeta. Los workers de capa 0 y
     fallback de ESTA app se precompilan en `prebuild`/`preparar` — sin eso el
     smoke de frescura falla.
- `.gitattributes` fuerza LF y `-text` en `public/scanner/*.js`. Sin eso, un clon
  en Windows con `core.autocrlf=true` materializa CRLF y la frescura falla.
- En Windows + Git Bash, `NEXT_PUBLIC_BASE_PATH=/digielect14` se manglea a una
  ruta local: antepón `MSYS_NO_PATHCONV=1`. Desde A-02 el build no fija basePath
  (canal único Cloudflare en raíz), pero el código cliente del motor sigue
  leyendo la variable — no la definas. Los detalles, en `docs/DEUDA.md`.

## Reglas del producto

- La app **no lee votos**: comprueba si la zona de votos tiene tinta (marcador
  obligatorio, D41) y extrae cabecera e identificación. No inventes totales ni
  interpretes el contenido del acta.
- La identificación se valida contra el catálogo oficial DIVIPOLA
  (`public/e14/divipol.json`). Un dato que no está en el catálogo se marca como
  fallo, no se completa a mano.
- Todo comportamiento nuevo de producción va **detrás de un flag**
  (`src/lib/e14/flags.ts`: `DEFAULTS ← public/flags.json ← overrides de
  localStorage`). El mantenedor usa esa cadena como kill-switch; el override manual
  manda sobre el plan por tier y sobre el default.

## Privacidad e integridad

- Son datos electorales reales: **no commitees actas, capturas ni credenciales**,
  y no envíes actas a endpoints distintos del hub (`POST {hub}/v1/actas`,
  autenticado — los fixtures SIM son sintéticas tras la decisión **D86**
  (2026-11-08, cierre de D35): la excepción de la foto real quedó anulada y
  su retirada de la historia está ejecutada con los scripts de `scripts/`).
- No añadas dependencias, telemetría ni servicios externos sin preguntarlo antes.
- Nunca `git push --force` ni reescritura de historial. **Excepción única y
  autorizada por el mantenedor**: purgas puntuales — sus SHAs previos, motivos y
  respaldos están registrados en `docs/archivo/registro-consolidacion.md` (raíz
  del monorepo, R-15). Cualquier otro caso sigue prohibido.

## Antes de borrar código que parece muerto

1. `bunx knip` lo marca como export unused → revisa si lo consume un
   `scripts/qa-*.ts` (muchas firmas se exigen por **regex sobre el fuente**, no
   por import) o un test con **import dinámico**; en esos casos knip no los ve.
2. Quita el `export` primero y corre `bun run lint`: si aparece «defined but
   never used», era muerto real y se va completo (la constante, el helper y los
   comentarios que solo existían para él).
3. Si el símbolo es ancla de contrato, déjalo exportado y anótalo en
   `docs/DEUDA.md` en vez de tocarlo.
4. **Lo mismo aplica a `dependencies`**: antes de quitar un paquete de
   `package.json`, revisa los `peerDependencies` de los paquetes vendorizados
   (`src/lib/e14/ui/LEEME.md`) y busca el nombre en `node_modules`. `framer-motion`
   no aparece en ningún `import` de `src/`, pero lo consume `ZoomableVisor` del
   árbol UI vendorizado vía peer: quitarlo rompe la pantalla de revisión, y como
   bun auto-instala peers el build local lo sigue tapando (con npm o pnpm fallaría
   al resolver).
5. **El motor vive en `packages/scanner-core`, consumido como `workspace:*`**
   (ver su `LEEME.md` y `CHANGELOG.md`). No es un paquete de npm: es un
   workspace de este monorepo — lo que ves en `node_modules` es el enlace
   del workspace, no una copia. No lo borres a mano ni lo reinstales con
   npm.

## El motor (`packages/scanner-core`) — la paridad es ESTRUCTURAL

**Frase autoridad: el motor vive en `packages/scanner-core`, consumido como
`workspace:*`** (una sola fuente, sin vendorizado ni npm — decisión D-monorepo
del `docs/adr/INDICE.md` raíz). Este repo y `supervision-e14` (supervisor
masivo) consumen EL MISMO paquete físico: no hay hermano que editar, ni ritual
de commits espejo, ni cotejo de checkouts (el harness `qa-paridad-motor.ts`
pre-monorepo se RETIRÓ — la paridad procedural murió con la consolidación).
Lo que además se comparte entre apps: el mismo `tesseract.js` con el mismo
`spa.traineddata`, las mismas ONNX PP-OCRv4 y el mismo `divipol.json`.

Editar el motor: cambia el archivo en `packages/scanner-core/src/**` (es código
de ESTE monorepo). Condiciones: (1) regenerar y commitear el golden si el
cambio toca el clasificador, (2) si el cambio altera la lectura de un acta
—umbral, recorte, normalización de texto—, pasar los tests del paquete
(`bun test packages/scanner-core`, que corre en el `verificar` de AMBAS apps).
Todo comportamiento *nuevo* de producción sigue detrás de un flag de
`src/lib/e14/flags.ts`.

### El golden del contrato (una sola fuente de verdad)

El contrato vive en `packages/scanner-core/tests/fixtures/contrato-motor.json`
(21 cabeceras SINTÉTICAS + su salida exacta) y lo valida
`packages/scanner-core/tests/contrato-motor.test.ts` — corre con
`bun run test:paquete` (parte de `verificar`).

- **Regeneración de UN paso** (R-02/D-3, auditoría 2026-11-16):
  `bun scripts/gen-contrato-motor.ts` — escribe DIRECTAMENTE al fixture del
  paquete (la ruta pre-monorepo `src/lib/e14/__fixtures__/` quedó muerta y se
  corrigió). `--check` para CI.
- **Se toca el negocio clasificador y el test del paquete pone rojo** → es un
  cambio de comportamiento REAL: regenera, revisa el diff del golden descriptor
  por descriptor y commitea golden + código en el MISMO commit. «Arreglar» el
  esperado a mano es lo que convertiría el contrato en decorativo.
- Salida de OCR sobre píxeles, `quad` y `score` NO están en el contrato
  (necesitan navegador/wasm). El `puente/` de envío es exclusivo de este repo.

### Los módulos D-only de ESTA app (CONTRATO md5)

`core/CONTRATO.json` y `ui/CONTRATO.json` fijan el md5 (contenido en LF) de los
módulos vendoreados de `web-scanner` que viven SOLO aquí (frame-loop,
motion-stabilizer, pdf-export, pwa, quality, sensor-profiler + ZoomableVisor).
Desde R-02 (H-02, auditoría 2026-11-16) el guard
`src/lib/e14/__tests__/contrato-md5.test.ts` los congela dentro de vitest, y el
regenerador es `bun scripts/gen-contrato-md5.ts` (`--check` para CI). Ritual:
editar → regenerar → `bun run verificar`. El validador histórico
(`qa-core-vendorizado.ts`, citado por los LEEME viejos) murió con la
consolidación — no lo cites como vivo.

## Estilo

- Responde en español; identificadores de dominio, comentarios y commits quedan
  en español (Conventional Commits: `feat(e14): …`, `fix(e14): …`).
- Muerto = fuera. Sin `_vars`, sin re-exports de compatibilidad, sin comentarios
  describiendo código removido.
- Un commit pequeño y frecuente vale más que un commit gigante.
- Los workflows de CI vivos viven SOLO en `.github/workflows/` de la RAÍZ
  (GitHub jamás ejecutó los anidados en `apps/*/.github/` — R-12, auditoría
  2026-11-16). Si un gate de esta app debe correr en CI, se lleva a la raíz con
  `paths-filter`.

## Dependencias (política de pinning, 6.1.3)

- **Caret por defecto** (`^`) en `dependencies`/`devDependencies`; el lock
  (`bun.lock`) fija el exacto que corre en CI. Excepción: los motores cuyo
  comportamiento es decisión de producto se fijan EXACTOS
  (`onnxruntime-web 1.31.1` — unificado entre las dos apps y el paquete, R-18 —,
  `tesseract.js 5.1.1`, `zxing-wasm 3.1.6`) — subirlos sin re-medir rompe las
  decisiones D53/D60/D76.
- **`bun audit` + gitleaks corren en CI en cada push/PR**
  (`.github/workflows/ci-seguridad.yml` de la raíz — R-04, auditoría 2026-11-16).
  Dependencias con vulnerabilidad CONOCIDA en paths de BUILD se suben esa misma
  semana (no es opcional); las de runtime pasan por la regla de arriba (decisión
  registrada antes de subir un motor).
- Antes de añadir una dependencia: `§Privacidad` manda (preguntar primero).

## Cómo se lee este repo

Los comentarios citan **kits** (`e14-*`), **decisiones** (`D<n>`) y secciones
de spec. Las decisiones viven en `docs/DECISIONS.md` (de ESTA app) y en
`apps/supervision-e14/docs/adr/README.md` (del panel — numeración POR REPO, no
confundir); el guard `adr-resolver.test.ts` del panel exige que toda `D<n>`
citada en código resuelva en alguno de los dos. Los kits y las specs son
artefactos de sesiones previas que no viajan en el repo: una mención sin
archivo no es un enlace roto. Los REPORTE/MEDICION/NOTA fechados viven en
`docs/archivo/` (H-45). `apps/scanner-lab/…` es el laboratorio del repo de
ORIGEN del motor (`Jg-Stevan/web-scanner`) — el motor VIVO es
`packages/scanner-core`.

## Dónde está qué

`packages/scanner-core/` EL MOTOR (workspace `workspace:*`: pipeline,
OCR, clasificador, completitud, marcadores, workers) · `src/lib/e14/` la
capa de dominio de ESTA app (pipeline L2, puente de envío, observabilidad,
política del gate en `politica/`) · `src/components/e14/` pantallas y hooks
de cámara (consumen el motor vía `src/lib/e14/fachada.ts` — regla 7.5) ·
`src/app/` rutas de Next · `scripts/` QA y utilidades de build · `docs/`
decisiones, arquitectura y `archivo/` histórico. El detalle por módulo está
en `docs/ARQUITECTURA.md`.
