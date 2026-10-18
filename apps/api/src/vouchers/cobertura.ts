// B-reservas-8 · ¿cubre este bono este servicio?
//
// Función PURA, y por eso vive aquí sola: la llaman la agenda al dar la
// cita, la caja al cobrar y la ficha al pintar, y las tres tienen que
// contestar lo mismo. El día que una sola de ellas decida por su cuenta
// aparecerá un bono que se puede apartar y no se puede consumir.
//
// Dos formas de cubrir, y la unión de las dos (S6 + S5):
//
//   · por SERVICIO — la ficha concreta del catálogo;
//   · por CATEGORÍA — la familia. En este TPV una categoría es un tag de
//     `Product.tags` (ADR-R1 y clinica-5: el agrupador único es la
//     categoría, y ya existía).
//
// La cobertura que se mira es la CONGELADA del bono, copiada de la
// plantilla al vender. Por eso ocultar un servicio o cambiarle el precio no
// invalida bonos ya vendidos (`07` pieza 16, con test).

/** Lo mínimo del bono para decidir. Estructural y no el tipo de Prisma,
 *  para que valga desde una tx, desde un test y desde un `select` parcial. */
export interface CoberturaDelBono {
  coversServiceIds: string[];
  coversTagSlugs: string[];
}

/** Lo mínimo del servicio. `tags` llega de `Product.tags` tal cual. */
export interface ServicioACubrir {
  id: string;
  tags: string[];
}

/** Por qué sí cubre. Se devuelve para poder decirlo en la pantalla: «con el
 *  bono B87 (categoría Podología)» lee mejor que «con el bono B87». */
export type MotivoDeCobertura =
  | { cubre: true; por: "servicio" }
  | { cubre: true; por: "categoria"; slug: string }
  | { cubre: false };

/**
 * El tag se compara NORMALIZADO (minúsculas y sin espacios en los bordes),
 * que es como llegan de Holded y como los guarda el catálogo local. Un
 * «Podología» de la plantilla y un «podologia» del producto son la misma
 * categoría para quien los escribió.
 */
function normalizarTag(slug: string): string {
  return slug.trim().toLowerCase();
}

export function resolverCobertura(
  bono: CoberturaDelBono,
  servicio: ServicioACubrir,
): MotivoDeCobertura {
  if (bono.coversServiceIds.includes(servicio.id)) {
    return { cubre: true, por: "servicio" };
  }
  if (bono.coversTagSlugs.length > 0 && servicio.tags.length > 0) {
    const delBono = new Set(bono.coversTagSlugs.map(normalizarTag));
    for (const tag of servicio.tags) {
      const t = normalizarTag(tag);
      if (delBono.has(t)) return { cubre: true, por: "categoria", slug: t };
    }
  }
  return { cubre: false };
}

/** `true` si el bono cubre TODOS los servicios de la lista. Lo usa la
 *  revalidación al cambiar el servicio de una cita. */
export function cubreTodos(
  bono: CoberturaDelBono,
  servicios: ServicioACubrir[],
): boolean {
  return servicios.every((s) => resolverCobertura(bono, s).cubre);
}
