// A3-distribución · escape de HTML para las páginas que sirve la API.
//
// La API sirve HTML en un solo sitio (la página /apk del Frente 4), y todo lo
// que interpola sale de `releases.json`, que escribe nuestro propio script de
// publicación. Aun así se escapa: el índice es un fichero del VPS, y un
// fichero editable a mano no es una fuente de confianza para inyectarla cruda
// en una página. Escapar cuesta nada; no escapar cuesta un XSS el día que
// alguien pegue un `note` con comillas.
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}
