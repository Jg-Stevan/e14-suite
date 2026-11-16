# DEUDA — digielect14

Lo que falta, lo que está bloqueado y lo que **no** se debe tocar. Actualizado
el 2026-11-04 tras la limpieza profunda (fuera `tools/`, `lab/`,
`docs/archive/`, código muerto del módulo masiva y 48 KB de registro de kits en
`AGENTS.md`); cifras y estado re-verificados el 2026-11-12 (rama
`plan/ejecucion-2026-11-12`).

## Inventario que parece muerto y no lo es

- **Exports de `src/lib/e14/obs/`** (`abrirBuffer`, `registrarBreadcrumb`,
  `percentilDe`, `agregarUso`, `selloDe`, `diaDe`, `mezclarContador`,
  `volcarContadores`, `registrarUso`, `flushUso`, `FALLOS_KILL_LOCAL`,
  `TipoEvento`): `knip` los reporta como unused porque sus consumidores no son
  imports estáticos. `scripts/qa-obs-contract.ts` los exige con **regex sobre el
  fuente** (contrato §4.3) y `obs.test.ts` los alcanza con **import dinámico**.
- **`heic2any` (SÍ se quitó, el 2026-11-04)**: se declaraba aquí y en el core,
  pero solo el core lo importa (`dist/image-processor.js`). Al ser dependencia
  dura del core, sigue instalando y resolviendo; quedó como transitiva.
- **`framer-motion`**: desde la capa UI vendorizada (D83) tiene un import estático
  visible en `src/lib/e14/ui/ZoomableVisor.tsx`, así que `knip` ya no lo reporta.
  Antes parecía muerto porque solo lo usaba el `dist` de `@jg-stevan/scanner-ui`.
  **No quitarlo.**
- **Comentarios que citan `apps/scanner-lab`, `SPEC-*` o `KIT e14-*`**: son
  artefactos de las sesiones de desarrollo (repo del motor y briefs). No son
  enlaces rotos; el catálogo real de decisiones es `docs/DECISIONS.md`.
- **`public/` (≈64 MB)**: modelos y runtimes cargados en runtime por red
  (`models/rapidocr`, `models/tess/spa.traineddata.gz`, `vendor/onnxruntime`,
  `vendor/tesseract` con wasm SIMD y no-SIMD, `vendor/opencv`). Ninguno sobra:
  el OCR, el QR y la detección los piden, y el service worker los precachea.

## QA de contrato: verde desde 2026-11-04

Los dos fallos que arrastraba `scripts/check-quality.sh` se cerraron en la limpieza:

- `qa-aa-quickwins.ts` (grises 500/600 con texto ≤11 px): tres microcopias de
  `dev/PanelDev.tsx` y `dev/SeccionRastreo.tsx` pasaron de `text-slate-500` a
  `text-slate-400`. Solo el panel de desarrollador; la UI de campo no se tocó.
- `qa-obs-ui.ts` (`aria-label` de la puerta del modo dev): el ancla seguía
  exigiendo «modo de diagnóstico», nombre que el mantenedor renombró a «modo
  desarrollador». Se recalibró **el harness**, no la UI.

Desde el 2026-11-04 esos harnesses **y** los 2 smoke de worker corren en CI
(`quality.yml` anidado, hoy PURGADO por R-12 — el gate vive en
`.github/workflows/ci-movil.yml` de la raíz, con bun 1.4.2) — ver
"Trampas de entorno" abajo. Eran **7**; desde R-12 (auditoría 2026-11-16)
son **6** — `qa-paridad-motor.ts` se retiró: en el monorepo la paridad es
estructural (workspace) y el harness se auto-omitía SIEMPRE. El original:
`scripts/qa-paridad-motor.ts` (contrato de paridad con `supervision-e14`, D80);
en CI sale «omitido» porque no hay checkout hermano, y en local exige
`E14_HERMANO` o que el hermano esté al lado.

## Trampas de entorno (Windows ↔ CI)

- **`.gitattributes` no existía** y `core.autocrlf=true` materializaba los `.js`
  con CRLF. Los smokes comparan el artefacto generado **byte a byte** contra su
  regeneración, así que en Windows el gate cortaba en paso 4 con un fallo falso
  (`heartbeat.worker.js`: 5.071 bytes con CRLF vs 4.909 reales). Se resolvió
  fijando `* text=auto eol=lf` y `-text` para `public/scanner/*.js`. El índice ya
  estaba en LF (0 archivos `i/crlf`), así que no hubo renormalización.
- **…pero `.gitattributes` no reescribe el working tree que ya está materializado.**
  El clon viejo seguía con 172 archivos en CRLF (el blob en LF, así que
  `git status` los muestra LIMPIOS — el atributo normaliza al comparar y el cache
  de stat ni los lee). Se ve con `git ls-files --eol | grep w/crlf`. Consecuencia
  real, no estética: `public/models/rapidocr/ppocr_keys.txt` servido en DEV tenía
  **6.622 de 6.623 entradas terminadas en `\r`**, y `ocr/rapidocr.ts` partía por
  `"\n"` sin quitarlo ⇒ `ctcDecode` empalmaba `C\rO\rN\rS…` — texto que parece
  legible pero no matchea ni una ancla de `senal-lectura`. En PRODUCCIÓN no se ve
  (el build publica el blob, que es LF): es un fallo **solo de dev**, que se
  diagnostica mal porque «en el deploy funciona». Fix en dos partes: el parser
  ahora es `split(/\r?\n/)` (mismo fix que el hermano, por la misma razón — D80)
  y se renormalizaron los 13 assets servidos bajo `public/` que seguían en CRLF.
  El ancla vive en `scripts/qa-paridad-motor.ts`.
- **`bun` flotante**: los workflows usaban `setup-bun@v2` sin versión → `latest`.
  El minificador cambia entre versiones y el artefacto de capa 0 se commiteó con
  bun 1.3.x, así que la frescura dependía del día que corriera el job. Fijado en
  **1.4.2** (hoy en los workflows raíz `ci-movil.yml` · `deploy-movil-pages.yml`;
  los anidados quality/deploy-cf fueron purgados por R-12 — jamás corrieron;
  el mismo pin existía en `deploy-pages.yml`, retirado con A-02).
- **Los workflows raíz usan `bun run build`** (los anidados quality/deploy-cf
  fueron purgados por R-12; su build corrió cero veces) (deploy-cf vía
  `bun run build`, que SÍ dispara el `prebuild`), que NO dispara el
  `prebuild` de `package.json`: publica los bytes commiteados de
  `capa0-qr.worker.js`. Si alguien edita `src/lib/e14/qr/capa0-qr.worker.ts` sin
  regenerar el artefacto, el worker publicado queda viejo — y ahora el smoke de
  CI lo atrapa. Regenerar con `bun run prebuild`.
- **Git Bash manglea `NEXT_PUBLIC_BASE_PATH=/digielect14`** (lo convierte a
  `C:/Program Files/Git/digielect14` y Next rechaza el basePath). En Windows,
  anteponer `MSYS_NO_PATHCONV=1` al comando; en CI (Linux) no aplica.


- **Copiar el `src` del motor desde un working tree de Windows trajo CRLF a un
  repo con `eol=lf`.** `CONTRATO.json` se generó con el md5 de esos bytes y el
  CI (Linux, que clona en LF) lo iba a cortar en rojo el primer run. Dos
  arreglo: los md5 se calculan sobre el contenido con saltos normalizados a LF
  (`SIN_CR` en el harness, ídem en `contrato-core.test.ts`) y el árbol vendorizado
  se renormalizó a LF. Se comprueba sin esperar al CI: `git show HEAD:<ruta>` da
  el blob tal como lo verá Linux, y su md5 tiene que coincidir con el contrato.
  Ojo: `git ls-files --eol | grep w/crlf` muestra que acá casi TODO el working
  tree está en CRLF aunque el índice esté en LF — por eso el md5 por bytes crudos
  nunca debió ser la garantía.

## Pendiente de decisión del mantenedor

1. **CERRADO por D86 (2026-11-08) — `src/assets/acta-e14-real.jpg` salió del
   repo.** Era foto real de un acta empaquetada como fixture SIM; el modo SIM
   carga ahora fixtures sintéticas (`acta-sim-*.jpg`) vía cargadores dinámicos.
   En el hermano `supervision-e14` las actas reales también salieron del árbol
   (D87 de ese repo) y la reescritura de historia quedó preparada en los dos
   repos (D91 acá, D90 allá) — ejecutarla sigue siendo paso del mantenedor.
2. **Historial de `.git` (verificado 2026-11-12: ≈22 MiB con `du -sh .git`)**:
   son blobs de binarios ML de commits
   antiguos, no ramas. Reducirlo exige reescribir historial
   (`git filter-repo` / BFG) → roto para cualquiera con clon, y la regla del
   repo prohíbe reescritura de historial sin autorización explícita.
3. **Ramas remotas mergeadas** (`git branch -r` — verificado 2026-11-12: 28
   ramas remotas, 29 refs contando `origin/HEAD`; 11 ya mergeadas a `main`
   según `git branch -r --merged origin/main`): borrarlas es acción
   remota y no reversible para otros.
4. **Licencia — RESUELTO**: `LICENSE` (MIT) existe en la raíz
   (verificado 2026-11-12).

## Deuda técnica real

- `docs/archivo/sim-recursos/*.js` (4 scripts, ≈76 KB — movidos a archivo el
  2026-11-12) son evidencia histórica
  de las corridas de gama baja; `knip` los ve como archivos sueltos. Se van con
  el próximo reporte que los cite o con decisión del mantenedor.
- **El HEIC de 12 MP sigue costando ~6,9 s.** El tope de D82 corta el caso que
  mataba el acta (50 MP), pero NO acelera el archivo que sí se decodifica:
  heic2any 0.0.4 decodifica a resolución nativa y no admite `width`/`height`
  (verificado en su `dist`), así que el recorte en el decode no existe. La
  salida real sería usar libheif directo (o una lib que sí recorte) dentro del
  worker propio de `public/scanner/`, con su propio kit de evidencia. Mientras
  tanto, el camino caro solo se paga en IMPORTAR un HEIC: la cámara del puesto
  dispara JPEG.
- El helper `blobADataUrl` está duplicado (privado) en `jornada.ts` y
  `puente/mapear.ts`. Doce líneas de glue de `FileReader`; fusionarlas obligaría
  a `mapear.ts` a importar `image-utils.ts`, que arrastra el motor
  (`src/lib/e14/core/`) a la capa de envío. Se prefirió duplicación antes que
  acoplamiento.
- `docs/` sigue siendo la mayor parte del peso documental (≈450 KB tras la
  limpieza). `DECISIONS.md` (94 KB) y `SPEC-*` (≈99 KB) son la referencia de
  comportamiento; los `REPORTE-*` (archivados en `docs/archivo/`) son
  evidencia puntual de cada kit.
- La bitácora por sesión (`docs/worklog.md`, 528 KB) se retiró del repo: su
  contenido es reconstructible con `git log` + `docs/DECISIONS.md`.
- El worklog retirado dejaba constancia de unos tokens `ghp_`/`vcp_` pegados en
  chat durante los merges de 2026-10-21, con orden de revocarlos. No queda ningún
  literal en el repo (verificado con grep de patrones `ghp_`/`vcp_`/`github_pat_`
  y JWT), pero **confirmar la revocación** en GitHub y Vercel.

## Intocables (con razón)

- `evaluarGate()` y `statusDeScore()`: el desenlace lo decide el gate, no el
  score crudo (D6). Cambiar un umbral sin registrar la decisión está prohibido.
- El veto `INCOMPLETA` y el marcador `SIN_VOTOS` corren **fuera** de `evaluarGate`
  y mandan sobre él (D41).
- `REGISTRO_KITS` (`kits.ts`): solo rellena la mesa cuando la cabecera no la
  leyó; nunca produce `AUTO`. Ampliarlo exige actas oficiales verificadas.
- Los estados de `Acta` y las claves de persistencia (`e14-obs`,
  `e14-flags-overrides`, …): son contrato con el hub y con datos ya guardados en
  dispositivos en campo.
- `public/models/rapidocr/*` y `public/vendor/**`: versionados a mano junto con
  el core; cambiarlos sin re-medir tiempos rompe las decisiones D53/D60/D76.

## Deuda abierta tras D88 (2026-11-10)

- **Acta `084906` no cierra AUTO con Tesseract**: SUGERIDA con `fast` y con
  `best` en los 4 equipos medidos (A56, A13, TECNO KN3 y Chrome de escritorio);
  el pipeline la acepta después con RapidOCR. Investigar qué campos de cabecera
  rechaza `clasificarCabecera` (DIVIPOLA, completitud, conf por campo) antes de
  tocar umbrales. Cualquier corrección es cambio del motor compartido: golden
  `contrato-motor.json` regenerado y misma edición en `supervision-e14`.
- **Tesseract en iOS sin verificar**: falta medir en Safari/WebKit con un Mac
  para Web Inspector; el entorno HTTPS de LAN con CA local ya se probó
  (`https://<ip>:8443`, COOP/COEP y cámara funcionando).
- **Worker de Tess tras importaciones encadenadas**: fallo intermitente sin
  recargar página (visto en A13 y PC); no se reproduce con recarga limpia. En
  campo cada acta llega tras una captura nueva; revisar si conviene reiniciar
  el worker por importación.

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

## 8. A-10 — escaneo de secretos (C-4 del plan de cierre) — TRIADO

- Fecha: 2026-11-12. Herramienta: fallback manual documentado (C-4.4 del plan;
  `gitleaks`/`trufflehog` no disponibles en el entorno del cierre) sobre
  `git rev-list --all` + `git grep -I -n -E` con 11 patrones (gh, github PAT,
  vcp, gitlab, sk-, AWS AKIA, Google, Slack, Cloudflare token, claves
  privadas, asignaciones genéricas secret/token/password). Reporte REDACTADO
  (sin valores): `docs/archivo/gitleaks-2026-11-12.txt`.
- Resultado: **0 hallazgos** en los 699 commits accesibles de todas las refs.
- Cobertura: la traversa de `main` se corta en `8583d300` (G-1); el tramo de
  main anterior a ~2026-11-04 queda pendiente de re-escaneo desde el clon
  íntegro del mantenedor (coordinar con C-1). Las demás refs: completas.
- Triage: 0 hallazgos → 0 rotaciones. A-05 (reescritura de historia): sin
  secretos conocidos en la historia accesible; la reescritura sigue siendo
  decisión HUMANA (A-05) por si acaso el tramo no cubierto de main.

## 9. Accesibilidad (R-38, auditoría 2026-11-16)

Hueco compartido §6.3 de la auditoría 2026-11-16: **0 cobertura de a11y** en
una herramienta que usan jurados de votación en mesas de campo (sol, prisa,
lectura rápida). Este pass **audita y registra — NO es un rediseño**: ningún
hallazgo de esta sección se remedia aquí; cada uno tiene condición de
remedio para cuando se decida tocarlo.

### 9.1 Contraste WCAG AA — harness nuevo `scripts/qa-a11y-contraste.ts`

Corre en el gate (paso 6 de `check-quality.sh`). Extrae los pares
texto/fondo de TODO `src/components/e14/**` (las 5 pantallas + el chrome que
las viste) y verifica WCAG 2.1: **4.5:1** texto normal · **3:1** texto
grande (≥24 px, o ≥18.66 px con bold 700+) · **3:1** gráficos/iconos
(criterio 1.4.11). Modelo: source-scan línea a línea (mismo criterio de
co-ocurrencia que `qa-aa-invariantes.ts`) + pila de contenedores por
indentación para los fondos heredados; los alfas (`bg-[#10b981]/15`,
`text-white/60`) se componen sobre el fondo efectivo. La paleta es la REAL
de Tailwind v4 en **oklch** (`node_modules/tailwindcss/theme.css`, 4.3.5) +
los tokens `brand-*` de `globals.css` — ojo al remediar con hexes: el
`amber-400` de v4 es `#ffb900`, NO el `#fbbf24` de v3.

**Nota de alcance**: la vista `MasivaView` NO existe en el móvil — el módulo
masiva se retiró (ver `src/lib/e14/store/tipos.ts`) y su homónima vive en el
panel `supervision-e14` (registrada en el DEUDA de ese repo). Las pantallas
críticas cubiertas son ESCANEAR (ScanView), ANALIZANDO (AnalyzingView),
REVISIÓN (ReviewView), ACTAS (ActasView) y RESUMEN (ResumenView).

Corrida 2026-11-16: **152 pares · 136 OK · 16 WARN perdonados · 0 FAIL**.
Los 16 perdonados están registrados abajo (A11Y-1…A11Y-9) y viven en la
lista `PERDONADOS` del script con referencia al hallazgo — el gate es VERDE
hoy y **cualquier par NUEVO bajo el umbral revienta el check**. Cuando un
perdonado se remedia, el par pasa a OK solo y su entrada queda huérfana
(inocua): se poda de `PERDONADOS` por higiene.

Prioridades (criterio del plan): **crítico** = contraste < 4.5 en texto
informativo de la UI de campo · **medio** = foco invisible o icono al límite
· **bajo** = cosmético, decorativo o fuera de campo.

| ID | Prioridad | Dónde | Par (ratio) | Condición de remedio |
|---|---|---|---|---|
| A11Y-1 | **crítico** | ReviewView — chip «capa 0 qr · sin lectura» (sm+) y línea colapsada (móvil) | `text-gray-500` sobre `#10161f` **3.75** y sobre `#090d12` **4.03** | Es el ESTADO de lectura del QR (informativo: distingue «no corrió» de «falló»). Subir a `gray-400` (≈7:1) o `slate-300` en las 4 ocurrencias (chip sm+ `QR ✗`/`sin lectura` y línea móvil `capa 0 qr · sin lectura`). |
| A11Y-2 | **crítico** | ReviewView — píldora RECHAZADA de la zona fija (motivo del rechazo) | `text-white` sobre `bg-[#ef4444]` **3.76** (11 px bold no alcanza texto grande) | Le dice al jurado que repita la foto. Mismo fix del design system: fondo `#E52222` (crit, blanco 4.58 — patrón ya validado en `PrimaryBtn` crit) o `red-600` (4.83), o subir la píldora a texto grande. |
| A11Y-3 | **crítico** | Familia badge de error: RESCANEO (ResumenView, badgeEstado) + equivalentes del panel dev | `text-[#ef4444]` sobre su tinte `/15` — **4.19** sobre tarjeta `#10161f` (PanelDev), **4.40** sobre `#0b1117` (VistaErrores); ResumenView real ≈4.19 sobre tarjeta (el script lo mide 4.54 sobre raíz porque el helper `badgeEstado` se define fuera del contexto de la tarjeta — documentado) | Texto de estado con borde fino del mismo tono. Subir el texto a `red-400` (≈5.7 sobre el tinte) manteniendo el borde `ef4444/40`. Al remediar, sacar las 2 claves de `PERDONADOS`. |
| A11Y-4 | **medio** | primitives — `PrimaryBtn` variante crit: el ICONO usa `toneText.crit` (`#E52222`) sobre el MISMO fondo `#E52222` del botón | icono **1:1** (invisible); el label blanco 4.58 sí pasa | El botón sigue siendo operativo (label legible). Remedio: icono blanco (como el label) en la rama crit de `toneText`. |
| A11Y-5 | **medio** | TopBar — nube de transmisión (offline/rechazada y online) | icono `red-500` sobre `red-500/20` **4.31** e icono `brand-green` sobre `brand-greendark` **3.83** | SOLO icono (umbral 1.4.11 de 3:1 → **pasan**), pero sin margen y sin texto de refuerzo (tiene `aria-label`+`title`). Si se toca: aclarar a `red-400`/`emerald-300`. |
| A11Y-6 | **bajo** | Solo modo desarrollador: PanelDev y SeccionRastreo | `text-slate-500` sobre `slate-800/60` **3.52** y sobre `#0b1117` **3.98** | Fuera de la UI de campo (el panel dev no lo usa un jurado). Remedio junto con la próxima limpieza del panel dev. |
| A11Y-7 | **bajo** (exento) | PanelClasificación — campos de clasificación deshabilitados | `text-gray-500` sobre `brand-surface/50` **3.88** | WCAG 1.4.3 EXIME los controles deshabilitados (`cursor-not-allowed`). Remedio solo si el campo vuelve a ser editable. |
| A11Y-8 | **bajo** (decorativo) | AnalyzingView — pista del anillo de progreso | `text-slate-800/80` sobre raíz **1.24** (svg `aria-hidden`) | La sutileza de la pista es INTENCIONAL (el dato viaja en el anillo verde, 7.91, y en el texto). Sin remedio; exento como decorativo. |
| A11Y-9 | **artefacto** del modelo | primitives (`styles` de PrimaryBtn) y ActasView (objetos de datos con `dot:`) | 4 claves con ratio 1.0–1.81 que **no son pares reales**: el fondo vive en OTRA línea (icono ok sobre verde = 7.68 OK) o el peor fondo de la línea es el dot decorativo de otro elemento (chips reales sobre tintes /10–/20 = 5.85–6.8 OK) | Sin remedio. Están perdonados para que el WARN del gate no sorprenda; si el modelo se refinara (parse JSX real), se limpian. |

### 9.2 Navegación por teclado (source-scan)

Cobertura REAL por vista (rg de `Escape`/`onKeyDown`/`focus-visible` en
`src/components/e14/`):

| Vista/componente | Escape | Enter/Space | focus-visible | Veredicto |
|---|---|---|---|---|
| ReviewView | ✓ (cierra visor fullscreen, listener con captura) | ✓ (tarjeta ENVIADA `role=button` con `tabIndex` + Enter/Espacio + `preventDefault`) | ✓ (ring-2 en las 2 tarjetas táctiles) | **completo** |
| QuadEditor (recorte) | ✓ (cancela; bloqueado mientras aplica) + trap de Tab vía `useDialogFocus` | ✓ (asas operables con flechas, +Shift ×10) | ✓ (×2) | **completo** (diálogo `role=dialog`) |
| AyudaOverlay | ✓ (hook + listener global) | — (botones nativos) | ✓ | **completo** (`useDialogFocus`: foco inicial, Tab cíclico, retorno de foco) |
| ScanView | n/a — el menú de modos es UI siempre-visible desde B3 (el efecto Escape del menú §6.3 se eliminó; no hay diálogo) | botones nativos | **✗ — 3 botones de la fila de disparo con `focus:outline-none`**: IMPORTAR y LINTERNA sin NINGÚN indicador de reemplazo (foco invisible), obturador solo cambia borde blanco→verde | **A11Y-10 (medio)**: añadir `focus-visible:ring-2` (patrón ya usado en ReviewView/AyudaOverlay/dev) |
| AnalyzingView | n/a (sin diálogo) | botón nativo | ✓ (cancelar/contingencia) | aceptable |
| ResumenView / ActasView / BottomNav / primitives | — | botones nativos | sin anillo explícito PERO **sin `outline-none`** → outline nativo del navegador visible | aceptable (nota: unificar a `focus-visible` si se toca) |
| GaleriaSimulación (SIM) / PanelClasificación / búsqueda de ActasView | — | nativos | `focus:outline-none` + solo cambio de borde (débil; la búsqueda añade `ring-1` en `:focus`) | **A11Y-11 (bajo)**: indicador solo-borde, sin distinción `focus-visible` |
| dev/* (PanelDev, VistaErrores, TuercaResumen, SeccionRastreo) | ✓ (PanelDev) | nativos | ✓ (20 anillos) | **completo** |

### 9.3 Táctiles (ya cubierto)

Los targets táctiles de 44 px y los grises ≤12 px YA están bloqueados por
`scripts/qa-aa-invariantes.ts` desde R-31 (check 1: 0 co-ocurrencias
gris-500/600 + texto ≤12 px en `src/components/**`; check 3: `min-h-[44px]`
en el botón REINICIAR JORNADA de ResumenView; check 2: el rojo crit
`#E52222` solo en `primitives.tsx`, blanco-sobre-rojo 4.58 AA). Este pass
de R-38 no añade nada ahí — cita y remite.

## 10. Relajación de ESLint (R-43) — estado real y plan de reapertura

La relajación de ESLint con scope que vive en `eslint.config.mjs` (heredada
del plan de remediación 7.7, paso C1) es transparente pero HASTA HOY no
estaba registrada aquí. Estado REAL verificado el 2026-11-16:

### 10.1 Reglas relajadas — qué, scope, severidad

| Regla | Scope | Severidad | Justificación histórica |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | global | **warn** | 7.7/C1: al reactivarla había **0 `any` explícitos en producción** («barato de mantener; tria los avisos que salgan antes de subir a error»). |
| `@typescript-eslint/no-explicit-any` | `src/lib/e14/politica/**` | **error** | La capa `politica/` (extraída en 7.1–7.2) NACE limpia y se defiende desde el día uno. |
| `react-hooks/exhaustive-deps` | global | **warn** | 7.7: el bloque por-archivo OFF de **ScanView** (el módulo más grande, 1.239 líneas) se ELIMINÓ — las directivas justificadas quedaron línea a línea y los avisos nuevos «se trian con plan de limpieza, no se silencian a ciegas». Hoy: 12 avisos, todos DELIBERADOS y anotados uno a uno en `docs/QA-TRIAGE-lint.md` (#5–#16: refs estables leídas por `.current` en los hooks de cámara y el side-channel de flags del PanelDev). |
| `react-hooks/purity` · `react-hooks/refs` · `react-hooks/set-state-in-effect` | global | **off** | Reglas nuevas de `eslint-plugin-react-hooks` 7.1.x del lockfile raíz; mismo criterio que se aplicó en `scanner-lab`. |
| `@typescript-eslint/no-unused-vars` | global | warn (`argsIgnorePattern: "^_"`) | Los 5 avisos actuales (bridge ×3, `sincronia-pestanas`, test de caracterización) son posteriores al triage de 2026-11-12 — falta triar. |
| Resto de OFF/warn cosmético (`no-non-null-assertion`, `ban-ts-comment`, `prefer-as-const`, `no-console`, `prefer-const` warn, `no-img-element`, `react/prop-types`, etc.) | global | off/warn | Histórico del andamiaje Next; sin avisos activos hoy salvo los citados. |

### 10.2 Estado actual (verificado 2026-11-16)

- `rg ': any' / 'as any' / any[]` en `src/` (tests incluidos): **0 matches**
  — 0 avisos de `no-explicit-any` en el lint.
- `bun run lint`: **0 errores / 19 avisos** = 12 `exhaustive-deps`
  deliberados (QA-TRIAGE-lint #5–#16) + 5 `no-unused-vars` sin triar
  (posteriores al cierre) + 2 de artefactos generados en `coverage/` (no se
  versionan; eslint no respeta .gitignore).

### 10.3 Plan de reapertura gradual (directorio por directorio)

Principio: subir a `error` **empezando por los directorios con 0 avisos
hoy**, un bloque por PR, sacando el `warn` global solo al final.

1. **Fase 0 (ya hecha)**: `src/lib/e14/politica/**` en `error`.
2. **Fase 1 — 0 avisos hoy**: `src/app/**`, `src/components/e14/screens/**`,
   `src/components/e14/{TopBar,BottomNav,SideNav,AyudaOverlay,QuadEditor,PanelClasificacion,GaleriaSimulacion,primitives,icons}.tsx`,
   `src/lib/e14/{puente,obs,store,adaptacion,rastreo}/**` → subir
   `no-explicit-any` a `error` por bloque `files:` (riesgo cero: 0 avisos).
3. **Fase 2 — limpiar los 5 `no-unused-vars`** (`bridge/ocr.ts`,
   `bridge/pipeline-recorte.ts`, `bridge/protocolo.ts`,
   `sincronia-pestanas.ts`, test de caracterización) y subir
   `src/lib/e14/bridge/**` + `src/lib/e14/sincronia-pestanas.ts`.
4. **Fase 3 — los 12 `exhaustive-deps` deliberados**: o se resuelven
   (refs estables → `useCallback` con deps reales, o refactor del effect
   orquestador de `useSesionCamara` — NO trivial, es el corazón del loop de
   cámara) o se convierten en `eslint-disable` línea a línea con su razón;
   luego subir `react-hooks/exhaustive-deps` a `error` en
   `src/components/e14/hooks/**` y `src/components/e14/dev/**`.
5. **Fase final**: quitar los `warn` globales de ambas reglas y dejar
   `error` en todo el repo (más `react-hooks/purity`/`refs`/
   `set-state-in-effect` cuando el plugin 7.1.x estabilice su triage).

Condición de reapertura de cada fase: `bun run lint` y `check-quality.sh`
verdes tras el cambio (el gate ya corre `eslint .`).
