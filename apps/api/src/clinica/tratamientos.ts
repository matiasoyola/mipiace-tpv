// clinica-3 · los tratamientos de la sesión salen DEL CATÁLOGO.
//
// Qué botones ve la podóloga lo decide `service_scheduling.
// tratamiento_sesion`, igual que la marca «primera valoración» de
// clinica-2 decide qué cita manda el test. Y el precio y el IVA de cada
// uno salen del producto, no de la historia (prompt §1).
//
// ── Por qué el catálogo y no una lista del módulo ────────────────────
//
// Porque lo que se marca en la sesión es lo que se va a cobrar, y lo que
// se cobra ya tiene un sitio en esta casa: `products` (ADR-R1, ADR-017).
// Una lista de tratamientos en el paquete compartido habría necesitado su
// propia tabla de precios — o sea, un segundo catálogo — y el día que la
// podóloga subiera la quiropodia a 32 € tendría que subirla en dos
// sitios. Uno de los dos se quedaría viejo, y el que se queda viejo es
// siempre el que no se ve al cobrar.
//
// Las listas que SÍ viven en el paquete (zonas, lesiones, consejos) no
// tienen precio y no se cobran: son vocabulario clínico.
//
// ── Lo que se exige para poder cobrarlo ──────────────────────────────
//
// Las mismas tres condiciones que `checkoutAppointment` ya exige a un
// servicio de una cita, y por el mismo motivo: si un botón de la sesión
// no se puede convertir en línea de ticket, el botón es una trampa que
// explota al cerrar.
//
//   · `kind = SERVICE` y del tenant · el aislamiento por fila.
//   · `active` · un servicio desactivado no se ofrece. Y si ya estaba
//     marcado en una sesión cerrada, su línea se cobra igual (el cobro lee
//     el catálogo por id, no por esta lista): desactivar un servicio no
//     puede dejar una sesión firmada sin poder cobrarse.
//   · `sku` no vacío · el camino de cobro lo exige en la línea
//     (`SERVICE_NOT_SELLABLE`). Un servicio sin SKU no es cobrable, y es
//     mejor que no salga el botón que un 409 con la paciente delante.

import type { PrismaClient } from "@mipiacetpv/db";
import type { TratamientoDelCatalogo } from "@mipiacetpv/clinica-sesion";

/**
 * Los tratamientos que la sesión ofrece HOY, en el orden del catálogo.
 *
 * `precio` e `iva` vienen siempre: quien decide si se los manda a la
 * pantalla es `puedeVerImportes` en la serialización, no esta función.
 * Mezclar las dos cosas aquí querría decir dos consultas distintas según
 * el rol, y entonces «el total que ve la dueña» y «las líneas que se
 * cobran» saldrían de dos sitios.
 */
export async function tratamientosDeLaSesion(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TratamientoDelCatalogo[]> {
  const filas = await prisma.product.findMany({
    where: {
      tenantId,
      kind: "SERVICE",
      active: true,
      scheduling: { tratamientoSesion: true },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      basePrice: true,
      taxRate: true,
    },
  });
  return filas
    .filter((p) => p.sku != null && p.sku.trim() !== "")
    .map((p) => ({
      serviceId: p.id,
      nombre: p.name,
      precio: Number(p.basePrice),
      iva: Number(p.taxRate),
    }));
}

/**
 * Los mismos datos pero para unos ids concretos, **sin exigir `active` ni
 * la marca**.
 *
 * Es lo que el cobro usa para una sesión YA CERRADA, y la diferencia con
 * la de arriba es deliberada: una sesión firmada hace tres semanas se
 * cobra con lo que diga el catálogo de hoy sobre esos servicios, aunque
 * entretanto se hayan desmarcado como tratamientos de sesión o se hayan
 * desactivado. Lo contrario sería que un cambio de catálogo dejara una
 * sesión firmada sin poder cobrarse — y la sesión ya está escrita, así que
 * el dinero no se puede quedar en el aire.
 *
 * Lo que SÍ se sigue exigiendo es que sea un servicio de este tenant: eso
 * no es catálogo, es aislamiento.
 */
export async function tratamientosPorId(
  prisma: PrismaClient,
  tenantId: string,
  serviceIds: readonly string[],
): Promise<TratamientoDelCatalogo[]> {
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return [];
  const filas = await prisma.product.findMany({
    where: { tenantId, kind: "SERVICE", id: { in: ids } },
    select: {
      id: true,
      name: true,
      basePrice: true,
      taxRate: true,
    },
  });
  const porId = new Map(filas.map((p) => [p.id, p]));
  // En el ORDEN EN QUE SE MARCARON, no en el del catálogo: es el orden en
  // que la podóloga los tocó y el que va a leer en el ticket.
  return ids
    .map((id) => porId.get(id))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => ({
      serviceId: p.id,
      nombre: p.name,
      precio: Number(p.basePrice),
      iva: Number(p.taxRate),
    }));
}
