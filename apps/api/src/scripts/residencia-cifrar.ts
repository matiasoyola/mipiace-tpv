// residencia-1b · EL «MIGRAR» DE LAS TRES TABLAS DE LA RESIDENCIA (D-63).
//
// Los tres pasos que `cifrar-lo-existente.ts` añade a su recorrido por
// tenant: la ficha del residente (DNI, NSS y motivo del alta), las líneas
// del plan de cuidados (los dos motivos) y el histórico de habitaciones
// (el motivo del cambio).
//
// Vive en su propio fichero por dos razones:
//
//   · el e2e de residencia-1b los importa para probarlos —cifrar, mirar,
//     vaciar, y una tercera pasada que no hace nada—, y
//     `cifrar-lo-existente.ts` llama a `main()` en el cuerpo del módulo,
//     así que importarlo lo ejecutaría (ver
//     `scripts-no-corren-al-importarlos.test.ts`);
//   · `--vaciar` entra como parámetro y no como constante de
//     `process.argv`, que es lo que hace posible probar las dos pasadas
//     por separado.
//
// Aquí no corre nada al importarlo.

import { getPrisma, shutdown } from "../context.js";
import { loadEnv } from "../env.js";
import { asegurarDek } from "../clinica/claves.js";
import {
  cifrarTexto,
  sitioDniDeResidente,
  sitioMotivoDeAlta,
  sitioMotivoDeCierreDeLinea,
  sitioMotivoDeLinea,
  sitioMotivoDeOcupacion,
  sitioNssDeResidente,
} from "../clinica/cripto-campos.js";
import {
  NoCuadra,
  TANDA,
  cuenta,
  verificar,
  type Cuenta,
} from "./cifrado-comun.js";

// ── residencia-1b · LAS SEIS DE LA RESIDENCIA (D-63) ─────────────────
//
// Las tres funciones siguen el patrón de las de arriba, con una diferencia
// que conviene decir: **cifran y vacían en PASADAS SEPARADAS**, no en el
// mismo `update` condicionado a `--vaciar`.
//
// Es la lección de `vaciarNotas()`: cifrando y vaciando en el mismo
// `update`, la segunda pasada —la que el despliegue de verdad hace, con el
// resultado de la primera ya mirado— no encuentra nada porque el
// `WHERE … IS NULL` ya no la ve, y el claro se queda para siempre. Aquí el
// bucle de vaciado tiene su propio `WHERE` (cifrado puesto Y claro todavía
// ahí) y funciona igual en una pasada que en dos.
//
// Y verifica DOS VECES: al cifrar, y otra vez antes de borrar el claro. Con
// el claro vaciado, un ciphertext que no abre es un dato perdido.

export async function fichasDeResidentes(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
  /** residencia-1b · `--vaciar` llega como PARAMETRO y no como constante de
   *  modulo leida de `process.argv`: asi el e2e puede hacer las dos pasadas
   *  —cifrar, mirar, vaciar— que es el camino que el despliegue hace de
   *  verdad. Con `process.argv` solo se podia probar una. */
  vaciar: boolean,
): Promise<void> {
  const prisma = getPrisma();

  // El AAD de las tres columnas lleva el `client_id`, que ES la primaria de
  // `resident_profiles`: esta tabla no tiene columna `id`.
  for (;;) {
    const filas = await prisma.residentProfile.findMany({
      where: {
        tenantId,
        OR: [
          { dniCifrado: null, NOT: { dni: null } },
          { nssCifrado: null, NOT: { nss: null } },
          { dischargeReasonCifrado: null, NOT: { dischargeReason: null } },
        ],
      },
      take: TANDA,
      select: {
        clientId: true,
        dni: true,
        nss: true,
        dischargeReason: true,
        dniCifrado: true,
        nssCifrado: true,
        dischargeReasonCifrado: true,
      },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const data: {
        dniCifrado?: string;
        nssCifrado?: string;
        dischargeReasonCifrado?: string;
      } = {};
      // Las tres en el MISMO `update`: una ficha es una fila, y tres
      // updates serían tres escrituras donde hay una.
      for (const [claro, yaCifrado, sitioDe, campo, que] of [
        [
          fila.dni,
          fila.dniCifrado,
          sitioDniDeResidente,
          "dniCifrado",
          "resident_profiles.dni",
        ],
        [
          fila.nss,
          fila.nssCifrado,
          sitioNssDeResidente,
          "nssCifrado",
          "resident_profiles.nss",
        ],
        [
          fila.dischargeReason,
          fila.dischargeReasonCifrado,
          sitioMotivoDeAlta,
          "dischargeReasonCifrado",
          "resident_profiles.discharge_reason",
        ],
      ] as const) {
        if (yaCifrado != null) continue;
        const sitio = sitioDe(tenantId, fila.clientId);
        const cifrado = cifrarTexto(claro, dek, sitio);
        if (cifrado == null) continue;
        verificar(cifrado, claro!, dek, sitio, que);
        data[campo] = cifrado;
      }
      if (Object.keys(data).length === 0) continue;
      await prisma.residentProfile.update({
        where: { clientId: fila.clientId },
        data,
      });
      total.cifradas += 1;
    }
    console.log(`  fichas de residentes · +${filas.length}`);
  }

  if (!vaciar) return;
  const porVaciar = await prisma.residentProfile.findMany({
    where: {
      tenantId,
      OR: [
        { NOT: { dniCifrado: null }, dni: { not: null } },
        { NOT: { nssCifrado: null }, nss: { not: null } },
        { NOT: { dischargeReasonCifrado: null }, dischargeReason: { not: null } },
      ],
    },
    select: {
      clientId: true,
      dni: true,
      nss: true,
      dischargeReason: true,
      dniCifrado: true,
      nssCifrado: true,
      dischargeReasonCifrado: true,
    },
  });
  for (const fila of porVaciar) {
    const data: { dni?: null; nss?: null; dischargeReason?: null } = {};
    for (const [claro, cifrado, sitioDe, campo, que] of [
      [
        fila.dni,
        fila.dniCifrado,
        sitioDniDeResidente,
        "dni",
        "resident_profiles.dni",
      ],
      [
        fila.nss,
        fila.nssCifrado,
        sitioNssDeResidente,
        "nss",
        "resident_profiles.nss",
      ],
      [
        fila.dischargeReason,
        fila.dischargeReasonCifrado,
        sitioMotivoDeAlta,
        "dischargeReason",
        "resident_profiles.discharge_reason",
      ],
    ] as const) {
      if (claro == null || cifrado == null) continue;
      verificar(
        cifrado,
        claro,
        dek,
        sitioDe(tenantId, fila.clientId),
        `${que} (al vaciar)`,
      );
      data[campo] = null;
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.residentProfile.update({
      where: { clientId: fila.clientId },
      data,
    });
    total.vaciadas += 1;
  }
  if (porVaciar.length > 0) {
    console.log(`  fichas de residentes vaciadas · +${porVaciar.length}`);
  }
}

export async function lineasDelPlan(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
  /** residencia-1b · `--vaciar` llega como PARAMETRO y no como constante de
   *  modulo leida de `process.argv`: asi el e2e puede hacer las dos pasadas
   *  —cifrar, mirar, vaciar— que es el camino que el despliegue hace de
   *  verdad. Con `process.argv` solo se podia probar una. */
  vaciar: boolean,
): Promise<void> {
  const prisma = getPrisma();

  for (;;) {
    const filas = await prisma.carePlanItem.findMany({
      where: {
        tenantId,
        OR: [
          { reasonCifrado: null, NOT: { reason: null } },
          { closeReasonCifrado: null, NOT: { closeReason: null } },
        ],
      },
      take: TANDA,
      select: {
        id: true,
        reason: true,
        closeReason: true,
        reasonCifrado: true,
        closeReasonCifrado: true,
      },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const data: { reasonCifrado?: string; closeReasonCifrado?: string } = {};
      for (const [claro, yaCifrado, sitioDe, campo, que] of [
        [
          fila.reason,
          fila.reasonCifrado,
          sitioMotivoDeLinea,
          "reasonCifrado",
          "care_plan_items.reason",
        ],
        [
          fila.closeReason,
          fila.closeReasonCifrado,
          sitioMotivoDeCierreDeLinea,
          "closeReasonCifrado",
          "care_plan_items.close_reason",
        ],
      ] as const) {
        if (yaCifrado != null) continue;
        const sitio = sitioDe(tenantId, fila.id);
        const cifrado = cifrarTexto(claro, dek, sitio);
        if (cifrado == null) continue;
        verificar(cifrado, claro!, dek, sitio, que);
        data[campo] = cifrado;
      }
      if (Object.keys(data).length === 0) continue;
      await prisma.carePlanItem.update({ where: { id: fila.id }, data });
      total.cifradas += 1;
    }
    console.log(`  líneas del plan · +${filas.length}`);
  }

  if (!vaciar) return;
  const porVaciar = await prisma.carePlanItem.findMany({
    where: {
      tenantId,
      OR: [
        { NOT: { reasonCifrado: null }, reason: { not: null } },
        { NOT: { closeReasonCifrado: null }, closeReason: { not: null } },
      ],
    },
    select: {
      id: true,
      reason: true,
      closeReason: true,
      reasonCifrado: true,
      closeReasonCifrado: true,
    },
  });
  for (const fila of porVaciar) {
    const data: { reason?: null; closeReason?: null } = {};
    for (const [claro, cifrado, sitioDe, campo, que] of [
      [
        fila.reason,
        fila.reasonCifrado,
        sitioMotivoDeLinea,
        "reason",
        "care_plan_items.reason",
      ],
      [
        fila.closeReason,
        fila.closeReasonCifrado,
        sitioMotivoDeCierreDeLinea,
        "closeReason",
        "care_plan_items.close_reason",
      ],
    ] as const) {
      if (claro == null || cifrado == null) continue;
      verificar(
        cifrado,
        claro,
        dek,
        sitioDe(tenantId, fila.id),
        `${que} (al vaciar)`,
      );
      data[campo] = null;
    }
    if (Object.keys(data).length === 0) continue;
    await prisma.carePlanItem.update({ where: { id: fila.id }, data });
    total.vaciadas += 1;
  }
  if (porVaciar.length > 0) {
    console.log(`  líneas del plan vaciadas · +${porVaciar.length}`);
  }
}

export async function ocupacionesDeCama(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
  /** residencia-1b · `--vaciar` llega como PARAMETRO y no como constante de
   *  modulo leida de `process.argv`: asi el e2e puede hacer las dos pasadas
   *  —cifrar, mirar, vaciar— que es el camino que el despliegue hace de
   *  verdad. Con `process.argv` solo se podia probar una. */
  vaciar: boolean,
): Promise<void> {
  const prisma = getPrisma();

  for (;;) {
    const filas = await prisma.bedAssignment.findMany({
      where: { tenantId, reasonCifrado: null, NOT: { reason: null } },
      take: TANDA,
      select: { id: true, reason: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioMotivoDeOcupacion(tenantId, fila.id);
      const cifrado = cifrarTexto(fila.reason, dek, sitio);
      if (cifrado == null) continue;
      verificar(cifrado, fila.reason!, dek, sitio, "bed_assignments.reason");
      await prisma.bedAssignment.update({
        where: { id: fila.id },
        data: { reasonCifrado: cifrado },
      });
      total.cifradas += 1;
    }
    console.log(`  ocupaciones de cama · +${filas.length}`);
  }

  if (!vaciar) return;
  const porVaciar = await prisma.bedAssignment.findMany({
    where: { tenantId, NOT: { reasonCifrado: null }, reason: { not: null } },
    select: { id: true, reason: true, reasonCifrado: true },
  });
  for (const fila of porVaciar) {
    verificar(
      fila.reasonCifrado!,
      fila.reason!,
      dek,
      sitioMotivoDeOcupacion(tenantId, fila.id),
      "bed_assignments.reason (al vaciar)",
    );
    await prisma.bedAssignment.update({
      where: { id: fila.id },
      data: { reason: null },
    });
    total.vaciadas += 1;
  }
  if (porVaciar.length > 0) {
    console.log(`  ocupaciones de cama vaciadas · +${porVaciar.length}`);
  }
}

// ── Y UNA ENTRADA PROPIA, para correr SÓLO la residencia ─────────────
//
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/residencia-cifrar.ts
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/residencia-cifrar.ts --vaciar
//
// El camino normal es `cifrar-lo-existente.ts`, que llama a estos tres
// pasos dentro de su recorrido por tenant. Esta entrada existe para el
// caso de residencia-1b: un entorno donde lo clínico YA se cifró en el
// despliegue de clinica-7 y lo único pendiente son las tres tablas de la
// residencia. Relanzar el script entero funcionaría igual (es idempotente),
// pero recorrería las nueve columnas clínicas para no hacer nada.
//
// ── La guardia de ejecución directa ─────────────────────────────────
//
// `main()` NO se llama en el cuerpo del módulo: el e2e importa las tres
// funciones de arriba, y un `main()` suelto correría al importarlas —con
// el rojo peor de todos, un «process.exit unexpectedly called» que no
// nombra ningún test. Lo vigila
// `scripts-no-corren-al-importarlos.test.ts`.

async function main(): Promise<void> {
  const prisma = getPrisma();
  const env = loadEnv();
  if (env.CLINICAL_KEK == null) {
    throw new Error(
      "Falta CLINICAL_KEK. Sin ella no se puede cifrar nada: ponla en el entorno antes de lanzar esto.",
    );
  }
  const vaciar = process.argv.includes("--vaciar");

  // Los centros de RESIDENCIA. Y nada más: las tres tablas sólo tienen
  // filas ahí, y un centro de residencia tiene la clínica encendida por
  // obligación (`tenants_residencia_exige_clinica`), así que su DEK es la
  // misma que cifra lo clínico.
  const centros = await prisma.tenant.findMany({
    where: { residenciaEnabled: true },
    select: { id: true, name: true },
  });
  if (centros.length === 0) {
    console.log("No hay ni un centro con la residencia encendida. Nada que cifrar.");
    return;
  }

  console.log(
    `${centros.length} centro(s) de residencia.${vaciar ? " MODO --vaciar: se borrará el claro de lo ya cifrado y verificado." : ""}`,
  );

  const total = cuenta();
  for (const centro of centros) {
    console.log(`\n── ${centro.id} · ${centro.name}`);
    const dek = await asegurarDek(centro.id, prisma);
    await fichasDeResidentes(centro.id, dek, total, vaciar);
    await lineasDelPlan(centro.id, dek, total, vaciar);
    await ocupacionesDeCama(centro.id, dek, total, vaciar);
  }

  console.log(
    `\n${"═".repeat(60)}\nCifradas: ${total.cifradas} · claros vaciados: ${total.vaciadas}`,
  );
  if (!vaciar) {
    console.log(
      "\nEl claro NO se ha tocado. Comprueba el resultado y, cuando estés seguro,\n" +
        "vuelve a lanzarlo con --vaciar.",
    );
  }
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("residencia-cifrar.ts");

if (isDirectRun) {
  main()
    .then(() => shutdown())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof NoCuadra) {
        console.error(
          "\nEl script ha PARADO a propósito. Lo cifrado hasta aquí está bien\n" +
            "(se verificó fila a fila) y el claro sigue en su sitio. Avisa antes de\n" +
            "volver a lanzarlo.",
        );
      }
      await shutdown();
      process.exit(1);
    });
}
