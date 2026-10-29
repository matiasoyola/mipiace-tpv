// pin-1 (punto 4) · LOS CORREOS NO PROMETEN NADA QUE NO EXISTA.
//
// Los dos correos de primer acceso llevaban, desde v1.3, esta línea:
//
//     «Puedes cambiar tu PIN en cualquier momento desde el panel.»
//
// Era mentira. No había pantalla. El bloque la construye, así que la
// frase pasa a ser verdad — y lo que este fichero guarda es que lo que
// el correo diga siga siendo lo que el programa hace.
//
// Lo que fija:
//
//   1. **Ningún PIN dentro.** Ni generado, ni de ejemplo. El parámetro
//      `ownerPin` ya no existe en ninguna de las dos plantillas, que es
//      lo que hace que no pueda volver sin que alguien lo escriba.
//   2. Con caja, el correo de invitación dice **dónde** elegirlo, y lo
//      que dice coincide con el rótulo real de la pantalla («Mi cuenta»,
//      «Elegir PIN»).
//   3. Sin caja, no habla de PIN ni de TPV. Es lo de
//      contrato-lectura-completa: a la directora de una residencia no se
//      le habla de una caja que no tiene.
//
// Sabotajes que pone en rojo: volver a meter un PIN en cualquiera de las
// dos plantillas, o dejar la promesa sin decir dónde se cumple.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://panel.mipiacetpv.tech";

import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Enviado {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
const enviados: Enviado[] = [];

vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (m: Enviado) => {
      enviados.push(m);
    },
  }),
}));

const { sendOwnerInviteEmail, marcaDelCorreo } = await import(
  "../src/superadmin/invite-email.js"
);
const { sendOwnerWelcomeEmail } = await import(
  "../src/superadmin/welcome-email.js"
);

beforeEach(() => {
  enviados.length = 0;
});

const MARCA_COMERCIO = marcaDelCorreo({ nombreDeLaCuenta: "Sirope" });

async function invitar(over: Record<string, unknown> = {}) {
  await sendOwnerInviteEmail({
    ownerEmail: "carmen@sirope.es",
    ownerName: "Carmen",
    enlace: "https://panel.mipiacetpv.tech/bienvenida?token=abc",
    caducaEl: new Date("2026-11-03T10:00:00Z"),
    marca: MARCA_COMERCIO,
    ...over,
  });
  return enviados.at(-1)!;
}

// ── 1 · NINGÚN PIN DENTRO ───────────────────────────────────────────

describe("ningún correo lleva un PIN", () => {
  it("la invitación con caja: habla de PIN pero no lleva ninguno", async () => {
    const correo = await invitar({ eligePinEnElPanel: true });
    // Habla del PIN…
    expect(correo.text).toMatch(/PIN/);
    // …y no lleva cifras pegadas a la palabra, que es la forma que tenía
    // («· PIN: 4817»).
    expect(correo.text).not.toMatch(/PIN:?\s*\d/);
    expect(correo.html ?? "").not.toMatch(/PIN:?\s*<?\/?code>?\s*\d/);
  });

  it("la invitación sin caja: ni PIN ni TPV", async () => {
    const correo = await invitar();
    expect(correo.text).not.toMatch(/PIN/);
    expect(correo.text).not.toMatch(/TPV/);
    expect(correo.html ?? "").not.toMatch(/PIN/);
  });

  it("el de bienvenida (transfer-owner) no habla de PIN en absoluto", async () => {
    await sendOwnerWelcomeEmail({
      ownerEmail: "nuevo@sirope.es",
      ownerName: "Luis",
      tempPassword: "temporal-larga-2026",
      expectsHolded: false,
    });
    const correo = enviados.at(-1)!;
    expect(correo.text).not.toMatch(/PIN/);
    expect(correo.html ?? "").not.toMatch(/PIN/);
  });

  it("y el parámetro `ownerPin` ya no existe en ninguna plantilla", async () => {
    // La garantía estructural, y es la que importa más que las de
    // arriba: mientras no haya por dónde meter un PIN, no puede volver
    // por descuido. Se lee el fuente a propósito — un test de
    // comportamiento no puede ver un parámetro que nadie pasa.
    for (const fichero of ["invite-email.ts", "welcome-email.ts"]) {
      const src = readFileSync(
        new URL(`../src/superadmin/${fichero}`, import.meta.url),
        "utf8",
      );
      const sinComentarios = src
        .split("\n")
        .filter((l) => {
          const t = l.trimStart();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .join("\n");
      expect(sinComentarios, fichero).not.toContain("ownerPin");
    }
  });
});

// ── 2 · LO QUE DICE ES VERDAD ───────────────────────────────────────

describe("con caja, el correo dice dónde se elige — y existe", () => {
  it("nombra «Mi cuenta» y «Elegir PIN», que son los rótulos reales", async () => {
    const correo = await invitar({ eligePinEnElPanel: true });
    expect(correo.text).toMatch(/Mi cuenta/);
    expect(correo.text).toMatch(/Elegir PIN/);
    expect(correo.html ?? "").toMatch(/Mi cuenta/);
  });

  it("dice el formato que la API acepta de verdad: 4 a 8 cifras", async () => {
    const { PIN_FORMAT } = await import("../src/auth/pin.js");
    expect(PIN_FORMAT).toContain("4,8");
    const correo = await invitar({ eligePinEnElPanel: true });
    expect(correo.text).toMatch(/cuatro a ocho/);
  });

  it("y que se puede cambiar cuando quiera, que ahora es verdad", async () => {
    const correo = await invitar({ eligePinEnElPanel: true });
    expect(correo.text).toMatch(/cuando quieras/);
  });

  it("el resto del correo no cambia: enlace, caducidad y usuario", async () => {
    const correo = await invitar({ eligePinEnElPanel: true });
    expect(correo.text).toContain(
      "https://panel.mipiacetpv.tech/bienvenida?token=abc",
    );
    expect(correo.text).toContain("03/11");
    expect(correo.text).toContain("carmen@sirope.es");
    // Y sigue sin ninguna contraseña dentro (primer-acceso).
    expect(correo.text).not.toMatch(/[Cc]ontraseña temporal/);
  });
});
