// v1.9.5-formacion · Frente 1: red de seguridad del gate fiscal en el
// worker. Si un refund de prueba (status TEST) aterriza en uploadRefund
// —cosa que no debería pasar porque POST /refunds no lo encola— el
// worker lo marca SKIPPED y sale sin construir cliente Holded ni tocar
// la API.

import { randomBytes } from "node:crypto";

process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.HOLDED_BASE_URL = "https://holded.test";

import { describe, expect, it, vi } from "vitest";

import { uploadRefund } from "../src/tickets/upload-refund.js";

describe("uploadRefund · defensa modo prueba (Frente 1)", () => {
  it("refund TEST → SKIPPED sin construir cliente Holded", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const buildClient = vi.fn(() => {
      throw new Error("no debe construirse cliente Holded para un refund TEST");
    });
    const prisma = {
      refund: {
        findUnique: vi.fn(async () => ({
          externalId: "ext-1",
          status: "TEST",
          holdedDocumentId: null,
          createdAt: new Date(),
          total: { toString: () => "10" },
          method: "CASH",
          lines: [],
          originalTicket: { id: "t-1", holdedDocumentId: null, holdedDocNumber: null },
          tenant: { id: "ten-1", holdedApiKeyCiphertext: "cipher" },
          register: { numSerieHolded: null },
        })),
      },
      holdedUpload: { updateMany },
    } as never;

    const res = await uploadRefund({ externalId: "ext-1", prisma, buildClient });

    expect(res).toEqual({ kind: "skipped", reason: "test_mode" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { externalId: "ext-1" },
      data: { status: "SKIPPED", lastError: { skipped: "test_mode" } },
    });
    expect(buildClient).not.toHaveBeenCalled();
  });
});
