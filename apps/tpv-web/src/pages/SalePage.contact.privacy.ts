// v1.4-Buscador-Contactos · helpers de privacidad usados por el
// buscador de contactos del TPV. En módulo aparte (sin imports de
// React/lucide) para que vitest los pueda cargar sin necesidad de
// jsdom — el render del componente vive en SalePage.contact.tsx y el
// test de UI completo queda como TODO hasta que tengamos infra
// React-testing en tpv-web.

// Enmascara el teléfono mostrando sólo los últimos 4 dígitos. Si el
// contacto no trajo teléfono devolvemos null para que el caller
// decida si pinta un guión o esconde la fila.
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const last = digits.slice(-4);
  return `•••• ${last}`;
}
