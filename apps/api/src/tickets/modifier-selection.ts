// Validación + snapshot de selecciones de modificadores para POST
// /tickets y endpoints derivados (mesa, checkout). El backend recibe
// `{ groupId, modifierId }[]` por línea y debe:
//
//   1. Validar que cada groupId existe (no soft-deleted) y pertenece al
//      tenant.
//   2. Validar que cada modifierId pertenece a su groupId (consistencia
//      relacional — un cliente que mande groupId/modifierId cruzados
//      sólo se valida bien con ambos lados).
//   3. Validar exclusivity: si group.exclusive=true, sólo 1 modifier
//      seleccionado de ese grupo.
//   4. Validar required: si el grupo está asociado al producto (vía
//      ProductModifierGroup) y group.required=true, debe haber al menos
//      1 modifier seleccionado del grupo.
//   5. Devolver el `unitPriceDeltaCents` agregado (suma de los deltas
//      seleccionados) y el snapshot desnormalizado para persistir en
//      `TicketLine.modifiers`.
//
// El cálculo de subtotal lo hace el caller — esta función sólo agrega
// los deltas y devuelve metadata. Mantiene unit handling centralizado.

import type { PrismaClient } from "@mipiacetpv/db";

export interface ModifierSelectionInput {
  groupId: string;
  modifierId: string;
}

export interface ModifierSnapshotEntry {
  groupId: string;
  groupName: string;
  modifierId: string;
  label: string;
  priceDeltaCents: number;
}

export interface ResolvedLineModifiers {
  // En céntimos, por unidad. El caller calcula:
  //   effectiveUnitPrice = unitPrice + unitPriceDeltaCents / 100
  unitPriceDeltaCents: number;
  snapshot: ModifierSnapshotEntry[];
}

export type ModifierValidationError =
  | { kind: "GROUP_NOT_FOUND"; groupId: string }
  | { kind: "MODIFIER_NOT_FOUND"; groupId: string; modifierId: string }
  | { kind: "EXCLUSIVE_VIOLATION"; groupId: string }
  | { kind: "REQUIRED_VIOLATION"; groupId: string };

export type ResolveResult =
  | { ok: true; resolved: ResolvedLineModifiers }
  | { ok: false; error: ModifierValidationError };

interface LineContext {
  productId: string | null;
  selections: ModifierSelectionInput[];
}

// Resuelve todas las líneas en una sola consulta a BD. Más eficiente que
// validar línea por línea cuando un ticket tiene muchas líneas.
export async function resolveModifierSelectionsForLines(
  prisma: PrismaClient,
  tenantId: string,
  lines: LineContext[],
): Promise<ResolveResult[]> {
  // Agregar todos los groupIds y modifierIds únicos para una sola query.
  const allGroupIds = new Set<string>();
  const allModifierIds = new Set<string>();
  for (const line of lines) {
    for (const sel of line.selections) {
      allGroupIds.add(sel.groupId);
      allModifierIds.add(sel.modifierId);
    }
  }

  // Productos cuyo `required` aplicable hay que comprobar — cualquier
  // línea con productId set podría tener grupos required asociados que
  // NO aparecen en `selections` (omisión). Resolver los grupos asociados
  // al producto que sean required.
  const productIdsWithRequiredCheck = new Set<string>();
  for (const line of lines) {
    if (line.productId) productIdsWithRequiredCheck.add(line.productId);
  }

  const [groups, productRequiredLinks] = await Promise.all([
    allGroupIds.size > 0
      ? prisma.modifierGroup.findMany({
          where: {
            id: { in: Array.from(allGroupIds) },
            tenantId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            exclusive: true,
            required: true,
            modifiers: {
              where: { deletedAt: null },
              select: {
                id: true,
                label: true,
                priceDeltaCents: true,
              },
            },
          },
        })
      : Promise.resolve([] as Array<{
          id: string;
          name: string;
          exclusive: boolean;
          required: boolean;
          modifiers: { id: string; label: string; priceDeltaCents: number }[];
        }>),
    productIdsWithRequiredCheck.size > 0
      ? prisma.productModifierGroup.findMany({
          where: {
            productId: { in: Array.from(productIdsWithRequiredCheck) },
            modifierGroup: {
              tenantId,
              deletedAt: null,
              required: true,
            },
          },
          select: { productId: true, modifierGroupId: true },
        })
      : Promise.resolve(
          [] as Array<{ productId: string; modifierGroupId: string }>,
        ),
  ]);

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const requiredByProduct = new Map<string, Set<string>>();
  for (const link of productRequiredLinks) {
    let set = requiredByProduct.get(link.productId);
    if (!set) {
      set = new Set();
      requiredByProduct.set(link.productId, set);
    }
    set.add(link.modifierGroupId);
  }

  return lines.map((line) => resolveOneLine(line, groupById, requiredByProduct));
}

function resolveOneLine(
  line: LineContext,
  groupById: Map<
    string,
    {
      id: string;
      name: string;
      exclusive: boolean;
      required: boolean;
      modifiers: { id: string; label: string; priceDeltaCents: number }[];
    }
  >,
  requiredByProduct: Map<string, Set<string>>,
): ResolveResult {
  const snapshot: ModifierSnapshotEntry[] = [];
  let unitPriceDeltaCents = 0;
  const seenGroups = new Map<string, number>(); // groupId → count

  for (const sel of line.selections) {
    const group = groupById.get(sel.groupId);
    if (!group) {
      return { ok: false, error: { kind: "GROUP_NOT_FOUND", groupId: sel.groupId } };
    }
    const modifier = group.modifiers.find((m) => m.id === sel.modifierId);
    if (!modifier) {
      return {
        ok: false,
        error: {
          kind: "MODIFIER_NOT_FOUND",
          groupId: sel.groupId,
          modifierId: sel.modifierId,
        },
      };
    }
    seenGroups.set(sel.groupId, (seenGroups.get(sel.groupId) ?? 0) + 1);
    snapshot.push({
      groupId: group.id,
      groupName: group.name,
      modifierId: modifier.id,
      label: modifier.label,
      priceDeltaCents: modifier.priceDeltaCents,
    });
    unitPriceDeltaCents += modifier.priceDeltaCents;
  }

  // Exclusive: si el grupo es exclusive, sólo 1 selección permitida.
  for (const [groupId, count] of seenGroups) {
    const group = groupById.get(groupId);
    if (group?.exclusive && count > 1) {
      return { ok: false, error: { kind: "EXCLUSIVE_VIOLATION", groupId } };
    }
  }

  // Required: cada grupo required asociado al producto debe tener al
  // menos 1 selección. Si la línea no lleva productId no podemos saber
  // qué es required (caja libre): omitimos el check.
  if (line.productId) {
    const requiredGroupIds = requiredByProduct.get(line.productId);
    if (requiredGroupIds) {
      for (const reqId of requiredGroupIds) {
        if (!seenGroups.has(reqId)) {
          return { ok: false, error: { kind: "REQUIRED_VIOLATION", groupId: reqId } };
        }
      }
    }
  }

  return {
    ok: true,
    resolved: { unitPriceDeltaCents, snapshot },
  };
}

// Helper: formatea la entrada de snapshot como texto humano para
// incluir en description/notes de la línea Holded (Frente 5).
// Formato: "(Grupo: Label; Grupo: Label)".
export function formatModifierSnapshotForHolded(
  snapshot: ModifierSnapshotEntry[],
): string {
  if (snapshot.length === 0) return "";
  return (
    "(" +
    snapshot
      .map((s) => `${s.groupName}: ${s.label}`)
      .join("; ") +
    ")"
  );
}
