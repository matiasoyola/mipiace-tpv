// Spike Fase 0 · Script 01.
//
// Objetivo: confirmar que la API Key funciona y que los dos endpoints
// que más nos importan (productos y almacenes) responden con la forma
// que la spec asume. Sólo lectura — no crea nada en Holded.
//
// Hallazgos esperados (apuntar manualmente en docs/spike-holded.md):
//   - ¿La respuesta de /products es array directo o {data: [...]}?
//   - ¿`forSale` viene como número o booleano?
//   - ¿Existe el endpoint /warehouse y devuelve algo?
//   - ¿Qué campos trae cada almacén (id, name, ¿default?, ¿id por tienda?)?

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiKeyClient, HoldedApiError, HoldedEnv } from "./holded-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "fixtures");

function countItems(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data.length;
  }
  return 0;
}

function summariseShape(payload: unknown): string {
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (payload && typeof payload === "object") {
    const keys = Object.keys(payload as Record<string, unknown>).slice(0, 8);
    return `object{${keys.join(",")}}`;
  }
  return typeof payload;
}

async function dump(label: string, path: string, holded: ApiKeyClient) {
  console.log(`→ GET ${path}`);
  try {
    const data = await holded.request<unknown>(path);
    const file = resolve(fixturesDir, `01-${label}.json`);
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`  shape: ${summariseShape(data)}`);
    console.log(`  items: ${countItems(data)}`);
    console.log(`  saved: ${file}`);
  } catch (err) {
    if (err instanceof HoldedApiError) {
      console.error(`  FALLO ${err.status} en ${err.url}`);
      console.error(`  body: ${JSON.stringify(err.body).slice(0, 300)}`);
    }
    throw err;
  }
}

async function main() {
  const env = HoldedEnv.parse(process.env);
  mkdirSync(fixturesDir, { recursive: true });

  const holded = new ApiKeyClient(env.HOLDED_API_KEY, env.HOLDED_BASE_URL);

  console.log("Spike 01 · Auth check + lectura básica");
  console.log(`Base URL: ${env.HOLDED_BASE_URL}`);
  console.log("");

  await dump("products", "/invoicing/v1/products", holded);
  console.log("");
  await dump("warehouse", "/invoicing/v1/warehouse", holded);

  console.log("");
  console.log("OK · auth válida y endpoints de lectura responden.");
  console.log("Siguiente: revisar fixtures/ y anotar hallazgos en docs/spike-holded.md.");
}

main().catch((err) => {
  console.error("");
  console.error("SPIKE 01 FALLÓ:");
  if (err instanceof HoldedApiError) {
    console.error(`  HTTP ${err.status} en ${err.url}`);
    console.error(`  ${JSON.stringify(err.body, null, 2)}`);
  } else if (err instanceof Error) {
    console.error(`  ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
