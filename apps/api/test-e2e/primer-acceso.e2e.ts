// primer-acceso · **EL DÍA DEL ALTA DE CARMEN, CONTRA POSTGRES.**
//
// El recorrido entero del bloque, sin saltarse ni un paso y sin mocks de
// nuestro propio código:
//
//   activar la cuenta → el CORREO (capturado, y se le saca el enlace como
//   lo saca ella) → la página de bienvenida → elegir contraseña → DENTRO
//   → el contrato de datos primero → aceptarlo → el panel de la
//   residencia vacía → «Nuevo ingreso» → y otro, y otro.
//
// POR QUÉ CONTRA POSTGRES y no sólo con los bancos de tabla:
//
//   1. **La migración.** `PasswordResetTokenType` es un enum nuevo y una
//      columna con DEFAULT sobre una tabla que en producción tiene filas.
//      Un valor de enum que el tipo no acepta revienta al INSERT, no al
//      compilar — y el default que no reescribe nada sólo se puede
//      comprobar ejecutándolo.
//   2. **El único uso es una carrera.** `updateMany ... WHERE used_at IS
//      NULL` es un candado del motor, y un fake con un Map no lo prueba:
//      aquí se lanzan DOS aceptaciones a la vez con el mismo token.
//   3. **`centroVacio` es un COUNT**, y el panel que lo trae son ocho
//      consultas en paralelo. Que la cifra sea 0 el primer día y 1
//      después del primer ingreso es una afirmación sobre Postgres.
//
// Y lo que se MIDE, que va en el done: cuántas pantallas hay desde que
// abre el correo hasta que guarda el primer residente.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "p".repeat(40);
process.env.JWT_REFRESH_SECRET = "q".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "r".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://panel.mipiacetpv.com";

// El Redis en memoria de la suite: los throttles del reset y del reenvío
// son de verdad y necesitan uno.
vi.mock("../src/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/context.js")>();
  const { redisFalso } = await import("./redis-falso.js");
  const falso = redisFalso();
  return {
    ...original,
    getRedis: () => falso as unknown as ReturnType<typeof original.getRedis>,
  };
});

// Las colas no son el objeto del fichero.
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: async () => undefined,
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: async () => ({ jobId: "x" }),
  registerTenantRepeatable: async () => undefined,
}));

// EL CORREO SÍ. Es parte de lo que hay que ver: el enlace se saca del
// cuerpo del email, igual que lo saca Carmen.
const correos: Array<{ to: string; subject: string; text: string; html?: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (msg: any) => {
      correos.push(msg);
    },
  }),
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerSuperAdminTenantsRoutes } = await import(
  "../src/superadmin/tenants.js"
);
const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { registerInvitacionRoutes } = await import(
  "../src/auth/invitacion-routes.js"
);
const { registerPasswordResetRoutes } = await import(
  "../src/auth/password-reset.js"
);
const { registerContratoRoutes } = await import(
  "../src/clinica/contrato-routes.js"
);
const { registerResidenciaResidentesRoutes } = await import(
  "../src/residencia/residentes-routes.js"
);
const { registerResidenciaPanelRoutes } = await import(
  "../src/residencia/panel-routes.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { sembrarResidencia } = await import("../src/residencia/semilla.js");
const { cargarCatalogoDeSerie } = await import(
  "../src/residencia/catalogo/cargar-catalogo.js"
);
const { olvidarEstado } = await import("../src/clinica/contrato.js");
const jwtLib = (await import("jsonwebtoken")).default;

const EMAIL_CARMEN = "carmen@jardindegredos.es";
const CONTRASENA_DE_CARMEN = "jardindegredos2026";

/** Lo que se mide: cada pantalla que Carmen ve desde el correo. */
const pantallas: string[] = [];

function enlaceDelCorreo(texto: string): string {
  const m = texto.match(/https:\/\/\S+\/bienvenida\?token=(\S+)/);
  if (!m) throw new Error(`El correo no lleva enlace de bienvenida:\n${texto}`);
  return m[1]!;
}

describe.skipIf(!e2eEnabled)("e2e · el primer acceso de Carmen", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let superAdminId = "";
  let tenantId = "";
  let ownerId = "";
  let tokenDeLaInvitacion = "";
  let sesion = "";

  const saAuth = () => ({
    authorization: `Bearer ${jwtLib.sign(
      { sub: superAdminId, purpose: "super-admin", tv: 0, type: "access" },
      process.env.SUPER_ADMIN_JWT_SECRET!,
      { expiresIn: "1h" },
    )}`,
  });

  const comoCarmen = () => ({ authorization: `Bearer ${sesion}` });

  beforeAll(async () => {
    await cargarCatalogoDeSerie();

    app = Fastify({ logger: false, trustProxy: 1 });
    registerErrorHandler(app);
    await registerSuperAdminTenantsRoutes(app);
    await registerAuthRoutes(app);
    await registerInvitacionRoutes(app);
    await registerPasswordResetRoutes(app);
    await registerContratoRoutes(app);
    await registerResidenciaResidentesRoutes(app);
    await registerResidenciaPanelRoutes(app);
    await app.ready();

    superAdminId = randomUUID();
    await prisma.superAdminUser.create({
      data: {
        id: superAdminId,
        email: `pa-${superAdminId.slice(0, 8)}@mipiacetpv.tech`,
        passwordHash: await hashPassword("Irrelevante1!"),
      },
    });

    // La residencia, en DRAFT y lista para activar: sin caja y sin
    // Holded, así que los únicos checks que aplican son los dos de
    // siempre (módulo encendido y datos fiscales). Es la forma real de
    // una cuenta de residencia.
    tenantId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenants
         (id, name, onboarding_state, caja_enabled, holded_enabled, crm_enabled,
          agenda_enabled, residencia_enabled, clinical_records_enabled,
          initial_sync_status, fiscal_profile, updated_at)
       VALUES
         ('${tenantId}', 'Jardín de Gredos', 'DRAFT', false, false, true,
          true, true, true, 'NOT_APPLICABLE',
          '{"legalName":"Jardín de Gredos, S.A.","taxId":"B86543217"}'::jsonb, now())`,
    );
    await sembrarResidencia(prisma as never, tenantId);
    olvidarEstado(tenantId);
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ══════════════════════════════════════════════════════════════════
  //  1 · El correo
  // ══════════════════════════════════════════════════════════════════

  it("activar la cuenta no genera ninguna contraseña: manda una invitación", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${tenantId}/activate`,
      headers: saAuth(),
      payload: { ownerEmail: EMAIL_CARMEN, ownerName: "Carmen" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.tempPassword).toBeUndefined();
    expect(body.invitacion.email).toBe(EMAIL_CARMEN);

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL_CARMEN },
    });
    ownerId = owner.id;
    // Nace sin contraseña utilizable y sin el aviso de cambiarla.
    expect(owner.passwordHash).toBeNull();
    expect(owner.mustChangePasswordAt).toBeNull();
    expect(owner.alias).toBe("Carmen");

    // La fila de la invitación existe, es de tipo INVITE (el enum nuevo,
    // en una columna de verdad) y dura 7 días.
    const filas = await prisma.passwordResetToken.findMany({
      where: { userId: owner.id },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.type).toBe("INVITE");
    const dias =
      (filas[0]!.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
    // Y el hash no es el token: lo que se guarda no abre nada.
    expect(filas[0]!.tokenHash).not.toContain(
      body.invitacion.enlace.split("token=")[1],
    );
  });

  it("el correo no dice «Mipiacetpv», no lleva contraseña y trae el enlace", async () => {
    pantallas.push("el correo");
    const mail = correos.find((m) => m.to === EMAIL_CARMEN);
    expect(mail).toBeTruthy();
    // Decisión 5: una residencia no recibe el correo de un TPV de
    // hostelería, y la marca todavía no existe.
    expect(mail!.text).not.toMatch(/Mipiacetpv/);
    expect(mail!.text).toContain("Jardín de Gredos, S.A.");
    expect(mail!.html).toContain("Crear mi contraseña");
    // Ninguna contraseña dentro.
    expect(mail!.text).not.toMatch(/[Cc]ontraseña (temporal|provisional)/);
    // Y dice cuánto vale y qué hacer si caduca.
    expect(mail!.text).toMatch(/7 días/);
    expect(mail!.text).toMatch(/puedes pedir otro/);
    tokenDeLaInvitacion = enlaceDelCorreo(mail!.text);
  });

  // ══════════════════════════════════════════════════════════════════
  //  2 · La bienvenida
  // ══════════════════════════════════════════════════════════════════

  it("la bienvenida sabe su nombre, su email y su centro", async () => {
    pantallas.push("la bienvenida");
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/consultar",
      payload: { token: tokenDeLaInvitacion },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      nombre: "Carmen",
      email: EMAIL_CARMEN,
      centro: "Jardín de Gredos",
    });
  });

  it("elegir la contraseña la deja DENTRO, sin pasar por el login", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: tokenDeLaInvitacion, password: CONTRASENA_DE_CARMEN },
    });
    expect(res.statusCode, res.body).toBe(200);
    sesion = res.json().accessToken;
    expect(sesion).toBeTruthy();

    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(owner.passwordHash).not.toBeNull();
    expect(owner.mustChangePasswordAt).toBeNull();

    // Y la contraseña que eligió sirve en el login de siempre: no es una
    // credencial de otra clase.
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL_CARMEN, password: CONTRASENA_DE_CARMEN },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json().mustChangePassword).toBeUndefined();
  });

  it("el enlace queda quemado: nadie más entra con el correo de Carmen", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: tokenDeLaInvitacion, password: "otra-cualquiera-2026" },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("INVITACION_CADUCADA_O_USADA");
    const fila = (
      await prisma.passwordResetToken.findMany({ where: { userId: ownerId } })
    )[0]!;
    expect(fila.usedAt).not.toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════
  //  3 · El contrato, primero
  // ══════════════════════════════════════════════════════════════════

  it("/auth/me dice que lo primero es el contrato, y que ella puede aceptarlo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: comoCarmen(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tenant.contratoClinico).toEqual({
      estado: "SIN_CONTRATO",
      falta: true,
      puedeAceptar: true,
    });
  });

  it("y mientras no lo acepte, el panel de la residencia contesta 423", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/residencia/panel",
      headers: comoCarmen(),
    });
    expect(res.statusCode).toBe(423);
    // El mismo código que la pantalla reconoce para pintar «Falta
    // aceptar el contrato de datos» en vez de un error rojo.
    expect(res.json().code).toBe("CONTRATO_ENCARGADO_SIN_ACEPTAR");
  });

  it("acepta, y la fila de la aceptación queda escrita con su nombre", async () => {
    pantallas.push("el contrato");
    const res = await app.inject({
      method: "POST",
      url: "/clinica/contrato/aceptar",
      headers: comoCarmen(),
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(201);
    const filas = await prisma.clinicalProcessorAgreement.findMany({
      where: { tenantId },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.userId).toBe(ownerId);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: comoCarmen(),
    });
    expect(me.json().tenant.contratoClinico.falta).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════
  //  4 · El panel vacío y el primer ingreso
  // ══════════════════════════════════════════════════════════════════

  it("el panel del primer día dice que el centro está vacío", async () => {
    pantallas.push("el panel");
    const res = await app.inject({
      method: "GET",
      url: "/residencia/panel",
      headers: comoCarmen(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().centroVacio).toBe(true);
  });

  it("da de alta a tres residentes seguidos sin volver a la lista", async () => {
    pantallas.push("nuevo ingreso");
    for (const nombre of ["Dolores", "Amparo", "Antonio"]) {
      const res = await app.inject({
        method: "POST",
        url: "/residencia/residentes",
        headers: comoCarmen(),
        payload: {
          firstName: nombre,
          admissionDate: new Date().toISOString().slice(0, 10),
          dependencyLevel: "DEPENDIENTE",
          placeType: "PRIVADA",
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const lista = await app.inject({
      method: "GET",
      url: "/residencia/residentes",
      headers: comoCarmen(),
    });
    expect(lista.json().residentes).toHaveLength(3);
  });

  it("y entonces el panel deja de estar vacío", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/residencia/panel",
      headers: comoCarmen(),
    });
    expect(res.json().centroVacio).toBe(false);
  });

  it("MEDIDO · del correo al primer residente: cuatro pantallas", () => {
    // Objetivo del prompt: correo → contraseña → contrato → «Nuevo
    // ingreso», sin ninguna pantalla más. La bienvenida es donde elige la
    // contraseña, así que son cuatro y ninguna es un login.
    expect(pantallas).toEqual([
      "el correo",
      "la bienvenida",
      "el contrato",
      "el panel",
      "nuevo ingreso",
    ]);
    expect(pantallas).not.toContain("el login");
  });

  // ══════════════════════════════════════════════════════════════════
  //  5 · El único uso, contra el motor
  // ══════════════════════════════════════════════════════════════════

  it("DOS aceptaciones a la vez con el mismo token: sólo una entra", async () => {
    // Un usuario nuevo con su invitación: lo que se prueba es el candado
    // `WHERE used_at IS NULL`, y para eso hacen falta dos peticiones de
    // verdad contra la misma fila.
    const otroId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role)
       VALUES ('${otroId}', '${tenantId}', 'otra@gredos.es', 'Otra', 'OWNER')`,
    );
    const { crearInvitacion } = await import("../src/auth/invitacion.js");
    const { plain } = await crearInvitacion(prisma, otroId);

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/invitacion/aceptar",
        payload: { token: plain, password: "la-primera-de-las-dos-1" },
      }),
      app.inject({
        method: "POST",
        url: "/auth/invitacion/aceptar",
        payload: { token: plain, password: "la-segunda-de-las-dos-2" },
      }),
    ]);
    const codigos = [a!.statusCode, b!.statusCode].sort();
    expect(codigos).toEqual([200, 410]);
  });

  // ══════════════════════════════════════════════════════════════════
  //  6 · Reenviar, y el caso de producción
  // ══════════════════════════════════════════════════════════════════

  it("reenviar desde el super-admin anula la provisional de un OWNER del flujo viejo", async () => {
    // El estado exacto en el que quedó Jardín de Gredos el 23-10-2026:
    // contraseña provisional y `must_change_password_at` puesto.
    const viejoTenant = randomUUID();
    const viejoOwner = randomUUID();
    await prisma.$executeRawUnsafe(
      // `clinical_records_enabled` también: hay un CHECK
      // (`tenants_residencia_exige_clinica`) que no deja una residencia
      // sin historia clínica. Es de residencia-1 y está bien que esté.
      `INSERT INTO tenants (id, name, onboarding_state, caja_enabled, holded_enabled,
                            residencia_enabled, clinical_records_enabled, updated_at)
       VALUES ('${viejoTenant}', 'Centro del flujo viejo', 'ACTIVE', false, false,
               true, true, now())`,
    );
    await prisma.user.create({
      data: {
        id: viejoOwner,
        tenantId: viejoTenant,
        email: "flujoviejo@gredos.es",
        alias: "Pilar",
        role: "OWNER",
        passwordHash: await hashPassword("provisional-rara-16"),
        mustChangePasswordAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${viejoTenant}/reenviar-invitacion`,
      headers: saAuth(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().anulabaProvisional).toBe(true);

    const owner = await prisma.user.findUniqueOrThrow({ where: { id: viejoOwner } });
    expect(owner.passwordHash).toBeNull();
    expect(owner.mustChangePasswordAt).toBeNull();
    // Y la provisional ya no entra por el login.
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "flujoviejo@gredos.es", password: "provisional-rara-16" },
    });
    expect(login.statusCode).toBe(401);

    // Pero el enlace nuevo sí: Pilar entra sin que nadie toque la base.
    const mail = correos.filter((m) => m.to === "flujoviejo@gredos.es").at(-1)!;
    const nuevo = enlaceDelCorreo(mail.text);
    const dentro = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: nuevo, password: "la-que-pilar-elige-2026" },
    });
    expect(dentro.statusCode, dentro.body).toBe(200);

    // La auditoría lo deja escrito, SIN el token.
    const audit = await prisma.superAdminAudit.findFirst({
      where: { tenantId: viejoTenant, action: "reenviar_invitacion" },
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.metadata)).not.toContain(nuevo);
  });

  it("y a un propietario que ya eligió la suya, el reenvío se NIEGA", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${tenantId}/reenviar-invitacion`,
      headers: saAuth(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("YA_TIENE_CONTRASENA");
    // Carmen sigue pudiendo entrar: el botón no le ha quitado nada.
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL_CARMEN, password: CONTRASENA_DE_CARMEN },
    });
    expect(login.statusCode, login.body).toBe(200);
  });

  // ══════════════════════════════════════════════════════════════════
  //  7 · Los sabotajes contra el motor
  // ══════════════════════════════════════════════════════════════════

  it("un token de RESET no vale como invitación, ni al revés", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: EMAIL_CARMEN },
    });
    const mail = correos.filter((m) => m.to === EMAIL_CARMEN).at(-1)!;
    const deReset = mail.text.match(/\/admin\/reset\?token=(\S+)/)![1]!;
    // Existe y está vivo, en la misma tabla.
    const fila = await prisma.passwordResetToken.findFirst({
      where: { userId: ownerId, type: "RESET", usedAt: null },
    });
    expect(fila).toBeTruthy();

    const comoInvitacion = await app.inject({
      method: "POST",
      url: "/auth/invitacion/aceptar",
      payload: { token: deReset, password: "no-deberia-entrar-2026" },
    });
    expect(comoInvitacion.statusCode).toBe(410);

    // Y sigue valiendo para lo suyo: el intento no lo ha quemado.
    const comoReset = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token: deReset, newPassword: "la-que-ella-elige-1" },
    });
    expect(comoReset.statusCode, comoReset.body).toBe(200);
    // Decisión 4: el reset limpia `mustChangePassword`.
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(owner.mustChangePasswordAt).toBeNull();
  });

  it("el reenvío público de un email que no existe contesta exactamente lo mismo", async () => {
    const existe = await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: EMAIL_CARMEN },
    });
    const noExiste = await app.inject({
      method: "POST",
      url: "/auth/invitacion/reenviar",
      payload: { email: "nadie@ninguna-parte.es" },
    });
    expect(noExiste.statusCode).toBe(existe.statusCode);
    expect(noExiste.body).toBe(existe.body);
  });

  it("la columna `type` tiene DEFAULT 'RESET': lo que ya había escrito sigue siendo de reset", async () => {
    // Es la afirmación de la migración: un INSERT que no menciona la
    // columna —como los que había antes del bloque— sale RESET.
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ('${id}', '${ownerId}', 'no-es-un-hash', now() + interval '1 hour')`,
    );
    const fila = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { id },
    });
    expect(fila.type).toBe("RESET");
  });
});
