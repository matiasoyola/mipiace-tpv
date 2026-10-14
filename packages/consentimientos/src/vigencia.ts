// clinica-4 · ¿ESTE CONSENTIMIENTO VALE HOY?
//
// La tabla `client_consents` es de **solo inserción** (S3, condición 1) y
// revocar es **una fila nueva enlazada a la que revoca** (condición 2, Ley
// 41/2002 art. 8.5: revocable en cualquier momento). Así que «está
// firmado» no es una columna que se lea: es una cuenta sobre las filas.
//
// Esa cuenta vive aquí, pura, por la razón de siempre en este frente: la
// hacen la API (que decide si la sesión empieza y si la foto se guarda) y
// la pantalla (que pinta el aviso y el botón «Firmar ahora»). Con una
// copia por lado, la podóloga vería «firmado ✓» sobre un consentimiento
// que el servidor considera revocado — y entonces la pantalla estaría
// diciendo que una cirugía se puede empezar.

/**
 * Una fila de `client_consents`, con lo que hace falta para la cuenta.
 *
 * `plantillaId: null` son las **altas manuales sin plantilla**: las filas
 * que ya existían en producción antes de este bloque (el spa, desde la
 * ficha del cliente) y las que se sigan dando de alta así. No se les
 * inventa versión ni huella, y **nunca satisfacen un consentimiento que
 * se pide por plantilla**: lo que no se sabe qué texto fue no puede valer
 * como prueba de que se informó de ese texto.
 */
export interface FilaFirmada {
  id: string;
  plantillaId: string | null;
  plantillaVersion: number | null;
  /** ISO-8601. */
  firmadoEn: string;
  /**
   * La fila que ESTA revoca, o `null` si es una concesión.
   *
   * Una fila de revocación no concede nada, aunque lleve el mismo
   * `plantillaId` (lo lleva para que la lista se lea: «Fotos clínicas ·
   * revocado el 8 de octubre»).
   */
  revocaA: string | null;
}

export interface EstadoDeUnaPlantilla {
  plantillaId: string;
  /** La concesión viva, o `null` si no hay ninguna (o están revocadas). */
  vigente: FilaFirmada | null;
  /** Las concesiones revocadas, de la más reciente a la más antigua. */
  revocadas: readonly FilaFirmada[];
}

/** ¿Alguna fila revoca a esta? */
export function estaRevocada(
  filas: readonly FilaFirmada[],
  id: string,
): boolean {
  return filas.some((f) => f.revocaA === id);
}

/**
 * La concesión VIVA de una plantilla, o `null`.
 *
 * Si hay varias (se firmó, se revocó, se volvió a firmar), manda la más
 * reciente por fecha de firma. El empate se resuelve por el orden de la
 * lista, que viene de la base ordenada: un empate al milisegundo entre dos
 * firmas de la misma plantilla no cambia el veredicto —las dos valen— y
 * elegir una regla estable es mejor que dejarlo al azar del `sort`.
 */
export function consentimientoVigente(
  filas: readonly FilaFirmada[],
  plantillaId: string,
): FilaFirmada | null {
  const vivas = filas
    .filter(
      (f) =>
        f.revocaA === null &&
        f.plantillaId === plantillaId &&
        !estaRevocada(filas, f.id),
    )
    .sort((a, b) => (a.firmadoEn < b.firmadoEn ? 1 : -1));
  return vivas[0] ?? null;
}

/** El estado completo de una plantilla: lo que la pantalla pinta. */
export function estadoDeUnaPlantilla(
  filas: readonly FilaFirmada[],
  plantillaId: string,
): EstadoDeUnaPlantilla {
  return {
    plantillaId,
    vigente: consentimientoVigente(filas, plantillaId),
    revocadas: filas
      .filter(
        (f) =>
          f.revocaA === null &&
          f.plantillaId === plantillaId &&
          estaRevocada(filas, f.id),
      )
      .sort((a, b) => (a.firmadoEn < b.firmadoEn ? 1 : -1)),
  };
}

/**
 * De los que PIDE la cita de hoy, cuáles FALTAN.
 *
 * Devuelve los ids en el orden en que se piden —el de los servicios de la
 * cita— y sin repetidos: dos servicios de la misma cita que pidan el mismo
 * consentimiento lo piden UNA vez.
 *
 * Un consentimiento revocado **cuenta como que falta**. Es el punto de
 * todo el mecanismo: la revocación es una fila nueva precisamente para que
 * la cuenta cambie sin tocar la prueba de que un día se firmó.
 */
export function consentimientosQueFaltan(input: {
  pide: readonly string[];
  filas: readonly FilaFirmada[];
}): readonly string[] {
  const vistos = new Set<string>();
  const faltan: string[] = [];
  for (const id of input.pide) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    if (!consentimientoVigente(input.filas, id)) faltan.push(id);
  }
  return faltan;
}
