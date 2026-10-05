// clinica-1 · la tabla de casos de LA función de acceso.
//
// Es la prueba más importante del bloque, y por eso está sola en su
// fichero y sin Prisma: `puedeVerHistoria` es pura, así que esto es una
// tabla de verdad y no una maqueta. Si mañana alguien mueve la regla, lo
// que se pone rojo es una fila con nombre.
//
// Los nueve casos que el prompt del bloque pide, uno a uno.

import { describe, expect, it } from "vitest";

import {
  puedeVerHistoria,
  resolverAccesoClinico,
  type EstadoClinico,
  type PrismaParaAcceso,
} from "../src/clinica/acceso.js";

// Un estado base "del que sí puede", para que cada caso diga sólo lo que
// cambia. Leer una fila de la tabla es leer su diferencia.
function estado(parche: Partial<EstadoClinico> = {}): EstadoClinico {
  return {
    clinicaEncendida: true,
    esSanitario: true,
    alcance: "SELECTION",
    accesoVigente: true,
    ...parche,
  };
}

describe("clinica-1 · ¿puede ver la historia de este paciente?", () => {
  it("el tenant tiene la clínica APAGADA → no, y el motivo es el módulo", () => {
    // Va primero a propósito: es la única condición que no habla de esta
    // persona. Un tenant apagado no tiene sanitarios, así que contestar
    // "no eres sanitario" sería contestar otra pregunta.
    const v = puedeVerHistoria(
      estado({ clinicaEncendida: false, esSanitario: true, alcance: "ALL" }),
    );
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("CLINICA_APAGADA");
  });

  it("NO es sanitario → no, aunque el tenant tenga la clínica encendida", () => {
    const v = puedeVerHistoria(estado({ esSanitario: false }));
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("NO_SANITARIO");
  });

  it("sanitario con alcance ALL → sí, sin mirar la selección", () => {
    const v = puedeVerHistoria(
      estado({ alcance: "ALL", accesoVigente: false }),
    );
    expect(v.puede).toBe(true);
  });

  it("sanitario con SELECTION y acceso vigente → sí", () => {
    expect(puedeVerHistoria(estado()).puede).toBe(true);
  });

  it("sanitario con SELECTION y SIN acceso a ese paciente → no", () => {
    const v = puedeVerHistoria(estado({ accesoVigente: false }));
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("SIN_ACCESO_AL_PACIENTE");
  });

  it("revocado → no (una revocación deja `accesoVigente` en false)", () => {
    // Lo que convierte "revocado" en `accesoVigente: false` es el
    // `revokedAt: null` del WHERE de `resolverAccesoClinico`, y eso lo
    // prueba el bloque de abajo. Aquí se prueba la mitad que decide.
    const v = puedeVerHistoria(estado({ accesoVigente: false }));
    expect(v.puede).toBe(false);
  });

  it("revocado y vuelto a asignar por una cita → sí", () => {
    // La cita nueva inserta OTRA fila vigente (el índice único es
    // parcial), así que el estado vuelve a `accesoVigente: true` y la
    // respuesta vuelve a ser sí. La revocación se queda en el histórico.
    expect(puedeVerHistoria(estado({ accesoVigente: true })).puede).toBe(true);
  });

  it("la DUEÑA NO sanitaria → no. Administra el negocio, no ve historias", () => {
    // El caso que justifica que rol y marca vivan en columnas distintas.
    // Esta función NO mira el rol: si lo mirara, habría que recordar que
    // OWNER no implica acceso, y ese "recordar" es el fallo.
    const v = puedeVerHistoria(estado({ esSanitario: false }));
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("NO_SANITARIO");
  });

  it("un CLINICIAN es sanitario por construcción → decide su alcance", () => {
    // `role = CLINICIAN` implica `isClinician` por CHECK de la base, así
    // que un CLINICIAN nunca llega aquí con `esSanitario: false`. Lo único
    // que queda por decidir es el alcance.
    expect(puedeVerHistoria(estado({ alcance: "ALL" })).puede).toBe(true);
    expect(
      puedeVerHistoria(estado({ alcance: "SELECTION", accesoVigente: false }))
        .puede,
    ).toBe(false);
  });

  it("cada negativa trae un mensaje que dice qué hacer", () => {
    for (const parche of [
      { clinicaEncendida: false },
      { esSanitario: false },
      { accesoVigente: false },
    ]) {
      const v = puedeVerHistoria(estado(parche));
      expect(v.puede).toBe(false);
      expect(v.puede === false && v.mensaje.length).toBeGreaterThan(20);
    }
  });
});

// ── La otra mitad: que lo que se lee de la base es lo que se decide ──
//
// `resolverAccesoClinico` no tiene reglas; tiene un WHERE. Lo que se
// prueba aquí es ese WHERE —`revokedAt: null` es lo que hace que una
// revocación quite el acceso— y la economía de consultas, que no es
// cosmética: es lo que hace que un tenant NO clínico no pague nada por
// este bloque en cada `GET /clients/:id`.
describe("clinica-1 · resolverAccesoClinico lee lo justo", () => {
  function prismaDoble(opts: {
    clinicaEncendida: boolean;
    user: { isClinician: boolean; clinicalScope: "ALL" | "SELECTION" } | null;
    accesoVigente: boolean;
  }) {
    const llamadas = { tenant: 0, user: 0, acceso: 0 };
    let whereDelAcceso: Record<string, unknown> | null = null;
    const prisma: PrismaParaAcceso = {
      tenant: {
        findUnique: async () => {
          llamadas.tenant += 1;
          return { clinicalRecordsEnabled: opts.clinicaEncendida };
        },
      },
      user: {
        findFirst: async () => {
          llamadas.user += 1;
          return opts.user;
        },
      },
      clinicalAccess: {
        findFirst: async (args: unknown) => {
          llamadas.acceso += 1;
          whereDelAcceso = (args as { where: Record<string, unknown> }).where;
          return opts.accesoVigente ? { id: "acceso" } : null;
        },
      },
    };
    return { prisma, llamadas, verWhere: () => whereDelAcceso };
  }

  const input = {
    tenantId: "t-1",
    userId: "u-1",
    clientId: "c-1",
  };

  it("sólo cuenta un acceso SIN revocar — ése es el WHERE que lo decide", async () => {
    const d = prismaDoble({
      clinicaEncendida: true,
      user: { isClinician: true, clinicalScope: "SELECTION" },
      accesoVigente: true,
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(res.veredicto.puede).toBe(true);
    // Si este `revokedAt: null` desapareciera, una revocación dejaría de
    // quitar el acceso y nada más se pondría rojo. Por eso se mira aquí.
    expect(d.verWhere()).toMatchObject({
      tenantId: "t-1",
      clinicianUserId: "u-1",
      clientId: "c-1",
      revokedAt: null,
    });
  });

  it("un tenant NO clínico no consulta la tabla de accesos", async () => {
    const d = prismaDoble({
      clinicaEncendida: false,
      user: { isClinician: true, clinicalScope: "SELECTION" },
      accesoVigente: true,
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(res.veredicto.puede).toBe(false);
    expect(d.llamadas.acceso).toBe(0);
  });

  it("quien no es sanitario tampoco la consulta", async () => {
    const d = prismaDoble({
      clinicaEncendida: true,
      user: { isClinician: false, clinicalScope: "SELECTION" },
      accesoVigente: true,
    });
    await resolverAccesoClinico(d.prisma, input);
    expect(d.llamadas.acceso).toBe(0);
  });

  it("con alcance ALL tampoco: no hace falta para decidir", async () => {
    const d = prismaDoble({
      clinicaEncendida: true,
      user: { isClinician: true, clinicalScope: "ALL" },
      accesoVigente: false,
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(res.veredicto.puede).toBe(true);
    expect(d.llamadas.acceso).toBe(0);
  });

  it("un usuario que no existe en el tenant no es sanitario y cae a SELECTION", async () => {
    // El aislamiento lo hace el `tenantId` del WHERE del `findFirst`: un
    // user de otro tenant no se encuentra, y el estado por defecto es el
    // restrictivo.
    const d = prismaDoble({
      clinicaEncendida: true,
      user: null,
      accesoVigente: true,
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(res.veredicto.puede).toBe(false);
    expect(res.estado.esSanitario).toBe(false);
    expect(res.estado.alcance).toBe("SELECTION");
  });
});
