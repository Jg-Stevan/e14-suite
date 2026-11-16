/**
 * CLONADO PROFUNDO en la frontera del repo tras M11 (R3) — reporte 02a
 * 🟡-1: `getMesasDePuesto` devolvía `{...m}` con `delegados` y
 * `transmision` (p1/p2 + alerta) ALIASADOS al singleton, y `clonarActa`
 * no clonaba `fotos` (ni `impresion`) — un mutador externo corrompía el
 * estado global / el documento histórico SIN RASTRO.
 *
 * Método: leer → mutar a fondo lo recibido → releer y comparar contra el
 * snapshot previo a la mutación. Si algún nivel sigue aliasado, la
 * relectura sale corrompida y el test lo delata.
 *
 * R-01 (auditoría 2026-11-16): la suite es INDEPENDIENTE DEL ORDEN de
 * archivos de `bun test` — cada `beforeEach` vacía el registro runtime y
 * siembra su propio estado (antes, heredar el singleton sembrado por otra
 * suite hacía el resultado depender del readdir del clon).
 */
import { beforeEach, describe, expect, test } from "bun:test";

import { mockSupervisionRepository } from "@/modules/supervision/data/mock-repository";
import { ID_ENLACE_ROMA } from "@/modules/supervision/data/divipola-adapter";
import {
  consultarActaRuntime,
  publicarActaMasiva,
  vaciarActasRuntimeParaPrueba,
} from "@/modules/supervision/data/actas-runtime";
import type { ActaMesa, FotoActa, ImpresionActa } from "@/modules/supervision/domain/acta";
import type { Mesa } from "@/modules/supervision/domain/types";

/** Snapshot inmutable para comparar tras la mutación. */
const clon = <T>(valor: T): T => JSON.parse(JSON.stringify(valor)) as T;

describe("getMesasDePuesto — clonado profundo (M11)", () => {
  test("mutar lo recibido a fondo NO corrompe el estado del repo", async () => {
    const primera = await mockSupervisionRepository.getMesasDePuesto(ID_ENLACE_ROMA);
    expect(primera.length).toBe(8);
    const snapshot: Mesa[] = clon(primera);

    // Mutación PROFUNDA del objeto recibido (todos los niveles aliasables).
    const mutada = primera[0];
    mutada.delegados.p1 = "pendiente";
    mutada.delegados = { p1: "pendiente", p2: "pendiente" };
    mutada.transmision.p1.estado = "pendiente";
    mutada.transmision.p1 = { estado: "pendiente" };
    mutada.transmision.p2.alerta = "CORRUMPIDO";
    mutada.transmision.p2 = { estado: "pendiente" };
    mutada.estadoMesa = "COMPLETO";
    mutada.accionSugerida = "notificar";

    const releida = await mockSupervisionRepository.getMesasDePuesto(ID_ENLACE_ROMA);
    expect(releida).toEqual(snapshot);
  }, 20_000);

  test("dos lecturas consecutivas son objetos independientes entre sí", async () => {
    const a = await mockSupervisionRepository.getMesasDePuesto(ID_ENLACE_ROMA);
    const b = await mockSupervisionRepository.getMesasDePuesto(ID_ENLACE_ROMA);
    const snapshotB: Mesa[] = clon(b);
    a[0].transmision.p2.alerta = "SOLO EN A";
    a[0].delegados.p1 = "pendiente";
    expect(b).toEqual(snapshotB);
  }, 20_000);
});

describe("getActaDeMesa — clonarActa profundo incluyendo fotos/impresión (M11)", () => {
  beforeEach(() => {
    // R-01: estado runtime conocido — la suite NO hereda singletons de
    // otras (el bug original solo saltaba si otra suite sembraba runtime).
    vaciarActasRuntimeParaPrueba();
  });

  test("mutar acta + ranuras de fotos + impresión NO corrompe el acta en caché", async () => {
    const acta = await mockSupervisionRepository.getActaDeMesa(ID_ENLACE_ROMA, "001");
    expect(acta).not.toBeNull();
    // El ancla Roma conserva la paginación real (D44) — pero desde D35
    // (2026-11-08) las fotos reales NO viven en el repo: las ranuras son
    // null (metadata-only) + encabezado impreso verbatim.
    expect(acta?.fotos?.DELEGADOS?.length).toBeGreaterThan(0);
    expect(acta?.fotos?.DELEGADOS?.[0]).toBeNull();
    expect(acta?.impresion).toBeDefined();
    const snapshot = clon(acta) as ActaMesa;

    // Mutación PROFUNDA: historial, formularios, RANURAS de fotos (el
    // ARREGLO también se clona — un mutador externo no toca la caché) e
    // impresión.
    acta!.historial[0].hora = "99:99 LOCAL";
    acta!.formularios.TRANSMISION[1].estado = "PENDIENTE";
    acta!.formularios.DELEGADOS[0].numero = 99;
    acta!.fotos!.DELEGADOS![0] = {
      src: "CORRUMPIDO",
      ancho: -1,
      alto: -1,
      archivo: "CORRUMPIDO.png",
    } satisfies FotoActa;
    acta!.impresion!.pais = "CORRUMPIDO";

    const releida = await mockSupervisionRepository.getActaDeMesa(ID_ENLACE_ROMA, "001");
    expect(releida).toEqual(snapshot);
  }, 20_000);

  test("ranuras de fotos del acta: el ARREGLO no está aliasado al loader (desde D35 las ranuras son null)", async () => {
    const a = await mockSupervisionRepository.getActaDeMesa(ID_ENLACE_ROMA, "001");
    const snapshot = clon(a) as ActaMesa;
    // D35: la ranura estática es null; se escribe una foto FALSA en la
    // copia recibida y la relectura debe seguir sirviendo el null original.
    expect(a?.fotos?.DELEGADOS?.[0]).toBeNull();
    a!.fotos!.DELEGADOS![0] = {
      src: "ALIAS-TEST",
      ancho: 1,
      alto: 1,
      archivo: "ALIAS-TEST.png",
    } satisfies FotoActa;
    const b = await mockSupervisionRepository.getActaDeMesa(ID_ENLACE_ROMA, "001");
    expect(b?.fotos?.DELEGADOS?.[0]).toBeNull();
    expect(b).toEqual(snapshot);
  }, 20_000);

  // R-01 (H-01, auditoría 2026-11-16): la FRONTERA de fusión con el runtime
  // también clona. Antes `fusionarActaRuntime` devolvía el acta con
  // `impresion` ALIASADA al registro del singleton — mutar el acta recibida
  // corrompía el runtime compartido (la causa raíz del flaky por orden).
  test("CON runtime publicado (fusión D27): mutar el acta fusionada NO corrompe el registro runtime", async () => {
    const impresion: ImpresionActa = {
      consulado: "88",
      pais: "380 - ITALIA",
      zona: "010",
      puesto: "02",
      mesa: "001",
      lugar: "Roma - Consulado",
      barcode: "710003993010102",
      etiquetaFormulario: "TRANSMISIÓN",
    };
    await publicarActaMasiva(
      {
        idEnlace: ID_ENLACE_ROMA,
        mesa: "001",
        formulario: "TRANSMISION",
        paginaIndex: 1,
        paginaTotal: 2,
        srcFoto: null,
        impresion,
        nombreArchivo: "acta-roma-r01.jpg",
        score: 8.5,
        statusActa: "OPTIMA",
      },
      "carga-masiva",
    );

    const acta = await mockSupervisionRepository.getActaDeMesa(ID_ENLACE_ROMA, "001");
    expect(acta).not.toBeNull();
    // La fusión manda: el encabezado impreso es el del runtime.
    expect(acta?.impresion?.pais).toBe("380 - ITALIA");
    const snapshot = clon(acta) as ActaMesa;

    // Mutación PROFUNDA del acta fusionada — incluido el nivel que antes
    // quedaba aliasado al singleton del runtime.
    acta!.impresion!.pais = "CORRUMPIDO";
    acta!.historial[0].hora = "99:99 LOCAL";
    acta!.fotos!.TRANSMISION![0] = {
      src: "CORRUMPIDO",
      ancho: -1,
      alto: -1,
      archivo: "CORRUMPIDO.png",
    } satisfies FotoActa;

    const releida = await mockSupervisionRepository.getActaDeMesa(ID_ENLACE_ROMA, "001");
    expect(releida).toEqual(snapshot);
    // Y el registro runtime queda INTACTO (la frontera clona de verdad).
    expect(consultarActaRuntime(ID_ENLACE_ROMA, "001")?.impresion.pais).toBe(
      "380 - ITALIA",
    );
  }, 20_000);
});
