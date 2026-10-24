// clinica-9 (5) · UN SOLO NOMBRE, Y LAS SEIS SUPERFICIES.
//
// La pasada en hierro del 24-10 leyó `m.oyola+clinica-demo` en seis
// sitios de la «Clínica demo»: los cajeros recientes del PIN, «Atiende»
// de la cita, «Firmada por» de la sesión, el «corregido por» de la
// valoración, la hoja de «Revisa lo que se va a firmar» y la aceptación
// del contrato.
//
// clinica-8 (fase B, 11) ya había hecho la mitad: las seis leen
// `users.alias` y caen a la local-part del email, no al email entero. Lo
// que faltaba era que el alias ESTUVIERA PUESTO — y el único sitio desde
// el que se escribía era Cajeros, donde la propietaria no sale.
//
// Este fichero fija las dos mitades:
//
//   1. **El puente** · `escribirElNombre` escribe las DOS columnas
//      (`users.alias` y `staff_profiles.display_name`). Las rutas que lo
//      llaman tienen sus tests en `staff-route.test.ts` y en
//      `clinica-8-cajeros.test.ts`.
//   2. **El inventario de las seis** · cada superficie, con el fichero y
//      la línea que PRODUCE el nombre, y la prueba de que ninguna arma el
//      nombre con el email crudo. Es un inventario que crece con el
//      bloque: cuando aparezca una séptima superficie se añade aquí, no
//      se baja el número.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { nombreParaMostrar } from "../src/lib/nombre-para-mostrar.js";
import {
  escribirElNombre,
  nombreLimpio,
} from "../src/lib/un-solo-nombre.js";

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function fuente(relativa: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../src/${relativa}`, import.meta.url)),
    "utf8",
  );
}

describe("clinica-9 · el nombre limpio", () => {
  it("un nombre que son espacios es NO tener nombre", () => {
    expect(nombreLimpio("   ")).toBeNull();
    expect(nombreLimpio("")).toBeNull();
    expect(nombreLimpio(null)).toBeNull();
    expect(nombreLimpio(undefined)).toBeNull();
  });

  it("y uno de verdad llega recortado", () => {
    expect(nombreLimpio("  Rosario  ")).toBe("Rosario");
  });

  it("porque un alias en blanco sería PEOR que no tener alias", () => {
    // `nombreParaMostrar` trata el blanco como ausente, pero sólo porque
    // lo recorta antes. La defensa va en el que ESCRIBE: lo que no entra
    // en la base no hay que recortarlo al leerlo en diez sitios.
    expect(nombreParaMostrar({ alias: "   ", email: "r@clinica.es" })).toBe(
      "r",
    );
  });
});

describe("clinica-9 · guardar el nombre escribe las DOS columnas", () => {
  function fake() {
    const user = { update: vi.fn(async () => ({ id: USER, email: "r@c.es", alias: "Rosario", role: "OWNER" })) };
    const staffProfile = {
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    // Las dos escrituras van en UNA transacción (ver `escribirElNombre`):
    // el fake la cumple de la forma de array, que es la que usa el código.
    const $transaction = vi.fn(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    return { user, staffProfile, $transaction } as never as Parameters<
      typeof escribirElNombre
    >[0] & {
      user: typeof user;
      staffProfile: typeof staffProfile;
      $transaction: typeof $transaction;
    };
  }

  it("desde Personal: alias + «Nombre en la agenda», y crea el perfil", async () => {
    const p = fake();
    await escribirElNombre(p, {
      tenantId: TENANT,
      userId: USER,
      nombre: "Rosario",
      crearPerfil: true,
      perfil: { color: null, active: true },
    });
    expect(p.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { alias: "Rosario" } }),
    );
    expect(p.staffProfile.upsert).toHaveBeenCalledTimes(1);
    const args = (p.staffProfile.upsert.mock.calls as unknown as Array<
      [{ create: { displayName: string }; update: { displayName: string } }]
    >)[0]![0];
    expect(args.create.displayName).toBe("Rosario");
    expect(args.update.displayName).toBe("Rosario");
  });

  it("desde Cajeros: alias siempre, y el perfil SÓLO si ya existe", async () => {
    const p = fake();
    await escribirElNombre(p, {
      tenantId: TENANT,
      userId: USER,
      nombre: "Marta R.",
      crearPerfil: false,
    });
    expect(p.user.update).toHaveBeenCalledTimes(1);
    // Y las dos, juntas: una sola transacción.
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    // `updateMany` no crea nada: un cajero de barra no se convierte en
    // profesional de la agenda por renombrarse.
    expect(p.staffProfile.upsert).not.toHaveBeenCalled();
    expect(p.staffProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { displayName: "Marta R." } }),
    );
  });
});

// ── EL INVENTARIO DE LAS SEIS ────────────────────────────────────────
//
// Cada entrada: la superficie tal como se ve, el fichero que la produce y
// la expresión exacta que escribe el nombre. Si alguien cambia una de las
// seis por `u.email`, aquí se ve.
const SUPERFICIES: Array<{
  superficie: string;
  fichero: string;
  produce: string;
}> = [
  {
    superficie: "Cajeros recientes del PIN",
    // La API manda el `alias` en el roster; la pantalla lo pinta arriba y
    // el email debajo (`cashierDisplayLabel`, clinica-8 fase B).
    fichero: "shift/cashier-auth.ts",
    produce: "alias: u.alias",
  },
  {
    superficie: "«Atiende» de la cita y de la sesión",
    fichero: "clinica/sesion.ts",
    produce: "nombre: nombreDe(staff)",
  },
  {
    superficie: "«Firmada por» de la sesión cerrada",
    fichero: "clinica/sesion.ts",
    produce: 'autorNombre: u ? nombreDe(u) : "—"',
  },
  {
    superficie: "«Corregido por» de la valoración",
    fichero: "clinica/valoracion.ts",
    produce: "autorNombre: nombreDe(c.author)",
  },
  {
    // La hoja la pinta el TPV con `vista.cabecera.atiende.nombre`, que
    // sale de la MISMA línea que «Atiende»: una sola fuente, no dos.
    superficie: "Hoja «Revisa lo que se va a firmar»",
    fichero: "clinica/sesion.ts",
    produce: "atiende: cita.atiende",
  },
  {
    superficie: "Aceptación del contrato de tratamiento",
    fichero: "clinica/contrato.ts",
    produce: "quien: nombreDe(f.user)",
  },
];

describe("clinica-9 · las seis superficies leen el NOMBRE, no el email", () => {
  it("son seis, y ni una menos", () => {
    expect(SUPERFICIES).toHaveLength(6);
  });

  for (const s of SUPERFICIES) {
    it(`${s.superficie} · ${s.fichero}`, () => {
      expect(fuente(s.fichero)).toContain(s.produce);
    });
  }

  it("y las cuatro de `clinica/` pasan por `nombreParaMostrar`", () => {
    // `nombreDe` es un alias local de `nombreParaMostrar` en los cuatro
    // ficheros (clinica-8 fase B lo unificó). Lo que esto impide es que
    // uno de ellos se escriba su propia versión de tres líneas otra vez
    // — que es exactamente cómo nacieron las seis copias que caían al
    // email entero.
    for (const f of [
      "clinica/sesion.ts",
      "clinica/valoracion.ts",
      "clinica/contrato.ts",
      "clinica/informe.ts",
    ]) {
      expect(fuente(f), f).toContain("nombre-para-mostrar.js");
    }
  });

  it("el nombre que se enseña es el alias en cuanto está puesto", () => {
    // La mitad que faltaba: con el alias puesto, las seis dejan de
    // pintar el email. Lo que lo pone es `escribirElNombre` desde
    // Personal o desde Cajeros.
    const sinNombre = { alias: null, email: "m.oyola+clinica-demo@mipiace.es" };
    const conNombre = { alias: "Rosario", email: sinNombre.email };
    expect(nombreParaMostrar(sinNombre)).toBe("m.oyola+clinica-demo");
    expect(nombreParaMostrar(conNombre)).toBe("Rosario");
    // Y nunca el dominio, que es la parte que no dice nada de la persona.
    expect(nombreParaMostrar(sinNombre)).not.toContain("@");
  });
});
