#!/usr/bin/env node
// A5 · R5 · guarda de build: aborta si el origen del WebView no es el de
// producción. El porqué está entero en origen-del-webview.mjs.
//
// Uso:
//   node scripts/verificar-origen.mjs --ts   apps/tpv-android/capacitor.config.ts
//   node scripts/verificar-origen.mjs --json .../assets/capacitor.config.json
//
// Sale 0 si todo cuadra, 1 con el motivo si no. No admite ninguna variable de
// entorno que la relaje: la guarda anterior (hallazgo B2) sí la admitía
// (VITE_TPV_URL) y por eso no paró el APK del 04-09.

import { existsSync } from "node:fs";

import {
  EXPLICACION,
  comprobarOrigen,
  leerConfigJson,
  leerConfigTs,
} from "./origen-del-webview.mjs";

const [modo, ruta] = process.argv.slice(2);

if ((modo !== "--ts" && modo !== "--json") || !ruta) {
  console.error("uso: verificar-origen.mjs --ts|--json <ruta>");
  process.exit(2);
}

if (!existsSync(ruta)) {
  console.error(`ERROR: no encuentro ${ruta}`);
  process.exit(1);
}

const procedencia = modo === "--ts" ? "capacitor.config.ts" : "capacitor.config.json";

let fallos;
try {
  const valores = modo === "--ts" ? leerConfigTs(ruta) : leerConfigJson(ruta);
  fallos = comprobarOrigen(valores, procedencia);
} catch (e) {
  // Un config que no se puede leer NO se da por bueno: es exactamente el caso
  // en que interesa parar.
  console.error(`ERROR: no puedo leer el origen de ${ruta}: ${e.message}`);
  process.exit(1);
}

if (fallos.length > 0) {
  console.error("ERROR: el origen del WebView no es el de producción.\n");
  for (const f of fallos) console.error(`       · ${f}`);
  console.error(EXPLICACION);
  process.exit(1);
}

const sitio = modo === "--ts" ? "la fuente" : "el proyecto nativo";
console.log(`    OK · origen del WebView correcto en ${sitio} (R5)`);
