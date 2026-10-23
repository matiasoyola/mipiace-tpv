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

import { dekONada } from "./claves.js";
import { cuerpoDeEntrada } from "./cripto-campos.js";
import type { PrismaClient } from "@mipiacetpv/db";
import type { CuerpoDeSesionCualquiera } from "@mipiacetpv/clinica-sesion";

/**
 * clinica-8 · LA RESPUESTA TIENE TRES VALORES, Y NO DOS.
 *
 * Hasta este bloque eran dos —la lista, o `null`— y `null` significaba a la
 * vez «aquí no hay nada clínico» y «la sesión cerrada no tiene nada que
 * cobrar». El cobro no podía distinguirlos, así que los dos acababan en los
 * servicios RESERVADOS de la cita. La auditoría del 18-10 lo cobró: una
 * sesión cerrada que no había dejado ni una línea se cobró como «Quiropodia
 * completa · 26 €» porque era lo que la cita reservaba. **Se cobró lo que no
 * se hizo, y nadie lo vio: los importes cuadran.**
 *
 * Los tres valores, y qué hace el cobro con cada uno:
 *
 *   · `null` — no hay sesión clínica que mirar (tenant sin clínica, cita sin
 *     sesión) **o la lectura falló**. El cobro sigue siendo el de siempre:
 *     los servicios de la cita. Es la memoria de la casa, «cobrar siempre se
 *     puede»: una lectura que revienta no puede tumbar una venta.
 *   · `{ lineas }` — lo que la podóloga marcó. Es lo que se cobra.
 *   · `{ sinNadaQueCobrar: true }` — hay sesión cerrada y LEGIBLE, y no deja
 *     ni una línea cobrable. No es un fallo: es un hecho de esa consulta
 *     (regla 11 de clinica-5 — una visita puede pasar sin servicio asignado).
 *     El cobro **no** se cae a lo reservado: abre el borrador vacío y lo
 *     dice, para que quien cobra añada el servicio que se hizo.
 *
 * La diferencia entre el tercero y el primero es si el CUERPO se pudo leer.
 * Un cuerpo ilegible es una lectura rota y cae al camino de siempre; un
 * cuerpo legible sin `tratamientos` es una sesión que no dejó nada que
 * cobrar, y eso sí se sabe.
 *
 * La forma de las líneas es la de `appointment_items` a propósito
 * (`{ serviceId }[]`): así `checkout.ts` no tiene dos ramas de
 * construcción de líneas, sólo dos orígenes para la misma. Una rama
 * paralela habría sido el sitio donde el día que alguien toque el IVA o el
 * descuento lo toque en una sola de las dos.
 */
export type LineasDeLaSesion =
  | { lineas: Array<{ serviceId: string }>; sinNadaQueCobrar?: false }
  | { sinNadaQueCobrar: true };

export async function lineasDeLaSesionCerrada(
  prisma: PrismaClient,
  input: { tenantId: string; appointmentId: string },
): Promise<LineasDeLaSesion | null> {
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
      // clinica-7 · `id` y `tenantId` los pide el AAD del cuerpo.
      select: { id: true, tenantId: true, body: true, bodyCifrado: true },
    });
    if (!sesion) return null;

    const cuerpo = cuerpoDeEntrada(
      { ...sesion, body: sesion.body as unknown },
      await dekONada(input.tenantId, prisma),
    ) as CuerpoDeSesionCualquiera | null;
    // clinica-8 · el cuerpo ILEGIBLE es una lectura rota, no una sesión sin
    // nada que cobrar. Se cae al camino de siempre, como cualquier otro
    // fallo de lectura de este fichero.
    if (cuerpo == null || typeof cuerpo !== "object") return null;

    const tratamientos = cuerpo.tratamientos;
    if (!Array.isArray(tratamientos) || tratamientos.length === 0) {
      // Sesión CERRADA, legible, y sin una sola línea cobrable. Desde
      // clinica-5 esto es legítimo (regla 11): un control de pie de riesgo
      // al que el centro no le ha puesto servicio es una visita que pasó y
      // que tiene que quedar escrita.
      //
      // Lo que NO se hace ya es caer a los servicios reservados de la cita.
      // Eso cobraba la previsión en vez del trabajo, y en una clínica la
      // previsión y el trabajo son dos cosas distintas: la cita se da como
      // «Quiropodia» y lo que se hizo fue el nivel que decidiera la
      // podóloga, o nada. El cobro abre el borrador vacío y lo dice.
      return { sinNadaQueCobrar: true };
    }
    return { lineas: tratamientos.map((serviceId) => ({ serviceId })) };
  } catch {
    // Ver la cabecera: con un fallo de lectura se cobra la cita como antes
    // de este bloque. Lo que no se hace nunca es tumbar el cobro.
    return null;
  }
}
