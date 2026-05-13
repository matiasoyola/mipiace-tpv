import { getPrisma } from "../context.js";

// Lógica del estado del último turno de una caja al hacer login cajero
// (§4 nucleus, §3.2 prompt B3).
//
// Tabla de decisión:
//   - sin turno o último cerrado → needsShiftOpen
//   - último abierto + lastActivity HOY → reanudar
//   - último abierto + lastActivity ayer o antes → forceClose

export type ShiftStateForLogin =
  | { kind: "needsShiftOpen" }
  | {
      kind: "reanudar";
      shift: { id: string; openedAt: string; cashOpening: string };
    }
  | {
      kind: "forceClose";
      shift: {
        id: string;
        openedAt: string;
        lastActivityAt: string;
        cashOpening: string;
        ownedByUserId: string;
      };
    };

export async function getShiftStateForLogin(
  registerId: string,
  now: Date = new Date(),
): Promise<ShiftStateForLogin> {
  const prisma = getPrisma();
  const last = await prisma.shift.findFirst({
    where: { registerId },
    orderBy: { openedAt: "desc" },
    select: {
      id: true,
      openedAt: true,
      closedAt: true,
      lastActivityAt: true,
      cashOpening: true,
      userId: true,
    },
  });
  if (!last || last.closedAt != null) {
    return { kind: "needsShiftOpen" };
  }
  if (sameLocalDay(last.lastActivityAt, now)) {
    return {
      kind: "reanudar",
      shift: {
        id: last.id,
        openedAt: last.openedAt.toISOString(),
        cashOpening: last.cashOpening.toString(),
      },
    };
  }
  return {
    kind: "forceClose",
    shift: {
      id: last.id,
      openedAt: last.openedAt.toISOString(),
      lastActivityAt: last.lastActivityAt.toISOString(),
      cashOpening: last.cashOpening.toString(),
      ownedByUserId: last.userId,
    },
  };
}

function sameLocalDay(a: Date, b: Date): boolean {
  // Comparamos en UTC simple (yyyy-mm-dd). El TPV opera en una sola
  // tienda física por tenant en MVP; en B4+ podemos pasar a tz local
  // del tenant si surge un caso real.
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
