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
