// residencia-5 (decisión de producto 3, D-51, D-58) · **CUÁNDO UN PARTE
// ESTÁ CONFIRMADO, Y QUÉ VE CADA UNO.**
//
// Dos preguntas que se contestan con la misma pieza —el alcance por
// zonas— y que están aquí juntas y aparte del resto del relevo por eso:
// son la regla de producto del bloque, y una regla de producto que vive
// dentro de una ruta de 300 líneas no se puede probar como tabla.
//
// ── Y VIVE EN EL PAQUETE PURO, no en la API ────────────────────────
//
// Porque **la tablet de la sala la ejecuta sin red**: el arranque le trae
// el parte ENTERO y el roster con las zonas de cada uno, y el recorte por
// alcance lo hace ella con `recortarAlAlcance`. Si esta función viviera en
// `apps/api`, la tablet tendría una copia — y entonces lo que una auxiliar
// ve sin red podría no ser lo que ve con red, que es exactamente el fallo
// que D-51 no se puede permitir.
//
// Es el mismo razonamiento por el que `gravedadDe` (residencia-4) y
// `queToca` (residencia-2) están aquí.
//
// ── QUÉ VE CADA UNO (D-51) ──────────────────────────────────────────
//
// La auxiliar ve **sus zonas**; la DUE, el médico, calidad y dirección ven
// **todo** (`CareRole.fullScope`, o una zona vigente de «todo el centro»).
// Es la misma regla que la puerta aplica residente a residente, aquí
// aplicada a un parte que ya viene repartido por plantas.
//
// Y lo que ve es **el parte recortado**, no el parte entero con unas
// líneas escondidas: lo que no es de su zona no sale ni en los recuentos.
// Si saliera «3 líneas» en una planta que no puede abrir, ya estaría
// diciendo algo de residentes que no le corresponden.
//
// ── CUÁNDO ESTÁ CONFIRMADO ──────────────────────────────────────────
//
// Cuando **cada zona con contenido** tiene al menos una confirmación de
// alguien que la cubre, o una de alcance total. Tres consecuencias que
// conviene tener delante:
//
//   1. Una planta **sin contenido no necesita confirmación**. Exigirla
//      dejaría partes «sin confirmar» para siempre por una planta vacía,
//      y un indicador que nunca llega al verde deja de mirarse.
//   2. La zona **«del centro»** —lo que no es de ninguna planta: una
//      avería del office, una queja sin residente— sólo la cubre una
//      confirmación de **alcance total**. Es lo correcto: lo del centro
//      no es de ninguna auxiliar.
//   3. Un parte **sin novedades** no tiene ninguna zona con contenido, y
//      entonces **basta una confirmación cualquiera**. Porque el
//      denominador cuenta tanto como lo que pasa (D-16): lo que se
//      demuestra es que alguien del turno que entra lo miró.
//
// ── LO QUE ESTA REGLA NO COMPRUEBA, Y ESTÁ DECIDIDO ASÍ ─────────────
//
// **No comprueba que quien confirma sea del turno ENTRANTE.** No hay
// cuadrante que lo diga (H-06: los ratios por turno salen de configurar
// el centro, y eso no está en la v1), y D-58 deja expresamente abierto
// «cuántos asisten y cómo se ajusta tras observar un turno real» (H-09).
// Además la DUE **sí** confirma el suyo si está de turno, así que una
// regla que prohibiera «confirmar lo tuyo» rompería el caso que D-58
// nombra. Queda en las dudas abiertas del done.

/** Una zona con contenido del parte. `floorId` `null` = del centro. */
export interface ZonaDelAcuse {
  floorId: string | null;
}

/** Lo que una confirmación abarca. */
export interface AlcanceDeUnAcuse {
  /** Ve todo el centro: cubre todas las zonas, incluida la del centro. */
  alcanceTotal: boolean;
  /** Las plantas que cubre, cuando no es de alcance total. */
  floorIds: string[];
}

/**
 * ¿Está este parte confirmado?
 *
 * `zonas` son **las zonas con contenido** (las filas de
 * `handover_zones`), y `acuses` las confirmaciones que ya hay.
 */
export function estaConfirmado(
  zonas: ZonaDelAcuse[],
  acuses: AlcanceDeUnAcuse[],
): boolean {
  if (acuses.length === 0) return false;
  // Sin zonas con contenido —un parte sin novedades— basta con que
  // alguien lo haya confirmado. Ver la consecuencia 3 de la cabecera.
  if (zonas.length === 0) return true;

  const hayTotal = acuses.some((a) => a.alcanceTotal);
  if (hayTotal) return true;

  const cubiertas = new Set(acuses.flatMap((a) => a.floorIds));
  return zonas.every((z) => z.floorId != null && cubiertas.has(z.floorId));
}

/** Las zonas con contenido que todavía no tiene cubiertas nadie. */
export function zonasSinConfirmar(
  zonas: ZonaDelAcuse[],
  acuses: AlcanceDeUnAcuse[],
): ZonaDelAcuse[] {
  if (acuses.some((a) => a.alcanceTotal)) return [];
  const cubiertas = new Set(acuses.flatMap((a) => a.floorIds));
  return zonas.filter((z) => z.floorId == null || !cubiertas.has(z.floorId));
}

/**
 * **Recorta un parte al alcance de quien lo mira** (D-51).
 *
 * Genérico sobre la forma del parte para no arrastrar el tipo entero
 * —`relevo.ts` lo importa y lo tipa— y para que se pueda probar con una
 * tabla de zonas sin montar un parte de verdad.
 */
export function recortarAlAlcance<
  Z extends { floorId: string | null; lineas: number },
  P extends { zonas: Z[]; lineas: number; sinNovedades: boolean },
>(parte: P, alcance: AlcanceDeUnAcuse): P {
  if (alcance.alcanceTotal) return parte;
  const mias = new Set(alcance.floorIds);
  const zonas = parte.zonas.filter((z) => z.floorId != null && mias.has(z.floorId));
  const lineas = zonas.reduce((n, z) => n + z.lineas, 0);
  return {
    ...parte,
    zonas,
    lineas,
    // **Y «sin novedades» se recalcula sobre lo que ESTA persona ve.** Si
    // se arrastrara el del parte entero, una auxiliar cuya planta no tiene
    // nada leería «hay 9 líneas» y no vería ninguna — o al revés, vería
    // «Turno sin novedades» en un parte que tiene nueve, y confirmaría
    // algo que no ha leído.
    sinNovedades: lineas === 0,
  };
}

/**
 * El alcance de una persona a partir de sus roles y zonas vigentes.
 *
 * Las dos formas de tener alcance total, y las dos cuentan: un rol con
 * `fullScope` (DUE, médico, calidad, dirección) **o** una zona vigente de
 * «todo el centro» (`CareZoneAssignment` con `floorId = null`). Es la
 * misma pareja que `resolverEstadoResidencia` usa en `clinica/acceso.ts`,
 * y está escrita igual a propósito.
 */
export function alcanceDe(input: {
  roles: Array<{ fullScope: boolean }>;
  zonas: Array<{ floorId: string | null }>;
}): AlcanceDeUnAcuse {
  const porRol = input.roles.some((r) => r.fullScope);
  const porZona = input.zonas.some((z) => z.floorId == null);
  if (porRol || porZona) return { alcanceTotal: true, floorIds: [] };
  return {
    alcanceTotal: false,
    floorIds: [
      ...new Set(input.zonas.map((z) => z.floorId).filter((x): x is string => x != null)),
    ],
  };
}
