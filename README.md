# e14-suite

Monorepo del ecosistema E-14: **digitalización de actas de escrutinio, procesado 100 % local**.

## Demos en vivo (Cloudflare Pages)

| App | URL canónico | Se despliega con |
| --- | --- | --- |
| digielect14 — PWA móvil, captura e importación de actas | https://digielect14.pages.dev/ | push a `main` · `deploy-movil-pages.yml` |
| supervision-e14 — panel de supervisión y carga masiva | https://supervision-e14.pages.dev/ | push a `main` · `deploy-panel.yml` |

Ruta de ejemplo del panel (carga masiva): https://supervision-e14.pages.dev/#dia=DOMINGO&vista=carga-masiva

Ambos deploys corren automáticamente en cada push a `main` (y en tags `v*`) y
quedaron verdes el 2026-11-16 sobre el commit de la remediación. Destinos
equivalentes (mismo código, otros canales):

- Worker móvil (deploy manual): https://digielect14e.julistevan02.workers.dev/
- Hub de producción `e14-puente` (fuente fuera de este monorepo; salud): https://e14-puente.julistevan02.workers.dev/salud

## Qué hay aquí

```
e14-suite/
├─ apps/
│  ├─ digielect14/        PWA móvil — captura del acta, cascada OCR, gate de calidad,
│  │                      cola offline-first firmada hacia el hub
│  └─ supervision-e14/    Panel en vivo + digitalización masiva — ingesta, dedup
│                         perceptual, gate y monitor DIVIPOLA
└─ packages/
   └─ scanner-core/      El motor de escaneo — UNA sola copia, consumida por ambas
                         apps vía @jg-stevan/scanner-core/* (workspace:*)
```

## Por qué procesado 100 % local (privacidad electoral)

El **procesado** es 100 % local: la cascada OCR/QR corre íntegramente en el
navegador (WASM) y las fotos de actas y los datos de jurados **jamás tocan
un servidor de procesado**. La foto ya procesada **sí viaja firmada (HMAC)
al hub de producción** — el único destino externo del CSP — para que el
panel de supervisión la reciba. Los límites conocidos están declarados y
son honestos — ver los README de cada app.

### Qué sale del dispositivo y qué se queda

| Dato | ¿Sale del dispositivo? | Protección |
| --- | --- | --- |
| Foto procesada de la página del acta (`srcFoto`) | Sí — al hub de producción (`e14-puente`, Cloudflare Worker) | Firmada HMAC-SHA256 con re-firma en reintento y falla-cerrado sin clave de jornada; huellas SHA-256/dhash64/QR adjuntas |
| Cifras, votos o interpretación del acta | No — la app no lee votos: solo cabecera e identificación | — |
| Fotos SIN procesar (originales de cámara) | No — se descartan tras el pipeline | Solo en memoria/IDB local durante el procesado |
| Claves de firma y de jornada | No — viven en localStorage del operador, jamás en el bundle | Falla-cerrado: sin clave no se envía nada |
| OCR/QR (píxeles → texto) | No — corre íntegramente en el navegador (WASM) | Sin telemetría ni terceros (CSP deny-by-default) |

> La fuente del hub vive fuera de este monorepo (paquete `e14-puente/`);
> su contrato formal y el registro de su exclusión están en
> `docs/adr/2026-11-16-contrato-hub-e14-puente.md`.

## Cómo correr

```bash
bun install                          # desde la raíz (workspaces bun; bun 1.4.2 fijado)

bun run dev:movil                    # PWA móvil
bun run dev:panel                    # panel de supervisión
bun run test:motor                   # suite del motor (209 casos)
bun run verificar:movil              # preparar + typecheck + lint + tests (móvil)
bun run verificar:panel              # verificar del panel
```

Los modelos OCR/QR no se versionan: se descargan por `assets.lock.json`
(URL + SHA-256, ~35–115 MB según app).

### Regenerar las métricas de portada (que no vuelvan a vencer)

| Métrica | Comando |
| --- | --- |
| Pruebas por suite | `bun test packages/scanner-core` · `cd apps/supervision-e14 && bun test` · `cd apps/digielect14 && bun run test` |
| LOC TypeScript (sin vendor/assets) | `find apps packages \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/public/*' -not -path '*/vendor/*' -print0 \| xargs -0 wc -l` |
| DIVIPOLA (puestos/países/mesas) | congelada por test (`init-datos.test.ts` del panel) |

## Pipeline (resumen)

```
cámara → detección/quad → recortes → OCR (Tesseract/RapidOCR en WASM)
      → gate de calidad → cola firmada → hub → panel en vivo / ingesta masiva
```

## Métricas de la suite

109.706 LOC TypeScript en 408 archivos (sin vendor/assets · medido 2026-11-16) ·
1.187 pruebas (motor 216 · panel 482 · móvil 489 · medido 2026-11-19, tras la
remediación R-45…R-62 — ver `docs/remediacion/VERIFICACION-FINAL-RE-EJECUTADA.md`
y el informe de ejecución v3 de la entrega) · 949 puestos / 67 países /
3.670 mesas · 0 hallazgos de
escaneo de secretos · CI de mínimo privilegio por app + motor + seguridad
(gitleaks + bun audit). Cada cifra se regenera con el comando de la sección
«Cómo correr» — nada de esta portada es irreproducible.

## Plan de remediación (2026-11-16)

Las 3 auditorías del ecosistema consolidaron **50 hallazgos → 43 tareas
accionables + 2 menores absorbidas (H-44/H-45 en R-44)** en 5 sprints, y el
plan completo se ejecutó: el plan corregido (D-1…D-6) con el estado por tarea
está en `docs/remediacion/PLAN-REMEDIACION-v2.md` y el informe de ejecución
con métricas antes→después en `docs/remediacion/INFORME-REMEDIACION.md`.
Los sprints cubren: estabilización (bug de aliasing, contratos md5,
toolchain, CVEs), gobernanza documental y CI, observabilidad de errores
(0 catches sin rastro, guard permanente), refactor estructural (runner 2.887→1.164,
store en slices, bridge particionado, forks DRY absorbidos) y cierre de
huecos (build real en CI, E2E de humo, cobertura medida, DIVIPOLA cruzado
contra la fuente oficial, ADRs de seguridad).

## Reglas del monorepo

1. El motor se edita SOLO en `packages/scanner-core`; las apps lo consumen por subpath.
2. Cada app conserva su `next.config`, `public/`, tests y pipeline de deploy propios
   (Cloudflare opennextjs la móvil; export estático + Pages Function el panel).
3. Commits convencionales en español; toda decisión de arquitectura se registra
   como D (ver `docs/adr/INDICE.md`).
4. Nada de fotos reales de actas entra al repositorio, jamás (DEC-1/DEC-3).

## Documentación

- `CONTRIBUTING.md` — kit de bienvenida para el equipo.
- `docs/README.md` — índice de docs y ciclo de vida (VIVOS vs CONGELADOS).
- `docs/PENDIENTES-TOKEN.md` — secretos pendientes de configurar en CI/despliegues.
- `docs/glosario-e14.md` — acta, DIVIPOLA, idEnlace, puesto, mesa, gate…
- `docs/adr/INDICE.md` — índice de decisiones (consolidación D1–D100 en curso).
