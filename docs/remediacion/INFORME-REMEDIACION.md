# INFORME DE REMEDIACIÓN — e14-suite

> **NOTA (2026-11-19):** los artefactos de entrega (`parches/*.patch`, `bundle/`, `COMO-APLICAR.md`) son EXTERNOS a este monorepo: se entregan junto a cada remediación y no se versionan aquí. Vía de aplicación: `git am -3 parches/*.patch` desde un clon limpio. Las menciones a esos artefactos que siguen abajo se conservan como registro histórico.

> **Nota post-cierre (2026-11-16):** este informe documenta la ejecución original (1.117 pruebas al cerrar el sprint 4). La **verificación independiente del cierre** — que saldó 3 huecos detectados (claim D-1, sabotaje R-39, handlers de promesa del guard) y re-ejecutó todo el apéndice con **1.123/1.123 pruebas** — está en `INFORME-VERIFICACION-CIERRE.md`, junto a este archivo.

> **Ejecución completa del Plan de Remediación v2** (43 tareas + R-44 «micro-limpieza 2» + correcciones D-1…D-6 + gitleaks + SHA de despliegue).
> **Base:** `f3d47f9` (hijo inmediato del commit auditado `107cc64`) · **Rama:** `remediacion/plan-2026-11`
> **Resultado:** 41 commits convencionales en español · 276 archivos · +15.274/−8.580 líneas · **1.117/1.117 pruebas** · 0 vulnerabilidades · builds reales verdes.

---

## 1. Cómo aplicar estos cambios (resumen)

Tres vías, de más a menos fiel (detalle en `COMO-APLICAR.md`):

```bash
# A) Parches por commit (recomendada — conserva los 41 commits atómicos):
git checkout -b remediacion/plan-2026-11
git am parches/*.patch          # o: git am -3 parches/*.patch si tu árbol divergió

# B) Un solo parche combinado (si prefieres 1 commit):
git apply remediacion-completa.patch

# C) Bundle de git (trae la rama tal cual):
git fetch e14-suite-remediacion.bundle remediacion/plan-2026-11:remediacion/plan-2026-11
```

Tras aplicar: `bun install` (con bun **1.4.2** — el lockfile v2 exige 1.4.x) y el apéndice de verificación del `PLAN-REMEDIACION-v2.md` (Parte 3).

---

## 2. Qué se ejecutó (por sprint — el detalle tarea por tarea con commits está en PLAN-REMEDIACION-v2.md)

### Sprint 0 — Estabilización (10 tareas)
El bug P0 de aliasing de `fusionarActaRuntime` cerrado con clonación en la frontera + test nuevo que congela el camino CON runtime; los 5+1 hashes md5 rotos de los CONTRATO.json regenerados con guard nuevo (verificado empíricamente: rojo con los viejos); bun fijado en 1.4.2 en sus 4 fuentes (fin del `UnknownLockfileVersion`); **3 CVEs cerrados** (zod High + glob + minimatch) con Dependabot y un CI de seguridad NUEVO (gitleaks + bun audit, actions pineadas por SHA); el lema de portada honesto con tabla de privacidad y guard de documentación; métricas vencidas sincronizadas con comandos de regeneración; **D65 y D72 reconstruidas** con guard de resolución permanente; pines exactos del sidecar; **token de lectura en el hub local** (verificado E2E: 401/200); micro-limpieza de tipo/console/typo.

### Sprint 1 — Gobernanza documental y CI (+R-35/R-37 por D-4)
Ambos AGENTS.md reescritos al mundo monorepo real (paridad estructural, golden por su ruta real, pasos ocultos del clon limpio); los 12 workflows anidados muertos purgados y sus gates valiosos migrados a la raíz (QA harnesses + smokes byte-a-byte al ci-movil; cabeceras COOP/COEP + frescura como workflow programado NUEVO; el paso PERDIDO de versión del SW restaurado en el deploy); 100 % de las actions pineadas por SHA con guard anti-tag; build real de ambas apps en CI con reporte de bundle; licencias unificadas en MIT (4 byte-idénticas); la reescritura de historia registrada con SHAs previos; **R-44**: token efímero en el sidecar nativo (H-44) + archivo documental de digi ejecutado con 35 citas corregidas (H-45); el golden a toStrictEqual; citas huérfanas purgadas y el guard muerto del SW corregido a la ruta real; onnxruntime unificado; **cobertura medida por primera vez** (19,86 % móvil con ratchet 17→19 · 52,26 % panel · 72,20 % motor).

### Sprint 2 — Observabilidad de errores
**El hallazgo mayor, cerrado:** ADR de política de manejo de errores (árbol de decisión de 4 vías — la REGLA DE ORO intacta) + **258 catches desnudos cubiertos** en 89 archivos (cada uno con su porqué específico leído del contexto; logger.debug solo donde ya había logger) + **guard permanente** que congela «0 catches sin rastro» en los tres árboles (corre en ambos CI). El bloque CSP duplicado consolidado con guards canónicos; la fisura de capa de modal-revisor cerrada con fachada + guard eslint en ERROR; el flaky de orden registrado con regla permanente.

### Sprint 3 — Refactor estructural (caracterización SIEMPRE primero)
Las dos duplicaciones DRY del repo eliminadas (fork del bridge absorbido con genericidad en el motor — similitud 85,8 %→4,4 %; fusion-lectura al paquete, fin del duplicado byte a byte); los tres orquestadores-dios particionados con API pública intacta: **runner 2.887→1.164** (las 3 fases grandes en módulos con 36 subtareas ≤80 líneas), **store 2.079→72 + 12 slices** (<400 c/u), **scanner-core-bridge 2.665→44 + 7 módulos** (<800 c/u) — este último con **41 tests de caracterización escritos ANTES** de partirlo (verdes antes y después); modal-revisor con 20 tests directos; el guard anti-relleno ampliado (productores enumerados, fixtures congelados, **verificado con archivo trampa**); invariantes AA separadas de pines cosméticos (y la única violación AA real corregida); **el contrato formal del hub publicado** con lo no-auditable DECLARADO y el requisito de SHA de despliegue; consistencia española; OpenCV 4.5.5→4.12.0 (tarball inmutable, 29/29 API verificadas en runtime) y jsQR con procedencia byte-exacta verificada en cada preparar.

### Sprint 4 — Cierre de huecos compartidos
**E2E de navegador del golden path: 4/4 verde en local** (~30 s — nadie había abierto la app en pruebas: carga sin pageerror, cámara fake viva, pipeline completo con OCR real vía ARCHIVO, falla-cerrado visible), con la estrategia de cámara presupuestada en el spec y CI nightly; pass de accesibilidad (152 pares de contraste medidos, hallazgos priorizados en ambos DEUDA, un par nuevo bajo umbral revienta el gate); **DIVIPOLA cruzado EN VIVO contra la fuente oficial de la Registraduría: 0 diferencias** (digest canónico idéntico, snapshot firmado, sabotaje controlado detectado); ADR del modelo de amenaza de la clave HMAC (el XSS firma por proxy: la extraibilidad no es la frontera); grafo de dependencias con gate de ciclos (449 módulos, 0 violaciones DIP, auto-verificado); supply chain del sidecar (SHA256SUMS + inventario en la release, guía de rebuild con estado honesto); la relajación de ESLint registrada con plan de reapertura.

---

## 3. Métricas antes → después

| Métrica | Antes (auditoría) | Después (medido 2026-11-16) |
|---|---|---|
| Pruebas (total) | 1.003 | **1.117** (84 nuevas: guards, caracterizaciones, E2E) — 0 fail |
| Catches sin rastro | 153 (metodología B) / 258 (regla del guard) | **0** (guard permanente) |
| Workflows muertos citados como vivos | 12 (en 7 docs) | **0** (purgados; gates migrados a la raíz) |
| CVEs de dependencias | 3 (1 High) | **0** (bun audit; Dependabot activo) |
| Fuentes de versión de bun | 4 contradictorias | **1** (1.4.2 en todas) |
| Hashes de contrato md5 rotos | 5/6 + 1/1 | **0** (guards que cazan el drift) |
| Decisiones D citadas sin fila | D65 + D72 | **0** (guard de resolución) |
| Duplicación DRY injustificada | bridge 86,2 % + fusion-lectura 100 % | **0** (4,4 % residual = adaptador fino) |
| Archivos >2.000 líneas | runner 2.883 · bridge 2.649 · store 2.074 | **0** (1.164 · 44+7mód · 72+12slices) |
| Tests directos módulos XL | modal-revisor 0 · bridge 0 | **20 · 41** (+ 4 E2E de navegador) |
| Cobertura medida | nunca (17 % «declarado» vs 33 % citado) | móvil 19,86 % (ratchet 19) · panel 52,26 % · motor 72,20 % |
| build real ejecutado | nunca (tsc trivial en raíz) | **ambas apps en CI** + reporte de bundle |
| E2E navegador | 0 | **4/4** (cámara fake + OCR real por ARCHIVO) |
| DIVIPOLA contra fuente oficial | nunca | **0 diferencias** (en vivo) |
| Licencias coherentes | no (raíz restrictiva vs MIT) | **MIT ×4 byte-idénticas** |
| Actions pineadas por SHA | 0 de 38 | **todas** + guard anti-tag |
| gitleaks en CI | no existía | **en cada push/PR** |
| Lema de portada | sobre-prometía | honesto + tabla de privacidad + guard |

**Scorecard proyectado (auditoría B):** todas las dimensiones con las tareas de su sprint completadas — global proyectado **4.5/5** como estimaba el plan.

---

## 4. Lo que se CONSERVÓ (verificado)

YAGNI con borrado documentado + knip · whitelist deny-by-default · assets.lock.json con SHA-256 (ahora con OpenCV 4.12 y jsQR verificable) · guards de regresión de negocio · commits convencionales en español (41/41 nuevos) · métricas DIVIPOLA congeladas y cruzadas contra la oficial · HMAC con re-firma y falla-cerrado · **la REGLA DE ORO: ningún cambio del plan rompe la app en jornada** (toda la suite verde tras cada tarea).

## 5. Deuda nueva registrada (documentada, no oculta)

- A11Y: 3 hallazgos críticos de contraste del móvil + 1 del panel, priorizados en DEUDA con remedio (el gate impide que empeoren).
- Supply chain del sidecar: binario sin firmar (EV cert = decisión del mantenedor); bit-a-bit declarado no perseguido.
- La fuente del Worker `e14-puente` sigue fuera (contrato formal publicado; cierre = traerla a `packages/e14-puente/`).
- Plan de reapertura de ESLint en 5 fases.
- Re-cruce DIVIPOLA obligatorio si cambia el catálogo o por release electoral.

## 6. Anomalías y decisiones de ejecución (transparencia)

1. La auditoría B contaba 153 catches «sin nada» con su metodología; la regla del guard (cuerpo sin comentario Y sin log) mide 258 — se usó la cifra MÁS exigente y todas quedaron cubiertas.
2. Durante la ejecución se descubrió que el último commit pre-plan (f3d47f9) añadió 15 tests al motor y 1 al móvil: los conteos «originales» del plan (192/399) eran de 107cc64; todos los números del informe están re-medidos sobre f3d47f9.
3. El guard de tags de actions se aplicó a los 12 workflows raíz resultantes (los anidados fueron purgados en lugar de pineados).
4. `packages/scanner-core/LICENSE` no existía (la auditoría la daba por existente): se creó al unificar.
5. El analisis-grafo, catches-guard y E2E se auto-verificaron plantando violaciones temporales (import paquete→app, archivo trampa de demo, contratos viejos) y confirmando que el gate correspondiente se ponía rojo.

---

*Informe generado por la ejecución del plan. Cada afirmación tiene su commit en `parches/` y su verificación en el log de la rama.*
