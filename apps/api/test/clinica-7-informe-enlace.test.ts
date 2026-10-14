// clinica-7 · EL INFORME POR ENLACE, Y SU CÓDIGO DE 6 CIFRAS.
//
// Los sabotajes del prompt que viven aquí, y **todos contestan la MISMA
// 404**: caducado, gastado, anulado, código erróneo, y código erróneo
// cinco veces → el enlace se anula.
//
// Lo que hace que esto importe: decirle «el código está mal» a quien prueba
// códigos le confirma que el enlace existe y que iba por buen camino. Con
// una sola 404, lo que un escáner aprende es nada.
//
// Y el guardián de los adjuntos: **ningún envío del módulo clínico pasa
// `attachments` al `EmailSender`**. Si alguien vuelve a meterlos, este
// fichero se pone rojo.

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIRECTORIO = mkdtempSync(join(tmpdir(), "clinica7-enlace-"));

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.CLINICAL_FILES_DIR = DIRECTORIO;
process.env.PUBLIC_TPV_URL = "https://tpv.mipiace.test";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PACIENTE_ID,
  SANITARIA_ID,
  TENANT_ID,
  crearMundo,
  sembrarSesion,
  sembrarValoracion,
} from "./support/fake-clinica-4.js";

const mundo = crearMundo();

const enviados: Array<{
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: unknown;
}> = [];

vi.mock("../src/context.js", () => ({
  initContext: vi.fn(),
  getPrisma: () => mundo.prisma,
  getRedis: () => ({}),
  closeContext: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (m: any) => {
      enviados.push(m);
    },
  }),
}));

// La puerta usa Redis para los dos límites. En los tests se desactiva: lo
// que este fichero prueba es la cerradura, no el cubo — y el cubo tiene su
// propio fichero desde `enlaces-publicos`.
vi.mock("../src/auth/rate-limit.js", () => ({
  inspect: async () => ({ locked: false, retryAfterSeconds: 0 }),
  registerFailure: async () => undefined,
  reset: async () => undefined,
  throttle: () => ({}),
}));

const { registerInformeRoutes } = await import(
  "../src/clinica/informe-routes.js"
);
const { registerInformePublicoRoutes } = await import(
  "../src/clinica/informe-publico.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");
const { REGLAS_INFORME } = await import("../src/enlaces/reglas.js");
const { FALLOS_QUE_ANULAN } = await import("../src/enlaces/codigo.js");

const comoSanitaria = {
  authorization: `Bearer ${signAccessToken({
    sub: SANITARIA_ID,
    tid: TENANT_ID,
    role: "CLINICIAN",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerInformeRoutes(app);
  await registerInformePublicoRoutes(app);
  await app.ready();
  return app;
}

/** Manda el informe por email y devuelve el token, el código y el enlace. */
async function mandarPorEmail(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: `/clinica/clients/${PACIENTE_ID}/informe`,
    headers: comoSanitaria,
    payload: { tipo: "RESUMEN", canal: "EMAIL", destinatario: "PACIENTE" },
  });
  expect(res.statusCode).toBe(201);
  const correo = enviados.at(-1)!;
  const token = (correo.text.match(/\/informe\/([A-Za-z0-9_-]{43})/) ?? [])[1]!;
  return {
    token,
    codigo: res.json().codigo as string,
    enlace: mundo.enlaces.at(-1)!,
    respuesta: res.json(),
  };
}

/** LA 404, carácter por carácter. Una sola para los cinco casos. */
const LA_404 = {
  error: REGLAS_INFORME.mensajes.code,
  code: REGLAS_INFORME.mensajes.code,
  message: REGLAS_INFORME.mensajes.noSirve,
};

beforeEach(() => {
  mundo.reset();
  enviados.length = 0;
  olvidarClaves();
  sembrarValoracion(mundo);
  sembrarSesion(mundo, 1);
});

// ── 1 · EL ENVÍO ────────────────────────────────────────────────────

describe("clinica-7 · el informe por email manda un ENLACE", () => {
  it("ni un adjunto, el enlace en el cuerpo y el código SOLO en la respuesta", async () => {
    const app = await buildApp();
    const { token, codigo, enlace, respuesta } = await mandarPorEmail(app);

    expect(enviados.at(-1)!.attachments).toBeUndefined();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codigo).toMatch(/^[0-9]{6}$/);
    // La respuesta es el ÚNICO sitio donde el código existe en claro.
    expect(enviados.at(-1)!.text).not.toContain(codigo);
    // De la base sale su huella y nada más.
    expect(enlace.codeHash).toHaveLength(64);
    expect(enlace.codeHash).not.toContain(codigo);
    // Y la pantalla sabe cuánto vive y cuántas aperturas tiene.
    expect(respuesta.caducaEn).toBeTruthy();
    expect(respuesta.aperturas).toBe(3);
    await app.close();
  });

  it("el enlace es del `purpose` del informe, con 7 días y 3 aperturas", async () => {
    const app = await buildApp();
    const { enlace } = await mandarPorEmail(app);
    expect(enlace.purpose).toBe("INFORME_CLINICO");
    expect(enlace.targetType).toBe("CLINICAL_REPORT_DELIVERY");
    expect(enlace.maxUses).toBe(3);
    const dias = (+enlace.expiresAt - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
    await app.close();
  });

  it("la entrega guarda el fichero Y el enlace: van juntos", async () => {
    // El CHECK `..._enlace_completo` los ata en la base; aquí se comprueba
    // que la ruta los escribe los dos.
    const app = await buildApp();
    const { enlace } = await mandarPorEmail(app);
    const entrega = mundo.deliveries.at(-1)!;
    expect(entrega.pdfFileName).toMatch(/\.pdf$/);
    expect(entrega.publicLinkId).toBe(enlace.id);
    expect(entrega.channel).toBe("EMAIL");
    // Y el enlace apunta a LA ENTREGA, no al paciente: el informe de un
    // paciente cambia cada vez que se le abre una sesión.
    expect(enlace.targetId).toBe(entrega.id);
    await app.close();
  });

  it("IMPRIMIR no crea enlace ni guarda fichero", async () => {
    // Imprimir es llevárselo en el mismo acto: no hay nada que guardar ni
    // enlace que dar. Es la decisión de clinica-4 y no cambia.
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "RESUMEN", canal: "PRINT", destinatario: "PACIENTE" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(mundo.enlaces).toHaveLength(0);
    expect(mundo.deliveries.at(-1)!.pdfFileName).toBeNull();
    await app.close();
  });
});

// ── 2 · EL CÓDIGO ───────────────────────────────────────────────────

describe("clinica-7 · sin el código, el enlace no abre", () => {
  it("el GET dice que hace falta código y NO enseña nada de la historia", async () => {
    const app = await buildApp();
    const { token } = await mandarPorEmail(app);
    const res = await app.inject({ method: "GET", url: `/informe/${token}` });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.pideCodigo).toBe(true);
    expect(v.clinica).toBe("Clínica de prueba");
    // NI el tipo de informe, NI el nombre del paciente, NI un id.
    expect(Object.keys(v).sort()).toEqual([
      "aperturasRestantes",
      "clinica",
      "pideCodigo",
    ]);
    expect(res.body).not.toContain(PACIENTE_ID);
    expect(res.body.toLowerCase()).not.toContain("resumen");
    await app.close();
  });

  it("el GET no gasta aperturas ni intentos: abrir la página no es leer", async () => {
    const app = await buildApp();
    const { token, enlace } = await mandarPorEmail(app);
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: "GET", url: `/informe/${token}` });
    }
    expect(enlace.usedCount).toBe(0);
    expect(enlace.codeFailures).toBe(0);
    await app.close();
  });

  it("CON el código, sale el PDF y se gasta UNA apertura", async () => {
    const app = await buildApp();
    const { token, codigo, enlace } = await mandarPorEmail(app);
    const res = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.headers["x-huella-cuadra"]).toBe("si");
    // El nombre del fichero no dice nada del paciente.
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="documento-clinico.pdf"',
    );
    expect(enlace.usedCount).toBe(1);
    await app.close();
  });

  it("y cada apertura deja su línea EXPORT en el registro", async () => {
    // Es lo que un adjunto no puede decir nunca: quién abrió el informe y
    // cuándo.
    const app = await buildApp();
    const { token, codigo } = await mandarPorEmail(app);
    mundo.registro = [];
    await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(mundo.registro).toHaveLength(1);
    expect(mundo.registro[0]).toMatchObject({
      clientId: PACIENTE_ID,
      action: "EXPORT",
      outcome: "ALLOWED",
    });
    await app.close();
  });

  it("CON EL CÓDIGO MAL: la misma 404, y cuenta el fallo EN LA FILA", async () => {
    const app = await buildApp();
    const { token, enlace } = await mandarPorEmail(app);
    const res = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo: "000000" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(LA_404);
    // En la FILA y no solo en Redis: un rate-limit se olvida al reiniciar
    // y se esquiva cambiando de IP.
    expect(enlace.codeFailures).toBe(1);
    // Y no se gasta una apertura: no ha leído nada.
    expect(enlace.usedCount).toBe(0);
    await app.close();
  });

  it("CINCO CÓDIGOS MAL ANULAN EL ENLACE, y el bueno ya no abre", async () => {
    // El sabotaje entero del prompt. Un atacante con la URL tiene cinco
    // intentos sobre un millón; después el enlace está muerto y hay que
    // llamar a la clínica.
    const app = await buildApp();
    const { token, codigo, enlace } = await mandarPorEmail(app);

    for (let i = 1; i <= FALLOS_QUE_ANULAN; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/informe/${token}`,
        payload: { codigo: String(100000 + i) },
      });
      expect(res.statusCode).toBe(404);
      // LA MISMA 404 en los cinco, también en el quinto (el que anula).
      // Un mensaje distinto en el último le diría a quien prueba que ha
      // llegado al tope, que es información.
      expect(res.json()).toEqual(LA_404);
    }
    expect(enlace.codeFailures).toBe(FALLOS_QUE_ANULAN);
    expect(enlace.revokedAt).not.toBeNull();

    // Y el código BUENO ya no abre.
    const conElBueno = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(conElBueno.statusCode).toBe(404);
    expect(conElBueno.json()).toEqual(LA_404);
    expect(enlace.usedCount).toBe(0);
    await app.close();
  });

  it("un código con otra forma lo tira el schema, sin tocar la base", async () => {
    const app = await buildApp();
    const { token, enlace } = await mandarPorEmail(app);
    for (const malo of ["12345", "1234567", "abcdef", "12 34 56"]) {
      const res = await app.inject({
        method: "POST",
        url: `/informe/${token}`,
        payload: { codigo: malo },
      });
      expect(res.statusCode).toBe(400);
    }
    // Y NO cuenta como intento: lo que no tiene forma de código no gasta
    // los cinco de quien se equivoca al teclear.
    expect(enlace.codeFailures).toBe(0);
    await app.close();
  });
});

// ── 3 · CADUCADO, GASTADO, ANULADO: LA MISMA 404 ────────────────────

describe("clinica-7 · los cinco casos del enlace contestan lo mismo", () => {
  it("CADUCADO", async () => {
    const app = await buildApp();
    const { token, codigo, enlace } = await mandarPorEmail(app);
    enlace.expiresAt = new Date(Date.now() - 1000);
    const res = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(LA_404);
    // Y NO gasta un intento de código: el código se comprueba en último
    // lugar justo para esto.
    expect(enlace.codeFailures).toBe(0);
    await app.close();
  });

  it("GASTADO (las tres aperturas)", async () => {
    const app = await buildApp();
    const { token, codigo, enlace } = await mandarPorEmail(app);
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({
        method: "POST",
        url: `/informe/${token}`,
        payload: { codigo },
      });
      expect(ok.statusCode).toBe(200);
    }
    expect(enlace.usedCount).toBe(3);
    const cuarta = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(cuarta.statusCode).toBe(404);
    expect(cuarta.json()).toEqual(LA_404);
    await app.close();
  });

  it("ANULADO desde la historia", async () => {
    const app = await buildApp();
    const { token, codigo, enlace } = await mandarPorEmail(app);
    const entregaId = mundo.deliveries.at(-1)!.id;

    const anula = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe/entregas/${entregaId}/anular-enlace`,
      headers: comoSanitaria,
    });
    expect(anula.statusCode).toBe(200);
    expect(anula.json().anulado).toBe(true);
    expect(enlace.revokedAt).not.toBeNull();

    const res = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(LA_404);
    await app.close();
  });

  it("UN TOKEN INVENTADO", async () => {
    const app = await buildApp();
    await mandarPorEmail(app);
    const res = await app.inject({
      method: "POST",
      url: `/informe/${"z".repeat(43)}`,
      payload: { codigo: "123456" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(LA_404);
    await app.close();
  });

  it("y la 404 es LA MISMA en los cinco, carácter por carácter", async () => {
    // Si se separan, se pueden distinguir — y distinguirlas le dice a un
    // escáner que el token existía, que ya es información sobre una
    // persona.
    const app = await buildApp();
    const { token, codigo, enlace } = await mandarPorEmail(app);

    const cuerpos: string[] = [];
    // inventado
    cuerpos.push(
      (
        await app.inject({
          method: "POST",
          url: `/informe/${"z".repeat(43)}`,
          payload: { codigo },
        })
      ).body,
    );
    // código erróneo
    cuerpos.push(
      (
        await app.inject({
          method: "POST",
          url: `/informe/${token}`,
          payload: { codigo: "000001" },
        })
      ).body,
    );
    // caducado
    enlace.expiresAt = new Date(Date.now() - 1000);
    cuerpos.push(
      (
        await app.inject({
          method: "POST",
          url: `/informe/${token}`,
          payload: { codigo },
        })
      ).body,
    );
    // anulado
    enlace.expiresAt = new Date(Date.now() + 86_400_000);
    enlace.revokedAt = new Date();
    cuerpos.push(
      (
        await app.inject({
          method: "POST",
          url: `/informe/${token}`,
          payload: { codigo },
        })
      ).body,
    );
    expect(new Set(cuerpos).size).toBe(1);
    await app.close();
  });

  it("las tres cabeceras van en TODAS las respuestas de la puerta", async () => {
    const app = await buildApp();
    const { token, codigo } = await mandarPorEmail(app);
    for (const res of [
      await app.inject({ method: "GET", url: `/informe/${token}` }),
      await app.inject({
        method: "POST",
        url: `/informe/${token}`,
        payload: { codigo: "000001" },
      }),
      await app.inject({
        method: "POST",
        url: `/informe/${token}`,
        payload: { codigo },
      }),
    ]) {
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    }
    await app.close();
  });

  it("y el módulo APAGADO deja el enlace sin abrir, con la misma 404", async () => {
    const app = await buildApp();
    const { token, codigo } = await mandarPorEmail(app);
    mundo.clinicaEncendida = false;
    const res = await app.inject({
      method: "POST",
      url: `/informe/${token}`,
      payload: { codigo },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(LA_404);
    await app.close();
  });
});

// ── 4 · EL GUARDIÁN DE LOS ADJUNTOS ─────────────────────────────────

describe("clinica-7 · NINGÚN envío del módulo clínico lleva adjunto", () => {
  it("el del informe, no", async () => {
    const app = await buildApp();
    await mandarPorEmail(app);
    for (const correo of enviados) {
      expect(correo.attachments).toBeUndefined();
    }
    await app.close();
  });

  it("y el guardián mira EL CÓDIGO FUENTE del módulo, no solo este camino", async () => {
    // Éste es el test que el prompt pide: «si alguien vuelve a meter
    // `attachments`, el test se pone rojo». Un test que solo recorriera el
    // camino de hoy no cubriría la ruta que alguien añada mañana — y la
    // forma de que no lo cubra es exactamente la forma de que se cuele.
    //
    // Así que se lee el fuente de `apps/api/src/clinica/` y se busca la
    // palabra. Es grosero y es lo que funciona: `attachments` solo
    // significa una cosa.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const raiz = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "src",
      "clinica",
    );
    const culpables: string[] = [];
    for (const nombre of readdirSync(raiz)) {
      if (!nombre.endsWith(".ts")) continue;
      const fuente = readFileSync(join(raiz, nombre), "utf8");
      // Las menciones en comentarios no cuentan: el módulo explica POR QUÉ
      // ya no hay adjuntos, y eso tiene que poder escribirse.
      const sinComentarios = fuente
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/\battachments\b/.test(sinComentarios)) culpables.push(nombre);
    }
    expect(
      culpables,
      `estos ficheros del módulo clínico pasan 'attachments' a un envío: ${culpables.join(", ")}. Desde clinica-7 el informe va por enlace y NINGÚN correo clínico lleva adjunto (decisión 21).`,
    ).toEqual([]);
  });
});
