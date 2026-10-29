import { randomInt } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { estadoDelContratoParaElPanel } from "../clinica/contrato.js";
import { getPrisma } from "../context.js";
import { CAJA_DISABLED_MESSAGE, cajaIsDisabled } from "../lib/caja-gate.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { probeFailureToHttpStatus, probeHoldedKey } from "../holded/probe.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import {
  requireOwner,
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "./middleware.js";
import {
  PIN_FORMAT,
  errorPinTrivial,
  generarPinDeSoporte,
  motivoPinTrivial,
} from "./pin.js";
import { escribirPinYRegistrarlo } from "./pin-registro.js";
import { enqueueInitialSync } from "../queues/initial-sync.js";
import {
  signMustChangePasswordToken,
  verifyMustChangePasswordToken,
} from "./must-change-password.js";
import {
  cashierLoginRateLimit,
  inspect as inspectRateLimit,
  ownerLoginRateLimit,
  registerFailure as registerRateLimitFailure,
  reset as resetRateLimit,
  twoFactorVerifyThrottle,
} from "./rate-limit.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./tokens.js";
import {
  consumeRecoveryCode,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateEnrollment,
  hashRecoveryCodes,
  isRecoveryCode,
  isTotpCode,
  readStoredRecoveryCodes,
  signPending2faToken,
  verifyPending2faToken,
  verifyTotp,
} from "./two-factor.js";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

// JSON Schema centralizado en las rutas (regla de B1).
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/signup",
    {
      schema: {
        body: {
          type: "object",
          required: ["businessName", "email", "password"],
          additionalProperties: false,
          properties: {
            businessName: { type: "string", minLength: 1, maxLength: 200 },
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            password: { type: "string", minLength: 10, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { businessName, email, password } = request.body as {
        businessName: string;
        email: string;
        password: string;
      };
      const prisma = getPrisma();
      const lowerEmail = email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
      if (existing) {
        return reply.code(409).send({
          error: "EMAIL_TAKEN",
          message: "Ya existe una cuenta con ese email",
        });
      }
      const hash = await hashPassword(password);
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const tenant = await tx.tenant.create({
          data: { name: businessName, holdedAuthMode: "API_KEY" },
        });
        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: lowerEmail,
            passwordHash: hash,
            role: "OWNER",
          },
        });
        return { tenant, user };
      });
      const accessToken = signAccessToken({
        sub: result.user.id,
        tid: result.tenant.id,
        role: "OWNER",
      });
      const refreshToken = signRefreshToken(
        { sub: result.user.id, tid: result.tenant.id },
        { tv: result.user.tokenVersion },
      );
      return reply.code(201).send({ accessToken, refreshToken });
    },
  );

  app.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat },
            password: { type: "string", minLength: 1, maxLength: 256 },
            // "Recuérdame en este dispositivo" — alarga el TTL del
            // refresh y el front lo guarda en localStorage. Opcional;
            // por defecto la sesión muere al cerrar pestaña.
            remember: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, remember } = request.body as {
        email: string;
        password: string;
        remember?: boolean;
      };
      const lowerEmail = email.toLowerCase();
      const prisma = getPrisma();
      const rlKey = ownerLoginRateLimit(lowerEmail);
      const pre = await inspectRateLimit(rlKey);
      if (pre.locked) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            pre.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: pre.retryAfterSeconds,
        });
      }
      const user = await prisma.user.findUnique({ where: { email: lowerEmail } });
      // Mensaje genérico — no filtramos si el email existe.
      const GENERIC = { error: "INVALID_CREDENTIALS", message: "Email o contraseña incorrectos" };
      if (!user || !user.passwordHash) {
        await registerRateLimitFailure(rlKey);
        return reply.code(401).send(GENERIC);
      }
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) {
        await registerRateLimitFailure(rlKey);
        return reply.code(401).send(GENERIC);
      }
      // clinica-1 · el sanitario sin caja entra por la MISMA puerta que
      // el cajero: el TPV, con su PIN. Comparte la rama a propósito —
      // caer al `NOT_OWNER_OR_MANAGER` de abajo le diría "sólo
      // propietarios o encargados", que es verdad y es inútil: lo que
      // necesita saber es por dónde SÍ entra.
      if (user.role === "CASHIER" || user.role === "CLINICIAN") {
        // No es un fallo de credenciales (password correcto) — no aplicamos
        // rate-limit. El cajero entra al TPV con PIN, no al admin con
        // password.
        return reply.code(403).send({
          error: "CASHIER_NOT_ALLOWED_IN_ADMIN",
          message:
            "Los cajeros y el personal sanitario sólo pueden acceder desde el TPV con su PIN.",
        });
      }
      if (user.role !== "OWNER" && user.role !== "MANAGER") {
        return reply.code(403).send({
          error: "NOT_OWNER_OR_MANAGER",
          message: "Sólo propietarios o encargados pueden entrar al admin.",
        });
      }
      await resetRateLimit(rlKey);
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // B-SuperAdmin: si el OWNER fue creado por un super-admin con
      // password temporal, mustChangePasswordAt está set y forzamos el
      // cambio antes de emitir sesión real. Sin esto, la temporal
      // seguiría siendo válida indefinidamente.
      if (user.mustChangePasswordAt != null) {
        const pendingPasswordChangeToken = signMustChangePasswordToken({
          sub: user.id,
          tid: user.tenantId,
          role: user.role,
          tv: user.tokenVersion,
        });
        return reply.code(200).send({
          mustChangePassword: true,
          pendingPasswordChangeToken,
        });
      }

      // Si el propietario tiene 2FA activado, no emitimos access/refresh
      // todavía: devolvemos `requires2fa` + `pendingToken` y el front
      // pasa al segundo paso vía POST /auth/login/2fa.
      if (user.twoFactorEnabledAt != null) {
        const pendingToken = signPending2faToken({
          sub: user.id,
          tid: user.tenantId,
          remember: remember === true,
        });
        return reply.code(200).send({ requires2fa: true, pendingToken });
      }

      const accessToken = signAccessToken({
        sub: user.id,
        tid: user.tenantId,
        role: user.role,
      });
      const refreshToken = signRefreshToken(
        { sub: user.id, tid: user.tenantId },
        { tv: user.tokenVersion, remember: remember === true },
      );
      // ── pin-1 · EL LOGIN YA NO GENERA NINGÚN PIN ───────────────────
      //
      // Aquí vivía el PIN de respaldo auto-generado de B7 §9: un OWNER sin
      // PIN entraba por primera vez y la primera pantalla del programa le
      // decía «te hemos asignado el 4817, apúntalo, sólo se muestra una
      // vez».
      //
      // Se va, y es el punto del bloque. Requisito de Matías desde el
      // 18-10: «el PIN debe ser personal y cambiable por el propio
      // usuario desde su panel; no me cuadra que el sistema lo genere y
      // solo se enseñe una vez». El 27-10 se perdió el PIN de la
      // propietaria dos veces en la misma mañana, que es lo que pasa con
      // un número al azar que sólo se enseña una vez.
      //
      // Lo que lo sustituye: **«Elegir PIN» en Mi cuenta**, que la
      // propietaria ya autenticada con email y contraseña usa cuando
      // quiera, sin tener que acordarse de nada. El correo de invitación
      // se lo dice, y ahora es verdad.
      //
      // Lo que esto NO rompe: quien ya tiene PIN sigue con el suyo. Esta
      // rama sólo le tocaba a quien NO tenía — o sea, al primer login de
      // una cuenta nueva.
      //
      // Y la invariante de contrato-lectura-completa (punto 6) se queda
      // más fuerte de lo que estaba: una cuenta SIN CAJA no recibe PIN
      // por ningún camino, porque ya no hay camino que lo genere solo.
      // El gate de la caja sigue puesto en las tres rutas que escriben un
      // PIN del TPV (`/auth/me/pin`, `/auth/me/pin/elegir` y
      // `/auth/me/regenerate-owner-pin`).
      return { accessToken, refreshToken };
    },
  );

  app.post(
    "/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          additionalProperties: false,
          properties: { refreshToken: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      try {
        const payload = verifyRefreshToken(refreshToken);
        const prisma = getPrisma();
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || user.tenantId !== payload.tid) {
          return reply.code(401).send({ error: "INVALID_REFRESH", message: "Sesión inválida" });
        }
        // tokenVersion mismatch → el usuario hizo logout-everywhere o
        // bumpó la versión por otra vía. Rechazar.
        if (payload.tv !== user.tokenVersion) {
          return reply.code(401).send({ error: "INVALID_REFRESH", message: "Sesión revocada" });
        }
        return {
          accessToken: signAccessToken({
            sub: user.id,
            tid: user.tenantId,
            role: user.role,
          }),
          refreshToken: signRefreshToken(
            { sub: user.id, tid: user.tenantId },
            { tv: user.tokenVersion, remember: payload.rmb === 1 },
          ),
        };
      } catch {
        return reply.code(401).send({ error: "INVALID_REFRESH", message: "Refresh inválido" });
      }
    },
  );

  app.post(
    "/auth/logout-everywhere",
    {
      preHandler: requireOwnerOrManager,
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      // Incremento atómico: cualquier refresh en vuelo con el `tv`
      // anterior queda invalidado al siguiente intento de refresh.
      // Los access tokens vivos (≤15 min) siguen valiendo hasta
      // expirar — coste aceptado a cambio de no llevar blacklist.
      const updated = await prisma.user.update({
        where: { id: auth.userId },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      });
      return reply.code(200).send({ tokenVersion: updated.tokenVersion });
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: requireOwnerOrManager,
    },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const [user, tenant] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
        prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } }),
      ]);
      const recovery = readStoredRecoveryCodes(user.twoFactorRecoveryCodes);
      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          twoFactorEnabled: user.twoFactorEnabledAt != null,
          recoveryCodesRemaining: recovery.filter((c) => c.usedAt == null).length,
          // pin-1 · las dos preguntas que «Mi cuenta» necesita para
          // escribir el rótulo correcto, y no se deducen la una de la
          // otra:
          //
          //   · `hasPin: false` → la sección dice «Elige tu PIN», que es
          //     lo que ve una propietaria el primer día (desde este
          //     bloque el sistema ya no le genera ninguno);
          //   · `pinProvisional: true` → tiene uno PRESTADO (soporte se
          //     lo regeneró) y la sección se lo dice, porque con él no va
          //     a poder entrar al TPV sin elegir el suyo.
          //
          // El PIN no sale, ni entero ni parcial ni su hash. Salen dos
          // booleanos sobre su estado.
          hasPin: user.pinHash != null,
          pinProvisional: user.pinProvisionalAt != null,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          hasHoldedKey: tenant.holdedApiKeyCiphertext != null,
          // catalogo-local (addendum 3) · ¿está PREVISTO que use Holded?
          // Distinta pregunta que `hasHoldedKey`, que es "¿lo tiene
          // conectado ya?". El panel necesita las DOS para decidir a
          // dónde entra: sin esta, un comercio de catálogo local cae en
          // /onboarding y no sale nunca (ver `RootRouter` en App.tsx).
          // Sólo lectura aquí; se mueve desde el super-admin, igual que
          // `cajaEnabled`.
          holdedEnabled: tenant.holdedEnabled,
          // holded-desconectar (ADR-020) · la tercera pregunta, y no es
          // deducible de las dos de arriba: `holdedEnabled = false` lo
          // contestan igual el comercio que NACIÓ sin Holded y el que lo
          // DEJÓ con 270 facturas emitidas detrás. El panel las trata
          // distinto — sólo el segundo tiene devoluciones que llevar a mano
          // al asesor, y sólo a él se le enseña esa pantalla.
          holdedDisconnectedAt: tenant.holdedDisconnectedAt?.toISOString() ?? null,
          // puesta-en-marcha (ADR-021) · DESDE CUÁNDO factura esta cuenta.
          // `null` es el ensayo, y el panel del propietario lo avisa en una
          // banda: es la tercera de las tres cosas que impiden que alguien
          // crea que ha facturado (la banda del TPV, el papel marcado y
          // esto).
          //
          // Sólo lectura, como `cajaEnabled`: arrancar lo hace el
          // super-admin en la visita, con el cliente delante.
          facturaDesde: tenant.facturaDesde?.toISOString() ?? null,
          // kds-1-cocina · el VERTICAL del negocio. El panel lo necesita
          // para pintar los alérgenos en la ficha del producto SÓLO en
          // hostelería: en una peluquería o una papelería, catorce
          // casillas de alérgenos son catorce casillas de ruido.
          //
          // Es sólo lectura y lo mueve el super-admin, como `cajaEnabled`.
          businessType: tenant.businessType,
          initialSyncStatus: tenant.initialSyncStatus,
          fiscalProfile: tenant.fiscalProfile ?? null,
          lastIncrementalSyncAt: tenant.lastIncrementalSyncAt?.toISOString() ?? null,
          // H1 (ADR-016) · los módulos del tenant, para que el panel
          // decida a dónde entra y qué esconde SIN una segunda llamada.
          // `cajaEnabled` es de sólo lectura aquí: se mueve desde el
          // super-admin, nunca desde el panel del cliente.
          cajaEnabled: tenant.cajaEnabled,
          crmEnabled: tenant.crmEnabled,
          agendaEnabled: tenant.agendaEnabled,
          // F1 (ADR-018) · el cuarto módulo. Es lo que hace que un colegio
          // sin caja entre a "Control horario" en vez de a su cuenta
          // (`landingSinCaja` en App.tsx). Sólo lectura, como `cajaEnabled`.
          fichajeEnabled: tenant.fichajeEnabled,
          // residencia-5 (decisión de producto 5) · el quinto módulo. Es
          // lo que hace que una residencia entre al **panel de dirección**
          // en vez de a su cuenta (`landingSinCaja` en App.tsx), que es la
          // pantalla donde está la métrica de éxito del producto.
          //
          // Sólo lectura, como los otros cuatro: el interruptor lo mueve
          // el super-admin (D-48).
          residenciaEnabled: tenant.residenciaEnabled,
          // primer-acceso (punto 3) · EL CONTRATO, EN LA MISMA RESPUESTA
          // QUE DECIDE A DÓNDE ENTRA.
          //
          // `RootRouter` tiene que saber si lo primero que ve la
          // propietaria es el contrato de datos, y tenía que saberlo sin
          // una segunda petición: con dos llamadas en serie, la pantalla
          // de inicio parpadea y la dueña ve medio segundo de un panel que
          // va a abandonar.
          //
          // El estado lo calcula la MISMA función pura que decide el 423
          // (`estadoDelTenant` → `@mipiacetpv/contrato-encargado`), así
          // que la redirección y la negativa no pueden discrepar. Y
          // `clinicaEncendida` sale del propio estado: `APAGADO` es
          // exactamente «este negocio no tiene el módulo».
          //
          // Y en una sesión de impersonación va `null`: clinica-7 decisión
          // 24 dice que Mi Piace no abre nada clínico, así que las rutas
          // del contrato le contestan la 404 de siempre. Mandar al
          // super-admin a una pantalla que no existe para él habría roto
          // «configurar» sobre una clínica, que es para lo que la
          // impersonación existe.
          contratoClinico: auth.isImpersonation
            ? null
            : await estadoDelContratoParaElPanel(tenant.id, user.id),
        },
      };
    },
  );

  // Edita el perfil fiscal del tenant (B2 §4.1). El sync inicial lo
  // pre-rellena con datos del almacén default (B1), pero el propietario
  // los reescribe aquí. NO re-sincroniza con Holded: la dirección del
  // ticket es la que el propietario marca, no la que Holded conozca.
  // Spike §08 confirmó que Holded no expone endpoint de account info,
  // así que NIF + razón social son SIEMPRE manuales.
  app.put(
    "/auth/me/fiscal-profile",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            businessName: { type: "string", minLength: 1, maxLength: 200 },
            nif: { type: "string", minLength: 1, maxLength: 32 },
            address: { type: "string", maxLength: 200 },
            postalCode: { type: "string", maxLength: 16 },
            city: { type: "string", maxLength: 80 },
            province: { type: "string", maxLength: 80 },
            country: { type: "string", maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as Record<string, string | undefined>;
      const prisma = getPrisma();
      // Mantenemos los campos previos no enviados (merge superficial).
      // El cliente del admin manda el form completo al guardar, así que
      // en la práctica esto siempre sobreescribe todo.
      const current = await prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { fiscalProfile: true },
      });
      const previous =
        current.fiscalProfile && typeof current.fiscalProfile === "object"
          ? (current.fiscalProfile as Record<string, unknown>)
          : {};
      const merged: Record<string, unknown> = { ...previous };
      // Sobreescribir sólo los que vinieron. La fuente queda marcada
      // como "manual" cuando hay edición (vs "warehouse_default" del
      // sync inicial).
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) merged[k] = v;
      }
      merged.source = "manual";
      merged.updatedAt = new Date().toISOString();

      const updated = await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: { fiscalProfile: merged as Prisma.InputJsonValue },
        select: { fiscalProfile: true },
      });
      return reply.code(200).send({ fiscalProfile: updated.fiscalProfile });
    },
  );

  // Rotación de API Key de Holded (B2 §4.2). Mismo schema de body que
  // /onboarding/connect-holded: el front del admin reutiliza el modal.
  // Sólo sobreescribe el ciphertext si la nueva clave valida — si
  // falla, la antigua se mantiene intacta y devolvemos el error
  // mapeado con el mismo HTTP que el onboarding inicial.
  app.post(
    "/auth/me/rotate-holded-key",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["apiKey"],
          additionalProperties: false,
          properties: {
            apiKey: { type: "string", minLength: 10, maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { apiKey } = request.body as { apiKey: string };

      // holded-desconectar (ADR-020) · esta ruta es `requireOwner` y no
      // tenía ninguna guarda: Ana podía pegar una clave y resucitar Holded
      // en su comercio ella sola. Y el daño no sería teórico — sus fichas
      // conservan `holded_product_id`, así que el sync entraría por la rama
      // `update` del upsert y le desharía los precios que acaba de poner.
      //
      // Se comprueba ANTES del `probeHoldedKey`: no tiene sentido gastar una
      // llamada a Holded para validar una clave que no vamos a guardar.
      //
      // El comercio que nunca tuvo Holded SÍ puede usarla: es el camino de
      // H1 («encender Holded más tarde») y ahí no hay catálogo local que
      // pisar. La puerta es la fecha del corte, no el interruptor.
      const antes = await getPrisma().tenant.findUnique({
        where: { id: auth.tenantId },
        select: { holdedDisconnectedAt: true },
      });
      if (antes?.holdedDisconnectedAt != null) {
        return reply.code(409).send({
          error: "HOLDED_DESCONECTADO",
          message:
            "Este comercio dejó de usar Holded. Volver a conectarlo no es sólo pegar la clave: " +
            "habla con Mi Piace antes de hacer nada.",
        });
      }

      const probe = await probeHoldedKey(apiKey);
      if (!probe.ok) {
        // NUNCA loguear la apiKey ni su longitud. El log identifica el
        // tenant y el motivo del rechazo; el front muestra el message.
        if (probe.code === "HOLDED_UNREACHABLE") {
          request.log.error(
            { tenantId: auth.tenantId, apiKey: "<REDACTED>" },
            `rotate-holded-key falló: ${probe.code}`,
          );
        }
        return reply
          .code(probeFailureToHttpStatus(probe.code))
          .send({ error: probe.code, message: probe.message });
      }

      const env = loadEnv();
      const ciphertext = encryptSecret(apiKey, env.HOLDED_KEY_ENCRYPTION_SECRET);
      const prisma = getPrisma();
      const now = new Date();
      // H1 · ¿rotación o estreno? Mismo criterio que la ruta hermana del
      // super-admin (`PATCH /super-admin/tenants/:id/holded-api-key`):
      // sólo se arranca el sync inicial desde NOT_APPLICABLE.
      const before = await prisma.tenant.findUnique({
        where: { id: auth.tenantId },
        select: { initialSyncStatus: true },
      });
      const estrenaHolded = before?.initialSyncStatus === "NOT_APPLICABLE";
      await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: {
          holdedApiKeyCiphertext: ciphertext,
          holdedAuthMode: "API_KEY",
          ...(estrenaHolded ? { initialSyncStatus: "PENDING" as const } : {}),
        },
      });
      // Rotación: no tocamos initialSyncStatus ni encolamos sync — la
      // rotación típica (clave comprometida → nueva clave de la MISMA
      // cuenta Holded) no necesita resync. Si el propietario cambia de
      // cuenta Holded, puede forzar manualmente con POST
      // /catalog/sync-now. No hay cache en memoria de la API key
      // descifrada — cada job descifra al arrancar, así que la rotación
      // es efectiva sin acción extra del runtime.
      //
      // Estreno (H1): la empresa nació sin Holded y acaba de conectarlo.
      // Aquí sí hay catálogo que traerse por primera vez, así que se
      // encola el sync inicial — el MISMO camino que usa
      // `/onboarding/connect-holded`, sin duplicar su flujo.
      let initialSyncQueued = false;
      if (estrenaHolded) {
        try {
          await enqueueInitialSync(auth.tenantId);
          initialSyncQueued = true;
        } catch (err) {
          request.log.error(
            { tenantId: auth.tenantId },
            `clave guardada pero initial-sync no se pudo encolar: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      return reply.code(200).send({
        ok: true,
        validatedAt: now.toISOString(),
        initialSyncStatus: estrenaHolded
          ? "PENDING"
          : (before?.initialSyncStatus ?? null),
        initialSyncQueued,
      });
    },
  );

  // "Probar conexión" en admin (B2 §4.2). Reusa la API Key cifrada en
  // BD y devuelve un resultado equivalente al de la rotación, sin
  // tocar nada.
  app.post(
    "/auth/me/test-holded-connection",
    {
      preHandler: requireOwnerOrManager,
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id: auth.tenantId },
        select: { holdedApiKeyCiphertext: true },
      });
      if (!tenant?.holdedApiKeyCiphertext) {
        return reply.code(409).send({
          error: "NO_HOLDED_KEY",
          message: "No hay una API Key configurada todavía.",
        });
      }
      const env = loadEnv();
      const apiKey = decryptSecret(
        tenant.holdedApiKeyCiphertext,
        env.HOLDED_KEY_ENCRYPTION_SECRET,
      );
      const probe = await probeHoldedKey(apiKey);
      if (!probe.ok) {
        return reply
          .code(probeFailureToHttpStatus(probe.code))
          .send({ error: probe.code, message: probe.message });
      }
      return reply.code(200).send({ ok: true, validatedAt: new Date().toISOString() });
    },
  );

  // ── 2FA TOTP (B3 §17.3) ────────────────────────────────────────────

  // Genera un secret + QR + recovery codes. NO persiste todavía: el
  // cliente debe confirmar con un código TOTP en `/confirm`.
  app.post(
    "/auth/me/2fa/enable",
    {
      preHandler: requireOwnerOrManager,
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { email: true, twoFactorEnabledAt: true },
      });
      if (user.twoFactorEnabledAt) {
        return reply.code(409).send({
          error: "TWO_FACTOR_ALREADY_ENABLED",
          message: "El 2FA ya está activado. Desactívalo antes de re-emparejar.",
        });
      }
      const enrollment = await generateEnrollment(user.email);
      // Persistimos el secret cifrado y los recovery hasheados — pero
      // `twoFactorEnabledAt` queda NULL hasta `/confirm`. Si el
      // usuario abandona el enroll, los datos sobran pero no afectan
      // (login sigue siendo sin 2FA mientras enabled_at == NULL).
      const recoveryHashed = await hashRecoveryCodes(enrollment.recoveryCodes);
      await prisma.user.update({
        where: { id: auth.userId },
        data: {
          twoFactorSecret: encryptTwoFactorSecret(enrollment.secret),
          twoFactorRecoveryCodes: recoveryHashed as unknown as Prisma.InputJsonValue,
          twoFactorEnabledAt: null,
        },
      });
      return reply.code(200).send({
        qrDataUrl: enrollment.qrDataUrl,
        secret: enrollment.secret,
        recoveryCodes: enrollment.recoveryCodes,
      });
    },
  );

  app.post(
    "/auth/me/2fa/confirm",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { code } = request.body as { code: string };
      const prisma = getPrisma();
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { twoFactorSecret: true, twoFactorEnabledAt: true },
      });
      if (!user.twoFactorSecret) {
        return reply.code(409).send({
          error: "TWO_FACTOR_NOT_ENROLLING",
          message: "No has iniciado el alta de 2FA.",
        });
      }
      if (user.twoFactorEnabledAt) {
        return reply.code(409).send({
          error: "TWO_FACTOR_ALREADY_ENABLED",
          message: "El 2FA ya está activo.",
        });
      }
      const secret = decryptTwoFactorSecret(user.twoFactorSecret);
      if (!verifyTotp(secret, code)) {
        return reply
          .code(401)
          .send({ error: "INVALID_TOTP", message: "Código incorrecto" });
      }
      await prisma.user.update({
        where: { id: auth.userId },
        data: { twoFactorEnabledAt: new Date() },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    "/auth/me/2fa/disable",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["password", "code"],
          additionalProperties: false,
          properties: {
            password: { type: "string", minLength: 1 },
            code: { type: "string", minLength: 6, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { password, code } = request.body as {
        password: string;
        code: string;
      };
      const prisma = getPrisma();
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: {
          passwordHash: true,
          twoFactorSecret: true,
          twoFactorEnabledAt: true,
          twoFactorRecoveryCodes: true,
        },
      });
      if (!user.twoFactorEnabledAt || !user.twoFactorSecret) {
        return reply.code(409).send({
          error: "TWO_FACTOR_NOT_ENABLED",
          message: "El 2FA no está activo.",
        });
      }
      if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
        return reply
          .code(401)
          .send({ error: "INVALID_PASSWORD", message: "Contraseña incorrecta" });
      }
      const secret = decryptTwoFactorSecret(user.twoFactorSecret);
      let authorized = false;
      if (isTotpCode(code) && verifyTotp(secret, code)) authorized = true;
      if (!authorized && isRecoveryCode(code)) {
        const stored = readStoredRecoveryCodes(user.twoFactorRecoveryCodes);
        const consumed = await consumeRecoveryCode(stored, code);
        if (consumed) authorized = true;
      }
      if (!authorized) {
        return reply
          .code(401)
          .send({ error: "INVALID_2FA_CODE", message: "Código incorrecto" });
      }
      await prisma.user.update({
        where: { id: auth.userId },
        data: {
          twoFactorSecret: null,
          twoFactorEnabledAt: null,
          twoFactorRecoveryCodes: Prisma.JsonNull,
        },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // Paso 2 del login con 2FA: el cliente envía `pendingToken` (5 min
  // de TTL) emitido por POST /auth/login + el código del autenticador
  // (6 dígitos) o un recovery code (10 alfanum).
  app.post(
    "/auth/login/2fa",
    {
      schema: {
        body: {
          type: "object",
          required: ["pendingToken", "code"],
          additionalProperties: false,
          properties: {
            pendingToken: { type: "string", minLength: 1 },
            code: { type: "string", minLength: 6, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const { pendingToken, code } = request.body as {
        pendingToken: string;
        code: string;
      };
      let payload;
      try {
        payload = verifyPending2faToken(pendingToken);
      } catch {
        return reply.code(401).send({
          error: "INVALID_PENDING_TOKEN",
          message: "Sesión de 2FA caducada. Vuelve a iniciar sesión.",
        });
      }
      // v1.5-D · Frente 3: throttle de la verificación del código 2FA. El
      // código es de 6 dígitos (10^6 combinaciones) y sin esto sería
      // fuerza-bruteable dentro de la validez del pendingToken. Clave por
      // cuenta (sub), sin IP: acota la fuerza bruta contra la cuenta
      // aunque el atacante rote de IP.
      const rl = await twoFactorVerifyThrottle("owner", payload.sub);
      if (rl.exceeded) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            rl.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }
      const prisma = getPrisma();
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.twoFactorEnabledAt || !user.twoFactorSecret) {
        return reply.code(401).send({
          error: "INVALID_PENDING_TOKEN",
          message: "Sesión de 2FA inválida.",
        });
      }

      let authorized = false;
      let usedRecovery = false;
      if (isTotpCode(code)) {
        const secret = decryptTwoFactorSecret(user.twoFactorSecret);
        authorized = verifyTotp(secret, code);
      }
      if (!authorized && isRecoveryCode(code)) {
        const stored = readStoredRecoveryCodes(user.twoFactorRecoveryCodes);
        const consumed = await consumeRecoveryCode(stored, code);
        if (consumed) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              twoFactorRecoveryCodes: consumed as unknown as Prisma.InputJsonValue,
            },
          });
          authorized = true;
          usedRecovery = true;
        }
      }
      if (!authorized) {
        return reply
          .code(401)
          .send({ error: "INVALID_2FA_CODE", message: "Código incorrecto" });
      }

      const accessToken = signAccessToken({
        sub: user.id,
        tid: user.tenantId,
        role: user.role,
      });
      const refreshToken = signRefreshToken(
        { sub: user.id, tid: user.tenantId },
        { tv: user.tokenVersion, remember: payload.rmb === 1 },
      );
      return reply
        .code(200)
        .send({ accessToken, refreshToken, usedRecoveryCode: usedRecovery });
    },
  );

  // B-SuperAdmin: cambia la password temporal entregada por el super-admin
  // al crear el OWNER. Sólo acepta el JWT especial `must-change-password`
  // emitido por /auth/login cuando user.mustChangePasswordAt != null.
  // Tras cambiarla emitimos una sesión normal (access + refresh).
  app.post(
    "/auth/change-password-initial",
    {
      schema: {
        body: {
          type: "object",
          required: ["pendingPasswordChangeToken", "newPassword"],
          additionalProperties: false,
          properties: {
            pendingPasswordChangeToken: { type: "string", minLength: 1 },
            newPassword: { type: "string", minLength: 12, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { pendingPasswordChangeToken, newPassword } = request.body as {
        pendingPasswordChangeToken: string;
        newPassword: string;
      };
      let payload;
      try {
        payload = verifyMustChangePasswordToken(pendingPasswordChangeToken);
      } catch {
        return reply.code(401).send({
          error: "INVALID_PENDING_TOKEN",
          message: "Token caducado. Vuelve a iniciar sesión.",
        });
      }
      const prisma = getPrisma();
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.tenantId !== payload.tid || user.tokenVersion !== payload.tv) {
        return reply.code(401).send({
          error: "INVALID_PENDING_TOKEN",
          message: "Token inválido.",
        });
      }
      if (!user.mustChangePasswordAt) {
        // El flujo ya se completó previamente.
        return reply.code(409).send({
          error: "PASSWORD_ALREADY_CHANGED",
          message: "La contraseña inicial ya fue cambiada. Inicia sesión normalmente.",
        });
      }
      // Defensa: rechazar si la nueva password coincide con la temporal.
      if (user.passwordHash) {
        const sameAsTemp = await verifyPassword(user.passwordHash, newPassword);
        if (sameAsTemp) {
          return reply.code(400).send({
            error: "PASSWORD_SAME_AS_TEMPORARY",
            message: "La nueva contraseña debe ser distinta de la temporal.",
          });
        }
      }
      const newHash = await hashPassword(newPassword);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          mustChangePasswordAt: null,
          tokenVersion: { increment: 1 },
        },
      });
      const accessToken = signAccessToken({
        sub: updated.id,
        tid: updated.tenantId,
        role: updated.role,
      });
      const refreshToken = signRefreshToken(
        { sub: updated.id, tid: updated.tenantId },
        { tv: updated.tokenVersion },
      );
      return reply.code(200).send({ accessToken, refreshToken });
    },
  );

  // ── pin-1 (punto 1) · CAMBIAR MI PIN ────────────────────────────────
  //
  // Una pantalla y un endpoint, y el MISMO para el panel y para el TPV:
  // «PIN actual, nuevo, repetir, guardar». Por eso el `preHandler` es
  // `requireOwnerOrCashier` y no `requireOwner` — acepta la sesión del
  // panel (access token de OWNER o MANAGER) y la sesión de cajero del
  // TPV, que es por donde entran la cajera y el sanitario. Dos endpoints
  // paralelos habrían sido dos sitios donde escribir el filtro de
  // triviales y el registro del punto 7.
  //
  // `repetirPin` NO viaja: la repetición es cosa de la pantalla (cazar
  // una errata que no se ve). Mandarla al servidor sólo añadiría un 400
  // que el front ya evita, y un campo más en el cuerpo de una petición
  // que lleva dos PIN en claro.
  //
  // ── El PIN ACTUAL es obligatorio, y cuenta para el bloqueo ──────────
  //
  // Punto 6 del bloque: los cinco intentos / quince minutos protegen
  // también este campo. Y lo hacen en el MISMO cubo que el login del TPV
  // (`cashierLoginRateLimit(tenantId, email)`), que es la decisión que
  // importa: si fueran dos cubos, adivinar el PIN desde aquí saldría
  // gratis mientras el login se queda bloqueado. Es la misma credencial;
  // es el mismo contador.
  //
  // ── Por qué NO cierra las demás sesiones ───────────────────────────
  //
  // El bloque lo pedía «o se justifica en el -done». Está justificado
  // allí con las cuentas; el resumen: las sesiones que abre un PIN son
  // las de cajero, que son JWT sin `tokenVersion` y que tienen que
  // validarse SIN tocar la base (y sin red, en modo offline). Y bumpar
  // el `tokenVersion` del usuario cerraría las sesiones del PANEL, que
  // no son las que abre el PIN.
  app.post(
    "/auth/me/pin",
    {
      preHandler: requireOwnerOrCashier,
      schema: {
        body: {
          type: "object",
          required: ["currentPin", "newPin"],
          additionalProperties: false,
          properties: {
            currentPin: { type: "string", pattern: PIN_FORMAT },
            newPin: { type: "string", pattern: PIN_FORMAT },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { currentPin, newPin } = request.body as {
        currentPin: string;
        newPin: string;
      };
      if (await cajaIsDisabled(auth.tenantId)) {
        return reply.code(403).send({
          error: "CAJA_DISABLED",
          code: "CAJA_DISABLED",
          message: CAJA_DISABLED_MESSAGE,
        });
      }
      const prisma = getPrisma();
      // Siempre el PROPIO usuario de la sesión. No hay `:userId` en esta
      // ruta a propósito: un cajero no puede cambiar el PIN de otro, y la
      // forma de garantizarlo es que no exista el parámetro. El PIN de
      // otra persona se cambia por `PATCH /cashiers/:id/pin`, que pide
      // OWNER o MANAGER y deja el PIN PROVISIONAL.
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, email: true, tenantId: true, pinHash: true },
      });
      if (!user || user.tenantId !== auth.tenantId) {
        return reply
          .code(404)
          .send({ error: "USER_NOT_FOUND", message: "Usuario no encontrado" });
      }
      const rlKey = cashierLoginRateLimit(auth.tenantId, user.email.toLowerCase());
      const pre = await inspectRateLimit(rlKey);
      if (pre.locked) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            pre.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: pre.retryAfterSeconds,
        });
      }
      // Sin PIN puesto no hay «PIN actual» que acertar, y dejar pasar un
      // `currentPin` cualquiera sería dar PIN a quien no lo tiene desde
      // una ruta que promete comprobarlo. Quien no tiene PIN lo elige:
      // la propietaria por «Elegir PIN», el personal con el provisional
      // que le pone su encargado.
      if (!user.pinHash) {
        return reply.code(409).send({
          error: "SIN_PIN_TODAVIA",
          code: "SIN_PIN_TODAVIA",
          message:
            "Todavía no tienes PIN, así que no hay uno actual que comprobar. Elige el tuyo desde «Mi cuenta» en el panel.",
        });
      }
      if (!(await verifyPassword(user.pinHash, currentPin))) {
        const state = await registerRateLimitFailure(rlKey);
        return reply.code(401).send({
          error: "PIN_ACTUAL_INCORRECTO",
          code: "PIN_ACTUAL_INCORRECTO",
          message: "El PIN actual no es correcto.",
          attemptsRemaining: state.attemptsRemaining,
        });
      }
      const motivo = motivoPinTrivial(newPin);
      if (motivo) return reply.code(400).send(errorPinTrivial(motivo));
      await resetRateLimit(rlKey);
      await escribirPinYRegistrarlo({
        targetUserId: user.id,
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        pinHash: await hashPassword(newPin),
        kind: "PROPIO",
        // De dónde viene la sesión: la de cajero es del TPV, la del panel
        // es del panel. Es lo que hace legible el registro del punto 7.
        source: request.cashier ? "TPV" : "PANEL",
      });
      request.log.info(
        { event: "pin.cambiado_por_su_dueno", userId: user.id, tenantId: auth.tenantId },
        "PIN cambiado por su propio dueño",
      );
      return reply.code(200).send({ ok: true });
    },
  );

  // ── pin-1 (punto 2) · OLVIDÉ MI PIN, LA PROPIETARIA ─────────────────
  //
  // Elegir un PIN nuevo **sin el actual**. No es un agujero: para llegar
  // aquí hay que tener una sesión del panel, y a esa sesión se llega con
  // email y contraseña (y con el 2FA si lo tiene). La contraseña ya la
  // ha identificado — pedirle además un PIN que acaba de olvidar es
  // pedirle lo que no tiene.
  //
  // Esto es lo que SUSTITUYE a «Regenerar PIN» en Mi cuenta. La
  // diferencia no es cosmética: el que se va daba cuatro cifras al azar
  // y las enseñaba una vez; éste deja el PIN que la dueña teclea.
  //
  // ── OWNER y no MANAGER, y por qué ──────────────────────────────────
  //
  // Decisión tomada sin preguntar (queda en el `-done`): el bloque dice
  // «la propietaria» en el punto 2 y mete al encargado en el punto 3,
  // que es el camino del personal — su PIN lo repone quien le dio de
  // alta, y en el siguiente login elige el suyo. Un `MANAGER` que llegue
  // aquí recibe el 403 de `requireOwner` con su frase de siempre.
  //
  // ── Y NO en una sesión de impersonación ────────────────────────────
  //
  // `requireOwner` acepta el JWT de «Configurar como OWNER» como si
  // fuera el OWNER (está escrito así desde v1.3-SuperAdmin-Hub). Sin
  // esta comprobación, Mi Piace podría dejarle a la propietaria un PIN
  // DEFINITIVO elegido por Mi Piace, que es exactamente lo que el punto
  // 5 prohíbe: lo que soporte puede dejar es un PIN provisional. La
  // negativa va aquí y no en el botón del panel — esconder no es gatear.
  app.post(
    "/auth/me/pin/elegir",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["newPin"],
          additionalProperties: false,
          properties: { newPin: { type: "string", pattern: PIN_FORMAT } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { newPin } = request.body as { newPin: string };
      if (auth.isImpersonation === true) {
        return reply.code(403).send({
          error: "SOPORTE_NO_ELIGE_PIN",
          code: "SOPORTE_NO_ELIGE_PIN",
          message:
            "Desde una sesión de configuración no se puede elegir el PIN definitivo del propietario. Usa «Regenerar PIN», que deja uno provisional y obliga a la propietaria a elegir el suyo.",
        });
      }
      if (await cajaIsDisabled(auth.tenantId)) {
        return reply.code(403).send({
          error: "CAJA_DISABLED",
          code: "CAJA_DISABLED",
          message: CAJA_DISABLED_MESSAGE,
        });
      }
      const motivo = motivoPinTrivial(newPin);
      if (motivo) return reply.code(400).send(errorPinTrivial(motivo));
      await escribirPinYRegistrarlo({
        targetUserId: auth.userId,
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        pinHash: await hashPassword(newPin),
        // PROPIO: lo ha elegido ella. No tiene que volver a elegirlo al
        // entrar al TPV.
        kind: "PROPIO",
        source: "PANEL",
      });
      // Y el contador del PIN se limpia. La dueña que acaba de elegir el
      // suyo no puede encontrarse el candado de quince minutos que se
      // ganó probando cinco veces el que no recordaba: tendría el PIN
      // nuevo en la mano y la caja cerrada.
      const yo = await getPrisma().user.findUnique({
        where: { id: auth.userId },
        select: { email: true },
      });
      if (yo) {
        await resetRateLimit(
          cashierLoginRateLimit(auth.tenantId, yo.email.toLowerCase()),
        );
      }
      request.log.info(
        { event: "pin.elegido_por_la_duena", userId: auth.userId, tenantId: auth.tenantId },
        "PIN elegido por la propietaria autenticada con contraseña",
      );
      return reply.code(200).send({ ok: true });
    },
  );

  // ── pin-1 (punto 5) · «REGENERAR PIN», EL ÚLTIMO RECURSO DE SOPORTE ─
  //
  // Lo que queda de B7 §9, con dos cambios y los dos del bloque:
  //
  //   1. **Deja el PIN PROVISIONAL.** Sirve para que esa persona entre
  //      UNA vez al TPV y elija el suyo; no abre turno, no autoriza
  //      descuentos ni cierres, y no viaja en el roster offline. Mi Piace
  //      ya no deja PINs definitivos en cuentas ajenas.
  //   2. **Sólo desde una sesión de soporte** («Configurar como OWNER»).
  //      La propietaria de verdad tiene «Elegir PIN», que le deja el que
  //      ella teclea; dejarle también este botón sería mantener vivo
  //      justo lo que el bloque viene a quitar — un número al azar que se
  //      enseña una vez. El 403 le dice por dónde sí.
  //
  // contrato-lectura-completa (punto 6) · el gate de la caja se queda:
  // sin TPV no hay PIN que regenerar.
  app.post(
    "/auth/me/regenerate-owner-pin",
    { preHandler: requireOwner },
    async (request, reply) => {
      const auth = request.auth!;
      if (auth.isImpersonation !== true) {
        return reply.code(403).send({
          error: "PIN_AL_AZAR_SOLO_SOPORTE",
          code: "PIN_AL_AZAR_SOLO_SOPORTE",
          message:
            "El PIN lo eliges tú: usa «Elegir PIN» en Mi cuenta. Generar uno al azar es sólo el último recurso de soporte de Mi Piace.",
        });
      }
      if (await cajaIsDisabled(auth.tenantId)) {
        return reply.code(403).send({
          error: "CAJA_DISABLED",
          code: "CAJA_DISABLED",
          message: CAJA_DISABLED_MESSAGE,
        });
      }
      const pin = generarPinDeSoporte(randomInt);
      await escribirPinYRegistrarlo({
        targetUserId: auth.userId,
        tenantId: auth.tenantId,
        // Quién lo hizo de verdad está en `impersonatedBy`, y eso ya lo
        // escribe `impersonate_write` del middleware por cada mutación en
        // modo full. Aquí el actor es el usuario de la sesión, que es lo
        // que la FK puede apuntar — `pin_changes.actor_user_id` referencia
        // `users`, y un super-admin no es un `user`. `source: SOPORTE` es
        // lo que distingue la fila.
        actorUserId: auth.userId,
        pinHash: await hashPassword(pin),
        kind: "PROVISIONAL",
        source: "SOPORTE",
      });
      request.log.info(
        {
          event: "owner.pin_regenerated",
          userId: auth.userId,
          tenantId: auth.tenantId,
          impersonatedBy: auth.impersonatedBy,
        },
        "PIN de propietario regenerado por soporte — queda PROVISIONAL",
      );
      // `provisional: true` en la respuesta para que el panel pueda
      // decirlo en la misma pantalla donde enseña el PIN: quien lo lea en
      // voz alta por teléfono tiene que saber que la dueña va a tener que
      // elegir el suyo al entrar.
      return { pin, provisional: true };
    },
  );
}

