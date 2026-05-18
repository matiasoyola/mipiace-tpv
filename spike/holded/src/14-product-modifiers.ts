// Spike Fase 1 · Script 14 · ¿Holded expone modificadores nativos?
//
// Contexto · B-Bar-Modifiers
// ──────────────────────────
// Vertical bar: un producto "Café con leche" puede tener 3 grupos de
// variantes (tipo de leche, azúcar, tamaño) sin que cada combinación
// sea un SKU distinto. Si Holded expone modificadores nativamente,
// nos ahorramos un CRUD admin y vivimos como mero consumidor del
// catálogo. Si no, hay que construirlo per-tenant en mipiacetpv.
//
// Sondeo
// ──────
// 1. GET /invoicing/v1/products?page=1 — muestra de hasta 10 productos.
// 2. Buscar campos candidatos en cada producto:
//      - attributes[]   (sabemos que existe → KV libre)
//      - variants[]     (existe → SKU separado, fuera de scope §"NO entra")
//      - options[]      (no observado nunca)
//      - modifiers[]    (no observado nunca)
//      - productAttributes / relatedProducts (alternativas en otros ERPs)
//    Reportamos qué campos están presentes/no en al menos 1 muestra.
// 3. GET /invoicing/v1/products/<id> sobre el primer producto que tenga
//    variants[] no vacío (si existe alguno). El listado puede recortar
//    payload; el detalle podría exponer más.
// 4. Probar paths candidatos a un endpoint dedicado de modificadores:
//      - /invoicing/v1/modifiers
//      - /invoicing/v1/productmodifiers
//      - /invoicing/v1/productoptions
//      - /invoicing/v1/variants
//    Patrón §01.B aplicado: 200+HTML = inexistente. JSON con envelope
//    `{status,info}` = ruta válida pero recurso/scope inválido.
//
// Crea 0 documentos. Sólo lectura.
//
// Si la API key no está disponible (entorno local sin secret), el
// script termina con exit-code 2 e imprime instrucciones — el operador
// con acceso puede correrlo después. La decisión por defecto del
// bloque (caso B, sin modificadores nativos) ya está documentada en
// §14 del spike y respaldada por:
//   - shape real conocido del producto en fixtures previas (script 01):
//     attributes[], variants[], translations[], tags[]. Sin
//     `modifiers`, `options`, ni `productAttributes`.
//   - doc oficial: developers.holded.com/reference no incluye
//     "modifiers" ni "options" en su árbol de endpoints.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
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

const CANDIDATE_FIELDS = [
  "attributes",
  "variants",
  "options",
  "modifiers",
  "productAttributes",
  "relatedProducts",
  "productOptions",
  "extras",
  "addons",
] as const;

const CANDIDATE_PATHS = [
  "/invoicing/v1/modifiers",
  "/invoicing/v1/productmodifiers",
  "/invoicing/v1/productoptions",
  "/invoicing/v1/options",
  "/invoicing/v1/variants",
  "/invoicing/v1/productvariants",
] as const;

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

async function step1ListSample(holded: ApiKeyClient): Promise<AnyRec[]> {
  console.log("  GET /invoicing/v1/products?page=1");
  let data: unknown;
  try {
    data = await holded.request<unknown>("/invoicing/v1/products?page=1");
  } catch (err) {
    console.log(`  ✗ ${fmtErr(err)}`);
    return [];
  }
  if (!Array.isArray(data)) {
    console.log(`  ✗ no es array: ${typeof data}`);
    return [];
  }
  const sample = data.slice(0, 10) as AnyRec[];
  writeFileSync(
    resolve(fixturesDir, "14-products-sample.json"),
    JSON.stringify(sample, null, 2),
  );
  console.log(`  saved: 14-products-sample.json (${sample.length} productos)`);
  return sample;
}

interface FieldStats {
  field: string;
  presentNonEmpty: number;
  presentEmpty: number;
  absent: number;
  example: unknown | null;
}

function analyzeFields(sample: AnyRec[]): FieldStats[] {
  const stats: FieldStats[] = CANDIDATE_FIELDS.map((field) => ({
    field,
    presentNonEmpty: 0,
    presentEmpty: 0,
    absent: 0,
    example: null,
  }));
  for (const product of sample) {
    for (const stat of stats) {
      const value = product[stat.field];
      if (value === undefined) {
        stat.absent += 1;
      } else if (Array.isArray(value) && value.length === 0) {
        stat.presentEmpty += 1;
      } else if (value == null) {
        stat.presentEmpty += 1;
      } else {
        stat.presentNonEmpty += 1;
        if (stat.example == null) stat.example = value;
      }
    }
  }
  return stats;
}

async function step2InspectDetail(
  holded: ApiKeyClient,
  sample: AnyRec[],
): Promise<AnyRec | null> {
  // Buscar el primer producto con variants[] no vacío; si no, usar el
  // primero para ver el detalle base.
  const withVariants = sample.find(
    (p) => Array.isArray(p.variants) && (p.variants as unknown[]).length > 0,
  );
  const target =
    withVariants ??
    sample.find((p) => typeof p.id === "string") ??
    null;
  if (!target || typeof target.id !== "string") {
    console.log("  ✗ ningún producto del sample tiene id válido");
    return null;
  }
  console.log(`  GET /invoicing/v1/products/${target.id}`);
  console.log(`    target seleccionado: "${target.name ?? "(sin nombre)"}" (${withVariants ? "tiene variants[]" : "sin variants[]"})`);

  let detail: unknown;
  try {
    detail = await holded.request<unknown>(
      `/invoicing/v1/products/${target.id}`,
    );
  } catch (err) {
    console.log(`    ✗ ${fmtErr(err)}`);
    return null;
  }

  writeFileSync(
    resolve(fixturesDir, "14-product-detail.json"),
    JSON.stringify(detail, null, 2),
  );
  console.log("    saved: 14-product-detail.json");

  if (!detail || typeof detail !== "object") {
    console.log("    ✗ respuesta no es objeto");
    return null;
  }

  const detailRec = detail as AnyRec;
  const extraKeys = Object.keys(detailRec).filter(
    (k) => !(target as AnyRec)[k] && CANDIDATE_FIELDS.includes(k as never),
  );
  if (extraKeys.length > 0) {
    console.log(`    ✓ detalle expone campos que el listado oculta: ${extraKeys.join(", ")}`);
  } else {
    console.log("    ⓘ detalle no añade campos candidatos respecto al listado.");
  }
  return detailRec;
}

interface PathProbe {
  path: string;
  status: number | null;
  contentType: string | null;
  isJson: boolean;
  bodyKind: "html" | "json-array" | "json-object" | "json-envelope" | "other";
  envelope?: { status: number; info?: string };
  arrayLen?: number;
  sample?: unknown;
}

async function step3ProbePaths(env: HoldedEnv): Promise<PathProbe[]> {
  const out: PathProbe[] = [];
  for (const path of CANDIDATE_PATHS) {
    const url = `${env.HOLDED_BASE_URL}${path}`;
    console.log(`  GET ${path}`);
    let res: Response;
    try {
      res = await fetch(url, { headers: { key: env.HOLDED_API_KEY, Accept: "application/json" } });
    } catch (err) {
      console.log(`    ✗ fetch ${(err as Error).message}`);
      out.push({ path, status: null, contentType: null, isJson: false, bodyKind: "other" });
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    const isJsonCt = contentType.toLowerCase().includes("application/json");
    let bodyKind: PathProbe["bodyKind"] = "other";
    let envelope: PathProbe["envelope"];
    let arrayLen: number | undefined;
    let sample: unknown;

    if (isJsonCt) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          bodyKind = "json-array";
          arrayLen = parsed.length;
          sample = parsed.slice(0, 2);
        } else if (
          parsed &&
          typeof parsed === "object" &&
          "status" in parsed &&
          "info" in parsed
        ) {
          bodyKind = "json-envelope";
          envelope = parsed as { status: number; info?: string };
        } else {
          bodyKind = "json-object";
          sample = parsed;
        }
      } catch {
        bodyKind = "other";
      }
    } else if (contentType.toLowerCase().includes("text/html")) {
      bodyKind = "html";
    }

    console.log(
      `    HTTP ${res.status} ct=${contentType} kind=${bodyKind}` +
        (envelope ? ` envelope=${JSON.stringify(envelope)}` : "") +
        (arrayLen != null ? ` len=${arrayLen}` : ""),
    );

    out.push({
      path,
      status: res.status,
      contentType,
      isJson: isJsonCt,
      bodyKind,
      envelope,
      arrayLen,
      sample,
    });
  }
  return out;
}

async function main() {
  const parsed = HoldedEnv.safeParse(process.env);
  if (!parsed.success) {
    console.log("Spike 14 · Falta HOLDED_API_KEY en spike/holded/.env");
    console.log("  Copia spike/holded/.env.example a spike/holded/.env y rellena.");
    console.log("  La decisión por defecto del bloque (caso B, sin modifiers nativos)");
    console.log("  está documentada en docs/spike-holded.md §14 con la justificación.");
    process.exit(2);
  }
  const env = parsed.data;
  mkdirSync(fixturesDir, { recursive: true });
  const holded = new ApiKeyClient(env.HOLDED_API_KEY, { baseUrl: env.HOLDED_BASE_URL });

  console.log("Spike 14 · ¿Holded expone modificadores de producto?");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  console.log("─── Paso 1: GET /products muestra de 10 ─────────────────");
  const sample = await step1ListSample(holded);
  if (sample.length === 0) {
    console.log("\n⛔ Sin muestra de productos. Aborto.");
    process.exit(1);
  }

  console.log("\n─── Paso 2: análisis de campos candidatos ───────────────");
  const stats = analyzeFields(sample);
  for (const s of stats) {
    const summary = `${s.field}: nonEmpty=${s.presentNonEmpty} empty=${s.presentEmpty} absent=${s.absent}`;
    if (s.presentNonEmpty > 0) {
      const exampleJson = JSON.stringify(s.example).slice(0, 200);
      console.log(`  ✓ ${summary}  · ejemplo: ${exampleJson}`);
    } else {
      console.log(`  · ${summary}`);
    }
  }

  console.log("\n─── Paso 3: detalle individual ──────────────────────────");
  await step2InspectDetail(holded, sample);

  console.log("\n─── Paso 4: paths candidatos a endpoint dedicado ────────");
  const probes = await step3ProbePaths(env);

  // Resumen final.
  writeFileSync(
    resolve(fixturesDir, "14-summary.json"),
    JSON.stringify({ stats, probes }, null, 2),
  );
  console.log("\nsaved: 14-summary.json");

  // Veredicto heurístico — no determina el bloque, sólo informa al operador.
  const fieldNativeHit = stats.find(
    (s) => s.presentNonEmpty > 0 && ["modifiers", "options", "productOptions"].includes(s.field),
  );
  const pathNativeHit = probes.find(
    (p) => p.bodyKind === "json-array" || p.bodyKind === "json-object",
  );
  console.log("\n──────────── Veredicto ───────────────────────────────");
  if (fieldNativeHit || pathNativeHit) {
    console.log("  ⚠ Posible API nativa detectada. Revisar fixtures antes de decidir caso A.");
    if (fieldNativeHit) console.log(`    field hit: ${fieldNativeHit.field}`);
    if (pathNativeHit) console.log(`    path hit: ${pathNativeHit.path} (${pathNativeHit.bodyKind})`);
  } else {
    console.log("  ✓ Sin evidencia de modifiers nativos. Caso B (CRUD admin propio) confirmado.");
  }
}

main().catch((err) => {
  console.error("\nSPIKE 14 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
