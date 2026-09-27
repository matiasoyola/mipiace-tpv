// declaracion-responsable · los endpoints públicos del art. 15.
//
// Lo que este banco fija:
//
//   1. Responden 200 SIN token. Es lo que hace que el documento se pueda
//      entregar: la URL es la entrega.
//   2. No hay nada de ningún tenant en la respuesta. Ni un nombre, ni un id.
//   3. La versión es la de `getAppVersion()` y la fecha la de
//      `getAppVersionDate()`: si cambia la env, cambia el documento.
//   4. La versión de la APK sale del índice de releases, y si no hay índice
//      el documento sale igual (sin ella).
//   5. El OWNER de una cuenta BLOQUEADA también puede leerla: el guard de
//      tenants bloqueados deja pasar /legal.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · poner un `requireOwner` (o cualquier auth) en las rutas
//   · colar un dato de tenant en la respuesta
//   · leer la versión de una constante en vez de de la env horneada
//   · quitar "/legal" de los prefijos exentos del guard de tenants
//   · que un `releases.json` ausente tumbe el endpoint

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELEASES_DIR = mkdtempSync(join(tmpdir(), "mipiacetpv-legal-releases-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.RELEASES_DIR = RELEASES_DIR;
process.env.SUPER_ADMIN_REPLY_TO_EMAIL = "soporte@mipiacetpv.com";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Ninguna de las dos rutas toca la base de datos —es su rasgo de diseño, no
// una casualidad— así que el fake por defecto EXPLOTA si alguien lo llama:
// el día que estas rutas empiecen a consultar la BD, este fichero se pone
// rojo y hay que justificar por qué un documento público del productor
// necesita una query.
//
// `guardActivo` lo cambia al fake del guard de tenants bloqueados, que SÍ
// consulta (es su trabajo), para el último describe.
const prismaProhibido = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "la declaración responsable no debe tocar la base de datos",
      );
    },
  },
);

const TENANT_BLOQUEADO = randomUUID();
const prismaConTenantBloqueado = {
  tenant: {
    findUnique: async ({ where }: any) =>
      where.id === TENANT_BLOQUEADO
        ? { blockedAt: new Date("2026-09-01T00:00:00Z"), blockedReason: "impago" }
        : null,
  },
};

let guardActivo = false;

vi.mock("../src/context.js", () => ({
  getPrisma: () => (guardActivo ? prismaConTenantBloqueado : prismaProhibido),
  getRedis: () => {
    throw new Error("la declaración responsable no debe tocar Redis");
  },
}));

const { registerLegalRoutes } = await import("../src/legal/routes.js");
const { registerTenantBlockGuard } = await import(
  "../src/superadmin/tenant-block-guard.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

function publicarRelease(): void {
  writeFileSync(
    join(RELEASES_DIR, "releases.json"),
    JSON.stringify([
      {
        versionCode: 11900,
        versionName: "1.19.0",
        fileName: "mipiacetpv-1.19.0-11900.apk",
        sha256: "a".repeat(64),
        size: 1234,
        publishedAt: "2026-09-27T10:00:00.000Z",
        gitSha: "2310f6e",
      },
    ]),
  );
}

function borrarIndice(): void {
  rmSync(join(RELEASES_DIR, "releases.json"), { force: true });
}

async function build(): Promise<FastifyInstance> {
  const app = Fastify();
  await registerLegalRoutes(app);
  await app.ready();
  return app;
}

/** Todo el texto de la declaración JSON, para buscar por contenido. */
function textoDe(body: any): string {
  const apartados = [...body.declaracion.apartados, ...body.declaracion.anexo];
  return [
    body.declaracion.titulo,
    ...apartados.flatMap((a: any) => [a.clave, a.rotulo, ...a.valor]),
  ].join("\n");
}

const envPrevia = {
  APP_VERSION: process.env.APP_VERSION,
  APP_VERSION_DATE: process.env.APP_VERSION_DATE,
};

afterEach(() => {
  if (envPrevia.APP_VERSION === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = envPrevia.APP_VERSION;
  if (envPrevia.APP_VERSION_DATE === undefined) {
    delete process.env.APP_VERSION_DATE;
  } else process.env.APP_VERSION_DATE = envPrevia.APP_VERSION_DATE;
});

afterAll(() => {
  rmSync(RELEASES_DIR, { recursive: true, force: true });
});

describe("GET /legal/declaracion-responsable", () => {
  it("responde 200 sin token", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("lleva los doce apartados y el anexo, en orden", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    const body = res.json();
    expect(body.declaracion.apartados.map((a: any) => a.clave)).toEqual([
      "1.a)",
      "1.b)",
      "1.c)",
      "1.d)",
      "1.e)",
      "1.f)",
      "1.g)",
      "1.h)",
      "1.i)",
      "1.j)",
      "1.k)",
      "1.l)",
    ]);
    expect(body.declaracion.anexo.map((a: any) => a.clave)).toEqual([
      "2.a)",
      "2.b)",
    ]);
    await app.close();
  });

  it("lleva los datos del productor y ni uno de ningún tenant", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    const texto = textoDe(res.json());
    expect(texto).toContain("MI PIACE INTERNET SOLUTIONS SL");
    expect(texto).toContain("B45902186");
    // Nada que huela a tenant. El fake de Prisma que explota cubre el
    // camino; esto cubre el resultado.
    for (const prohibido of [
      "tenantId",
      "tenant",
      "storeId",
      "cashier",
      "holded",
      "Bearer",
    ]) {
      expect(
        texto.toLowerCase(),
        `la declaración menciona «${prohibido}»`,
      ).not.toContain(prohibido.toLowerCase());
    }
    await app.close();
  });

  it("un Bearer cualquiera no cambia la respuesta ni la rompe", async () => {
    const app = await build();
    const sin = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    const con = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
      headers: { authorization: `Bearer ${randomUUID()}` },
    });
    expect(con.statusCode).toBe(200);
    expect(con.json()).toEqual(sin.json());
    await app.close();
  });

  it("la versión y la fecha son las horneadas en la imagen", async () => {
    process.env.APP_VERSION = "c0ffee1";
    process.env.APP_VERSION_DATE = "2026-09-27";
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    const texto = textoDe(res.json());
    expect(texto).toContain("c0ffee1 (servidor)");
    expect(texto).toContain("27 de septiembre de 2026");
    await app.close();
  });

  it("otra versión horneada → otra declaración", async () => {
    process.env.APP_VERSION = "deadbee";
    process.env.APP_VERSION_DATE = "2026-01-15";
    const app = await build();
    const texto = textoDe(
      (
        await app.inject({
          method: "GET",
          url: "/legal/declaracion-responsable",
        })
      ).json(),
    );
    expect(texto).toContain("deadbee (servidor)");
    expect(texto).toContain("15 de enero de 2026");
    expect(texto).not.toContain("c0ffee1");
    await app.close();
  });

  it("sin APP_VERSION_DATE dice que no hay fecha, no pone la de hoy", async () => {
    delete process.env.APP_VERSION_DATE;
    const app = await build();
    const texto = textoDe(
      (
        await app.inject({
          method: "GET",
          url: "/legal/declaracion-responsable",
        })
      ).json(),
    );
    expect(texto).toContain("no disponible en esta build");
    const anioActual = String(new Date().getFullYear());
    expect(texto).not.toContain(`de ${anioActual}`);
    await app.close();
  });

  it("la versión de la APK sale del índice de releases", async () => {
    publicarRelease();
    const app = await build();
    const texto = textoDe(
      (
        await app.inject({
          method: "GET",
          url: "/legal/declaracion-responsable",
        })
      ).json(),
    );
    expect(texto).toContain("1.19.0 (11900) (app Android)");
    await app.close();
  });

  it("sin índice de releases el documento sale igual, sin la APK", async () => {
    borrarIndice();
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    expect(res.statusCode).toBe(200);
    expect(textoDe(res.json())).not.toContain("app Android");
    await app.close();
  });

  it("se puede cachear en público: no hay nada privado que cachear", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable",
    });
    expect(res.headers["cache-control"]).toContain("public");
    await app.close();
  });
});

describe("GET /legal/declaracion-responsable.pdf", () => {
  it("responde 200 sin token, con un PDF", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable.pdf",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await app.close();
  });

  it("se abre en el visor, no se descarga a ciegas", async () => {
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable.pdf",
    });
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.headers["content-disposition"]).toContain(
      "declaracion-responsable-mipiacetpv.pdf",
    );
    await app.close();
  });

  it("sin índice de releases el PDF también sale", async () => {
    borrarIndice();
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: "/legal/declaracion-responsable.pdf",
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe("el guard de tenants bloqueados", () => {
  // Una cuenta bloqueada es un asunto comercial. Esconderle al OWNER un
  // documento que la Orden obliga a entregar a cualquiera sería usar el
  // bloqueo para incumplir el art. 15. Se prueba con el guard montado de
  // verdad y un token de un tenant realmente bloqueado, no comprobando que
  // "/legal" esté en una lista: lo que importa es el 200.
  async function buildConGuard(): Promise<FastifyInstance> {
    const app = Fastify();
    registerTenantBlockGuard(app);
    await registerLegalRoutes(app);
    // Ruta de control: cualquier otra cosa SÍ recibe el 423. Si esto
    // devolviera 200, el test de arriba no probaría nada.
    app.get("/admin/lo-que-sea", async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  function tokenDeTenantBloqueado(): string {
    return signAccessToken({
      sub: randomUUID(),
      tid: TENANT_BLOQUEADO,
      role: "OWNER",
    } as any);
  }

  it("el OWNER de una cuenta bloqueada sí puede leer su declaración", async () => {
    guardActivo = true;
    try {
      const app = await buildConGuard();
      const headers = { authorization: `Bearer ${tokenDeTenantBloqueado()}` };

      // El control: el resto de la API le responde 423.
      const control = await app.inject({
        method: "GET",
        url: "/admin/lo-que-sea",
        headers,
      });
      expect(control.statusCode).toBe(423);

      const json = await app.inject({
        method: "GET",
        url: "/legal/declaracion-responsable",
        headers,
      });
      expect(json.statusCode).toBe(200);

      const pdf = await app.inject({
        method: "GET",
        url: "/legal/declaracion-responsable.pdf",
        headers,
      });
      expect(pdf.statusCode).toBe(200);
      await app.close();
    } finally {
      guardActivo = false;
    }
  });
});
