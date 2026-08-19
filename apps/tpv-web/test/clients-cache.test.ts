// Tests de la caché local del CRM (B-reservas-1): búsqueda A–Z sin red,
// persistencia en IndexedDB y alta offline degradada al outbox.
//
// fake-indexeddb aporta IndexedDB en jsdom. La API y el outbox se mockean
// para verificar el degradado offline sin tocar red.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const outboxMock = vi.hoisted(() => ({ outboxAdd: vi.fn(async () => undefined) }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/outbox.js", () => ({ outboxAdd: outboxMock.outboxAdd }));

import { ApiError } from "../src/api.js";
import {
  createClient,
  loadClientsFromCache,
  searchClientsLocal,
  sortClientsAz,
  upsertClientInCache,
  clientFullName,
  type ClientRow,
} from "../src/lib/clients.js";

function row(partial: Partial<ClientRow>): ClientRow {
  return {
    id: partial.id ?? crypto.randomUUID(),
    externalId: partial.externalId ?? null,
    firstName: partial.firstName ?? "Nombre",
    lastName: partial.lastName ?? "Apellido",
    phone: partial.phone ?? null,
    email: partial.email ?? null,
    birthdate: partial.birthdate ?? null,
    holdedContactId: partial.holdedContactId ?? null,
    marketingOptIn: partial.marketingOptIn ?? false,
    notes: partial.notes ?? null,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
    syncState: partial.syncState,
  };
}

beforeEach(() => {
  // IndexedDB limpio por test.
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  outboxMock.outboxAdd.mockClear();
});

describe("búsqueda local A–Z", () => {
  const clients = [
    row({ firstName: "Carla", lastName: "López", phone: "600111222" }),
    row({ firstName: "Ana", lastName: "Zabala", email: "ana@x.com" }),
    row({ firstName: "Bruno", lastName: "Aaa" }),
  ];

  it("ordena por apellido y luego nombre", () => {
    expect(sortClientsAz(clients).map((c) => c.lastName)).toEqual([
      "Aaa",
      "López",
      "Zabala",
    ]);
  });

  it("filtra por nombre/teléfono/email (insensible)", () => {
    expect(searchClientsLocal(clients, "carla").map(clientFullName)).toEqual([
      "Carla López",
    ]);
    expect(searchClientsLocal(clients, "600111")).toHaveLength(1);
    expect(searchClientsLocal(clients, "ana@x")).toHaveLength(1);
  });

  it("query vacía devuelve todos ordenados", () => {
    expect(searchClientsLocal(clients, "")).toHaveLength(3);
  });
});

describe("persistencia IndexedDB", () => {
  it("upsert + load conserva la fila", async () => {
    const c = row({ firstName: "Persist", lastName: "Ente" });
    await upsertClientInCache(c);
    const all = await loadClientsFromCache();
    expect(all.find((x) => x.id === c.id)?.firstName).toBe("Persist");
  });
});

describe("alta offline", () => {
  it("degrada al outbox y persiste fila optimista ante fallo de red", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const res = await createClient({ firstName: "Off", lastName: "Line" });
    expect(res.queuedOffline).toBe(true);
    expect(res.client.syncState).toBe("pending");
    expect(outboxMock.outboxAdd).toHaveBeenCalledOnce();
    const all = await loadClientsFromCache();
    expect(all.find((x) => x.id === res.client.id)?.syncState).toBe("pending");
  });

  it("propaga un 400 de validación (no degrada a offline)", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(
      new ApiError(400, "VALIDATION_ERROR"),
    );
    await expect(createClient({ firstName: "X", lastName: "Y" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(outboxMock.outboxAdd).not.toHaveBeenCalled();
  });

  it("alta online cachea la fila del server", async () => {
    const server = row({ firstName: "On", lastName: "Line", id: "srv-1" });
    apiMock.apiWithCashier.mockResolvedValueOnce({ client: server });
    const res = await createClient({ firstName: "On", lastName: "Line" });
    expect(res.client.syncState).toBe("synced");
    expect(res.queuedOffline).toBeUndefined();
  });
});
