# BUILD-REPRODUCIBLE — reconstruir y verificar el sidecar (R-42)

> Supply chain del binario distribuido (hueco compartido §6.8, auditoría
> 2026-11-16). Complementa a **R-08** (pines exactos en `requirements.txt`):
> R-08 fija qué ENTRA al build; esto define cómo se VERIFICA lo que sale.
> Procedimiento de release: `docs/RUNBOOK-sidecar-instalable-v1.md` §B.

## El contrato, dicho claro

**La reproducibilidad BIT A BIT de un bundle PyInstaller NO está garantizada
por diseño** — y este documento no finge lo contrario. Lo que sí existe es una
cadena de verificación de tres eslabones:

| Eslabón | Qué fija | Dónde vive |
|---|---|---|
| 1. Fuente | el árbol exacto que entró al build | tag `sidecar-v<versión>` de la release |
| 2. Dependencias | versiones EXACTAS medidas (`onnxruntime 1.31.1`, `opencv-python 5.0.0`, `numpy 2.5.4`, `pillow 12.3.0`) | `native/requirements.txt` (R-08) + modelos `.onnx` por URL+SHA-256 en `scripts/assets.lock.json` |
| 3. Binario distribuido | el SHA-256 del ZIP **tal como se publicó** | `SHA256SUMS.txt` y el cuerpo de la release (workflow `sidecar-release.yml`, R-42) — y el `manifiesto.json` del deploy, que parte el ZIP con el hash en los nombres de las partes |

El contrato verificable es: **MISMA fuente + MISMO requirements + hash publicado
del build oficial**. El binario que se distribuye es el que se hashea: lo que
el visitante descarga se puede comprobar contra el hash que el CI registró en
el momento de publicar, sin confiar en nada intermedio (ni en el deploy que
parte el ZIP — cada parte lleva el hash en el nombre y la página reensambla
byte a byte).

Un rebuild local NO va a dar el mismo hash (sección C). Lo que un rebuild
local demuestra es que la fuente + los pines producen un bundle equivalente:
mismo inventario de DLLs/pyd, tamaños en el rango esperado, `/salud` vivo.

## A. Verificar el binario que DESCARGASTE (lo que importa de verdad)

Esta es la verificación del contrato: lo que tienes en el disco contra el hash
que el CI registró al publicar. El SHA-256 está en el cuerpo de la release
`sidecar-v<versión>` y en su adjunto `SHA256SUMS.txt` (bájalo de la misma
release, en la misma carpeta que el ZIP).

```powershell
# Windows — PowerShell
Get-FileHash .\supervision-e14-sidecar-win-x64.zip -Algorithm SHA256
# Windows — cmd (copia el hash a mano, sin espacios)
certutil -hashfile supervision-e14-sidecar-win-x64.zip SHA256
```

```bash
# Git Bash (Windows) — con el SHA256SUMS.txt descargado al lado:
sha256sum -c SHA256SUMS.txt
# → supervision-e14-sidecar-win-x64.zip: OK

# macOS / Linux
shasum -a 256 supervision-e14-sidecar-win-x64.zip
```

La descarga pública del panel se verifica contra el manifiesto del deploy
(mismo hash, canal distinto):

```bash
curl -sS https://supervision-e14.pages.dev/descargas/sidecar/manifiesto.json \
  | jq '{archivo, bytes, sha256, partes:(.partes|length)}'
```

**Un mismatch aquí SÍ es hallazgo** (descarga corrupta, canal manipulado,
asset re-subido a mano): no ejecutes el binario, repórtalo por el canal privado
de `SECURITY.md`.

## B. Reconstruir localmente (auditar la cadena)

Requisitos: **Windows** (PyInstaller no cross-compila), **Python 3.14** en el
PATH (la versión con la que se midieron los pines de `requirements.txt`),
**Node ≥ 18** y `git`.

```bash
# 1. El árbol EXACTO del release (no main: el tag es el contrato del eslabón 1)
git checkout sidecar-v<versión>

cd apps/supervision-e14

# 2. Materializar los modelos .onnx (NO se versionan): los baja por la URL y
#    comprueba el SHA-256 de scripts/assets.lock.json. Sin esto el bundle
#    arranca sin det_v5_mobile.onnx y revienta en la primera acta.
node scripts/preparar-assets.mjs

# 3. Empaquetar: crea SU venv, instala requirements.txt (pines exactos) +
#    pyinstaller, congela --onedir y verifica el bundle estáticamente.
node scripts/empaquetar-sidecar.mjs

# 4. El hash local — NO tiene que salir el del paso A (sección C)
sha256sum dist/supervision-e14-sidecar-win-x64.zip
```

Qué verifica SOLO el empaquetador (sin que hagas nada):

- cada `.onnx` del bundle contra el SHA-256 de `scripts/assets.lock.json`;
- el piso de tamaño del bundle (90 MiB en onedir: un build al que le faltó el
  `--add-data` pesa la mitad y revienta en la máquina del visitante);
- si corres SIN `--sin-ejecutar`: arranca el .exe desde una carpeta temporal
  fuera del repo y exige `GET /salud` con `motor`, `sesiones`, `pid`,
  `version` (que arranque YA prueba que los modelos del bundle aterrizaron).

Y qué comparar contra la release (auditoría de equivalencia):

```bash
# El inventario del build oficial está adjunto a la release:
# INVENTARIO-BUNDLE.txt — dir recursivo con tamaños (R-42).
# Descárgalo y compara:
diff <(grep -v '^#' INVENTARIO-BUNDLE.txt) \
     <(cd dist && find supervision-e14-sidecar -type f -printf '%10s  %p\n' | sort -k2)
```

Diferencias esperadas entre tu build y el oficial: **ninguna en el inventario
de DLLs/pyd si la versión de Python coincide, y solo las que arrastra la
versión de Python si no** (el runner usa 3.12 — ver C.3). Una DLL que aparece
en tu build y no está en el inventario publicado (o un tamaño desbocado) es
hallazgo, no variación.

## C. Estado honesto: por qué el rebuild NO es bit a bit

1. **PyInstaller embebe timestamps y rutas del builder.** Los PEs del bundle
   (bootloader, exe) llevan la hora del build; el análisis arrastra rutas
   absolutas del runner (`D:\a\…`). Dos corridas del MISMO commit en el MISMO
   runner pueden diferir en bytes.
2. **`Compress-Archive` no es determinista entre corridas** (timestamps de los
   archivos dentro del ZIP): el hash del ZIP es aún más resbaladizo que el del
   bundle.
3. **La versión de Python arrastra DLLs distintas.** El runner de CI construye
   con **3.12** (decisión del workflow: «el runner debe producir el binario
   aburrido» — PyInstaller+opencv+onnxruntime sobre la 3.14 recién salida
   siguen con hooks en ajuste); los pines de `requirements.txt` se midieron
   sobre **3.14.7** local. Las wheels traen binarios distintos por versión de
   Python: los tamaños del inventario oficial y del local NO van a casar
   exacto.
4. **Reproducibilidad bit a bit real** exigiría SOURCE_DATE_EPOCH + builds
   deterministas de las wheels de onnxruntime/opencv — fuera del alcance de
   esta auditoría y declarado como no-perseguido.

Por eso el contrato es el de la tabla de arriba: el hash publicado ata **el
binario que se distribuye** al build oficial de CI. El rebuild local es
auditoría de equivalencia (fuente + pines → mismo contenido funcional), no
verificación de identidad.

## Ritual al actualizar un pin (R-08)

Medir con el lote demo (`native/bench-acta.py`, 2-3 corridas back-to-back —
la varianza de máquina es ±14 s), actualizar ESTE `requirements.txt`, correr
el empaquetado y registrar el SHA-256 del binario resultante en la release
(cruza con este documento). El detalle del pin viejo→nuevo queda en el commit;
el hash nuevo, en `SHA256SUMS.txt` de la release nueva.

## Referencias

- `native/requirements.txt` — pines exactos (R-08, auditoría 2026-11-16).
- `.github/workflows/sidecar-release.yml` — build de CI + `SHA256SUMS.txt` +
  `INVENTARIO-BUNDLE.txt` (R-42).
- `docs/RUNBOOK-sidecar-instalable-v1.md` §B — procedimiento de release y
  verificación del release.
- `docs/DEUDA.md` §12 — entrada de supply chain: qué quedó verificado y qué
  queda abierto (firma de código, bit a bit).
- `docs/adr/README.md` → **D81** (por qué ZIP onedir y no exe onefile) y
  **D79** (las mediciones que fijaron los pines).
