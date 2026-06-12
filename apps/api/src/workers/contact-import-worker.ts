// v1.0-pilotos · Lote 6 (#22): worker del importador de clientes.
//
// Holded es la fuente de verdad de contactos: cada fila se crea EN
// HOLDED vía API (type=client) con GET-back (ADR-010 — Holded acepta
// 2xx y descarta campos en silencio) y la BD local se rellena con el
// upsert del propio flujo. Nunca escribimos contactos "solo locales".
//
// Reglas:
//   - Throttle: ~5 req/s contra Holded. Cada alta son 2 requests
//     (POST + GET-back) → pausa de 400 ms por fila creada
//     (CONTACT_IMPORT_DELAY_MS para ajustar).
//   - Idempotencia: si ya existe contacto con el mismo NIF (o email si
//     no hay NIF) en la BD local (espejo de Holded), skip → "ya
//     existía". Releer el archivo dos veces no duplica.
//   - NIF inválido (util-validation) → fila a errores, no se crea.
//   - Reintentos por fila: 3 intentos con backoff ante errores
//     transitorios; si se agotan, la fila va a errores y seguimos.
//   - Progreso: job.updateProgress({processed,total,created,existed,
//     errors}) — el admin lo consulta por polling.

import { Worker, type Job } from "bullmq";

import {
  ApiKeyClient,
  createContactWithGetBack,
  type CreateContactBody,
  type HoldedContact,
} from "@mipiacetpv/holded-client";
import { validateSpanishTaxId } from "@mipiacetpv/util-validation";

import { getPrisma, getRedis } from "../context.js";
import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { captureError } from "../lib/sentry.js";
import {
  CONTACT_IMPORT_QUEUE_NAME,
  type ContactImportJob,
  type ContactImportProgress,
  type ContactImportResult,
  type ContactImportRowError,
} from "../queues/contact-import.js";

const ROW_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

function defaultDelayMs(): number {
  const raw = Number(process.env.CONTACT_IMPORT_DELAY_MS ?? 400);
  return Number.isFinite(raw) && raw >= 0 ? raw : 400;
}

// Normaliza un NIF para comparar/almacenar: mayúsculas, sin espacios
// ni guiones. util-validation valida sobre este shape.
export function normalizeNif(raw: string): string {
  return raw.toUpperCase().replace(/[\s.-]/g, "");
}

export interface ContactImportDeps {
  prisma: {
    tenant: {
      findUnique: (args: unknown) => Promise<{ holdedApiKeyCiphertext: string | null } | null>;
    };
    contact: {
      findFirst: (args: unknown) => Promise<{ id: string } | null>;
      upsert: (args: unknown) => Promise<unknown>;
    };
  };
  // Inyectable en tests; en producción crea el ApiKeyClient real.
  buildClient?: (apiKey: string) => Pick<ApiKeyClient, "request">;
  createContact?: (
    client: Pick<ApiKeyClient, "request">,
    body: CreateContactBody,
    options: { expect: Record<string, string | undefined> },
  ) => Promise<HoldedContact>;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
  onProgress?: (p: ContactImportProgress) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function processContactImportJob(
  data: ContactImportJob,
  deps: ContactImportDeps,
): Promise<ContactImportResult> {
  const env = loadEnv();
  const sleep = deps.sleep ?? realSleep;
  const delayMs = deps.delayMs ?? defaultDelayMs();
  const createContact = deps.createContact ?? createContactWithGetBack;

  const tenant = await deps.prisma.tenant.findUnique({
    where: { id: data.tenantId },
    select: { holdedApiKeyCiphertext: true },
  });
  if (!tenant?.holdedApiKeyCiphertext) {
    throw new Error("El tenant no tiene API key de Holded configurada.");
  }
  const apiKey = decryptSecret(
    tenant.holdedApiKeyCiphertext,
    env.HOLDED_KEY_ENCRYPTION_SECRET,
  );
  const client = deps.buildClient
    ? deps.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  const result: ContactImportResult = { created: 0, existed: 0, errors: [] };
  // Dedupe DENTRO del archivo: la segunda aparición del mismo NIF/email
  // cuenta como "ya existía" sin pegar a Holded.
  const seenInFile = new Set<string>();
  const total = data.rows.length;

  for (let i = 0; i < total; i += 1) {
    const row = data.rows[i]!;
    const rowNumber = i + 1;
    const pushError = (reason: string) => {
      result.errors.push({
        row: rowNumber,
        name: row.name,
        nif: row.nif,
        reason,
      } satisfies ContactImportRowError);
    };

    const name = row.name.trim();
    if (name.length === 0) {
      pushError("El nombre es obligatorio.");
    } else {
      const nif = row.nif ? normalizeNif(row.nif) : null;
      const email = row.email?.trim().toLowerCase() || null;
      const phone = row.phone?.trim() || null;
      if (nif && !validateSpanishTaxId(nif).valid) {
        pushError(`NIF inválido: ${row.nif}`);
      } else {
        // Clave de idempotencia: NIF > email > nombre (sin NIF ni email
        // no hay identificador fuerte; el nombre evita al menos el
        // duplicado obvio al releer el archivo).
        const dedupeKey = nif ?? email ?? `name:${name.toLowerCase()}`;
        if (seenInFile.has(dedupeKey)) {
          result.existed += 1;
        } else {
          seenInFile.add(dedupeKey);
          const where = nif
            ? { tenantId: data.tenantId, nif }
            : email
              ? { tenantId: data.tenantId, email }
              : { tenantId: data.tenantId, name };
          const existing = await deps.prisma.contact.findFirst({
            where,
            select: { id: true },
          });
          if (existing) {
            result.existed += 1;
          } else {
            const outcome = await createWithRetries({
              client,
              createContact,
              sleep,
              body: {
                name,
                type: "client",
                code: nif ?? undefined,
                email: email ?? undefined,
                phone: phone ?? undefined,
              },
            });
            if (outcome.ok) {
              await upsertImportedContact(data.tenantId, outcome.contact);
              result.created += 1;
            } else {
              pushError(outcome.reason);
            }
            // Throttle sólo cuando hubo tráfico real contra Holded.
            if (delayMs > 0) await sleep(delayMs);
          }
        }
      }
    }

    if (deps.onProgress) {
      await deps.onProgress({
        processed: rowNumber,
        total,
        created: result.created,
        existed: result.existed,
        errors: result.errors.length,
      });
    }
  }

  return result;
}

async function createWithRetries(args: {
  client: Pick<ApiKeyClient, "request">;
  createContact: NonNullable<ContactImportDeps["createContact"]>;
  sleep: (ms: number) => Promise<void>;
  body: CreateContactBody;
}): Promise<{ ok: true; contact: HoldedContact } | { ok: false; reason: string }> {
  let lastError = "error desconocido";
  for (let attempt = 1; attempt <= ROW_RETRIES; attempt += 1) {
    try {
      const contact = await args.createContact(args.client, args.body, {
        expect: {
          name: args.body.name,
          code: args.body.code,
          email: args.body.email,
        },
      });
      return { ok: true, contact };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < ROW_RETRIES) {
        await args.sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  return { ok: false, reason: lastError };
}

// Upsert local con la misma forma que el resto del flujo de contactos
// (contacts/routes.ts) — la BD local es espejo de Holded.
async function upsertImportedContact(
  tenantId: string,
  remote: HoldedContact,
): Promise<void> {
  const prisma = getPrisma();
  const pick = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  await prisma.contact.upsert({
    where: { tenantId_holdedContactId: { tenantId, holdedContactId: remote.id } },
    create: {
      tenantId,
      holdedContactId: remote.id,
      name: pick(remote.name) ?? "(sin nombre)",
      nif: pick(remote.code),
      email: pick(remote.email),
      phone: pick(remote.phone) ?? pick(remote.mobile),
      type: "CLIENT",
      raw: remote as unknown as object,
    },
    update: {
      name: pick(remote.name) ?? "(sin nombre)",
      nif: pick(remote.code),
      email: pick(remote.email),
      phone: pick(remote.phone) ?? pick(remote.mobile),
      type: "CLIENT",
      raw: remote as unknown as object,
      lastSyncedAt: new Date(),
    },
  });
}

export function startContactImportWorker(): Worker<ContactImportJob> {
  const worker = new Worker<ContactImportJob>(
    CONTACT_IMPORT_QUEUE_NAME,
    async (job: Job<ContactImportJob>) => {
      const prisma = getPrisma();
      return processContactImportJob(job.data, {
        prisma: prisma as unknown as ContactImportDeps["prisma"],
        onProgress: async (p) => {
          await job.updateProgress(p as unknown as object);
        },
      });
    },
    {
      connection: getRedis(),
      // Un archivo a la vez por proceso: el throttle es por diseño
      // secuencial (5 req/s globales contra Holded).
      concurrency: 1,
    },
  );
  worker.on("completed", (job) => {
    console.log(`[contact-import] job ${job.id} ok`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[contact-import] job ${job?.id} falló: ${err.message}`);
    captureError(err, {
      extra: { queue: "contact-import", jobId: job?.id, tenantId: job?.data.tenantId },
    });
  });
  return worker;
}
