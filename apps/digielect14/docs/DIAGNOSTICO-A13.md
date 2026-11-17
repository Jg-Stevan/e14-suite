# Diagnóstico de rendimiento — Samsung Galaxy A13 (SM-A135M)

> Fecha de medición: 2026-11-17. Medido sobre el aparato real por ADB/CDP y con
> el harness `.diag-secuencial.mjs` (export estático servido con COOP/COEP).
> Las 7 actas son simuladas (galería de la app, sintéticas por D86); no se usó
> ninguna acta real.
>
> Este informe es la base para una investigación independiente del problema de
> lentitud (~30–90 s/acta). Incluye ficha de recursos, tiempos por etapa,
> metodología reproducible y comandos de medición.

---

## 1. Ficha del dispositivo (leída del aparato)

| Recurso | Dato |
|---|---|
| Modelo / fingerprint | SM-A135M · `samsung/a13ub/a13:14/UP1A.231005.007/A135MUBSDDZB3` |
| Android | 14 (SDK 34), parche de seguridad 2026-02-05 |
| SoC | Samsung Exynos 850 (8× Cortex-A55, 546 MHz–2.002 GHz, **sin núcleos grandes**), GPU Mali-G52 MP1 |
| RAM | MemTotal 3.62 GiB (3.8 GB nominales); ~966 MB disponibles con Chrome abierto |
| Almacenamiento | 109 GB totales, 58 GB libres |
| **ABI / userland** | **32-bit**: `ro.zygote=zygote32`, `abilist=armeabi-v7a,armeabi`, `uname -m=armv8l` |
| **Memoria baja** | **`ro.config.low_ram=true`**, `dalvik.vm.heapsize=256m` |
| Navegador | Chrome 157.0.8103.78 (32-bit) |
| Pantalla | 1080×2408 @ 450 dpi |
| Batería / térmica (reposo) | 59 %, 29.6 °C, Thermal Status 0 (sin throttling) |
| Web platform | COOP/COEP OK → `crossOriginIsolated=true`, SharedArrayBuffer disponible |
| Tier calculado por la app | ALTO (`deviceMemory=4`, cores=8, 4G/WiFi) → **6 hilos wasm** |

Contraste con el A56 (SM-A566E): `deviceMemory=8`, 7.6 GB RAM, núcleos
grandes → misma acta de sombras: **10.8 s vs 42.5 s en el A13 (≈3.9×)**.

---

## 2. Por qué el A13 es lento (causas, por peso)

1. **Microarquitectura**: ocho Cortex-A55 a 2 GHz. Un A55 rinde ~⅓ de un
   núcleo grande moderno en cargas SIMD/wasm; aquí no existe un núcleo grande
   que absorba el trabajo.
2. **Chrome 32-bit**: aunque el silicio es ARMv8, el sistema entero es
   `zygote32`. Limita el espacio virtual a 4 GB por proceso (modelos ONNX +
   canvas + buffers compiten ahí) y deja sin optimizaciones de 64 bits.
3. **`low_ram=true` + heap 256 MB**: Android trata el equipo como gama baja y
   mata procesos agresivamente; cada reinicio del renderer paga recarga de
   modelos y precalentado.
4. **Los 6 hilos ya saturan los 8 A55** (medido 7.7/8 núcleos ocupados durante
   el rec con `/proc/stat`). Bajar a 3 hilos dio **+34 % de tiempo** y el mismo
   resultado: los hilos no son la palanca.
5. **Etapas dominantes** (A13): RapidOCR det+rec 11–25 s · Tesseract 6–15 s ·
   banda del sello 3.5–10 s · probe/orientación hasta 22 s en fotos duras.
6. **Variabilidad**: el costo depende del contenido (nº de cajas/líneas → lotes
   del rec), de si dispara la 2.ª pasada (1920/ROI), de si necesita banda, del
   fallback de orientación y de térmica/GC/reinicios del renderer.

---

## 3. Tiempos medidos (A13)

### Baseline (código anterior, harness local)

| acta | total | OCR | banda | 2.ª pasada | desenlace |
|---|---|---|---|---|---|
| normal | 40.3 s | 25.0 | 10.15 | no | 8.5 ÓPTIMA · auto |
| color | 37.0 s | 24.5 | 9.33 | no | 10.0 ÓPTIMA · auto |
| rotada | 28.2 s | 14.6 | – | no | 10.0 ÓPTIMA · auto |
| inclinada | 96.0 s | 46.8 | 4.71 | no | 8.5 REVISIÓN HUMANA |
| sombras | 63.1 s | 33.2 | – | no | 8.5 ÓPTIMA · auto |
| recorte-inferior | 53.8 s | 22.7 | – | no | 7.9 ADVERTENCIA |
| recorte-superior | 84.4 s | 46.7 | 3.53 | sí (1920+ROI) | 4.9 RECHAZADA |

### KIT e14-banda-rapida-v1 (banda con cap det 1280, sin cls, sin rescate)

7/7 actas con **mismo score, status, auto-envío e intentos**. Banda:
normal 10.15 → 7.84 s; color 9.33 → 7.48 s; inclinada 4.71 → 3.65 s;
recorte-superior 3.53 → 3.50 s.

A/B pareado intercalado ON→OFF→ON→OFF en la misma sesión (para separar la
ganancia de la varianza del aparato):

| ronda | flag | banda normal | banda color |
|---|---|---|---|
| 1 | ON (ambiente rápido) | 7.69 s | 7.65 s |
| 2 | OFF | 9.85 s | 11.03 s |
| 3 | ON | 9.42 s | 9.06 s |
| 4 | OFF | 10.23 s | 9.81 s |

ON gana las 4 comparaciones pareadas: −4 a −8 % (normal), −8 a −18 % (color).
Ganancia neta ~0.4–1.4 s/acta con banda. El costo restante está en el
decode/draw/encode del recorte, que el flag no toca.

### Producción: sombras A13 vs A56 (mismo pipeline)

| equipo | total | intento 1 (Tess) | RapidOCR 1280 | desenlace |
|---|---|---|---|---|
| A13 | 42.5 s | 8.2 s (SUGERIDA) | 14.8 s (AUTO) | 8.5 ÓPTIMA · auto |
| A56 | 10.8 s | 2.5 s (MANUAL) | 4.0 s (AUTO) | 8.5 ÓPTIMA · auto |

La diferencia de veredicto del intento 1 (SUGERIDA vs MANUAL) viene de píxeles
distintos (encoder JPEG de cada equipo) y no cambia la decisión final.

---

## 4. Dónde vive la telemetría

- **IndexedDB `e14-obs`**, store `eventos`, registros `tipo:"perf"`:
  - `datos.tiempos { totalMs, procesoMs, ocrMs }`
  - `datos.tramos { msProbe, msBanda, msSegundaPasada }`
  - `datos.lectura.intentos[{ paso, motor, validacion, ms }]`
  - `scoreFinal`, `status`, `metricas { sharpness, contrast, brightness }`
- **Informe de sesión** (`ReporteSesion`): añade `perfResumen` (p50/p95),
  `saludMuestras`, `hangResumen`, `hangPorOp`.

## 5. Reproducción sin el A13

1. `BUILD_STATIC=1 bun run build` en `apps/digielect14` (genera `out/`).
2. Servir `out/` con COOP/COEP: `bun .diag-server.ts` (puerto 3000).
3. `adb reverse tcp:3000 tcp:3000` en cualquier Android y abrir
   `http://localhost:3000`.
4. `E14_DEV=<serial> E14_URL=http://localhost:3000 bun .diag-secuencial.mjs salida.json`
   (Playwright por CDP; reinicia Chrome entre actas).
5. Para tocar knobs sin rebuild:
   `localStorage["e14-flags-overrides"] = JSON.stringify({...})`.

El entorno local es ~20–30 % más lento que producción; solo son válidas las
comparaciones relativas por etapa.

## 6. Hipótesis para investigación independiente (rankeadas)

1. **(Alta) OCR CPU-bound**: bajar píxeles/líneas. Palancas ya existentes:
   `ladoOcrPx`, `ocrRecCabecera`/`ocrRecPie`, `ocrRecAltura`/`ocrRecWmax`,
   detCap de la banda (probar 960).
2. **(Media) decode/draw/encode repetido** de la foto completa entre etapas
   (`loadImageMemo` mitiga; medir con Performance marks).
3. **(Media) 2.ª pasada en fotos duras**: 1920 + ROI suman 7–12 s cada una.
4. **(Media) reinicios del renderer por `low_ram`**: recarga de modelos y
   precalentado inflan el total percibido.
5. **(Baja en reposo) throttling térmico**: status 0 y 29.6 °C en reposo;
   medir `scaling_cur_freq` durante una corrida.

## 7. Comandos útiles

```sh
adb shell "getprop ro.config.low_ram; getprop ro.zygote; uname -m"
adb shell cat /proc/meminfo
adb shell "for c in /sys/devices/system/cpu/cpu[0-9]*; do cat \$c/cpufreq/scaling_cur_freq; done"
adb shell dumpsys thermalservice
adb shell dumpsys meminfo com.android.chrome
adb shell dumpsys battery
# Perfilado: chrome://inspect → target de la app → Performance
```
