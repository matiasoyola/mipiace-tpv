// n1-hosteleria-2 · hallazgo 9 · UN AVISO DE «LISTO» ABRE UNA HOJA, NO
// SIRVE EN EL ACTO.
//
// Matías, 23-10, ya con la 1.29.0 en la mano: al pulsar un aviso de
// cocina el TPV lo daba por servido en el acto. El camarero toca, el
// aviso desaparece, y entonces tiene que acordarse de qué era — porque
// la única pista que había es el nombre de la mesa.
//
// Lo que dictó: el aviso abre **una hoja por mesa** con lo que está listo
// (cantidad, nombre ENTERO, alergias marcadas) y un «Hecho» grande
// abajo. Y **en todos los aparatos**, no sólo en la mano: es un cambio de
// flujo, no de reparto. De ahí la segunda excepción a la restricción.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | El aviso vuelve a servir en el acto        | este banco
//   | En el terminal sigue siendo «hecho» directo | kds-tpv-cocina
//   | La hoja no agrupa las dos secciones         | dos viajes por mesa

import { describe, expect, it } from "vitest";

import {
  agruparListasPorMesa,
  alergenosDeLaMesa,
  hojaDeLaMesa,
  hojaDeListoOcupaLaPantalla,
  rotuloDeLinea,
  type ListaDeCocina,
} from "../src/lib/avisosListos.js";
import {
  HECHO_ALTO_MANO,
  HECHO_ALTO_TERMINAL,
} from "../src/kitchen/tpv/HojaDeListo.js";
import { MIN_TOUCH_PX } from "../src/lib/hospitalityTheme.js";
import { SUELO_LETRA_MANO_PX } from "../src/lib/roomGrid.js";

const COCINA = (o: Partial<ListaDeCocina> = {}): ListaDeCocina => ({
  orderId: "o1",
  tableId: "t-m4",
  tableName: "M4",
  section: "COCINA",
  readyAt: "2026-10-23T10:20:00.000Z",
  lines: [{ id: "l1", name: "Café con leche", units: 2, allergens: [] }],
  ...o,
});

describe("n1-hosteleria-2 · una hoja POR MESA (9)", () => {
  it("dos mesas listas son dos hojas", () => {
    const g = agruparListasPorMesa([
      COCINA(),
      COCINA({ orderId: "o2", tableId: "t-t6", tableName: "T6" }),
    ]);
    expect(g).toHaveLength(2);
    expect(g.map((m) => m.tableName)).toEqual(["M4", "T6"]);
  });

  it("una mesa con las bravas en cocina y las cañas en barra es UNA hoja", () => {
    // Y es el caso que justifica que `orderIds` sea una lista: el
    // camarero hace UN viaje, así que el «Hecho» sirve las dos.
    const g = agruparListasPorMesa([
      COCINA({
        orderId: "cocina",
        section: "COCINA",
        lines: [{ id: "a", name: "Bravas", units: 1, allergens: [] }],
      }),
      COCINA({
        orderId: "barra",
        section: "BARRA",
        readyAt: "2026-10-23T10:22:00.000Z",
        lines: [{ id: "b", name: "Caña", units: 2, allergens: [] }],
      }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.orderIds).toEqual(["cocina", "barra"]);
    expect(g[0]!.secciones).toEqual(["COCINA", "BARRA"]);
    expect(g[0]!.lineas.map((l) => l.name)).toEqual(["Bravas", "Caña"]);
    // La más antigua manda, que es el orden de la decisión 5 de kds-1.
    expect(g[0]!.readyAt).toBe("2026-10-23T10:20:00.000Z");
  });

  it("SABOTAJE · sin agrupar, la misma mesa pediría DOS viajes", () => {
    const sinAgrupar = [
      COCINA({ orderId: "cocina" }),
      COCINA({ orderId: "barra", section: "BARRA" }),
    ];
    // Lo que se ve si cada comanda es su propia fila: dos avisos de M4.
    expect(sinAgrupar).toHaveLength(2);
    // Lo que hay: uno.
    expect(agruparListasPorMesa(sinAgrupar)).toHaveLength(1);
  });

  it("las ventas SIN mesa no se agrupan entre sí", () => {
    // Dos mostradores distintos no comparten viaje.
    const g = agruparListasPorMesa([
      COCINA({ orderId: "a", tableId: null, tableName: null }),
      COCINA({ orderId: "b", tableId: null, tableName: null }),
    ]);
    expect(g).toHaveLength(2);
  });

  it("de más antigua a más nueva, que es quien lleva esperando", () => {
    const g = agruparListasPorMesa([
      COCINA({ orderId: "nueva", tableId: "t2", tableName: "T2", readyAt: "2026-10-23T10:25:00.000Z" }),
      COCINA({ orderId: "vieja", tableId: "m1", tableName: "M1", readyAt: "2026-10-23T10:05:00.000Z" }),
    ]);
    expect(g.map((m) => m.tableName)).toEqual(["M1", "T2"]);
  });

  it("se encuentra la hoja de una mesa concreta", () => {
    const listas = [COCINA(), COCINA({ orderId: "o2", tableId: "t-t6", tableName: "T6" })];
    expect(hojaDeLaMesa(listas, "t-t6")!.tableName).toBe("T6");
    expect(hojaDeLaMesa(listas, "no-existe")).toBeNull();
    // Y por comanda, para la venta sin mesa.
    const sinMesa = [COCINA({ orderId: "x", tableId: null, tableName: null })];
    expect(hojaDeLaMesa(sinMesa, null, "x")!.orderIds).toEqual(["x"]);
  });
});

describe("n1-hosteleria-2 · lo que la hoja tiene que decir", () => {
  it("cantidad delante y el nombre ENTERO", () => {
    expect(rotuloDeLinea({ id: "1", name: "Café Americano", units: 2, allergens: [] }))
      .toBe("2 · Café Americano");
    // Nada de truncar: «Café…» no distingue un americano de un cortado,
    // que es el 🔴 que n1-hosteleria arregló en la comanda.
    expect(rotuloDeLinea({ id: "1", name: "Croissant a la plancha", units: 1, allergens: [] }))
      .toContain("Croissant a la plancha");
  });

  it("media unidad se escribe entera, no redondeada a cero", () => {
    expect(rotuloDeLinea({ id: "1", name: "Tarta", units: 0.5, allergens: [] }))
      .toBe("0.50 · Tarta");
  });

  it("los alérgenos de la mesa salen juntos y sin repetir", () => {
    const g = agruparListasPorMesa([
      COCINA({
        lines: [
          { id: "a", name: "Tostada", units: 1, allergens: ["GLUTEN"] },
          { id: "b", name: "Tortilla", units: 1, allergens: ["HUEVO", "GLUTEN"] },
        ],
      }),
    ]);
    expect(alergenosDeLaMesa(g[0]!)).toEqual(["GLUTEN", "HUEVO"]);
  });

  it("sin alérgenos no se inventa ninguno", () => {
    expect(alergenosDeLaMesa(agruparListasPorMesa([COCINA()])[0]!)).toEqual([]);
  });

  it("lo que llega por la WIFI, sin detalle, no rompe la hoja", () => {
    // kds-2 · una tarjeta que sólo llegó por la LAN no trae líneas ni
    // sección. La hoja sigue valiendo: dice de qué mesa es y sirve.
    const g = agruparListasPorMesa([
      { orderId: "lan:abc", tableName: "T3", readyAt: "2026-10-23T10:00:00.000Z" },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.lineas).toEqual([]);
    expect(g[0]!.secciones).toEqual(["COCINA"]);
  });
});

describe("n1-hosteleria-2 · el flujo es de TODOS los aparatos (9)", () => {
  it("la hoja ocupa la pantalla SÓLO en la mano", () => {
    // R1 en la mano: una sola capa. En el terminal sale centrada — tapar
    // 1280×800 para enseñar tres líneas sería esconderle la sala a un
    // cajero que está de pie delante de ella.
    expect(hojaDeListoOcupaLaPantalla(true)).toBe(true);
    expect(hojaDeListoOcupaLaPantalla(false)).toBe(false);
  });

  it("pero el «Hecho» existe en los DOS, y en los dos es grande", () => {
    // Esto es lo que hace que sea un cambio de flujo y no de reparto: lo
    // que cambia con el tamaño es la forma, no los pasos.
    expect(HECHO_ALTO_MANO).toBeGreaterThanOrEqual(48);
    expect(HECHO_ALTO_TERMINAL).toBeGreaterThanOrEqual(48);
    // Y en la mano es el objetivo más grande de la pantalla.
    expect(HECHO_ALTO_MANO).toBeGreaterThan(MIN_TOUCH_PX);
  });

  it("R4 · la letra de la hoja llega al suelo en la mano", () => {
    expect(SUELO_LETRA_MANO_PX).toBe(15);
  });
});
