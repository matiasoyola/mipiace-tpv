// v1.0-pilotos · Lote 6 (#22): cola del importador de clientes.
//
// Un job = un archivo (máx 2.000 filas ya normalizadas por el
// endpoint). El worker crea los contactos EN HOLDED (fuente de verdad)
// con throttle y reintentos por fila, y la BD local se rellena por el
// upsert del propio flujo. attempts=1 a nivel job: los reintentos son
// por fila dentro del worker (si el job entero re-corriera, el check de
// idempotencia por NIF/email evita duplicar, pero no queremos repetir
// 2.000 GET-backs por un fallo puntual al final).

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const CONTACT_IMPORT_QUEUE_NAME = "contact-import";

export interface ContactImportRow {
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
}

export interface ContactImportJob {
  tenantId: string;
  requestedByUserId: string;
  rows: ContactImportRow[];
}

export interface ContactImportProgress {
  processed: number;
  total: number;
  created: number;
  existed: number;
  errors: number;
}

export interface ContactImportRowError {
  row: number; // 1-based, en el orden del archivo
  name: string;
  nif: string | null;
  reason: string;
}

export interface ContactImportResult {
  created: number;
  existed: number;
  errors: ContactImportRowError[];
}

let _queue: Queue<ContactImportJob> | null = null;
export function getContactImportQueue(): Queue<ContactImportJob> {
  if (!_queue) {
    _queue = new Queue<ContactImportJob>(CONTACT_IMPORT_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1,
        // El resultado se consulta por polling desde el admin — lo
        // retenemos un día (o 50 jobs) antes de purgar.
        removeOnComplete: { age: 24 * 3600, count: 50 },
        removeOnFail: { age: 24 * 3600 },
      },
    });
  }
  return _queue;
}

export async function enqueueContactImport(
  job: ContactImportJob,
): Promise<string> {
  const added = await getContactImportQueue().add("import-contacts", job);
  return String(added.id);
}
