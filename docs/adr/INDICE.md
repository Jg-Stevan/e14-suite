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
| D-amenaza-firma | **La firma HMAC del puente protege integridad del sobre + origen del dispositivo, NO confidencialidad** — la clave en `localStorage` queda aceptada con la frontera XSS declarada | VIGENTE | Cierra R-40 (hueco compartido §6.5, auditoría 2026-11-16). `docs/adr/2026-11-16-modelo-amenaza-clave-firma.md`: atacantes A1–A3 (red→bloqueado por TLS+HMAC, LAN→bloqueado por firma, XSS en el navegador del operador→residual aceptado por dispositivo/jornada), por qué NO WebCrypto no-extraíble (el XSS firma por proxy) y el cross-ref al anti-replay R-32 / cierre de D-puente. |

## Decisiones heredadas pendientes de cerrar

| # | Título | Estado | Pendiente |
|---|---|---|---|
| D-onnx | Bump onnxruntime-web 1.30.0 → 1.31.1 (dependabot) | ABIERTA | Re-medir OCR en gama baja con el bench existente y registrar, o revertir al pin 1.30.0. Violación conocida de la regla de pines exactos. |
| D-puente | Fuente del worker `e14-puente` versionada | PARCIAL (R-32) | CONTRATO FORMAL publicado (`docs/adr/2026-11-16-contrato-hub-e14-puente.md`: sobre, firma HMAC, anti-replay declarado, lecturas Bearer, lo no-auditable declarado y requisito de SHA de despliegue). La FUENTE sigue fuera — traerla a `packages/e14-puente/` cierra el ciclo. |

## Huecos conocidos de la historia de decisiones (consolidación)

- **Faltan** (registro de supervision-e14): D32, D66–D71, D73 y D74 — declarado
  en la auditoría; reconstruir de commits/kits. **D65 y D72 quedaron
  reconstruidas el 2026-11-16** (R-07, auditoría) desde las citas del código:
  D65 era la 15ª decisión más citada (68 refs, incluida el «umbral D65» de
  Hamming ≤ 6 que cita el puente del móvil) y no tenía fila.
- **Guard permanente**: `apps/supervision-e14/src/shared/docs/__tests__/adr-resolver.test.ts`
  (suite del panel) exige que toda `D<n>` citada en `src/` de las dos apps y del
  paquete resuelva en alguno de los dos registros del monorepo
  (`docs/adr/README.md` de supervision o `docs/DECISIONS.md` de digielect14).
- **Tope real**: D98 (dig) / D99 (worker puente). El índice consolidado debe
  llegar a D1–D99 con estado por decisión.
