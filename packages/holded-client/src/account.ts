import type { HoldedClient } from "./client.js";

// Datos fiscales de la cuenta del propietario. Holded no expone un único
// endpoint "/account/fiscal" estable y documentado — en la práctica los
// datos viven en:
//   - El usuario (NIF, razón social) en su perfil de Holded.
//   - Cada almacén lleva su propia dirección.
//
// Para el ticket impreso necesitamos NIF + razón social + dirección. En
// MVP los obtenemos del almacén default; si no hay, dejamos vacío y el
// propietario los introduce a mano en el admin (queda fuera de B1, ya
// hay scaffold).
//
// Esta función intenta el endpoint "me" si existe, y devuelve null si no.
// Lo dejamos como hook para que el sync inicial no rompa: en B1 vamos a
// poblar fiscalAddress a partir del almacén default + lo que el
// propietario introduzca en el admin (B2 lo formaliza).

export interface HoldedAccountInfo {
  id?: string;
  name?: string;
  vatNumber?: string;
  // Estructura opaca para no asumir shape que no hemos validado en spike.
  raw?: unknown;
}

export async function tryGetAccountInfo(
  client: HoldedClient,
): Promise<HoldedAccountInfo | null> {
  // No probado en spike. Lo dejamos como best-effort: si el endpoint no
  // existe devuelve null y el sync sigue. La fiscalidad real se llenará
  // desde el almacén default + UI admin.
  try {
    const result = await client.request<HoldedAccountInfo>("/invoicing/v1/me");
    return result;
  } catch {
    return null;
  }
}
