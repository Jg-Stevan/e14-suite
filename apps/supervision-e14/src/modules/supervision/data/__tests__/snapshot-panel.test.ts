/**
 * Tests del SNAPSHOT DE SESIÓN del panel (R-54) — SOLO la capa PURA
 * (serializar/deserializar/recortes), SIN IndexedDB: bun test no tiene
 * IndexedDB y el guard de entorno de snapshot-panel.ts debe mantenerse
 * ajeno a estas pruebas (jamás abre la DB aquí).
 *
 * Congela los invariantes del round-trip:
 *  · los límites duros de cuota (200 actas / 2.000 entradas más recientes);
 *  · el round-trip JSON conserva actas + recepción + huellas + decisiones;
 *  · lo malformado NO aborta: top-level corrupto → null, ítem corrupto →
 *    se salta (conservador, jamás throw).
 */
import { describe, expect, test } from "bun:test";

import type { ActaRealLista } from "../actas-reales/actas-reales";
import type { EntradaRecepcion } from "../recepcion-log";
import {
  LIMITE_ACTAS,
  LIMITE_RECEPCION,
  deserializarSnapshotPanel,
  recortarActas,
  recortarRecepcion,
  serializarSnapshotPanel,
  type EstadoVivoPanel,
  type RegistroActaSnapshot,
} from "../snapshot-panel";

const IMPRESION = {
  consulado: "88",
  pais: "380 - ITALIA",
  zona: "010",
  puesto: "02",
  mesa: "001",
  lugar: "Roma - Consulado",
} as const;

/** Acta del runtime con dataURL (la excepción LOCAL documentada: la foto
 *  viaja TAL CUAL — el panel corre en PC y jamás sale por red). */
function actaFalsa(n: number): ActaRealLista {
  return {
    idEnlace: `88_495_010_${String(n).padStart(2, "0")}`,
    mesa: "001",
    fotos: {
      TRANSMISION: [
        {
          src: `data:image/webp;base64,foto-${n}`,
          ancho: 794,
          alto: 1123,
          archivo: `E14_${n}.webp`,
        },
        null,
      ],
    },
    impresion: { ...IMPRESION },
    etiquetasImpresas: { TRANSMISION: "TRANSMISIÓN" },
    barcodesImpresos: { TRANSMISION: "710003993010102" },
  };
}

function entradaFalsa(n: number, fecha: number): EntradaRecepcion {
  return {
    id: `recepcion-test-${n}`,
    fecha,
    origen: "carga-masiva",
    estado: "PUBLICADA",
    idEnlace: "88_495_010_02",
    mesa: "001",
    formulario: "TRANSMISION",
    paginaIndex: 1,
    paginaTotal: 2,
    srcFoto: `data:image/webp;base64,mini-${n}`,
    pais: "380 - ITALIA",
    lugar: "Roma - Consulado",
    clave: "88_495_010_02::001",
  };
}

function estadoFalso(): EstadoVivoPanel {
  const actas: RegistroActaSnapshot[] = [
    { clave: "88_495_010_02::001", acta: actaFalsa(2) },
    { clave: "88_495_010_02::002", acta: actaFalsa(2) },
  ];
  return {
    actas,
    recepcion: [
      entradaFalsa(1, 1_000),
      entradaFalsa(2, 2_000),
      // DUPLICADA con dupOf — la trazabilidad también sobrevive.
      {
        ...entradaFalsa(3, 3_000),
        estado: "DUPLICADA",
        dupOf: "recepcion-test-2",
      },
    ],
    huellas: [
      {
        identidad: "88_495_010_02::001::TRANSMISION::1",
        huella: "a".repeat(64),
        qrPayload: "710003993010102",
        dhash64: null,
        idRecepcion: "recepcion-test-2",
      },
    ],
    decisiones: [
      {
        idEntrada: "recepcion-test-2",
        decision: "APROBADA",
        ms: 4_000,
        idEnlace: "88_495_010_02",
        mesa: "001",
        nota: "firmas legibles",
      },
    ],
  };
}

describe("recortes — límites duros de cuota (R-54)", () => {
  test("recortarActas: máx 200 actas (primeras en orden de inserción)", () => {
    const muchas: RegistroActaSnapshot[] = Array.from({ length: 205 }, (_, i) => ({
      clave: `clave-${i}`,
      acta: actaFalsa(i + 1),
    }));
    const recorte = recortarActas(muchas);
    expect(recorte.length).toBe(200);
    expect(recorte[0]!.clave).toBe("clave-0");
    expect(LIMITE_ACTAS).toBe(200);
  });

  test("recortarRecepcion: conserva las MÁS RECIENTES (el log llega más-nuevas-primero)", () => {
    const muchas = Array.from({ length: 2_100 }, (_, i) =>
      entradaFalsa(i + 1, i + 1) // fecha ascendente: la última es la más nueva
    );
    // El log real está más-nuevas-primero: invierte como hace unshift.
    muchas.reverse();
    const recorte = recortarRecepcion(muchas);
    expect(recorte.length).toBe(2_000);
    expect(recorte[0]!.id).toBe("recepcion-test-2100");
    expect(LIMITE_RECEPCION).toBe(2_000);
  });

  test("recortes con listas bajo el límite: idénticas (sin tocar)", () => {
    const estado = estadoFalso();
    expect(recortarActas(estado.actas)).toEqual(estado.actas);
    expect(recortarRecepcion(estado.recepcion)).toEqual(estado.recepcion);
  });

  test("serializarSnapshotPanel aplica los límites por sí mismo", () => {
    const muchas: RegistroActaSnapshot[] = Array.from(
      { length: 250 },
      (_, i) => ({ clave: `clave-${i}`, acta: actaFalsa(i + 1) })
    );
    const entradas = Array.from({ length: 2_500 }, (_, i) =>
      entradaFalsa(i + 1, i + 1)
    );
    const snapshot = serializarSnapshotPanel(
      { actas: muchas, recepcion: entradas, huellas: [], decisiones: [] },
      1_000
    );
    expect(snapshot.version).toBe(1);
    expect(snapshot.ms).toBe(1_000);
    expect(snapshot.actas.length).toBe(200);
    expect(snapshot.recepcion.length).toBe(2_000);
  });
});

describe("round-trip serializar → JSON → deserializar (sin IndexedDB)", () => {
  test("conserva actas + recepción + huellas + decisiones ÍNTEGRAS", () => {
    const snapshot = serializarSnapshotPanel(estadoFalso(), 9_000);
    // El camino real de IDB: los registros viven como objetos estructurados
    // (el mismo recorrido que un JSON.stringify/parse — se prueba el plano).
    const bruto = JSON.parse(JSON.stringify(snapshot));
    const deserializado = deserializarSnapshotPanel(bruto);
    expect(deserializado).not.toBeNull();
    expect(deserializado!.version).toBe(1);
    expect(deserializado!.ms).toBe(9_000);
    expect(deserializado!.actas.length).toBe(2);
    expect(deserializado!.actas[0]!.clave).toBe("88_495_010_02::001");
    expect(deserializado!.actas[0]!.acta.fotos.TRANSMISION![0]!.src).toBe(
      "data:image/webp;base64,foto-2"
    );
    expect(deserializado!.recepcion.length).toBe(3);
    expect(deserializado!.recepcion.find((e) => e.estado === "DUPLICADA")!.dupOf).toBe(
      "recepcion-test-2"
    );
    expect(deserializado!.huellas.length).toBe(1);
    expect(deserializado!.huellas[0]!.identidad).toBe(
      "88_495_010_02::001::TRANSMISION::1"
    );
    expect(deserializado!.decisiones.length).toBe(1);
    expect(deserializado!.decisiones[0]!.decision).toBe("APROBADA");
    expect(deserializado!.decisiones[0]!.nota).toBe("firmas legibles");
  });

  test("top-level malformado → null (nada que fusionar, jamás throw)", () => {
    expect(deserializarSnapshotPanel(null)).toBeNull();
    expect(deserializarSnapshotPanel("no-es-un-snapshot")).toBeNull();
    expect(deserializarSnapshotPanel({ version: 2 })).toBeNull(); // versión desconocida
    expect(deserializarSnapshotPanel(42)).toBeNull();
  });

  test("ítems malformados se SALTAN (el resto sigue — conservador)", () => {
    const bruto = {
      version: 1,
      ms: 1,
      actas: [
        { clave: "buena::001", acta: actaFalsa(1) },
        { clave: "sin-acta" }, // sin acta
        { clave: "", acta: actaFalsa(1) }, // clave vacía
        { clave: "acta-mala", acta: { fotos: null } }, // acta sin forma
      ],
      recepcion: [
        entradaFalsa(1, 100),
        { id: "", fecha: 1 }, // sin id
        { id: "sin-fecha" }, // sin fecha
        { id: "estado-raro", fecha: 2, estado: "DESCONOCIDO" }, // estado fuera del union
      ],
      huellas: [
        { identidad: "i-1", huella: "a".repeat(64), idRecepcion: "r-1" },
        { identidad: "i-2" }, // incompleta
      ],
      decisiones: [
        {
          idEntrada: "r-1",
          decision: "APROBADA",
          ms: 1,
          idEnlace: "88_495_010_02",
          mesa: "001",
        },
        { idEntrada: "r-2", decision: "TAL_VEZ", ms: 1, idEnlace: "x", mesa: "1" }, // decisión inválida
      ],
    };
    const d = deserializarSnapshotPanel(bruto);
    expect(d).not.toBeNull();
    expect(d!.actas.length).toBe(1);
    expect(d!.recepcion.length).toBe(1);
    expect(d!.huellas.length).toBe(1);
    expect(d!.decisiones.length).toBe(1);
    expect(d!.decisiones[0]!.decision).toBe("APROBADA");
  });

  test("arrays ausentes en el bruto → vacíos (no null en los campos)", () => {
    const d = deserializarSnapshotPanel({ version: 1, ms: 5 });
    expect(d).not.toBeNull();
    expect(d!.actas).toEqual([]);
    expect(d!.recepcion).toEqual([]);
    expect(d!.huellas).toEqual([]);
    expect(d!.decisiones).toEqual([]);
  });
});
