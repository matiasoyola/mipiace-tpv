// B-reservas-9 · El panel de salud de la agenda.
//
// Lo que se prueba aquí es el CONTRATO del panel: que cada tarjeta llega
// con su consulta y su explicación, que una tarjeta cuya dependencia no
// está sale deshabilitada y NO a cero, que el tenant va en `$1` de todas
// las consultas y que el gate de agenda protege el endpoint.
//
// Las CIFRAS —que cada tarjeta cuente bien sobre un fixture— se prueban
// contra Postgres de verdad en `test-e2e/agenda-salud.e2e.ts`: estas
// consultas son SQL crudo, y probarlas contra un doble sería probar el
// doble. Aquí el `$queryRawUnsafe` es un despachador que devuelve filas
// conocidas y, sobre todo, **apunta qué SQL se ha ejecutado**: lo que se
// afirma es que la consulta que corre es la MISMA que se enseña en
// pantalla, que es el principio entero del bloque (ADR-F3).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";

// Qué tablas "existen" en el esquema de la prueba. Por defecto sólo las
// que hay hoy en master: ni bonos, ni reglas de yield, ni ventana
// reservable. Es el estado real del repo el día de este bloque.
let tablasExistentes = new Set<string>([
  "service_scheduling",
  "products",
  "staff_skills",
  "staff_profiles",
  "appointments",
  "booking_policies",
]);
let patronDeclarado: unknown = null;
const ejecutadas: Array<{ sql: string; params: unknown[] }> = [];
let agendaEnabled = true;

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async () => ({
      agendaEnabled,
      agendaSlotMinutes: 15,
    })),
  },
  $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
    // La sonda de esquema: cuántas de las columnas pedidas existen.
    if (sql.includes("information_schema.columns")) {
      const table = params[0] as string;
      const columns = params[1] as string[];
      return [{ n: tablasExistentes.has(table) ? columns.length : 0 }];
    }
    if (sql.includes("FROM booking_policies")) {
      return patronDeclarado === null ? [] : [{ value: patronDeclarado }];
    }
    ejecutadas.push({ sql, params });
    if (sql.includes("FROM service_scheduling ss") && sql.includes("HAVING")) {
      return [
        {
          id: "svc-1",
          name: "Maderoterapia",
          staff_required: 1,
          skilled_active: 0,
          skilled_total: 0,
        },
        {
          id: "svc-2",
          name: "Ritual reafirmante drenante",
          staff_required: 2,
          skilled_active: 1,
          skilled_total: 1,
        },
      ];
    }
    if (sql.includes("FROM service_scheduling ss")) {
      return [
        {
          id: "svc-3",
          name: "Spa capilar",
          duration_min: 32,
          buffer_after_min: 0,
        },
      ];
    }
    if (sql.includes("FROM vouchers v")) {
      return [];
    }
    if (sql.includes("GROUP BY a.source")) {
      return [
        { source: "PRESENCIAL", n: 7 },
        { source: "PHONE", n: 2 },
      ];
    }
    return [];
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerAgendaRoutes } = await import("../src/agenda/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { HEALTH_CARDS, runAgendaHealth, CONTRATO_VALIDADO } = await import(
  "../src/agenda/health.js"
);

const TOKEN = signAccessToken({ sub: OWNER_ID, tid: TENANT_ID, role: "OWNER" });
const auth = { authorization: `Bearer ${TOKEN}` };
// Un reloj de mentira: "las últimas 24 h" tienen que ser deterministas.
const AHORA = new Date("2026-09-13T10:00:00.000Z");
const clock = { now: () => AHORA };

async function buildApp() {
  const app = Fastify();
  await registerAgendaRoutes(app, { prisma: fakePrisma, clock, store: {} as any });
  return app;
}

async function getHealth() {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/agenda/health",
    headers: auth,
  });
  await app.close();
  return res;
}

beforeEach(() => {
  tablasExistentes = new Set<string>([
    "service_scheduling",
    "products",
    "staff_skills",
    "staff_profiles",
    "appointments",
    "booking_policies",
  ]);
  patronDeclarado = null;
  ejecutadas.length = 0;
  agendaEnabled = true;
});

describe("el catálogo de tarjetas", () => {
  it("son las seis del §7.5, en orden", () => {
    expect(HEALTH_CARDS.map((c) => c.key)).toEqual([
      "servicios-sin-profesional",
      "duracion-fuera-de-patron",
      "saldo-vivo-sin-cita",
      "filtrado-por-reglas",
      "citas-por-canal-24h",
      "ventanas-fuera-de-turno",
    ]);
  });

  // La restricción dura del bloque: un número sin consulta trazable no se
  // muestra. Si alguien añade una tarjeta sin explicación, este test cae.
  it("ninguna tarjeta existe sin su consulta y su explicación", () => {
    for (const card of HEALTH_CARDS) {
      expect(card.query.length, card.key).toBeGreaterThan(0);
      expect(card.explain.length, card.key).toBeGreaterThan(40);
      expect(card.goodNews.length, card.key).toBeGreaterThan(0);
      expect(card.title.length, card.key).toBeGreaterThan(0);
    }
  });

  // Aislamiento por fila: el tenant es SIEMPRE el primer parámetro. Una
  // consulta de diagnóstico que se olvide del tenant enseña datos de otro
  // centro, que es peor que no enseñar nada.
  it("toda consulta filtra por el tenant en $1", () => {
    for (const card of HEALTH_CARDS) {
      expect(card.query, card.key).toMatch(/tenant_id = \$1/);
    }
  });
});

describe("GET /agenda/health", () => {
  it("403 cuando la agenda está apagada", async () => {
    agendaEnabled = false;
    const res = await getHealth();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("AGENDA_DISABLED");
  });

  it("devuelve las seis con cifra, explicación y consulta", async () => {
    const res = await getHealth();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cards).toHaveLength(6);
    for (const card of body.cards) {
      expect(card.query, card.key).toMatch(/SELECT/);
      expect(card.explain, card.key).toBeTruthy();
      expect(card.params.length, card.key).toBeGreaterThan(0);
    }
    expect(body.generatedAt).toBe(AHORA.toISOString());
  });

  // El caso real: un servicio agendable con cero skills sale en la lista.
  it("la tarjeta 1 lista los servicios que nadie puede hacer", async () => {
    const body = (await getHealth()).json();
    const card = body.cards.find((c: any) => c.key === "servicios-sin-profesional");
    expect(card.status).toBe("ok");
    expect(card.value).toBe(2);
    expect(card.items.map((i: any) => i.label)).toEqual([
      "Maderoterapia",
      "Ritual reafirmante drenante",
    ]);
    // El dato que desambigua, no sólo el nombre (auditoría §7.1 nº 13).
    expect(card.items[0].detail).toBe("Nadie lo tiene asignado");
    expect(card.items[1].detail).toBe("1 de 2 profesionales a la vez");
  });

  // La consulta que se enseña es la que se ha ejecutado. Sin esto el
  // desplegable «cómo se calcula esto» sería decoración.
  it("la consulta que enseña es la que ha corrido, con el tenant", async () => {
    const body = (await getHealth()).json();
    const card = body.cards.find((c: any) => c.key === "servicios-sin-profesional");
    const corrida = ejecutadas.find((e) => e.sql === card.query);
    expect(corrida).toBeDefined();
    expect(corrida!.params[0]).toBe(TENANT_ID);
  });

  it("la tarjeta 5 cuenta por canal las últimas 24 h", async () => {
    const body = (await getHealth()).json();
    const card = body.cards.find((c: any) => c.key === "citas-por-canal-24h");
    expect(card.value).toBe(9);
    expect(card.items.map((i: any) => i.label)).toEqual(["Mostrador", "Teléfono"]);
    const corrida = ejecutadas.find((e) => e.sql === card.query)!;
    expect(corrida.params[1]).toEqual(new Date("2026-09-12T10:00:00.000Z"));
  });
});

describe("degradación honesta", () => {
  // Un cero falso es peor que un hueco declarado: parece un dato bueno.
  it("las tres tarjetas cuyo bloque no existe salen deshabilitadas, NO a cero", async () => {
    const body = (await getHealth()).json();
    const pendientes = body.cards.filter((c: any) =>
      ["saldo-vivo-sin-cita", "filtrado-por-reglas", "ventanas-fuera-de-turno"].includes(
        c.key,
      ),
    );
    expect(pendientes).toHaveLength(3);
    for (const card of pendientes) {
      expect(card.status, card.key).toBe("unavailable");
      expect(card.value, card.key).toBeNull();
      expect(card.items, card.key).toEqual([]);
      expect(card.dependsOn.block, card.key).toMatch(/^B-reservas-/);
      expect(card.unavailableReason, card.key).toBeTruthy();
    }
  });

  it("dice de qué bloque depende cada una", async () => {
    const body = (await getHealth()).json();
    const porKey = Object.fromEntries(body.cards.map((c: any) => [c.key, c]));
    expect(porKey["saldo-vivo-sin-cita"].dependsOn.block).toBe("B-reservas-8");
    expect(porKey["filtrado-por-reglas"].dependsOn.block).toBe("B-reservas-6b");
    expect(porKey["ventanas-fuera-de-turno"].dependsOn.block).toBe("B-reservas-7b");
  });

  // La tabla presente NO basta. Una consulta que nadie ha ejecutado nunca
  // puede casar en forma y mentir en significado, y entonces devuelve un
  // CERO — justo lo que este panel existe para no enseñar. Así que con la
  // tabla puesta y el contrato sin validar la tarjeta sigue apagada, y lo
  // dice con otras palabras: ya no falta el bloque, falta validarla.
  it("la tabla puesta no enciende la tarjeta si nadie ha validado su consulta", async () => {
    tablasExistentes.add("vouchers");
    const body = (await getHealth()).json();
    const card = body.cards.find((c: any) => c.key === "saldo-vivo-sin-cita");
    expect(card.status).toBe("unavailable");
    expect(card.value).toBeNull();
    expect(card.unavailableReason).toMatch(/todav[ií]a no se ha ejecutado/i);
    expect(card.unavailableReason).toMatch(/B-reservas-8/);
  });

  // Y con las dos cosas —tabla y consulta validada por su bloque— se
  // enciende sin tocar nada más: la sonda sigue siendo quien decide.
  it("con la tabla y el contrato validado, la tarjeta se enciende", async () => {
    tablasExistentes.add("vouchers");
    CONTRATO_VALIDADO["saldo-vivo-sin-cita"] = true;
    try {
      const body = (await getHealth()).json();
      const card = body.cards.find((c: any) => c.key === "saldo-vivo-sin-cita");
      expect(card.status).toBe("ok");
      expect(card.value).toBe(0);
      // Y el cero se dice con palabras, que es lo que pinta el front.
      expect(card.goodNews).toBeTruthy();
    } finally {
      CONTRATO_VALIDADO["saldo-vivo-sin-cita"] = false;
    }
  });

  // El flag no sustituye a la sonda: validado pero con otro esquema, la
  // tarjeta sigue apagada en vez de romperse con un 500.
  it("el contrato validado no enciende nada si la tabla no está", async () => {
    CONTRATO_VALIDADO["saldo-vivo-sin-cita"] = true;
    try {
      const body = (await getHealth()).json();
      const card = body.cards.find((c: any) => c.key === "saldo-vivo-sin-cita");
      expect(card.status).toBe("unavailable");
      expect(card.unavailableReason).toMatch(/no existe/i);
    } finally {
      CONTRATO_VALIDADO["saldo-vivo-sin-cita"] = false;
    }
  });

  // El patrón de duración no se inventa: sin declarar, la tarjeta calla.
  it("sin patrón declarado la tarjeta 2 no inventa un patrón", async () => {
    const body = (await getHealth()).json();
    const card = body.cards.find((c: any) => c.key === "duracion-fuera-de-patron");
    expect(card.status).toBe("unavailable");
    expect(card.value).toBeNull();
    expect(card.unavailableReason).toMatch(/no ha declarado/i);
  });

  it("con patrón declarado, la tarjeta 2 mide la desviación", async () => {
    patronDeclarado = { stepMin: 5, pickupMin: 10 };
    const body = (await getHealth()).json();
    const card = body.cards.find((c: any) => c.key === "duracion-fuera-de-patron");
    expect(card.status).toBe("ok");
    expect(card.value).toBe(1);
    expect(card.items[0].detail).toBe(
      "32 min no es múltiplo de 5 · recogida de 0 min en vez de 10",
    );
    // El patrón declarado viaja a la pantalla junto a la cifra.
    expect(card.params).toContain("$2 = múltiplo declarado: 5 min");
  });

  // Una consulta que peta no puede tumbar el panel entero: el resto de
  // tarjetas siguen diciendo lo suyo.
  it("una tarjeta que falla no se lleva por delante a las demás", async () => {
    const original = fakePrisma.$queryRawUnsafe;
    fakePrisma.$queryRawUnsafe = vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("FROM appointments a") && sql.includes("GROUP BY a.source")) {
        throw new Error("boom");
      }
      return original(sql, ...params);
    });
    const body = (await getHealth()).json();
    fakePrisma.$queryRawUnsafe = original;
    const porKey = Object.fromEntries(body.cards.map((c: any) => [c.key, c]));
    expect(porKey["citas-por-canal-24h"].status).toBe("unavailable");
    expect(porKey["citas-por-canal-24h"].value).toBeNull();
    expect(porKey["servicios-sin-profesional"].status).toBe("ok");
  });
});

describe("runAgendaHealth aislado", () => {
  it("no toca ningún otro tenant", async () => {
    const otro = "00000000-0000-0000-0000-000000000002";
    await runAgendaHealth({ prisma: fakePrisma, tenantId: otro, now: AHORA });
    for (const e of ejecutadas) expect(e.params[0]).toBe(otro);
  });
});
