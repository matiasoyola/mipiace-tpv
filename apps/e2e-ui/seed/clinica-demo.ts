// clinica-2 · la clínica del banco: un tenant APARTE de la peluquería.
//
// ── Por qué un tenant propio y no la peluquería de siempre ────────────
//
// Porque la peluquería del banco es una peluquería. Encenderle la historia
// clínica para probar la valoración sería probarla sobre un negocio que no
// la tiene, y de paso cambiaría lo que ven los diez capítulos anteriores:
// la ficha de clienta pasaría a tener una pestaña nueva y las citas un
// aviso, en un vídeo que se graba para explicar la agenda de Sole.
//
// Separarlo cuesta este fichero y gana que el capítulo 11 no pueda romper
// los diez de antes — y que los diez de antes sigan siendo la prueba de
// que **la clínica no se le nota a nadie más**, que es lo que el prompt
// del bloque pide («Sole y el resto de tenants no notan nada»).
//
// Se siembra DESPUÉS de la peluquería y no hace `TRUNCATE`: borra lo suyo
// y lo vuelve a crear. Idempotente, como el resto del seed.

import { createHash } from "node:crypto";

import { PrismaClient } from "@mipiacetpv/db";
import argon2 from "argon2";

/** IDs fijos, en el rango 3xxx para no chocar con la peluquería. */
export const CLINICA = {
  tenant: "33333333-3333-4333-8333-333333333331",
  store: "33333333-3333-4333-8333-333333333332",
  register: "33333333-3333-4333-8333-333333333333",
  device: "33333333-3333-4333-8333-333333333334",
  /** La podóloga. Es la DUEÑA y además sanitaria: es el caso del piloto,
   *  y el que demuestra que la marca va separada del rol (clinica-1 §2). */
  podologa: "33333333-3333-4333-8333-333333333341",
  /** La recepcionista: manda el test y abre la tablet, NO lee respuestas. */
  recepcion: "33333333-3333-4333-8333-333333333342",
  paciente: "33333333-3333-4333-8333-333333333351",
  /** El servicio marcado «primera valoración». */
  servicioValoracion: "33333333-3333-4333-8333-333333333361",
  /** clinica-3 · la sanitaria SIN caja: la que no ve importes y no cobra. */
  sanitaria: "33333333-3333-4333-8333-333333333343",
  /** clinica-3 · los tres tratamientos de la sesión, del catálogo. */
  quiropodia: "33333333-3333-4333-8333-333333333362",
  fresado: "33333333-3333-4333-8333-333333333363",
  verruga: "33333333-3333-4333-8333-333333333364",
  /** clinica-5 · los TRES NIVELES de la quiropodia, que son tres productos
   *  (decisión 4). El nivel que la sesión propone elige cuál pasa a caja. */
  basica: "33333333-3333-4333-8333-333333333371",
  completa: "33333333-3333-4333-8333-333333333372",
  extra: "33333333-3333-4333-8333-333333333373",
  /** clinica-5 · la cura de la revisión de cirugía, en la categoría de
   *  cirugía: es la segunda línea del «Pasa a caja» del mockup. */
  cura: "33333333-3333-4333-8333-333333333374",
  /** Y la consulta de pie de riesgo, para que ese tipo tenga cobro. */
  consultaRiesgo: "33333333-3333-4333-8333-333333333375",
} as const;

/**
 * clinica-5 · el mapa `categoría → tipo de visita` del centro (S5).
 *
 * Tres categorías para los tres tipos que el banco recorre. Sin estas
 * filas los servicios no tienen tipo y la sesión no los ofrece en ninguna
 * tarjeta — que es la regla de S5 funcionando, no un fallo del seed.
 */
export const CATEGORIAS_CLINICAS = [
  { slug: "podologia", visitType: "QUIROPODIA" },
  { slug: "cirugia", visitType: "CIRUGIA" },
  { slug: "pie-de-riesgo", visitType: "PIE_RIESGO" },
] as const;

/**
 * clinica-5 · los tres niveles de quiropodia y los dos servicios de los
 * otros tipos.
 *
 * Los precios son los de Rosario (`docs/clinica/decisiones.md`): básica
 * 25 €, completa 26 €, extra 27 €, los mismos 30 minutos. Exentos los
 * cinco, como el resto de lo sanitario.
 */
export const SERVICIOS_POR_TIPO = [
  {
    id: CLINICA.basica,
    name: "Quiropodia básica",
    sku: "SVC-QUIRO-1",
    basePrice: 25,
    tags: ["podologia"],
    nivelQuiropodia: 1,
  },
  {
    id: CLINICA.completa,
    name: "Quiropodia completa",
    sku: "SVC-QUIRO-2",
    basePrice: 26,
    tags: ["podologia"],
    nivelQuiropodia: 2,
  },
  {
    id: CLINICA.extra,
    name: "Quiropodia extra",
    sku: "SVC-QUIRO-3",
    basePrice: 27,
    tags: ["podologia"],
    nivelQuiropodia: 3,
  },
  {
    id: CLINICA.cura,
    name: "Cura",
    sku: "SVC-CURA",
    basePrice: 13,
    tags: ["cirugia"],
    nivelQuiropodia: null,
  },
  {
    id: CLINICA.consultaRiesgo,
    name: "Consulta de pie de riesgo",
    sku: "SVC-RIESGO",
    basePrice: 20,
    tags: ["pie-de-riesgo"],
    nivelQuiropodia: null,
  },
] as const;

export const CLINICA_NOMBRE = "Clínica Podológica Demo";
export const CLINICA_DEVICE_TOKEN = "banco-clinica-dispositivo-0001";
export const CLINICA_PASSWORD = "BancoClinica2026!";
export const CLINICA_PIN = "2468";

export const PODOLOGA = {
  id: CLINICA.podologa,
  email: "lucia@clinicademo.local",
  alias: "Lucía Martín",
  colegiado: "Col. 45-0312",
} as const;

export const RECEPCION = {
  id: CLINICA.recepcion,
  email: "marta@clinicademo.local",
  alias: "Marta",
} as const;

/** clinica-3 · la sanitaria sin caja. `role = CLINICIAN`, que implica la
 *  marca por CHECK de la base. Es la que prueba la regla 8: cierra su
 *  sesión sin ver un importe y la recepción la cobra. */
export const SANITARIA = {
  id: CLINICA.sanitaria,
  email: "ana@clinicademo.local",
  alias: "Ana Sanitaria",
  colegiado: "Col. 45-0999",
} as const;

export const PACIENTE = {
  id: CLINICA.paciente,
  firstName: "Carmen",
  lastName: "Rodríguez López",
  // Un buzón de mentira en un dominio que no resuelve. El email lo recoge
  // el buzón en fichero (`EMAIL_OUTBOX_FILE`), no sale de la máquina.
  email: "carmen@clinicademo.local",
  phone: "600 123 456",
} as const;

export const SERVICIO_VALORACION = {
  id: CLINICA.servicioValoracion,
  name: "Primera visita · valoración",
  sku: "SVC-VALORACION",
  durationMin: 30,
} as const;

/**
 * clinica-3 · los tratamientos de la sesión, con su marca del catálogo.
 *
 * El de 0 € es el que el mockup pinta como «incluido»: en esta casa
 * «incluido» es un precio de 0 en el catálogo, no una marca aparte. Y los
 * tres llevan SKU porque el camino de cobro lo exige en la línea — un
 * servicio sin SKU no sale como botón.
 */
export const TRATAMIENTOS = [
  {
    id: CLINICA.quiropodia,
    name: "Quiropodia",
    sku: "SVC-QUIROPODIA",
    // iva-exento-sanitario · 35 € y EXENTO, que es el ticket del mockup
    // validado el 07-10. Antes eran 30 € sin causa; se cambia porque el
    // escenario del banco tiene que ser el del bloque, y el bloque es
    // exactamente éste: el servicio sanitario de la podóloga sale exento.
    basePrice: 35,
    exemptionCause: "E1" as const,
  },
  {
    id: CLINICA.fresado,
    name: "Corte y fresado de uñas",
    sku: "SVC-FRESADO",
    basePrice: 0,
    // «Incluido» es un precio de 0 en el catálogo, no una marca aparte
    // (clinica-3) — y sigue siendo un acto sanitario, así que exento. En
    // el desglose no se nota (0 € no mueve ningún tramo) y en el papel sí:
    // es una de las líneas que la leyenda ampara.
    exemptionCause: "E1" as const,
  },
  {
    id: CLINICA.verruga,
    name: "Tratamiento de verruga",
    sku: "SVC-VERRUGA",
    basePrice: 25,
    exemptionCause: "E1" as const,
  },
] as const;

/**
 * iva-exento-sanitario · LO QUE LA CLÍNICA VENDE CON IVA.
 *
 * Es la mitad del bloque que no se ve si todo el catálogo está exento: una
 * clínica vende también cremas y plantillas de serie, y el mismo ticket
 * mezcla los dos tramos. Sin esta ficha, el banco sólo podría enseñar el
 * ticket «Sólo sesión» del mockup y nunca el «Sesión + crema».
 *
 * `basePrice` es el NETO de cuatro decimales que persiste el catálogo
 * (`netoDesdeBruto(12, 21)`), igual que lo guardaría el alta del panel.
 */
export const CREMA = {
  id: "33333333-3333-4333-8333-333333333365",
  name: "Crema urea 20%",
  sku: "LOC-CREMA-UREA",
  basePrice: 9.9174,
  taxRate: 21,
} as const;

function hashDeviceToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

/**
 * Siembra la clínica. Borra lo suyo primero, en el orden que las FKs
 * RESTRICT de lo clínico imponen — y que limpiar sea incómodo es, otra
 * vez, la garantía funcionando.
 */
export async function sembrarClinica(prisma: PrismaClient): Promise<void> {
  await borrarClinica(prisma);

  const pinHash = await argon2.hash(CLINICA_PIN, { type: argon2.argon2id });
  const passwordHash = await argon2.hash(CLINICA_PASSWORD, {
    type: argon2.argon2id,
  });

  await prisma.tenant.create({
    data: {
      id: CLINICA.tenant,
      name: CLINICA_NOMBRE,
      businessType: "SERVICES",
      onboardingState: "ACTIVE",
      cajaEnabled: true,
      crmEnabled: true,
      holdedEnabled: false,
      // Las tres encendidas: la clínica EXIGE CRM y agenda (lo comprueba
      // el PATCH del super-admin en clinica-1).
      agendaEnabled: true,
      clinicalRecordsEnabled: true,
      agendaSlotMinutes: 15,
      // iva-exento-sanitario · la CABECERA FISCAL.
      //
      // `holdedEnabled: false` significa que esta clínica EMITE SUS
      // PROPIAS FACTURAS (V1-verifactu): su papel lleva número de serie,
      // QR tributario y registro de facturación. Sin estos tres campos el
      // papel sale con la razón social y el NIF vacíos — que es lo que el
      // banco enseñaba antes de este bloque, y lo que hacía imposible
      // capturar el ticket del mockup.
      //
      // Los datos son de mentira y lo dicen: «Ejemplo», y el NIF es el
      // 00000000T del mockup validado.
      fiscalProfile: {
        legalName: "PODOLOGÍA ROSARIO",
        taxId: "00000000T",
        address: "C/ Ejemplo 1, 45600 Talavera de la Reina",
      },
      stores: {
        create: {
          id: CLINICA.store,
          name: CLINICA_NOMBRE,
          registers: { create: { id: CLINICA.register, name: "Mostrador" } },
        },
      },
    },
  });

  await prisma.device.create({
    data: {
      id: CLINICA.device,
      tenantId: CLINICA.tenant,
      registerId: CLINICA.register,
      name: "Tablet de la sala",
      kind: "TERMINAL",
      deviceTokenHash: hashDeviceToken(CLINICA_DEVICE_TOKEN),
    },
  });

  // La podóloga: OWNER **y sanitaria**, con alcance a todos sus pacientes.
  // Es el caso del piloto (trabaja sola) y el que prueba que la marca
  // decide y el rol no.
  await prisma.user.create({
    data: {
      id: PODOLOGA.id,
      tenantId: CLINICA.tenant,
      email: PODOLOGA.email,
      alias: PODOLOGA.alias,
      role: "OWNER",
      passwordHash,
      pinHash,
      isClinician: true,
      clinicianLicense: PODOLOGA.colegiado,
      clinicalScope: "ALL",
      staffProfile: {
        create: {
          tenantId: CLINICA.tenant,
          displayName: PODOLOGA.alias,
          color: "#e8663c",
        },
      },
    },
  });

  // La recepcionista: cajera y NO sanitaria.
  await prisma.user.create({
    data: {
      id: RECEPCION.id,
      tenantId: CLINICA.tenant,
      email: RECEPCION.email,
      alias: RECEPCION.alias,
      role: "CASHIER",
      pinHash,
      isClinician: false,
    },
  });

  // clinica-3 · la sanitaria SIN caja. Entra al TPV con su PIN como
  // cualquiera, ve sólo su agenda, y de ella no puede nacer un cobro.
  await prisma.user.create({
    data: {
      id: SANITARIA.id,
      tenantId: CLINICA.tenant,
      email: SANITARIA.email,
      alias: SANITARIA.alias,
      role: "CLINICIAN",
      pinHash,
      isClinician: true,
      clinicianLicense: SANITARIA.colegiado,
      clinicalScope: "ALL",
      staffProfile: {
        create: {
          tenantId: CLINICA.tenant,
          displayName: SANITARIA.alias,
          color: "#3c7de8",
        },
      },
    },
  });

  await prisma.client.create({
    data: {
      id: PACIENTE.id,
      tenantId: CLINICA.tenant,
      firstName: PACIENTE.firstName,
      lastName: PACIENTE.lastName,
      email: PACIENTE.email,
      phone: PACIENTE.phone,
    },
  });

  // El servicio, con su extensión de agenda y LA MARCA de primera
  // valoración. Es la pieza que convierte «dar la cita» en «el paciente
  // recibe el test».
  await prisma.product.create({
    data: {
      id: SERVICIO_VALORACION.id,
      tenantId: CLINICA.tenant,
      kind: "SERVICE",
      source: "LOCAL",
      holdedProductId: null,
      name: SERVICIO_VALORACION.name,
      sku: SERVICIO_VALORACION.sku,
      basePrice: 35,
      taxRate: 0,
      // iva-exento-sanitario · la primera visita también es un acto
      // sanitario: exenta por el art. 20.Uno.3º, como los tratamientos.
      exemptionCause: "E1",
      active: true,
      scheduling: {
        create: {
          tenantId: CLINICA.tenant,
          durationMin: SERVICIO_VALORACION.durationMin,
          staffRequired: 1,
          primeraValoracion: true,
          channels: {
            caja: true,
            ticket: true,
            agenda: true,
            online: false,
          },
        },
      },
    },
  });

  // clinica-3 · los tres tratamientos de la sesión, MARCADOS en el
  // catálogo. La marca es lo que hace que salgan como botones, y el precio
  // y el IVA de cada uno son los que pasan a caja.
  for (const t of TRATAMIENTOS) {
    await prisma.product.create({
      data: {
        id: t.id,
        tenantId: CLINICA.tenant,
        kind: "SERVICE",
        // iva-exento-sanitario · `source = LOCAL`, que es lo que una
        // clínica sin Holded tiene de verdad (ADR-017, catalogo-local). El
        // seed los dejaba en el `HOLDED` por defecto y entonces el panel
        // los lista pero NO ofrece editarlos — así que la pantalla que
        // este bloque cambia no se podía ni abrir en el banco.
        source: "LOCAL",
        holdedProductId: null,
        name: t.name,
        sku: t.sku,
        // clinica-5 · la categoría de la que sale el TIPO DE VISITA (S5).
        // Los tres de clinica-3 son de quiropodia, que es lo que eran
        // cuando no había tipos.
        tags: ["podologia"],
        basePrice: t.basePrice,
        // iva-exento-sanitario · exento ⇒ `taxRate = 0` SIEMPRE, y lo
        // garantiza el CHECK `products_exencion_sin_iva`: si alguien
        // cambiara una de las dos cosas aquí, el seed se cae con un error
        // de constraint en vez de sembrar una ficha imposible.
        taxRate: 0,
        exemptionCause: t.exemptionCause,
        active: true,
        scheduling: {
          create: {
            tenantId: CLINICA.tenant,
            durationMin: 30,
            staffRequired: 1,
            tratamientoSesion: true,
            channels: { caja: true, ticket: true, agenda: true, online: false },
          },
        },
      },
    });
  }

  // clinica-5 · el mapa `categoría → tipo de visita` (S5) y los servicios
  // de cada tipo: los tres niveles de quiropodia, la cura de la revisión y
  // la consulta de pie de riesgo.
  //
  // Es lo que hace que el banco pueda recorrer el mockup entero: sin los
  // niveles, la tarjeta de quiropodia propone un nivel y no tiene producto
  // que cobrar; sin la cura, la revisión de cirugía sale «sin cobro».
  for (const c of CATEGORIAS_CLINICAS) {
    await prisma.tagVisitType.create({
      data: {
        tenantId: CLINICA.tenant,
        slug: c.slug,
        visitType: c.visitType,
      },
    });
  }

  for (const s of SERVICIOS_POR_TIPO) {
    await prisma.product.create({
      data: {
        id: s.id,
        tenantId: CLINICA.tenant,
        kind: "SERVICE",
        source: "LOCAL",
        holdedProductId: null,
        name: s.name,
        sku: s.sku,
        tags: [...s.tags],
        basePrice: s.basePrice,
        // Exento ⇒ `taxRate = 0` SIEMPRE (CHECK
        // `products_exencion_sin_iva`): un acto sanitario del art.
        // 20.Uno.3º, como el resto.
        taxRate: 0,
        exemptionCause: "E1",
        active: true,
        scheduling: {
          create: {
            tenantId: CLINICA.tenant,
            durationMin: 30,
            staffRequired: 1,
            tratamientoSesion: true,
            nivelQuiropodia: s.nivelQuiropodia,
            channels: { caja: true, ticket: true, agenda: true, online: false },
          },
        },
      },
    });
  }

  // iva-exento-sanitario · la crema del mostrador, SUJETA al 21 %. No es
  // un tratamiento de sesión (no lleva `scheduling`): se vende por la
  // rejilla del TPV como cualquier producto, y es lo que hace posible el
  // ticket mixto del mockup.
  await prisma.product.create({
    data: {
      id: CREMA.id,
      tenantId: CLINICA.tenant,
      kind: "PRODUCT",
      source: "LOCAL",
      holdedProductId: null,
      name: CREMA.name,
      sku: CREMA.sku,
      basePrice: CREMA.basePrice,
      taxRate: CREMA.taxRate,
      active: true,
    },
  });

  // Y quién da cada servicio: sin la matriz de skills, el motor no las
  // propone y el capítulo no puede reservar. Las dos dan de todo: en una
  // clínica de dos personas, la matriz completa es lo normal.
  for (const userId of [PODOLOGA.id, SANITARIA.id]) {
    for (const serviceId of [
      SERVICIO_VALORACION.id,
      ...TRATAMIENTOS.map((t) => t.id),
      ...SERVICIOS_POR_TIPO.map((s) => s.id),
    ]) {
      await prisma.staffSkill.create({
        data: { tenantId: CLINICA.tenant, userId, serviceId },
      });
    }
  }

  // El horario del centro y el turno de la podóloga, de lunes a sábado y
  // de 9 a 20: así el capítulo encuentra hueco cualquier día en que corra.
  //
  // Esto SÍ se siembra, al contrario que en la peluquería —donde el
  // horario lo configura el capítulo 4 por la pantalla— porque este
  // capítulo no es sobre el horario: es sobre la valoración, y hacerle dar
  // de alta un horario primero sería meterle dentro la prueba de otro
  // bloque.
  const DESDE = new Date("2026-01-01T00:00:00.000Z");
  const DIAS = ["MO", "TU", "WE", "TH", "FR", "SA"] as const;
  for (let weekday = 1; weekday <= 6; weekday++) {
    await prisma.centerHours.create({
      data: {
        tenantId: CLINICA.tenant,
        weekday,
        openTime: "09:00",
        closeTime: "20:00",
        validFrom: DESDE,
      },
    });
    for (const userId of [PODOLOGA.id, SANITARIA.id]) {
      await prisma.staffShift.create({
        data: {
          tenantId: CLINICA.tenant,
          userId,
          kind: "REGULAR",
          rrule: `FREQ=WEEKLY;BYDAY=${DIAS[weekday - 1]}`,
          startTime: "09:00",
          endTime: "20:00",
          validFrom: DESDE,
        },
      });
    }
  }
}

/**
 * Borra la clínica del banco, en el orden que las FKs RESTRICT exigen.
 *
 * Los triggers de lo clínico rechazan el DELETE, así que se desactivan
 * para limpiar — exactamente como hace `clinica-valoracion.e2e.ts`. Es un
 * tenant de mentira en una base desechable; lo que esto demuestra de paso
 * es que **sin desactivar los triggers no se puede borrar una historia**.
 */
export async function borrarClinica(prisma: PrismaClient): Promise<void> {
  const triggers: Array<[string, string]> = [
    [
      "clinical_assessment_corrections",
      "clinical_assessment_corrections_append_only",
    ],
    ["clinical_assessments", "clinical_assessments_guard"],
    ["clinical_entries", "clinical_entries_inmutable"],
    ["clinical_addenda", "clinical_addenda_inmutable"],
    ["clinical_access_log", "clinical_access_log_append_only"],
    ["clinical_access", "clinical_access_guard"],
    // clinica-4 · las tres tablas del bloque: el consentimiento firmado,
    // la foto y la entrega del informe. Las tres cuelgan del tenant con
    // RESTRICT, así que sin borrarlas antes el `DELETE FROM tenants` de
    // abajo se cae con `client_consents_tenant_id_fkey`.
    //
    // **Lo descubrió el bucle visual**, al rehacer la semilla entre dos
    // anchos: el consentimiento firmado en el primero impedía borrar el
    // tenant en el segundo. Es la garantía de S3 funcionando —un tenant
    // con consentimientos no se borra— y lo que hay que arreglar es el
    // seed, no la garantía.
    ["client_consents", "client_consents_append_only"],
    ["clinical_photos", "clinical_photos_guard"],
    ["clinical_report_deliveries", "clinical_report_deliveries_append_only"],
  ];
  for (const [tabla, trg] of triggers) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${tabla} DISABLE TRIGGER ${trg}`,
    );
  }
  // clinica-4 · las REVOCACIONES primero: una fila de revocación apunta a
  // la que revoca con RESTRICT, así que un `DELETE` de toda la tabla de
  // golpe choca contra sí mismo.
  await prisma.$executeRawUnsafe(
    `DELETE FROM client_consents WHERE tenant_id = '${CLINICA.tenant}' AND revokes_consent_id IS NOT NULL`,
  );
  for (const t of [
    "clinical_assessment_corrections",
    "clinical_assessments",
    "clinical_addenda",
    "clinical_entries",
    "clinical_access_log",
    "clinical_access",
    "client_consents",
    "clinical_photos",
    "clinical_report_deliveries",
  ]) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${t} WHERE tenant_id = '${CLINICA.tenant}'`,
    );
  }
  for (const [tabla, trg] of triggers) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${tabla} ENABLE TRIGGER ${trg}`,
    );
  }
  // El resto cae por el CASCADE del tenant, menos los turnos de caja, que
  // apuntan al USUARIO por `shifts_user_id_fkey` y esa FK no cascadea desde
  // el tenant — es la lección que `vaciar()` de la peluquería dejó escrita.
  //
  // Y `shifts` NO TIENE `tenant_id`: cuelga de la caja. Se borra por su
  // caja, que es la del banco de la clínica. (Primera pasada en rojo con
  // «column "tenant_id" does not exist»; el comentario queda para que no
  // se vuelva a escribir por inercia.)
  await prisma.$executeRawUnsafe(
    `DELETE FROM shifts WHERE register_id = '${CLINICA.register}'`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM tenants WHERE id = '${CLINICA.tenant}'`,
  );
}
