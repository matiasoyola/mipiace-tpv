// clinica-5 · el tipo de visita de un servicio, contra la base.
//
// Las decisiones viven en `@mipiacetpv/clinica-sesion`
// (`tipoDelServicio`, puras, compartidas con la pantalla); esto es lo que
// lee la tabla `tag_visit_types` y cruza con `products.tags`. Misma
// separación que `tratamientos.ts` / `resumenDeLaSesion` de clinica-3.
//
// ── El cruce, en una frase ───────────────────────────────────────────
//
// Un producto tiene varias etiquetas (`products.tags`, de Holded o del
// catálogo local). El centro dice qué tipo de visita tiene cada etiqueta
// (`tag_visit_types`, patrón `TagSection`, S5). El tipo del servicio es el
// de sus etiquetas — y si dos de sus etiquetas tienen tipos DISTINTOS, el
// servicio no se guarda.
//
// ── Por qué la validación se llama desde `services/routes.ts` ────────
//
// Porque ahí es donde nace la mezcla: es el único sitio desde el que la
// dueña puede marcar un servicio como tratamiento de sesión. Un trigger de
// Postgres habría tenido que mirar el array `tags` cruzado con esta tabla
// en cada escritura de `products`, o sea en cada sync de Holded, y habría
// hecho fallar el sync por una regla de la agenda.
//
// Lo que SÍ está en el motor es lo que el motor puede garantizar sin mirar
// dos tablas: que una categoría tenga un solo tipo (índice único) y que el
// tipo sea uno de los cinco (CHECK).

import type { PrismaClient } from "@mipiacetpv/db";
import {
  esNivelDeQuiropodia,
  esTipoDeVisita,
  normalizarSlug,
  tipoDelServicio,
  type NivelDeQuiropodia,
  type TipoDeVisita,
  type TipoDelServicio,
} from "@mipiacetpv/clinica-sesion";

/**
 * La tabla del centro: `slug normalizado → tipo de visita`.
 *
 * Una consulta, y el resultado se pasa a las funciones puras. Un tipo que
 * esta versión del código no conoce se tira al leer en vez de reventar:
 * la fila pasó el CHECK de la base contra los cinco de hoy, así que esto
 * sólo puede pasar en un despliegue a medias — y entonces lo correcto es
 * que el servicio quede sin tipo (y no se guarde si es de sesión), no que
 * el panel conteste un 500.
 */
export async function tipoPorEtiqueta(
  prisma: PrismaClient,
  tenantId: string,
): Promise<Record<string, TipoDeVisita>> {
  const filas = await prisma.tagVisitType.findMany({
    where: { tenantId },
    select: { slug: true, visitType: true },
  });
  const salida: Record<string, TipoDeVisita> = {};
  for (const f of filas) {
    if (!esTipoDeVisita(f.visitType)) continue;
    salida[normalizarSlug(f.slug)] = f.visitType;
  }
  return salida;
}

/**
 * El veredicto sobre un servicio: su tipo, o el motivo legible por el que
 * no se puede guardar.
 *
 * Tres lecturas y ni una decisión: el tenant (¿tiene la historia
 * encendida?), las etiquetas del producto y la tabla del centro. Quien
 * decide es `tipoDelServicio`, que es pura y la comparte la pantalla.
 */
export async function resolverTipoDelServicio(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    productId: string;
    /** Lo que el PUT va a guardar, no lo que hay hoy en la fila. */
    tratamientoSesion: boolean;
  },
): Promise<TipoDelServicio> {
  const [tenant, producto, tipoPorTag] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { clinicalRecordsEnabled: true },
    }),
    prisma.product.findFirst({
      where: { id: input.productId, tenantId: input.tenantId },
      select: { tags: true },
    }),
    tipoPorEtiqueta(prisma, input.tenantId),
  ]);
  return tipoDelServicio({
    etiquetas: producto?.tags ?? [],
    tipoPorTag,
    esCentroClinico: tenant?.clinicalRecordsEnabled === true,
    tratamientoSesion: input.tratamientoSesion,
  });
}

/**
 * El tipo y el nivel de un montón de servicios de golpe, para la sesión.
 *
 * Es lo que convierte la lista de `tratamientosDeLaSesion` en la lista
 * agrupada por tipo que la pantalla pinta. Una consulta de etiquetas y una
 * de la tabla, no una por servicio.
 */
export async function tiposDeLosServicios(
  prisma: PrismaClient,
  tenantId: string,
  serviceIds: readonly string[],
): Promise<
  Map<string, { tipo: TipoDeVisita | null; nivel: NivelDeQuiropodia | null }>
> {
  const salida = new Map<
    string,
    { tipo: TipoDeVisita | null; nivel: NivelDeQuiropodia | null }
  >();
  const ids = [...new Set(serviceIds)];
  if (ids.length === 0) return salida;

  const [productos, tipoPorTag] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        tags: true,
        scheduling: { select: { nivelQuiropodia: true } },
      },
    }),
    tipoPorEtiqueta(prisma, tenantId),
  ]);

  for (const p of productos) {
    // Aquí NO se rechaza nada: un servicio con dos tipos distintos no
    // debería existir —el guardado lo impide— pero si existiera (una
    // etiqueta añadida desde Holded después de guardarlo), la sesión no es
    // el sitio donde pararlo. Se queda sin tipo, no sale en ninguna
    // tarjeta, y la dueña lo ve al volver a guardarlo en el panel.
    const r = tipoDelServicio({
      etiquetas: p.tags,
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: false,
    });
    const nivel = p.scheduling?.nivelQuiropodia ?? null;
    salida.set(p.id, {
      tipo: r.ok ? r.tipo : null,
      nivel: esNivelDeQuiropodia(nivel) ? nivel : null,
    });
  }
  return salida;
}
