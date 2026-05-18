// Spike Fase 1 · Script 13 · campo de imagen del producto en Holded.
//
// Motivación (B-ProductImages): el TPV de mipiacetpv pinta los tiles
// del catálogo con sólo nombre + precio. Visualmente plano y lento de
// identificar en bar/retail. Holded sí muestra imagen en su backoffice
// — la API tiene que exponer el campo de algún modo. Antes de tocar
// schema y worker, confirmamos:
//
//   1. ¿Qué campo del Producto contiene la URL/binario de la imagen?
//      Candidatos: `mainImage`, `image`, `thumbnail`, `pictures[]`,
//      `images[]`, `photo`, `mainImageUrl`.
//   2. Si es una URL, ¿responde sin auth o exige el header `key:`?
//   3. ¿Qué `Content-Type` devuelve (image/jpeg | image/png | image/webp)?
//   4. ¿Qué `Cache-Control` propone Holded? (de cara a cómo el worker
//      decide refresco — si Holded envía `max-age` razonable, podemos
//      respetar; si no, fijamos 30 días en Caddy).
//   5. ¿Hay endpoint dedicado `/products/<id>/image` que devuelva el
//      binario directamente, evitando el GET de URL externa?
//
// Salidas:
//   - fixtures/13-products-sample.json  : 5 productos completos con todos los campos.
//   - fixtures/13-image-headers.json    : HEAD/GET de la URL de imagen.
//   - fixtures/13-summary.json          : resumen de hallazgos para §13.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HoldedEnv } from "./env.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

// Campos donde Holded podría exponer una URL/binario de imagen. Si
// ninguno aparece en la respuesta real, el spike grita y B-ProductImages
// tendrá que negociar otro flujo (subir imágenes desde admin propio).
const IMAGE_CANDIDATE_FIELDS = [
  "mainImage",
  "mainImageUrl",
  "image",
  "imageUrl",
  "thumbnail",
  "thumbnailUrl",
  "photo",
  "photoUrl",
  "pictures",
  "images",
  "media",
] as const;

interface RawResponse {
  httpStatus: number;
  contentType: string | null;
  sizeBytes: number;
  isJson: boolean;
  parsed?: unknown;
  preview: string;
  cacheControl: string | null;
}

async function rawFetch(
  env: HoldedEnv,
  path: string,
  options: { withKey?: boolean; method?: "GET" | "HEAD" } = {},
): Promise<RawResponse> {
  const url = path.startsWith("http") ? path : `${env.HOLDED_BASE_URL}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.withKey !== false) headers.key = env.HOLDED_API_KEY;
  const res = await fetch(url, { headers, method: options.method ?? "GET" });
  const buf = options.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  const contentType = res.headers.get("content-type");
  const cacheControl = res.headers.get("cache-control");
  const isJsonByCt = (contentType ?? "").toLowerCase().includes("application/json");
  const isJsonByShape =
    text.length > 0 && (text.trimStart()[0] === "{" || text.trimStart()[0] === "[");
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
    sizeBytes: Number(res.headers.get("content-length") ?? buf.length),
    isJson,
    parsed,
    preview: text.slice(0, 200).replace(/\s+/g, " "),
    cacheControl,
  };
}

interface CandidateHit {
  field: string;
  type: "string" | "array" | "object" | "other";
  sample: unknown;
}

interface ImageProbe {
  url: string;
  withAuth: {
    httpStatus: number;
    contentType: string | null;
    cacheControl: string | null;
    sizeBytes: number;
  };
  withoutAuth: {
    httpStatus: number;
    contentType: string | null;
    cacheControl: string | null;
    sizeBytes: number;
  };
}

interface Finding {
  productsSampled: number;
  candidateFieldsObserved: CandidateHit[];
  productsWithAnyImage: number;
  // Campo elegido como canónico (primer hit consistente en la muestra).
  chosenField: string | null;
  chosenSampleValue: unknown;
  imageProbe: ImageProbe | null;
  dedicatedEndpoint: {
    tried: string;
    httpStatus: number;
    contentType: string | null;
    looksValid: boolean;
    notes: string;
  } | null;
  recommendation: string[];
}

function describeFieldValue(v: unknown): CandidateHit["type"] {
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "array";
  if (v !== null && typeof v === "object") return "object";
  return "other";
}

// Dado un valor de un candidato, extrae la primera URL string que
// encontremos: a veces los campos son arrays/objetos anidados.
function extractFirstUrl(v: unknown): string | null {
  if (typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"))) {
    return v;
  }
  if (Array.isArray(v)) {
    for (const it of v) {
      const u = extractFirstUrl(it);
      if (u) return u;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const val of Object.values(v as Record<string, unknown>)) {
      const u = extractFirstUrl(val);
      if (u) return u;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });

  console.log("Spike 13 · Product image — campo, auth, formato y cache");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}\n`);

  // ── 1. Listado de productos: muestra ────────────────────────────────
  console.log("  GET /invoicing/v1/products?page=1");
  const list = await rawFetch(env, "/invoicing/v1/products?page=1");
  console.log(
    `    HTTP ${list.httpStatus} · ${list.contentType ?? "(no ct)"} · ${list.sizeBytes}B · isJson=${list.isJson}`,
  );
  if (!list.isJson || !Array.isArray(list.parsed)) {
    console.error("    ✗ respuesta de productos no es array JSON; abortamos.");
    console.error(`    preview: ${list.preview}`);
    process.exit(2);
  }
  const products = list.parsed as Array<Record<string, unknown>>;
  const sample = products.slice(0, 8);
  writeFileSync(
    resolve(fixturesDir, "13-products-sample.json"),
    JSON.stringify(sample, null, 2),
  );
  console.log(`    saved: 13-products-sample.json (${sample.length} productos)`);

  // ── 2. Detectar candidatos en la muestra ────────────────────────────
  const candidateHits = new Map<string, CandidateHit>();
  let productsWithAnyImage = 0;
  for (const p of products) {
    let hadHit = false;
    for (const field of IMAGE_CANDIDATE_FIELDS) {
      const v = p[field];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        continue;
      }
      hadHit = true;
      if (!candidateHits.has(field)) {
        candidateHits.set(field, {
          field,
          type: describeFieldValue(v),
          sample: v,
        });
      }
    }
    if (hadHit) productsWithAnyImage += 1;
  }
  console.log(
    `    productos con algún campo de imagen: ${productsWithAnyImage}/${products.length}`,
  );
  for (const c of candidateHits.values()) {
    const preview =
      typeof c.sample === "string"
        ? c.sample.slice(0, 80)
        : JSON.stringify(c.sample).slice(0, 80);
    console.log(`    candidato: ${c.field} (${c.type}) → ${preview}`);
  }

  // ── 3. Detalle individual del primer producto con imagen ────────────
  let chosenField: string | null = null;
  let chosenSampleValue: unknown = null;
  let imageUrl: string | null = null;
  for (const field of IMAGE_CANDIDATE_FIELDS) {
    const hit = candidateHits.get(field);
    if (!hit) continue;
    const url = extractFirstUrl(hit.sample);
    if (url) {
      chosenField = field;
      chosenSampleValue = hit.sample;
      imageUrl = url;
      break;
    }
  }
  if (chosenField === null && candidateHits.size > 0) {
    // Hay candidato pero no URL extraíble en el listado. Probemos
    // detalle individual: a veces el listado omite la URL y el detalle
    // la trae completa.
    const firstWithId = products.find(
      (p) => typeof p.id === "string" && (p.id as string).length > 0,
    );
    if (firstWithId) {
      const id = firstWithId.id as string;
      console.log(`\n  GET /invoicing/v1/products/${id} (detalle)`);
      const detail = await rawFetch(env, `/invoicing/v1/products/${id}`);
      console.log(
        `    HTTP ${detail.httpStatus} · ${detail.contentType ?? "(no ct)"} · ${detail.sizeBytes}B`,
      );
      if (detail.isJson && detail.parsed && typeof detail.parsed === "object") {
        const d = detail.parsed as Record<string, unknown>;
        for (const field of IMAGE_CANDIDATE_FIELDS) {
          const v = d[field];
          if (v === undefined || v === null || v === "") continue;
          const url = extractFirstUrl(v);
          if (url) {
            chosenField = field;
            chosenSampleValue = v;
            imageUrl = url;
            break;
          }
        }
      }
    }
  }

  if (chosenField) {
    console.log(`\n    campo canónico de imagen: ${chosenField}`);
    console.log(`    URL muestra: ${imageUrl}`);
  } else {
    console.log("\n    ✗ ningún campo de la muestra contiene URL extraíble.");
  }

  // ── 4. Sondear la URL: con y sin auth ───────────────────────────────
  let imageProbe: ImageProbe | null = null;
  if (imageUrl) {
    console.log(`\n  GET ${imageUrl} (con header key)`);
    const withAuth = await rawFetch(env, imageUrl, { withKey: true });
    console.log(
      `    HTTP ${withAuth.httpStatus} · ${withAuth.contentType ?? "(no ct)"} · ${withAuth.sizeBytes}B · cc=${withAuth.cacheControl ?? "(no)"}`,
    );
    console.log(`  GET ${imageUrl} (SIN auth)`);
    const withoutAuth = await rawFetch(env, imageUrl, { withKey: false });
    console.log(
      `    HTTP ${withoutAuth.httpStatus} · ${withoutAuth.contentType ?? "(no ct)"} · ${withoutAuth.sizeBytes}B · cc=${withoutAuth.cacheControl ?? "(no)"}`,
    );
    imageProbe = {
      url: imageUrl,
      withAuth: {
        httpStatus: withAuth.httpStatus,
        contentType: withAuth.contentType,
        cacheControl: withAuth.cacheControl,
        sizeBytes: withAuth.sizeBytes,
      },
      withoutAuth: {
        httpStatus: withoutAuth.httpStatus,
        contentType: withoutAuth.contentType,
        cacheControl: withoutAuth.cacheControl,
        sizeBytes: withoutAuth.sizeBytes,
      },
    };
    writeFileSync(
      resolve(fixturesDir, "13-image-headers.json"),
      JSON.stringify(imageProbe, null, 2),
    );
  }

  // ── 5. ¿Existe endpoint dedicado /products/<id>/image? ──────────────
  let dedicatedEndpoint: Finding["dedicatedEndpoint"] = null;
  const firstWithId = products.find(
    (p) => typeof p.id === "string" && (p.id as string).length > 0,
  );
  if (firstWithId) {
    const id = firstWithId.id as string;
    const probePath = `/invoicing/v1/products/${id}/image`;
    console.log(`\n  GET ${probePath} (endpoint dedicado, sondeo)`);
    const r = await rawFetch(env, probePath);
    const looksImage =
      r.httpStatus === 200 &&
      typeof r.contentType === "string" &&
      r.contentType.startsWith("image/");
    const looksHtml200 =
      r.httpStatus === 200 &&
      typeof r.contentType === "string" &&
      r.contentType.includes("text/html");
    dedicatedEndpoint = {
      tried: probePath,
      httpStatus: r.httpStatus,
      contentType: r.contentType,
      looksValid: looksImage,
      notes: looksImage
        ? "endpoint dedicado devuelve binario image/*"
        : looksHtml200
          ? "200+HTML → endpoint inexistente (caso §01.B)"
          : `HTTP ${r.httpStatus}, no es imagen`,
    };
    console.log(`    HTTP ${r.httpStatus} · ${r.contentType ?? "(no ct)"} · ${dedicatedEndpoint.notes}`);
  }

  // ── 6. Recomendación final ──────────────────────────────────────────
  const recommendation: string[] = [];
  if (!chosenField) {
    recommendation.push(
      "NO se encontró campo de imagen en la cuenta sondeada. Antes de avanzar B-ProductImages, validar en una cuenta con productos que sí tengan foto cargada en el backoffice de Holded.",
    );
  } else {
    recommendation.push(
      `Usar el campo \`${chosenField}\` como fuente de Product.imageUrl en el sync (initial + incremental). Si el valor es array/objeto, extraer la primera URL string anidada.`,
    );
  }
  if (imageProbe) {
    const authRequired =
      imageProbe.withoutAuth.httpStatus >= 400 ||
      (typeof imageProbe.withoutAuth.contentType === "string" &&
        imageProbe.withoutAuth.contentType.includes("text/html"));
    if (authRequired) {
      recommendation.push(
        "La URL exige autenticación: el image-cache-worker debe enviar el header `key:` del tenant al descargar.",
      );
    } else {
      recommendation.push(
        "La URL es pública (sin auth): el worker puede descargar con `fetch` plano. Aun así, mantenemos el cache local en Caddy para velocidad y para sobrevivir caídas de Holded.",
      );
    }
    const ct = imageProbe.withAuth.contentType ?? "";
    if (ct.startsWith("image/")) {
      recommendation.push(
        `Content-Type observado: \`${ct}\`. El worker debe aceptar JPEG/PNG/WebP y rechazar resto (defensivo: HTML disfrazado de 200 podría llegar aquí).`,
      );
    }
  } else {
    recommendation.push(
      "Sin URL sondeable en la muestra. Documentar y reintentar contra cuenta piloto antes de lanzar producción.",
    );
  }

  const summary: Finding = {
    productsSampled: products.length,
    candidateFieldsObserved: [...candidateHits.values()],
    productsWithAnyImage,
    chosenField,
    chosenSampleValue,
    imageProbe,
    dedicatedEndpoint,
    recommendation,
  };
  writeFileSync(
    resolve(fixturesDir, "13-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log("  Resumen final");
  console.log("──────────────────────────────────────────────────────────────────");
  console.log(`  productos en muestra: ${summary.productsSampled}`);
  console.log(`  productos con imagen: ${summary.productsWithAnyImage}`);
  console.log(`  campo canónico:       ${summary.chosenField ?? "(ninguno)"}`);
  for (const r of recommendation) console.log(`  · ${r}`);
  console.log("\n  saved: 13-summary.json");
}

main().catch((err) => {
  console.error("\nSPIKE 13 FALLÓ:");
  if (err instanceof Error) console.error(`  ${err.message}`);
  else console.error(err);
  process.exit(1);
});
