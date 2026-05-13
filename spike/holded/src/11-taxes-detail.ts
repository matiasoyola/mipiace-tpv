// Spike Fase 1 · Script 11 · estructura completa de /invoicing/v1/taxes
// y de Product.taxes[].
//
// Motivación: la validación de B6 destapó que el sync de B5 deja
// `tenant_taxes.rate = NULL` y todos los productos con
// `sellable_via_tpv = false` en esta cuenta. El root cause hipotético
// (a confirmar aquí) es que nuestro `HoldedTax` interface lee
// `t.id`/`t.rate` pero Holded en realidad expone `t.key` (alias slug
// que matchea Product.taxes[]) y `t.amount` (porcentaje como string).
// La cuenta original del spike §03.A tenía sólo IVAs estándar con
// `key: s_iva_21`, la actual mete taxes custom (`tax_49_sales`).
//
// Pregunta-spike:
//   1. ¿Qué campos completos devuelve `/invoicing/v1/taxes`?
//   2. ¿Cuál de esos campos matchea `Product.taxes[]`?
//   3. ¿Existe `GET /invoicing/v1/taxes/:id` (detalle individual)?
//   4. ¿Existe variante con más detalle (`?include=...`)?
//   5. ¿Qué shape tienen los taxes embebidos en `Product`?
//
// Salidas:
//   - fixtures/11-taxes-list.json     : respuesta cruda del listado.
//   - fixtures/11-taxes-<id>.json     : cada detalle individual (si existe).
//   - fixtures/11-products-sample.json: 5 productos con su `taxes[]`.
//   - fixtures/11-summary.json        : resumen de hallazgos.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HoldedEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

interface RawResponse {
  httpStatus: number;
  contentType: string | null;
  sizeBytes: number;
  isJson: boolean;
  parsed?: unknown;
  preview: string;
}

async function rawFetch(env: HoldedEnv, path: string): Promise<RawResponse> {
  const url = `${env.HOLDED_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { key: env.HOLDED_API_KEY, Accept: "application/json" },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  const contentType = res.headers.get("content-type");
  const isJsonByCt = (contentType ?? "").toLowerCase().includes("application/json");
  const isJsonByShape = text.length > 0 && (text.trimStart()[0] === "{" || text.trimStart()[0] === "[");
  let parsed: unknown;
  let isJson = false;
  if (isJsonByCt || isJsonByShape) {
    try {
      parsed = JSON.parse(text);
      isJson = true;
    } catch {
      isJson = false;
    }
  }
  return {
    httpStatus: res.status,
    contentType,
    sizeBytes: buf.length,
    isJson,
    parsed,
    preview: text.slice(0, 200).replace(/\s+/g, " "),
  };
}

interface Finding {
  // Lista de tax records descubiertos.
  taxCount: number;
  // Claves observadas en cada tax record (unión).
  taxFieldsObserved: string[];
  // Tipo de cada campo (primera observación).
  taxFieldTypes: Record<string, string>;
  // Candidatos para "alias que matchea Product.taxes[]".
  aliasCandidates: Array<{ field: string; sampleValues: string[] }>;
  // Candidatos para "porcentaje numérico".
  rateCandidates: Array<{ field: string; sampleValues: unknown[] }>;
  // ¿GET /invoicing/v1/taxes/:id existe? Para una muestra.
  detailEndpoint: {
    tried: string;
    httpStatus: number;
    contentType: string | null;
    sizeBytes: number;
    isJson: boolean;
    looksValid: boolean;
    notes: string;
  };
  // Productos: campo taxes[] cómo viene.
  productTaxesShape: {
    sampleSize: number;
    samples: Array<{ id: string; name: string; taxes: unknown }>;
    distinctValues: string[];
  };
  // Cross-match: ¿qué campo de tax matchea los valores de Product.taxes[]?
  matchingField: { field: string | null; matches: number; total: number };
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

async function main(): Promise<void> {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });

  console.log("Spike 11 · Taxes detail — investigación de mapping tax → rate");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  // ── 1. Listado completo ─────────────────────────────────────────────
  console.log("  GET /invoicing/v1/taxes");
  const list = await rawFetch(env, "/invoicing/v1/taxes");
  console.log(
    `    HTTP ${list.httpStatus} · ${list.contentType ?? "(no ct)"} · ${list.sizeBytes}B · isJson=${list.isJson}`,
  );
  if (!list.isJson || !Array.isArray(list.parsed)) {
    console.error("    ✗ respuesta no es array JSON; abortamos.");
    console.error(`    preview: ${list.preview}`);
    process.exit(2);
  }
  const taxes = list.parsed as Array<Record<string, unknown>>;
  writeFileSync(
    resolve(fixturesDir, "11-taxes-list.json"),
    JSON.stringify(taxes, null, 2),
  );
  console.log(`    saved: 11-taxes-list.json (${taxes.length} taxes)`);

  // Recolectar todos los campos vistos en taxes.
  const fieldsObserved = new Set<string>();
  const fieldTypes: Record<string, string> = {};
  for (const t of taxes) {
    for (const [k, v] of Object.entries(t)) {
      fieldsObserved.add(k);
      if (fieldTypes[k] === undefined) fieldTypes[k] = describeType(v);
    }
  }
  console.log(`    campos: ${[...fieldsObserved].join(", ")}`);

  // Candidatos para alias (campos string ≤ 32 chars con valores tipo slug).
  const aliasCandidates: Finding["aliasCandidates"] = [];
  for (const f of fieldsObserved) {
    const samples = taxes
      .map((t) => t[f])
      .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)
      .slice(0, 5);
    if (samples.length >= 1) {
      aliasCandidates.push({ field: f, sampleValues: samples });
    }
  }

  // Candidatos para rate (campos numéricos o strings que parsean a número).
  const rateCandidates: Finding["rateCandidates"] = [];
  for (const f of fieldsObserved) {
    const samples = taxes
      .map((t) => t[f])
      .filter((v) => {
        if (typeof v === "number" && Number.isFinite(v)) return true;
        if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return true;
        return false;
      })
      .slice(0, 5);
    if (samples.length >= 1) rateCandidates.push({ field: f, sampleValues: samples });
  }

  // ── 2. Detalle individual: ¿existe GET /invoicing/v1/taxes/:id? ─────
  const firstWithId = taxes.find((t) => typeof t.id === "string" && (t.id as string).length > 0);
  let detailEndpoint: Finding["detailEndpoint"] = {
    tried: "",
    httpStatus: 0,
    contentType: null,
    sizeBytes: 0,
    isJson: false,
    looksValid: false,
    notes: "ningún tax tiene id no vacío, no probado",
  };
  if (firstWithId) {
    const id = firstWithId.id as string;
    const detailPath = `/invoicing/v1/taxes/${id}`;
    console.log(`\n  GET ${detailPath}`);
    const detail = await rawFetch(env, detailPath);
    console.log(
      `    HTTP ${detail.httpStatus} · ${detail.contentType ?? "(no ct)"} · ${detail.sizeBytes}B · isJson=${detail.isJson}`,
    );
    const looksValid =
      detail.httpStatus === 200 && detail.isJson && !Array.isArray(detail.parsed);
    detailEndpoint = {
      tried: detailPath,
      httpStatus: detail.httpStatus,
      contentType: detail.contentType,
      sizeBytes: detail.sizeBytes,
      isJson: detail.isJson,
      looksValid,
      notes: looksValid
        ? "endpoint detalle parece existir"
        : detail.httpStatus === 200 && !detail.isJson
          ? "200+HTML → endpoint inexistente (caso §01.B)"
          : `HTTP ${detail.httpStatus} sin JSON útil`,
    };
    writeFileSync(
      resolve(fixturesDir, `11-taxes-${id}.json`),
      detail.isJson
        ? JSON.stringify(detail.parsed, null, 2)
        : JSON.stringify(
            { note: "no-json", httpStatus: detail.httpStatus, preview: detail.preview },
            null,
            2,
          ),
    );
    console.log(`    saved: 11-taxes-${id}.json (${detail.isJson ? "JSON" : "no-json"})`);
  }

  // Probar también un par de variantes habituales de "include detail".
  for (const probe of ["/invoicing/v1/taxes?include=details", "/invoicing/v1/taxes?expand=items"]) {
    console.log(`\n  GET ${probe}`);
    const r = await rawFetch(env, probe);
    console.log(
      `    HTTP ${r.httpStatus} · ${r.contentType ?? "(no ct)"} · ${r.sizeBytes}B · isJson=${r.isJson}`,
    );
    if (r.isJson && Array.isArray(r.parsed)) {
      const first = (r.parsed as Array<Record<string, unknown>>)[0];
      console.log(`    primer registro fields: ${first ? Object.keys(first).join(", ") : "(vacío)"}`);
    }
  }

  // ── 3. Productos: muestra con taxes[] ───────────────────────────────
  console.log("\n  GET /invoicing/v1/products?page=1 (primera página)");
  const products = await rawFetch(env, "/invoicing/v1/products?page=1");
  const productTaxesShape: Finding["productTaxesShape"] = {
    sampleSize: 0,
    samples: [],
    distinctValues: [],
  };
  if (products.isJson && Array.isArray(products.parsed)) {
    const arr = products.parsed as Array<Record<string, unknown>>;
    productTaxesShape.sampleSize = arr.length;
    const distinctSet = new Set<string>();
    for (const p of arr) {
      if (Array.isArray(p.taxes)) {
        for (const t of p.taxes as unknown[]) {
          if (typeof t === "string") distinctSet.add(t);
        }
      }
      if (productTaxesShape.samples.length < 8) {
        productTaxesShape.samples.push({
          id: String(p.id ?? "?"),
          name: String(p.name ?? "?"),
          taxes: p.taxes,
        });
      }
    }
    productTaxesShape.distinctValues = [...distinctSet].sort();
    console.log(
      `    productos en página: ${arr.length} · taxes distintos: ${productTaxesShape.distinctValues.join(", ") || "(ninguno)"}`,
    );
    writeFileSync(
      resolve(fixturesDir, "11-products-sample.json"),
      JSON.stringify({ samples: productTaxesShape.samples }, null, 2),
    );
  } else {
    console.error("    ✗ respuesta de products no es array JSON; saltamos cross-match.");
  }

  // ── 4. Cross-match: ¿qué campo de tax matchea Product.taxes[]? ──────
  let matchingField: Finding["matchingField"] = { field: null, matches: 0, total: 0 };
  if (productTaxesShape.distinctValues.length > 0) {
    const distinct = new Set(productTaxesShape.distinctValues);
    let best: { field: string; matches: number } | null = null;
    for (const f of fieldsObserved) {
      let matches = 0;
      for (const t of taxes) {
        const v = t[f];
        if (typeof v === "string" && v.length > 0 && distinct.has(v)) matches += 1;
      }
      if (best === null || matches > best.matches) best = { field: f, matches };
    }
    matchingField = best
      ? { field: best.field, matches: best.matches, total: distinct.size }
      : { field: null, matches: 0, total: distinct.size };
    console.log(
      `\n  Cross-match Product.taxes[] vs tax fields: mejor candidato = ${matchingField.field ?? "(ninguno)"} (${matchingField.matches}/${matchingField.total})`,
    );
  }

  // ── 5. Summary ───────────────────────────────────────────────────────
  const summary: Finding = {
    taxCount: taxes.length,
    taxFieldsObserved: [...fieldsObserved].sort(),
    taxFieldTypes: fieldTypes,
    aliasCandidates,
    rateCandidates,
    detailEndpoint,
    productTaxesShape,
    matchingField,
  };
  writeFileSync(
    resolve(fixturesDir, "11-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log("  Resumen final");
  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`  taxes en cuenta: ${summary.taxCount}`);
  console.log(`  campos: ${summary.taxFieldsObserved.join(", ")}`);
  console.log(`  campo que matchea Product.taxes[]: ${summary.matchingField.field ?? "(ninguno)"}`);
  console.log(`  campo numérico/rate: ${summary.rateCandidates.map((c) => c.field).join(", ")}`);
  console.log(`  endpoint detalle: ${summary.detailEndpoint.notes}`);
  console.log("\n  saved: 11-summary.json");
}

main().catch((err) => {
  console.error("\nSPIKE 11 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
