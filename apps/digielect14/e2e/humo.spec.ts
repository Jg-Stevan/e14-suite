/**
 * R-36 (hueco compartido §6.2 + H-50, auditoría 2026-11-16) — HUMO E2E del
 * golden path en navegador real: NADIE había abierto la app ni recorrido
 * captura→OCR→envío fuera de jsdom. Este spec lo recorre una vez por vía,
 * con el presupuesto de cámara documentado abajo (D-6 del plan).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PRESUPUESTO DE CÁMARA (D-6 — qué cubre cada vía y qué NO)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * El golden path REAL usa la CÁMARA del dispositivo. En E2E headless NO hay
 * cámara física: Chromium se lanza con `--use-fake-device-for-media-stream`
 * `--use-fake-ui-for-media-stream` (playwright.config.ts) y sirve un video
 * SINTÉTICO (señal verde animada), auto-aceptando el permiso.
 *
 *   · VÍA CÁMARA (fake) — cubre: permisos aceptados, getUserMedia OK, stream
 *     vivo en el <video> del visor y el frame loop de detección corriendo
 *     (chip ACTA DETECTADA/NO DETECTADA), sin crash. NO cubre: OCR de un
 *     acta real (la señal verde no es un acta) ni el pipeline de captura.
 *
 *   · VÍA ARCHIVO (SUBIR) — cubre: el pipeline COMPLETO sin cámara. El input
 *     file oculto de ESCANEAR recibe una fixture sintética del repo y la app
 *     recorre tope de importación → detección → recorte → realce → calidad →
 *     OCR real (ONNX/tessdata que descarga al primer uso) → gate → REVISIÓN.
 *     Es la vía que EJERCE el motor de punta a punta en navegador.
 *
 *   · CÁMARA REAL de dispositivo físico — queda como validación de campo
 *     (ver docs/archivo/REPORTE-validacion-dispositivo-a56-2026-11-09.md y
 *     REPORTE-validacion-dispositivo-a13-2026-11-09.md): el E2E no la
 *     reemplaza ni lo pretende.
 *
 * FIXTURE: src/assets/acta-sim-extra-1.jpg — es byte-idéntica a la imagen
 * «Normal» de la galería de simulación (sim-normal.jpg, md5 9df0a513…): acta
 * completa, bien encuadrada y legible. La subimos por el INPUT FILE (fuente
 * ARCHIVO), NO por la galería SIM: así el pipeline corre SIN score inyectado
 * (el gate decide solo) y sin el guard D6 que excluye las actas SIM del
 * puente. El directorio de fixtures está congelado archivo por archivo
 * (sin-relleno-produccion.test.ts): esta spec NO añade fixtures y las cita
 * solo como datos de prueba (e2e/ queda fuera del walk anti-relleno).
 *
 * Flujo firmado: la LÓGICA de envío (cola, re-firma S-1, falla-cerrado sin
 * clave de jornada, kill local) ya está codificada en vitest
 * (src/lib/e14/puente/envio.test.ts). Aquí se verifica la PRESENCIA del
 * contrato en la UI: la tarjeta PUENTE A SUPERVISIÓN de RESUMEN y el estado
 * falla-cerrado VISIBLE (sin clave de jornada → el botón SINCRONIZAR AHORA
 * responde «provisiona la clave de jornada para enviar» y la cola queda
 * intacta). Para eso se siembra UNA entrada en el outbox IndexedDB del
 * puente (misma forma que escribe encolarActa) — sin red: el check de clave
 * ocurre ANTES del fetch, así que la vía es determinística y offline.
 *
 * UMBRALES: el OCR real tarda (primer uso = descargar/compilar WASM:
 * OpenCV ~10,4 MB + onnxruntime + PP-OCRv4 ~16 MB + tessdata ~1,1 MB). La
 * espera del desenlace es de 120 s — alineada con el watchdog del propio
 * store (que corta un análisis estancado a los 120 s): si el pipeline no
 * resuelve en ese plazo, el golden path está roto en ese entorno y el humo
 * DEBE quedar rojo. test.slow() triplica los timeouts del caso.
 *
 * Selectores: SOLO role/text/aria-label — nada de clases CSS volátiles.
 * Contexto POR TEST (aislamiento total de localStorage/IndexedDB — cada caso
 * parte de una instalación virgen, como el primer arranque del operador).
 */
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

/** Fixture sintética del repo (ver cabecera — byte-idéntica a sim-normal.jpg). */
const FIXTURE_ACTA = join(
  __dirname,
  "..",
  "src",
  "assets",
  "acta-sim-extra-1.jpg",
);

/** Segundos que la app tiene para resolver el pipeline completo. */
const TIMEOUT_PIPELINE_MS = 120_000;

/**
 * Abrir la app en un contexto determinista:
 *  · e14-ayuda-vista=1 — el overlay de primera visita NO salta (Task 4 lo
 *    abre en el primer arranque; cerrarlo por UI en cada test sería ruido).
 *  · SIN e14-clave-jornada y SIN e14-puente-url — precondiciones del
 *    falla-cerrado: hub de producción por defecto y clave sin provisionar.
 */
function abrirApp(page: Page): Promise<unknown> {
  page.on("console", (m) => {
    if (m.type() === "error") {
      test.info().annotations.push({
        type: "console-error",
        description: m.text().slice(0, 300),
      });
    }
  });
  void page.addInitScript(() => {
    try {
      localStorage.setItem("e14-ayuda-vista", "1");
      localStorage.removeItem("e14-clave-jornada");
      localStorage.removeItem("e14-puente-url");
    } catch {
      /* modo privado: la ayuda no auto-abre y no hay clave — mismo efecto */
    }
  });
  return page.goto("/");
}

// ─── Carga ──────────────────────────────────────────────────────────────────

test.describe("R-36 — humo del golden path (digielect14)", () => {
  let erroresPagina: string[] = [];

  test.beforeEach(async ({ page }) => {
    erroresPagina = [];
    // FATAL: una excepción NO manejada en la página rompe el caso (el humo
    // existe justamente para cazar pantallas blancas mudas).
    page.on("pageerror", (e) => erroresPagina.push(String(e)));
  });

  test.afterEach(() => {
    // Se evalúa AL FINAL del caso: los pageerror de cualquier momento del
    // flujo (carga, cámara, pipeline, puente) revientan el test.
    expect(
      erroresPagina,
      `excepciones no manejadas en la página: ${erroresPagina.join(" | ")}`,
    ).toEqual([]);
  });

  test("carga — la app abre con la navegación y el visor de captura", async ({
    page,
  }) => {
    await abrirApp(page);

    // Shell vivo: navegación principal (BottomNav en móvil) con ESCANEAR activo.
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    await expect(nav).toBeVisible();
    await expect(
      nav.getByRole("button", { name: "ESCANEAR" }),
    ).toHaveAttribute("aria-current", "page");

    // Vista de captura montada: el obturador documental del visor.
    await expect(
      page.getByRole("button", { name: "Capturar fotografía del acta E-14" }),
    ).toBeVisible();
  });

  // ─── Cámara (vía fake — presupuesto D-6) ──────────────────────────────────

  test("cámara fake — permisos, stream vivo y frame loop sin crash", async ({
    page,
  }) => {
    await abrirApp(page);

    // La vista de captura arranca la sesión de cámara (fuente por defecto
    // CAMARA). Con --use-fake-ui-for-media-stream el permiso se auto-acepta.
    const video = page.getByLabel("Vista previa de la cámara");
    await expect(video).toBeAttached({ timeout: 30_000 });

    // Stream FLUYENDO de verdad (no solo elemento montado): el navegador
    // decodificó frames (videoWidth > 0). Si getUserMedia hubiera fallado,
    // este poll se cuelga y el aviso §E «No podemos acceder a tu cámara»
    // sería lo primero que aparecería en la traza.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const v = document.querySelector<HTMLVideoElement>(
              'video[aria-label="Vista previa de la cámara"]',
            );
            return v ? v.videoWidth : 0;
          }),
        { message: "el video del visor nunca decodificó frames (videoWidth=0)" },
      )
      .toBeGreaterThan(0);

    // Frame loop de detección VIVO (corre solo con cámara viva): el chip de
    // estado del HUD. Con la señal verde sintética lo esperado es NO
    // DETECTADA — que el chip exista YA prueba permiso+stream+captura de
    // frames por segundo del loop, sin crash (el presupuesto de esta vía).
    await expect(
      page.getByText(/^(ACTA DETECTADA|NO DETECTADA)$/),
    ).toBeVisible({ timeout: 30_000 });

    // Con la cámara viva, el overlay de error de permiso NO puede estar:
    // aserción negativa evaluada DESPUÉS de las positivas (si corría antes
    // pasaría de inmediato por no existir el nodo — trampa conocida).
    await expect(
      page.getByText("No podemos acceder a tu cámara"),
    ).not.toBeVisible();
  });

  // ─── Pipeline completo vía ARCHIVO ────────────────────────────────────────

  test("pipeline vía ARCHIVO — fixture → OCR real → gate → REVISIÓN", async ({
    page,
  }) => {
    test.slow(); // primer uso: descarga+compilación de WASM/ONNX/tessdata
    await abrirApp(page);

    // El input file OCULTO del dock (aria-label «Importar imagen») acepta la
    // fixture sintética. La app la pasa por el tope de importación y dispara
    // el análisis: fuente ARCHIVO, SIN score inyectado (el gate decide solo).
    await page
      .locator('input[type="file"][aria-label="Importar imagen"]')
      .setInputFiles(FIXTURE_ACTA);

    // Estado intermedio ANALIZANDO (beacon del motor): NO se exige atraparlo
    // (en una máquina rápida + piso escénico de 300 ms podría pasar rápido),
    // pero se intenta dejar constancia en el reporte.
    await page
      .getByText("PROCESANDO MOTOR OCR")
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() =>
        test
          .info()
          .annotations.push({ type: "pipeline", description: "ANALIZANDO observado" }),
      )
      .catch(() =>
        test
          .info()
          .annotations.push({
            type: "pipeline",
            description: "ANALIZANDO no alcanzado a observar (rápido)",
          }),
      );

    // Desenlace UNIVERSAL: TODOS los veredictos del gate (ENVIADA /
    // ADVERTENCIA / RECHAZADA / EN_REVISION_HUMANA) terminan en REVISIÓN con
    // sus CTAs. Espera generosa: el OCR real de la fixture manda. .first():
    // en ADVERTENCIA/RECHAZADA con candado hay DOS CTAs a la vez (REPETIR +
    // «Enviar esta acta a revisión humana») y ambos matchean la unión — sin
    // .first() el modo estricto de Playwright revienta por ambigüedad.
    const ctaRevision = page
      .getByRole("button", {
        name: /SEGUIR ESCANEANDO|REPETIR|REVISIÓN HUMANA|VOLVER AL ESCÁNER/,
      })
      .first();
    await expect(ctaRevision).toBeVisible({ timeout: TIMEOUT_PIPELINE_MS });

    // El pipeline produjo un acta real: la foto procesada del visor de
    // REVISIÓN (alt del ZoomableVisor — «Foto real/original del acta…»).
    await expect(
      page.getByAltText(/^Foto (real|original) del acta/),
    ).toBeVisible();

    // Veredicto del gate visible en la píldora del TopBar (cualquiera de los
    // cinco estados canónicos — el humo no predice el score de la fixture).
    await expect(
      page.getByText(
        /^(ÓPTIMA|ENVIADA CON ADVERTENCIA|ADVERTENCIA|RECHAZADA|REVISIÓN HUMANA)$/,
      ),
    ).toBeVisible();
  });

  // ─── Contrato del puente (presencia + falla-cerrado visible) ─────────────

  test("RESUMEN — tarjeta PUENTE A SUPERVISIÓN y falla-cerrado sin clave", async ({
    page,
  }) => {
    await abrirApp(page);

    // Navegar a RESUMEN por la barra inferior (flujo del operador).
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("button", { name: "RESUMEN" })
      .click();
    await expect(page.getByText("RESUMEN DE TRABAJO")).toBeVisible();

    // PRESENCIA del contrato: la tarjeta del puente (KIT e14-puente-
    // supervision-v1 §7) con su estado y su acción manual.
    const tarjeta = page.locator("section", {
      hasText: "PUENTE A SUPERVISIÓN",
    });
    await expect(tarjeta).toBeVisible();
    const botonSync = page.getByRole("button", {
      name: "Sincronizar ahora con el panel de supervisión",
    });
    await expect(botonSync).toBeVisible();

    // Sembrar UNA entrada en el outbox del puente (IndexedDB e14-puente-v1 —
    // misma fila que escribe encolarActa: {hash, entrada, ts, intentos}).
    // Sin cola pendiente el ciclo no intenta enviar y el falla-cerrado no
    // tiene nada que mostrar; con ella, el check de clave ocurre ANTES de
    // cualquier fetch → determinístico y offline.
    await page.evaluate(async () => {
      const entrada = {
        idEnlace: "88_495_010_02_001",
        mesa: "001",
        formulario: "TRANSMISION",
        paginaIndex: 1,
        paginaTotal: 2,
        srcFoto: null,
        impresion: {
          consulado: "E2E",
          pais: "E2E",
          zona: "010",
          puesto: "02",
          mesa: "001",
          lugar: "E2E",
        },
        nombreArchivo: "E14_88_495_010_02_001_TRANSMISION-1.png",
        score: 9.1,
        statusActa: "ENVIADA",
        tsEscaneo: Date.now(),
      };
      const fila = {
        hash: "e2e-r36-humo-puente-0001",
        entrada,
        ts: Date.now(),
        intentos: 0,
      };
      await new Promise<void>((resolver, rechazar) => {
        const req = indexedDB.open("e14-puente-v1", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("pendientes")) {
            req.result.createObjectStore("pendientes", { keyPath: "hash" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const store = db
            .transaction("pendientes", "readwrite")
            .objectStore("pendientes");
          const put = store.put(fila);
          // OJO: oncomplete vive en la TRANSACCIÓN (store.transaction), no en
          // el request del put — colgarlo del request jamás dispara.
          store.transaction.oncomplete = () => {
            db.close();
            resolver();
          };
          store.transaction.onerror = () => rechazar(store.transaction.error);
          store.transaction.onabort = () => rechazar(store.transaction.error);
          put.onerror = () => rechazar(put.error);
        };
        req.onerror = () => rechazar(req.error);
      });
    });

    // FALLA-CERRADO VISIBLE (0.1 del kit): sin clave de jornada provisionada
    // el puente NO envía a producción — la cola queda INTACTA y el feedback
    // de la tarjeta lo dice en palabras. (La lógica de re-firma/cola vive en
    // vitest; aquí el contrato visible.)
    await botonSync.click();
    const feedback = page.getByText(/provisiona la clave de jornada/);
    await expect(feedback).toBeVisible({ timeout: 30_000 });

    // Cola INTACTA: el mismo detalle reporta la entrada aún pendiente.
    await expect(
      page.getByText(/1 pendientes — provisiona la clave de jornada/),
    ).toBeVisible();
  });
});
