// mover-con-otra · el cruce puro de la puerta de «otra peluquera».
//
// Lo que se prueba aquí es la DECISIÓN, sin BD ni Fastify: quién pasa, quién
// es 404 y quién es 409 con su motivo escrito. Lo que NO se puede probar
// aquí es que la ruta la llame (eso es `agenda-mover-con-otra.e2e.ts`, y es
// la fila 1 de la tabla de sabotajes: se ignora `staffUserId` y estos tests
// siguen verdes).

import { describe, expect, it } from "vitest";

import {
  comprobarProfesional,
  type PerfilDeAgenda,
} from "../src/agenda/mover-staff.js";

const SOLE = "55555555-5555-4555-8555-555555555555";
const ANA = "66666666-6666-4666-8666-666666666666";
const ISA = "77777777-7777-4777-8777-777777777777";
const FUERA = "88888888-8888-4888-8888-888888888888";

const CORTE = "33333333-3333-4333-8333-333333333333";
const TINTE = "44444444-4444-4444-8444-444444444444";

const PERFILES: PerfilDeAgenda[] = [
  { userId: SOLE, displayName: "Sole", active: true },
  { userId: ANA, displayName: "Ana", active: true },
  { userId: ISA, displayName: "Isa", active: false },
];

const NOMBRES = new Map([
  [CORTE, "Corte de pelo"],
  [TINTE, "Tinte"],
]);

/** Sole hace todo; Ana sólo corta. */
function matriz(): Map<string, Set<string>> {
  return new Map([
    [CORTE, new Set([SOLE, ANA])],
    [TINTE, new Set([SOLE])],
  ]);
}

function comprobar(staffUserId: string, serviceIds: string[]) {
  return comprobarProfesional({
    staffUserId,
    perfiles: PERFILES,
    serviceIds,
    sabenHacer: matriz(),
    nombres: NOMBRES,
  });
}

describe("comprobarProfesional · quién puede coger la cita", () => {
  it("la que sabe hacer el servicio pasa", () => {
    expect(comprobar(ANA, [CORTE])).toBeNull();
  });

  it("la que sabe hacerlos TODOS pasa", () => {
    expect(comprobar(SOLE, [CORTE, TINTE])).toBeNull();
  });

  it("la que no sabe hacer el servicio es 409 con el nombre de las dos cosas", () => {
    const r = comprobar(ANA, [TINTE]);
    expect(r).toEqual({
      status: 409,
      error: "STAFF_NO_SKILL",
      // La frase que la cajera lee en voz alta: la persona y el servicio,
      // no "no se pudo mover a ese hueco".
      message: "Ana no hace Tinte.",
    });
  });

  it("sabe hacer UNO de los dos: sigue siendo 409, y dice cuál falta", () => {
    // Media cita no es media respuesta: el motor encadena los items sobre
    // la fijada, así que si no puede con el tinte no puede con la cita.
    const r = comprobar(ANA, [CORTE, TINTE]);
    expect(r?.status).toBe(409);
    expect(r?.message).toBe("Ana no hace Tinte.");
  });

  it("si le faltan dos, los enumera en castellano", () => {
    const r = comprobarProfesional({
      staffUserId: ANA,
      perfiles: PERFILES,
      serviceIds: [CORTE, TINTE],
      sabenHacer: new Map([
        [CORTE, new Set([SOLE])],
        [TINTE, new Set([SOLE])],
      ]),
      nombres: NOMBRES,
    });
    expect(r?.message).toBe("Ana no hace Corte de pelo y Tinte.");
  });

  it("un servicio sin nombre en catálogo no escupe un uuid a la cara", () => {
    const r = comprobarProfesional({
      staffUserId: ANA,
      perfiles: PERFILES,
      serviceIds: [TINTE],
      sabenHacer: new Map([[TINTE, new Set([SOLE])]]),
      nombres: new Map(),
    });
    expect(r?.message).toBe("Ana no hace ese servicio.");
  });

  it("quien no es del centro es 404, y el mensaje no la nombra", () => {
    // No se la nombra porque no se sabe quién es: los perfiles son los de
    // ESTE tenant. Una peluquera de otro centro cae aquí.
    expect(comprobar(FUERA, [CORTE])).toEqual({
      status: 404,
      error: "STAFF_NOT_FOUND",
      message: "Esa profesional no es de este centro.",
    });
  });

  it("la inactiva es 404, y de ella SÍ se sabe el nombre", () => {
    expect(comprobar(ISA, [CORTE])).toEqual({
      status: 404,
      error: "STAFF_NOT_FOUND",
      message: "Isa ya no está activa en la agenda.",
    });
  });

  it("primero QUIÉN es, después qué sabe hacer", () => {
    // La inactiva tampoco sale en la matriz (`getSkilledStaff` filtra por
    // perfil activo), así que las dos ramas podrían morder. Manda la de
    // quién es: hablar de skills de alguien que ya no está sería contestar
    // a otra pregunta.
    const r = comprobar(ISA, [TINTE]);
    expect(r?.error).toBe("STAFF_NOT_FOUND");
  });

  it("una cita sin servicios no inventa un «no»", () => {
    // No pasa hoy (toda cita tiene items), pero un filter sobre una lista
    // vacía devuelve vacío y eso tiene que leerse como «adelante», no como
    // «le falta todo».
    expect(comprobar(ANA, [])).toBeNull();
  });
});
