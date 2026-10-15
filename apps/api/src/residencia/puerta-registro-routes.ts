// residencia-3 · **LA PUERTA, DE PARTE DEL SERVIDOR.**
//
// Las seis rutas que la tablet necesita para hacer lo que el mockup de
// D-64 pinta, y ni una más:
//
//   1. `GET  /residencia/puerta/arranque`                — la caché de SU
//      habitación, para poder pintar y registrar SIN RED.
//   2. `POST /residencia/puerta/pin`                     — el PIN y, si
//      hace falta, con qué rol entra (D-31).
//   3. `GET  /residencia/puerta/lo-que-toca`             — qué toca ahora
//      y qué ya está hecho. Detrás del PIN.
//   4. `POST /residencia/puerta/registros`               — el lote,
//      idempotente por el uuid de la tablet.
//   5. `POST /residencia/puerta/registros/:id/anular`    — «deshacer el
//      último».
//   6. `GET  /residencia/puerta/residentes/:id/foto`     — la foto, SÓLO
//      con consentimiento de imagen (D-64).
//
// ── LAS TRES PUERTAS, Y CUÁL LLEVA CADA RUTA ────────────────────────
//
//   · `requirePuertaDevice` — **todas**. Dice qué habitación es esta
//     tablet, que es lo único con lo que puede filtrar.
//   · `requirePuertaSesion` — las que tocan datos de salud (3, 4 y 5).
//     Dice quién está delante. Ver su cabecera: lo que prueba es
//     presencia, no la firma de cada registro.
//   · la función de acceso de la casa (`resolverAccesoClinico`) —
//     residente a residente, con su línea en `clinical_access_log`. De ahí
//     sale el alcance por zona de D-51 sin escribir una segunda regla.
//
// La 1 y la 6 **no** llevan sesión, y las dos razones son distintas:
//
//   · el **arranque** tiene que funcionar antes de que nadie teclee nada,
//     porque es lo que carga la caché con la que después se registra sin
//     red. Es el mismo reparto que `/shift/offline-bundle` en el TPV
//     (v1.10 §1): paquete offline detrás del token del dispositivo.
//   · la **foto** se pinta en la pantalla en reposo, antes del PIN (D-64),
//     y su permiso no es el rol de nadie: es el consentimiento de imagen
//     del residente.
//
// ── NADA DE SALUD ANTES DEL PIN (decisión 7) ────────────────────────
//
// Lo que la pantalla 1 PINTA son el número de la habitación, el turno, la
// hora, la foto y el nombre. Nada más, y eso ya lo garantizaba
// `/residencia/puerta/me` de residencia-1 con su test que mira el payload
// crudo.
//
// Lo que el arranque TRAE sí incluye el plan, porque sin plan no hay «lo
// que toca» cuando se cae el wifi. Son dos cosas distintas y conviene no
// confundirlas: la caché guarda lo que hará falta, la pantalla en reposo
// no lo pinta, y la caché se vacía al revocar el dispositivo.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { PrismaClient } from "@mipiacetpv/db";
import {
  diaDelTurno,
  queToca,
  turnoDe,
  utcToWallDate,
  wallTimeToUtc,
  type Ocurrencia,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { verifyPassword } from "../auth/passwords.js";
import { inspect, registerFailure, reset } from "../auth/rate-limit.js";
import { dekONada } from "../clinica/claves.js";
import { negativaClinica } from "../clinica/contrato.js";
import {
  comoPrismaParaAcceso,
  resolverAccesoClinico,
} from "../clinica/acceso.js";
import { apuntarAcceso } from "../clinica/registro.js";
import {
  huellaDePinDePuerta,
  subclaveDePinDePuerta,
} from "../clinica/cripto.js";
import { leerFichero, MIME_DE_FOTO } from "../clinica/ficheros.js";
import { deColumnas, FRECUENCIA_SELECT } from "./frecuencia-columnas.js";
import { requirePuertaDevice } from "./puerta-auth.js";
import { requirePuertaSesion, signPuertaSesion } from "./puerta-sesion.js";
import {
  dekParaLeer,
  escribirRegistro,
  REGISTRO_SELECT,
  VENTANA_DE_ANULACION_MS,
  vistaDeRegistros,
  type ContextoDelLote,
  type ControlParaRegistrar,
  type RegistroEntrante,
} from "./registro.js";

// ── El rate-limit del PIN · POR PUERTA, y corto a propósito ──────────
//
// No hay email que teclear, así que no se puede limitar por persona antes
// de resolver: lo único que identifica el intento es la tablet. De ahí la
// clave por `(tenant, device)`.
//
// Y de ahí también los números, que **no** son los del login de cajero (5
// intentos → 15 min de candado):
//
//   · **10 intentos** en 5 minutos, porque una auxiliar con guantes y
//     prisa teclea mal más de dos veces, y porque las cuatro cifras las
//     comparten veinte personas que entran por la misma tablet;
//   · **2 minutos de candado**, no 15. Un candado largo en esta pantalla
//     **bloquea el registro de cuidados de una habitación**, y eso es peor
//     que el riesgo que evita: diez mil combinaciones a diez intentos cada
//     cinco minutos son casi cuatro días de alguien de pie en un pasillo.
//     El candado está para que no se pueda barrer el espacio, no para
//     castigar a quien se equivoca.
//
// Lo que NO se hace es dejarlo sin límite: sin candado, un script contra
// la tablet saca un PIN en minutos. Y lo que tampoco se hace es bloquear
// la habitación entera: las otras puertas, el admin y el panel siguen
// funcionando, y el mensaje dice que se puede usar otra puerta.
const PIN_MAX_INTENTOS = 10;
const PIN_VENTANA_S = 5 * 60;
const PIN_CANDADO_S = 2 * 60;

function limiteDelPin(tenantId: string, deviceId: string) {
  return {
    attemptsKey: `puerta-pin-attempts:${tenantId}:${deviceId}`,
    lockKey: `puerta-pin-locked:${tenantId}:${deviceId}`,
    maxAttempts: PIN_MAX_INTENTOS,
    attemptTtlSeconds: PIN_VENTANA_S,
    lockTtlSeconds: PIN_CANDADO_S,
  };
}

/** Qué residentes ocupan HOY las camas de esta habitación. */
async function ocupantesDeLaHabitacion(
  prisma: PrismaClient,
  roomId: string,
): Promise<
  Array<{
    clientId: string;
    bedId: string;
    bedLabel: string;
    nombre: string;
  }>
> {
  const camas = await prisma.bed.findMany({
    where: { roomId, active: true },
    orderBy: { label: "asc" },
    select: {
      id: true,
      label: true,
      assignments: {
        where: { toAt: null },
        take: 1,
        select: {
          client: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  const salida: Array<{
    clientId: string;
    bedId: string;
    bedLabel: string;
    nombre: string;
  }> = [];
  for (const cama of camas) {
    const ocupacion = cama.assignments[0];
    if (!ocupacion) continue;
    salida.push({
      clientId: ocupacion.client.id,
      bedId: cama.id,
      bedLabel: cama.label,
      nombre: `${ocupacion.client.firstName} ${ocupacion.client.lastName}`.trim(),
    });
  }
  return salida;
}

/**
 * ¿Tiene este residente consentimiento de imagen VIGENTE? (D-64)
 *
 * Vigente = hay una fila `IMAGE` que concede y **ninguna fila que la
 * revoque**. La revocación es otra fila (`revokesConsentId`), que es como
 * funciona el consentimiento en toda la casa desde clinica-4: nadie pone
 * un booleano a `false`, se escribe la retirada con su autor y su fecha.
 *
 * Y la pregunta se hace SIEMPRE antes de servir la foto, no al subirla: una
 * familia que llama el martes para decir «quiten la foto de mi madre»
 * tiene que dejar de verla el martes, no cuando alguien vuelva a subirla.
 */
async function consentimientosDeImagen(
  prisma: PrismaClient,
  tenantId: string,
  clientIds: string[],
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const filas = await prisma.clientConsent.findMany({
    where: { tenantId, clientId: { in: clientIds }, kind: "IMAGE" },
    select: { id: true, clientId: true, revokesConsentId: true },
  });
  const revocados = new Set(
    filas.map((f) => f.revokesConsentId).filter((x): x is string => x != null),
  );
  const con = new Set<string>();
  for (const f of filas) {
    // Una fila que REVOCA no concede nada (ver el comentario de
    // `revokesConsentId` en el esquema), y una concesión revocada tampoco.
    if (f.revokesConsentId != null) continue;
    if (revocados.has(f.id)) continue;
    con.add(f.clientId);
  }
  return con;
}

/**
 * Los residentes de esta habitación que quien está delante PUEDE ver, con
 * su línea en el registro de accesos — permitidos y denegados.
 *
 * ── Por qué llama a `apuntarAcceso` y no a `conHistoria` ──────────────
 *
 * `conHistoria` envuelve UNA ruta sobre UN paciente y contesta ella misma
 * cuando dice no. Aquí hay dos residentes en la misma pantalla y la
 * respuesta no es «no» para la pantalla: es «no» para uno de los dos. La
 * misma forma exacta que `exportarElCentro` (clinica-7), que apunta una
 * línea por paciente por la misma razón — «¿quién se llevó la historia de
 * mi madre?» se contesta en la historia de su madre, no en una línea que
 * diga «se abrió la 112».
 *
 * Lo que NO cambia es quién escribe la línea: `apuntarAcceso`, que es el
 * único sitio de la casa que lo hace.
 */
async function residentesVisibles(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    deviceId: string;
    ruta: string;
    accion: "READ" | "WRITE";
    clientIds: string[];
  },
): Promise<Set<string>> {
  const visibles = new Set<string>();
  for (const clientId of input.clientIds) {
    const { veredicto } = await resolverAccesoClinico(
      comoPrismaParaAcceso(prisma),
      { tenantId: input.tenantId, userId: input.userId, clientId },
    );
    // LA LÍNEA, pase lo que pase. Un acceso denegado es justo el que
    // interesa ver cuando alguien pregunta quién ha estado mirando.
    await apuntarAcceso({
      tenantId: input.tenantId,
      userId: input.userId,
      clientId,
      action: input.accion,
      outcome: veredicto.puede ? "ALLOWED" : "DENIED",
      deviceId: input.deviceId,
      route: input.ruta,
    });
    if (veredicto.puede) visibles.add(clientId);
  }
  return visibles;
}

/** Los controles vigentes del centro que la puerta puede registrar, por
 *  código: los de serie más los propios, menos los que el centro ha
 *  desactivado. */
async function controlesActivos(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Map<string, ControlParaRegistrar>> {
  const [controles, ajustes] = await Promise.all([
    prisma.controlType.findMany({
      where: {
        supersededAt: null,
        OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
      },
      orderBy: [{ layer: "asc" }, { sortOrder: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        layer: true,
        nature: true,
        valueDomain: true,
        version: true,
        groupCode: true,
        unit: true,
        options: {
          orderBy: { sortOrder: "asc" },
          select: { code: true, label: true, isAsUsual: true, sortOrder: true },
        },
      },
    }),
    prisma.centerControlSetting.findMany({
      where: { tenantId },
      select: { controlCode: true, active: true, alias: true },
    }),
  ]);
  // La AUSENCIA de ajuste no apaga nada, igual que en `queToca`: un control
  // sin fila de ajuste es un dato que falta, no una decisión del centro, y
  // suprimir un cuidado por un dato que falta es la clase de silencio que
  // se descubre en una auditoría.
  const apagados = new Set(
    ajustes.filter((a) => !a.active).map((a) => a.controlCode),
  );
  const mapa = new Map<string, ControlParaRegistrar>();
  for (const c of controles) {
    if (apagados.has(c.code)) continue;
    mapa.set(c.code, {
      id: c.id,
      code: c.code,
      layer: c.layer,
      nature: c.nature,
      valueDomain: c.valueDomain,
      opciones: c.options.map((o) => ({ code: o.code, isAsUsual: o.isAsUsual })),
    });
  }
  return mapa;
}

export async function registerResidenciaPuertaRegistroRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  1 · `GET /residencia/puerta/arranque` · LA CACHÉ DE SU HABITACIÓN
  // ════════════════════════════════════════════════════════════════
  //
  // Decisión de producto 7. Lo que la tablet guarda para poder pintar «lo
  // que toca» y registrar **sin red**, y nada más: lo de SU habitación.
  //
  // No es «el centro filtrado en la pantalla»: es que el servidor no le
  // manda otra cosa. Una tablet de pasillo con el plan de 49 residentes
  // dentro es una copia de los datos de salud del centro colgada de una
  // pared, y el día que alguien se la lleve da igual lo que pintara.
  //
  // Lo único que no es «de su habitación» son el catálogo, los ajustes, los
  // turnos y los momentos — que son del centro y no de nadie.
  app.get(
    "/residencia/puerta/arranque",
    { preHandler: [requirePuertaDevice] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const prisma = getPrisma();
      const ahora = new Date();

      const habitacion = await prisma.room.findFirst({
        where: { id: ctx.roomId, tenantId: ctx.tenantId },
        select: {
          id: true,
          number: true,
          name: true,
          floor: { select: { id: true, name: true } },
        },
      });
      if (!habitacion) {
        return reply.code(409).send({
          error: "HABITACION_RETIRADA",
          message:
            "Esta tablet estaba emparejada a una habitación que ya no existe. Avisa a dirección.",
        });
      }

      const ocupantes = await ocupantesDeLaHabitacion(prisma, ctx.roomId);
      const clientIds = ocupantes.map((o) => o.clientId);

      const [
        perfiles,
        conFoto,
        plan,
        ajustes,
        turnos,
        momentos,
        controles,
        pins,
      ] = await Promise.all([
        prisma.residentProfile.findMany({
          where: { tenantId: ctx.tenantId, clientId: { in: clientIds } },
          select: { clientId: true, photoFileName: true },
        }),
        consentimientosDeImagen(prisma, ctx.tenantId, clientIds),
        // El plan VIVO de los residentes de esta habitación. `toAt: null`:
        // el histórico no hace falta para registrar y es más dato en una
        // tablet que se puede perder.
        prisma.carePlanItem.findMany({
          where: {
            tenantId: ctx.tenantId,
            clientId: { in: clientIds },
            toAt: null,
          },
          select: {
            id: true,
            clientId: true,
            controlCode: true,
            fromAt: true,
            toAt: true,
            ...FRECUENCIA_SELECT,
          },
        }),
        prisma.centerControlSetting.findMany({
          where: { tenantId: ctx.tenantId },
          select: { controlCode: true, active: true, alias: true },
        }),
        prisma.centerShift.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
          select: {
            id: true,
            code: true,
            name: true,
            startsAt: true,
            endsAt: true,
          },
        }),
        prisma.centerMoment.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: [{ sortOrder: "asc" }],
          select: { code: true, name: true, atTime: true },
        }),
        prisma.controlType.findMany({
          where: {
            supersededAt: null,
            OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId: ctx.tenantId }],
          },
          orderBy: [{ layer: "asc" }, { sortOrder: "asc" }],
          select: {
            id: true,
            code: true,
            name: true,
            version: true,
            layer: true,
            nature: true,
            valueDomain: true,
            groupCode: true,
            options: {
              orderBy: { sortOrder: "asc" },
              select: { code: true, label: true, isAsUsual: true },
            },
          },
        }),
        // ── El ROSTER DE CUIDADO, para resolver el PIN sin red ───────
        //
        // Quién puede entrar en esta puerta, con su huella de búsqueda y
        // sus roles vigentes. Mismo reparto que el roster de
        // `/shift/offline-bundle` en el TPV (v1.10 §1-2) y mismo modelo de
        // confianza, con una diferencia a favor: **aquí no viaja ningún
        // hash de contraseña**. Lo que viaja es la huella HMAC, que no
        // sirve para nada fuera de esta puerta.
        //
        // Lo que sí permite una tablet robada es probar las diez mil
        // combinaciones y aprender los PIN de la plantilla. Es la misma
        // exposición que el roster del TPV acepta y documenta, y por eso la
        // caché **se vacía al revocar el dispositivo** (decisión 7).
        prisma.carePin.findMany({
          where: { tenantId: ctx.tenantId },
          select: {
            userId: true,
            pinLookup: true,
            user: {
              select: {
                id: true,
                alias: true,
                email: true,
                careRoleAssignments: {
                  where: {
                    revokedAt: null,
                    careRole: { active: true, recordsCare: true },
                  },
                  select: {
                    id: true,
                    fromAt: true,
                    toAt: true,
                    careRole: {
                      select: { code: true, name: true, fullScope: true },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

      const fotoPorCliente = new Map(
        perfiles.map((p) => [p.clientId, p.photoFileName]),
      );

      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: ahora },
      });

      // La subclave con la que la tablet recalcula las huellas. `dekONada`
      // y no `asegurarDek`: el arranque LEE, y crear la clave de un centro
      // aquí dejaría filas de clave en centros que no han escrito nada
      // (residencia-1b §4). Sin clave, el roster va vacío y el PIN se
      // resuelve sólo con red — que es exactamente lo que hay.
      const dek = await dekONada(ctx.tenantId, prisma);
      const subclave = dek
        ? subclaveDePinDePuerta(dek, ctx.tenantId).toString("base64")
        : null;

      return {
        device: { id: ctx.deviceId, name: ctx.deviceName },
        habitacion: {
          id: habitacion.id,
          number: habitacion.number,
          name: habitacion.name,
          plantaId: habitacion.floor.id,
          plantaName: habitacion.floor.name,
        },
        // Nombre, cama y si hay foto que pedir. **El nombre y la foto son
        // lo único de los residentes que la pantalla en reposo pinta.**
        ocupantes: ocupantes.map((o) => ({
          clientId: o.clientId,
          bedId: o.bedId,
          bedLabel: o.bedLabel,
          nombre: o.nombre,
          // `true` sólo si hay fichero Y consentimiento vigente. La tablet
          // no tiene que saber de consentimientos: pide la foto si esto es
          // `true`, y pinta las iniciales si no.
          tieneFoto:
            fotoPorCliente.get(o.clientId) != null && conFoto.has(o.clientId),
        })),
        plan: plan.map((l) => ({
          id: l.id,
          clientId: l.clientId,
          controlCode: l.controlCode,
          frecuencia: deColumnas(l),
          fromAt: l.fromAt.toISOString(),
          toAt: l.toAt?.toISOString() ?? null,
        })),
        ajustes: ajustes.map((a) => ({
          controlCode: a.controlCode,
          active: a.active,
          alias: a.alias,
        })),
        turnos,
        momentos,
        controles: controles.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          version: c.version,
          layer: c.layer,
          nature: c.nature,
          valueDomain: c.valueDomain,
          groupCode: c.groupCode,
          opciones: c.options,
        })),
        roster: pins.map((p) => ({
          userId: p.userId,
          nombre: p.user.alias ?? (p.user.email.split("@")[0] ?? p.user.email),
          pinLookup: p.pinLookup,
          roles: p.user.careRoleAssignments
            .filter((a) => a.fromAt <= ahora && (a.toAt == null || a.toAt > ahora))
            .map((a) => ({
              assignmentId: a.id,
              code: a.careRole.code,
              name: a.careRole.name,
              alcanceTotal: a.careRole.fullScope,
            })),
        })),
        pinSubclave: subclave,
        // La hora del SERVIDOR, para que la tablet mida su desvío de reloj
        // (kds-2, residencia-1). Sin desvío no puede adscribir un registro
        // offline al turno correcto.
        serverTime: ahora.toISOString(),
      };
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  2 · `POST /residencia/puerta/pin` · QUIÉN ESTÁ DELANTE
  // ════════════════════════════════════════════════════════════════
  //
  // Sólo el PIN, como pide el mockup (D-64). La huella lo encuentra en una
  // consulta indexada y argon2id lo verifica contra ESA fila — ver la
  // cabecera de `care_pins` en el esquema para por qué hay dos columnas.
  //
  // ── Y si la persona lleva DOS roles de cuidado vivos (D-31) ───────
  //
  // Se le pregunta con cuál entra, y hasta que conteste **no hay sesión**.
  // La capacidad es la mitad de la firma, así que elegirla por ella —«el
  // primero de la lista»— sería firmar sus registros con un rol que no es
  // el que está ejerciendo. Con un rol, no se le pregunta nada.
  app.post(
    "/residencia/puerta/pin",
    {
      preHandler: [requirePuertaDevice],
      schema: {
        body: {
          type: "object",
          required: ["pin"],
          additionalProperties: false,
          properties: {
            // Cuatro a ocho cifras. La pantalla pinta cuatro; el margen
            // está para que un centro pueda alargarlo sin una migración.
            pin: { type: "string", pattern: "^[0-9]{4,8}$" },
            // El rol elegido cuando hay más de uno. En la primera llamada
            // no viene.
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const { pin, careRoleAssignmentId } = request.body as {
        pin: string;
        careRoleAssignmentId?: string;
      };
      const prisma = getPrisma();
      const ahora = new Date();

      const limite = limiteDelPin(ctx.tenantId, ctx.deviceId);
      const previo = await inspect(limite);
      if (previo.locked) {
        return reply.code(429).send({
          error: "PUERTA_PIN_BLOQUEADO",
          message: `Demasiados intentos en esta tablet. Prueba en ${Math.ceil(
            previo.retryAfterSeconds / 60,
          )} min, o usa otra puerta.`,
          retryAfterSeconds: previo.retryAfterSeconds,
        });
      }

      // La misma frase para «ese PIN no es de nadie» y para «ese PIN no es
      // el tuyo». Decir cuál de las dos es permite barrer el espacio de
      // cuatro cifras aprendiendo qué PIN existen.
      const NO = {
        error: "PIN_INCORRECTO",
        message: "Ese PIN no es correcto.",
      };

      const dek = await dekONada(ctx.tenantId, prisma);
      if (dek == null) {
        // Un centro con la residencia encendida y sin clave clínica no ha
        // escrito nunca nada cifrado, así que no puede tener PIN de puerta
        // (ponerlo exige la clave). Es un centro sin configurar, y decirlo
        // es mejor que un «PIN incorrecto» que manda a la auxiliar a
        // probar: ni este PIN ni ningún otro va a entrar.
        return reply.code(409).send({
          error: "PUERTA_SIN_PIN_CONFIGURADO",
          message:
            "En este centro todavía no hay ningún PIN de puerta. Dirección los pone desde Personal.",
        });
      }

      const huella = huellaDePinDePuerta(
        pin,
        subclaveDePinDePuerta(dek, ctx.tenantId),
        ctx.tenantId,
      );
      const fila = await prisma.carePin.findUnique({
        where: {
          tenantId_pinLookup: { tenantId: ctx.tenantId, pinLookup: huella },
        },
        select: {
          userId: true,
          pinHash: true,
          user: {
            select: {
              id: true,
              alias: true,
              email: true,
              careRoleAssignments: {
                where: {
                  revokedAt: null,
                  careRole: { active: true, recordsCare: true },
                },
                select: {
                  id: true,
                  fromAt: true,
                  toAt: true,
                  careRole: { select: { code: true, name: true } },
                },
              },
            },
          },
        },
      });
      // argon2id contra LA fila que la huella encontró, y no contra las
      // veinte: eso es lo que hace que esto sean 250 ms y no cinco
      // segundos. Y se verifica igual aunque la huella ya cuadre, porque
      // una huella escrita a mano en la base no debe abrir nada.
      if (!fila || !(await verifyPassword(fila.pinHash, pin))) {
        const estado = await registerFailure(limite);
        return reply
          .code(401)
          .send({ ...NO, attemptsRemaining: estado.attemptsRemaining });
      }

      const vivos = fila.user.careRoleAssignments.filter(
        (a) => a.fromAt <= ahora && (a.toAt == null || a.toAt > ahora),
      );
      if (vivos.length === 0) {
        // El PIN es bueno y la persona ya no tiene rol de cuidado vigente
        // (la dieron de baja, o se le revocó). **No es un PIN incorrecto**
        // y no cuenta como intento fallido: decirle «PIN incorrecto» la
        // dejaría tecleándolo otra vez en el pasillo.
        await reset(limite);
        return reply.code(403).send({
          error: "SIN_ROL_DE_CUIDADO",
          message:
            "Tu PIN es correcto pero no tienes ningún rol de cuidado vigente. Avisa a dirección.",
        });
      }

      let elegido = vivos[0]!;
      if (vivos.length > 1) {
        if (!careRoleAssignmentId) {
          // **No hay sesión todavía.** Se devuelve la lista y la pantalla
          // pregunta. 200 y no 409: no es un error, es el paso 2 de 2.
          await reset(limite);
          return reply.code(200).send({
            necesitaElegirRol: true,
            nombre: fila.user.alias ?? fila.user.email.split("@")[0],
            roles: vivos.map((a) => ({
              assignmentId: a.id,
              code: a.careRole.code,
              name: a.careRole.name,
            })),
          });
        }
        const encontrado = vivos.find((a) => a.id === careRoleAssignmentId);
        if (!encontrado) {
          return reply.code(400).send({
            error: "ROL_NO_VIGENTE",
            message: "Ese rol de cuidado ya no está vigente. Vuelve a entrar.",
          });
        }
        elegido = encontrado;
      } else if (careRoleAssignmentId && careRoleAssignmentId !== elegido.id) {
        return reply.code(400).send({
          error: "ROL_NO_VIGENTE",
          message: "Ese rol de cuidado ya no está vigente. Vuelve a entrar.",
        });
      }

      await reset(limite);

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { cashierSessionTtlMinutes: true },
      });
      const token = signPuertaSesion(
        {
          sub: fila.user.id,
          tid: ctx.tenantId,
          did: ctx.deviceId,
          rid: ctx.roomId,
          caid: elegido.id,
          crc: elegido.careRole.code,
        },
        tenant.cashierSessionTtlMinutes,
      );

      return reply.code(200).send({
        token,
        // La ventana de inactividad la aplica la TABLET, como el
        // auto-logout del TPV. Sesenta segundos (decisión 8): una tablet de
        // pasillo con la historia de dos personas abierta no se queda así
        // porque alguien se haya ido corriendo.
        inactividadSegundos: 60,
        usuario: {
          id: fila.user.id,
          nombre: fila.user.alias ?? fila.user.email.split("@")[0],
        },
        rol: {
          assignmentId: elegido.id,
          code: elegido.careRole.code,
          name: elegido.careRole.name,
        },
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  3 · `GET /residencia/puerta/lo-que-toca` · LA PANTALLA 3
  // ════════════════════════════════════════════════════════════════
  //
  // Lo que `queToca` dice para la franja de ahora, cruzado con lo que ya
  // está registrado en este turno. Las dos mitades juntas porque la
  // pantalla las pinta juntas: «cambio postural · desde las 10:00 · cada
  // 3 h» con su botón «Hecho», o en gris con «lo hizo Ana a las 10:05».
  //
  // Y **con red**. Sin red la tablet calcula lo mismo con su caché: por eso
  // `queToca` es un paquete puro y por eso el arranque trae el plan. Esta
  // ruta es la versión autoritativa, la que además deja la línea en el
  // registro de accesos y la que trae lo que registró OTRA persona del
  // mismo turno — que la tablet no puede saber si estuvo sin red.
  app.get(
    "/residencia/puerta/lo-que-toca",
    { preHandler: [requirePuertaDevice, requirePuertaSesion] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const sesion = request.puertaSesion!;
      const prisma = getPrisma();
      const ahora = new Date();

      const ocupantes = await ocupantesDeLaHabitacion(prisma, ctx.roomId);
      if (ocupantes.length === 0) {
        return reply.code(200).send({
          habitacionLibre: true,
          residentes: [],
          serverTime: ahora.toISOString(),
        });
      }

      const visibles = await residentesVisibles(prisma, {
        tenantId: ctx.tenantId,
        userId: sesion.userId,
        deviceId: ctx.deviceId,
        ruta: "GET /residencia/puerta/lo-que-toca",
        accion: "READ",
        clientIds: ocupantes.map((o) => o.clientId),
      });
      if (visibles.size === 0) {
        // D-51 · fuera de su zona no ve DATOS, y lo que ve es la frase.
        // 403 y no 404: la habitación existe y ella sabe que existe —está
        // delante de su puerta—; lo que falta es el alcance.
        return reply.code(403).send({
          error: "HABITACION_FUERA_DE_TU_ZONA",
          message:
            "Esta habitación no es de tu zona. Si tienes que registrar algo aquí, dirección puede darte la planta.",
        });
      }

      // clinica-7 · el contrato de encargado. Para LEER, igual que
      // `conHistoria`: con el contrato nunca aceptado, ni una ruta clínica
      // responde con datos.
      const negativa = await negativaClinica(ctx.tenantId, "LEER");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const clientIds = ocupantes
        .filter((o) => visibles.has(o.clientId))
        .map((o) => o.clientId);

      const [plan, ajustes, turnos, momentos, controles, perfiles] =
        await Promise.all([
          prisma.carePlanItem.findMany({
            where: { tenantId: ctx.tenantId, clientId: { in: clientIds } },
            select: {
              id: true,
              clientId: true,
              controlCode: true,
              fromAt: true,
              toAt: true,
              ...FRECUENCIA_SELECT,
            },
          }),
          prisma.centerControlSetting.findMany({
            where: { tenantId: ctx.tenantId },
            select: { controlCode: true, active: true, alias: true },
          }),
          prisma.centerShift.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: {
              id: true,
              code: true,
              name: true,
              startsAt: true,
              endsAt: true,
            },
          }),
          prisma.centerMoment.findMany({
            where: { tenantId: ctx.tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: { code: true, name: true, atTime: true },
          }),
          controlesActivos(prisma, ctx.tenantId),
          prisma.residentProfile.findMany({
            where: { tenantId: ctx.tenantId, clientId: { in: clientIds } },
            select: { clientId: true, photoFileName: true },
          }),
        ]);

      const turno = turnoDe(ahora, turnos);
      const careDay = diaDelTurno(ahora, turno);

      // La ventana: el DÍA de pared entero. La pantalla filtra por turno,
      // pero lo que trae es el día porque «lo que toca ahora» de un turno
      // de noche empieza antes de medianoche y acaba después.
      const diaDePared = utcToWallDate(ahora);
      const desde = wallTimeToUtc(careDay, "00:00");
      const hasta = wallTimeToUtc(siguienteDia(diaDePared), "00:00");

      const ocurrencias = queToca(
        plan.map((l) => ({
          id: l.id,
          clientId: l.clientId,
          controlCode: l.controlCode,
          frecuencia: deColumnas(l),
          fromAt: l.fromAt,
          toAt: l.toAt,
        })),
        ajustes.map((a) => ({ controlCode: a.controlCode, active: a.active })),
        turnos,
        momentos,
        desde,
        hasta,
      );

      // Lo registrado en ESTE día del centro, de estos residentes. La
      // cadena COMPLETA (también las correcciones y las anuladas), porque
      // `vistaDeRegistros` necesita el conjunto entero para decir cuál es
      // el valor de ahora.
      const dek = await dekParaLeer(ctx.tenantId, prisma);
      const registros = await prisma.careRecord.findMany({
        where: {
          tenantId: ctx.tenantId,
          clientId: { in: clientIds },
          careDay,
        },
        orderBy: { recordedAt: "asc" },
        select: REGISTRO_SELECT,
      });
      const vista = vistaDeRegistros(registros, dek);

      const alias = new Map(ajustes.map((a) => [a.controlCode, a.alias]));
      const nombreDe = (code: string) =>
        alias.get(code) ?? controles.get(code)?.code ?? code;

      const fotoPorCliente = new Map(
        perfiles.map((p) => [p.clientId, p.photoFileName]),
      );
      const conFoto = await consentimientosDeImagen(
        prisma,
        ctx.tenantId,
        clientIds,
      );

      const porOcurrencia = (o: Ocurrencia) => ({
        controlCode: o.controlCode,
        nombre: nombreDe(o.controlCode),
        planItemId: o.planItemId,
        at: o.at.toISOString(),
        until: o.until?.toISOString() ?? null,
        esFranja: o.esFranja,
        shiftCode: o.shiftCode,
        momentCode: o.momentCode,
      });

      return reply.code(200).send({
        habitacionLibre: false,
        turno: turno
          ? { id: turno.id, code: turno.code, name: turno.name }
          : null,
        careDay,
        residentes: ocupantes
          .filter((o) => visibles.has(o.clientId))
          .map((o) => ({
            clientId: o.clientId,
            bedLabel: o.bedLabel,
            nombre: o.nombre,
            tieneFoto:
              fotoPorCliente.get(o.clientId) != null && conFoto.has(o.clientId),
            // Lo que toca en el turno de ahora. Si no hay turno —hueco en
            // el cuadrante— se devuelve lo del día sin filtrar y la
            // pantalla lo pinta con su aviso: un cuidado que toca no se
            // esconde porque el cuadrante esté mal hecho.
            toca: ocurrencias
              .filter(
                (oc) =>
                  oc.clientId === o.clientId &&
                  (turno == null || oc.shiftCode === turno.code),
              )
              .map(porOcurrencia),
            registros: vista.filter((r) => r.clientId === o.clientId),
          })),
        // Los controles activos, para que la pantalla sepa qué pintar de
        // cada uno (botón, opciones ordinales, nota) sin inventarse nada.
        controles: [...controles.values()].map((c) => ({
          code: c.code,
          nombre: nombreDe(c.code),
          layer: c.layer,
          nature: c.nature,
          valueDomain: c.valueDomain,
          opciones: c.opciones,
        })),
        serverTime: ahora.toISOString(),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  4 · `POST /residencia/puerta/registros` · EL LOTE
  // ════════════════════════════════════════════════════════════════
  //
  // Idempotente por el uuid que generó la tablet. Un lote es **un gesto**:
  // el toque de «como siempre» son siete filas y una sola petición, que es
  // lo que hace que quepa en los dos segundos de D-05 con una wifi mala.
  //
  // ── Qué comprueba el servidor de la firma de CADA registro ────────
  //
  // La sesión dice quién está delante; el cuerpo dice quién hizo cada cosa
  // (ver la cabecera de `puerta-sesion.ts`: un lote de la noche sale con la
  // sesión de la mañana). Así que la firma se comprueba por registro:
  //
  //   1. la asignación de rol es de esa persona, de este centro, de un rol
  //      que REGISTRA, y **estaba vigente en el `recordedAt`** — no
  //      «ahora». Un cambio postural hecho el martes por alguien a quien se
  //      revocó el rol el miércoles entra, y tiene que entrar: lo hizo.
  //   2. esa persona ALCANZA a ese residente (D-51), por la función de
  //      acceso de la casa, con su línea `WRITE` en el registro de accesos.
  //   3. el residente está en LA HABITACIÓN DE ESTA TABLET.
  app.post(
    "/residencia/puerta/registros",
    {
      preHandler: [requirePuertaDevice, requirePuertaSesion],
      schema: {
        body: {
          type: "object",
          required: ["registros"],
          additionalProperties: false,
          properties: {
            registros: {
              type: "array",
              minItems: 1,
              // Cincuenta: el gesto más grande del mockup es «no está como
              // siempre» con las siete dimensiones más una nota, o sea
              // ocho. Cincuenta deja sitio de sobra para un reenvío que
              // agrupe y acota el tamaño del POST con las notas de voz
              // dentro.
              maxItems: 50,
              items: {
                type: "object",
                required: [
                  "id",
                  "clientId",
                  "controlCode",
                  "recordedAt",
                  "careDay",
                  "valor",
                ],
                additionalProperties: false,
                properties: {
                  id: { type: "string", format: "uuid" },
                  clientId: { type: "string", format: "uuid" },
                  controlCode: { type: "string", maxLength: 60 },
                  planItemId: { type: ["string", "null"], format: "uuid" },
                  occurrenceAt: { type: ["string", "null"] },
                  recordedAt: { type: "string" },
                  centerShiftId: { type: ["string", "null"], format: "uuid" },
                  careDay: { type: "string", maxLength: 10 },
                  firmadoPorUserId: { type: "string", format: "uuid" },
                  careRoleAssignmentId: { type: "string", format: "uuid" },
                  valor: {
                    type: "object",
                    required: ["tipo"],
                    additionalProperties: false,
                    properties: {
                      tipo: { type: "string", enum: ["BOOL", "ORDINAL", "NOTA"] },
                      hecho: { type: "boolean" },
                      opcion: { type: "string", maxLength: 60 },
                    },
                  },
                  nota: { type: ["string", "null"], maxLength: 500 },
                  voz: {
                    type: ["object", "null"],
                    required: ["webmBase64"],
                    additionalProperties: false,
                    properties: {
                      // 2 MB de audio son ~2,7 MB en base64. El tope real
                      // lo pone `CARE_VOICE_MAX_BYTES` sobre los bytes
                      // decodificados; esto sólo acota el JSON.
                      webmBase64: { type: "string", maxLength: 3_000_000 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const sesion = request.puertaSesion!;
      const prisma = getPrisma();
      const ahora = new Date();
      const cuerpo = request.body as {
        registros: Array<
          RegistroEntrante & {
            firmadoPorUserId?: string;
            careRoleAssignmentId?: string;
          }
        >;
      };

      // clinica-7 · el contrato de encargado, y aquí para ESCRIBIR: con el
      // contrato no vigente la historia pasa a solo lectura. 423.
      const negativa = await negativaClinica(ctx.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const ocupantes = await ocupantesDeLaHabitacion(prisma, ctx.roomId);
      const clientesDeLaHabitacion = new Set(ocupantes.map((o) => o.clientId));

      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: ctx.tenantId },
        select: { id: true },
      });
      const controles = await controlesActivos(prisma, ctx.tenantId);

      // ── Las firmas, agrupadas: una comprobación por (persona, rol) ───
      //
      // Un lote de siete filas lleva una sola firma en el caso normal, y
      // comprobarla siete veces serían siete resoluciones de acceso y siete
      // consultas de asignación por un toque de dos segundos.
      const resultados = [];
      const firmasComprobadas = new Map<string, string | null>();
      const visiblesPorFirmante = new Map<string, Set<string>>();

      for (const entrante of cuerpo.registros) {
        const userId = entrante.firmadoPorUserId ?? sesion.userId;
        const assignmentId =
          entrante.careRoleAssignmentId ?? sesion.caid;
        const clave = `${userId}|${assignmentId}`;

        if (!firmasComprobadas.has(clave)) {
          firmasComprobadas.set(
            clave,
            await problemaDeLaFirma(prisma, {
              tenantId: ctx.tenantId,
              userId,
              assignmentId,
              // Vigente EN EL INSTANTE DEL REGISTRO, no ahora.
              instante: new Date(entrante.recordedAt),
            }),
          );
        }
        const problema = firmasComprobadas.get(clave)!;
        if (problema) {
          resultados.push({
            id: entrante.id,
            estado: "rechazado" as const,
            codigo: "FIRMA_NO_VALIDA",
            mensaje: problema,
          });
          continue;
        }

        if (!visiblesPorFirmante.has(userId)) {
          visiblesPorFirmante.set(
            userId,
            await residentesVisibles(prisma, {
              tenantId: ctx.tenantId,
              userId,
              deviceId: ctx.deviceId,
              ruta: "POST /residencia/puerta/registros",
              accion: "WRITE",
              clientIds: [...clientesDeLaHabitacion],
            }),
          );
        }
        if (!visiblesPorFirmante.get(userId)!.has(entrante.clientId)) {
          resultados.push({
            id: entrante.id,
            estado: "rechazado" as const,
            codigo: "RESIDENTE_FUERA_DE_TU_ZONA",
            mensaje:
              "Quien firma este registro no alcanza a ese residente. Dirección puede darle la planta.",
          });
          continue;
        }

        resultados.push(
          await escribirRegistro(
            prisma,
            {
              tenantId: ctx.tenantId,
              deviceId: ctx.deviceId,
              firma: { userId, careRoleAssignmentId: assignmentId },
              clientesDeLaHabitacion,
              controles,
              turnos: new Set(turnos.map((t) => t.id)),
              ahora,
            } satisfies ContextoDelLote,
            entrante,
          ),
        );
      }

      const guardados = resultados.filter(
        (r) => r.estado === "guardado" || r.estado === "corrige" || r.estado === "ya-estaba",
      ).length;

      // ── Si NO entró nada, 409 · y si entró algo, 200 con el detalle ──
      //
      // La cola del TPV trata un 4xx como rechazo permanente: lo deja
      // `rejected`, no lo reintenta en bucle y lo pinta en el chip de
      // pendientes. Es exactamente lo que hace falta cuando no entró nada —
      // la hora de la tablet está mal, o le revocaron el rol— porque eso no
      // se arregla reintentando y alguien tiene que verlo.
      //
      // Y un 200 cuando entró algo, con el detalle por registro: la tablet
      // borra el item de la cola (lo que entró, entró) y pinta lo que no
      // pudo. Un 409 aquí haría que un reenvío repitiera para siempre un
      // lote del que seis de siete están ya guardados.
      if (guardados === 0) {
        return reply.code(409).send({
          error: "LOTE_RECHAZADO",
          code: "LOTE_RECHAZADO",
          message:
            resultados[0]?.mensaje ??
            "No se pudo guardar ninguno de estos registros.",
          registros: resultados,
        });
      }
      return reply.code(200).send({ registros: resultados });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  5 · `POST /residencia/puerta/registros/:id/anular`
  // ════════════════════════════════════════════════════════════════
  //
  // «Deshacer el último» de la pantalla 6. **Anula, no borra**: rellena
  // `voidedAt` y `voidedByUserId`, que es la única transición que el
  // trigger `care_records_inmutable` deja pasar.
  //
  // Dos condiciones, y las dos son de producto (decisión 1):
  //
  //   · **sólo quien lo firmó.** Deshacer lo de otra persona es corregir
  //     su trabajo sin decírselo; para eso está «Corregir», que escribe una
  //     fila nueva con quien corrige dentro.
  //   · **sólo en la ventana.** Diez minutos. Es «me he equivocado de
  //     botón», no «quiero que esto no conste»: pasada la ventana, lo que
  //     hay es una corrección, que deja las dos cosas a la vista.
  app.post(
    "/residencia/puerta/registros/:id/anular",
    {
      preHandler: [requirePuertaDevice, requirePuertaSesion],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const sesion = request.puertaSesion!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const ahora = new Date();

      const negativa = await negativaClinica(ctx.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const fila = await prisma.careRecord.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: {
          id: true,
          clientId: true,
          recordedByUserId: true,
          recordedAt: true,
          voidedAt: true,
        },
      });
      if (!fila) {
        return reply.code(404).send({
          error: "REGISTRO_NO_ENCONTRADO",
          message: "Ese registro no es de este centro.",
        });
      }

      const ocupantes = await ocupantesDeLaHabitacion(prisma, ctx.roomId);
      if (!ocupantes.some((o) => o.clientId === fila.clientId)) {
        return reply.code(403).send({
          error: "REGISTRO_DE_OTRA_HABITACION",
          message: "Ese registro no es de un residente de esta habitación.",
        });
      }
      if (fila.recordedByUserId !== sesion.userId) {
        return reply.code(403).send({
          error: "SOLO_QUIEN_LO_FIRMO",
          message:
            "Sólo puede deshacerlo quien lo apuntó. Si está mal, corrígelo: queda tu nombre en la corrección.",
        });
      }
      if (fila.voidedAt != null) {
        return reply.code(409).send({
          error: "YA_ESTABA_ANULADO",
          message: "Ese registro ya estaba deshecho.",
        });
      }
      if (ahora.getTime() - fila.recordedAt.getTime() > VENTANA_DE_ANULACION_MS) {
        return reply.code(409).send({
          error: "FUERA_DE_LA_VENTANA",
          message:
            "Ha pasado demasiado tiempo para deshacerlo. Corrígelo: así queda lo que se apuntó y lo que se corrigió.",
        });
      }

      // La línea del registro de accesos ANTES de escribir, como siempre.
      await apuntarAcceso({
        tenantId: ctx.tenantId,
        userId: sesion.userId,
        clientId: fila.clientId,
        action: "WRITE",
        outcome: "ALLOWED",
        deviceId: ctx.deviceId,
        route: "POST /residencia/puerta/registros/:id/anular",
      });

      await prisma.careRecord.update({
        where: { id: fila.id },
        data: { voidedAt: ahora, voidedByUserId: sesion.userId },
      });
      return reply.code(200).send({ id: fila.id, anuladoEn: ahora.toISOString() });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  6 · `GET /residencia/puerta/residentes/:clientId/foto`
  // ════════════════════════════════════════════════════════════════
  //
  // D-64. La cara del residente, en la pantalla en reposo y en «lo que
  // toca». **Sólo con consentimiento de imagen vigente**; sin él, 404 y la
  // tablet pinta las iniciales.
  //
  // ── Por qué NO lleva sesión de puerta ni deja línea de acceso ─────
  //
  // Porque se pinta ANTES del PIN: en la pantalla 1, que es la que está
  // encendida las veinticuatro horas. Su identidad es el DISPOSITIVO, y una
  // línea en el registro de accesos sin persona no contesta «¿quién ha
  // abierto la historia de mi madre?» — es la decisión 3 de residencia-1,
  // la misma por la que `/residencia/puerta/me` tampoco apunta.
  //
  // Lo que la protege no es un rol: es el consentimiento. Y eso es correcto
  // para lo que es — una cara en un pasillo donde su nombre ya está en el
  // timbre — y sería incorrecto para cualquier dato de salud, que por eso
  // no se pinta en esa pantalla.
  //
  // **404 y no 403** cuando no hay consentimiento: un 403 diría «esta
  // persona tiene foto y no te la damos», y en una tablet de pasillo eso ya
  // es decir algo de ella. La tablet trata las dos igual: iniciales.
  app.get(
    "/residencia/puerta/residentes/:clientId/foto",
    {
      preHandler: [requirePuertaDevice],
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const { clientId } = request.params as { clientId: string };
      const prisma = getPrisma();

      // Sólo los residentes de ESTA habitación. La tablet de la 112 no
      // sirve la cara del de la 114 ni aunque alguien pida su id.
      const ocupantes = await ocupantesDeLaHabitacion(prisma, ctx.roomId);
      if (!ocupantes.some((o) => o.clientId === clientId)) {
        return reply.code(404).send({
          error: "SIN_FOTO",
          message: "No hay foto que enseñar.",
        });
      }

      const perfil = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId: ctx.tenantId },
        select: { photoFileName: true, photoSha256: true, photoMimeType: true },
      });
      const con = await consentimientosDeImagen(prisma, ctx.tenantId, [clientId]);
      if (!perfil?.photoFileName || !con.has(clientId)) {
        return reply.code(404).send({
          error: "SIN_FOTO",
          message: "No hay foto que enseñar.",
        });
      }

      const dek = await dekONada(ctx.tenantId, prisma);
      const leido = await leerFichero(
        "RESIDENTE",
        perfil.photoFileName,
        perfil.photoSha256,
        { tenantId: ctx.tenantId, dek },
      );
      if (!leido) {
        return reply.code(404).send({
          error: "SIN_FOTO",
          message: "No hay foto que enseñar.",
        });
      }
      // La huella se dice en una cabecera y la foto se sirve igual, como
      // los ficheros clínicos de clinica-4: una foto que no cuadra con su
      // huella es justo la que alguien tiene que mirar.
      return reply
        .code(200)
        .header("Content-Type", perfil.photoMimeType ?? MIME_DE_FOTO)
        .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "no")
        // Sin caché en disco del navegador: es una cara en un pasillo y la
        // retirada de un consentimiento tiene que notarse al recargar.
        .header("Cache-Control", "no-store")
        .send(leido.contenido);
    },
  );
}

/**
 * ¿Qué le pasa a esta firma? `null` si está bien.
 *
 * Comprueba la asignación de rol de cuidado **en el instante del
 * registro**, no ahora: un cambio postural hecho el martes por alguien a
 * quien se le revocó el rol el miércoles es un cuidado que ocurrió, y su
 * firma dice la verdad. Al contrario, un registro con `recordedAt` de
 * antes de que esa persona tuviera el rol no la dice.
 */
async function problemaDeLaFirma(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    userId: string;
    assignmentId: string;
    instante: Date;
  },
): Promise<string | null> {
  const asignacion = await prisma.careRoleAssignment.findFirst({
    where: { id: input.assignmentId, tenantId: input.tenantId },
    select: {
      userId: true,
      fromAt: true,
      toAt: true,
      revokedAt: true,
      careRole: { select: { active: true, recordsCare: true, name: true } },
    },
  });
  if (!asignacion) return "Esa capacidad no existe en este centro.";
  if (asignacion.userId !== input.userId) {
    return "Esa capacidad no es de quien firma el registro.";
  }
  if (!asignacion.careRole.recordsCare) {
    return `El rol «${asignacion.careRole.name}» no registra cuidados.`;
  }
  if (!asignacion.careRole.active) {
    return `El rol «${asignacion.careRole.name}» está desactivado en este centro.`;
  }
  if (Number.isNaN(input.instante.getTime())) {
    return "El instante del registro no es una fecha.";
  }
  if (asignacion.fromAt > input.instante) {
    return "Quien firma no tenía ese rol cuando se hizo el cuidado.";
  }
  if (asignacion.toAt != null && asignacion.toAt <= input.instante) {
    return "Quien firma ya no tenía ese rol cuando se hizo el cuidado.";
  }
  // `revokedAt` se mira contra el instante por lo mismo: revocar hoy no
  // borra lo que esa persona hizo ayer con ese rol.
  if (asignacion.revokedAt != null && asignacion.revokedAt <= input.instante) {
    return "Ese rol estaba revocado cuando se hizo el cuidado.";
  }
  return null;
}

/** «YYYY-MM-DD» + 1 día, en calendario. Copia de `plan-routes.ts`; son
 *  cuatro líneas y moverlas a un sitio común significaría decidir cuál. */
function siguienteDia(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}
