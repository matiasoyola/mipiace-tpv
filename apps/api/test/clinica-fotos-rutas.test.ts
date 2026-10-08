// clinica-4 · las fotos en la API.
//
// Las garantías de este fichero:
//
//   1. **Sin consentimiento de fotos NO se guarda ninguna** (decisión 10),
//      y la negativa trae el camino para arreglarlo.
//   2. **La zona se elige antes de disparar**: sin zona o con una que no
//      es del mapa, no entra.
//   3. **Una foto no sale sin `conHistoria` ni sin línea en el registro**,
//      ni la de leer la lista, ni la del binario.
//   4. **La foto RETIRADA sigue en la historia**: sale de la rejilla
//      marcada y deja de salir en el comparador.
//   5. **La huella cuadra con el fichero del disco.**
//   6. El comparador es la más antigua y la última, decidido en el
//      servidor.

import { mkdtempSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
const DIRECTORIO = mkdtempSync(join(tmpdir(), "clinica4-fotos-"));
process.env.CLINICAL_FILES_DIR = DIRECTORIO;

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearMundo,
  sembrarValoracion,
  CITA_ID,
  JPEG_BASE64,
  PACIENTE_ID,
  RECEPCION_ID,
  SANITARIA_ID,
  TENANT_ID,
} from "./support/fake-clinica-4.js";

const mundo = crearMundo();

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => mundo.prisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

const { registerFotosRoutes } = await import("../src/clinica/fotos-routes.js");
const { comparadorPorZona } = await import("../src/clinica/fotos.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

function tokenDe(userId: string, role: "OWNER" | "CLINICIAN" | "CASHIER") {
  return signAccessToken({ sub: userId, tid: TENANT_ID, role });
}
const comoSanitaria = {
  authorization: `Bearer ${tokenDe(SANITARIA_ID, "CLINICIAN")}`,
};
const comoRecepcion = {
  authorization: `Bearer ${tokenDe(RECEPCION_ID, "CASHIER")}`,
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerFotosRoutes(app);
  await app.ready();
  return app;
}

/** El consentimiento de fotos, firmado. */
function conConsentimientoDeFotos() {
  mundo.consents.push({
    id: "c-fotos",
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    kind: "TREATMENT",
    grantedAt: new Date("2026-09-01T10:00:00.000Z"),
    docRef: "x.pdf",
    templateId: "fotos-clinicas",
    templateVersion: 1,
    textSha256: "a".repeat(64),
    pdfSha256: "b".repeat(64),
    pdfFileName: "x.pdf",
    clinical: true,
    signer: "PACIENTE",
    signerName: null,
    signerRelation: null,
    informerUserId: SANITARIA_ID,
    revokesConsentId: null,
    revokeReason: null,
    createdByUserId: SANITARIA_ID,
  });
}

function revocarElDeFotos() {
  mundo.consents.push({
    ...mundo.consents[0]!,
    id: "r-fotos",
    grantedAt: new Date("2026-09-02T10:00:00.000Z"),
    revokesConsentId: "c-fotos",
    revokeReason: "ya no quiere",
    pdfFileName: null,
    pdfSha256: null,
  });
}

async function hacerFoto(
  app: Awaited<ReturnType<typeof buildApp>>,
  zona = "L:h",
  headers = comoSanitaria,
) {
  return app.inject({
    method: "POST",
    url: `/clinica/appointments/${CITA_ID}/fotos`,
    headers,
    payload: { zona, jpegBase64: JPEG_BASE64 },
  });
}

beforeEach(() => {
  mundo.reset();
  sembrarValoracion(mundo);
});

// ── 1 · la puerta del consentimiento de fotos ────────────────────────

describe("clinica-4 · antes de la primera foto, el consentimiento", () => {
  it("SIN consentimiento no se guarda, y dice cuál falta", async () => {
    const app = await buildApp();
    const res = await hacerFoto(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SIN_CONSENTIMIENTO_DE_FOTOS");
    // El camino para arreglarlo, como la puerta de la valoración.
    expect(res.json().plantillaId).toBe("fotos-clinicas");
    expect(mundo.photos).toHaveLength(0);
    await app.close();
  });

  it("CON consentimiento sí", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    const res = await hacerFoto(app);
    expect(res.statusCode).toBe(201);
    expect(mundo.photos).toHaveLength(1);
    await app.close();
  });

  it("REVOCADO deja de poder hacer fotos nuevas", async () => {
    // Lo dice el propio texto de la plantilla: las que ya están se
    // conservan (son historia), y no se hacen más.
    conConsentimientoDeFotos();
    const app = await buildApp();
    expect((await hacerFoto(app)).statusCode).toBe(201);
    revocarElDeFotos();
    const res = await hacerFoto(app, "R:h");
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SIN_CONSENTIMIENTO_DE_FOTOS");
    // Y la que ya estaba, sigue.
    expect(mundo.photos).toHaveLength(1);
    await app.close();
  });

  it("y la lista lo dice para que la pantalla lleve a firmarlo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos`,
      headers: comoSanitaria,
    });
    expect(res.json().consentimiento).toEqual({
      puede: false,
      plantillaId: "fotos-clinicas",
      mensaje:
        "Antes de la primera foto, el paciente tiene que firmar el consentimiento de fotos clínicas.",
    });
    await app.close();
  });
});

// ── 2 · la zona ─────────────────────────────────────────────────────

describe("clinica-4 · la zona se elige antes de disparar", () => {
  it("una zona que no es del mapa no entra", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    const res = await hacerFoto(app, "L:no-existe");
    // El `enum` del schema la rechaza: 400, antes de tocar el disco.
    expect(res.statusCode).toBe(400);
    expect(mundo.photos).toHaveLength(0);
    await app.close();
  });

  it("sin zona tampoco", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/fotos`,
      headers: comoSanitaria,
      payload: { jpegBase64: JPEG_BASE64 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("lo que no es un JPEG tampoco", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/appointments/${CITA_ID}/fotos`,
      headers: comoSanitaria,
      payload: {
        zona: "L:h",
        jpegBase64: Buffer.from("<html>soy un html</html>").toString("base64"),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FOTO_INVALIDA");
    expect(mundo.photos).toHaveLength(0);
    await app.close();
  });

  it("la fila guarda la zona Y la versión del mapa", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app, "R:talon");
    const f = mundo.photos[0]!;
    expect(f.zona).toBe("R:talon");
    expect(f.mapaVersion).toBe(1);
    expect(f.appointmentId).toBe(CITA_ID);
    expect(f.authorUserId).toBe(SANITARIA_ID);
    await app.close();
  });
});

// ── 3 · ni una foto sin registro ────────────────────────────────────

describe("clinica-4 · ninguna foto se ve sin dejar línea", () => {
  it("hacerla deja línea WRITE", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    expect(mundo.registro).toEqual([
      {
        userId: SANITARIA_ID,
        clientId: PACIENTE_ID,
        action: "WRITE",
        outcome: "ALLOWED",
        route: `POST /clinica/appointments/${CITA_ID}/fotos`,
      },
    ]);
    await app.close();
  });

  it("el BINARIO deja línea READ", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    mundo.registro = [];
    const id = mundo.photos[0]!.id;
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos/${id}/imagen`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(mundo.registro).toHaveLength(1);
    expect(mundo.registro[0]!.action).toBe("READ");
    await app.close();
  });

  it("la RECEPCIONISTA no ve una foto, y queda escrito", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    mundo.registro = [];
    const id = mundo.photos[0]!.id;
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos/${id}/imagen`,
      headers: comoRecepcion,
    });
    expect(res.statusCode).toBe(403);
    expect(mundo.registro[0]).toMatchObject({
      userId: RECEPCION_ID,
      action: "READ",
      outcome: "DENIED",
    });
    await app.close();
  });

  it("ni puede hacer una", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    const res = await hacerFoto(app, "L:h", comoRecepcion);
    expect(res.statusCode).toBe(403);
    expect(mundo.photos).toHaveLength(0);
    expect(mundo.registro.at(-1)).toMatchObject({ outcome: "DENIED" });
    await app.close();
  });

  it("con la clínica apagada la ruta NO EXISTE", async () => {
    mundo.clinicaEncendida = false;
    conConsentimientoDeFotos();
    const app = await buildApp();
    const res = await hacerFoto(app);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: `Route POST:/clinica/appointments/${CITA_ID}/fotos not found`,
    });
    expect(mundo.photos).toHaveLength(0);
    await app.close();
  });
});

// ── 4 · retirar, no borrar ──────────────────────────────────────────

describe("clinica-4 · una foto no se borra: se retira", () => {
  it("la retirada SIGUE en la historia, marcada y con su motivo", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    const id = mundo.photos[0]!.id;
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/fotos/${id}/retirar`,
      headers: comoSanitaria,
      payload: { motivo: "Salió en blanco" },
    });
    expect(res.statusCode).toBe(200);
    // La fila sigue, con autor y motivo.
    expect(mundo.photos).toHaveLength(1);
    expect(mundo.photos[0]!.withdrawnAt).not.toBeNull();
    expect(mundo.photos[0]!.withdrawnByUserId).toBe(SANITARIA_ID);
    expect(mundo.photos[0]!.withdrawReason).toBe("Salió en blanco");

    // Y la lista la enseña marcada.
    const lista = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos`,
      headers: comoSanitaria,
    });
    const v = lista.json();
    expect(v.fotos).toHaveLength(1);
    expect(v.fotos[0].retirada).toBe(true);
    expect(v.fotos[0].retiradaMotivo).toBe("Salió en blanco");
    expect(v.fotos[0].retiradaPor).toBe("Lucía Martín");
    await app.close();
  });

  it("y DEJA de salir en el comparador", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    await hacerFoto(app);
    let lista = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos`,
      headers: comoSanitaria,
    });
    expect(lista.json().comparador[0].cuantas).toBe(2);

    const id = mundo.photos[0]!.id;
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/fotos/${id}/retirar`,
      headers: comoSanitaria,
      payload: { motivo: "Salió en blanco" },
    });
    lista = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos`,
      headers: comoSanitaria,
    });
    const c = lista.json().comparador[0];
    expect(c.cuantas).toBe(1);
    // Con una sola, no hay antes: la pantalla dice «con la segunda podrás
    // comparar» en vez de enseñar la misma foto dos veces.
    expect(c.antes).toBeNull();
    await app.close();
  });

  it("pero SÍ se sigue sirviendo por su id (derecho de acceso)", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    const id = mundo.photos[0]!.id;
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/fotos/${id}/retirar`,
      headers: comoSanitaria,
      payload: { motivo: "Salió en blanco" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/fotos/${id}/imagen`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-foto-retirada"]).toBe("si");
    await app.close();
  });

  it("no se retira dos veces y sin motivo no se retira", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app);
    const id = mundo.photos[0]!.id;
    const url = `/clinica/clients/${PACIENTE_ID}/fotos/${id}/retirar`;
    const sinMotivo = await app.inject({
      method: "POST",
      url,
      headers: comoSanitaria,
      payload: { motivo: "no" },
    });
    expect(sinMotivo.statusCode).toBe(400);
    await app.inject({
      method: "POST",
      url,
      headers: comoSanitaria,
      payload: { motivo: "Salió en blanco" },
    });
    const otra = await app.inject({
      method: "POST",
      url,
      headers: comoSanitaria,
      payload: { motivo: "otra vez" },
    });
    expect(otra.statusCode).toBe(409);
    expect(otra.json().code).toBe("YA_ESTABA_RETIRADA");
    await app.close();
  });
});

// ── 5 · la huella del fichero ───────────────────────────────────────

describe("clinica-4 · la huella de la foto cuadra con el fichero", () => {
  it("y el nombre no dice nada del paciente ni de la zona", async () => {
    conConsentimientoDeFotos();
    const app = await buildApp();
    await hacerFoto(app, "L:h");
    const f = mundo.photos[0]!;
    const bytes = readFileSync(join(DIRECTORIO, "fotos", f.fileName));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(f.sha256);
    expect(f.bytes).toBe(bytes.byteLength);
    expect(f.fileName).toMatch(/^[0-9a-f-]{36}-[0-9a-f]{12}\.jpg$/);
    expect(f.fileName).not.toContain("h");
    await app.close();
  });
});

// ── 6 · el comparador, decidido en el servidor ──────────────────────

describe("clinica-4 · el comparador es la más antigua y la última", () => {
  const foto = (
    id: string,
    zona: string,
    hecha: string,
    retirada = false,
  ) => ({
    id,
    zona,
    zonaNombre: zona,
    mapaVersion: 1,
    hecha,
    autor: "Lucía",
    retirada,
    retiradaEn: null,
    retiradaMotivo: null,
    retiradaPor: null,
  });

  it("con tres, la primera y la tercera", () => {
    const c = comparadorPorZona([
      foto("c", "L:h", "2026-09-21T10:00:00.000Z"),
      foto("a", "L:h", "2026-09-07T10:00:00.000Z"),
      foto("b", "L:h", "2026-09-14T10:00:00.000Z"),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.antes!.id).toBe("a");
    expect(c[0]!.ultima!.id).toBe("c");
    expect(c[0]!.cuantas).toBe(3);
  });

  it("con una, no hay «antes»", () => {
    const c = comparadorPorZona([foto("a", "L:h", "2026-09-07T10:00:00.000Z")]);
    expect(c[0]!.antes).toBeNull();
    expect(c[0]!.ultima!.id).toBe("a");
  });

  it("una zona por entrada, y las retiradas no cuentan", () => {
    const c = comparadorPorZona([
      foto("a", "L:h", "2026-09-07T10:00:00.000Z"),
      foto("b", "R:talon", "2026-09-07T10:00:00.000Z"),
      foto("x", "R:talon", "2026-09-14T10:00:00.000Z", true),
    ]);
    expect(c.map((x) => x.zona).sort()).toEqual(["L:h", "R:talon"]);
    expect(c.find((x) => x.zona === "R:talon")!.cuantas).toBe(1);
  });

  it("una zona cuyas fotos están TODAS retiradas desaparece del comparador", () => {
    const c = comparadorPorZona([
      foto("x", "R:talon", "2026-09-14T10:00:00.000Z", true),
    ]);
    expect(c).toEqual([]);
  });
});
