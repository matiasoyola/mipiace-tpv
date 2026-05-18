// Tests del validador de selecciones de modificadores
// (B-Bar-Modifiers · Frente 3). Comprueba exclusivity, required y
// cross-tenant fencing — la lógica que el POST /tickets aplica antes
// de calcular el subtotal.

import { describe, expect, it, vi } from "vitest";

import {
  resolveModifierSelectionsForLines,
  formatModifierSnapshotForHolded,
  type ModifierSnapshotEntry,
} from "../src/tickets/modifier-selection.js";

const TENANT = "00000000-0000-0000-0000-000000000001";

interface Group {
  id: string;
  tenantId: string;
  name: string;
  exclusive: boolean;
  required: boolean;
  deletedAt: Date | null;
  modifiers: Array<{
    id: string;
    label: string;
    priceDeltaCents: number;
    deletedAt: Date | null;
  }>;
}

interface ProductLink {
  productId: string;
  modifierGroupId: string;
}

function makePrisma(groups: Group[], links: ProductLink[]) {
  return {
    modifierGroup: {
      findMany: vi.fn(async ({ where }: any) => {
        return groups
          .filter((g) => {
            if (where.tenantId && g.tenantId !== where.tenantId) return false;
            if (where.deletedAt === null && g.deletedAt !== null) return false;
            if (where.id?.in && !where.id.in.includes(g.id)) return false;
            return true;
          })
          .map((g) => ({
            id: g.id,
            name: g.name,
            exclusive: g.exclusive,
            required: g.required,
            modifiers: g.modifiers
              .filter((m) => m.deletedAt === null)
              .map((m) => ({
                id: m.id,
                label: m.label,
                priceDeltaCents: m.priceDeltaCents,
              })),
          }));
      }),
    },
    productModifierGroup: {
      findMany: vi.fn(async ({ where }: any) => {
        return links.filter((l) => {
          if (where.productId?.in && !where.productId.in.includes(l.productId))
            return false;
          if (where.modifierGroup) {
            const g = groups.find((x) => x.id === l.modifierGroupId);
            if (!g) return false;
            if (where.modifierGroup.tenantId && g.tenantId !== where.modifierGroup.tenantId)
              return false;
            if (
              where.modifierGroup.deletedAt === null &&
              g.deletedAt !== null
            )
              return false;
            if (where.modifierGroup.required != null && g.required !== where.modifierGroup.required)
              return false;
          }
          return true;
        });
      }),
    },
  } as any;
}

const baseGroup: Group = {
  id: "g-leche",
  tenantId: TENANT,
  name: "Tipo de leche",
  exclusive: true,
  required: false,
  deletedAt: null,
  modifiers: [
    { id: "m-desnatada", label: "Desnatada", priceDeltaCents: 0, deletedAt: null },
    { id: "m-entera", label: "Entera", priceDeltaCents: 0, deletedAt: null },
  ],
};

describe("resolveModifierSelectionsForLines", () => {
  it("línea sin selecciones devuelve snapshot vacío y delta 0", async () => {
    const prisma = makePrisma([baseGroup], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      { productId: "p1", selections: [] },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resolved.snapshot).toEqual([]);
      expect(res.resolved.unitPriceDeltaCents).toBe(0);
    }
  });

  it("selección válida suma priceDelta y desnormaliza groupName/label", async () => {
    const groupSize: Group = {
      id: "g-tam",
      tenantId: TENANT,
      name: "Tamaño",
      exclusive: true,
      required: false,
      deletedAt: null,
      modifiers: [
        { id: "m-grande", label: "Grande", priceDeltaCents: 50, deletedAt: null },
      ],
    };
    const prisma = makePrisma([groupSize], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      {
        productId: "p-cafe",
        selections: [{ groupId: "g-tam", modifierId: "m-grande" }],
      },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resolved.unitPriceDeltaCents).toBe(50);
      expect(res.resolved.snapshot).toEqual<ModifierSnapshotEntry[]>([
        {
          groupId: "g-tam",
          groupName: "Tamaño",
          modifierId: "m-grande",
          label: "Grande",
          priceDeltaCents: 50,
        },
      ]);
    }
  });

  it("rechaza grupo cross-tenant (GROUP_NOT_FOUND)", async () => {
    const otherGroup = { ...baseGroup, tenantId: "tenant-x" };
    const prisma = makePrisma([otherGroup], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      {
        productId: "p1",
        selections: [{ groupId: "g-leche", modifierId: "m-desnatada" }],
      },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("GROUP_NOT_FOUND");
  });

  it("rechaza grupo soft-deleted", async () => {
    const deletedGroup = { ...baseGroup, deletedAt: new Date() };
    const prisma = makePrisma([deletedGroup], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      {
        productId: "p1",
        selections: [{ groupId: "g-leche", modifierId: "m-desnatada" }],
      },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("GROUP_NOT_FOUND");
  });

  it("rechaza modifier soft-deleted (MODIFIER_NOT_FOUND)", async () => {
    const grp: Group = {
      ...baseGroup,
      modifiers: [
        { id: "m-old", label: "Vieja", priceDeltaCents: 0, deletedAt: new Date() },
      ],
    };
    const prisma = makePrisma([grp], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      {
        productId: "p1",
        selections: [{ groupId: "g-leche", modifierId: "m-old" }],
      },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("MODIFIER_NOT_FOUND");
  });

  it("exclusive: 2 selecciones del mismo grupo → EXCLUSIVE_VIOLATION", async () => {
    const prisma = makePrisma([baseGroup], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      {
        productId: "p1",
        selections: [
          { groupId: "g-leche", modifierId: "m-desnatada" },
          { groupId: "g-leche", modifierId: "m-entera" },
        ],
      },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("EXCLUSIVE_VIOLATION");
  });

  it("no exclusive (multiselect): 2 selecciones es OK", async () => {
    const group: Group = { ...baseGroup, exclusive: false };
    const prisma = makePrisma([group], []);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      {
        productId: "p1",
        selections: [
          { groupId: "g-leche", modifierId: "m-desnatada" },
          { groupId: "g-leche", modifierId: "m-entera" },
        ],
      },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.resolved.snapshot).toHaveLength(2);
  });

  it("required: producto con grupo required y sin selección → REQUIRED_VIOLATION", async () => {
    const reqGroup: Group = { ...baseGroup, required: true };
    const prisma = makePrisma([reqGroup], [
      { productId: "p1", modifierGroupId: "g-leche" },
    ]);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      { productId: "p1", selections: [] },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("REQUIRED_VIOLATION");
      if (res.error.kind === "REQUIRED_VIOLATION") {
        expect(res.error.groupId).toBe("g-leche");
      }
    }
  });

  it("required: línea sin productId (caja libre) no comprueba required", async () => {
    const reqGroup: Group = { ...baseGroup, required: true };
    const prisma = makePrisma([reqGroup], [
      { productId: "p1", modifierGroupId: "g-leche" },
    ]);
    const results = await resolveModifierSelectionsForLines(prisma, TENANT, [
      { productId: null, selections: [] },
    ]);
    const res = results[0]!;
    expect(res.ok).toBe(true);
  });
});

describe("formatModifierSnapshotForHolded", () => {
  it("snapshot vacío → string vacío", () => {
    expect(formatModifierSnapshotForHolded([])).toBe("");
  });
  it("formato canónico (Grupo: Label; Grupo: Label)", () => {
    const snapshot: ModifierSnapshotEntry[] = [
      {
        groupId: "g1",
        groupName: "Tipo de leche",
        modifierId: "m1",
        label: "Desnatada",
        priceDeltaCents: 0,
      },
      {
        groupId: "g2",
        groupName: "Tamaño",
        modifierId: "m2",
        label: "Grande",
        priceDeltaCents: 50,
      },
    ];
    expect(formatModifierSnapshotForHolded(snapshot)).toBe(
      "(Tipo de leche: Desnatada; Tamaño: Grande)",
    );
  });
});
