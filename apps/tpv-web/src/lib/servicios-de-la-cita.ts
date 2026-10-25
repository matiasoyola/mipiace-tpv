// clinica-8 (fase B, 17) · EL ORDEN DE LOS SERVICIOS AL DAR UNA CITA.
//
// Auditoría del 18-10, punto 27: «Servicios de la cita sin orden útil».
// La lista del alta sale en el orden en que el catálogo devuelve los
// productos, que en Rosario son DIECISIETE líneas seguidas: «Consulta
// diagnóstico, Quiropodia básica, Quiropodia completa, Quiropodia extra,
// Quiropodia a domicilio, Cura, Sesión papiloma, Exploración
// biomecánica, Revisión biomecánica adultos, Revisión biomecánica niños,
// Entrega de órtesis plantares, Órtesis de silicona pequeña…». Con la
// paciente al teléfono, eso se LEE entero cada vez.
//
// Dos criterios, y los dos salen del prompt («servicios ordenados por
// categoría y uso»):
//
// ── 1. La CATEGORÍA, que es el agrupador del centro ───────────────────
//
// La misma que manda en todo lo clínico desde S5: el tag del producto.
// Cinco encabezados en vez de diecisiete líneas. El orden de los grupos
// no es alfabético: es el del USO, para que lo que se da todos los días
// esté arriba. A igualdad de uso, alfabético — que es lo único estable
// cuando nadie ha usado nada todavía.
//
// ── 2. El USO, contado DONDE SE USA ───────────────────────────────────
//
// «Uso» aquí no son ventas: es cuántas veces se ha puesto ese servicio
// EN UNA CITA desde este mostrador. Se cuenta al reservar y se guarda
// por tenant en `localStorage`, igual que el reparto de tonos de
// categoría (`categoryTones.ts`) y por las mismas razones: vale sin red,
// no cuesta una ruta nueva en el camino del alta, y lo que se aprende es
// el mostrador de verdad y no un ranking de caja que mezcla productos.
//
// Lo que NO hace: adivinar el primer día. Con el contador vacío el orden
// es categoría alfabética + el orden del catálogo dentro, que ya es
// mejor que la lista plana. Converge en una mañana.
//
// Y no decide nada clínico ni de precio: decide en qué fila se pinta un
// botón.

const CLAVE = "mipiacetpv-uso-servicios-cita";

// La MISMA clave que `catalog.ts` usa para el tenant cacheado. Se lee a
// mano y no por su `getCachedTenantId` a propósito: media docena de
// bancos del TPV mockean `catalog.js` entero con `vi.mock`, y un import
// nuevo ahí revienta veinte ficheros que no tienen nada que ver con el
// orden de una lista de servicios. Lo que se comparte es un string, no
// una decisión.
const CLAVE_DEL_TENANT = "mipiacetpv-catalog-tenant";

/** El tenant cacheado, o `null`. Nunca lanza. */
export function tenantDelTerminal(): string | null {
  try {
    return localStorage.getItem(CLAVE_DEL_TENANT);
  } catch {
    return null;
  }
}

/** Lo mínimo que hace falta para ordenar. */
export interface ServicioOrdenable {
  id: string;
  name: string;
  tags: string[];
}

export interface GrupoDeServicios<T> {
  /** El tag tal cual, para la clave de React y los tests. */
  categoria: string;
  /** Con la primera en mayúscula, para pintarlo. */
  titulo: string;
  servicios: T[];
}

/** La categoría de un servicio: su primer tag. Sin tags, «otros». */
export function categoriaDe(s: ServicioOrdenable): string {
  const primero = s.tags.find((t) => t.trim().length > 0);
  return (primero ?? "otros").trim().toLowerCase();
}

/** «quiropodia» → «Quiropodia». Sólo la primera letra: los tags pueden
 *  traer acrónimos y partirlos por palabras los estropea. */
export function tituloDeCategoria(tag: string): string {
  if (tag.length === 0) return tag;
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

/**
 * Agrupa por categoría y ordena los grupos y su contenido por uso.
 *
 * El orden dentro de un grupo es: más usado primero y, a igualdad, el
 * orden en que venían (que es el del catálogo, y en un CSV cargado a
 * mano suele ser el que la dueña escribió). **Estable**: dos servicios
 * sin uso no se reordenan entre sí, y por eso la lista no baila de un
 * día para otro.
 *
 * El orden de los grupos es la SUMA de usos del grupo, no su máximo: una
 * categoría con tres servicios de cinco usos cada uno se da más que una
 * con uno de doce.
 */
export function agruparServiciosDeLaCita<T extends ServicioOrdenable>(
  servicios: readonly T[],
  uso: Readonly<Record<string, number>>,
): Array<GrupoDeServicios<T>> {
  const grupos = new Map<string, T[]>();
  for (const s of servicios) {
    const cat = categoriaDe(s);
    const lista = grupos.get(cat);
    if (lista) lista.push(s);
    else grupos.set(cat, [s]);
  }

  const salida = [...grupos.entries()].map(([categoria, lista]) => ({
    categoria,
    titulo: tituloDeCategoria(categoria),
    // `sort` de V8 es estable desde ES2019: los empates conservan el
    // orden de entrada, que es lo que hace que la lista no baile.
    servicios: [...lista].sort((a, b) => (uso[b.id] ?? 0) - (uso[a.id] ?? 0)),
    peso: lista.reduce((n, s) => n + (uso[s.id] ?? 0), 0),
  }));

  salida.sort(
    (a, b) => b.peso - a.peso || a.categoria.localeCompare(b.categoria, "es"),
  );
  return salida.map(({ categoria, titulo, servicios }) => ({
    categoria,
    titulo,
    servicios,
  }));
}

function clave(tenantId: string | null): string {
  return tenantId ? `${CLAVE}:${tenantId}` : `${CLAVE}:anon`;
}

/** Lo contado hasta ahora. `{}` si no hay nada o el JSON está roto. */
export function leerUsoDeServicios(
  tenantId: string | null,
): Record<string, number> {
  let crudo: string | null = null;
  try {
    crudo = localStorage.getItem(clave(tenantId));
  } catch {
    return {};
  }
  if (!crudo) return {};
  try {
    const parsed: unknown = JSON.parse(crudo);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Apunta que estos servicios acaban de entrar en una cita.
 *
 * Se llama DESPUÉS de que el servidor confirme la reserva, no al tocar
 * el botón: lo que se quiere contar son las citas que existen, no los
 * botones que alguien tocó y deshizo.
 *
 * Nunca lanza. Un almacenamiento lleno o bloqueado no puede tumbar el
 * alta de una cita con la paciente delante; lo único que se pierde es
 * que el orden aprenda.
 */
export function apuntarUsoDeServicios(
  serviceIds: readonly string[],
  tenantId: string | null,
): void {
  if (serviceIds.length === 0) return;
  try {
    const actual = leerUsoDeServicios(tenantId);
    for (const id of serviceIds) actual[id] = (actual[id] ?? 0) + 1;
    localStorage.setItem(clave(tenantId), JSON.stringify(actual));
  } catch {
    /* ver la nota de arriba */
  }
}
