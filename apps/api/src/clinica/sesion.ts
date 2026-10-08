// clinica-3 · la sesión y la exploración, contra la base.
//
// Las decisiones viven en `@mipiacetpv/clinica-sesion` (puras, compartidas
// con la pantalla); esto es lo que lee y escribe. Misma separación que
// `acceso.ts` / `resolverAccesoClinico` de clinica-1 y
// `primer-tratamiento.ts` de clinica-2, y por la misma razón: la tabla de
// casos de los tests es una tabla de verdad y no una maqueta de Prisma.
//
// ── Lo que este fichero NO hace ──────────────────────────────────────
//
//   · **No comprueba el acceso clínico ni apunta en el registro.** Eso lo
//     hace `conHistoria` en la ruta, y lo hace ANTES. Una función de datos
//     que además autorizara sería una segunda puerta, y dos puertas son
//     una puerta que algún día se queda abierta.
//   · **No decide quién ve importes.** Devuelve los datos completos y la
//     ruta serializa según `puedeVerImportes`. Si esta capa filtrara,
//     «lo que se cobra» y «lo que se enseña» saldrían de dos consultas
//     distintas.
//   · **No crea el ticket.** Ver `cerrarSesion` y la cabecera de
//     `agenda/checkout.ts`: el cobro lo crea el camino que ya existe.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  ACTOS_QUIROPODIA_V1,
  CONSEJOS_V1,
  ESTADOS_DE_HERIDA,
  FUENTE_DEL_RIESGO,
  LESIONES_V1,
  MAPA_PIE_V1,
  PENDIENTES_V1,
  PISADAS,
  PUNTOS_DE_LA_HERIDA,
  TIPOS_DE_PIE_BIOMECANICA,
  TIPOS_DE_VISITA,
  VERSION_DE_LA_EXPLORACION,
  VERSION_DEL_CUERPO,
  VERSION_DEL_CUERPO_V2,
  marcasLegibles,
  normalizarExploracion,
  normalizarSesionV2,
  partirDeLaUltima,
  pendientesAbiertos,
  resumenDeLaSesion,
  tiposDeLaSesion,
  versionesDeHoy,
  type CuerpoDeExploracion,
  type CuerpoDeSesion,
  type CuerpoDeSesionCualquiera,
  type CuerpoDeSesionV2,
  type EntradaDeCierreV2,
  type ExploracionEnPantalla,
  type Marcas,
  type PendienteCerrado,
  type PendienteCreado,
  type ResumenDeLaSesion,
  type ServicioDeSesion,
  type SesionAnterior,
  type TipoDeVisita,
} from "@mipiacetpv/clinica-sesion";
import type { PuertaPrimerTratamiento } from "@mipiacetpv/clinica-valoracion";

import { resolverPrimerTratamiento } from "./primer-tratamiento.js";
import {
  serviciosDeSesionConTipo,
  tratamientosPorId,
} from "./tratamientos.js";
import { tiposDeLosServicios } from "./tipos-de-visita.js";
import { vistaDeLaValoracion } from "./valoracion.js";

/** Cuántas sesiones anteriores entran en la gráfica del dolor. */
const SESIONES_EN_LA_GRAFICA = 6;

/** Cuántas sesiones hacia atrás se miran buscando la última cirugía. Una
 *  cirugía que hay que revisar es de hace semanas; doce visitas de
 *  quiropodia son medio año. */
const SESIONES_PARA_LA_CIRUGIA = 12;

// ── La cita de la que nace la sesión ──────────────────────────────────

export interface CitaDeLaSesion {
  id: string;
  clientId: string;
  /** ISO-8601. */
  empieza: string;
  status: string;
  /** Los servicios de la cita, en su orden: «Quiropodia». */
  servicios: readonly string[];
  /** Y sus ids, que es de donde sale el tipo de visita sugerido
   *  (clinica-5): «al abrir la sesión de una cita vienen marcados los
   *  tipos de los servicios de la cita» (decisión 3). Con los nombres no
   *  se puede: el tipo cuelga de la categoría del producto. */
  servicioIds: readonly string[];
  /** Quién atiende, de los assignments de STAFF. `null` en una cita sin
   *  profesional (no debería darse en una clínica, y no se inventa). */
  atiende: { userId: string; nombre: string } | null;
  ticketId: string | null;
}

/**
 * La cita, validada como de ESTE tenant y **con paciente**.
 *
 * `null` si no existe, es de otro tenant o es un walk-in sin cliente: una
 * sesión clínica es de una persona con historia, y «la sesión de nadie» no
 * es un caso que haya que soportar — es un caso que hay que negar.
 */
export async function cargarCitaDeLaSesion(
  prisma: PrismaClient,
  input: { tenantId: string; appointmentId: string },
): Promise<CitaDeLaSesion | null> {
  const filas = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      client_id: string | null;
      status: string;
      starts_at: Date;
      ticket_id: string | null;
    }>
  >(
    `SELECT id, client_id, status, lower(timeslot) AS starts_at, ticket_id
       FROM appointments
      WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    input.tenantId,
    input.appointmentId,
  );
  const fila = filas[0];
  if (!fila || fila.client_id == null) return null;

  const [items, assignments] = await Promise.all([
    prisma.appointmentItem.findMany({
      where: { appointmentId: fila.id },
      orderBy: { sortOrder: "asc" },
      select: { serviceId: true },
    }),
    prisma.appointmentAssignment.findMany({
      where: { appointmentId: fila.id, reservableType: "STAFF" },
      select: { staffUserId: true },
    }),
  ]);

  const serviceIds = [...new Set(items.map((i) => i.serviceId))];
  const staffId = assignments.find((a) => a.staffUserId != null)?.staffUserId;
  const [productos, staff] = await Promise.all([
    serviceIds.length
      ? prisma.product.findMany({
          where: { tenantId: input.tenantId, id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    staffId
      ? prisma.user.findFirst({
          where: { id: staffId, tenantId: input.tenantId },
          select: { id: true, alias: true, email: true },
        })
      : Promise.resolve(null),
  ]);
  const nombrePorId = new Map(productos.map((p) => [p.id, p.name]));

  return {
    id: fila.id,
    clientId: fila.client_id,
    empieza: fila.starts_at.toISOString(),
    status: fila.status,
    servicios: items
      .map((i) => nombrePorId.get(i.serviceId))
      .filter((n): n is string => n != null),
    servicioIds: serviceIds,
    atiende: staff
      ? { userId: staff.id, nombre: staff.alias ?? staff.email ?? "—" }
      : null,
    ticketId: fila.ticket_id,
  };
}

// ── Leer sesiones y exploraciones escritas ────────────────────────────

interface FilaDeEntrada {
  id: string;
  body: Prisma.JsonValue;
  createdAt: Date;
  appointmentId: string | null;
  author: { id: string; alias: string | null; email: string | null };
}

const SELECT_ENTRADA = {
  id: true,
  body: true,
  createdAt: true,
  appointmentId: true,
  author: { select: { id: true, alias: true, email: true } },
} as const;

function cuerpoDeSesion(fila: FilaDeEntrada): CuerpoDeSesion | null {
  const b = fila.body as unknown;
  if (b == null || typeof b !== "object") return null;
  return b as CuerpoDeSesion;
}

/**
 * La ÚLTIMA sesión cerrada de este paciente, sin contar la de esta cita.
 *
 * `exceptoCita` existe porque la pantalla la usa para «lo de la visita
 * anterior», y si la sesión de hoy ya estuviera cerrada se pintaría a sí
 * misma como anterior.
 */
export async function ultimaSesion(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; exceptoCita?: string | null },
): Promise<SesionAnterior | null> {
  const fila = await prisma.clinicalEntry.findFirst({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT_SESSION",
      ...(input.exceptoCita
        ? { NOT: { appointmentId: input.exceptoCita } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: SELECT_ENTRADA,
  });
  if (!fila) return null;
  const cuerpo = cuerpoDeSesion(fila);
  if (!cuerpo) return null;
  return {
    entryId: fila.id,
    fecha: fila.createdAt.toISOString(),
    marcas: (cuerpo.marcas ?? {}) as Marcas,
    tratamientos: cuerpo.tratamientos ?? [],
    consejos: cuerpo.consejos ?? [],
    dolor: cuerpo.dolor ?? 0,
    // clinica-5 · de aquí sale «Hoy toca». `tiposDeLaSesion` contesta las
    // dos versiones: en una v1 devuelve la lista vacía, y entonces la
    // banda no sale. No hay tabla de pendientes y no hace falta: lo
    // abierto está siempre en la última sesión, porque al cerrar se
    // vuelve a crear lo que no se hizo (ver `pendientes.ts`).
    pendientesCreados: tiposDeLaSesion(
      cuerpo as CuerpoDeSesionCualquiera,
    ).pendientesCreados,
  };
}

// ── clinica-5 · LA ÚLTIMA CIRUGÍA, para la cabecera de su tarjeta ─────

export interface UltimaCirugia {
  /** ISO-8601 de la visita en la que se operó. */
  fecha: string;
  /** La TÉCNICA: los nombres de los servicios de esa visita de cirugía
   *  («Matricectomía parcial», «Fenol»). Sale del `tratamientosNombre`
   *  congelado en el cuerpo y no del catálogo de hoy, así que una
   *  cirugía de hace dos años sigue diciendo con qué nombre se cobró. */
  tecnica: readonly string[];
  /** Y la ZONA: las zonas que estaban marcadas ese día, en palabras. */
  zonas: readonly string[];
}

/**
 * La última visita de tipo CIRUGÍA de este paciente, para la cabecera de
 * la tarjeta de revisión («Matricectomía parcial · dedo gordo izq. · 6
 * oct», decisión 7).
 *
 * ── Por qué se deduce de las sesiones y no hay tabla de cirugías ──────
 *
 * Porque todavía no existe el acto quirúrgico como pieza propia: hoy una
 * cirugía ES una visita de tipo CIRUGIA, con sus servicios y sus zonas
 * marcadas. Inventar aquí una tabla `cirugias` con técnica, lateralidad y
 * anestesia sería diseñar la pieza de clinica-4 (consentimientos e
 * informe) desde el sitio equivocado y sin que nadie la haya validado.
 *
 * Lo que esto da es lo que el mockup pinta y nada más: cuándo, con qué
 * servicio y dónde. Y lo da LEYENDO EL CUERPO CONGELADO, así que no
 * depende de que el catálogo siga teniendo ese servicio.
 *
 * `null` si no hay ninguna, y entonces la tarjeta lo dice en vez de
 * inventarse una fecha.
 */
export async function ultimaCirugia(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; exceptoCita?: string | null },
): Promise<UltimaCirugia | null> {
  // Las últimas N y no todas: una cirugía que hay que revisar es de hace
  // semanas, no de hace cinco años. Con `take` se lee una página del
  // índice `(tenant, client, kind, created_at DESC)` de clinica-3 y no la
  // historia entera de una paciente con ochenta visitas.
  const filas = await prisma.clinicalEntry.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT_SESSION",
      ...(input.exceptoCita
        ? { NOT: { appointmentId: input.exceptoCita } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: SESIONES_PARA_LA_CIRUGIA,
    select: { body: true, createdAt: true },
  });
  for (const fila of filas) {
    const cuerpo = fila.body as unknown as CuerpoDeSesionCualquiera | null;
    if (cuerpo == null || typeof cuerpo !== "object") continue;
    const leido = tiposDeLaSesion(cuerpo);
    if (!leido.tipos.includes("CIRUGIA")) continue;
    const c = cuerpo as CuerpoDeSesionV2;
    const nombres = c.tratamientosNombre ?? {};
    const tecnica = (leido.bloques.CIRUGIA?.servicios ?? [])
      .map((id) => nombres[id])
      .filter((n): n is string => n != null);
    return {
      fecha: fila.createdAt.toISOString(),
      tecnica,
      zonas: marcasLegibles({
        marcas: (c.marcas ?? {}) as Marcas,
        mapaVersion: c.mapaVersion ?? MAPA_PIE_V1.version,
        lesionesVersion: c.lesionesVersion ?? LESIONES_V1.version,
      }).map((m) => m.zona),
    };
  }
  return null;
}

/** La sesión YA CERRADA de esta cita, si la hay. Es lo que convierte la
 *  pantalla en «Sesión cerrada» y lo que el cobro lee para sus líneas. */
export async function sesionDeLaCita(
  prisma: PrismaClient,
  input: { tenantId: string; appointmentId: string },
): Promise<{
  entryId: string;
  cerradaEn: string;
  cuerpo: CuerpoDeSesion;
} | null> {
  const fila = await prisma.clinicalEntry.findFirst({
    where: {
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      kind: "TREATMENT_SESSION",
    },
    select: SELECT_ENTRADA,
  });
  if (!fila) return null;
  const cuerpo = cuerpoDeSesion(fila);
  if (!cuerpo) return null;
  return {
    entryId: fila.id,
    cerradaEn: fila.createdAt.toISOString(),
    cuerpo,
  };
}

/** La última exploración, para que la siguiente parta de ella (decisión de
 *  producto 5). */
export async function ultimaExploracion(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<{
  entryId: string;
  fecha: string;
  autor: string;
  exploracion: ExploracionEnPantalla;
} | null> {
  const fila = await prisma.clinicalEntry.findFirst({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "FOOT_EXAM",
    },
    orderBy: { createdAt: "desc" },
    select: SELECT_ENTRADA,
  });
  if (!fila) return null;
  const cuerpo = fila.body as unknown as CuerpoDeExploracion;
  return {
    entryId: fila.id,
    fecha: fila.createdAt.toISOString(),
    autor: nombreDe(fila.author),
    exploracion: normalizarExploracion({
      pulsos: cuerpo?.pulsos,
      sinSensibilidad: cuerpo?.sinSensibilidad,
      tipoDePie: cuerpo?.tipoDePie,
    }),
  };
}

export interface PuntoDeDolor {
  /** ISO-8601 del día de la sesión. La pantalla lo formatea («7 sep»). */
  fecha: string;
  dolor: number;
}

/**
 * La gráfica del dolor, sesión a sesión. Las últimas seis, de la más
 * antigua a la más reciente — que es como se lee una gráfica.
 *
 * Seis y no todas: la gráfica del mockup tiene tres barras y lo que se
 * mira es la tendencia reciente. Un paciente de hace cuatro años con
 * ochenta sesiones haría una barra de un píxel por visita, que no es una
 * gráfica: es una textura.
 */
export async function historialDeDolor(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; exceptoCita?: string | null },
): Promise<PuntoDeDolor[]> {
  const filas = await prisma.clinicalEntry.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT_SESSION",
      ...(input.exceptoCita
        ? { NOT: { appointmentId: input.exceptoCita } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: SESIONES_EN_LA_GRAFICA,
    select: { body: true, createdAt: true },
  });
  return filas
    .map((f) => {
      const cuerpo = f.body as unknown as CuerpoDeSesion;
      return {
        fecha: f.createdAt.toISOString(),
        dolor: typeof cuerpo?.dolor === "number" ? cuerpo.dolor : 0,
      };
    })
    .reverse();
}

/** Cuántas sesiones cerradas lleva este paciente. Es el «nº de visita» de
 *  la cabecera, y la de hoy cuenta: la 3.ª visita es la que está pasando. */
async function visitasCerradas(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<number> {
  return prisma.clinicalEntry.count({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT_SESSION",
    },
  });
}

function nombreDe(u: {
  alias: string | null;
  email: string | null;
}): string {
  return u.alias ?? u.email ?? "—";
}

// ── La pantalla entera, en una llamada ────────────────────────────────

export interface CabeceraDeLaSesion {
  paciente: {
    id: string;
    nombre: string;
    /** Años cumplidos. `null` sin fecha de nacimiento: no se inventa. */
    edad: number | null;
    telefono: string | null;
  };
  /** «10:30 · Quiropodia» se arma en la pantalla con estos dos. */
  citaDeHoy: { empieza: string; servicios: readonly string[] };
  /** La 3.ª visita es la que está pasando, así que la de hoy cuenta. */
  numeroDeVisita: number;
  /** ISO-8601 de la sesión anterior, o `null` si es la primera. */
  visitaAnterior: string | null;
  atiende: { userId: string; nombre: string } | null;
  /**
   * LA FRANJA ROJA. Las mismas alertas que pinta la pantalla de la
   * valoración, calculadas con la MISMA función
   * (`clinica-valoracion::alertasDe`, a través de `vistaDeLaValoracion`).
   *
   * No se recalculan aquí ni se copia la lógica: lo que la franja enseña
   * tiene que ser idéntico en las dos pantallas, y dos sitios que lo
   * calculen son dos sitios que algún día dirán cosas distintas sobre si
   * una persona está anticoagulada.
   */
  alertas: readonly string[];
  /**
   * clinica-5 · LAS IDS de esas alertas, para las alertas cruzadas.
   *
   * Van además de los textos y no en su lugar. La tabla de cruces
   * (`ALERTAS_CRUZADAS_V1`) cruza por `preguntaId` del cuestionario de
   * clinica-2 (`diab`, `antic`…) y nunca por el texto: el texto lo escribe
   * el cuestionario y se puede reescribir mañana sin que nadie piense en
   * la tabla, y una alerta que deja de dispararse porque alguien corrigió
   * una tilde es el peor fallo posible en una señal de seguridad.
   */
  alertaIds: readonly string[];
}

export interface VistaDeLaSesion {
  cita: CitaDeLaSesion;
  cabecera: CabeceraDeLaSesion;
  /** La puerta: sin valoración validada no hay sesión (prompt §2). */
  puerta: PuertaPrimerTratamiento;
  /** Los botones de tratamiento, del catálogo, cada uno con su TIPO DE
   *  VISITA y su nivel de quiropodia si lo es (clinica-5). Sin importes
   *  para quien no los ve — lo quita la serialización de la ruta. */
  tratamientos: readonly ServicioDeSesion[];
  /**
   * clinica-5 · los tipos que vienen MARCADOS al abrir (decisión 3): los
   * de los servicios de la cita. Se pueden añadir y quitar.
   *
   * Vacío si los servicios de la cita no tienen tipo todavía, y entonces
   * la podóloga marca el que sea. Lo que no se hace es sugerir uno por
   * defecto: «quiropodia porque es lo más normal» sería escribir en la
   * historia el tipo que no se eligió.
   */
  tiposSugeridos: readonly TipoDeVisita[];
  /** clinica-5 · «Hoy toca»: lo que la sesión anterior dejó apuntado.
   *  Vacío si la anterior es una v1 o si no dejó nada. */
  pendientes: readonly PendienteCreado[];
  /** clinica-5 · la cabecera de la tarjeta de revisión de cirugía. */
  ultimaCirugia: UltimaCirugia | null;
  /** Lo de la visita anterior, para el naranja suave y para «Igual que la
   *  última vez». */
  anterior: SesionAnterior | null;
  /** La gráfica del dolor, sin la de hoy. */
  dolorHistorico: readonly PuntoDeDolor[];
  /** La exploración de la que parte la siguiente, y cuándo se hizo. */
  exploracion: {
    departeDe: ExploracionEnPantalla;
    ultima: { fecha: string; autor: string } | null;
  };
  /** La sesión de esta cita si YA está cerrada. La pantalla entra directa
   *  a «Sesión cerrada» en vez de ofrecer cerrarla otra vez. */
  cerrada: SesionCerradaView | null;
  /** El mapa, las lesiones y los consejos con los que se pinta. Viajan con
   *  la respuesta —y no los lleva la pantalla por su cuenta— porque son la
   *  versión con la que se va a escribir, y la pantalla tiene que pintar
   *  esa y no «la que tenga compilada». */
  listas: {
    mapa: typeof MAPA_PIE_V1;
    lesiones: typeof LESIONES_V1;
    consejos: typeof CONSEJOS_V1;
    // clinica-5 · y las de este bloque, por la MISMA razón que las tres
    // de arriba: son la versión con la que se va a ESCRIBIR, y una
    // pantalla que pintara «la que tiene compilada» podría ofrecer un
    // acto o un pendiente que el servidor va a tirar.
    actos: typeof ACTOS_QUIROPODIA_V1;
    estadosDeHerida: typeof ESTADOS_DE_HERIDA;
    puntos: typeof PUNTOS_DE_LA_HERIDA;
    tiposDePieBiomecanica: typeof TIPOS_DE_PIE_BIOMECANICA;
    pisadas: typeof PISADAS;
    pendientes: typeof PENDIENTES_V1;
    /** Las versiones de todas ellas, como van a quedar en el cuerpo. */
    versiones: ReturnType<typeof versionesDeHoy>;
    /** La cita de la guía del riesgo, para que la tarjeta la escriba con
     *  las mismas palabras que el código. */
    fuenteDelRiesgo: string;
  };
}

export interface SesionCerradaView {
  entryId: string;
  cerradaEn: string;
  firma: CuerpoDeSesion["firma"];
  cuerpo: CuerpoDeSesion;
  /** Las marcas en palabras, con el vocabulario de SU versión. */
  marcas: ReturnType<typeof marcasLegibles>;
  /** El resumen de lo que pasa a caja. Sin importes para quien no los ve. */
  resumen: ResumenDeLaSesion;
  /** Si la cita ya tiene un cobro hecho. La pantalla no ofrece «Cobrar
   *  ahora» sobre algo ya cobrado. */
  yaCobrada: boolean;
}

export async function vistaDeLaSesion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    cita: CitaDeLaSesion;
    verImportes: boolean;
  },
): Promise<VistaDeLaSesion> {
  const { tenantId, cita } = input;
  const clientId = cita.clientId;

  const [
    paciente,
    valoracion,
    puerta,
    catalogo,
    anterior,
    dolorHistorico,
    exploracion,
    cerradaFila,
    visitas,
    cirugia,
    tiposDeLaCita,
  ] = await Promise.all([
    prisma.client.findFirstOrThrow({
      where: { id: clientId, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        birthdate: true,
      },
    }),
    // Las alertas salen de AQUÍ y no de un cálculo propio: ver
    // `CabeceraDeLaSesion.alertas`.
    vistaDeLaValoracion(prisma, { tenantId, clientId }),
    resolverPrimerTratamiento(prisma, { tenantId, clientId }),
    serviciosDeSesionConTipo(prisma, tenantId),
    ultimaSesion(prisma, { tenantId, clientId, exceptoCita: cita.id }),
    historialDeDolor(prisma, { tenantId, clientId, exceptoCita: cita.id }),
    ultimaExploracion(prisma, { tenantId, clientId }),
    sesionDeLaCita(prisma, { tenantId, appointmentId: cita.id }),
    visitasCerradas(prisma, { tenantId, clientId }),
    ultimaCirugia(prisma, { tenantId, clientId, exceptoCita: cita.id }),
    // clinica-5 · los tipos de los SERVICIOS DE LA CITA, que son los que
    // vienen marcados al abrir (decisión 3).
    tiposDeLosServicios(prisma, tenantId, cita.servicioIds),
  ]);

  const cerrada = cerradaFila
    ? await vistaDeSesionCerrada(prisma, {
        tenantId,
        cerrada: cerradaFila,
        ticketId: cita.ticketId,
        verImportes: input.verImportes,
      })
    : null;

  return {
    cita,
    cabecera: {
      paciente: {
        id: paciente.id,
        nombre: `${paciente.firstName} ${paciente.lastName}`.trim(),
        edad: edadDe(paciente.birthdate),
        telefono: paciente.phone,
      },
      citaDeHoy: { empieza: cita.empieza, servicios: cita.servicios },
      // La de hoy cuenta: si hay dos cerradas, hoy es la 3.ª. Y si la de
      // hoy YA está cerrada, no se cuenta dos veces.
      numeroDeVisita: cerradaFila ? visitas : visitas + 1,
      visitaAnterior: anterior?.fecha ?? null,
      atiende: cita.atiende,
      alertas: valoracion.alertas.alertas.map((a) => a.texto),
      alertaIds: valoracion.alertas.alertas.map((a) => a.preguntaId),
    },
    puerta,
    tratamientos: catalogo,
    // En el orden de la lista de tipos y sin repetidos: una cita con
    // «Quiropodia» y «Cura» marca los dos, una vez cada uno.
    tiposSugeridos: TIPOS_DE_VISITA.filter((t) =>
      [...tiposDeLaCita.values()].some((x) => x.tipo === t),
    ),
    pendientes: pendientesAbiertos(anterior),
    ultimaCirugia: cirugia,
    anterior,
    dolorHistorico,
    exploracion: {
      departeDe: partirDeLaUltima(exploracion?.exploracion ?? null),
      ultima: exploracion
        ? { fecha: exploracion.fecha, autor: exploracion.autor }
        : null,
    },
    cerrada,
    listas: {
      mapa: MAPA_PIE_V1,
      lesiones: LESIONES_V1,
      consejos: CONSEJOS_V1,
      actos: ACTOS_QUIROPODIA_V1,
      estadosDeHerida: ESTADOS_DE_HERIDA,
      puntos: PUNTOS_DE_LA_HERIDA,
      tiposDePieBiomecanica: TIPOS_DE_PIE_BIOMECANICA,
      pisadas: PISADAS,
      pendientes: PENDIENTES_V1,
      versiones: versionesDeHoy(),
      fuenteDelRiesgo: FUENTE_DEL_RIESGO,
    },
  };
}

async function vistaDeSesionCerrada(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    cerrada: { entryId: string; cerradaEn: string; cuerpo: CuerpoDeSesion };
    ticketId: string | null;
    verImportes: boolean;
  },
): Promise<SesionCerradaView> {
  const { cuerpo } = input.cerrada;
  // Por id y SIN exigir `active` ni la marca: una sesión firmada se cobra
  // aunque el catálogo haya cambiado desde entonces (ver
  // `tratamientosPorId`).
  const catalogo = await tratamientosPorId(
    prisma,
    input.tenantId,
    cuerpo.tratamientos ?? [],
  );
  const yaCobrada = input.ticketId
    ? await ticketCobrado(prisma, input.ticketId)
    : false;
  return {
    entryId: input.cerrada.entryId,
    cerradaEn: input.cerrada.cerradaEn,
    firma: cuerpo.firma,
    cuerpo,
    marcas: marcasLegibles({
      marcas: (cuerpo.marcas ?? {}) as Marcas,
      mapaVersion: cuerpo.mapaVersion ?? MAPA_PIE_V1.version,
      lesionesVersion: cuerpo.lesionesVersion ?? LESIONES_V1.version,
    }),
    resumen: resumenDeLaSesion({
      tratamientos: cuerpo.tratamientos ?? [],
      catalogo,
      dolor: cuerpo.dolor ?? null,
      verImportes: input.verImportes,
    }),
    yaCobrada,
  };
}

async function ticketCobrado(
  prisma: PrismaClient,
  ticketId: string,
): Promise<boolean> {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  return t != null && t.status !== "DRAFT";
}

/** Los años cumplidos. `null` sin fecha: una edad inventada en una
 *  historia clínica es peor que un hueco. */
export function edadDe(
  birthdate: Date | null,
  hoy: Date = new Date(),
): number | null {
  if (!birthdate) return null;
  let edad = hoy.getUTCFullYear() - birthdate.getUTCFullYear();
  const mes = hoy.getUTCMonth() - birthdate.getUTCMonth();
  if (mes < 0 || (mes === 0 && hoy.getUTCDate() < birthdate.getUTCDate())) {
    edad -= 1;
  }
  return edad >= 0 && edad < 130 ? edad : null;
}

// ── Escribir la exploración ───────────────────────────────────────────

/**
 * Guarda una exploración NUEVA. La anterior no se toca: es historia, y la
 * siguiente partió de ella pero no la sustituye.
 *
 * **No pasa por la puerta de la valoración** (prompt §2): la exploración
 * es parte de la primera visita, que es justo la que puede no tener la
 * valoración validada todavía.
 */
export async function guardarExploracion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    appointmentId: string;
    autorUserId: string;
    pulsos?: Record<string, unknown> | null;
    sinSensibilidad?: readonly unknown[] | null;
    tipoDePie?: unknown;
  },
): Promise<{ entryId: string; cuerpo: CuerpoDeExploracion }> {
  const limpia = normalizarExploracion({
    pulsos: input.pulsos as never,
    sinSensibilidad: input.sinSensibilidad,
    tipoDePie: input.tipoDePie,
  });
  const firma = await firmaDe(prisma, input.tenantId, input.autorUserId);
  const cuerpo: CuerpoDeExploracion = {
    v: VERSION_DE_LA_EXPLORACION,
    mapaVersion: MAPA_PIE_V1.version,
    pulsos: limpia.pulsos,
    sinSensibilidad: limpia.sinSensibilidad,
    tipoDePie: limpia.tipoDePie,
    firma,
  };
  const creada = await prisma.clinicalEntry.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      authorUserId: input.autorUserId,
      appointmentId: input.appointmentId,
      kind: "FOOT_EXAM",
      body: cuerpo as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { entryId: creada.id, cuerpo };
}

// ── Cerrar la sesión ──────────────────────────────────────────────────

export type CierreDeSesion =
  | { ok: true; yaEstaba: boolean; cerrada: SesionCerradaView }
  | {
      ok: false;
      motivo: "SIN_VALORACION_VALIDADA" | "FALTA_DOLOR" | "SIN_TIPOS";
      mensaje: string;
    };

/**
 * CERRAR = FIRMAR. Escribe la sesión, una sola vez, y a partir de ahí el
 * trigger `clinical_entries_inmutable` de clinica-1 la deja congelada.
 *
 * ── Por qué esto NO crea el ticket ───────────────────────────────────
 *
 * El prompt pide «crear UNA SOLA VEZ el cobro pendiente de esa cita con
 * las líneas de los tratamientos, **reutilizando el camino que ya existe
 * de la cita a la caja**». Y reutilizarlo de verdad quiere decir no
 * crear el ticket aquí, por una razón que no es de gusto:
 *
 *   **El ticket necesita una caja con turno abierto, y el sanitario sin
 *   caja no tiene ninguna.** `checkoutAppointment` exige `registerId` y un
 *   `Shift` abierto en esa caja (es lo que hace que el cobro impute al
 *   turno correcto, `shift/impute.ts`). Un `CLINICIAN` entra al TPV sin
 *   abrir turno a propósito desde clinica-1 §7 — pedirle un arqueo de una
 *   caja que no toca. Para crear el ticket al cerrar habría que inventarle
 *   un turno, y un turno inventado es un cobro imputado a un arqueo que
 *   nadie hizo.
 *
 * Así que el reparto es:
 *
 *   · **cerrar** escribe la sesión firmada con sus tratamientos. Ése ES el
 *     cobro pendiente: desde ese instante la cita tiene qué cobrar y la
 *     recepción lo ve en su lista.
 *   · **cobrar** lo hace `POST /agenda/appointments/:id/checkout`, el
 *     endpoint que ya existía, sin una línea nueva en su contrato. Lo
 *     llama la dueña desde «Cobrar ahora» de la pantalla de sesión cerrada
 *     y la recepción desde «Cobrar en caja» de la agenda: **el mismo
 *     botón de siempre**. Lo único que cambia en ese camino es de dónde
 *     salen las líneas cuando hay sesión cerrada (ver `checkout.ts`).
 *
 * Y la idempotencia queda sostenida por DOS capas independientes, que
 * conviene saber cuáles son:
 *
 *   1. **Una sesión por cita** → el índice parcial
 *      `clinical_entries_una_sesion_por_cita`. Cerrar dos veces no escribe
 *      dos sesiones; el segundo cierre devuelve la misma con
 *      `yaEstaba: true` y un 200, porque un doble toque no es un error.
 *   2. **Un ticket por cita** → `appointments.ticket_id` es UNIQUE y
 *      `checkoutAppointment` devuelve el borrador enlazado en vez de abrir
 *      otro (B-reservas-5 F5).
 *
 * Con la red cortada a medias, lo que puede pasar es que la sesión quede
 * escrita y la pantalla no reciba la respuesta. El reintento cae en el
 * camino 1 y la podóloga ve su sesión cerrada, que es lo correcto: la
 * sesión ya pasó.
 */
export async function cerrarSesion(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    cita: CitaDeLaSesion;
    autorUserId: string;
    verImportes: boolean;
    // clinica-5 · lo que la pantalla manda ahora: los tipos y sus
    // bloques. `tratamientos` ya no viaja — LO DERIVA EL SERVIDOR de los
    // bloques (`serviciosDeLaSesion`) y lo congela en el cuerpo. Dejarlo
    // llegar de fuera habría sido dejar que la pantalla eligiera qué se
    // cobra sin pasar por la regla del nivel.
    tipos: readonly unknown[];
    bloques: EntradaDeCierreV2["bloques"];
    marcas: Record<string, unknown>;
    dolor: unknown;
    evolucion: unknown;
    consejos: readonly string[];
    proximaCita: unknown;
    nota: unknown;
    /** Los que la podóloga ha cerrado a mano o contestando el diálogo. */
    pendientesCerrados: readonly PendienteCerrado[];
    /** Y lo que apunta para la próxima visita. */
    pendientesNuevos: readonly {
      id: string;
      zona: string | null;
      nota: string | null;
    }[];
  },
): Promise<CierreDeSesion> {
  const { tenantId, cita } = input;

  // 1 · LA PUERTA. Sin valoración validada no hay sesión.
  const puerta = await resolverPrimerTratamiento(prisma, {
    tenantId,
    clientId: cita.clientId,
  });
  if (!puerta.puede) {
    return {
      ok: false,
      motivo: "SIN_VALORACION_VALIDADA",
      mensaje: puerta.mensaje,
    };
  }

  // 2 · ¿ya estaba cerrada? Se contesta antes de escribir para que el
  // doble toque normal no genere un error de índice en los logs. El índice
  // sigue siendo la garantía: esto es sólo cortesía (ver el `catch`).
  const yaEstaba = await sesionDeLaCita(prisma, {
    tenantId,
    appointmentId: cita.id,
  });
  if (yaEstaba) {
    return {
      ok: true,
      yaEstaba: true,
      cerrada: await vistaDeSesionCerrada(prisma, {
        tenantId,
        cerrada: yaEstaba,
        ticketId: cita.ticketId,
        verImportes: input.verImportes,
      }),
    };
  }

  // 3 · lo que tiene mal SENTIDO (el schema ya rechazó lo que tiene mala
  // forma). La misma función pura que la pantalla usa para el botón.
  //
  // Y DOS lecturas más que la v1 no necesitaba, las dos porque el servidor
  // vuelve a decidir en vez de creerse lo que llega:
  //
  //   · las ALERTAS vigentes, para recalcular los avisos cruzados que se
  //     dan por enseñados. Si la pantalla mandara la lista, una sesión
  //     podría constar como «avisada» sin que nadie viera el aviso.
  //   · los PENDIENTES abiertos de la última sesión, para que el cierre
  //     automático se calcule con lo que de verdad se ha marcado hoy y
  //     para que lo que no se hizo se arrastre. Es la garantía del
  //     prompt: un pendiente sin hacer no se cae, haga lo que haga la
  //     pantalla.
  const [catalogo, valoracion, anterior] = await Promise.all([
    serviciosDeSesionConTipo(prisma, tenantId),
    vistaDeLaValoracion(prisma, { tenantId, clientId: cita.clientId }),
    ultimaSesion(prisma, {
      tenantId,
      clientId: cita.clientId,
      exceptoCita: cita.id,
    }),
  ]);
  const normal = normalizarSesionV2({
    tipos: input.tipos,
    bloques: input.bloques,
    marcas: input.marcas as never,
    catalogo,
    dolor: input.dolor,
    evolucion: input.evolucion,
    consejos: input.consejos,
    proximaCita: input.proximaCita,
    nota: input.nota,
    alertaIds: valoracion.alertas.alertas.map((a) => a.preguntaId),
    pendientesAbiertos: pendientesAbiertos(anterior),
    pendientesCerradosAMano: input.pendientesCerrados,
    pendientesNuevos: input.pendientesNuevos,
    // El reloj entra como dato: el paquete no tiene ninguno.
    hoy: new Date().toISOString(),
  });
  if (!normal.ok) {
    return { ok: false, motivo: normal.motivo, mensaje: normal.mensaje };
  }

  // 4 · LA FIRMA y la escritura.
  const firma = await firmaDe(prisma, tenantId, input.autorUserId);
  const cuerpo: CuerpoDeSesionV2 = { ...normal.cuerpo, firma };

  let entryId: string;
  try {
    const creada = await prisma.clinicalEntry.create({
      data: {
        tenantId,
        clientId: cita.clientId,
        authorUserId: input.autorUserId,
        appointmentId: cita.id,
        kind: "TREATMENT_SESSION",
        body: cuerpo as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    entryId = creada.id;
  } catch (err) {
    // LA CARRERA, y por qué este `catch` no es defensivo sino la mitad de
    // la garantía: dos toques simultáneos (la podóloga y su iPad lento, o
    // dos pestañas) pasan los dos por el paso 2 sin ver nada y llegan los
    // dos aquí. El índice único rechaza al segundo con 23505, y lo
    // correcto para ese segundo NO es un error: es la sesión que acaba de
    // escribir el primero. Es la misma forma que el `ON CONFLICT DO
    // NOTHING` del acceso por cita de clinica-1.
    if (!esChoqueDeSesionUnica(err)) throw err;
    const ahora = await sesionDeLaCita(prisma, {
      tenantId,
      appointmentId: cita.id,
    });
    if (!ahora) throw err;
    return {
      ok: true,
      yaEstaba: true,
      cerrada: await vistaDeSesionCerrada(prisma, {
        tenantId,
        cerrada: ahora,
        ticketId: cita.ticketId,
        verImportes: input.verImportes,
      }),
    };
  }

  return {
    ok: true,
    yaEstaba: false,
    cerrada: await vistaDeSesionCerrada(prisma, {
      tenantId,
      cerrada: { entryId, cerradaEn: new Date().toISOString(), cuerpo },
      ticketId: cita.ticketId,
      verImportes: input.verImportes,
    }),
  };
}

/** El 23505 del índice de «una sesión por cita», y sólo ése. Cualquier
 *  otro error sube: un fallo de base no se puede confundir con un doble
 *  toque. */
function esChoqueDeSesionUnica(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = JSON.stringify(e.meta?.target ?? "");
  return (
    target.includes("clinical_entries_una_sesion_por_cita") ||
    target.includes("appointment_id")
  );
}

/**
 * LA FIRMA, congelada en el cuerpo.
 *
 * El autor ya está en `author_user_id`, pero el nº de colegiado vive en
 * `users` y cambia (una errata, una renumeración del colegio). Lo que hay
 * que poder enseñar dentro de cinco años es con qué número firmó ESE día.
 * Es la misma decisión que `TicketLine.nameSnapshot`.
 */
async function firmaDe(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
): Promise<CuerpoDeSesion["firma"]> {
  const u = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { alias: true, email: true, clinicianLicense: true },
  });
  return {
    autorNombre: u ? nombreDe(u) : "—",
    colegiado: u?.clinicianLicense ?? null,
    firmadaEn: new Date().toISOString(),
  };
}

export { VERSION_DEL_CUERPO };
