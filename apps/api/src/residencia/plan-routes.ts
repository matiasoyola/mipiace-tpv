// residencia-2 · LAS PLANTILLAS POR NIVEL y EL PLAN DE UN RESIDENTE.
//
//   · `GET/PUT /residencia/plantillas`                    — qué lleva un
//     válido, un semiasistido y un dependiente. `requireOwner`.
//   · `GET  /residencia/residentes/:clientId/plan`        — su plan, con
//     el histórico de líneas cerradas.
//   · `POST /residencia/residentes/:clientId/plan`        — añadir una
//     línea, o cambiarle la frecuencia a una (cierra y abre).
//   · `DELETE /residencia/residentes/:clientId/plan/:id`  — CERRAR una
//     línea. No borra: la fila se queda con su `toAt`.
//   · `GET  /residencia/residentes/:clientId/plan/hoy`    — `queToca`
//     para hoy, agrupado por turno. Es la prueba de que el plan está bien
//     **antes de que la puerta exista**.
//
// ── Los permisos, que aquí son DOS reglas y no una ───────────────────
//
// Alcance §7. Las plantillas son del centro y van con `requireOwner`,
// igual que el catálogo. El plan de un residente es otra cosa:
//
//   · lo pueden ver y tocar el OWNER y los roles de cuidado con categoría
//     `SUPERVISOR` o `DIRECTIVO` y los de alcance total (DUE, médico,
//     calidad) — porque decidir cada cuánto se gira a una persona es una
//     decisión clínica, no de configuración;
//   · y además **pasa por `conHistoria`**, la función de acceso de
//     siempre, porque el plan de cuidados de alguien ES un dato de salud:
//     dice que tiene riesgo de úlceras y que no se levanta solo. Que lo
//     diga una línea de plan en vez de un diagnóstico no lo hace menos.
//
// Las dos, y en ese orden: la de la capacidad primero (es más barata, no
// toca la base del residente) y la clínica después, que es la que deja
// línea en `clinical_access_log`.
//
// ── residencia-1b · LOS DOS MOTIVOS VAN CIFRADOS (D-63) ─────────────
//
// `reason` y `close_reason` son los textos libres de la tabla —«úlcera
// sacra grado II», «se le retiró la sonda»— y desde este bloque se
// escriben con `cifrarTexto` y se leen con `leerTexto`.
//
// Lo que **no** se cifra, y está declarado: `control_code` y las siete
// columnas de frecuencia. Sostienen `care_plan_items_one_live_key` («una
// línea viva por residente y control») y el cifrado de clinica-7 es no
// determinista, así que una columna cifrada no puede sostener un índice
// único. Consecuencia que conviene no esconder: el código del control en
// claro ya dice QUÉ se le controla a un residente.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { CarePlanItemSource, DependencyLevel } from "@mipiacetpv/db";
import {
  frecuenciaEnPalabras,
  problemaDeFrecuencia,
  queToca,
  utcToWallDate,
  wallTimeToUtc,
  type Frecuencia,
  type Ocurrencia,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { requireOwner, requireOwnerOrCashier } from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
// residencia-1b (D-63) · los dos motivos de una línea del plan van
// cifrados. `asegurarDek` en las escrituras, `dekONada` en las lecturas.
import { asegurarDek, dekONada } from "../clinica/claves.js";
import {
  cifrarTexto,
  leerTexto,
  nuevoIdDeFila,
  sitioMotivoDeCierreDeLinea,
  sitioMotivoDeLinea,
} from "../clinica/cripto-campos.js";
import { ensureResidenciaEnabled } from "./gate.js";
import {
  FRECUENCIA_DEFAULT_SELECT,
  FRECUENCIA_SELECT,
  aColumnas,
  deColumnas,
  deColumnasDefault,
  mismaFrecuencia,
} from "./frecuencia-columnas.js";
import { ausenciasDelPlan } from "./ausencias.js";

const PUERTAS_PLANTILLAS = [requireOwner, ensureClinicaEnabled, ensureResidenciaEnabled];
const PUERTAS_PLAN = [requireOwnerOrCashier, ensureClinicaEnabled, ensureResidenciaEnabled];

const NIVELES = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"] as const;
const FRECUENCIAS = [
  "EVERY_SHIFT",
  "DAILY",
  "MOMENTS",
  "EVERY_N_HOURS",
  "WEEKDAYS",
  "EVERY_N_DAYS",
  "MONTHLY",
  "ON_DEMAND",
] as const;

const FRECUENCIA_SCHEMA = {
  type: "object",
  required: ["kind"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: FRECUENCIAS as unknown as string[] },
    everyNHours: { type: "integer", minimum: 1, maximum: 12 },
    everyNDays: { type: "integer", minimum: 1, maximum: 365 },
    weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, maxItems: 7 },
    monthDay: { type: "integer", minimum: 1, maximum: 28 },
    shiftCodes: { type: "array", items: { type: "string", maxLength: 8 }, maxItems: 12 },
    momentCodes: { type: "array", items: { type: "string", maxLength: 24 }, maxItems: 12 },
  },
} as const;

const LINEA_SELECT = {
  id: true,
  clientId: true,
  controlCode: true,
  ...FRECUENCIA_SELECT,
  fromAt: true,
  toAt: true,
  source: true,
  sourceLevel: true,
  reason: true,
  closeReason: true,
  // residencia-1b · las que MANDAN. Las claras se quedan para las filas
  // que ya estaban escritas cuando llegó el cifrado.
  reasonCifrado: true,
  closeReasonCifrado: true,
} as const;

/**
 * ¿Puede esta persona tocar el PLAN de un residente?
 *
 * El OWNER sí (es quien configura el centro y quien responde de él). Del
 * resto, sólo quien lleva un rol de cuidado vigente de categoría
 * `SUPERVISOR` o `DIRECTIVO`, o uno de alcance total — que en la semilla
 * de serie son la DUE, el médico, calidad y dirección.
 *
 * El MANAGER NO entra por ser manager, y es a propósito: el encargado del
 * bar de un centro mixto es un `MANAGER` y no tiene por qué decidir cada
 * cuánto se gira a doña Carmen. Si además es la DUE, entra por su rol de
 * cuidado, que es la vía correcta — la que firma lo que decide con su
 * capacidad (D-31).
 *
 * Devuelve `null` si pasa, o la frase de la negativa si no. Dos motivos
 * distintos y no uno, por lo mismo que residencia-1 partió
 * `SIN_ROL_DE_CUIDADO` y `RESIDENTE_FUERA_DE_TU_ZONA`: se arreglan en
 * sitios distintos.
 */
async function puedeTocarElPlan(
  tenantId: string,
  userId: string,
  esOwner: boolean,
): Promise<{ error: string; message: string } | null> {
  if (esOwner) return null;
  const ahora = new Date();
  const roles = await getPrisma().careRoleAssignment.findMany({
    where: {
      tenantId,
      userId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gte: ahora } }],
    },
    select: { careRole: { select: { code: true, category: true, fullScope: true, active: true } } },
  });
  const vigentes = roles.map((r) => r.careRole).filter((r) => r.active);
  if (vigentes.length === 0) {
    return {
      error: "SIN_ROL_DE_CUIDADO",
      message:
        "No tienes ningún rol de cuidado vigente en este centro. Pídeselo a la dirección en Personal.",
    };
  }
  const puede = vigentes.some(
    (r) => r.category === "SUPERVISOR" || r.category === "DIRECTIVO" || r.fullScope,
  );
  if (!puede) {
    return {
      error: "PLAN_ES_DE_SUPERVISION",
      message:
        "El plan de cuidados lo ajustan la dirección, la DUE, el médico o calidad. Tú puedes verlo desde la puerta cuando esté, y registrar lo que toca.",
    };
  }
  return null;
}

export async function registerResidenciaPlanRoutes(app: FastifyInstance): Promise<void> {
  // ══ LAS PLANTILLAS POR NIVEL ═══════════════════════════════════════
  app.get(
    "/residencia/plantillas",
    { preHandler: PUERTAS_PLANTILLAS },
    async (request: FastifyRequest) => {
      const tenantId = request.auth!.tenantId;
      const prisma = getPrisma();
      const [lineas, controles, turnos, momentos] = await Promise.all([
        prisma.carePlanTemplateItem.findMany({
          where: { tenantId },
          orderBy: [{ dependencyLevel: "asc" }, { controlCode: "asc" }],
          select: {
            id: true,
            dependencyLevel: true,
            controlCode: true,
            ...FRECUENCIA_SELECT,
          },
        }),
        prisma.controlType.findMany({
          where: {
            supersededAt: null,
            OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
          },
          orderBy: [{ layer: "asc" }, { sortOrder: "asc" }],
          select: {
            code: true,
            name: true,
            layer: true,
            nature: true,
            allowedFrequencies: true,
            ...FRECUENCIA_DEFAULT_SELECT,
          },
        }),
        prisma.centerShift.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: "asc" }],
          select: { code: true, name: true },
        }),
        prisma.centerMoment.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: "asc" }],
          select: { code: true, name: true },
        }),
      ]);
      // Los ajustes, para no ofrecer en una plantilla un control que el
      // centro tiene apagado: entraría en el plan de todos los residentes
      // de ese nivel y no «tocaría» nunca.
      const ajustes = await prisma.centerControlSetting.findMany({
        where: { tenantId },
        select: { controlCode: true, active: true, alias: true },
      });
      const porCodigo = new Map(ajustes.map((a) => [a.controlCode, a]));

      const nombre = (code: string) =>
        porCodigo.get(code)?.alias ?? controles.find((c) => c.code === code)?.name ?? code;

      return {
        plantillas: Object.fromEntries(
          NIVELES.map((nivel) => [
            nivel,
            lineas
              .filter((l) => l.dependencyLevel === nivel)
              .map((l) => ({
                id: l.id,
                controlCode: l.controlCode,
                nombre: nombre(l.controlCode),
                frecuencia: deColumnas(l),
                // Si el centro lo apagó, la plantilla sigue teniéndolo y
                // la pantalla lo pinta en ámbar: quitarlo solo sería
                // decidir por la dirección, y volver a activar el control
                // tiene que devolverlo al plan.
                activo: porCodigo.get(l.controlCode)?.active ?? true,
              })),
          ]),
        ),
        // El catálogo que se puede añadir, con lo que cada control admite.
        controles: controles.map((c) => ({
          code: c.code,
          nombre: nombre(c.code),
          layer: c.layer,
          nature: c.nature,
          activo: porCodigo.get(c.code)?.active ?? true,
          puedeElegir: { frecuencias: c.allowedFrequencies },
          frecuenciaDeSerie: deColumnasDefault(c),
        })),
        turnos,
        momentos,
      };
    },
  );

  // ── GUARDAR LA PLANTILLA DE UN NIVEL · la lista COMPLETA ──────────
  //
  // Un `PUT` de la lista entera y no un POST/DELETE por línea, por lo
  // mismo que la zona de residencia-1 (decisión 5 de su done): es como se
  // usa —la dirección mira la pantalla, marca lo que lleva ese nivel y
  // guarda— y con rutas por línea el estado intermedio (la plantilla a
  // medias) es un momento en el que un ingreso precargaría medio plan.
  //
  // Guardar la plantilla **no toca los planes ya abiertos**. Es la
  // decisión: una plantilla es lo que se aplica a los ingresos y a los
  // cambios de nivel DE AHÍ EN ADELANTE, no una regla que se reevalúa. Si
  // cambiarla recalculara los 49 planes, la dirección movería una casilla
  // y cerraría líneas que la DUE había puesto a mano hace un mes.
  app.put(
    "/residencia/plantillas/:nivel",
    {
      preHandler: PUERTAS_PLANTILLAS,
      schema: {
        params: {
          type: "object",
          required: ["nivel"],
          additionalProperties: false,
          properties: { nivel: { type: "string", enum: NIVELES as unknown as string[] } },
        },
        body: {
          type: "object",
          required: ["lineas"],
          additionalProperties: false,
          properties: {
            lineas: {
              type: "array",
              maxItems: 80,
              items: {
                type: "object",
                required: ["controlCode", "frecuencia"],
                additionalProperties: false,
                properties: {
                  controlCode: { type: "string", minLength: 1, maxLength: 48 },
                  frecuencia: FRECUENCIA_SCHEMA,
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.auth!.tenantId;
      const { nivel } = request.params as { nivel: DependencyLevel };
      const body = request.body as {
        lineas: Array<{ controlCode: string; frecuencia: Frecuencia }>;
      };
      const prisma = getPrisma();

      const repetidos = body.lineas
        .map((l) => l.controlCode)
        .filter((c, i, todos) => todos.indexOf(c) !== i);
      if (repetidos.length > 0) {
        return reply.code(400).send({
          error: "CONTROL_REPETIDO",
          message: `«${repetidos[0]}» está dos veces en la plantilla. Un control lleva una frecuencia, no dos.`,
        });
      }

      // Todo validado ANTES de escribir: que la mitad de la plantilla se
      // guarde y la otra falle deja un nivel con medio plan, y el
      // siguiente ingreso lo arrastra.
      const controles = await prisma.controlType.findMany({
        where: {
          supersededAt: null,
          code: { in: body.lineas.map((l) => l.controlCode) },
          OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
        },
        select: { code: true, allowedFrequencies: true, nature: true },
      });
      for (const l of body.lineas) {
        const control = controles.find((c) => c.code === l.controlCode);
        if (!control) {
          return reply.code(400).send({
            error: "CONTROL_NO_ENCONTRADO",
            message: `No hay ningún control con el código «${l.controlCode}».`,
          });
        }
        const problema = problemaDeFrecuencia(l.frecuencia);
        if (problema) {
          return reply.code(400).send({
            error: "FRECUENCIA_INCOHERENTE",
            message: `${l.controlCode}: ${problema}`,
          });
        }
        if (!control.allowedFrequencies.includes(l.frecuencia.kind)) {
          return reply.code(400).send({
            error: "FRECUENCIA_NO_PERMITIDA",
            message: `«${l.controlCode}» no admite esa frecuencia. Las que admite son: ${control.allowedFrequencies.join(", ")}.`,
          });
        }
        // Un control a demanda en una plantilla no hace daño pero no hace
        // nada: `queToca` no devuelve ocurrencias suyas. Se dice, para que
        // nadie crea que ha agendado la deposición.
        if (control.nature === "ON_DEMAND" && l.frecuencia.kind !== "ON_DEMAND") {
          return reply.code(400).send({
            error: "NATURALEZA_Y_FRECUENCIA",
            message: `«${l.controlCode}» es un control a demanda: no tiene agenda y no se puede agendar en una plantilla.`,
          });
        }
      }

      // Borrar y reescribir, en una transacción. **Aquí sí se borra**, al
      // revés que en el plan de un residente, y la diferencia es de fondo:
      // una plantilla es CONFIGURACIÓN (como un turno o una habitación) y
      // una línea de plan es parte de la historia de una persona. Nadie
      // tiene que poder reconstruir «qué decía la plantilla del
      // semiasistido en marzo»; lo que sí hay que poder reconstruir es qué
      // le tocaba a doña Carmen, y eso vive en `care_plan_items`.
      await prisma.$transaction(async (tx) => {
        await tx.carePlanTemplateItem.deleteMany({
          where: { tenantId, dependencyLevel: nivel },
        });
        if (body.lineas.length > 0) {
          await tx.carePlanTemplateItem.createMany({
            data: body.lineas.map((l) => ({
              tenantId,
              dependencyLevel: nivel,
              controlCode: l.controlCode,
              ...aColumnas(l.frecuencia),
            })),
          });
        }
      });

      return { nivel, lineas: body.lineas.length };
    },
  );

  // ══ EL PLAN DE UN RESIDENTE ════════════════════════════════════════
  app.get(
    "/residencia/residentes/:clientId/plan",
    {
      preHandler: PUERTAS_PLAN,
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
      const ctx = await contextoDelPlan(request, reply);
      if (!ctx) return;
      const { tenantId, clientId } = ctx;
      const prisma = getPrisma();

      return conHistoria(request, reply, { clientId, action: "READ" }, async () => {
        // residencia-1b · una lectura NO crea claves: `dekONada`. Y una
        // sola vez para todas las líneas del plan, que son del mismo
        // centro — la caché del llavero dura 60 s, pero pedirla por línea
        // serían veinte `await` en una ruta que hace seis consultas.
        const dek = await dekONada(tenantId, prisma);
        const [lineas, controles, ajustes, turnos, momentos, perfil] = await Promise.all([
          prisma.carePlanItem.findMany({
            where: { tenantId, clientId },
            orderBy: [{ toAt: "asc" }, { controlCode: "asc" }],
            select: LINEA_SELECT,
          }),
          prisma.controlType.findMany({
            where: {
              supersededAt: null,
              OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
            },
            orderBy: [{ layer: "asc" }, { sortOrder: "asc" }],
            select: {
              code: true,
              name: true,
              layer: true,
              nature: true,
              allowedFrequencies: true,
              ...FRECUENCIA_DEFAULT_SELECT,
            },
          }),
          prisma.centerControlSetting.findMany({
            where: { tenantId },
            select: { controlCode: true, active: true, alias: true, ...FRECUENCIA_SELECT },
          }),
          prisma.centerShift.findMany({
            where: { tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: { code: true, name: true, startsAt: true, endsAt: true },
          }),
          prisma.centerMoment.findMany({
            where: { tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: { code: true, name: true, atTime: true },
          }),
          prisma.residentProfile.findUniqueOrThrow({
            where: { clientId },
            select: { dependencyLevel: true, admissionDate: true, dischargeDate: true },
          }),
        ]);

        const ajustePorCodigo = new Map(ajustes.map((a) => [a.controlCode, a]));
        const nombreTurno = (c: string) => turnos.find((t) => t.code === c)?.name ?? c;
        const nombreMomento = (c: string) => momentos.find((m) => m.code === c)?.name ?? c;
        const nombre = (code: string) =>
          ajustePorCodigo.get(code)?.alias ??
          controles.find((c) => c.code === code)?.name ??
          code;

        const vista = (l: (typeof lineas)[number]) => {
          const f = deColumnas(l);
          const ajuste = ajustePorCodigo.get(l.controlCode);
          return {
            id: l.id,
            controlCode: l.controlCode,
            nombre: nombre(l.controlCode),
            layer: controles.find((c) => c.code === l.controlCode)?.layer ?? null,
            frecuencia: f,
            // La frase la compone el PAQUETE y no la pantalla: la va a
            // leer también el parte de relevo de residencia-5, y dos
            // traducciones de «cada 3 h» acabarían diciendo cosas
            // distintas.
            frecuenciaEnPalabras: frecuenciaEnPalabras(f, nombreTurno, nombreMomento),
            desde: l.fromAt.toISOString(),
            hasta: l.toAt?.toISOString() ?? null,
            source: l.source,
            sourceLevel: l.sourceLevel,
            // residencia-1b · de la columna cifrada, con el hueco marcado
            // si no se descifra. El plan se SIGUE SIRVIENDO: una línea
            // ilegible no puede dejar a un residente sin su plan entero.
            motivo: leerTexto(
              { cifrado: l.reasonCifrado, claro: l.reason },
              dek,
              sitioMotivoDeLinea(tenantId, l.id),
            ),
            motivoDeCierre: leerTexto(
              { cifrado: l.closeReasonCifrado, claro: l.closeReason },
              dek,
              sitioMotivoDeCierreDeLinea(tenantId, l.id),
            ),
            // Los dos avisos que la pantalla pinta en ámbar. Ninguno es un
            // error: son estados legítimos que no pueden pasar
            // desapercibidos.
            //
            //   · el centro apagó el control: la línea existe y no toca;
            //   · la línea nombra un turno o un momento que ya no existe:
            //     `queToca` no inventa otro y devuelve cero ocurrencias.
            controlDesactivado: ajuste ? !ajuste.active : false,
            turnoDesconocido: (f.shiftCodes ?? []).some(
              (c) => !turnos.some((t) => t.code === c),
            ),
            momentoDesconocido: (f.momentCodes ?? []).some(
              (c) => !momentos.some((m) => m.code === c),
            ),
          };
        };

        return {
          residente: {
            dependencyLevel: perfil.dependencyLevel,
            admissionDate: perfil.admissionDate.toISOString().slice(0, 10),
            dischargeDate: perfil.dischargeDate?.toISOString().slice(0, 10) ?? null,
          },
          // Las vivas y el histórico, separados: la pantalla pinta las
          // primeras y esconde el segundo detrás de «ver el histórico».
          lineas: lineas.filter((l) => l.toAt === null).map(vista),
          cerradas: lineas.filter((l) => l.toAt !== null).map(vista),
          // Lo que se puede añadir: el catálogo activo que no está ya en
          // el plan vivo.
          disponibles: controles
            .filter(
              (c) =>
                (ajustePorCodigo.get(c.code)?.active ?? true) &&
                !lineas.some((l) => l.controlCode === c.code && l.toAt === null),
            )
            .map((c) => ({
              code: c.code,
              nombre: nombre(c.code),
              layer: c.layer,
              nature: c.nature,
              puedeElegir: { frecuencias: c.allowedFrequencies },
              // La del CENTRO si la hay, y la de serie si no: es la que la
              // pantalla propone al añadir, y la que se materializa en la
              // línea.
              frecuenciaPropuesta: ajustePorCodigo.has(c.code)
                ? deColumnas(ajustePorCodigo.get(c.code)!)
                : deColumnasDefault(c),
            })),
          turnos,
          momentos,
        };
      });
    },
  );

  // ── AÑADIR UNA LÍNEA, O CAMBIARLE LA FRECUENCIA ───────────────────
  //
  // Una sola ruta para las dos cosas, y es a propósito: cambiarle la
  // frecuencia a un control **es** cerrar su línea y abrir otra, en la
  // misma transacción y en ese orden. Con dos rutas, la pantalla tendría
  // que acordarse de llamar a las dos y el estado intermedio —el control
  // sin línea viva— es un residente al que ese cuidado no le toca.
  app.post(
    "/residencia/residentes/:clientId/plan",
    {
      preHandler: PUERTAS_PLAN,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["controlCode", "frecuencia"],
          additionalProperties: false,
          properties: {
            controlCode: { type: "string", minLength: 1, maxLength: 48 },
            frecuencia: FRECUENCIA_SCHEMA,
            motivo: { type: "string", maxLength: 160 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = await contextoDelPlan(request, reply);
      if (!ctx) return;
      const { tenantId, clientId, userId } = ctx;
      const body = request.body as {
        controlCode: string;
        frecuencia: Frecuencia;
        motivo?: string;
      };
      const prisma = getPrisma();

      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const control = await prisma.controlType.findFirst({
          where: {
            code: body.controlCode,
            supersededAt: null,
            OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
          },
          select: { code: true, allowedFrequencies: true, nature: true },
        });
        if (!control) {
          return reply.code(404).send({
            error: "CONTROL_NO_ENCONTRADO",
            message: "No hay ningún control con ese código.",
          });
        }
        const problema = problemaDeFrecuencia(body.frecuencia);
        if (problema) {
          return reply.code(400).send({ error: "FRECUENCIA_INCOHERENTE", message: problema });
        }
        if (!control.allowedFrequencies.includes(body.frecuencia.kind)) {
          return reply.code(400).send({
            error: "FRECUENCIA_NO_PERMITIDA",
            message: `Este control no admite esa frecuencia. Las que admite son: ${control.allowedFrequencies.join(", ")}.`,
          });
        }
        if (control.nature === "ON_DEMAND" && body.frecuencia.kind !== "ON_DEMAND") {
          return reply.code(400).send({
            error: "NATURALEZA_Y_FRECUENCIA",
            message:
              "Es un control a demanda: el botón está en la puerta y no tiene agenda. No se puede agendar.",
          });
        }

        const ahora = new Date();
        const viva = await prisma.carePlanItem.findFirst({
          where: { tenantId, clientId, controlCode: body.controlCode, toAt: null },
          select: { id: true, ...FRECUENCIA_SELECT, source: true },
        });

        // Guardar dos veces lo mismo NO cierra una línea para abrir otra
        // idéntica. Sin esto, cada vez que alguien abriera el panel y
        // diera a guardar sin tocar nada, el histórico ganaría una fila y
        // el plan de ayer dejaría de parecerse al de hoy.
        if (viva && mismaFrecuencia(deColumnas(viva), body.frecuencia)) {
          return { linea: { id: viva.id, sinCambios: true } };
        }

        const creada = await prisma.$transaction(async (tx) => {
          // residencia-1b · la clave del centro, dentro de la transacción
          // que escribe. Si no se pudiera obtener, esto LEVANTA y la línea
          // no se guarda: no se escribe el motivo en claro porque falte la
          // clave.
          const dek = await asegurarDek(tenantId, tx);
          if (viva) {
            await tx.carePlanItem.update({
              where: { id: viva.id },
              data: {
                toAt: ahora,
                closeReason: null,
                closeReasonCifrado: cifrarTexto(
                  body.motivo?.trim() || "cambio de frecuencia",
                  dek,
                  sitioMotivoDeCierreDeLinea(tenantId, viva.id),
                ),
                closedByUserId: userId,
              },
            });
          }
          // El uuid, generado aquí: el AAD lo necesita y no se puede leer
          // de una fila que todavía no existe.
          const nuevaId = nuevoIdDeFila();
          return tx.carePlanItem.create({
            data: {
              id: nuevaId,
              tenantId,
              clientId,
              controlCode: body.controlCode,
              ...aColumnas(body.frecuencia),
              fromAt: ahora,
              // A mano es MANUAL, siempre, incluso si lo que se cambia es
              // una línea que puso la plantilla. Y es la decisión que hace
              // que el cambio de nivel funcione: en cuanto alguien la
              // toca, la línea deja de ser de la plantilla y el recálculo
              // no la cerrará nunca.
              source: "MANUAL" as CarePlanItemSource,
              sourceLevel: null,
              reason: null,
              reasonCifrado: cifrarTexto(
                body.motivo?.trim() || null,
                dek,
                sitioMotivoDeLinea(tenantId, nuevaId),
              ),
              createdByUserId: userId,
            },
            select: { id: true },
          });
        });

        return reply.code(201).send({ linea: creada });
      });
    },
  );

  // ── CERRAR UNA LÍNEA · no se borra ────────────────────────────────
  //
  // `DELETE` en la URL porque es lo que la pantalla hace («quitar este
  // control»), y lo que pasa por debajo es un `UPDATE … SET to_at`. La
  // fila se queda: «¿qué le tocaba a doña Carmen el 3 de marzo?» tiene que
  // tener respuesta.
  app.delete(
    "/residencia/residentes/:clientId/plan/:itemId",
    {
      preHandler: PUERTAS_PLAN,
      schema: {
        params: {
          type: "object",
          required: ["clientId", "itemId"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            itemId: { type: "string", format: "uuid" },
          },
        },
        // El motivo va en la QUERY y no en el cuerpo, y es un arreglo que
        // salió de su propio test: un `DELETE` sin cuerpo contra una ruta
        // que declara `body` recibe un 400 de Fastify, y la pantalla lo
        // llama sin cuerpo (`api(url, { method: "DELETE" })`). O sea que
        // esto estaba roto para el único cliente que tiene.
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { motivo: { type: "string", maxLength: 160 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = await contextoDelPlan(request, reply);
      if (!ctx) return;
      const { tenantId, clientId, userId } = ctx;
      const { itemId } = request.params as { itemId: string };
      const body = (request.query ?? {}) as { motivo?: string };
      const prisma = getPrisma();

      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        const linea = await prisma.carePlanItem.findFirst({
          where: { id: itemId, tenantId, clientId },
          select: { id: true, toAt: true },
        });
        if (!linea) {
          return reply.code(404).send({
            error: "LINEA_NO_ENCONTRADA",
            message: "Esa línea no es del plan de este residente.",
          });
        }
        if (linea.toAt !== null) {
          return reply.code(409).send({
            error: "LINEA_YA_CERRADA",
            message: "Esa línea ya estaba cerrada. No se borra: se queda en el histórico.",
          });
        }
        const dek = await asegurarDek(tenantId, prisma);
        await prisma.carePlanItem.update({
          where: { id: itemId },
          data: {
            toAt: new Date(),
            closeReason: null,
            closeReasonCifrado: cifrarTexto(
              body.motivo?.trim() || null,
              dek,
              sitioMotivoDeCierreDeLinea(tenantId, itemId),
            ),
            closedByUserId: userId,
          },
        });
        return { cerrada: true };
      });
    },
  );

  // ── LA VISTA «HOY» · `queToca`, agrupado por turno ────────────────
  //
  // Es la prueba de que el plan está bien **antes de que la puerta
  // exista**: la dirección da de alta a un residente, abre esta vista y ve
  // lo que le tocaría en cada turno. Si algo está mal puesto, se ve aquí y
  // no el primer día con quince tablets colgadas.
  //
  // Y acepta un día cualquiera (`?dia=YYYY-MM-DD`), que es la otra mitad:
  // la misma llamada contesta «¿qué le tocaba el 3 de marzo?».
  app.get(
    "/residencia/residentes/:clientId/plan/hoy",
    {
      preHandler: PUERTAS_PLAN,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { dia: { type: "string", format: "date" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = await contextoDelPlan(request, reply);
      if (!ctx) return;
      const { tenantId, clientId } = ctx;
      const { dia } = request.query as { dia?: string };
      const prisma = getPrisma();

      return conHistoria(request, reply, { clientId, action: "READ" }, async () => {
        const [lineas, ajustes, turnos, momentos, controles] = await Promise.all([
          prisma.carePlanItem.findMany({
            where: { tenantId, clientId },
            select: { id: true, clientId: true, controlCode: true, fromAt: true, toAt: true, ...FRECUENCIA_SELECT },
          }),
          prisma.centerControlSetting.findMany({
            where: { tenantId },
            select: { controlCode: true, active: true, alias: true },
          }),
          prisma.centerShift.findMany({
            where: { tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
          }),
          prisma.centerMoment.findMany({
            where: { tenantId },
            orderBy: [{ sortOrder: "asc" }],
            select: { code: true, name: true, atTime: true },
          }),
          prisma.controlType.findMany({
            where: {
              supersededAt: null,
              OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
            },
            select: { code: true, name: true, layer: true, valueDomain: true, unit: true },
          }),
        ]);

        // El día de PARED del centro, de sus 00:00 a las 00:00 del
        // siguiente. Construirlo con `Date.UTC` sería un día desplazado
        // una o dos horas, y en octubre metería la ronda de las 00:00 en
        // el día anterior.
        const fecha = dia ?? utcToWallDate(new Date());
        const desde = wallTimeToUtc(fecha, "00:00");
        const hasta = new Date(desde.getTime() + 25 * 3600_000);
        const finDelDia = wallTimeToUtc(siguienteDia(fecha), "00:00");

        const ocurrencias = queToca(
          lineas.map((l) => ({
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
          // El día de pared puede tener 23, 24 o 25 horas; se pide hasta
          // las 00:00 del siguiente, calculadas como fecha y no como
          // «+24 h».
          finDelDia < hasta ? finDelDia : hasta,
          // historia-1 (D-92) · las ausencias de ESTE residente. La vista
          // «hoy» de su plan enseña lo que le toca de verdad, y mientras
          // está en el hospital no le toca nada — la pantalla lo dice con
          // su banda en vez de listar veintiocho cuidados que nadie puede
          // hacer.
          await ausenciasDelPlan(
            prisma,
            tenantId,
            desde,
            finDelDia < hasta ? finDelDia : hasta,
            [clientId],
          ),
        );

        const aliasPorCodigo = new Map(ajustes.map((a) => [a.controlCode, a.alias]));
        const nombre = (code: string) =>
          aliasPorCodigo.get(code) ?? controles.find((c) => c.code === code)?.name ?? code;

        const vista = (o: Ocurrencia) => ({
          controlCode: o.controlCode,
          nombre: nombre(o.controlCode),
          layer: controles.find((c) => c.code === o.controlCode)?.layer ?? null,
          at: o.at.toISOString(),
          until: o.until?.toISOString() ?? null,
          esFranja: o.esFranja,
          shiftCode: o.shiftCode,
          momentCode: o.momentCode,
        });

        return {
          dia: fecha,
          // Agrupado por turno, que es cómo trabaja el centro: la auxiliar
          // de la mañana quiere ver su turno, no el día entero. Y en el
          // orden del cuadrante, no en el de la base.
          porTurno: turnos.map((t) => ({
            code: t.code,
            name: t.name,
            desde: t.startsAt,
            hasta: t.endsAt,
            ocurrencias: ocurrencias.filter((o) => o.shiftCode === t.code).map(vista),
          })),
          // Lo que no cae en ningún turno. Normalmente nada —los tres de
          // serie cubren las 24 h— y si sale algo es un hueco en el
          // cuadrante, que la pantalla pinta en ámbar. Misma decisión que
          // el «ahora: ningún turno» de la pantalla de Turnos.
          sinTurno: ocurrencias.filter((o) => o.shiftCode === null).map(vista),
          total: ocurrencias.length,
          // Y los que están en el plan y NO tocan hoy: los `ON_DEMAND`.
          // Salen aparte porque el botón sí estará en la puerta, y una
          // vista de «hoy» que los esconda haría creer que la deposición
          // no se apunta.
          aDemanda: lineas
            .filter((l) => l.toAt === null && l.frequencyKind === "ON_DEMAND")
            .map((l) => ({ controlCode: l.controlCode, nombre: nombre(l.controlCode) })),
        };
      });
    },
  );
}

/** «YYYY-MM-DD» + 1 día, en calendario. */
function siguienteDia(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Las dos puertas del plan, resueltas una vez: la del aislamiento por fila
 * (¿es este residente de este centro?) y la de la capacidad (¿puede esta
 * persona tocar un plan?).
 *
 * Devuelve `null` si ya ha contestado. El orden importa y es el de
 * residencia-1: el aislamiento primero —la 404 es del tenant, un
 * `clientId` de otro centro no existe para éste— y la capacidad después.
 * La autorización CLÍNICA va luego, en `conHistoria`, que es la que deja
 * línea en el registro de accesos.
 */
async function contextoDelPlan(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ tenantId: string; clientId: string; userId: string } | null> {
  // `requireOwnerOrCashier` puebla SIEMPRE `request.auth`, también cuando
  // el token es una sesión de TPV: ahí copia el `sub`, el `tid` y el rol
  // del cajero. Una sola lectura, como en las demás rutas de residencia.
  const auth = request.auth!;
  const { clientId } = request.params as { clientId: string };
  const prisma = getPrisma();

  const existe = await prisma.residentProfile.findFirst({
    where: { clientId, tenantId: auth.tenantId },
    select: { clientId: true },
  });
  if (!existe) {
    reply.code(404).send({
      error: "RESIDENTE_NO_ENCONTRADO",
      message: "No hay ningún residente con esa ficha en este centro.",
    });
    return null;
  }

  const negativa = await puedeTocarElPlan(
    auth.tenantId,
    auth.userId,
    auth.role === "OWNER",
  );
  if (negativa) {
    // 403 y no 404: el residente existe y es de este centro, lo que falta
    // es el permiso. Mismo criterio que `SIN_ACCESO_AL_PACIENTE`.
    reply.code(403).send(negativa);
    return null;
  }

  return { tenantId: auth.tenantId, clientId, userId: auth.userId };
}
