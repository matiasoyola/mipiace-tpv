// Tests del sweeper de HoldedUpload huérfanos (v1.5-consistencia-A §3.b).

import { describe, expect, it, vi } from "vitest";

import {
  sweepOrphanUploads,
  type SweeperJob,
  type SweeperQueue,
} from "../src/workers/upload-sweeper.js";

const NOW = new Date("2026-06-10T12:00:00Z");

function makeQueue(jobs: Record<string, { state: string }> = {}) {
  const added: Array<{ name: string; jobId: string }> = [];
  const removed: string[] = [];
  const queue: SweeperQueue = {
    getJob: vi.fn(async (jobId: string): Promise<SweeperJob | null> => {
      const j = jobs[jobId];
      if (!j) return null;
      return {
        getState: async () => j.state,
        remove: async () => {
          removed.push(jobId);
          delete jobs[jobId];
        },
      };
    }),
    add: vi.fn(async (name, _data, opts) => {
      added.push({ name, jobId: opts.jobId });
      return {};
    }),
  };
  return { queue, added, removed };
}

function makePrisma(rows: Array<{ externalId: string; kind: "TICKET" | "REFUND" }>) {
  return {
    holdedUpload: {
      findMany: vi.fn(async () => rows),
    },
  };
}

const silentLog = () => undefined;

describe("sweepOrphanUploads", () => {
  it("upload PENDING viejo sin job en la cola → lo re-encola con jobId determinista", async () => {
    const ticket = makeQueue();
    const refund = makeQueue();
    const result = await sweepOrphanUploads({
      prisma: makePrisma([{ externalId: "ext-1", kind: "TICKET" }]),
      ticketQueue: ticket.queue,
      refundQueue: refund.queue,
      log: silentLog,
      now: NOW,
    });
    expect(result).toEqual({ scanned: 1, rescued: 1, errors: 0 });
    expect(ticket.added).toEqual([{ name: "upload-ticket", jobId: "upload-ticket-ext-1" }]);
    expect(refund.added).toEqual([]);
  });

  it("upload PENDING con job vivo en la cola → no duplica", async () => {
    const ticket = makeQueue({ "upload-ticket-ext-1": { state: "waiting" } });
    const refund = makeQueue();
    const result = await sweepOrphanUploads({
      prisma: makePrisma([{ externalId: "ext-1", kind: "TICKET" }]),
      ticketQueue: ticket.queue,
      refundQueue: refund.queue,
      log: silentLog,
      now: NOW,
    });
    expect(result).toEqual({ scanned: 1, rescued: 0, errors: 0 });
    expect(ticket.added).toEqual([]);
    expect(ticket.removed).toEqual([]);
  });

  it("job zombi (failed) con fila aún PENDING → lo elimina y re-encola", async () => {
    const ticket = makeQueue({ "upload-ticket-ext-1": { state: "failed" } });
    const refund = makeQueue();
    const result = await sweepOrphanUploads({
      prisma: makePrisma([{ externalId: "ext-1", kind: "TICKET" }]),
      ticketQueue: ticket.queue,
      refundQueue: refund.queue,
      log: silentLog,
      now: NOW,
    });
    expect(result.rescued).toBe(1);
    expect(ticket.removed).toEqual(["upload-ticket-ext-1"]);
    expect(ticket.added).toEqual([{ name: "upload-ticket", jobId: "upload-ticket-ext-1" }]);
  });

  it("refunds usan su propia cola y jobId upload-refund-*", async () => {
    const ticket = makeQueue();
    const refund = makeQueue();
    const result = await sweepOrphanUploads({
      prisma: makePrisma([{ externalId: "ext-r", kind: "REFUND" }]),
      ticketQueue: ticket.queue,
      refundQueue: refund.queue,
      log: silentLog,
      now: NOW,
    });
    expect(result.rescued).toBe(1);
    expect(refund.added).toEqual([{ name: "upload-refund", jobId: "upload-refund-ext-r" }]);
    expect(ticket.added).toEqual([]);
  });

  it("error de Redis en un upload no aborta la pasada (cuenta como error)", async () => {
    const ticket = makeQueue();
    (ticket.queue.getJob as any).mockImplementationOnce(async () => {
      throw new Error("redis down");
    });
    const refund = makeQueue();
    const result = await sweepOrphanUploads({
      prisma: makePrisma([
        { externalId: "ext-1", kind: "TICKET" },
        { externalId: "ext-2", kind: "TICKET" },
      ]),
      ticketQueue: ticket.queue,
      refundQueue: refund.queue,
      log: silentLog,
      now: NOW,
    });
    expect(result).toEqual({ scanned: 2, rescued: 1, errors: 1 });
    expect(ticket.added).toEqual([{ name: "upload-ticket", jobId: "upload-ticket-ext-2" }]);
  });

  it("pide a Prisma sólo PENDING con createdAt < now - 10 min", async () => {
    const prisma = makePrisma([]);
    const ticket = makeQueue();
    const refund = makeQueue();
    await sweepOrphanUploads({
      prisma,
      ticketQueue: ticket.queue,
      refundQueue: refund.queue,
      log: silentLog,
      now: NOW,
    });
    const args = (prisma.holdedUpload.findMany as any).mock.calls[0][0];
    expect(args.where.status).toBe("PENDING");
    expect(args.where.createdAt.lt.getTime()).toBe(NOW.getTime() - 10 * 60 * 1000);
  });
});
