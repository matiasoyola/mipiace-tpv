// Encender el modo emisor: el suelo que hay que pisar ANTES de la primera
// factura.
//
// Un registro de facturación necesita NIF del emisor, razón social, serie y
// número de instalación. Nada de eso se puede inventar en el momento del
// cobro, y comprobarlo en el momento del cobro sería peor: rompería la
// invariante de que cobrar siempre se puede.
//
// La regla, entonces: el suelo se comprueba AL ENCENDER, no al cobrar. Una
// vez encendido, cobrar no puede fallar por falta de datos fiscales porque
// los datos ya estaban ahí antes del primer cobro.
//
// De las cuatro cosas que hacen falta, aquí sólo se comprueban DOS. La serie
// y el número de instalación no aparecen: los pone la base al crear la caja
// (trigger `registers_fiscal_identity_default`), así que no hay ningún
// estado en el que falten. Comprobarlos aquí sería comprobar una invariante
// que ya no depende de nadie — y dejaría entender que puede fallar.

import { type Prisma, type PrismaClient } from "@mipiacetpv/db";
import { validateSpanishTaxId } from "@mipiacetpv/util-validation";

import { leerIdentidadFiscal } from "./mode.js";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface SueloFiscal {
  ok: boolean;
  problemas: string[];
}

export async function comprobarSueloFiscal(
  tx: Tx,
  tenantId: string,
): Promise<SueloFiscal> {
  const problemas: string[] = [];
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, fiscalProfile: true },
  });
  if (!tenant) return { ok: false, problemas: ["La empresa no existe."] };

  const identidad = leerIdentidadFiscal(tenant);
  if (!identidad) {
    problemas.push(
      "Falta el NIF o la razón social en los datos fiscales. Sin ellos el registro de facturación no se puede generar.",
    );
  } else if (!validateSpanishTaxId(identidad.nif).valid) {
    problemas.push(
      `El NIF "${identidad.nif}" no es un identificador fiscal español válido.`,
    );
  }

  return { ok: problemas.length === 0, problemas };
}
