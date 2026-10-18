// v1.13-e2e-ciclo-de-caja · la puerta de la suite.
//
// La suite e2e corre contra un Postgres DE VERDAD y **borra el esquema
// entero** antes de migrar. Por eso no se engancha a `DATABASE_URL`: esa
// variable la tiene exportada media plantilla apuntando a su base de
// desarrollo (y `apps/api/.env` la lleva). Un `pnpm test:e2e` despistado
// no puede costar el catálogo de nadie.
//
// La variable es `E2E_DATABASE_URL` y es explícita: quien la pone sabe
// que la base es desechable. Sin ella:
//   - en local, la suite se salta con un mensaje que dice cómo levantarla;
//   - en CI (`CI=true`), la suite FALLA. Un e2e que nadie mira no existe
//     (§3 del prompt), y uno que se salta en verde es peor: miente.

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── clinica-7 · LA KEK DE LA SUITE ──────────────────────────────────
//
// Cualquier e2e que escriba algo clínico necesita `CLINICAL_KEK`: sin ella
// `asegurarDek` no puede envolver la clave de la clínica y la ruta
// contesta 500. En el portátil la trae `apps/api/.env` y por eso no se
// notaba; **en CI no hay `.env`** y `clinica-sesion-cobro.e2e.ts` se caía
// con seis 500 que no decían por qué.
//
// Va aquí —el módulo que importan todos los ficheros de la suite— y no en
// cada uno: la próxima ruta clínica que alguien pruebe no tiene que
// acordarse de nada.
//
// Y es **fija, no aleatoria**: los ficheros comparten base y un fichero
// que envolviera una DEK con una KEK distinta de la del siguiente dejaría
// un canario que no cuadra. Derivada de una frase para que se vea de lejos
// que es de pruebas.
//
// `??=`: si el entorno ya trae una, manda la del entorno. Y un fichero que
// quiera la suya la asigna después de este import (lo hace
// `clinica-7.e2e.ts`, que prueba justo qué pasa cuando la KEK no cuadra).
process.env.CLINICAL_KEK ??= createHash("sha256")
  .update("mipiacetpv-e2e-clinical-kek")
  .digest("base64");
process.env.CLINICAL_KEK_ID ??= "e2e";

// ── residencia-3 · DÓNDE CAEN LOS FICHEROS CLÍNICOS ─────────────────
//
// `env.ts` defaults a `/var/lib/mipiacetpv/clinical-files`, que es la ruta
// DEL CONTENEDOR. El runner de CI no puede crearla, así que la foto del
// residente contestaba `EACCES: permission denied, mkdir
// '/var/lib/mipiacetpv'` —500 en la ruta de subida—. En el portátil no se
// veía porque el `.env` de la raíz trae su propia ruta: la memoria de la
// casa otra vez, el `.env` de dev tapa lo que la CI va a ver.
//
// Se fija aquí y **SIN `??=`**, al contrario que la KEK: que la suite
// escriba en el mismo sitio en el portátil y en CI es justo lo que
// faltaba para cazar esto antes de empujar. Y va a `tmpdir()`, no al
// árbol, para no dejar fotos de prueba en el repo.
process.env.CLINICAL_FILES_DIR = join(tmpdir(), "mipiacetpv-e2e-clinical-files");

export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "";
export const e2eEnabled = E2E_DATABASE_URL.length > 0;

export const SKIP_MESSAGE = [
  "e2e del ciclo de caja: SALTADA (falta E2E_DATABASE_URL).",
  "",
  "Para correrla en local:",
  "  docker compose up -d postgres",
  '  docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_e2e;"',
  "  E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_e2e' pnpm test:e2e",
  "",
  "OJO: la suite hace DROP SCHEMA public sobre esa base antes de migrar.",
].join("\n");

/**
 * Red de seguridad de segundo nivel: aunque alguien apunte
 * `E2E_DATABASE_URL` a una base que no es de usar y tirar, el nombre
 * tiene que decirlo. Se puede desactivar a propósito con
 * `E2E_ALLOW_ANY_DB=1` — a propósito, no por accidente.
 */
export function assertDisposableDatabase(url: string): void {
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`E2E_DATABASE_URL no es una URL válida: ${url}`);
  }
  if (!dbName) {
    throw new Error("E2E_DATABASE_URL no incluye nombre de base de datos.");
  }
  if (process.env.E2E_ALLOW_ANY_DB === "1") return;
  if (!/(e2e|test)/i.test(dbName)) {
    throw new Error(
      [
        `La base "${dbName}" no parece desechable y la suite hace DROP SCHEMA public sobre ella.`,
        'Usa una base cuyo nombre contenga "e2e" o "test", o exporta E2E_ALLOW_ANY_DB=1 si de verdad quieres esa.',
      ].join(" "),
    );
  }
}
