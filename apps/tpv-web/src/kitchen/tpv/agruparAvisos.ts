// hierro-sirope (D) · UNA BANDA POR MESA, Y QUE DIGA QUÉ ESTÁ LISTO.
//
// Lo que pasaba el 18-10 (captura 25): M3 con un croissant en COCINA y un
// café en BARRA. Las dos secciones se marcaron listas y el TPV pintó DOS
// bandas idénticas, «M3 · listo para servir» y «M3 · listo para servir».
// Ninguna de las dos decía qué estaba listo, las dos hacían lo mismo al
// tocarlas, y juntas empujaban el ticket hacia abajo hasta que la segunda
// línea quedaba bajo la franja «Urgente».
//
// La unidad mental del camarero no es la comanda: es LA MESA. Va a M3 una
// vez y recoge lo que haya. Así que:
//
//   · una banda por mesa (o por mostrador),
//   · que diga qué está listo cuando hay más de una sección —«M3 · cocina
//     y barra listas»—,
//   · y que avise de lo que NO está listo —«M3 · barra lista (cocina en
//     marcha)»—, porque ir a por media mesa y volver es el viaje que el
//     camarero no quiere hacer,
//   · un toque sirve TODO lo listo de esa mesa, que es lo que acaba de
//     hacer con las manos.
//
// Con una sola sección y nada pendiente se mantiene el texto de kds-1,
// «M3 · listo para servir»: es el caso normal de un bar y está probado en
// el hierro.
//
// Módulo aparte y puro para que el banco pueda afirmar los textos y la
// agrupación sin montar la pantalla de venta entera.

import type { KitchenSection } from "../secciones.js";

export interface ComandaListaMin {
  orderId: string;
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  section: KitchenSection;
  readyAt: string;
}

export interface ComandaEnMarchaMin {
  ticketId: string;
  tableId: string | null;
  section: KitchenSection;
}

export interface AvisoAgrupado {
  /** La llave de la mesa/mostrador. Estable: ordena y des-duplica. */
  clave: string;
  /** «M3», «Mostrador nº 1» o «Comanda» si la comanda no trae título. */
  titulo: string;
  /** Lo que se sirve al tocar la banda: todo lo listo de esta mesa. */
  orderIds: string[];
  /**
   * Las cuentas que hay dentro del grupo. Es lo que deja a la pantalla de
   * venta preguntar «¿lo de ESTA cuenta está listo?» sin tener que saber
   * cómo se forma la llave (hierro-sirope H3).
   */
  ticketIds: string[];
  /** Para la etiqueta verde del mapa de sala. */
  tableId: string | null;
  /** El `readyAt` MÁS ANTIGUO del grupo: es lo que ordena la pila. */
  readyAt: string;
  secciones: KitchenSection[];
  enMarcha: KitchenSection[];
  /** La línea entera: «M3 · barra lista (cocina en marcha)». */
  texto: string;
}

/** En minúscula porque van dentro de una frase. */
const SECCION_EN_FRASE: Record<KitchenSection, string> = {
  BARRA: "barra",
  COCINA: "cocina",
  SALON: "sala",
};

/**
 * El orden en que se nombran las secciones.
 *
 * Fijo y no el de llegada: «cocina y barra» tiene que decirse igual
 * siempre, porque lo que el camarero reconoce de un vistazo es la FORMA
 * de la frase, no sus palabras. Cocina primero porque es lo que se
 * enfría.
 */
const ORDEN_SECCION: KitchenSection[] = ["COCINA", "BARRA", "SALON"];

function ordenar(secciones: Iterable<KitchenSection>): KitchenSection[] {
  const vistas = new Set(secciones);
  return ORDEN_SECCION.filter((s) => vistas.has(s));
}

/** «cocina y barra», «cocina, barra y sala». */
export function enumerar(secciones: readonly KitchenSection[]): string {
  const nombres = secciones.map((s) => SECCION_EN_FRASE[s]);
  if (nombres.length === 0) return "";
  if (nombres.length === 1) return nombres[0]!;
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * La llave del grupo.
 *
 * Una mesa agrupa por `tableId` porque dos cuentas distintas de la MISMA
 * mesa (una cuenta partida) son un solo viaje del camarero. Un mostrador
 * no tiene mesa, así que agrupa por ticket: «Mostrador nº 1» y «Mostrador
 * nº 2» son dos clientes distintos esperando en la barra.
 */
export function claveDeGrupo(c: {
  tableId: string | null;
  ticketId: string;
}): string {
  return c.tableId != null ? `mesa:${c.tableId}` : `ticket:${c.ticketId}`;
}

export function agruparAvisos(
  listas: readonly ComandaListaMin[],
  enMarcha: readonly ComandaEnMarchaMin[] = [],
): AvisoAgrupado[] {
  const pendientesPorClave = new Map<string, Set<KitchenSection>>();
  for (const p of enMarcha) {
    const k = claveDeGrupo(p);
    const set = pendientesPorClave.get(k) ?? new Set<KitchenSection>();
    set.add(p.section);
    pendientesPorClave.set(k, set);
  }

  const grupos = new Map<
    string,
    {
      clave: string;
      titulo: string | null;
      tableId: string | null;
      orderIds: string[];
      ticketIds: Set<string>;
      secciones: Set<KitchenSection>;
      readyAt: string;
    }
  >();

  for (const c of listas) {
    const clave = claveDeGrupo(c);
    const previo = grupos.get(clave);
    if (!previo) {
      grupos.set(clave, {
        clave,
        titulo: c.tableName,
        tableId: c.tableId,
        orderIds: [c.orderId],
        ticketIds: new Set([c.ticketId]),
        secciones: new Set([c.section]),
        readyAt: c.readyAt,
      });
      continue;
    }
    previo.orderIds.push(c.orderId);
    previo.ticketIds.add(c.ticketId);
    previo.secciones.add(c.section);
    // El más ANTIGUO manda: lo que lleva más tiempo en el pase es lo que
    // decide dónde va esta banda en la pila y qué urgencia tiene.
    if (c.readyAt.localeCompare(previo.readyAt) < 0) previo.readyAt = c.readyAt;
    previo.titulo = previo.titulo ?? c.tableName;
  }

  return [...grupos.values()]
    .map((g) => {
      const secciones = ordenar(g.secciones);
      // Lo que sigue en marcha: sólo las secciones que NO están ya listas
      // (una mesa puede tener dos comandas de cocina, una lista y otra no,
      // y entonces «cocina en marcha» sigue siendo verdad).
      const enMarchaGrupo = ordenar(
        [...(pendientesPorClave.get(g.clave) ?? [])].filter(
          (s) => !g.secciones.has(s),
        ),
      );
      const titulo = g.titulo ?? "Comanda";
      return {
        clave: g.clave,
        titulo,
        orderIds: g.orderIds,
        ticketIds: [...g.ticketIds],
        tableId: g.tableId,
        readyAt: g.readyAt,
        secciones,
        enMarcha: enMarchaGrupo,
        texto: textoDeBanda(titulo, secciones, enMarchaGrupo),
      };
    })
    .sort((a, b) => a.readyAt.localeCompare(b.readyAt));
}

/**
 * «M3 · listo para servir» · «M3 · cocina y barra listas» ·
 * «M3 · barra lista (cocina en marcha)».
 */
export function textoDeBanda(
  titulo: string,
  listasSinOrden: readonly KitchenSection[],
  enMarchaSinOrden: readonly KitchenSection[],
): string {
  // El orden lo fija AQUÍ y no el llamante: «cocina y barra» tiene que
  // decirse igual siempre, y una función que se fiara del orden que le
  // llega se puede llamar desde otro sitio con el orden de llegada.
  const listas = ordenar(listasSinOrden);
  const enMarcha = ordenar(enMarchaSinOrden);
  if (enMarcha.length === 0) {
    // Una sola sección y nada pendiente: el texto de siempre. Es el caso
    // normal de un bar con una sola pantalla y no hay nada que añadir.
    if (listas.length <= 1) return `${titulo} · listo para servir`;
    return `${titulo} · ${enumerar(listas)} listas`;
  }
  const verbo = listas.length === 1 ? "lista" : "listas";
  const cola = `${enumerar(enMarcha)} en marcha`;
  return `${titulo} · ${enumerar(listas)} ${verbo} (${cola})`;
}
