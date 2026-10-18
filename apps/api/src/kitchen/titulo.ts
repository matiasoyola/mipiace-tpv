// auditoria-sirope (#25) · CÓMO SE TITULA UNA COMANDA.
//
// La tarjeta de la pantalla de cocina, el papel de la impresora y el
// aviso de «listo para servir» del TPV dicen los tres lo mismo, y por eso
// lo dice una sola función:
//
//   · una mesa      → su nombre («T6»);
//   · un mostrador  → «Mostrador nº 3» (`Ticket.counterNumber`);
//   · nada de eso   → `null`, y entonces la tarjeta cae al nº de comanda
//                     («#1»), que es lo que hacían TODAS las ventas
//                     rápidas antes de este bloque.
//
// Vive en un módulo propio —minúsculo y sin dependencias— porque lo mira
// `kitchen/envio.ts`, que no tiene nada que hacer con el grafo de
// imports de una ruta.

/** «Mostrador nº 3». */
export function etiquetaDeMostrador(numero: number): string {
  return `Mostrador nº ${numero}`;
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
