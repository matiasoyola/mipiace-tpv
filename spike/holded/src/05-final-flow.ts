// Spike Fase 0 · Script 05 · cierre (versión extendida).
//
// Cuatro pasos:
//   1. GET /invoicing/v1/paymentmethods — descubrir métodos + heurística
//      para identificar "efectivo" y "tarjeta".
//   2. POST salesreceipt con el payload definitivo (approveDoc, sku=barcode,
//      sin numSerieId, sin warehouseId, sin productId) + GET-back.
//   3. POST .../pay para cobrar el documento 100% al treasury del método
//      cash (o fallback) + GET-back y comprobar campo de cobro.
//   4. GET .../pdf para inspeccionar la respuesta (content-type, tamaño,
//      forma del PDF o del error si no hay PDF).
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

interface PaymentMethod {
  id: string;
  name?: string;
  bankId?: string;
  dueDays?: number;
}

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as T;
}

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

// ── Paso 1 ─────────────────────────────────────────────────────────────
async function step1Payments(holded: ApiKeyClient): Promise<{
  all: PaymentMethod[];
  cash: PaymentMethod | null;
  card: PaymentMethod | null;
  fallback: PaymentMethod | null;
}> {
  const path = "/invoicing/v1/paymentmethods";
  console.log(`  GET ${path}`);
  let data: unknown;
  try {
    data = await holded.request<unknown>(path);
  } catch (err) {
    console.log(`  ✗ ${fmtErr(err)}`);
    return { all: [], cash: null, card: null, fallback: null };
  }
  writeFileSync(
    resolve(fixturesDir, "05-paymentmethods.json"),
    JSON.stringify(data, null, 2),
  );
  console.log(`  saved: 05-paymentmethods.json`);

  if (!Array.isArray(data)) {
    console.log(`  ✗ no es array: ${typeof data}`);
    return { all: [], cash: null, card: null, fallback: null };
  }

  const methods = data as PaymentMethod[];
  console.log(`  total métodos: ${methods.length}`);
  for (const m of methods) {
    console.log(
      `    {id=${m.id}, name="${m.name ?? ""}", bankId=${m.bankId ?? "-"}, dueDays=${m.dueDays ?? "-"}}`,
    );
  }

  const lc = (s: string | undefined) => (s ?? "").toLowerCase();
  const cash =
    methods.find((m) => /efectivo|caja/.test(lc(m.name))) ?? null;
  const card =
    methods.find((m) => /tarjeta|visa|card/.test(lc(m.name))) ?? null;
  const fallback = methods[0] ?? null;

  console.log();
  console.log(`  ✓ efectivo: ${cash ? `"${cash.name}" id=${cash.id} bankId=${cash.bankId ?? "-"}` : "(no match → uso fallback)"}`);
  console.log(`  ✓ tarjeta : ${card ? `"${card.name}" id=${card.id} bankId=${card.bankId ?? "-"}` : "(no match)"}`);
  console.log(`  ✓ fallback: ${fallback ? `"${fallback.name}" id=${fallback.id} bankId=${fallback.bankId ?? "-"}` : "(none)"}`);

  return { all: methods, cash, card, fallback };
}

// ── Paso 2 ─────────────────────────────────────────────────────────────
interface CreatedDoc {
  id: string;
  total: number;
  subtotal: number;
  stored: AnyRec;
  sentPayload: AnyRec;
  externalId: string;
  productSent: { name: string; price: number; barcode: string };
}

async function step2Post(
  holded: ApiKeyClient,
): Promise<CreatedDoc | null> {
  const products = loadJson<Product[]>("01-products.json");
  const candidate =
    products.find(
      (p) =>
        typeof p.barcode === "string" && p.barcode.length > 0 &&
        p.forSale === 1 && p.stock > 0,
    ) ??
    products.find(
      (p) => typeof p.barcode === "string" && p.barcode.length > 0 && p.forSale === 1,
    ) ??
    products.find((p) => typeof p.barcode === "string" && p.barcode.length > 0);

  if (!candidate || typeof candidate.barcode !== "string") {
    console.log("  ✗ ningún producto del fixture tiene barcode");
    return null;
  }

  const expectedTotal = candidate.price * 1.21;
  console.log(`  producto: "${candidate.name}"`);
  console.log(`    barcode (→ sku): "${candidate.barcode}"`);
  console.log(`    price: ${candidate.price} (base)`);
  console.log(`    total esperado: ${expectedTotal.toFixed(4)}`);

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
        sku: candidate.barcode,
      },
    ],
  };

  console.log(`\n  POST /invoicing/v1/documents/salesreceipt`);
  console.log(`    externalId: ${externalId}`);

  let documentId: string;
  try {
    const r = await holded.request<AnyRec>(
      "/invoicing/v1/documents/salesreceipt",
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (typeof r.id !== "string") {
      console.log(`    ✗ POST 2xx sin id: ${JSON.stringify(r).slice(0, 200)}`);
      return null;
    }
    documentId = r.id;
    console.log(`    ✓ documentId=${documentId}`);
    writeFileSync(
      resolve(fixturesDir, "05-post-request.json"),
      JSON.stringify(payload, null, 2),
    );
    writeFileSync(
      resolve(fixturesDir, "05-post-response.json"),
      JSON.stringify(r, null, 2),
    );
  } catch (err) {
    console.log(`    ✗ POST ${fmtErr(err)}`);
    return null;
  }

  // GET-back.
  console.log(`\n  GET-back`);
  let stored: AnyRec;
  try {
    stored = await holded.request<AnyRec>(
      `/invoicing/v1/documents/salesreceipt/${documentId}`,
    );
    writeFileSync(
      resolve(fixturesDir, "05-get-response.json"),
      JSON.stringify(stored, null, 2),
    );
  } catch (err) {
    console.log(`    ✗ GET ${fmtErr(err)}`);
    return null;
  }

  const draft = stored.draft;
  const docNumber = stored.docNumber;
  const approvedAt = stored.approvedAt;
  const total = Number(stored.total ?? 0);
  const subtotal = Number(stored.subtotal ?? 0);

  // Asertos del spec + uno relajado para reconciliar el matiz `draft: null`.
  const draftIsFalse = draft === false;
  const draftNotTrue =
    draft !== true && (draft === false || (draft == null && approvedAt != null));
  const docNumberOk = docNumber != null && docNumber !== "";
  const totalOk = total > 0 && Math.abs(total - expectedTotal) < 0.05;

  console.log(`    draft=${JSON.stringify(draft)} approvedAt=${approvedAt} docNumber=${JSON.stringify(docNumber)}`);
  console.log(`    total=${total} (esperado ${expectedTotal.toFixed(4)}, delta ${(total-expectedTotal).toFixed(4)})`);
  console.log(`    subtotal=${subtotal} (price enviado=${candidate.price}, delta ${(subtotal - candidate.price).toFixed(4)})`);
  console.log();
  console.log(`  ## Asertos (spec)`);
  console.log(`    ${draftIsFalse ? "✓" : "✗"} draft === false  · stored.draft = ${JSON.stringify(draft)}`);
  console.log(`    ${docNumberOk ? "✓" : "✗"} docNumber !== null · stored.docNumber = ${JSON.stringify(docNumber)}`);
  console.log(`    ${total > 0 ? "✓" : "✗"} total > 0          · ${total}`);
  console.log(`    ${totalOk ? "✓" : "✗"} total ≈ price·1.21  · delta ${(total - expectedTotal).toFixed(4)}`);

  if (!draftIsFalse) {
    console.log(`\n  ⚠ draft no es exactamente \`false\`. Holded devuelve \`null\` para documentos aprobados via approveDoc:true.`);
    console.log(`    Reconciliación: \`isApproved = (draft===false) || (draft==null && approvedAt!=null)\` → ${draftNotTrue}`);
    console.log(`    Tratamos el doc como aprobado si isApproved=true (registrado en spike-holded.md 05.A).`);
  }

  // Decisión de continuar:
  //   - Si docNumber, total, math son OK y isApproved (relajado) → continuar.
  //   - Si docNumber está vacío o total no cuadra → parar.
  const okToContinue = draftNotTrue && docNumberOk && totalOk;
  if (!okToContinue) {
    console.log(`\n  ✗ Aserto crítico fallido. Documento completo:`);
    console.log(JSON.stringify(stored, null, 2));
    return null;
  }

  return {
    id: documentId,
    total,
    subtotal,
    stored,
    sentPayload: payload,
    externalId,
    productSent: { name: candidate.name, price: candidate.price, barcode: candidate.barcode },
  };
}

// ── Paso 3 ─────────────────────────────────────────────────────────────
async function step3Pay(
  holded: ApiKeyClient,
  doc: CreatedDoc,
  treasuryMethod: PaymentMethod | null,
): Promise<void> {
  if (!treasuryMethod) {
    console.log("  ✗ sin payment method → no pago");
    return;
  }
  const treasury =
    typeof treasuryMethod.bankId === "string" && treasuryMethod.bankId.length > 0
      ? treasuryMethod.bankId
      : treasuryMethod.id;
  console.log(
    `  treasury: ${treasury} (de "${treasuryMethod.name}", ${treasuryMethod.bankId ? "bankId" : "id como fallback"})`,
  );

  const payPath = `/invoicing/v1/documents/salesreceipt/${doc.id}/pay`;
  const payload: AnyRec = {
    amount: doc.total,
    date: Math.floor(Date.now() / 1000),
    treasury,
  };

  console.log(`  POST ${payPath}`);
  console.log(`    payload: ${JSON.stringify(payload)}`);
  try {
    const r = await holded.request<AnyRec>(payPath, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    console.log(`    ✓ ${JSON.stringify(r).slice(0, 200)}`);
    writeFileSync(
      resolve(fixturesDir, "05-pay-response.json"),
      JSON.stringify(r, null, 2),
    );
  } catch (err) {
    console.log(`    ✗ ${fmtErr(err)}`);
    // No abortamos: aun fallando, hacemos GET-back para ver el estado.
  }

  // GET-back.
  console.log(`\n  GET-back`);
  let stored: AnyRec;
  try {
    stored = await holded.request<AnyRec>(
      `/invoicing/v1/documents/salesreceipt/${doc.id}`,
    );
    writeFileSync(
      resolve(fixturesDir, "05-after-pay.json"),
      JSON.stringify(stored, null, 2),
    );
  } catch (err) {
    console.log(`    ✗ GET ${fmtErr(err)}`);
    return;
  }

  const ptotal = Number(stored.paymentsTotal ?? 0);
  const ppending = Number(stored.paymentsPending ?? 0);
  const prefunds = Number(stored.paymentsRefunds ?? 0);
  const status = stored.status;
  console.log(`    paymentsTotal:   ${ptotal} (esperado ${doc.total})`);
  console.log(`    paymentsPending: ${ppending} (esperado 0)`);
  console.log(`    paymentsRefunds: ${prefunds}`);
  console.log(`    status:          ${status}`);

  const paidEqualTotal = Math.abs(ptotal - doc.total) < 0.01;
  const pendingZero = Math.abs(ppending) < 0.01;
  console.log();
  console.log(`  ## Asertos (spec)`);
  console.log(`    ${paidEqualTotal ? "✓" : "✗"} paymentsTotal === total    · ${ptotal} vs ${doc.total}`);
  console.log(`    ${pendingZero ? "✓" : "✗"} paymentsPending === 0       · ${ppending}`);

  if (!paidEqualTotal) {
    console.log(`\n  ⚠ paymentsTotal no coincide con total. Posibles otros campos donde Holded refleja el cobro:`);
    const keys = Object.keys(stored).filter((k) =>
      /pay|paid|cob|amount|balance/i.test(k),
    );
    for (const k of keys) {
      console.log(`    stored.${k} = ${JSON.stringify(stored[k])}`);
    }
  }
}

// ── Paso 4 ─────────────────────────────────────────────────────────────
async function step4Pdf(env: HoldedEnv, documentId: string): Promise<void> {
  const url = `${env.HOLDED_BASE_URL}/invoicing/v1/documents/salesreceipt/${documentId}/pdf`;
  console.log(`  GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        key: env.HOLDED_API_KEY,
        Accept: "*/*",
      },
    });
  } catch (err) {
    console.log(`  ✗ fetch error: ${(err as Error).message}`);
    return;
  }

  const contentType = res.headers.get("content-type");
  const buf = Buffer.from(await res.arrayBuffer());
  const size = buf.length;
  console.log(`    HTTP ${res.status} · content-type=${contentType} · size=${size}b`);

  writeFileSync(resolve(fixturesDir, "05-pdf.raw"), buf);
  console.log(`    saved: 05-pdf.raw`);

  // Detectar tipo del payload.
  const head4 = buf.subarray(0, 4).toString("latin1");
  const isPdf = head4 === "%PDF";
  const isJson =
    contentType?.toLowerCase().includes("application/json") ||
    (buf.length > 0 && (buf[0] === 0x7b || buf[0] === 0x5b));
  const isHtml = contentType?.toLowerCase().includes("text/html");

  const previewBytes = buf.subarray(0, 200);
  const asciiPreview = previewBytes
    .toString("utf8")
    .replace(/[^\x20-\x7E\n]/g, ".")
    .slice(0, 200);
  console.log(`    preview (ascii, 200B): ${asciiPreview}`);

  if (isJson) {
    try {
      const json = JSON.parse(buf.toString("utf8"));
      console.log(`    JSON parseado:`);
      console.log("      " + JSON.stringify(json, null, 2).split("\n").join("\n      "));
      if (json && typeof json === "object" && "info" in json) {
        console.log(`    info: ${(json as AnyRec).info}`);
      }
    } catch (err) {
      console.log(`    no se pudo parsear como JSON: ${(err as Error).message}`);
    }
  } else if (isPdf) {
    console.log(`    ✓ Es un PDF binario válido (header "%PDF").`);
  } else if (isHtml) {
    console.log(`    ⚠ Es HTML — probablemente el endpoint no expone PDF para salesreceipt.`);
  } else {
    console.log(`    hex (200B): ${previewBytes.toString("hex").slice(0, 200)}…`);
  }
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, { baseUrl: env.HOLDED_BASE_URL });

  console.log("Spike 05 · Flujo final completo (paymentmethods + POST + /pay + /pdf)");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  console.log("─── Paso 1: payment methods ────────────────────────────");
  const pm = await step1Payments(holded);

  console.log("\n─── Paso 2: POST salesreceipt + GET-back ───────────────");
  const doc = await step2Post(holded);
  if (!doc) {
    console.log("\n⛔ Paso 2 falló asertos críticos. Paro antes de /pay y /pdf.");
    process.exit(1);
  }

  console.log("\n─── Paso 3: /pay ───────────────────────────────────────");
  const treasury = pm.cash ?? pm.fallback;
  await step3Pay(holded, doc, treasury);

  console.log("\n─── Paso 4: /pdf ───────────────────────────────────────");
  await step4Pdf(env, doc.id);

  console.log();
  console.log("══════════════════════════════════════════════════════");
  console.log("  Spike 05 completado");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  documentId: ${doc.id}`);
  console.log(`  externalId: ${doc.externalId}`);
  console.log(`  docNumber : ${doc.stored.docNumber}`);
  console.log(`  total     : ${doc.total} €`);
}

main().catch((err) => {
  console.error("\nSPIKE 05 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
