// B-reservas-mostrador F3 · un apellido vacío no puede desordenar la lista.
//
// Los apellidos pasan a ser opcionales porque Sole apunta a sus clientas por
// el nombre de pila. La cadena vacía ordena ANTES que cualquier letra, así que
// sin tocar nada TODAS esas clientas se amontonarían al principio de la lista
// — justo donde no se las busca. Y `${nombre} ${apellido}` deja un espacio
// colgando al final.
//
// Este es EL A–Z que se ve: `refreshClients()` se baja el tenant entero al
// caché y la lista se pinta desde aquí. El `orderBy` del servidor es el orden
// del cursor de paginación.

import { describe, expect, it } from "vitest";

import {
  clientFullName,
  clientSortKey,
  searchClientsLocal,
  sortClientsAz,
  type ClientRow,
} from "../src/lib/clients.js";

function c(firstName: string, lastName: string, extra: Partial<ClientRow> = {}): ClientRow {
  return {
    id: `${firstName}-${lastName}`,
    externalId: null,
    firstName,
    lastName,
    phone: null,
    email: null,
    birthdate: null,
    holdedContactId: null,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("el nombre completo de una clienta sin apellidos", () => {
  it("no deja un espacio colgando", () => {
    expect(clientFullName(c("Sole", ""))).toBe("Sole");
    expect(clientFullName(c("Sole", ""))).not.toMatch(/\s$/);
  });

  it("con apellidos, el de siempre", () => {
    expect(clientFullName(c("Carmen", "Ruiz"))).toBe("Carmen Ruiz");
  });

  it("y un apellido que sólo son espacios se comporta igual", () => {
    expect(clientFullName(c("Sole", "   "))).toBe("Sole");
  });
});

describe("el A–Z coloca a la clienta sin apellidos por su NOMBRE", () => {
  it("Sole cae en la S, no la primera de la lista", () => {
    const lista = [
      c("Ana", "Soto"),
      c("Sole", ""), // sin apellido
      c("Lucía", "Suárez"),
      c("Carmen", "Ruiz"),
    ];
    const orden = sortClientsAz(lista).map(clientFullName);
    // «Sole» ordena por su nombre, así que va con las eses: Ruiz, Sole, Soto,
    // Suárez (Sole < Soto porque la l va antes que la t).
    expect(orden).toEqual(["Carmen Ruiz", "Sole", "Ana Soto", "Lucía Suárez"]);
    // Lo que importa: NO es la primera, que es donde caía antes.
    expect(orden[0]).not.toBe("Sole");
    expect(orden.indexOf("Sole")).toBeGreaterThan(orden.indexOf("Carmen Ruiz"));
  });

  it("varias sin apellidos se ordenan entre sí por el nombre", () => {
    const orden = sortClientsAz([
      c("Isa", ""),
      c("Ana", ""),
      c("Sole", ""),
    ]).map((x) => x.firstName);
    expect(orden).toEqual(["Ana", "Isa", "Sole"]);
  });

  it("la clave de orden es el apellido, o el nombre si no hay apellido", () => {
    expect(clientSortKey(c("Sole", ""))).toBe("Sole");
    expect(clientSortKey(c("Carmen", "Ruiz"))).toBe("Ruiz");
    expect(clientSortKey(c("Sole", "  "))).toBe("Sole");
  });

  it("mismo apellido: desempata el nombre, como siempre", () => {
    const orden = sortClientsAz([
      c("Lucía", "Ruiz"),
      c("Ana", "Ruiz"),
    ]).map((x) => x.firstName);
    expect(orden).toEqual(["Ana", "Lucía"]);
  });

  it("el orden respeta los acentos y la ñ del español", () => {
    const orden = sortClientsAz([
      c("A", "Núñez"),
      c("B", "Nueva"),
      c("C", "Marín"),
    ]).map((x) => x.lastName);
    expect(orden[0]).toBe("Marín");
    expect(orden).toContain("Núñez");
  });

  it("el buscador también las encuentra por el nombre de pila", () => {
    const lista = [c("Sole", ""), c("Carmen", "Ruiz")];
    expect(searchClientsLocal(lista, "sole").map(clientFullName)).toEqual(["Sole"]);
    // Y sin query, salen todas en el A–Z bueno.
    expect(searchClientsLocal(lista, "")).toHaveLength(2);
  });
});
