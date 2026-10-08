// clinica-4 · EL CONSENTIMIENTO INFORMADO, sobre la tabla común.
//
// Se construye sobre `ClientConsent` (`kind = TREATMENT`), que ya usa el
// spa desde la ficha del cliente (`crm/routes.ts`). **No hay tabla clínica
// de consentimientos** (S3, decidido el 07-10), y lo que hoy funciona en
// la ficha del cliente sigue funcionando igual: este fichero no toca esa
// ruta.
//
// Lo que este fichero hace es lo que la tabla sola no puede:
//
//   · leer las filas y contestar **qué está firmado y vigente**, con la
//     cuenta pura de `@mipiacetpv/consentimientos`;
//   · contestar **qué pide la cita de hoy** (los servicios de la cita
//     dicen qué plantillas piden) y por tanto **qué falta**;
//   · **firmar**: validar firmante e informante, pintar el PDF, guardarlo
//     y escribir la fila con todo congelado;
//   · **revocar**: una fila nueva enlazada, nunca un UPDATE.
//
// ── El orden de la firma, y por qué es ése ───────────────────────────
//
//   1. se valida todo (incluido que el informante sea sanitario);
//   2. se pinta el PDF y se calcula su huella;
//   3. se escribe el fichero;
//   4. se escribe la fila.
//
// Primero el fichero y después la fila: al revés, un fallo de disco
// dejaría una fila que dice «aquí hay un consentimiento firmado»
// apuntando a un PDF que no existe, y en una historia clínica ese hueco
// es peor que no tener la fila. Al orden de aquí, lo que puede quedar es
// un PDF huérfano en el volumen, que no afirma nada.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  consentimientoVigente,
  consentimientosQueFaltan,
  firmanteCompleto,
  informantePuedeInformar,
  plantillaDe,
  plantillaVigente,
  PLANTILLAS_VIGENTES,
  PLANTILLA_DE_FOTOS,
  textoCanonico,
  type ClaseDeFirmante,
  type FilaFirmada,
  type PlantillaDeConsentimiento,
} from "@mipiacetpv/consentimientos";
import { renderConsentimientoPdf } from "@mipiacetpv/ticket-pdf";

import { CENTER_TZ } from "../agenda/time.js";
import { guardarFichero, huellaDe } from "./ficheros.js";

/** El nombre del campo que la pantalla y el PDF llaman «hoy». */
export function fechaLarga(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: CENTER_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** «7 sep» — la de la gráfica y las listas. */
export function diaCorto(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: CENTER_TZ,
    day: "numeric",
    month: "short",
  }).format(d);
}

function horaDelCentro(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: CENTER_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// ── Lo que la pantalla ve de un consentimiento ───────────────────────

export interface ConsentimientoEnPantalla {
  id: string;
  /** `null` en un alta manual sin plantilla (el spa, y lo de antes). */
  plantillaId: string | null;
  plantillaVersion: number | null;
  /** El título de la plantilla de ESA versión, o el texto honesto. */
  titulo: string;
  firmadoEn: string;
  /** `true` si esta fila ha sido revocada por otra. */
  revocado: boolean;
  revocadoEn: string | null;
  revocadoMotivo: string | null;
  /** Si tiene PDF que se pueda abrir. */
  tienePdf: boolean;
  /** `true` si la plantilla era clínica: su PDF va por el registro. */
  clinico: boolean;
  firmante: {
    clase: ClaseDeFirmante | null;
    nombre: string | null;
    relacion: string | null;
  };
  informante: { nombre: string; colegiado: string | null } | null;
  /** La huella del PDF, para el pie de la ficha. */
  pdfSha256: string | null;
}

export interface PlantillaEnPantalla {
  id: string;
  titulo: string;
  version: number;
  /** Los párrafos que se leen con el paciente antes de firmar. */
  parrafos: readonly string[];
  clinica: boolean;
  /** `true` = el texto todavía no lo ha validado la profesional. */
  pendienteDeValidar: boolean;
  /** `true` si la pide la cita de hoy (y por tanto bloquea la sesión). */
  laPideLaCita: boolean;
  /** El estado: firmado y vigente, revocado, o nunca firmado. */
  vigente: ConsentimientoEnPantalla | null;
}

const SELECT_CONSENTIMIENTO = {
  id: true,
  kind: true,
  grantedAt: true,
  templateId: true,
  templateVersion: true,
  textSha256: true,
  pdfSha256: true,
  pdfFileName: true,
  clinical: true,
  signer: true,
  signerName: true,
  signerRelation: true,
  informerUserId: true,
  revokesConsentId: true,
  revokeReason: true,
  informer: { select: { alias: true, email: true, clinicianLicense: true } },
} satisfies Prisma.ClientConsentSelect;

type FilaDeBase = Prisma.ClientConsentGetPayload<{
  select: typeof SELECT_CONSENTIMIENTO;
}>;

function nombreDeUsuario(u: {
  alias: string | null;
  email: string;
}): string {
  return u.alias?.trim() || u.email;
}

/** La forma que la cuenta pura necesita. */
function paraLaCuenta(filas: readonly FilaDeBase[]): readonly FilaFirmada[] {
  return filas.map((f) => ({
    id: f.id,
    plantillaId: f.templateId,
    plantillaVersion: f.templateVersion,
    firmadoEn: f.grantedAt.toISOString(),
    revocaA: f.revokesConsentId,
  }));
}

/**
 * El título con el que se enseña una fila.
 *
 * Con una versión que este despliegue no conoce **no se cae a la vigente**:
 * se dice el id y la versión. Enseñar el título de hoy sobre una firma de
 * otra versión sería afirmar que el paciente firmó un documento que no se
 * le puso delante — la misma regla que `mapaDeVersion` de clinica-3.
 */
function tituloDeLaFila(fila: FilaDeBase): string {
  if (fila.templateId == null) {
    return fila.kind === "DATA"
      ? "Consentimiento de datos · alta manual"
      : "Consentimiento de tratamiento · alta manual";
  }
  const p = plantillaDe(fila.templateId, fila.templateVersion ?? 0);
  if (p) return p.titulo;
  return `${fila.templateId} · versión ${fila.templateVersion}`;
}

function aPantalla(
  fila: FilaDeBase,
  todas: readonly FilaDeBase[],
): ConsentimientoEnPantalla {
  const revocacion = todas.find((f) => f.revokesConsentId === fila.id) ?? null;
  return {
    id: fila.id,
    plantillaId: fila.templateId,
    plantillaVersion: fila.templateVersion,
    titulo: tituloDeLaFila(fila),
    firmadoEn: fila.grantedAt.toISOString(),
    revocado: revocacion != null,
    revocadoEn: revocacion ? revocacion.grantedAt.toISOString() : null,
    revocadoMotivo: revocacion?.revokeReason ?? null,
    tienePdf: fila.pdfFileName != null,
    clinico: fila.clinical,
    firmante: {
      clase: (fila.signer as ClaseDeFirmante | null) ?? null,
      nombre: fila.signerName,
      relacion: fila.signerRelation,
    },
    informante: fila.informer
      ? {
          nombre: nombreDeUsuario(fila.informer),
          colegiado: fila.informer.clinicianLicense,
        }
      : null,
    pdfSha256: fila.pdfSha256,
  };
}

/** Las filas de un paciente, de la más reciente a la más antigua. */
export async function filasDelPaciente(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<readonly FilaDeBase[]> {
  return prisma.clientConsent.findMany({
    where: { tenantId: input.tenantId, clientId: input.clientId },
    orderBy: { grantedAt: "desc" },
    select: SELECT_CONSENTIMIENTO,
  });
}

/**
 * QUÉ CONSENTIMIENTOS PIDEN los servicios de una cita.
 *
 * Sale de `service_scheduling.consentimientos` (decisión 4). Sin servicios
 * marcados no pide ninguno, que es lo que les pasa a los quince tenants de
 * hoy y a cualquier clínica antes de configurarlo.
 */
export async function consentimientosQuePideLaCita(
  prisma: PrismaClient,
  input: { tenantId: string; servicioIds: readonly string[] },
): Promise<readonly string[]> {
  if (input.servicioIds.length === 0) return [];
  const filas = await prisma.serviceScheduling.findMany({
    where: { tenantId: input.tenantId, productId: { in: [...input.servicioIds] } },
    select: { productId: true, consentimientos: true },
  });
  // En el orden de los servicios de la cita y sin repetidos: dos servicios
  // que pidan el mismo consentimiento lo piden UNA vez.
  const porProducto = new Map(filas.map((f) => [f.productId, f.consentimientos]));
  const vistos = new Set<string>();
  const pide: string[] = [];
  for (const id of input.servicioIds) {
    for (const plantilla of porProducto.get(id) ?? []) {
      if (vistos.has(plantilla)) continue;
      vistos.add(plantilla);
      pide.push(plantilla);
    }
  }
  return pide;
}

export interface PuertaDeConsentimientos {
  puede: boolean;
  /** Los que faltan, con su título, para el aviso y el botón. */
  faltan: readonly { id: string; titulo: string }[];
  /** Qué se le dice a la podóloga. Vacío cuando no falta ninguno. */
  mensaje: string;
}

/**
 * ¿PUEDE EMPEZAR ESTA SESIÓN?
 *
 * Regla 7: la sesión no empieza si su servicio pide un consentimiento que
 * no está firmado y vigente. Un revocado **cuenta como que falta**, que es
 * el punto de que revocar sea una fila nueva.
 *
 * Es la hermana de `resolverPrimerTratamiento` (clinica-2) y tiene la
 * misma forma a propósito: la pantalla pinta un aviso con el camino para
 * arreglarlo —aquí, «Firmar ahora»— y el servidor se niega a cerrar. No es
 * un error rojo: es una puerta que dice por dónde se abre.
 */
export async function puertaDeConsentimientos(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    servicioIds: readonly string[];
  },
): Promise<PuertaDeConsentimientos> {
  const [pide, filas] = await Promise.all([
    consentimientosQuePideLaCita(prisma, input),
    filasDelPaciente(prisma, input),
  ]);
  const faltanIds = consentimientosQueFaltan({
    pide,
    filas: paraLaCuenta(filas),
  });
  const faltan = faltanIds.map((id) => ({
    id,
    titulo: plantillaVigente(id)?.titulo ?? id,
  }));
  return {
    puede: faltan.length === 0,
    faltan,
    mensaje:
      faltan.length === 0
        ? ""
        : faltan.length === 1
          ? `Falta firmar «${faltan[0]!.titulo}». Se lee con el paciente y se firma aquí, en la consulta.`
          : `Faltan ${faltan.length} consentimientos por firmar: ${faltan.map((f) => `«${f.titulo}»`).join(", ")}. Se leen con el paciente y se firman aquí.`,
  };
}

/**
 * ¿Hay consentimiento de fotos vigente?
 *
 * Decisión 10: antes de la primera foto de un paciente, el consentimiento
 * de fotos firmado. Y no es «antes de la primera»: es **antes de cada
 * una**, porque si se revoca, no se hacen más (lo dice el propio texto de
 * la plantilla). Lo que se conserva son las que ya estaban hechas, que es
 * historia y no se borra.
 */
export async function puertaDeFotos(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<{ puede: boolean; plantillaId: string; mensaje: string }> {
  const filas = await filasDelPaciente(prisma, input);
  const vigente = consentimientoVigente(paraLaCuenta(filas), PLANTILLA_DE_FOTOS);
  return {
    puede: vigente != null,
    plantillaId: PLANTILLA_DE_FOTOS,
    mensaje:
      vigente != null
        ? ""
        : "Antes de la primera foto, el paciente tiene que firmar el consentimiento de fotos clínicas.",
  };
}

export interface VistaDeConsentimientos {
  /** Las plantillas vigentes, con su estado para este paciente. */
  plantillas: readonly PlantillaEnPantalla[];
  /** TODAS las filas del paciente, incluidas las de alta manual y las
   *  revocadas: es la pestaña «Documentos» de la historia. */
  firmados: readonly ConsentimientoEnPantalla[];
  /** Lo que pide la cita de hoy, si se abre desde una cita. */
  pideLaCita: readonly string[];
}

/** Todo lo que la pantalla de consentimientos pinta, de una vez. */
export async function vistaDeConsentimientos(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    /** Los servicios de la cita, si se abre desde una. */
    servicioIds?: readonly string[];
  },
): Promise<VistaDeConsentimientos> {
  const [filas, pideLaCita] = await Promise.all([
    filasDelPaciente(prisma, input),
    consentimientosQuePideLaCita(prisma, {
      tenantId: input.tenantId,
      servicioIds: input.servicioIds ?? [],
    }),
  ]);
  const cuenta = paraLaCuenta(filas);
  return {
    plantillas: PLANTILLAS_VIGENTES.map((p) => {
      const vigente = consentimientoVigente(cuenta, p.id);
      const fila = vigente ? filas.find((f) => f.id === vigente.id) : null;
      return {
        id: p.id,
        titulo: p.titulo,
        version: p.version,
        parrafos: p.parrafos,
        clinica: p.clinica,
        pendienteDeValidar: p.pendienteDeValidar,
        laPideLaCita: pideLaCita.includes(p.id),
        vigente: fila ? aPantalla(fila, filas) : null,
      };
    }),
    firmados: filas
      // Las filas de revocación no se enseñan como documentos: lo que se
      // enseña es la concesión, marcada como revocada. Dos líneas por el
      // mismo consentimiento se leerían como dos consentimientos.
      .filter((f) => f.revokesConsentId == null)
      .map((f) => aPantalla(f, filas)),
    pideLaCita,
  };
}

// ── Firmar ───────────────────────────────────────────────────────────

export type MotivoDeNoFirmar =
  | "PLANTILLA_DESCONOCIDA"
  | "YA_ESTA_FIRMADO"
  | "FALTA_LA_FIRMA"
  | "FALTA_EL_REPRESENTANTE"
  | "FALTA_LA_RELACION"
  | "SOBRA_EL_REPRESENTANTE"
  | "INFORMANTE_NO_SANITARIO";

export type ResultadoDeFirmar =
  | { ok: true; consentimiento: ConsentimientoEnPantalla }
  | { ok: false; motivo: MotivoDeNoFirmar; mensaje: string };

export interface DatosDelCentro {
  nombre: string;
  nif: string | null;
  direccion: string | null;
  telefono: string | null;
}

/**
 * Los datos del centro para la cabecera del documento.
 *
 * Salen de `Tenant.name` y de `fiscalProfile`, que es de donde los coge el
 * ticket impreso (`escpos-input.ts`). Un consentimiento con una cabecera
 * distinta de la del ticket del mismo centro serían dos identidades del
 * mismo negocio.
 */
export async function datosDelCentro(
  prisma: PrismaClient,
  tenantId: string,
): Promise<DatosDelCentro> {
  const t = await prisma.tenant.findFirstOrThrow({
    where: { id: tenantId },
    select: { name: true, fiscalProfile: true },
  });
  const fiscal = (t.fiscalProfile ?? {}) as {
    legalName?: string | null;
    taxId?: string | null;
    address?: unknown;
    phone?: string | null;
  };
  return {
    nombre: fiscal.legalName?.trim() || t.name,
    nif: fiscal.taxId?.trim() || null,
    direccion: textoDeDireccion(fiscal.address),
    telefono: fiscal.phone?.trim() || null,
  };
}

/** `fiscalProfile.address` llega como texto o como objeto (Holded). */
function textoDeDireccion(address: unknown): string | null {
  if (typeof address === "string") return address.trim() || null;
  if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    const partes = ["address", "city", "postalCode", "province"]
      .map((k) => a[k])
      .filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return partes.length > 0 ? partes.join(", ") : null;
  }
  return null;
}

/**
 * FIRMAR un consentimiento.
 *
 * El PNG de la firma llega en base64 desde el `<canvas>` donde el paciente
 * firmó con el dedo. **Es obligatorio**: un consentimiento sin firma es un
 * folio, y lo que la ley pide es la firma.
 */
export async function firmarConsentimiento(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    /** Quién teclea y quién informa: en consulta, el sanitario. */
    userId: string;
    /** `true` si ese usuario lleva la marca sanitaria. */
    usuarioEsSanitario: boolean;
    plantillaId: string;
    firmante: {
      clase: ClaseDeFirmante;
      nombre: string | null;
      relacion: string | null;
    };
    /** El PNG de la firma, ya decodificado. */
    firmaPng: Buffer | null;
    ahora: Date;
  },
): Promise<ResultadoDeFirmar> {
  const plantilla = plantillaVigente(input.plantillaId);
  if (!plantilla) {
    return {
      ok: false,
      motivo: "PLANTILLA_DESCONOCIDA",
      mensaje: "Ese consentimiento no existe en esta versión del programa.",
    };
  }

  // La firma del dedo. Sin ella no hay consentimiento que valga.
  if (!input.firmaPng || input.firmaPng.byteLength === 0) {
    return {
      ok: false,
      motivo: "FALTA_LA_FIRMA",
      mensaje: "Falta la firma. Que el paciente firme con el dedo en la pantalla.",
    };
  }

  const firmante = firmanteCompleto(input.firmante);
  if (!firmante.ok) {
    return { ok: false, motivo: firmante.motivo, mensaje: firmante.mensaje };
  }

  const informante = informantePuedeInformar({
    plantillaEsClinica: plantilla.clinica,
    esSanitario: input.usuarioEsSanitario,
  });
  if (!informante.ok) {
    return { ok: false, motivo: informante.motivo, mensaje: informante.mensaje };
  }

  // Ya firmado y vigente: se devuelve el que hay en vez de firmar otro.
  // Un doble toque no es un error, y dos consentimientos idénticos del
  // mismo día en la historia no son más prueba: son una pregunta.
  const filas = await filasDelPaciente(prisma, input);
  const yaVigente = consentimientoVigente(paraLaCuenta(filas), plantilla.id);
  if (yaVigente) {
    const fila = filas.find((f) => f.id === yaVigente.id)!;
    return {
      ok: false,
      motivo: "YA_ESTA_FIRMADO",
      mensaje: `Ya está firmado y vigente desde el ${fechaLarga(fila.grantedAt)}. Para cambiarlo, revócalo y firma otro.`,
    };
  }

  const [paciente, centro, quien] = await Promise.all([
    prisma.client.findFirstOrThrow({
      where: { id: input.clientId, tenantId: input.tenantId },
      select: { firstName: true, lastName: true },
    }),
    datosDelCentro(prisma, input.tenantId),
    prisma.user.findFirstOrThrow({
      where: { id: input.userId, tenantId: input.tenantId },
      select: { alias: true, email: true, clinicianLicense: true },
    }),
  ]);

  const texto = textoCanonico(plantilla);
  const pdf = await renderConsentimientoPdf({
    centro,
    titulo: plantilla.titulo,
    parrafos: plantilla.parrafos,
    plantillaId: plantilla.id,
    plantillaVersion: plantilla.version,
    textoSha256: huellaDe(Buffer.from(texto, "utf8")),
    paciente: {
      nombre: `${paciente.firstName} ${paciente.lastName}`.trim(),
      documento: null,
    },
    firmante: input.firmante,
    informante: {
      nombre: nombreDeUsuario(quien),
      colegiado: quien.clinicianLicense,
    },
    fecha: `${fechaLarga(input.ahora)}, ${horaDelCentro(input.ahora)}`,
    firmaPng: input.firmaPng,
    avisoDePlantilla: plantilla.pendienteDeValidar
      ? "Texto de ejemplo del programa, pendiente de revisar por la profesional del centro."
      : null,
  });

  // El fichero ANTES de la fila. Ver la cabecera.
  const guardado = await guardarFichero("CONSENTIMIENTO", pdf);

  const creada = await prisma.clientConsent.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT",
      grantedAt: input.ahora,
      // `docRef` sigue siendo el puntero al documento, como en B1: aquí,
      // el nombre del fichero que la API sirve.
      docRef: guardado.fileName,
      templateId: plantilla.id,
      templateVersion: plantilla.version,
      textSha256: huellaDe(Buffer.from(texto, "utf8")),
      pdfSha256: guardado.sha256,
      pdfFileName: guardado.fileName,
      clinical: plantilla.clinica,
      signer: input.firmante.clase,
      signerName:
        input.firmante.clase === "REPRESENTANTE"
          ? (input.firmante.nombre?.trim() ?? null)
          : null,
      signerRelation:
        input.firmante.clase === "REPRESENTANTE"
          ? (input.firmante.relacion?.trim() ?? null)
          : null,
      informerUserId: input.userId,
      createdByUserId: input.userId,
    },
    select: SELECT_CONSENTIMIENTO,
  });

  return { ok: true, consentimiento: aPantalla(creada, [creada]) };
}

// ── Revocar ──────────────────────────────────────────────────────────

export type MotivoDeNoRevocar =
  | "NO_EXISTE"
  | "YA_ESTABA_REVOCADO"
  | "ES_UNA_REVOCACION";

export type ResultadoDeRevocar =
  | { ok: true; revocacionId: string }
  | { ok: false; motivo: MotivoDeNoRevocar; mensaje: string };

/**
 * REVOCAR: una fila nueva enlazada a la que revoca.
 *
 * Nunca un `UPDATE` (Ley 41/2002 art. 8.5; el trigger de la tabla lo
 * rechazaría igual). La fila nueva copia la plantilla y su versión para
 * que la lista se lea —«Fotos clínicas · revocado el 9 de octubre»— y
 * lleva el motivo, que es lo que la podóloga podrá explicar dentro de dos
 * años.
 *
 * Vale igual para `DATA`: un cliente del spa que retira el permiso de
 * comunicaciones deja la misma prueba de cuándo se dio y cuándo se
 * retiró (S3, lado agenda, punto 1).
 */
export async function revocarConsentimiento(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    userId: string;
    consentimientoId: string;
    motivo: string;
    ahora: Date;
  },
): Promise<ResultadoDeRevocar> {
  const filas = await filasDelPaciente(prisma, input);
  const fila = filas.find((f) => f.id === input.consentimientoId);
  if (!fila) {
    return {
      ok: false,
      motivo: "NO_EXISTE",
      mensaje: "Ese consentimiento no está en la historia de este paciente.",
    };
  }
  if (fila.revokesConsentId != null) {
    return {
      ok: false,
      motivo: "ES_UNA_REVOCACION",
      mensaje: "Eso ya es una revocación: no se revoca una revocación.",
    };
  }
  if (filas.some((f) => f.revokesConsentId === fila.id)) {
    return {
      ok: false,
      motivo: "YA_ESTABA_REVOCADO",
      mensaje: "Ese consentimiento ya estaba revocado.",
    };
  }

  const revocacion = await prisma.clientConsent.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: fila.kind,
      grantedAt: input.ahora,
      templateId: fila.templateId,
      templateVersion: fila.templateVersion,
      textSha256: fila.textSha256,
      clinical: fila.clinical,
      // El informante se copia porque el CHECK lo exige cuando es
      // clínico: la revocación de un documento clínico sigue siendo un
      // acto clínico, y quien lo recoge consta.
      informerUserId: fila.clinical ? input.userId : null,
      createdByUserId: input.userId,
      revokesConsentId: fila.id,
      revokeReason: input.motivo.trim(),
    },
    select: { id: true },
  });
  return { ok: true, revocacionId: revocacion.id };
}

/** La fila de un consentimiento, para servir su PDF. */
export async function consentimientoParaPdf(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; consentimientoId: string },
): Promise<{
  pdfFileName: string;
  pdfSha256: string | null;
  clinical: boolean;
  titulo: string;
} | null> {
  const fila = await prisma.clientConsent.findFirst({
    where: {
      id: input.consentimientoId,
      tenantId: input.tenantId,
      clientId: input.clientId,
    },
    select: SELECT_CONSENTIMIENTO,
  });
  if (!fila || !fila.pdfFileName) return null;
  return {
    pdfFileName: fila.pdfFileName,
    pdfSha256: fila.pdfSha256,
    clinical: fila.clinical,
    titulo: tituloDeLaFila(fila),
  };
}

/** Los vigentes en palabras, para la sección del informe completo. */
export async function consentimientosVigentesLegibles(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<readonly { titulo: string; fecha: string }[]> {
  const filas = await filasDelPaciente(prisma, input);
  const cuenta = paraLaCuenta(filas);
  const salida: { titulo: string; fecha: string }[] = [];
  for (const p of PLANTILLAS_VIGENTES) {
    const vigente = consentimientoVigente(cuenta, p.id);
    if (!vigente) continue;
    const fila = filas.find((f) => f.id === vigente.id)!;
    salida.push({
      titulo: tituloDeLaFila(fila),
      fecha: fila.grantedAt.toISOString(),
    });
  }
  return salida;
}

export { PLANTILLA_DE_FOTOS };
export type { PlantillaDeConsentimiento };
