# Kit de bienvenida — e14-suite

Bienvenido. Este documento te tiene programando en menos de 15 minutos.

## Requisitos

- [bun](https://bun.sh) >= 1.1 (runtime, gestor de dependencias y runner de tests del panel)
- Node >= 20 (para tooling de Next cuando aplique)

## Primer run

```bash
git clone <este repo> && cd e14-suite
cp .env.example .env          # claves vacías para dev local; nunca se commitean
bun install                   # workspaces: apps/* + packages/*
bun run dev:movil             # o dev:panel
```

## Mapa mental (30 segundos)

- **packages/scanner-core** es el motor: detección del acta (quad), recortes,
  OCR/QR en WASM, gate de calidad. Se edita SOLO aquí.
- **apps/digielect14** es la PWA de captura (celular → acta → cola firmada).
- **apps/supervision-e14** es el panel: ve en vivo lo que llega y permite
  digitalización masiva (lote de imágenes).

## Antes de abrir un PR

```bash
bun run verificar:movil       # o verificar:panel, según lo que tocaste
bun run test:motor            # si tocaste packages/scanner-core
```

## Reglas de la casa

1. **Commits convencionales en español** (`feat(motor): …`, `fix(supervision): …`).
2. **Toda decisión con "por qué" se registra como D** en `docs/adr/` — un ADR de
   media página: contexto · decisión · consecuencia.
3. **El motor vive UNA vez**: nunca copies `scanner-core` dentro de una app.
4. **Privacidad absoluta**: ningún archivo con fotos reales de actas ni datos de
   jurados entra al repo, ni en tests, ni "temporalmente". Las demos sintéticas
   del modo SIM son el único material de prueba permitido.
5. Modelos pesados: vía `assets.lock.json` (URL + SHA-256), nunca al git.
