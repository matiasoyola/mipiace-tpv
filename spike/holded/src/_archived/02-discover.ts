// Spike Fase 0 · Script 02.
//
// Objetivo:
//   1. Encontrar el endpoint REAL para listar almacenes. El path que
//      asumía la spec (/invoicing/v1/warehouse) responde 200 + HTML.
//   2. Descubrir cómo se pagina /invoicing/v1/products. El script 01
//      vio 500 ítems sin paginar → posible default implícito.
//
// No crea nada en Holded. Sólo lectura.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
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

type ProbeResult =
  | { kind: "ok"; data: unknown; firstId: string | null; length: number }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "non-json"; status: number; contentType: string | null; preview: string }
  | { kind: "error"; message: string };

async function probe(holded: ApiKeyClient, path: string): Promise<ProbeResult> {
  try {
    const data = await holded.request<unknown>(path);
    let firstId: string | null = null;
    let length = -1;
    if (Array.isArray(data)) {
      length = data.length;
      const first = data[0];
      if (first && typeof first === "object" && "id" in first) {
        firstId = (first as { id?: string }).id ?? null;
      }
    }
    return { kind: "ok", data, firstId, length };
  } catch (err) {
    if (err instanceof HoldedApiError) {
      return { kind: "http", status: err.status, body: err.body };
    }
    if (err instanceof HoldedInvalidResponseError) {
      return {
        kind: "non-json",
        status: err.status,
        contentType: err.contentType,
        preview: err.bodyPreview.replace(/\s+/g, " ").slice(0, 80),
      };
    }
    return { kind: "error", message: (err as Error).message };
  }
}

function fmt(r: ProbeResult): string {
  switch (r.kind) {
    case "ok":
      if (r.length >= 0) return `OK · array(${r.length}) firstId=${r.firstId ?? "?"}`;
      return `OK · ${typeof r.data}`;
    case "http":
      return `HTTP ${r.status} · ${JSON.stringify(r.body).slice(0, 100)}`;
    case "non-json":
      return `non-JSON · status=${r.status} ct=${r.contentType ?? "-"} body="${r.preview}…"`;
    case "error":
      return `ERR · ${r.message}`;
  }
}

async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, env.HOLDED_BASE_URL);

  console.log("Spike 02 · Endpoint de almacenes + paginación de /products");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  // ── Almacenes ───────────────────────────────────────────────────────
  console.log("## Almacenes — candidatos");
  const warehouseCandidates = [
    "/invoicing/v1/warehouses",
    "/invoicing/v1/warehouse",
    "/inventory/v1/warehouses",
    "/inventory/v1/warehouse",
    "/invoicing/v1/storages",
    "/invoicing/v1/storage",
    "/products/v1/warehouses",
  ];
  let winner: { path: string; data: unknown } | null = null;
  for (const path of warehouseCandidates) {
    const r = await probe(holded, path);
    console.log(`  ${path.padEnd(38)} → ${fmt(r)}`);
    if (r.kind === "ok" && !winner) winner = { path, data: r.data };
  }
  if (winner) {
    writeFileSync(
      resolve(fixturesDir, "02-warehouses.json"),
      JSON.stringify(winner.data, null, 2),
    );
    console.log(`\n  ✓ winner: ${winner.path}`);
    console.log(`  ✓ saved : 02-warehouses.json`);
  } else {
    console.log("\n  ✗ ningún candidato devolvió JSON 2xx");
  }

  // ── Paginación productos ────────────────────────────────────────────
  console.log("\n## Paginación de /invoicing/v1/products");
  const base = "/invoicing/v1/products";
  const queries = [
    "",
    "?page=1",
    "?page=2",
    "?page=3",
    "?per_page=10",
    "?perPage=10",
    "?limit=10",
    "?page=1&perPage=10",
  ];

  type PageSig = { qs: string; firstId: string | null; length: number };
  const sigs: PageSig[] = [];

  for (const qs of queries) {
    const r = await probe(holded, `${base}${qs}`);
    if (r.kind === "ok") {
      sigs.push({ qs: qs || "(none)", firstId: r.firstId, length: r.length });
    }
    console.log(`  ${(qs || "(none)").padEnd(24)} → ${fmt(r)}`);
  }

  // Guardar page=2 para comparar contenidos con 01-products.json (page=1).
  const page2 = await probe(holded, `${base}?page=2`);
  if (page2.kind === "ok") {
    writeFileSync(
      resolve(fixturesDir, "02-products-page2.json"),
      JSON.stringify(page2.data, null, 2),
    );
  }

  console.log("\n## Análisis de paginación");
  const baseSig = sigs.find((s) => s.qs === "(none)") ?? sigs[0];
  if (baseSig) {
    console.log(`  baseline (sin query): firstId=${baseSig.firstId} len=${baseSig.length}`);
    for (const s of sigs) {
      if (s === baseSig) continue;
      const samePage = s.firstId === baseSig.firstId;
      const sameLen = s.length === baseSig.length;
      const verdict = samePage
        ? "MISMA página que baseline"
        : "página DISTINTA (avanzó)";
      const lenNote = sameLen ? "mismo tamaño" : `len=${s.length}`;
      console.log(`  ${s.qs.padEnd(24)} → ${verdict} · ${lenNote}`);
    }
  }

  console.log("\nFin.");
}

main().catch((err) => {
  console.error("\nSPIKE 02 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
