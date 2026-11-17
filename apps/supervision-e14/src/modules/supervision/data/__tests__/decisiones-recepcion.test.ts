/**
 * Tests de las DECISIONES DE RECEPCIÓN (R-55): registro append-only
 * APROBADA/RECHAZADA sobre entradas del log de recepción.
 *
 * Congela:
 *  · la validación al registrar (entrada existente, sin decisión previa,
 *    con join D22 — jamás throw, resultado discriminado);
 *  · el cruce del gate (TERCERA FUENTE): hayAprobacionParaClaveJoin es
 *    true SOLO con APROBADA de la misma `${idEnlace}::${mesa}` — RECHAZADA
 *    jamás hace visible;
 *  · la fusión CONSERVADORA desde el snapshot (solo ids ausentes).
 *
 * Nota de higiene: bun test comparte el registro de módulos entre archivos —
 * cada prueba purga el log y las decisiones (mismo gesto de hub-local.test).
 * El guard de entorno de snapshot-panel hace que el guardado agendado sea un
 * no-op aquí (no hay IndexedDB ni timer colgado).
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  consultarDecisionesRecepcion,
  fusionarDecisionesDesdeSnapshot,
  hayAprobacionParaClaveJoin,
  registrarDecisionRecepcion,
  reiniciarDecisionesParaPrueba,
  suscribirseDecisionesRecepcion,
} from "../decisiones-recepcion";
import {
  purgarRecepciones,
  registrarRecepcion,
} from "../recepcion-log";

const ROMA = "88_495_010_02";
const MESA = "001";

beforeEach(() => {
  purgarRecepciones();
  reiniciarDecisionesParaPrueba();
});

/** Siembra UNA entrada PUBLICADA con join válido y devuelve su id. */
function sembrarEntrada(nombre = "acta-roma-1.jpg"): string {
  const entrada = registrarRecepcion({
    fecha: 1_793_821_040_000,
    origen: "carga-masiva",
    estado: "PUBLICADA",
    idEnlace: ROMA,
    mesa: MESA,
    formulario: "TRANSMISION",
    paginaIndex: 1,
    paginaTotal: 2,
    srcFoto: null,
    pais: "380 - ITALIA",
    lugar: "Roma - Consulado",
    nombreArchivo: nombre,
    score: 7.2,
    statusActa: "ADVERTENCIA",
  });
  return entrada.id;
}

describe("registrarDecisionRecepcion — validación y append-only", () => {
  test("APROBADA sobre una entrada existente: ok, con la clave de join estampada", () => {
    const id = sembrarEntrada();
    const r = registrarDecisionRecepcion(id, "APROBADA");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.registro.decision).toBe("APROBADA");
      expect(r.registro.idEnlace).toBe(ROMA);
      expect(r.registro.mesa).toBe(MESA);
      expect(typeof r.registro.ms).toBe("number");
    }
    const d = consultarDecisionesRecepcion();
    expect(d.size).toBe(1);
    expect(d.get(id)?.decision).toBe("APROBADA");
  });

  test("RECHAZADA también se registra (con nota opcional)", () => {
    const id = sembrarEntrada();
    const r = registrarDecisionRecepcion(id, "RECHAZADA", "ilegible");
    expect(r.ok).toBe(true);
    expect(consultarDecisionesRecepcion().get(id)?.decision).toBe("RECHAZADA");
    expect(consultarDecisionesRecepcion().get(id)?.nota).toBe("ilegible");
  });

  test("append-only: la entrada ya decidida NO se sobre-decide", () => {
    const id = sembrarEntrada();
    expect(registrarDecisionRecepcion(id, "APROBADA").ok).toBe(true);
    const segunda = registrarDecisionRecepcion(id, "RECHAZADA");
    expect(segunda.ok).toBe(false);
    // La PRIMERA decisión manda.
    expect(consultarDecisionesRecepcion().get(id)?.decision).toBe("APROBADA");
  });

  test("entrada inexistente → ok:false (jamás throw)", () => {
    const r = registrarDecisionRecepcion("recepcion-fantasma", "APROBADA");
    expect(r.ok).toBe(false);
    expect(consultarDecisionesRecepcion().size).toBe(0);
  });

  test("entrada SIN_JOIN → ok:false (sin join D22 no hay decisión que cruzar)", () => {
    const entrada = registrarRecepcion({
      fecha: 1_793_821_040_000,
      origen: "carga-masiva",
      estado: "SIN_JOIN",
      idEnlace: "—",
      mesa: "—",
      formulario: null,
      paginaIndex: null,
      paginaTotal: null,
      srcFoto: null,
      pais: null,
      lugar: null,
    });
    const r = registrarDecisionRecepcion(entrada.id, "APROBADA");
    expect(r.ok).toBe(false);
    expect(consultarDecisionesRecepcion().size).toBe(0);
  });

  test("decisión desconocida → ok:false (tipo discriminado, jamás throw)", () => {
    const id = sembrarEntrada();
    const r = registrarDecisionRecepcion(
      id,
      "TAL_VEZ" as never
    );
    expect(r.ok).toBe(false);
    expect(consultarDecisionesRecepcion().size).toBe(0);
  });
});

describe("hayAprobacionParaClaveJoin — la TERCERA FUENTE del gate (R-55)", () => {
  test("APROBADA para la clave → visible; RECHAZADA → jamás", () => {
    const id = sembrarEntrada();
    expect(hayAprobacionParaClaveJoin(ROMA, MESA)).toBe(false);
    registrarDecisionRecepcion(id, "APROBADA");
    expect(hayAprobacionParaClaveJoin(ROMA, MESA)).toBe(true);
    // Otra mesa del mismo puesto: sin decisión → sin visibilidad extra.
    expect(hayAprobacionParaClaveJoin(ROMA, "002")).toBe(false);
  });

  test("RECHAZADA no hace visible (el gate es aditivo)", () => {
    const id = sembrarEntrada();
    registrarDecisionRecepcion(id, "RECHAZADA");
    expect(hayAprobacionParaClaveJoin(ROMA, MESA)).toBe(false);
  });

  test("otro puesto con la misma mesa NO cruza (la clave es idEnlace::mesa)", () => {
    const id = sembrarEntrada();
    registrarDecisionRecepcion(id, "APROBADA");
    expect(hayAprobacionParaClaveJoin("99_999_999_99", MESA)).toBe(false);
  });
});

describe("suscripción y fusión desde el snapshot (R-54)", () => {
  test("los oyentes se enteran de cada mutación y la baja silencia", () => {
    let avisos = 0;
    const baja = suscribirseDecisionesRecepcion(() => {
      avisos += 1;
    });
    const id = sembrarEntrada();
    registrarDecisionRecepcion(id, "APROBADA");
    expect(avisos).toBe(1);
    baja();
    const segunda = registrarDecisionRecepcion(id, "RECHAZADA");
    expect(segunda.ok).toBe(false); // append-only: rechazada, sin cambio
    expect(avisos).toBe(1); // sin oyente tras la baja (y sin segundo cambio)
  });

  test("fusión conservadora: SOLO ids ausentes — la memoria viva manda", () => {
    const id = sembrarEntrada();
    registrarDecisionRecepcion(id, "APROBADA");
    const agregadas = fusionarDecisionesDesdeSnapshot([
      {
        idEntrada: id, // ya existe en memoria → no se pisa
        decision: "RECHAZADA",
        ms: 1,
        idEnlace: ROMA,
        mesa: MESA,
      },
      {
        idEntrada: "recepcion-persistida",
        decision: "RECHAZADA",
        ms: 2,
        idEnlace: ROMA,
        mesa: "002",
      },
    ]);
    expect(agregadas).toBe(1);
    expect(consultarDecisionesRecepcion().get(id)?.decision).toBe("APROBADA");
    expect(consultarDecisionesRecepcion().get("recepcion-persistida")?.decision).toBe(
      "RECHAZADA"
    );
    // La fusión cruzó: la rehidratada alimenta el gate.
    expect(hayAprobacionParaClaveJoin(ROMA, "002")).toBe(false);
    expect(hayAprobacionParaClaveJoin(ROMA, MESA)).toBe(true);
  });

  test("reiniciarDecisionesParaPrueba vacía el registro (higiene entre suites)", () => {
    const id = sembrarEntrada();
    registrarDecisionRecepcion(id, "APROBADA");
    reiniciarDecisionesParaPrueba();
    expect(consultarDecisionesRecepcion().size).toBe(0);
    expect(hayAprobacionParaClaveJoin(ROMA, MESA)).toBe(false);
  });
});
