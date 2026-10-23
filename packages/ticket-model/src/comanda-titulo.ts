// auditoria-sirope (#25) + hierro-sirope (E) · CÓMO SE TITULA UNA COMANDA,
// ENTERA Y CORTA.
//
// Vivía en `apps/api/src/kitchen/titulo.ts` y de allí salían los tres
// sitios que tienen que decir lo mismo: la tarjeta de la pantalla de
// cocina, el papel de la impresora y el aviso de «listo para servir» del
// TPV.
//
// El 18-10 apareció el cuarto caso y obligó a moverlo aquí: la pantalla
// de cocina NO cabe. «Mostrador nº 1» a 34 px se partió a mitad de
// palabra en la cabecera de la tarjeta —«Mostra / dor nº 1», captura 11—
// y se cortó en la columna estrecha «Listas» —«Mostrado», captura 12c—.
// La forma corta la tiene que escribir la MISMA función que escribe la
// larga, porque si no son dos textos que se pueden separar: alguien
// renombra «Mostrador nº» y la pantalla sigue buscando lo de antes.
//
// Vive en `ticket-model` y no en la API porque ahora lo miran los dos
// lados: el servidor al crear la tarjeta y la pantalla al pintarla.

/** «Mostrador nº 3». Lo que se guarda en `kitchen_orders.table_name`. */
export function etiquetaDeMostrador(numero: number): string {
  return `Mostrador nº ${numero}`;
}

/**
 * «Mostr. 3» · la forma que cabe en la pantalla de cocina.
 *
 * Ocho caracteres. A 34 px en la cabecera de la tarjeta y a 28 px en la
 * columna «Listas» de 160 px entra entera, que es lo que no hacía
 * «Mostrador nº 3» (14). Se descartó «M·3» por ambigua: en un bar con
 * mesas M1…M9 «M·3» y «M3» se leen igual desde dos metros, y confundir
 * un mostrador con una mesa manda al camarero al otro lado del local.
 */
export function etiquetaCortaDeMostrador(numero: number): string {
  return `Mostr. ${numero}`;
}

export function tituloDeComanda(ticket: {
  table: { name: string } | null;
  counterNumber: number | null;
}): string | null {
  if (ticket.table) return ticket.table.name;
  if (ticket.counterNumber != null) {
    return etiquetaDeMostrador(ticket.counterNumber);
  }
  return null;
}

/**
 * hierro-sirope (E) · el título tal como lo pinta la PANTALLA DE COCINA.
 *
 * Recibe lo que viaja en la tarjeta (`tableName`, ya compuesto por
 * `tituloDeComanda`) y devuelve lo que cabe. Una mesa no se toca: «T6» o
 * «Terraza 2» son el nombre que puso la dueña y acortarlo sería
 * inventarse otro. Lo único que se acorta es la etiqueta que escribimos
 * nosotros.
 *
 * Sin título cae al número de comanda («#1»), que es lo que hacían todas
 * las ventas rápidas antes de auditoria-sirope.
 */
export function tituloDeComandaEnPantalla(
  tableName: string | null,
  numero: number,
): string {
  if (tableName == null) return `#${numero}`;
  const m = /^Mostrador nº (\d+)$/.exec(tableName);
  if (m) return etiquetaCortaDeMostrador(Number(m[1]));
  return tableName;
}
