// personal-1 · LA API DEL CUADRANTE.
//
// Mismo guardia que el resto del módulo, y una decisión que se ve de lejos
// en este fichero: **las rutas de turnos son NUEVAS y las de residencia no
// se tocan** (decisión 4).
//
// `center_shifts` es la MISMA tabla. Lo que la ataba a la residencia eran
// sus rutas, que piden `ensureClinicaEnabled` + `ensureResidenciaEnabled`
// y por lo tanto dejan fuera a un colegio que sólo ficha. Aquí se abren
// con el gate del fichaje, y `residencia/turnos-routes.ts` sigue
// exactamente como estaba, leyendo lo mismo.
//
// Lo que eso significa y conviene no esconder: un tenant de residencia
// tiene DOS pantallas que editan los mismos tres turnos. No es un
// descuido — son dos módulos distintos que necesitan el dato, y duplicar
// la tabla para que cada uno tuviera la suya era la alternativa. Lo que no
// puede pasar es que discrepen, y no pueden: es una fila.
//
// ── Y LA REGLA DE ORO ───────────────────────────────────────────────
//
// Ni una celda se escribe aquí. Todo pasa por `ponerCelda`, que llama a
// `set_staff_schedule_day(...)`. Ver la cabecera de `cuadrante.ts`.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  AUSENCIAS,
  comprobarTurnosDelTenant,
  diasDe,
  resumenDeAvisos,
} from "@mipiacetpv/cuadrante";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureFichajeEnabled } from "../lib/fichaje-gate.js";
import {
  CuadranteRechazado,
  asegurarCuadrante,
  cargarCuadrante,
  ponerCelda,
  sembrarCategoriasSiHaceFalta,
  sembrarTurnosSiHaceFalta,
  turnosDelTenant,
} from "./cuadrante.js";
import { localDate } from "./time.js";

const MES = "^\\d{4}-(0[1-9]|1[0-2])$";
const DIA = "^\\d{4}-\\d{2}-\\d{2}$";
const HORA = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

/** El nombre con el que se firma un cambio del cuadrante. */
async function autorDe(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { alias: true, email: true },
  });
  // Congelado en la fila de cambio, igual que `TimeEntryCorrection.author`:
  // un usuario que se borra no puede dejar muda la traza.
  return user?.alias ?? user?.email?.split("@")[0] ?? "la empresa";
}

export async function registerCuadranteRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [requireOwnerOrManager, ensureFichajeEnabled] };

  // ── los turnos del tenant ──────────────────────────────────────────

  app.get("/admin/fichaje/turnos", guard, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    await sembrarTurnosSiHaceFalta(auth.tenantId, prisma);
    const turnos = await turnosDelTenant(auth.tenantId, prisma);
    return {
      turnos,
      // La configuración, comprobada: solapes, huecos de las 24 h y turnos
      // sin cobertura declarada. **Avisos y no un 409**: un colegio no
      // tiene por qué cubrir las cuatro de la mañana, y negarle guardar
      // sería imponerle el horario de una residencia.
      avisos: comprobarTurnosDelTenant(turnos),
    };
  });

  const CUERPO_DE_TURNO = {
    code: { type: "string", minLength: 1, maxLength: 8 },
    name: { type: "string", minLength: 1, maxLength: 40 },
    startsAt: { type: "string", pattern: HORA },
    endsAt: { type: "string", pattern: HORA },
    sortOrder: { type: "integer", minimum: 0, maximum: 999 },
    // `null` = «no declarado», que es distinto de 0. Ver el modelo.
    minCoverage: { type: ["integer", "null"], minimum: 0, maximum: 200 },
  } as const;

  app.post(
    "/admin/fichaje/turnos",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          required: ["code", "name", "startsAt", "endsAt"],
          additionalProperties: false,
          properties: CUERPO_DE_TURNO,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        code: string;
        name: string;
        startsAt: string;
        endsAt: string;
        sortOrder?: number;
        minCoverage?: number | null;
      };
      const prisma = getPrisma();
      const code = body.code.trim().toUpperCase();

      // Mismo rechazo que la ruta de residencia, palabra por palabra: un
      // turno sin hora de fin (o con la misma que la de inicio) no se sabe
      // si dura cero horas o veinticuatro.
      if (body.startsAt === body.endsAt) {
        return reply.code(400).send({
          error: "TURNO_DE_CERO_HORAS",
          message:
            "La hora de inicio y la de fin no pueden ser la misma: no se sabría si el turno dura cero horas o veinticuatro.",
        });
      }
      const repetido = await prisma.centerShift.findFirst({
        where: { tenantId: auth.tenantId, code },
        select: { id: true },
      });
      if (repetido) {
        return reply.code(409).send({
          error: "TURNO_REPETIDO",
          message: `Ya hay un turno con el código «${code}».`,
        });
      }
      const turno = await prisma.centerShift.create({
        data: {
          tenantId: auth.tenantId,
          code,
          name: body.name.trim(),
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          sortOrder: body.sortOrder ?? 50,
          minCoverage: body.minCoverage ?? null,
        },
        select: { id: true, code: true, name: true },
      });
      const turnos = await turnosDelTenant(auth.tenantId, prisma);
      // Y el aviso del solape vuelve EN LA RESPUESTA del alta, no en la
      // siguiente lectura: quien acaba de crear un turno que pisa otro
      // tiene que verlo ahora, no cuando vuelva a entrar.
      return reply
        .code(201)
        .send({ turno, avisos: comprobarTurnosDelTenant(turnos) });
    },
  );

  app.patch(
    "/admin/fichaje/turnos/:id",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: CUERPO_DE_TURNO.name,
            startsAt: CUERPO_DE_TURNO.startsAt,
            endsAt: CUERPO_DE_TURNO.endsAt,
            sortOrder: CUERPO_DE_TURNO.sortOrder,
            minCoverage: CUERPO_DE_TURNO.minCoverage,
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        startsAt?: string;
        endsAt?: string;
        sortOrder?: number;
        minCoverage?: number | null;
      };
      const prisma = getPrisma();
      const turno = await prisma.centerShift.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, startsAt: true, endsAt: true },
      });
      if (!turno) {
        return reply.code(404).send({
          error: "TURNO_NO_ENCONTRADO",
          message: "Ese turno no es de este centro.",
        });
      }
      const inicio = body.startsAt ?? turno.startsAt;
      const fin = body.endsAt ?? turno.endsAt;
      if (inicio === fin) {
        return reply.code(400).send({
          error: "TURNO_DE_CERO_HORAS",
          message:
            "La hora de inicio y la de fin no pueden ser la misma: no se sabría si el turno dura cero horas o veinticuatro.",
        });
      }
      await prisma.centerShift.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.startsAt ? { startsAt: body.startsAt } : {}),
          ...(body.endsAt ? { endsAt: body.endsAt } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.minCoverage !== undefined
            ? { minCoverage: body.minCoverage }
            : {}),
        },
      });
      const turnos = await turnosDelTenant(auth.tenantId, prisma);
      return {
        turno: turnos.find((t) => t.id === id),
        avisos: comprobarTurnosDelTenant(turnos),
      };
    },
  );

  // ── las reglas ─────────────────────────────────────────────────────

  app.get("/admin/fichaje/reglas", guard, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const [fila, tenant] = await Promise.all([
      prisma.staffRuleSettings.findUnique({ where: { tenantId: auth.tenantId } }),
      prisma.tenant.findUnique({
        where: { id: auth.tenantId },
        select: {
          residenciaEnabled: true,
          fichajeMaxOpenHours: true,
          fichajeShiftMarginHours: true,
        },
      }),
    ]);
    return {
      // Si no hay fila, los defaults — que son los de la base. La pantalla
      // los enseña igual y al guardar se crea la fila.
      reglas: {
        ratioAtencionDirecta: (fila?.ratioDirectCarePerMil ?? 200) / 1000,
        minutosDeJornadaCompleta: fila?.fullDayMinutes ?? 480,
        horasDescansoDiario: fila?.minRestHours ?? 12,
        horasDescansoSemanal: fila?.weeklyRestHours ?? 36,
        diasComputoSemanal: fila?.weeklyRestWindowDays ?? 7,
        minutosDeTolerancia: fila?.noShowToleranceMinutes ?? 15,
      },
      /** Si la ratio se evalúa: lo dice el módulo, no un ajuste. */
      conRatioDeResidencia: tenant?.residenciaEnabled === true,
      /** Los dos del super-admin, de sólo lectura aquí. */
      delSuperAdmin: {
        fichajeMaxOpenHours: tenant?.fichajeMaxOpenHours ?? 16,
        fichajeShiftMarginHours: tenant?.fichajeShiftMarginHours ?? 4,
      },
    };
  });

  app.patch(
    "/admin/fichaje/reglas",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            // Los rangos son los MISMOS que el CHECK de la base. Si los
            // dos no coincidieran, ganaría la base y nadie sabría por qué
            // — es la lección de `fichaje_max_open_hours` (#45).
            ratioAtencionDirecta: { type: "number", minimum: 0, maximum: 2 },
            minutosDeJornadaCompleta: { type: "integer", minimum: 60, maximum: 720 },
            horasDescansoDiario: { type: "integer", minimum: 0, maximum: 24 },
            horasDescansoSemanal: { type: "integer", minimum: 0, maximum: 96 },
            diasComputoSemanal: { type: "integer", minimum: 7, maximum: 14 },
            minutosDeTolerancia: { type: "integer", minimum: 0, maximum: 240 },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const body = request.body as Record<string, number | undefined>;
      const prisma = getPrisma();
      const data: Record<string, unknown> = {
        updatedByUserId: auth.userId,
      };
      if (body.ratioAtencionDirecta !== undefined) {
        // A milésimas, que es como vive en la base.
        data.ratioDirectCarePerMil = Math.round(body.ratioAtencionDirecta * 1000);
      }
      if (body.minutosDeJornadaCompleta !== undefined) {
        data.fullDayMinutes = body.minutosDeJornadaCompleta;
      }
      if (body.horasDescansoDiario !== undefined) {
        data.minRestHours = body.horasDescansoDiario;
      }
      if (body.horasDescansoSemanal !== undefined) {
        data.weeklyRestHours = body.horasDescansoSemanal;
      }
      if (body.diasComputoSemanal !== undefined) {
        data.weeklyRestWindowDays = body.diasComputoSemanal;
      }
      if (body.minutosDeTolerancia !== undefined) {
        data.noShowToleranceMinutes = body.minutosDeTolerancia;
      }
      const fila = await prisma.staffRuleSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, ...data },
        update: data,
      });
      return {
        reglas: {
          ratioAtencionDirecta: fila.ratioDirectCarePerMil / 1000,
          minutosDeJornadaCompleta: fila.fullDayMinutes,
          horasDescansoDiario: fila.minRestHours,
          horasDescansoSemanal: fila.weeklyRestHours,
          diasComputoSemanal: fila.weeklyRestWindowDays,
          minutosDeTolerancia: fila.noShowToleranceMinutes,
        },
      };
    },
  );

  // ── el cuadrante ───────────────────────────────────────────────────

  app.get(
    "/admin/fichaje/cuadrante",
    {
      ...guard,
      schema: {
        querystring: {
          type: "object",
          properties: { month: { type: "string", pattern: MES } },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const { month } = request.query as { month?: string };
      const mes = month ?? localDate(new Date()).slice(0, 7);
      const prisma = getPrisma();
      // La semilla, al abrir: ver la cabecera de `cuadrante.ts`.
      await Promise.all([
        sembrarTurnosSiHaceFalta(auth.tenantId, prisma),
        sembrarCategoriasSiHaceFalta(auth.tenantId, prisma),
      ]);
      const cargado = await cargarCuadrante(auth.tenantId, mes, prisma);
      return {
        month: mes,
        dias: diasDe(mes),
        cabecera: cargado.cabecera,
        turnos: cargado.cuadrante.turnos,
        personas: cargado.personas,
        celdas: cargado.cuadrante.celdas,
        ausencias: AUSENCIAS,
        reglas: cargado.reglas,
        avisos: cargado.avisos,
        resumen: cargado.resumen,
        ocupacionPorDia: cargado.cuadrante.ocupacionPorDia ?? null,
      };
    },
  );

  /**
   * Pintar celdas. **Una lista, no una celda**, y es lo que hace que
   * «copiar la semana anterior» y «repetir patrón» sean la misma ruta que
   * un toque: un toque manda una celda y copiar la semana manda ciento
   * cuarenta y siete.
   *
   * Todas en la MISMA transacción: media semana copiada es el estado del
   * que después nadie se fía.
   */
  app.put(
    "/admin/fichaje/cuadrante/:month/celdas",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["month"],
          additionalProperties: false,
          properties: { month: { type: "string", pattern: MES } },
        },
        body: {
          type: "object",
          required: ["celdas"],
          additionalProperties: false,
          properties: {
            celdas: {
              type: "array",
              minItems: 1,
              // 21 personas × 31 días. Más que un mes entero de un centro
              // no cabe en una petición, y el mensaje lo dice.
              maxItems: 1000,
              items: {
                type: "object",
                required: ["employeeId", "dia"],
                additionalProperties: false,
                properties: {
                  employeeId: { type: "string", format: "uuid" },
                  dia: { type: "string", pattern: DIA },
                  turnoIds: {
                    type: "array",
                    maxItems: 4,
                    items: { type: "string", format: "uuid" },
                  },
                  ausencia: { type: ["string", "null"], enum: [...AUSENCIAS, null] },
                },
              },
            },
            // Obligatorio si el cuadrante está publicado. Lo exige la
            // función de la base; esto es para que llegue la frase.
            motivo: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { month } = request.params as { month: string };
      const body = request.body as {
        celdas: Array<{
          employeeId: string;
          dia: string;
          turnoIds?: string[];
          ausencia?: string | null;
        }>;
        motivo?: string;
      };
      const prisma = getPrisma();
      const cabecera = await asegurarCuadrante(
        auth.tenantId,
        month,
        auth.userId,
        prisma,
      );
      const autor =
        cabecera.state === "PUBLICADO"
          ? await autorDe(prisma, auth.userId)
          : null;

      let cambios = 0;
      try {
        await prisma.$transaction(async (tx) => {
          for (const celda of body.celdas) {
            const id = await ponerCelda(tx, {
              scheduleId: cabecera.id,
              employeeId: celda.employeeId,
              dia: celda.dia,
              turnoIds: celda.turnoIds ?? [],
              ausencia: celda.ausencia ?? null,
              motivo: body.motivo ?? null,
              autor,
              autorUserId: auth.userId,
            });
            if (id != null) cambios += 1;
          }
        });
      } catch (err) {
        if (err instanceof CuadranteRechazado) {
          return reply
            .code(400)
            .send({ error: "CUADRANTE_RECHAZADO", message: err.message });
        }
        throw err;
      }

      // Y se devuelve el cuadrante entero recalculado, no un «ok»: la
      // pantalla tiene que repintar los avisos del mes después de cada
      // toque, y pedirlos aparte abriría la ventana en la que la rejilla y
      // los avisos no coinciden.
      const cargado = await cargarCuadrante(auth.tenantId, month, prisma);
      return {
        cambiosRegistrados: cambios,
        cabecera: cargado.cabecera,
        celdas: cargado.cuadrante.celdas,
        avisos: cargado.avisos,
        resumen: cargado.resumen,
      };
    },
  );

  /**
   * Copiar una semana sobre otra.
   *
   * Vive en el servidor y no en la pantalla por una razón medida: copiar
   * siete días de 21 personas son 147 celdas, y el cliente tendría que
   * mandarlas todas después de calcular qué va en cada una. Aquí es una
   * petición, y el cálculo lo hace quien ya tiene los datos.
   *
   * Es idempotente por `set_staff_schedule_day`: copiar dos veces la misma
   * semana no escribe nada la segunda, ni en el registro de cambios.
   */
  app.post(
    "/admin/fichaje/cuadrante/:month/copiar-semana",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["month"],
          additionalProperties: false,
          properties: { month: { type: "string", pattern: MES } },
        },
        body: {
          type: "object",
          required: ["desde", "hasta"],
          additionalProperties: false,
          properties: {
            /** Primer día de la semana que se copia. */
            desde: { type: "string", pattern: DIA },
            /** Y primer día de la semana donde se pega. */
            hasta: { type: "string", pattern: DIA },
            dias: { type: "integer", minimum: 1, maximum: 31 },
            motivo: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { month } = request.params as { month: string };
      const body = request.body as {
        desde: string;
        hasta: string;
        dias?: number;
        motivo?: string;
      };
      const cuantos = body.dias ?? 7;
      const prisma = getPrisma();

      const cabecera = await asegurarCuadrante(
        auth.tenantId,
        month,
        auth.userId,
        prisma,
      );
      const autor =
        cabecera.state === "PUBLICADO"
          ? await autorDe(prisma, auth.userId)
          : null;

      // Lo que hay en la semana de origen. Puede estar en OTRO cuadrante
      // —copiar la última semana de octubre sobre la primera de
      // noviembre— así que se busca por día y no por `scheduleId`.
      const dias = Array.from({ length: cuantos }, (_, i) => ({
        de: sumarDias(body.desde, i),
        a: sumarDias(body.hasta, i),
      }));
      const origen = await prisma.staffScheduleCell.findMany({
        where: {
          tenantId: auth.tenantId,
          day: { in: dias.map((d) => new Date(`${d.de}T12:00:00Z`)) },
        },
        select: {
          employeeId: true,
          day: true,
          centerShiftId: true,
          absenceKind: true,
        },
      });
      // Agrupado por (persona, día de destino), que es la unidad que
      // `set_staff_schedule_day` sustituye.
      const porDestino = new Map<
        string,
        { employeeId: string; dia: string; turnoIds: string[]; ausencia: string | null }
      >();
      const destinoDe = new Map(dias.map((d) => [d.de, d.a]));
      // Todas las personas de alta y todos los días de destino, para que
      // copiar una semana en la que alguien libraba **borre** lo que
      // hubiera en el destino. Sin esto, copiar sería «añadir» y la
      // segunda copia dejaría dos turnos donde había uno.
      const activos = await prisma.employee.findMany({
        where: { tenantId: auth.tenantId, active: true },
        select: { id: true },
      });
      for (const d of dias) {
        // Sólo los días del mes del cuadrante: la función rechaza los
        // demás, y mandárselos sería pedirle que reviente.
        if (d.a.slice(0, 7) !== month) continue;
        for (const e of activos) {
          porDestino.set(`${e.id}|${d.a}`, {
            employeeId: e.id,
            dia: d.a,
            turnoIds: [],
            ausencia: null,
          });
        }
      }
      for (const c of origen) {
        const dia = c.day.toISOString().slice(0, 10);
        const destino = destinoDe.get(dia);
        if (destino == null || destino.slice(0, 7) !== month) continue;
        const clave = `${c.employeeId}|${destino}`;
        const ya = porDestino.get(clave);
        if (!ya) continue;
        if (c.absenceKind != null) ya.ausencia = c.absenceKind;
        else if (c.centerShiftId != null) ya.turnoIds.push(c.centerShiftId);
      }

      let cambios = 0;
      try {
        await prisma.$transaction(async (tx) => {
          for (const celda of porDestino.values()) {
            const id = await ponerCelda(tx, {
              scheduleId: cabecera.id,
              employeeId: celda.employeeId,
              dia: celda.dia,
              turnoIds: celda.turnoIds,
              ausencia: celda.ausencia,
              motivo: body.motivo ?? null,
              autor,
              autorUserId: auth.userId,
            });
            if (id != null) cambios += 1;
          }
        });
      } catch (err) {
        if (err instanceof CuadranteRechazado) {
          return reply
            .code(400)
            .send({ error: "CUADRANTE_RECHAZADO", message: err.message });
        }
        throw err;
      }

      const cargado = await cargarCuadrante(auth.tenantId, month, prisma);
      return {
        celdasTocadas: porDestino.size,
        cambiosRegistrados: cambios,
        cabecera: cargado.cabecera,
        celdas: cargado.cuadrante.celdas,
        avisos: cargado.avisos,
        resumen: cargado.resumen,
      };
    },
  );

  /**
   * Publicar.
   *
   * **Los avisos no bloquean** (decisión 7): publicar con avisos pide
   * `confirmarAvisos: true` y los deja apuntados en la cabecera, con su
   * cuenta y su lista. Sin la confirmación, 409 con el resumen dentro para
   * que la pantalla pueda preguntar.
   *
   * Un cuadrante con un hueco real publicado es mejor que un cuadrante
   * perfecto que nadie ve: el hueco se cubre llamando a alguien.
   */
  app.post(
    "/admin/fichaje/cuadrante/:month/publicar",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["month"],
          additionalProperties: false,
          properties: { month: { type: "string", pattern: MES } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { confirmarAvisos: { type: "boolean" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { month } = request.params as { month: string };
      const { confirmarAvisos } = (request.body ?? {}) as {
        confirmarAvisos?: boolean;
      };
      const prisma = getPrisma();
      const cabecera = await asegurarCuadrante(
        auth.tenantId,
        month,
        auth.userId,
        prisma,
      );
      if (cabecera.state === "PUBLICADO") {
        return reply.code(409).send({
          error: "CUADRANTE_YA_PUBLICADO",
          message:
            "Este cuadrante ya está publicado. Los cambios se hacen sobre él, y quedan registrados con quién, cuándo y por qué.",
        });
      }

      const cargado = await cargarCuadrante(auth.tenantId, month, prisma);
      const resumen = resumenDeAvisos(cargado.avisos);
      if (resumen.total > 0 && confirmarAvisos !== true) {
        return reply.code(409).send({
          error: "CUADRANTE_CON_AVISOS",
          message:
            resumen.rojos > 0
              ? `Este cuadrante tiene ${resumen.rojos} aviso(s) que incumplen una norma y ${resumen.ambares} más. Puedes publicarlo igual, pero quedará apuntado.`
              : `Este cuadrante tiene ${resumen.total} aviso(s). Puedes publicarlo igual, pero quedará apuntado.`,
          resumen,
          avisos: cargado.avisos,
        });
      }

      const autor = await autorDe(prisma, auth.userId);
      const publicado = await prisma.staffSchedule.update({
        where: { id: cabecera.id },
        data: {
          state: "PUBLICADO",
          publishedAt: new Date(),
          publishedByUserId: auth.userId,
          publishedBy: autor,
          warningsAtPublish: resumen.total,
          // La LISTA, no sólo la cuenta: a los seis meses, «¿se publicó
          // sabiendo que el sábado faltaba una auxiliar?» se contesta
          // mirando esto.
          warningsSnapshot: cargado.avisos as unknown as object,
        },
        select: {
          id: true,
          month: true,
          state: true,
          publishedAt: true,
          publishedBy: true,
          warningsAtPublish: true,
        },
      });
      return reply.code(200).send({
        cabecera: {
          ...publicado,
          publishedAt: publicado.publishedAt?.toISOString() ?? null,
        },
        resumen,
      });
    },
  );

  /** El registro de cambios de un cuadrante publicado. Append-only. */
  app.get(
    "/admin/fichaje/cuadrante/:month/cambios",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["month"],
          additionalProperties: false,
          properties: { month: { type: "string", pattern: MES } },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const { month } = request.params as { month: string };
      const prisma = getPrisma();
      const cabecera = await prisma.staffSchedule.findUnique({
        where: { tenantId_month: { tenantId: auth.tenantId, month } },
        select: { id: true },
      });
      if (!cabecera) return { cambios: [] };
      const cambios = await prisma.staffScheduleChange.findMany({
        where: { scheduleId: cabecera.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          employeeId: true,
          day: true,
          beforeLabel: true,
          afterLabel: true,
          reason: true,
          author: true,
          createdAt: true,
          employee: { select: { name: true, lastName: true } },
        },
      });
      return {
        cambios: cambios.map((c) => ({
          id: c.id,
          employeeId: c.employeeId,
          employeeName: c.employee.lastName
            ? `${c.employee.name} ${c.employee.lastName}`
            : c.employee.name,
          dia: c.day.toISOString().slice(0, 10),
          antes: c.beforeLabel,
          despues: c.afterLabel,
          motivo: c.reason,
          autor: c.author,
          cuando: c.createdAt.toISOString(),
        })),
      };
    },
  );
}

/** «2026-11-02» + 3 → «2026-11-05». Aritmética de CALENDARIO. */
function sumarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}
