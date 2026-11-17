# Deuda y pendientes

Lo que falta, lo que está cortado a propósito y las condiciones para reactivarlo.
Prioridad: **P0** bloquea el uso real; **P1** afecta la experiencia o la
operación; **P2** mejora deseable.

## 1. Cortado a propósito (no es un bug)

| Tema | Estado | Cómo se reactiva |
|---|---|---|
| Ledger remoto de envíos (D29) | Apagado con `LEDGER_REMOTO_ACTIVO = false`; no hay endpoint. | Implementar `/api/e14/envios` y poner la constante en `true`; las tres funciones ya respetan su contrato. |
| Notificaciones e informes (D82) | Vistas borradas (554 líneas). El dato de notificaciones sigue vivo sin UI. | Reescribir la vista si el negocio la vuelve a pedir; no resucitar el flag D20. |
| Persistencia de publicación | Memoria de sesión por diseño (sin backend). | Requiere backend o almacenamiento remoto; cambia el modelo de despliegue. |
| Aprobación/rescaneo desde el visor (D46) | Lógica dormida en el store; única acción visible: REPORTAR ANOMALIA. | Volver a exponer las acciones y sus motivos obligatorios. |
| Fotos de Roma/Barcelona en TRANSMISIÓN | Sintéticas: la fuente solo trae CÓNSUL/EMBAJADOR. | Con seguir fotos reales, añadirlas al manifest con la convención actual. |

## 2. Pendientes funcionales

| Prioridad | Tema | Detalle |
|---|---|---|
| P0 | Sonda `/salud` del sidecar | Hoy `ocrNativoUrl` nace `null`, así que hosted no falla; si se activa el sidecar, falta apagarlo solo cuando deja de responder. |
| P1 | Recepción sin destino para `SIN_JOIN` | Queda en el log y se puede reclasificar en la bandeja, pero no tiene cola propia. |
| P1 | Publicación solo de AUTO | Las ADVERTENCIA no se publican aunque el gate las acepte; `autoEnvioUmbral` controla el envío, no el join del monitor. |
| P1 | Monitor sin virtualización | 949 filas se renderizan completas; prohibido inventar paginación. Medir antes de optimizar. |
| P1 | Regla ALTO depende de la red en el momento del escaneo | Debería condicionar solo la descarga de modelos (`sincronizarSoloWifi`), no la clasificación del equipo. |
| P1 | iOS atrapado en MEDIO | Sin `deviceMemory`/`performance.memory`, la ruta de inferencia no se cumple. Fix propuesto: renderer GPU + sonda ≥750. |
| P2 | `benchmark.score` no viaja al perfil headless | El motor reporta `null` honesto; solo refinaría el origen `medio-elegible-upgrade`. |
| P2 | R2 de calidad no ejecutada | Filtro de documento, deskew de fotos, recorte al marco, nitidez y PDF de entrega. Cada uno con flag. |
| P2 | R1.5 presupuesto dinámico del prescan | Opcional; no se hizo. |
| P2 | Sidecar sin firma | SmartScreen advierte; requiere VC++ 2015-2022; doble instancia en 8765 reparte tráfico. |
| P2 — **CERRADA (2026-11-19, parche P-22)** | Dedup del puente móvil solo por SHA-256 exacto | CERRADA: el sobre `EntradaPuente` declara las tres huellas — `qrPayload?` y `dhash64?` en `digielect14/src/lib/e14/puente/tipos.ts:70,75`, estampadas por el móvil en `puente/mapear.ts:135-154` y listadas en el contrato del hub (`docs/adr/2026-11-16-contrato-hub-e14-puente.md`, tabla del sobre, ~líneas 49-50). El panel las consume por la ruta del hub (`hub-local.ts:311-314` → `publicarActaMasiva`) y el embudo deduplica en 3 capas (`actas-runtime.ts:366-387`: SHA-256 de bytes + payload QR exacto + dhash64 con Hamming ≤ 6) — matiz: 3 capas en el embudo del panel (actas-runtime) + 4 vías en el store masiva (`bytes`/`dhash`/`payload`/`payload-remoto`, `ViaYaEnviada` en `masiva/store.ts:240`). La ruta BANDEJA LOCAL también pasa `qrPayload` desde `store-e14.ts` (`publicarDesdeActa`, normalizado con `normalizarQrPayload` de shared); el tipo `Acta` del panel no estampa `dhash64` (solo lo calcula el puente del móvil), así que por esa vía la capa 3 queda sin huella local — sin huella no se inventa (conservador). |

## 3. Operación y despliegue

- **Cloudflare Pages (canal único):** verificar en cada despliegue que COOP/COEP llegan y que
  los dos wasm grandes se sirven por la Function con el tamaño correcto. La
  matriz de errores histórica está en `docs/archivo/RUNBOOK-deploy-pages-v1.md`.
- **GitHub Pages: retirado (verificado 2026-11-12 — `deploy-pages.yml` ya no
  está en `.github/workflows/`).** Cloudflare Pages es el único canal; sin sus
  cabeceras COOP/COEP cualquier host estático corre el OCR a un hilo.
- **Wasm partido:** el manifiesto debe quedar en `/e14/`, no en `/vendor/`, y
  `out/_routes.json` debe incluir solo los archivos partidos.
- **Sidecar:** construir en Windows (PyInstaller no cross-compila), publicar con
  semver sin `v` y probar en una máquina limpia; el runner no reproduce
  SmartScreen.
- **Benchmarks:** no usarlos como gate; anotar carga de máquina y repetir.

## 4. Higiene del repositorio

- **El gate local no era reproducible en un clon limpio.** Ocho componentes
  `src/components/ui/*` (andamiaje shadcn: calendar, carousel, chart, command,
  drawer, form, input-otp, resizable) y `src/lib/db.ts` importaban `cmdk`,
  `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-hook-form`,
  `react-resizable-panels`, `recharts`, `vaul` y `@prisma/client` — ninguno de
  esos nueve paquetes está en `package.json` ni en `bun.lock`. En la máquina de
  desarrollo pasaban porque `node_modules` heredaba los paquetes de un
  `bunx shadcn add` antiguo; en CI (`bun install --frozen-lockfile` + `tsc`)
  `bun run verificar` estaba rojo desde el primer commit. Los nueve archivos se
  fueron: cero consumidores en `src`, `functions`, `scripts` y `native`, y no
  hay `prisma/` (el `@prisma/client` de `db.ts` no era ni generable). Lección
  para el gate: si algo se borra, hay que borrar también su import huérfano.
- **PENDIENTE DE DECISIÓN DEL MANTENEDOR — datos personales en un repo que va a
  público.** Dos niveles, verificados abriendo los archivos, no deducidos del
  nombre:
  · *Capturas de sesión* (`docs/capturas-actas-reales-v1/` y
    `docs/capturas-divipola-v1/`, quince PNG, 1,5 MB, cero referencias en el
    repo): pantazos del supervisor con actas reales abiertas; en la página 2 se
    leen nombres, cédulas y firmas de los jurados. **Ya retiradas del árbol de
    trabajo.**
  · *Assets que consume el producto*: ocho `*.webp` de
    `src/modules/supervision/data/actas-reales/assets/`, seis `*.jpg` de
    `src/modules/digitalizador/assets/actas-demo/` y `acta-e14-real.jpg`
    (3,3 MB). La página 1 lleva totales de votación (eso es público por ley),
    pero la página 2 —`E14_88_335_005_02_001_TRANSMISION-2.webp`, revisada—
    muestra **nombres, cédulas y firmas de tres jurados**, que son datos
    personales de particulares y contradicen la regla del propio repo
    («no commitees actas», `CONTRIBUTING.md` regla 10).
  **El commit `910c71f` ya está empujado a `origin/main`**, así que borrar del
  árbol no basta: purgar el historial exige reescritura (`git filter-repo`/BFG)
  + `push --force` — prohibida por la regla del repo sin autorización explícita —
  y además un ticket a GitHub para que limpie cachés y vistas. Opciones: (a)
  autorizar la reescritura antes de abrir el repo, (b) anonimizar las páginas 2
  (tapar firmas/cédulas) y re-empujar, (c) reemplazar los assets por fixtures
  sintéticos, (d) declararlos documentos públicos y asumir las firmas visibles.
  Ninguna se decidió aquí porque ninguna es reversible sin tocar el remoto.
  **ESTADO R-49 (2026-11-19, verificación independiente):** el hallazgo es
  HISTÓRICO del repo pre-consolidación — el árbol actual NO contiene los
  assets señalados (verificado: `actas-reales/assets/`, `actas-demo/` y
  `acta-e14-real.jpg` ya no existen) y el escaneo del 2026-11-12 dio 0 hallazgos
  sobre commits accesibles (`docs/archivo/gitleaks-2026-11-12.txt`). Quedan
  abiertos DOS tramos que requieren al mantenedor: (1) re-escanear la historia
  COMPLETA desde el clon íntegro (el tramo de main anterior a ~2026-11-04; el
  escaneo del 11-12 usó historia recortada) y (2) elegir y ejecutar una de las
  opciones (a)–(d) para el remoto viejo, incluido ticket a GitHub Support para
  cachés/vistas si se reescribe. El gate periódico ya corre con config propia
  (`.gitleaks.toml`, R-60, 2026-11-19).
- Los JSON de benchmark contienen texto OCR de actas reales: **nunca** se
  versionan (ya están ignorados).
- `public/vendor/onnxruntime/` y `public/scanner/capa0-qr.worker.js` se generan
  en `preparar`; si un clon falla al arrancar, ejecutar `bun run preparar`.
- Las actas de demostración son documentos públicos recomprimidos (~3,3 MB). Si
  se añaden nuevas, respetar el guardrail de `actas-reales` (≤10 assets y ≤2 MB)
  y recomprimir antes de commitear.
- Convención de nombres de assets: los archivos reales usan
  `E14_<idEnlace>_<mesa>_<FORMULARIO>-<pagina>.webp`; el manifest es la fuente de
  verdad aunque la etiqueta visible difiera (`DELEGADOS` vs `CÓNSUL/EMBAJADOR`).
- Algunos comentarios del motor citan documentos del repositorio de origen
  (`revision-v1`, `REPORTE-*`, `ESTRATEGIA-*`) que no se versionan aquí: son
  procedencia histórica, no enlaces. La versión vigente de esa evidencia está en
  `docs/NOTAS-OCR-QR.md`, `docs/MEDICIONES.md` y `docs/adr/README.md`.

## 5. Decisiones que conviene revisar algún día

- **Numeración duplicada:** los comentarios del motor citan IDs del repo origen
  (D44, D57, D61, D63–D66, D74) con otro significado. Unificar el registro
  exigiría renumerar comentarios; riesgo alto, beneficio bajo.
- **Faltan D32 y D65–D74** en el registro local: D32 se perdió sin push. Lección:
  hacer push al cerrar cada tarea.
- **`AGENTS.md` ya existe** (reglas para agentes: stack, reglas del producto,
  privacidad y paridad con `digielect14`). La documentación histórica lo
  mencionaba como ausente; las reglas de fondo siguen también en
  `CONTRIBUTING.md` y `docs/adr/README.md`, así que hay tres entradas y conviene
  que `AGENTS.md` apunte a ellas en vez de duplicarlas.

## 6. Knip (C-6.3 del plan de cierre 2026-11-12) — configurado y triado

`knip@5.44.1` entró a devDependencies (espejo de la config de `digielect14`,
réplica pedida por el plan). `knip.json` cubre: entries de app/tests/scripts/
Pages Functions (`functions/**` — D80 wasm partes) y el workspace
`packages/scanner-core` con su contrato real (el `exports` map expone cada
`src/*.ts` como subpath público, más `tests/` y `workers/`). Resultado:
0 archivos/dependencias/binarios sin declarar o sin usar a nivel bloqueante;
exports/tipos/duplicados restantes **en `warn` (no bloqueante)** — superficie
deliberada: catálogo shadcn/ui (`src/components/ui/**` + hooks stock), catálogo
de iconos del digitalizador, helpers `__resetXParaTest`, alias semántico
`TECHO_ESCUDO_FONDO`, y helpers de observabilidad.

Deuda conocida documentada (PR propio, fuera del cierre):

- **Dependencias fantasma de radix:** `src/components/ui/*` importa
  `@radix-ui/react-*` (estilo viejo) sin declararlos — resuelven por hoisting
  del paquete unificado `radix-ui` (que los declara como dependencias suyas).
  Migrar los imports al paquete unificado.
- **Huérfanos detectados por knip** (0 referencias): `obs/identidad.ts` y
  `status-dot.tsx` — ignorados en la config con retiro pendiente (regla: nada
  se borra directo).
- **`fflate` en `packages/scanner-core/package.json`:** sin uso en sup, pero
  usado por `workers/__tests__/capa0.test.ts` en dig — se conserva por la regla
  de simetría byte-a-byte del paquete (`ignoreDependencies` documentado).
- **T-16 (paridad):** `heic2any`/`onnxruntime-web`/`tesseract.js`/`zxing-wasm`
  se declaran en la RAÍZ aunque los consume el paquete vendorizado (imports
  dinámicos) — decisión explícita de `qa-paridad-motor.ts`; no quitarlos.
- `tw-animate-css` se consume vía `@import` de CSS (knip no ve CSS).

Verificación: `bunx knip` → **exit 0** · `bun run typecheck` → 0 errores ·
tests del paquete → 154 pass.

## 7. H-41 residuales — excepciones documentadas (C-7 del plan de cierre)

Criterio del cierre: `rg -i "dueñ"` en CÓDIGO ACTIVO (`*.ts`/`*.tsx`/`*.mjs`/
`*.yml`/`*.sh`) → **0 matches** en ambos repos (verificado 2026-11-12). Los
residuales restantes son excepciones documentadas:

1. **Datos oficiales (NO se tocan — fidelidad DIVIPOLA):**
   `public/e14/divipol.json` (ambos repos). Los matches son substrings de
   topónimos oficiales de sedes de votación: «I.E FONTIDUEÑO JAIME ARANGO R»,
   «SEC PRIMARIA IE FONTIDUEÑO JAIME ARANGO» (FONTIDUEÑO = nombre propio del
   corregimiento/sede, dato de la Registraduría). Igual criterio para
   `divipola-exterior.json` de sup si lo hubiera.
2. **Documentos archivados (histórico — se conservan tal cual):**
   `docs/archivo/auditoria/GUIA-AUDITORIA-supervision-e14.md:31,93,98` (sup) ·
   `docs/archivo/sim-recursos/README.md:52` (dig). Excepción anotada en la
   fila H-41 del CIERRE-REPORTE.
3. **Artefacto generado upstream (pendiente de regeneración upstream):**
   `public/scanner/detection-worker.js` +
   `packages/scanner-core/assets/scanner/detection-worker.js` (ambos repos,
   3 hits por archivo). Son comentarios muertos embebidos («aviso Canvas2D del
   dueño») de una fuente YA saneada en la Ola 4 — el bundle no se regeneró
   entonces. Este repo NO tiene pipeline para regenerarlo (el bundle proviene
   de `src/scanner/core/*` del repo origen web-scanner, ver cabecera del
   archivo; `preparar` regenera `capa0-qr.worker.js` — verificado idéntico —
   pero no el detection-worker). Sin impacto funcional (comentarios); queda el
   pendiente de regeneración en el pipeline upstream.

## 9. A-10 — escaneo de secretos (C-4 del plan de cierre) — TRIADO

- Fecha: 2026-11-12. Herramienta: fallback manual documentado (C-4.4 del plan;
  `gitleaks`/`trufflehog` no disponibles en el entorno del cierre) sobre
  `git rev-list --all` + `git grep -I -n -E` con 11 patrones (gh, github PAT,
  vcp, gitlab, sk-, AWS AKIA, Google, Slack, Cloudflare token, claves
  privadas, asignaciones genéricas secret/token/password). Reporte REDACTADO
  (sin valores): `docs/archivo/gitleaks-2026-11-12.txt`.
- Resultado: **0 hallazgos** en los 65 commits de la historia COMPLETA (clon
  íntegro del bundle, fsck limpio).
- Triage: 0 hallazgos → 0 rotaciones. A-05 (reescritura de historia): sin
  secretos en historia; decisión HUMANA igualmente (A-05) por otros motivos.

## 10. Higiene de pruebas

- **Flaky dependiente del orden de suites (cerrado con R-01, registrado por
  R-23 — auditoría 2026-11-16).** El test M11 de `clonado-profundo.test.ts`
  solo fallaba si `hub-local-drenaje.test.ts` corría ANTES: bun test comparte
  el registro de módulos entre archivos y el drenaje SEMBRABA el singleton
  runtime de actas que el clonado heredaba. Causa raíz cerrada doble: (1) el
  aliasing en `fusionarActaRuntime` se rompió clonando en la frontera; (2)
  cada suite ahora siembra SU estado (`vaciarActasRuntimeParaPrueba()` en
  beforeEach/afterEach). **Regla permanente: ninguna suite depende de singletons
  sembrados por otra — todo estado compartido se resetea en beforeEach.**
  Condición de reactivación: si vuelve a aparecer un test que pasa aislado y
  falla en suite, buscar SIEMPRE estado de módulo compartido antes de tocar el
  test. (bun test no tiene --randomize todavía; el orden del readdir del clon
  es el que manda — la regla de beforeEach es la defensa.)

## 11. Accesibilidad (R-38, auditoría 2026-11-16) — registro mínimo

Hueco compartido §6.3 de la auditoría: 0 cobertura de a11y. Tratamiento
mínimo acordado para el panel: **registro manual, sin script nuevo** —
verificado el 2026-11-16, `apps/supervision-e14/scripts/` NO tiene
harnesses `qa-*.ts` (solo `.mjs` de build/parcelación y sus tests), así que
no hay infra de gate a la que engancharlo. Si el panel adquiere harnesses,
portar `apps/digielect14/scripts/qa-a11y-contraste.ts` (allí está registrado
con su modelo y sus perdonados en el DEUDA §9 de ese repo).

### 11.1 Contraste — tokens del tema: TODOS pasan AA

El tema solo-dark de `globals.css` (kit SUP-1 §2.1 + T-01…T-04) es sólido:
ningún par semántico baja de 5.3:1 (umbral AA texto: 4.5:1). Ratios medidos
2026-11-16 (WCAG 2.1 sobre las superficies reales):

| Token | Sobre `--background` #0a1314 | Sobre `--card` #0f1c1d | Otros |
|---|---|---|---|
| `--foreground` #dee4e3 | 14.61 | 7.82 | — |
| `--muted-foreground` #bbcbb8 | 11.06 | 10.25 | 9.74 sobre `--surface` · 7.16 sobre hover `--surface-highest` #2b3838 |
| `--primary` #05f292 | 12.65 | 11.73 | `--primary-foreground` sobre primary: 12.65 |
| `--amber` #ffb800 (PENDIENTE) | 10.85 | 10.06 | 9.51 sobre chip SCORE `--mz-amber-bg` #261e0b |
| `--danger` #ff4d4d (CRÍTICO) | 5.75 | 5.33 | 5.48 sobre `--hazard-bg` #241215 (botón REPORTAR/RECHAZAR) |
| `--neutral-state` #869583 (NO INICIADO) | 5.95 | 5.51 | — |
| `--error-text` #ff8d87 | — | 7.82 | — |

### 11.2 Hallazgo registrado — grises Tailwind CRUDOS como texto (crítico) — CERRADA

**CERRADA (2026-11-19):** migración aplicada — **35 instancias** de
`text-slate-500`/`text-gray-500` → `text-muted-foreground` en los 8 archivos
del módulo masiva + InformeCorrida (`InformeCorrida.tsx` ×21; masiva/:
acelerador ×3, barra-lote ×3, dropzone ×1, fila ×3, helpers ×1,
modal-revisor ×2, progreso-lote ×1). Re-verificado contra §11.1:
`--muted-foreground` (#bbcbb8) mide ≥7.2:1 en todas las superficies del tema.
El hallazgo original se conserva abajo como registro.

Mismo patrón crítico que el móvil (A11Y-1 del DEUDA de digielect14):
`text-slate-500` **×22**, `text-gray-500` **×13** y `text-gray-600` **×7**
usados como texto sobre las superficies oscuras del tema (≈**3.6–4.1:1**,
bajo el umbral AA de 4.5:1). Concentrados en el módulo digitalizador del
panel — la MasivaView real del sistema vive aquí, no en el móvil:

- `screens/InformeCorrida.tsx` ×21 (el peor: informe completo en slate-500)
- masiva/: `bandeja.tsx` ×5 · `barra-lote.tsx` ×4 · `modal-revisor.tsx` ×3 ·
  `fila.tsx` ×3 · `acelerador.tsx` ×3 · `progreso-lote.tsx`/`helpers.tsx`/
  `dropzone.tsx` ×1

**Prioridad: crítico** (texto informativo de estado/metadata de lotes bajo
4.5:1; el modal-revisor lo usa un auditor humano durante horas).
**Condición de remedio**: migrar a `text-muted-foreground` (#bbcbb8, ≥7.2:1
en todas las superficies) — es EL token del sistema para texto secundario;
no inventar gris nuevo. Tras remediar, re-verificar con los ratios de §11.1.

### 11.3 Teclado y táctiles (source-scan rápido)

- **Escape**: cubierto en los 3 diálogos (`acta-viewer-modal` ×4,
  `modal-revisor` ×5, `supervision-shell` ×4) y toolbar/header de actas.
- **focus-visible/focus:ring**: presente en 12+ archivos (incluido el
  catálogo shadcn `button`/`select`/`input`, que aporta anillos base a toda
  la UI construida sobre él). Pendiente menor: consistencia en tablas densas
  (`puestos-table`, `mesas-subtable`).
- **Táctiles 44 px**: ya decidido y vigente en **D7** (ADR README: «targets
  44 px» dentro de los diez ajustes técnicos) — este registro lo cita, no lo
  duplica.

## 13. DIVIPOLA — cruce contra la fuente oficial (R-39, auditoría 2026-11-16)

Hueco compartido §6.4 de la auditoría: la consistencia interna del catálogo
estaba congelada por test (949 puestos · 67 países · 3.670 mesas, exacto al
dígito — `data/__tests__/catalogo-divipola.test.ts`), pero nadie lo había
cruzado contra la fuente externa. **Cerrado el 2026-11-16** con
`scripts/cruzar-divipola.ts` (sin dependencias nuevas; la validación
estructural importa el MISMO validador del runtime, `domain/divipola.ts`):

- **Qué se cruzó**: los 949 registros de `data/divipola-exterior.json`,
  campo a campo (idEnlace + los 8 campos), contra la extracción del depto 88
  (CONSULADOS) del bundle DIVIPOL que sirve el **visor ciudadano E14 2026 de
  la Registraduría** — la misma fuente de verdad que documenta
  `apps/digielect14/scripts/gen-divipol.mjs` (SPEC-e14-cabecera §1).
- **Contra qué exactamente**:
  `https://e14segundavueltapresidente.registraduria.gov.co/assets/temis/divipol_json/departmentsTree.json`
  (descargada en vivo; el WAF exige User-Agent de navegador — el script hace
  fetch con UA + 1 reintento + fallback a curl). Se agotaron además: la
  DIVIPOLA del DANE en datos.gov.co (`gdxc-w37w` — responde, pero su
  nomenclatura NO publica consulados: cod_dpto 88 = San Andrés; el exterior
  es convención E14 de la Registraduría) y el portal
  `registraduria.gov.co` (403 a clientes no-navegador; sus puestos del
  exterior son PDFs — referencia humana).
- **Resultado (2026-11-16)**: **0 diferencias** — catálogo y fuente oficial
  idénticos registro a registro y en digest canónico
  (`bbb12832429e32ce…`), con conteos 949/67/3.670 a ambos lados y las
  validaciones estructurales completas en verde (formato dept(2)_mun(3)_
  zona(3)_puesto(2), depto "88" en todos, 3.670 pares (idEnlace, mesa)
  únicos). El snapshot firmado de la referencia quedó en
  `docs/archivo/divipola-snapshot-oficial.md` (SHA-256 del catálogo +
  SHA-256 de la extracción oficial + fecha + URLs).
- **Condición de re-cruce**: correr `bun scripts/cruzar-divipola.ts` —
  obligatorio si cambia el catálogo versionado (el script sale en rojo por
  DRIFT contra el snapshot) y al preparar cada release electoral. Si el
  cruce en vivo está limpio, `--congelar` mueve la referencia. El modo
  `--congelar` se REHÚSA a firmar si el cruce en vivo da diferencias. Si la
  fuente oficial deja de responder (WAF/rotación), el gate degrada a
  detección de drift contra el snapshot (plan B documentado en la cabecera
  del script).

## 12. Supply chain del sidecar (R-42, auditoría 2026-11-16) — REGISTRADO

Hueco compartido §6.8: el `.exe` PyInstaller que se distribuye en releases
jamás fue analizado como cadena de suministro. Con **R-08** (pines exactos de
`native/requirements.txt`, ya aplicado) quedó la mitad — qué ENTRA al build;
**R-42** cerró la otra mitad — cómo se VERIFICA lo que sale. Estado real:

**Qué quedó verificado (y dónde vive):**

- **Qué entra**: pines exactos de `native/requirements.txt` (R-08) + modelos
  `.onnx` por URL+SHA-256 de `scripts/assets.lock.json`, materializados en CI
  por `scripts/preparar-assets.mjs` antes de empaquetar.
- **Qué verifica el empaquetador solo** (`scripts/empaquetar-sidecar.mjs`):
  cada `.onnx` del bundle contra el SHA-256 del lock (modo `--sin-ejecutar`
  del runner), piso de tamaño del bundle (90 MiB onedir) y — en local —
  arranque real del `.exe` con `GET /salud`.
- **Qué publica el workflow** (`.github/workflows/sidecar-release.yml`, R-42):
  `SHA256SUMS.txt` adjunto a la release + al artifact (el hash ya estaba en
  el cuerpo, pero un cuerpo se edita y un asset se re-sube; ahora hay un
  archivo estándar `sha256sum -c`), `INVENTARIO-BUNDLE.txt` adjunto (dir
  recursivo con tamaños: QUÉ `.dll`/`.pyd` viajan dentro de los ~240 MiB —
  trazabilidad que el log del runner solo guarda 90 días) y el mismo hash en
  el cuerpo de la release leído del MISMO cálculo (imposible que diverja).
- **El canal público**: el deploy parte el ZIP con el SHA-256 en los nombres
  de las partes (`partir-descarga-sidecar.mjs`) — un deploy no puede mezclar
  partes viejas; `manifiesto.json` expone el hash para verificar descargas.

**El contrato (qué es verificable y qué no):** la reproducibilidad BIT A BIT
de PyInstaller NO está garantizada por diseño (timestamps de los PEs, rutas
del runner embebidas, `Compress-Archive` no determinista, y el runner construye
con Python 3.12 mientras los pines se midieron sobre 3.14.7 — las wheels
traen DLLs distintas). El contrato verificable es: MISMA fuente (tag) + MISMO
requirements + **hash publicado del build oficial** — el que se distribuye es
el que se hashea. Procedimiento completo de verificación y rebuild:
`native/BUILD-REPRODUCIBLE.md`.

**Qué queda abierto:**

- **Binario sin firmar** (P2 de §2): sigue siendo la vía más realista de
  compromiso percibido por el visitante (SmartScreen + antivirus). La
  verificación por SHA-256 de R-42 es el paliativo; el certificado EV de
  code signing sigue siendo decisión del mantenedor.
- **Reproducibilidad bit a bit real** (SOURCE_DATE_EPOCH + wheels
  deterministas): declarado NO perseguido — costo alto, ganancia marginal
  sobre el contrato actual.
- **El inventario publicado es del build de CI (Python 3.12)**: un rebuild
  local con 3.14 no casa tamaños exactos — comparar inventarios, no bytes
  (detallado en `native/BUILD-REPRODUCIBLE.md` §C).
