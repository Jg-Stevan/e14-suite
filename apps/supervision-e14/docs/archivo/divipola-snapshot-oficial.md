# Snapshot oficial del catálogo DIVIPOLA exterior (R-39)

> Registro de referencia congelada. El catálogo versionado
> (`src/modules/supervision/data/divipola-exterior.json`) está congelado por
> test (949 puestos · 67 países · 3.670 mesas);
> este snapshot fija la referencia EXTERNA contra la que se detecta drift
> (`bun scripts/cruzar-divipola.ts`). Generado 2026-11-16.

## Qué se cruzó, contra qué y cuándo

| Aspecto | Valor |
|---|---|
| Catálogo | `src/modules/supervision/data/divipola-exterior.json` (189.839 bytes · sha256 raw `bbb12832429e32ce…`) |
| Contenido congelado | 949 registros · 67 países · 3.670 mesas · sha256 canónico `bbb12832429e32ce…` |
| Fuente oficial | Visor ciudadano E14 2026 — Registraduría (bundle DIVIPOL del visor) |
| URL máquina | https://e14segundavueltapresidente.registraduria.gov.co/assets/temis/divipol_json/departmentsTree.json |
| Consultada | 2026-11-16T06:26:45.793Z |
| Extracción depto 88 | 949 registros · 67 países · 3.670 mesas · sha256 `bbb12832429e32ce…` |
| Resultado del cruce | **0 diferencias** — idéntico registro a registro y digest canónico igual |
| Método | cruce en vivo contra el bundle DIVIPOL del visor E14 de la Registraduría (departmentsTree.json, depto 88 CONSULADOS) + digests SHA-256 del catálogo versionado |

### Intentos de descarga registrados (2026-11-16)

- `https://e14segundavueltapresidente.registraduria.gov.co/assets/temis/divipol_json/departmentsTree.json` → OK (4.43 MB · 34 departamentos · depto 88 "CONSULADOS" con 949 puestos)
- `https://www.datos.gov.co/resource/gdxc-w37w.json?cod_dpto=88&%24limit=200` → RESPONDE pero NO apta para el cruce: cod_dpto 88 = ARCHIPIÉLAGO DE SAN ANDRÉS, PROVIDENCIA Y SANTA CATALINA (SAN ANDRÉS, PROVIDENCIA) — la nomenclatura DANE no publica consulados; el exterior es convención E14 de la Registraduría
- `https://www.registraduria.gov.co/ (portal: puestos del exterior en PDF)` → referencia HUMANA (PDF) — el WAF del portal devuelve 403 a clientes no-navegador

### Referencias humanas

- https://e14segundavueltapresidente.registraduria.gov.co/ (visor oficial E14 — en navegador)
- https://www.registraduria.gov.co/ (portal: puestos del exterior en PDF)

### Condición de re-cruce

- **Obligatorio** si cambia el catálogo versionado (el script reporta DRIFT y
  sale en rojo) o al preparar cada release electoral: correr
  `bun scripts/cruzar-divipola.ts` (intenta la fuente en vivo) y, si el
  cruce está limpio, `--congelar` para mover la referencia.
- La validación ESTRUCTURAL (conteos, formato, unicidad) corre siempre — no
  depende de la red.
- Si la fuente oficial en vivo deja de responder (WAF/rotación de portal),
  el gate queda en la detección de drift contra este snapshot; actualizar la
  URL `url_maquina` requiere un nuevo congelamiento.

## Bloque máquina (no editar a mano — lo escribe `--congelar`)

```json
{
  "kind": "snapshot-divipola-exterior",
  "version": 1,
  "generado": "2026-11-16T06:26:45.793Z",
  "metodo": "cruce en vivo contra el bundle DIVIPOL del visor E14 de la Registraduría (departmentsTree.json, depto 88 CONSULADOS) + digests SHA-256 del catálogo versionado",
  "catalogo": {
    "archivo": "src/modules/supervision/data/divipola-exterior.json",
    "bytes": 189839,
    "sha256_raw": "bbb12832429e32ce8568aa2e6b0cc3b41f30ac50d0bf1ead3c9c48867d360ee4",
    "sha256_canonico": "bbb12832429e32ce8568aa2e6b0cc3b41f30ac50d0bf1ead3c9c48867d360ee4",
    "registros": 949,
    "paises": 67,
    "mesas": 3670
  },
  "fuente_oficial": {
    "nombre": "Visor ciudadano E14 2026 — Registraduría (bundle DIVIPOL del visor)",
    "url_maquina": "https://e14segundavueltapresidente.registraduria.gov.co/assets/temis/divipol_json/departmentsTree.json",
    "consultada": "2026-11-16T06:26:45.793Z",
    "sha256_extraccion_depto88": "bbb12832429e32ce8568aa2e6b0cc3b41f30ac50d0bf1ead3c9c48867d360ee4",
    "departamentos": 34,
    "registros_88": 949,
    "paises_88": 67,
    "mesas_88": 3670,
    "disponible_en_vivo": true
  },
  "referencias_humanas": [
    "https://e14segundavueltapresidente.registraduria.gov.co/ (visor oficial E14 — en navegador)",
    "https://www.registraduria.gov.co/ (portal: puestos del exterior en PDF)"
  ]
}
```
