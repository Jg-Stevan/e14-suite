# Registro de consolidación y purgas de historia

Material histórico — asienta qué historia existía antes del monorepo `e14-suite`,
por qué se reescribió y cuáles son los SHAs previos conocidos. Cumple la regla de
`AGENTS.md` (registrar SHA previo y motivo ante cualquier reescritura de historial)
que la consolidación dejó sin asiento: los respaldos viven fuera del repo y este
documento es la única traza consultable desde el monorepo.

- **Fecha del registro:** 2026-11-16
- **Fuente:** auditoría 2026-11-16 (hallazgo H-32 / remediación R-15)
- **Rama:** `remediacion/plan-2026-11` (Sprint 1)

---

## 1. Qué historia existía

El panel `supervision-e14` vivió como repositorio independiente
(`https://github.com/Jg-Stevan/supervision-e14.git`) y su historia fue reescrita
**dos veces** antes de consolidarse en el monorepo:

| # | Reescritura | Herramienta | Motivo | Referencia |
|---|---|---|---|---|
| 1 | Purga de binarios (D85) | `git filter-repo` | Dejar de versionar binarios de `public/`: modelos OCR, OpenCV y vendor de npm. Pack **49,3 MB → 5,87 MB**. | `apps/supervision-e14/docs/adr/README.md`, D85 |
| 2 | Reescritura de remediación gitleaks (D90) | `scripts/reescribir-historia-supervision-e14.sh` (filter-repo `--invert-paths` + `--force-with-lease`) | Sacar del historial las **fotos REALES de actas electorales**: `actas-demo/` (6 JPG reales del consulado), `actas-reales/assets` (8 WebP con códigos DANE), `acta-e14-real.jpg`, `capturas-actas-reales-v1` y el manifest original (G2). Cierra el hallazgo #8 (T2.5) de la auditoría 2026-11-11; el escaneo de secretos del 2026-11-12 (`docs/archivo/gitleaks-2026-11-12.txt`, fallback manual, 11 patrones) dio **0 hallazgos** sobre los commits accesibles. | D90 + `apps/supervision-e14/docs/archivo/gitleaks-2026-11-12.txt` |

El script de la reescritura 2 conserva a propósito el manifest metadata-only
vigente (`actas-reales-manifest.json`) y `actas-reales.ts`, exige bundle `--all`
de respaldo, `--force-with-lease` (nunca `--force` a secas) y hace eco del SHA
previo de `main` antes de filtrar.

## 2. Consolidación al monorepo e14-suite

- **Commit raíz:** `8e88f31` — `chore: monorepo e14-suite — workspaces bun (apps/digielect14, apps/supervision-e14, packages/scanner-core)`, 2026-11-15 10:56.
- Ese día entraron el raíz **más 23 commits** (24 en total hasta `f3d47f9`,
  2026-11-15): importación de las dos apps y del motor `scanner-core`, suites de
  pruebas, CI y deploy.
- **La historia pre-monorepo NO viajó:** el monorepo arranca de raíz nueva. Ninguno
  de los SHAs del repo viejo existe en el almacén de objetos de `e14-suite`
  (verificado 2026-11-16 con `git cat-file -t`: `0386fa1`, `4409249…`, `8583d300`,
  `a3a3d960…` y `1e23174` fallan todos).

## 3. SHAs previos conocidos (y pérdidas)

| SHA | Qué era | Estado en el monorepo |
|---|---|---|
| `0386fa1` | `main` de supervision-e14 **antes de la purga de binarios** (D85) | No existe aquí; solo en los bundles de respaldo |
| `440924900e8b555f430d6c2582badda40e9803cf` | `main` de supervision-e14 **al preparar la reescritura gitleaks** (D90) | No existe aquí; solo en los bundles de respaldo |
| `1e23174` | Commit base del parche de auditoría citado por la GUIA archivada (`fix(csp): 'unsafe-eval' solo en desarrollo`) | **PÉRDIDA CONOCIDA:** `git cat-file -t 1e23174` falla — el objeto no existe en el monorepo. Recuperable únicamente desde los bundles del mantenedor. La GUIA lo sigue citando en 3 lugares (ver §5). |
| `8583d300` | Donde moría la traversa de `main` en el clon recortado del escaneo gitleaks | No existe aquí (nota «HISTORIA RECORTADA» del escaneo) |
| `a3a3d960…` | Ancestro ausente del bundle de origen, detectado por el escaneo gitleaks | No existe aquí; el escaneo de la historia COMPLETA debe re-corarse desde el clon íntegro del mantenedor |

## 4. Respaldo y fecha límite

- La consolidación se materializó el **2026-11-15** (raíz `8e88f31`); la auditoría
  del **2026-11-16** (H-32) ordenó este registro como cierre del Sprint 1 de la
  remediación — es el límite efectivo: a partir de la consolidación, la historia
  vieja solo existe en los respaldos externos.
- **Dónde están los respaldos:**
  - Bundle `git bundle create … --all` generado por el script de reescritura
    (`supervision-e14-backup-<YYYYMMDD>.bundle`), guardado **fuera de la máquina
    de trabajo** — requisito del AGENTS.md para toda reescritura.
  - `.hub-local/` (almacén del hub local con las actas REALES recibidas en las
    corridas E2E) vive **fuera del control de versiones**, ignorado por
    `.gitignore` de `apps/supervision-e14`.

## 5. Dónde viven las citas

- D85 y D90: `apps/supervision-e14/docs/adr/README.md` (tabla de decisiones).
- Script de reescritura: `apps/supervision-e14/scripts/reescribir-historia-supervision-e14.sh`.
- Escaneo de secretos con la nota «HISTORIA RECORTADA»:
  `apps/supervision-e14/docs/archivo/gitleaks-2026-11-12.txt`.
- GUIA que cita el SHA perdido `1e23174`:
  `apps/supervision-e14/docs/archivo/auditoria/GUIA-AUDITORIA-supervision-e14.md`.
- El archivo histórico del panel (`apps/supervision-e14/docs/archivo/`:
  `RUNBOOK-deploy-pages-v1.md`, `auditoria/`, `historico/`) se conserva intacto;
  este registro lo complementa desde la raíz del monorepo.

## 6. Regla que este registro cumple

`apps/supervision-e14/AGENTS.md` (regla de historial):

> Nunca `git push --force` ni reescritura de historial. **Excepción única y
> autorizada por el mantenedor**: purgas puntuales de binarios del historial
> (p. ej. `git filter-repo` para dejar de versionar modelos). Requisitos: bundle
> de respaldo con `--all`, verificación post-reescritura, `--force-with-lease`
> (nunca `--force` a secas) y registrar en `docs/adr/README.md` el SHA previo y
> el motivo.

Las dos reescrituras cumplían bundle, verificación y `--force-with-lease`, pero el
registro consolidado de SHAs previos quedó disperso (D85/D90 citan los suyos) y la
consolidación al monorepo cortó el acceso a los objetos. Este documento cierra ese
hueco: SHAs previos, motivos y paradero de los respaldos, en un solo lugar.
