# RUNBOOK — sidecar instalable (KIT `e14-sidecar-instalable-v1`, D81)

Dos procedures en uno: **A** es para quien recibe el ZIP (el visitante del sitio
publicado), **B** es para el mantenedor cuando sale un release nuevo. La decisión y las
mediciones están en `docs/adr/README.md` → **D81**; acá solo hay pasos.

---

## A. Instalar el acelerador nativo (el visitante)

**Qué es:** un programa de Windows con el motor de OCR adentro. Le baja al lote de
6 actas de ~100 s a 40-58 s. **No es obligatorio**: sin él la app funciona igual,
solo que más lento, y nunca te va a bloquear por no tenerlo.

### A.1 Descargar

En la vista **CARGA MASIVA**, columna izquierda, debajo del botón `DEMO ×6`, está
el bloque **ACELERADOR NATIVO**. Si tu máquina no tiene el sidecar, el bloque dice
`WASM` y aparece `DESCARGAR ZIP (≈108 MiB)`.

Qué debes ver: el navegador descarga
`supervision-e14-sidecar-win-x64.zip` (~108 MiB).

Si el bloque ya dice `CPU` con un `PID`, **no descargues nada** — ya lo tienes
corriendo.

### A.2 Descomprimir y ejecutar

1. Descomprime el ZIP **en una carpeta** (clic derecho → «Extraer todo…»). Queda
   una carpeta `supervision-e14-sidecar\` con un `.exe` adentro y ~240 MiB.
2. Ejecuta `supervision-e14-sidecar.exe`.
3. **SmartScreen te va a frenar** la primera vez, porque el binario va sin firmar
   (firmar cuesta un certificado de código y no se decidió pagarlo). El cuadro azul
   dice «No se permite ejecutar esta aplicación»: pulsa **Más información** y luego
   **Ejecutar de todas formas**.
4. Se abre una consola negra. **Déjala abierta** — esa ventana ES el sidecar; si la
   cierras, se apaga.

Qué debes ver (la primera vez tarda más porque Windows Defender está escaneando
240 MiB recién escritos):

```
[e14-nativo] sidecar en http://127.0.0.1:8765 · motor v5 · cls-lineas False · 2 sesión(es) × 2 hilos — calentando…
[e14-nativo] token  3f9c1a72…  (header x-sidecar-token o ?token= en POST /ocr y /acta)
[e14-nativo] LISTO (sin acta de ejemplo: no calentada)
```

`sin acta de ejemplo: no calentada` es **lo esperado** en el congelado: la foto de
calentamiento vive en `assets/actas-demo` y no viaja dentro del ZIP (D81). La primera
acta del lote paga ese recargo una vez.

La línea del `token` (H-44) es la llave de `/ocr` y `/acta`: cópiala — la necesitas
en A.3 para que las actas salgan de verdad por CPU nativa.

`/salud` empieza a contestar entre **5 y 15 s** la primera vez; en los arranques
siguientes, en **4,5-6,3 s**.

### A.3 Verificarlo desde la app

Vuelve a la pestaña del digitalizador. El bloque pasa solo de `WASM` a `CPU` (sondea
cada 15 s) — o pulsa **YA LO PUSE — REINTENTAR**, que salta esa espera.

Qué debes ver:

```
ACELERADOR NATIVO                                    CPU
MOTOR: v5   SESIONES: 2   PID: 12204   SONDEO: 682 ms
LISTO — LAS ACTAS SALEN POR CPU NATIVA
```

El `PID` que aparece es el proceso de la consola que dejaste abierta. Corre el lote
y en el informe de la corrida debe figurar `ocrNativo` con el motor.

**Token (H-44):** para que las actas salgan por el sidecar, el `ocrNativoUrl` de la
app necesita el token de la línea `[e14-nativo] token …`. En la consola del navegador
(del sitio del panel):

```js
localStorage.setItem(
  "e14-flags-overrides",
  JSON.stringify({ ocrNativoUrl: "http://127.0.0.1:8765?token=<el-hex-del-arranque>", actaNativa: true }),
);
location.reload();
```

Sin él la tarjeta igual dirá `CPU` (el `/salud` de la sonda no exige token) pero los
`POST` devuelven `401` y el lote sale por WASM con un `POST /ocr 401` en consola. Si
reinicias el sidecar, el token CAMBIA — actualiza el override.

### A.4 Matriz de corrección rápida (visitante)

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| Tarjeta en `CPU` pero el lote va a ritmo WASM (`POST /ocr 401` en consola) | H-44 — falta el `?token=` en el override, o el sidecar se reinició y lo rotó | copia la línea `[e14-nativo] token …` del arranque y actualiza `ocrNativoUrl` (ver A.3) |
| La tarjeta sigue en `WASM` aunque la consola está abierta | el ZIP se ejecutó en otro puerto, o SmartScreen lo bloqueó sin avisar | cierra la consola y vuelve a abrirla; mira que diga `8765` |
| `YA HAY un sidecar en http://127.0.0.1:8765` y se cerró | ya tenías otro corriendo (Windows permite el doble bind y reparte el tráfico: es MÁS lento) | cierra la consola vieja y deja UNA sola |
| La consola se cierra sola al instante | SmartScreen lo tumbó, o falta una .dll de Visual C++ | ejecuta de nuevo con «Ejecutar de todas formas»; si persiste, `Windows Terminal` → «Instalar» el *Visual C++ 2015-2022 Redistributable* |
| `no encuentro la raíz del proyecto (public/models/rapidocr)` | el ZIP se descomprimió a medias o moviste solo el `.exe` fuera de la carpeta | el `.exe` necesita a su lado la carpeta `_internal` entera; descomprime de nuevo |
| Antivirus avisa de un archivo sospechoso | binario sin firmar y empaquetado (PyInstaller es notorio en esto) | excepción/permitir en la carpeta; si quieres verificar, el SHA-256 está en la nota de la release |
| La app va IGUAL de lenta con el sidecar en `CPU` | el cuello se movió a `preOcrQrMs` (esperar la respuesta), no al OCR | es el comportamiento conocido (D79); el lote sigue cerrando antes, mira el `INFORME & TELEMETRÍA` |

**Desinstalar:** cerrar la consola. No deja nada instalado en el sistema (todo vive
en la carpeta donde descomprimiste). Borra la carpeta y listo.

---

## B. Publicar un release nuevo (el mantenedor)

El ZIP se construye **en Windows** (PyInstaller no cross-compila) y el workflow lo
publica como asset de una release `sidecar-v<versión>` en este repo privado. La
tarjeta NO baja de GitHub: el deploy del panel toma la última release
`sidecar-v*` no-prerelease, parte el ZIP en trozos de < 25 MiB y los sirve en
`https://supervision-e14.pages.dev/descargas/sidecar/`; la página los reensambla
en el navegador. La release nueva reemplaza a la anterior en el siguiente deploy,
sin tocar el código de la app.

### B.1 Localmente, antes de publicar

```bash
node scripts/empaquetar-sidecar.mjs              # venv + PyInstaller + arranca + ZIP
node scripts/empaquetar-sidecar.mjs --limpio     # si sospechas del venv o de build/
```

Qué debes ver, en este orden:

```
[empaquetar] pyinstaller 6.22.3
[empaquetar] C:\…\dist\supervision-e14-sidecar\supervision-e14-sidecar.exe · 239.5 MiB (onedir)
── verificar arrancando el .exe ────
[empaquetar] /salud en … ms · {"ok":true,"version":"e14-ocr-nativo-v1","motor":"v5","pid":…,"sesiones":2}
[empaquetar] C:\…\dist\supervision-e14-sidecar-win-x64.zip · 108.4 MiB
[empaquetar] OK · supervision-e14-sidecar · onedir · …
```

La verificación **arranca el .exe desde una carpeta temporal fuera del repo**. Que
responda `/salud` ya demuestra que los modelos del bundle aterrizaron (la rama
`sys._MEIPASS` de `e14nativo.py`); un `--add-data` roto no llega hasta acá.

`exit=1` con `✘ … MiB es sospechosamente chico` = faltan modelos o DLLs. No publiques.

### B.2 Publicar

1. Commit y push a `main` de lo que cambie de `native/` o del script.
2. Actions → **Release sidecar nativo** → *Run workflow* → `version` (semver, sin
   `v` — p. ej. `1.0.1`). Marca `prerelease` solo si NO quieres que la tarjeta lo
   sirva todavía: el deploy del panel filtra las releases prerelease.
3. El job tarda ~6-9 min (pip + análisis de PyInstaller + arranque + `Compress-Archive`).

Qué debes ver: una release `sidecar-v<versión>` con el asset
`supervision-e14-sidecar-win-x64.zip` y una nota que trae el SHA-256.

### B.3 Verificar el release

La release privada se verifica con `gh release view sidecar-v<versión> --json assets`;
el asset debe estar `uploaded` y pesar ~110 MB. La descarga pública se verifica
contra el manifiesto que deja el deploy:

```bash
curl -sS https://supervision-e14.pages.dev/descargas/sidecar/manifiesto.json \
  | jq '{archivo, bytes, sha256, partes:(.partes|length)}'
```

Debe devolver el nombre `supervision-e14-sidecar-win-x64.zip`, el tamaño del
asset y entre 5 y 6 partes. Unos KB arriba o abajo respecto al build local es
normal (la versión de Python del runner cambia qué .dll entran).
Descárgalo en una máquina limpia y corre la sección A. **Esa es la única prueba que
vale**: el runner de GitHub no tiene tu antivirus ni tu SmartScreen.

### B.4 Cambiar el nombre del asset (no lo hagas a mano)

El nombre es un contrato a tres bandas: la URL de la tarjeta, el ZIP que produce
`scripts/empaquetar-sidecar.mjs` y el `gh release upload` del workflow. Si cambias
uno, los otros dos se desalinean y el botón queda en un 404 **silencioso** — es un
link. `masiva/__tests__/acelerador-tarjeta.test.ts` lo comprueba leyendo los tres
archivos; fallará él solo.

Lo mismo con el puerto: `native/servidor.py --puerto` (8765) y la flag compilada
`ocrNativoUrl` tienen que coincidir, y `lib/e14/ocr/__tests__/nativo.test.ts` lee el
`.py` para fijarlo.

### B.5 Matriz de corrección rápida (mantenedor)

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| El workflow no aparece en Actions | el `.yml` no llegó a `main` | `git log --oneline -1 -- .github/workflows/sidecar-release.yml` |
| `gh: HTTP 404` al crear la release | `permissions: contents: write` ausente o el token sin alcance | el workflow ya lo declara; si lo editaste, revísalo |
| El job muere en `Compress-Archive` | `dist\supervision-e14-sidecar` no existe (el build falló antes) | mira el log del paso anterior; casi siempre es `--add-data` |
| `/salud` no contesta en el runner | otro proceso en 8799 o el exe abortó | el script imprime las últimas 2000 chars del stdout del exe al fallar |
| La página `/descargas/sidecar/` dice «todavía no está publicada» | el deploy no encontró una release `sidecar-v*` no-prerelease, o el asset cambió de nombre | publica la release y vuelve a correr el deploy del panel; mira `…/descargas/sidecar/manifiesto.json` |
| Arranque > 60 s y el job rojo | otra cosa: no el antivirus | el script vuelca la salida del exe; revisa si `e14nativo` está buscando `public/` (rama `_MEIPASS` tocada) |

### B.6 Prueba de origen (C-22 — plan 2026-11-11)

El sidecar rechaza con `403` EXPLÍCITO todo origen fuera de la allowlist
(lazo, `https://supervision-e14.pages.dev`, previsualizaciones de un nivel y
`E14_ORIGENES`). El caso que motiva la prueba: un iframe sandbox
(`allow-scripts`) de un sitio público manda `Origin: null` — antes pasaba,
ahora no. Con el sidecar corriendo en `127.0.0.1:8765`:

```bash
# → 403 {"error":"origen",...}: iframe sandbox de sitio público (Origin: null)
curl -i -X OPTIONS http://127.0.0.1:8765/salud -H "Origin: null"

# → 403: origen vacío (mismo trato que null)
curl -i http://127.0.0.1:8765/salud -H "Origin:"

# → 403: sitio ajeno
curl -i http://127.0.0.1:8765/salud -H "Origin: https://evil.example"

# → 200 + Access-Control-Allow-Origin: flujo legítimo (página publicada)
curl -si http://127.0.0.1:8765/salud -H "Origin: https://supervision-e14.pages.dev" | head -8

# → 200: dev local
curl -si http://127.0.0.1:8765/salud -H "Origin: http://localhost:3000" | head -8

# file:// de custodia del mantenedor: SOLO con allowlist explícito
E14_ORIGENES="null" python native/servidor.py   # → Origin: null pasa
python native/servidor.py                        # → Origin: null da 403
```

Criterio: los tres primeros dan `403` con cuerpo JSON y SIN cabeceras
permissivas (ni `Access-Control-Allow-Origin` ni
`Access-Control-Allow-Private-Network`); los dos siguientes dan `200`.
