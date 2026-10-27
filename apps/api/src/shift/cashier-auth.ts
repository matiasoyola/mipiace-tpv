import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import {
  cashierLoginRateLimit,
  inspect,
  registerFailure,
  reset,
} from "../auth/rate-limit.js";
import { verifyPassword, hashPassword } from "../auth/passwords.js";
import { PIN_FORMAT, errorPinTrivial, motivoPinTrivial } from "../auth/pin.js";
import { escribirPinYRegistrarlo } from "../auth/pin-registro.js";
import {
  signPinEleccionToken,
  verifyPinEleccionToken,
} from "../auth/pin-eleccion.js";
import { requireDeviceToken } from "../devices/auth.js";
import { signCashierSession, requireCashierSession } from "./cashier-session.js";
import { getShiftStateForLogin } from "./state.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { enEnsayo } from "../fiscal/mode.js";

// Rate-limit clave: usamos (tenantId, email) — el tenantId viene del
// device token, así que el rate-limit es por (caja-de-este-tenant, email
// que prueba). Esto evita enumeración: una clave concreta no revela si
// el email existe; basta con haber acumulado 5 intentos contra ese email.
function rateLimitKeyFor(tenantId: string, email: string) {
  return cashierLoginRateLimit(tenantId, email.toLowerCase());
}

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

export async function registerCashierAuthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/shift/cashier-login",
    {
      preHandler: [requireDeviceToken, ensureCajaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["email", "pin"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            pin: { type: "string", minLength: 4, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.device!;
      const { email, pin } = request.body as { email: string; pin: string };
      const lowerEmail = email.toLowerCase();
      const prisma = getPrisma();

      const rlKey = rateLimitKeyFor(ctx.tenantId, lowerEmail);
      const pre = await inspect(rlKey);
      if (pre.locked) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            pre.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: pre.retryAfterSeconds,
        });
      }

      const GENERIC = {
        error: "INVALID_CREDENTIALS",
        message: "Email o PIN incorrectos",
      };

      const user = await prisma.user.findFirst({
        where: {
          tenantId: ctx.tenantId,
          email: lowerEmail,
          // v1.3-piloto-feedback · Lote 1: aceptamos OWNER. El activate
          // ya le coloca pinHash; sin esto, el dueño no podía abrir
          // turno en el TPV con su propio email.
          //
          // clinica-1 · y CLINICIAN. El sanitario sin caja ENTRA AL TPV:
          // es donde vive su agenda. Lo que no puede hacer al entrar es
          // abrir turno ni cobrar, y eso no se decide aquí — lo decide
          // `ensureCajaEnabled` en cada ruta de caja. Dejarlo fuera de
          // esta lista habría sido esconder la negativa en la puerta de
          // entrada, y la puerta de entrada no es donde se razona.
          role: { in: ["OWNER", "MANAGER", "CASHIER", "CLINICIAN"] },
          // clinica-8 · y VIVO. La activación borra (soft) el cajero
          // técnico de «Probar TPV» y le quita el PIN; lo segundo ya
          // cerraba la puerta —sin `pin_hash` no se entra— pero lo hacía
          // por un efecto lateral del borrado, no porque nadie lo
          // comprobara. El día que alguien le ponga un PIN a un usuario
          // borrado, esto es lo que lo sigue dejando fuera.
          deletedAt: null,
        },
        select: {
          id: true,
          role: true,
          pinHash: true,
          // pin-1 (punto 3) · si el PIN es PRESTADO. Se lee aquí y se
          // decide tres bloques más abajo, DESPUÉS de comprobar el PIN:
          // contestar «tienes que elegir uno» antes de saber si el PIN
          // es correcto le diría a cualquiera que ese email existe y que
          // acaban de reponerle el PIN.
          pinProvisionalAt: true,
          email: true,
          alias: true,
          // clinica-2 · LA MARCA sanitaria, no el rol. La pantalla del TPV
          // la necesita para decidir si OFRECE la valoración de un
          // paciente: el rol no sirve, porque una cajera-sanitaria y una
          // propietaria sanitaria llevan `CASHIER` y `OWNER`.
          //
          // No es una puerta —lo clínico lo gatea la API en cada ruta— sino
          // lo que evita pintarle a la recepcionista un botón que siempre
          // le va a fallar Y que le dejaría una línea DENIED en el registro
          // de accesos por cada toque de curiosidad. Esa es exactamente la
          // clase de ruido que clinica-1 decidió no meter en el registro
          // (§11.1 de su done).
          isClinician: true,
        },
      });
      if (!user || !user.pinHash) {
        const state = await registerFailure(rlKey);
        return reply.code(401).send({ ...GENERIC, attemptsRemaining: state.attemptsRemaining });
      }
      const ok = await verifyPassword(user.pinHash, pin);
      if (!ok) {
        const state = await registerFailure(rlKey);
        return reply
          .code(401)
          .send({ ...GENERIC, attemptsRemaining: state.attemptsRemaining });
      }

      await reset(rlKey);

      // ── pin-1 (punto 3) · EL PIN PRESTADO NO ABRE LA CAJA ───────────
      //
      // El PIN es correcto, pero no es suyo: se lo puso la propietaria
      // desde Cajeros, o Mi Piace con «Regenerar PIN». Así que **no se
      // emite sesión**. Se devuelve un token que no vale más que para
      // `POST /shift/cashier-pin`, la pantalla donde elige el suyo.
      //
      // Va ANTES de `lastLoginAt` a propósito: esto no es un acceso
      // todavía. «Último acceso» en la lista de Cajeros tiene que seguir
      // queriendo decir «entró», y quien se queda en la pantalla de
      // elegir PIN no ha entrado.
      //
      // Y va antes de leer el tenant y de firmar nada: la negativa es la
      // emisión de la sesión, no una pantalla que se pueda saltar.
      if (user.pinProvisionalAt != null) {
        return reply.code(200).send({
          mustChoosePin: true,
          pendingPinChangeToken: signPinEleccionToken({
            sub: user.id,
            tid: ctx.tenantId,
            did: ctx.deviceId,
          }),
          // El nombre, para que la pantalla pueda decir «Hola Marta,
          // elige tu PIN» y no «elige tu PIN» a secas. El email viaja por
          // lo mismo que en el login normal: es la credencial, y la
          // pantalla reintenta el login con ella en cuanto el PIN nuevo
          // está puesto.
          user: { id: user.id, email: user.email, alias: user.alias },
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // v1.0-pilotos · Lote 4 (#18): el JWT vive el turno entero
      // (cashierSessionTtlMinutes, default 720 = 12 h). El auto-logout
      // por inactividad sigue siendo cashierAutoLogoutMinutes y lo
      // aplica la PWA en cliente — antes el JWT se firmaba con ese TTL
      // corto (10 min) y el cajero re-logueaba varias veces al día
      // aunque estuviera trabajando.
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        // puesta-en-marcha (ADR-021) · `facturaDesde` viaja en el `select`
        // que ya existía. El TPV necesita saber que está en ensayo DESDE EL
        // LOGIN y no cuando termine de sincronizar el catálogo: la banda
        // tiene que estar puesta antes de que nadie pueda cobrar.
        select: { cashierSessionTtlMinutes: true, facturaDesde: true },
      });

      const sessionToken = signCashierSession(
        {
          sub: user.id,
          tid: ctx.tenantId,
          did: ctx.deviceId,
          rid: ctx.registerId,
          role: user.role as "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN",
        },
        tenant.cashierSessionTtlMinutes,
      );

      const shiftState = await getShiftStateForLogin(ctx.registerId);

      return reply.code(200).send({
        sessionToken,
        sessionTtlMinutes: tenant.cashierSessionTtlMinutes,
        // puesta-en-marcha (ADR-021) · la cuenta está en ensayo: el TPV pinta
        // la banda fija y el ticket sale marcado como de prueba.
        ensayo: enEnsayo(tenant),
        user: {
          id: user.id,
          // v1.7-alias-cajeros: el email se mantiene por compat con
          // devices con SW viejo — NO quitarlo del contrato.
          email: user.email,
          alias: user.alias,
          role: user.role,
          isClinician: user.isClinician,
        },
        shiftState,
      });
    },
  );

  // ── pin-1 (punto 3) · DONDE SE ELIGE EL PIN PROPIO ─────────────────
  //
  // La segunda mitad del login con PIN provisional: llega el token que
  // emitió el login y el PIN que esa persona acaba de elegir. Al salir
  // de aquí su PIN es PROPIO y la pantalla reintenta el login normal con
  // él — no se emite sesión desde esta ruta.
  //
  // **Por qué no devuelve la sesión directamente**, que sería un viaje
  // menos: porque emitir una sesión de cajero es montar el turno, el
  // ensayo, el TTL del tenant y el `shiftState`, y eso ya está escrito
  // una vez en `/shift/cashier-login`. Duplicarlo aquí sería el segundo
  // sitio donde acordarse de cada cosa que se añada al arranque del TPV.
  // El viaje de más cuesta 200 ms y lo paga una vez en la vida de cada
  // persona.
  //
  // Sin `ensureCajaEnabled` por la misma razón que `cashier-logout`: aquí
  // no hay sesión ni rol que mirar (sólo el device y el token), y el
  // sanitario sin caja tiene que poder elegir su PIN igual que todo el
  // mundo — `ensureCajaEnabled` rechaza a un `CLINICIAN` por diseño. La
  // puerta de la caja ya la pasó el login que emitió este token.
  app.post(
    "/shift/cashier-pin",
    {
      preHandler: requireDeviceToken,
      schema: {
        body: {
          type: "object",
          required: ["pendingPinChangeToken", "newPin"],
          additionalProperties: false,
          properties: {
            pendingPinChangeToken: { type: "string", minLength: 1 },
            newPin: { type: "string", pattern: PIN_FORMAT },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.device!;
      const { pendingPinChangeToken, newPin } = request.body as {
        pendingPinChangeToken: string;
        newPin: string;
      };
      let payload;
      try {
        payload = verifyPinEleccionToken(pendingPinChangeToken);
      } catch {
        return reply.code(401).send({
          error: "PIN_ELECCION_CADUCADA",
          code: "PIN_ELECCION_CADUCADA",
          message:
            "Se ha agotado el tiempo para elegir el PIN. Vuelve a teclear el PIN que te dieron y elige otra vez.",
        });
      }
      // El token nació en ESTE terminal y en ESTA empresa. No es la
      // frontera principal —quien tiene el token tiene el PIN
      // provisional— pero un token copiado a otra caja no sirve.
      if (payload.tid !== ctx.tenantId || payload.did !== ctx.deviceId) {
        return reply.code(401).send({
          error: "PIN_ELECCION_CADUCADA",
          code: "PIN_ELECCION_CADUCADA",
          message:
            "Se ha agotado el tiempo para elegir el PIN. Vuelve a teclear el PIN que te dieron y elige otra vez.",
        });
      }
      const prisma = getPrisma();
      const user = await prisma.user.findFirst({
        where: { id: payload.sub, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, pinProvisionalAt: true },
      });
      if (!user) {
        return reply
          .code(404)
          .send({ error: "USER_NOT_FOUND", message: "Usuario no encontrado" });
      }
      // Que el PIN SIGA siendo provisional, leído de la base y no del
      // token. Es lo que hace que este token no sea un pase para cambiar
      // el PIN cuando a uno le apetezca: en cuanto su dueña elige el
      // suyo, el token que sobró no vale para nada. Para cambiarlo
      // después está `/auth/me/pin`, que pide el actual.
      if (user.pinProvisionalAt == null) {
        return reply.code(409).send({
          error: "PIN_YA_ELEGIDO",
          code: "PIN_YA_ELEGIDO",
          message: "Ese PIN ya se eligió. Entra con él.",
        });
      }
      const motivo = motivoPinTrivial(newPin);
      if (motivo) return reply.code(400).send(errorPinTrivial(motivo));
      await escribirPinYRegistrarlo({
        targetUserId: user.id,
        tenantId: ctx.tenantId,
        // Lo elige ella, así que el actor es ella misma.
        actorUserId: user.id,
        pinHash: await hashPassword(newPin),
        kind: "PROPIO",
        source: "TPV",
      });
      request.log.info(
        { event: "pin.elegido_tras_provisional", userId: user.id, tenantId: ctx.tenantId },
        "PIN propio elegido tras un PIN provisional",
      );
      return reply.code(200).send({ ok: true });
    },
  );

  // Sin gate de caja a propósito: cerrar sesión tiene que funcionar
  // SIEMPRE, también en el instante en que a la empresa le apagan la
  // caja con un cajero dentro. Un 403 aquí dejaría al cajero atrapado en
  // la pantalla de venta.
  app.post(
    "/shift/cashier-logout",
    { preHandler: requireCashierSession },
    async () => {
      // Sin server-side blacklist: el cliente descarta el token y se
      // acabó. Si en B4 introducimos session refresh, aquí
      // incrementaremos un sessionVersion del user (similar al
      // tokenVersion del owner).
      return { ok: true };
    },
  );

  // B-OnboardingV2: bootstrap del TPV en modo prueba. El super-admin
  // emite el JWT cashier-session (purpose=test-cashier) desde su
  // consola; el TPV lo guarda en sessionStorage y llama a este
  // endpoint para obtener el perfil del cajero, el shift abierto y
  // los datos de tenant/register/store sin pasar por PinScreen.
  app.get(
    "/shift/cashier-bootstrap",
    { preHandler: [requireCashierSession, ensureCajaEnabled] },
    async (request, reply) => {
      const ctx = request.cashier!;
      if (!ctx.isTest) {
        return reply.code(403).send({
          error: "TEST_CASHIER_ONLY",
          message: "Este endpoint sólo acepta JWTs test-cashier.",
        });
      }
      const prisma = getPrisma();
      const [user, register, tenant, shift] = await Promise.all([
        prisma.user.findUnique({
          where: { id: ctx.sub },
          select: { id: true, email: true, alias: true, role: true },
        }),
        prisma.register.findUnique({
          where: { id: ctx.rid },
          select: {
            id: true,
            name: true,
            numSerieHolded: true,
            store: {
              select: {
                id: true,
                name: true,
                // kds-1-cocina · los ajustes de cocina de la tienda, para
                // que el MODO PRUEBA pinte la cocina igual que un
                // terminal de verdad. El modo prueba es con lo que se
                // demuestra el producto: una demo sin la pantalla de
                // comandas en una cuenta que la tiene es una demo que
                // miente.
                kitchenCourseMode: true,
                kitchenSeatMode: true,
                kitchenGreenMaxMin: true,
                kitchenAmberMaxMin: true,
                kitchenReadyBeep: true,
              },
            },
          },
        }),
        prisma.tenant.findUnique({
          where: { id: ctx.tid },
          select: {
            id: true,
            name: true,
            cashierAutoLogoutMinutes: true,
            kitchenDisplayEnabled: true,
          },
        }),
        prisma.shift.findFirst({
          where: { registerId: ctx.rid, userId: ctx.sub, closedAt: null },
          orderBy: { openedAt: "desc" },
          select: { id: true, openedAt: true, cashOpening: true },
        }),
      ]);
      if (!user || !register || !tenant) {
        return reply.code(404).send({
          error: "TEST_CASHIER_RESOURCES_MISSING",
          message: "Faltan recursos para el modo prueba (re-provision necesaria).",
        });
      }
      return reply.code(200).send({
        user: { id: user.id, email: user.email, alias: user.alias, role: user.role },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          cashierAutoLogoutMinutes: tenant.cashierAutoLogoutMinutes,
          kitchenDisplayEnabled: tenant.kitchenDisplayEnabled,
        },
        // puesta-en-marcha (ADR-021) · la sesión de prueba no emite nunca
        // (addendum 1b), así que aquí es `true` también cuando la cuenta ya
        // factura. Es lo correcto para lo único que decide: la banda.
        ensayo: true as const,
        register: {
          id: register.id,
          name: register.name,
          numSerieHolded: register.numSerieHolded,
        },
        store: { id: register.store.id, name: register.store.name },
        // kds-1-cocina · `null` con el módulo apagado, igual que en
        // `/devices/me`: lo que no se compró no llega a la pantalla.
        kitchen: tenant.kitchenDisplayEnabled
          ? {
              courseMode: register.store.kitchenCourseMode,
              seatMode: register.store.kitchenSeatMode,
              greenMaxMin: register.store.kitchenGreenMaxMin,
              amberMaxMin: register.store.kitchenAmberMaxMin,
              readyBeep: register.store.kitchenReadyBeep,
            }
          : null,
        shift: shift
          ? {
              id: shift.id,
              openedAt: shift.openedAt.toISOString(),
              cashOpening: shift.cashOpening.toString(),
            }
          : null,
      });
    },
  );

  // v1.10-offline-un-terminal §1: paquete offline de autenticación.
  //
  // Un terminal YA bootstrapeado (deviceToken válido) descarga aquí, con
  // red, todo lo necesario para operar un turno completo sin conexión:
  //   - roster: usuarios que pueden abrir turno en esta caja (OWNER /
  //     MANAGER / CASHIER con pinHash != null) con su pinHash argon2id.
  //   - config: TTL de sesión y auto-logout del tenant.
  //   - shiftState: estado del último turno de la caja (mismo cálculo
  //     que el login), para que el arranque offline sepa si reanudar.
  //
  // MODELO DE CONFIANZA (documentado en el done.md): enviamos el HASH
  // argon2id del PIN (nunca el PIN en claro) y sólo a un device ya
  // emparejado (requireDeviceToken). El hash es de alto coste (64 MB,
  // t=3) — verificarlo offline es viable pero fuerza-bruteárlo desde el
  // IndexedDB de un dispositivo robado es igual de caro que atacar la
  // BD del servidor. El server sigue siendo la red de seguridad:
  // idempotencia del outbox + re-login real al recuperar red para
  // obtener el JWT que los POST necesitan.
  app.get(
    "/shift/offline-bundle",
    { preHandler: [requireDeviceToken, ensureCajaEnabled] },
    async (request, reply) => {
      const ctx = request.device!;
      // El modo prueba (test-cashier) no tiene device físico ni roster
      // que cachear: no aplica el paquete offline.
      if (ctx.isTest) {
        return reply.code(403).send({
          error: "OFFLINE_BUNDLE_NOT_FOR_TEST",
          message: "El paquete offline no aplica al modo prueba.",
        });
      }
      const prisma = getPrisma();
      const [tenant, users] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: {
            cashierSessionTtlMinutes: true,
            cashierAutoLogoutMinutes: true,
            // v1.11-cierre-de-dia · viaja en el paquete offline para que un
            // terminal sin red sepa si tiene que exigir el arqueo.
            requireCashCountOnClose: true,
            // puesta-en-marcha (ADR-021) · y el ensayo viaja con ellos. Un
            // terminal que entra sin red tiene que pintar la banda igual:
            // «estos cobros no son facturas» no puede depender de la línea.
            facturaDesde: true,
          },
        }),
        prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            // clinica-1 · el sanitario también está en el roster offline:
            // sin red tiene que poder entrar a ver su agenda cacheada.
            role: { in: ["OWNER", "MANAGER", "CASHIER", "CLINICIAN"] },
            pinHash: { not: null },
            // pin-1 (punto 3) · **el PIN prestado no viaja al terminal.**
            //
            // El roster offline es lo que deja entrar SIN RED, y elegir
            // un PIN necesita servidor. Si un PIN provisional viajara
            // aquí, bastaría con quitar la wifi para saltarse la pantalla
            // que obliga a elegirlo — que es justo la única puerta que
            // tiene el punto 3.
            //
            // Consecuencia aceptada y dicha en el `-done`: alguien con
            // PIN recién repuesto no puede entrar en un terminal sin red
            // hasta que elija el suyo con red una vez. Es correcto: su
            // PIN todavía lo saben dos personas.
            pinProvisionalAt: null,
          },
          select: { id: true, email: true, alias: true, role: true, pinHash: true },
        }),
      ]);
      const shiftState = await getShiftStateForLogin(ctx.registerId);
      return reply.code(200).send({
        registerId: ctx.registerId,
        config: {
          cashierSessionTtlMinutes: tenant.cashierSessionTtlMinutes,
          cashierAutoLogoutMinutes: tenant.cashierAutoLogoutMinutes,
          requireCashCountOnClose: tenant.requireCashCountOnClose,
          ensayo: enEnsayo(tenant),
        },
        roster: users.map((u) => ({
          id: u.id,
          email: u.email,
          alias: u.alias,
          role: u.role,
          pinHash: u.pinHash,
        })),
        shiftState,
      });
    },
  );
}
