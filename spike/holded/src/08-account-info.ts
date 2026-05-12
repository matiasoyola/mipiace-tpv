// Spike Fase 1 · Script 08 · sondeo de endpoints de "account info".
//
// Pregunta: ¿qué endpoint de Holded expone los datos fiscales de la
// cuenta del propietario (NIF + razón social + dirección)?
//
// Hipótesis a probar (en orden de la doc B2 §1):
//   1. GET /invoicing/v1/me
//   2. GET /invoicing/v1/account
//   3. GET /invoicing/v1/company
//   4. GET /invoicing/v1/users/me
//
// Algún endpoint puede devolver 200 + HTML (caso 01.B del spike), por lo
// que NO usamos ApiKeyClient — abriría con InvalidResponseError antes de
// poder inspeccionar. Hacemos fetch crudo y registramos status,
// content-type, tamaño, preview y, si es JSON, qué campos fiscales
// reconocemos.
//
// Salidas:
//   - fixtures/08-<slug>.json : cuerpo crudo (o preview en HTML)
//   - fixtures/08-summary.json: resumen estructurado de los 4 sondeos.
//   - stdout: tabla legible para pegar en docs/spike-holded.md §08.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HoldedEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

interface ProbeResult {
  path: string;
  slug: string;
  httpStatus: number;
  contentType: string | null;
  sizeBytes: number;
  isJson: boolean;
  bodyPreview: string; // primeros 200 caracteres legibles
  // Sólo cuando isJson === true.
  parsed?: unknown;
  fiscalFieldsFound?: FiscalFields;
  // Para casos JSON con envelope {status:0,info:"..."}, status del envelope.
  envelopeStatus?: number;
  envelopeInfo?: string;
  errorClass: "OK_JSON" | "OK_HTML_404" | "ENVELOPE_ERROR" | "HTTP_ERROR" | "UNKNOWN";
}

interface FiscalFields {
  // Identificación fiscal:
  nif: string | null;
  razonSocial: string | null;
  // Dirección:
  address: string | null;
  city: string | null;
  postalCode: string | null;
  province: string | null;
  country: string | null;
  countryCode: string | null;
  // Email y teléfono también nos servirían en el ticket si existen.
  email: string | null;
  phone: string | null;
  // Mapa de claves → path donde se encontró, para trazabilidad.
  foundAt: Record<string, string>;
}

const TARGETS: Array<{ path: string; slug: string }> = [
  // Hipótesis principales del prompt B2 §1.
  { path: "/invoicing/v1/me", slug: "me" },
  { path: "/invoicing/v1/account", slug: "account" },
  { path: "/invoicing/v1/company", slug: "company" },
  { path: "/invoicing/v1/users/me", slug: "users-me" },
  // Candidatos adicionales: nombres típicos en ERPs y formatos vistos en
  // otros endpoints de Holded.
  { path: "/invoicing/v1/users", slug: "users" },
  { path: "/invoicing/v1/profile", slug: "profile" },
  { path: "/invoicing/v1/businessinfo", slug: "businessinfo" },
  { path: "/invoicing/v1/myaccount", slug: "myaccount" },
  { path: "/invoicing/v1/contacts/me", slug: "contacts-me" },
  { path: "/users/v1/me", slug: "users-v1-me" },
  { path: "/account/v1/me", slug: "account-v1-me" },
  { path: "/v1/me", slug: "v1-me" },
];

// Heurística de campos fiscales: nombres de campos típicos que Holded
// (o cualquier ERP español) suele usar para cada concepto. Buscamos
// case-insensitive y aceptamos el primer match.
const FIELD_ALIASES: Record<keyof Omit<FiscalFields, "foundAt">, string[]> = {
  nif: ["nif", "vatnumber", "vat", "taxid", "cif", "documentnumber"],
  razonSocial: ["companyname", "businessname", "name", "razonsocial", "legalname", "tradename"],
  address: ["address", "streetaddress", "street"],
  city: ["city", "town", "locality"],
  postalCode: ["postalcode", "zipcode", "zip", "postcode", "cp"],
  province: ["province", "state", "region"],
  country: ["country", "countryname"],
  countryCode: ["countrycode", "isocountry", "iso2"],
  email: ["email", "mail", "contactemail"],
  phone: ["phone", "telephone", "tel", "mobile"],
};

function findFiscalFields(parsed: unknown): FiscalFields {
  const result: FiscalFields = {
    nif: null,
    razonSocial: null,
    address: null,
    city: null,
    postalCode: null,
    province: null,
    country: null,
    countryCode: null,
    email: null,
    phone: null,
    foundAt: {},
  };

  // BFS sobre el JSON. Para cada clave: lowercase + sin guiones bajos
  // y matchear contra cada alias.
  type Node = { value: unknown; path: string };
  const queue: Node[] = [{ value: parsed, path: "$" }];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const { value, path } = node;
    if (value == null) continue;
    if (typeof value !== "object") continue;
    if (Array.isArray(value)) {
      value.forEach((v, i) => queue.push({ value: v, path: `${path}[${i}]` }));
      continue;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      const norm = key.toLowerCase().replace(/[_-]/g, "");
      if (typeof child === "string" && child.length > 0) {
        for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<
          [keyof Omit<FiscalFields, "foundAt">, string[]]
        >) {
          if (result[field] != null) continue;
          if (aliases.includes(norm)) {
            result[field] = child;
            result.foundAt[field] = childPath;
            break;
          }
        }
      }
      if (typeof child === "object" && child !== null) {
        queue.push({ value: child, path: childPath });
      }
    }
  }
  return result;
}

function summarizeFiscal(f: FiscalFields | undefined): string {
  if (!f) return "(no JSON)";
  const filled = Object.entries(f)
    .filter(([k, v]) => k !== "foundAt" && v != null && v !== "")
    .map(([k]) => k);
  if (filled.length === 0) return "ningún campo fiscal reconocido";
  return `${filled.length}/10 campos: ${filled.join(", ")}`;
}

async function probe(env: HoldedEnv, target: { path: string; slug: string }): Promise<ProbeResult> {
  const url = `${env.HOLDED_BASE_URL}${target.path}`;
  console.log(`\n  GET ${target.path}`);

  let res: Response;
  let buf: Buffer;
  try {
    res = await fetch(url, {
      headers: { key: env.HOLDED_API_KEY, Accept: "application/json" },
    });
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`    ✗ fetch error: ${errMsg}`);
    return {
      path: target.path,
      slug: target.slug,
      httpStatus: 0,
      contentType: null,
      sizeBytes: 0,
      isJson: false,
      bodyPreview: `fetch error: ${errMsg}`,
      errorClass: "UNKNOWN",
    };
  }

  const contentType = res.headers.get("content-type");
  const sizeBytes = buf.length;
  const bodyText = buf.toString("utf8");
  const bodyPreview = bodyText.slice(0, 200).replace(/\s+/g, " ");
  console.log(`    HTTP ${res.status} · content-type=${contentType ?? "(none)"} · size=${sizeBytes}B`);
  console.log(`    preview: ${bodyPreview.slice(0, 160)}${bodyPreview.length > 160 ? "…" : ""}`);

  // ¿Es JSON?
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

  // Detectar envelope error {status:0, info:"..."}
  let envelopeStatus: number | undefined;
  let envelopeInfo: string | undefined;
  if (isJson && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.status === "number" && typeof obj.info === "string" && obj.status === 0) {
      envelopeStatus = obj.status;
      envelopeInfo = obj.info;
    }
  }

  let errorClass: ProbeResult["errorClass"] = "UNKNOWN";
  if (res.status === 200 && isJson && envelopeInfo == null) errorClass = "OK_JSON";
  else if (res.status === 200 && !isJson && (contentType ?? "").includes("text/html"))
    errorClass = "OK_HTML_404";
  else if (envelopeInfo != null) errorClass = "ENVELOPE_ERROR";
  else if (res.status >= 400) errorClass = "HTTP_ERROR";

  let fiscalFieldsFound: FiscalFields | undefined;
  if (isJson && errorClass === "OK_JSON") {
    fiscalFieldsFound = findFiscalFields(parsed);
    console.log(`    fiscal: ${summarizeFiscal(fiscalFieldsFound)}`);
  }

  // Guardar respuesta.
  const dumpPath = resolve(fixturesDir, `08-${target.slug}.json`);
  if (isJson) {
    writeFileSync(dumpPath, JSON.stringify(parsed, null, 2));
  } else {
    // Para HTML, sólo preview (no merece guardar la SPA completa).
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          note: "no-json response",
          httpStatus: res.status,
          contentType,
          sizeBytes,
          preview: bodyText.slice(0, 500),
        },
        null,
        2,
      ),
    );
  }
  console.log(`    saved: 08-${target.slug}.json (${isJson ? "JSON" : "preview HTML"})`);

  return {
    path: target.path,
    slug: target.slug,
    httpStatus: res.status,
    contentType,
    sizeBytes,
    isJson,
    bodyPreview,
    parsed: isJson ? parsed : undefined,
    fiscalFieldsFound,
    envelopeStatus,
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
    const fiscal = r.isJson ? summarizeFiscal(r.fiscalFieldsFound) : "—";
    console.log(`  ${r.path.padEnd(28)} · HTTP ${r.httpStatus} · ${tag} · ${fiscal}`);
  }

  const winners = results.filter(
    (r) =>
      r.errorClass === "OK_JSON" &&
      r.fiscalFieldsFound != null &&
      (r.fiscalFieldsFound.nif != null || r.fiscalFieldsFound.razonSocial != null),
  );
  console.log();
  if (winners.length === 0) {
    console.log(
      "  ⛔ Ningún endpoint expone NIF/razón social. Fallback: datos del almacén default + edición manual en admin.",
    );
  } else {
    console.log(`  ✓ ${winners.length} endpoint(s) con datos fiscales útiles:`);
    for (const w of winners) {
      console.log(`    → ${w.path}`);
      const f = w.fiscalFieldsFound!;
      console.log(`        nif=${f.nif ?? "—"} | razonSocial=${f.razonSocial ?? "—"}`);
      console.log(`        address=${f.address ?? "—"} | city=${f.city ?? "—"} | cp=${f.postalCode ?? "—"} | country=${f.country ?? "—"}`);
      console.log(`        foundAt=${JSON.stringify(f.foundAt)}`);
    }
  }
}

async function main(): Promise<void> {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });

  console.log("Spike 08 · Account info — sondeo de 4 endpoints");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}`);

  const results: ProbeResult[] = [];
  for (const target of TARGETS) {
    const r = await probe(env, target);
    results.push(r);
  }

  printTable(results);

  // Guardar resumen estructurado para que B2 lo procese si hace falta
  // (decisión de refactor de account.ts depende de esto).
  writeFileSync(
    resolve(fixturesDir, "08-summary.json"),
    JSON.stringify(
      results.map((r) => ({
        path: r.path,
        slug: r.slug,
        httpStatus: r.httpStatus,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        isJson: r.isJson,
        errorClass: r.errorClass,
        envelopeInfo: r.envelopeInfo,
        fiscalFieldsFound: r.fiscalFieldsFound
          ? { ...r.fiscalFieldsFound, foundAt: r.fiscalFieldsFound.foundAt }
          : null,
      })),
      null,
      2,
    ),
  );
  console.log("\n  saved: 08-summary.json");
}

main().catch((err) => {
  console.error("\nSPIKE 08 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
