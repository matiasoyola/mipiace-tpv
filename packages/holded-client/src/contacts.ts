// Cliente de contactos de Holded (B2 §3).
//
// Endpoints disponibles:
//   - `GET /invoicing/v1/contacts`             — lista; query params
//                                                ÚNICOS: `phone`,
//                                                `mobile` (match
//                                                exacto) y `customId`
//                                                (array). No hay
//                                                filtro por nombre,
//                                                email o NIF (= code).
//   - `GET /invoicing/v1/contacts/{id}`        — contacto individual.
//   - `POST /invoicing/v1/contacts`            — crea contacto.
//   - `PUT /invoicing/v1/contacts/{id}`        — actualiza.
//
// Sobre la búsqueda: a diferencia de los productos, los contactos del
// tenant pueden ser miles (libreta histórica) y NO hacemos sync inicial
// (B2 §3). Para soportar búsqueda por nombre/NIF/email seguimos la
// estrategia "BD local primero" (núcleo B2 §3): la API de Holded sólo
// nos sirve para fallback por teléfono o creación on-the-fly.

import type { HoldedClient } from "./client.js";
import { HoldedSilentRejectError, type SilentRejectMismatch } from "./errors.js";

export interface HoldedContactAddress {
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  province?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

export interface HoldedContact {
  id: string;
  name?: string;
  // NIF/CIF en español. Holded lo llama "code".
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  type?: string; // "client" | "supplier" | "lead" | ...
  customId?: string | null;
  billAddress?: HoldedContactAddress | null;
  isperson?: boolean;
  [k: string]: unknown;
}

export interface CreateContactBody {
  name: string;
  // NIF en el payload de creación → campo `code` (ver doc oficial).
  code?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  type?: "client" | "supplier" | "lead" | "debtor" | "creditor";
  customId?: string;
  isperson?: boolean;
  billAddress?: HoldedContactAddress;
}

// ── Listado / búsqueda ───────────────────────────────────────────────

// La doc oficial de developers.holded.com sólo documenta filtros por
// `phone`, `mobile` y `customId`. El listado plano descargaría miles
// de contactos por tenant, así que el caller decide cuándo usarlo.
export async function listContactsByPhone(
  client: HoldedClient,
  phone: string,
): Promise<HoldedContact[]> {
  const qs = `?phone=${encodeURIComponent(phone)}`;
  return client.request<HoldedContact[]>(`/invoicing/v1/contacts${qs}`);
}

export async function listContactsByMobile(
  client: HoldedClient,
  mobile: string,
): Promise<HoldedContact[]> {
  const qs = `?mobile=${encodeURIComponent(mobile)}`;
  return client.request<HoldedContact[]>(`/invoicing/v1/contacts${qs}`);
}

export async function listContactsByCustomIds(
  client: HoldedClient,
  customIds: string[],
): Promise<HoldedContact[]> {
  // La doc indica que `customId` se manda como array. Probamos
  // serialización repetida (`?customId=a&customId=b`) por defecto;
  // si Holded no lo acepta y prefiere JSON-array stringified, ajustar
  // tras observar en producción.
  const qs = customIds
    .map((c) => `customId=${encodeURIComponent(c)}`)
    .join("&");
  return client.request<HoldedContact[]>(`/invoicing/v1/contacts?${qs}`);
}

// ── Get individual ───────────────────────────────────────────────────

export async function getContact(client: HoldedClient, id: string): Promise<HoldedContact> {
  return client.request<HoldedContact>(`/invoicing/v1/contacts/${encodeURIComponent(id)}`);
}

// ── Create con GET-back (ADR-010) ────────────────────────────────────

export interface CreateContactWithGetBackOptions {
  // Campos que esperamos sobrevivir el round-trip. Si alguno no coincide
  // entre lo enviado y lo guardado, lanzamos HoldedSilentRejectError.
  expect?: Partial<Pick<HoldedContact, "name" | "code" | "email" | "phone">>;
}

// Crea un contacto y verifica con GET-back que los campos críticos no
// fueron silenciados. Patrón idéntico a `updateProductWithGetBack`
// (spike §04.D: Holded acepta campos y devuelve 2xx aunque los descarte).
export async function createContactWithGetBack(
  client: HoldedClient,
  body: CreateContactBody,
  options: CreateContactWithGetBackOptions = {},
): Promise<HoldedContact> {
  type CreateResponse = { id?: string; status?: number; info?: string } & Record<string, unknown>;
  const createResponse = await client.request<CreateResponse>("/invoicing/v1/contacts", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!createResponse || typeof createResponse.id !== "string") {
    throw new Error(
      `POST /contacts no devolvió id: ${JSON.stringify(createResponse).slice(0, 200)}`,
    );
  }
  const id = createResponse.id;

  // GET-back: leemos lo guardado y comparamos con lo prometido.
  const stored = await getContact(client, id);
  const expect: Partial<HoldedContact> = {
    name: body.name,
    code: body.code,
    email: body.email,
    phone: body.phone,
    ...options.expect,
  };
  const mismatches: SilentRejectMismatch[] = [];
  for (const [field, expected] of Object.entries(expect)) {
    if (expected == null || expected === "") continue;
    const actual = (stored as Record<string, unknown>)[field];
    if (actual !== expected) {
      mismatches.push({ field, expected, actual });
    }
  }
  if (mismatches.length > 0) {
    throw new HoldedSilentRejectError(
      `POST contact`,
      `/invoicing/v1/contacts/${id}`,
      mismatches,
      stored,
    );
  }
  return stored;
}
