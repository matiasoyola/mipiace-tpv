// v1.13-e2e-ciclo-de-caja · base limpia + migraciones REALES.
//
// `prisma migrate deploy` y no `db push`: así el e2e prueba también la
// migración —incluido el backfill de `summary_ack_at` que metió el
// addendum de v1.11— y no un esquema derivado del schema.prisma que en
// producción nadie aplica.
//
// El DROP SCHEMA va antes: una base a medio migrar de una pasada anterior
// haría pasar o fallar la suite por razones que no son el ciclo de caja.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@mipiacetpv/db";

import {
  assertDisposableDatabase,
  E2E_DATABASE_URL,
  e2eEnabled,
  SKIP_MESSAGE,
} from "./e2e-env.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export default async function setup(): Promise<void> {
  if (!e2eEnabled) {
    if (process.env.CI) {
      throw new Error(
        "CI sin E2E_DATABASE_URL: el e2e del ciclo de caja no puede saltarse en CI.\n" +
          SKIP_MESSAGE,
      );
    }
    console.warn(`\n${SKIP_MESSAGE}\n`);
    return;
  }

  assertDisposableDatabase(E2E_DATABASE_URL);

  const prisma = new PrismaClient({
    datasources: { db: { url: E2E_DATABASE_URL } },
  });
  try {
    await prisma.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await prisma.$executeRawUnsafe("CREATE SCHEMA public");
  } finally {
    await prisma.$disconnect();
  }

  execFileSync(
    "pnpm",
    ["--filter", "@mipiacetpv/db", "run", "migrate:deploy"],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    },
  );
}
