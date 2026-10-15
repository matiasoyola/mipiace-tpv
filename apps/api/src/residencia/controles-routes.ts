// residencia-2 · EL CATÁLOGO DE CONTROLES, los ajustes del centro y los
// momentos del día.
//
// Lo que estas rutas sirven es **la frontera estándar / centro** (rama de
// controles §10) hecha HTTP:
//
//   · `GET  /residencia/controles`            — el catálogo vigente (de
//     serie + propios del centro) ya cruzado con los ajustes del centro,
//     agrupado por capas y con lo que el centro PUEDE elegir en cada uno.
//   · `PATCH /residencia/controles/:code`     — lo que el centro decide.
//     Si manda un campo del producto, 400.
//   · `POST /residencia/controles`            — crear uno PROPIO.
//   · `POST /residencia/controles/:code/versiones` — publicar la versión
//     siguiente de uno propio. De los de serie no: ésos vienen del
//     fichero del repo (está declarado fuera de alcance).
//   · `GET  /residencia/momentos` y `PATCH /residencia/momentos/:code`
//     — las horas del desayuno, la comida, la merienda, la cena y la
//     noche.
//
// ── Los permisos, y por qué `requireOwner` para escribir ─────────────
//
// Alcance §7: catálogo, ajustes del centro y plantillas son
// `requireOwner`. Es el mismo criterio exacto que residencia-1 aplicó a
// roles y zonas (decisión 6 de su done): **esto decide qué se registra de
// la salud de una persona**, y de ello cuelga lo que la auditoría de AENOR
// va a contar. El encargado LEE (`requireOwnerOrManager`), igual que lee
// los roles de cuidado.
//
// Y no pasa por `conHistoria`: lo que estas rutas devuelven es el
// CATÁLOGO del centro, no la salud de nadie. No hay ni un `clientId` en
// ninguna respuesta. Es la decisión 2 de residencia-1 aplicada aquí.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  CareFrequencyKind,
  ControlLayer,
  ControlNature,
  ControlValueDomain,
} from "@mipiacetpv/db";
import { problemaDeFrecuencia, type Frecuencia } from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { ensureResidenciaEnabled } from "./gate.js";
import {
  FRECUENCIA_DEFAULT_SELECT,
  FRECUENCIA_SELECT,
  aColumnas,
  aColumnasDefault,
  deColumnas,
  deColumnasDefault,
} from "./frecuencia-columnas.js";

const PUERTAS_LECTURA = [
  requireOwnerOrManager,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];
const PUERTAS_ESCRITURA = [requireOwner, ensureClinicaEnabled, ensureResidenciaEnabled];

const HORA = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

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

// Lo que un CONTROL PROPIO del centro puede ser. `SCALE` y `SCORE` son
// Fase 2 (una escala validada lleva su algoritmo detrás) y `EVENT` /
// `DERIVED` los genera el sistema en residencia-4: un centro que se
// inventara una «escala propia» tendría un control que la puerta no sabría
// pintar ni puntuar.
const CAPAS_PROPIAS = ["EXEC", "OBS", "MEASURE"] as const;
const DOMINIOS_PROPIOS = ["BOOL", "ORDINAL", "NUMERIC", "TEXT_SHORT"] as const;
const NATURALEZAS = ["SCHEDULED", "ON_DEMAND"] as const;

/**
 * El esquema de una frecuencia en el cuerpo de una petición.
 *
 * `additionalProperties: false` y nada más: la coherencia entre el `kind` y
 * sus parámetros la juzga `problemaDeFrecuencia` —el mismo juicio que el
 * CHECK de la base— porque un esquema JSON no sabe decir «si el `kind` es
 * `MONTHLY`, `monthDay` es obligatorio y `weekdays` tiene que estar
 * vacío». Y porque de ahí sale una frase en castellano en vez de un
 * «body/frequency debe coincidir con exactamente un esquema de oneOf».
 */
const FRECUENCIA_SCHEMA = {
  type: "object",
  required: ["kind"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: FRECUENCIAS as unknown as string[] },
    everyNHours: { type: "integer", minimum: 1, maximum: 12 },
    everyNDays: { type: "integer", minimum: 1, maximum: 365 },
    weekdays: {
      type: "array",
      items: { type: "integer", minimum: 1, maximum: 7 },
      maxItems: 7,
    },
    monthDay: { type: "integer", minimum: 1, maximum: 28 },
    shiftCodes: { type: "array", items: { type: "string", maxLength: 8 }, maxItems: 12 },
    momentCodes: { type: "array", items: { type: "string", maxLength: 24 }, maxItems: 12 },
  },
} as const;

const CONTROL_SELECT = {
  id: true,
  scope: true,
  code: true,
  version: true,
  name: true,
  layer: true,
  nature: true,
  valueDomain: true,
  unit: true,
  inputMin: true,
  inputMax: true,
  refMin: true,
  refMax: true,
  groupCode: true,
  allowedFrequencies: true,
  allowedCareRoleCodes: true,
  ...FRECUENCIA_DEFAULT_SELECT,
  isoIndicatorCode: true,
  familyVisibleDefault: true,
  sortOrder: true,
  validFrom: true,
  options: {
    select: { code: true, label: true, sortOrder: true, isAsUsual: true },
    orderBy: { sortOrder: "asc" },
  },
} as const;

const AJUSTE_SELECT = {
  id: true,
  controlCode: true,
  active: true,
  alias: true,
  ...FRECUENCIA_SELECT,
  careRoleCodes: true,
  familyVisible: true,
  reconductedAt: true,
  reconductedFromVersion: true,
  reconductedReason: true,
} as const;

/** Los decimales de Prisma salen como `Decimal`; la pantalla quiere números. */
function num(d: unknown): number | null {
  if (d === null || d === undefined) return null;
  return Number(d);
}

/**
 * Las versiones VIGENTES que este centro ve: las de serie (globales) más
 * las propias del centro.
 *
 * Un `OR` y no dos consultas porque la pantalla las pinta juntas y
 * ordenadas por capa: con dos consultas habría que entrelazarlas en
 * memoria y el `sortOrder` de un control propio no sabría dónde caer.
 */
async function catalogoVigente(tenantId: string) {
  return getPrisma().controlType.findMany({
    where: {
      supersededAt: null,
      OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
    },
    orderBy: [{ layer: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    select: CONTROL_SELECT,
  });
}

export async function registerResidenciaControlesRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── EL CATÁLOGO, ya cruzado con los ajustes del centro ────────────
  //
  // Una sola llamada devuelve todo lo que la pantalla de Controles
  // necesita: el control, lo que el centro decidió de él y **qué puede
  // elegir**. Lo último es la mitad del trabajo de esta ruta: sin
  // `puedeElegir`, la pantalla tendría que saberse la frontera de memoria
  // y acabaría ofreciendo una frecuencia que el servidor rechaza.
  app.get(
    "/residencia/controles",
    { preHandler: PUERTAS_LECTURA },
    async (request: FastifyRequest) => {
      const tenantId = request.auth!.tenantId;
      const prisma = getPrisma();

      const [controles, ajustes, turnos, momentos, roles] = await Promise.all([
        catalogoVigente(tenantId),
        prisma.centerControlSetting.findMany({
          where: { tenantId },
          select: AJUSTE_SELECT,
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
        // Sólo los roles que REGISTRAN y están activos: ofrecer
        // «administración» como quien registra la medicación sería ofrecer
        // algo que la puerta de residencia-3 no va a permitir.
        prisma.careRole.findMany({
          where: { tenantId, active: true, recordsCare: true },
          orderBy: [{ sortOrder: "asc" }],
          select: { code: true, name: true, category: true },
        }),
      ]);

      const porCodigo = new Map(ajustes.map((a) => [a.controlCode, a]));

      return {
        controles: controles.map((c) => {
          const ajuste = porCodigo.get(c.code) ?? null;
          return {
            id: c.id,
            scope: c.scope,
            code: c.code,
            version: c.version,
            name: c.name,
            layer: c.layer,
            nature: c.nature,
            valueDomain: c.valueDomain,
            unit: c.unit,
            inputMin: num(c.inputMin),
            inputMax: num(c.inputMax),
            refMin: num(c.refMin),
            refMax: num(c.refMax),
            groupCode: c.groupCode,
            isoIndicatorCode: c.isoIndicatorCode,
            sortOrder: c.sortOrder,
            validFrom: c.validFrom.toISOString(),
            opciones: c.options.map((o) => ({
              code: o.code,
              label: o.label,
              comoSiempre: o.isAsUsual,
            })),
            // ── Lo que el centro PUEDE elegir ───────────────────────
            //
            // Va en la respuesta y no en la pantalla porque la frontera es
            // del producto: el día que una guía retire una frecuencia, la
            // pantalla deja de ofrecerla sin desplegar el panel.
            puedeElegir: {
              frecuencias: c.allowedFrequencies,
              roles: c.allowedCareRoleCodes,
            },
            // ── Lo que el centro DECIDIÓ ────────────────────────────
            ajuste: ajuste
              ? {
                  active: ajuste.active,
                  alias: ajuste.alias,
                  frecuencia: deColumnas(ajuste),
                  careRoleCodes: ajuste.careRoleCodes,
                  familyVisible: ajuste.familyVisible,
                  // La reconducción, para que el panel la diga. Ver la
                  // cabecera de `CenterControlSetting`: reconducir en
                  // silencio es cambiar el plan de 49 personas sin
                  // decírselo a nadie.
                  reconducido: ajuste.reconductedAt
                    ? {
                        cuando: ajuste.reconductedAt.toISOString(),
                        desdeVersion: ajuste.reconductedFromVersion,
                        motivo: ajuste.reconductedReason,
                      }
                    : null,
                }
              : null,
            // La de serie, para el botón de «volver a la de serie» y para
            // que la pantalla pueda decir «lo has cambiado».
            frecuenciaDeSerie: deColumnasDefault(c),
          };
        }),
        turnos,
        momentos,
        roles,
      };
    },
  );

  // ── LO QUE EL CENTRO DECIDE ───────────────────────────────────────
  //
  // Cinco campos y ni uno más. Lo del producto —capa, naturaleza, dominio,
  // unidad, rangos, indicador, frecuencias permitidas, roles permitidos—
  // **no está en el esquema del cuerpo**.
  //
  // ── Y `additionalProperties: false` NO basta, otra vez ────────────
  //
  // Fastify configura ajv con `removeAdditional: true` por defecto, así
  // que `additionalProperties: false` **BORRA** la propiedad en vez de
  // quejarse: la ruta contestaría **200 sin hacer nada**. Es exactamente
  // el bug que residencia-1 destapó en el PATCH del super-admin (§1 de su
  // done), y aquí haría más daño: la dirección intenta cambiar el rango
  // de referencia de la temperatura, recibe un 200 y se queda creyendo
  // que lo ha cambiado.
  //
  // Un 400 se ve el primer día; un 200 que no hace nada se descubre en la
  // auditoría. Así que va un `preValidation` que mira el cuerpo CRUDO
  // —antes de que ajv lo pode— y contesta un 400 con el nombre del campo
  // y con qué sí se puede cambiar. Tiene su test, campo por campo.
  app.patch(
    "/residencia/controles/:code",
    {
      preValidation: soloLoDelCentro,
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", minLength: 1, maxLength: 48 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            active: { type: "boolean" },
            // `null` borra el alias y vuelve al nombre del producto.
            alias: { type: ["string", "null"], maxLength: 60 },
            frecuencia: FRECUENCIA_SCHEMA,
            careRoleCodes: {
              type: "array",
              items: { type: "string", maxLength: 32 },
              maxItems: 20,
            },
            familyVisible: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.auth!.tenantId;
      const { code } = request.params as { code: string };
      const body = request.body as {
        active?: boolean;
        alias?: string | null;
        frecuencia?: Frecuencia;
        careRoleCodes?: string[];
        familyVisible?: boolean;
      };
      const prisma = getPrisma();

      // La VERSIÓN VIGENTE del control, que es quien dice qué se permite.
      const control = await prisma.controlType.findFirst({
        where: {
          code,
          supersededAt: null,
          OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }],
        },
        select: {
          code: true,
          version: true,
          allowedFrequencies: true,
          allowedCareRoleCodes: true,
          ...FRECUENCIA_DEFAULT_SELECT,
          familyVisibleDefault: true,
        },
      });
      if (!control) {
        return reply.code(404).send({
          error: "CONTROL_NO_ENCONTRADO",
          message: "No hay ningún control con ese código.",
        });
      }

      // ── La frecuencia: dentro de las permitidas y coherente ───────
      if (body.frecuencia) {
        const problema = problemaDeFrecuencia(body.frecuencia);
        if (problema) {
          return reply.code(400).send({ error: "FRECUENCIA_INCOHERENTE", message: problema });
        }
        if (!control.allowedFrequencies.includes(body.frecuencia.kind)) {
          // Es la frontera, dicha con una frase: el centro elige DENTRO.
          // Una analítica no se hace «cada turno» por mucho que la
          // pantalla lo dejara teclear.
          return reply.code(400).send({
            error: "FRECUENCIA_NO_PERMITIDA",
            message: `Este control no admite esa frecuencia. Las que admite son: ${control.allowedFrequencies.join(", ")}.`,
          });
        }
        const malos = await turnosOMomentosQueNoExisten(tenantId, body.frecuencia);
        if (malos) {
          return reply.code(400).send({ error: "TURNO_O_MOMENTO_DESCONOCIDO", message: malos });
        }
      }

      // ── Los roles: un SUBCONJUNTO de los permitidos ───────────────
      //
      // Se puede estrechar, no ensanchar. Y se comprueba contra las dos
      // cosas: lo que el producto permite y lo que el centro tiene.
      if (body.careRoleCodes) {
        if (body.careRoleCodes.length === 0) {
          return reply.code(400).send({
            error: "SIN_QUIEN_LO_REGISTRE",
            message:
              "Si no lo registra ningún rol, no lo registraría nadie. Desactiva el control en vez de dejarlo sin roles.",
          });
        }
        const sobran = body.careRoleCodes.filter(
          (r) => !control.allowedCareRoleCodes.includes(r),
        );
        if (sobran.length > 0) {
          return reply.code(400).send({
            error: "ROL_NO_PERMITIDO",
            message: `Este control no lo puede registrar ${sobran.join(", ")}. Puedes quitar roles de la lista del producto, no añadir.`,
          });
        }
        // Y que los roles existan en ESTE centro y registren. Es una regla
        // que cruza dos tablas, así que vive aquí y no en un CHECK —igual
        // que el requisito de colegiado de residencia-1.
        const delCentro = await prisma.careRole.findMany({
          where: { tenantId, code: { in: body.careRoleCodes }, active: true, recordsCare: true },
          select: { code: true },
        });
        const faltan = body.careRoleCodes.filter(
          (r) => !delCentro.some((d) => d.code === r),
        );
        if (faltan.length > 0) {
          return reply.code(400).send({
            error: "ROL_DESCONOCIDO",
            message: `En este centro no hay un rol activo que registre llamado ${faltan.join(", ")}.`,
          });
        }
      }

      // ── Guardar ───────────────────────────────────────────────────
      //
      // `upsert` y no `update`: el ajuste de un control de serie lo crea
      // la semilla, pero el de un control que se añadió al producto
      // DESPUÉS de que este centro se encendiera no existe todavía. Sin
      // el `upsert`, activar ese control sería un 404 y haría falta un
      // backfill cada vez que el catálogo crece.
      const datos = {
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.alias !== undefined ? { alias: body.alias?.trim() || null } : {}),
        ...(body.frecuencia ? aColumnas(body.frecuencia) : {}),
        ...(body.careRoleCodes ? { careRoleCodes: body.careRoleCodes } : {}),
        ...(body.familyVisible !== undefined ? { familyVisible: body.familyVisible } : {}),
        // Elegir otra vez BORRA el aviso de reconducción: el centro ya ha
        // visto lo que pasó y ha dicho lo que quiere.
        ...(body.frecuencia || body.careRoleCodes
          ? { reconductedAt: null, reconductedFromVersion: null, reconductedReason: null }
          : {}),
      };
      const ajuste = await prisma.centerControlSetting.upsert({
        where: { tenantId_controlCode: { tenantId, controlCode: code } },
        update: datos,
        create: {
          tenantId,
          controlCode: code,
          active: body.active ?? true,
          alias: body.alias?.trim() || null,
          ...aColumnas(body.frecuencia ?? deColumnasDefault(control)),
          careRoleCodes: body.careRoleCodes ?? control.allowedCareRoleCodes,
          familyVisible: body.familyVisible ?? control.familyVisibleDefault,
        },
        select: AJUSTE_SELECT,
      });

      return {
        ajuste: {
          active: ajuste.active,
          alias: ajuste.alias,
          frecuencia: deColumnas(ajuste),
          careRoleCodes: ajuste.careRoleCodes,
          familyVisible: ajuste.familyVisible,
          reconducido: null,
        },
      };
    },
  );

  // ── UN CONTROL PROPIO DEL CENTRO ──────────────────────────────────
  //
  // Alcance `CENTER`: no se mezcla con los de serie y **no baja a ningún
  // otro centro**. Aquí el centro SÍ decide la capa, la naturaleza y el
  // dominio, porque el control es suyo.
  app.post(
    "/residencia/controles",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["code", "name", "layer", "nature", "valueDomain", "frecuencia", "careRoleCodes"],
          additionalProperties: false,
          properties: {
            code: { type: "string", minLength: 2, maxLength: 48 },
            name: { type: "string", minLength: 1, maxLength: 80 },
            // `SCALE` y `EVENT` no: la primera es Fase 2 (se pasa con
            // `ClinicalAssessment` y tiene su propio algoritmo) y la
            // segunda la genera el sistema, no una persona. Un centro que
            // se inventara una «escala propia» tendría un control que la
            // puerta no sabría pintar.
            layer: { type: "string", enum: CAPAS_PROPIAS as unknown as string[] },
            nature: { type: "string", enum: NATURALEZAS as unknown as string[] },
            valueDomain: { type: "string", enum: DOMINIOS_PROPIOS as unknown as string[] },
            unit: { type: "string", maxLength: 16 },
            inputMin: { type: "number" },
            inputMax: { type: "number" },
            refMin: { type: "number" },
            refMax: { type: "number" },
            opciones: {
              type: "array",
              maxItems: 10,
              items: {
                type: "object",
                required: ["code", "label"],
                additionalProperties: false,
                properties: {
                  code: { type: "string", minLength: 1, maxLength: 32 },
                  label: { type: "string", minLength: 1, maxLength: 60 },
                  comoSiempre: { type: "boolean" },
                },
              },
            },
            frecuencia: FRECUENCIA_SCHEMA,
            allowedFrequencies: {
              type: "array",
              items: { type: "string", enum: FRECUENCIAS as unknown as string[] },
              maxItems: 8,
            },
            careRoleCodes: {
              type: "array",
              minItems: 1,
              items: { type: "string", maxLength: 32 },
              maxItems: 20,
            },
            isoIndicatorCode: { type: "string", maxLength: 40 },
            familyVisible: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0, maximum: 9999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.auth!.tenantId;
      const body = request.body as {
        code: string;
        name: string;
        layer: ControlLayer;
        nature: "SCHEDULED" | "ON_DEMAND";
        valueDomain: "BOOL" | "ORDINAL" | "NUMERIC" | "TEXT_SHORT";
        unit?: string;
        inputMin?: number;
        inputMax?: number;
        refMin?: number;
        refMax?: number;
        opciones?: Array<{ code: string; label: string; comoSiempre?: boolean }>;
        frecuencia: Frecuencia;
        allowedFrequencies?: CareFrequencyKind[];
        careRoleCodes: string[];
        isoIndicatorCode?: string;
        familyVisible?: boolean;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const code = normalizarCodigo(body.code);

      const problema = problemasDeUnControlPropio(body, code);
      if (problema) {
        return reply.code(400).send({ error: problema.error, message: problema.message });
      }

      // ── UN CÓDIGO DE SERIE NO SE PUEDE REUSAR ─────────────────────
      //
      // Es la regla que sostiene que `center_control_settings` se
      // identifique por `(tenantId, controlCode)` y no por la versión: si
      // un centro pudiera crear su «PESO», el ajuste no sabría de cuál de
      // los dos es. Un 409 con una frase que dice qué hacer.
      const deSerie = await prisma.controlType.findFirst({
        where: { scope: "STANDARD", code },
        select: { name: true },
      });
      if (deSerie) {
        return reply.code(409).send({
          error: "CODIGO_DE_SERIE",
          message: `«${code}» es el código de un control del producto («${deSerie.name}»). Ponle otro código al tuyo, o ajusta el de serie en vez de crear uno nuevo.`,
        });
      }
      const propio = await prisma.controlType.findFirst({
        where: { scope: "CENTER", tenantId, code },
        select: { id: true },
      });
      if (propio) {
        return reply.code(409).send({
          error: "CONTROL_REPETIDO",
          message: `Ya tienes un control con el código «${code}».`,
        });
      }

      const permitidas = body.allowedFrequencies?.length
        ? body.allowedFrequencies
        : // Sin lista, el producto permite exactamente la que el centro
          // eligió. Es lo prudente: un control propio no tiene detrás una
          // guía clínica que diga qué otras frecuencias tienen sentido.
          [body.frecuencia.kind];
      if (!permitidas.includes(body.frecuencia.kind)) permitidas.push(body.frecuencia.kind);

      const ahora = new Date();
      const creado = await prisma.$transaction(async (tx) => {
        const control = await tx.controlType.create({
          data: {
            scope: "CENTER",
            tenantId,
            code,
            version: 1,
            name: body.name.trim(),
            layer: body.layer,
            nature: body.nature,
            valueDomain: body.valueDomain,
            unit: body.unit?.trim() || null,
            inputMin: body.inputMin ?? null,
            inputMax: body.inputMax ?? null,
            refMin: body.refMin ?? null,
            refMax: body.refMax ?? null,
            allowedFrequencies: permitidas,
            allowedCareRoleCodes: body.careRoleCodes,
            ...aColumnasDefault(body.frecuencia),
            isoIndicatorCode: body.isoIndicatorCode?.trim() || null,
            familyVisibleDefault: body.familyVisible ?? false,
            sortOrder: body.sortOrder ?? 900,
            validFrom: ahora,
          },
          select: { id: true, code: true, version: true },
        });
        if ((body.opciones ?? []).length > 0) {
          await tx.controlTypeOption.createMany({
            data: (body.opciones ?? []).map((o, i) => ({
              controlTypeId: control.id,
              code: normalizarCodigo(o.code),
              label: o.label.trim(),
              sortOrder: (i + 1) * 10,
              isAsUsual: o.comoSiempre === true,
            })),
          });
        }
        // Su ajuste, en la misma transacción: un control creado sin ajuste
        // es un control que la pantalla pinta sin saber si está activo, y
        // `queToca` tendría que adivinarlo.
        await tx.centerControlSetting.create({
          data: {
            tenantId,
            controlCode: code,
            active: true,
            ...aColumnas(body.frecuencia),
            careRoleCodes: body.careRoleCodes,
            familyVisible: body.familyVisible ?? false,
          },
        });
        return control;
      });

      return reply.code(201).send({ control: creado });
    },
  );

  // ── LA VERSIÓN SIGUIENTE DE UN CONTROL PROPIO ─────────────────────
  //
  // Una versión publicada no se edita (decisión de producto 5), y eso vale
  // también para los propios del centro: en cuanto hay una línea de plan o
  // un registro apuntando a ella, cambiarle el rango de referencia
  // cambiaría el significado del histórico hacia atrás.
  //
  // De los de serie NO hay ruta: vienen del fichero del repo y el editor
  // para Mi Piace está declarado fuera de alcance. Un intento recibe un
  // 403 con la frase que lo explica.
  app.post(
    "/residencia/controles/:code/versiones",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", minLength: 1, maxLength: 48 } },
        },
        body: {
          type: "object",
          required: ["name", "frecuencia", "careRoleCodes"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            unit: { type: "string", maxLength: 16 },
            inputMin: { type: "number" },
            inputMax: { type: "number" },
            refMin: { type: "number" },
            refMax: { type: "number" },
            opciones: {
              type: "array",
              maxItems: 10,
              items: {
                type: "object",
                required: ["code", "label"],
                additionalProperties: false,
                properties: {
                  code: { type: "string", minLength: 1, maxLength: 32 },
                  label: { type: "string", minLength: 1, maxLength: 60 },
                  comoSiempre: { type: "boolean" },
                },
              },
            },
            frecuencia: FRECUENCIA_SCHEMA,
            allowedFrequencies: {
              type: "array",
              items: { type: "string", enum: FRECUENCIAS as unknown as string[] },
              maxItems: 8,
            },
            careRoleCodes: {
              type: "array",
              minItems: 1,
              items: { type: "string", maxLength: 32 },
              maxItems: 20,
            },
            isoIndicatorCode: { type: "string", maxLength: 40 },
            sortOrder: { type: "integer", minimum: 0, maximum: 9999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.auth!.tenantId;
      const { code } = request.params as { code: string };
      const body = request.body as {
        name: string;
        unit?: string;
        inputMin?: number;
        inputMax?: number;
        refMin?: number;
        refMax?: number;
        opciones?: Array<{ code: string; label: string; comoSiempre?: boolean }>;
        frecuencia: Frecuencia;
        allowedFrequencies?: CareFrequencyKind[];
        careRoleCodes: string[];
        isoIndicatorCode?: string;
        sortOrder?: number;
      };
      const prisma = getPrisma();

      const vigente = await prisma.controlType.findFirst({
        where: { code, supersededAt: null, OR: [{ scope: "STANDARD" }, { scope: "CENTER", tenantId }] },
        select: {
          id: true,
          scope: true,
          version: true,
          layer: true,
          nature: true,
          valueDomain: true,
          name: true,
        },
      });
      if (!vigente) {
        return reply.code(404).send({
          error: "CONTROL_NO_ENCONTRADO",
          message: "No hay ningún control con ese código.",
        });
      }
      if (vigente.scope === "STANDARD") {
        return reply.code(403).send({
          error: "CONTROL_DE_SERIE",
          message:
            "Éste es un control del producto: su definición la mantiene Mi Piace y se actualiza en todos los centros a la vez. Lo que puedes cambiar es tu ajuste (si lo usas, cómo lo llamas, cada cuánto y quién lo registra).",
        });
      }

      const problema = problemasDeUnControlPropio(
        { ...body, layer: vigente.layer, nature: vigente.nature, valueDomain: vigente.valueDomain },
        code,
      );
      if (problema) {
        return reply.code(400).send({ error: problema.error, message: problema.message });
      }

      const permitidas = body.allowedFrequencies?.length
        ? body.allowedFrequencies
        : [body.frecuencia.kind];
      if (!permitidas.includes(body.frecuencia.kind)) permitidas.push(body.frecuencia.kind);

      const ahora = new Date();
      const creado = await prisma.$transaction(async (tx) => {
        // Jubilar y publicar, en este orden y en la misma transacción: dos
        // vigentes del mismo código las rechazaría el índice parcial
        // `control_types_una_vigente_centro_key` a mitad de camino.
        await tx.controlType.update({
          where: { id: vigente.id },
          data: { supersededAt: ahora },
        });
        const control = await tx.controlType.create({
          data: {
            scope: "CENTER",
            tenantId,
            code,
            version: vigente.version + 1,
            name: body.name.trim(),
            // La capa, la naturaleza y el dominio NO cambian entre
            // versiones, ni en los propios: lo registrado con la versión
            // anterior tiene un valor de ese dominio, y cambiarlo haría
            // ilegible el histórico. Para eso se crea otro control.
            layer: vigente.layer,
            nature: vigente.nature,
            valueDomain: vigente.valueDomain,
            unit: body.unit?.trim() || null,
            inputMin: body.inputMin ?? null,
            inputMax: body.inputMax ?? null,
            refMin: body.refMin ?? null,
            refMax: body.refMax ?? null,
            allowedFrequencies: permitidas,
            allowedCareRoleCodes: body.careRoleCodes,
            ...aColumnasDefault(body.frecuencia),
            isoIndicatorCode: body.isoIndicatorCode?.trim() || null,
            sortOrder: body.sortOrder ?? 900,
            validFrom: ahora,
          },
          select: { id: true, code: true, version: true },
        });
        if ((body.opciones ?? []).length > 0) {
          await tx.controlTypeOption.createMany({
            data: (body.opciones ?? []).map((o, i) => ({
              controlTypeId: control.id,
              code: normalizarCodigo(o.code),
              label: o.label.trim(),
              sortOrder: (i + 1) * 10,
              isAsUsual: o.comoSiempre === true,
            })),
          });
        }
        return control;
      });

      return reply.code(201).send({ control: creado });
    },
  );

  // ── LOS MOMENTOS DEL DÍA ──────────────────────────────────────────
  //
  // Sólo la hora y el nombre. El CÓDIGO no se cambia: es lo que
  // referencian `momentCodes` en los ajustes, en las plantillas y en cada
  // línea de plan, y renombrarlo dejaría a la medicación del desayuno
  // apuntando a un momento que no existe — sin FK que lo impida, porque el
  // catálogo es global y los momentos son del centro.
  app.get(
    "/residencia/momentos",
    { preHandler: PUERTAS_LECTURA },
    async (request: FastifyRequest) => {
      const momentos = await getPrisma().centerMoment.findMany({
        where: { tenantId: request.auth!.tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, atTime: true, sortOrder: true },
      });
      return { momentos };
    },
  );

  app.patch(
    "/residencia/momentos/:code",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", minLength: 1, maxLength: 24 } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 60 },
            atTime: { type: "string", pattern: HORA },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = request.auth!.tenantId;
      const { code } = request.params as { code: string };
      const body = request.body as { name?: string; atTime?: string };
      const prisma = getPrisma();

      const momento = await prisma.centerMoment.findFirst({
        where: { tenantId, code },
        select: { id: true },
      });
      if (!momento) {
        return reply.code(404).send({
          error: "MOMENTO_NO_ENCONTRADO",
          message: "Ese momento del día no es de este centro.",
        });
      }
      const actualizado = await prisma.centerMoment.update({
        where: { id: momento.id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.atTime ? { atTime: body.atTime } : {}),
        },
        select: { id: true, code: true, name: true, atTime: true, sortOrder: true },
      });
      return { momento: actualizado };
    },
  );
}

/** Los cinco campos que el centro decide de un control. */
const DEL_CENTRO = ["active", "alias", "frecuencia", "careRoleCodes", "familyVisible"];

/**
 * Los campos del PRODUCTO, con la frase de cada uno.
 *
 * Están nombrados uno por uno —y no se contesta un «campo desconocido»
 * genérico— porque la negativa tiene que decir DÓNDE se cambia eso. «La
 * unidad no se cambia» a secas deja a la dirección buscando la pantalla
 * que no existe.
 */
const DEL_PRODUCTO: Record<string, string> = {
  layer: "la capa",
  nature: "si es programado o a demanda",
  valueDomain: "el tipo de valor",
  unit: "la unidad",
  inputMin: "el mínimo que se puede teclear",
  inputMax: "el máximo que se puede teclear",
  refMin: "el mínimo normal",
  refMax: "el máximo normal",
  opciones: "las opciones",
  allowedFrequencies: "las frecuencias que se permiten",
  allowedCareRoleCodes: "los roles que se permiten",
  isoIndicatorCode: "el indicador de calidad",
  groupCode: "el grupo",
  version: "la versión",
  code: "el código",
  name: "el nombre del producto",
  scope: "el alcance",
};

/**
 * Mira el cuerpo CRUDO y rechaza lo que no es del centro.
 *
 * `preValidation` y no `preHandler`: corre ANTES de que ajv pode el cuerpo
 * con `removeAdditional`, que es el único momento en que esos campos
 * todavía existen.
 */
async function soloLoDelCentro(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body;
  if (body === null || typeof body !== "object") return;
  for (const campo of Object.keys(body as Record<string, unknown>)) {
    if (DEL_CENTRO.includes(campo)) continue;
    const queEs = DEL_PRODUCTO[campo];
    if (queEs) {
      await reply.code(400).send({
        error: "ES_DEL_PRODUCTO",
        message: `${queEs[0]!.toUpperCase()}${queEs.slice(1)} de un control lo mantiene Mi Piace y se actualiza en todos los centros a la vez. Tú puedes cambiar si lo usáis, cómo lo llamáis, cada cuánto y quién lo registra.`,
      });
      return;
    }
    await reply.code(400).send({
      error: "CAMPO_DESCONOCIDO",
      message: `«${campo}» no es nada que se pueda cambiar de un control.`,
    });
    return;
  }
}

/** Mayúsculas, sin acentos y con guiones bajos. Es lo que son los códigos. */
export function normalizarCodigo(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Los turnos y momentos que una frecuencia nombra y el centro no tiene.
 *
 * Es la otra regla que cruza dos tablas y no cabe en un CHECK. Importa
 * porque `queToca` no inventa un turno cuando el que la línea nombra no
 * existe: devuelve cero ocurrencias, y un control que no toca nunca es un
 * cuidado que nadie hace y nadie echa en falta.
 */
async function turnosOMomentosQueNoExisten(
  tenantId: string,
  f: Frecuencia,
): Promise<string | null> {
  const prisma = getPrisma();
  const turnos = f.shiftCodes ?? [];
  const momentos = f.momentCodes ?? [];
  if (turnos.length > 0) {
    const hay = await prisma.centerShift.findMany({
      where: { tenantId, code: { in: turnos } },
      select: { code: true },
    });
    const faltan = turnos.filter((c) => !hay.some((h) => h.code === c));
    if (faltan.length > 0) {
      return `En este centro no hay un turno llamado ${faltan.join(", ")}.`;
    }
  }
  if (momentos.length > 0) {
    const hay = await prisma.centerMoment.findMany({
      where: { tenantId, code: { in: momentos } },
      select: { code: true },
    });
    const faltan = momentos.filter((c) => !hay.some((h) => h.code === c));
    if (faltan.length > 0) {
      return `En este centro no hay un momento del día llamado ${faltan.join(", ")}.`;
    }
  }
  return null;
}

/**
 * Lo que un control propio no puede ser, con la frase de cada caso.
 *
 * Se comparte entre crear y versionar porque son el mismo juicio: un
 * control ordinal sin opciones es igual de inútil en la versión 1 que en
 * la 4.
 */
function problemasDeUnControlPropio(
  body: {
    code?: string;
    // Los tres llegan como el enum COMPLETO y no como el subconjunto que
    // el esquema del POST admite, porque la ruta de versionar los lee de
    // la fila vigente (donde el tipo es el del enum). El subconjunto lo
    // garantiza el esquema al crear; aquí se vuelve a comprobar al final,
    // que es lo que convierte el tipo ancho en una negativa con frase en
    // vez de en un `as`.
    layer: ControlLayer;
    nature: ControlNature;
    valueDomain: ControlValueDomain;
    unit?: string;
    inputMin?: number;
    inputMax?: number;
    refMin?: number;
    refMax?: number;
    opciones?: Array<{ code: string; label: string; comoSiempre?: boolean }>;
    frecuencia: Frecuencia;
  },
  code: string,
): { error: string; message: string } | null {
  if (code.length < 2) {
    return {
      error: "CODIGO_INVALIDO",
      message: "El código tiene que tener al menos dos letras o números.",
    };
  }
  const malaFrecuencia = problemaDeFrecuencia(body.frecuencia);
  if (malaFrecuencia) {
    return { error: "FRECUENCIA_INCOHERENTE", message: malaFrecuencia };
  }
  // Una naturaleza `ON_DEMAND` con una frecuencia que no es `ON_DEMAND`, o
  // al revés, es un control que dice dos cosas: «no tiene agenda» y «toca
  // los lunes». La puerta pintaría un botón suelto y el panel lo contaría
  // como incumplido.
  if (body.nature === "ON_DEMAND" && body.frecuencia.kind !== "ON_DEMAND") {
    return {
      error: "NATURALEZA_Y_FRECUENCIA",
      message:
        "Un control «a demanda» no lleva agenda: su frecuencia tiene que ser «a demanda» también. Si quieres que toque a una hora, ponlo como programado.",
    };
  }
  if (body.nature === "SCHEDULED" && body.frecuencia.kind === "ON_DEMAND") {
    return {
      error: "NATURALEZA_Y_FRECUENCIA",
      message:
        "Un control programado tiene que tocar en algún momento. Elige cada cuánto, o ponlo «a demanda».",
    };
  }
  if (body.valueDomain === "ORDINAL" && (body.opciones ?? []).length < 2) {
    return {
      error: "ORDINAL_SIN_OPCIONES",
      message: "Un control de opciones necesita al menos dos. Escribe las que vais a usar.",
    };
  }
  if (body.valueDomain !== "ORDINAL" && (body.opciones ?? []).length > 0) {
    return {
      error: "OPCIONES_SIN_ORDINAL",
      message: "Las opciones son de los controles de opciones. Cambia el tipo de valor o quítalas.",
    };
  }
  if ((body.opciones ?? []).filter((o) => o.comoSiempre).length > 1) {
    // Lo impide también el índice parcial
    // `control_type_options_un_como_siempre_key`; aquí se dice con una
    // frase en vez de un 500 de constraint.
    return {
      error: "DOS_COMO_SIEMPRE",
      message:
        "Sólo una opción puede ser el «como siempre»: es la que da por buena el toque rápido.",
    };
  }
  if (body.valueDomain === "NUMERIC" && !body.unit?.trim()) {
    return {
      error: "MEDIDA_SIN_UNIDAD",
      message: "Una medida sin unidad es un número que nadie sabe leer. Pon «kg», «cm», lo que sea.",
    };
  }
  if (
    body.inputMin !== undefined &&
    body.inputMax !== undefined &&
    body.inputMin > body.inputMax
  ) {
    return {
      error: "RANGO_AL_REVES",
      message: "El mínimo que se puede teclear tiene que ser menor que el máximo.",
    };
  }
  if (body.refMin !== undefined && body.refMax !== undefined && body.refMin > body.refMax) {
    return {
      error: "RANGO_AL_REVES",
      message: "El mínimo normal tiene que ser menor que el máximo normal.",
    };
  }
  // Lo que un centro NO puede tener en un control propio: una capa de
  // escala (Fase 2, con su algoritmo), un dominio de puntuación (idem) y
  // una naturaleza derivada (la genera el sistema, residencia-4). Las tres
  // las filtra el esquema al crear; esto cubre la ruta de versionar, que
  // las lee de la fila.
  if (
    !CAPAS_PROPIAS.includes(body.layer as (typeof CAPAS_PROPIAS)[number]) ||
    !DOMINIOS_PROPIOS.includes(body.valueDomain as (typeof DOMINIOS_PROPIOS)[number]) ||
    !NATURALEZAS.includes(body.nature as (typeof NATURALEZAS)[number])
  ) {
    return {
      error: "CONTROL_INVALIDO",
      message:
        "Un control propio del centro es de ejecución, observación o medida, con valor de sí/no, opciones, número o texto corto. Las escalas validadas y los eventos los pone el producto.",
    };
  }
  return null;
}
