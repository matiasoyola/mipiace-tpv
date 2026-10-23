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
// (art. 9 RGPD y Ley 41/2002). Desde residencia-1b, tampoco el
// ciphertext: un `c1:…` en un log es el dato con un candado que la misma
// casa sabe abrir.
//
// ── residencia-1b · Y TRES COLUMNAS VAN CIFRADAS (D-63) ─────────────
//
// `resident_profiles.dni`, `.nss` y `.discharge_reason`, más
// `bed_assignments.reason` del histórico de habitaciones. Se escriben con
// `cifrarTexto` y se leen con `leerTexto`, que es lo que decide qué
// columna manda (la cifrada) y qué pasa cuando no se descifra (el hueco
// marcado, no una excepción: la ficha se sigue sirviendo).
//
// Lo que las pantallas reciben **no cambia**: los mismos campos con los
// mismos nombres. Lo único nuevo que puede llegar es el texto del hueco.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
// residencia-1b (D-63) · el cifrado de clinica-7, tal cual. `asegurarDek`
// en las ESCRITURAS (crea la clave del centro la primera vez, dentro de la
// transacción que escribe) y `dekONada` en las LECTURAS, que no crean
// claves: un centro que no ha escrito nada cifrado se lee en claro, que es
// exactamente lo que hay.
import { asegurarDek, dekONada } from "../clinica/claves.js";
import {
  cifrarTexto,
  leerTexto,
  nuevoIdDeFila,
  sitioDniDeResidente,
  sitioMotivoDeAlta,
  sitioMotivoDeOcupacion,
  sitioNssDeResidente,
} from "../clinica/cripto-campos.js";
// residencia-2 · el plan de cuidados, que se precarga al dar de alta a un
// residente y se recalcula al cambiarle el nivel (D-53).
import { aplicarPlantilla, cerrarPlanPorAlta } from "./plan.js";
// historia-1 · el ingreso guiado (D-94), el cierre de la ausencia
// abierta (D-92) y la obligación de comunicar la baja (D-96).
import {
  crearChecklistDeIngreso,
  plazosDelCentro,
} from "./ingreso.js";
import { cerrarAusenciaPorAlta } from "./ausencias.js";
import {
  crearObligacionDeBaja,
  seComunicaLaBaja,
} from "./alta-del-residente.js";
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

/**
 * residencia-3 (D-64) · el consentimiento de imagen VIGENTE de un
 * residente, o `null`.
 *
 * Vigente = una fila `IMAGE` que concede y ninguna que la revoque. La
 * revocación es otra fila, que es como funciona el consentimiento en toda
 * la casa desde clinica-4: nadie pone un booleano a `false`.
 *
 * Devuelve quién lo dio y cuándo, no sólo el sí: lo que la dirección tiene
 * que poder enseñar si alguien pregunta es que el consentimiento existe y
 * de quién es.
 */
async function consentimientoDeImagen(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  clientId: string,
): Promise<{
  id: string;
  anotadoEn: string;
  loDio: string | null;
  nombre: string | null;
  parentesco: string | null;
} | null> {
  const filas = await prisma.clientConsent.findMany({
    where: { tenantId, clientId, kind: "IMAGE" },
    orderBy: { grantedAt: "asc" },
    select: {
      id: true,
      grantedAt: true,
      signer: true,
      signerName: true,
      signerRelation: true,
      revokesConsentId: true,
    },
  });
  const revocados = new Set(
    filas.map((f) => f.revokesConsentId).filter((x): x is string => x != null),
  );
  for (const f of filas) {
    if (f.revokesConsentId != null) continue;
    if (revocados.has(f.id)) continue;
    return {
      id: f.id,
      anotadoEn: f.grantedAt.toISOString(),
      loDio: f.signer,
      nombre: f.signerName,
      parentesco: f.signerRelation,
    };
  }
  return null;
}

const NIVELES = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"] as const;
const GRADOS = ["I", "II", "III"] as const;
const PLAZAS = ["PRIVADA", "CONCERTADA", "TEMPORAL"] as const;
/** historia-1 (D-96) · las cuatro clases de alta. Copiadas del enum y no
 *  importadas de `@mipiacetpv/db`: el `schema` de Fastify necesita un
 *  array de cadenas en tiempo de ejecución, y un enum de Prisma es un
 *  objeto. Es lo mismo que `NIVELES`, `GRADOS` y `PLAZAS` ya hacían. */
const CLASES_DE_ALTA = [
  "TRASLADO",
  "VOLUNTARIA",
  "FALLECIMIENTO",
  "OTRA",
] as const;

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
  dischargeKind: true,
  dischargeReason: true,
  // residencia-1b · la que MANDA. La clara se queda para las filas que ya
  // estaban escritas cuando llegó el cifrado.
  dischargeReasonCifrado: true,
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
  dischargeReasonCifrado: string | null;
  dischargeKind: string | null;
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

/**
 * residencia-1b · lo que `vistaResidente` necesita para DESCIFRAR.
 *
 * El `tenantId` y la DEK van juntos porque el AAD los ata: la clave es de
 * ese centro y el valor es de esa fila de ese centro. Pasarlos sueltos
 * habría sido dos parámetros que alguien cruza.
 *
 * `dek` puede ser `null` y es legítimo: un centro que todavía no ha
 * escrito nada cifrado no tiene clave (`dekONada`), y entonces lo que hay
 * en las columnas claras es lo que hay. Lo que `leerTexto` NO hace es
 * caerse a la clara cuando la cifrada está y no se descifra — eso sería
 * un «la clave no es la buena» que parece funcionar.
 */
interface Sobre {
  tenantId: string;
  dek: Buffer | null;
}

function vistaResidente(p: FilaResidente, sobre: Sobre) {
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
    dischargeReason: leerTexto(
      { cifrado: p.dischargeReasonCifrado, claro: p.dischargeReason },
      sobre.dek,
      sitioMotivoDeAlta(sobre.tenantId, p.clientId),
    ),
    /** historia-1 (D-96) · `null` en las filas dadas de alta antes de
     *  este bloque: no se les inventa una clase. La pantalla lo dice. */
    dischargeKind: p.dischargeKind,
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
      // residencia-1b · UNA sola vez para los 48, no una por residente: la
      // DEK es del centro y la caché del llavero dura 60 s, pero pedirla
      // dentro del `map` habría sido 48 `await` en una ruta que hoy hace
      // dos consultas.
      const dek = await dekONada(tenantId, prisma);

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
        residentes: perfiles.map((p) => vistaResidente(p, { tenantId, dek })),
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
          // residencia-1b · LA CLAVE DEL CENTRO, dentro de la transacción
          // que escribe. `asegurarDek` la crea si es la primera escritura
          // cifrada del centro, y si la transacción se deshace la clave no
          // queda huérfana.
          //
          // Si no se pudiera obtener, esto LEVANTA y el alta no se guarda.
          // Es la decisión 4 del bloque: nada se escribe en claro porque
          // falte la clave. Un centro de residencia la tiene siempre —
          // `tenants_residencia_exige_clinica` no deja encender la
          // residencia sin la clínica, y la clínica no arranca sin KEK.
          const dek = await asegurarDek(auth.tenantId, tx);
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
              // residencia-1b · el DNI y el NSS nacen CIFRADOS, y el claro
              // se queda a NULL. El respaldo en claro existe para las
              // filas que ya estaban escritas, no para las nuevas.
              dni: null,
              nss: null,
              dniCifrado: cifrarTexto(
                body.dni?.trim() || null,
                dek,
                sitioDniDeResidente(auth.tenantId, clientId),
              ),
              nssCifrado: cifrarTexto(
                body.nss?.trim() || null,
                dek,
                sitioNssDeResidente(auth.tenantId, clientId),
              ),
            },
          });

          if (body.bedId) {
            // residencia-1b · EL UUID LO GENERA LA APLICACIÓN. El AAD ata
            // el valor a su fila y el id de una fila que todavía no existe
            // no se puede leer, así que no vale el `@default(uuid())` de
            // Prisma. Es la misma mecánica que las entradas de historia
            // (`cripto-campos.ts`, cabecera).
            const ocupacionId = nuevoIdDeFila();
            await tx.bedAssignment.create({
              data: {
                id: ocupacionId,
                tenantId: auth.tenantId,
                bedId: body.bedId,
                clientId,
                fromAt: admissionDate,
                reason: null,
                reasonCifrado: cifrarTexto(
                  "ingreso",
                  dek,
                  sitioMotivoDeOcupacion(auth.tenantId, ocupacionId),
                ),
                createdByUserId: auth.userId,
              },
            });
          }

          // ── residencia-2 · EL PLAN, precargado por su nivel ───────
          //
          // En la MISMA transacción que el perfil y la cama, y eso es la
          // decisión: si el plan se abriera después, en otra transacción,
          // un fallo dejaría a un residente dado de alta sin plan — y eso
          // no se ve hasta el primer turno, cuando la puerta no le pide
          // nada a nadie.
          //
          // `fromAt` es la FECHA DE INGRESO y no «ahora»: así `queToca`
          // no le pide nada de antes de llegar al centro, que es el caso
          // del residente que ingresa a mediodía y no tiene el turno de
          // la mañana de ese día.
          await aplicarPlantilla(tx, {
            tenantId: auth.tenantId,
            clientId,
            nivel: body.dependencyLevel,
            nivelAnterior: null,
            desde: admissionDate,
            userId: auth.userId,
            motivo: "ingreso",
            // residencia-1b · el motivo de cada línea del plan va cifrado,
            // y la clave viaja hasta aquí en vez de pedirse otra vez: una
            // segunda llamada dentro de la misma transacción sería la
            // misma clave con una consulta más.
            dek,
          });

          // ── historia-1 (D-94) · LA LISTA DEL INGRESO ─────────────
          //
          // En la MISMA transacción que el perfil, la cama y el plan, y
          // por la misma razón que el plan: si la lista se creara
          // después, un fallo dejaría a un residente ingresado **sin
          // expediente**, y eso no se ve hasta que lo pide un inspector
          // (R20) — que es exactamente el problema que D-94 viene a
          // cerrar.
          //
          // Y los dos plazos del centro se leen DENTRO: el del PAI
          // decide la fecha límite de `PAI_INICIAL`, y el plazo corre
          // desde hoy.
          const plazos = await plazosDelCentro(tx, auth.tenantId);
          await crearChecklistDeIngreso(tx, {
            tenantId: auth.tenantId,
            clientId,
            ingreso: body.admissionDate,
            diasDePai: plazos.diasDePai,
          });

          const fila = await tx.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: PERFIL_SELECT,
          });
          return { fila, dek };
        });
        return reply.code(201).send({
          residente: vistaResidente(perfil.fila, {
            tenantId: auth.tenantId,
            dek: perfil.dek,
          }),
        });
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
          // residencia-1b · `dekONada` y no `asegurarDek`: una LECTURA no
          // crea claves. Un centro que no haya escrito nada cifrado se lee
          // de las columnas claras, y eso es lo que hay.
          const dek = await dekONada(tenantId, prisma);
          const perfil = await prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: {
              ...PERFIL_SELECT,
              // El DNI y el NSS sólo aquí, en la ficha de uno y tras pasar
              // la función de acceso. Nunca en la lista.
              dni: true,
              nss: true,
              dniCifrado: true,
              nssCifrado: true,
              // residencia-3 (D-64) · la foto, para que la ficha diga si
              // hay una y desde cuándo. El binario se pide aparte
              // (`GET …/foto`): meterlo aquí en base64 engordaría una
              // respuesta que se abre cada vez que alguien mira una ficha.
              photoFileName: true,
              photoBytes: true,
              photoUploadedAt: true,
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
              reasonCifrado: true,
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
              ...vistaResidente(perfil, { tenantId, dek }),
              dni: leerTexto(
                { cifrado: perfil.dniCifrado, claro: perfil.dni },
                dek,
                sitioDniDeResidente(tenantId, clientId),
              ),
              nss: leerTexto(
                { cifrado: perfil.nssCifrado, claro: perfil.nss },
                dek,
                sitioNssDeResidente(tenantId, clientId),
              ),
              // Lo que hace que «¿dónde dormía doña Carmen en marzo?» tenga
              // respuesta. Es la razón por la que cambiar de habitación
              // cierra una fila y abre otra en vez de editar una.
              ocupaciones: ocupaciones.map((a) => ({
                id: a.id,
                desde: a.fromAt.toISOString(),
                hasta: a.toAt?.toISOString() ?? null,
                motivo: leerTexto(
                  { cifrado: a.reasonCifrado, claro: a.reason },
                  dek,
                  sitioMotivoDeOcupacion(tenantId, a.id),
                ),
                habitacion: a.bed.room.number,
                cama: a.bed.label,
                planta: a.bed.room.floor.name,
              })),
              // ── residencia-3 (D-64) · la foto y su consentimiento ────
              //
              // Las DOS cosas, y por separado: hay foto subida y hay o no
              // consentimiento de imagen vigente. La pantalla las pinta
              // juntas porque la combinación que importa es «hay foto y NO
              // se puede enseñar», que es la que la dirección tiene que ver
              // para pedir el consentimiento o quitar la foto.
              foto: perfil.photoFileName
                ? {
                    bytes: perfil.photoBytes,
                    subidaEn: perfil.photoUploadedAt?.toISOString() ?? null,
                  }
                : null,
              consentimientoDeImagen: await consentimientoDeImagen(
                prisma,
                tenantId,
                clientId,
              ),
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
          ]) {
            if (body[campo] !== undefined) {
              const v = (body[campo] as string).trim();
              data[campo] = v === "" ? null : v;
            }
          }
          // ── residencia-1b · EL DNI Y EL NSS, aparte y cifrados ────
          //
          // Salen del bucle de arriba porque no se guardan donde se
          // reciben. Y cada uno escribe LAS DOS columnas: el claro a
          // `null` y el dato en la cifrada.
          //
          // Poner el claro a `null` explícitamente es la mitad que
          // importa. Sin eso, editar el DNI de una ficha que aún tenía el
          // claro de antes del cifrado dejaría el DNI VIEJO legible en la
          // base para siempre: `leerTexto` serviría el nuevo (manda la
          // cifrada) y nadie se enteraría del que se quedó atrás.
          //
          // Cadena vacía → las dos a NULL. Lo exige el CHECK
          // `resident_profiles_identificacion_not_blank` —que desde este
          // bloque mira también las cifradas— y además es lo correcto: un
          // DNI en blanco no es un DNI.
          //
          // Qué hay que cifrar se decide aquí y se CIFRA dentro de la
          // transacción: `asegurarDek` crea la clave del centro si es la
          // primera escritura cifrada, y creándola fuera quedaría una
          // clave huérfana si el `update` fallara después.
          const porCifrar: Array<{
            campo: "dni" | "nss";
            valor: string | null;
            sitioDe: typeof sitioDniDeResidente;
          }> = [];
          for (const [campo, sitioDe] of [
            ["dni", sitioDniDeResidente],
            ["nss", sitioNssDeResidente],
          ] as const) {
            if (body[campo] === undefined) continue;
            const v = (body[campo] as string).trim();
            porCifrar.push({ campo, valor: v === "" ? null : v, sitioDe });
            data[campo] = null;
          }
          // ── residencia-2 · CAMBIAR EL NIVEL recalcula el plan ────
          //
          // Hay que leer el nivel de ANTES para saber qué cerrar, y las
          // dos cosas —el `update` del perfil y el recálculo— van en la
          // misma transacción: un perfil en «dependiente» con el plan de
          // un «válido» es un residente al que nadie gira, y lo contrario
          // es un válido con ocho rondas nocturnas que nadie entiende.
          //
          // Y sólo si el nivel CAMBIA de verdad. Guardar la ficha para
          // corregir un teléfono no puede tocar el plan de nadie.
          const antes = await prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: { dependencyLevel: true },
          });
          const nivelNuevo = data.dependencyLevel as
            | (typeof NIVELES)[number]
            | undefined;
          const cambiaElNivel =
            nivelNuevo !== undefined && nivelNuevo !== antes.dependencyLevel;

          const { perfil, plan, dek } = await prisma.$transaction(async (tx) => {
            const dek = await asegurarDek(auth.tenantId, tx);
            for (const { campo, valor, sitioDe } of porCifrar) {
              data[`${campo}Cifrado`] = cifrarTexto(
                valor,
                dek,
                sitioDe(auth.tenantId, clientId),
              );
            }
            const perfil = await tx.residentProfile.update({
              where: { clientId },
              data,
              select: PERFIL_SELECT,
            });
            if (!cambiaElNivel) return { perfil, plan: null, dek };
            const plan = await aplicarPlantilla(tx, {
              tenantId: auth.tenantId,
              clientId,
              nivel: nivelNuevo!,
              nivelAnterior: antes.dependencyLevel,
              dek,
              // «Ahora» y no la fecha de ingreso: la línea nueva empieza
              // cuando se cambia el nivel. Si empezara en el ingreso se
              // solaparía con la que se acaba de cerrar, y «¿qué le
              // tocaba en marzo?» tendría dos respuestas.
              desde: new Date(),
              userId: auth.userId,
              motivo: `cambio de nivel: ${antes.dependencyLevel} → ${nivelNuevo}`,
            });
            return { perfil, plan, dek };
          });

          return {
            residente: vistaResidente(perfil, { tenantId: auth.tenantId, dek }),
            // Lo que el recálculo hizo, para que la pantalla lo diga en
            // vez de dejar que la dirección lo descubra abriendo el plan.
            // `null` si el nivel no cambió.
            plan: plan
              ? {
                  abiertas: plan.abiertas,
                  cerradas: plan.cerradas,
                  // Las que ya tenía y NO se han tocado: ahí están las
                  // manuales, que es la promesa del cambio de nivel.
                  intactas: plan.yaTenian,
                }
              : null,
          };
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
  //
  // ── historia-1 (D-96) · LO QUE EL ALTA CIERRA AHORA, Y LO QUE ABRE ─
  //
  // Cuatro cosas en la misma transacción, y las cuatro tienen su razón:
  //
  //   1. la **cama** (residencia-1) y el **plan** (residencia-2), que ya
  //      estaban;
  //   2. la **ausencia abierta**, si la hay. Sin esto, un residente dado
  //      de alta desde el hospital se queda **ausente para siempre**: los
  //      días del mes lo seguirían contando fuera y el panel seguiría
  //      pidiendo la revisión de su vuelta, y la pantalla de ausencias no
  //      lo lista porque sólo enseña a los que viven aquí. Una fila que
  //      nadie puede volver a tocar;
  //   3. la **clase del alta** (traslado · voluntaria · fallecimiento ·
  //      otra), que es obligatoria desde hoy;
  //   4. y si la plaza es **concertada**, la **obligación con fecha** de
  //      comunicar la baja a la administración
  //      (`alta-del-residente.ts`).
  //
  // Lo que NO hace, y es la mitad de D-96: **borrar**. La historia se
  // conserva ≥ 5 años (Ley 41/2002) y todas las FK son `RESTRICT`.
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
          // historia-1 (D-96) · **la clase es obligatoria desde hoy**. La
          // columna es nullable por las filas que ya estaban (no se les
          // inventa una clase), y la ruta la pide: lo que entra desde
          // ahora la lleva.
          required: ["dischargeDate", "dischargeKind"],
          additionalProperties: false,
          properties: {
            dischargeDate: { type: "string", format: "date" },
            dischargeKind: { type: "string", enum: CLASES_DE_ALTA },
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
        dischargeKind: (typeof CLASES_DE_ALTA)[number];
        dischargeReason?: string;
      };
      const prisma = getPrisma();

      const perfil = await prisma.residentProfile.findFirst({
        where: { clientId, tenantId: auth.tenantId },
        select: {
          clientId: true,
          admissionDate: true,
          dischargeDate: true,
          // historia-1 (D-96) · de la clase de plaza depende si hay que
          // comunicar la baja, y del nombre, cómo se llama la obligación.
          placeType: true,
          client: { select: { firstName: true, lastName: true } },
        },
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
          const dek = await prisma.$transaction(async (tx) => {
            const dek = await asegurarDek(auth.tenantId, tx);
            await tx.residentProfile.update({
              where: { clientId },
              data: {
                dischargeDate,
                // historia-1 (D-96) · la clase, que el texto libre no
                // podía decidir. El detalle sigue en el texto cifrado.
                dischargeKind: body.dischargeKind,
                // residencia-1b · «fallecimiento» o «traslado al hospital
                // por ictus» caben enteros aquí, así que va cifrado y el
                // claro a NULL.
                dischargeReason: null,
                dischargeReasonCifrado: cifrarTexto(
                  body.dischargeReason?.trim() || null,
                  dek,
                  sitioMotivoDeAlta(auth.tenantId, clientId),
                ),
              },
            });
            // residencia-1b · UN `updateMany` NO SIRVE para una columna
            // cifrada: el AAD lleva el id de la fila, así que cada fila
            // necesita su propio ciphertext. Se buscan y se actualizan una
            // por una.
            //
            // Son una como mucho —lo garantiza el índice parcial
            // `bed_assignments_one_live_per_client_key`—, y el bucle está
            // porque la garantía es del motor y no de este handler: el día
            // que el índice cambie, esto sigue siendo correcto.
            const vigentes = await tx.bedAssignment.findMany({
              where: { tenantId: auth.tenantId, clientId, toAt: null },
              select: { id: true },
            });
            for (const ocupacion of vigentes) {
              await tx.bedAssignment.update({
                where: { id: ocupacion.id },
                data: {
                  toAt: dischargeDate,
                  reason: null,
                  reasonCifrado: cifrarTexto(
                    "alta",
                    dek,
                    sitioMotivoDeOcupacion(auth.tenantId, ocupacion.id),
                  ),
                },
              });
            }
            // ── residencia-2 · y su PLAN se cierra ──────────────────
            //
            // Por lo mismo que su ocupación de cama: si el plan se
            // quedara abierto, la puerta seguiría pidiendo el cambio
            // postural de alguien que ya no vive aquí y el panel lo
            // contaría como incumplido todos los turnos.
            //
            // Se CIERRA, no se borra. El plan de una persona es parte de
            // lo que se conserva cinco años (D-45), y «¿qué le tocaba
            // cuando se fue?» es una pregunta legítima.
            await cerrarPlanPorAlta(tx, {
              tenantId: auth.tenantId,
              clientId,
              cuando: dischargeDate,
              userId: auth.userId,
              motivo: "alta del residente",
              dek,
            });

            // ── historia-1 (D-92, D-96) · Y SU AUSENCIA ABIERTA ────
            //
            // **Sin dejar revisión pendiente**, aunque venga de un
            // hospital: la DUE no tiene que revisar la medicación de
            // alguien que ya no vive aquí. Por eso es otra función y no
            // `cerrarAusencia` con un booleano.
            await cerrarAusenciaPorAlta(tx, {
              tenantId: auth.tenantId,
              clientId,
              cuando: dischargeDate,
              userId: auth.userId,
            });

            // ── historia-1 (D-96) · LA COMUNICACIÓN DE LA BAJA ─────
            //
            // Sólo si la plaza es concertada, y con el plazo que el
            // centro configura. **Sin plazo configurado la obligación
            // nace igual**, con la fecha del alta y marcada «periodicidad
            // por verificar»: ver `crearObligacionDeBaja`.
            if (seComunicaLaBaja(perfil.placeType)) {
              const plazos = await plazosDelCentro(tx, auth.tenantId);
              await crearObligacionDeBaja(tx, {
                tenantId: auth.tenantId,
                clientId,
                nombre: `${perfil.client.firstName} ${perfil.client.lastName}`.trim(),
                alta: body.dischargeDate,
                diasDePlazo: plazos.diasParaComunicarLaBaja,
                userId: auth.userId,
              });
            }
            return dek;
          });
          const actualizado = await prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: PERFIL_SELECT,
          });
          return {
            residente: vistaResidente(actualizado, {
              tenantId: auth.tenantId,
              dek,
            }),
          };
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
          let dek: Buffer | null = null;
          try {
            dek = await prisma.$transaction(async (tx) => {
              const dek = await asegurarDek(auth.tenantId, tx);
              const vigente = await tx.bedAssignment.findFirst({
                where: { tenantId: auth.tenantId, clientId, toAt: null },
                select: { id: true, bedId: true },
              });
              // Mover a la cama en la que ya está no es un error: es un
              // doble toque. Se contesta 200 sin tocar nada, igual que el
              // POST idempotente de los accesos clínicos.
              if (vigente?.bedId === body.bedId) return dek;
              if (vigente) {
                // residencia-1b · el motivo del CIERRE de la fila vieja,
                // cifrado con el AAD de ESA fila. Mismo texto en dos filas
                // da dos ciphertexts distintos, y ninguno vale en la otra.
                await tx.bedAssignment.update({
                  where: { id: vigente.id },
                  data: {
                    toAt: ahora,
                    reason: null,
                    reasonCifrado: cifrarTexto(
                      body.reason?.trim() || "cambio de habitación",
                      dek,
                      sitioMotivoDeOcupacion(auth.tenantId, vigente.id),
                    ),
                  },
                });
              }
              const ocupacionId = nuevoIdDeFila();
              await tx.bedAssignment.create({
                data: {
                  id: ocupacionId,
                  tenantId: auth.tenantId,
                  bedId: body.bedId,
                  clientId,
                  fromAt: ahora,
                  reason: null,
                  reasonCifrado: cifrarTexto(
                    body.reason?.trim() ||
                      (vigente ? "cambio de habitación" : "ingreso"),
                    dek,
                    sitioMotivoDeOcupacion(auth.tenantId, ocupacionId),
                  ),
                  createdByUserId: auth.userId,
                },
              });
              return dek;
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
          return {
            residente: vistaResidente(actualizado, {
              tenantId: auth.tenantId,
              dek,
            }),
          };
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
