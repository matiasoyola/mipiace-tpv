// A3-distribucion · Frentes 3 y 4 · descarga de la APK por codigo de 6 digitos.
//
// Cubre lo que el bloque pide explicitamente: caducidad, agotamiento, codigo
// inexistente, limite por IP, cabeceras del binario y que latest.json no lleve
// URL. Mas lo que hace peligroso a este endpoint: es PUBLICO y sirve ficheros.
//
// Fake Prisma con Map + fake Redis que cuenta de verdad (mismo patron que
// pairing-route.test.ts y super-admin-2fa-throttle.test.ts). El directorio de
// releases es real, en un tmpdir: el modulo lee ficheros y quiero que los lea.

import {
  createReadStream,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";

const RELEASES_DIR = mkdtempSync(join(tmpdir(), "mipiacetpv-releases-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.RELEASES_DIR = RELEASES_DIR;

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const SA_ID = randomUUID();
const APK_BYTES = Buffer.from("PK apk de mentira pero con bytes");
const APK_SHA = createHash("sha256").update(APK_BYTES).digest("hex");
const APK_NAME = "mipiacetpv-1.10.2-11002.apk";

function publicarRelease(): void {
  writeFileSync(join(RELEASES_DIR, APK_NAME), APK_BYTES);
  writeFileSync(
    join(RELEASES_DIR, "releases.json"),
    JSON.stringify([
      {
        versionCode: 11002,
        versionName: "1.10.2",
        fileName: APK_NAME,
        sha256: APK_SHA,
        size: APK_BYTES.length,
        publishedAt: "2026-08-27T10:00:00.000Z",
        gitSha: "7774c51",
      },
      {
        versionCode: 11001,
        versionName: "1.10.1",
        fileName: "mipiacetpv-1.10.1-11001.apk",
        sha256: "f".repeat(64),
        size: 123,
        publishedAt: "2026-08-01T10:00:00.000Z",
        gitSha: "aaaaaaa",
      },
    ]),
  );
}

// --- Fake Prisma -----------------------------------------------------------

interface FakeCode {
  id: string;
  code: string;
  versionCode: number;
  createdBySuperAdminId: string;
  createdAt: Date;
  expiresAt: Date;
  maxDownloads: number;
  downloadCount: number;
  lastDownloadIp: string | null;
  lastDownloadAt: Date | null;
  note: string | null;
}

const codes = new Map<string, FakeCode>();
const audits: { superAdminId: string; action: string; tenantId: unknown; metadata: any }[] = [];
let auditExplota = false;

const fakePrisma = {
  superAdminUser: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.id === SA_ID
        ? { id: SA_ID, tokenVersion: 0, deletedAt: null, isRoot: true }
        : null,
    ),
  },
  apkDownloadCode: {
    findUnique: vi.fn(async ({ where }: any) => codes.get(where.code) ?? null),
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeCode[] = [];
      for (const c of codes.values()) {
        if (where?.expiresAt?.gt && c.expiresAt <= where.expiresAt.gt) continue;
        out.push(c);
      }
      return out;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: FakeCode = {
        id: randomUUID(),
        code: data.code,
        versionCode: data.versionCode,
        createdBySuperAdminId: data.createdBySuperAdminId,
        createdAt: new Date(),
        expiresAt: data.expiresAt,
        maxDownloads: data.maxDownloads ?? 3,
        downloadCount: 0,
        lastDownloadIp: null,
        lastDownloadAt: null,
        note: data.note ?? null,
      };
      codes.set(row.code, row);
      return row;
    }),
    delete: vi.fn(async ({ where }: any) => {
      for (const c of codes.values()) {
        if (c.id === where.id) {
          codes.delete(c.code);
          return c;
        }
      }
      throw new Error("not found");
    }),
    // Claim atomico: las condiciones se evaluan aqui, como en el UPDATE real.
    updateMany: vi.fn(async ({ where, data }: any) => {
      const c = codes.get(where.code);
      if (!c) return { count: 0 };
      if (where.expiresAt?.gt && c.expiresAt <= where.expiresAt.gt) {
        return { count: 0 };
      }
      if (
        where.downloadCount?.lt !== undefined &&
        c.downloadCount >= where.downloadCount.lt
      ) {
        return { count: 0 };
      }
      if (data.downloadCount?.increment) {
        c.downloadCount += data.downloadCount.increment;
      }
      if (data.lastDownloadIp !== undefined) c.lastDownloadIp = data.lastDownloadIp;
      if (data.lastDownloadAt !== undefined) c.lastDownloadAt = data.lastDownloadAt;
      return { count: 1 };
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      if (auditExplota) throw new Error("BD de auditoria caida");
      audits.push(data);
      return data;
    }),
  },
} as const;

// --- Fake Redis ------------------------------------------------------------

const store = new Map<string, { value: string; expiresAt: number | null }>();
function alive(k: string) {
  const e = store.get(k);
  if (!e) return null;
  if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
    store.delete(k);
    return null;
  }
  return e;
}
const fakeRedis = {
  incr: vi.fn(async (k: string) => {
    const e = alive(k);
    const v = e ? Number(e.value) + 1 : 1;
    store.set(k, { value: String(v), expiresAt: e?.expiresAt ?? null });
    return v;
  }),
  get: vi.fn(async (k: string) => alive(k)?.value ?? null),
  set: vi.fn(async (k: string, v: string, _ex: string, s: number) => {
    store.set(k, { value: v, expiresAt: Date.now() + s * 1000 });
    return "OK";
  }),
  expire: vi.fn(async (k: string, s: number) => {
    const e = alive(k);
    if (!e) return 0;
    e.expiresAt = Date.now() + s * 1000;
    return 1;
  }),
  ttl: vi.fn(async (k: string) => {
    const e = alive(k);
    if (!e) return -2;
    return e.expiresAt === null ? -1 : Math.ceil((e.expiresAt - Date.now()) / 1000);
  }),
  decr: vi.fn(async (k: string) => {
    // Semantica del DECR real: si la clave no existe la crea a -1 y SIN TTL.
    // Se imita a proposito, que es justo la trampa que forgiveFailure evita.
    const e = alive(k);
    const v = e ? Number(e.value) - 1 : -1;
    store.set(k, { value: String(v), expiresAt: e?.expiresAt ?? null });
    return v;
  }),
  del: vi.fn(async (...ks: string[]) => {
    let n = 0;
    for (const k of ks) if (store.delete(k)) n++;
    return n;
  }),
};

// `createReadStream` espiado y por lo demas REAL: es la unica forma de ver
// desde fuera si el endpoint llego a abrir un descriptor. Todo lo demas de
// node:fs se deja tal cual (el propio test escribe ficheros de verdad).
vi.mock("node:fs", async () => {
  const real = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...real, createReadStream: vi.fn(real.createReadStream) };
});

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerReleasesRoutes } = await import("../src/releases/routes.js");
const { registerFormBodyParser } = await import("../src/lib/form-body.js");
const { signSuperAdminAccessToken } = await import("../src/superadmin/tokens.js");

function saBearer(): string {
  return `Bearer ${signSuperAdminAccessToken({ sub: SA_ID, tv: 0 } as never)}`;
}

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  registerFormBodyParser(app);
  await registerReleasesRoutes(app);
  await app.ready();
  return app;
}

function form(codigo: string) {
  return {
    method: "POST" as const,
    url: "/apk",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: `codigo=${encodeURIComponent(codigo)}`,
  };
}

/** Emite un codigo vivo directamente en el fake, sin pasar por la API. */
function sembrarCodigo(over: Partial<FakeCode> = {}): FakeCode {
  const row: FakeCode = {
    id: randomUUID(),
    code: "123456",
    versionCode: 11002,
    createdBySuperAdminId: SA_ID,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60_000),
    maxDownloads: 3,
    downloadCount: 0,
    lastDownloadIp: null,
    lastDownloadAt: null,
    note: null,
    ...over,
  };
  codes.set(row.code, row);
  return row;
}

beforeEach(() => {
  codes.clear();
  audits.length = 0;
  store.clear();
  auditExplota = false;
  vi.clearAllMocks();
  rmSync(RELEASES_DIR, { recursive: true, force: true });
  mkdirSync(RELEASES_DIR, { recursive: true });
  publicarRelease();
});

afterAll(() => rmSync(RELEASES_DIR, { recursive: true, force: true }));

describe("POST /apk con codigo valido", () => {
  it("sirve el binario con las cabeceras que Android necesita", async () => {
    sembrarCodigo();
    const app = await build();
    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(
      "application/vnd.android.package-archive",
    );
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="${APK_NAME}"`,
    );
    // Content-Length real: es lo que Android usa para la barra de progreso.
    expect(res.headers["content-length"]).toBe(String(APK_BYTES.length));
    expect(res.headers["cache-control"]).toBe("no-store");
    // Sin compresion: un APK ya es un zip y comprimirlo rompe el Content-Length.
    expect(res.headers["content-encoding"]).toBe("identity");
    expect(res.rawPayload.equals(APK_BYTES)).toBe(true);
    await app.close();
  });

  it("el binario servido coincide con el SHA-256 que publica la pagina", async () => {
    sembrarCodigo();
    const app = await build();
    const res = await app.inject(form("123456"));
    expect(createHash("sha256").update(res.rawPayload).digest("hex")).toBe(APK_SHA);
    await app.close();
  });

  it("gasta UNA descarga y la audita al super-admin que emitio el codigo", async () => {
    const row = sembrarCodigo();
    const app = await build();
    await app.inject(form("123456"));
    expect(codes.get(row.code)!.downloadCount).toBe(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.superAdminId).toBe(SA_ID);
    expect(audits[0]!.action).toBe("apk_download");
    expect(audits[0]!.tenantId).toBeNull();
    expect(audits[0]!.metadata).toMatchObject({
      versionCode: 11002,
      code: "123456",
      result: "ok",
    });
    await app.close();
  });

  it("admite 3 descargas y la cuarta dice agotado", async () => {
    sembrarCodigo();
    const app = await build();
    for (let i = 0; i < 3; i++) {
      expect((await app.inject(form("123456"))).statusCode).toBe(200);
    }
    const cuarta = await app.inject(form("123456"));
    expect(cuarta.statusCode).toBe(400);
    expect(cuarta.body).toContain("ya se ha usado las veces permitidas");
    await app.close();
  });
});

describe("POST /apk con codigo que no sirve", () => {
  it("caducado da mensaje de caducado, sin binario", async () => {
    sembrarCodigo({ expiresAt: new Date(Date.now() - 1000) });
    const app = await build();
    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("ha caducado");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(audits[0]!.metadata.result).toBe("caducado");
    await app.close();
  });

  it("agotado se audita como agotado", async () => {
    sembrarCodigo({ downloadCount: 3, maxDownloads: 3 });
    const app = await build();
    await app.inject(form("123456"));
    expect(audits[0]!.metadata.result).toBe("agotado");
    await app.close();
  });

  it("inexistente NO se audita: no hay a quien atribuirlo", async () => {
    const app = await build();
    const res = await app.inject(form("999999"));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Código incorrecto");
    expect(audits).toHaveLength(0);
    await app.close();
  });

  it("formato imposible cuenta como intento igual", async () => {
    const app = await build();
    await app.inject(form("abc"));
    expect(await fakeRedis.get("apk-download-attempts:127.0.0.1")).toBe("1");
    await app.close();
  });
});

describe("POST /apk y fuerza bruta", () => {
  it("el decimo fallo bloquea la IP y el siguiente ya no consulta la BD", async () => {
    const app = await build();
    // Nueve intentos gastados, aun se puede probar.
    for (let i = 0; i < 9; i++) {
      const r = await app.inject(form("999999"));
      expect(r.statusCode).toBe(400);
    }
    // El decimo cruza el umbral y echa el candado (misma semantica que el
    // login, que bloquea en el quinto).
    expect((await app.inject(form("999999"))).statusCode).toBe(429);
    fakePrisma.apkDownloadCode.findUnique.mockClear();
    const bloqueado = await app.inject(form("999999"));
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.body).toContain("Demasiados intentos");
    // Bloqueado de verdad: ni siquiera se mira si el codigo existe.
    expect(fakePrisma.apkDownloadCode.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it("bloqueada, la pagina NO ofrece formulario", async () => {
    const app = await build();
    for (let i = 0; i < 11; i++) await app.inject(form("999999"));
    const res = await app.inject(form("999999"));
    expect(res.body).not.toContain("<form");
    await app.close();
  });

  it("un acierto perdona UN intento, no regala la ventana entera", async () => {
    // Un reset por acierto se lo regala precisamente a quien tiene un codigo
    // bueno: 9 fallos + 1 acierto, contador a cero, y otra vez, tantas veces
    // como usos le queden al codigo. Perdonar uno cubre el caso real (el
    // instalador teclea mal antes de acertar) sin reabrir la ventana.
    const CLAVE = "apk-download-attempts:127.0.0.1";
    sembrarCodigo();
    const app = await build();

    // Acierto sin fallos previos: no deja la clave en negativo ni sin TTL.
    expect((await app.inject(form("123456"))).statusCode).toBe(200);
    expect(await fakeRedis.get(CLAVE)).toBeNull();

    for (let i = 0; i < 5; i++) await app.inject(form("999999"));
    expect(await fakeRedis.get(CLAVE)).toBe("5");
    expect((await app.inject(form("123456"))).statusCode).toBe(200);
    expect(await fakeRedis.get(CLAVE)).toBe("4");

    // Y el candado sigue cayendo dentro de los 10 intentos de la ventana.
    for (let i = 0; i < 5; i++) await app.inject(form("999999"));
    expect(await fakeRedis.get(CLAVE)).toBe("9");
    expect((await app.inject(form("999999"))).statusCode).toBe(429);
    await app.close();
  });

  it("acertar no abre el candado de una IP ya bloqueada", async () => {
    sembrarCodigo();
    const app = await build();
    for (let i = 0; i < 10; i++) await app.inject(form("999999"));
    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(429);
    expect(await fakeRedis.ttl("apk-download-locked:127.0.0.1")).toBeGreaterThan(0);
    await app.close();
  });
});

describe("el binario se resuelve antes de gastar la descarga", () => {
  it("si la version no esta en disco NO se quema una de las 3 descargas", async () => {
    // El indice la lista pero el fichero no esta (publicacion a medias, un
    // borrado en el VPS). Eso es problema nuestro: si el claim fuera primero,
    // el 404 se llevaria uno de los 3 usos y el instalador se quedaria con
    // dos intentos y sin APK.
    rmSync(join(RELEASES_DIR, APK_NAME));
    const row = sembrarCodigo();
    const app = await build();

    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("ya no está publicada");
    expect(codes.get(row.code)!.downloadCount).toBe(0);
    // Nada que auditar: no ha habido descarga que registrar.
    expect(audits).toHaveLength(0);

    // Y cuando el fichero vuelve, el MISMO codigo sigue teniendo sus 3 usos.
    publicarRelease();
    const segunda = await app.inject(form("123456"));
    expect(segunda.statusCode).toBe(200);
    expect(segunda.rawPayload.equals(APK_BYTES)).toBe(true);
    expect(codes.get(row.code)!.downloadCount).toBe(1);
    await app.close();
  });

  it("un codigo apuntando a una version que no esta en el indice tampoco la gasta", async () => {
    const row = sembrarCodigo({ versionCode: 40404 });
    const app = await build();
    expect((await app.inject(form("123456"))).statusCode).toBe(404);
    expect(codes.get(row.code)!.downloadCount).toBe(0);
    await app.close();
  });

  it("si el claim revienta no se fuga ningun descriptor", async () => {
    // Comprobar el binario antes del claim NO puede significar abrirlo antes
    // del claim. Un descriptor abierto ahi sobrevive al claim y a la
    // auditoria, y la salida que no se ve venir —esta: una excepcion de
    // Prisma— se salta cualquier cierre a mano y lo fuga. En un endpoint
    // publico eso es un goteo de fds en el proceso que ademas esta cobrando.
    sembrarCodigo();
    fakePrisma.apkDownloadCode.updateMany.mockRejectedValueOnce(
      new Error("Prisma: la conexion se cayo a mitad del UPDATE"),
    );
    const app = await build();

    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(500);
    expect(createReadStream).not.toHaveBeenCalled();

    // Y el espia no esta muerto: por el camino bueno SI se abre, una vez.
    const buena = await app.inject(form("123456"));
    expect(buena.statusCode).toBe(200);
    expect(createReadStream).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe("una auditoria que falla no tumba la descarga", () => {
  it("si writeAudit explota, el binario se sirve igual", async () => {
    sembrarCodigo();
    auditExplota = true;
    const app = await build();
    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(APK_BYTES)).toBe(true);
    await app.close();
  });

  it("la metadata de auditoria valida contra su esquema zod", async () => {
    // El motivo por el que un fallo de auditoria es un bug y no runtime: la
    // metadata es determinista. Si esto se rompe, se rompe siempre.
    sembrarCodigo();
    const app = await build();
    await app.inject(form("123456"));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({
      versionCode: 11002,
      code: "123456",
      result: "ok",
      ipAddress: expect.any(String),
    });
    await app.close();
  });
});

describe("GET /apk, la pagina del terminal roto", () => {
  it("no lleva ni un byte de JavaScript", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/apk" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("<script");
    expect(res.body).not.toContain("onclick");
    await app.close();
  });

  it("no usa nada que el Chrome 81 no entienda", async () => {
    const app = await build();
    const { body } = await app.inject({ method: "GET", url: "/apk" });
    // `gap` en flexbox llego en Chrome 84: es EL fallo que motiva el bloque.
    expect(body).not.toMatch(/[^-a-z]gap\s*:/);
    expect(body).not.toContain("display: grid");
    expect(body).not.toContain("display:grid");
    expect(body).not.toContain("var(--");
    expect(body).not.toContain(":is(");
    await app.close();
  });

  it("ensena version, fecha, tamano y SHA-256 para cotejar antes de instalar", async () => {
    const app = await build();
    const { body } = await app.inject({ method: "GET", url: "/apk" });
    expect(body).toContain("1.10.2");
    expect(body).toContain(APK_SHA);
    expect(body).toContain("27/08/2026");
    await app.close();
  });

  it("el input es numerico y de 6 digitos", async () => {
    const app = await build();
    const { body } = await app.inject({ method: "GET", url: "/apk" });
    expect(body).toContain('inputmode="numeric"');
    expect(body).toContain('maxlength="6"');
    await app.close();
  });
});

describe("GET /apk/latest.json", () => {
  it("da metadatos de la MAS NUEVA y ninguna URL del binario", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/apk/latest.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      versionCode: 11002,
      versionName: "1.10.2",
      sha256: APK_SHA,
      size: APK_BYTES.length,
      publishedAt: "2026-08-27T10:00:00.000Z",
    });
    // Decision 4 del bloque: saber que existe la 1.10.2 no es secreto; donde
    // esta el binario, si.
    expect(res.body).not.toContain(APK_NAME);
    expect(res.body.toLowerCase()).not.toContain("url");
    expect(res.body.toLowerCase()).not.toContain("filename");
    await app.close();
  });

  it("no delata el commit de produccion: el gitSha se queda en super-admin", async () => {
    // El endpoint es publico y sin sesion. El commit del que salio el build
    // dice que hay desplegado ahi dentro y contra que arbol mirar: es
    // informacion de casa. La consola, que si pide sesion, lo sigue viendo.
    const app = await build();
    const publico = await app.inject({ method: "GET", url: "/apk/latest.json" });
    expect(publico.json()).not.toHaveProperty("gitSha");
    expect(publico.body).not.toContain("7774c51");

    const consola = await app.inject({
      method: "GET",
      url: "/super-admin/releases",
      headers: { authorization: saBearer() },
    });
    expect(consola.json().releases[0].gitSha).toBe("7774c51");
    await app.close();
  });

  it("la pagina publica tampoco pinta el gitSha por ningun lado", async () => {
    const app = await build();
    const { body } = await app.inject({ method: "GET", url: "/apk" });
    expect(body).not.toContain("7774c51");
    await app.close();
  });
});

describe("nadie sin sesion enumera ni descarga", () => {
  it("GET /super-admin/releases sin token da 401", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/super-admin/releases" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain(APK_NAME);
    await app.close();
  });

  it("la descarga directa sin token da 401, sin binario", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/releases/11002/apk",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("emitir codigos sin token da 401 y no se crea nada", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/releases/11002/download-codes",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(codes.size).toBe(0);
    await app.close();
  });
});

describe("super-admin", () => {
  it("lista versiones con su gitSha", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/releases",
      headers: { authorization: saBearer() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.releases).toHaveLength(2);
    expect(body.releases[0]).toMatchObject({
      versionCode: 11002,
      gitSha: "7774c51",
    });
    await app.close();
  });

  it("emite un codigo de 6 digitos con caducidad y nota, y lo audita", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/releases/11002/download-codes",
      headers: { authorization: saBearer() },
      payload: { note: "Thalia, terminal barra" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.maxDownloads).toBe(3);
    const minutos = (new Date(body.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(58);
    expect(minutos).toBeLessThanOrEqual(60);
    expect(audits[0]!.action).toBe("create_apk_download_code");
    expect(audits[0]!.metadata.note).toBe("Thalia, terminal barra");
    await app.close();
  });

  it("pedir codigo para una version no publicada da 404", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/releases/99999/download-codes",
      headers: { authorization: saBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(codes.size).toBe(0);
    await app.close();
  });

  it("descarga directa desde la consola", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/releases/11002/apk",
      headers: { authorization: saBearer() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(APK_BYTES)).toBe(true);
    await app.close();
  });
});

describe("manda el indice, no el directorio", () => {
  it("un .apk suelto sin entrada en releases.json NO se sirve", async () => {
    writeFileSync(join(RELEASES_DIR, "colado.apk"), Buffer.from("no deberia salir"));
    sembrarCodigo({ versionCode: 40404 });
    const app = await build();
    const res = await app.inject(form("123456"));
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("colado");
    await app.close();
  });

  it("un fileName con ../ NO saca ficheros de RELEASES_DIR", async () => {
    // El indice lo escribe nuestro script, pero es un fichero editable a mano
    // en el VPS. Si `fileName` pudiera salir del directorio, este endpoint
    // publico se convertiria en una lectura arbitraria del sistema de
    // ficheros: /apk con el codigo correcto devolveria /etc/passwd.
    const secreto = join(RELEASES_DIR, "..", "secreto-fuera.txt");
    writeFileSync(secreto, Buffer.from("ESTO NO DEBE SALIR NUNCA"));
    writeFileSync(
      join(RELEASES_DIR, "releases.json"),
      JSON.stringify([
        {
          versionCode: 11002,
          versionName: "1.10.2",
          fileName: "../secreto-fuera.txt",
          sha256: "0".repeat(64),
          size: 24,
          publishedAt: "2026-08-27T10:00:00.000Z",
          gitSha: "7774c51",
        },
      ]),
    );
    sembrarCodigo();
    const app = await build();
    const res = await app.inject(form("123456"));
    expect(res.body).not.toContain("ESTO NO DEBE SALIR NUNCA");
    rmSync(secreto, { force: true });
    await app.close();
  });

  it("la descarga directa del super-admin tampoco escapa del directorio", async () => {
    const secreto = join(RELEASES_DIR, "..", "secreto-consola.txt");
    writeFileSync(secreto, Buffer.from("TAMPOCO POR AQUI"));
    writeFileSync(
      join(RELEASES_DIR, "releases.json"),
      JSON.stringify([
        {
          versionCode: 11002,
          versionName: "1.10.2",
          fileName: "../secreto-consola.txt",
          sha256: "0".repeat(64),
          size: 16,
          publishedAt: "2026-08-27T10:00:00.000Z",
          gitSha: "7774c51",
        },
      ]),
    );
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/super-admin/releases/11002/apk",
      headers: { authorization: saBearer() },
    });
    expect(res.body).not.toContain("TAMPOCO POR AQUI");
    rmSync(secreto, { force: true });
    await app.close();
  });

  it("un fileName con comillas y CRLF no llega a Content-Disposition", async () => {
    // basename() cierra el traversal, pero el nombre entra CRUDO en la
    // cabecera. Una comilla cierra el filename y un CR/LF parte la cabecera:
    // Node rechaza el valor (ERR_INVALID_CHAR) y la descarga se convierte en
    // un 500 delante del instalador. El fichero existe de verdad en disco
    // para que el unico filtro que puede parar esto sea el del indice.
    const venenoso = 'evil.apk"\r\nX-Colada: si';
    writeFileSync(join(RELEASES_DIR, venenoso), APK_BYTES);
    writeFileSync(
      join(RELEASES_DIR, "releases.json"),
      JSON.stringify([
        {
          versionCode: 11002,
          versionName: "1.10.2",
          fileName: venenoso,
          sha256: APK_SHA,
          size: APK_BYTES.length,
          publishedAt: "2026-08-27T10:00:00.000Z",
          gitSha: "7774c51",
        },
      ]),
    );
    const row = sembrarCodigo();
    const app = await build();
    const res = await app.inject(form("123456"));

    expect(res.statusCode).toBe(404);
    expect(res.headers["x-colada"]).toBeUndefined();
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(res.rawPayload.equals(APK_BYTES)).toBe(false);
    // La entrada no existe para la API, asi que tampoco quema una descarga.
    expect(codes.get(row.code)!.downloadCount).toBe(0);
    await app.close();
  });

  it("sin releases.json la pagina sigue en pie y no revienta", async () => {
    rmSync(join(RELEASES_DIR, "releases.json"));
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/apk" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<form");
    await app.close();
  });
});
