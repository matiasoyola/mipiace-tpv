// historia-1 (D-90, D-91) · **LEER Y ESCRIBIR LA FICHA CLÍNICA DEL
// RESIDENTE, EN UN SOLO SITIO.**
//
// Lo que hoy está en una ficha de papel, el PAI en Word y la cabeza de la
// DUE: diagnósticos, alergias, dispositivos y dieta. Este fichero es el
// que las lee (descifrando), el que arma la **franja de alertas** y el
// que contesta **quién puede escribir cada parte**.
//
// ── POR QUÉ UN MÓDULO Y NO TODO EN LAS RUTAS ────────────────────────
//
// Porque la ficha se lee desde **cuatro sitios** y los cuatro tienen que
// ver lo mismo:
//
//   1. la pantalla de la ficha del admin (`ficha-clinica-routes.ts`);
//   2. el **arranque de la puerta** y su «lo que toca»
//      (`puerta-routes.ts`), que reciben sólo las FRASES;
//   3. el **parte de relevo** (`relevo.ts`), para la línea del ausente y
//      lo accionable;
//   4. el **panel de dirección** (`panel.ts`), para los ingresos con
//      pendientes.
//
// Cuatro copias de «lee los diagnósticos activos y descífralos» son
// cuatro sitios donde se puede olvidar el `withdrawnAt IS NULL` — y un
// diagnóstico retirado por error que siga alertando es peor que no tener
// franja.
//
// ── Y LA REGLA DE LA PUERTA SE APLICA AQUÍ, NO ALLÍ ─────────────────
//
// `frasesDeLaPuerta` devuelve `string[]` y nada más. La ruta de la puerta
// no recibe un objeto del que pueda sacar un `detalle` «porque hacía
// falta para la pantalla»: recibe las frases ya recortadas. Es la misma
// forma en la que `recortarAlAlcance` del relevo no devuelve el parte
// entero con un flag.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  alertasDeLaFicha,
  dispositivoDeSerie,
  frasesParaLaPuerta,
  type AlertaDeLaFicha,
  type FichaParaLaFranja,
  type TexturaDeDieta,
} from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import {
  leerTexto,
  sitioAgenteDeAlergia,
  sitioMotivoDeRetiradaDeAlergia,
  sitioMotivoDeRetiradaDeDiagnostico,
  sitioCodigoDeDiagnostico,
  sitioDetalleDeDispositivo,
  sitioFraseDeAlerta,
  sitioFuenteDeLaRevision,
  sitioNotasDeDieta,
  sitioReaccionDeAlergia,
  sitioTextoDeDiagnostico,
} from "../clinica/cripto-campos.js";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

// ── QUIÉN PUEDE ESCRIBIR QUÉ (D-90) ─────────────────────────────────
//
// «Diagnósticos y alergias, médico y DUE; dispositivos, además TO y
// fisio; dieta, médico y DUE.» **Por capacidad del rol de cuidado
// (D-50), no por `UserRole`** — el encargado del bar de un centro mixto
// es un `MANAGER` y no tiene por qué escribir un diagnóstico.
//
// Y el OWNER sí, por lo mismo que en `puedeTocarElPlan`: es quien
// configura el centro y quien responde de él ante la Consejería. La
// diferencia con el MANAGER está escrita allí y vale igual aquí.

/** Las cuatro partes de la ficha que se escriben por separado. */
export type ParteDeLaFicha = "DIAGNOSTICOS" | "ALERGIAS" | "DISPOSITIVOS" | "DIETA";

/**
 * Qué roles de serie escriben cada parte.
 *
 * Son CÓDIGOS de rol y no categorías, al revés que `puedeTocarElPlan`, y
 * es la decisión de esta tabla: la categoría no distingue a la fisio
 * (OPERATIVO) de la auxiliar (OPERATIVO), y la diferencia es justo la que
 * D-90 marca — la fisio pone un andador en la ficha y la auxiliar no.
 *
 * Un centro que invente un rol propio no entra por esta tabla: entra
 * porque la dirección le dé uno de los de serie, o no entra. Es lo
 * prudente mientras «qué puede escribir un rol propio» no sea un dato
 * configurable (y no lo es: sería una pantalla de permisos, que no está
 * en este bloque).
 */
export const QUIEN_ESCRIBE: Record<ParteDeLaFicha, readonly string[]> = {
  DIAGNOSTICOS: ["MEDICO", "DUE"],
  ALERGIAS: ["MEDICO", "DUE"],
  // TO y fisio son quienes pautan una silla, un andador o una grúa.
  DISPOSITIVOS: ["MEDICO", "DUE", "TO", "FISIO"],
  DIETA: ["MEDICO", "DUE"],
};

/** Cómo se lee cada parte en la negativa. */
const NOMBRE_DE_LA_PARTE: Record<ParteDeLaFicha, string> = {
  DIAGNOSTICOS: "Los diagnósticos",
  ALERGIAS: "Las alergias",
  DISPOSITIVOS: "Los dispositivos y ayudas",
  DIETA: "La dieta",
};

/** Quién puede escribir cada parte, en palabras, para la negativa y para
 *  la pantalla. */
const QUIENES_EN_PALABRAS: Record<ParteDeLaFicha, string> = {
  DIAGNOSTICOS: "el médico y la DUE",
  ALERGIAS: "el médico y la DUE",
  DISPOSITIVOS: "el médico, la DUE, el terapeuta ocupacional y el fisioterapeuta",
  DIETA: "el médico y la DUE",
};

/** La capacidad con la que alguien escribe: el id de la asignación de rol
 *  (D-31), que es lo que la fila guarda. */
export interface CapacidadParaEscribir {
  assignmentId: string;
  code: string;
}

export type VeredictoDeCapacidad =
  | { ok: true; capacidad: CapacidadParaEscribir }
  | { ok: false; error: string; message: string };

/**
 * ¿Puede esta persona escribir esta parte de la ficha, y con qué
 * capacidad?
 *
 * Devuelve la ASIGNACIÓN y no un booleano, y es el punto de la función:
 * la fila guarda `created_by_care_role_assignment_id` NOT NULL, así que
 * quien autoriza es quien tiene que decir con qué capacidad se firma. Dos
 * pasos —«¿puede?» y «¿con cuál?»— serían dos consultas y la posibilidad
 * de firmar con una capacidad distinta de la que autorizó.
 *
 * ── El OWNER sin rol de cuidado ────────────────────────────────────
 *
 * Es el caso que obliga a decidir algo. El OWNER puede tocar la ficha
 * (ver arriba), pero la fila **exige** una capacidad, y un OWNER que
 * nunca se asignó un rol de cuidado no tiene ninguna. Se le niega, con su
 * mensaje: «asígnate un rol de cuidado en Personal». La alternativa era
 * inventar una capacidad de sistema, y entonces la firma de un
 * diagnóstico podría decir «el programa» — que es exactamente lo que D-31
 * prohíbe.
 */
export async function capacidadParaLaFicha(
  tenantId: string,
  userId: string,
  esOwner: boolean,
  parte: ParteDeLaFicha,
): Promise<VeredictoDeCapacidad> {
  const ahora = new Date();
  const filas = await getPrisma().careRoleAssignment.findMany({
    where: {
      tenantId,
      userId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gte: ahora } }],
    },
    select: {
      id: true,
      careRole: { select: { code: true, active: true } },
    },
  });
  const vigentes = filas.filter((f) => f.careRole.active);
  if (vigentes.length === 0) {
    return {
      ok: false,
      error: "SIN_ROL_DE_CUIDADO",
      message: esOwner
        ? "Para escribir en una historia clínica hace falta firmar con una capacidad. Asígnate un rol de cuidado en Personal."
        : "No tienes ningún rol de cuidado vigente en este centro. Pídeselo a la dirección en Personal.",
    };
  }
  const permitidos = QUIEN_ESCRIBE[parte];
  // El OWNER entra con **cualquiera** de sus capacidades vigentes; el
  // resto, sólo con una de las que la tabla permite. Y se elige la
  // PRIMERA que permita, con el orden de la consulta —que es estable
  // porque Prisma ordena por el índice— para que dos escrituras seguidas
  // del mismo médico firmen con la misma capacidad.
  const buena = vigentes.find((f) => permitidos.includes(f.careRole.code));
  if (buena) {
    return { ok: true, capacidad: { assignmentId: buena.id, code: buena.careRole.code } };
  }
  if (esOwner) {
    const primera = vigentes[0]!;
    return {
      ok: true,
      capacidad: { assignmentId: primera.id, code: primera.careRole.code },
    };
  }
  return {
    ok: false,
    error: "FICHA_ES_DE_OTRO_ROL",
    message: `${NOMBRE_DE_LA_PARTE[parte]} de la ficha clínica los escriben ${QUIENES_EN_PALABRAS[parte]}.`,
  };
}

// ── LEER LA FICHA ───────────────────────────────────────────────────

/** Un diagnóstico, ya descifrado, como lo ve el admin. */
export interface DiagnosticoEnPantalla {
  id: string;
  texto: string | null;
  icd10: string | null;
  quirurgico: boolean;
  desde: string;
  resueltoEn: string | null;
  alerta: boolean;
  fraseDeAlerta: string | null;
  retirado: boolean;
  retiradoEn: string | null;
  motivoDeRetirada: string | null;
  firmadoPor: string;
  firmadoComo: string;
  escritoEn: string;
}

/** Una alergia, ya descifrada. */
export interface AlergiaEnPantalla {
  id: string;
  clase: "MEDICAMENTO" | "ALIMENTO" | "OTRA";
  gravedad: "LEVE" | "MODERADA" | "GRAVE";
  agente: string | null;
  reaccion: string | null;
  retirada: boolean;
  retiradaEn: string | null;
  motivoDeRetirada: string | null;
  firmadoPor: string;
  firmadoComo: string;
  escritoEn: string;
}

/** La última revisión de alergias. */
export interface RevisionDeAlergias {
  id: string;
  sinAlergiasConocidas: boolean;
  fuente: string | null;
  revisadoEn: string;
  revisadoPor: string;
  revisadoComo: string;
}

/** Un dispositivo. */
export interface DispositivoEnPantalla {
  id: string;
  code: string;
  nombre: string;
  detalle: string | null;
  desde: string;
  hasta: string | null;
  deRiesgo: boolean;
  firmadoPor: string;
  firmadoComo: string;
}

/** Una versión de la dieta. */
export interface DietaEnPantalla {
  id: string;
  version: number;
  textura: TexturaDeDieta;
  espesante: boolean;
  nivelDeEspesante: number | null;
  restricciones: string[];
  notas: string | null;
  vigente: boolean;
  jubiladaEn: string | null;
  firmadoPor: string;
  firmadoComo: string;
  escritoEn: string;
}

/** La ficha entera, como la devuelve la API del admin. */
export interface FichaEnPantalla {
  clientId: string;
  /** **La franja**, con sus dos textos (D-91). */
  alertas: AlertaDeLaFicha[];
  diagnosticos: DiagnosticoEnPantalla[];
  alergias: AlergiaEnPantalla[];
  /**
   * La última revisión, o `null` = **a este residente nadie le ha
   * preguntado por sus alergias**. No es lo mismo que `sinAlergias`:
   * ver D-90 y la cabecera de `allergy_reviews`.
   */
  revisionDeAlergias: RevisionDeAlergias | null;
  dispositivos: DispositivoEnPantalla[];
  /** Todas las versiones, la vigente primero. */
  dietas: DietaEnPantalla[];
}

const FIRMA_SELECT = {
  createdBy: { select: { alias: true, email: true } },
  createdWith: { select: { careRole: { select: { name: true } } } },
} as const;

/** El nombre de quien firmó. El alias si lo tiene; el correo si no, que
 *  es lo que el resto de la casa hace. */
function nombreDe(u: { alias: string | null; email: string } | null): string {
  if (u == null) return "—";
  return u.alias?.trim() || u.email;
}

/**
 * **La ficha clínica de un residente, descifrada.**
 *
 * Una función y seis consultas en paralelo. **No comprueba el acceso**: lo
 * hace `conHistoria` en la ruta, que es el único sitio por el que se abre
 * una historia en esta casa (clinica-1). Un `if` de acceso aquí sería un
 * segundo camino que mantener.
 */
export async function leerFicha(
  prisma: Ejecutor,
  tenantId: string,
  clientId: string,
  dek: Buffer | null,
): Promise<FichaEnPantalla> {
  const [diagnosticos, alergias, revision, dispositivos, dietas] = await Promise.all([
    prisma.residentDiagnosis.findMany({
      where: { tenantId, clientId },
      orderBy: [{ diagnosedOn: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        textCifrado: true,
        icd10Cifrado: true,
        surgical: true,
        diagnosedOn: true,
        resolvedOn: true,
        alertFlag: true,
        alertPhraseCifrado: true,
        withdrawnAt: true,
        withdrawReasonCifrado: true,
        createdAt: true,
        ...FIRMA_SELECT,
      },
    }),
    prisma.allergy.findMany({
      where: { tenantId, clientId },
      // Las vigentes primero y las graves arriba: es el orden en el que
      // alguien que va a prescribir las lee.
      orderBy: [{ withdrawnAt: "asc" }, { severity: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        class: true,
        severity: true,
        agentCifrado: true,
        reactionCifrado: true,
        withdrawnAt: true,
        withdrawReasonCifrado: true,
        createdAt: true,
        ...FIRMA_SELECT,
      },
    }),
    prisma.allergyReview.findFirst({
      where: { tenantId, clientId },
      orderBy: { reviewedAt: "desc" },
      select: {
        id: true,
        noneKnown: true,
        sourceCifrado: true,
        reviewedAt: true,
        reviewedBy: { select: { alias: true, email: true } },
        reviewedWith: { select: { careRole: { select: { name: true } } } },
      },
    }),
    prisma.residentDevice.findMany({
      where: { tenantId, clientId },
      orderBy: [{ toOn: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        detailCifrado: true,
        fromOn: true,
        toOn: true,
        ...FIRMA_SELECT,
      },
    }),
    prisma.dietProfile.findMany({
      where: { tenantId, clientId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        texture: true,
        thickener: true,
        thickenerLevel: true,
        restrictions: true,
        notesCifrado: true,
        supersededAt: true,
        createdAt: true,
        ...FIRMA_SELECT,
      },
    }),
  ]);

  const dias = (d: Date | null): string | null =>
    d == null ? null : d.toISOString().slice(0, 10);

  const diagnosticosEnPantalla: DiagnosticoEnPantalla[] = diagnosticos.map((d) => ({
    id: d.id,
    texto: leerTexto(
      { cifrado: d.textCifrado, claro: null },
      dek,
      sitioTextoDeDiagnostico(tenantId, d.id),
    ),
    icd10: leerTexto(
      { cifrado: d.icd10Cifrado, claro: null },
      dek,
      sitioCodigoDeDiagnostico(tenantId, d.id),
    ),
    quirurgico: d.surgical,
    desde: dias(d.diagnosedOn)!,
    resueltoEn: dias(d.resolvedOn),
    alerta: d.alertFlag,
    fraseDeAlerta: leerTexto(
      { cifrado: d.alertPhraseCifrado, claro: null },
      dek,
      sitioFraseDeAlerta(tenantId, d.id),
    ),
    retirado: d.withdrawnAt != null,
    retiradoEn: d.withdrawnAt?.toISOString() ?? null,
    motivoDeRetirada: leerTexto(
      { cifrado: d.withdrawReasonCifrado, claro: null },
      dek,
      // La columna lógica de la retirada de un diagnóstico, que es
      // distinta de la de una alergia: ver `cripto-campos.ts`.
      sitioMotivoDeRetiradaDeDiagnostico(tenantId, d.id),
    ),
    firmadoPor: nombreDe(d.createdBy),
    firmadoComo: d.createdWith.careRole.name,
    escritoEn: d.createdAt.toISOString(),
  }));

  const alergiasEnPantalla: AlergiaEnPantalla[] = alergias.map((a) => ({
    id: a.id,
    clase: a.class,
    gravedad: a.severity,
    agente: leerTexto(
      { cifrado: a.agentCifrado, claro: null },
      dek,
      sitioAgenteDeAlergia(tenantId, a.id),
    ),
    reaccion: leerTexto(
      { cifrado: a.reactionCifrado, claro: null },
      dek,
      sitioReaccionDeAlergia(tenantId, a.id),
    ),
    retirada: a.withdrawnAt != null,
    retiradaEn: a.withdrawnAt?.toISOString() ?? null,
    motivoDeRetirada: leerTexto(
      { cifrado: a.withdrawReasonCifrado, claro: null },
      dek,
      sitioMotivoDeRetiradaDeAlergia(tenantId, a.id),
    ),
    firmadoPor: nombreDe(a.createdBy),
    firmadoComo: a.createdWith.careRole.name,
    escritoEn: a.createdAt.toISOString(),
  }));

  const dispositivosEnPantalla: DispositivoEnPantalla[] = dispositivos.map((p) => ({
    id: p.id,
    code: p.code,
    nombre: nombreDeDispositivo(p.code),
    detalle: leerTexto(
      { cifrado: p.detailCifrado, claro: null },
      dek,
      sitioDetalleDeDispositivo(tenantId, p.id),
    ),
    desde: dias(p.fromOn)!,
    hasta: dias(p.toOn),
    deRiesgo: esDeRiesgo(p.code),
    firmadoPor: nombreDe(p.createdBy),
    firmadoComo: p.createdWith.careRole.name,
  }));

  const dietasEnPantalla: DietaEnPantalla[] = dietas.map((d) => ({
    id: d.id,
    version: d.version,
    textura: d.texture,
    espesante: d.thickener,
    nivelDeEspesante: d.thickenerLevel,
    restricciones: d.restrictions,
    notas: leerTexto(
      { cifrado: d.notesCifrado, claro: null },
      dek,
      sitioNotasDeDieta(tenantId, d.id),
    ),
    vigente: d.supersededAt == null,
    jubiladaEn: d.supersededAt?.toISOString() ?? null,
    firmadoPor: nombreDe(d.createdBy),
    firmadoComo: d.createdWith.careRole.name,
    escritoEn: d.createdAt.toISOString(),
  }));

  return {
    clientId,
    alertas: alertasDeLaFicha(paraLaFranja(diagnosticosEnPantalla, alergiasEnPantalla, dispositivosEnPantalla, dietasEnPantalla)),
    diagnosticos: diagnosticosEnPantalla,
    alergias: alergiasEnPantalla,
    revisionDeAlergias:
      revision == null
        ? null
        : {
            id: revision.id,
            sinAlergiasConocidas: revision.noneKnown,
            fuente: leerTexto(
              { cifrado: revision.sourceCifrado, claro: null },
              dek,
              sitioFuenteDeLaRevision(tenantId, revision.id),
            ),
            revisadoEn: revision.reviewedAt.toISOString(),
            revisadoPor: nombreDe(revision.reviewedBy),
            revisadoComo: revision.reviewedWith.careRole.name,
          },
    dispositivos: dispositivosEnPantalla,
    dietas: dietasEnPantalla,
  };
}

/**
 * De la ficha descifrada a lo que la función pura necesita.
 *
 * Es donde se aplica el filtro de **lo vigente**, y en un solo sitio:
 * los diagnósticos activos y no retirados, las alergias no retiradas, los
 * dispositivos que lleva hoy y la dieta vigente. Repartirlo por las cuatro
 * consultas de arriba habría dejado cuatro `WHERE` que se pueden olvidar
 * —y un diagnóstico retirado por error que siga alertando es peor que no
 * tener franja.
 *
 * El texto que no se descifra (`TEXTO_ILEGIBLE`) entra tal cual: la
 * decisión de clinica-7 es enseñar el hueco marcado, no esconder la
 * alerta. Una alergia grave que no se puede leer tiene que salir en la
 * banda diciendo que no se puede leer.
 */
function paraLaFranja(
  diagnosticos: DiagnosticoEnPantalla[],
  alergias: AlergiaEnPantalla[],
  dispositivos: DispositivoEnPantalla[],
  dietas: DietaEnPantalla[],
): FichaParaLaFranja {
  const hoy = new Date().toISOString().slice(0, 10);
  const vigente = dietas.find((d) => d.vigente) ?? null;
  return {
    diagnosticos: diagnosticos
      .filter((d) => !d.retirado && d.resueltoEn == null)
      .map((d) => ({
        id: d.id,
        texto: d.texto ?? "",
        alerta: d.alerta,
        frase: d.fraseDeAlerta,
      })),
    alergias: alergias
      .filter((a) => !a.retirada)
      .map((a) => ({
        id: a.id,
        clase: a.clase,
        gravedad: a.gravedad,
        agente: a.agente ?? "",
        reaccion: a.reaccion,
      })),
    dispositivos: dispositivos
      // «Hoy» por la fecha de pared y no por un instante: `to_on` es un
      // `DATE`, y el día que se cierra el dispositivo todavía se lleva.
      .filter((p) => p.hasta == null || p.hasta >= hoy)
      .map((p) => ({ id: p.id, code: p.code, detalle: p.detalle })),
    dieta:
      vigente == null
        ? null
        : {
            textura: vigente.textura,
            espesante: vigente.espesante,
            nivelDeEspesante: vigente.nivelDeEspesante,
          },
  };
}

/**
 * **Las frases de la puerta de varios residentes, de una vez.**
 *
 * Devuelve `Map<clientId, string[]>` y nada más que frases: ver la
 * cabecera de este fichero y la de `ficha.ts` del paquete puro. La ruta
 * de la puerta no puede sacar de aquí un diagnóstico porque no está.
 *
 * Una consulta por tabla para TODOS los residentes de golpe, y no una
 * ficha por residente: el arranque de la puerta pide los dos ocupantes de
 * una habitación, pero el parte de relevo y el panel piden los 49 del
 * centro, y 49 × 5 consultas es lo que convierte una pantalla en una
 * espera.
 */
export async function frasesDeLaPuerta(
  prisma: Ejecutor,
  tenantId: string,
  clientIds: string[],
  dek: Buffer | null,
): Promise<Map<string, string[]>> {
  const fuera = new Map<string, string[]>();
  if (clientIds.length === 0) return fuera;

  const hoy = new Date();
  const [diagnosticos, alergias, dispositivos, dietas] = await Promise.all([
    prisma.residentDiagnosis.findMany({
      where: {
        tenantId,
        clientId: { in: clientIds },
        alertFlag: true,
        resolvedOn: null,
        withdrawnAt: null,
      },
      select: { id: true, clientId: true, alertPhraseCifrado: true },
    }),
    prisma.allergy.findMany({
      where: {
        tenantId,
        clientId: { in: clientIds },
        withdrawnAt: null,
        severity: "GRAVE",
      },
      select: { id: true, clientId: true, agentCifrado: true },
    }),
    prisma.residentDevice.findMany({
      where: {
        tenantId,
        clientId: { in: clientIds },
        OR: [{ toOn: null }, { toOn: { gte: hoy } }],
      },
      select: { id: true, clientId: true, code: true },
    }),
    prisma.dietProfile.findMany({
      where: { tenantId, clientId: { in: clientIds }, supersededAt: null },
      select: {
        clientId: true,
        texture: true,
        thickener: true,
        thickenerLevel: true,
      },
    }),
  ]);

  for (const clientId of clientIds) {
    const ficha: FichaParaLaFranja = {
      diagnosticos: diagnosticos
        .filter((d) => d.clientId === clientId)
        .map((d) => ({
          id: d.id,
          // El texto del diagnóstico **no se lee aquí**, y no es una
          // optimización: es que no se pide a la base. Lo que no se trae
          // no se puede mandar por error a una tablet de pasillo.
          texto: "",
          alerta: true,
          frase: leerTexto(
            { cifrado: d.alertPhraseCifrado, claro: null },
            dek,
            sitioFraseDeAlerta(tenantId, d.id),
          ),
        })),
      alergias: alergias
        .filter((a) => a.clientId === clientId)
        .map((a) => ({
          id: a.id,
          clase: "OTRA" as const,
          gravedad: "GRAVE" as const,
          agente:
            leerTexto(
              { cifrado: a.agentCifrado, claro: null },
              dek,
              sitioAgenteDeAlergia(tenantId, a.id),
            ) ?? "",
          // La reacción tampoco se pide: no sale a la puerta.
          reaccion: null,
        })),
      dispositivos: dispositivos
        .filter((p) => p.clientId === clientId)
        .map((p) => ({ id: p.id, code: p.code, detalle: null })),
      dieta: (() => {
        const d = dietas.find((x) => x.clientId === clientId);
        return d == null
          ? null
          : {
              textura: d.texture,
              espesante: d.thickener,
              nivelDeEspesante: d.thickenerLevel,
            };
      })(),
    };
    fuera.set(clientId, frasesParaLaPuerta(ficha));
  }
  return fuera;
}

// ── El catálogo, leído del paquete puro ─────────────────────────────
//
// `dispositivoDeSerie` viene de `@mipiacetpv/residencia-plan` y no se
// copia: de la misma lista salen el nombre y el riesgo, y dos copias se
// separan el día que entre una CPAP (ver la cabecera de `ficha.ts`).

function nombreDeDispositivo(code: string): string {
  // El código tal cual si no está en el catálogo: enseñar `CPAP` es más
  // honesto que esconderlo, y es lo que `nombreDeRestriccion` hace.
  return dispositivoDeSerie(code)?.name ?? code;
}

function esDeRiesgo(code: string): boolean {
  return dispositivoDeSerie(code)?.riesgo === true;
}
