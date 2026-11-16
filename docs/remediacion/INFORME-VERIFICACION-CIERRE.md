# INFORME DE VERIFICACIÓN DEL CIERRE — plan de remediación e14-suite

> **Pregunta que responde:** ¿el plan se ejecutó correctamente y completo? ¿Está incompleto? ¿Falta algo? ¿Todo funciona?
> **Método:** verificación INDEPENDIENTE en dos niveles — (1) estructural, tarea por tarea contra las 45 tarjetas del plan v2 (correcciones D-1…D-6 + gitleaks + SHA incluidas), con evidencia `archivo:línea`; (2) dinámica, re-ejecutando instalación, suites, typechecks, lint, audit, build real y gates en un clon fresco con bun 1.4.2.
> **Base verificada:** `https://github.com/Jg-Stevan/e14-suite` @ `f3d47f9` + rama `remediacion/plan-2026-11` (41 commits) + 3 commits de cierre (44 total).
> **Fecha:** 2026-11-16.

---

## VEREDICTO

| Pregunta | Respuesta |
|---|---|
| ¿El plan se ejecutó correctamente? | **Sí — 44 de 45 tareas verificadas OK con evidencia exacta.** Las métricas declaradas (runner 2.887→1.164, store 2.079→72+12 slices, bridge 2.665→44+7 módulos, licencias MIT ×4 byte-idénticas, actions 100 % por SHA) se confirmaron al dígito. |
| ¿Está incompleto? | **Estaba incompleto en 3 puntos; los 3 quedan cerrados en esta verificación** (commit por commit, ver §2): (a) el claim D-1 de portada no existía; (b) el sabotaje controlado de R-39 no estaba ejercitado por ninguna suite; (c) el guard de catches dejaba fuera los handlers de promesa. |
| ¿Falta algo? | **Quedan 4 observaciones menores documentadas** (§4) — ninguna bloquea el DoD del plan: a11y sin gate automático en el panel (decisión documentada), sin test Python del sidecar, similitud 4,4 % no recomputable sin el fork original, `bun-types@^1.3.0` desalineado (cosmético). |
| ¿Todo funciona? | **Sí — verificado dinámicamente**: motor **209/209** · panel **462/462** · móvil **452/452** · **1.123/1.123 pruebas, 0 fallos** · typecheck 0 errores en ambas apps · lint 0 errores en ambas · **bun audit 0 vulnerabilidades** · **build real de ambas apps exit 0** · golden coherente · grafo sin violaciones DIP/ciclos. |

---

## 1. Verificación estructural — las 45 tareas del plan v2

Verificación con evidencia `archivo:línea` contra el árbol real. Las rutas difieren del plan original porque el monorepo consolidó (`src/modules/…` en el panel; el contenido es el mismo).

### Sprint 0 — Estabilización (10/10 OK)

| Tarea | Veredicto | Evidencia clave |
|---|---|---|
| R-01 clonar acta (aliasing) | ✅ | `mock-repository.ts:824` `return clonarActa(acta)` en la frontera; `clonarActa` clona impresion/formularios/fotos (`actas-mock.ts:283-303`); test NUEVO con runtime publicado (`clonado-profundo.test.ts:120-170`); `beforeEach` con runtime propio (`:64-68`) |
| R-02 contratos md5 + D-3 | ✅ | guard con `toStrictEqual` ×4 (`contrato-md5.test.ts:48-66`); hashes md5 recalculados = idénticos al JSON; `gen-contrato-motor.ts:40-43` escribe a `packages/scanner-core/tests/fixtures/` (ruta viva, no la muerta pre-monorepo) |
| R-03 toolchain bun | ✅ | engines + packageManager 1.4.2 (raíz); 10 workflows con `bun-version: "1.4.2"`; AGENTS ×2; `bun install` limpio verificado (sin UnknownLockfileVersion) |
| R-04 CVEs + gitleaks (Añadido 1) | ✅ | `dependabot.yml` (bun+actions weekly); `ci-seguridad.yml` con gitleaks + bun audit + guard anti-tag; overrides glob/minimatch; `bun audit` re-ejecutado: **0 vulnerabilidades (966 paquetes)** |
| R-05 lema honesto | ✅ | README «procesado 100 % local» + foto firmada al hub + tabla de privacidad (5 filas) + guard `lema-privacidad.test.ts` |
| R-06 métricas | ✅ | 109.706 LOC · pruebas con fecha de medición · 949/67/3.670 — sin rastro de «~130.000» ni «~154» |
| R-07 D65/D72 | ✅ | Reconstruidas en `docs/adr/README.md:89-90` (supervision); guard `adr-resolver.test.ts` exige que toda D citada resuelva |
| R-08 pins sidecar | ✅ | `requirements.txt` con `==` exactos (onnxruntime 1.31.1, opencv 5.0.0, numpy 2.5.4, pillow 12.3.0), cero `>=` |
| R-09 auth hub-local | ✅ | `TOKEN_LECTURA` por sesión (Bearer o `?token=`) en /actas, /foto, /hub/estado; 401 accionable que no revela el token |
| R-10 micro-limpieza 1 | ✅ | tipo nullable + guard (sin cast mentiroso); 0 `console.*` en cola.ts; DESCRIPTORES (typo eliminado) |

### Sprint 1 — Gobernanza + D-1/D-4 (12/12 OK tras cierre)

| Tarea | Veredicto | Evidencia clave |
|---|---|---|
| R-11 AGENTS.md | ✅ | Rutas muertas eliminadas; «el harness qa-paridad-motor pre-monorepo se RETIRÓ»; golden citado en su ruta viva |
| R-12 migrar gates | ✅ | apps/*/.github purgados (0 anidados); 12 workflows raíz; 7 citas vivas actualizadas; ci-programados NUEVO (COOP/COEP + frescura) |
| R-13 actions por SHA | ✅ | 35 refs `uses:` = 100 % SHA de 40 hex con comentario de versión; guard que falla si queda un `@vN` |
| R-35 build real (D-4) | ✅ | `ci-build.yml` matrix de ambas apps + reporte de bundle como artefacto; **build re-ejecutado en esta verificación: exit 0 ×2** |
| R-14 licencias | ✅ | md5 idéntico `452ed265…` en las 4 LICENSE (MIT byte-idénticas) |
| R-15 consolidación | ✅ | `docs/archivo/registro-consolidacion.md` con SHAs previos (0386fa1, 4409249…) y la pérdida conocida 1e23174 |
| R-44 micro-limpieza 2 (D-1) | ✅ (c) | (a) H-44: token efímero en /ocr y /acta del sidecar (`compare_digest`, `x-sidecar-token`, cliente + tests 5 nuevos); (b) H-45: `docs/archivo/` con 16 docs fechados + índice + 35 citas corregidas; (c) claim de portada — **faltaba, añadido en el cierre** (ver §2) |
| R-16 golden | ✅ | `toStrictEqual` en clasificación y escalera; regeneración de un paso; **residuos corregidos en el cierre** (cabecera pre-monorepo + toEqual en derivadosDe) |
| R-17 citas huérfanas | ✅ | REPORTE-e75 corregido; guard del SW a `/descargas/`; **residuo corregido en el cierre** (QA-TRIAGE desactualizado tras aterrizar R-36 + cita huérfana a qa-paridad-motor) |
| R-18 onnxruntime | ✅ | 1.31.1 en ambas apps; cascada OCR en verde |
| R-19 opennextjs devDeps | ✅ | En devDependencies |
| R-37 cobertura (D-4) | ✅ | Umbrales en vitest.config (ratchet 17→19, medido 19,86 %); coverage en CI con artefactos |

### Sprint 2 — Observabilidad (4/4 OK tras cierre)

| Tarea | Veredicto | Evidencia clave |
|---|---|---|
| R-20 campaña catches (L por D-6) | ✅ | ADR con árbol de 5 vías; **0/660 try/catch desnudos** (re-contado con parser independiente); guard permanente en 3 workflows; **brecha de promesa cerrada en el cierre** (ver §2) |
| R-21 CSP duplicado | ✅ | 1 bloque `/_next/static/*` por `_headers`; guards canónicos espejo en ambas suites |
| R-22 guard capa eslint | ✅ | `no-restricted-imports` en ERROR; import por fachada; verificado que dispara |
| R-23 flaky registrado | ✅ | DEUDA §10 con causa raíz, regla beforeEach y condición de reactivación |

### Sprint 3 — Refactor (11/11 OK, métricas exactas)

| Tarea | Veredicto | Medido |
|---|---|---|
| R-24 absorber fork bridge | ✅ | panel bridge.ts = **77 líneas** (decl. 251→77); CompositeBridge genérico + singleton en el paquete |
| R-25 fusion-lectura | ✅ | 1 archivo (en el paquete); 2 copias borradas; apps importan por subpath |
| R-26 3 fases (D-2) | ✅ | runner.ts = **1.164 líneas** (decl. 2.887→1.164); fases/ ×4; subtareas máx 76 líneas (≤80); caracterización 53 anclas |
| R-27 slices store | ✅ | store.ts = **72 líneas** + **12 slices** (máx 389 <400); consumidores intactos |
| R-28 partición bridge | ✅ | fachada **44 líneas** + **7 módulos** (máx 694 <800); caracterización 41 tests ANTES/DESPUÉS |
| R-29 tests XL | ✅ | modal-revisor **20 tests**; bridge **41 tests** |
| R-30 guard anti-relleno | ✅ | walk .js/.mjs; PRODUCTORES_DEMO enumerados; fixtures congeladas «EXACTAMENTE» |
| R-31 invariantes vs cosméticos | ✅ | qa-aa-invariantes (BLOQUEA) vs qa-aa-cosmeticos (AVISA); vestigio 2-repos purgado; 8 harnesses 1:1 con el gate |
| R-32 contrato hub + SHA (Añadido 2) | ✅ | ADR `2026-11-16-contrato-hub-e14-puente.md` con sobre, HMAC, anti-replay, lo-no-auditable declarado y **requisito de SHA de despliegue** (§l.74-88: deployment ID/SHA en tabla + `GET {hub}/__version`; deploy sin entrada = hallazgo de auditoría) |
| R-33 nombres españoles | ✅ | `hasRealAF`/`setupUpdateBanner` = 0 matches; `tieneRealAF`/`prepararBannerDeActualizacion` existentes |
| R-34 vendor | ✅ | opencv **4.12.0** con sha256 en ambos locks; jsQR 1.4.0 con procedencia byte-exacta; shim 4.5.5 = compatibilidad documentada (no vestigio) |

### Sprint 4 — Huecos compartidos (9/9 tras cierre)

| Tarea | Veredicto | Evidencia clave |
|---|---|---|
| R-36 E2E + D-6 | ✅ | `e2e/humo.spec.ts` 4 tests; estrategia de cámara PRESUPUESTADA en el propio spec (cámara fake = permisos/stream sin OCR; ARCHIVO = pipeline con OCR real; física = validación de campo); ci-e2e nightly; **test re-ejecutable con `bunx playwright test`** |
| R-38 a11y | ✅ | qa-a11y-contraste (152 pares: 136 OK · 16 perdonados · 0 FAIL); hallazgos priorizados en ambos DEUDA; guard corre en ci-movil; **script registrado como `qa:a11y` en el cierre** (solo invocable por ruta) |
| R-39 DIVIPOLA oficial | ✅ (b) | Script 616 líneas; snapshot firmado con SHA-256; «0 diferencias» registrado; **cruce en vivo re-ejecutado en esta verificación: 0 diferencias**; el «sabotaje controlado» declarado por el plan NO existía como test — **añadido en el cierre** (ver §2) |
| R-40 ADR HMAC | ✅ | Modelo de amenaza con atacantes A1-A3, por qué localStorage (el XSS firma por proxy), límites; indexado como D-amenaza-firma |
| R-41 grafo deps | ✅ | `analisis-grafo.mjs` (449 módulos); **re-ejecutado: DIP limpio, 0 ciclos entre árboles** |
| R-42 sidecar reproducible | ✅ | SHA256SUMS.txt + INVENTARIO-BUNDLE.txt en la release; BUILD-REPRODUCIBLE.md con estado honesto (bit-a-bit no perseguido) |
| R-43 ESLint deuda | ✅ | DEUDA §10 con estado por regla y plan de reapertura en 5 fases (matiz honesto: no-explicit-any está en warn global + error en política, lo OFF son purity/refs/set-state) |
| Workflows ×12 | ✅ | Los 12 parsean YAML válido con `on:`/`jobs:`; **`branches: ['main']` verificado semánticamente con parser YAML** en los 9 con push |
| Apéndice D-5 | ✅ (a) | Typecheck POR APP + build real de AMBAS apps (verificado en workflows y re-ejecutado aquí); **los documentos quedaron versionados en `docs/remediacion/`** en el cierre |

---

## 2. Los 3 huecos que la verificación encontró (y el cierre que los salda)

La ejecución previa del plan estaba completa en su estructura pero dejó 3 puntos sin cerrar. Todos quedaron saldados en la rama de cierre (commits `52165b7`, `7314ef4`, `abe5553`):

### (a) D-1: el claim de portada «50 → 43 + 2 menores absorbidas» no existía

- **Hueco:** la recomendación D-1 pedía corregir el claim «50 hallazgos → 43 tareas» a «50 → 43 + 2 menores absorbidas». El claim corregido estaba en el PLAN-REMEDIACION-v2.md pero ese documento **no estaba versionado en el repo** y el README no lo contenía: grep repo-completo = 0 matches.
- **Cierre (`abe5553`):** el README tiene la sección «Plan de remediación (2026-11-16)» con el claim corregido y enlaza `docs/remediacion/PLAN-REMEDIACION-v2.md` e `INFORME-REMEDIACION.md`, ahora versionados en el repo (esto cierra también el matiz del apéndice D-5 «custodia local no versionada»).

### (b) R-39: el «sabotaje controlado» declarado no estaba ejercitado

- **Hueco:** el informe declaraba «drift verificado con sabotaje controlado», pero no existía ningún test que ejercitara `verificarDrift`/`parsearSnapshot` — el detector del gate electoral era código no probado; una regresión lo habría dejado decorativo en silencio.
- **Cierre (`52165b7`):** test `cruzar-divipola-drift.test.ts` (6 casos: snapshot real parsea · catálogo real → SIN DRIFT · catálogo alterado → DRIFT · snapshot alterado → DRIFT · reordenamiento ≠ drift · doc sin fence → null). `main()` corre SOLO como CLI (`import.meta.main`) para que la importación no dispare descargas ni `process.exit`. **Verificado en vivo: 6/6 + el CLI reproduce «0 diferencias» contra la fuente oficial desde este entorno.**

### (c) R-20: el guard de catches no cubría handlers de promesa

- **Hueco:** el guard congelaba try/catch pero NO `.catch(...)`: de 70 handlers de promesa, 49 no dejaban rastro (vía ADR la letra los prohibía; el guard los permitía en silencio).
- **Cierre (`7314ef4`):** el guard parsea ambas formas. Regla: bloque con trabajo exige comentario/log; el idiom fire-and-forget con cuerpo vacío se declara como **vía 5 del ADR** (promesas void-eadas de fondo); la expresión suelta (`.catch(manejadorFn)`) cuenta como comportamiento visible (vías 3/4). Los 7 handlers multi-línea señalados recibieron su rastro (QuadEditor, useSelectorFuente, persistencia ×2, bridge/captura, pipeline del panel, ocr.ts del motor — CONTRATO.json regenerado con el ritual, el guard de md5 detectó el cambio como debe). El ADR también aclara sus dos metodologías (520/739 de la auditoría B vs 258 de la regla del guard — el informe usaba ambas cifras sin reconciliar) y quedó registrado en `docs/adr/INDICE.md` como D-errores-catches. **Guard re-ejecutado: 2/2 verde.**

### Residuos menores saldados en el mismo cierre

- QA-TRIAGE-lint.md quedó vencido al aterrizar R-36 (decía «cuando llegue» sobre un E2E que YA existe) + citaba el harness retirado `qa-paridad-motor.ts` — corregido.
- `contrato-motor.test.ts`: cabecera pre-monorepo («cópialo al hermano», «vendorizado») + `toEqual` residual en derivadosDe → `toStrictEqual` (24/24 verdes).
- `ci-movil.yml` decía «6 harnesses» pero el gate corre 8 → corregido.
- Cabeceras de scaffold vencidas en ci-panel.yml / motor.yml / deploy-movil.yml («NOTA: scaffold…», «REVISAR antes del primer push») → retiradas.
- `qa-a11y-contraste.ts` solo invocable por ruta → registrado como script `qa:a11y`.

---

## 3. Verificación dinámica (lo ejecutado en esta verificación, con bun 1.4.2)

| # | Verificación | Resultado |
|---|---|---|
| 1 | `bun install` (lockfile v2, 844 paquetes raíz hoisted) | ✅ limpio, sin UnknownLockfileVersion |
| 2 | `bun test packages/scanner-core` | ✅ **209/209** (incl. contrato con toStrictEqual, catches-guard extendido, golden) |
| 3 | `bun test` (panel, con assets preparados) | ✅ **462/462** — incluye los 6 tests de sabotaje nuevos |
| 4 | `bun run test` (móvil, con assets preparados) | ✅ **452/452** |
| 5 | `bunx tsc --noEmit` (cada app — D-5) | ✅ 0 errores ×2 |
| 6 | `bun run lint` (cada app) | ✅ 0 errores (17-23 warnings preexistentes documentados) |
| 7 | `bun audit` | ✅ **0 vulnerabilidades (966 paquetes)** |
| 8 | `bun run build` móvil (BUILD_STATIC=1) | ✅ exit 0 · export estático |
| 9 | `bun run build` panel | ✅ exit 0 · `out/` con _headers |
| 10 | `bun scripts/gen-contrato-motor.ts --check` | ✅ golden coherente |
| 11 | `bun scripts/analisis-grafo.mjs` | ✅ DIP limpio · 0 ciclos entre árboles (449 módulos) |
| 12 | `bun scripts/cruzar-divipola.ts` (en vivo) | ✅ «0 diferencias» contra la fuente oficial — reproduce el claim de R-39 |
| 13 | Guard de catches (extendido) | ✅ 2/2 |
| 14 | Test de sabotaje DIVIPOLA (nuevo) | ✅ 6/6 |

**Total: 1.123/1.123 pruebas, 0 fallos** (motor 209 + panel 462 + móvil 452 — +6 sobre las 1.117 del informe de remediación por el sabotaje nuevo).

Nota de transparencia: dos «hallazgos» sospechosos durante esta verificación resultaron ser artefactos de renderizado de la herramienta de verificación, no defectos del repo (el texto `branches: [main]` se mostraba truncado); se descartaron tras verificar los bytes reales y parsear el YAML.

---

## 4. Observaciones menores documentadas (no cierran el DoD)

1. **a11y sin gate automático en el panel** — decision documentada honestamente en su DEUDA («registro manual, sin script nuevo»); los 4 hallazgos críticos están priorizados con remedio y el gate impide que empeoren en el móvil. Deuda abierta, no hueco del plan.
2. **Sin test Python del sidecar** — la exigencia de token de H-44 está respaldada por lectura de código + tests vitest del cliente; un test automatizado de `servidor.py` sería el cierre natural (deuda nueva documentada).
3. **Similitud 85,8 %→4,4 % (R-24)** no recomputable sin el fork original; la evidencia estructural (77 líneas que solo añaden 4 campos) la hace plausible.
4. **`bun-types@^1.3.0`** en las dos apps (paquete de tipos TS, no el runtime): cosmético, fuera del alcance de las «4 fuentes» de R-03.

## 5. Estado final de la rama

```
f3d47f9  (main — hijo del commit auditado 107cc64)
  └─ 41 commits de la remediación (parches 0001–0041)
      └─ 52165b7  test(divipola): sabotaje controlado del detector de drift (R-39)
      └─ 7314ef4  feat(observabilidad): el guard de catches cubre handlers de promesa
      └─ abe5553  docs: claim D-1 en portada, plan v2 versionado y residuos del cierre
```

44 commits convencionales en español · 1.123/1.123 pruebas · 0 CVEs · builds reales verdes · todos los DoD de los 5 sprints cumplidos.

*Informe de verificación del cierre generado sobre clon fresco con bun 1.4.2. Toda afirmación es re-ejecutable con los comandos del §3.*
