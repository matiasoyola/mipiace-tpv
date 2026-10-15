// residencia-1 · LA TABLA DE CASOS de la función de acceso, ampliada.
//
// Es la prueba más importante del bloque y está sola en su fichero por lo
// mismo que `clinica-acceso.test.ts`: `puedeVerHistoria` es pura, así que
// esto es una tabla de verdad y no una maqueta. Si mañana alguien mueve la
// regla, lo que se pone rojo es una fila con nombre.
//
// Los nueve casos que el prompt pide, uno por `it`:
//
//   1. tenant apagado          2. sin rol de cuidado
//   3. rol revocado            4. rol de alcance total
//   5. auxiliar con zona · residente DENTRO
//   6. auxiliar con zona · residente FUERA
//   7. residente sin cama      8. cambio de habitación
//   9. residente dado de alta
//
// Más el que sostiene todo el bloque: **en un tenant que no es residencia,
// esta función contesta EXACTAMENTE lo que contestaba antes.**

import { describe, expect, it, vi } from "vitest";

import {
  puedeVerHistoria,
  resolverAccesoClinico,
  type EstadoClinico,
  type EstadoResidencia,
  type PrismaParaAcceso,
} from "../src/clinica/acceso.js";

// El estado de una AUXILIAR que sí puede: rol de cuidado vigente, sin
// alcance total, y el residente en su zona. Cada caso dice sólo lo que
// cambia.
function residencia(parche: Partial<EstadoResidencia> = {}): EstadoResidencia {
  return {
    rolDeCuidadoVigente: true,
    alcanceTotal: false,
    residenteEnMiZona: true,
    ...parche,
  };
}

function estado(parche: Partial<EstadoClinico> = {}): EstadoClinico {
  return {
    clinicaEncendida: true,
    esSanitario: true,
    // En una residencia esto no se mira, y se deja en el valor por defecto
    // de la columna a propósito: si la rama de residencia mirara el alcance
    // clínico, con `SELECTION` y sin `ClinicalAccess` la plantilla entera
    // se quedaría fuera y este fichero lo vería.
    alcance: "SELECTION",
    accesoVigente: false,
    residencia: residencia(),
    ...parche,
  };
}

describe("residencia-1 · ¿puede este usuario ver a este residente?", () => {
  it("1 · el tenant tiene la RESIDENCIA APAGADA → se comporta como la clínica de siempre", () => {
    // `residencia: null` es lo que llega en los quince tenants de hoy. La
    // rama no se mira y decide el alcance clínico: con `SELECTION` y sin
    // acceso vigente, no.
    const v = puedeVerHistoria(estado({ residencia: null }));
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("SIN_ACCESO_AL_PACIENTE");
  });

  it("1b · y con la CLÍNICA apagada, el motivo sigue siendo el módulo", () => {
    // El orden importa: la condición del módulo va primero porque es la
    // única que no habla de esta persona. Un centro de residencia no puede
    // tener la clínica apagada (CHECK `tenants_residencia_exige_clinica`),
    // así que esto sólo pasaría con la base manipulada — y aun así
    // contesta lo prudente.
    const v = puedeVerHistoria(estado({ clinicaEncendida: false }));
    expect(v.puede === false && v.motivo).toBe("CLINICA_APAGADA");
  });

  it("2 · SIN ROL DE CUIDADO → no, y el motivo dice dónde se arregla", () => {
    const v = puedeVerHistoria(
      estado({
        residencia: residencia({ rolDeCuidadoVigente: false, residenteEnMiZona: true }),
      }),
    );
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("SIN_ROL_DE_CUIDADO");
    expect(v.puede === false && v.mensaje).toContain("Personal");
  });

  it("3 · ROL REVOCADO → no. Una revocación deja `rolDeCuidadoVigente` en false", () => {
    // Lo que convierte «revocado» en `false` es el `revokedAt: null` del
    // WHERE de `resolverEstadoResidencia`, y eso lo prueba el bloque de
    // abajo. Aquí se prueba la mitad que decide.
    const v = puedeVerHistoria(
      estado({ residencia: residencia({ rolDeCuidadoVigente: false }) }),
    );
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("SIN_ROL_DE_CUIDADO");
  });

  it("4 · ROL DE ALCANCE TOTAL (DUE, médico, calidad, dirección) → sí, sin mirar la zona", () => {
    const v = puedeVerHistoria(
      estado({
        residencia: residencia({ alcanceTotal: true, residenteEnMiZona: false }),
      }),
    );
    expect(v.puede).toBe(true);
  });

  it("5 · AUXILIAR CON ZONA · el residente está DENTRO → sí", () => {
    expect(puedeVerHistoria(estado()).puede).toBe(true);
  });

  it("6 · AUXILIAR CON ZONA · el residente está FUERA → no, y el motivo lo dice", () => {
    const v = puedeVerHistoria(
      estado({ residencia: residencia({ residenteEnMiZona: false }) }),
    );
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("RESIDENTE_FUERA_DE_TU_ZONA");
  });

  it("7 · RESIDENTE SIN CAMA (ingreso pendiente) → no para la auxiliar, sí para la DUE", () => {
    // Un residente sin cama no está en la zona de nadie. Es lo correcto: a
    // un ingreso pendiente lo ve dirección o la DUE, que tienen alcance
    // total, y son quienes le van a asignar la habitación.
    const auxiliar = puedeVerHistoria(
      estado({ residencia: residencia({ residenteEnMiZona: false }) }),
    );
    expect(auxiliar.puede).toBe(false);
    const due = puedeVerHistoria(
      estado({
        residencia: residencia({ alcanceTotal: true, residenteEnMiZona: false }),
      }),
    );
    expect(due.puede).toBe(true);
  });

  it("8 · CAMBIO DE HABITACIÓN · al cambiar de planta, cambia quién lo ve", () => {
    // La función no sabe de camas: sabe de `residenteEnMiZona`. Lo que este
    // caso fija es que el veredicto SIGUE a la cama, y los dos lados.
    const antes = puedeVerHistoria(
      estado({ residencia: residencia({ residenteEnMiZona: true }) }),
    );
    const despues = puedeVerHistoria(
      estado({ residencia: residencia({ residenteEnMiZona: false }) }),
    );
    expect(antes.puede).toBe(true);
    expect(despues.puede).toBe(false);
  });

  it("9 · RESIDENTE DADO DE ALTA · su cama se cerró, así que sale de la zona", () => {
    // Dar de alta cierra la ocupación (`toAt`), así que el residente deja
    // de tener cama vigente y deja de estar en la zona de nadie. La
    // dirección y la DUE siguen viéndolo —tienen que poder: su historia se
    // conserva cinco años— porque su alcance es total.
    const auxiliar = puedeVerHistoria(
      estado({ residencia: residencia({ residenteEnMiZona: false }) }),
    );
    expect(auxiliar.puede).toBe(false);
    const direccion = puedeVerHistoria(
      estado({ residencia: residencia({ alcanceTotal: true, residenteEnMiZona: false }) }),
    );
    expect(direccion.puede).toBe(true);
  });

  it("la MARCA SANITARIA sigue mandando: sin ella, no, aunque tenga rol de cuidado", () => {
    // La rama de residencia va DESPUÉS de la marca a propósito. Si fuera
    // antes, un rol de cuidado abriría la historia con la marca quitada a
    // mano y la marca dejaría de significar nada.
    const v = puedeVerHistoria(estado({ esSanitario: false }));
    expect(v.puede).toBe(false);
    expect(v.puede === false && v.motivo).toBe("NO_SANITARIO");
  });

  it("cada negativa nueva trae un mensaje que dice qué hacer", () => {
    for (const parche of [
      { rolDeCuidadoVigente: false },
      { residenteEnMiZona: false },
    ]) {
      const v = puedeVerHistoria(estado({ residencia: residencia(parche) }));
      expect(v.puede).toBe(false);
      expect(v.puede === false && v.mensaje.length).toBeGreaterThan(20);
    }
  });
});

// ── La otra mitad: que lo que se LEE de la base es lo que se decide ──
//
// `resolverEstadoResidencia` no tiene reglas; tiene tres WHERE. Lo que se
// prueba aquí son esos WHERE —`revokedAt: null` y la vigencia por fechas
// son lo que hace que una revocación o una caducidad quiten el acceso— y
// la ECONOMÍA DE CONSULTAS, que no es cosmética: es lo que hace que los
// quince clientes de hoy no paguen nada por este bloque.
describe("residencia-1 · resolverAccesoClinico lee lo justo", () => {
  const AHORA = new Date("2026-10-14T12:00:00Z");

  function prismaDoble(opts: {
    residenciaEnabled: boolean;
    roles?: Array<{ careRole: { fullScope: boolean } }>;
    zonas?: Array<{ floorId: string | null }>;
    cama?: { bed: { room: { floorId: string } } } | null;
  }) {
    const llamadas = { tenant: 0, user: 0, acceso: 0, roles: 0, zonas: 0, cama: 0 };
    const wheres: Record<string, unknown> = {};
    const prisma: PrismaParaAcceso = {
      tenant: {
        findUnique: vi.fn(async () => {
          llamadas.tenant += 1;
          return {
            clinicalRecordsEnabled: true,
            residenciaEnabled: opts.residenciaEnabled,
          };
        }),
      },
      user: {
        findFirst: vi.fn(async () => {
          llamadas.user += 1;
          return { isClinician: true, clinicalScope: "SELECTION" as const };
        }),
      },
      clinicalAccess: {
        findFirst: vi.fn(async () => {
          llamadas.acceso += 1;
          return null;
        }),
      },
      careRoleAssignment: {
        findMany: vi.fn(async (args: unknown) => {
          llamadas.roles += 1;
          wheres.roles = (args as { where: unknown }).where;
          return opts.roles ?? [];
        }),
      },
      careZoneAssignment: {
        findMany: vi.fn(async (args: unknown) => {
          llamadas.zonas += 1;
          wheres.zonas = (args as { where: unknown }).where;
          return opts.zonas ?? [];
        }),
      },
      bedAssignment: {
        findFirst: vi.fn(async (args: unknown) => {
          llamadas.cama += 1;
          wheres.cama = (args as { where: unknown }).where;
          return opts.cama ?? null;
        }),
      },
    };
    return { prisma, llamadas, wheres };
  }

  const input = {
    tenantId: "t-1",
    userId: "u-1",
    clientId: "c-1",
    ahora: AHORA,
  };

  it("un tenant QUE NO ES RESIDENCIA no gasta ni una consulta del bloque", async () => {
    // Es la condición con la que este bloque podía tocar la función de la
    // clínica. Si esto se rompe, cada `GET` de la podóloga de clinica-1
    // paga tres consultas que no necesita.
    const d = prismaDoble({ residenciaEnabled: false });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(d.llamadas.roles).toBe(0);
    expect(d.llamadas.zonas).toBe(0);
    expect(d.llamadas.cama).toBe(0);
    // Y sí gasta la de la clínica, porque la regla de siempre sigue
    // aplicándose igual.
    expect(d.llamadas.acceso).toBe(1);
    expect(res.estado.residencia).toBeNull();
  });

  it("en una RESIDENCIA no se consulta `ClinicalAccess`: la tabla está vacía", async () => {
    const d = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: true } }],
    });
    await resolverAccesoClinico(d.prisma, input);
    expect(d.llamadas.acceso).toBe(0);
  });

  it("SIN ROL DE CUIDADO no se preguntan la zona ni la cama", async () => {
    const d = prismaDoble({ residenciaEnabled: true, roles: [] });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(d.llamadas.roles).toBe(1);
    expect(d.llamadas.zonas).toBe(0);
    expect(d.llamadas.cama).toBe(0);
    expect(res.veredicto.puede).toBe(false);
  });

  it("CON ALCANCE TOTAL no se pregunta la cama del residente", async () => {
    const d = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: true } }],
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(d.llamadas.cama).toBe(0);
    expect(res.veredicto.puede).toBe(true);
  });

  it("CON ROL Y SIN ZONA tampoco: no hay planta con la que comparar", async () => {
    const d = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: false } }],
      zonas: [],
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(d.llamadas.zonas).toBe(1);
    expect(d.llamadas.cama).toBe(0);
    expect(res.veredicto.puede).toBe(false);
  });

  it("el WHERE del rol exige SIN REVOCAR y VIGENTE — es lo que lo decide", async () => {
    const d = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: false } }],
      zonas: [{ floorId: "p-1" }],
      cama: { bed: { room: { floorId: "p-1" } } },
    });
    await resolverAccesoClinico(d.prisma, input);
    // Si este `revokedAt: null` desapareciera, una revocación dejaría de
    // quitar el rol y nada más se pondría rojo. Por eso se mira aquí.
    expect(d.wheres.roles).toMatchObject({
      tenantId: "t-1",
      userId: "u-1",
      revokedAt: null,
      careRole: { active: true },
    });
    // Y la vigencia por fechas, que es lo que hace que una suplencia de
    // verano caduque sola.
    expect(d.wheres.roles).toMatchObject({ fromAt: { lte: AHORA } });
  });

  it("el WHERE de la cama exige la VIGENTE (`toAt: null`), la misma del índice parcial", async () => {
    const d = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: false } }],
      zonas: [{ floorId: "p-1" }],
      cama: { bed: { room: { floorId: "p-1" } } },
    });
    await resolverAccesoClinico(d.prisma, input);
    expect(d.wheres.cama).toMatchObject({
      tenantId: "t-1",
      clientId: "c-1",
      toAt: null,
    });
  });

  it("la zona de TODO EL CENTRO (`floorId: null`) da alcance total sin rol que lo dé", async () => {
    const d = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: false } }],
      zonas: [{ floorId: null }],
    });
    const res = await resolverAccesoClinico(d.prisma, input);
    expect(res.estado.residencia?.alcanceTotal).toBe(true);
    expect(res.veredicto.puede).toBe(true);
    expect(d.llamadas.cama).toBe(0);
  });

  it("la planta de la cama tiene que estar EN la zona, no sólo existir", async () => {
    const dentro = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: false } }],
      zonas: [{ floorId: "p-1" }],
      cama: { bed: { room: { floorId: "p-1" } } },
    });
    const fuera = prismaDoble({
      residenciaEnabled: true,
      roles: [{ careRole: { fullScope: false } }],
      zonas: [{ floorId: "p-1" }],
      cama: { bed: { room: { floorId: "p-2" } } },
    });
    expect((await resolverAccesoClinico(dentro.prisma, input)).veredicto.puede).toBe(true);
    expect((await resolverAccesoClinico(fuera.prisma, input)).veredicto.puede).toBe(false);
  });

  it("un cliente Prisma SIN los modelos del bloque cae del lado restrictivo", async () => {
    // Los dobles de la suite de la clínica no exponen `careRoleAssignment`.
    // Que eso dé «sin rol de cuidado» y no un 500 es lo que hace que
    // aquellos tests sigan verdes sin tocarles una línea.
    const prisma = {
      tenant: {
        findUnique: async () => ({
          clinicalRecordsEnabled: true,
          residenciaEnabled: true,
        }),
      },
      user: {
        findFirst: async () => ({
          isClinician: true,
          clinicalScope: "ALL" as const,
        }),
      },
      clinicalAccess: { findFirst: async () => null },
    } satisfies PrismaParaAcceso;
    const res = await resolverAccesoClinico(prisma, input);
    expect(res.veredicto.puede).toBe(false);
    expect(res.veredicto.puede === false && res.veredicto.motivo).toBe(
      "SIN_ROL_DE_CUIDADO",
    );
  });
});
