// clinica-7 · EL «MIGRAR» DE expand → migrar → contract.
//
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/cifrar-lo-existente.ts
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/cifrar-lo-existente.ts --vaciar
//
// La migración añadió las columnas cifradas vacías. Esto las rellena con lo
// que ya había, **verificando cada fila**, y con `--vaciar` borra el claro
// después.
//
// ── Qué garantiza, y cómo ───────────────────────────────────────────
//
//   1. **IDEMPOTENTE.** Cada paso lleva su `WHERE … IS NULL`: una fila ya
//      cifrada no se vuelve a tocar. Se puede relanzar las veces que haga
//      falta, y si se corta a la mitad se sigue desde donde iba. Es lo que
//      permite lanzarlo en producción sin una ventana de mantenimiento.
//   2. **VERIFICA ANTES DE SEGUIR.** Después de cifrar cada fila la
//      descifra y la compara con el original. Si una no cuadra, el script
//      PARA — no sigue cifrando sobre un fallo que se repetiría en las
//      otras diez mil.
//   3. **NO BORRA NADA SIN QUE SE LO PIDAN.** El claro se queda hasta que
//      alguien pase `--vaciar`, y eso se hace en una pasada aparte, con la
//      verificación del paso anterior ya hecha y mirada.
//
// ── Y corre CON LOS TRIGGERS PUESTOS ────────────────────────────────
//
// No desactiva ninguno. La migración le enseñó a cada trigger cuál es la
// transición legítima (poner el cifrado, vaciar el claro) y nada más: si
// este script tuviera un fallo que intentara cambiar un cuerpo, un autor o
// una fecha, **el motor lo rechaza igual que rechazaría a una ruta**.
//
// Es la alternativa a `ALTER TABLE … DISABLE TRIGGER`, y la diferencia es
// que durante los minutos que dura esto la historia clínica no se queda sin
// garantías.
//
// ── El orden: PRIMERO LAS FILAS, DESPUÉS LOS FICHEROS ───────────────
//
// Las filas son rápidas y los ficheros son lentos. Si algo va a fallar, que
// falle en los dos primeros minutos y no en el minuto cuarenta.
//
// ── residencia-1b · Y LAS SEIS DE LA RESIDENCIA (D-63) ──────────────
//
// El DNI, el NSS y el motivo de alta de la ficha del residente; los dos
// motivos de cada línea del plan de cuidados; y el motivo de cada cambio
// de habitación.
//
// Van en el mismo recorrido por tenant que las nueve clínicas y no en un
// script aparte: un centro de residencia tiene la clínica encendida por
// obligación (`tenants_residencia_exige_clinica`), así que ya está en la
// lista — y su DEK es la misma. Un script aparte habría sido una segunda
// pasada que alguien se olvida.
//
// En los tenants que no son residencias las tres tablas están vacías y las
// funciones no hacen nada: no hace falta preguntar si la residencia está
// encendida.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Prisma } from "@mipiacetpv/db";

import { getPrisma, shutdown } from "../context.js";
import { loadEnv } from "../env.js";
import { asegurarDek } from "../clinica/claves.js";
import {
  cifrarFichero,
  descifrarValor,
  esFicheroCifrado,
  sitioDelFichero,
} from "../clinica/cripto.js";
import {
  CUERPO_VACIADO,
  cifrarCorreccion,
  cifrarJson,
  cifrarTexto,
  sitioAnotacion,
  sitioCorreccion,
  sitioEntrada,
  sitioMotivoDeRetirada,
  sitioMotivoDeRevocacion,
  sitioNotaDeCita,
  sitioNotaDeFicha,
  sitioNotaTecnica,
  sitioZonaDeFoto,
} from "../clinica/cripto-campos.js";
// residencia-1b (D-63) · los tres pasos de la residencia, en su propio
// fichero porque el e2e los importa y este llama a `main()` al cargarse.
import {
  fichasDeResidentes,
  lineasDelPlan,
  ocupacionesDeCama,
} from "./residencia-cifrar.js";
// Y lo que los dos comparten: la tanda, la cuenta y el `verificar`.
import {
  NoCuadra,
  TANDA,
  cuenta,
  verificar,
  type Cuenta,
} from "./cifrado-comun.js";

const vaciar = process.argv.includes("--vaciar");

async function main(): Promise<void> {
  const prisma = getPrisma();
  const env = loadEnv();
  if (env.CLINICAL_KEK == null) {
    throw new Error(
      "Falta CLINICAL_KEK. Sin ella no se puede cifrar nada: ponla en el entorno antes de lanzar esto.",
    );
  }

  // Los tenants CLÍNICOS. Las notas de los demás no se cifran (decisión
  // 10): en la peluquería la nota dice «no le gusta el secador».
  const clinicos = await prisma.tenant.findMany({
    where: { clinicalRecordsEnabled: true },
    select: { id: true, name: true },
  });

  // Y los que tienen historia aunque les hayan apagado el módulo: sus
  // filas clínicas existen y hay que cifrarlas igual.
  const conHistoria = await prisma.clinicalEntry.findMany({
    distinct: ["tenantId"],
    select: { tenantId: true },
  });
  const ids = new Set([
    ...clinicos.map((t) => t.id),
    ...conHistoria.map((e) => e.tenantId),
  ]);

  if (ids.size === 0) {
    console.log(
      "No hay ni un tenant con el módulo clínico encendido ni con historia escrita. Nada que cifrar.",
    );
    return;
  }

  console.log(
    `${ids.size} tenant(s) que cifrar.${vaciar ? " MODO --vaciar: se borrará el claro de lo ya cifrado y verificado." : ""}`,
  );

  const total = cuenta();
  for (const tenantId of ids) {
    const esClinico = clinicos.some((t) => t.id === tenantId);
    console.log(`\n── ${tenantId}${esClinico ? "" : " (módulo apagado, con historia)"}`);
    const dek = await asegurarDek(tenantId, prisma);

    await entradas(tenantId, dek, total);
    await anotaciones(tenantId, dek, total);
    await fotos(tenantId, dek, total);
    await consentimientos(tenantId, dek, total);
    await correcciones(tenantId, dek, total);
    // Las tres de abajo SOLO en tenants clínicos: en los demás la columna
    // cifrada se queda vacía y el claro es el bueno.
    if (esClinico) {
      await notasDeCitas(tenantId, dek, total);
      await notasDeFichas(tenantId, dek, total);
      await notasTecnicas(tenantId, dek, total);
    }
    // residencia-1b (D-63) · las tres tablas de la residencia. Sin
    // condición: en un tenant que no sea residencia están vacías, y un
    // centro de residencia tiene la clínica encendida por obligación, así
    // que ya está en esta lista con su DEK.
    await fichasDeResidentes(tenantId, dek, total, vaciar);
    await lineasDelPlan(tenantId, dek, total, vaciar);
    await ocupacionesDeCama(tenantId, dek, total, vaciar);
    await ficherosDelTenant(tenantId, dek, total);
  }

  console.log(
    `\n${"═".repeat(60)}\nCifradas: ${total.cifradas} · ya estaban: ${total.yaEstaban} · claros vaciados: ${total.vaciadas}`,
  );
  if (!vaciar) {
    console.log(
      "\nEl claro NO se ha tocado. Comprueba el resultado y, cuando estés seguro,\n" +
        "vuelve a lanzarlo con --vaciar.",
    );
  }
}

// ── Las entradas de historia ─────────────────────────────────────────

async function entradas(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.clinicalEntry.findMany({
      where: { tenantId, bodyCifrado: null },
      take: TANDA,
      select: { id: true, body: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioEntrada(tenantId, fila.id);
      const claro = JSON.stringify(fila.body);
      const cifrado = cifrarJson(fila.body, dek, sitio);
      verificar(cifrado, claro, dek, sitio, "clinical_entries.body");
      await prisma.clinicalEntry.update({
        where: { id: fila.id },
        data: { bodyCifrado: cifrado },
      });
      total.cifradas += 1;
    }
    console.log(`  entradas · +${filas.length}`);
  }

  if (!vaciar) return;
  for (;;) {
    const filas = await prisma.clinicalEntry.findMany({
      where: {
        tenantId,
        bodyCifrado: { not: null },
        NOT: { body: { equals: CUERPO_VACIADO as Prisma.InputJsonValue } },
      },
      take: TANDA,
      select: { id: true, body: true, bodyCifrado: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      // VERIFICA OTRA VEZ antes de borrar. Es la última oportunidad: con
      // el claro vaciado, un ciphertext que no abre es historia perdida.
      verificar(
        fila.bodyCifrado!,
        JSON.stringify(fila.body),
        dek,
        sitioEntrada(tenantId, fila.id),
        "clinical_entries.body (al vaciar)",
      );
      await prisma.clinicalEntry.update({
        where: { id: fila.id },
        data: { body: CUERPO_VACIADO as Prisma.InputJsonValue },
      });
      total.vaciadas += 1;
    }
    console.log(`  entradas vaciadas · +${filas.length}`);
  }
}

async function anotaciones(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.clinicalAddendum.findMany({
      where: { tenantId, bodyCifrado: null },
      take: TANDA,
      select: { id: true, body: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioAnotacion(tenantId, fila.id);
      const cifrado = cifrarJson(fila.body, dek, sitio);
      verificar(
        cifrado,
        JSON.stringify(fila.body),
        dek,
        sitio,
        "clinical_addenda.body",
      );
      await prisma.clinicalAddendum.update({
        where: { id: fila.id },
        data: { bodyCifrado: cifrado },
      });
      total.cifradas += 1;
    }
    console.log(`  anotaciones · +${filas.length}`);
  }
  if (!vaciar) return;
  for (;;) {
    const filas = await prisma.clinicalAddendum.findMany({
      where: {
        tenantId,
        bodyCifrado: { not: null },
        NOT: { body: { equals: CUERPO_VACIADO as Prisma.InputJsonValue } },
      },
      take: TANDA,
      select: { id: true, body: true, bodyCifrado: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      verificar(
        fila.bodyCifrado!,
        JSON.stringify(fila.body),
        dek,
        sitioAnotacion(tenantId, fila.id),
        "clinical_addenda.body (al vaciar)",
      );
      await prisma.clinicalAddendum.update({
        where: { id: fila.id },
        data: { body: CUERPO_VACIADO as Prisma.InputJsonValue },
      });
      total.vaciadas += 1;
    }
    console.log(`  anotaciones vaciadas · +${filas.length}`);
  }
}

// ── Las fotos: la zona y el motivo de la retirada ────────────────────

async function fotos(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.clinicalPhoto.findMany({
      where: { tenantId, zonaCifrada: null },
      take: TANDA,
      select: { id: true, zona: true, withdrawReason: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sZona = sitioZonaDeFoto(tenantId, fila.id);
      const zonaCifrada = cifrarTexto(fila.zona, dek, sZona)!;
      verificar(zonaCifrada, fila.zona, dek, sZona, "clinical_photos.zona");

      // El motivo, si lo hay. Va en el MISMO update: el trigger admite la
      // transición de cifrado con las cuatro columnas en juego a la vez, y
      // dos updates serían dos transiciones donde hay una.
      let motivoCifrado: string | null = null;
      if (fila.withdrawReason != null && fila.withdrawReason !== "") {
        const sMotivo = sitioMotivoDeRetirada(tenantId, fila.id);
        motivoCifrado = cifrarTexto(fila.withdrawReason, dek, sMotivo)!;
        verificar(
          motivoCifrado,
          fila.withdrawReason,
          dek,
          sMotivo,
          "clinical_photos.withdraw_reason",
        );
      }
      await prisma.clinicalPhoto.update({
        where: { id: fila.id },
        data: { zonaCifrada, withdrawReasonCifrado: motivoCifrado },
      });
      total.cifradas += 1;
    }
    console.log(`  fotos · +${filas.length}`);
  }
  if (!vaciar) return;
  for (;;) {
    const filas = await prisma.clinicalPhoto.findMany({
      where: { tenantId, zonaCifrada: { not: null }, NOT: { zona: "" } },
      take: TANDA,
      select: { id: true, zona: true, zonaCifrada: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      verificar(
        fila.zonaCifrada!,
        fila.zona,
        dek,
        sitioZonaDeFoto(tenantId, fila.id),
        "clinical_photos.zona (al vaciar)",
      );
      await prisma.clinicalPhoto.update({
        where: { id: fila.id },
        data: { zona: "", withdrawReason: null },
      });
      total.vaciadas += 1;
    }
    console.log(`  fotos vaciadas · +${filas.length}`);
  }
}

// ── Los consentimientos: el motivo de la revocación ──────────────────

async function consentimientos(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.clientConsent.findMany({
      where: {
        tenantId,
        revokeReasonCifrado: null,
        revokeReason: { not: null },
      },
      take: TANDA,
      select: { id: true, revokeReason: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioMotivoDeRevocacion(tenantId, fila.id);
      const cifrado = cifrarTexto(fila.revokeReason, dek, sitio)!;
      verificar(
        cifrado,
        fila.revokeReason!,
        dek,
        sitio,
        "client_consents.revoke_reason",
      );
      await prisma.clientConsent.update({
        where: { id: fila.id },
        data: { revokeReasonCifrado: cifrado },
      });
      total.cifradas += 1;
    }
    console.log(`  consentimientos · +${filas.length}`);
  }
  if (!vaciar) return;
  for (;;) {
    const filas = await prisma.clientConsent.findMany({
      where: {
        tenantId,
        revokeReasonCifrado: { not: null },
        revokeReason: { not: "" },
        NOT: { revokeReason: null },
      },
      take: TANDA,
      select: { id: true, revokeReason: true, revokeReasonCifrado: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      verificar(
        fila.revokeReasonCifrado!,
        fila.revokeReason!,
        dek,
        sitioMotivoDeRevocacion(tenantId, fila.id),
        "client_consents.revoke_reason (al vaciar)",
      );
      await prisma.clientConsent.update({
        where: { id: fila.id },
        data: { revokeReason: "" },
      });
      total.vaciadas += 1;
    }
    console.log(`  consentimientos vaciados · +${filas.length}`);
  }
}

// ── Las correcciones de la valoración ────────────────────────────────

async function correcciones(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.clinicalAssessmentCorrection.findMany({
      where: { tenantId, correccionCifrada: null },
      take: TANDA,
      select: { id: true, questionId: true, value: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      if (fila.value == null) continue;
      const sitio = sitioCorreccion(tenantId, fila.id);
      const claro = { preguntaId: fila.questionId, valor: fila.value };
      const cifrado = cifrarCorreccion(claro, dek, sitio);
      verificar(
        cifrado,
        JSON.stringify(claro),
        dek,
        sitio,
        "clinical_assessment_corrections",
      );
      await prisma.clinicalAssessmentCorrection.update({
        where: { id: fila.id },
        data: { correccionCifrada: cifrado },
      });
      total.cifradas += 1;
    }
    console.log(`  correcciones · +${filas.length}`);
  }
  if (!vaciar) return;
  for (;;) {
    const filas = await prisma.clinicalAssessmentCorrection.findMany({
      where: {
        tenantId,
        correccionCifrada: { not: null },
        NOT: { questionId: "" },
      },
      take: TANDA,
      select: {
        id: true,
        questionId: true,
        value: true,
        correccionCifrada: true,
      },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      verificar(
        fila.correccionCifrada!,
        JSON.stringify({ preguntaId: fila.questionId, valor: fila.value }),
        dek,
        sitioCorreccion(tenantId, fila.id),
        "clinical_assessment_corrections (al vaciar)",
      );
      await prisma.clinicalAssessmentCorrection.update({
        where: { id: fila.id },
        // El enum no tiene valor neutro, así que `value` va a NULL. Lo
        // sostiene el CHECK `..._dice_algo`: una corrección dice algo, en
        // claro o cifrado.
        data: { questionId: "", value: null },
      });
      total.vaciadas += 1;
    }
    console.log(`  correcciones vaciadas · +${filas.length}`);
  }
}

// ── Las tres notas de los tenants clínicos ───────────────────────────

async function notasDeCitas(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.appointment.findMany({
      where: { tenantId, notesCifradas: null, notes: { not: null } },
      take: TANDA,
      select: { id: true, notes: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioNotaDeCita(tenantId, fila.id);
      const cifrado = cifrarTexto(fila.notes, dek, sitio);
      if (cifrado == null) continue;
      verificar(cifrado, fila.notes!, dek, sitio, "appointments.notes");
      await prisma.appointment.update({
        where: { id: fila.id },
        data: {
          notesCifradas: cifrado,
          ...(vaciar ? { notes: null } : {}),
        },
      });
      total.cifradas += 1;
      if (vaciar) total.vaciadas += 1;
    }
    console.log(`  notas de citas · +${filas.length}`);
  }
  await vaciarNotas("appointments", tenantId, dek, total);
}

async function notasDeFichas(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.client.findMany({
      where: { tenantId, notesCifradas: null, notes: { not: null } },
      take: TANDA,
      select: { id: true, notes: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioNotaDeFicha(tenantId, fila.id);
      const cifrado = cifrarTexto(fila.notes, dek, sitio);
      if (cifrado == null) continue;
      verificar(cifrado, fila.notes!, dek, sitio, "clients.notes");
      await prisma.client.update({
        where: { id: fila.id },
        data: {
          notesCifradas: cifrado,
          ...(vaciar ? { notes: null } : {}),
        },
      });
      total.cifradas += 1;
      if (vaciar) total.vaciadas += 1;
    }
    console.log(`  notas de fichas · +${filas.length}`);
  }
  await vaciarNotas("clients", tenantId, dek, total);
}

async function notasTecnicas(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  for (;;) {
    const filas = await prisma.clientTechnicalNote.findMany({
      where: { tenantId, bodyCifrado: null, NOT: { body: "" } },
      take: TANDA,
      select: { id: true, body: true },
    });
    if (filas.length === 0) break;
    for (const fila of filas) {
      const sitio = sitioNotaTecnica(tenantId, fila.id);
      const cifrado = cifrarTexto(fila.body, dek, sitio);
      if (cifrado == null) continue;
      verificar(cifrado, fila.body, dek, sitio, "client_technical_notes.body");
      await prisma.clientTechnicalNote.update({
        where: { id: fila.id },
        data: {
          bodyCifrado: cifrado,
          // `body` es NOT NULL desde B1, así que el vaciado es la cadena
          // vacía.
          ...(vaciar ? { body: "" } : {}),
        },
      });
      total.cifradas += 1;
      if (vaciar) total.vaciadas += 1;
    }
    console.log(`  notas técnicas · +${filas.length}`);
  }
  await vaciarNotas("client_technical_notes", tenantId, dek, total);
}

/**
 * Vacía el claro de las notas YA CIFRADAS en una pasada anterior.
 *
 * ── Esto es un arreglo, y de un fallo que el banco de datos encontró ──
 *
 * Las tres funciones de arriba cifran y, si va `--vaciar`, vacían en el
 * MISMO `update`. Eso cubre la pasada que hace las dos cosas de una vez y
 * **deja fuera el camino que el prompt pide**: cifrar primero, mirar el
 * resultado, y vaciar después. En esa segunda pasada el `WHERE
 * notesCifradas: null` ya no encuentra nada, así que el claro se quedaba
 * para siempre.
 *
 * Lo cazó la prueba sobre la copia con datos: `CANARIO-VISITA` desaparecía
 * del `pg_dump` y `CANARIO-FICHA` seguía ahí, cincuenta veces. Sin esa
 * prueba habría llegado al despliegue, y lo que habría pasado es que las
 * notas de las fichas de los pacientes se quedaran en claro en la base y
 * en todas las copias — exactamente lo que el bloque existe para impedir,
 * en la columna que menos se mira.
 *
 * Y verifica antes de borrar, como todo lo demás: es la última
 * oportunidad.
 */
async function vaciarNotas(
  tabla: "appointments" | "clients" | "client_technical_notes",
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  if (!vaciar) return;
  const prisma = getPrisma();

  if (tabla === "appointments") {
    const filas = await prisma.appointment.findMany({
      where: { tenantId, notesCifradas: { not: null }, notes: { not: null } },
      select: { id: true, notes: true, notesCifradas: true },
    });
    for (const fila of filas) {
      verificar(
        fila.notesCifradas!,
        fila.notes!,
        dek,
        sitioNotaDeCita(tenantId, fila.id),
        "appointments.notes (al vaciar)",
      );
      await prisma.appointment.update({
        where: { id: fila.id },
        data: { notes: null },
      });
      total.vaciadas += 1;
    }
    if (filas.length > 0) {
      console.log(`  notas de citas vaciadas · +${filas.length}`);
    }
    return;
  }

  if (tabla === "clients") {
    const filas = await prisma.client.findMany({
      where: { tenantId, notesCifradas: { not: null }, notes: { not: null } },
      select: { id: true, notes: true, notesCifradas: true },
    });
    for (const fila of filas) {
      verificar(
        fila.notesCifradas!,
        fila.notes!,
        dek,
        sitioNotaDeFicha(tenantId, fila.id),
        "clients.notes (al vaciar)",
      );
      await prisma.client.update({
        where: { id: fila.id },
        data: { notes: null },
      });
      total.vaciadas += 1;
    }
    if (filas.length > 0) {
      console.log(`  notas de fichas vaciadas · +${filas.length}`);
    }
    return;
  }

  const filas = await prisma.clientTechnicalNote.findMany({
    where: { tenantId, bodyCifrado: { not: null }, NOT: { body: "" } },
    select: { id: true, body: true, bodyCifrado: true },
  });
  for (const fila of filas) {
    verificar(
      fila.bodyCifrado!,
      fila.body,
      dek,
      sitioNotaTecnica(tenantId, fila.id),
      "client_technical_notes.body (al vaciar)",
    );
    await prisma.clientTechnicalNote.update({
      where: { id: fila.id },
      data: { body: "" },
    });
    total.vaciadas += 1;
  }
  if (filas.length > 0) {
    console.log(`  notas técnicas vaciadas · +${filas.length}`);
  }
}

// ── Y LOS FICHEROS, en su sitio ──────────────────────────────────────
//
// Fotos, consentimientos e informes guardados. Se cifran **en su sitio**
// (se lee, se cifra, se reescribe el mismo fichero) y de forma idempotente:
// `esFicheroCifrado` mira la cabecera `MPC1`, así que un fichero ya cifrado
// se salta.
//
// ── El orden: FICHERO NUEVO, RENOMBRAR, no al revés ─────────────────
//
// Se escribe `<nombre>.cifrando` y después se renombra encima. Un
// `writeFile` directo sobre el original deja el fichero a medias si el
// proceso muere ahí — y un JPEG de una historia clínica a medias no se
// recupera. El renombrado dentro del mismo directorio es atómico en
// POSIX, así que el fichero o es el viejo o es el nuevo.
async function ficherosDelTenant(
  tenantId: string,
  dek: Buffer,
  total: Cuenta,
): Promise<void> {
  const prisma = getPrisma();
  const raiz = loadEnv().CLINICAL_FILES_DIR;

  const lotes: Array<{ clase: "FOTO" | "CONSENTIMIENTO"; nombres: string[] }> = [
    {
      clase: "FOTO",
      nombres: (
        await prisma.clinicalPhoto.findMany({
          where: { tenantId },
          select: { fileName: true },
        })
      ).map((f) => f.fileName),
    },
    {
      clase: "CONSENTIMIENTO",
      nombres: (
        await prisma.clientConsent.findMany({
          where: { tenantId, pdfFileName: { not: null } },
          select: { pdfFileName: true },
        })
      ).map((f) => f.pdfFileName!),
    },
  ];
  // Los informes guardados son de clinica-7 y nacen cifrados, así que no
  // entran: no hay ninguno en claro que migrar. Se deja dicho para que
  // nadie lo lea como un olvido.

  const CARPETA = { FOTO: "fotos", CONSENTIMIENTO: "consentimientos" };

  for (const lote of lotes) {
    let cifrados = 0;
    let saltados = 0;
    for (const nombre of lote.nombres) {
      const ruta = join(raiz, CARPETA[lote.clase], nombre);
      let bytes: Buffer;
      try {
        bytes = await readFile(ruta);
      } catch {
        console.log(`  ⚠ ${lote.clase} ${nombre}: no está en el volumen`);
        continue;
      }
      if (esFicheroCifrado(bytes)) {
        saltados += 1;
        total.yaEstaban += 1;
        continue;
      }
      const sobre = cifrarFichero(
        bytes,
        dek,
        sitioDelFichero({ tenantId, clase: lote.clase, fileName: nombre }),
      );
      const temporal = `${ruta}.cifrando`;
      await writeFile(temporal, sobre);
      const { rename } = await import("node:fs/promises");
      await rename(temporal, ruta);
      cifrados += 1;
      total.cifradas += 1;
    }
    console.log(
      `  ficheros ${lote.clase} · cifrados ${cifrados}, ya estaban ${saltados}`,
    );
  }
}

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
