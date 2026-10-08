// clinica-4 · los consentimientos en la API.
//
// Las garantías de este fichero, una por bloque, y son las que el prompt
// pide en «cómo se da por hecho»:
//
//   1. **Firmar deja la fila con TODO congelado**: plantilla, versión,
//      huella del texto, huella del PDF, firmante e informante.
//   2. **La huella del PDF cuadra con el fichero del disco.** Se firma de
//      verdad, se lee el fichero de verdad y se vuelve a hashear.
//   3. **La sesión no empieza sin el consentimiento que pide su
//      servicio**, y un revocado cuenta como que falta.
//   4. **Revocar es una fila nueva**: la original sigue ahí.
//   5. **La recepcionista no firma lo clínico**, y el intento le queda
//      escrito en el registro.
//   6. **Cada apertura del PDF deja su línea** en `ClinicalAccessLog`.
//   7. **Módulo apagado → 404**, la de Fastify carácter por carácter.
//   8. El paciente de otro tenant no existe.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_TPV_URL = "https://mipiacetpv.com";
// Los ficheros clínicos, en un directorio de usar y tirar: este test
// ESCRIBE PDFs de verdad, porque la garantía que prueba es que la huella
// de la fila cuadra con el fichero del disco.
const DIRECTORIO = mkdtempSync(join(tmpdir(), "clinica4-"));
process.env.CLINICAL_FILES_DIR = DIRECTORIO;

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearMundo,
  sembrarValoracion,
  AJENA_ID,
  CITA_ID,
  DUENA_ID,
  PACIENTE_ID,
  PNG_1x1_BASE64,
  RECEPCION_ID,
  SANITARIA_ID,
  SERVICIO_CIRUGIA,
  SERVICIO_QUIROPODIA,
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

const { registerConsentimientosRoutes } = await import(
  "../src/clinica/consentimientos-routes.js"
);
const { puertaDeConsentimientos } = await import(
  "../src/clinica/consentimientos.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { textoCanonico, plantillaVigente } = await import(
  "@mipiacetpv/consentimientos"
);

function tokenDe(userId: string, role: "OWNER" | "CLINICIAN" | "CASHIER") {
  return signAccessToken({ sub: userId, tid: TENANT_ID, role });
}
const comoSanitaria = {
  authorization: `Bearer ${tokenDe(SANITARIA_ID, "CLINICIAN")}`,
};
const comoDuena = { authorization: `Bearer ${tokenDe(DUENA_ID, "OWNER")}` };
const comoRecepcion = {
  authorization: `Bearer ${tokenDe(RECEPCION_ID, "CASHIER")}`,
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerConsentimientosRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  mundo.reset();
  sembrarValoracion(mundo);
});

const CUERPO_FIRMA = {
  plantillaId: "cirugia-ungueal",
  firmante: { clase: "PACIENTE" as const },
  firmaPngBase64: PNG_1x1_BASE64,
};

async function firmar(
  app: Awaited<ReturnType<typeof buildApp>>,
  cuerpo: Record<string, unknown> = CUERPO_FIRMA,
  headers = comoSanitaria,
) {
  return app.inject({
    method: "POST",
    url: `/clinica/clients/${PACIENTE_ID}/consentimientos`,
    headers,
    payload: cuerpo,
  });
}

// ── 1 · firmar congela todo ──────────────────────────────────────────

describe("clinica-4 · firmar congela qué se firmó y delante de quién", () => {
  it("la fila lleva plantilla, versión, huella del texto y del PDF", async () => {
    const app = await buildApp();
    const res = await firmar(app);
    expect(res.statusCode).toBe(201);

    expect(mundo.consents).toHaveLength(1);
    const fila = mundo.consents[0]!;
    const plantilla = plantillaVigente("cirugia-ungueal")!;
    expect(fila.templateId).toBe("cirugia-ungueal");
    expect(fila.templateVersion).toBe(plantilla.version);
    expect(fila.textSha256).toBe(
      createHash("sha256").update(textoCanonico(plantilla), "utf8").digest("hex"),
    );
    expect(fila.clinical).toBe(true);
    expect(fila.signer).toBe("PACIENTE");
    expect(fila.signerName).toBeNull();
    expect(fila.informerUserId).toBe(SANITARIA_ID);
    expect(fila.kind).toBe("TREATMENT");
    // Y `docRef`, que es el puntero al documento desde B1.
    expect(fila.docRef).toBe(fila.pdfFileName);
    await app.close();
  });

  it("un REPRESENTANTE guarda su nombre y su relación", async () => {
    const app = await buildApp();
    const res = await firmar(app, {
      ...CUERPO_FIRMA,
      firmante: { clase: "REPRESENTANTE", nombre: "Ana", relacion: "hija" },
    });
    expect(res.statusCode).toBe(201);
    const fila = mundo.consents[0]!;
    expect(fila.signer).toBe("REPRESENTANTE");
    expect(fila.signerName).toBe("Ana");
    expect(fila.signerRelation).toBe("hija");
    await app.close();
  });

  it("un representante SIN relación no se guarda", async () => {
    const app = await buildApp();
    const res = await firmar(app, {
      ...CUERPO_FIRMA,
      firmante: { clase: "REPRESENTANTE", nombre: "Ana" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FALTA_LA_RELACION");
    expect(mundo.consents).toHaveLength(0);
    await app.close();
  });

  it("sin firma no se firma", async () => {
    const app = await buildApp();
    // Un base64 que no es un PNG: lo rechaza la ruta antes de tocar nada.
    const res = await firmar(app, {
      ...CUERPO_FIRMA,
      firmaPngBase64: Buffer.from("no soy un png").toString("base64"),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FIRMA_INVALIDA");
    expect(mundo.consents).toHaveLength(0);
    await app.close();
  });

  it("firmar DOS VECES lo mismo no crea dos filas", async () => {
    const app = await buildApp();
    expect((await firmar(app)).statusCode).toBe(201);
    const segunda = await firmar(app);
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().code).toBe("YA_ESTA_FIRMADO");
    expect(mundo.consents).toHaveLength(1);
    await app.close();
  });
});

// ── 2 · la huella del PDF cuadra con el fichero ──────────────────────

describe("clinica-4 · la huella SHA-256 del PDF cuadra con el fichero", () => {
  it("se vuelve a calcular sobre el fichero del disco", async () => {
    const app = await buildApp();
    await firmar(app);
    const fila = mundo.consents[0]!;
    const ruta = join(DIRECTORIO, "consentimientos", fila.pdfFileName!);
    const bytes = readFileSync(ruta);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      fila.pdfSha256,
    );
    // Y es un PDF de verdad, no un fichero con otro nombre.
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await app.close();
  });

  it("el nombre del fichero NO lleva datos del paciente", async () => {
    // Los nombres de fichero acaban en listados, en logs y en la captura
    // de pantalla de quien está depurando.
    const app = await buildApp();
    await firmar(app);
    const nombre = mundo.consents[0]!.pdfFileName!;
    expect(nombre).toMatch(/^[0-9a-f-]{36}-[0-9a-f]{12}\.pdf$/);
    expect(nombre.toLowerCase()).not.toContain("carmen");
    expect(nombre.toLowerCase()).not.toContain("cirugia");
    await app.close();
  });

  it("y si el PDF del disco NO cuadra, la cabecera lo DICE", async () => {
    // Este test existe por un sabotaje que salió VERDE: con
    // `huellaCuadra: true` fijo, todo seguía en verde porque ningún caso
    // ejercitaba el camino en que NO cuadra. La comprobación habría sido
    // código muerto y nadie se habría enterado.
    //
    // Y lo que se enseña es el documento CON el aviso, no un 404: un PDF
    // que no cuadra es justo el que alguien tiene que mirar, y esconderlo
    // borra la única pista.
    const app = await buildApp();
    await firmar(app);
    const fila = mundo.consents[0]!;
    const ruta = join(DIRECTORIO, "consentimientos", fila.pdfFileName!);
    // Alguien cambia el fichero en el volumen, por detrás de la API.
    writeFileSync(ruta, Buffer.concat([readFileSync(ruta), Buffer.from("x")]));
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${fila.id}/pdf`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-huella-cuadra"]).toBe("NO");
    await app.close();
  });

  it("y el PDF se sirve con la cabecera de que la huella cuadra", async () => {
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/pdf`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-huella-cuadra"]).toBe("si");
    await app.close();
  });
});

// ── 3 · la puerta de la sesión ───────────────────────────────────────

describe("clinica-4 · la sesión no empieza sin el consentimiento que pide", () => {
  it("el servicio que lo pide y no está firmado: NO", async () => {
    mundo.pideElServicio.set(SERVICIO_CIRUGIA, ["cirugia-ungueal"]);
    const puerta = await puertaDeConsentimientos(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      servicioIds: [SERVICIO_CIRUGIA],
    });
    expect(puerta.puede).toBe(false);
    expect(puerta.faltan.map((f) => f.id)).toEqual(["cirugia-ungueal"]);
    // Y el mensaje dice el título, no el id: lo lee la podóloga.
    expect(puerta.mensaje).toContain("Consentimiento para cirugía de uña");
  });

  it("firmado: SÍ", async () => {
    mundo.pideElServicio.set(SERVICIO_CIRUGIA, ["cirugia-ungueal"]);
    const app = await buildApp();
    await firmar(app);
    const puerta = await puertaDeConsentimientos(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      servicioIds: [SERVICIO_CIRUGIA],
    });
    expect(puerta.puede).toBe(true);
    expect(puerta.faltan).toEqual([]);
    await app.close();
  });

  it("REVOCADO: otra vez NO", async () => {
    mundo.pideElServicio.set(SERVICIO_CIRUGIA, ["cirugia-ungueal"]);
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "La paciente se lo pensó mejor" },
    });
    expect(res.statusCode).toBe(201);
    const puerta = await puertaDeConsentimientos(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      servicioIds: [SERVICIO_CIRUGIA],
    });
    expect(puerta.puede).toBe(false);
    await app.close();
  });

  it("un servicio que no pide nada no bloquea nada", async () => {
    mundo.pideElServicio.set(SERVICIO_QUIROPODIA, []);
    const puerta = await puertaDeConsentimientos(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      servicioIds: [SERVICIO_QUIROPODIA],
    });
    expect(puerta.puede).toBe(true);
  });

  it("y una cita SIN servicios marcados tampoco: los quince tenants de hoy", async () => {
    const puerta = await puertaDeConsentimientos(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      servicioIds: [],
    });
    expect(puerta.puede).toBe(true);
  });
});

// ── 4 · revocar es una fila nueva ────────────────────────────────────

describe("clinica-4 · revocar NO toca la fila original", () => {
  it("la revocación es una fila enlazada, con su motivo", async () => {
    const app = await buildApp();
    await firmar(app);
    const original = { ...mundo.consents[0]! };
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${original.id}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "Prefiere pensarlo" },
    });
    expect(res.statusCode).toBe(201);
    expect(mundo.consents).toHaveLength(2);
    // La original, byte a byte igual que antes.
    expect(mundo.consents[0]).toEqual(original);
    const revocacion = mundo.consents[1]!;
    expect(revocacion.revokesConsentId).toBe(original.id);
    expect(revocacion.revokeReason).toBe("Prefiere pensarlo");
    // Copia plantilla y versión para que la lista se lea.
    expect(revocacion.templateId).toBe(original.templateId);
    expect(revocacion.templateVersion).toBe(original.templateVersion);
    await app.close();
  });

  it("no se revoca dos veces", async () => {
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    const url = `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/revocar`;
    await app.inject({
      method: "POST",
      url,
      headers: comoSanitaria,
      payload: { motivo: "uno" },
    });
    const segunda = await app.inject({
      method: "POST",
      url,
      headers: comoSanitaria,
      payload: { motivo: "dos" },
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().code).toBe("YA_ESTABA_REVOCADO");
    expect(mundo.consents).toHaveLength(2);
    await app.close();
  });

  it("y no se revoca una revocación", async () => {
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "uno" },
    });
    const revocacionId = mundo.consents[1]!.id;
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${revocacionId}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "dos" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ES_UNA_REVOCACION");
    await app.close();
  });

  it("sin motivo no se revoca", async () => {
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(mundo.consents).toHaveLength(1);
    await app.close();
  });
});

// ── 5 · quién puede, y el registro ───────────────────────────────────

describe("clinica-4 · lo clínico lo firma el sanitario", () => {
  it("la RECEPCIONISTA no entra, y le queda escrito", async () => {
    const app = await buildApp();
    const res = await firmar(app, CUERPO_FIRMA, comoRecepcion);
    expect(res.statusCode).toBe(403);
    expect(mundo.consents).toHaveLength(0);
    expect(mundo.registro).toEqual([
      {
        userId: RECEPCION_ID,
        clientId: PACIENTE_ID,
        action: "WRITE",
        outcome: "DENIED",
        route: `POST /clinica/clients/${PACIENTE_ID}/consentimientos`,
      },
    ]);
    await app.close();
  });

  it("una dueña sanitaria sí, y con SU número de colegiado", async () => {
    const app = await buildApp();
    const res = await firmar(app, CUERPO_FIRMA, comoDuena);
    expect(res.statusCode).toBe(201);
    expect(res.json().consentimiento.informante).toEqual({
      nombre: "Rosario",
      colegiado: "45-0001",
    });
    await app.close();
  });

  it("una dueña NO sanitaria no firma un consentimiento clínico", async () => {
    // La condición cruza `users.is_clinician` con la marca de la
    // plantilla, así que no cabe en un CHECK: la comprueba la API.
    mundo.users.get(DUENA_ID)!.isClinician = false;
    const app = await buildApp();
    const res = await firmar(app, CUERPO_FIRMA, comoDuena);
    // La función de acceso la para antes: una dueña no sanitaria no ve
    // historias (clinica-1 §4). La negativa es la misma y queda escrita.
    expect(res.statusCode).toBe(403);
    expect(mundo.registro.at(-1)!.outcome).toBe("DENIED");
    await app.close();
  });

  it("abrir el PDF deja su línea en el registro", async () => {
    const app = await buildApp();
    await firmar(app);
    mundo.registro = [];
    const id = mundo.consents[0]!.id;
    await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/pdf`,
      headers: comoSanitaria,
    });
    expect(mundo.registro).toHaveLength(1);
    expect(mundo.registro[0]).toMatchObject({
      userId: SANITARIA_ID,
      clientId: PACIENTE_ID,
      action: "READ",
      outcome: "ALLOWED",
    });
    await app.close();
  });

  it("y leer la lista también", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(200);
    expect(mundo.registro).toHaveLength(1);
    expect(mundo.registro[0]!.action).toBe("READ");
    await app.close();
  });
});

// ── 6 · la pantalla ─────────────────────────────────────────────────

describe("clinica-4 · la vista de consentimientos", () => {
  it("trae las tres plantillas con su texto y su estado", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos`,
      headers: comoSanitaria,
    });
    const v = res.json();
    expect(v.plantillas.map((p: any) => p.id)).toEqual([
      "cirugia-ungueal",
      "anestesia-local",
      "fotos-clinicas",
    ]);
    expect(v.plantillas[0].parrafos.length).toBeGreaterThan(3);
    expect(v.plantillas[0].pendienteDeValidar).toBe(true);
    expect(v.plantillas[0].vigente).toBeNull();
    await app.close();
  });

  it("dice CUÁL pide la cita, cuando se abre desde una", async () => {
    mundo.serviciosDeLaCita = [SERVICIO_CIRUGIA];
    mundo.pideElServicio.set(SERVICIO_CIRUGIA, [
      "cirugia-ungueal",
      "anestesia-local",
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos?appointmentId=${CITA_ID}`,
      headers: comoSanitaria,
    });
    const v = res.json();
    expect(v.pideLaCita).toEqual(["cirugia-ungueal", "anestesia-local"]);
    expect(
      v.plantillas.filter((p: any) => p.laPideLaCita).map((p: any) => p.id),
    ).toEqual(["cirugia-ungueal", "anestesia-local"]);
    await app.close();
  });

  it("las filas de REVOCACIÓN no salen como documentos", async () => {
    // Lo que se enseña es el consentimiento, marcado como revocado: dos
    // líneas por el mismo documento se leerían como dos documentos.
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${id}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "lo pensó mejor" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos`,
      headers: comoSanitaria,
    });
    const v = res.json();
    expect(v.firmados).toHaveLength(1);
    expect(v.firmados[0].revocado).toBe(true);
    expect(v.firmados[0].revocadoMotivo).toBe("lo pensó mejor");
    await app.close();
  });

  it("un ALTA MANUAL del spa se enseña, sin inventarle plantilla", async () => {
    mundo.consents.push({
      id: "manual-1",
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      kind: "TREATMENT",
      grantedAt: new Date("2026-08-01T10:00:00.000Z"),
      docRef: "papel en el archivador",
      templateId: null,
      templateVersion: null,
      textSha256: null,
      pdfSha256: null,
      pdfFileName: null,
      clinical: false,
      signer: null,
      signerName: null,
      signerRelation: null,
      informerUserId: null,
      revokesConsentId: null,
      revokeReason: null,
      createdByUserId: RECEPCION_ID,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos`,
      headers: comoSanitaria,
    });
    const fila = res.json().firmados[0];
    expect(fila.titulo).toBe("Consentimiento de tratamiento · alta manual");
    expect(fila.plantillaId).toBeNull();
    expect(fila.tienePdf).toBe(false);
    await app.close();
  });
});

// ── 6b · «Documentos» de la historia viva ────────────────────────────
//
// Este bloque existe por un sabotaje que salió VERDE: el fichero de
// clinica-6 trae el paciente SIN consentimientos y SIN informes, así que
// esconderlos no rompía nada. La fila de un consentimiento firmado tiene
// que estar en «Documentos» —es la decisión 19 del prompt— y hasta aquí
// ningún test la pedía con datos dentro.

describe("clinica-4 · «Documentos» enseña lo que hay de verdad", () => {
  it("el consentimiento firmado sale con su PDF y su informante", async () => {
    const app = await buildApp();
    await firmar(app);
    const { vistaDeLaHistoria } = await import("../src/clinica/historia.js");
    const historia = await vistaDeLaHistoria(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      ahora: new Date("2026-10-09T09:00:00.000Z"),
    });
    const doc = historia.documentos.find((d) => d.clase === "CONSENTIMIENTO");
    expect(doc).toBeDefined();
    expect(doc!.titulo).toBe(
      "Consentimiento para cirugía de uña (matricectomía)",
    );
    // Se abre: es la fila que lleva al PDF.
    expect(doc!.abre).toBe("PDF_CONSENTIMIENTO");
    expect(doc!.id).toBe(mundo.consents[0]!.id);
    expect(doc!.revocado).toBe(false);
    expect(doc!.detalles.join(" · ")).toContain("Firmó el paciente");
    expect(doc!.detalles.join(" · ")).toContain("Informó Lucía Martín");
    await app.close();
  });

  it("y uno REVOCADO sigue saliendo, marcado y con su motivo", async () => {
    // Es historia: lo que se firmó un día no se esconde por haber dejado
    // de valer. Lo que cambia es que la fila lo dice.
    const app = await buildApp();
    await firmar(app);
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/consentimientos/${mundo.consents[0]!.id}/revocar`,
      headers: comoSanitaria,
      payload: { motivo: "Se lo pensó mejor" },
    });
    const { vistaDeLaHistoria } = await import("../src/clinica/historia.js");
    const historia = await vistaDeLaHistoria(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      ahora: new Date("2026-10-09T09:00:00.000Z"),
    });
    const docs = historia.documentos.filter(
      (d) => d.clase === "CONSENTIMIENTO",
    );
    // UNA fila, no dos: la revocación no es un documento aparte.
    expect(docs).toHaveLength(1);
    expect(docs[0]!.revocado).toBe(true);
    expect(docs[0]!.titulo).toContain("REVOCADO");
    expect(docs[0]!.detalles.join(" · ")).toContain(
      "Revocado: Se lo pensó mejor",
    );
    await app.close();
  });

  it("el INFORME entregado sale con su canal y quién lo entregó", async () => {
    mundo.deliveries.push({
      id: "ent-1",
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      report: "DERIVACION",
      channel: "EMAIL",
      recipient: "PROFESIONAL",
      recipientEmail: "traumatologia@hospital.es",
      pdfSha256: "f".repeat(64),
      userId: SANITARIA_ID,
      at: new Date("2026-10-09T10:00:00.000Z"),
    });
    const { vistaDeLaHistoria } = await import("../src/clinica/historia.js");
    const historia = await vistaDeLaHistoria(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      ahora: new Date("2026-10-09T11:00:00.000Z"),
    });
    const doc = historia.documentos.find((d) => d.clase === "INFORME");
    expect(doc).toBeDefined();
    expect(doc!.titulo).toBe("Informe de derivación");
    // No se abre: el PDF de un informe no se guarda (ver `informe-routes`).
    expect(doc!.abre).toBeNull();
    expect(doc!.detalles.join(" · ")).toContain(
      "Enviado por email a traumatologia@hospital.es",
    );
    expect(doc!.detalles.join(" · ")).toContain("Para otro profesional");
    expect(doc!.detalles.join(" · ")).toContain("Lo entregó Lucía Martín");
  });

  it("y el ALTA MANUAL del spa también, diciendo que no tiene documento", async () => {
    mundo.consents.push({
      id: "manual-2",
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      kind: "DATA",
      grantedAt: new Date("2026-08-01T10:00:00.000Z"),
      docRef: null,
      templateId: null,
      templateVersion: null,
      textSha256: null,
      pdfSha256: null,
      pdfFileName: null,
      clinical: false,
      signer: null,
      signerName: null,
      signerRelation: null,
      informerUserId: null,
      revokesConsentId: null,
      revokeReason: null,
      createdByUserId: RECEPCION_ID,
    });
    const { vistaDeLaHistoria } = await import("../src/clinica/historia.js");
    const historia = await vistaDeLaHistoria(mundo.prisma, {
      tenantId: TENANT_ID,
      clientId: PACIENTE_ID,
      ahora: new Date("2026-10-09T09:00:00.000Z"),
    });
    const doc = historia.documentos.find((d) => d.clase === "CONSENTIMIENTO");
    expect(doc!.titulo).toBe("Consentimiento de datos · alta manual");
    expect(doc!.abre).toBeNull();
    expect(doc!.detalles).toContain("Alta manual, sin documento");
  });
});

// ── 7 y 8 · el gate del módulo y el aislamiento ──────────────────────

describe("clinica-4 · con la clínica apagada estas rutas NO EXISTEN", () => {
  it("la 404 es indistinguible de la de una ruta que no existe", async () => {
    mundo.clinicaEncendida = false;
    const app = await buildApp();
    const url = `/clinica/clients/${PACIENTE_ID}/consentimientos`;
    const gateada = await app.inject({ method: "GET", url, headers: comoSanitaria });
    const inexistente = await app.inject({
      method: "GET",
      url: "/clinica/esta-ruta-no-existe",
      headers: comoSanitaria,
    });
    expect(gateada.statusCode).toBe(404);
    // Mismas claves, mismo texto y la MISMA forma de mensaje que Fastify
    // da para una ruta que no existe — con su URL, que es lo único que
    // cambia. Comparar los dos cuerpos tal cual compararía las URLs.
    expect(Object.keys(gateada.json()).sort()).toEqual(
      Object.keys(inexistente.json()).sort(),
    );
    expect(gateada.json()).toEqual({
      statusCode: 404,
      error: "Not Found",
      message: `Route GET:${url} not found`,
    });
    // Y no deja línea: no se llegó a mirar ninguna historia.
    expect(mundo.registro).toEqual([]);
    await app.close();
  });

  it("firmar tampoco", async () => {
    mundo.clinicaEncendida = false;
    const app = await buildApp();
    const res = await firmar(app);
    expect(res.statusCode).toBe(404);
    expect(mundo.consents).toHaveLength(0);
    await app.close();
  });
});

describe("clinica-4 · el paciente de otro tenant no existe", () => {
  it("404 antes de preguntar si este sanitario podría verlo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${AJENA_ID}/consentimientos`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CLIENT_NOT_FOUND");
    // Y no queda línea en el registro de ESE paciente: no es un intento de
    // abrir su historia, es un id que en este tenant no existe.
    expect(mundo.registro).toEqual([]);
    await app.close();
  });

  it("y el PDF de un consentimiento de otro paciente, tampoco", async () => {
    const app = await buildApp();
    await firmar(app);
    const id = mundo.consents[0]!.id;
    // El mismo id de consentimiento, pedido por otro paciente del mismo
    // tenant: la consulta cruza las dos cosas.
    mundo.clientes.set("77777777-7777-7777-7777-777777777777", {
      id: "77777777-7777-7777-7777-777777777777",
      tenantId: TENANT_ID,
      firstName: "Otro",
      lastName: "Paciente",
      phone: null,
      email: null,
      birthdate: null,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/77777777-7777-7777-7777-777777777777/consentimientos/${id}/pdf`,
      headers: comoSanitaria,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CONSENT_NOT_FOUND");
    await app.close();
  });
});
