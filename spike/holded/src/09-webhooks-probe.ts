// Spike Fase 1 · Script 09 · sondeo de webhooks de Holded.
//
// Pregunta: ¿expone Holded webhooks (registro programático, eventos,
// firma HMAC) que nos permitan invalidar la cache local de catálogo en
// tiempo real, en lugar de polling cada 15 min?
//
// Esta investigación es **sólo de descubrimiento** (B2 §2.4): si
// existen y son fiables, documentamos shape esperado; si no, queda
// como "non-feature" y el cron de 15 min cubre el MVP.
//
// Estrategia: sondear paths típicos de webhooks/eventos en distintos
// namespaces. Como en §08, fetch crudo + tolerancia al 200+HTML y al
// envelope `{status:0, info:"..."}`.
//
// No registra ningún webhook real (POST no se ejecuta en esta tanda).
// Sólo GET y, donde tiene sentido, una OPTIONS para ver Allow headers.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HoldedEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

interface ProbeResult {
  path: string;
  method: "GET" | "OPTIONS";
  slug: string;
  httpStatus: number;
  contentType: string | null;
  allow: string | null;
  sizeBytes: number;
  isJson: boolean;
  bodyPreview: string;
  envelopeInfo?: string;
  errorClass: "OK_JSON" | "OK_HTML_404" | "ENVELOPE_ERROR" | "HTTP_ERROR" | "UNKNOWN";
}

// Candidatos típicos para registro/listado de webhooks.
const TARGETS: Array<{ path: string; slug: string; method: "GET" | "OPTIONS" }> = [
  { path: "/invoicing/v1/webhooks", slug: "invoicing-webhooks", method: "GET" },
  { path: "/invoicing/v1/webhooks", slug: "invoicing-webhooks-options", method: "OPTIONS" },
  { path: "/invoicing/v1/hooks", slug: "invoicing-hooks", method: "GET" },
  { path: "/invoicing/v1/events", slug: "invoicing-events", method: "GET" },
  { path: "/invoicing/v1/subscriptions", slug: "invoicing-subscriptions", method: "GET" },
  { path: "/invoicing/v1/notifications", slug: "invoicing-notifications", method: "GET" },
  { path: "/webhooks/v1", slug: "webhooks-v1", method: "GET" },
  { path: "/webhooks/v1/subscriptions", slug: "webhooks-v1-subs", method: "GET" },
  { path: "/events/v1", slug: "events-v1", method: "GET" },
  { path: "/v1/webhooks", slug: "v1-webhooks", method: "GET" },
  { path: "/api/v1/webhooks", slug: "api-v1-webhooks", method: "GET" },
  // Algunos ERPs anidan el webhook bajo el recurso (producto/contacto).
  { path: "/invoicing/v1/products/webhooks", slug: "products-webhooks", method: "GET" },
  { path: "/invoicing/v1/contacts/webhooks", slug: "contacts-webhooks", method: "GET" },
];

async function probe(env: HoldedEnv, target: typeof TARGETS[number]): Promise<ProbeResult> {
  const url = `${env.HOLDED_BASE_URL}${target.path}`;
  console.log(`\n  ${target.method} ${target.path}`);

  let res: Response;
  let buf: Buffer;
  try {
    res = await fetch(url, {
      method: target.method,
      headers: { key: env.HOLDED_API_KEY, Accept: "application/json" },
    });
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`    ✗ fetch error: ${msg}`);
    return {
      path: target.path,
      method: target.method,
      slug: target.slug,
      httpStatus: 0,
      contentType: null,
      allow: null,
      sizeBytes: 0,
      isJson: false,
      bodyPreview: `fetch error: ${msg}`,
      errorClass: "UNKNOWN",
    };
  }

  const contentType = res.headers.get("content-type");
  const allow = res.headers.get("allow") ?? res.headers.get("access-control-allow-methods");
  const sizeBytes = buf.length;
  const bodyText = buf.toString("utf8");
  const bodyPreview = bodyText.slice(0, 200).replace(/\s+/g, " ");
  console.log(`    HTTP ${res.status} · ct=${contentType ?? "—"} · allow=${allow ?? "—"} · ${sizeBytes}B`);
  if (bodyPreview.length > 0) {
    console.log(`    preview: ${bodyPreview.slice(0, 160)}${bodyPreview.length > 160 ? "…" : ""}`);
  }

  const isJsonByCt = (contentType ?? "").toLowerCase().includes("application/json");
  const isJsonByShape = bodyText.length > 0 && (bodyText.trimStart()[0] === "{" || bodyText.trimStart()[0] === "[");
  let parsed: unknown;
  let isJson = false;
  if (isJsonByCt || isJsonByShape) {
    try {
      parsed = JSON.parse(bodyText);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  let envelopeInfo: string | undefined;
  if (isJson && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.status === "number" && typeof obj.info === "string" && obj.status === 0) {
      envelopeInfo = obj.info;
    }
  }

  let errorClass: ProbeResult["errorClass"] = "UNKNOWN";
  if (res.status === 200 && isJson && envelopeInfo == null) errorClass = "OK_JSON";
  else if (res.status === 200 && !isJson && (contentType ?? "").includes("text/html"))
    errorClass = "OK_HTML_404";
  else if (envelopeInfo != null) errorClass = "ENVELOPE_ERROR";
  else if (res.status >= 400) errorClass = "HTTP_ERROR";

  const dumpPath = resolve(fixturesDir, `09-${target.slug}.json`);
  if (isJson) {
    writeFileSync(dumpPath, JSON.stringify(parsed, null, 2));
  } else {
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          note: "no-json response",
          httpStatus: res.status,
          contentType,
          allow,
          sizeBytes,
          preview: bodyText.slice(0, 500),
        },
        null,
        2,
      ),
    );
  }

  return {
    path: target.path,
    method: target.method,
    slug: target.slug,
    httpStatus: res.status,
    contentType,
    allow,
    sizeBytes,
    isJson,
    bodyPreview,
    envelopeInfo,
    errorClass,
  };
}

function printTable(results: ProbeResult[]): void {
  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log("  Resumen");
  console.log("──────────────────────────────────────────────────────────────────");
  for (const r of results) {
    const tag = r.errorClass.padEnd(14);
    const env = r.envelopeInfo ? ` · "${r.envelopeInfo}"` : "";
    console.log(
      `  ${r.method.padEnd(7)} ${r.path.padEnd(40)} · HTTP ${r.httpStatus} · ${tag}${env}`,
    );
  }
  const winners = results.filter((r) => r.errorClass === "OK_JSON" || r.errorClass === "ENVELOPE_ERROR");
  console.log();
  if (winners.length === 0) {
    console.log("  ⛔ Ninguna ruta tipo webhook responde con JSON. Holded NO expone API de webhooks por API Key.");
  } else {
    console.log(`  ⚠ ${winners.length} ruta(s) responden con JSON (válida o envelope):`);
    for (const w of winners) {
      console.log(`    → ${w.method} ${w.path} · ${w.errorClass}${w.envelopeInfo ? ` · "${w.envelopeInfo}"` : ""}`);
    }
  }
}

async function main(): Promise<void> {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });

  console.log("Spike 09 · Webhooks — sondeo de endpoints típicos");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}`);

  const results: ProbeResult[] = [];
  for (const target of TARGETS) {
    const r = await probe(env, target);
    results.push(r);
  }

  printTable(results);

  writeFileSync(
    resolve(fixturesDir, "09-summary.json"),
    JSON.stringify(results, null, 2),
  );
  console.log("\n  saved: 09-summary.json");
}

main().catch((err) => {
  console.error("\nSPIKE 09 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
