// clinica-9 (3) · EL BUSCADOR QUE NO ENCONTRABA A LA PACIENTE.
//
// Pasada en hierro del 24-10, capturas 05 y 40: en «Nueva cita» se teclea
// «Carmen Prueba», sale **«Sin coincidencias»** y existe «Carmen Prueba
// Demo, 600000001». La recepción crea la ficha que la pantalla le ofrece y
// la clínica se queda con dos fichas de la misma persona — o sea, con dos
// historias clínicas y media en cada una.
//
// El fallo era de una línea: lo tecleado se comparaba ENTERO contra CADA
// campo. «Carmen Prueba» no está dentro de «Carmen» ni dentro de «Prueba
// Demo».
//
// Sabotaje: vuelve `clienteCasaCon` a un `includes` por campo y caen los
// cinco primeros tests; quita el aviso de parecidos y caen los cuatro
// últimos.

import { describe, expect, it } from "vitest";

import {
  clienteCasaCon,
  clientesParecidosA,
  searchClientsLocal,
  type ClientRow,
} from "../src/lib/clients.js";

function c(
  firstName: string,
  lastName: string,
  extra: Partial<ClientRow> = {},
): ClientRow {
  return {
    id: `${firstName}-${lastName}`.toLowerCase().replace(/\s+/g, "-"),
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

/** La «Clínica demo» del 24-10, más gente para que el filtro signifique algo. */
const FICHERO: ClientRow[] = [
  c("Carmen", "Prueba Demo", { phone: "600 000 001", email: "carmen@ej.es" }),
  c("José", "Martín Ruiz", { phone: "611222333" }),
  c("Ana", "Prueba", { phone: "622333444" }),
  c("Rosario", "Jiménez", { phone: "633444555", email: "ROSA@Clinica.es" }),
  c("Sole", "", { phone: "644555666" }),
];

const nombres = (xs: ClientRow[]) =>
  xs.map((x) => `${x.firstName} ${x.lastName}`.trim());

describe("clinica-9 · buscar por palabras, no por la cadena entera", () => {
  it("«Carmen Prueba» encuentra a «Carmen Prueba Demo» (la del 24-10)", () => {
    expect(nombres(searchClientsLocal(FICHERO, "Carmen Prueba"))).toEqual([
      "Carmen Prueba Demo",
    ]);
  });

  it("el orden de las palabras da igual: «Prueba Carmen» también", () => {
    expect(nombres(searchClientsLocal(FICHERO, "Prueba Carmen"))).toEqual([
      "Carmen Prueba Demo",
    ]);
  });

  it("sin tildes: «Jose Martin» encuentra a «José Martín Ruiz»", () => {
    expect(nombres(searchClientsLocal(FICHERO, "jose martin"))).toEqual([
      "José Martín Ruiz",
    ]);
  });

  it("el teléfono casa aunque la ficha lo tenga con espacios", () => {
    expect(nombres(searchClientsLocal(FICHERO, "600000001"))).toEqual([
      "Carmen Prueba Demo",
    ]);
    expect(nombres(searchClientsLocal(FICHERO, "600 000 001"))).toEqual([
      "Carmen Prueba Demo",
    ]);
  });

  it("y el email, sin mayúsculas", () => {
    expect(nombres(searchClientsLocal(FICHERO, "rosa@clinica.es"))).toEqual([
      "Rosario Jiménez",
    ]);
  });

  it("una palabra suelta sigue trayendo a TODOS los que la llevan", () => {
    expect(nombres(searchClientsLocal(FICHERO, "prueba")).sort()).toEqual(
      ["Ana Prueba", "Carmen Prueba Demo"].sort(),
    );
  });

  it("lo que no está, no está: no se inventa nadie", () => {
    expect(searchClientsLocal(FICHERO, "Carmen Jiménez")).toEqual([]);
    // Un canario: una cadena que no aparece en ninguna ficha.
    expect(searchClientsLocal(FICHERO, "zzzqqq")).toEqual([]);
  });

  it("sin nada tecleado, la lista entera y en A–Z", () => {
    expect(searchClientsLocal(FICHERO, "")).toHaveLength(FICHERO.length);
  });

  it("el criterio es UNO: `clienteCasaCon` es el mismo que usa la lista", () => {
    const carmen = FICHERO[0]!;
    expect(clienteCasaCon(carmen, "Carmen Prueba")).toBe(true);
    expect(clienteCasaCon(carmen, "carmen demo")).toBe(true);
    expect(clienteCasaCon(carmen, "Carmen Jiménez")).toBe(false);
  });
});

describe("clinica-9 · antes de crear otra ficha, a quién se parece", () => {
  it("«Carmen Prueba» avisa de «Carmen Prueba Demo» con su teléfono", () => {
    const p = clientesParecidosA(FICHERO, {
      firstName: "Carmen",
      lastName: "Prueba",
    });
    expect(nombres(p)).toEqual(["Carmen Prueba Demo"]);
    expect(p[0]!.phone).toBe("600 000 001");
  });

  it("el MISMO teléfono avisa aunque el nombre no se parezca en nada", () => {
    const p = clientesParecidosA(FICHERO, {
      firstName: "Carmina",
      lastName: "Pruebas",
      phone: "600000001",
    });
    expect(nombres(p)).toEqual(["Carmen Prueba Demo"]);
  });

  it("y el mismo email", () => {
    const p = clientesParecidosA(FICHERO, {
      firstName: "Rosa",
      lastName: "",
      email: "rosa@clinica.es",
    });
    expect(nombres(p)).toEqual(["Rosario Jiménez"]);
  });

  it("alguien que no se parece a nadie no dispara ningún aviso", () => {
    expect(
      clientesParecidosA(FICHERO, {
        firstName: "Lucía",
        lastName: "Fernández",
        phone: "655666777",
      }),
    ).toEqual([]);
  });

  it("un prefijo corto NO empareja medio fichero", () => {
    // «600» son tres dígitos: con eso casi todos los móviles del fichero
    // «se parecerían», y un aviso que sale siempre no lo lee nadie.
    expect(
      clientesParecidosA(FICHERO, {
        firstName: "Nadie",
        lastName: "Deaquí",
        phone: "600",
      }),
    ).toEqual([]);
  });
});
