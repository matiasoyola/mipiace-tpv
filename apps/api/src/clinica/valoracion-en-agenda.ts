// clinica-2 · el aviso de la agenda: «Valoración pendiente».
//
// Lo ÚNICO que la agenda sabe de lo clínico, y es a propósito.
//
// ── Qué sale, y qué NO ────────────────────────────────────────────────
//
// Sale **una lista de ids de paciente**. Ni una alerta, ni una respuesta,
// ni el estado concreto («sin responder» / «sin validar»), ni cuántas
// preguntas quedan. Decisión de producto 6 (Matías, 05-10): *las alertas
// de salud viven sólo dentro de la historia; la agenda y la caja sólo
// enseñan contacto.*
//
// Y el aviso ES compatible con eso: «este paciente tiene algo pendiente de
// hacer antes de su primer tratamiento» es información de AGENDA, no de
// salud. No dice que esté enfermo de nada; dice que falta un trámite. La
// recepcionista lo necesita para poder decirle «le hemos mandado unas
// preguntas, ¿le llegaron?» sin leer una sola respuesta.
//
// Tampoco se distingue «sin responder» de «sin validar», y tiene su razón:
// la primera es trabajo del paciente y la segunda de la podóloga, pero la
// agenda no es la pantalla donde se actúa sobre ninguna de las dos. Un
// estado más es una invitación a interpretarlo delante del mostrador.
//
// ── Y no cuesta nada en los catorce tenants no clínicos ───────────────
//
// La capability es lo PRIMERO que mira el WHERE, y la función sale antes
// si no hay pacientes en el rango. Un bar con la agenda llena no paga ni
// una consulta por este bloque.

import type { PrismaClient } from "@mipiacetpv/db";

/**
 * De los pacientes que aparecen en el rango de la agenda, cuáles tienen
 * una valoración SIN VALIDAR (pendiente de contestar o contestada y sin
 * revisar).
 *
 * Lo que NO lleva el resultado es tan importante como lo que lleva: una
 * lista de ids y nada más.
 *
 * **No pasa por `conHistoria` ni deja línea en el registro**, y es la
 * misma decisión que clinica-1 tomó con `GET /clients/:id` (§11.1 de su
 * done): la agenda es la pantalla por la que el mostrador pasa cincuenta
 * veces al día, y apuntar un acceso por cada pintada llenaría de ruido la
 * lista de «quién ha abierto la historia de este paciente» justo con lo
 * que NO es un intento de abrirla. Aquí además no hay nada que registrar:
 * no se lee ni una respuesta.
 */
export async function valoracionesPendientesDe(
  prisma: PrismaClient,
  tenantId: string,
  clientIds: ReadonlyArray<string | null>,
): Promise<string[]> {
  const ids = [...new Set(clientIds.filter((x): x is string => x != null))];
  if (ids.length === 0) return [];

  const filas = await prisma.clinicalAssessment.findMany({
    where: {
      tenant: { id: tenantId, clinicalRecordsEnabled: true },
      clientId: { in: ids },
      status: { not: "VALIDADA" },
    },
    select: { clientId: true },
  });
  return [...new Set(filas.map((f) => f.clientId))];
}
