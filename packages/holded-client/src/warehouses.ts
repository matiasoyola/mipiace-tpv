import type { HoldedClient } from "./client.js";

// Almacén. Spike §02.A confirma plural `/warehouses` (singular devuelve
// 200+HTML). Flag `default` permite pre-seleccionar al crear la primera
// tienda en el TPV.
export interface HoldedWarehouse {
  id: string;
  name: string;
  default?: boolean;
  warehouseRecord?: string | null;
  address?: HoldedAddress;
  [extra: string]: unknown;
}

export interface HoldedAddress {
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
}

export async function listWarehouses(
  client: HoldedClient,
): Promise<HoldedWarehouse[]> {
  const result = await client.request<unknown>("/invoicing/v1/warehouses");
  if (!Array.isArray(result)) {
    throw new TypeError("GET /invoicing/v1/warehouses no devolvió array");
  }
  return result as HoldedWarehouse[];
}
