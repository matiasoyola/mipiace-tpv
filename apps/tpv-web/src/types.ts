// Estructura que el backend devuelve en GET /api/products y que el carrito
// del frontend manipula. Coincide con TpvProduct del backend.
export interface Product {
  id: string;
  name: string;
  sku: string;
  price: number; // base sin IVA
  total: number; // con IVA (precio que ve el cajero)
  tax: number; // porcentaje numérico (21, 10, 4…)
}

export interface CartLine {
  productId: string;
  units: number;
}

// Respuesta esperada del POST /api/tickets. Coincide con TicketResult.
export interface TicketResult {
  externalId: string;
  holdedDocumentId: string;
  docNumber: string;
  total: number;
}
