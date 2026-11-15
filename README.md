# e14-suite

Monorepo del ecosistema E-14: **digitalización de actas de escrutinio, 100 % client-side**.

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

## Por qué 100 % client-side (privacidad electoral)

Las fotos de actas y los datos de jurados **jamás tocan un servidor de procesado**:
la cascada OCR/QR corre en el navegador (WASM), la publicación es en memoria de
sesión y la cola de sincronización firma cada envío. Los límites conocidos están
declarados y son honestos — ver los README de cada app.

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
