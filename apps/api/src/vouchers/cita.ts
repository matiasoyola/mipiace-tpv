// B-reservas-8 · lo que le pasa al bono cuando le pasa algo a la cita.
//
// Dos sucesos y una decisión del centro:
//
//   · **Anular la cita LIBERA lo apartado.** No se discute: la sesión
//     vuelve a estar libre y la clienta puede volver a citarse.
//   · **No-show: lo decide el centro** (`Tenant.bonoNoShow`), `consumir`
//     por defecto —que es lo que hace el spa— o `liberar`.
//
// Vive aquí y no en `agenda/routes.ts` porque es una regla de los bonos, no
// de la agenda: el día que la reserva online anule una cita tiene que pasar
// exactamente esto, y tiene que pasar en un sitio.
//
// ── Por qué el no-show que consume NO revalida la cobertura ────────────
//
// Porque no se hizo nada. La cobertura se comprobó al apartar y está
// congelada en el bono, así que volver a comprobarla sólo puede dar el
// mismo «sí» — y si diera «no» (un bono corregido a mano entre medias), la
// dirección correcta es liberar, no consumir contra algo que no cubre.
// Eso es exactamente lo que hace `consumir()`, así que se le pasa el
// servicio de la cita y se deja que decida.

import type { PrismaClient } from "@mipiacetpv/db";

import { consumir, liberar } from "./gate.js";
import { serviciosACubrir } from "./servicios.js";

export type PoliticaNoShow = "consumir" | "liberar";

export interface ConsecuenciaInput {
  prisma: PrismaClient;
  tenantId: string;
  appointmentId: string;
  /** Los servicios de la cita, para el único caso que los necesita. */
  serviceIds: string[];
  canal: "tpv" | "panel" | "web";
  userId: string | null;
  ahora: Date;
}

/** Qué pasó, para el log y para la respuesta. `null` = la cita no era de
 *  bono y no se hizo nada (el caso de las catorce cuentas sin bonos y de
 *  todas las citas normales de las que sí los tienen). */
export type Consecuencia =
  | { que: "liberada"; voucherId: string | null }
  | { que: "consumida"; voucherId: string | null }
  | { que: "nada" };

/** Anular una cita libera lo apartado. Idempotente por el libro. */
export async function liberarPorAnulacion(
  input: ConsecuenciaInput & { detalle: string },
): Promise<Consecuencia> {
  const res = await input.prisma.$transaction(async (tx) =>
    liberar(tx, {
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      detalle: input.detalle,
      canal: input.canal,
      userId: input.userId,
      actor: input.userId == null ? "Web" : null,
      ahora: input.ahora,
    }),
  );
  if (res.yaEstaba && res.bono == null) return { que: "nada" };
  return { que: "liberada", voucherId: res.bono?.id ?? null };
}

/**
 * No-show, según el ajuste del centro.
 *
 * `consumir` es el default porque es lo que hace el spa: la sesión se pierde
 * igual que se pierde la hora de la cabina. `liberar` existe porque hay
 * centros que no cobran el plantón, y el prompt deja la decisión al centro.
 */
export async function resolverNoShow(
  input: ConsecuenciaInput & { politica: PoliticaNoShow },
): Promise<Consecuencia> {
  if (input.politica === "liberar") {
    return liberarPorAnulacion({
      ...input,
      detalle: "Liberada: la clienta no vino y este centro no cobra el plantón.",
    });
  }
  return input.prisma.$transaction(async (tx) => {
    const servicios = await serviciosACubrir(
      tx,
      input.tenantId,
      input.serviceIds,
    );
    const res = await consumir(tx, {
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      ticketLineId: null,
      // Cualquiera de los servicios de la cita sirve: el bono tuvo que
      // cubrirlos TODOS para poder apartarse. Si la cita se quedó sin
      // servicios (no puede pasar: el alta exige al menos uno), se pasa uno
      // imposible y `consumir()` liberará, que es la dirección segura.
      servicio: servicios[0] ?? { id: "", tags: [] },
      detalle: "Consumida: la clienta no vino (no-show).",
      detalleSiNoCubre:
        "Liberada en el no-show: el bono ya no cubre el servicio de esta cita.",
      canal: input.canal,
      userId: input.userId,
      actor: input.userId == null ? "Web" : null,
      ahora: input.ahora,
    });
    if (res.ok) {
      if (res.yaEstaba) return { que: "nada" };
      return { que: "consumida", voucherId: res.bono.id };
    }
    if (res.motivo === "no_cubre") {
      return { que: "liberada", voucherId: res.bono.id };
    }
    return { que: "nada" };
  });
}
