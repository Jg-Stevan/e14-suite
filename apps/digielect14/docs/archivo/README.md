# Archivo documental — digielect14

Material histórico archivado: **no describe el estado vigente**; se conserva
por trazabilidad. Los documentos de aquí son evidencia de CIERRE (un kit que
terminó, una medición fechada, una investigación resuelta) — su contenido ya
no cambia y las decisiones que fundamentan viven en `../DECISIONS.md`.

> H-45 (auditoría 2026-11-16, TRAY-C-13): este directorio se declaró
> («Material histórico archivado») pero estuvo VACÍO mientras los 12
> `REPORTE-*` y las 4 mediciones/notas seguían activos en `docs/`. El
> mecanismo se ejecuta con este índice (en `supervision-e14` ya se había
> ejecutado).

## Índice

| Documento | Qué es |
| --- | --- |
| [MEDICION-6.7.md](MEDICION-6.7.md) | Protocolo de la ventana §6.7 para fijar el orden por defecto de motores (C3/C4/C5, D85): qué se mide, criterio de cambio, estado «abierta» desde el 2026-11-07 |
| [MEDICION-RENDIMIENTO-2026-11-05.md](MEDICION-RENDIMIENTO-2026-11-05.md) | Medición de rendimiento del digitalizador en dispositivo real (17 actas, 214 long tasks, 6 sesiones), sesión del 2026-11-05 |
| [NOTA-c4-workers.md](NOTA-c4-workers.md) | Nota C4 del KIT e14-remediacion-movil-v1: inventario de workers y nombres nuevos (fin de los targets mudos, P1 #10 + P2 #15) |
| [NOTA-d5-csp-eval.md](NOTA-d5-csp-eval.md) | Nota D5 (D5.4, solo investigación): el CSP `EvalError` de `unsafe-eval`/`wasm-unsafe-eval` — sin cambio de CSP |
| [REPORTE-adaptacion-dispositivo-v1.md](REPORTE-adaptacion-dispositivo-v1.md) | Cierre del KIT e14-adaptacion-dispositivo-v1 (D75): perfil profundo del dispositivo, plan por tier e informe IA descargable |
| [REPORTE-e14-capa0-qr-worker-v1.md](REPORTE-e14-capa0-qr-worker-v1.md) | Cierre del KIT e14-capa0-qr-worker-v1 (D78): capa 0 QR de cámara en worker dedicado (port del D40+R1.1+R1.4-b de supervision-e14) |
| [REPORTE-e14-frame-loop-modo-espera-baja-v1.md](REPORTE-e14-frame-loop-modo-espera-baja-v1.md) | C3 #20 / D5.3: el modo espera del frame-loop queda ELIMINADO (código muerto verificado en `core/frame-loop.ts`) |
| [REPORTE-e14-gama-baja-20s-v1.md](REPORTE-e14-gama-baja-20s-v1.md) | KIT e14-gama-baja-20s-v1: el procesamiento de la imagen en ~20 s en gama baja, offline, sin VLM |
| [REPORTE-e14-ocr-psm4-port-v1.md](REPORTE-e14-ocr-psm4-port-v1.md) | Puerto de velocidad del OCR (PSM 4) desde `supervision-e14` @ `a249518` |
| [REPORTE-e14-rastreo-tiempos-v1.md](REPORTE-e14-rastreo-tiempos-v1.md) | KIT e14-rastreo-tiempos-v1 (+ e14-sin-relleno-v1): rastreo de tiempos por etapa del pipeline |
| [REPORTE-fix-camara-principal-f-lens-v5.md](REPORTE-fix-camara-principal-f-lens-v5.md) | KIT fix-camara-principal F-LENS v5: bug de campo «abrió la cámara FRONTAL» — facing-primero, saneo de caché venenada |
| [REPORTE-ocr-tessbest-cascada-v1.md](REPORTE-ocr-tessbest-cascada-v1.md) | KIT e14-ocr-tessbest-v1 (GO-B): Tesseract best primero, escalonado a PP-OCR |
| [REPORTE-sim-gama-baja-v2.md](REPORTE-sim-gama-baja-v2.md) | Simulación gama baja v2: herramientas del navegador usadas, problemas y soluciones (evidencia del PR #117) |
| [REPORTE-tesseract-fast-vs-best-2026-11-10.md](REPORTE-tesseract-fast-vs-best-2026-11-10.md) | Tesseract `fast` vs `best` en el gate de clasificación (2026-11-10): ¿clasifican el acta y a qué costo? |
| [REPORTE-validacion-dispositivo-a13-2026-11-09.md](REPORTE-validacion-dispositivo-a13-2026-11-09.md) | Validación en dispositivo real (Galaxy A13, Android 14) tras las olas A–D + H1–H5, por CDP |
| [REPORTE-validacion-dispositivo-a56-2026-11-09.md](REPORTE-validacion-dispositivo-a56-2026-11-09.md) | Validación en dispositivo real (Galaxy A56 5G, Android 16) vs A13, por CDP |

## Política

**Se archiva** (se mueve aquí al cerrar):

- Los `REPORTE-*` — evidencia puntual de un kit: petición del mantenedor, qué
  se hizo, mediciones y verificación. Cerrado el kit, el reporte es histórico.
- Las mediciones y notas fechadas o de investigación cerrada
  (`MEDICION-*.md`, `NOTA-*.md`): una fecha o un veredicto las congela.

**NO se archiva** (sigue en `docs/`, es material vivo):

- `SPEC-*.md` — contratos vigentes de comportamiento (mientras estén en pie).
- `DECISIONS.md` (la autoridad), `DEUDA.md`, `ROADMAP.md`, `ARQUITECTURA.md`,
  `PENDIENTES-INTEGRACION.md`, `PLAN-TROCEADO-PIPELINE.md`, `QA-TRIAGE-lint.md`,
  `DEPLOY.md`, `ENDPOINT-REPORTES.md`.
- `research/` (patrones de investigación vigentes) y `flags-ejemplo.json`.

**Convención de citas:** desde `docs/` y `src/` se cita con la ruta
repo-relativa `docs/archivo/…`; los enlaces relativos desde aquí hacia un doc
activo de `docs/` llevan `../` (p. ej. `../DECISIONS.md`).
