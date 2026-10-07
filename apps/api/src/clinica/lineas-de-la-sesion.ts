// clinica-3 · lo que el camino de cobro de siempre le pregunta a lo
// clínico, y lo ÚNICO que le pregunta.
//
// `agenda/checkout.ts` llama aquí una vez y recibe, o la lista de
// tratamientos que la podóloga marcó en la sesión cerrada de esa cita, o
// `null` — y con `null` sigue siendo el camino de antes, línea por línea.
//
// ── Por qué este fichero existe en vez de un import directo ──────────
//
// Porque la dirección de la dependencia importa. El cobro es el camino que
// usan los quince clientes de hoy y la clínica es un módulo de uno; que
// `checkout.ts` importe `clinica/sesion.ts` entero —con su vista, sus
// alertas y su valoración— sería atar el cobro de Sole a lo clínico. Aquí
// la superficie es una función con una respuesta de dos valores, y lo que
// el cobro sabe de la historia clínica es exactamente eso.
//
// ── Y la capability PRIMERO ──────────────────────────────────────────
//
// Es lo que hace verdad la frase «Sole y los demás no notan nada»: un
// tenant sin la historia encendida sale en la primera línea y no paga ni
// una consulta. Misma forma que `valoracionesPendientesDe` de clinica-2 y
// que `resolverAccesoClinico` de clinica-1, que tampoco gastan consulta
// cuando el veredicto ya no puede cambiar.
//
// La lectura **falla hacia «no hay sesión»**, igual que el gate del módulo
// (`clinicaIsEnabled`) y por la misma razón, que aquí se dobla: una
// lectura que revienta no puede ser el motivo de que no se pueda cobrar
// una cita. Con `null`, el cobro abre el ticket con los servicios de la
// cita —el comportamiento de master— y la podóloga ve un importe que no es
// el que esperaba, que es un problema de un ticket y no una venta perdida.
// Es la memoria de la casa: «cobrar siempre se puede».

import type { PrismaClient } from "@mipiacetpv/db";
import type { CuerpoDeSesion } from "@mipiacetpv/clinica-sesion";

/**
 * Los tratamientos de la sesión cerrada de esta cita, en el orden en que
 * se marcaron, o `null` si no hay ninguna.
 *
 * La forma de la respuesta es la de `appointment_items` a propósito
 * (`{ serviceId }[]`): así `checkout.ts` no tiene dos ramas de
 * construcción de líneas, sólo dos orígenes para la misma. Una rama
 * paralela habría sido el sitio donde el día que alguien toque el IVA o el
 * descuento lo toque en una sola de las dos.
 */
export async function lineasDeLaSesionCerrada(
  prisma: PrismaClient,
  input: { tenantId: string; appointmentId: string },
): Promise<Array<{ serviceId: string }> | null> {
  try {
    // 1 · la capability, antes de nada.
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { clinicalRecordsEnabled: true },
    });
    if (tenant?.clinicalRecordsEnabled !== true) return null;

    // 2 · la sesión de esta cita. El índice parcial
    // `clinical_entries_una_sesion_por_cita` garantiza que es una o
    // ninguna, así que `findFirst` no está eligiendo entre varias.
    const sesion = await prisma.clinicalEntry.findFirst({
      where: {
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        kind: "TREATMENT_SESSION",
      },
      select: { body: true },
    });
    if (!sesion) return null;

    const cuerpo = sesion.body as unknown as CuerpoDeSesion | null;
    const tratamientos = cuerpo?.tratamientos;
    if (!Array.isArray(tratamientos) || tratamientos.length === 0) {
      // Una sesión sin tratamientos no se puede cerrar
      // (`normalizarSesion` lo impide y el schema de la ruta también), así
      // que esto es un cuerpo de una versión que no se sabe leer. Y
      // entonces lo honesto es NO inventarse las líneas: se cae al camino
      // de siempre, que cobra los servicios de la cita. Cobrar cero
      // habría sido peor que cobrar la previsión.
      return null;
    }
    return tratamientos.map((serviceId) => ({ serviceId }));
  } catch {
    // Ver la cabecera: con un fallo de lectura se cobra la cita como antes
    // de este bloque. Lo que no se hace nunca es tumbar el cobro.
    return null;
  }
}
