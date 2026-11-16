/**
 * R-29 (H-24) — RED DE CARACTERIZACIÓN del MODAL DE REVISIÓN (modal-revisor).
 *
 * El modal es el flujo de revisión humana del panel (~1.900 líneas) y NO tenía
 * ni un test directo. Sin testing-library en esta app NO se monta el
 * componente: se congela lo que SÍ es comprobable y lo que puede romperse en
 * silencio, con los TRES seams del repo (mismo patrón de acelerador-tarjeta
 * y masiva-caracterizacion):
 *
 *  A. HELPERS PUROS de la carpeta — pildoraEstadoActa (helpers.tsx, el chip
 *     de estado que pinta el panel del auditor), QUAD_POR_DEFECTO/clampPct
 *     (editor-recorte.ts, geometría del editor de perspectiva) y
 *     PublicacionChip (publicacion-chip.tsx, desenlace D27 — componente SIN
 *     hooks, renderizable estático).
 *  B. ANCLAS DE COMPORTAMIENTO (source-scan del propio modal-revisor.tsx):
 *     las invariantes documentadas en comentarios que, si alguien las mueve,
 *     revientan en silencio — orden de salida de Escape, motivo OBLIGATORIO
 *     y armado a 2 toques de RECHAZAR/ACEPTAR, ROTAR dual (hornea vs visual),
 *     guard de tamaño mínimo del recorte, reproyección de puntos al rotar,
 *     contraste biciclo NORMAL↔NEGATIVO y la honestidad de datos (score,
 *     código entre las X, PÁG -/-, barcode real — jamás inventar).
 *  C. CONTRATO DE PROPS — la lista exacta (+2 opcionales de navegación) y el
 *     degradado honesto (sin acta → null; sin onAceptar/onVerEnMonitor/onNavegar
 *     → el botón correspondiente NO se ofrece).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { pildoraEstadoActa } from "../helpers";
import { PublicacionChip } from "../publicacion-chip";
import { clampPct, QUAD_POR_DEFECTO } from "../editor-recorte";
import type { Acta } from "@/modules/digitalizador/lib/e14/types";
import type { PublicacionActa } from "@/modules/digitalizador/store/store-e14";

const FUENTE = readFileSync(
  join(import.meta.dir, "../modal-revisor.tsx"),
  "utf-8",
);

/** Acta mínima para los helpers que consumen Acta (mismos defaults honestos
 *  del acta-factory: título/ubicación «—», cero candidatos). */
function actaPrueba(status: Acta["status"]): Acta {
  return {
    id: "acta-test-1",
    titulo: "ACTA SIN IDENTIFICAR",
    ubicacion: {
      departamento: "—",
      municipio: "—",
      zona: "—",
      puesto: "—",
      mesa: "—",
    },
    tipo: "SENADO DE LA REPÚBLICA",
    pagina: null,
    candidatos: [],
    firmas: [],
    score: 7.5,
    status,
    rechazo: null,
    intento: 1,
    maxIntentos: 4,
  };
}

// ─── A. HELPERS PUROS DE LA CARPETA ─────────────────────────────────────────

describe("modal-revisor — helpers puros de la carpeta", () => {
  test("pildoraEstadoActa: los 6 estados del acta abierta → etiqueta y paleta del repo", () => {
    // El chip que pinta el panel del auditor. La etiqueta es lo que lee el
    // supervisor y la paleta es la semántica del design system (verde ok ·
    // ámbar advertencia · rojo rechazo · azul duplicada). Cambiar una de las
    // dos sin avisar es un cambio de UX silencioso.
    expect(pildoraEstadoActa(actaPrueba("ENVIADA"))).toEqual({
      label: "ENVIADA",
      clases: "border-emerald-500/60 text-emerald-300 bg-emerald-500/10",
    });
    expect(pildoraEstadoActa(actaPrueba("OPTIMA")).label).toBe("ÓPTIMA");
    expect(pildoraEstadoActa(actaPrueba("OPTIMA")).clases).toContain(
      "text-emerald-300",
    );
    expect(pildoraEstadoActa(actaPrueba("ADVERTENCIA"))).toEqual({
      label: "ADVERTENCIA",
      clases: "border-amber-400/60 text-amber-400 bg-amber-400/10",
    });
    expect(pildoraEstadoActa(actaPrueba("RECHAZADA"))).toEqual({
      label: "RECHAZADA",
      clases: "border-red-500/60 text-red-400 bg-red-500/10",
    });
    // e66: la gemela DUPLICADA pinta azul (el envío real vive en la original).
    expect(pildoraEstadoActa(actaPrueba("DUPLICADA"))).toEqual({
      label: "DUPLICADA",
      clases: "border-blue-400/60 text-blue-300 bg-blue-950/40",
    });
    // EN_REVISION_HUMANA → «REVISIÓN HUMANA» (etiqueta legible, no el enum).
    expect(pildoraEstadoActa(actaPrueba("EN_REVISION_HUMANA"))).toEqual({
      label: "REVISIÓN HUMANA",
      clases: "border-amber-400/60 text-amber-400",
    });
  });

  test("editor-recorte: QUAD_POR_DEFECTO nace con margen del 10% (8 handles visibles) y clampPct encierra a [0,100]", () => {
    // El editor arranca SIEMPRE con el quad al 10% por lado — si alguien
    // cambia el margen, el primer APLICAR sin mover nada recorta distinto.
    expect(QUAD_POR_DEFECTO).toEqual({
      tl: { x: 10, y: 10 },
      tr: { x: 90, y: 10 },
      br: { x: 90, y: 90 },
      bl: { x: 10, y: 90 },
    });
    // clampPct es el guard de TODA la geometría del editor (arrastres,
    // reproyección al rotar): fuera de rango → borde, nunca NaN ni negativos.
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(0)).toBe(0);
    expect(clampPct(42.5)).toBe(42.5);
    expect(clampPct(100)).toBe(100);
    expect(clampPct(140)).toBe(100);
  });

  test("PublicacionChip: sin publicación NO pinta nada (no hay desenlace que contar)", () => {
    const html = renderToStaticMarkup(createElement(PublicacionChip));
    expect(html).toBe("");
  });

  test("PublicacionChip: los 5 desenlaces D27 con SU texto fijo (honestidad ante todo)", () => {
    const pintar = (p: PublicacionActa) =>
      renderToStaticMarkup(createElement(PublicacionChip, { publicacion: p }));
    expect(pintar({ estado: "publicando" })).toContain(
      "PUBLICANDO EN EL MONITOR…",
    );
    expect(pintar({ estado: "publicada", clave: "88_495_010_02::001" })).toContain(
      "PUBLICADA EN EL MONITOR · 88_495_010_02::001",
    );
    expect(pintar({ estado: "duplicada" })).toContain(
      "DUPLICADA — MISMO CONTENIDO YA RECIBIDO · NO SE REPROCESA",
    );
    // Cuarentena D25: el motivo viaja cuando existe y cae al honesto
    // «validación fallida» cuando no.
    expect(pintar({ estado: "bloqueada", motivo: "mesa no coincide" })).toContain(
      "CUARENTENA (D25) — mesa no coincide",
    );
    expect(pintar({ estado: "bloqueada" })).toContain(
      "CUARENTENA (D25) — validación fallida",
    );
    expect(pintar({ estado: "sin-join" })).toContain(
      "SIN PUBLICAR EN EL MONITOR — SOLO REGISTRO LOCAL (SIN CLASIFICACIÓN AUTO)",
    );
  });
});

// ─── B/C. CARACTERIZACIÓN DEL MODAL POR ANCLAS (source-scan) ────────────────

describe("modal-revisor — anclas de comportamiento (source-scan)", () => {
  test("contrato de props intacto (+2 opcionales de navegación) y export memo", () => {
    // El kit visor-masida-redesign-v1 promete «contrato de props intacto»:
    // esta es la lista exacta que el orquestador alimenta. Quitar/renombrar
    // una prop rompe el orquestador en silencio (TS lo pilla, el build no).
    for (const prop of [
      "acta",
      "publicacion",
      "onVerEnMonitor",
      "onCerrar",
      "posNavegacion",
      "onNavegar",
      "cargarOriginal",
      "onAceptar",
    ]) {
      expect(FUENTE).toContain(`  ${prop},`);
    }
    expect(FUENTE).toMatch(
      /onNavegar\?: \(direccion: -1 \| 1\) => void;/,
    );
    // Sin acta abierta el modal NO renderiza nada (bandeja cierra).
    expect(FUENTE).toContain("if (!acta) return null;");
    // memo: el modal vive dentro de MasivaView (suscriptor de filas/progreso)
    // — sin memo, CUALQUIER vida de fondo re-renderizaba ~1000 nodos.
    expect(FUENTE).toContain("export const ModalRevisor = memo(ModalRevisorBase);");
  });

  test("Escape — orden de salida documentado: pantalla completa → EDITOR (cancela) → cierra el modal", () => {
    // El orden es una invariante de UX: Escape con el editor abierto JAMÁS
    // cierra el modal (pierde el contexto del supervisor) — primero sale de
    // pantalla completa, luego cancela el editor sin tocar nada, al final
    // cierra. Si alguien reordena los guards, este ancla revienta.
    expect(FUENTE).toMatch(
      /if \(expandidoRef\.current\) \{\s*setExpandido\(false\);\s*return;\s*\}\s*if \(editandoRef\.current\) \{\s*setEditandoRecorte\(false\);\s*setPuntos\(null\);\s*setHintEditor\(null\);\s*return;\s*\}\s*onCerrar\(\);/,
    );
  });

  test("RECHAZAR — motivo OBLIGATORIO + armado a 2 toques + parche SUPERVISOR + avance al siguiente", () => {
    // Rechazar sin motivo es una decisión sin evidencia (auditoría): el
    // textarea vacío marca errorMotivo y NO arma la confirmación.
    expect(FUENTE).toMatch(
      /const motivo = observaciones\.trim\(\);\s*if \(!motivo\) \{\s*setErrorMotivo\(true\);\s*setRechazoArmado\(false\);\s*return;\s*\}/,
    );
    // El rechazo NUNCA es accidental: primer toque arma, segundo confirma.
    expect(FUENTE).toMatch(
      /if \(!rechazoArmado\) \{\s*setRechazoArmado\(true\);\s*return;\s*\}/,
    );
    // El acta ya rechazada no se re-rechaza (botón deshabilitado + guard).
    expect(FUENTE).toMatch(/if \(!acta \|\| acta\.status === "RECHAZADA"\) return;/);
    // El parche del acta abierta: status RECHAZADA + rechazo SUPERVISOR con
    // el motivo — la persistencia la hace sincronizarAlVolver al cerrar.
    expect(FUENTE).toContain(
      'const rechazo = { tipo: "SUPERVISOR", detalle: motivo } as const;',
    );
    expect(FUENTE).toMatch(
      /useE14Store\.getState\(\)\.editarActaActual\(\{\s*status: "RECHAZADA",\s*rechazo,\s*\}\);/,
    );
    // Balde de motivos (misma maquinaria del adaptador).
    expect(FUENTE).toMatch(/\.contarMotivoNoEnvioActa\(\{ \.\.\.acta, status: "RECHAZADA", rechazo \}\)/);
    // Flash de confirmación → avance al siguiente acta del lote (1200 ms).
    expect(FUENTE).toMatch(
      /timerRechazoRef\.current = setTimeout\(\(\) => \{\s*timerRechazoRef\.current = null;\s*setRechazoHecho\(false\);\s*onNavegar\?\.\(1\);\s*\}, 1200\);/,
    );
  });

  test("ACEPTAR — mismo régimen que el rechazo: motivo obligatorio (T5), 2 toques, desarme a 3 s y guard ENVIADA", () => {
    // T5 (decisión 6 del mantenedor): motivo OBLIGATORIO también al ACEPTAR.
    expect(FUENTE).toMatch(
      /if \(!observaciones\.trim\(\)\) \{\s*setErrorMotivo\(true\);\s*setAceptarArmado\(false\);\s*return;\s*\}/,
    );
    // Armado a 2 toques + desarme solo del armado a los 3 s.
    expect(FUENTE).toMatch(/if \(!aceptarArmado\) \{\s*setAceptarArmado\(true\);\s*return;\s*\}/);
    expect(FUENTE).toMatch(
      /window\.setTimeout\(\(\) => setAceptarArmado\(false\), 3000\)/,
    );
    // Ya enviada — nada que aceptar (el botón además no se ofrece).
    expect(FUENTE).toContain('if (acta.status === "ENVIADA") return; // ya enviada — nada que aceptar');
    // El envío real del lote: onAceptar → registrarEnvioMasiva. Si devuelve
    // false (sin fila abierta / envío en curso) NO hay flash — honesto.
    expect(FUENTE).toMatch(
      /const ok = await onAceptar\(\);\s*if \(!ok\) return; \/\/ sin fila abierta \/ envío en curso — honesto, sin flash/,
    );
    // ACEPTAR solo se ofrece en actas SIN envío automático no enviadas.
    expect(FUENTE).toMatch(
      /\{onAceptar && !enviadaAuto && acta\.status !== "ENVIADA" && \(/,
    );
  });

  test("ACEPTAR — la corrección manual se hornea SOLO si el supervisor editó algo y el acta trae clasificación", () => {
    // Sin clasificación no hay códigos reales que corregir: la ubicación
    // textual degradada NO se toca (honestidad — jamás inventar).
    expect(FUENTE).toContain(
      "if (huboEdicionManual && datosManual && acta.clasificacion) {",
    );
    // patchManual marca la transparencia de la corrección.
    expect(FUENTE).toMatch(
      /setDatosManual\(\(prev\) => \(prev \? \{ \.\.\.prev, \.\.\.p \} : prev\)\);\s*setHuboEdicionManual\(true\);/,
    );
    // Kit paginas-acta-e14-v1: el total horneado es el del ACTA (2 hojas),
    // NUNCA el total dudoso del OCR ni el del lote.
    expect(FUENTE).toContain("const totalPaginas = PAGINAS_POR_ACTA_E14;");
  });

  test("ROTAR — dual por editabilidad: actas manuales HORNEAN 90°, enviadas auto solo giran la VISTA", () => {
    // Enviada auto: rotación VISUAL (ayuda de lectura, no persiste).
    expect(FUENTE).toMatch(
      /if \(!editable\) \{\s*setRotacionVisual\(\(r\) => \(r \+ 90\) % 360\);\s*return;\s*\}/,
    );
    // Editable: horneado real por canvas → editarActaActual (chip EDITADA).
    expect(FUENTE).toMatch(
      /const r = await rotateProcessedDataUrl\(foto, 90\);\s*useE14Store\.getState\(\)\.editarActaActual\(\{ fotoProcesada: r\.url \}\);/,
    );
    // La oferta del editor depende de EXACTAMENTE esto: acta viva + sin envío
    // automático + foto (enviadas auto NO se editan).
    expect(FUENTE).toContain(
      "const editable = Boolean(acta && !acta.enviadoAutomaticamente && foto);",
    );
    expect(FUENTE).toMatch(/\{editable && !editandoRecorte && \(/);
  });

  test("editor — guard de tamaño mínimo del recorte: bbox ≥ 3% en CADA eje o APLICAR no hace nada", () => {
    // RECT_MIN_PCT evita recortes absurdos (mismo guard del editor anterior):
    // el botón APLICAR nace deshabilitado hasta que el quad es válido.
    expect(FUENTE).toContain("const RECT_MIN_PCT = 3;");
    expect(FUENTE).toMatch(/if \(bb\.w < RECT_MIN_PCT \|\| bb\.h < RECT_MIN_PCT\) return;/);
    expect(FUENTE).toMatch(
      /const recorteValido = Boolean\(\s*bbQuad && bbQuad\.w >= RECT_MIN_PCT && bbQuad\.h >= RECT_MIN_PCT,\s*\);/,
    );
    expect(FUENTE).toMatch(/disabled=\{!recorteValido \|\| !!ocupado\}/);
  });

  test("editor — al rotar DENTRO del editor los 8 puntos se re-proyectan ((x,y) → (100−y, x); la vieja BL pasa a TL)", () => {
    // El quad sigue al giro de la foto horneada: sin esta reproyección los
    // handles quedarían sobre coordenadas ya giradas (recorte torcido).
    expect(FUENTE).toMatch(
      /tl: \{ x: clampPct\(100 - q\.bl\.y\), y: clampPct\(q\.bl\.x\) \},\s*tr: \{ x: clampPct\(100 - q\.tl\.y\), y: clampPct\(q\.tl\.x\) \},\s*br: \{ x: clampPct\(100 - q\.tr\.y\), y: clampPct\(q\.tr\.x\) \},\s*bl: \{ x: clampPct\(100 - q\.br\.y\), y: clampPct\(q\.br\.x\) \},/,
    );
  });

  test("editor — DESHACER devuelve la foto de ANTES de la primera edición y deja el quad por defecto", () => {
    // La foto pre-edición se congela en fotoPreEdicionRef ANTES del primer
    // bake; DESHACER la restaura, apaga el chip EDITADA y re-arma el quad
    // inicial (el editor sigue abierto).
    expect(FUENTE).toMatch(
      /useE14Store\.getState\(\)\.editarActaActual\(\{ fotoProcesada: original \}\);\s*setEditada\(false\);\s*fotoPreEdicionRef\.current = null;\s*setPuntos\(QUAD_POR_DEFECTO\);/,
    );
    // Deshabilitado si no hay ediciones que deshacer.
    expect(FUENTE).toMatch(/disabled=\{!editada \|\| !!ocupado\}/);
  });

  test("DETECCIÓN AUTOMÁTICA — SOLO PROPONE: hints honestos y los puntos SOLO cambian con detección válida", () => {
    // La detección es una propuesta, nunca un hecho: con quad propuesto el
    // hint manda a REVISAR Y CONFIRMAR; sin detección el hint es honesto y
    // los puntos del supervisor se conservan.
    expect(FUENTE).toContain(
      'setHintEditor("PUNTOS PROPUESTOS — REVÍSALOS Y CONFIRMA CON APLICAR");',
    );
    expect(FUENTE).toContain(
      'setHintEditor("DETECCIÓN SIN ÉXITO — AJUSTA LOS PUNTOS MANUALMENTE");',
    );
    expect(FUENTE).toMatch(/const q = await detectarBordesDocumento\(foto\);\s*if \(q\) \{\s*setPuntos\(q\);/);
  });

  test("contraste — BICICLO NORMAL↔NEGATIVO (el nivel «ALTO» salió de la UI de masiva)", () => {
    // N1 del mantenedor: la UI de masiva tiene DOS modos y solo dos. El
    // trío del visor del monitor es OTRO componente y no se toca.
    expect(FUENTE).toContain('type ContrasteModo = "NORMAL" | "NEGATIVO";');
    expect(FUENTE).toMatch(
      /const FILTRO_CONTRASTE: Record<ContrasteModo, string \| undefined> = \{\s*NORMAL: undefined,\s*NEGATIVO: "invert\(1\)",\s*\};/,
    );
    // El toggle es un biciclo puro — jamás un tercer estado.
    expect(FUENTE).toContain(
      'setContraste((m) => (m === "NORMAL" ? "NEGATIVO" : "NORMAL"))',
    );
  });

  test("honestidad de datos — score entero/1 decimal, tipos de copia legibles (jamás el título mock), PÁG -/- y código entre las X", () => {
    // Score honesto: 10/10 entero, el resto a 1 decimal.
    expect(FUENTE).toContain(
      "return Number.isInteger(score) ? String(score) : score.toFixed(1);",
    );
    // Tipo de copia: SOLO lo reconocido — TRANSMISION → «TRANSMISIÓN»,
    // DELEGADOS → «CÓNSUL/EMBAJADOR», sin reconocimiento → «—». El
    // acta.tipo crudo (título del mock) NUNCA se muestra.
    expect(FUENTE).toMatch(
      /function etiquetaFormularioDe\(acta: Acta\): string \{\s*const t = acta\.clasificacion\?\.tipo;\s*if \(t === "TRANSMISION"\) return "TRANSMISIÓN";\s*if \(t === "DELEGADOS"\) return "CÓNSUL\/EMBAJADOR";\s*return "—";\s*\}/,
    );
    expect(FUENTE).toMatch(
      /if \(t === "TRANSMISION"\) return "Transmisión";\s*if \(t === "DELEGADOS"\) return "Delegados";\s*return "—";/,
    );
    // Página: sin dato → «-/-» en la franja y «- DE -» en el panel (jamás
    // asumir P1 mintiendo). Con dato → el total es el del ACTA (2 hojas).
    expect(FUENTE).toContain(
      'PÁG {pagina ? `${pagina.index}/${PAGINAS_POR_ACTA_E14}` : "-/-"}',
    );
    expect(FUENTE).toMatch(
      /valor=\{\s*pagina\s*\? `\$\{pagina\.index\} DE \$\{PAGINAS_POR_ACTA_E14\}`\s*: "- DE -"\s*\}/,
    );
    // Código entre las X: del manifiesto vía codigoFormaDeActa, espaciado
    // SOLO tipográfico; sin dato → «—» (V2-01/V3-04 — jamás uno global).
    expect(FUENTE).toContain("{`X  ${codigoForma.replace(/-/g, \" - \")}  X`}");
    // Barcode: UNA sola fuente real (barcodeRealDeActa), sin lectura → «—».
    expect(FUENTE).toMatch(/valor=\{barcodeEscaneado \|\| "—"\}/);
    // Mesa zero-pad 3 (misma convención del join del monitor).
    expect(FUENTE).toContain(
      '? `Mesa ${String(c.mesa).padStart(3, "0")}`',
    );
  });

  test("render condicional — VER EN MONITOR fijo (join + no cuarentena), panel por envío auto y glifo T-07 de la píldora", () => {
    // VER EN MONITOR: la condición sale del JOIN del acta (persistida), NO
    // del registro en memoria de la publicación — el botón NO desaparece
    // tras darle click; solo se oculta con cuarentena D25.
    expect(FUENTE).toMatch(
      /\{join &&\s*onVerEnMonitor &&\s*publicacion\?\.estado !== "bloqueada" && \(/,
    );
    // La cabecera distingue ENVÍO AUTOMÁTICO (✓) de INGRESO MANUAL (✎)
    // (literales del JSX del encabezado de la tarjeta).
    expect(FUENTE).toMatch(/ENVÍO AUTOMÁTICO\s*<\/span>/);
    expect(FUENTE).toMatch(/INGRESO MANUAL DE DATOS\s*<\/span>/);
    expect(FUENTE).toMatch(/ENVIADA AUTO · \{acta\.enviadoAutomaticamente\}/);
    // T-07 — glifo prefijo: ■ crítico (RECHAZADA/ERROR) · ▲ advertencia
    // (ADVERTENCIA/REVISIÓN) · ● resto.
    expect(FUENTE).toMatch(
      /const glifoPildora = \/RECHAZADA\|ERROR\/\.test\(pildora\.label\)\s*\?\s*"■"\s*:\s*\/ADVERTENCIA\|REVISIÓN\/\.test\(pildora\.label\)\s*\?\s*"▲"\s*:\s*"●";/,
    );
    // SCORE con color semántico unificado V2-02/T-10: esmeralda ≥ 9 · ámbar.
    expect(FUENTE).toMatch(/acta\.score >= 9\s*\?\s*"border-emerald-400/);
  });

  test("ingreso manual — pre-carga con los códigos RECONOCIDOS (padStart DIVIPOL), cascada que limpia dependencias y opciones SOLO de la base real", () => {
    // Pre-carga: municipio 3 dígitos, zona/puesto 2, mesa tal cual, tipo
    // default DELEGADOS, página default 1 — códigos vacíos si no hay
    // clasificación (jamás inventar).
    expect(FUENTE).toMatch(
      /municipio: c\?\.municipio\?\.codigo\?\.padStart\(3, "0"\) \?\? "",[\s\S]*?zona: c\?\.zona\?\.codigo\?\.padStart\(2, "0"\) \?\? "",[\s\S]*?puesto: c\?\.puesto\?\.codigo\?\.padStart\(2, "0"\) \?\? "",[\s\S]*?mesa: c\?\.mesa \?\? null,[\s\S]*?tipo: c\?\.tipo \?\? "DELEGADOS",[\s\S]*?paginaIndex: pagina\?\.index \?\? 1,/,
    );
    // Cascada DIVIPOL: cambiar PAÍS limpia zona/puesto/mesa; cambiar ZONA
    // limpia puesto/mesa (la jerarquía manda).
    expect(FUENTE).toContain(
      'patchManual({ municipio: v, zona: "", puesto: "", mesa: null })',
    );
    expect(FUENTE).toContain('patchManual({ zona: v, puesto: "", mesa: null })');
    expect(FUENTE).toContain("patchManual({ puesto: v, mesa: null })");
    // Opciones SIEMPRE de la base real: sin base (o sin ruta) → selects
    // fuera (display honesto), jamás opciones inventadas.
    expect(FUENTE).toMatch(
      /const opsPaises =\s*baseDivipol && dep2 \? municipiosDe\(baseDivipol, dep2\) : \[\];/,
    );
    expect(FUENTE).toMatch(
      /\{manualEditable && opsPaises\.length > 0 && datosManual \? \(/,
    );
    // Página del select: clamp 1..PAGINAS_POR_ACTA_E14 (OCR fuera de rango).
    expect(FUENTE).toMatch(
      /Math\.min\(\s*Math\.max\(1, datosManual\.paginaIndex\),\s*PAGINAS_POR_ACTA_E14,\s*\)/,
    );
    // El modo edición solo para actas no enviadas/rechazadas y sin envío auto.
    expect(FUENTE).toContain(
      "onAceptar && !enviadaAuto && acta.status !== \"ENVIADA\" && !rechazadaYa,",
    );
  });

  test("MOSTRAR ORIGINAL — degradación honesta: fotoProcesada + (fotoOriginal | materialización | sinOriginal)", () => {
    // El toggle solo se ofrece si HAY original (en el acta, materializable
    // on-demand o aún sin sondear): tras un 404 del registro el botón se
    // oculta (sinOriginal) y no vuelve a ofrecer nada.
    expect(FUENTE).toMatch(
      /const hayOriginal =\s*Boolean\(acta\.fotoProcesada\) &&\s*\(Boolean\(acta\.fotoOriginal\) \|\|\s*Boolean\(originalUrl\) \|\|\s*\(!sinOriginal && Boolean\(cargarOriginal\)\)\);/,
    );
    // La materialización fallida es honesta: sinOriginal, sin humo.
    expect(FUENTE).toMatch(/setSinOriginal\(true\); \/\/ sin archivo en el registro — el botón se oculta/);
    // fitKey del visor: re-ajustar al alternar original/procesada.
    expect(FUENTE).toContain(
      '`${acta.id}::${verOriginal ? "original" : "procesada"}::${fotoVisible.length}`',
    );
  });

  test("reset por acta abierta — el visor/editor/rechazo/aceptación vuelven a cero al navegar (y los timers se cancelan)", () => {
    // Navegar entre imágenes con el editor armado o un flash pendiente NO
    // puede filtrar estado a la siguiente acta (falso rechazo heredado,
    // rotaciones fantasma). El efecto cuelga de acta?.id.
    const idx = FUENTE.indexOf("setRotacionVisual(0);");
    expect(idx).toBeGreaterThan(0);
    const bloqueReset = FUENTE.slice(idx - 600, idx + 600);
    for (const ancla of [
      "setEditandoRecorte(false);",
      "setPuntos(null);",
      "setEditada(false);",
      "setVerOriginal(false);",
      'setContraste("NORMAL");',
      "setRechazoArmado(false);",
      "setObservaciones(\"\");",
      "setAceptarArmado(false);",
      "setHuboEdicionManual(false);",
      "clearTimeout(timerRechazoRef.current);",
      "clearTimeout(timerAceptarRef.current);",
    ]) {
      expect(bloqueReset).toContain(ancla);
    }
    expect(FUENTE).toMatch(/\}, \[acta\?\.id\]\);/);
  });
});
