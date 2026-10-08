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
//
// ── clinica-5 · POR QUÉ ESTE FICHERO NO CAMBIÓ AL LLEGAR LOS TIPOS ───
//
// El prompt pide que las líneas sean las de **todos** los tipos marcados,
// «con el mismo camino de cobro de siempre (sin rama paralela)». Y la
// forma de cumplirlo de verdad fue no tocar esto:
//
// Al cerrar, `serviciosDeLaSesion` resuelve los servicios de todos los
// tipos —para la quiropodia, el producto del NIVEL elegido; para el resto,
// los servicios tocados— y el resultado se CONGELA en `tratamientos`, la
// misma clave que leía la v1. Así que aquí se sigue leyendo una lista de
// ids y este fichero no sabe que existen los tipos, ni los niveles, ni el
// riesgo del pie.
//
// La alternativa era recorrer los bloques desde aquí, y entonces el cobro
// tendría que saber qué es un nivel de quiropodia. La derivación vive en
// UNA función pura con su test (`sesion-v2.test.ts`, «dos tipos, dos
// líneas a caja») y el cobro lee lo que esa función dejó escrito.

import type { PrismaClient } from "@mipiacetpv/db";
import type { CuerpoDeSesionCualquiera } from "@mipiacetpv/clinica-sesion";

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

    const cuerpo = sesion.body as unknown as CuerpoDeSesionCualquiera | null;
    const tratamientos = cuerpo?.tratamientos;
    if (!Array.isArray(tratamientos) || tratamientos.length === 0) {
      // DOS casos caen aquí, y los dos acaban igual a propósito:
      //
      //   · un cuerpo de una versión que no se sabe leer (en la v1 una
      //     sesión sin tratamientos no se podía cerrar siquiera);
      //   · y, desde clinica-5, una sesión v2 legítima en la que NINGÚN
      //     tipo marcado tiene servicio asignado — la pantalla lo enseña
      //     como «sin cobro» (regla 11 del prompt).
      //
      // En los dos, lo honesto es NO inventarse las líneas: se cae al
      // camino de siempre, que cobra los servicios de la cita. Y hay una
      // razón de más para el segundo caso: `checkoutAppointment` contesta
      // `APPOINTMENT_EMPTY` con cero líneas, así que devolver `[]` aquí
      // sería bloquear el cobro de una cita que tiene su previsión. Cobrar
      // la previsión es un importe que la dueña puede corregir en el
      // ticket; no poder cobrar es una venta perdida con la paciente
      // delante. «Cobrar siempre se puede».
      return null;
    }
    return tratamientos.map((serviceId) => ({ serviceId }));
  } catch {
    // Ver la cabecera: con un fallo de lectura se cobra la cita como antes
    // de este bloque. Lo que no se hace nunca es tumbar el cobro.
    return null;
  }
}
