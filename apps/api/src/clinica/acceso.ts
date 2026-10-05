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
//   3. ¿Alcanza a este paciente? `ALL` sí; `SELECTION` sólo con un acceso
//      VIGENTE (`ClinicalAccess` con `revokedAt = null`).
//
// Lo que esta función NO hace, y es deliberado:
//
//   · **No mira el rol de negocio.** Ni `OWNER`, ni `MANAGER`, ni
//     `CLINICIAN`, ni `CASHIER` aparecen aquí. Quien decide es la marca.
//     Si mañana entra un cuarto rol de negocio, esta función no cambia —
//     que es la mitad de la razón por la que rol y marca se guardan
//     separados.
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
}

/** Por qué se dijo no. Se guarda en el registro y decide el HTTP. */
export type MotivoDenegado =
  | "CLINICA_APAGADA"
  | "NO_SANITARIO"
  | "SIN_ACCESO_AL_PACIENTE";

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
  if (estado.alcance === "ALL") return { puede: true };
  if (estado.accesoVigente) return { puede: true };
  return no("SIN_ACCESO_AL_PACIENTE");
}

/** Lo mínimo de Prisma que hace falta. Facilita el doble en los tests. */
export interface PrismaParaAcceso {
  tenant: {
    findUnique: (args: unknown) => Promise<{
      clinicalRecordsEnabled: boolean;
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
  input: { tenantId: string; userId: string; clientId: string },
): Promise<{ veredicto: Veredicto; estado: EstadoClinico }> {
  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { clinicalRecordsEnabled: true },
    }),
    prisma.user.findFirst({
      where: { id: input.userId, tenantId: input.tenantId },
      select: { isClinician: true, clinicalScope: true },
    }),
  ]);

  const clinicaEncendida = tenant?.clinicalRecordsEnabled === true;
  const esSanitario = user?.isClinician === true;
  const alcance: AlcanceClinico = user?.clinicalScope ?? "SELECTION";

  let accesoVigente = false;
  // Sólo se pregunta por el acceso cuando la respuesta puede cambiar el
  // veredicto. Un tenant apagado o alguien que no es sanitario no gastan
  // una consulta, y un `ALL` tampoco la necesita.
  if (clinicaEncendida && esSanitario && alcance === "SELECTION") {
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
  };
  return { veredicto: puedeVerHistoria(estado), estado };
}
