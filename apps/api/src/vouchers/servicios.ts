// B-reservas-8 · los servicios de una cita, en la forma que necesita la
// cobertura.
//
// La categoría de un servicio es un TAG de `Product.tags` (ADR-R1, y S5:
// el agrupador único del TPV es la categoría). La cobertura por categoría
// se resuelve con esos tags, así que hay que leerlos — y se leen DENTRO de
// la transacción que decide, para que lo que se comprueba y lo que se
// escribe vean el mismo catálogo.

import type { Prisma } from "@mipiacetpv/db";

import type { ServicioACubrir } from "./cobertura.js";

export async function serviciosACubrir(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceIds: string[],
): Promise<ServicioACubrir[]> {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return [];
  const filas = await tx.$queryRaw<Array<{ id: string; tags: string[] }>>`
    SELECT "id", "tags"
      FROM "products"
     WHERE "tenant_id" = ${tenantId}::uuid
       AND "id" = ANY(${ids}::uuid[])`;
  const porId = new Map(filas.map((f) => [f.id, f.tags ?? []]));
  // Se devuelven TODOS los ids pedidos, incluidos los que ya no están en el
  // catálogo: un servicio que desapareció no lo cubre ningún bono, y es
  // mejor que `cubreTodos` diga «no» que que la lista se acorte en silencio
  // y el bono cubra «todos» los cero servicios que quedaron.
  return ids.map((id) => ({ id, tags: porId.get(id) ?? [] }));
}

/** La frase que lee recepción en el libro: «la cita del 3-nov 10:30». */
export function citaLegible(fecha: string, hora: string): string {
  return `la cita del ${fecha} ${hora}`;
}
