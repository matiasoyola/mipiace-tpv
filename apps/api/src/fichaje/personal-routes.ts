// personal-1 · LA API DE LA FICHA DE PERSONAL Y DE LA IMPORTACIÓN.
//
// Mismo guardia que el resto del módulo: `requireOwnerOrManager` +
// `ensureFichajeEnabled`, y `ensureCajaEnabled` en NINGUNA. El cliente
// cero del fichaje es un colegio con `caja_enabled = false`.
//
// Y una puerta más que las de F1, que es la razón de que estas rutas estén
// en su propio fichero: **aquí se descifra**. El DNI y el nº de afiliación
// de la plantilla sólo salen por `GET /admin/fichaje/employees/:id`, que
// es una ruta por persona y con nombre propio. La LISTA no los trae — ni
// descifra nada, porque contar lo que falta no necesita el valor.
//
// No hay DELETE de una ficha. La baja DESACTIVA (F1), y el trigger
// `employees_delete_guard` lo impide aunque alguien lo añadiera.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  CsvDePersonalInvalido,
  MAX_FILAS_CSV,
  estadoDeLaFichaDePersonal,
  leerCsvDePersonal,
  planDeImportacion,
  planParaLaPantalla,
  type AccionDeImportacion,
  type CategoriaConocida,
} from "@mipiacetpv/cuadrante";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureFichajeEnabled } from "../lib/fichaje-gate.js";
import { sembrarCategoriasSiHaceFalta } from "./cuadrante.js";
import {
  FICHA_SELECT,
  FaltaLaClaveDelCifrado,
  datosDeFicha,
  dekParaLeer,
  fichaDeEmpleado,
  fechaIso,
  nombreCompleto,
  paraCasar,
  paraCompletar,
  resumenDePersonal,
  type CambiosDeFicha,
  type FilaDeFicha,
} from "./personal.js";
import { localDate } from "./time.js";

/** Lo que una ficha acepta por el PATCH. El cuerpo entero es opcional. */
const CUERPO_DE_FICHA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    // `nullable` en los demás: `null` BORRA, y hace falta poder borrar un
    // teléfono mal tecleado. `undefined` (la propiedad ausente) no toca.
    lastName: { type: ["string", "null"], maxLength: 160 },
    dni: { type: ["string", "null"], maxLength: 32 },
    afiliacion: { type: ["string", "null"], maxLength: 32 },
    categoryId: { type: ["string", "null"], format: "uuid" },
    // En HORAS, que es lo que la pantalla pide. Se guardan minutos.
    weeklyHours: { type: ["number", "null"], minimum: 0.25, maximum: 60 },
    contractKind: { type: ["string", "null"], enum: ["INDEFINIDO", "TEMPORAL", null] },
    hiredOn: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    contractEndsOn: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    phone: { type: ["string", "null"], maxLength: 40 },
    email: { type: ["string", "null"], maxLength: 200 },
  },
} as const;

interface CuerpoDeFicha {
  name?: string;
  lastName?: string | null;
  dni?: string | null;
  afiliacion?: string | null;
  categoryId?: string | null;
  weeklyHours?: number | null;
  contractKind?: "INDEFINIDO" | "TEMPORAL" | null;
  hiredOn?: string | null;
  contractEndsOn?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Horas → minutos. 37,5 → 2 250. */
function minutosDeHoras(h: number | null | undefined): number | null | undefined {
  if (h === undefined) return undefined;
  if (h === null) return null;
  return Math.round(h * 60);
}

function cambiosDe(body: CuerpoDeFicha): CambiosDeFicha {
  const c: CambiosDeFicha = {};
  if (body.name !== undefined) c.name = body.name;
  if (body.lastName !== undefined) c.lastName = body.lastName;
  if (body.dni !== undefined) c.dni = body.dni;
  if (body.afiliacion !== undefined) c.afiliacion = body.afiliacion;
  if (body.categoryId !== undefined) c.categoryId = body.categoryId;
  if (body.weeklyHours !== undefined) {
    c.weeklyMinutes = minutosDeHoras(body.weeklyHours) ?? null;
  }
  if (body.contractKind !== undefined) c.contractKind = body.contractKind;
  if (body.hiredOn !== undefined) c.hiredOn = body.hiredOn;
  if (body.contractEndsOn !== undefined) c.contractEndsOn = body.contractEndsOn;
  if (body.phone !== undefined) c.phone = body.phone;
  if (body.email !== undefined) c.email = body.email;
  return c;
}

/**
 * Los CHECK de la base, dichos con una frase.
 *
 * La base los defiende igual (`employees_fin_solo_temporales`,
 * `employees_fin_despues_del_alta`) y ésa es la garantía; esto es para que
 * quien rellena la ficha lea qué pasa en vez de un 500 de Postgres. Las
 * dos mitades hacen falta: la de abajo es la última línea.
 */
function problemaDeCoherencia(
  ficha: { contractKind: string | null; hiredOn: string | null; contractEndsOn: string | null },
): string | null {
  if (
    ficha.contractEndsOn != null &&
    ficha.contractKind != null &&
    ficha.contractKind !== "TEMPORAL"
  ) {
    return "La fecha de fin prevista es sólo de los contratos temporales. Cambia el tipo de contrato o quita la fecha.";
  }
  if (
    ficha.contractEndsOn != null &&
    ficha.hiredOn != null &&
    ficha.contractEndsOn < ficha.hiredOn
  ) {
    return "La fecha de fin es anterior a la de alta.";
  }
  return null;
}

export async function registerPersonalRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [requireOwnerOrManager, ensureFichajeEnabled] };

  // ── el catálogo de categorías ──────────────────────────────────────

  app.get("/admin/fichaje/categorias", guard, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    // Se siembra al PEDIRLO por primera vez, no al encender el módulo:
    // mismo criterio que `asegurarDek`. Ver `sembrarCategoriasSiHaceFalta`.
    await sembrarCategoriasSiHaceFalta(auth.tenantId, prisma);
    const categorias = await prisma.employeeCategory.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        countsAsDirectCare: true,
        isStandard: true,
        active: true,
        sortOrder: true,
        _count: { select: { employees: true } },
      },
    });
    return {
      categorias: categorias.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        countsAsDirectCare: c.countsAsDirectCare,
        isStandard: c.isStandard,
        active: c.active,
        sortOrder: c.sortOrder,
        // «¿Puedo borrar ésta?» es la pregunta de esa pantalla, y va
        // contestada: con gente dentro, el `RESTRICT` de la base dice no.
        employees: c._count.employees,
      })),
    };
  });

  app.post(
    "/admin/fichaje/categorias",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            code: { type: "string", minLength: 1, maxLength: 32 },
            name: { type: "string", minLength: 1, maxLength: 80 },
            countsAsDirectCare: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        code?: string;
        name: string;
        countsAsDirectCare?: boolean;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const name = body.name.trim();
      // El código se normaliza si no viene: lo que el centro escribe es un
      // nombre, y pedirle además un código sería pedirle dos cosas para
      // una. Mismo criterio que `POST /residencia/roles`.
      const code = (body.code ?? name)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/(^_|_$)/g, "")
        .slice(0, 32);
      if (code === "") {
        return reply.code(400).send({
          error: "CATEGORIA_SIN_CODIGO",
          message: "Ese nombre no deja un código utilizable. Escribe uno a mano.",
        });
      }
      const repetida = await prisma.employeeCategory.findFirst({
        where: { tenantId: auth.tenantId, code },
        select: { id: true, name: true },
      });
      if (repetida) {
        return reply.code(409).send({
          error: "CATEGORIA_REPETIDA",
          message: `Ya hay una categoría con el código «${code}» («${repetida.name}»).`,
        });
      }
      const categoria = await prisma.employeeCategory.create({
        data: {
          tenantId: auth.tenantId,
          code,
          name,
          countsAsDirectCare: body.countsAsDirectCare ?? false,
          sortOrder: body.sortOrder ?? 500,
        },
        select: { id: true, code: true, name: true, countsAsDirectCare: true },
      });
      return reply.code(201).send({ categoria });
    },
  );

  app.patch(
    "/admin/fichaje/categorias/:id",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            // **Editable, también en las de serie.** Al revés que la
            // categoría de un rol de cuidado, que un trigger congela: qué
            // cuenta como atención directa lo dice la acreditación de cada
            // centro, no nosotros.
            countsAsDirectCare: { type: "boolean" },
            active: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const prisma = getPrisma();
      const categoria = await prisma.employeeCategory.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!categoria) {
        return reply.code(404).send({
          error: "CATEGORIA_NO_ENCONTRADA",
          message: "Esa categoría no es de esta empresa.",
        });
      }
      const data: Record<string, unknown> = {};
      if (typeof body.name === "string") data.name = body.name.trim();
      if (typeof body.countsAsDirectCare === "boolean") {
        data.countsAsDirectCare = body.countsAsDirectCare;
      }
      if (typeof body.active === "boolean") data.active = body.active;
      if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
      const actualizada = await prisma.employeeCategory.update({
        where: { id },
        data,
        select: {
          id: true,
          code: true,
          name: true,
          countsAsDirectCare: true,
          active: true,
        },
      });
      return { categoria: actualizada };
    },
  );

  app.delete(
    "/admin/fichaje/categorias/:id",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const categoria = await prisma.employeeCategory.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, name: true, _count: { select: { employees: true } } },
      });
      if (!categoria) {
        return reply.code(404).send({
          error: "CATEGORIA_NO_ENCONTRADA",
          message: "Esa categoría no es de esta empresa.",
        });
      }
      // La garantía la da el `RESTRICT` de la base; esto es la frase.
      if (categoria._count.employees > 0) {
        return reply.code(409).send({
          error: "CATEGORIA_CON_GENTE",
          message: `«${categoria.name}» la llevan ${categoria._count.employees} persona(s). Desactívala en vez de borrarla: las fichas que ya la tienen seguirían apuntando a ella.`,
        });
      }
      await prisma.employeeCategory.delete({ where: { id } });
      return { borrada: true };
    },
  );

  // ── la plantilla, con lo que le falta a cada ficha ─────────────────

  app.get("/admin/fichaje/personal", guard, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const [filas, categorias] = await Promise.all([
      prisma.employee.findMany({
        where: { tenantId: auth.tenantId },
        select: FICHA_SELECT,
        orderBy: [{ active: "desc" }, { lastName: "asc" }, { name: "asc" }],
      }),
      prisma.employeeCategory.findMany({
        where: { tenantId: auth.tenantId },
        select: { id: true, code: true, name: true, countsAsDirectCare: true },
        orderBy: [{ sortOrder: "asc" }],
      }),
    ]);
    const hoy = localDate(new Date());
    const porId = new Map(categorias.map((c) => [c.id, c]));
    return {
      // **Ni un DNI en esta respuesta, y ni una clave tocada**: contar lo
      // que falta se hace sobre `dni_cifrado IS NULL`, no sobre el valor.
      // Es la frontera de alta-minima (decisión 8) aplicada al personal.
      personal: (filas as FilaDeFicha[]).map((f) => ({
        id: f.id,
        name: f.name,
        lastName: f.lastName,
        nombreCompleto: nombreCompleto(f),
        categoryId: f.categoryId,
        categoria: f.categoryId == null ? null : (porId.get(f.categoryId)?.name ?? null),
        atencionDirecta:
          f.categoryId != null &&
          porId.get(f.categoryId)?.countsAsDirectCare === true,
        weeklyMinutes: f.weeklyMinutes,
        contractKind: f.contractKind,
        hiredOn: fechaIso(f.hiredOn),
        contractEndsOn: fechaIso(f.contractEndsOn),
        phone: f.phone,
        email: f.email,
        active: f.active,
        tieneDni: f.dniCifrado != null,
        tieneAfiliacion: f.nssCifrado != null,
        faltan: estadoDeLaFichaDePersonal(paraCompletar(f)),
      })),
      categorias,
      resumen: resumenDePersonal(filas as FilaDeFicha[], hoy),
    };
  });

  app.get(
    "/admin/fichaje/personal/:id",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const fila = (await prisma.employee.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: FICHA_SELECT,
      })) as FilaDeFicha | null;
      if (!fila) {
        return reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: "Ese empleado no existe" });
      }
      // **AQUÍ se descifra, y sólo aquí.** `dekONada` y no `asegurarDek`:
      // una lectura no crea claves.
      const dek = await dekParaLeer(auth.tenantId, prisma);
      const ficha = await fichaDeEmpleado(fila, dek);

      // Y lo que la ficha ENSEÑA de las otras dos «personas» cuando están
      // vinculadas (decisión 1). Se enseña, no se mueve: los roles de
      // cuidado siguen siendo de residencia y el perfil de agenda de la
      // agenda.
      const vinculo =
        fila.userId == null
          ? null
          : await vinculoDelUsuario(prisma, auth.tenantId, fila.userId);

      return { ficha, vinculo };
    },
  );

  app.patch(
    "/admin/fichaje/personal/:id",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: CUERPO_DE_FICHA,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as CuerpoDeFicha;
      const prisma = getPrisma();
      const fila = (await prisma.employee.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: FICHA_SELECT,
      })) as FilaDeFicha | null;
      if (!fila) {
        return reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: "Ese empleado no existe" });
      }

      // La categoría tiene que ser de ESTE tenant. Sin esto, el panel de
      // una empresa podría poner a su gente una categoría de otra.
      if (body.categoryId) {
        const cat = await prisma.employeeCategory.findFirst({
          where: { id: body.categoryId, tenantId: auth.tenantId },
          select: { id: true },
        });
        if (!cat) {
          return reply.code(404).send({
            error: "CATEGORIA_NO_ENCONTRADA",
            message: "Esa categoría no es de esta empresa.",
          });
        }
      }

      const cambios = cambiosDe(body);
      const problema = problemaDeCoherencia({
        contractKind:
          cambios.contractKind !== undefined
            ? cambios.contractKind
            : fila.contractKind,
        hiredOn:
          cambios.hiredOn !== undefined ? cambios.hiredOn : fechaIso(fila.hiredOn),
        contractEndsOn:
          cambios.contractEndsOn !== undefined
            ? cambios.contractEndsOn
            : fechaIso(fila.contractEndsOn),
      });
      if (problema) {
        return reply
          .code(400)
          .send({ error: "FICHA_INCOHERENTE", message: problema });
      }

      let data: Record<string, unknown>;
      try {
        data = await datosDeFicha(prisma, { id: fila.id, tenantId: fila.tenantId }, cambios);
      } catch (err) {
        if (err instanceof FaltaLaClaveDelCifrado) {
          return reply
            .code(503)
            .send({ error: "CIFRADO_NO_DISPONIBLE", message: err.message });
        }
        throw err;
      }
      await prisma.employee.update({ where: { id }, data });
      const fresca = (await prisma.employee.findUniqueOrThrow({
        where: { id },
        select: FICHA_SELECT,
      })) as FilaDeFicha;
      const dek = await dekParaLeer(auth.tenantId, prisma);
      return { ficha: await fichaDeEmpleado(fresca, dek) };
    },
  );

  // ── la importación CSV ─────────────────────────────────────────────
  //
  // Dos rutas y el mismo cálculo: la vista previa devuelve el plan y
  // «aplicar» lo ejecuta. El cliente manda el MISMO texto las dos veces y
  // el servidor vuelve a planificar — no se guarda el plan entre las dos
  // llamadas.
  //
  // Es a propósito: un plan guardado se queda viejo (alguien da de alta a
  // alguien entre la vista previa y el «aplicar») y entonces la pantalla
  // dice «crea 1» y el servidor crea 2. Volviendo a planificar, lo que se
  // aplica es lo que el fichero dice SOBRE EL ESTADO DE AHORA, y la
  // respuesta devuelve lo que hizo de verdad.

  const CUERPO_DEL_CSV = {
    type: "object",
    required: ["csv"],
    additionalProperties: false,
    properties: {
      // 2 MB de texto. Mil filas de once columnas son ~100 kB; el tope
      // está para que un fichero equivocado no se lea entero en memoria.
      csv: { type: "string", minLength: 1, maxLength: 2_000_000 },
    },
  } as const;

  async function planDe(tenantId: string, csv: string) {
    const prisma = getPrisma();
    await sembrarCategoriasSiHaceFalta(tenantId, prisma);
    const [filas, categorias] = await Promise.all([
      prisma.employee.findMany({ where: { tenantId }, select: FICHA_SELECT }),
      prisma.employeeCategory.findMany({
        where: { tenantId, active: true },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const leido = leerCsvDePersonal(csv);
    return {
      plan: planDeImportacion(
        leido,
        (filas as FilaDeFicha[]).map(paraCasar),
        categorias as CategoriaConocida[],
      ),
      leido,
    };
  }

  app.post(
    "/admin/fichaje/personal/importar/vista-previa",
    { ...guard, schema: { body: CUERPO_DEL_CSV } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { csv } = request.body as { csv: string };
      try {
        const { plan, leido } = await planDe(auth.tenantId, csv);
        return {
          separador: leido.separador,
          columnas: leido.columnas,
          maxFilas: MAX_FILAS_CSV,
          // **Por `planParaLaPantalla`, siempre.** El plan lleva la fila
          // cruda —con el DNI en claro— porque es lo que se aplica; esta
          // ruta no puede devolverla.
          ...planParaLaPantalla(plan),
        };
      } catch (err) {
        if (err instanceof CsvDePersonalInvalido) {
          return reply
            .code(400)
            .send({ error: "CSV_INVALIDO", message: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/admin/fichaje/personal/importar",
    { ...guard, schema: { body: CUERPO_DEL_CSV } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { csv } = request.body as { csv: string };
      const prisma = getPrisma();
      let plan;
      try {
        plan = (await planDe(auth.tenantId, csv)).plan;
      } catch (err) {
        if (err instanceof CsvDePersonalInvalido) {
          return reply
            .code(400)
            .send({ error: "CSV_INVALIDO", message: err.message });
        }
        throw err;
      }

      let creadas = 0;
      let completadas = 0;
      let sinCambios = 0;
      try {
        // Una transacción para el lote entero: veintiuna fichas a medio
        // importar es el estado del que después nadie se fía. O entran
        // todas las filas buenas, o ninguna.
        await prisma.$transaction(async (tx) => {
          for (const accion of plan.acciones) {
            if (accion.que === "ERROR") continue;
            if (accion.que === "SIN_CAMBIOS") {
              sinCambios += 1;
              continue;
            }
            const cambios = cambiosDeLaAccion(accion);
            if (accion.que === "CREAR") {
              const creada = await tx.employee.create({
                data: { tenantId: auth.tenantId, name: accion.fila.nombre },
                select: { id: true, tenantId: true },
              });
              const data = await datosDeFicha(tx, creada, cambios);
              await tx.employee.update({ where: { id: creada.id }, data });
              creadas += 1;
            } else {
              const data = await datosDeFicha(
                tx,
                { id: accion.employeeId!, tenantId: auth.tenantId },
                cambios,
              );
              await tx.employee.update({ where: { id: accion.employeeId! }, data });
              completadas += 1;
            }
          }
        });
      } catch (err) {
        if (err instanceof FaltaLaClaveDelCifrado) {
          return reply
            .code(503)
            .send({ error: "CIFRADO_NO_DISPONIBLE", message: err.message });
        }
        throw err;
      }

      return reply.code(200).send({
        creadas,
        completadas,
        sinCambios,
        errores: plan.errores,
      });
    },
  );
}

/** Lo que una acción del plan cambia, ya como cambios de ficha. */
function cambiosDeLaAccion(accion: AccionDeImportacion): CambiosDeFicha {
  const f = accion.fila;
  const c: CambiosDeFicha = {};
  // Sólo lo que el plan dijo que cambia. Es lo que hace que «una celda
  // vacía no borra» y que repetir el fichero no escriba nada: la decisión
  // ya está tomada en el paquete puro, y aquí no se vuelve a tomar.
  const cambia = new Set(accion.cambios.map((x) => x.campo));
  if (cambia.has("nombre")) c.name = f.nombre;
  if (cambia.has("apellidos")) c.lastName = f.apellidos ?? null;
  if (cambia.has("dni")) c.dni = f.dniNie ?? null;
  if (cambia.has("afiliacion")) c.afiliacion = f.afiliacion ?? null;
  if (cambia.has("categoria")) c.categoryId = accion.categoryId ?? null;
  if (cambia.has("jornadaSemanal")) c.weeklyMinutes = f.minutosSemanales ?? null;
  if (cambia.has("fechaDeAlta")) c.hiredOn = f.fechaDeAlta ?? null;
  if (cambia.has("tipoDeContrato")) c.contractKind = f.tipoDeContrato ?? null;
  if (cambia.has("finPrevisto")) c.contractEndsOn = f.fechaDeFin ?? null;
  if (cambia.has("telefono")) c.phone = f.telefono ?? null;
  if (cambia.has("email")) c.email = f.email ?? null;
  return c;
}

/**
 * Lo que la ficha ENSEÑA de las otras dos «personas» del sistema cuando
 * hay `userId` (decisión 1).
 *
 * Se enseña y **no se mueve**: los roles de cuidado siguen colgando de
 * `users` y siendo de residencia, y el perfil de agenda siendo de la
 * agenda. Aquí sólo se leen para que quien abre la ficha de Ana vea que
 * además es auxiliar con rol de cuidado vigente y que atiende citas.
 *
 * Y si al leerlo resulta que vincular no basta y hay que fusionar algo, el
 * prompt dice que **no se haga en este bloque**. No se ha hecho: ver el
 * done.
 */
async function vinculoDelUsuario(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  userId: string,
): Promise<{
  userId: string;
  nombre: string | null;
  rol: string | null;
  rolesDeCuidado: Array<{ code: string; name: string; desde: string }>;
  perfilDeAgenda: { displayName: string; active: boolean } | null;
}> {
  const [user, roles, perfil] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, tenantId },
      // `alias` y no `displayName`: el nombre visible de un usuario es el
      // alias desde v1.7-alias-cajeros, con la local-part del email de
      // respaldo. Es lo que el TPV, el ticket y el admin pintan.
      select: { id: true, alias: true, email: true, role: true },
    }),
    prisma.careRoleAssignment.findMany({
      where: { tenantId, userId, revokedAt: null },
      select: {
        fromAt: true,
        careRole: { select: { code: true, name: true } },
      },
      orderBy: { fromAt: "desc" },
    }),
    prisma.staffProfile.findFirst({
      where: { userId, tenantId },
      select: { displayName: true, active: true },
    }),
  ]);
  return {
    userId,
    nombre: user?.alias ?? user?.email?.split("@")[0] ?? null,
    rol: user?.role ?? null,
    rolesDeCuidado: roles.map((r) => ({
      code: r.careRole.code,
      name: r.careRole.name,
      desde: r.fromAt.toISOString().slice(0, 10),
    })),
    perfilDeAgenda: perfil ?? null,
  };
}
