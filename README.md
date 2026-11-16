# e14-suite

Monorepo del ecosistema E-14: **digitalización de actas de escrutinio, procesado 100 % local**.

## Demos en vivo (Cloudflare Pages)

| App | URL |
| --- | --- |
| digielect14 — PWA móvil, captura e importación de actas | https://digielect14.pages.dev/ |
| supervision-e14 — panel de supervisión y carga masiva | https://supervision-e14.pages.dev/#dia=DOMINGO&vista=carga-masiva |

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
bun install                          # desde la raíz (workspaces bun)

bun run dev:movil                    # PWA móvil
bun run dev:panel                    # panel de supervisión
bun run test:motor                   # suite del motor (~154 casos)
bun run verificar:movil              # preparar + typecheck + lint + tests (móvil)
bun run verificar:panel              # verificar del panel
```

Los modelos OCR/QR no se versionan: se descargan por `assets.lock.json`
(URL + SHA-256, ~35–115 MB según app).

## Pipeline (resumen)

```
cámara → detección/quad → recortes → OCR (Tesseract/RapidOCR en WASM)
      → gate de calidad → cola firmada → hub → panel en vivo / ingesta masiva
```

## Métricas de la suite

~130.000 LOC TypeScript · ~1.000 pruebas · 949 puestos / 67 países / 3.670 mesas ·
0 hallazgos de escaneo de secretos · CI de mínimo privilegio por app + motor.

## Reglas del monorepo

1. El motor se edita SOLO en `packages/scanner-core`; las apps lo consumen por subpath.
2. Cada app conserva su `next.config`, `public/`, tests y pipeline de deploy propios
   (Cloudflare opennextjs la móvil; export estático + Pages Function el panel).
3. Commits convencionales en español; toda decisión de arquitectura se registra
   como D (ver `docs/adr/INDICE.md`).
4. Nada de fotos reales de actas entra al repositorio, jamás (DEC-1/DEC-3).

## Documentación

- `CONTRIBUTING.md` — kit de bienvenida para el equipo.
- `docs/glosario-e14.md` — acta, DIVIPOLA, idEnlace, puesto, mesa, gate…
- `docs/adr/INDICE.md` — índice de decisiones (consolidación D1–D99 en curso).
