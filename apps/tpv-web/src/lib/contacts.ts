// B-reservas-mostrador F6 · los contactos de Holded, para el selector de
// cliente.
//
// Hay DOS listas y la recepcionista no tiene por qué saberlo: `clients` es el
// CRM local (fuente de verdad, ADR-R2) y `contacts` es lo que sincroniza
// Holded. El selector busca en las dos; los del CRM salen del caché, al
// instante, y los de Holded llegan después por red.
//
// El endpoint es el de B2 (`GET /contacts/search`), el MISMO que usa el
// buscador de contactos de la venta. Y por eso hereda dos cosas suyas:
//
//   · el filtro de tipo del cajero (CLIENT + UNKNOWN; los proveedores, leads,
//     deudores y acreedores no salen) — y se aplica a TODOS los roles, el
//     propietario incluido, salvo `?includeAll=1`, que el TPV no manda nunca;
//   · la invariante de privacidad de v1.4: **el listado nunca enseña el
//     teléfono completo** (`maskPhone`). Delante de la clienta hay más gente.

import { apiWithCashier } from "../api.js";
import { upsertClientInCache, type ClientRow } from "./clients.js";

/** Un contacto de Holded, tal y como se pinta en el selector. */
export interface ContactoHolded {
  /** El id de la FILA `Contact` — el que pide `POST /clients/from-contact`. */
  id: string;
  holdedContactId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface RespuestaBusqueda {
  results: Array<{
    id: string;
    holdedContactId: string;
    name: string;
    nif: string | null;
    email: string | null;
    phone: string | null;
  }>;
  source: "local" | "holded";
  holdedFallback: string | null;
}

/** A partir de cuántas letras se molesta en preguntar por red. */
export const MINIMO_PARA_BUSCAR_EN_HOLDED = 2;

/**
 * Busca contactos de Holded. Devuelve `null` si NO se ha podido preguntar
 * (sin red, servidor caído): `null` y `[]` son cosas distintas y la pantalla
 * las dice distinto — «sin conexión» no es «no hay nadie con ese nombre».
 */
export async function buscarContactosHolded(
  query: string,
): Promise<ContactoHolded[] | null> {
  const q = query.trim();
  if (q.length < MINIMO_PARA_BUSCAR_EN_HOLDED) return [];
  try {
    const res = await apiWithCashier<RespuestaBusqueda>(
      `/contacts/search?q=${encodeURIComponent(q)}`,
    );
    return res.results.map((r) => ({
      id: r.id,
      holdedContactId: r.holdedContactId,
      name: r.name,
      email: r.email,
      phone: r.phone,
    }));
  } catch {
    return null;
  }
}

/**
 * Convierte un contacto de Holded en cliente del CRM.
 *
 * UNA sola llamada, y el servidor decide si crea o devuelve el que ya estaba.
 * Desde el front NO se busca-y-si-no-se-crea: entre las dos llamadas caben dos
 * toques seguidos o dos terminales, y saldrían dos clientes para la misma
 * persona. Ver `apps/api/src/crm/from-contact.ts`.
 */
export async function clienteDesdeContacto(
  contactId: string,
): Promise<{ client: ClientRow; created: boolean }> {
  const res = await apiWithCashier<{ client: ClientRow; created: boolean }>(
    `/clients/from-contact/${contactId}`,
    { method: "POST" },
  );
  const client: ClientRow = { ...res.client, syncState: "synced" };
  // Entra en el caché al momento: la siguiente búsqueda ya lo encuentra como
  // cliente del CRM, y por eso deja de salir en la sección de Holded.
  await upsertClientInCache(client);
  return { client, created: res.created };
}
