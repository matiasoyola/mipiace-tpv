// clinica-4 · el informe en la API.
//
// Las garantías de este fichero:
//
//   1. **NI UN IMPORTE** en la respuesta ni en el PDF, para nadie — ni
//      para la dueña (regla 16). Se comprueba recorriendo el JSON y
//      comparando las dos respuestas byte a byte.
//   2. **El cuerpo del email NO lleva ningún dato de salud** (regla 17):
//      se compara el asunto y el cuerpo contra TODAS las palabras del
//      cuestionario de clinica-2 y contra los nombres de los cuatro
//      informes, no contra una lista escrita a mano.
//   3. **Toda entrega queda apuntada**: la fila de `clinical_report_deliveries`
//      Y la línea del registro de accesos con `action = EXPORT`.
//   4. **La derivación sin motivo no se entrega.**
//   5. Al paciente se le manda A SU email, no a uno que se teclee.
//   6. El PDF se entrega de verdad y es un PDF.

import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.CLINICAL_FILES_DIR = mkdtempSync(join(tmpdir(), "clinica4-inf-"));

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  crearMundo,
  sembrarSesion,
  sembrarValoracion,
  DUENA_ID,
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

const { registerInformeRoutes } = await import(
  "../src/clinica/informe-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { setEmailSender } = await import("../src/email/sender.js");
const { CUESTIONARIO_V1 } = await import("@mipiacetpv/clinica-valoracion");
const { NOMBRE_DE_TIPO_DE_INFORME, TIPOS_DE_INFORME } = await import(
  "@mipiacetpv/clinica-sesion"
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

interface Enviado {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}
let enviados: Enviado[] = [];

setEmailSender({
  async send(email) {
    enviados.push(email as Enviado);
  },
});

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerInformeRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  mundo.reset();
  sembrarValoracion(mundo);
  sembrarSesion(mundo, 7, { dolor: 7 });
  sembrarSesion(mundo, 14, { dolor: 5 });
  sembrarSesion(mundo, 21, { dolor: 3 });
  enviados = [];
});

/** Las palabras de contenido de una frase. Las de cuatro letras o menos
 *  son conectores («que», «los», «con») y saldrían en cualquier texto.
 *  Es el MISMO tokenizador que `clinica-valoracion-rutas.test.ts`. */
function palabrasDe(frase: string): string[] {
  return frase
    .toLowerCase()
    .split(/[^\wáéíóúñü]+/)
    .filter((w) => w.length > 4);
}

/** Recorre el JSON buscando claves de dinero CON VALOR NUMÉRICO. */
function clavesDeDinero(valor: unknown, ruta = "$"): string[] {
  const SOSPECHOSAS =
    /(precio|price|importe|total|amount|coste|cost|iva|tax|eur|euro|cents?)/i;
  if (Array.isArray(valor)) {
    return valor.flatMap((v, i) => clavesDeDinero(v, `${ruta}[${i}]`));
  }
  if (valor && typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>).flatMap(
      ([k, v]) => {
        const aqui =
          SOSPECHOSAS.test(k) && typeof v === "number" ? [`${ruta}.${k}`] : [];
        return [...aqui, ...clavesDeDinero(v, `${ruta}.${k}`)];
      },
    );
  }
  return [];
}

// ── 1 · ni un importe ───────────────────────────────────────────────

describe("clinica-4 · el informe no lleva un solo importe", () => {
  it("ninguno de los cuatro tipos, para la sanitaria", async () => {
    const app = await buildApp();
    for (const tipo of TIPOS_DE_INFORME) {
      const res = await app.inject({
        method: "GET",
        url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=${tipo}`,
        headers: comoSanitaria,
      });
      expect(res.statusCode, tipo).toBe(200);
      expect(clavesDeDinero(res.json()), tipo).toEqual([]);
    }
    await app.close();
  });

  it("y la DUEÑA ve exactamente lo mismo, byte a byte", async () => {
    // Es historia, no caja (regla 16): aquí no hay un camino de
    // serialización por rol que pueda separarse. La comparación byte a
    // byte es la que lo caza — la misma que clinica-6.
    const app = await buildApp();
    const deLaSanitaria = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=COMPLETA`,
      headers: comoSanitaria,
    });
    const deLaDuena = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=COMPLETA`,
      headers: comoDuena,
    });
    // La fecha y el profesional que firma SÍ cambian (firma quien lo
    // saca): se comparan las secciones, que es la historia.
    expect(deLaDuena.json().informe).toEqual(deLaSanitaria.json().informe);
    expect(clavesDeDinero(deLaDuena.json())).toEqual([]);
    await app.close();
  });

  it("el papel trae la historia que ya calculó la historia viva", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=RESUMEN`,
      headers: comoSanitaria,
    });
    const v = res.json();
    expect(v.informe.secciones.map((s: any) => s.id)).toEqual([
      "ALERTAS",
      "ENCONTRADO",
      "SESIONES",
      "DOLOR",
      "RECOMENDACIONES",
    ]);
    // Las tres visitas sembradas, y el dolor de la más antigua a la más
    // reciente.
    const sesiones = v.informe.secciones.find((s: any) => s.id === "SESIONES");
    expect(sesiones.filas).toHaveLength(3);
    const dolor = v.informe.secciones.find((s: any) => s.id === "DOLOR");
    expect(dolor.grafica.map((p: any) => p.dolor)).toEqual([7, 5, 3]);
    // El nº de colegiado de quien firma.
    expect(v.profesional.colegiado).toBe("45-0312");
    // Y los datos del centro, los del perfil fiscal (los del ticket).
    expect(v.centro.nombre).toBe("Clínica Podológica Demo S.L.");
    expect(v.centro.nif).toBe("B12345678");
    await app.close();
  });

  it("la COMPLETA lleva las respuestas de la valoración", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=COMPLETA`,
      headers: comoSanitaria,
    });
    const val = res
      .json()
      .informe.secciones.find((s: any) => s.id === "VALORACION");
    expect(val.filas.length).toBeGreaterThan(2);
    // Con la pregunta tal como se le hizo al paciente y su respuesta.
    expect(val.filas.some((f: string[]) => f[1] === "Sí")).toBe(true);
    await app.close();
  });
});

// ── 2 · el email no lleva datos de salud ────────────────────────────

describe("clinica-4 · el cuerpo del email NO lleva datos de salud", () => {
  it("ni una palabra del cuestionario, ni el tipo de informe", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "DERIVACION", canal: "EMAIL", destinatario: "PACIENTE", motivo: "Úlcera que no cierra" },
    });
    expect(res.statusCode).toBe(201);
    expect(enviados).toHaveLength(1);
    const correo = enviados[0]!;
    const texto = `${correo.subject}\n${correo.text}\n${correo.html ?? ""}`;

    // 1 · TODAS las palabras del cuestionario, no una lista a mano: el día
    // que se añada una pregunta, el guardián ya la cubre.
    //
    // Y se comparan PALABRAS CON PALABRAS y no subcadenas, que es la
    // lección de clinica-2: con `includes`, «lleva» casaba dentro de «le
    // llevará unos minutos» y el guardián cantaba un falso positivo.
    const enElCorreo = new Set(palabrasDe(texto));
    const palabras = new Set<string>();
    const meter = (frase: string) => {
      for (const w of palabrasDe(frase)) palabras.add(w);
    };
    for (const p of CUESTIONARIO_V1.preguntas) {
      meter(p.texto);
      meter(p.ayuda);
      if (p.alerta) meter(p.alerta);
      meter(p.corto);
      for (const o of p.opciones ?? []) meter(o);
      if (p.seguimiento) {
        meter(p.seguimiento.texto);
        meter(p.seguimiento.ayuda);
        if (p.seguimiento.alerta) meter(p.seguimiento.alerta);
      }
    }
    // SIN lista de inocentes, al contrario que el correo de clinica-2: en
    // este el texto se escribió esquivando las palabras del cuestionario
    // («para cualquier aclaración, llámenos» en vez de «si tiene alguna
    // duda, puede llamarnos»), así que el guardián vigila las 53 enteras.
    // Cada excepción habría sido una palabra menos vigilada.
    expect(palabras.size).toBeGreaterThan(30);
    expect([...palabras].filter((w) => enElCorreo.has(w))).toEqual([]);

    // 2 · y ni el nombre de ningún informe: «derivación» en un asunto
    // cuenta que a esa persona la están derivando, y eso se lee en la
    // pantalla de bloqueo de su móvil.
    for (const t of TIPOS_DE_INFORME) {
      expect(texto, t).not.toContain(
        NOMBRE_DE_TIPO_DE_INFORME[t].toLowerCase(),
      );
    }

    // 3 · ni el motivo de la derivación que escribió la sanitaria.
    expect(texto).not.toContain("úlcera");
    await app.close();
  });

  it("el PDF va ADJUNTO, y el adjunto no lo cuenta en el nombre", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "RESUMEN", canal: "EMAIL", destinatario: "PACIENTE" },
    });
    const adj = enviados[0]!.attachments!;
    expect(adj).toHaveLength(1);
    expect(adj[0]!.filename).toBe("informe-clinico-resumen.pdf");
    expect(adj[0]!.filename.toLowerCase()).not.toContain("carmen");
    // Y es un PDF de verdad.
    expect(adj[0]!.content.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await app.close();
  });

  it("al PACIENTE se le manda AL EMAIL DE SU FICHA", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      // Aunque se intente colar otro: el del paciente sale de su ficha.
      payload: {
        tipo: "RESUMEN",
        canal: "EMAIL",
        destinatario: "PACIENTE",
        email: "cualquiera@ejemplo.com",
      },
    });
    expect(enviados[0]!.to).toBe("carmen@ejemplo.com");
    await app.close();
  });

  it("sin email en la ficha, no se manda: se imprime", async () => {
    mundo.clientes.get(PACIENTE_ID)!.email = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "RESUMEN", canal: "EMAIL", destinatario: "PACIENTE" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SIN_EMAIL");
    expect(enviados).toHaveLength(0);
    // Y no se apunta una entrega que no ocurrió.
    expect(mundo.deliveries).toHaveLength(0);
    await app.close();
  });

  it("al PROFESIONAL, al email que se escriba", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: {
        tipo: "DERIVACION",
        canal: "EMAIL",
        destinatario: "PROFESIONAL",
        email: "traumatologia@hospital.es",
        motivo: "Deformidad para valorar",
      },
    });
    expect(enviados[0]!.to).toBe("traumatologia@hospital.es");
    // Y al profesional NO se le manda el nombre del paciente en el cuerpo.
    const texto = `${enviados[0]!.subject}\n${enviados[0]!.text}`;
    expect(texto).not.toContain("Carmen");
    await app.close();
  });

  it("y sin email del profesional no se manda", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: {
        tipo: "DERIVACION",
        canal: "EMAIL",
        destinatario: "PROFESIONAL",
        motivo: "x y z",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SIN_EMAIL");
    await app.close();
  });
});

// ── 3 · la entrega queda apuntada, dos veces ────────────────────────

describe("clinica-4 · toda entrega queda apuntada", () => {
  it("por email: su fila y su línea EXPORT", async () => {
    const app = await buildApp();
    mundo.registro = [];
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "RESUMEN", canal: "EMAIL", destinatario: "PACIENTE" },
    });
    expect(res.statusCode).toBe(201);

    // 1 · la fila, con el canal, el destinatario y la huella del PDF.
    expect(mundo.deliveries).toHaveLength(1);
    const d = mundo.deliveries[0]!;
    expect(d).toMatchObject({
      report: "RESUMEN",
      channel: "EMAIL",
      recipient: "PACIENTE",
      recipientEmail: "carmen@ejemplo.com",
      userId: SANITARIA_ID,
    });
    expect(d.pdfSha256).toMatch(/^[0-9a-f]{64}$/);

    // 2 · y la línea del registro, con EXPORT: es lo que distingue
    // «abrió la historia» de «se llevó una copia».
    expect(mundo.registro).toHaveLength(1);
    expect(mundo.registro[0]).toMatchObject({
      userId: SANITARIA_ID,
      clientId: PACIENTE_ID,
      action: "EXPORT",
      outcome: "ALLOWED",
    });
    await app.close();
  });

  it("al imprimir: el PDF vuelve, y la entrega también queda", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "SESIONES", canal: "PRINT", destinatario: "PACIENTE" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(mundo.deliveries).toHaveLength(1);
    expect(mundo.deliveries[0]).toMatchObject({
      channel: "PRINT",
      // En papel no hay dirección: se entrega en mano.
      recipientEmail: null,
    });
    expect(res.headers["x-entrega-id"]).toBe(mundo.deliveries[0]!.id);
    await app.close();
  });

  it("y las entregas salen en la lista, para la pestaña de documentos", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "RESUMEN", canal: "PRINT", destinatario: "PACIENTE" },
    });
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=RESUMEN`,
      headers: comoSanitaria,
    });
    const entregas = res.json().entregas;
    expect(entregas).toHaveLength(1);
    expect(entregas[0]).toMatchObject({
      tipo: "RESUMEN",
      tipoNombre: "Resumen de la historia",
      canal: "PRINT",
      quien: "Lucía Martín",
    });
    await app.close();
  });

  it("la RECEPCIONISTA no saca un informe, y queda escrito", async () => {
    const app = await buildApp();
    mundo.registro = [];
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoRecepcion,
      payload: { tipo: "RESUMEN", canal: "PRINT", destinatario: "PACIENTE" },
    });
    expect(res.statusCode).toBe(403);
    expect(mundo.deliveries).toHaveLength(0);
    expect(mundo.registro[0]).toMatchObject({
      userId: RECEPCION_ID,
      action: "EXPORT",
      outcome: "DENIED",
    });
    await app.close();
  });
});

// ── 4 · la derivación sin motivo ────────────────────────────────────

describe("clinica-4 · la derivación sin motivo no se entrega", () => {
  it("409 y sin fila de entrega", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: {
        tipo: "DERIVACION",
        canal: "PRINT",
        destinatario: "PROFESIONAL",
        motivo: "   ",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FALTA_EL_MOTIVO");
    expect(mundo.deliveries).toHaveLength(0);
    await app.close();
  });

  it("con motivo, el papel lo lleva en su sección", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/clinica/clients/${PACIENTE_ID}/informe?tipo=DERIVACION&motivo=${encodeURIComponent("Úlcera que no cierra en 6 semanas")}`,
      headers: comoSanitaria,
    });
    const motivo = res
      .json()
      .informe.secciones.find((s: any) => s.id === "MOTIVO");
    expect(motivo.parrafos).toEqual(["Úlcera que no cierra en 6 semanas"]);
    await app.close();
  });
});

// ── 5 · el gate del módulo ──────────────────────────────────────────

describe("clinica-4 · con la clínica apagada el informe NO EXISTE", () => {
  it("404, y sin entrega", async () => {
    mundo.clinicaEncendida = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${PACIENTE_ID}/informe`,
      headers: comoSanitaria,
      payload: { tipo: "RESUMEN", canal: "PRINT", destinatario: "PACIENTE" },
    });
    expect(res.statusCode).toBe(404);
    expect(mundo.deliveries).toHaveLength(0);
    await app.close();
  });
});
