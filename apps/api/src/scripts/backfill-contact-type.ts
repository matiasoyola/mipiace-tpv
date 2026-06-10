// v1.4-Buscador-Contactos · backfill del campo `type` en `contacts`.
//
// La migración b29 añade la columna nullable. Este script la rellena
// sobre los contactos ya sincronizados leyendo `raw.type` y aplicando
// `mapHoldedType`. El resultado por defecto cuando no hay `type` en el
// raw es `UNKNOWN`, que el endpoint search trata como cliente para no
// esconder contactos legítimos preexistentes.
//
// Uso (en VPS, post-deploy):
//   pnpm --filter @mipiacetpv/api tsx src/scripts/backfill-contact-type.ts
//
// Opcional: pasar tenantId concreto para limitar el alcance.
//   pnpm --filter @mipiacetpv/api tsx src/scripts/backfill-contact-type.ts <tenantId>
//
// El script es idempotente: sólo actualiza filas con `type IS NULL`.
// Re-ejecutarlo tras un sync que dejó UNKNOWN tampoco daña nada (el
// upsert del sync ya escribe el type correcto).

import "dotenv/config";

import type { ContactType, PrismaClient } from "@mipiacetpv/db";

import { mapHoldedType } from "../contacts/holded-type.js";
import { getPrisma, shutdown } from "../context.js";

const CHUNK_SIZE = 200;

interface BackfillStats {
  scanned: number;
  updated: number;
  perType: Record<ContactType, number>;
  rawWithoutType: string[];
}

function emptyStats(): BackfillStats {
  return {
    scanned: 0,
    updated: 0,
    perType: {
      CLIENT: 0,
      SUPPLIER: 0,
      LEAD: 0,
      DEBTOR: 0,
      CREDITOR: 0,
      UNKNOWN: 0,
    },
    rawWithoutType: [],
  };
}

export async function runBackfillContactType(
  prisma: PrismaClient,
  tenantId?: string,
): Promise<BackfillStats> {
  const stats = emptyStats();
  // Estrategia "drain": pedimos siempre el primer chunk de filas con
  // `type IS NULL`. Tras actualizarlas dejan de matchear el filtro,
  // así que el siguiente chunk empieza limpio sin necesidad de
  // cursor. Si el chunk vuelve vacío, hemos terminado.
  for (;;) {
    const rows = await prisma.contact.findMany({
      where: {
        type: null,
        ...(tenantId ? { tenantId } : {}),
      },
      orderBy: { id: "asc" },
      take: CHUNK_SIZE,
      select: { id: true, raw: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      stats.scanned += 1;
      const rawType = (row.raw as { type?: unknown } | null)?.type;
      const next = mapHoldedType(rawType);
      stats.perType[next] += 1;
      if (next === "UNKNOWN" && rawType === undefined) {
        // Caso edge: el raw no traía `type`. Lo registramos para que
        // el operador sepa qué IDs hay que revisar manualmente.
        if (stats.rawWithoutType.length < 50) {
          stats.rawWithoutType.push(row.id);
        }
      }
      await prisma.contact.update({
        where: { id: row.id },
        data: { type: next },
      });
      stats.updated += 1;
    }
    // Loggeamos progreso por chunk para que en VPS con miles de
    // contactos no parezca colgado.
    process.stdout.write(`· ${stats.updated} actualizados\n`);
  }
  return stats;
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  const prisma = getPrisma();
  console.log(
    tenantId
      ? `Backfill contact.type para tenant ${tenantId}`
      : "Backfill contact.type para todos los tenants",
  );
  const stats = await runBackfillContactType(prisma, tenantId);
  console.log("");
  console.log("== Backfill terminado ==");
  console.log(`Escaneados: ${stats.scanned}`);
  console.log(`Actualizados: ${stats.updated}`);
  console.log("Por tipo:");
  for (const [t, n] of Object.entries(stats.perType)) {
    console.log(`  ${t.padEnd(10)} ${n}`);
  }
  if (stats.rawWithoutType.length > 0) {
    console.log("");
    console.log(
      `IDs sin \`type\` en el raw (primeros ${stats.rawWithoutType.length}):`,
    );
    for (const id of stats.rawWithoutType) console.log(`  ${id}`);
    console.log(
      "Estos quedaron como UNKNOWN y son visibles en el TPV. Revisa el contacto en Holded si esperabas otra clasificación.",
    );
  }
}

// Sólo arrancamos main si el módulo se ejecuta directamente — así el
// test de Vitest puede importar `runBackfillContactType` sin disparar
// el script.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("backfill-contact-type.ts");

if (isDirectRun) {
  main()
    .then(() => shutdown())
    .catch(async (err) => {
      console.error(err);
      await shutdown();
      process.exit(1);
    });
}
