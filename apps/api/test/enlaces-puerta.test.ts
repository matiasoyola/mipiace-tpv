// enlaces-publicos · LA PUERTA, con Prisma y Redis en memoria.
//
// Lo que se prueba aquí es el MECANISMO, con `purpose` de prueba y no con
// la valoración: la valoración ya tiene su propia guardia entera
// (`clinica-valoracion-rutas.test.ts`, 48 casos que no se tocaron), y
// probar la puerta a través de ella mezclaría «la puerta funciona» con «la
// valoración funciona». Lo que decide el MOTOR (que los usos no bajen, que
// un anulado no se des-anule, que la columna no admita un token en claro)
// lo prueba `test-e2e/enlaces-publicos.e2e.ts` contra Postgres de verdad.
//
// Las garantías, una por bloque:
//
//   1. LAS TRES CABECERAS, en el 200, en la 404 y en el 429. Las pone la
//      puerta antes de cualquier rama, así que no hay respuesta suya que
//      pueda salir sin ellas.
//   2. LA MISMA 404 para los SIETE motivos, carácter por carácter.
//   3. EL TOPE DE USOS: se gasta lo que se declara y ni uno más.
//   4. EL TOPE DE TOKENS INEXISTENTES: la undécima petición del minuto.
//   5. Y NO castiga a quien tiene un enlace caducado: ése no es un
//      escáner.
//   6. EL LÍMITE DEL EQUIPO VA POR TOKEN y no por IP — todo el centro sale
//      por el mismo wifi.
//   7. EL TOKEN NO SE GUARDA: en la fila está su SHA-256.
//   8. UN SOLO ENLACE VIVO por objetivo, y rotar es revocar + crear.
//   9. EL RASTRO CLÍNICO lo declara el `purpose`, no la ruta.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTRO_TENANT = "00000000-0000-0000-0000-000000000002";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";

// ── Prisma en memoria ────────────────────────────────────────────────

interface FakeLink {
  id: string;
  tenantId: string;
  purpose: string;
  targetType: string;
  targetId: string;
  tokenHash: string;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
}
const enlaces: FakeLink[] = [];

/** El objeto al que apuntan los `purpose` de prueba. */
interface FakeObjetivo {
  id: string;
  tenantId: string;
  clientId: string;
  abierto: boolean;
}
const objetivos = new Map<string, FakeObjetivo>();

interface FakeLog {
  tenantId: string;
  userId: string;
  clientId: string;
  action: string;
  outcome: string;
  route: string | null;
}
const registro: FakeLog[] = [];

const users = new Map<
  string,
  { id: string; tenantId: string; email: string; isSystemActor: boolean }
>();

let registroRoto = false;

function coincideEnlace(l: FakeLink, where: Record<string, unknown>): boolean {
  if (where.id != null && l.id !== where.id) return false;
  if (where.tenantId != null && l.tenantId !== where.tenantId) return false;
  if (where.purpose != null && l.purpose !== where.purpose) return false;
  if (where.targetType != null && l.targetType !== where.targetType) {
    return false;
  }
  if (where.targetId != null && l.targetId !== where.targetId) return false;
  if (where.revokedAt === null && l.revokedAt !== null) return false;
  const uc = where.usedCount as { lt?: number } | undefined;
  if (uc?.lt != null && !(l.usedCount < uc.lt)) return false;
  return true;
}

const fakePrisma = {
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(fakePrisma),
  ),
  publicLink: {
    create: vi.fn(async ({ data }: any) => {
      // Los dos invariantes que Postgres impone y que hacen que estos
      // tests prueben algo: la huella es un SHA-256, y hay un solo enlace
      // vivo por (`purpose`, objetivo).
      if (!/^[0-9a-f]{64}$/.test(data.tokenHash)) {
        throw new Error(
          'new row violates check constraint "public_links_token_hash_es_sha256"',
        );
      }
      if (data.maxUses < 1) {
        throw new Error(
          'new row violates check constraint "public_links_max_uses_positivo"',
        );
      }
      const yaVivo = enlaces.some(
        (l) =>
          l.purpose === data.purpose &&
          l.targetId === data.targetId &&
          l.revokedAt === null &&
          l.usedCount < l.maxUses,
      );
      if (yaVivo) {
        throw new Error(
          'duplicate key value violates unique constraint "public_links_uno_vivo_key"',
        );
      }
      const row: FakeLink = {
        id: randomUUID(),
        tenantId: data.tenantId,
        purpose: data.purpose,
        targetType: data.targetType,
        targetId: data.targetId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        maxUses: data.maxUses,
        usedCount: 0,
        revokedAt: null,
        createdByUserId: data.createdByUserId ?? null,
        createdAt: new Date(Date.now() + enlaces.length),
      };
      enlaces.push(row);
      return { id: row.id };
    }),
    findUnique: vi.fn(
      async ({ where }: any) =>
        enlaces.find((l) => l.tokenHash === where.tokenHash) ?? null,
    ),
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      let xs = enlaces.filter((l) => coincideEnlace(l, where));
      if (orderBy?.createdAt === "desc") {
        xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
      }
      return xs[0] ?? null;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const xs = enlaces.filter((l) => coincideEnlace(l, where));
      for (const l of xs) {
        if (data.revokedAt !== undefined) l.revokedAt = data.revokedAt;
        if (data.usedCount?.increment != null) {
          l.usedCount += data.usedCount.increment;
          // El CHECK `public_links_usos_dentro_del_tope`, también aquí.
          if (l.usedCount > l.maxUses) {
            throw new Error(
              'new row violates check constraint "public_links_usos_dentro_del_tope"',
            );
          }
        }
      }
      return { count: xs.length };
    }),
  },
  // El actor «paciente por enlace» de `actor-paciente.ts`.
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const u of users.values()) {
        if (u.tenantId !== where.tenantId) continue;
        if (u.email !== where.email) continue;
        if (where.isSystemActor != null && u.isSystemActor !== where.isSystemActor) {
          continue;
        }
        return u;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        isSystemActor: data.isSystemActor ?? false,
      };
      users.set(row.id, row);
      return { id: row.id };
    }),
  },
  clinicalAccessLog: {
    create: vi.fn(async ({ data }: any) => {
      if (registroRoto) throw new Error("append-only table unavailable");
      registro.push({
        tenantId: data.tenantId,
        userId: data.userId,
        clientId: data.clientId,
        action: data.action,
        outcome: data.outcome,
        route: data.route ?? null,
      });
      return { id: randomUUID() };
    }),
  },
} as const;

// Redis en memoria, sólo lo que usan el candado y el throttle.
const redisKeys = new Map<string, number>();
const fakeRedis = {
  ttl: async (k: string) => (redisKeys.has(k) ? 3600 : -2),
  get: async (k: string) => redisKeys.get(k)?.toString() ?? null,
  incr: async (k: string) => {
    const n = (redisKeys.get(k) ?? 0) + 1;
    redisKeys.set(k, n);
    return n;
  },
  expire: async () => 1,
  set: async (k: string) => {
    redisKeys.set(k, 1);
    return "OK";
  },
  del: async (...ks: string[]) => {
    for (const k of ks) redisKeys.delete(k);
    return ks.length;
  },
  decr: async (k: string) => {
    const n = (redisKeys.get(k) ?? 0) - 1;
    redisKeys.set(k, n);
    return n;
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const {
  CABECERAS_DE_ENLACE,
  consumirEnlace,
  crearEnlace,
  registrarAccesoDelEnlace,
  resolverEnlace,
  revocarEnlace,
  revocarEnlacesDe,
} = await import("../src/enlaces/puerta.js");
const { MAX_INEXISTENTES, MAX_INTENTOS } = await import(
  "../src/enlaces/limites.js"
);
const { huellaDeToken, nuevoToken } = await import("../src/enlaces/token.js");
const { REGLAS_VALORACION } = await import("../src/enlaces/reglas.js");
type ReglasDePurpose<T> = import("../src/enlaces/reglas.js").ReglasDePurpose<T>;

// ── Los dos `purpose` de prueba ──────────────────────────────────────
//
// Ninguno está en el registro de producción, y es a propósito: el bloque
// sólo da de alta `VALORACION`. Lo que estos dos ejercitan es el
// mecanismo que los `purpose` que vienen van a usar.

const MENSAJES = {
  code: "PRUEBA_NOT_FOUND",
  noSirve: "Este enlace ya no sirve.",
  demasiados: "Demasiados intentos.",
};

/** El de siempre: por IP, dos usos, deja rastro clínico. */
const REGLAS_PRUEBA: ReglasDePurpose<FakeObjetivo> = {
  purpose: "PRUEBA",
  targetType: "OBJETIVO_DE_PRUEBA",
  perfil: "SOLO_ESCRIBIR",
  vidaMs: (canal) => (canal === "CORTO" ? 1000 : 60 * 60 * 1000),
  maxUsos: 2,
  limitePor: "IP",
  mensajes: MENSAJES,
  registraAccesoClinico: true,
  pacienteDe: (o) => o.clientId,
  accionClinica: "WRITE",
  cargarObjetivo: async (_p, { tenantId, targetId }) => {
    const o = objetivos.get(targetId);
    return o && o.tenantId === tenantId ? o : null;
  },
  admiteEnlace: (o) => o.abierto,
};

/**
 * EL `purpose` DEL EQUIPO, el caso que la decisión S1.4 deja preparado:
 * **el límite va por token y no por IP**, porque todas las profesionales
 * del centro contestan desde el mismo wifi y por IP serían un solo
 * atacante. Y no deja rastro clínico: lo que el equipo rellena no es la
 * historia de un paciente.
 */
const REGLAS_EQUIPO: ReglasDePurpose<FakeObjetivo> = {
  ...REGLAS_PRUEBA,
  purpose: "PRUEBA_EQUIPO",
  perfil: "SOLO_LEER",
  maxUsos: 50,
  limitePor: "TOKEN",
  registraAccesoClinico: false,
  pacienteDe: null,
  accionClinica: null,
};

// ── La app de prueba ─────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify();
  const params = {
    type: "object",
    required: ["token"],
    properties: { token: { type: "string", minLength: 1, maxLength: 200 } },
  } as const;

  for (const reglas of [REGLAS_PRUEBA, REGLAS_EQUIPO]) {
    app.get(
      `/${reglas.purpose}/:token`,
      { schema: { params } },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const enlace = await resolverEnlace(request, reply, reglas);
        if (!enlace) return reply;
        return { ok: true, usosRestantes: enlace.usosRestantes };
      },
    );
  }
  return app;
}

/** Un objetivo abierto y su enlace vivo. Devuelve el token. */
async function conEnlace(
  reglas: ReglasDePurpose<FakeObjetivo>,
  opts: { canal?: string; abierto?: boolean; tenantId?: string } = {},
): Promise<{ token: string; enlaceId: string; targetId: string }> {
  const targetId = randomUUID();
  const tenantId = opts.tenantId ?? TENANT_ID;
  objetivos.set(targetId, {
    id: targetId,
    tenantId,
    clientId: PACIENTE_ID,
    abierto: opts.abierto ?? true,
  });
  const creado = await crearEnlace(fakePrisma as never, reglas, {
    tenantId,
    targetId,
    canal: opts.canal,
    creadoPorUserId: null,
  });
  return { token: creado.token, enlaceId: creado.enlaceId, targetId };
}

/** Lo caduca a mano, que es lo que el reloj haría. */
function caducar(enlaceId: string): void {
  enlaces.find((l) => l.id === enlaceId)!.expiresAt = new Date(0);
}

function get(
  app: Awaited<ReturnType<typeof buildApp>>,
  purpose: string,
  token: string,
  ip = "10.0.0.1",
) {
  return app.inject({
    method: "GET",
    url: `/${purpose}/${token}`,
    remoteAddress: ip,
  });
}

beforeEach(() => {
  enlaces.length = 0;
  objetivos.clear();
  registro.length = 0;
  users.clear();
  redisKeys.clear();
  registroRoto = false;
});

// ── 1 · las tres cabeceras ───────────────────────────────────────────

describe("enlaces-publicos · LAS TRES CABECERAS, en toda respuesta de la puerta", () => {
  // LA LISTA, ESCRITA A MANO Y NO LEÍDA DE `CABECERAS_DE_ENLACE`.
  //
  // Es la diferencia entre un test y un espejo: si los casos de abajo
  // recorrieran la constante, quitarle una cabecera los dejaría en verde
  // (recorrerían dos en vez de tres y las dos cuadrarían). El sabotaje
  // «quitar una de las tres» tiene que poner rojo el 200, la 404 y el 429,
  // y no sólo la igualdad de la constante.
  const LAS_TRES: Array<[string, string]> = [
    ["cache-control", "no-store"],
    ["x-robots-tag", "noindex"],
    ["referrer-policy", "no-referrer"],
  ];

  it("son no-store, noindex y no-referrer", () => {
    expect(CABECERAS_DE_ENLACE).toEqual({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    });
  });

  it("en el 200", async () => {
    const app = await buildApp();
    const { token } = await conEnlace(REGLAS_PRUEBA);
    const res = await get(app, "PRUEBA", token);
    expect(res.statusCode).toBe(200);
    for (const [k, v] of LAS_TRES) expect(res.headers[k]).toBe(v);
    await app.close();
  });

  it("en la 404 de un token que no es de nadie", async () => {
    const app = await buildApp();
    const res = await get(app, "PRUEBA", nuevoToken());
    expect(res.statusCode).toBe(404);
    for (const [k, v] of LAS_TRES) expect(res.headers[k]).toBe(v);
    await app.close();
  });

  it("y en el 429, que es la respuesta que nadie se acuerda de vestir", async () => {
    const app = await buildApp();
    let res = await get(app, "PRUEBA", nuevoToken());
    for (let i = 1; i <= MAX_INEXISTENTES; i++) {
      res = await get(app, "PRUEBA", nuevoToken());
    }
    expect(res.statusCode).toBe(429);
    for (const [k, v] of LAS_TRES) expect(res.headers[k]).toBe(v);
    await app.close();
  });
});

// ── 2 · la misma 404 ─────────────────────────────────────────────────

describe("enlaces-publicos · LA MISMA 404 para los siete motivos", () => {
  it("no existe, mal formado, otro purpose, anulado, caducado, gastado, sin objetivo y estado que no admite", async () => {
    const app = await buildApp();

    // Cada caso con su cubo de IP propio, para que el tope de tokens
    // inexistentes no se cruce con lo que se mide aquí.
    const noExiste = await get(app, "PRUEBA", nuevoToken(), "10.1.0.1");
    const malFormado = await get(app, "PRUEBA", "no-es-un-token", "10.1.0.2");

    const delEquipo = await conEnlace(REGLAS_EQUIPO);
    const otroPurpose = await get(app, "PRUEBA", delEquipo.token, "10.1.0.3");

    const anulado = await conEnlace(REGLAS_PRUEBA);
    await revocarEnlace(fakePrisma as never, { enlaceId: anulado.enlaceId });
    const resAnulado = await get(app, "PRUEBA", anulado.token, "10.1.0.4");

    const caducado = await conEnlace(REGLAS_PRUEBA);
    caducar(caducado.enlaceId);
    const resCaducado = await get(app, "PRUEBA", caducado.token, "10.1.0.5");

    const gastado = await conEnlace(REGLAS_PRUEBA);
    for (let i = 0; i < REGLAS_PRUEBA.maxUsos; i++) {
      await consumirEnlace(fakePrisma as never, {
        enlaceId: gastado.enlaceId,
        maxUsos: REGLAS_PRUEBA.maxUsos,
      });
    }
    const resGastado = await get(app, "PRUEBA", gastado.token, "10.1.0.6");

    const huerfano = await conEnlace(REGLAS_PRUEBA);
    objetivos.delete(huerfano.targetId);
    const resHuerfano = await get(app, "PRUEBA", huerfano.token, "10.1.0.7");

    const cerrado = await conEnlace(REGLAS_PRUEBA, { abierto: false });
    const resCerrado = await get(app, "PRUEBA", cerrado.token, "10.1.0.8");

    // Carácter por carácter, los ocho. Respuestas distintas le dicen a un
    // escáner que el token existía, y eso ya es información sobre una
    // persona.
    for (const r of [
      malFormado,
      otroPurpose,
      resAnulado,
      resCaducado,
      resGastado,
      resHuerfano,
      resCerrado,
    ]) {
      expect(r.statusCode).toBe(noExiste.statusCode);
      expect(r.body).toBe(noExiste.body);
    }
    expect(noExiste.statusCode).toBe(404);
    expect(noExiste.json().code).toBe(MENSAJES.code);
    await app.close();
  });

  it("y un enlace de OTRO tenant no abre: el objetivo se carga con el tenant del enlace", async () => {
    const app = await buildApp();
    const { token, targetId } = await conEnlace(REGLAS_PRUEBA);
    // El objetivo se muda de negocio. El enlace sigue diciendo el de antes.
    objetivos.get(targetId)!.tenantId = OTRO_TENANT;
    const res = await get(app, "PRUEBA", token);
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("EL REGISTRO tiene dado de alta sólo `VALORACION`", async () => {
    // Es lo que hace que `purpose` sea TEXT sin ser un agujero: para
    // preguntar a la puerta por un `purpose` hay que traerle sus REGLAS, y
    // las reglas sólo existen en `reglas.ts`. Una fila con un `purpose` que
    // nadie declara puede estar en la base y no tiene ninguna ruta que la
    // pregunte.
    //
    // Y este assert existe para que dar de alta un `purpose` nuevo sea un
    // acto deliberado y visible, y no algo que aparezca de rebote.
    const { PURPOSES } = await import("../src/enlaces/reglas.js");
    expect(Object.keys(PURPOSES)).toEqual(["VALORACION"]);
    expect(REGLAS_VALORACION.purpose).toBe("VALORACION");
    // Los dos `purpose` de este fichero NO están en el registro, a
    // propósito: lo que ejercitan es el mecanismo.
    expect(PURPOSES[REGLAS_PRUEBA.purpose]).toBeUndefined();
    expect(PURPOSES[REGLAS_EQUIPO.purpose]).toBeUndefined();
  });
});

// ── 3 · el tope de usos ──────────────────────────────────────────────

describe("enlaces-publicos · EL TOPE DE USOS, y ni uno más", () => {
  it("se gasta lo que el purpose declara, y después no abre", async () => {
    const app = await buildApp();
    const { token, enlaceId } = await conEnlace(REGLAS_PRUEBA);

    expect((await get(app, "PRUEBA", token)).json().usosRestantes).toBe(2);
    expect(
      await consumirEnlace(fakePrisma as never, {
        enlaceId,
        maxUsos: REGLAS_PRUEBA.maxUsos,
      }),
    ).toBe(true);
    expect((await get(app, "PRUEBA", token)).json().usosRestantes).toBe(1);
    expect(
      await consumirEnlace(fakePrisma as never, {
        enlaceId,
        maxUsos: REGLAS_PRUEBA.maxUsos,
      }),
    ).toBe(true);
    // El tercero no: ni el `consumir` ni la puerta.
    expect(
      await consumirEnlace(fakePrisma as never, {
        enlaceId,
        maxUsos: REGLAS_PRUEBA.maxUsos,
      }),
    ).toBe(false);
    expect((await get(app, "PRUEBA", token)).statusCode).toBe(404);
    expect(enlaces.find((l) => l.id === enlaceId)!.usedCount).toBe(2);
    await app.close();
  });

  it("y ABRIR NO GASTA: sólo gasta el acto que lo gasta", async () => {
    // El paciente recarga la pantalla y no se queda sin enlace. Es la
    // diferencia entre «de un solo uso» y «de una sola carga».
    const app = await buildApp();
    const { token, enlaceId } = await conEnlace(REGLAS_PRUEBA);
    for (let i = 0; i < 20; i++) {
      expect((await get(app, "PRUEBA", token)).statusCode).toBe(200);
    }
    expect(enlaces.find((l) => l.id === enlaceId)!.usedCount).toBe(0);
    await app.close();
  });

  it("un enlace ANULADO no se gasta", async () => {
    const { enlaceId } = await conEnlace(REGLAS_PRUEBA);
    await revocarEnlace(fakePrisma as never, { enlaceId });
    expect(
      await consumirEnlace(fakePrisma as never, {
        enlaceId,
        maxUsos: REGLAS_PRUEBA.maxUsos,
      }),
    ).toBe(false);
    expect(enlaces.find((l) => l.id === enlaceId)!.usedCount).toBe(0);
  });
});

// ── 4 y 5 · el tope de tokens inexistentes ───────────────────────────

describe("enlaces-publicos · EL TOPE DE TOKENS INEXISTENTES, 10 por minuto y por IP", () => {
  it("las diez primeras contestan 404; LA UNDÉCIMA, 429", async () => {
    const app = await buildApp();
    for (let i = 1; i <= MAX_INEXISTENTES; i++) {
      const r = await get(app, "PRUEBA", nuevoToken(), "10.2.0.1");
      expect(r.statusCode, `intento ${i}`).toBe(404);
    }
    const once = await get(app, "PRUEBA", nuevoToken(), "10.2.0.1");
    expect(once.statusCode).toBe(429);
    expect(once.json().code).toBe("TOO_MANY_REQUESTS");
    await app.close();
  });

  it("y es POR IP: otra IP sigue teniendo sus diez", async () => {
    const app = await buildApp();
    for (let i = 0; i <= MAX_INEXISTENTES; i++) {
      await get(app, "PRUEBA", nuevoToken(), "10.2.0.2");
    }
    expect((await get(app, "PRUEBA", nuevoToken(), "10.2.0.2")).statusCode).toBe(429);
    expect((await get(app, "PRUEBA", nuevoToken(), "10.2.0.3")).statusCode).toBe(404);
    await app.close();
  });

  it("cuenta también los tokens MAL FORMADOS: probar la forma tampoco es gratis", async () => {
    const app = await buildApp();
    for (let i = 0; i <= MAX_INEXISTENTES; i++) {
      await get(app, "PRUEBA", "no-es-un-token", "10.2.0.4");
    }
    expect((await get(app, "PRUEBA", "tampoco", "10.2.0.4")).statusCode).toBe(429);
    await app.close();
  });

  it("y NO castiga a quien tiene un enlace caducado: ése no es un escáner", async () => {
    // Un paciente mayor recarga quince veces la pantalla de «este enlace ya
    // no sirve». Bloquearle sería castigar al único que de verdad quería
    // contestar — y para el total ya está el cubo general.
    const app = await buildApp();
    const { token, enlaceId } = await conEnlace(REGLAS_PRUEBA);
    caducar(enlaceId);
    for (let i = 0; i < 15; i++) {
      const r = await get(app, "PRUEBA", token, "10.2.0.5");
      expect(r.statusCode, `recarga ${i}`).toBe(404);
    }
    await app.close();
  });

  it("y un enlace BUENO no gasta intentos: recargar no bloquea a nadie", async () => {
    const app = await buildApp();
    const { token } = await conEnlace(REGLAS_PRUEBA);
    for (let i = 0; i < 40; i++) {
      expect((await get(app, "PRUEBA", token, "10.2.0.6")).statusCode).toBe(200);
    }
    await app.close();
  });
});

// ── 6 · el límite del equipo ─────────────────────────────────────────

describe("enlaces-publicos · EL LÍMITE DEL EQUIPO VA POR TOKEN, no por IP", () => {
  /** Gasta el cubo general con fallos que NO son de token inexistente. */
  async function quemarElCubo(
    app: Awaited<ReturnType<typeof buildApp>>,
    purpose: string,
    token: string,
    ip: string,
  ) {
    for (let i = 0; i < MAX_INTENTOS; i++) {
      await get(app, purpose, token, ip);
    }
  }

  it("dos IPs con EL MISMO token comparten cubo: el wifi del centro no multiplica el límite", async () => {
    const app = await buildApp();
    const a = await conEnlace(REGLAS_EQUIPO);
    caducar(a.enlaceId);
    await quemarElCubo(app, "PRUEBA_EQUIPO", a.token, "10.3.0.1");
    // El candado está puesto sobre el TOKEN, así que otra IP con el mismo
    // token también lo encuentra cerrado.
    const otra = await get(app, "PRUEBA_EQUIPO", a.token, "10.3.0.9");
    expect(otra.statusCode).toBe(429);
    await app.close();
  });

  it("y dos tokens distintos desde LA MISMA IP no se estorban", async () => {
    // Es el caso real: cuatro profesionales rellenando sus capacidades
    // desde el mismo wifi. Por IP, la cuarta se quedaría fuera.
    const app = await buildApp();
    const a = await conEnlace(REGLAS_EQUIPO);
    const b = await conEnlace(REGLAS_EQUIPO);
    caducar(a.enlaceId);
    caducar(b.enlaceId);
    await quemarElCubo(app, "PRUEBA_EQUIPO", a.token, "10.3.1.1");
    expect((await get(app, "PRUEBA_EQUIPO", a.token, "10.3.1.1")).statusCode).toBe(429);
    expect((await get(app, "PRUEBA_EQUIPO", b.token, "10.3.1.1")).statusCode).toBe(404);
    await app.close();
  });

  it("el de siempre SÍ va por IP: dos tokens distintos desde una IP sí se estorban", async () => {
    const app = await buildApp();
    const a = await conEnlace(REGLAS_PRUEBA);
    const b = await conEnlace(REGLAS_PRUEBA);
    caducar(a.enlaceId);
    caducar(b.enlaceId);
    await quemarElCubo(app, "PRUEBA", a.token, "10.3.2.1");
    expect((await get(app, "PRUEBA", b.token, "10.3.2.1")).statusCode).toBe(429);
    await app.close();
  });

  it("y el cubo de tokens inexistentes sigue siendo POR IP incluso para el equipo", async () => {
    // Un token que no existe no tiene identidad contra la que contar: por
    // token le daría a un escáner un cubo nuevo por intento.
    const app = await buildApp();
    for (let i = 0; i <= MAX_INEXISTENTES; i++) {
      await get(app, "PRUEBA_EQUIPO", nuevoToken(), "10.3.3.1");
    }
    expect(
      (await get(app, "PRUEBA_EQUIPO", nuevoToken(), "10.3.3.1")).statusCode,
    ).toBe(429);
    await app.close();
  });
});

// ── 7 · el token no se guarda ────────────────────────────────────────

describe("enlaces-publicos · EL TOKEN NO SE GUARDA", () => {
  it("en la fila está su SHA-256, y el token en claro sale una sola vez", async () => {
    const { token, enlaceId } = await conEnlace(REGLAS_PRUEBA);
    const fila = enlaces.find((l) => l.id === enlaceId)!;
    expect(fila.tokenHash).not.toBe(token);
    expect(fila.tokenHash).toBe(huellaDeToken(token));
    expect(fila.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // Y la fila entera no contiene el token por ningún campo.
    expect(JSON.stringify(fila)).not.toContain(token);
  });

  it("y el token son 256 bits en base64url: 43 caracteres", async () => {
    const { token } = await conEnlace(REGLAS_PRUEBA);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("la caducidad la pone el PURPOSE, por canal", async () => {
    const corto = await conEnlace(REGLAS_PRUEBA, { canal: "CORTO" });
    const largo = await conEnlace(REGLAS_PRUEBA);
    const vidaDe = (id: string) =>
      enlaces.find((l) => l.id === id)!.expiresAt.getTime() - Date.now();
    expect(vidaDe(corto.enlaceId)).toBeLessThan(5_000);
    expect(vidaDe(largo.enlaceId)).toBeGreaterThan(30 * 60 * 1000);
  });
});

// ── 8 · un solo enlace vivo ──────────────────────────────────────────

describe("enlaces-publicos · UN SOLO ENLACE VIVO por objetivo", () => {
  it("crear un segundo sin revocar el primero FALLA", async () => {
    const { targetId } = await conEnlace(REGLAS_PRUEBA);
    await expect(
      crearEnlace(fakePrisma as never, REGLAS_PRUEBA, {
        tenantId: TENANT_ID,
        targetId,
        creadoPorUserId: null,
      }),
    ).rejects.toThrow(/public_links_uno_vivo_key/);
  });

  it("revocar y crear SÍ: eso es rotar, y el viejo deja de abrir", async () => {
    const app = await buildApp();
    const viejo = await conEnlace(REGLAS_PRUEBA);
    expect((await get(app, "PRUEBA", viejo.token)).statusCode).toBe(200);

    const revocados = await revocarEnlacesDe(fakePrisma as never, {
      tenantId: TENANT_ID,
      targetType: REGLAS_PRUEBA.targetType,
      targetId: viejo.targetId,
      purpose: REGLAS_PRUEBA.purpose,
    });
    expect(revocados).toBe(1);
    const nuevo = await crearEnlace(fakePrisma as never, REGLAS_PRUEBA, {
      tenantId: TENANT_ID,
      targetId: viejo.targetId,
      creadoPorUserId: null,
    });

    expect((await get(app, "PRUEBA", viejo.token)).statusCode).toBe(404);
    expect((await get(app, "PRUEBA", nuevo.token)).statusCode).toBe(200);
    // Y LA ANULACIÓN QUEDA ESCRITA: dos filas, no una con el hash encima.
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0]!.revokedAt).not.toBeNull();
    await app.close();
  });

  it("un enlace GASTADO no bloquea al siguiente: sale del índice", async () => {
    const gastado = await conEnlace(REGLAS_PRUEBA);
    for (let i = 0; i < REGLAS_PRUEBA.maxUsos; i++) {
      await consumirEnlace(fakePrisma as never, {
        enlaceId: gastado.enlaceId,
        maxUsos: REGLAS_PRUEBA.maxUsos,
      });
    }
    await expect(
      crearEnlace(fakePrisma as never, REGLAS_PRUEBA, {
        tenantId: TENANT_ID,
        targetId: gastado.targetId,
        creadoPorUserId: null,
      }),
    ).resolves.toBeTruthy();
  });

  it("revocar es idempotente: anularlo dos veces no cambia la fecha", async () => {
    const { enlaceId } = await conEnlace(REGLAS_PRUEBA);
    await revocarEnlace(fakePrisma as never, { enlaceId });
    const primera = enlaces.find((l) => l.id === enlaceId)!.revokedAt;
    await revocarEnlace(fakePrisma as never, {
      enlaceId,
      ahora: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(enlaces.find((l) => l.id === enlaceId)!.revokedAt).toBe(primera);
  });
});

// ── 9 · el rastro clínico ────────────────────────────────────────────

describe("enlaces-publicos · EL RASTRO CLÍNICO lo declara el purpose", () => {
  it("un purpose clínico deja línea con el actor «paciente por enlace»", async () => {
    const o: FakeObjetivo = {
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      abierto: true,
    };
    await registrarAccesoDelEnlace(fakePrisma as never, REGLAS_PRUEBA, {
      tenantId: TENANT_ID,
      objetivo: o,
      route: "POST /PRUEBA/:token",
    });
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      action: "WRITE",
      outcome: "ALLOWED",
      route: "POST /PRUEBA/:token",
    });
    expect(users.get(registro[0]!.userId)!.isSystemActor).toBe(true);
  });

  it("y uno que no es clínico NO deja ninguna: no hay historia que tocar", async () => {
    const o: FakeObjetivo = {
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      abierto: true,
    };
    await registrarAccesoDelEnlace(fakePrisma as never, REGLAS_EQUIPO, {
      tenantId: TENANT_ID,
      objetivo: o,
      route: "GET /PRUEBA_EQUIPO/:token",
    });
    expect(registro).toHaveLength(0);
  });

  it("SI LA LÍNEA NO SE PUEDE ESCRIBIR, el error SUBE: quien llama decide", async () => {
    // Trazabilidad por encima de disponibilidad, igual que `conHistoria`.
    // La ruta lo convierte en un 500 sin una palabra del contenido.
    registroRoto = true;
    const o: FakeObjetivo = {
      id: randomUUID(),
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      abierto: true,
    };
    await expect(
      registrarAccesoDelEnlace(fakePrisma as never, REGLAS_PRUEBA, {
        tenantId: TENANT_ID,
        objetivo: o,
        route: "POST /PRUEBA/:token",
      }),
    ).rejects.toThrow();
  });

  it("y un purpose que dice dejar rastro SIN decir de quién no se puede apuntar", async () => {
    // Dejarlo pasar en silencio sería el agujero que la decisión S1.6
    // cierra: un `purpose` clínico nuevo mal declarado NO escribiría línea
    // y nadie se enteraría.
    const roto: ReglasDePurpose<FakeObjetivo> = {
      ...REGLAS_PRUEBA,
      purpose: "PRUEBA_ROTA",
      registraAccesoClinico: true,
      pacienteDe: null,
      accionClinica: null,
    };
    await expect(
      registrarAccesoDelEnlace(fakePrisma as never, roto, {
        tenantId: TENANT_ID,
        objetivo: objetivos.values().next().value ?? ({} as FakeObjetivo),
        route: "x",
      }),
    ).rejects.toThrow(/rastro clínico sin paciente/);
  });

  it("y el purpose VALORACION lo declara: es lo que clinica-2 ya hacía", async () => {
    expect(REGLAS_VALORACION.registraAccesoClinico).toBe(true);
    expect(REGLAS_VALORACION.accionClinica).toBe("WRITE");
    expect(REGLAS_VALORACION.perfil).toBe("SOLO_ESCRIBIR");
    expect(REGLAS_VALORACION.maxUsos).toBe(1);
    expect(REGLAS_VALORACION.limitePor).toBe("IP");
  });
});
