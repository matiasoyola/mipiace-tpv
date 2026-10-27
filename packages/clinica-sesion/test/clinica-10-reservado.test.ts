// clinica-10 (1) · LA REGLA DE LO RESERVADO, EN PURO.
//
// `semillaDeLoReservado` (con qué nace marcada la sesión de una cita),
// `nivelCobrado` (qué nivel de quiropodia se cobra, o ninguno) y lo que
// `normalizarSesionV2` hace con el `null` que la pantalla manda.
//
// El catálogo es el de Rosario (`docs/implantaciones/rosario/
// catalogo-tpv.csv`) con un cambio que importa y va dicho: la **cura**
// va aquí en la categoría de quiropodia, que es como está en la «Clínica
// demo» y es lo que produjo la captura 10b de la pasada del 27-10. En el
// CSV de Rosario la cura es de cirugía.

import { describe, expect, it } from "vitest";

import {
  nivelCobrado,
  normalizarSesionV2,
  semillaDeLoReservado,
  versionesDeHoy,
  type ServicioDeSesion,
} from "../src/index.js";

const CONSULTA = "s-pod-001";
const BASICA = "s-pod-002";
const COMPLETA = "s-pod-003";
const EXTRA = "s-pod-004";
const CURA = "s-pod-006";
/** Un producto sin tipo de visita: una crema, un bono. No es de sesión. */
const CREMA = "s-crema";

const CATALOGO: ServicioDeSesion[] = [
  {
    serviceId: CONSULTA,
    nombre: "Consulta diagnóstico",
    precio: 20,
    iva: 0,
    tipo: "GENERAL",
    nivelQuiropodia: null,
  },
  {
    serviceId: BASICA,
    nombre: "Quiropodia básica",
    precio: 25,
    iva: 0,
    tipo: "QUIROPODIA",
    nivelQuiropodia: 1,
  },
  {
    serviceId: COMPLETA,
    nombre: "Quiropodia completa",
    precio: 26,
    iva: 0,
    tipo: "QUIROPODIA",
    nivelQuiropodia: 2,
  },
  {
    serviceId: EXTRA,
    nombre: "Quiropodia extra",
    precio: 27,
    iva: 0,
    tipo: "QUIROPODIA",
    nivelQuiropodia: 3,
  },
  {
    serviceId: CURA,
    nombre: "Cura",
    precio: 13,
    iva: 0,
    tipo: "QUIROPODIA",
    nivelQuiropodia: null,
  },
];

function semilla(reservados: string[]) {
  return semillaDeLoReservado({ reservados, catalogo: CATALOGO });
}

describe("clinica-10 · semillaDeLoReservado", () => {
  it("marca el servicio reservado, en su tipo", () => {
    expect(semilla([CONSULTA]).servicios).toEqual({ GENERAL: [CONSULTA] });
  });

  it("marca varios, cada uno en el suyo", () => {
    expect(semilla([CONSULTA, CURA]).servicios).toEqual({
      GENERAL: [CONSULTA],
      QUIROPODIA: [CURA],
    });
  });

  it("no marca los TRES NIVELES: ésos no son chips, los pone el nivel", () => {
    expect(semilla([COMPLETA]).servicios).toEqual({});
  });

  it("ignora lo que el catálogo de sesión no conoce", () => {
    // Un bono o una crema reservados en la misma cita no son una línea
    // de la sesión. Se tira en silencio, como las marcas de una zona que
    // no existe.
    expect(semilla([CREMA, "nada-de-nada"]).servicios).toEqual({});
  });

  it("no repite un servicio reservado dos veces", () => {
    expect(semilla([CONSULTA, CONSULTA]).servicios).toEqual({
      GENERAL: [CONSULTA],
    });
  });
});

describe("clinica-10 · ¿se propone un nivel de quiropodia?", () => {
  it("sin nada reservado, sí (clinica-5: una quiropodia es al menos una)", () => {
    expect(semilla([]).seProponeNivel).toBe(true);
  });

  it("con un NIVEL reservado, sí", () => {
    expect(semilla([COMPLETA]).seProponeNivel).toBe(true);
  });

  it("con una CURA de quiropodia reservada, NO", () => {
    expect(semilla([CURA]).seProponeNivel).toBe(false);
  });

  it("con la cura Y un nivel, sí: lo reservado incluye un nivel", () => {
    expect(semilla([CURA, EXTRA]).seProponeNivel).toBe(true);
  });

  it("con una consulta GENERAL reservada, sí: lo de quiropodia es lo que manda", () => {
    // Marcar «Quiropodia» a mano en una cita de consulta es la podóloga
    // diciendo que hoy también hace quiropodia. Pedirle un toque más
    // sería lo contrario de este bloque.
    expect(semilla([CONSULTA]).seProponeNivel).toBe(true);
  });
});

describe("clinica-10 · nivelCobrado", () => {
  it("sin actos y con propuesta, la básica", () => {
    expect(
      nivelCobrado({ actos: [], nivelAMano: null, seProponeNivel: true }),
    ).toBe(1);
  });

  it("sin actos y SIN propuesta, ninguno", () => {
    expect(
      nivelCobrado({ actos: [], nivelAMano: null, seProponeNivel: false }),
    ).toBeNull();
  });

  it("con un acto marcado vuelve a haber nivel, aunque no se propusiera", () => {
    // Marcar «deslaminado» es decir que hoy se ha hecho quiropodia. Y
    // entonces hay nivel sin que la podóloga toque nada más: es el
    // «mínimos clics» en el otro sentido.
    expect(
      nivelCobrado({
        actos: ["durezas"],
        nivelAMano: null,
        seProponeNivel: false,
      }),
    ).toBe(1);
  });

  it("y el acto sube el nivel como siempre", () => {
    expect(
      nivelCobrado({
        actos: ["fresado"],
        nivelAMano: null,
        seProponeNivel: false,
      }),
    ).toBe(3);
  });

  it("un acto que la lista no conoce no cuenta como quiropodia hecha", () => {
    expect(
      nivelCobrado({
        actos: ["masaje-tailandes"],
        nivelAMano: null,
        seProponeNivel: false,
      }),
    ).toBeNull();
  });

  it("lo elegido a mano manda siempre", () => {
    expect(
      nivelCobrado({ actos: [], nivelAMano: 3, seProponeNivel: false }),
    ).toBe(3);
  });
});

// ── Y lo que el servidor hace con todo esto al escribir ──────────────

function cerrar(bloqueQuiropodia: Record<string, unknown>) {
  const r = normalizarSesionV2({
    tipos: ["QUIROPODIA"],
    bloques: { QUIROPODIA: bloqueQuiropodia } as never,
    catalogo: CATALOGO,
    marcas: {},
    dolor: 3,
    evolucion: null,
    consejos: [],
    proximaCita: null,
    nota: null,
    alertaIds: [],
    pendientesAbiertos: [],
    pendientesCerradosAMano: [],
    pendientesNuevos: [],
    versiones: versionesDeHoy(),
    firma: {
      autorNombre: "Rosario",
      colegiado: "45/0123",
      firmadaEn: "2026-10-27T14:00:00.000Z",
    },
  } as never);
  if (!r.ok) throw new Error(`no cerró: ${r.motivo}`);
  return r;
}

describe("clinica-10 · el cierre escribe «sin nivel» cuando se manda", () => {
  it("`nivelElegido: null` no cobra ningún nivel", () => {
    const r = cerrar({ actos: [], nivelElegido: null, servicios: [CURA] });
    expect(r.cuerpo.bloques.QUIROPODIA?.nivelElegido).toBeNull();
    expect(r.cuerpo.bloques.QUIROPODIA?.productoDelNivel).toBeNull();
    // Y a caja va sólo la cura: nada de «Quiropodia básica».
    expect(r.cuerpo.tratamientos).toEqual([CURA]);
  });

  it("pero la CLAVE QUE NO VIENE sigue cobrando la propuesta", () => {
    // La tercera rama, la de siempre y la segura: un cuerpo malformado
    // cobra la quiropodia que marcar el tipo implica, en vez de dejar la
    // visita sin línea sin que nadie lo haya pedido.
    const r = cerrar({ actos: [], servicios: [] });
    expect(r.cuerpo.bloques.QUIROPODIA?.nivelElegido).toBe(1);
    expect(r.cuerpo.tratamientos).toEqual([BASICA]);
  });

  it("y con ACTOS marcados no se cree el «sin nivel»", () => {
    // Marcar un acto es haber hecho quiropodia. Una pantalla que mandara
    // las dos cosas estaría cobrando de menos una visita que sí se hizo,
    // y lo que entra en la historia lo decide quien la escribe.
    const r = cerrar({
      actos: ["fresado"],
      nivelElegido: null,
      servicios: [],
    });
    expect(r.cuerpo.bloques.QUIROPODIA?.nivelElegido).toBe(3);
    expect(r.cuerpo.tratamientos).toEqual([EXTRA]);
  });

  it("el nivel puesto a mano se escribe igual que siempre", () => {
    const r = cerrar({ actos: [], nivelElegido: 2, servicios: [] });
    expect(r.cuerpo.bloques.QUIROPODIA?.nivelPropuesto).toBe(1);
    expect(r.cuerpo.bloques.QUIROPODIA?.nivelElegido).toBe(2);
    expect(r.cuerpo.tratamientos).toEqual([COMPLETA]);
  });
});
