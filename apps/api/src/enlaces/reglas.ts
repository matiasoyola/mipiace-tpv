// enlaces-publicos · EL REGISTRO DE `purpose`, tipado y en código.
//
// Decisión S1.3 (07-10): cada `purpose` declara AQUÍ —no en la fila— su
// caducidad, sus usos, su perfil, en qué estado del objeto admite enlace,
// si deja rastro clínico y si su límite de peticiones va por IP o por
// token. Si los topes vivieran en la fila, cualquier pantalla podría
// aflojarlos con un UPDATE; aquí hace falta tocar este fichero, y se ve en
// la revisión.
//
// ── Los tres perfiles, que es lo que decide QUÉ PUEDE HACER ──────────
//
//   · `SOLO_ESCRIBIR` — contesta y NUNCA recibe datos de vuelta. Lo que
//     exige la clínica para todo lo clínico: si el enlace se filtra, lo
//     que se filtra es un formulario vacío. La valoración es éste.
//   · `SOLO_LEER` — ve un documento y no escribe (el consentimiento para
//     leerlo antes de firmarlo, S3).
//   · `ACTUAR_SOBRE_CITA` — ve día, hora, servicio y profesional de ESA
//     cita y actúa sobre ella; nada de la ficha y nada de salud («mi
//     cita», lo que RT midió con `/mi-cita/{token}`).
//
// El perfil se aplica en la PUERTA y no en cada pantalla, que es el punto
// entero del bloque: un `purpose` nuevo declara el suyo y no vuelve a
// escribir seguridad.
//
// ── Qué hay dado de alta HOY, y qué no ───────────────────────────────
//
// Sólo `VALORACION`. Los `purpose` de «mi cita», consentimiento, encuesta
// y formulario del equipo los añade el bloque que los necesite: están
// descritos aquí para que se vea que la forma les vale, pero una fila que
// nadie puede crear es una promesa que el sistema no cumple.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import type { AccionClinica } from "../clinica/registro.js";

/** Qué puede hacer quien tiene el enlace. Ver la cabecera. */
export type PerfilDeEnlace =
  | "SOLO_ESCRIBIR"
  | "SOLO_LEER"
  | "ACTUAR_SOBRE_CITA";

/**
 * Contra qué se cuenta el límite del que SÍ tiene un token válido.
 *
 * `IP` es lo normal. `TOKEN` es para los `purpose` del equipo
 * (capacidades, B9): **todas contestan desde el wifi del centro**, así que
 * un límite por IP las trataría como un solo atacante y la cuarta
 * fisioterapeuta se quedaría fuera. La clave es la HUELLA del token y no
 * el token: lo que se mete en Redis no abre nada.
 *
 * El otro límite —el de tokens inexistentes— va SIEMPRE por IP, para todos
 * los `purpose`, y no es configurable: un token que no existe no tiene
 * identidad contra la que contar, así que contarlo por token le daría a un
 * escáner un cubo nuevo por intento (ver `limites.ts`).
 */
export type LimitePor = "IP" | "TOKEN";

/** Lo mínimo de Prisma que un cargador de objetivo necesita. */
export type PrismaDeLectura = PrismaClient | Prisma.TransactionClient;

/**
 * Las reglas de un `purpose`.
 *
 * Genérica en `T` —el objeto al que apunta— para que la puerta devuelva al
 * llamante lo que su pantalla necesita, con tipo, sin que la puerta sepa
 * de valoraciones ni de citas.
 */
export interface ReglasDePurpose<T> {
  /** El nombre que viaja en la fila (`public_links.purpose`). */
  purpose: string;
  /** Y el tipo de objeto al que apunta (`public_links.target_type`). */
  targetType: string;

  perfil: PerfilDeEnlace;

  /**
   * Cuánto vive un enlace sin usar, en milisegundos.
   *
   * Recibe el canal porque un mismo `purpose` puede ofrecerse por dos
   * sitios con dos vidas distintas (la valoración: 30 días por email, 4
   * horas en la tablet de la sala). Los `purpose` sin canales lo ignoran.
   */
  vidaMs(canal: string | undefined): number;

  /** Cuántas veces se puede gastar. 1 = de un solo uso. */
  maxUsos: number;

  /** Ver `LimitePor`. */
  limitePor: LimitePor;

  /**
   * LO QUE LA PERSONA LEE cuando el enlace no sirve, y cuando ha probado
   * demasiadas veces.
   *
   * Una sola 404 por `purpose`, carácter por carácter, para los CUATRO
   * casos («no existe», «caducado», «gastado», «anulado») y para todas sus
   * rutas. Cuatro respuestas distintas le dicen a un escáner que el token
   * existía, y eso ya es información sobre una persona.
   *
   * Por eso vive aquí y no en la ruta: con un mensaje por ruta, el día que
   * alguien ajuste el texto de una sola se puede volver a distinguir.
   */
  mensajes: {
    /** El `code` de la 404. */
    code: string;
    /** El cuerpo de la 404. No puede decir «ha caducado»: la pantalla no
     *  lo sabe con certeza, y a propósito. */
    noSirve: string;
    /** El cuerpo del 429 de los dos límites. */
    demasiados: string;
  };

  /**
   * ¿Cada uso de este enlace tiene que quedar en `ClinicalAccessLog`?
   *
   * Decisión S1.6: los enlaces clínicos dejan rastro, con el actor
   * «paciente por enlace» que clinica-2 ya creó. Lo declara el `purpose` y
   * no la ruta, porque «cada ruta se acuerda» es la forma de fallo que
   * clinica-1 cerró con `conHistoria` y que aquí volvería a abrirse.
   */
  registraAccesoClinico: boolean;

  /**
   * De dónde sale el `clientId` para esa línea del registro. `null`
   * cuando el `purpose` no es clínico.
   */
  pacienteDe: ((objetivo: T) => string) | null;

  /** Y con qué acción se apunta (`WRITE` lo que escribe, `READ` lo que
   *  lee). `null` cuando el `purpose` no es clínico. */
  accionClinica: AccionClinica | null;

  /**
   * Carga el objeto al que apunta el enlace, con el `tenantId` del enlace.
   *
   * Devuelve `null` si no está, y entonces la puerta contesta la misma
   * 404: un enlace huérfano no abre nada. Es lo que cubre que `target_id`
   * no tenga FK (ver la migración).
   */
  cargarObjetivo(
    prisma: PrismaDeLectura,
    input: { tenantId: string; targetId: string },
  ): Promise<T | null>;

  /**
   * ¿El objeto está en un estado que ADMITE enlace?
   *
   * Decisión S1 (lado agenda, punto 3): «una cita sin confirmar no tiene
   * enlace válido». La puerta pregunta y, si no, la misma 404 genérica.
   * Para la valoración la pregunta es «¿está pendiente de contestar?» —
   * precisión de clínica en el S1: el enlace apunta a la valoración, no a
   * la cita.
   */
  admiteEnlace(objetivo: T): boolean;
}

// ── VALORACION · el primer usuario de la puerta ───────────────────────

/** Lo que la pantalla del paciente necesita de su valoración. Tres cosas
 *  salen por la ruta pública (clínica, nombre de pila, cuestionario); el
 *  resto es lo que la ruta necesita para guardar la respuesta. */
export interface ValoracionDelEnlace {
  id: string;
  tenantId: string;
  clientId: string;
  appointmentId: string | null;
  questionnaireVersion: number;
  channel: "EMAIL" | "TABLET";
  status: "PENDIENTE_PACIENTE" | "RESPONDIDA" | "VALIDADA";
  cliente: { firstName: string };
  tenant: { name: string; clinicalRecordsEnabled: boolean };
}

// Cuánto vive un enlace de la valoración sin usar, según por dónde se le
// ofrece. Son dos números porque son dos situaciones, no por
// configurabilidad (y vienen tal cual de `clinica/enlace.ts`):
//
//   · EMAIL · 30 días. Una cita que se da para dentro de tres semanas
//     necesita el enlace vivo cuando el paciente lo abra; uno de hace un
//     año, no.
//   · TABLET · 4 horas. El paciente lo contesta ahí mismo, en la sala, con
//     la tablet en la mano. Cuatro horas cubren una mañana entera de
//     consulta con margen, y pasado eso el token que quedó en una tablet
//     que alguien se llevó a casa ya no abre nada.
export const DIAS_DE_VIDA_DEL_ENLACE = 30;
export const HORAS_DE_VIDA_EN_TABLET = 4;

export const REGLAS_VALORACION: ReglasDePurpose<ValoracionDelEnlace> = {
  purpose: "VALORACION",
  // Apunta a LA VALORACIÓN, no a la cita. Precisión de clínica en el S1 y
  // es la que hace que mover o anular la cita no toque este enlace: el
  // paciente puede estar contestándolo, y la valoración sirve igual para
  // su siguiente cita.
  targetType: "CLINICAL_ASSESSMENT",

  // Contesta y no recibe nada de vuelta. Ni una respuesta —ni las que
  // acaba de mandar, ni las de una valoración anterior—, ni una alerta, ni
  // su apellido, ni su teléfono, ni su email, ni el id del paciente, ni el
  // de la valoración. Si la URL acaba en un historial compartido, en un
  // móvil prestado o en una captura de un grupo familiar, el que la tiene
  // puede CONTESTAR —eso es el producto— pero no puede LEER.
  perfil: "SOLO_ESCRIBIR",

  vidaMs: (canal) =>
    canal === "TABLET"
      ? HORAS_DE_VIDA_EN_TABLET * 60 * 60 * 1000
      : DIAS_DE_VIDA_DEL_ENLACE * 24 * 60 * 60 * 1000,

  // DE UN SOLO USO. Se gasta al CONTESTAR, no al abrir: el paciente puede
  // recargar la pantalla las veces que quiera (y lo hace: un mayor con el
  // móvil en la mano recarga). Lo que no puede es contestar dos veces.
  maxUsos: 1,

  // Por IP: cada paciente abre su enlace desde su casa. El caso del wifi
  // compartido es el de los `purpose` del equipo, que este bloque no da de
  // alta.
  limitePor: "IP",

  // Los textos de clinica-2, palabra por palabra. La 404 NO dice «su
  // enlace ha caducado» —la pantalla no lo sabe con certeza— y le pide
  // llamar a la clínica, que es además lo que tiene que hacer: allí sí se
  // sabe cuál es su estado, y puede contestar en la tablet.
  mensajes: {
    code: "VALORACION_NOT_FOUND",
    noSirve:
      "Este enlace ya no sirve. Llame a la clínica y se lo preparamos otra vez; también puede contestarlo allí el día de su cita.",
    demasiados:
      "Demasiados intentos. Espere un rato y vuelva a abrir el enlace, o llame a la clínica.",
  },

  // El paciente escribe en su historia. Línea `WRITE` con el actor
  // «paciente por enlace» (`clinica/actor-paciente.ts`), que es lo que
  // resuelve el `userId` NOT NULL del registro.
  registraAccesoClinico: true,
  pacienteDe: (v) => v.clientId,
  accionClinica: "WRITE",

  cargarObjetivo: async (prisma, { tenantId, targetId }) => {
    const fila = await prisma.clinicalAssessment.findFirst({
      where: { id: targetId, tenantId },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        appointmentId: true,
        questionnaireVersion: true,
        channel: true,
        status: true,
        client: { select: { firstName: true } },
        tenant: { select: { name: true, clinicalRecordsEnabled: true } },
      },
    });
    if (!fila) return null;
    return {
      id: fila.id,
      tenantId: fila.tenantId,
      clientId: fila.clientId,
      appointmentId: fila.appointmentId,
      questionnaireVersion: fila.questionnaireVersion,
      channel: fila.channel as "EMAIL" | "TABLET",
      status: fila.status as ValoracionDelEnlace["status"],
      cliente: fila.client,
      tenant: fila.tenant,
    };
  },

  admiteEnlace: (v) =>
    // CON EL MÓDULO APAGADO, NO EXISTE. La misma 404 y no una distinta: un
    // tenant al que se le apagó la clínica no destapa que la tuvo. Es la
    // misma decisión que `clinica/gate.ts`, aplicada a una ruta que no
    // puede usar ese gate porque no tiene sesión de la que sacar el
    // tenant. Va aquí, dentro del estado admitido, porque es exactamente
    // eso: con el módulo apagado ninguna valoración admite enlace.
    v.tenant.clinicalRecordsEnabled &&
    // Y PENDIENTE DE CONTESTAR. El estado y el gasto del enlace van de la
    // mano y se comprueban los dos: si por cualquier camino quedara una
    // valoración RESPONDIDA sin gastar su enlace, el enlace tampoco tiene
    // que abrir. Lo que no se puede es que contestar dos veces sea
    // posible. Es la defensa en profundidad que el done de clinica-2
    // documentó en §8 («el "un solo uso" lo sostienen DOS líneas
    // independientes»).
    v.status === "PENDIENTE_PACIENTE",
};

/**
 * EL REGISTRO. Lo que está dado de alta, hoy sólo `VALORACION`.
 *
 * Un `purpose` que no esté aquí NO EXISTE, y no hace falta comprobarlo en
 * ningún sitio: para preguntar a la puerta por un `purpose` hay que
 * traerle sus REGLAS, y las reglas sólo se escriben en este fichero. Una
 * fila con `purpose = 'LO_QUE_SEA'` puede estar en la base y no tiene
 * ninguna ruta que la pregunte, así que no abre nada. Es lo que hace que
 * el TEXT de la columna no sea un agujero.
 *
 * Existe, entonces, para lo que no pasa por la puerta: enumerar lo que hay
 * (la pantalla de recepción que vendrá con «mi cita»), y poder afirmar en
 * un test QUÉ está dado de alta — que un `purpose` nuevo aparezca aquí sin
 * que nadie lo haya querido es exactamente lo que no debe pasar.
 */
export const PURPOSES: Readonly<Record<string, ReglasDePurpose<never>>> =
  Object.freeze({
    [REGLAS_VALORACION.purpose]:
      REGLAS_VALORACION as unknown as ReglasDePurpose<never>,
  });
