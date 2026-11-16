# ADR — Política de manejo de errores y catches (R-20)

> **Estado:** VIGENTE · **Fecha:** 2026-11-16 · **Fuente:** auditoría 2026-11-16
> (hallazgo mayor: 520/739 catches silenciosos, 153+ sin rastro alguno) ·
> **Cierra:** H-21 y el hallazgo mayor de la auditoría A.

## Contexto

La REGLA DE ORO del producto (§2.4: «el fallo jamás tumba la app en jornada
electoral») produjo una cultura de `catch` defensivo masivo: ~660 catches en
código de producción (no-test). La regla es defendible — en una mesa de
votación un crash cuesta actas — pero su aplicación sin disciplina dejó
**258 puntos de error que desaparecen sin dejar rastro** (sin comentario del
porqué y sin log): un fallo en jornada se vuelve undiagnosticable.

## Decisión — el árbol de decisión de cada `catch`

Todo `catch` de producción debe dejar rastro por exactamente UNA de estas
cuatro vías, elegida en orden:

1. **COMENTARIO del por qué** (mínimo, siempre suficiente para degradaciones
   deliberadas): el cuerpo del catch lleva un comentario que explica POR QUÉ
   tragar es correcto AQUÍ (p. ej. `/* cosmético: el fallo jamás rompe al llamador */`).
   Regla: explica el porqué, no el qué.
2. **`logger.debug(...)`** (diagnóstico en desarrollo, costo cero en
   producción — el bundle de producción lo elimina por sustitución estática de
   NODE_ENV): para fallos recuperables cuyo contexto ayuda a diagnosticar
   (valores de entrada, qué se degradó). Se usa el logger central del
   monorepo (`packages/scanner-core/src/dominio/logger.ts`); JAMÁS `console.*`
   directo (la única excepción histórica anclada es la traza watchdog de
   relectura del runner del panel, que QA grepea literal).
3. **`logger.warn(...)`** — degradaciones que el operador debe poder ver en
   devtools y que viajan al buffer obs (IndexedDB): la app sigue, pero algo
   real se perdió (p. ej. telemetría que no se pudo enviar, caché que no
   pudo escribirse).
4. **Elevar a UI** — cuando el fallo cambia lo que el usuario puede hacer:
   la REGLA DE ORO no manda callar, manda no caer: el error se convierte en
   estado visible (toast, fila ERROR, chip de degradación) por la vía del
   flujo, nunca con `throw` desde el catch hacia arriba en plena jornada.

**Prohibido a partir de este ADR:** un catch cuyo cuerpo no tenga NI
comentario NI llamada a `logger.*`/`console.*`. El guard
`packages/scanner-core/tests/catches-guard.test.ts` congela esta regla en
CI (corre en el `test:paquete` de ambas apps) con una lista blanca
explícita y justificada para excepciones verdaderas.

## Qué NO cambia

- La REGLA DE ORO sigue mandando: nada de este ADR autoriza a dejar que un
  error tumba la app, ni convierte los catches en `throw`.
- Los 367+ catches que ya documentaban su porqué (70 % según la auditoría B)
  siguen como están: su comentario ES el rastro.
- El logger sigue siendo el único punto de consola (warn/error transportan
  al buffer obs con anti-recursión).

## Consecuencias

- **Ganamos:** diagnóstico en jornada — los 258 puntos ciegos ahora dejan
  rastro (comentario o traza de desarrollo); el guard impide que vuelva a
  crecer la deuda.
- **Costo:** ~260 ediciones puntuales de comentario/traza (pagadas en la
  campaña R-20); leve aumento de LOC de comentarios.
- **Riesgo residual:** un comentario puede mentir (decir «es cosmético» cuando
  no lo es). La revisión de PR y el guard de anclas existentes mitigan; la
  alternativa (exigir logger.debug en todos) infla el ruido y se ignora.
