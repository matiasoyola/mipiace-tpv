// clinica-2 · la valoración inicial contra la base.
//
// Lo PURO (el cuestionario, las alertas, si se puede validar, la puerta
// del primer tratamiento) vive en `@mipiacetpv/clinica-valoracion` y lo
// comparten la API y las pantallas. Aquí está lo que necesita Postgres:
// crear la valoración, rotar el token, guardar lo que contestó el
// paciente, añadir correcciones y firmar la validación.
//
// ── Dónde se escribe cada cosa, y por qué ahí ─────────────────────────
//
//   · **Las respuestas del paciente** → `clinical_entries` con
//     `kind = INITIAL_ASSESSMENT`. Inmutable por el trigger de clinica-1,
//     con autor (el actor «paciente por enlace») y fecha. No hay ninguna
//     ruta que las edite, y si la hubiera el motor la rechazaría.
//   · **El estado** → `clinical_assessments`. Avanza y se congela al
//     validar.
//   · **Las correcciones** → `clinical_assessment_corrections`,
//     append-only, cada una con su autor.
//
// ── Y el registro de accesos no se escribe aquí ───────────────────────
//
// Lo escribe `registro.ts::conHistoria`, un único punto, ANTES de que
// estas funciones corran. Lo que estas funciones hacen es el trabajo; la
// prueba de que ocurrió ya está escrita cuando llegan.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  VERSION_VIGENTE,
  alertasDe,
  cuestionarioDeVersion,
  puedeValidarse,
  type Alertas,
  type CanalValoracion,
  type Confirmaciones,
  type Correccion,
  type Cuestionario,
  type EstadoValoracion,
  type RespondioPor,
  type Respuesta,
  type RespuestasPaciente,
  type Validable,
  type ValoracionParaPuerta,
} from "@mipiacetpv/clinica-valoracion";

import {
  consumirEnlace,
  crearEnlace,
  revocarEnlacesDe,
  type EnlaceCreado,
} from "../enlaces/puerta.js";
import { REGLAS_VALORACION } from "../enlaces/reglas.js";
import { huellaDeToken } from "../enlaces/token.js";
import { comoPrismaParaActor, resolverActorPaciente } from "./actor-paciente.js";

// ── La forma de lo que se guarda en la entrada de historia ────────────
//
// El `body` es jsonb y esta interfaz es su contrato. Lleva la versión
// DENTRO además de en la columna: si algún día una entrada se leyera sin
// su valoración (un export, un informe), sigue diciendo con qué
// cuestionario se contestó.
export interface CuerpoDeValoracion {
  valoracion: {
    version: number;
    canal: CanalValoracion;
    respondioPor: RespondioPor;
  };
  respuestas: Record<string, Respuesta>;
  /** Las opciones marcadas en las preguntas con detalle (`{aler:[…]}`). */
  detalles: Record<string, string[]>;
}

/** Lo que `select` trae de una valoración. Un solo sitio lo define para
 *  que las cuatro consultas de este fichero no se separen. */
const SELECT_VALORACION = {
  id: true,
  clientId: true,
  appointmentId: true,
  questionnaireVersion: true,
  status: true,
  channel: true,
  createdAt: true,
  source: true,
  // Las tres columnas del enlace NO SE SELECCIONAN desde
  // `enlaces-publicos`: están obsoletas y nadie las lee. El estado del
  // enlace sale de `public_links` (`enlaceDeLaValoracion`). Quitarlas de
  // aquí es la mitad de «se dejan de leer» que no se ve en ningún test:
  // mientras siguieran en el `select`, el día que alguien las volviera a
  // usar no habría nada que lo frenara.
  entryId: true,
  answeredAt: true,
  answeredBy: true,
  confirmedAllergies: true,
  confirmedMedication: true,
  confirmedAlerts: true,
  validatedAt: true,
  validatedByUserId: true,
  requestedBy: { select: { id: true, alias: true, email: true } },
  validatedBy: {
    select: { id: true, alias: true, email: true, clinicianLicense: true },
  },
} satisfies Prisma.ClinicalAssessmentSelect;

type FilaValoracion = Prisma.ClinicalAssessmentGetPayload<{
  select: typeof SELECT_VALORACION;
}>;

/** El nombre visible de quien firma. Mismo criterio que `autorView` de
 *  `routes.ts`: alias primero (el email es credencial, no display). */
function nombreDe(u: { alias: string | null; email: string }): string {
  return u.alias?.trim() || u.email;
}

// ── Lecturas ──────────────────────────────────────────────────────────

/**
 * La valoración ABIERTA de un paciente (pendiente o respondida), si la
 * hay. Como mucho una: lo garantiza el índice único parcial
 * `clinical_assessments_one_open_key`, no este `findFirst`.
 */
export async function cargarValoracionAbierta(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { tenantId: string; clientId: string },
): Promise<FilaValoracion | null> {
  return prisma.clinicalAssessment.findFirst({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      status: { not: "VALIDADA" },
    },
    select: SELECT_VALORACION,
  });
}

/**
 * La valoración que la pantalla del sanitario tiene que enseñar: la
 * abierta si hay una, y si no la última validada.
 *
 * El orden importa y es éste: si hay un repaso en marcha, lo que la
 * podóloga está mirando es el repaso. La validada anterior sigue en la
 * historia (y es la que deja tratar, ver `primer-tratamiento.ts`), pero no
 * es la pantalla en la que se trabaja hoy.
 */
export async function cargarValoracionDeLaPantalla(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<FilaValoracion | null> {
  const abierta = await cargarValoracionAbierta(prisma, input);
  if (abierta) return abierta;
  return prisma.clinicalAssessment.findFirst({
    where: { tenantId: input.tenantId, clientId: input.clientId },
    orderBy: { createdAt: "desc" },
    select: SELECT_VALORACION,
  });
}

/** Todas las valoraciones de un paciente, en la forma que pide la puerta
 *  del primer tratamiento. Tres columnas: no se trae ni una respuesta. */
export async function valoracionesParaLaPuerta(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<ValoracionParaPuerta[]> {
  const filas = await prisma.clinicalAssessment.findMany({
    where: { tenantId: input.tenantId, clientId: input.clientId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, validatedAt: true },
  });
  return filas.map((f) => ({
    id: f.id,
    estado: f.status as EstadoValoracion,
    validadaEn: f.validatedAt?.toISOString() ?? null,
  }));
}

// ── La vista del sanitario ────────────────────────────────────────────

export interface VistaValoracion {
  valoracion: {
    id: string;
    estado: EstadoValoracion;
    canal: CanalValoracion;
    version: number;
    creadaEn: string;
    origen: OrigenValoracion;
    pedidaPor: string | null;
    appointmentId: string | null;
    respondidaEn: string | null;
    respondioPor: RespondioPor | null;
    validadaEn: string | null;
    validadaPor: { nombre: string; colegiado: string | null } | null;
    confirmaciones: Confirmaciones;
    /** El estado del enlace, NUNCA el token ni su huella. Lo que la
     *  pantalla necesita saber es si hay uno vivo y hasta cuándo, para
     *  poder decir «el test se mandó y caduca el día X» y ofrecer
     *  reenviarlo. Desde `enlaces-publicos` sale de `public_links` (ver
     *  `enlaceDeLaValoracion`), no de las columnas obsoletas. */
    enlace: { activo: boolean; caducaEn: string | null } | null;
  } | null;
  cuestionario: Cuestionario | null;
  respuestasPaciente: RespuestasPaciente;
  detalles: Record<string, string[]>;
  correcciones: Correccion[];
  alertas: Alertas;
  /**
   * ¿Está TODO LO DEMÁS listo para validar?
   *
   * Se calcula **dando las tres confirmaciones por marcadas**, y eso es el
   * contrato: las confirmaciones las marca la pantalla en memoria y viajan
   * con la validación (ver `validarValoracion`), así que el servidor no
   * sabe —ni tiene por qué— cuáles ha tocado la podóloga ahora mismo.
   *
   * Lo que esto contesta es lo que el servidor SÍ sabe: si queda algún «No
   * lo sé» sin resolver, si el paciente ha contestado, si ya está
   * validada, si el cuestionario se puede leer. La pantalla hace el AND
   * con sus tres casillas usando la MISMA función pura, y de ahí sale el
   * botón desactivado con su motivo al lado del mockup.
   *
   * Calcularlo con las confirmaciones de la FILA sería inútil: antes de
   * validar son `false` las tres, así que el motivo sería siempre «marca
   * las tres confirmaciones» y taparía el «queda 1 respuesta por
   * resolver», que es el que hay que leer primero.
   */
  validable: Validable;
  /** Las anteriores, para que la pantalla pueda decir «ésta es la tercera
   *  valoración de este paciente». Sin respuestas: sólo cuándo y quién. */
  anteriores: Array<{
    id: string;
    estado: EstadoValoracion;
    validadaEn: string | null;
  }>;
}

/**
 * Todo lo que la pantalla del sanitario necesita, en una sola llamada.
 *
 * Las alertas y «se puede validar» se calculan AQUÍ con las funciones
 * puras del paquete, y viajan en la respuesta. Así la pantalla las pinta
 * sin recalcular —aunque podría, es el mismo código— y, lo que importa, la
 * API y la pantalla no pueden discrepar: el servidor manda.
 */
export async function vistaDeLaValoracion(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<VistaValoracion> {
  const fila = await cargarValoracionDeLaPantalla(prisma, input);

  if (!fila) {
    return {
      valoracion: null,
      cuestionario: cuestionarioDeVersion(VERSION_VIGENTE),
      respuestasPaciente: {},
      detalles: {},
      correcciones: [],
      alertas: { alertas: [], sinResolver: [], detalles: {} },
      validable: {
        puede: false,
        motivo: "NO_RESPONDIDA",
        mensaje: "Este paciente no tiene valoración inicial todavía.",
      },
      anteriores: [],
    };
  }

  const [cuerpo, correcciones, enlace, anteriores] = await Promise.all([
    cargarCuerpo(prisma, fila),
    cargarCorrecciones(prisma, fila.id),
    enlaceDeLaValoracion(prisma, {
      tenantId: input.tenantId,
      valoracionId: fila.id,
      estado: fila.status as EstadoValoracion,
    }),
    prisma.clinicalAssessment.findMany({
      where: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        id: { not: fila.id },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, validatedAt: true },
    }),
  ]);

  const cuestionario = cuestionarioDeVersion(fila.questionnaireVersion);
  const estado = {
    respuestasPaciente: cuerpo?.respuestas ?? {},
    correcciones,
  };
  const confirmaciones: Confirmaciones = {
    alergias: fila.confirmedAllergies,
    medicacion: fila.confirmedMedication,
    alertas: fila.confirmedAlerts,
  };

  // Con una versión que no se sabe leer no hay alertas que calcular, y
  // decir «sin alertas» sería mentir. La pantalla recibe la lista vacía Y
  // el `validable` con motivo VERSION_DESCONOCIDA, que es lo que pinta el
  // aviso.
  const alertas: Alertas = cuestionario
    ? alertasDe({
        cuestionario,
        ...estado,
        detalles: cuerpo?.detalles ?? {},
      })
    : { alertas: [], sinResolver: [], detalles: {} };

  return {
    valoracion: {
      id: fila.id,
      estado: fila.status as EstadoValoracion,
      canal: fila.channel as CanalValoracion,
      version: fila.questionnaireVersion,
      creadaEn: fila.createdAt.toISOString(),
      origen: fila.source as OrigenValoracion,
      // `null` cuando la pidió la cita: ahí no la pidió nadie, y la
      // pantalla lo dice así («se mandó al dar la cita»).
      pedidaPor: fila.requestedBy ? nombreDe(fila.requestedBy) : null,
      appointmentId: fila.appointmentId,
      respondidaEn: fila.answeredAt?.toISOString() ?? null,
      respondioPor: (fila.answeredBy as RespondioPor | null) ?? null,
      validadaEn: fila.validatedAt?.toISOString() ?? null,
      validadaPor: fila.validatedBy
        ? {
            nombre: nombreDe(fila.validatedBy),
            colegiado: fila.validatedBy.clinicianLicense,
          }
        : null,
      confirmaciones,
      enlace,
    },
    cuestionario,
    respuestasPaciente: estado.respuestasPaciente,
    detalles: cuerpo?.detalles ?? {},
    correcciones,
    alertas,
    validable: puedeValidarse({
      cuestionario,
      estado: fila.status as EstadoValoracion,
      // Las tres por marcadas: ver la nota del campo en `VistaValoracion`.
      confirmaciones: { alergias: true, medicacion: true, alertas: true },
      ...estado,
    }),
    anteriores: anteriores.map((a) => ({
      id: a.id,
      estado: a.status as EstadoValoracion,
      validadaEn: a.validatedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * El estado del enlace de una valoración, leído de `public_links`.
 *
 * Devuelve el ÚLTIMO enlace de esta valoración, vivo o no, porque eso es
 * lo que la pantalla tiene que poder decir: «se mandó y caduca el día X»,
 * «se usó» o «lo anularon». `null` cuando nunca hubo enlace.
 *
 * **Ni el token ni su huella salen de aquí.** Tres datos: si abre, hasta
 * cuándo, y nada más — la pantalla del sanitario no necesita el enlace
 * para nada (para reenviarlo hay un botón que crea otro), y una huella en
 * una respuesta HTTP es una huella en el historial de un navegador.
 *
 * El estado de la valoración entra por parámetro porque es la mitad del
 * «activo»: la defensa en profundidad de clinica-2 (§8 de su done) son dos
 * líneas independientes —el gasto del enlace y el estado del objeto— y
 * aquí se preguntan las dos, igual que en `REGLAS_VALORACION.admiteEnlace`.
 */
async function enlaceDeLaValoracion(
  prisma: PrismaClient,
  input: { tenantId: string; valoracionId: string; estado: EstadoValoracion },
  ahora = new Date(),
): Promise<{ activo: boolean; caducaEn: string | null } | null> {
  const fila = await prisma.publicLink.findFirst({
    where: {
      tenantId: input.tenantId,
      purpose: REGLAS_VALORACION.purpose,
      targetType: REGLAS_VALORACION.targetType,
      targetId: input.valoracionId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      revokedAt: true,
    },
  });
  if (!fila) return null;
  return {
    activo:
      fila.revokedAt == null &&
      fila.usedCount < fila.maxUses &&
      fila.expiresAt.getTime() > ahora.getTime() &&
      input.estado === "PENDIENTE_PACIENTE",
    caducaEn: fila.expiresAt.toISOString(),
  };
}

async function cargarCuerpo(
  prisma: PrismaClient,
  fila: FilaValoracion,
): Promise<CuerpoDeValoracion | null> {
  if (!fila.entryId) return null;
  const entrada = await prisma.clinicalEntry.findUnique({
    where: { id: fila.entryId },
    select: { body: true },
  });
  return (entrada?.body as CuerpoDeValoracion | undefined) ?? null;
}

async function cargarCorrecciones(
  prisma: PrismaClient,
  assessmentId: string,
): Promise<Correccion[]> {
  const filas = await prisma.clinicalAssessmentCorrection.findMany({
    where: { assessmentId },
    orderBy: { createdAt: "asc" },
    select: {
      questionId: true,
      value: true,
      createdAt: true,
      author: { select: { id: true, alias: true, email: true } },
    },
  });
  return filas.map((c) => ({
    preguntaId: c.questionId,
    valor: c.value as Respuesta,
    autorNombre: nombreDe(c.author),
    autorUserId: c.author.id,
    creadaEn: c.createdAt.toISOString(),
  }));
}

// ── Crear / reenviar el test ──────────────────────────────────────────

export type OrigenValoracion = "APPOINTMENT" | "MANUAL";

export interface ValoracionAbierta {
  valoracionId: string;
  /** El token EN CLARO, sólo cuando se acaba de generar uno. Va al email y
   *  a ningún otro sitio. `null` cuando el canal es la tablet. */
  token: string | null;
  /** `true` si la valoración se ha creado ahora; `false` si ya había una
   *  abierta y se le ha rotado el enlace. Lo usa la ruta para contestar
   *  201 o 200, y los tests para distinguir «no creó porque no tocaba» de
   *  «no creó porque ya había». */
  creada: boolean;
  estado: EstadoValoracion;
  caducaEn: Date | null;
}

/**
 * Deja al paciente con una valoración abierta y un enlace vivo si el canal
 * lo necesita.
 *
 * Es IDEMPOTENTE por el índice único parcial: dos envíos (la recepcionista
 * y la podóloga a la vez, o dos citas de primera valoración) no crean dos
 * valoraciones. La segunda reusa la abierta.
 *
 * **Y si la abierta ya está RESPONDIDA, no se le rota nada**: el paciente
 * ya contestó, y darle otro enlace sería invitarle a contestar dos veces
 * sobre una valoración que la podóloga quizá ya está revisando. Lo que
 * toca entonces es validarla —o, si de verdad hay que volver a preguntar,
 * validarla y crear un repaso.
 */
export async function asegurarValoracionAbierta(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    canal: CanalValoracion;
    /**
     * De dónde sale. `APPOINTMENT` NO lleva usuario y `MANUAL` lo exige:
     * lo ata el CHECK `clinical_assessments_source_pedida_por`, con el
     * mismo criterio que `clinical_access` de clinica-1.
     */
    origen: OrigenValoracion;
    pedidaPorUserId: string | null;
    appointmentId?: string | null;
    ahora?: Date;
  },
): Promise<ValoracionAbierta> {
  const ahora = input.ahora ?? new Date();
  const abierta = await cargarValoracionAbierta(prisma, input);

  if (abierta) {
    if (abierta.status !== "PENDIENTE_PACIENTE") {
      return {
        valoracionId: abierta.id,
        token: null,
        creada: false,
        estado: abierta.status as EstadoValoracion,
        caducaEn: null,
      };
    }
    const rotado = await rotarEnlace(prisma, {
      tenantId: input.tenantId,
      valoracionId: abierta.id,
      canal: input.canal,
      creadoPorUserId: input.pedidaPorUserId,
      ahora,
    });
    return {
      valoracionId: abierta.id,
      token: rotado.token,
      creada: false,
      estado: "PENDIENTE_PACIENTE",
      caducaEn: rotado.expiraEn,
    };
  }

  try {
    // La valoración y su enlace nacen EN LA MISMA TRANSACCIÓN, y el orden
    // no se puede invertir: el enlace apunta a la valoración, así que su
    // `target_id` no existe hasta que la fila está. Juntos porque una
    // valoración pendiente sin enlace es un test que nadie puede contestar
    // y un enlace sin valoración no abre nada.
    const creada = await prisma.$transaction(async (tx) => {
      const fila = await tx.clinicalAssessment.create({
        data: {
          tenantId: input.tenantId,
          clientId: input.clientId,
          appointmentId: input.appointmentId ?? null,
          questionnaireVersion: VERSION_VIGENTE,
          channel: input.canal,
          source: input.origen,
          requestedByUserId:
            input.origen === "MANUAL" ? input.pedidaPorUserId : null,
        },
        select: { id: true },
      });
      const enlace = await crearEnlace(tx, REGLAS_VALORACION, {
        tenantId: input.tenantId,
        targetId: fila.id,
        canal: input.canal,
        // NULL cuando lo pidió la cita: ahí no lo pide una persona. Mismo
        // criterio que `requested_by_user_id` con `source = APPOINTMENT`.
        creadoPorUserId:
          input.origen === "MANUAL" ? input.pedidaPorUserId : null,
        ahora,
      });
      await espejoDelEnlaceObsoleto(tx, fila.id, input.canal, enlace);
      return { id: fila.id, enlace };
    });
    return {
      valoracionId: creada.id,
      token: creada.enlace.token,
      creada: true,
      estado: "PENDIENTE_PACIENTE",
      caducaEn: creada.enlace.expiraEn,
    };
  } catch (err) {
    // La carrera: otra petición creó la valoración abierta entre el
    // `findFirst` y el `create`. El índice único parcial la rechazó —que
    // es para lo que está— y lo correcto es seguir con la que ganó.
    const ganadora = await cargarValoracionAbierta(prisma, input);
    if (!ganadora) throw err;
    const rotado =
      ganadora.status === "PENDIENTE_PACIENTE"
        ? await rotarEnlace(prisma, {
            tenantId: input.tenantId,
            valoracionId: ganadora.id,
            canal: input.canal,
            creadoPorUserId: input.pedidaPorUserId,
            ahora,
          })
        : null;
    return {
      valoracionId: ganadora.id,
      token: rotado?.token ?? null,
      creada: false,
      estado: ganadora.status as EstadoValoracion,
      caducaEn: rotado?.expiraEn ?? null,
    };
  }
}

/**
 * Le pone un enlace nuevo a una valoración pendiente, y ANULA EL ANTERIOR.
 *
 * **Rotar es lo que invalida el anterior**, y no «quemarlo»: gastar un uso
 * significa exactamente «se usó para contestar» y se escribe una sola vez,
 * al contestar. Si reenviar gastara el token viejo, el contador pasaría a
 * significar dos cosas y el trigger que hace el enlace de un solo uso
 * dejaría de poder distinguirlas.
 *
 * Desde `enlaces-publicos` son DOS filas de `public_links` —la vieja
 * anulada, la nueva viva— y no una fila con el hash sobrescrito, que es la
 * decisión S1.5. Lo que se gana: la anulación queda ESCRITA, con su fecha,
 * en vez de desaparecer; y el único parcial `public_links_uno_vivo_key`
 * convierte «se anula el anterior» en una invariante — si este `revocar`
 * se cayera, el `crearEnlace` de la línea siguiente fallaría con 23505 en
 * vez de dejar dos enlaces vivos del mismo test.
 *
 * Las dos van en la MISMA transacción: un enlace nuevo con el viejo todavía
 * vivo, o un viejo anulado sin nuevo, son los dos estados que no pueden
 * quedar.
 *
 * De aquí sale, gratis, lo que hacía falta de todos modos: **abrir la
 * tablet invalida el enlace del email**. La fila del email queda anulada,
 * así que la URL que el paciente tiene en el correo ya no resuelve contra
 * nada — sin un camino aparte que «cancele» el email.
 */
async function rotarEnlace(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    valoracionId: string;
    canal: CanalValoracion;
    creadoPorUserId: string | null;
    ahora: Date;
  },
): Promise<EnlaceCreado> {
  return prisma.$transaction(async (tx) => {
    await revocarEnlacesDe(tx, {
      tenantId: input.tenantId,
      targetType: REGLAS_VALORACION.targetType,
      targetId: input.valoracionId,
      purpose: REGLAS_VALORACION.purpose,
      ahora: input.ahora,
    });
    const enlace = await crearEnlace(tx, REGLAS_VALORACION, {
      tenantId: input.tenantId,
      targetId: input.valoracionId,
      canal: input.canal,
      creadoPorUserId: input.creadoPorUserId,
      ahora: input.ahora,
    });
    await espejoDelEnlaceObsoleto(tx, input.valoracionId, input.canal, enlace);
    return enlace;
  });
}

/**
 * EL ESPEJO DE LAS TRES COLUMNAS OBSOLETAS. Transitorio, y por una sola
 * razón.
 *
 * `clinical_assessments.link_token_hash` / `link_expires_at` /
 * `link_used_at` **ya no las lee nadie**: el enlace de la valoración vive
 * en `public_links` y la única cosa que resuelve un token es la puerta
 * común. Se siguen escribiendo porque la guardia de regresión de clinica-2
 * las mira —`clinica-valoracion.e2e.ts` contra los CHECK y los triggers de
 * `clinical_assessments`, y `11-clinica-valoracion.spec.ts` contra la fila
 * real— y el bloque que generaliza el mecanismo no es el que cambia la
 * guardia que lo vigilaba. Expand ahora, contract después.
 *
 * **Se borra, con sus columnas, en el bloque que mueva esa guardia a
 * `public_links`.** Hasta entonces es un espejo y no una segunda fuente de
 * verdad: nada lo lee, así que no puede discrepar de nada.
 *
 * `channel` NO es obsoleto y se escribe aquí porque es el mismo UPDATE: lo
 * lee la pantalla del sanitario y la respuesta de la ruta pública (la
 * despedida de la tablet no es la del email).
 */
async function espejoDelEnlaceObsoleto(
  tx: PrismaClient | Prisma.TransactionClient,
  valoracionId: string,
  canal: CanalValoracion,
  enlace: EnlaceCreado,
): Promise<void> {
  await tx.clinicalAssessment.update({
    where: { id: valoracionId },
    data: {
      channel: canal,
      linkTokenHash: huellaDeToken(enlace.token),
      linkExpiresAt: enlace.expiraEn,
    },
  });
}

// ── Lo que contesta el paciente ───────────────────────────────────────

export type ResultadoResponder =
  | { ok: true; entryId: string }
  | { ok: false; motivo: "YA_RESPONDIDA" };

/**
 * Guarda lo que contestó el paciente, en una transacción con tres partes
 * que no pueden ir por separado:
 *
 *   1. el actor «paciente por enlace», si es la primera vez en este
 *      tenant;
 *   2. la ENTRADA DE HISTORIA con las respuestas (inmutable desde ese
 *      instante);
 *   3. la valoración, que pasa a RESPONDIDA;
 *   4. **el uso del enlace**, dentro de esta misma transacción.
 *
 * Si la 3 fallara después de la 2, quedaría una entrada de historia que
 * ninguna valoración reclama: respuestas sin contexto que nadie va a
 * revisar, y el enlace seguiría abierto para contestar otra vez.
 *
 * Y la 4 va aquí, y no antes ni después, por lo mismo: un enlace gastado
 * con la respuesta sin guardar deja al paciente sin poder contestar y sin
 * nada contestado, y una respuesta guardada con el enlace sin gastar le
 * deja contestar dos veces. `consumirEnlace` recibe el `tx` justamente
 * para eso (decisión S1: «incrementa usos dentro de la transacción del
 * acto que lo gasta»).
 *
 * El `updateMany` con `status: "PENDIENTE_PACIENTE"` en el WHERE es el
 * cierre de la carrera: si dos envíos del formulario llegan a la vez, el
 * segundo actualiza cero filas y la transacción se deshace entera. No hace
 * falta un bloqueo — y el trigger del enlace de un solo uso lo respalda
 * desde el motor.
 */
export async function responderValoracion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    valoracionId: string;
    appointmentId: string | null;
    version: number;
    canal: CanalValoracion;
    respondioPor: RespondioPor;
    respuestas: Record<string, Respuesta>;
    detalles: Record<string, string[]>;
    /**
     * El enlace por el que se entró, que se gasta en esta transacción.
     * `null` cuando no se entró por un enlace.
     *
     * (Las dos puertas del test SÍ son enlaces —el email y la tablet usan
     * el mismo token con otra caducidad—, así que hoy siempre viene con
     * valor desde la ruta pública. Se admite `null` porque la firma tiene
     * que poder decir «esto no gastó ningún enlace».)
     */
    enlaceId: string | null;
    ahora?: Date;
  },
): Promise<ResultadoResponder> {
  const ahora = input.ahora ?? new Date();
  const cuerpo: CuerpoDeValoracion = {
    valoracion: {
      version: input.version,
      canal: input.canal,
      respondioPor: input.respondioPor,
    },
    respuestas: input.respuestas,
    detalles: input.detalles,
  };

  try {
    return await prisma.$transaction(async (tx) => {
      const autorUserId = await resolverActorPaciente(
        comoPrismaParaActor(tx),
        input.tenantId,
      );
      const entrada = await tx.clinicalEntry.create({
        data: {
          tenantId: input.tenantId,
          clientId: input.clientId,
          // EL AUTOR ES EL PACIENTE. No la podóloga, no la recepcionista:
          // lo contestó él, y la historia dice quién lo escribió.
          authorUserId: autorUserId,
          appointmentId: input.appointmentId,
          kind: "INITIAL_ASSESSMENT",
          body: cuerpo as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      const movidas = await tx.clinicalAssessment.updateMany({
        where: {
          id: input.valoracionId,
          tenantId: input.tenantId,
          status: "PENDIENTE_PACIENTE",
        },
        data: {
          status: "RESPONDIDA",
          channel: input.canal,
          entryId: entrada.id,
          answeredAt: ahora,
          answeredBy: input.respondioPor,
          // El espejo obsoleto del sello. Ver `espejoDelEnlaceObsoleto`:
          // no lo lee nadie, y se va con las columnas en el bloque que
          // mueva la guardia de clinica-2 a `public_links`. El «un solo
          // uso» de verdad lo hace `consumirEnlace`, cuatro líneas más
          // abajo.
          ...(input.enlaceId ? { linkUsedAt: ahora } : {}),
        },
      });
      if (movidas.count !== 1) {
        // Deshace la entrada recién creada: la transacción entera se
        // revierte, y un ROLLBACK no dispara el trigger de inmutabilidad
        // (que vigila DELETE, no el deshacer de una inserción propia).
        throw new CarreraDeRespuesta();
      }

      // EL USO DEL ENLACE, aquí dentro. `false` cuando ya no quedaba (o
      // ya estaba anulado): dos envíos del formulario a la vez, y el
      // segundo se cae con toda su transacción.
      if (input.enlaceId) {
        const gastado = await consumirEnlace(tx, {
          enlaceId: input.enlaceId,
          maxUsos: REGLAS_VALORACION.maxUsos,
        });
        if (!gastado) throw new CarreraDeRespuesta();
      }

      return { ok: true as const, entryId: entrada.id };
    });
  } catch (err) {
    if (err instanceof CarreraDeRespuesta) {
      return { ok: false, motivo: "YA_RESPONDIDA" };
    }
    throw err;
  }
}

class CarreraDeRespuesta extends Error {
  constructor() {
    super("la valoración ya estaba respondida");
  }
}

// ── Las correcciones del sanitario ────────────────────────────────────

export type ResultadoCorregir =
  | { ok: true }
  | { ok: false; motivo: "NO_CORREGIBLE"; mensaje: string };

/**
 * Añade una corrección. NO toca la respuesta del paciente: inserta una
 * fila con su autor y su hora, y la que vale es la última.
 *
 * Las dos negativas que la base también impone (no se corrige lo que nadie
 * contestó, no se corrige lo validado) se comprueban aquí para poder dar
 * un 409 con una frase, y allí para que sean verdad. Con sólo la de aquí,
 * un camino nuevo que insertara a mano se las saltaría; con sólo la de
 * allá, el cliente recibiría un error de constraint.
 */
export async function corregirValoracion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    valoracionId: string;
    preguntaId: string;
    valor: Respuesta;
    autorUserId: string;
  },
): Promise<ResultadoCorregir> {
  const fila = await prisma.clinicalAssessment.findFirst({
    where: { id: input.valoracionId, tenantId: input.tenantId },
    select: { status: true, questionnaireVersion: true },
  });
  if (!fila) {
    return {
      ok: false,
      motivo: "NO_CORREGIBLE",
      mensaje: "Esa valoración no existe.",
    };
  }
  if (fila.status === "PENDIENTE_PACIENTE") {
    return {
      ok: false,
      motivo: "NO_CORREGIBLE",
      mensaje: "El paciente todavía no ha contestado el test, así que no hay nada que corregir.",
    };
  }
  if (fila.status === "VALIDADA") {
    return {
      ok: false,
      motivo: "NO_CORREGIBLE",
      mensaje:
        "Esta valoración ya está validada y no se corrige. Si algo ha cambiado, repásala con una valoración nueva.",
    };
  }

  // La pregunta tiene que existir EN LA VERSIÓN CON LA QUE SE CONTESTÓ.
  // Sin esto, una corrección con un id inventado se guardaría para
  // siempre en una fila append-only, y la pantalla no sabría qué pintar.
  const cuestionario = cuestionarioDeVersion(fila.questionnaireVersion);
  const existe =
    cuestionario != null &&
    cuestionario.preguntas.some(
      (p) => p.id === input.preguntaId || p.seguimiento?.id === input.preguntaId,
    );
  if (!existe) {
    return {
      ok: false,
      motivo: "NO_CORREGIBLE",
      mensaje: "Esa pregunta no es del cuestionario de esta valoración.",
    };
  }

  await prisma.clinicalAssessmentCorrection.create({
    data: {
      tenantId: input.tenantId,
      assessmentId: input.valoracionId,
      questionId: input.preguntaId,
      value: input.valor,
      authorUserId: input.autorUserId,
    },
    select: { id: true },
  });
  return { ok: true };
}

// ── Validar ───────────────────────────────────────────────────────────

export type ResultadoValidar =
  | { ok: true; validadaEn: string }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Firma la validación: las tres confirmaciones, el autor y la hora, en un
 * solo UPDATE.
 *
 * **Las tres confirmaciones se escriben en este acto y no una a una.** La
 * pantalla las marca en memoria y las manda con la validación. Guardar
 * cada toque de casilla habría dejado medio estado en la base (dos
 * casillas marcadas y nadie que firme), que no significa nada, y habría
 * convertido tres gestos de la podóloga en tres escrituras sobre una
 * historia clínica. El CHECK de la base garantiza que una fila VALIDADA
 * las tiene las tres, que es lo que de verdad importa.
 *
 * Se re-decide con la función pura ANTES del UPDATE: el front ya pintó el
 * botón con ella, y aquí se vuelve a preguntar porque el front no es una
 * puerta.
 */
export async function validarValoracion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    valoracionId: string;
    confirmaciones: Confirmaciones;
    validadaPorUserId: string;
    ahora?: Date;
  },
): Promise<ResultadoValidar> {
  const ahora = input.ahora ?? new Date();
  const fila = await prisma.clinicalAssessment.findFirst({
    where: {
      id: input.valoracionId,
      tenantId: input.tenantId,
      clientId: input.clientId,
    },
    select: SELECT_VALORACION,
  });
  if (!fila) {
    return {
      ok: false,
      motivo: "NO_ENCONTRADA",
      mensaje: "Esa valoración no existe.",
    };
  }

  const [cuerpo, correcciones] = await Promise.all([
    cargarCuerpo(prisma as PrismaClient, fila),
    cargarCorrecciones(prisma as PrismaClient, fila.id),
  ]);
  const veredicto = puedeValidarse({
    cuestionario: cuestionarioDeVersion(fila.questionnaireVersion),
    estado: fila.status as EstadoValoracion,
    confirmaciones: input.confirmaciones,
    respuestasPaciente: cuerpo?.respuestas ?? {},
    correcciones,
  });
  if (!veredicto.puede) {
    return {
      ok: false,
      motivo: veredicto.motivo,
      mensaje: veredicto.mensaje,
    };
  }

  const movidas = await prisma.clinicalAssessment.updateMany({
    // `status: RESPONDIDA` en el WHERE cierra la carrera de dos
    // terminales: la segunda mueve cero filas y recibe su 409 en vez de
    // chocar con el trigger.
    where: {
      id: input.valoracionId,
      tenantId: input.tenantId,
      status: "RESPONDIDA",
    },
    data: {
      status: "VALIDADA",
      confirmedAllergies: input.confirmaciones.alergias,
      confirmedMedication: input.confirmaciones.medicacion,
      confirmedAlerts: input.confirmaciones.alertas,
      validatedAt: ahora,
      validatedByUserId: input.validadaPorUserId,
    },
  });
  if (movidas.count !== 1) {
    return {
      ok: false,
      motivo: "YA_VALIDADA",
      mensaje:
        "Alguien acaba de validar esta valoración. Recarga la pantalla para verla.",
    };
  }
  return { ok: true, validadaEn: ahora.toISOString() };
}
