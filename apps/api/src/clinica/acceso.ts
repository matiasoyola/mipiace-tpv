// clinica-1 · LA función que decide si alguien puede ver una historia.
//
// Una sola, pura y testeada. Ninguna ruta repite la regla por su cuenta,
// y la razón no es elegancia: cada pantalla clínica que viene después
// (valoración, exploración, sesión, fotos, informe) tendría que acordarse
// de aplicarla, y alguna se olvidaría. El olvido aquí no es un bug de
// usabilidad: es una historia clínica que ve quien no debe.
//
// La regla, en el orden en que se evalúa y por qué ese orden:
//
//   1. ¿Tiene el tenant la clínica encendida? Si no, no hay historia que
//      ver. Va primero porque es la única condición que no habla de esta
//      persona: un tenant apagado no tiene sanitarios ni accesos, y
//      contestar "no eres sanitario" ahí sería contestar otra pregunta.
//   2. ¿Es sanitario? La marca (`isClinician`), no el rol. Una dueña NO
//      sanitaria —un gerente— administra el negocio y no ve historias.
//   3. ¿Alcanza a este paciente? Y aquí hay DOS reglas, no una, porque
//      hay dos verticales con historia clínica y el alcance significa
//      cosas distintas en cada una:
//
//        · **Clínica** (clinica-1) · `ALL` sí; `SELECTION` sólo con un
//          acceso VIGENTE (`ClinicalAccess` con `revokedAt = null`). El
//          acceso nace de la CITA.
//        · **Residencia** (residencia-1, D-51) · rol de cuidado vigente
//          **y** (rol de alcance total **o** el residente tiene una cama
//          vigente en una planta de su zona vigente). Aquí no hay citas:
//          hay zonas y turnos, así que `ClinicalAccess` no tendría de
//          dónde llenarse.
//
//      La que se aplica la decide `Tenant.residenciaEnabled`, y **en un
//      tenant que no es residencia esta función contesta exactamente lo
//      que contestaba antes de residencia-1**: el campo `residencia` del
//      estado llega `null` y la rama no se mira. Eso es lo que hace que
//      los quince clientes de hoy no noten el bloque.
//
// Lo que esta función NO hace, y es deliberado:
//
//   · **No mira el rol de negocio.** Ni `OWNER`, ni `MANAGER`, ni
//     `CLINICIAN`, ni `CASHIER` aparecen aquí. Quien decide es la marca.
//     Si mañana entra un cuarto rol de negocio, esta función no cambia —
//     que es la mitad de la razón por la que rol y marca se guardan
//     separados. Lo mismo vale para el rol de CUIDADO de la residencia:
//     aquí entra ya resuelto a tres booleanos, no como una lista de roles
//     que esta función tendría que interpretar.
//   · **No se duplica.** residencia-1 amplía ESTA función en vez de
//     escribir una segunda. Con dos, cada pantalla de residencia tendría
//     que acordarse de cuál le toca, y la de la puerta —que es la que
//     tendrá quince tablets abiertas a la vez— se equivocaría una vez y no
//     volvería a notarse.
//   · **No consulta la base.** Recibe el estado ya leído. Así la tabla de
//     casos del test es una tabla de verdad y no una maqueta de Prisma, y
//     así `resolverAccesoClinico` puede leer las tres cosas en una sola
//     ida a la base.
//   · **No apunta nada en el registro.** Eso lo hace `registro.ts`, y lo
//     hace TAMBIÉN cuando esta función dice no (ADR: los intentos
//     denegados son justo los que interesa ver).

import type { PrismaClient } from "@mipiacetpv/db";

/** El alcance de un sanitario. Mismo juego de valores que el enum. */
export type AlcanceClinico = "ALL" | "SELECTION";

/**
 * Lo que hay que saber para contestar. Las tres piezas vienen de la base
 * (`resolverAccesoClinico` las lee), pero la decisión no las vuelve a
 * pedir: entran como datos.
 */
export interface EstadoClinico {
  /** `Tenant.clinicalRecordsEnabled`. */
  clinicaEncendida: boolean;
  /** `User.isClinician`. La MARCA, no el rol. */
  esSanitario: boolean;
  /** `User.clinicalScope`. Sólo significa algo si `esSanitario`. */
  alcance: AlcanceClinico;
  /**
   * ¿Hay una fila de `ClinicalAccess` para (este sanitario, este
   * paciente) sin revocar? Con `alcance = "ALL"` no se mira.
   */
  accesoVigente: boolean;
  /**
   * residencia-1 (D-51) · el estado de la RESIDENCIA, o `null`.
   *
   * `null` —y es lo que llega en los quince tenants de hoy y en la clínica
   * de podología— significa «este tenant no es una residencia», y entonces
   * esta función se comporta EXACTAMENTE como antes de residencia-1.
   *
   * Opcional en el tipo y no obligatorio-nullable a propósito: así todo el
   * código que ya construía un `EstadoClinico` —y los dobles de Prisma de
   * la suite de la clínica— sigue compilando sin tocar una línea. Un
   * olvido cae del lado de «no es residencia», que es el lado que no
   * cambia nada.
   */
  residencia?: EstadoResidencia | null;
}

/**
 * residencia-1 (D-51) · lo que hay que saber de la residencia, ya resuelto
 * a tres booleanos.
 *
 * Tres y no una lista de roles: la función decide, no interpreta. Quien
 * lee la base (`resolverAccesoClinico`) es quien sabe que «alcance total»
 * sale de `CareRole.fullScope` y que «en mi zona» es un cruce de
 * `CareZoneAssignment` con `BedAssignment`; aquí sólo se combinan.
 */
export interface EstadoResidencia {
  /**
   * ¿Tiene esta persona algún rol de cuidado VIGENTE? Vigente =
   * `revokedAt IS NULL`, `fromAt <= ahora` y (`toAt IS NULL` o `toAt >
   * ahora`), y el rol activo.
   *
   * Es la primera condición y la que de verdad separa: en una residencia,
   * quien no tiene rol de cuidado no es personal de cuidado, aunque lleve
   * la marca sanitaria puesta de otro sitio.
   */
  rolDeCuidadoVigente: boolean;
  /**
   * ¿Alguno de esos roles vigentes ve TODO EL CENTRO? DUE, médico, calidad
   * y dirección (`CareRole.fullScope`). También lo da una zona vigente de
   * «todo el centro» (`CareZoneAssignment` con `floorId = null`).
   */
  alcanceTotal: boolean;
  /**
   * ¿Este residente tiene una cama VIGENTE en una planta de la zona
   * vigente de esta persona?
   *
   * `false` cuando el residente no tiene cama (ingreso pendiente, o ya se
   * le dio de alta): un residente sin cama no está en la zona de nadie, y
   * eso es lo correcto — quien lo necesite ver es dirección o la DUE, que
   * tienen alcance total. Está en la tabla de casos.
   */
  residenteEnMiZona: boolean;
}

/** Por qué se dijo no. Se guarda en el registro y decide el HTTP. */
export type MotivoDenegado =
  | "CLINICA_APAGADA"
  | "NO_SANITARIO"
  | "SIN_ACCESO_AL_PACIENTE"
  // residencia-1 · los dos motivos de la residencia. Son dos y no uno
  // porque dicen cosas distintas y se arreglan en sitios distintos: el
  // primero se arregla en Personal (dale un rol de cuidado), el segundo en
  // Personal también pero en otra línea (dale la planta) o en Edificio
  // (ponle cama al residente). Un único "no puedes" habría dejado a la
  // encargada probando.
  | "SIN_ROL_DE_CUIDADO"
  | "RESIDENTE_FUERA_DE_TU_ZONA";

export type Veredicto =
  | { puede: true }
  | { puede: false; motivo: MotivoDenegado; mensaje: string };

// Los mensajes son los que ve una persona, así que dicen qué hacer. El de
// `CLINICA_APAGADA` no lo lee nadie desde fuera: esa ruta contesta 404
// (ver `gate.ts`), y el mensaje existe para la línea del registro y para
// el log de la aplicación.
const MENSAJES: Record<MotivoDenegado, string> = {
  CLINICA_APAGADA:
    "Este negocio no tiene el módulo de historia clínica activado.",
  NO_SANITARIO:
    "Sólo el personal sanitario puede abrir la historia clínica de un paciente.",
  SIN_ACCESO_AL_PACIENTE:
    "No tienes acceso a la historia de este paciente. La dueña o el encargado pueden dártelo desde Personal.",
  SIN_ROL_DE_CUIDADO:
    "No tienes ningún rol de cuidado vigente en este centro. La dirección te lo asigna desde Personal.",
  RESIDENTE_FUERA_DE_TU_ZONA:
    "Este residente no está en tu zona. La dirección puede ampliarte la planta desde Personal, o asignarle una cama en la tuya.",
};

function no(motivo: MotivoDenegado): Veredicto {
  return { puede: false, motivo, mensaje: MENSAJES[motivo] };
}

/**
 * ¿Puede este usuario ver la historia de este paciente?
 *
 * Pura: mismas entradas, misma respuesta, sin base de datos ni reloj.
 */
export function puedeVerHistoria(estado: EstadoClinico): Veredicto {
  if (!estado.clinicaEncendida) return no("CLINICA_APAGADA");
  if (!estado.esSanitario) return no("NO_SANITARIO");
  // residencia-1 · la rama de la residencia, y va DESPUÉS de las dos
  // condiciones que comparten las dos verticales:
  //
  //   · la del módulo, porque en una residencia la clínica está encendida
  //     por obligación (CHECK `tenants_residencia_exige_clinica`), así que
  //     esta pregunta nunca cambia de respuesta por ser residencia;
  //   · la de la marca sanitaria, porque quien registra cuidados en una
  //     residencia ES sanitario a efectos de acceso (D-51) y lo pone así
  //     la ruta que asigna el rol. Dejarla fuera habría significado que un
  //     rol de cuidado abre la historia incluso con la marca quitada a
  //     mano, y entonces la marca dejaría de significar nada.
  //
  // Y SUSTITUYE al alcance de la clínica, no se suma: `clinicalScope` nace
  // en `SELECTION` y en una residencia nadie llena `ClinicalAccess`, así
  // que sumarlas habría dejado a la plantilla entera sin ver a nadie.
  if (estado.residencia) {
    if (!estado.residencia.rolDeCuidadoVigente) return no("SIN_ROL_DE_CUIDADO");
    if (estado.residencia.alcanceTotal) return { puede: true };
    if (estado.residencia.residenteEnMiZona) return { puede: true };
    return no("RESIDENTE_FUERA_DE_TU_ZONA");
  }
  if (estado.alcance === "ALL") return { puede: true };
  if (estado.accesoVigente) return { puede: true };
  return no("SIN_ACCESO_AL_PACIENTE");
}

/** Lo mínimo de Prisma que hace falta. Facilita el doble en los tests. */
export interface PrismaParaAcceso {
  tenant: {
    findUnique: (args: unknown) => Promise<{
      clinicalRecordsEnabled: boolean;
      // residencia-1 · opcional en el TIPO a propósito: los dobles de la
      // suite de la clínica no lo devuelven, y `undefined !== true` deja el
      // tenant como «no es residencia», que es el comportamiento de antes
      // del bloque. Un doble que no sabe de residencias no puede volverse
      // una residencia por accidente.
      residenciaEnabled?: boolean;
    } | null>;
  };
  user: {
    findFirst: (args: unknown) => Promise<{
      isClinician: boolean;
      clinicalScope: AlcanceClinico;
    } | null>;
  };
  clinicalAccess: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  /**
   * residencia-1 · los roles de cuidado VIGENTES de esta persona, con el
   * rol y su `fullScope`. Opcional en el tipo por lo mismo que arriba: sólo
   * se llama en un tenant de residencia, y un doble que no lo traiga nunca
   * llega a esa rama.
   */
  careRoleAssignment?: {
    findMany: (args: unknown) => Promise<
      Array<{ careRole: { fullScope: boolean } }>
    >;
  };
  /** residencia-1 · las zonas vigentes de esta persona. */
  careZoneAssignment?: {
    findMany: (args: unknown) => Promise<
      Array<{ floorId: string | null }>
    >;
  };
  /** residencia-1 · la cama vigente de este residente, con su planta. */
  bedAssignment?: {
    findFirst: (args: unknown) => Promise<
      { bed: { room: { floorId: string } } } | null
    >;
  };
}

export function comoPrismaParaAcceso(
  prisma: PrismaClient,
): PrismaParaAcceso {
  return prisma as unknown as PrismaParaAcceso;
}

/**
 * Lee el estado de la base y contesta. El `clientId` tiene que estar YA
 * validado como del tenant por quien llama (`loadOwnedClient` en el CRM,
 * `cargarPacienteDelTenant` aquí): esta función no es la frontera de
 * aislamiento, es la de autorización clínica.
 *
 * El acceso vigente sólo se consulta cuando hace falta — con `ALL` no se
 * va a la tabla.
 */
export async function resolverAccesoClinico(
  prisma: PrismaParaAcceso,
  input: {
    tenantId: string;
    userId: string;
    clientId: string;
    /**
     * residencia-1 · el reloj, inyectable para los tests de vigencia.
     * Por defecto `new Date()`.
     */
    ahora?: Date;
  },
): Promise<{ veredicto: Veredicto; estado: EstadoClinico }> {
  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      // residencia-1 · una columna más en un `select` que ya se hacía. No
      // es una consulta nueva y no cuesta nada a los tenants de hoy — que
      // es la condición con la que este bloque podía tocar esta función.
      select: { clinicalRecordsEnabled: true, residenciaEnabled: true },
    }),
    prisma.user.findFirst({
      where: { id: input.userId, tenantId: input.tenantId },
      select: { isClinician: true, clinicalScope: true },
    }),
  ]);

  const clinicaEncendida = tenant?.clinicalRecordsEnabled === true;
  const esSanitario = user?.isClinician === true;
  const alcance: AlcanceClinico = user?.clinicalScope ?? "SELECTION";
  const esResidencia = tenant?.residenciaEnabled === true;

  // ── residencia-1 · la rama de la residencia ────────────────────────
  //
  // Se entra sólo con el módulo encendido Y siendo sanitario, por la misma
  // economía que el acceso por paciente de abajo: lo que se lee aquí no
  // puede cambiar el veredicto si alguna de las dos primeras condiciones
  // ya dijo no. Un bar, una peluquería y la clínica de podología no pagan
  // ni una consulta por este bloque.
  let residencia: EstadoResidencia | null = null;
  if (clinicaEncendida && esSanitario && esResidencia) {
    residencia = await resolverEstadoResidencia(prisma, {
      tenantId: input.tenantId,
      userId: input.userId,
      clientId: input.clientId,
      ahora: input.ahora ?? new Date(),
    });
  }

  let accesoVigente = false;
  // Sólo se pregunta por el acceso cuando la respuesta puede cambiar el
  // veredicto. Un tenant apagado o alguien que no es sanitario no gastan
  // una consulta, y un `ALL` tampoco la necesita.
  //
  // residencia-1 añade una condición más: en una residencia el alcance lo
  // decide la zona, así que `ClinicalAccess` no se consulta nunca. La tabla
  // está vacía en un centro de residencia y preguntarle sería una ida a la
  // base por cada apertura de ficha, 49 veces por turno.
  if (!esResidencia && clinicaEncendida && esSanitario && alcance === "SELECTION") {
    const fila = await prisma.clinicalAccess.findFirst({
      where: {
        tenantId: input.tenantId,
        clinicianUserId: input.userId,
        clientId: input.clientId,
        revokedAt: null,
      },
      select: { id: true },
    });
    accesoVigente = fila != null;
  }

  const estado: EstadoClinico = {
    clinicaEncendida,
    esSanitario,
    alcance,
    accesoVigente,
    residencia,
  };
  return { veredicto: puedeVerHistoria(estado), estado };
}

/**
 * residencia-1 (D-51) · lee las tres piezas de la residencia.
 *
 * Tres consultas, y están separadas de `resolverAccesoClinico` para que se
 * lean como lo que son: la traducción de «rol de cuidado vigente» y «en mi
 * zona» a booleanos. La decisión sigue estando en `puedeVerHistoria`.
 *
 * ── Qué cuenta como VIGENTE, y por qué el reloj está aquí ────────────
 *
 * `revokedAt IS NULL` + `fromAt <= ahora` + (`toAt IS NULL` o `toAt >
 * ahora`), más `careRole.active`. Los tres índices parciales de la
 * migración garantizan la UNICIDAD de lo vivo; la VIGENCIA en el tiempo no
 * cabe en un índice (un índice no puede llamar a `now()`), así que es un
 * WHERE — y por eso `ahora` se puede inyectar: un test de «el rol caducó
 * ayer» no puede depender de esperar un día.
 *
 * El `active` del rol entra en el WHERE y no después a propósito:
 * desactivar «fisio» en el catálogo tiene que quitar el acceso de quien
 * sólo era fisio, sin que nadie revoque nada a mano. Es lo que un centro
 * espera de un interruptor que dice «activo».
 */
async function resolverEstadoResidencia(
  prisma: PrismaParaAcceso,
  input: { tenantId: string; userId: string; clientId: string; ahora: Date },
): Promise<EstadoResidencia> {
  // Un cliente Prisma sin estos modelos (un doble de la suite) deja el
  // estado en «sin rol de cuidado», que es el lado restrictivo.
  if (
    typeof prisma.careRoleAssignment?.findMany !== "function" ||
    typeof prisma.careZoneAssignment?.findMany !== "function" ||
    typeof prisma.bedAssignment?.findFirst !== "function"
  ) {
    return {
      rolDeCuidadoVigente: false,
      alcanceTotal: false,
      residenteEnMiZona: false,
    };
  }

  const vigente = {
    revokedAt: null,
    fromAt: { lte: input.ahora },
    OR: [{ toAt: null }, { toAt: { gt: input.ahora } }],
  };

  const roles = await prisma.careRoleAssignment.findMany({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
      ...vigente,
      careRole: { active: true },
    },
    select: { careRole: { select: { fullScope: true } } },
  });

  const rolDeCuidadoVigente = roles.length > 0;
  // Sin rol de cuidado la respuesta ya está decidida: no se gastan las dos
  // consultas que quedan.
  if (!rolDeCuidadoVigente) {
    return {
      rolDeCuidadoVigente: false,
      alcanceTotal: false,
      residenteEnMiZona: false,
    };
  }

  const rolDeAlcanceTotal = roles.some((r) => r.careRole.fullScope === true);

  const zonas = await prisma.careZoneAssignment.findMany({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
      // La zona no se revoca (es organización, no capacidad firmada): su
      // vigencia es sólo `toAt`.
      fromAt: { lte: input.ahora },
      OR: [{ toAt: null }, { toAt: { gt: input.ahora } }],
    },
    select: { floorId: true },
  });

  // «Todo el centro» llega por dos caminos y los dos valen: el rol
  // (`fullScope`, que es la DUE y el médico) y una zona explícita sin
  // planta (que es la gerente que cubre el edificio).
  const alcanceTotal =
    rolDeAlcanceTotal || zonas.some((z) => z.floorId == null);
  if (alcanceTotal) {
    return { rolDeCuidadoVigente: true, alcanceTotal: true, residenteEnMiZona: false };
  }

  const plantas = new Set(
    zonas.map((z) => z.floorId).filter((id): id is string => id != null),
  );
  // Sin plantas no hace falta preguntar dónde duerme el residente.
  if (plantas.size === 0) {
    return {
      rolDeCuidadoVigente: true,
      alcanceTotal: false,
      residenteEnMiZona: false,
    };
  }

  // La cama VIGENTE del residente (`toAt IS NULL`, el mismo criterio que
  // el índice parcial `bed_assignments_one_live_per_client_key`), y de
  // ella su planta. Un residente sin cama devuelve `null` y queda fuera de
  // la zona de todos — correcto: a un ingreso pendiente lo ve dirección,
  // que tiene alcance total.
  const cama = await prisma.bedAssignment.findFirst({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      toAt: null,
    },
    select: { bed: { select: { room: { select: { floorId: true } } } } },
  });

  return {
    rolDeCuidadoVigente: true,
    alcanceTotal: false,
    residenteEnMiZona:
      cama != null && plantas.has(cama.bed.room.floorId),
  };
}
