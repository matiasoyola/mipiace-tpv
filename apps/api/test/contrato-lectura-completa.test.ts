// contrato-lectura-completa · **LA API NO ACEPTA UN CONTRATO QUE NO SE HA
// RECORRIDO.**
//
// Decisión 3 del bloque: la aceptación registra que el texto completo se
// mostró y se recorrió hasta el final, y el instante en que el final llegó
// a la pantalla. La regla vive en el CAMINO DE ESCRITURA, no sólo en la
// pantalla.
//
// Por qué hace falta aquí y no basta con desactivar el botón: la pantalla
// se puede saltar. Un `curl` con el token de la dueña escribiría la misma
// fila sin haber pintado una letra, y esa fila es la que un día tiene que
// contestar «yo eso no lo leí». Una prueba que se firma sin haber abierto
// el documento no demuestra nada.
//
// Sabotajes que este fichero pone en rojo:
//   · quitar la negativa de `aceptarContrato` (cualquier `curl` acepta);
//   · dejar de declarar `textoMostradoCompleto` en el `schema` de la ruta
//     (con `additionalProperties: false` Fastify lo BORRA en silencio, y
//     entonces NADIE puede aceptar nunca: 400 eterno);
//   · guardar el instante del aparato tal cual (una tablet con el reloj
//     en 2030 dejaría una fila que dice que el contrato se leyó en 2030);
//   · dejar de devolver `textoRecorridoEn` en la vista (la pantalla ya no
//     puede enseñar de qué aceptaciones consta).

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { contratoFake, kekDePrueba, llaveroFake } from "./clinica-7-claves-fake.js";

kekDePrueba();

const TENANT = "00000000-0000-0000-0000-000000000001";
const DUENA = "11111111-1111-1111-1111-111111111111";

const llavero = llaveroFake();
const contrato = contratoFake(TENANT, DUENA);

const fakePrisma: any = {
  clinicalTenantKey: llavero.modelo,
  clinicalProcessorAgreement: contrato.modelo,
  tenant: {
    findUnique: vi.fn(async ({ select }: any) =>
      select?.blockedAt !== undefined
        ? { blockedAt: null, blockedReason: null }
        : { clinicalRecordsEnabled: true },
    ),
    findFirst: vi.fn(async () => ({ name: "Clínica", fiscalProfile: null })),
    count: vi.fn(async () => 1),
  },
  user: {
    findFirst: vi.fn(async () => ({ role: "OWNER" })),
    findUnique: vi.fn(async () => ({ role: "OWNER" })),
  },
  store: { findFirst: vi.fn(async () => null) },
  superAdminAudit: { create: vi.fn(async () => ({ id: randomUUID() })) },
};
fakePrisma.tenant.findFirstOrThrow = vi.fn(async () => ({
  name: "Clínica",
  fiscalProfile: null,
}));

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerContratoRoutes } = await import(
  "../src/clinica/contrato-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const { olvidarClaves } = await import("../src/clinica/claves.js");

const comoDuena = {
  authorization: `Bearer ${signAccessToken({
    sub: DUENA,
    tid: TENANT,
    role: "OWNER",
  })}`,
};

async function buildApp() {
  const app = Fastify();
  await registerContratoRoutes(app);
  await app.ready();
  return app;
}

/** Sin contrato aceptado: es el estado en el que se acepta. */
beforeEach(() => {
  llavero.reset();
  contrato.reset();
  contrato.vaciar();
  olvidarEstado();
  olvidarClaves();
});

async function aceptarCon(payload: unknown) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/clinica/contrato/aceptar",
    headers: comoDuena,
    payload: payload as never,
  });
  await app.close();
  return res;
}

// ── 1 · LA NEGATIVA ─────────────────────────────────────────────────

describe("una aceptación que no dice haber recorrido el texto", () => {
  it("un cuerpo VACÍO se rechaza con 400 y su código, y no escribe fila", async () => {
    const res = await aceptarCon({});
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("TEXTO_NO_RECORRIDO");
    // 400 y no 403 ni 409: no es de permisos (es la dueña) ni de estado
    // (no hay nada aceptado) — es que la petición no trae lo que hace
    // falta.
    expect(res.json().message).toContain("Baja hasta el final");
    expect(contrato.filas).toHaveLength(0);
  });

  it("y con el campo a `false`, también: no es «no lo dijo», es «no»", async () => {
    const res = await aceptarCon({ textoMostradoCompleto: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("TEXTO_NO_RECORRIDO");
    expect(contrato.filas).toHaveLength(0);
  });

  it("un valor que no es un booleano se rechaza", async () => {
    // Ojo con lo que este test NO dice. Fastify trae `coerceTypes` de
    // serie, así que la CADENA `"true"` llega al handler como `true` y la
    // aceptación pasa — y está bien que pase: la petición sigue afirmando
    // que el texto se recorrió, sólo lo escribe con otro tipo, y esa
    // coerción es la de las cien rutas de la casa.
    //
    // Lo que no puede pasar es que un valor que no quiere decir nada
    // acabe leyéndose como un sí.
    const res = await aceptarCon({ textoMostradoCompleto: "luego" });
    expect(res.statusCode).toBe(400);
    expect(contrato.filas).toHaveLength(0);
  });
});

// ── 2 · LA ACEPTACIÓN QUE SÍ ────────────────────────────────────────

describe("una aceptación que recorrió el texto", () => {
  it("escribe la fila CON el instante del final", async () => {
    // Que esto dé 201 es, además, el canario del `schema`: con
    // `additionalProperties: false`, un `textoMostradoCompleto` sin
    // declarar no da 400 — Fastify lo BORRA, y el handler vería un cuerpo
    // vacío. O sea: si alguien quita la propiedad del `schema`, este test
    // cae con el 400 de arriba y nadie puede aceptar el contrato.
    const antes = Date.now();
    const res = await aceptarCon({ textoMostradoCompleto: true });
    expect(res.statusCode).toBe(201);
    expect(contrato.filas).toHaveLength(1);
    const fila = contrato.filas[0]!;
    expect(fila.textoRecorridoEn).toBeInstanceOf(Date);
    // Sin instante en el cuerpo vale la hora del servidor.
    expect(fila.textoRecorridoEn!.getTime()).toBeGreaterThanOrEqual(antes);
    expect(fila.textoRecorridoEn!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("guarda el instante QUE DICE LA PANTALLA cuando es creíble", async () => {
    // Treinta segundos atrás: el tiempo que tarda alguien en bajar hasta
    // el final y marcar la casilla.
    const haceTreintaSegundos = new Date(Date.now() - 30_000);
    const res = await aceptarCon({
      textoMostradoCompleto: true,
      finalDelTextoEn: haceTreintaSegundos.toISOString(),
    });
    expect(res.statusCode).toBe(201);
    expect(contrato.filas[0]!.textoRecorridoEn!.toISOString()).toBe(
      haceTreintaSegundos.toISOString(),
    );
  });

  it("un instante DEL FUTURO se cambia por el del servidor", async () => {
    // El reloj de una tablet miente. Una fila que dice que el contrato se
    // leyó dentro de un año no es una prueba: es un reloj mal puesto.
    const dentroDeUnAno = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const res = await aceptarCon({
      textoMostradoCompleto: true,
      finalDelTextoEn: dentroDeUnAno.toISOString(),
    });
    expect(res.statusCode).toBe(201);
    const guardado = contrato.filas[0]!.textoRecorridoEn!;
    expect(guardado.getTime()).toBeLessThanOrEqual(Date.now());
    expect(guardado.toISOString()).not.toBe(dentroDeUnAno.toISOString());
  });

  it("y uno de hace más de un día, también", async () => {
    const haceUnaSemana = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const res = await aceptarCon({
      textoMostradoCompleto: true,
      finalDelTextoEn: haceUnaSemana.toISOString(),
    });
    expect(res.statusCode).toBe(201);
    const guardado = contrato.filas[0]!.textoRecorridoEn!;
    expect(guardado.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("una fecha ilegible NO impide aceptar: vale la del servidor", async () => {
    // Lo que decide el 400 es haber recorrido el texto, no saber estampar
    // un ISO. Misma dirección que el user-agent largo, que se recorta.
    const res = await aceptarCon({
      textoMostradoCompleto: true,
      finalDelTextoEn: "no-soy-una-fecha",
    });
    // El `format: "date-time"` del schema puede atraparla o no según el
    // ajv del despliegue; lo que NO puede pasar es escribir una fila con
    // una fecha inválida dentro.
    if (res.statusCode === 201) {
      expect(contrato.filas[0]!.textoRecorridoEn!.getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
    } else {
      expect(res.statusCode).toBe(400);
      expect(contrato.filas).toHaveLength(0);
    }
  });
});

// ── 3 · LA VISTA LO CUENTA ──────────────────────────────────────────

describe("la vista del contrato", () => {
  it("devuelve `textoRecorridoEn` de la aceptación que lo trae", async () => {
    await aceptarCon({ textoMostradoCompleto: true });
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato",
      headers: comoDuena,
    });
    expect(res.statusCode).toBe(200);
    const aceptaciones = res.json().aceptaciones;
    expect(aceptaciones).toHaveLength(1);
    expect(typeof aceptaciones[0].textoRecorridoEn).toBe("string");
    await app.close();
  });

  it("y `null` en las aceptaciones de antes de la regla: no se midió", async () => {
    // Las ya guardadas NO SE TOCAN (decisión 3). La columna nace NULL en
    // ellas, y la pantalla no afirma nada: escribir que no se leyó sería
    // inventárselo.
    contrato.aceptar();
    olvidarEstado();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/clinica/contrato",
      headers: comoDuena,
    });
    expect(res.json().aceptaciones[0].textoRecorridoEn).toBeNull();
    await app.close();
  });
});
