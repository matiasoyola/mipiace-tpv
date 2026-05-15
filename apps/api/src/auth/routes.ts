import { randomInt } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { probeFailureToHttpStatus, probeHoldedKey } from "../holded/probe.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { requireOwner, requireOwnerOrManager } from "./middleware.js";
import {
  signMustChangePasswordToken,
  verifyMustChangePasswordToken,
} from "./must-change-password.js";
import {
  inspect as inspectRateLimit,
  ownerLoginRateLimit,
  registerFailure as registerRateLimitFailure,
  reset as resetRateLimit,
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
      if (user.role === "CASHIER") {
        // No es un fallo de credenciales (password correcto) — no aplicamos
        // rate-limit. El cajero entra al TPV con PIN, no al admin con
        // password.
        return reply.code(403).send({
          error: "CASHIER_NOT_ALLOWED_IN_ADMIN",
          message:
            "Los cajeros sólo pueden acceder desde el TPV con su PIN.",
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
      // B7 §9: OWNER sin PIN al primer login → auto-generamos uno de 4
      // dígitos para que pueda autorizar descuentos y cierres
      // SYNC_FAILED desde el TPV cuando no hay MANAGER. Se devuelve
      // una sola vez en este response — el front lo muestra en un
      // modal "Tu PIN de respaldo es 1234".
      let ownerPinGenerated: string | null = null;
      if (user.role === "OWNER" && !user.pinHash) {
        ownerPinGenerated = generateOwnerPin();
        await prisma.user.update({
          where: { id: user.id },
          data: { pinHash: await hashPassword(ownerPinGenerated) },
        });
        request.log.info(
          { event: "owner.pin_auto_generated", userId: user.id, tenantId: user.tenantId },
          "OWNER PIN de respaldo generado automáticamente en login",
        );
      }
      return ownerPinGenerated
        ? { accessToken, refreshToken, ownerPinGenerated }
        : { accessToken, refreshToken };
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
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          hasHoldedKey: tenant.holdedApiKeyCiphertext != null,
          initialSyncStatus: tenant.initialSyncStatus,
          fiscalProfile: tenant.fiscalProfile ?? null,
          lastIncrementalSyncAt: tenant.lastIncrementalSyncAt?.toISOString() ?? null,
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
      await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: {
          holdedApiKeyCiphertext: ciphertext,
          holdedAuthMode: "API_KEY",
        },
      });
      // No tocamos initialSyncStatus ni encolamos sync — la rotación
      // típica (clave comprometida → nueva clave de la MISMA cuenta
      // Holded) no necesita resync. Si el propietario cambia de cuenta
      // Holded, puede forzar manualmente con POST /catalog/sync-now.
      // No hay cache en memoria de la API key descifrada — cada job
      // descifra al arrancar, así que la rotación es efectiva sin
      // acción extra del runtime.
      return reply.code(200).send({
        ok: true,
        validatedAt: now.toISOString(),
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

  // B7 §9: el OWNER puede regenerar su PIN de respaldo desde "Mi
  // cuenta". Devuelve el nuevo PIN en plano una sola vez. El antiguo
  // queda invalidado.
  app.post(
    "/auth/me/regenerate-owner-pin",
    { preHandler: requireOwner },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const pin = generateOwnerPin();
      await prisma.user.update({
        where: { id: auth.userId },
        data: { pinHash: await hashPassword(pin) },
      });
      request.log.info(
        { event: "owner.pin_regenerated", userId: auth.userId, tenantId: auth.tenantId },
        "OWNER PIN de respaldo regenerado manualmente",
      );
      return { pin };
    },
  );
}

// Genera un PIN numérico de 4 dígitos al estilo del PIN del cajero
// (B3): suficiente para una autorización de respaldo, fácil de
// teclear, no se confunde con MFA. Usa `crypto.randomInt` para evitar
// sesgos del modulo en 10000.
function generateOwnerPin(): string {
  // 4 dígitos: cubre 10.000 combinaciones. Para piloto con rate-limit
  // en `manager-authorize` es suficiente. Si quisiéramos 6 dígitos
  // (estilo Google), basta cambiar el rango.
  return randomInt(0, 10_000).toString().padStart(4, "0");
}
