// Spike Fase 0 · Script 06 · cierre del spike.
//
// Continúa donde quedó el 05:
//   Paso 3 · /pay sobre el doc aprobado del 05 run1 (Precinto, 2.75 €).
//            Cascada: sin treasury → con treasury="Pago al contado".
//            Tras cada 2xx, GET-back para vigilar el "PUT 2xx mentiroso".
//   Paso 4 · /pdf sobre el mismo doc. Loguea content-type, tamaño,
//            primeros 200 bytes en ascii+hex. Guarda body en 05-pdf.raw.
//   Paso 5 · POST de línea libre (sin sku, sin productId) — confirma
//            que el fallback funciona cuando un producto no tiene sku.
//
// Crea como máximo 1 documento nuevo (el del paso 5).

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

// Doc aprobado del 05 run1 (Precinto de embalaje, total 2.75 €).
const EXISTING_DOC_ID = "6a020deaa1b0a3d96d03256f";
const EXISTING_DOC_TOTAL = 2.75;
// "Pago al contado" del paymentmethods del 05 run2.
const PAGO_AL_CONTADO_ID = "674ef5490dbae438c107d95e";

type AnyRec = Record<string, unknown>;

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

async function getDoc(holded: ApiKeyClient, id: string): Promise<AnyRec> {
  return await holded.request<AnyRec>(
    `/invoicing/v1/documents/salesreceipt/${id}`,
  );
}

// ── Paso 3 ─────────────────────────────────────────────────────────────
async function step3PayCascade(
  holded: ApiKeyClient,
  docId: string,
  expectedTotal: number,
): Promise<void> {
  console.log(`  doc: ${docId} · esperado total=${expectedTotal}`);

  let initial: AnyRec;
  try {
    initial = await getDoc(holded, docId);
  } catch (err) {
    console.log(`  ✗ GET inicial: ${fmtErr(err)}`);
    return;
  }
  const initialPaid = Number(initial.paymentsTotal ?? 0);
  const initialPending = Number(initial.paymentsPending ?? 0);
  console.log(`  initial: paymentsTotal=${initialPaid} paymentsPending=${initialPending}`);

  if (initialPaid >= expectedTotal - 0.01) {
    console.log(`  ⚠ doc ya pagado en un run previo · saltando /pay`);
    return;
  }

  const date = Math.floor(Date.now() / 1000);
  const attempts: { label: string; payload: AnyRec }[] = [
    {
      label: "1 · sin treasury",
      payload: { date, amount: expectedTotal, desc: "TPV pago contado spike" },
    },
    {
      label: "2 · treasury='Pago al contado'",
      payload: {
        date,
        amount: expectedTotal,
        treasury: PAGO_AL_CONTADO_ID,
        desc: "TPV pago contado spike",
      },
    },
  ];

  const payPath = `/invoicing/v1/documents/salesreceipt/${docId}/pay`;
  let n = 0;
  for (const a of attempts) {
    n++;
    console.log(`\n  → Intento ${a.label}`);
    console.log(`    payload: ${JSON.stringify(a.payload)}`);

    try {
      const r = await holded.request<AnyRec>(payPath, {
        method: "POST",
        body: JSON.stringify(a.payload),
      });
      console.log(`    POST 2xx · ${JSON.stringify(r).slice(0, 200)}`);
    } catch (err) {
      console.log(`    POST ${fmtErr(err)}`);
      continue;
    }

    // GET-back contra el "PUT 2xx mentiroso".
    let stored: AnyRec;
    try {
      stored = await getDoc(holded, docId);
    } catch (err) {
      console.log(`    GET-back ${fmtErr(err)}`);
      continue;
    }
    const paid = Number(stored.paymentsTotal ?? 0);
    const pending = Number(stored.paymentsPending ?? 0);
    const paidFlag = stored.paid;
    console.log(
      `    GET · paymentsTotal=${paid} paymentsPending=${pending} paid=${JSON.stringify(paidFlag)}`,
    );

    const ok =
      Math.abs(paid - expectedTotal) < 0.01 || paidFlag === 1 || paidFlag === true;
    if (ok) {
      console.log(`    ✓ /pay surtió efecto`);
      writeFileSync(
        resolve(fixturesDir, `06-after-pay-${n}.json`),
        JSON.stringify(stored, null, 2),
      );
      return;
    }
    console.log(
      `    ✗ 2xx pero el doc no refleja el pago (PUT 2xx mentiroso) · siguiente variante`,
    );
  }
  console.log(`\n  ✗ Ningún intento de /pay surtió efecto`);
}

// ── Paso 4 ─────────────────────────────────────────────────────────────
async function step4Pdf(env: HoldedEnv, docId: string): Promise<void> {
  const url = `${env.HOLDED_BASE_URL}/invoicing/v1/documents/salesreceipt/${docId}/pdf`;
  console.log(`  GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { key: env.HOLDED_API_KEY, Accept: "*/*" },
    });
  } catch (err) {
    console.log(`  ✗ fetch: ${(err as Error).message}`);
    return;
  }

  const contentType = res.headers.get("content-type");
  const buf = Buffer.from(await res.arrayBuffer());
  const size = buf.length;
  console.log(`    HTTP ${res.status} · content-type=${contentType} · size=${size}b`);

  writeFileSync(resolve(fixturesDir, "05-pdf.raw"), buf);
  console.log(`    saved: 05-pdf.raw`);

  const head4 = buf.subarray(0, 4).toString("latin1");
  const isPdf = head4 === "%PDF";
  const isJson =
    contentType?.toLowerCase().includes("application/json") ||
    (buf.length > 0 && (buf[0] === 0x7b || buf[0] === 0x5b));
  const isHtml = contentType?.toLowerCase().includes("text/html");

  const preview = buf.subarray(0, 200);
  const ascii = preview
    .toString("utf8")
    .replace(/[^\x20-\x7E\n]/g, ".")
    .slice(0, 200);
  console.log(`    ascii (200B): ${ascii}`);
  console.log(`    hex   (200B): ${preview.toString("hex").slice(0, 200)}`);

  if (isJson) {
    try {
      const json = JSON.parse(buf.toString("utf8"));
      console.log(`    JSON parseado:`);
      console.log("      " + JSON.stringify(json, null, 2).split("\n").join("\n      "));
      if (json && typeof json === "object" && "info" in json) {
        console.log(`    info: ${(json as AnyRec).info}`);
      }
    } catch (err) {
      console.log(`    no parseable JSON: ${(err as Error).message}`);
    }
  } else if (isPdf) {
    console.log(`    ✓ PDF binario válido (header %PDF)`);
  } else if (isHtml) {
    console.log(`    ⚠ HTML — probable página de error del SPA`);
  }
}

// ── Paso 5 ─────────────────────────────────────────────────────────────
async function step5FreeLine(holded: ApiKeyClient): Promise<void> {
  const externalId = randomUUID();
  const payload: AnyRec = {
    approveDoc: true,
    date: Math.floor(Date.now() / 1000),
    notes: `TPV-uuid: ${externalId}`,
    items: [
      {
        name: "Producto manual sin SKU",
        units: 1,
        price: 1.5,
        tax: 21,
        discount: 0,
      },
    ],
  };

  console.log(`  externalId: ${externalId}`);
  console.log(`  payload: ${JSON.stringify(payload)}`);

  let documentId: string;
  try {
    const r = await holded.request<AnyRec>(
      "/invoicing/v1/documents/salesreceipt",
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (typeof r.id !== "string") {
      console.log(`  ✗ POST 2xx sin id: ${JSON.stringify(r).slice(0, 200)}`);
      return;
    }
    documentId = r.id;
    console.log(`  ✓ POST OK · documentId=${documentId}`);
    writeFileSync(
      resolve(fixturesDir, "06-freeline-request.json"),
      JSON.stringify(payload, null, 2),
    );
    writeFileSync(
      resolve(fixturesDir, "06-freeline-response.json"),
      JSON.stringify(r, null, 2),
    );
  } catch (err) {
    console.log(`  ✗ POST ${fmtErr(err)}`);
    return;
  }

  let stored: AnyRec;
  try {
    stored = await getDoc(holded, documentId);
    writeFileSync(
      resolve(fixturesDir, "06-freeline-stored.json"),
      JSON.stringify(stored, null, 2),
    );
  } catch (err) {
    console.log(`  ✗ GET-back ${fmtErr(err)}`);
    return;
  }

  const total = Number(stored.total ?? 0);
  const subtotal = Number(stored.subtotal ?? 0);
  const docNumber = stored.docNumber;
  const draft = stored.draft;
  const approvedAt = stored.approvedAt;
  const expectedTotal = 1.815;
  const expectedSubtotal = 1.5;

  console.log(`\n  GET stored:`);
  console.log(`    docNumber: ${JSON.stringify(docNumber)}`);
  console.log(`    draft: ${draft} · approvedAt: ${approvedAt}`);
  console.log(`    total: ${total} (esperado ≈ ${expectedTotal})`);
  console.log(`    subtotal: ${subtotal} (esperado ≈ ${expectedSubtotal})`);

  const line = Array.isArray(stored.products)
    ? (stored.products[0] as AnyRec | undefined)
    : null;
  if (line) {
    console.log(
      `    línea[0]: name=${line.name} price=${line.price} sku=${JSON.stringify(line.sku)} productId=${JSON.stringify(line.productId ?? null)}`,
    );
  }

  const totalOk = Math.abs(total - expectedTotal) < 0.05;
  const subtotalOk = Math.abs(subtotal - expectedSubtotal) < 0.02;
  const docNumberOk = docNumber != null && docNumber !== "";
  const isApproved = draft === false || (draft == null && approvedAt != null);

  console.log(`\n  ## Asertos`);
  console.log(`    ${totalOk ? "✓" : "✗"} total ≈ ${expectedTotal}    · ${total}`);
  console.log(`    ${subtotalOk ? "✓" : "✗"} subtotal ≈ ${expectedSubtotal} · ${subtotal}`);
  console.log(`    ${docNumberOk ? "✓" : "✗"} docNumber asignado        · ${docNumber}`);
  console.log(`    ${isApproved ? "✓" : "✗"} doc aprobado              · draft=${draft} approvedAt=${approvedAt}`);
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, env.HOLDED_BASE_URL);

  console.log("Spike 06 · Cierre · /pay + /pdf + línea libre");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  console.log("─── Paso 3: /pay (cascada) ─────────────────────────────");
  await step3PayCascade(holded, EXISTING_DOC_ID, EXISTING_DOC_TOTAL);

  console.log("\n─── Paso 4: /pdf ───────────────────────────────────────");
  await step4Pdf(env, EXISTING_DOC_ID);

  console.log("\n─── Paso 5: POST línea libre (sub-experimento C) ──────");
  await step5FreeLine(holded);

  console.log();
  console.log("══════════════════════════════════════════════════════");
  console.log("  Spike 06 completado");
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\nSPIKE 06 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
