// clinica-8 · LA MARCA SANITARIA, AL DÍA, SIN VOLVER A ENTRAR.
//
// El TPV lee `isClinician` en el login del cajero y esa sesión dura el turno
// entero (12 h por defecto). Así que marcar a alguien sanitario desde el
// panel no le llegaba al TPV hasta cerrar sesión y volver a entrar: la
// auditoría del 18-10 marcó a la propietaria, volvió a la cita y la cita
// seguía sin enseñar nada clínico. Desde fuera eso se ve como «esto no
// funciona», porque no hay forma de saber que hace falta re-entrar.
//
// Lo que este banco fija son las tres decisiones de forma, que son las que
// hacen que esto sea seguro:
//
//   1. `null` en un comercio SIN clínica — y sin pagar la consulta del
//      usuario. Los catorce de hoy no notan nada.
//   2. **falla hacia «no sé»**, nunca hacia «no es sanitaria»: una marca
//      que no se pudo leer no puede quitarle los botones a quien los tiene.
//   3. y lee la FILA, no el token: es justo lo que la hace estar al día.

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  clinica: true as boolean,
  usuario: null as { isClinician: boolean } | null,
  /** Revienta la lectura DEL USUARIO, que es la que llega al `catch`. */
  revienta: false,
  lecturasDeUsuario: 0,
}));

vi.mock("../src/context.js", () => ({
  getPrisma: () => ({
    tenant: {
      findUnique: async () => ({
        clinicalRecordsEnabled: prismaMock.clinica,
      }),
    },
    user: {
      findFirst: async () => {
        prismaMock.lecturasDeUsuario += 1;
        // Revienta AQUÍ y no en la lectura del tenant, y eso lo enseñó un
        // sabotaje que salió verde: `clinicaIsEnabled` tiene su propio
        // `try/catch` y devuelve `false`, así que un fallo del tenant
        // nunca llega al `catch` de esta función — se contestaba `null`
        // por la capability, no por el `catch`, y el sabotaje
        // «falla hacia no-es-sanitaria» pasaba en verde.
        if (prismaMock.revienta) throw new Error("db down");
        return prismaMock.usuario;
      },
    },
  }),
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { marcaSanitariaDe } = await import("../src/clinica/marca-sanitaria.js");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USUARIO = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  prismaMock.clinica = true;
  prismaMock.usuario = { isClinician: false };
  prismaMock.revienta = false;
  prismaMock.lecturasDeUsuario = 0;
});

describe("clinica-8 · la marca sanitaria de quien mira", () => {
  it("dice lo que dice la fila HOY", async () => {
    prismaMock.usuario = { isClinician: true };
    expect(await marcaSanitariaDe(TENANT, USUARIO)).toBe(true);
    prismaMock.usuario = { isClinician: false };
    expect(await marcaSanitariaDe(TENANT, USUARIO)).toBe(false);
  });

  it("en un comercio SIN clínica es `null`, y no cuesta la consulta", async () => {
    // Los catorce de hoy. El sabotaje que esto caza es preguntar por el
    // usuario antes que por la capability: serían 15 consultas más por
    // cada pintado de la agenda, y la agenda se pinta cincuenta veces al
    // día.
    prismaMock.clinica = false;
    expect(await marcaSanitariaDe(TENANT, USUARIO)).toBeNull();
    expect(prismaMock.lecturasDeUsuario).toBe(0);
  });

  it("sin usuario, `null` y ni una consulta", async () => {
    expect(await marcaSanitariaDe(TENANT, null)).toBeNull();
    expect(prismaMock.lecturasDeUsuario).toBe(0);
  });

  it("si la lectura REVIENTA, «no sé» — nunca «no es sanitaria»", async () => {
    // Es la decisión que importa: con `false`, un fallo de base le
    // quitaría a la podóloga los botones de la historia en mitad de una
    // consulta. Con `null`, la pantalla se queda como estaba.
    prismaMock.revienta = true;
    expect(await marcaSanitariaDe(TENANT, USUARIO)).toBeNull();
  });

  it("y un usuario que no es de este comercio es `null`, no `false`", async () => {
    prismaMock.usuario = null;
    expect(await marcaSanitariaDe(TENANT, USUARIO)).toBeNull();
  });
});
