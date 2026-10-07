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
} as const;

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
    basePrice: 30,
  },
  {
    id: CLINICA.fresado,
    name: "Corte y fresado de uñas",
    sku: "SVC-FRESADO",
    basePrice: 0,
  },
  {
    id: CLINICA.verruga,
    name: "Tratamiento de verruga",
    sku: "SVC-VERRUGA",
    basePrice: 25,
  },
] as const;

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
      name: SERVICIO_VALORACION.name,
      sku: SERVICIO_VALORACION.sku,
      basePrice: 35,
      taxRate: 0,
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
        name: t.name,
        sku: t.sku,
        basePrice: t.basePrice,
        taxRate: 0,
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

  // Y quién da cada servicio: sin la matriz de skills, el motor no las
  // propone y el capítulo no puede reservar. Las dos dan de todo: en una
  // clínica de dos personas, la matriz completa es lo normal.
  for (const userId of [PODOLOGA.id, SANITARIA.id]) {
    for (const serviceId of [
      SERVICIO_VALORACION.id,
      ...TRATAMIENTOS.map((t) => t.id),
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
  ];
  for (const [tabla, trg] of triggers) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${tabla} DISABLE TRIGGER ${trg}`,
    );
  }
  for (const t of [
    "clinical_assessment_corrections",
    "clinical_assessments",
    "clinical_addenda",
    "clinical_entries",
    "clinical_access_log",
    "clinical_access",
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
