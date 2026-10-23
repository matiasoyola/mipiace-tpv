// hierro-sirope (A) · CLI de la limpieza única de comandas huérfanas.
//
// Uso:
//   pnpm --filter @mipiacetpv/api huerfanas                      # sólo informa
//   pnpm --filter @mipiacetpv/api huerfanas -- --apply           # escribe
//   pnpm --filter @mipiacetpv/api huerfanas -- --edad-horas=0    # también lo de hoy
//
// Una comanda huérfana es la de un ticket que ya no está vivo —se cobró o
// se vació— y que sigue sin servir: sale con LISTO en el mapa de una mesa
// libre, espera para siempre en la columna «Listas» del KDS y su banda
// «M5 · listo para servir» tapa cualquier venta en todos los TPV. Nadie
// la puede apagar porque su ticket ya no existe.
//
// **Sin `--apply` no escribe nada.** Idempotente: la segunda pasada
// informa de 0.
//
// La regla y el barrido diario viven en `kitchen/servir.ts` y
// `kitchen/huerfanas.ts`; esto es sólo para lo que ya hay en producción
// (la T6 y M1 de Cafetería Sirope, y lo que salga en los demás).
//
// NO se ejecuta dentro del bloque: lo corre Matías contra producción
// después del despliegue.

import "dotenv/config";

import { getPrisma, shutdown } from "../context.js";
import {
  EDAD_MINIMA_HORAS,
  limpiarComandasHuerfanas,
} from "../kitchen/limpieza-huerfanas.js";

function leerEdadHoras(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--edad-horas="));
  if (!flag) return EDAD_MINIMA_HORAS;
  const n = Number(flag.slice("--edad-horas=".length));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--edad-horas no es un número de horas válido: ${flag}`);
  }
  return n;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const edadHoras = leerEdadHoras(process.argv);
  const prisma = getPrisma();

  const r = await limpiarComandasHuerfanas({ prisma, apply, edadHoras });

  console.log(
    `\nComandas sin servir en toda la plataforma: ${
      r.aServir.length + r.vivas + r.recientes
    }`,
  );
  console.log(`  con su cuenta viva (no se tocan):      ${r.vivas}`);
  console.log(
    `  huérfanas de menos de ${edadHoras} h (no se tocan): ${r.recientes}`,
  );
  console.log(`  HUÉRFANAS a servir:                    ${r.aServir.length}`);

  if (r.porTenant.length > 0) {
    console.log("\nPor tenant:");
    for (const t of r.porTenant) {
      console.log(
        `  ${t.tenantId}  ${String(t.total).padStart(4)} ` +
          `(${t.listas} ya listas · ${t.sinMarcar} sin marcar)`,
      );
    }
  }

  if (r.aServir.length > 0) {
    console.log("\nDetalle:");
    for (const f of r.aServir) {
      console.log(
        `  ${f.sentAt.toISOString()}  ${(f.tableName ?? "—").padEnd(16)} ` +
          `${f.section.padEnd(7)} ${f.ticket.status.padEnd(12)} ` +
          `${f.readyAt ? "LISTA" : "sin marcar"}  ${f.id}`,
      );
    }
  }

  if (!apply) {
    console.log(
      "\n--dry-run: no se ha escrito nada. Repite con `-- --apply` para servirlas.",
    );
  } else {
    console.log(`\n--apply: ${r.escritas} comanda(s) servidas.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => shutdown());
