// residencia-1 · LOS RESIDENTES.
//
// Alta, lista, ficha, cambio de habitación y alta de salida. Nada más: el
// plan de cuidados es residencia-2 y lo que se registra en la puerta es
// residencia-3.
//
// ── Las tres puertas de cada ruta, y por qué son tres ────────────────
//
//   1. `requireOwnerOrManager` (o `requireOwnerOrCashier` en las de
//      lectura) · quién es y de qué tenant.
//   2. `ensureResidenciaEnabled` · el MÓDULO. Apagado, 404 — ni se sabe
//      que existe.
//   3. `conHistoria` · el RESIDENTE. Sólo en las rutas que leen o escriben
//      la ficha de UNO, y es LA función de acceso de la casa, ampliada por
//      este bloque. De paso deja la línea en `clinical_access_log`.
//
// La tercera no está en la LISTA, y es la decisión que más se nota. Ver
// `GET /residencia/residentes`.
//
// ── Lo que no entra en un log, nunca ─────────────────────────────────
//
// DNI, NSS, nivel de dependencia, grado, motivo de alta y el nombre del
// familiar. Ni a `request.log`, ni a Sentry, ni al cuerpo de un error. La
// misma regla que la historia clínica, y aquí por dos leyes a la vez
// (art. 9 RGPD y Ley 41/2002).

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
import { ensureResidenciaEnabled } from "./gate.js";

const PUERTAS_LECTURA = [
  requireOwnerOrCashier,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];
const PUERTAS_ESCRITURA = [
  requireOwnerOrManager,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];

const NIVELES = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"] as const;
const GRADOS = ["I", "II", "III"] as const;
const PLAZAS = ["PRIVADA", "CONCERTADA", "TEMPORAL"] as const;

/**
 * La ficha de un residente tal y como la pinta el admin. **Sin DNI ni NSS
 * en la lista**: la lista se enseña en una pantalla que mira cualquiera
 * que pase por el despacho, y el DNI sólo hace falta en la ficha.
 *
 * La ocupación cuelga del CLIENTE y no del perfil, y por eso el `select`
 * la pide a través de `client`: `BedAssignment.clientId` apunta a
 * `clients`, no a `resident_profiles`. Es la consecuencia de que el
 * residente SEA un `Client` (D-49) y no una entidad paralela — la misma
 * razón por la que hereda gratis la historia y los consentimientos.
 */
const CAMA_VIGENTE = {
  where: { toAt: null },
  take: 1,
  select: {
    id: true,
    fromAt: true,
    bed: {
      select: {
        id: true,
        label: true,
        room: {
          select: {
            id: true,
            number: true,
            name: true,
            floor: { select: { id: true, name: true } },
          },
        },
      },
    },
  },
} as const;

const PERFIL_SELECT = {
  clientId: true,
  admissionDate: true,
  dischargeDate: true,
  dischargeReason: true,
  dependencyLevel: true,
  dependencyGrade: true,
  placeType: true,
  responsibleName: true,
  responsiblePhone: true,
  responsibleRelation: true,
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      birthdate: true,
      bedAssignments: CAMA_VIGENTE,
    },
  },
} as const;

/** Una ocupación, como la trae `CAMA_VIGENTE`. */
interface OcupacionVigente {
  id: string;
  fromAt: Date;
  bed: {
    id: string;
    label: string;
    room: {
      id: string;
      number: string;
      name: string | null;
      floor: { id: string; name: string };
    };
  };
}

/**
 * Lo que `vistaResidente` necesita, declarado por ESTRUCTURA y no con el
 * tipo generado de Prisma.
 *
 * Es a propósito: los tipos de `select` de Prisma no se pueden nombrar sin
 * arrastrar `Prisma.ResidentProfileGetPayload<...>` por cada variante, y
 * aquí hay cuatro (lista, ficha, alta, cambio de cama) que sólo se
 * diferencian en si traen el DNI. Una interfaz estructural las cubre las
 * cuatro y el compilador sigue comprobando que el `select` trae lo que
 * esta función lee.
 */
interface FilaResidente {
  clientId: string;
  admissionDate: Date;
  dischargeDate: Date | null;
  dischargeReason: string | null;
  dependencyLevel: string;
  dependencyGrade: string | null;
  placeType: string;
  responsibleName: string | null;
  responsiblePhone: string | null;
  responsibleRelation: string | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    birthdate: Date | null;
    bedAssignments: OcupacionVigente[];
  };
}

function vistaResidente(p: FilaResidente) {
  // La VIGENTE. El `select` ya filtra `toAt: null`, así que como mucho hay
  // una — lo garantiza el índice parcial
  // `bed_assignments_one_live_per_client_key`.
  const cama = p.client.bedAssignments[0] ?? null;
  return {
    clientId: p.clientId,
    nombre: `${p.client.firstName} ${p.client.lastName}`.trim(),
    firstName: p.client.firstName,
    lastName: p.client.lastName,
    phone: p.client.phone,
    birthdate: p.client.birthdate
      ? p.client.birthdate.toISOString().slice(0, 10)
      : null,
    admissionDate: p.admissionDate.toISOString().slice(0, 10),
    dischargeDate: p.dischargeDate
      ? p.dischargeDate.toISOString().slice(0, 10)
      : null,
    dischargeReason: p.dischargeReason,
    dependencyLevel: p.dependencyLevel,
    dependencyGrade: p.dependencyGrade,
    placeType: p.placeType,
    responsible: p.responsibleName
      ? {
          name: p.responsibleName,
          phone: p.responsiblePhone,
          relation: p.responsibleRelation,
        }
      : null,
    // `null` = **ingreso pendiente**, y está permitido (el prompt lo dice):
    // una residencia da de alta a alguien que llega el lunes. El admin lo
    // pinta como aviso, no como error.
    cama: cama
      ? {
          assignmentId: cama.id,
          bedId: cama.bed.id,
          bedLabel: cama.bed.label,
          roomId: cama.bed.room.id,
          roomNumber: cama.bed.room.number,
          roomName: cama.bed.room.name,
          floorId: cama.bed.room.floor.id,
          floorName: cama.bed.room.floor.name,
          desde: cama.fromAt.toISOString(),
        }
      : null,
  };
}

export async function registerResidenciaResidentesRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── La LISTA ───────────────────────────────────────────────────────
  //
  // **No pasa por `conHistoria`, y es la decisión del fichero.** Tres
  // razones, en orden de peso:
  //
  //   1. Lo que devuelve no es historia. Nombre, habitación, nivel de
  //      dependencia y tipo de plaza es el cuadrante del centro: lo mismo
  //      que hoy está impreso y colgado en el office. La historia es lo
  //      que hay DENTRO de la ficha, y eso sí pasa.
  //   2. Apuntar una línea por residente y por apertura de lista llenaría
  //      `clinical_access_log` de ruido con lo que NO es un acceso a una
  //      historia, y eso hace el registro **menos** útil — que es el daño
  //      real. Es, literal, la decisión 1 de clinica-1 sobre
  //      `GET /clients/:id`.
  //   3. Una lista de 49 residentes con `conHistoria` son 49 resoluciones
  //      de acceso y 49 inserciones por apertura.
  //
  // Lo que sí hace: **filtra por la zona de quien mira**. Una auxiliar de
  // la primera planta ve a los residentes de la primera planta, y el
  // nivel de dependencia que le llega es el de su gente. Se resuelve una
  // sola vez (no 49) porque es la misma pregunta para toda la lista.
  app.get(
    "/residencia/residentes",
    {
      preHandler: PUERTAS_LECTURA,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            // Por defecto, los que viven aquí hoy. `true` añade a los que
            // ya se fueron — la dirección los necesita para un informe.
            incluirAltas: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      // `requireOwnerOrCashier` puebla SIEMPRE `request.auth`, también
      // cuando el token es una sesión de TPV: ahí copia el `sub`, el `tid`
      // y el rol del cajero. Así que una sola lectura, sin `??` sobre
      // `request.cashier` — que era una rama que no se alcanza nunca y un
      // `!` que nadie volvería a comprobar.
      const { tenantId, userId } = request.auth!;
      const { incluirAltas } = request.query as { incluirAltas?: boolean };
      const prisma = getPrisma();

      const alcance = await resolverAlcanceDeLista(prisma, tenantId, userId);

      const perfiles = await prisma.residentProfile.findMany({
        where: {
          tenantId,
          ...(incluirAltas ? {} : { dischargeDate: null }),
          // La zona, como filtro de la consulta y no como `filter()` en
          // memoria: con 49 residentes da igual, con un grupo de cinco
          // centros no.
          ...(alcance.total
            ? {}
            : {
                client: {
                  bedAssignments: {
                    some: {
                      toAt: null,
                      bed: { room: { floorId: { in: alcance.plantas } } },
                    },
                  },
                },
              }),
        },
        select: PERFIL_SELECT,
        orderBy: [
          { client: { lastName: "asc" } },
          { client: { firstName: "asc" } },
        ],
      });

      return {
        residentes: perfiles.map((p) => vistaResidente(p)),
        // Para que la pantalla pueda decir «ves la planta 1» en vez de
        // dejar a una auxiliar pensando que faltan residentes.
        alcance: alcance.total ? "CENTRO" : "ZONA",
      };
    },
  );

  // ── EL ALTA · un `Client` y su perfil, en una transacción ──────────
  //
  // Una sola ruta y no «crea el cliente en el CRM y luego dale perfil»,
  // porque la segunda mitad se puede quedar sin hacer: un residente sin
  // perfil es un contacto más en el CRM de un centro que no tiene CRM, y
  // nadie lo volvería a mirar. La transacción cierra eso.
  //
  // Acepta `clientId` para el caso real contrario: la señora ya está en el
  // CRM porque vino de visita o porque la clínica le abrió historia. Ahí
  // NO se crea un cliente nuevo, se le pone perfil al que hay — duplicarla
  // partiría su historia en dos.
  app.post(
    "/residencia/residentes",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["admissionDate", "dependencyLevel", "placeType"],
          additionalProperties: false,
          properties: {
            // O uno o los otros dos: ver la validación del handler.
            clientId: { type: "string", format: "uuid" },
            firstName: { type: "string", minLength: 1, maxLength: 120 },
            lastName: { type: "string", maxLength: 120 },
            phone: { type: "string", maxLength: 32 },
            birthdate: { type: "string", format: "date" },

            admissionDate: { type: "string", format: "date" },
            dependencyLevel: { type: "string", enum: NIVELES as unknown as string[] },
            dependencyGrade: { type: "string", enum: GRADOS as unknown as string[] },
            placeType: { type: "string", enum: PLAZAS as unknown as string[] },
            responsibleName: { type: "string", maxLength: 160 },
            responsiblePhone: { type: "string", maxLength: 32 },
            responsibleRelation: { type: "string", maxLength: 60 },
            dni: { type: "string", maxLength: 32 },
            nss: { type: "string", maxLength: 32 },
            // La cama, si ya se sabe. Opcional: el ingreso puede estar
            // pendiente.
            bedId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        clientId?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        birthdate?: string;
        admissionDate: string;
        dependencyLevel: (typeof NIVELES)[number];
        dependencyGrade?: (typeof GRADOS)[number];
        placeType: (typeof PLAZAS)[number];
        responsibleName?: string;
        responsiblePhone?: string;
        responsibleRelation?: string;
        dni?: string;
        nss?: string;
        bedId?: string;
      };
      const prisma = getPrisma();

      if (!body.clientId && !body.firstName) {
        return reply.code(400).send({
          error: "FALTA_NOMBRE",
          message: "Dime el nombre del residente, o el cliente que ya existe.",
        });
      }

      // La cama, validada ANTES de crear nada: que la primera mitad del
      // alta se guarde y la segunda falle por una cama de otro centro deja
      // un residente a medias.
      if (body.bedId) {
        const cama = await prisma.bed.findFirst({
          where: { id: body.bedId, tenantId: auth.tenantId },
          select: { id: true, active: true },
        });
        if (!cama) {
          return reply.code(404).send({
            error: "CAMA_NO_ENCONTRADA",
            message: "Esa cama no es de este centro.",
          });
        }
        if (!cama.active) {
          return reply.code(409).send({
            error: "CAMA_INACTIVA",
            message: "Esa cama está fuera de servicio. Elige otra o vuelve a activarla.",
          });
        }
      }

      if (body.clientId) {
        const cliente = await prisma.client.findFirst({
          where: { id: body.clientId, tenantId: auth.tenantId },
          select: { id: true, residentProfile: { select: { clientId: true } } },
        });
        if (!cliente) {
          return reply.code(404).send({
            error: "CLIENTE_NO_ENCONTRADO",
            message: "Esa persona no es de este centro.",
          });
        }
        if (cliente.residentProfile) {
          return reply.code(409).send({
            error: "YA_ES_RESIDENTE",
            message:
              "Esa persona ya está dada de alta como residente. Si volvió a ingresar, edita su ficha.",
          });
        }
      }

      const admissionDate = new Date(body.admissionDate);

      try {
        const perfil = await prisma.$transaction(async (tx) => {
          const clientId =
            body.clientId ??
            (
              await tx.client.create({
                data: {
                  tenantId: auth.tenantId,
                  firstName: body.firstName!.trim(),
                  lastName: body.lastName?.trim() ?? "",
                  phone: body.phone?.trim() || null,
                  birthdate: body.birthdate ? new Date(body.birthdate) : null,
                },
                select: { id: true },
              })
            ).id;

          await tx.residentProfile.create({
            data: {
              clientId,
              tenantId: auth.tenantId,
              admissionDate,
              dependencyLevel: body.dependencyLevel,
              dependencyGrade: body.dependencyGrade ?? null,
              placeType: body.placeType,
              responsibleName: body.responsibleName?.trim() || null,
              responsiblePhone: body.responsiblePhone?.trim() || null,
              responsibleRelation: body.responsibleRelation?.trim() || null,
              dni: body.dni?.trim() || null,
              nss: body.nss?.trim() || null,
            },
          });

          if (body.bedId) {
            await tx.bedAssignment.create({
              data: {
                tenantId: auth.tenantId,
                bedId: body.bedId,
                clientId,
                fromAt: admissionDate,
                reason: "ingreso",
                createdByUserId: auth.userId,
              },
            });
          }

          return tx.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: PERFIL_SELECT,
          });
        });
        return reply
          .code(201)
          .send({ residente: vistaResidente(perfil) });
      } catch (err) {
        // El índice parcial `bed_assignments_one_live_per_bed_key`. El
        // mensaje de Postgres NO se reenvía (lleva ids de fila), y la
        // negativa se explica: es la cama la que está ocupada, no un fallo.
        if (esCamaOcupada(err)) {
          return reply.code(409).send({
            error: "CAMA_OCUPADA",
            message:
              "Esa cama ya tiene un residente. Libérala primero o elige otra.",
          });
        }
        throw err;
      }
    },
  );

  // ── LA FICHA de uno · aquí SÍ pasa por `conHistoria` ───────────────
  //
  // El prompt lo pide con estas palabras: «la ficha del residente en la API
  // pasa por la MISMA función de acceso que la historia». Y de paso deja su
  // línea en el registro de accesos: `action = READ`.
  app.get(
    "/residencia/residentes/:clientId",
    {
      preHandler: PUERTAS_LECTURA,
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
      // `requireOwnerOrCashier` puebla SIEMPRE `request.auth`, también
      // cuando el token es una sesión de TPV: ahí copia el `sub`, el `tid`
      // y el rol del cajero. Así que una sola lectura, sin `??` sobre
      // `request.cashier` — que era una rama que no se alcanza nunca y un
      // `!` que nadie volvería a comprobar.
      const tenantId = request.auth!.tenantId;
      const { clientId } = request.params as { clientId: string };
      const prisma = getPrisma();

      // El aislamiento por fila va ANTES de la autorización clínica, y la
      // 404 es del tenant: un `clientId` de otro centro no existe para
      // éste. Mismo orden que `cargarPacienteDelTenant` en la clínica.
      const existe = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId },
        select: { clientId: true },
      });
      if (!existe) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }

      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async () => {
          const perfil = await prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: {
              ...PERFIL_SELECT,
              // El DNI y el NSS sólo aquí, en la ficha de uno y tras pasar
              // la función de acceso. Nunca en la lista.
              dni: true,
              nss: true,
            },
          });
          // El HISTÓRICO de habitaciones, aparte. Es una segunda consulta
          // en vez de un `include` con dos `where` distintos sobre la misma
          // relación —Prisma no deja pedir «las vigentes» y «todas» en un
          // solo `select`— y sale más barata que resolverlo en memoria: la
          // ficha abre una vez y el histórico de un residente de quince
          // años son una docena de filas.
          const ocupaciones = await prisma.bedAssignment.findMany({
            where: { tenantId, clientId },
            orderBy: { fromAt: "desc" },
            select: {
              id: true,
              fromAt: true,
              toAt: true,
              reason: true,
              bed: {
                select: {
                  label: true,
                  room: {
                    select: {
                      number: true,
                      floor: { select: { name: true } },
                    },
                  },
                },
              },
            },
          });
          return {
            residente: {
              ...vistaResidente(perfil),
              dni: perfil.dni,
              nss: perfil.nss,
              // Lo que hace que «¿dónde dormía doña Carmen en marzo?» tenga
              // respuesta. Es la razón por la que cambiar de habitación
              // cierra una fila y abre otra en vez de editar una.
              ocupaciones: ocupaciones.map((a) => ({
                id: a.id,
                desde: a.fromAt.toISOString(),
                hasta: a.toAt?.toISOString() ?? null,
                motivo: a.reason,
                habitacion: a.bed.room.number,
                cama: a.bed.label,
                planta: a.bed.room.floor.name,
              })),
            },
          };
        },
      );
    },
  );

  // ── Editar la ficha ────────────────────────────────────────────────
  app.patch(
    "/residencia/residentes/:clientId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            admissionDate: { type: "string", format: "date" },
            dependencyLevel: { type: "string", enum: NIVELES as unknown as string[] },
            // `null` para quitarle el grado al que lo tenía por error.
            dependencyGrade: {
              type: ["string", "null"],
              enum: [...GRADOS, null] as unknown as string[],
            },
            placeType: { type: "string", enum: PLAZAS as unknown as string[] },
            responsibleName: { type: "string", maxLength: 160 },
            responsiblePhone: { type: "string", maxLength: 32 },
            responsibleRelation: { type: "string", maxLength: 60 },
            dni: { type: "string", maxLength: 32 },
            nss: { type: "string", maxLength: 32 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as Record<string, unknown>;
      const prisma = getPrisma();

      const existe = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId: auth.tenantId },
        select: { clientId: true },
      });
      if (!existe) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }

      // `WRITE` y no `READ`: lo que se escribe aquí es parte de la ficha de
      // una persona con historia, y el registro tiene que poder distinguir
      // quién la miró de quién la cambió.
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          const data: Record<string, unknown> = {};
          if (body.admissionDate !== undefined) {
            data.admissionDate = new Date(body.admissionDate as string);
          }
          for (const campo of [
            "dependencyLevel",
            "dependencyGrade",
            "placeType",
          ]) {
            if (body[campo] !== undefined) data[campo] = body[campo];
          }
          for (const campo of [
            "responsibleName",
            "responsiblePhone",
            "responsibleRelation",
            "dni",
            "nss",
          ]) {
            if (body[campo] !== undefined) {
              const v = (body[campo] as string).trim();
              // Cadena vacía → NULL: lo exige el CHECK
              // `resident_profiles_identificacion_not_blank`, y además es
              // lo correcto (un DNI en blanco no es un DNI).
              data[campo] = v === "" ? null : v;
            }
          }
          const perfil = await prisma.residentProfile.update({
            where: { clientId },
            data,
            select: PERFIL_SELECT,
          });
          return { residente: vistaResidente(perfil) };
        },
      );
    },
  );

  // ── DAR DE ALTA (que se va) · NO es borrar ─────────────────────────
  //
  // Un residente no se borra: se le da de alta. La ficha, su historia y su
  // histórico de habitaciones se quedan, y las FKs `RESTRICT` de la base lo
  // impedirían igual el día que alguien escriba una ruta de borrado.
  //
  // Y cierra su ocupación en la misma transacción. Si no la cerrara, su
  // cama seguiría ocupada por alguien que ya no vive aquí y el índice
  // parcial no dejaría meter al siguiente — que es la forma en que esto se
  // habría descubierto, con una familia esperando en la puerta.
  app.post(
    "/residencia/residentes/:clientId/alta",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["dischargeDate"],
          additionalProperties: false,
          properties: {
            dischargeDate: { type: "string", format: "date" },
            dischargeReason: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        dischargeDate: string;
        dischargeReason?: string;
      };
      const prisma = getPrisma();

      const perfil = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId: auth.tenantId },
        select: { clientId: true, admissionDate: true, dischargeDate: true },
      });
      if (!perfil) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      if (perfil.dischargeDate) {
        return reply.code(409).send({
          error: "YA_DADO_DE_ALTA",
          message: "Este residente ya estaba dado de alta.",
        });
      }
      const dischargeDate = new Date(body.dischargeDate);
      if (dischargeDate < perfil.admissionDate) {
        return reply.code(400).send({
          error: "ALTA_ANTES_DEL_INGRESO",
          message: "La fecha de alta no puede ser anterior a la de ingreso.",
        });
      }

      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          await prisma.$transaction(async (tx) => {
            await tx.residentProfile.update({
              where: { clientId },
              data: {
                dischargeDate,
                dischargeReason: body.dischargeReason?.trim() || null,
              },
            });
            await tx.bedAssignment.updateMany({
              where: { tenantId: auth.tenantId, clientId, toAt: null },
              data: { toAt: dischargeDate, reason: "alta" },
            });
          });
          const actualizado = await prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: PERFIL_SELECT,
          });
          return { residente: vistaResidente(actualizado) };
        },
      );
    },
  );

  // ── CAMBIAR DE HABITACIÓN · cierra una ocupación y abre otra ───────
  //
  // Las dos cosas en LA MISMA transacción, y en este orden. Si el `update`
  // no corriera, el `create` revienta contra
  // `bed_assignments_one_live_per_client_key` en vez de dejar a la señora
  // en dos camas: la garantía la da el índice, no este handler.
  //
  // Y la fila vieja NO se edita: se cierra. «¿Dónde dormía doña Carmen en
  // marzo?» es una pregunta que una residencia tiene que poder contestar —
  // a una familia, a la Consejería o a un juzgado.
  app.post(
    "/residencia/residentes/:clientId/cama",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["bedId"],
          additionalProperties: false,
          properties: {
            bedId: { type: "string", format: "uuid" },
            reason: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { bedId: string; reason?: string };
      const prisma = getPrisma();

      const perfil = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId: auth.tenantId },
        select: { clientId: true, dischargeDate: true },
      });
      if (!perfil) {
        return reply.code(404).send({
          error: "RESIDENTE_NO_ENCONTRADO",
          message: "No hay ningún residente con esa ficha en este centro.",
        });
      }
      if (perfil.dischargeDate) {
        return reply.code(409).send({
          error: "RESIDENTE_DADO_DE_ALTA",
          message:
            "Este residente está dado de alta. Si ha vuelto a ingresar, quítale primero la fecha de alta.",
        });
      }
      const cama = await prisma.bed.findFirst({
        where: { id: body.bedId, tenantId: auth.tenantId },
        select: { id: true, active: true },
      });
      if (!cama) {
        return reply.code(404).send({
          error: "CAMA_NO_ENCONTRADA",
          message: "Esa cama no es de este centro.",
        });
      }
      if (!cama.active) {
        return reply.code(409).send({
          error: "CAMA_INACTIVA",
          message: "Esa cama está fuera de servicio. Elige otra o vuelve a activarla.",
        });
      }

      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async () => {
          const ahora = new Date();
          try {
            await prisma.$transaction(async (tx) => {
              const vigente = await tx.bedAssignment.findFirst({
                where: { tenantId: auth.tenantId, clientId, toAt: null },
                select: { id: true, bedId: true },
              });
              // Mover a la cama en la que ya está no es un error: es un
              // doble toque. Se contesta 200 sin tocar nada, igual que el
              // POST idempotente de los accesos clínicos.
              if (vigente?.bedId === body.bedId) return;
              if (vigente) {
                await tx.bedAssignment.update({
                  where: { id: vigente.id },
                  data: { toAt: ahora, reason: body.reason?.trim() || "cambio de habitación" },
                });
              }
              await tx.bedAssignment.create({
                data: {
                  tenantId: auth.tenantId,
                  bedId: body.bedId,
                  clientId,
                  fromAt: ahora,
                  reason: body.reason?.trim() || (vigente ? "cambio de habitación" : "ingreso"),
                  createdByUserId: auth.userId,
                },
              });
            });
          } catch (err) {
            if (esCamaOcupada(err)) {
              reply.code(409).send({
                error: "CAMA_OCUPADA",
                message:
                  "Esa cama ya tiene un residente. Libérala primero o elige otra.",
              });
              return undefined;
            }
            throw err;
          }
          const actualizado = await prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: PERFIL_SELECT,
          });
          return { residente: vistaResidente(actualizado) };
        },
      );
    },
  );
}

/**
 * ¿Este error es «la cama ya está ocupada»?
 *
 * Reconoce el índice parcial por NOMBRE y no por el código P2002 a secas:
 * la misma transacción puede violar
 * `bed_assignments_one_live_per_client_key` (el residente ya tiene cama,
 * que es un fallo de carrera distinto) y confundirlos daría un mensaje que
 * manda a la dirección a mirar la cama equivocada.
 */
function esCamaOcupada(err: unknown): boolean {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.includes("bed_assignments_one_live_per_bed_key");
}

/**
 * residencia-1 · el alcance de quien pide la LISTA, resuelto una vez.
 *
 * No es la función de acceso: es la MISMA regla aplicada a un conjunto en
 * vez de a un residente. La función contesta «¿puedo ver a éste?» y esto
 * contesta «¿a cuáles?», y las dos salen de lo mismo —rol de cuidado
 * vigente, `fullScope`, zona— porque si no salieran de lo mismo la lista
 * enseñaría a alguien que la ficha luego niega, que es la peor de las dos
 * incoherencias posibles.
 *
 * `total: true` para OWNER y MANAGER sin rol de cuidado: son quien da de
 * alta a los residentes y tienen que verlos antes de asignarles nada. Es
 * la misma asimetría que en la clínica, donde la dueña administra el
 * negocio: aquí la dirección administra el centro. Lo que NO les da es la
 * ficha —ésa pasa por `conHistoria` y les dirá «sin rol de cuidado» si no
 * lo tienen— y eso es deliberado: la lista es el cuadrante, la ficha es
 * historia.
 */
async function resolverAlcanceDeLista(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  userId: string,
): Promise<{ total: boolean; plantas: string[] }> {
  const ahora = new Date();
  const [usuario, roles, zonas] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { role: true },
    }),
    prisma.careRoleAssignment.findMany({
      where: {
        tenantId,
        userId,
        revokedAt: null,
        fromAt: { lte: ahora },
        OR: [{ toAt: null }, { toAt: { gt: ahora } }],
        careRole: { active: true },
      },
      select: { careRole: { select: { fullScope: true } } },
    }),
    prisma.careZoneAssignment.findMany({
      where: {
        tenantId,
        userId,
        fromAt: { lte: ahora },
        OR: [{ toAt: null }, { toAt: { gt: ahora } }],
      },
      select: { floorId: true },
    }),
  ]);

  if (usuario?.role === "OWNER" || usuario?.role === "MANAGER") {
    return { total: true, plantas: [] };
  }
  if (roles.some((r) => r.careRole.fullScope)) {
    return { total: true, plantas: [] };
  }
  if (zonas.some((z) => z.floorId == null)) {
    return { total: true, plantas: [] };
  }
  return {
    total: false,
    plantas: zonas
      .map((z) => z.floorId)
      .filter((id): id is string => id != null),
  };
}
