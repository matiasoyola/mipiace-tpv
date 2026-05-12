import type { HoldedClient } from "./client.js";

// Servicio facturable (sin stock). Shape paralelo al producto pero más
// minimalista. Lo guardamos en la misma tabla `product` con kind=SERVICE.
export interface HoldedService {
  id: string;
  name: string;
  desc?: string;
  sku?: string | null;
  price?: number;
  taxes?: string[];
  forSale?: number;
  [extra: string]: unknown;
}

export async function listServicesPage(
  client: HoldedClient,
  page: number,
): Promise<HoldedService[]> {
  const result = await client.request<unknown>(
    `/invoicing/v1/services?page=${page}`,
  );
  if (!Array.isArray(result)) {
    throw new TypeError(
      `GET /invoicing/v1/services?page=${page} no devolvió array`,
    );
  }
  return result as HoldedService[];
}

export async function* iterateAllServices(
  client: HoldedClient,
): AsyncGenerator<{ page: number; services: HoldedService[] }, void, void> {
  let page = 1;
  while (true) {
    const services = await listServicesPage(client, page);
    if (services.length === 0) return;
    yield { page, services };
    page += 1;
  }
}
