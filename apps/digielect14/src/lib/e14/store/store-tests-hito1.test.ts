/**
 * R-57 — hito 1 de tests del store del móvil (funciones PURAS, headless).
 *
 * La partición del store (R-27, `src/lib/e14/store/*.ts`) vivía SIN tests.
 * Este archivo cubre los módulos con lógica pura ejecutable sin DOM/IndexedDB
 * con bun:test (el runner acotado del repo — la suite vitest de la app sigue
 * intacta; este hito SOLO AÑADE tests, el ratchet de cobertura de
 * vitest.config.ts:39 no se toca):
 *
 *   · guion.ts       — proximaPagina / recalcularMesa / marcarPaginaOK /
 *                      derivarMesas (el guion que guía el escaneo y ACTAS).
 *   · generacion.ts  — guardas de generación del disparo (H1/H2) y contadores
 *                      de pipelines en vuelo (estado de módulo, sin DOM).
 *   · navegacion.ts  — slice de vista/destello/conexión con set/get FAKE
 *                      (misma forma que zustand entrega a cada slice), que
 *                      ejercita navegar/destellar/alternarConexion incluido
 *                      el re-estampado del hash real C-08 al volver la red.
 *
 * POR QUÉ el resto de los 12 módulos NO entra en el hito 1 (todos acoplados a
 * I/O o DOM — testeables solo con harness de integración):
 *   · analisis.ts (L21+) / edicion.ts (L27+) / captura.ts (L38+): acciones que
 *     consumen la fachada del bridge (get-bridge → RealCoreBridge) y, en
 *     captura, el <video> vivo de la cámara.
 *   · envio.ts: registrarEnvio consulta red/hash del puente (get-bridge,
 *     obs/dispositivo L1-14) — sus helpers puros (idHistorial L31,
 *     tituloPaginaActual L225) son candidatos del hito 2.
 *   · persistencia.ts: IndexedDB (abrirJornada → jornada.ts L62
 *     `typeof indexedDB === "undefined"`) — bun no trae IDB.
 *   · simulacion.ts: avanza el guion SIM escribiendo el estado vivo del
 *     store (crearSimulacion L21) — necesita la tienda completa.
 *   · sesion-ocr.ts (L11-34): emisión obs con dynamic imports del buffer y la
 *     identidad del dispositivo — efectos laterales puros.
 *   · tipos.ts / avisos.ts: solo tipos (avisos: 3 setters triviales — hito 2).
 *
 * Estilo: imports de `vitest` (el ESTÁNDAR de la suite unitaria de esta app —
 * ver completitud.test.ts / ocr-cascada.test.ts): `bun test` los ALIASA a
 * bun:test (verificado) y el CI móvil corre la MISMA suite con vitest — un
 * solo archivo verde en ambos runners, sin tocar vitest.config.ts ni el
 * ratchet de cobertura (statements: 19). El veredicto del hito corre con
 * `bun test apps/digielect14/src/lib/e14/store`.
 */
import { describe, expect, it } from "vitest";
import type { PaginaObjetivo } from "@jg-stevan/scanner-core/dominio/bridge";
import type { ClasificacionE14 } from "@jg-stevan/scanner-core/dominio/clasificador";
import type { Acta, Mesa, MesaPagina } from "@jg-stevan/scanner-core/dominio/types";
import {
  derivarMesas,
  marcarPaginaOK,
  proximaPagina,
  recalcularMesa,
} from "./guion";
import {
  abrirPipeline,
  cancelacionPara,
  cancelarGeneracionVigente,
  cerrarPipeline,
  esGeneracionVigente,
  olvidarCancelacion,
  siguienteGeneracion,
} from "./generacion";
import { crearNavegacion } from "./navegacion";
import { mesasRealesDe } from "../jornada";
import type { ActaArchivada, E14Get, E14Set, E14Store, PuestoActual } from "./tipos";

// ─── Fábricas de datos de prueba (solo campos que los módulos leen) ────

/** Mesa con las páginas dadas (orden canónico DELEGADOS→TRANSMISIÓN). */
function mesaDe(id: string, paginas: MesaPagina[]): Mesa {
  return {
    id,
    estado: "PENDIENTE",
    progresoPct: 0,
    paginas,
  };
}

function pagina(tipo: MesaPagina["tipo"], num: 1 | 2, estado: MesaPagina["estado"]): MesaPagina {
  return { tipo, pagina: num, estado };
}

/** Clasificación mínima para las entradas archivadas (mesasRealesDe solo lee
 *  `clasificacion.pagina?.total`; el resto del contrato no participa aquí). */
function clasif(totalPaginas: number | null): ClasificacionE14 {
  return {
    pagina: totalPaginas == null ? null : { index: 1, total: totalPaginas },
  } as unknown as ClasificacionE14;
}

function archivada(
  huecos: ActaArchivada["huecos"],
  totalPaginas: number | null = 2,
): ActaArchivada {
  return { clasificacion: clasif(totalPaginas), huecos };
}

const PUESTO: PuestoActual = {
  clave: "88-335-05-02",
  titulo: "EL CAIRO",
  departamento: "CAUCA",
  municipio: "EL CAIRO",
  zona: "05",
  puesto: "02",
};

// ─── guion.ts ───────────────────────────────────────────────────────────

describe("guion · proximaPagina (prioridad EN_PROCESO > PENDIENTE > RESCANEO)", () => {
  it("sin mesas → null", () => {
    expect(proximaPagina([])).toBeNull();
  });

  it("todo OK → null (guion terminado)", () => {
    const mesas = [
      mesaDe("MESA 01", [
        pagina("DELEGADOS", 1, "OK"),
        pagina("DELEGADOS", 2, "OK"),
        pagina("TRANSMISIÓN", 1, "OK"),
        pagina("TRANSMISIÓN", 2, "OK"),
      ]),
    ];
    expect(proximaPagina(mesas)).toBeNull();
  });

  it("EN_PROCESO vence a RESCANEO aunque venga después", () => {
    const mesas = [
      mesaDe("MESA 01", [pagina("DELEGADOS", 1, "RESCANEO")]),
      mesaDe("MESA 02", [pagina("TRANSMISIÓN", 1, "EN_PROCESO")]),
    ];
    const objetivo: PaginaObjetivo = { mesaId: "MESA 02", tipo: "TRANSMISIÓN", pagina: 1 };
    expect(proximaPagina(mesas)).toEqual(objetivo);
  });

  it("PENDIENTE vence a RESCANEO", () => {
    const mesas = [
      mesaDe("MESA 01", [pagina("DELEGADOS", 2, "RESCANEO")]),
      mesaDe("MESA 02", [pagina("DELEGADOS", 1, "PENDIENTE")]),
    ];
    expect(proximaPagina(mesas)).toEqual({ mesaId: "MESA 02", tipo: "DELEGADOS", pagina: 1 });
  });

  it("empate de prioridad: la primera mesa del guion manda", () => {
    const mesas = [
      mesaDe("MESA 03", [pagina("TRANSMISIÓN", 2, "PENDIENTE")]),
      mesaDe("MESA 01", [pagina("DELEGADOS", 1, "PENDIENTE")]),
    ];
    expect(proximaPagina(mesas)).toEqual({ mesaId: "MESA 03", tipo: "TRANSMISIÓN", pagina: 2 });
  });
});

describe("guion · recalcularMesa (progreso y estado derivados)", () => {
  it("una página OK de 4 → 25 % EN_PROCESO (y sin mutar la entrada)", () => {
    const original = mesaDe("MESA 01", [
      pagina("DELEGADOS", 1, "OK"),
      pagina("DELEGADOS", 2, "PENDIENTE"),
      pagina("TRANSMISIÓN", 1, "PENDIENTE"),
      pagina("TRANSMISIÓN", 2, "PENDIENTE"),
    ]);
    const recalculada = recalcularMesa(original);
    expect(recalculada).not.toBe(original); // derivada — la entrada queda intacta
    expect(original.progresoPct).toBe(0);
    expect(recalculada.progresoPct).toBe(25);
    expect(recalculada.estado).toBe("EN_PROCESO");
    expect(recalculada.paginas).toEqual(original.paginas);
  });

  it("todo OK → 100 % COMPLETADA", () => {
    const completa = recalcularMesa(
      mesaDe("MESA 01", [
        pagina("DELEGADOS", 1, "OK"),
        pagina("DELEGADOS", 2, "OK"),
        pagina("TRANSMISIÓN", 1, "OK"),
        pagina("TRANSMISIÓN", 2, "OK"),
      ]),
    );
    expect(completa.estado).toBe("COMPLETADA");
    expect(completa.progresoPct).toBe(100);
  });

  it("todo PENDIENTE → 0 % EN_PROCESO (no COMPLETADA)", () => {
    const virgen = recalcularMesa(
      mesaDe("MESA 02", [
        pagina("DELEGADOS", 1, "PENDIENTE"),
        pagina("TRANSMISIÓN", 1, "PENDIENTE"),
      ]),
    );
    expect(virgen.estado).toBe("EN_PROCESO");
    expect(virgen.progresoPct).toBe(0);
  });

  it("una página EN_PROCESO con el resto OK → 100 % pero EN_PROCESO (noPendientes cuenta EN_PROCESO como avance)", () => {
    const enVuelo = recalcularMesa(
      mesaDe("MESA 01", [
        pagina("DELEGADOS", 1, "OK"),
        pagina("DELEGADOS", 2, "EN_PROCESO"),
      ]),
    );
    expect(enVuelo.estado).toBe("EN_PROCESO"); // la página EN_PROCESO manda en el estado
    expect(enVuelo.progresoPct).toBe(100); // noPendientes = todo lo que NO está PENDIENTE
  });
});

describe("guion · marcarPaginaOK (marca el hueco objetivo y recalcula su mesa)", () => {
  const DOS_MESAS = () => [
    mesaDe("MESA 01", [
      pagina("DELEGADOS", 1, "PENDIENTE"),
      pagina("TRANSMISIÓN", 1, "PENDIENTE"),
    ]),
    mesaDe("MESA 02", [
      pagina("DELEGADOS", 1, "PENDIENTE"),
      pagina("TRANSMISIÓN", 1, "PENDIENTE"),
    ]),
  ];

  it("marca SOLO la página objetivo (tipo + página) de la mesa objetivo", () => {
    const salida = marcarPaginaOK(DOS_MESAS(), {
      mesaId: "MESA 01",
      tipo: "DELEGADOS",
      pagina: 1,
    });
    expect(salida[0].paginas[0].estado).toBe("OK");
    expect(salida[0].paginas[1].estado).toBe("PENDIENTE"); // TRANSMISIÓN intacta
    expect(salida[0].progresoPct).toBe(50); // recalculada por recalcularMesa
    expect(salida[1].paginas[0].estado).toBe("PENDIENTE");
  });

  it("la mesa NO objetivo conserva su referencia (copia mínima)", () => {
    const entrada = DOS_MESAS();
    const salida = marcarPaginaOK(entrada, {
      mesaId: "MESA 02",
      tipo: "TRANSMISIÓN",
      pagina: 1,
    });
    expect(salida[0]).toBe(entrada[0]); // sin cambios → mismo objeto
    expect(salida[1]).not.toBe(entrada[1]); // la marcada, derivada
    expect(salida[1].paginas[1].estado).toBe("OK");
  });

  it("marcar la última página pendiente → mesa COMPLETADA 100 %", () => {
    const salida = marcarPaginaOK(
      [mesaDe("MESA 01", [pagina("DELEGADOS", 1, "OK"), pagina("TRANSMISIÓN", 1, "PENDIENTE")])],
      { mesaId: "MESA 01", tipo: "TRANSMISIÓN", pagina: 1 },
    );
    expect(salida[0].estado).toBe("COMPLETADA");
    expect(salida[0].progresoPct).toBe(100);
  });

  it("objetivo inexistente (mesa/tipo/página que no existen) → guion intacto", () => {
    const entrada = DOS_MESAS();
    const salida = marcarPaginaOK(entrada, {
      mesaId: "MESA 09",
      tipo: "DELEGADOS",
      pagina: 2,
    });
    expect(salida).toEqual(entrada);
  });
});

describe("guion · derivarMesas (guion REAL desde el archivo de huecos — C-11/M10)", () => {
  it("total DIVIPOL completo: mesas vacías PENDIENTE + huecos OK derivados", () => {
    const archivadas = {
      "88-335-05-02-001": archivada([{ tipo: "DELEGADOS", pagina: 1, estado: "OK" }]),
    };
    const mesas = derivarMesas(archivadas, PUESTO, 2);
    expect(mesas).toHaveLength(2);
    expect(mesas[0].id).toBe("MESA 01");
    expect(mesas[0].paginas[0]).toEqual({ tipo: "DELEGADOS", pagina: 1, estado: "OK" });
    expect(mesas[0].paginas[1].estado).toBe("PENDIENTE");
    expect(mesas[0].estado).toBe("EN_PROCESO");
    expect(mesas[0].progresoPct).toBe(25);
    expect(mesas[1].id).toBe("MESA 02");
    expect(mesas[1].estado).toBe("PENDIENTE");
    expect(mesas[1].progresoPct).toBe(0);
  });

  it("hueco RESCANEO cuenta como NO OK (invita al re-escaneo) y conserva su estado", () => {
    const archivadas = {
      "88-335-05-02-001": archivada([{ tipo: "DELEGADOS", pagina: 1, estado: "RESCANEO" }]),
    };
    const mesas = mesasRealesDe(archivadas, PUESTO, null);
    expect(mesas).toHaveLength(1);
    expect(mesas[0].paginas[0].estado).toBe("RESCANEO");
    expect(mesas[0].estado).toBe("PENDIENTE"); // 0 huecos OK
    // El guion apunta a la P2 PENDIENTE ANTES que al RESCANEO de la P1
    // (prioridad EN_PROCESO > PENDIENTE > RESCANEO — §guion).
    expect(proximaPagina(mesas)).toEqual({
      mesaId: "MESA 01",
      tipo: "DELEGADOS",
      pagina: 2,
    });
  });

  it("total null → SOLO las mesas archivadas (sin inventar vacías)", () => {
    const archivadas = {
      "88-335-05-02-002": archivada([{ tipo: "TRANSMISIÓN", pagina: 1, estado: "OK" }]),
    };
    const mesas = mesasRealesDe(archivadas, PUESTO, null);
    expect(mesas).toHaveLength(1);
    expect(mesas[0].id).toBe("MESA 02");
  });

  it("claves de OTRO puesto se ignoran (prefijo de clave DIVIPOL)", () => {
    const archivadas = {
      "88-335-05-02-001": archivada([]),
      "88-335-05-09-001": archivada([{ tipo: "DELEGADOS", pagina: 1, estado: "OK" }]),
    };
    const mesas = mesasRealesDe(archivadas, PUESTO, null);
    expect(mesas).toHaveLength(1);
    expect(mesas[0].id).toBe("MESA 01");
    expect(mesas[0].estado).toBe("PENDIENTE"); // sin huecos → pendiente
  });

  it("mesa archivada FUERA del rango total se añade al final (honestidad)", () => {
    const archivadas = {
      "88-335-05-02-007": archivada([{ tipo: "DELEGADOS", pagina: 1, estado: "OK" }]),
    };
    const mesas = derivarMesas(archivadas, PUESTO, 2);
    expect(mesas.map((m) => m.id)).toEqual(["MESA 01", "MESA 02", "MESA 07"]);
  });

  it("sin clasificación con página conocida → 2 páginas por tipo (default)", () => {
    const archivadas = { "88-335-05-02-001": archivada([], null) };
    // total: null solo acepta la función interna mesasRealesDe (jornada.ts:398-402);
    // derivarMesas (wrapper público) estrecha a number.
    const mesas = mesasRealesDe(archivadas, PUESTO, null);
    expect(mesas[0].paginas).toHaveLength(4);
  });
});

// ─── generacion.ts (estado de módulo — los its corren en orden) ─────────

describe("generacion · token de generación del disparo (H1)", () => {
  it("reserva incrementa y la vigencia sigue a la ÚLTIMA generación", () => {
    const g1 = siguienteGeneracion();
    expect(esGeneracionVigente(g1)).toBe(true);
    const g2 = siguienteGeneracion();
    expect(g2).toBeGreaterThan(g1);
    expect(esGeneracionVigente(g1)).toBe(false); // huérfano — no escribe estado
    expect(esGeneracionVigente(g2)).toBe(true);
  });
});

describe("generacion · contador de pipelines en vuelo (H2)", () => {
  it("cerrarPipeline solo devuelve true al llegar a cero", () => {
    abrirPipeline();
    abrirPipeline();
    expect(cerrarPipeline()).toBe(false); // queda 1 vivo — el viejo puede cerrar mientras el nuevo corre
    expect(cerrarPipeline()).toBe(true); // 0 vivos — el store apaga analisisEnVuelo
  });

  it("piso en cero: cerrar de más nunca vuelve negativo", () => {
    expect(cerrarPipeline()).toBe(true);
    expect(cerrarPipeline()).toBe(true);
  });
});

describe("generacion · cancelación dirigida a UNA generación", () => {
  it("solo la generación apuntada consume la cancelación", () => {
    const vieja = siguienteGeneracion();
    const vigente = siguienteGeneracion();
    cancelarGeneracionVigente("operador");
    expect(cancelacionPara(vigente)).toEqual({ generacion: vigente, motivo: "operador" });
    expect(cancelacionPara(vieja)).toBeNull(); // la del nuevo jamás la consume el viejo
  });

  it("olvidarCancelacion SOLO limpia si apunta a esa generación", () => {
    const gen = siguienteGeneracion();
    cancelarGeneracionVigente("interrumpida");
    olvidarCancelacion(gen - 1); // otra generación → intacta
    expect(cancelacionPara(gen)?.motivo).toBe("interrumpida"); // A3.3: el motivo conserva la adopción
    olvidarCancelacion(gen); // la dueña → se consume
    expect(cancelacionPara(gen)).toBeNull();
  });

  it("sin cancelación pendiente → null (y null jamás confunde con la gen 0)", () => {
    const gen = siguienteGeneracion();
    olvidarCancelacion(gen); // garantiza estado limpio
    expect(cancelacionPara(gen)).toBeNull();
    expect(cancelacionPara(0)).toBeNull();
  });
});

// ─── navegacion.ts (slice con set/get FAKE — misma forma que zustand) ───

/** Tienda mínima con la MISMA forma de set/get que zustand entrega a cada
 *  slice (R-27): set acepta parcial u updater, get devuelve el estado vivo. */
function tiendaFake(inicial: Partial<E14Store>): {
  set: E14Set;
  get: E14Get;
  estado: () => E14Store;
} {
  let estado = { ...inicial } as E14Store;
  const set: E14Set = (parcial) => {
    const delta = typeof parcial === "function" ? parcial(estado) : parcial;
    estado = { ...estado, ...delta };
  };
  const get: E14Get = () => estado;
  return { set, get, estado: () => estado };
}

/** Monta el slice navegación igual que la fachada: la tienda absorbe el
 *  estado INICIAL del slice (t.set(slice) — la composición de create()) y
 *  después aplican los overrides del caso de prueba. */
function montarNavegacion(inicial: Partial<E14Store> = {}): {
  slice: ReturnType<typeof crearNavegacion>;
  estado: () => E14Store;
} {
  const t = tiendaFake({});
  const slice = crearNavegacion(t.set, t.get);
  t.set(slice);
  t.set(inicial);
  return { slice, estado: t.estado };
}

/** dataURL JPEG válido de 4 bytes ("Hola") — suficiente para el hash C-08. */
const FOTO_OK = "data:image/jpeg;base64,SG9sYQ==";

describe("navegacion · estado inicial y acciones de vista", () => {
  it("arranca en ESCANEAR, sin destello y online", () => {
    const { slice, estado } = montarNavegacion();
    expect(slice.vista).toBe("escanear");
    expect(slice.destelloKey).toBe(0);
    expect(slice.online).toBe(true);
    expect(estado().vista).toBe("escanear"); // la tienda absorbió el estado inicial
  });

  it("navegar cambia SOLO la vista", () => {
    const { slice, estado } = montarNavegacion();
    slice.navegar("revision");
    expect(estado().vista).toBe("revision");
    expect(estado().online).toBe(true); // nada más se toca
  });

  it("destellar incrementa el destelloKey (animación desde cero)", () => {
    const { slice, estado } = montarNavegacion();
    slice.destellar();
    slice.destellar();
    slice.destellar();
    expect(estado().destelloKey).toBe(3);
  });
});

describe("navegacion · alternarConexion (C-08: hash real al volver la red)", () => {
  it("online → offline: solo apaga la bandera", () => {
    const { slice, estado } = montarNavegacion({ online: true, colaOffline: 2 });
    slice.alternarConexion();
    expect(estado().online).toBe(false);
    expect(estado().colaOffline).toBe(2); // la cola no se drena offline
  });

  it("offline → online drena la cola y RE-ESTAMPA el hash real del acta", async () => {
    const acta = { hashSha256: "EN COLA", fotoProcesada: FOTO_OK } as Acta;
    const { slice, estado } = montarNavegacion({ online: false, colaOffline: 1, actaActual: acta });
    slice.alternarConexion();
    expect(estado().online).toBe(true);
    expect(estado().colaOffline).toBe(0);
    await new Promise((r) => setTimeout(r, 20)); // el hash viaja fire-and-forget
    expect(estado().actaActual?.hashSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sin fotoProcesada → el campo queda «EN COLA» (honesto, jamás relleno)", async () => {
    const acta = { hashSha256: "EN COLA", fotoProcesada: null } as unknown as Acta;
    const { slice, estado } = montarNavegacion({ online: false, colaOffline: 1, actaActual: acta });
    slice.alternarConexion();
    await new Promise((r) => setTimeout(r, 20));
    expect(estado().actaActual?.hashSha256).toBe("EN COLA");
  });

  it("guard de identidad: un acta SIN «EN COLA» no se re-hasha", async () => {
    const acta = { hashSha256: "0".repeat(64), fotoProcesada: FOTO_OK } as Acta;
    const { slice, estado } = montarNavegacion({ online: false, colaOffline: 1, actaActual: acta });
    slice.alternarConexion();
    await new Promise((r) => setTimeout(r, 20));
    expect(estado().actaActual?.hashSha256).toBe("0".repeat(64));
  });

  it("volver online SIN cola no toca el acta", () => {
    const acta = { hashSha256: "EN COLA", fotoProcesada: FOTO_OK } as Acta;
    const { slice, estado } = montarNavegacion({ online: false, colaOffline: 0, actaActual: acta });
    slice.alternarConexion();
    expect(estado().online).toBe(true);
    expect(estado().actaActual?.hashSha256).toBe("EN COLA");
  });
});
