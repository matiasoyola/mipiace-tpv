// Spike Fase 0 · Script 07 · sondeo `productId` solo (sin `sku`).
//
// Hipótesis: en el catálogo de Holded del cliente, casi todos los productos
// tienen `sku: ""`. La regla §05.B del spike obliga a enviar `sku` para que
// la línea no se invalide a 0. Si Holded acepta resolver el producto vía
// `productId` cuando se omite `sku`, el TPV podría vender los 961 productos
// del catálogo (no sólo los que tengan sku rellenado).
//
// 1 POST salesreceipt con `productId` y SIN `sku`. GET-back y validar
// `total > 0` y `total ≈ price·1.21`. No hace nada más (ni `/pay`, ni `/pdf`).
//
// Crea como máximo 1 documento nuevo.

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
} from "@mipiacetpv/holded-client";
import { HoldedEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

type AnyRec = Record<string, unknown>;

interface Product {
  id: string;
  name: string;
  price: number;
  total: number;
  stock: number;
  sku?: string | null;
  barcode?: string | null;
  forSale?: number;
}

// "Forro Libro Adhesivo 1.5x0.50" del fixture 01-products.json. Tiene
// sku: "" (vacío) y price: 1.40496, así que es el caso canónico que
// queremos probar.
const TARGET_PRODUCT_ID = "68d50ecfd24138c0cf089d2b";

function fmtErr(err: unknown): string {
  if (err instanceof HoldedApiError) {
    const body = typeof err.body === "string" ? err.body : JSON.stringify(err.body);
    return `HTTP ${err.status} · ${body.slice(0, 240)}`;
  }
  if (err instanceof HoldedInvalidResponseError) {
    return `non-JSON · status=${err.status} ct=${err.contentType ?? "-"}`;
  }
  if (err instanceof Error) return `ERR · ${err.message}`;
  return `ERR · ${String(err)}`;
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as T;
}

async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, { baseUrl: env.HOLDED_BASE_URL });

  console.log("Spike 07 · ¿Holded resuelve un producto vía productId sin sku?");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  // Cargar candidato del fixture
  const products = loadJson<Product[]>("01-products.json");
  const candidate = products.find((p) => p.id === TARGET_PRODUCT_ID);
  if (!candidate) {
    console.error(`✗ producto ${TARGET_PRODUCT_ID} no está en 01-products.json`);
    process.exit(1);
  }

  console.log("─── Producto candidato ─────────────────────────────────");
  console.log(`  id     : ${candidate.id}`);
  console.log(`  name   : ${candidate.name}`);
  console.log(`  sku    : ${JSON.stringify(candidate.sku)}`);
  console.log(`  barcode: ${JSON.stringify(candidate.barcode)}`);
  console.log(`  price  : ${candidate.price}`);
  console.log(`  total  : ${candidate.total} (con IVA, según Holded)`);
  const expectedTotal = candidate.price * 1.21;
  console.log(`  total esperado tras venta: ${expectedTotal.toFixed(4)}\n`);

  // Payload: productId, sin sku.
  const externalId = randomUUID();
  const payload: AnyRec = {
    approveDoc: true,
    date: Math.floor(Date.now() / 1000),
    notes: `TPV-uuid: ${externalId}`,
    items: [
      {
        name: candidate.name,
        units: 1,
        price: candidate.price,
        tax: 21,
        discount: 0,
        productId: candidate.id,
      },
    ],
  };

  writeFileSync(
    resolve(fixturesDir, "07-request.json"),
    JSON.stringify(payload, null, 2),
  );
  console.log("─── POST /invoicing/v1/documents/salesreceipt ──────────");
  console.log(`  externalId: ${externalId}`);
  console.log(`  payload (sin sku):`);
  console.log("    " + JSON.stringify(payload, null, 2).split("\n").join("\n    "));

  let documentId: string;
  try {
    const r = await holded.request<AnyRec>(
      "/invoicing/v1/documents/salesreceipt",
      { method: "POST", body: JSON.stringify(payload) },
    );
    writeFileSync(
      resolve(fixturesDir, "07-response.json"),
      JSON.stringify(r, null, 2),
    );
    if (typeof r.id !== "string") {
      console.log(`  ✗ POST 2xx sin id: ${JSON.stringify(r).slice(0, 200)}`);
      process.exit(1);
    }
    documentId = r.id;
    console.log(`  ✓ documentId=${documentId}\n`);
  } catch (err) {
    console.log(`  ✗ POST ${fmtErr(err)}`);
    process.exit(1);
  }

  // GET-back
  console.log("─── GET-back ───────────────────────────────────────────");
  let stored: AnyRec;
  try {
    stored = await holded.request<AnyRec>(
      `/invoicing/v1/documents/salesreceipt/${documentId}`,
    );
    writeFileSync(
      resolve(fixturesDir, "07-stored.json"),
      JSON.stringify(stored, null, 2),
    );
  } catch (err) {
    console.log(`  ✗ GET ${fmtErr(err)}`);
    process.exit(1);
  }

  const docNumber = stored.docNumber;
  const approvedAt = stored.approvedAt;
  const draft = stored.draft;
  const total = Number(stored.total ?? 0);
  const subtotal = Number(stored.subtotal ?? 0);
  const productsArr = Array.isArray(stored.products) ? (stored.products as AnyRec[]) : [];
  const line = productsArr[0] ?? {};
  const lineSku = (line as AnyRec).sku;
  const linePrice = Number((line as AnyRec).price ?? 0);
  const lineProductId = (line as AnyRec).productId;
  const lineName = (line as AnyRec).name;

  console.log(`  draft=${JSON.stringify(draft)}  approvedAt=${approvedAt}  docNumber=${JSON.stringify(docNumber)}`);
  console.log(`  total=${total}  subtotal=${subtotal}  (esperado total ≈ ${expectedTotal.toFixed(4)})`);
  console.log();
  console.log(`  Línea[0] guardada:`);
  console.log(`    name      = ${JSON.stringify(lineName)}`);
  console.log(`    price     = ${linePrice}  (enviado ${candidate.price})`);
  console.log(`    sku       = ${JSON.stringify(lineSku)}`);
  console.log(`    productId = ${JSON.stringify(lineProductId)}`);

  // Asertos
  const isApproved =
    docNumber != null &&
    docNumber !== "" &&
    approvedAt != null &&
    draft !== true;
  const totalOk = total > 0 && Math.abs(total - expectedTotal) < 0.05;
  const priceOk = Math.abs(linePrice - candidate.price) < 0.01;

  console.log();
  console.log("─── Asertos ────────────────────────────────────────────");
  console.log(`  ${isApproved ? "✓" : "✗"} documento aprobado con docNumber`);
  console.log(`  ${total > 0 ? "✓" : "✗"} total > 0  (${total})`);
  console.log(`  ${totalOk ? "✓" : "✗"} total ≈ price·1.21  (delta ${(total - expectedTotal).toFixed(4)})`);
  console.log(`  ${priceOk ? "✓" : "✗"} line.price preservado  (delta ${(linePrice - candidate.price).toFixed(4)})`);

  console.log();
  if (isApproved && totalOk && priceOk) {
    console.log("══════════════════════════════════════════════════════");
    console.log("  ✓ HIPÓTESIS CONFIRMADA");
    console.log("  Holded resuelve el producto vía productId aun sin sku.");
    console.log("  Implicación: el TPV puede vender todos los productos");
    console.log("  del catálogo, no sólo los que tengan sku rellenado.");
    console.log("══════════════════════════════════════════════════════");
  } else {
    console.log("══════════════════════════════════════════════════════");
    console.log("  ✗ HIPÓTESIS REFUTADA");
    console.log("  Holded ignora productId cuando se omite sku.");
    console.log("  Implicación: vigente la regla §05.B — el TPV sólo");
    console.log("  puede vender productos con sku no vacío.");
    console.log("══════════════════════════════════════════════════════");
  }
  console.log();
  console.log(`  documentId creado: ${documentId}`);
  console.log(`  externalId       : ${externalId}`);
  console.log(`  docNumber        : ${JSON.stringify(docNumber)}`);
}

main().catch((err) => {
  console.error("\nSPIKE 07 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
