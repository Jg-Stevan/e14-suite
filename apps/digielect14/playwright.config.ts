/**
 * R-36 (hueco compartido §6.2 + H-50, auditoría 2026-11-16) — E2E de humo del
 * golden path en navegador real (Playwright + Chromium).
 *
 * Decisiones de la config (presupuesto D-6 del plan — ver e2e/humo.spec.ts
 * para el detalle de qué cubre cada vía):
 *
 *  · PUERTO 3111 — NO 3000: el dev server del día a día vive en 3000 (script
 *    `dev`); el webServer del E2E es OTRO proceso y no debe chocar con él.
 *    Se lanza `next dev` directo (sin `bun run dev`): el hook `predev`
 *    (`preparar`) ya materializó los assets del motor en public/ (onnx,
 *    tessdata, opencv — ver scripts/assets.lock.json); en CI el workflow los
 *    restaura del cache ANTES de esta corrida.
 *
 *  · CHROMIUM único — la app es una PWA de cámara pensada para Chrome/Edge
 *    (getUserMedia + ImageCapture + Wake Lock). Perfil Pixel 7 (móvil): es
 *    el factor de forma del operador (BottomNav + dock de captura — en lg+
 *    la BottomNav se oculta y cambiaría la navegación del spec). El
 *    proyecto define un solo proyecto "chromium" (los selectores del spec
 *    son role/text, no CSS).
 *
 *  · workers: 1, fullyParallel: false — la app es single-tab con cámaras y
 *    un store zustand por pestaña; dos páginas disparando getUserMedia y el
 *    pipeline OCR en paralelo solo añade flakiness (y el sandbox de Chromium
 *    del contenedor agradece un proceso a la vez).
 *
 *  · timeout 180 s / expect 15 s — el PRIMER load de la vista de análisis
 *    descarga y compila WASM (OpenCV ~10,4 MB + onnxruntime + PP-OCRv4
 *    ~16 MB + tessdata 1,1 MB). El spec del pipeline usa test.slow() y una
 *    espera explícita de 120 s (alineada con el watchdog del propio store,
 *    que corta el análisis estancado a los 120 s).
 *
 *  · launchOptions con --use-fake-device-for-media-stream y
 *    --use-fake-ui-for-media-stream — el presupuesto de cámara del E2E
 *    headless: Chromium sirve un video SINTÉTICO (señal verde animada) y
 *    auto-acepta el permiso. Suficiente para humo de permisos + stream +
 *    frame loop; NO valida OCR de un acta real (esa vía va por ARCHIVO).
 *
 *  · reuseExistingServer: fuera de CI reusa un 3111 vivo (iteración local
 *    rápida); en CI siempre lo levanta fresco.
 */
import { defineConfig, devices } from "@playwright/test";

const PUERTO = 3111;
const BASE = `http://127.0.0.1:${PUERTO}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e-reportes/html" }],
  ],
  outputDir: "e2e-reportes/artefactos",
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `bunx next dev -p ${PUERTO} -H 127.0.0.1`,
    url: BASE,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
