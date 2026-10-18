// auditoria-sirope (#18) · LAS MESAS QUE SE VACIARON CON CONSUMO.
//
// El 18-10 se vaciaron cinco mesas con consumo en Cafetería Sirope y al
// día siguiente no había dónde mirarlo: el informe Z no las contaba, el
// resumen del turno tampoco, y el único rastro era un ticket `VOIDED`
// en la base.
//
// Vaciar una mesa con platos dentro es comida que salió de la cocina y
// no se cobró. No es un error del sistema —a veces se invita, a veces
// se equivoca la comanda, a veces alguien se va sin pagar—, pero es
// dinero que no entró y tiene que poder verse al cerrar el día, que es
// cuando el dueño mira.
//
// Lo que NO se cuenta aquí: las mesas vacías. Abrir una mesa por error
// y cerrarla sin pedir nada no es nada, y contarlo llenaría el Z de
// ruido que esconde las cinco que importan.

import type { MotivoVaciado } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";

export interface MesasVaciadas {
  /** Cuántas, con consumo. */
  count: number;
  /** Lo que valía lo que se vació. */
  total: number;
  /** El desglose por motivo, para el informe del dueño. */
  porMotivo: Array<{ motivo: MotivoVaciado | null; count: number; total: number }>;
}

export const MESAS_VACIADAS_VACIO: MesasVaciadas = {
  count: 0,
  total: 0,
  porMotivo: [],
};

/** Lo que se vació con consumo en este turno. */
export async function contarMesasVaciadas(
  prisma: ReturnType<typeof getPrisma>,
  shiftId: string,
): Promise<MesasVaciadas> {
  const filas = await prisma.ticket.findMany({
    where: {
      shiftId,
      status: "VOIDED",
      // Sólo lo que vació una persona desde la caja o desde el panel: el
      // barrido de las 05:00 sólo toca mesas vacías y no tiene nada que
      // contar aquí.
      voidReason: { in: ["MANUAL", "MANAGER_VOID"] },
    },
    select: { total: true, voidMotivo: true, _count: { select: { lines: true } } },
  });
  // «Con consumo» es tener líneas o importe. El `?? 0` no es cautela
  // vacía: `_count` es una proyección y un `select` que no la pida —o un
  // doble de pruebas— devolvería la fila sin ella. Sin el recuento, el
  // importe sigue decidiendo, que es el dato que de verdad importa aquí.
  const conConsumo = filas.filter(
    (t) => (t._count?.lines ?? 0) > 0 || Number(t.total) > 0,
  );
  const porMotivo = new Map<MotivoVaciado | null, { count: number; total: number }>();
  let total = 0;
  for (const t of conConsumo) {
    const importe = Number(t.total);
    total += importe;
    const previo = porMotivo.get(t.voidMotivo) ?? { count: 0, total: 0 };
    porMotivo.set(t.voidMotivo, {
      count: previo.count + 1,
      total: Math.round((previo.total + importe) * 100) / 100,
    });
  }
  return {
    count: conConsumo.length,
    total: Math.round(total * 100) / 100,
    porMotivo: [...porMotivo.entries()].map(([motivo, v]) => ({
      motivo,
      count: v.count,
      total: v.total,
    })),
  };
}

/** «Invitación», para el papel. */
export const ETIQUETA_MOTIVO: Record<MotivoVaciado, string> = {
  INVITACION: "Invitación",
  ERROR_DE_COMANDA: "Error de comanda",
  SE_FUERON_SIN_PAGAR: "Se fueron sin pagar",
  OTRO: "Otro",
};
