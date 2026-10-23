// primer-acceso · LA SIEMBRA DEL BUCLE VISUAL.
//
// Deja la base en el estado del minuto ANTES de activar Jardín de Gredos:
// un super-admin con el que entrar, y la residencia en DRAFT con sus
// datos fiscales puestos y sin propietario.
//
// A partir de ahí la pasada con la cámara hace lo que hace el implantador:
// pulsa «Activar cuenta», lee el correo que sale y sigue el enlace.
//
// Idempotente: borra lo suyo antes de sembrar, así que se puede volver a
// lanzar sin pensar.
//
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx seed/primer-acceso-demo.ts

import * as argon2 from "argon2";
import { PrismaClient } from "@mipiacetpv/db";

import { databaseUrl } from "./base-de-datos.js";

export const TENANT = "99999999-0000-4000-8000-00000000000a";
export const SUPER_ADMIN = {
  email: "implantacion@mipiacetpv.tech",
  password: "ImplantaGredos2026!",
};
export const CARMEN = {
  email: "carmen@jardindegredos.es",
  nombre: "Carmen",
  password: "jardindegredos2026",
};

export async function sembrarPrimerAcceso(prisma: PrismaClient): Promise<void> {
  // Lo de la pasada anterior, fuera. El orden es el de las FK.
  await prisma.$executeRawUnsafe(
    `DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '${TENANT}')`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM super_admin_audits WHERE tenant_id = '${TENANT}'`,
  );
  // La tabla del contrato es de SOLO INSERCIÓN y un trigger lo hace
  // cumplir — que es justo lo que el bloque clinica-7 promete. Para
  // volver a sembrar el minuto anterior al alta hay que apartarlo, igual
  // que `capturas-residencia5.ts` aparta los del relevo. Se vuelve a
  // poner siempre, incluso si el borrado falla.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE clinical_processor_agreements DISABLE TRIGGER clinical_processor_agreements_append_only`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_processor_agreements WHERE tenant_id = '${TENANT}'`,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_processor_agreements ENABLE TRIGGER clinical_processor_agreements_append_only`,
    );
  }
  // Y la clave de la clínica tiene su propio guardián, por la misma
  // razón: una clave que se puede borrar sin rastro no prueba nada.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE clinical_tenant_keys DISABLE TRIGGER clinical_tenant_keys_guard`,
  );
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM clinical_tenant_keys WHERE tenant_id = '${TENANT}'`,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE clinical_tenant_keys ENABLE TRIGGER clinical_tenant_keys_guard`,
    );
  }
  // Los residentes de la pasada anterior y su rastro. El orden es el de
  // las FK: el perfil cuelga del cliente, y el cliente del tenant.
  await prisma.$executeRawUnsafe(
    `DELETE FROM clinical_access_log WHERE tenant_id = '${TENANT}'`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM resident_profiles WHERE tenant_id = '${TENANT}'`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = '${TENANT}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE tenant_id = '${TENANT}'`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM care_role_assignments WHERE tenant_id = '${TENANT}'`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM care_roles WHERE tenant_id = '${TENANT}'`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM center_shifts WHERE tenant_id = '${TENANT}'`,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${TENANT}'`);

  // La residencia, en DRAFT y lista: sin caja y sin Holded, así que los
  // únicos checks de salud que aplican son los dos de siempre (un módulo
  // encendido y los datos fiscales). Es la forma real de estas cuentas.
  await prisma.$executeRawUnsafe(
    `INSERT INTO tenants
       (id, name, onboarding_state, caja_enabled, holded_enabled, crm_enabled,
        agenda_enabled, residencia_enabled, clinical_records_enabled,
        initial_sync_status, fiscal_profile, updated_at)
     VALUES
       ('${TENANT}', 'Jardín de Gredos', 'DRAFT', false, false, true,
        true, true, true, 'NOT_APPLICABLE',
        '{"legalName":"Jardín de Gredos, S.A.","taxId":"B86543217","address":"Ctra. de Ávila 14, 05120 El Barco"}'::jsonb,
        now())`,
  );

  const existe = await prisma.superAdminUser.findUnique({
    where: { email: SUPER_ADMIN.email },
  });
  if (!existe) {
    await prisma.superAdminUser.create({
      data: {
        email: SUPER_ADMIN.email,
        passwordHash: await argon2.hash(SUPER_ADMIN.password, {
          type: argon2.argon2id,
        }),
      },
    });
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await sembrarPrimerAcceso(prisma);
    console.log(`Sembrado: Jardín de Gredos en DRAFT (tenant ${TENANT}).`);
    console.log(`Super-admin: ${SUPER_ADMIN.email} / ${SUPER_ADMIN.password}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Sólo cuando se lanza a mano, no al importarlo desde la pasada.
if (process.argv[1]?.endsWith("primer-acceso-demo.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
