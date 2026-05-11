// Spike Fase 0 · Script 04.
//
// Cuatro sub-spikes en orden:
//   1. Series          — probe endpoints, elegir una real (sólo GET).
//   2. POST corregido  — products[] + subtotal + sin productId + serie real.
//                        Hasta 2 variantes si la 1ª da total=0.
//   3. Approve         — pasar de draft a aprobado, conseguir docNumber.
//   4. Idempotencia    — re-POST mismo externalId, ver dedupe + búsqueda.
//
// Límite duro: 2 documentos nuevos en Holded (1 en sub-spike 2 + 1 en
// sub-spike 4). Si sub-spike 2 falla del todo, se aborta antes del 3.

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedEnv,
  HoldedInvalidResponseError,
} from "./holded-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

type AnyRec = Record<string, unknown>;

interface Product {
  id: string;
  name: string;
  price: number;
  total: number;
  stock: number;
  taxes?: string[];
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as T;
}

function redact(s: string | null | undefined, keep = 8): string {
  if (!s) return "?";
  return s.length > keep ? s.slice(0, keep) + "…" : s;
}

function describe(data: unknown): string {
  if (Array.isArray(data)) return `array(${data.length})`;
  if (data && typeof data === "object") {
    const keys = Object.keys(data as AnyRec).slice(0, 6);
    return `object{${keys.join(",")}}`;
  }
  return typeof data;
}

function fmtErr(err: unknown): string {
  if (err instanceof HoldedApiError) {
    const body = typeof err.body === "string" ? err.body : JSON.stringify(err.body);
    return `HTTP ${err.status} · ${body.slice(0, 220)}`;
  }
  if (err instanceof HoldedInvalidResponseError) {
    return `non-JSON · status=${err.status} ct=${err.contentType ?? "-"}`;
  }
  if (err instanceof Error) return `ERR · ${err.message}`;
  return `ERR · ${String(err)}`;
}

async function probeJson(
  holded: ApiKeyClient,
  path: string,
): Promise<{ ok: true; data: unknown } | { ok: false; err: unknown }> {
  try {
    const data = await holded.request<unknown>(path);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, err };
  }
}

// ── Sub-spike 1 ────────────────────────────────────────────────────────
async function probeSeries(
  holded: ApiKeyClient,
): Promise<{ raw: AnyRec; sendValue: string; path: string } | null> {
  const candidates = [
    "/invoicing/v1/series",
    "/invoicing/v1/numerationseries",
    "/invoicing/v1/numseries",
    "/invoicing/v1/numberingseries",
    "/invoicing/v1/numerations",
    "/invoicing/v1/documents/salesreceipt/series",
    "/invoicing/v1/documents/series",
  ];

  let winner: { path: string; data: AnyRec[] } | null = null;
  for (const path of candidates) {
    const r = await probeJson(holded, path);
    if (r.ok) {
      console.log(`  ${path.padEnd(54)} → OK · ${describe(r.data)}`);
      if (!winner && Array.isArray(r.data) && r.data.length > 0) {
        winner = { path, data: r.data as AnyRec[] };
      }
    } else {
      console.log(`  ${path.padEnd(54)} → ${fmtErr(r.err)}`);
    }
  }

  if (!winner) {
    console.log("  ✗ ningún endpoint de series devolvió array no vacío");
    return null;
  }

  writeFileSync(
    resolve(fixturesDir, "04-series.json"),
    JSON.stringify(winner.data, null, 2),
  );
  console.log(`  ✓ saved: 04-series.json  (winner: ${winner.path})`);
  const first = winner.data[0]!;
  console.log(`  Campos de [0]: ${Object.keys(first).join(", ")}`);

  // Heurística: una serie está "vinculada a salesreceipt" si su JSON
  // contiene literalmente la palabra (campo docType/type/etc.).
  const filtered = winner.data.filter((s) =>
    JSON.stringify(s).toLowerCase().includes("salesreceipt"),
  );
  const chosen = filtered[0] ?? winner.data[0]!;
  const name =
    (chosen.name as string | undefined) ??
    (chosen.code as string | undefined) ??
    (chosen.serie as string | undefined) ??
    (chosen.id as string | undefined);

  if (!name) {
    console.log("  ⚠ La serie elegida no tiene name/code/serie/id legible");
    console.log(`    raw: ${JSON.stringify(chosen).slice(0, 200)}`);
    return null;
  }
  console.log(
    `  ✓ serie elegida (${filtered.length > 0 ? "match salesreceipt" : "fallback primer item"}): "${name}"`,
  );
  console.log(`    raw: ${JSON.stringify(chosen).slice(0, 240)}`);
  return { raw: chosen, sendValue: name, path: winner.path };
}

// ── Sub-spike 2 ────────────────────────────────────────────────────────
interface CreatedDoc {
  documentId: string;
  sent: AnyRec;
  stored: AnyRec;
  variantLabel: string;
}

async function postCorrected(
  holded: ApiKeyClient,
  serie: { sendValue: string } | null,
  externalId: string,
): Promise<{ docs: CreatedDoc[]; winner: CreatedDoc | null }> {
  const products = loadJson<Product[]>("01-products.json");
  const product =
    products.find((p) => p.name === "MILAN 430") ??
    products.find((p) => p.total === 0.4) ??
    products[0]!;

  console.log(`  producto: "${product.name}" id=${redact(product.id)} price=${product.price}`);
  console.log(`  serie   : ${serie ? `"${serie.sendValue}"` : "(sin serie — Holded asignará)"}`);
  console.log(`  externalId: ${externalId}`);

  const buildPayload = (item: AnyRec): AnyRec => ({
    date: Math.floor(Date.now() / 1000),
    notes: `TPV-uuid: ${externalId}`,
    ...(serie ? { numSerie: serie.sendValue } : {}),
    products: [item],
  });

  const variants: { label: string; item: AnyRec }[] = [
    {
      label: "A · products[]+subtotal, sin productId",
      item: {
        name: product.name,
        units: 1,
        subtotal: product.price,
        tax: 21,
        discount: 0,
      },
    },
    {
      label: "B · products[]+subtotal+productId (fallback)",
      item: {
        name: product.name,
        units: 1,
        subtotal: product.price,
        tax: 21,
        discount: 0,
        productId: product.id,
      },
    },
  ];

  const docs: CreatedDoc[] = [];
  let winner: CreatedDoc | null = null;

  for (const v of variants) {
    console.log(`\n  → ${v.label}`);
    const payload = buildPayload(v.item);
    let documentId: string;
    try {
      const r = await holded.request<AnyRec>(
        "/invoicing/v1/documents/salesreceipt",
        { method: "POST", body: JSON.stringify(payload) },
      );
      const id = typeof r.id === "string" ? r.id : undefined;
      if (!id) {
        console.log(`    ✗ POST 2xx sin id: ${JSON.stringify(r).slice(0, 160)}`);
        continue;
      }
      documentId = id;
      console.log(`    POST OK · documentId=${redact(documentId, 10)}`);
    } catch (err) {
      console.log(`    ✗ POST ${fmtErr(err)}`);
      continue;
    }

    // GET-back inmediato.
    let stored: AnyRec;
    try {
      stored = await holded.request<AnyRec>(
        `/invoicing/v1/documents/salesreceipt/${documentId}`,
      );
    } catch (err) {
      console.log(`    ✗ GET-back ${fmtErr(err)}`);
      continue;
    }

    const total = Number(stored.total ?? 0);
    const subtotal = Number(stored.subtotal ?? 0);
    const numSerie = stored.numSerie ?? "(none)";
    const draft = stored.draft;
    console.log(
      `    GET · total=${total} subtotal=${subtotal} draft=${draft} numSerie=${numSerie}`,
    );

    const created: CreatedDoc = {
      documentId,
      sent: payload,
      stored,
      variantLabel: v.label,
    };
    docs.push(created);

    if (total > 0) {
      console.log(`    ✓ total>0 → GANADOR`);
      winner = created;
      break;
    }
    console.log(`    ✗ total=0 → siguiente variante`);
  }

  if (winner) {
    writeFileSync(
      resolve(fixturesDir, "04-post-request.json"),
      JSON.stringify(winner.sent, null, 2),
    );
    writeFileSync(
      resolve(fixturesDir, "04-post-stored.json"),
      JSON.stringify(winner.stored, null, 2),
    );
  }
  return { docs, winner };
}

// ── Sub-spike 3 ────────────────────────────────────────────────────────
async function tryApprove(
  holded: ApiKeyClient,
  documentId: string,
): Promise<AnyRec | null> {
  console.log(`  doc: ${documentId}`);
  const base = `/invoicing/v1/documents/salesreceipt/${documentId}`;
  const attempts: { method: "POST" | "PUT"; path: string; body?: AnyRec }[] = [
    { method: "POST", path: `${base}/approve` },
    { method: "POST", path: `${base}/send` },
    { method: "POST", path: `${base}/issue` },
    { method: "POST", path: `${base}/pay` },
    { method: "PUT", path: base, body: { draft: false } },
    { method: "POST", path: base, body: { approve: true } },
  ];

  for (const a of attempts) {
    const label = `[${a.method}] ${a.path.replace(documentId, redact(documentId, 10))}${a.body ? " " + JSON.stringify(a.body) : ""}`;
    try {
      const r = await holded.request<AnyRec>(a.path, {
        method: a.method,
        body: a.body ? JSON.stringify(a.body) : undefined,
      });
      console.log(`  ${label} → 2xx · ${JSON.stringify(r).slice(0, 140)}`);
    } catch (err) {
      console.log(`  ${label} → ${fmtErr(err)}`);
      continue;
    }

    // GET para confirmar.
    try {
      const stored = await holded.request<AnyRec>(base);
      const draft = stored.draft;
      const docNumber = stored.docNumber;
      const status = stored.status;
      console.log(
        `    GET · draft=${draft} docNumber=${docNumber} status=${status}`,
      );
      if (draft === false || (docNumber != null && docNumber !== "")) {
        console.log(`    ✓ aprobado`);
        writeFileSync(
          resolve(fixturesDir, "04-approved.json"),
          JSON.stringify(stored, null, 2),
        );
        return stored;
      }
      console.log(`    ✗ POST 2xx pero el doc sigue draft; siguiente intento`);
    } catch (err) {
      console.log(`    ✗ GET ${fmtErr(err)}`);
    }
  }
  return null;
}

// ── Sub-spike 4 ────────────────────────────────────────────────────────
async function testIdempotency(
  holded: ApiKeyClient,
  sourcePayload: AnyRec,
  originalDocumentId: string,
  externalId: string,
): Promise<void> {
  // 4.1 · Re-POST con el mismo payload (mismo externalId en notes).
  console.log(`  4.1 · re-POST con mismo externalId=${externalId}`);
  let duplicateId: string | null = null;
  try {
    const r = await holded.request<AnyRec>(
      "/invoicing/v1/documents/salesreceipt",
      { method: "POST", body: JSON.stringify(sourcePayload) },
    );
    const id = typeof r.id === "string" ? r.id : null;
    if (!id) {
      console.log(`    ✗ POST 2xx sin id: ${JSON.stringify(r).slice(0, 160)}`);
    } else {
      duplicateId = id;
      const dedup = id === originalDocumentId;
      console.log(
        `    POST OK · nuevoId=${redact(id, 10)} (original=${redact(originalDocumentId, 10)})`,
      );
      console.log(`    Holded ${dedup ? "DEDUPLICÓ (mismo id)" : "DUPLICÓ (id distinto → bad)"}`);
      writeFileSync(
        resolve(fixturesDir, "04-duplicate-response.json"),
        JSON.stringify(r, null, 2),
      );
    }
  } catch (err) {
    console.log(`    ✗ POST ${fmtErr(err)}`);
  }

  // 4.2 · ¿Es indexable el externalId vía búsqueda?
  console.log(`\n  4.2 · ¿se puede buscar por externalId?`);
  const baseList = "/invoicing/v1/documents/salesreceipt";
  const queries = [
    `?search=${externalId}`,
    `?notes=${externalId}`,
    `?q=${externalId}`,
    `?externalId=${externalId}`,
    `?filter=${encodeURIComponent(`notes=${externalId}`)}`,
  ];
  for (const qs of queries) {
    const r = await probeJson(holded, baseList + qs);
    if (r.ok) {
      const len = Array.isArray(r.data) ? r.data.length : -1;
      let hits = 0;
      if (Array.isArray(r.data)) {
        hits = r.data.filter((d) => {
          const n = (d as AnyRec).notes;
          return typeof n === "string" && n.includes(externalId);
        }).length;
      }
      const verdict =
        len === -1 ? `not array (${describe(r.data)})` : `array(${len}) · matches=${hits}`;
      console.log(`    ${qs.padEnd(56)} → ${verdict}`);
    } else {
      console.log(`    ${qs.padEnd(56)} → ${fmtErr(r.err)}`);
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, env.HOLDED_BASE_URL);

  console.log("Spike 04 · Validar flujo completo del salesreceipt");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  // 1.
  console.log("─── Sub-spike 1: series ─────────────────────────────────");
  const serie = await probeSeries(holded);
  if (!serie) {
    console.log("  (continuamos sin numSerie — Holded asignará una por defecto si lo hace)");
  }

  // 2.
  console.log("\n─── Sub-spike 2: POST corregido ─────────────────────────");
  const externalId = randomUUID();
  const result = await postCorrected(holded, serie, externalId);
  if (result.docs.length === 0) {
    console.log("\n⛔ Ningún POST creó documento. Aborto antes del sub-spike 3.");
    process.exit(1);
  }
  if (!result.winner) {
    console.log(
      "\n⚠ Ningún POST consiguió total>0. Continúo con el último doc creado para sub-spike 3+4, pero esto es un hallazgo crítico.",
    );
  }
  const anchorDoc = result.winner ?? result.docs[result.docs.length - 1]!;

  // 3.
  console.log("\n─── Sub-spike 3: approve ────────────────────────────────");
  const approved = await tryApprove(holded, anchorDoc.documentId);
  if (!approved) {
    console.log("  ✗ ningún endpoint consiguió aprobar el doc");
  }

  // 4.
  console.log("\n─── Sub-spike 4: idempotencia ───────────────────────────");
  await testIdempotency(holded, anchorDoc.sent, anchorDoc.documentId, externalId);

  console.log("\nFin.");
  console.log(`\nResumen rápido:`);
  console.log(`  serie usada     : ${serie?.sendValue ?? "(none)"}`);
  console.log(`  documentos POST : ${result.docs.length}`);
  console.log(`  variant ganador : ${result.winner?.variantLabel ?? "(ninguno con total>0)"}`);
  console.log(`  doc ancla       : ${anchorDoc.documentId}`);
  console.log(`  total ancla     : ${anchorDoc.stored.total ?? "?"}`);
  console.log(`  approve OK      : ${approved ? "sí" : "no"}`);
  if (approved) {
    console.log(`  docNumber       : ${approved.docNumber ?? "(none)"}`);
  }
}

main().catch((err) => {
  console.error("\nSPIKE 04 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
