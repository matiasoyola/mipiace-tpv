// S1-sello · el doble de `shift_z_reports` para los tests con prisma
// falso. Vive fuera de cada fichero porque lo necesitan los dos caminos
// que cierran un turno (el cierre manual de `shift/routes.ts` y el corte
// de día de `shift/day-cut-run.ts`) y tienen que comportarse igual.
//
// Reproduce lo único que el código de producción da por hecho: el
// `sequence` sube de uno en uno por turno y el Z anterior queda marcado
// como corregido, no reescrito.

import { randomUUID } from "node:crypto";

export interface FakeZReport {
  id: string;
  shiftId: string;
  sequence: number;
  breakdown: unknown;
  sealedHash: string;
  sealedAt: Date;
  pdfPath: string | null;
  reason: string;
  supersededAt: Date | null;
  supersededById: string | null;
}

export interface FakeZReportStore {
  rows: FakeZReport[];
  /** El fragmento que se pega al objeto `fakePrisma`. */
  model: Record<string, unknown>;
  /** `$transaction(fn)` mínimo: ejecuta el callback con el mismo doble. */
  transaction: (fn: unknown) => Promise<unknown>;
  forShift: (shiftId: string) => FakeZReport[];
  reset: () => void;
}

export function createFakeZReports(getPrismaDouble: () => unknown): FakeZReportStore {
  const rows: FakeZReport[] = [];
  const store: FakeZReportStore = {
    rows,
    model: {
      findFirst: async ({ where, orderBy }: any) => {
        const found = rows.filter((r) => r.shiftId === where.shiftId);
        found.sort((a, b) =>
          orderBy?.sequence === "desc" ? b.sequence - a.sequence : a.sequence - b.sequence,
        );
        return found[0] ?? null;
      },
      findMany: async ({ where, orderBy }: any) => {
        const found = rows.filter((r) => r.shiftId === where.shiftId);
        found.sort((a, b) =>
          orderBy?.sequence === "desc" ? b.sequence - a.sequence : a.sequence - b.sequence,
        );
        return found;
      },
      create: async ({ data }: any) => {
        const row: FakeZReport = {
          id: randomUUID(),
          shiftId: data.shiftId,
          sequence: data.sequence,
          breakdown: data.breakdown,
          sealedHash: data.sealedHash,
          sealedAt: new Date(),
          pdfPath: data.pdfPath ?? null,
          reason: data.reason,
          supersededAt: null,
          supersededById: null,
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("z report not found");
        Object.assign(row, data);
        return row;
      },
    },
    transaction: async (fn: unknown) => {
      if (typeof fn === "function") return await (fn as (tx: unknown) => unknown)(getPrismaDouble());
      return Promise.all(fn as unknown[]);
    },
    forShift: (shiftId: string) =>
      rows.filter((r) => r.shiftId === shiftId).sort((a, b) => a.sequence - b.sequence),
    reset: () => {
      rows.length = 0;
    },
  };
  return store;
}
