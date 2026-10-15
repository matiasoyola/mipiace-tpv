// kds-2b · LOS ALÉRGENOS DE LA COMANDA QUE SALE POR LA WIFI.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | La comanda de la wifi sale con el catálogo viejo | gana lo que dice
//   | el servidor; y si no lo dice, se pide el catálogo antes de mandar
//   | Un plato sin alérgenos informados pasa por comprobado | sale
//   | «ALÉRGENOS SIN INFORMAR» en los DOS caminos
//
// Lo que pasó el 15-10: los alérgenos de ENSAYO se cargaron por script a
// las 13:21, el D8 llevaba la app abierta desde antes, y la tarjeta que la
// cocina recibió por la wifi traía las bravas de la silla de la celíaca
// **sin «¡LLEVA GLUTEN!»**. La de la nube sí lo llevaba.

import { describe, expect, it } from "vitest";

import { avisoSinInformar, SIN_INFORMAR } from "@mipiacetpv/ticket-model";

import {
  alergenosPorLineaDeEnvio,
  hayQuePreguntarElCatalogo,
} from "../src/kitchen/tpv/alergenosDeEnvio.js";
import { componerComandasLan } from "../src/kitchen/tpv/envioLan.js";
import type { EstadoCocinaMesa } from "../src/lib/kitchenComanda.js";

const DESTINO = { screen: true, printer: false, canCorrectSent: true };

function estado(over: Partial<EstadoCocinaMesa> = {}): EstadoCocinaMesa {
  return {
    diners: 4,
    revision: 0,
    lines: [],
    firedCourses: [],
    allergies: [],
    orders: [],
    destinations: { BARRA: DESTINO, COCINA: DESTINO, SALON: DESTINO },
    ...over,
  };
}

function lineaEstado(over: Partial<EstadoCocinaMesa["lines"][number]> = {}) {
  return {
    id: "l1",
    units: 1,
    sentUnits: 0,
    course: 1,
    seat: 3,
    section: "COCINA" as const,
    ...over,
  };
}

describe("kds-2b · de dónde salen los alérgenos del camino directo", () => {
  it("gana el SERVIDOR, aunque la línea del carrito diga otra cosa", () => {
    // La línea del carrito lleva la copia del catálogo cacheado, hecha al
    // añadir el plato. Si el catálogo era viejo, miente.
    const r = alergenosPorLineaDeEnvio({
      lines: [{ id: "l1", productId: "p1", allergens: [] }],
      estado: estado({ lines: [lineaEstado({ allergens: ["GLUTEN"] })] }),
      catalogo: [{ id: "p1", allergens: ["LACTEOS"] }],
    });
    expect(r.get("l1")).toEqual(["GLUTEN"]);
  });

  it("si el servidor no los dice, el catálogo RECIÉN pedido", () => {
    const r = alergenosPorLineaDeEnvio({
      lines: [{ id: "l1", productId: "p1", allergens: [] }],
      estado: estado({ lines: [lineaEstado()] }),
      catalogo: [{ id: "p1", allergens: ["GLUTEN"] }],
    });
    expect(r.get("l1")).toEqual(["GLUTEN"]);
  });

  it("y si tampoco se pudo pedir, la copia de la línea (lo de kds-2)", () => {
    const r = alergenosPorLineaDeEnvio({
      lines: [{ id: "l1", productId: "p1", allergens: ["SULFITOS"] }],
      estado: estado({ lines: [lineaEstado()] }),
    });
    expect(r.get("l1")).toEqual(["SULFITOS"]);
  });

  it("un vacío del SERVIDOR es un vacío de verdad: no se cae al catálogo", () => {
    // «No informado» dicho por quien lo sabe no se corrige con una caché.
    const r = alergenosPorLineaDeEnvio({
      lines: [{ id: "l1", productId: "p1", allergens: ["GLUTEN"] }],
      estado: estado({ lines: [lineaEstado({ allergens: [] })] }),
      catalogo: [{ id: "p1", allergens: ["GLUTEN"] }],
    });
    expect(r.get("l1")).toEqual([]);
  });
});

describe("kds-2b · cuándo se pide el catálogo antes de mandar", () => {
  const conAlergia = {
    allergies: [{ seat: 3, allergen: "GLUTEN" }],
    lines: [lineaEstado({ units: 1, sentUnits: 0 })],
  };

  it("mesa con alergia + servidor que no los dice + plato sin informar → sí", () => {
    expect(
      hayQuePreguntarElCatalogo({
        lines: [{ id: "l1", productId: "p1", allergens: [] }],
        estado: estado(conAlergia),
      }),
    ).toBe(true);
  });

  it("sin alergias declaradas → NO se pide nada", () => {
    // Nadie espera un viaje a la API por un dato que no se pinta.
    expect(
      hayQuePreguntarElCatalogo({
        lines: [{ id: "l1", productId: "p1", allergens: [] }],
        estado: estado({ lines: conAlergia.lines }),
      }),
    ).toBe(false);
  });

  it("si el servidor ya los dice → NO se pide nada", () => {
    expect(
      hayQuePreguntarElCatalogo({
        lines: [{ id: "l1", productId: "p1", allergens: [] }],
        estado: estado({
          allergies: conAlergia.allergies,
          lines: [lineaEstado({ allergens: [] })],
        }),
      }),
    ).toBe(false);
  });

  it("si lo que se va a mandar ya tiene alérgenos → NO se pide nada", () => {
    expect(
      hayQuePreguntarElCatalogo({
        lines: [{ id: "l1", productId: "p1", allergens: ["GLUTEN"] }],
        estado: estado(conAlergia),
      }),
    ).toBe(false);
  });

  it("una línea YA ENVIADA sin alérgenos no obliga a pedir nada", () => {
    // Lo que se manda son las unidades pendientes. Lo que ya está en la
    // plancha no se vuelve a componer.
    expect(
      hayQuePreguntarElCatalogo({
        lines: [{ id: "l1", productId: "p1", allergens: [] }],
        estado: estado({
          allergies: conAlergia.allergies,
          lines: [lineaEstado({ units: 1, sentUnits: 1 })],
        }),
      }),
    ).toBe(false);
  });
});

describe("kds-2b · «ALÉRGENOS SIN INFORMAR» en la comanda de la wifi", () => {
  const comun = {
    ticketId: "t1",
    tableId: "m5",
    tableName: "M5",
    clientSendId: "55555555-5555-4555-8555-555555555555",
    urgent: false,
    nombrePorLinea: new Map([
      ["l1", "Patatas bravas"],
      ["l2", "Magro"],
      ["l3", "Calamares"],
    ]),
    notasPorLinea: new Map<string, string[]>(),
    ahora: new Date("2026-10-15T13:30:00.000Z"),
  };

  const mesaConCeliaco = estado({
    allergies: [{ seat: 3, allergen: "GLUTEN" }],
    lines: [
      lineaEstado({ id: "l1", seat: 3 }),
      lineaEstado({ id: "l2", seat: 3 }),
      lineaEstado({ id: "l3", seat: null }),
    ],
  });

  it("el magro de la silla 3 sale marcado; las bravas gritan; el plato sin silla, nada", () => {
    const [comanda] = componerComandasLan({
      ...comun,
      estado: mesaConCeliaco,
      alergenosPorLinea: new Map([
        ["l1", ["GLUTEN"]],
        ["l2", []],
        ["l3", []],
      ]),
    });
    const porId = new Map(comanda!.lines.map((l) => [l.ticketLineId, l]));

    // Las bravas: comprobadas y con gluten. La alarma de kds-1, intacta.
    expect(porId.get("l1")!.allergyWarning).toBe("¡LLEVA GLUTEN!");
    expect(porId.get("l1")!.allergensUnknown).toBeNull();

    // El magro: su ficha no informa de nada. Esto es el hallazgo 4.
    expect(porId.get("l2")!.allergensUnknown).toBe(SIN_INFORMAR);
    expect(porId.get("l2")!.allergyWarning).toBeNull();
    // Y sigue llevando el «SIN GLUTEN» de la capa 2: la silla es la misma.
    expect(porId.get("l2")!.seatAllergy).toBe("SIN GLUTEN");

    // Los calamares, sin silla: no se sabe de quién son y no se marca.
    expect(porId.get("l3")!.allergensUnknown).toBeNull();
  });

  it("y con el catálogo viejo, el magro Y las bravas salen sin informar", () => {
    // Exactamente lo que llegó al AP11 el 15-10 —y por qué el aviso hace
    // falta aunque el dato se arregle: la cocina ve que ese plato no está
    // comprobado en vez de leer un «SIN GLUTEN» que parece una
    // instrucción cumplida.
    const [comanda] = componerComandasLan({
      ...comun,
      estado: mesaConCeliaco,
      alergenosPorLinea: new Map([
        ["l1", []],
        ["l2", []],
        ["l3", []],
      ]),
    });
    const bravas = comanda!.lines.find((l) => l.ticketLineId === "l1")!;
    expect(bravas.allergyWarning).toBeNull();
    expect(bravas.allergensUnknown).toBe(SIN_INFORMAR);
  });

  it("una mesa SIN alergias no marca nada, con 128 platos sin informar", () => {
    const [comanda] = componerComandasLan({
      ...comun,
      estado: estado({ lines: [lineaEstado({ id: "l1", seat: 3 })] }),
      alergenosPorLinea: new Map([["l1", []]]),
    });
    expect(comanda!.lines[0]!.allergensUnknown).toBeNull();
  });
});

describe("kds-2b · la regla, en limpio", () => {
  it("silla con algo declarado + plato sin informar → el aviso", () => {
    expect(avisoSinInformar([], ["GLUTEN"])).toBe(SIN_INFORMAR);
  });

  it("plato informado → nada que decir, lo diga o no la capa 3", () => {
    expect(avisoSinInformar(["LACTEOS"], ["GLUTEN"])).toBeNull();
  });

  it("silla sin nada declarado → nada que decir", () => {
    expect(avisoSinInformar([], [])).toBeNull();
  });
});
