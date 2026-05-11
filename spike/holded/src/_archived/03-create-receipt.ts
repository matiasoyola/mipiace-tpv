// Spike Fase 0 · Script 03.
//
// Objetivo:
//   1. Probe rápido de endpoints de tipos de IVA.
//   2. POST /invoicing/v1/documents/salesreceipt — cascada de variantes:
//        tax {21 número, "s_iva_21" string, ["s_iva_21"] array}
//      ×  warehouse {warehouseId, warehouseRecord}
//      → primera variante que cuele se queda.
//   3. GET del documento creado y diff exhaustivo "lo que envié" vs
//      "lo que Holded guardó" — éste es el verdadero entregable.
//
// Crea UN documento de prueba en Holded. Veri*factu OFF (verificado).

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

interface Warehouse {
  id: string;
  name: string;
  default?: boolean;
  warehouseRecord?: string | null;
}

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

function redact(s: string | null | undefined, keep = 6): string {
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

function diffObjects(sent: AnyRec, stored: AnyRec) {
  const sentKeys = new Set(Object.keys(sent));
  const storedKeys = new Set(Object.keys(stored));
  const onlySent: string[] = [];
  const onlyStored: string[] = [];
  const different: { key: string; sent: unknown; stored: unknown }[] = [];
  for (const k of sentKeys) {
    if (!storedKeys.has(k)) {
      onlySent.push(k);
    } else if (JSON.stringify(sent[k]) !== JSON.stringify(stored[k])) {
      different.push({ key: k, sent: sent[k], stored: stored[k] });
    }
  }
  for (const k of storedKeys) {
    if (!sentKeys.has(k)) onlyStored.push(k);
  }
  return { onlySent, onlyStored, different };
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

interface Attempt {
  n: number;
  taxLabel: string;
  warehouseLabel: string;
  request: AnyRec;
  ok: boolean;
  documentId?: string;
  error?: string;
}

async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, env.HOLDED_BASE_URL);

  const externalId = randomUUID();
  console.log("Spike 03 · Crear salesreceipt (cascada IVA × almacén) + verificación GET");
  console.log(`Base URL  : ${env.HOLDED_BASE_URL}`);
  console.log(`numSerie  : ${env.HOLDED_TEST_NUMSERIE}`);
  console.log(`externalId: ${externalId}\n`);

  // ── 1. Probe de tipos de IVA ────────────────────────────────────────
  console.log("## Endpoints de tipos de IVA — probe");
  const taxCandidates = [
    "/invoicing/v1/taxes",
    "/accounting/v1/taxes",
    "/v1/taxes",
    "/invoicing/v1/saletaxes",
    "/invoicing/v1/expensesaccounts",
  ];
  let taxesWinner: { path: string; data: unknown } | null = null;
  for (const path of taxCandidates) {
    const r = await probeJson(holded, path);
    if (r.ok) {
      console.log(`  ${path.padEnd(38)} → OK · ${describe(r.data)}`);
      if (!taxesWinner) taxesWinner = { path, data: r.data };
    } else {
      console.log(`  ${path.padEnd(38)} → ${fmtErr(r.err)}`);
    }
  }
  if (taxesWinner) {
    writeFileSync(
      resolve(fixturesDir, "03-taxes.json"),
      JSON.stringify(taxesWinner.data, null, 2),
    );
    console.log(`  ✓ taxes endpoint: ${taxesWinner.path} (saved: 03-taxes.json)`);
  } else {
    console.log("  ✗ ningún endpoint de taxes devolvió JSON");
  }
  console.log();

  // ── 2. Elegir producto y almacén ────────────────────────────────────
  const warehouses = loadJson<Warehouse[]>("02-warehouses.json");
  const wh = warehouses.find((w) => w.default) ?? warehouses[0];
  if (!wh) {
    console.error("✗ No hay almacenes en 02-warehouses.json. Lanza spike:02 primero.");
    process.exit(1);
  }

  const products = loadJson<Product[]>("01-products.json");
  const product =
    products.find((p) => p.name === "MILAN 430") ??
    products.find((p) => p.total === 0.4) ??
    products[0];
  if (!product) {
    console.error("✗ No hay productos en 01-products.json. Lanza spike:01 primero.");
    process.exit(1);
  }

  console.log("## Producto y almacén elegidos");
  console.log(`  producto : "${product.name}" id=${redact(product.id)}`);
  console.log(
    `             price=${product.price} total=${product.total} taxes=${JSON.stringify(product.taxes ?? [])} stock=${product.stock}`,
  );
  console.log(`  almacén  : "${wh.name}" default=${wh.default ?? false}`);
  console.log(
    `             id=${redact(wh.id)} warehouseRecord=${redact(wh.warehouseRecord ?? null)}`,
  );
  console.log();

  // ── 3. Cascada ──────────────────────────────────────────────────────
  const date = Math.floor(Date.now() / 1000);
  const baseItem: AnyRec = {
    name: product.name,
    units: 1,
    price: product.price,
    discount: 0,
    productId: product.id,
  };

  const taxVariants: { label: string; build: () => AnyRec }[] = [
    { label: "tax:21 (num)", build: () => ({ ...baseItem, tax: 21 }) },
    { label: 'tax:"s_iva_21" (str)', build: () => ({ ...baseItem, tax: "s_iva_21" }) },
    { label: 'taxes:["s_iva_21"] (arr)', build: () => ({ ...baseItem, taxes: ["s_iva_21"] }) },
  ];

  const whVariants: { label: string; key: "warehouseId" | "warehouseRecord"; value: string }[] = [
    { label: "warehouseId", key: "warehouseId", value: wh.id },
  ];
  if (wh.warehouseRecord) {
    whVariants.push({ label: "warehouseRecord", key: "warehouseRecord", value: wh.warehouseRecord });
  }

  console.log("## Cascada (POST /invoicing/v1/documents/salesreceipt)");
  const attempts: Attempt[] = [];
  let winner: { attempt: Attempt; sent: AnyRec; response: AnyRec } | null = null;
  let n = 0;

  outer: for (const wv of whVariants) {
    for (const tv of taxVariants) {
      n++;
      const payload: AnyRec = {
        date,
        notes: `TPV-uuid: ${externalId}`,
        numSerie: env.HOLDED_TEST_NUMSERIE,
        items: [tv.build()],
        [wv.key]: wv.value,
      };
      const label = `${tv.label.padEnd(26)} + ${wv.label}`;
      try {
        const response = await holded.request<AnyRec>(
          "/invoicing/v1/documents/salesreceipt",
          { method: "POST", body: JSON.stringify(payload) },
        );
        const documentId = typeof response.id === "string" ? response.id : undefined;
        const attempt: Attempt = {
          n,
          taxLabel: tv.label,
          warehouseLabel: wv.label,
          request: payload,
          ok: !!documentId,
          documentId,
        };
        attempts.push(attempt);
        if (documentId) {
          console.log(`  [${n}] ${label} → ✓ documentId=${redact(documentId, 10)}`);
          winner = { attempt, sent: payload, response };
          break outer;
        }
        console.log(`  [${n}] ${label} → 2xx sin id: ${JSON.stringify(response).slice(0, 160)}`);
      } catch (err) {
        const error = fmtErr(err);
        attempts.push({
          n,
          taxLabel: tv.label,
          warehouseLabel: wv.label,
          request: payload,
          ok: false,
          error,
        });
        console.log(`  [${n}] ${label} → ✗ ${error}`);
      }
    }
  }

  writeFileSync(resolve(fixturesDir, "03-attempts.json"), JSON.stringify(attempts, null, 2));

  if (!winner) {
    console.log("\n✗ Ninguna variante creó el documento. Ver 03-attempts.json.");
    process.exit(1);
  }

  writeFileSync(
    resolve(fixturesDir, "03-post-request.json"),
    JSON.stringify(winner.sent, null, 2),
  );
  writeFileSync(
    resolve(fixturesDir, "03-post-response.json"),
    JSON.stringify(winner.response, null, 2),
  );

  // ── 4. GET de vuelta ────────────────────────────────────────────────
  const documentId = winner.attempt.documentId as string;
  const getPath = `/invoicing/v1/documents/salesreceipt/${documentId}`;
  console.log(`\n## GET del documento creado`);
  console.log(`  ${getPath}`);
  let stored: AnyRec;
  try {
    stored = await holded.request<AnyRec>(getPath);
    writeFileSync(
      resolve(fixturesDir, "03-get-response.json"),
      JSON.stringify(stored, null, 2),
    );
    console.log(`  ✓ leído (saved: 03-get-response.json)`);
  } catch (err) {
    console.log(`  ✗ ${fmtErr(err)}`);
    return;
  }

  // ── 5. Diff sent vs stored ──────────────────────────────────────────
  console.log("\n## Diff: payload enviado vs documento guardado");
  const diff = diffObjects(winner.sent, stored);
  console.log(`  Sólo en sent (Holded NO los guardó con ese nombre) [${diff.onlySent.length}]:`);
  for (const k of diff.onlySent) console.log(`    - ${k}`);
  console.log(`  Sólo en stored (Holded añadió o renombró) [${diff.onlyStored.length}]:`);
  for (const k of diff.onlyStored) console.log(`    + ${k}`);
  console.log(`  Valor distinto [${diff.different.length}]:`);
  for (const d of diff.different) {
    const s = JSON.stringify(d.sent);
    const t = JSON.stringify(d.stored);
    console.log(`    ≠ ${d.key}`);
    console.log(`        sent  : ${s.length > 160 ? s.slice(0, 160) + "…" : s}`);
    console.log(`        stored: ${t.length > 160 ? t.slice(0, 160) + "…" : t}`);
  }

  // items[] diff (sent.items[0] vs el primer item guardado)
  const sentItems = winner.sent.items as unknown;
  const storedItems = (stored.items ?? stored.products ?? stored.lines) as unknown;
  if (
    Array.isArray(sentItems) && sentItems.length > 0 &&
    Array.isArray(storedItems) && storedItems.length > 0
  ) {
    const sentItem = sentItems[0] as AnyRec;
    const storedItem = storedItems[0] as AnyRec;
    console.log("\n## Diff items[0]");
    const itemDiff = diffObjects(sentItem, storedItem);
    console.log(`  Sólo en sent: ${itemDiff.onlySent.join(", ") || "(ninguno)"}`);
    console.log(`  Sólo en stored: ${itemDiff.onlyStored.join(", ") || "(ninguno)"}`);
    console.log(`  Distintos [${itemDiff.different.length}]:`);
    for (const d of itemDiff.different) {
      const s = JSON.stringify(d.sent);
      const t = JSON.stringify(d.stored);
      console.log(`    ≠ ${d.key}: sent=${s} → stored=${t}`);
    }
  }

  // ── 6. Resumen clave ────────────────────────────────────────────────
  console.log("\n## Resumen clave");
  const get = (k: string): unknown => stored[k];
  console.log(`  documentId        : ${get("id") ?? "?"}`);
  console.log(`  docNumber         : ${get("docNumber") ?? "(none)"}`);
  console.log(`  numSerie          : sent=${winner.sent.numSerie} | stored=${get("numSerie") ?? "(none)"}`);
  console.log(`  total             : ${get("total") ?? "(none)"}`);
  console.log(`  subtotal          : ${get("subtotal") ?? "(none)"}`);
  console.log(`  notes             : ${get("notes") ?? "(none)"}`);
  console.log(`  status            : ${get("status") ?? "(none)"}`);
  console.log(`  pdf url           : ${get("pdfUrl") ?? get("publicUrl") ?? get("documentUrl") ?? "(none)"}`);
  console.log(`  warehouseId stored: ${get("warehouseId") ?? "(none)"}`);
  console.log(`  warehouseRecord   : ${get("warehouseRecord") ?? "(none)"}`);
  console.log(`\nFin.`);
}

main().catch((err) => {
  console.error("\nSPIKE 03 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
