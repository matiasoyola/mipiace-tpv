// v1.11-cierre-de-dia · el caso delicado: terminal offline a la hora del
// corte de día.
//
// El escenario que hay que no romper: son las 05:00, el server cierra el
// turno de la caja. El terminal está sin red y sigue vendiendo contra ese
// turno. Cuando vuelve la conexión, su outbox sube tickets con el
// `shiftId` de un turno YA CERRADO. Hasta v1.10 eso era 409
// SHIFT_NOT_OPEN → `isPermanentRejection` → venta rechazada y perdida.
//
// La regla del prompt: se imputan al turno que les corresponde por su
// timestamp, no al turno abierto en ese momento.

import { describe, expect, it } from "vitest";

import { pickShiftForOccurrence, type ShiftWindow } from "../src/shift/impute.js";

const AYER: ShiftWindow = {
  id: "shift-ayer",
  openedAt: new Date("2026-08-10T07:00:00.000Z"), // 09:00 local
  closedAt: new Date("2026-08-11T03:00:00.000Z"), // corte de las 05:00
  closeReason: "AUTO_DAY_CUT",
};
const HOY: ShiftWindow = {
  id: "shift-hoy",
  openedAt: new Date("2026-08-11T07:00:00.000Z"), // 09:00 local
  closedAt: null,
  closeReason: "MANUAL",
};

describe("pickShiftForOccurrence · a qué turno pertenece una venta", () => {
  it("una venta de anoche va al turno de anoche, no al abierto ahora", () => {
    // 23:40 local de ayer. El terminal la subió esta mañana, pero el dinero
    // entró en el cajón de ayer y ahí es donde tiene que contar.
    const venta = new Date("2026-08-10T21:40:00.000Z");
    expect(pickShiftForOccurrence([AYER, HOY], venta)?.id).toBe("shift-ayer");
  });

  it("una venta de esta mañana va al turno de hoy", () => {
    const venta = new Date("2026-08-11T08:15:00.000Z");
    expect(pickShiftForOccurrence([AYER, HOY], venta)?.id).toBe("shift-hoy");
  });

  it("la ventana es semiabierta: una venta EN el instante del cierre no cae en el turno cerrado", () => {
    // Si cayera dentro, el Z recién archivado nacería desfasado por una
    // venta que en realidad pertenece al día siguiente.
    const venta = new Date("2026-08-11T03:00:00.000Z");
    expect(pickShiftForOccurrence([AYER, HOY], venta)).toBeNull();
  });

  it("el hueco entre el corte y la apertura del día siguiente no tiene turno", () => {
    // 06:00 local: el corte ya cerró ayer y nadie ha abierto caja todavía.
    // Devolver null es lo correcto — la decisión de qué hacer con esa venta
    // la toma `resolveShiftForSale` (turno abierto → si no, el cerrado).
    const venta = new Date("2026-08-11T04:00:00.000Z");
    expect(pickShiftForOccurrence([AYER, HOY], venta)).toBeNull();
  });

  it("una venta anterior a cualquier turno conocido no encaja en ninguno", () => {
    const venta = new Date("2026-08-09T10:00:00.000Z");
    expect(pickShiftForOccurrence([AYER, HOY], venta)).toBeNull();
  });

  it("con ventanas solapadas (reloj desviado) gana la apertura más reciente", () => {
    const colgado: ShiftWindow = {
      id: "colgado",
      openedAt: new Date("2026-08-10T07:00:00.000Z"),
      closedAt: null,
      closeReason: "MANUAL",
    };
    const nuevo: ShiftWindow = {
      id: "nuevo",
      openedAt: new Date("2026-08-11T07:00:00.000Z"),
      closedAt: null,
      closeReason: "MANUAL",
    };
    const venta = new Date("2026-08-11T09:00:00.000Z");
    expect(pickShiftForOccurrence([colgado, nuevo], venta)?.id).toBe("nuevo");
  });

  it("el orden de la lista no cambia el resultado", () => {
    const venta = new Date("2026-08-10T21:40:00.000Z");
    expect(pickShiftForOccurrence([HOY, AYER], venta)?.id).toBe("shift-ayer");
    expect(pickShiftForOccurrence([AYER, HOY], venta)?.id).toBe("shift-ayer");
  });

  it("un turno que sigue abierto acepta cualquier venta posterior a su apertura", () => {
    const dentroDeMucho = new Date("2026-08-11T20:00:00.000Z");
    expect(pickShiftForOccurrence([AYER, HOY], dentroDeMucho)?.id).toBe("shift-hoy");
  });
});
