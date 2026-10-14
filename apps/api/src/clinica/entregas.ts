// clinica-4 · LAS ENTREGAS DEL INFORME: apuntar y leer.
//
// Vive aparte de `informe.ts` por una razón mecánica y no de gusto: la
// historia viva (`historia.ts`) enseña las entregas en «Documentos», y
// `informe.ts` lee la historia viva para armar el informe. Con las dos
// cosas en el mismo fichero, los dos módulos se importan en círculo —
// funciona en ESM mientras nadie use nada en tiempo de carga, y es la
// clase de cosa que un día deja de funcionar por un `const` que alguien
// movió arriba.
//
// ── La tabla, y por qué además de `ClinicalAccessLog` ────────────────
//
// `clinical_report_deliveries`, de solo inserción. El prompt deja elegir
// entre esta tabla y el registro de accesos, y pide explicar la elección:
// **se hacen las dos**, porque contestan preguntas distintas y ninguna
// puede contestar la de la otra.
//
//   · `clinical_access_log` contesta «¿quién ha abierto esta historia?».
//     Su forma es cerrada desde clinica-1 —quién, a quién, cuándo, aparato,
//     ruta, permitido o no— y **no tiene sitio** para el canal ni para el
//     destinatario. La línea sale gratis: la ruta del informe pasa por
//     `conHistoria` con `action = EXPORT`, el valor que clinica-1 metió en
//     el enum sin usarlo (su decisión 11.7) escrito para hoy.
//   · esta tabla contesta «¿qué se le entregó a quién?», que es la
//     pregunta del paciente que pide su historia y la del abogado.
//
// Ensanchar el registro de accesos con un destinatario habría sido
// ensanchar la tabla que clinica-1 dejó deliberadamente estrecha («nada de
// salud entra aquí»); quedarse sólo con la tabla nueva habría dejado una
// lectura de la historia sin su línea en el registro.
//
// Y aquí **no entra ni un dato de salud**: ni el PDF, ni su contenido, ni
// el motivo de la derivación. El tipo de informe, sí: «derivación» no dice
// nada de la salud de nadie, y sin él la tabla no contesta su pregunta.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  NOMBRE_DE_TIPO_DE_INFORME,
  type TipoDeInforme,
} from "@mipiacetpv/clinica-sesion";

export const DESTINATARIOS = ["PACIENTE", "PROFESIONAL"] as const;
export type Destinatario = (typeof DESTINATARIOS)[number];

export const CANALES = ["PRINT", "EMAIL"] as const;
export type Canal = (typeof CANALES)[number];

/**
 * APUNTA la entrega.
 *
 * Tabla de solo inserción. La otra mitad —la línea del registro de
 * accesos— la escribe `conHistoria` con `action = EXPORT` por el hecho de
 * pasar por la ruta: no se llama a mano desde aquí, que es lo que hace que
 * el registro siga teniendo un solo punto de escritura (clinica-1).
 */
export async function apuntarEntrega(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    userId: string;
    tipo: TipoDeInforme;
    canal: Canal;
    destinatario: Destinatario;
    email: string | null;
    pdfSha256: string;
    ahora: Date;
  },
): Promise<{ id: string }> {
  return prisma.clinicalReportDelivery.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      userId: input.userId,
      report: input.tipo,
      channel: input.canal,
      recipient: input.destinatario,
      recipientEmail: input.canal === "EMAIL" ? input.email : null,
      pdfSha256: input.pdfSha256,
      at: input.ahora,
    },
    select: { id: true },
  });
}

export interface EntregaEnPantalla {
  id: string;
  tipo: string;
  tipoNombre: string;
  canal: string;
  destinatario: string;
  email: string | null;
  cuando: string;
  quien: string;
}

/** Las entregas de un paciente, para la pestaña «Documentos». */
export async function entregasDelPaciente(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<readonly EntregaEnPantalla[]> {
  const filas = await prisma.clinicalReportDelivery.findMany({
    where: { tenantId: input.tenantId, clientId: input.clientId },
    orderBy: { at: "desc" },
    take: 50,
    select: {
      id: true,
      report: true,
      channel: true,
      recipient: true,
      recipientEmail: true,
      at: true,
      user: { select: { alias: true, email: true } },
    },
  });
  return filas.map((f) => ({
    id: f.id,
    tipo: f.report,
    tipoNombre:
      NOMBRE_DE_TIPO_DE_INFORME[f.report as TipoDeInforme] ?? f.report,
    canal: f.channel,
    destinatario: f.recipient,
    email: f.recipientEmail,
    cuando: f.at.toISOString(),
    quien: f.user.alias?.trim() || f.user.email,
  }));
}
