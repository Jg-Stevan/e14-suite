# PLAN DE REMEDIACIÓN v2 — e14-suite (corregido y EJECUTADO)

> **Repositorio:** https://github.com/Jg-Stevan/e14-suite · base `f3d47f9` (hijo del auditado `107cc64`)
> **Este documento:** la versión 2 del plan con las **correcciones D-1…D-6 + 2 añadidos** de la revisión aplicadas AL PLAN y AL EJECUTOR, más el **estado final de ejecución de las 45 tareas** (43 originales + R-44 nueva + correcciones absorbidas).
> **Ejecución:** rama `remediacion/plan-2026-11` — 41 commits convencionales en español, 276 archivos, +15.274/−8.580 líneas.

---

## Parte 1 — Correcciones aplicadas al plan (revisión del plan, ítem 4)

| # | Corrección pedida | Decisión tomada y aplicada |
|---|---|---|
| **D-1** | Añadir H-44 y H-45 a R-10/R-17 **o** crear tarjeta «micro-limpieza 2»; corregir el claim «50→43» a «50→43+2 menores absorbidas» | Se CREÓ la tarjeta **R-44 «micro-limpieza 2»** (Sprint 1) que cierra H-44 (token efímero en /ocr y /acta del sidecar nativo + cliente + docs + tests 35/35) y H-45 (archivo documental de digielect14 ejecutado: 16 documentos fechados movidos a `docs/archivo/` con índice y 35 citas corregidas). El claim de portada quedó: «50 hallazgos → 43 tareas accionables + 2 menores absorbidas (H-44/H-45 en R-44)». |
| **D-2** | Elegir: ampliar R-26 a las 3 fases **o** rebajar el DoD de runner.ts a <2.000 líneas | Se **AMPLIÓ R-26 a las 3 fases** (faseCapa0Qr 501 · faseDesenlace 348 · fasePipelineIntentos 329) manteniendo el DoD original: resultado **runner.ts 2.887 → 1.164 líneas** (< 1.500) con 36 subtareas ≤ 80 líneas en `masiva/fases/` y la caracterización (53 anclas) verde con anclas reposicionadas. |
| **D-3** | Mover el fix de ruta del generador de R-16 a R-02 | Aplicado: **R-02** incluyó el fix de `gen-contrato-motor.ts` (escribía a la ruta muerta pre-monorepo `src/lib/e14/__fixtures__/`; ahora escribe directo a `packages/scanner-core/tests/fixtures/`). Verificado con regeneración (diff VACÍO: golden en sync) + `--check` verde. R-16 quedó con el resto (toStrictEqual + re-vinculación de docs). |
| **D-4** | Subir R-35 y R-37 al Sprint 1 | Aplicado: ambas tareas se ejecutaron en el Sprint 1 (commits `fd6a2d1` build real con reporte de bundle y `bf2f0e7` cobertura medida con ratchet). |
| **D-5** | Corregir el script del apéndice para verificar ambas apps | Aplicado — ver **Parte 3**: typecheck POR APP (en la raíz no hay tsconfig: era trivialmente exitoso), build real de AMBAS apps con su entorno de deploy, y conteos por suite. |
| **D-6** | Re-etiquetar R-20 como L y presupuestar la estrategia de cámara para R-36 en la propia tarjeta | Aplicado: R-20 se ejecutó como esfuerzo L (258 catches en 89 archivos + ADR + guard permanente). La estrategia de cámara de R-36 quedó PRESUPUESTADA EN EL PROPIO SPEC (`e2e/humo.spec.ts`): cámara fake de Chromium para la ruta de permisos/stream (sin OCR), vía ARCHIVO con fixture sintética para el pipeline completo (OCR real), cámara física = validación de campo (REPORTE-validacion-dispositivo-*). |
| **Añadido 1** | Añadir gitleaks al CI raíz nuevo | Aplicado en R-04: `ci-seguridad.yml` con gitleaks (historia completa) + bun audit en cada push/PR — actions pineadas por SHA desde su creación. |
| **Añadido 2** | Un SHA de despliegue al DoD de R-32 | Aplicado: el ADR del contrato del hub fija el requisito de identidad de despliegue (todo deploy del Worker registra su deployment ID/SHA en la tabla del ADR + endpoint de versión; un despliegue sin entrada es hallazgo de auditoría). |

---

## Parte 2 — Estado de ejecución por tarea

Leyenda: ✅ ejecutada y verificada · el commit es el de la rama `remediacion/plan-2026-11`.

### Sprint 0 — Estabilización
| Tarea | Estado | Evidencia clave |
|---|---|---|
| R-01 clonar acta en la frontera | ✅ | `fusionarActaRuntime` devuelve `clonarActa(acta)`; test NUEVO congela la frontera con runtime publicado; M11 independiente del orden (9/9 en ambos órdenes). Commit `1f323c3`. |
| R-02 contratos md5 + fix ruta generador (D-3) | ✅ | core/CONTRATO.json y ui/CONTRATO.json regenerados (5/6 y 1/1 estaban rotos); guard `contrato-md5.test.ts` con toStrictEqual (verificado: rojo con los viejos); gen-contrato-motor.ts escribe al paquete; golden en sync. Commit `8928033`. |
| R-03 toolchain bun 4 fuentes | ✅ | engines + packageManager (raíz) + 6 workflows + AGENTS en 1.4.2; `bun install --frozen-lockfile` limpio; lockfile estable. Commit `a915194`. |
| R-04 CVEs + Dependabot | ✅ | knip 5.44.1→6.45.1 (elimina zod 3.25.76) + overrides glob/minimatch; **bun audit = 0 vulnerabilidades**; dependabot.yml (bun+actions); NUEVO ci-seguridad.yml (gitleaks + audit). Commit `e24c0c9`. |
| R-05 lema honesto | ✅ | README: «procesado 100 % local» + tabla de privacidad + guard de documentación 4/4. Commit `a624323`. |
| R-06 métricas vencidas | ✅ | 109.706 LOC · 1.033→1.117 pruebas medidas con fecha · 949 puestos · tabla «regenerar métricas». Commit `e7392f4`. |
| R-07 D65 y D72 | ✅ | Reconstruidas desde las citas (D65: watchdog+dedup v2; D72: título compacto); guard `adr-resolver.test.ts` (59+40+35 números D citados, todos resuelven). Commit `d66a848`. |
| R-08 pins sidecar | ✅ | requirements.txt con == exactos de las versiones medidas. Commit `e219f6e`. |
| R-09 auth hub-local | ✅ | TOKEN_LECTURA por sesión (Bearer o ?token=) en /actas, /foto, /hub/estado; verificado E2E: 401 sin token · 200 con Bearer y ?token= · estáticos abiertos; runbook actualizado; ADR D99-sup. Commit `42486a9`. |
| R-10 micro-limpieza 1 | ✅ | Fin del cast mentiroso (EntradaPrecalor.maestro nullable + guard); 4 console.info al logger; DESCRYPTORES→DESCRIPTORES. Commit `30d6198`. |

### Sprint 1 — Gobernanza documental y CI (+ R-35/R-37 por D-4)
| Tarea | Estado | Evidencia clave |
|---|---|---|
| R-11 AGENTS.md al monorepo | ✅ | Ambos reescritos: paridad estructural, golden por ruta real, regeneración de un paso, pasos ocultos del clon limpio, sin workflows muertos. Commit `5692df5`. |
| R-12 migrar gates + purgar 12 muertos | ✅ | ci-movil con QA+smokes+cache (era scaffold); NUEVO ci-programados (cabeceras COOP/COEP + frescura); paso PERDIDO de versión del SW restaurado en deploy-movil-pages; 12 workflows anidados + qa-paridad-motor ×2 purgados; 7 citas vivas actualizadas. Commit `0130df9`. |
| R-13 actions por SHA | ✅ | 11 pines restantes aplicados (todos los workflows con comentario de versión); guard anti-tag-mutable en ci-seguridad. Commit `d892ddd`. |
| R-35 (D-4) build real | ✅ | NUEVO ci-build.yml: build de producción de ambas apps (mismo entorno que deploy) + reporte de bundle como artefacto. Verificado local: panel y móvil build verde. Commit `fd6a2d1`. |
| R-14 licencias | ✅ | 4 LICENSE byte-idénticas MIT (la de scanner-core no existía y se creó). Commit `e280a3b`. |
| R-15 registro consolidación | ✅ | `docs/archivo/registro-consolidacion.md`: las 2 reescrituras, SHAs previos (0386fa1, 4409249…), pérdida conocida de 1e23174, respaldos. Commit `c3a152f`. |
| R-44 (D-1) micro-limpieza 2 | ✅ | H-44: token efímero en /ocr y /acta del sidecar (compare_digest, CORS, cliente ?token=, flags-schema, docs, +7 tests); H-45: archivo documental ejecutado (16 docs + índice + 35 citas). Commits `0abf1b0` y `2f74a50`. |
| R-16 golden cadena | ✅ | toStrictEqual en clasificación y escalera (24/24 — ningún contrato sano roto); regeneración de un paso documentada. Commit `c21a156`. |
| R-17 citas huérfanas + guard SW | ✅ | REPORTE-e75 corregido (era del repo origen); guard del SW /downloads/→/descargas/ (ruta real); QA-TRIAGE corregido y enlazado a R-36. Commit `48a3381`. |
| R-18 onnxruntime | ✅ | Panel 1.30.0→1.31.1; una sola entrada en bun.lock; cascada OCR 33/33. Commit `e219f6e`. |
| R-19 opennextjs devDeps | ✅ | Movido a devDependencies. Commit `e219f6e`. |
| R-37 (D-4) cobertura real | ✅ | Medido: móvil 19,86 % (ratchet 17→19) · panel 52,26 % · motor 72,20 %; cobertura en CI con artefactos. Commit `bf2f0e7`. |

### Sprint 2 — Observabilidad de errores
| Tarea | Estado | Evidencia clave |
|---|---|---|
| R-20 (L por D-6) campaña catches | ✅ | ADR de política (árbol de 4 vías); **258 catches desnudos cubiertos** en 89 archivos (porqué específico + 7 logger.debug donde ya había logger); guard `catches-guard.test.ts` permanente (corre en ambos CI); CONTRATO md5 regenerados con ritual. Commit `e2f1af4`. |
| R-21 CSP duplicado | ✅ | Bloque duplicado de _headers de digi consolidado; guards canónicos en ambas suites (patrón único · un solo /* con COOP/COEP · CSP con orígenes críticos) 6/6. Commit `12512bb`. |
| R-22 guard eslint capa | ✅ | Fachada del módulo + import de modal-revisor migrado + guard no-restricted-imports en ERROR (verificado que dispara). Commit `12512bb`. |
| R-23 flaky registrado | ✅ | DEUDA §10: causa raíz, regla de beforeEach, condición de reactivación. Commit `12512bb`. |

### Sprint 3 — Refactor estructural (DRY · KISS · SOLID)
| Tarea | Estado | Evidencia clave |
|---|---|---|
| R-24 absorber fork bridge | ✅ | CompositeBridge genérico en el motor; bridge del panel 251→77 líneas; similitud 85,8 %→4,4 %; singleton del motor. Commit `c2448b9`. |
| R-25 fusion-lectura al motor | ✅ | Diff byte a byte re-verificado VACÍO; movida al paquete; dos copias borradas. Commit `96a6f27`. |
| R-26 (D-2: 3 fases) extraer fases | ✅ | runner 2.887→1.164; 4 módulos en fases/; 36 subtareas ≤80 líneas; caracterización 53/53 con anclas reposicionadas. Commit `1c2179c`. |
| R-27 slices store | ✅ | 2.079→72 fachada + 12 slices <400 líneas; API pública exacta (25 consumidores sin cambios); persistencia intacta. Commit `b9c6861`. |
| R-28 particionar bridge | ✅ | 2.665→44 fachada + 7 módulos <800; caracterización 41 tests verde ANTES y DESPUÉS. Commit `617e323`. |
| R-29 tests XL | ✅ | scanner-core-bridge: 41 tests (R-28); modal-revisor: 20 tests (props, RECHAZAR/ACEPTAR, ROTAR, reproyección, honestidad de datos, DIVIPOL…). Commits `617e323` + `06523f2`. |
| R-30 guard anti-relleno | ✅ | Walk .js/.mjs; allowlist ACTA_MOCK con walk al paquete; PRODUCTORES_DEMO enumerados; fixtures congelados; verificado empíricamente con archivo trampa (.ts y .mjs → rojo). Commit `fa9fa6f`. |
| R-31 invariantes vs cosméticos | ✅ | qa-aa-quickwins partido en aa-invariantes (BLOQUEA; corrigió la única violación AA real: pie 10 px slate-500) + aa-cosmeticos (AVISA); vestigio 2-repos purgado. Commit `ff41b8b`. |
| R-32 contrato hub + SHA | ✅ | ADR del contrato formal (sobre completo, HMAC, anti-replay declarado, lo no-auditable DECLARADO, requisito de SHA de despliegue); índice D-puente ABIERTA→PARCIAL. Commit `066a262`. |
| R-33 nombres españoles | ✅ | tieneRealAF + prepararBannerDeActualizacion; rg de viejos = 0. Commit `afa9144`. |
| R-34 vendor | ✅ | OpenCV 4.5.5→4.12.0 (tarball npm inmutable, compatibilidad 29/29 verificada en runtime, alternativas agotadas documentadas); jsQR procedencia byte-exacta registrada (verificación in-place en cada preparar). Commit `6f8b849`. |

### Sprint 4 — Cierre de huecos compartidos
| Tarea | Estado | Evidencia clave |
|---|---|---|
| R-36 E2E golden path | ✅ | Playwright + humo.spec con estrategia de cámara presupuestada; **4/4 VERDE en local** (~30 s: carga, cámara fake viva, pipeline ARCHIVO con OCR real, falla-cerrado visible); ci-e2e nightly. Commit `b2a37db`. |
| R-38 a11y | ✅ | qa-a11y-contraste (152 pares: 136 OK · 16 perdonados con registro · 0 FAIL; un par nuevo bajo umbral revienta); teclado source-scan; hallazgos priorizados en ambos DEUDA (3 críticos móviles + 1 panel). Commit `d4bd871`. |
| R-39 DIVIPOLA oficial | ✅ | Cruzado EN VIVO contra el visor E14 2026 de la Registraduría: **0 diferencias** (digest canónico igual); snapshot firmado; DANE constancia (no publica consulados); drift verificado con sabotaje controlado. Commit `c8a62fd`. |
| R-40 ADR HMAC | ✅ | Modelo de amenaza completo (qué protege/no, atacantes A1–A3, por qué localStorage y no WebCrypto no-extraíble — el XSS firma por proxy); índice actualizado. Commit `282464d`. |
| R-41 grafo deps | ✅ | analisis-grafo.mjs (449 módulos, 0 violaciones DIP, 0 ciclos entre árboles; auto-verificado con import trampa) + ci-analisis.yml. Commit `6ab71a9`. |
| R-42 sidecar build | ✅ | SHA256SUMS.txt + INVENTARIO-BUNDLE.txt como assets de la release; BUILD-REPRODUCIBLE.md con estado honesto (bit-a-bit no perseguido; mismo código+mismo pins+hash del build oficial); DEUDA §12. Commit `a507f2d`. |
| R-43 ESLint deuda | ✅ | Relajación registrada con estado por regla, 0 `any` verificado y plan de reapertura en 5 fases. Commit `d4bd871`. |

**Deuda descubierta durante la ejecución y saldada en el mismo plan:** ancla de qa-autoenvio rota por R-27 (recalibrada), flaky de temporización en la caracterización e67 (espera por polling + tolerancia de jitter, commit `66827ef`).

---

## Parte 3 — Apéndice corregido (D-5): verificación global

El apéndice original tenía 3 defectos: `bunx tsc --noEmit` en la RAÍZ (ahí no hay tsconfig: exito trivial — exactamente el falso verde que la auditoría señaló), `bun run build` en la raíz (no existe el script) y sin typecheck por app. Versión corregida y EXECUTADA (2026-11-16):

```bash
git clone https://github.com/Jg-Stevan/e14-suite && cd e14-suite
bun install                                            # limpio con bun 1.4.2 (R-03) — sin UnknownLockfileVersion

bun test packages/scanner-core                         # MOTOR: 209/209 (incl. guards de catches y golden estricto)

# PANEL — typecheck POR APP + suite + build real:
(cd apps/supervision-e14 \
  && bun run preparar && bunx tsc --noEmit && bun test && bun run build)
# → typecheck 0 errores · 456/456 · build export estático ✓

# MÓVIL — typecheck POR APP + suite + build real (mismo entorno que el deploy):
(cd apps/digielect14 \
  && bun run preparar && bunx tsc --noEmit && bun run test \
  && BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH='' bun run build)
# → typecheck 0 errores · 452/452 · build export ✓
# Extra: bash scripts/check-quality.sh → TODO VERDE (tsc·lint·build·vitest·QA 8/8)
# Extra: bunx playwright test --project=chromium  # E2E de humo 4/4 (~30 s)

bun audit                                              # 0 vulnerabilidades (R-04)
bun scripts/analisis-grafo.mjs                         # DIP limpio · 0 ciclos entre árboles (R-41)
```

**Cierre del plan:** todas las tareas con su DoD cumplido · suites completas **1.117/1.117** (motor 209 + panel 456 + móvil 452 — 84 tests NUEVOS creados por el plan: guards, caracterizaciones y E2E) · bun audit 0 · build real en CI · E2E de humo verde en local · grafo sin ciclos · DIVIPOLA idéntico a la fuente oficial.
