# `native/` — sidecar nativo del E-14 (KIT `e14-ocr-nativo-v1`)

Lo que hace: corre en CPU nativa (ONNX Runtime de python) la parte más cara del
pipeline — OCR y, en modo *acta-completa*, también warp, b/n y sondeo de
orientación. La app web sigue haciendo su gate, score, dedup y envío; del
sidecar salen la imagen de presentación y el texto ya enderezado.

**Es una aceleración, nunca un requisito.** Flag apagado, sidecar mudo o
timeout ⇒ el pipeline WASM de siempre corre byte-idéntico (kill-switch).

## Por qué loopback y nada más

Los recortes son datos sensibles (actas con nombres, cédulas, mesas).
`ocrNativoUrl` solo acepta `http://127.0.0.1:<puerto>` — la validación vive en
`urlSidecarLocalValida` ([src/shared/e14/flags-schema.ts:152](file:///c/Users/JG/Documents/Qoder/2026-11-02/a8b531fd/supervision-e14/src/shared/e14/flags-schema.ts#L152))
y descarta cualquier otra URL. No expongas este servidor a la red.

Desde D81 el servidor también **elige a quién responde**: `origen_permitido()` deja
pasar loopback, el dominio de Pages del proyecto y `null`/vacío (el `file://`), y
cualquier otra página origin se queda sin `Access-Control-Allow-Origin`. Mientras el
sidecar fue herramienta local un `ACAO: *` era inofensivo; publicado el instalador,
un wildcard significa que cualquier sitio abierto en el navegador del visitante puede
encolar actas en su CPU y leer el texto. La lista se amplía con `E14_ORIGENES`
(separadas por coma) si montas la app en otro dominio.

Y manda `Access-Control-Allow-Private-Network: true`: desde un origen público https,
Chrome pre-vuela todo `fetch` hacia `http://127.0.0.1` con
`Access-Control-Request-Private-Network`; hoy es advertencia, mañana será corte. Sin
esa cabecera de respuesta, el sitio publicado deja de ver el sidecar sin explicación.

### H-44 — el token efímero de `/ocr` y `/acta`

El modelo anterior dejaba un hueco: loopback + CORS + LNA expulsan a la red y a las
páginas ajenas, pero cualquier **otro proceso local** del usuario podía hacer `POST` a
piel y encolar actas en su CPU. Desde H-44 (auditoría 2026-11-16, TRAY-C-07) los dos
endpoints de trabajo **exigen un token efímero**:

- Se genera al arrancar (`uuid.uuid4().hex`), se imprime junto al puerto y **muere con
  el proceso** — no se persiste ni viaja en archivo.
- Se acepta como header `x-sidecar-token: <hex>` (el camino del navegador, ya
  allowlistado en el preflight CORS) **o** como `?token=<hex>` en la URL del POST.
- Sin token o con token viejo → `401` con un JSON que dice cómo arreglarlo.
- `GET /salud` queda **sin token a propósito**: la tarjeta del panel lo sondea para
  detectar el acelerador y no conoce el token.

**Modelo de amenaza residual** (capas, de afuera hacia adentro): bind a `127.0.0.1`
(fuera de la red) → allowlist CORS `origen_permitido` (fuera las páginas ajenas) →
permiso LNA de Chrome 142+ (el visitante consiente el acceso a loopback) → token
efímero (fuera los demás procesos locales). Lo que queda: un proceso local con
permisos de **leer la consola del sidecar** también puede leer el token — a eso no
llega esta mitigación, y es el riesgo residual aceptado.

Ojo con el flujo del visitante: sin `?token=` en el override, `/salud` responde (la
tarjeta dirá `CPU`) pero los `POST` caen en `401` y las actas salen por WASM con un
log `POST /ocr 401` en consola. Reiniciar el sidecar **rota** el token: actualiza el
override o el lote vuelve a WASM.

## Distribución: el ZIP para el visitante

`127.0.0.1` es la máquina del visitante, nunca el servidor — o sea, publicado el sitio
solo vuela si EL VISITANTE corre esto. Como `python native/servidor.py` no es una frase
que un elector escriba, existe el empaquetado:

```bash
node scripts/empaquetar-sidecar.mjs   # → dist/supervision-e14-sidecar-win-x64.zip (~108 MiB)
```

Congela `native/` con PyInstaller (`--onedir`, NO `--onefile`: el un-archivo paga ~12 s
de descompresión a `%TEMP%` en CADA arranque por la misma descarga) y la vista CARGA
MASIVA ofrece el ZIP desde la tarjeta **ACELERADOR NATIVO**. Pasos para quien lo
descarga y procedimiento de release: `docs/RUNBOOK-sidecar-instalable-v1.md`.

## Arranque

```bash
pip install -r native/requirements.txt
python native/servidor.py                 # motor v5, puerto 8765, 2 sesiones
```

Qué debes ver (las tres líneas, tal como las imprime `servidor.py`):

```
[e14-nativo] sidecar en http://127.0.0.1:8765 · motor v5 · cls-lineas False · 2 sesión(es) × 2 hilos — calentando…
[e14-nativo] token  3f9c1a72…  (header x-sidecar-token o ?token= en POST /ocr y /acta)
[e14-nativo] LISTO (calentada en … ms)
```

La línea del **token** (H-44) es la llave de `/ocr` y `/acta`: cópiala entera para
configurar la app (ver abajo). La tercera línea es la que importa para el primer
lote: mientras no diga `LISTO`, el `/salud` ya responde pero la primera acta paga el
calentamiento del grafo. C-23 — la calentada usa las fixtures sintéticas vigentes
(`acta-sim-*.jpg`); si el clon no las tiene, arranca frío sin error y dirá
`LISTO (sin acta de ejemplo: no calentada)` —
en ese caso la PRIMERA acta paga el arranque frío (~13 s medidos en el informe
del sidecar) y las siguientes van calientes. Ver D81.

Opciones: `--motor v4|v5` · `--puerto 8765` · `--sesiones N` (los núcleos se
reparten entre ellas) · `--hilos N` · `--con-cls` (volteo 180° por línea, más
lento) · `--forzar` (arrancar aunque ya haya uno — **ralentiza el lote**, es el
error del bind duplicado en Windows).

Para probar el sidecar sin navegador: `python native/bench-acta.py` (mide el
`/acta` secuencial, como el relé de la app, sobre `assets/actas-demo`).

## Encenderlo en la app

El panel de dispositivo NO expone estas dos flags (expone el motor OCR). Se
encienden por la puerta oficial de overrides, en la consola del navegador:

```js
localStorage.setItem(
  "e14-flags-overrides",
  JSON.stringify({
    ocrNativoUrl: "http://127.0.0.1:8765?token=<el-hex-de-la-línea-[e14-nativo]-token>",
    actaNativa: true,
  }),
);
location.reload();
```

El `?token=` es el token efímero del arranque (H-44): el cliente lo pela de la URL y
lo manda como header `x-sidecar-token` en cada `POST /ocr` y `/acta`; el `/salud` de
la sonda no lo necesita. El validador de la flag solo acepta loopback con ese único
query — nada de rutas ni otros parámetros. **Cada reinicio del sidecar rota el
valor**: si el lote vuelve a WASM con `POST /ocr 401` en consola, actualiza el
override con la línea nueva. Para apagarlo:
`localStorage.removeItem("e14-flags-overrides")` y recargar.

Qué debes ver: `/salud` 200 en la pestaña de red y, en consola, las actas con
etapas nativas (el navegador deja de pagar det/rec WASM).

## Medido en el lote demo (6 actas reales, 4 núcleos, HD Graphics 520)

| Camino | Lote | Resultado |
| --- | --- | --- |
| 3 m 21 s | antes del KIT | referencia |
| **50-67 s** | sidecar nativo (`actaNativa`, D79) | 6/6 ENVIADAS, 0 rechazos, `lectura=FUERTE` en las 6 |
| **59-62 s** | navegador + WebGPU | 6/6 ENVIADAS, scores idénticos |
| 218 s | navegador SIN WebGPU | 1 RECHAZADA — no es opción |

El sidecar solo (sin navegador) hace el lote en **28,5 s** con `--sesiones 2`;
el lote completo vale lo que tarda la cola de esperas del navegador por detrás.
La varianza de la máquina es de ±14 s entre corridas idénticas (D79), así que
cualquier comparación se hace con 2-3 corridas back-to-back.

`--sesiones 1 --hilos 4` va PEOR por acta (6,31 s vs 4,75 s): el reconocedor
PP-OCRv5 no escala más allá de 2 hebras. Se queda el default `--sesiones 2`, que
además es lo que el relé de la app lee de `/salud` para saber cuántas actas
puede tener en vuelo.

Nativo gana ~8-10 % en este equipo, pero su ventaja real es el peor caso: no
depende del execution provider del navegador.

## Matriz de corrección rápida

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| Tarjeta en `CPU` pero el lote va a ritmo WASM y la consola dice `POST /ocr 401` | H-44 — falta el `?token=` en el override (o el sidecar se reinició y lo rotó) | copia la línea `[e14-nativo] token …` del arranque y actualiza `ocrNativoUrl` con `?token=` |
| `YA HAY un sidecar en …` | doble arranque (Windows permite el bind duplicado) | mata el PID viejo o usa `--puerto` distinto; **nunca** `--forzar` para medir |
| Números 2-3× peores sin tocar código | máquina saturada u otro agente compilando | `python native/bench-acta.py` solo; compara A/B back-to-back antes de sentenciar |
| Acta en `ERROR` con `CANNOT RUN INFERENCE. INVALID SESSION ID` | sesión ORT compartida muerta por el watchdog de otra acta | ya se reintenta sola ([runner.ts:1453](file:///c/Users/JG/Documents/Qoder/2026-11-02/a8b531fd/supervision-e14/src/modules/digitalizador/lib/e14/masiva/runner.ts#L1453)); si persiste, baja `poolWorkers` a 1 |
| `/salud` no responde | sidecar caído o puerto distinto al flag | rearranca; revisa que el flag apunte al mismo `--puerto` |
| `no encuentro la raíz del proyecto` | `public/models/rapidocr` fuera de sitio | arranca desde el repo o apunta `E14_REPO` / `E14_MODELS` |
