// clinica-9 (4) · LA SESIÓN SE FIRMA EL DÍA DE LA CITA.
//
// Pasada en hierro del 24-10 (capturas 22 y 33): desde la agenda se abrió
// la cita del **lunes 26** y la pantalla dijo «Cita de hoy · 10:00». Al
// cerrarla, la sesión quedó firmada el **sábado 24**. Una historia clínica
// en la que la fecha de la visita no es el día en que se hizo no es un
// detalle de pantalla: es el dato del que cuelga todo lo demás.
//
// Lo que se fija aquí:
//
//   · el día es el de PARED DEL CENTRO, no el UTC;
//   · `cerrarSesion` dice que no ANTES DE LEER NADA (el prisma de estos
//     tests revienta a la primera consulta: si el corte no fuera lo
//     primero, el test no fallaría con un `expect`, fallaría con la
//     excepción — y las dos cosas son fallar);
//   · la visita que acaba pasada la medianoche SÍ se puede firmar, hasta
//     las 6 (ver `HORA_LIMITE_DEL_DIA_SIGUIENTE`): si no, la sanitaria
//     pierde la sesión que tiene a medio escribir en la pantalla.
//
// Sabotaje: quita el `if (!sePuedeCerrarLaSesion(cita))` de `cerrarSesion`
// y caen los tres tests del cierre.

import { describe, expect, it } from "vitest";

import {
  cerrarSesion,
  diaDeLaCita,
  esElDiaDeLaCita,
  sePuedeCerrarLaSesion,
  type CitaDeLaSesion,
} from "../src/clinica/sesion.js";

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function cita(empieza: string): CitaDeLaSesion {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    clientId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    empieza,
    status: "CONFIRMED",
    servicios: ["Consulta diagnóstico"],
    servicioIds: ["eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"],
    atiende: { userId: "u1", nombre: "Rosario" },
    ticketId: null,
  };
}

/** Un prisma que no se puede usar: cualquier lectura revienta. Es la mitad
 *  del test — el corte tiene que ir ANTES de las puertas, que leen. */
const PRISMA_PROHIBIDO = new Proxy(
  {},
  {
    get() {
      throw new Error("no se puede leer nada: la cita no es de hoy");
    },
  },
) as never;

async function cerrar(c: CitaDeLaSesion) {
  return cerrarSesion(PRISMA_PROHIBIDO, {
    tenantId: TENANT,
    cita: c,
    autorUserId: "u1",
    verImportes: true,
    tipos: ["GENERAL"],
    bloques: {} as never,
    marcas: {},
    dolor: 3,
    evolucion: null,
    consejos: [],
    proximaCita: null,
    nota: null,
    pendientesCerrados: [],
    pendientesNuevos: [],
  });
}

describe("clinica-9 · el día de una cita es el de pared del centro", () => {
  it("una cita de las 00:30 de Madrid es del 26, aunque en UTC sea del 25", () => {
    // 2026-10-25T23:30Z = 2026-10-26 00:30 en Madrid (CET, +1 en invierno).
    expect(diaDeLaCita(cita("2026-10-25T23:30:00.000Z"))).toBe("2026-10-26");
  });

  it("«es hoy» se contesta contra ese mismo día de pared", () => {
    const c = cita("2026-10-26T09:00:00.000Z");
    expect(esElDiaDeLaCita(c, new Date("2026-10-26T07:00:00.000Z"))).toBe(true);
    expect(esElDiaDeLaCita(c, new Date("2026-10-24T07:00:00.000Z"))).toBe(
      false,
    );
  });
});

describe("clinica-9 · cuándo se puede firmar", () => {
  const lunes = cita("2026-10-26T09:00:00.000Z");

  it("el día de la cita, sí", () => {
    expect(
      sePuedeCerrarLaSesion(lunes, new Date("2026-10-26T12:00:00.000Z")),
    ).toBe(true);
  });

  it("dos días ANTES, no (el caso de la pasada del 24-10)", () => {
    expect(
      sePuedeCerrarLaSesion(lunes, new Date("2026-10-24T12:00:00.000Z")),
    ).toBe(false);
  });

  it("al día siguiente ya de mañana, tampoco", () => {
    expect(
      sePuedeCerrarLaSesion(lunes, new Date("2026-10-27T09:00:00.000Z")),
    ).toBe(false);
  });

  it("pero la visita que acaba pasada la medianoche SÍ se firma", () => {
    // 2026-10-27T00:10 de Madrid: la cita sigue siendo la del lunes.
    expect(
      sePuedeCerrarLaSesion(lunes, new Date("2026-10-26T23:10:00.000Z")),
    ).toBe(true);
  });
});

describe("clinica-9 · `cerrarSesion` corta antes de leer nada", () => {
  it("la cita del lunes, firmada el sábado: FUERA_DEL_DIA", async () => {
    // El reloj de estos tests es el de verdad, así que la cita se
    // construye lejos de hoy a propósito: una de 2026-01-01 no es hoy
    // ningún día en el que se corra la suite.
    const r = await cerrar(cita("2026-01-01T09:00:00.000Z"));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("no debería cerrar");
    expect(r.motivo).toBe("FUERA_DEL_DIA");
  });

  it("y el mensaje dice QUÉ DÍA es la cita y qué hacer", async () => {
    const r = await cerrar(cita("2026-01-01T09:00:00.000Z"));
    if (r.ok) throw new Error("no debería cerrar");
    expect(r.mensaje).toContain("1 de enero");
    expect(r.mensaje).toContain("La sesión se abre el día de la cita.");
  });

  it("no se lee ni la valoración ni los consentimientos: el corte es el primero", async () => {
    // `PRISMA_PROHIBIDO` revienta a la primera consulta. Que esto no
    // lance es la prueba de que no se consultó nada.
    await expect(cerrar(cita("2026-01-01T09:00:00.000Z"))).resolves.toEqual(
      expect.objectContaining({ ok: false, motivo: "FUERA_DEL_DIA" }),
    );
  });
});
