// clinica-4 · EL INFORME: se arma, se pinta, se entrega y queda apuntado.
//
// Hoy, cuando un paciente pide su historia o Rosario lo deriva, lo que
// hace es fotocopiar el papel. Esto saca el informe con un toque y deja
// apuntado a quién se entregó.
//
// ── No recalcula NADA ────────────────────────────────────────────────
//
// Decisión 18 del prompt: las fuentes ya existen (clinica-2, -3, -5 y las
// funciones de clinica-6) y el informe **no recalcula reglas clínicas**.
// Así que esto lee `vistaDeLaHistoria` —la MISMA llamada que pinta la
// historia viva— y le pasa el resultado a `construirInforme`, que es puro.
//
// Eso tiene una consecuencia que vale la pena nombrar: **el informe no
// puede decir que una zona está curada si la pantalla dice que está
// activa.** Son el mismo cálculo, hecho una vez. Con un lector propio
// serían dos verdades sobre el mismo pie, y la que viajaría en papel a
// otro profesional sería la de este fichero.
//
// ── Ni un importe ────────────────────────────────────────────────────
//
// Regla 16. `vistaDeLaHistoria` ya no trae ninguna clave de dinero (lo
// fija su test desde clinica-6) y `InformeClinico` no tiene dónde ponerla.
// Dos capas, y las dos son de tipo, no de `if`.
//
// ── El email NO lleva datos de salud en el cuerpo ────────────────────
//
// Regla 17, y es la razón por la que el cuerpo del correo lo escribe
// `informe-email.ts` con una lista cerrada de lo que puede decir. El PDF
// va adjunto: un adjunto se abre a propósito, y el cuerpo de un correo se
// lee en la pantalla de bloqueo del móvil, que ve quien esté al lado.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  construirInforme,
  MAPA_PIE_V1,
  NOMBRE_DE_TIPO_DE_INFORME,
  TIPOS_DE_INFORME,
  type InformeClinico,
  type TipoDeInforme,
} from "@mipiacetpv/clinica-sesion";
import {
  preguntasEnJuego,
  valorVigente,
  type Respuesta,
} from "@mipiacetpv/clinica-valoracion";
import { renderInformeClinicoPdf } from "@mipiacetpv/ticket-pdf";

import {
  consentimientosVigentesLegibles,
  datosDelCentro,
  diaCorto,
  fechaLarga,
} from "./consentimientos.js";
import { huellaDe } from "./ficheros.js";
import { vistaDeLaHistoria } from "./historia.js";
import { edadDe } from "./sesion.js";
import { vistaDeLaValoracion } from "./valoracion.js";

export { TIPOS_DE_INFORME, NOMBRE_DE_TIPO_DE_INFORME };
export type { TipoDeInforme };

// Las entregas viven en `entregas.ts` (ver su cabecera: el círculo de
// imports con la historia viva). Se re-exportan para que quien use el
// informe no tenga que saber que son dos ficheros.
export {
  apuntarEntrega,
  CANALES,
  DESTINATARIOS,
  entregasDelPaciente,
  type Canal,
  type Destinatario,
  type EntregaEnPantalla,
} from "./entregas.js";

/** Cómo se lee una respuesta del cuestionario en el papel. */
const RESPUESTA_LEGIBLE: Record<Respuesta, string> = {
  SI: "Sí",
  NO: "No",
  NO_SE: "No lo sabe",
};

export interface InformeArmado {
  informe: InformeClinico;
  /** La cabecera del papel: centro, profesional y fecha. */
  centro: Awaited<ReturnType<typeof datosDelCentro>>;
  profesional: { nombre: string; colegiado: string | null; titulo: string };
  paciente: { nombre: string; edad: number | null; email: string | null };
  fecha: string;
}

/** El título del profesional en el papel. Pendiente de Rosario (§8). */
const TITULO_DEL_PROFESIONAL = "Podología";

/**
 * ARMA el informe con las fuentes que ya existen.
 *
 * `ahora` entra por la puerta y no se lee del reloj aquí dentro, igual que
 * en `vistaDeLaHistoria`: lo que decide la fecha del documento tiene que
 * poder fijarse en un test sin congelar el reloj del proceso.
 */
export async function armarInforme(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    tipo: TipoDeInforme;
    /** Quién firma el informe: el sanitario que lo saca. */
    userId: string;
    /** El texto breve de la derivación. `null` en los otros tres. */
    motivoDeDerivacion: string | null;
    ahora: Date;
  },
): Promise<InformeArmado> {
  const [historia, valoracion, centro, quien, paciente, consentimientos] =
    await Promise.all([
    // LA MISMA llamada que pinta la historia viva. Ver la cabecera.
    vistaDeLaHistoria(prisma, {
      tenantId: input.tenantId,
      clientId: input.clientId,
      ahora: input.ahora,
    }),
    // Y la valoración, por sus RESPUESTAS: la historia viva sólo devuelve
    // las alertas (lo que sube a la franja roja), y el informe de acceso
    // tiene que llevar lo que el paciente contestó, pregunta por pregunta.
    vistaDeLaValoracion(prisma, {
      tenantId: input.tenantId,
      clientId: input.clientId,
    }),
    datosDelCentro(prisma, input.tenantId),
    prisma.user.findFirstOrThrow({
      where: { id: input.userId, tenantId: input.tenantId },
      select: { alias: true, email: true, clinicianLicense: true },
    }),
    prisma.client.findFirstOrThrow({
      where: { id: input.clientId, tenantId: input.tenantId },
      select: { firstName: true, lastName: true, birthdate: true, email: true },
    }),
    consentimientosVigentesLegibles(prisma, input),
  ]);

  const informe = construirInforme(input.tipo, {
    alertas: historia.cabecera.alertas,
    alertasPorValidar: historia.cabecera.alertasPorValidar,
    valoracion: respuestasLegibles(valoracion),
    exploracion: historia.sensibilidad
      ? {
          fecha: historia.sensibilidad.fecha,
          autor: historia.sensibilidad.autor,
          pulsos: historia.sensibilidad.pulsos,
          tipoDePie: historia.sensibilidad.tipoDePie,
          sinSensibilidad: historia.sensibilidad.sinSensibilidad,
          puntosTotales: historia.sensibilidad.puntosTotales,
        }
      : null,
    zonas: historia.zonas,
    visitas: historia.visitas,
    recomendaciones: await consejosDeLaUltima(prisma, input),
    consentimientos,
    motivoDeDerivacion: input.motivoDeDerivacion,
    dia: (iso) => fechaLarga(iso),
  });

  return {
    informe,
    centro,
    profesional: {
      nombre: quien.alias?.trim() || quien.email,
      colegiado: quien.clinicianLicense,
      titulo: TITULO_DEL_PROFESIONAL,
    },
    paciente: {
      nombre: `${paciente.firstName} ${paciente.lastName}`.trim(),
      edad: edadDe(paciente.birthdate),
      email: paciente.email,
    },
    fecha: fechaLarga(input.ahora),
  };
}

/**
 * Las respuestas de la valoración, en palabras.
 *
 * Con la **corrección del sanitario aplicada encima** (`valorVigente`) y
 * sólo las preguntas EN JUEGO: si la podóloga corrigió la diabetes a «No»,
 * el seguimiento de la insulina deja de estar en juego y no sale en el
 * papel. Es la misma cuenta que hace su pantalla, con la misma función —y
 * por eso el informe no puede decir una cosa y la pantalla otra.
 *
 * Y con la versión del cuestionario CON LA QUE SE CONTESTÓ, que es la que
 * `vistaDeLaValoracion` devuelve: un informe de acceso que pintara las
 * preguntas de hoy sobre respuestas de hace dos años diría que el paciente
 * contestó algo que no se le preguntó.
 */
function respuestasLegibles(
  vista: Awaited<ReturnType<typeof vistaDeLaValoracion>>,
): readonly { pregunta: string; respuesta: string }[] {
  const cuestionario = vista.cuestionario;
  if (!cuestionario || !vista.valoracion) return [];
  const estado = {
    respuestasPaciente: vista.respuestasPaciente,
    correcciones: vista.correcciones,
  };
  const valorDe = (id: string) => valorVigente(estado, id);
  return preguntasEnJuego(cuestionario, valorDe)
    .map((p) => {
      const v = valorDe(p.id);
      return v == null
        ? null
        : { pregunta: p.texto, respuesta: RESPUESTA_LEGIBLE[v] };
    })
    .filter((x): x is { pregunta: string; respuesta: string } => x != null);
}

/**
 * Los consejos para casa de la última visita que dejó alguno.
 *
 * De la ÚLTIMA que los tenga y no de todas juntas: lo que el paciente se
 * lleva a casa es lo que se le dijo esta vez. Y no se recalculan: se leen
 * del cuerpo de la sesión, que es donde la podóloga los dejó escritos.
 */
async function consejosDeLaUltima(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<readonly string[]> {
  const filas = await prisma.clinicalEntry.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT_SESSION",
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { body: true },
  });
  for (const f of filas) {
    const cuerpo = f.body as { consejosNombre?: unknown; consejos?: unknown };
    const nombres = cuerpo?.consejosNombre;
    if (Array.isArray(nombres) && nombres.length > 0) {
      return nombres.filter((x): x is string => typeof x === "string");
    }
  }
  return [];
}

export interface PdfDelInforme {
  pdf: Uint8Array;
  sha256: string;
  /** El nombre con el que se baja o se adjunta. Sin datos del paciente:
   *  un adjunto llamado «informe-carmen-rodriguez-diabetes.pdf» cuenta la
   *  historia en el nombre del fichero. */
  nombreDeFichero: string;
}

/** Pinta el informe armado. */
export async function pdfDelInforme(
  armado: InformeArmado,
): Promise<PdfDelInforme> {
  const pdf = await renderInformeClinicoPdf({
    centro: armado.centro,
    profesional: armado.profesional,
    fecha: armado.fecha,
    titulo: armado.informe.titulo,
    subtitulo: armado.informe.subtitulo,
    paciente: { nombre: armado.paciente.nombre, edad: armado.paciente.edad },
    secciones: armado.informe.secciones,
    piePropio: armado.informe.piePropio,
    diaCorto: (iso) => diaCorto(iso),
  });
  return {
    pdf,
    sha256: huellaDe(pdf),
    nombreDeFichero: `informe-clinico-${armado.informe.tipo.toLowerCase()}.pdf`,
  };
}

/** El mapa, para que la pantalla pinte la gráfica con la misma versión. */
export const VERSION_DEL_MAPA_DEL_INFORME = MAPA_PIE_V1.version;
