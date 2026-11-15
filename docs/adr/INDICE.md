# Índice de decisiones (ADR) — e14-suite

> Estado: ÍNDICE SEMILLA creado en el commit de docs. La consolidación completa
> de D1–D99 (desde `DECISIONS.md` de digielect14 y `docs/adr/` de supervision-e14)
> está EN CURSO — ver Fase E del plan y `PENDIENTES-TOKEN.md`.

## Formato

Cada decisión vive en `docs/adr/NNN-titulo.md` con ~media página:

- **Contexto** — qué problema había
- **Decisión** — qué se decidió
- **Consecuencia** — qué implica (incl. qué se pierde)

Estado de cada ADR: **VIGENTE** · **SUPERADA** (por cuál) · **OBSOLETA**.

## Decisiones nuevas del monorepo (registrar YA)

| # | Título | Estado | Nota |
|---|---|---|---|
| D-monorepo | **El motor vive UNA vez** — scanner-core único en `packages/`, apps por subpath `workspace:*` | VIGENTE | La decisión estructural más importante: mata la paridad procedural (qa-paridad-motor.ts y commits espejo se retiran). |
| D-sim-color | `sim-color.jpg` reemplazada por demo sintética (mismo nombre de archivo) | VIGENTE | Era byte-idéntica al acta real eliminada por D86 (blob `18fb8543` / md5 `08cd5f9d…`). Ver plan §3.1 y R3. |
| D-e1-retiro | Telemetría E1 `msCrops` retirada | VIGENTE | Ningún productor la llenaba (siempre 0). Documentada como roadmap post-aprobación. |
| D-e3-diferido | Atlas de tensores OCR (E3) diferido a post-aprobación | VIGENTE | Flag `ocrTensorAtlas` apagada por defecto; no se arriesga la fecha de presentación. |

## Decisiones heredadas pendientes de cerrar

| # | Título | Estado | Pendiente |
|---|---|---|---|
| D-onnx | Bump onnxruntime-web 1.30.0 → 1.31.1 (dependabot) | ABIERTA | Re-medir OCR en gama baja con el bench existente y registrar, o revertir al pin 1.30.0. Violación conocida de la regla de pines exactos. |
| D-puente | Fuente del worker `e14-puente` versionada | ABIERTA (D99) | Hoy no está en ningún repo — versionarla en el monorepo o repo de infra. |

## Huecos conocidos de la historia de decisiones (consolidación)

- **Faltan**: D32 y D65–D74 (declarado en la auditoría; reconstruir de commits/kits).
- **Tope real**: D98 (dig) / D99 (worker puente). El índice consolidado debe
  llegar a D1–D99 con estado por decisión.
