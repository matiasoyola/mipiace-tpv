// hierro-sirope (D, E, H3) · UNA BANDA POR MESA, Y QUE DIGA QUÉ ESTÁ LISTO.
//
// Lo que pasó el 18-10 (capturas 24, 25): M3 con un croissant en COCINA y
// un café en BARRA. Las dos secciones listas → DOS bandas idénticas «M3 ·
// listo para servir» en el TPV y DOS tarjetas «M3» en la columna «Listas»
// del AP11. Ninguna decía qué estaba listo, las dos hacían lo mismo, y
// juntas empujaban el ticket hasta meter la segunda línea bajo «Urgente».
//
// Filas de la tabla de sabotajes:
//
//   | Dos secciones listas → dos bandas | el banco de agrupación
//
// Y de paso lo que comparte el módulo: la etiqueta corta del KDS (E) y el
// rótulo del ticket (H3), que son las otras dos cosas que el 18-10 decían
// lo que no era.

import { describe, expect, it } from "vitest";

import { tituloDeComandaEnPantalla } from "@mipiacetpv/ticket-model";

import {
  agruparAvisos,
  textoDeBanda,
  type ComandaListaMin,
} from "../src/kitchen/tpv/agruparAvisos.js";
import { etiquetaDeLoEnviado } from "../src/lib/kitchenComanda.js";

const M3 = "mesa-3";
const T6 = "mesa-6";

function lista(over: Partial<ComandaListaMin> = {}): ComandaListaMin {
  return {
    orderId: "o-1",
    ticketId: "t-1",
    tableId: M3,
    tableName: "M3",
    section: "COCINA",
    readyAt: "2026-10-18T23:40:00.000Z",
    ...over,
  };
}

describe("hierro-sirope D · una banda por mesa", () => {
  it("SABOTAJE · dos secciones listas de la MISMA mesa son UNA banda", () => {
    const g = agruparAvisos([
      lista({ orderId: "o-cocina", section: "COCINA" }),
      lista({ orderId: "o-barra", section: "BARRA" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.texto).toBe("M3 · cocina y barra listas");
    // Un toque sirve LAS DOS: el camarero fue una vez y recogió lo que
    // había.
    expect(g[0]!.orderIds.sort()).toEqual(["o-barra", "o-cocina"]);
  });

  it("y dos mesas distintas siguen siendo dos bandas", () => {
    const g = agruparAvisos([
      lista({ orderId: "a", tableId: M3, tableName: "M3" }),
      lista({ orderId: "b", tableId: T6, tableName: "T6" }),
    ]);
    expect(g.map((x) => x.titulo)).toEqual(["M3", "T6"]);
  });

  it("con una sola sección y nada pendiente, el texto de siempre", () => {
    // Es el caso normal de un bar con una pantalla, y está probado en el
    // hierro: no se toca.
    expect(agruparAvisos([lista()])[0]!.texto).toBe("M3 · listo para servir");
  });

  it("si falta algo lo DICE: «barra lista (cocina en marcha)»", () => {
    const g = agruparAvisos(
      [lista({ orderId: "o-barra", section: "BARRA" })],
      [{ ticketId: "t-1", tableId: M3, section: "COCINA" }],
    );
    expect(g[0]!.texto).toBe("M3 · barra lista (cocina en marcha)");
  });

  it("una sección que ya está lista NO se cuenta como «en marcha»", () => {
    // Entre el GET y el evento una tarjeta puede aparecer en las dos
    // listas; «barra lista (barra en marcha)» no se le dice a nadie.
    const g = agruparAvisos(
      [lista({ section: "BARRA" })],
      [{ ticketId: "t-1", tableId: M3, section: "BARRA" }],
    );
    expect(g[0]!.texto).toBe("M3 · listo para servir");
    expect(g[0]!.enMarcha).toEqual([]);
  });

  it("la pila la ordena el readyAt MÁS ANTIGUO del grupo", () => {
    const g = agruparAvisos([
      lista({
        orderId: "nueva",
        tableId: T6,
        tableName: "T6",
        ticketId: "t-6",
        readyAt: "2026-10-18T23:50:00.000Z",
      }),
      lista({ orderId: "vieja-a", readyAt: "2026-10-18T23:45:00.000Z" }),
      lista({
        orderId: "vieja-b",
        section: "BARRA",
        readyAt: "2026-10-18T23:30:00.000Z",
      }),
    ]);
    expect(g.map((x) => x.titulo)).toEqual(["M3", "T6"]);
    expect(g[0]!.readyAt).toBe("2026-10-18T23:30:00.000Z");
  });

  it("un mostrador agrupa por TICKET: dos clientes son dos bandas", () => {
    const g = agruparAvisos([
      lista({
        orderId: "a",
        ticketId: "t-1",
        tableId: null,
        tableName: "Mostrador nº 1",
      }),
      lista({
        orderId: "b",
        ticketId: "t-2",
        tableId: null,
        tableName: "Mostrador nº 2",
      }),
    ]);
    expect(g.map((x) => x.titulo)).toEqual(["Mostrador nº 1", "Mostrador nº 2"]);
  });

  it("y una cuenta partida de la misma mesa es UN viaje", () => {
    const g = agruparAvisos([
      lista({ orderId: "a", ticketId: "t-1" }),
      lista({ orderId: "b", ticketId: "t-2", section: "BARRA" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.ticketIds.sort()).toEqual(["t-1", "t-2"]);
  });

  it("las secciones se nombran SIEMPRE en el mismo orden", () => {
    // Lo que el camarero reconoce de un vistazo es la forma de la frase.
    expect(textoDeBanda("M3", ["BARRA", "COCINA"], [])).toBe(
      "M3 · cocina y barra listas",
    );
    expect(textoDeBanda("M3", ["COCINA", "BARRA"], [])).toBe(
      "M3 · cocina y barra listas",
    );
    expect(textoDeBanda("M3", ["COCINA", "BARRA", "SALON"], [])).toBe(
      "M3 · cocina, barra y sala listas",
    );
  });
});

describe("hierro-sirope E · «Mostrador nº 1» en la pantalla de cocina", () => {
  it("se acorta: a 34 px en una tarjeta de cuatro columnas no cabe", () => {
    // Partido queda «Mostra / dor nº 1» (captura 11) y recortado en la
    // columna «Listas», «Mostrado» (captura 12c).
    expect(tituloDeComandaEnPantalla("Mostrador nº 1", 7)).toBe("Mostr. 1");
    expect(tituloDeComandaEnPantalla("Mostrador nº 12", 7)).toBe("Mostr. 12");
    expect(tituloDeComandaEnPantalla("Mostr. 1", 7)).toBe("Mostr. 1");
  });

  it("el nombre de una MESA no se toca: lo puso la dueña", () => {
    expect(tituloDeComandaEnPantalla("M3", 7)).toBe("M3");
    expect(tituloDeComandaEnPantalla("Terraza 2", 7)).toBe("Terraza 2");
  });

  it("sin título, el nº de comanda de siempre", () => {
    expect(tituloDeComandaEnPantalla(null, 7)).toBe("#7");
  });
});

describe("hierro-sirope H3 · el rótulo del ticket dice el estado real", () => {
  const ENVIADO = "2026-10-18T23:34:00.000Z";

  it("nada listo → «EN COCINA · hh:mm», como siempre", () => {
    expect(etiquetaDeLoEnviado(ENVIADO, null)).toMatch(/^EN COCINA · \d\d:\d\d$/);
    expect(
      etiquetaDeLoEnviado(ENVIADO, { listas: [], enMarcha: ["COCINA"] }),
    ).toMatch(/^EN COCINA · \d\d:\d\d$/);
  });

  it("todo listo → «LISTO», que es lo que la banda ya decía (captura 13b)", () => {
    expect(
      etiquetaDeLoEnviado(ENVIADO, { listas: ["BARRA"], enMarcha: [] }),
    ).toMatch(/^LISTO · \d\d:\d\d$/);
  });

  it("a medias → por sección, que es lo que hace falta saber", () => {
    expect(
      etiquetaDeLoEnviado(ENVIADO, { listas: ["BARRA"], enMarcha: ["COCINA"] }),
    ).toBe("BARRA LISTA · COCINA EN MARCHA");
  });

  it("sin hora de envío no se inventa ninguna", () => {
    expect(etiquetaDeLoEnviado(null, null)).toBe("EN COCINA");
    expect(etiquetaDeLoEnviado(null, { listas: ["COCINA"], enMarcha: [] })).toBe(
      "LISTO",
    );
  });
});
