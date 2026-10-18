// residencia-3 · EL CENTRO DE PRUEBA PARA EL BUCLE VISUAL.
//
// Siembra Jardín de Gredos en la base de desarrollo de este worktree: el
// centro, la dirección, una auxiliar con su PIN, la primera planta, la
// 112 con dos camas ocupadas, el plan de cada residente, la tablet de la
// puerta y la foto de doña Carmen con su consentimiento de imagen.
//
// ── Por qué está en el repo y no en el scratchpad ───────────────────
//
// Porque lo que siembra es **el escenario del cliente cero** y el día que
// alguien quiera volver a ver las seis pantallas tiene que poder hacerlo
// sin reconstruirlo de memoria. Es el mismo criterio con el que el banco
// de la agenda tiene sus `seed/*.ts` en el repo.
//
// Y es **idempotente por ids fijos**: se puede correr dos veces. Los ids
// llevan `9` delante para que se vean de lejos que son de prueba.
//
// No corre en ningún arranque ni en ninguna suite: se llama a mano.
//
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/sembrar-gredos.ts

import { randomUUID } from "node:crypto";

import { PrismaClient } from "@mipiacetpv/db";

import { hashPassword } from "../auth/passwords.js";
import { asegurarDek } from "../clinica/claves.js";
import {
  huellaDePinDePuerta,
  subclaveDePinDePuerta,
} from "../clinica/cripto.js";
import { guardarFichero, MIME_DE_FOTO } from "../clinica/ficheros.js";
import { cifrarTexto, sitioDniDeResidente } from "../clinica/cripto-campos.js";
import { hashDeviceToken } from "../devices/auth.js";
import { sembrarResidencia } from "../residencia/semilla.js";
import { cargarCatalogoDeSerie } from "../residencia/catalogo/cargar-catalogo.js";
import { cargarPlantillaDeGravedad } from "../residencia/catalogo/cargar-plantilla.js";
import { aplicarPlantilla } from "../residencia/plan.js";

const T = "99999999-0000-4000-8000-000000000001";
const DIRECCION = "99999999-0000-4000-8000-000000000010";
const ANA = "99999999-0000-4000-8000-000000000011";
const ROSA = "99999999-0000-4000-8000-000000000012";
const PLANTA = "99999999-0000-4000-8000-000000000020";
const HAB = "99999999-0000-4000-8000-000000000030";
const CAMA_A = "99999999-0000-4000-8000-000000000040";
const CAMA_B = "99999999-0000-4000-8000-000000000041";
const CARMEN = "99999999-0000-4000-8000-000000000050";
const LUIS = "99999999-0000-4000-8000-000000000051";
const TABLET = "99999999-0000-4000-8000-000000000060";
// residencia-4 (D-66) · los dos móviles de guardia y la médica que pauta
// las excepciones de umbral.
const MOVIL_ENFERMERIA = "99999999-0000-4000-8000-000000000061";
const MOVIL_RESPONSABLE = "99999999-0000-4000-8000-000000000062";
const SOTO = "99999999-0000-4000-8000-000000000013";

/** El token de la tablet y el PIN de la auxiliar. Son de prueba y están
 *  escritos aquí porque el bucle visual los teclea. */
export const TOKEN_DE_LA_PUERTA = "gredos-puerta-112-0001-0001-0001";
export const PIN_DE_ANA = "4071";
export const PIN_DE_ROSA = "9182";
/** residencia-4 · la dirección y la médica también tienen PIN: una para
 *  coger el móvil de responsable, la otra para pautar una excepción. */
export const PIN_DE_PILAR = "3344";
export const PIN_DE_SOTO = "5566";
export const CLAVE_DE_DIRECCION = "Gredos2026!";
/** Y los tokens de los dos móviles de guardia. */
export const TOKEN_DE_ENFERMERIA = "gredos-guardia-enf-0001-0001-0001";
export const TOKEN_DE_RESPONSABLE = "gredos-guardia-dir-0001-0001-0001";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL! } },
});

/** Un JPEG de verdad, generado aquí: un degradado de 240×240 en un solo
 *  MCU por bloque. No es una cara —no se siembra la foto de nadie— y sirve
 *  para ver que el hueco de la foto se pinta y que el cifrado funciona. */
function jpegDePrueba(): Buffer {
  // Un JPEG de 240×240 en gris liso, generado una vez con `sips` y pegado
  // aquí en base64. **No es la cara de nadie**: la foto de un residente no
  // se siembra, se sube desde su ficha. Lo que esto permite ver es que el
  // hueco se pinta, que el fichero del volumen nace cifrado y que sin
  // consentimiento la puerta enseña las iniciales en vez de la imagen.
  return Buffer.from(
      "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAA" +
      "AAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAA8KADAAQAAAABAAAA8AAAAAD/7QA4UGhvdG9z" +
      "aG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgA" +
      "8ADwAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIB" +
      "AwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYX" +
      "GBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeI" +
      "iYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn" +
      "6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIB" +
      "AgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDTh" +
      "JfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWG" +
      "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm" +
      "5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgK" +
      "CgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQ" +
      "EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAD//aAAwD" +
      "AQACEQMRAD8A/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKK" +
      "KKACiiigAooooAKKKKACiiigD//Q/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKK" +
      "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//R/TSiiivYOMKKKKACiiigAooooAKK" +
      "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//S/TSiiivYOMKK" +
      "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
      "D//T/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
      "AooooAKKKKACiiigD//U/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
      "AooooAKKKKACiiigAooooAKKKKACiiigD//V/TSiiivYOMKKKKACiiigAooooAKKKKACiiig" +
      "AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//W/TSiiivYOMKKKKACiiig" +
      "AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//X/TSi" +
      "iivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKK" +
      "KKACiiigD//Q/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKK" +
      "KKACiiigAooooAKKKKACiiigD//R/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKK" +
      "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//S/TSiiivYOMKKKKACiiigAooooAKK" +
      "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//T/TSiiivYOMKK" +
      "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
      "D//U/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
      "AooooAKKKKACiiigD//V/TSiiivYOMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
      "AooooAKKKKACiiigAooooAKKKKACiiigD//Z",
    "base64",
  );
}

async function main(): Promise<void> {
  await cargarCatalogoDeSerie();
  // residencia-4 (D-65) · la plantilla de gravedad. Sin ella el centro
  // registra constantes y no gradúa nada, que es justo lo que la
  // pantalla de la guardia avisa con «versión 0».
  await cargarPlantillaDeGravedad();

  await prisma.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, residencia_enabled, clinical_records_enabled,
       crm_enabled, agenda_enabled, caja_enabled, updated_at)
     VALUES ('${T}', 'Jardín de Gredos', true, true, true, true, false, now())
     ON CONFLICT (id) DO UPDATE SET residencia_enabled = true,
       clinical_records_enabled = true, caja_enabled = false`,
  );

  const clave = await hashPassword(CLAVE_DE_DIRECCION);
  for (const [id, alias, email, rol] of [
    [DIRECCION, "Pilar", "pilar@gredos.local", "OWNER"],
    [ANA, "Ana López", "ana@gredos.local", "CLINICIAN"],
    [ROSA, "Rosa (DUE)", "rosa@gredos.local", "CLINICIAN"],
    // residencia-4 · la médica. Es la única que puede pautar una
    // excepción de umbral (D-22).
    [SOTO, "Dra. Soto", "soto@gredos.local", "CLINICIAN"],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, tenant_id, email, alias, role, password_hash, is_clinician, clinical_scope)
       VALUES ('${id}', '${T}', '${email}', '${alias}', '${rol}', '${clave}', true, 'SELECTION')
       ON CONFLICT (id) DO UPDATE SET alias = '${alias}', password_hash = '${clave}', is_clinician = true`,
    );
  }

  await sembrarResidencia(prisma as never, T);

// El edificio ANTES de las zonas: la zona apunta a una planta con una FK,
  // y sembrarla primero daba `care_zone_assignments_floor_id_fkey`.
  await prisma.$executeRawUnsafe(
    `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
     VALUES ('${PLANTA}', '${T}', 'Primera', 1, now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO rooms (id, tenant_id, floor_id, number, name, active, updated_at)
     VALUES ('${HAB}', '${T}', '${PLANTA}', '112', NULL, true, now())
     ON CONFLICT (id) DO NOTHING`,
  );
  for (const [id, label] of [
    [CAMA_A, "A"],
    [CAMA_B, "B"],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
       VALUES ('${id}', '${T}', '${HAB}', '${label}', true, now())
       ON CONFLICT (id) DO NOTHING`,
    );
  }

  for (const [u, code] of [
    [DIRECCION, "DIRECCION"],
    [ANA, "AUXILIAR"],
    [ROSA, "DUE"],
  ] as const) {
    const ya = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM care_role_assignments a
       JOIN care_roles r ON r.id = a.care_role_id
       WHERE a.tenant_id = '${T}' AND a.user_id = '${u}' AND r.code = '${code}'
         AND a.revoked_at IS NULL`,
    );
    if (Number(ya[0]!.n) > 0) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_role_assignments (id, tenant_id, user_id, care_role_id, from_at, granted_by_user_id)
       SELECT '${randomUUID()}', '${T}', '${u}', id, now() - interval '400 days', '${DIRECCION}'
       FROM care_roles WHERE tenant_id = '${T}' AND code = '${code}'`,
    );
  }
  // Ana cubre la PRIMERA planta y nada más (D-51).
  await prisma.$executeRawUnsafe(
    `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
     SELECT '${randomUUID()}', '${T}', '${ANA}', '${PLANTA}', now() - interval '400 days', '${DIRECCION}'
     WHERE NOT EXISTS (
       SELECT 1 FROM care_zone_assignments
       WHERE tenant_id = '${T}' AND user_id = '${ANA}' AND to_at IS NULL)`,
  );
  // El contrato de encargado, aceptado: sin él la historia es solo lectura.
  const contrato = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM clinical_processor_agreements WHERE tenant_id = '${T}'`,
  );
  if (Number(contrato[0]!.n) === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, at)
       VALUES ('${randomUUID()}', '${T}', 1, '${"a".repeat(64)}', '${DIRECCION}', now())`,
    );
  }

  const dek = await asegurarDek(T, prisma);

  for (const [id, nombre, apellido, cama] of [
    [CARMEN, "Carmen", "Gómez Ruiz", CAMA_A],
    [LUIS, "Luis", "Núñez Bravo", CAMA_B],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, first_name, last_name, updated_at)
       VALUES ('${id}', '${T}', '${nombre}', '${apellido}', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    const dni = cifrarTexto("00000000T", dek, sitioDniDeResidente(T, id));
    await prisma.$executeRawUnsafe(
      `INSERT INTO resident_profiles (client_id, tenant_id, admission_date,
         dependency_level, place_type, responsible_name, responsible_relation,
         dni_cifrado, updated_at)
       VALUES ('${id}', '${T}', DATE '2024-03-12', 'DEPENDIENTE', 'CONCERTADA',
               'Marta Gómez', 'hija', '${dni}', now())
       ON CONFLICT (client_id) DO NOTHING`,
    );
    const ocupa = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM bed_assignments WHERE client_id = '${id}' AND to_at IS NULL`,
    );
    if (Number(ocupa[0]!.n) === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO bed_assignments (id, tenant_id, bed_id, client_id, from_at)
         VALUES ('${randomUUID()}', '${T}', '${cama}', '${id}', now() - interval '400 days')`,
      );
    }
    const plan = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM care_plan_items WHERE client_id = '${id}' AND to_at IS NULL`,
    );
    if (Number(plan[0]!.n) === 0) {
      await aplicarPlantilla(prisma as never, {
        tenantId: T,
        clientId: id,
        nivel: "DEPENDIENTE",
        nivelAnterior: null,
        desde: new Date(Date.now() - 400 * 24 * 3600_000),
        userId: DIRECCION,
        motivo: "alta",
        dek,
      });
    }
  }

  // ── La foto de doña Carmen y su consentimiento de imagen (D-64) ─────
  const yaFoto = await prisma.$queryRawUnsafe<
    Array<{ photo_file_name: string | null }>
  >(`SELECT photo_file_name FROM resident_profiles WHERE client_id = '${CARMEN}'`);
  if (!yaFoto[0]?.photo_file_name) {
    const guardado = await guardarFichero("RESIDENTE", jpegDePrueba(), {
      tenantId: T,
      dek,
    });
    await prisma.$executeRawUnsafe(
      `UPDATE resident_profiles SET photo_file_name = '${guardado.fileName}',
         photo_sha256 = '${guardado.sha256}', photo_bytes = ${guardado.bytes},
         photo_mime_type = '${MIME_DE_FOTO}', photo_uploaded_at = now(),
         photo_uploaded_by_user_id = '${DIRECCION}'
       WHERE client_id = '${CARMEN}'`,
    );
  }
  const yaConsent = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*) AS n FROM client_consents WHERE client_id = '${CARMEN}' AND kind = 'IMAGE'`,
  );
  if (Number(yaConsent[0]!.n) === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO client_consents (id, tenant_id, client_id, kind, clinical,
         signer, signer_name, signer_relation, created_by_user_id)
       VALUES ('${randomUUID()}', '${T}', '${CARMEN}', 'IMAGE', false,
               'REPRESENTANTE', 'Marta Gómez', 'hija', '${DIRECCION}')`,
    );
  }
  // A Luis **no** se le pone consentimiento, a propósito: así la pantalla
  // en reposo enseña los dos casos del mockup a la vez — la foto de una y
  // las iniciales del otro.

  // ── Los PIN de la puerta ───────────────────────────────────────────
  const subclave = subclaveDePinDePuerta(dek, T);
  for (const [u, pin] of [
    [ANA, PIN_DE_ANA],
    [ROSA, PIN_DE_ROSA],
    [DIRECCION, PIN_DE_PILAR],
    [SOTO, PIN_DE_SOTO],
  ] as const) {
    const hash = await hashPassword(pin);
    const lookup = huellaDePinDePuerta(pin, subclave, T);
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_pins (user_id, tenant_id, pin_hash, pin_lookup, set_by_user_id, updated_at)
       VALUES ('${u}', '${T}', '${hash}', '${lookup}', '${DIRECCION}', now())
       ON CONFLICT (user_id) DO UPDATE SET pin_hash = '${hash}', pin_lookup = '${lookup}', updated_at = now()`,
    );
  }

  // ── La tablet de la 112 ────────────────────────────────────────────
  // Primero el UPDATE y sólo si no estaba el INSERT, y **no un
  // `ON CONFLICT DO UPDATE`**: `devices` lleva el trigger
  // `devices_revoke_previous`, que al insertar REVOCA la puerta anterior
  // de esa habitación — o sea toca otra fila de la misma tabla en la misma
  // sentencia, y Postgres contesta «ON CONFLICT DO UPDATE command cannot
  // affect row a second time». Es el relevo de residencia-1 funcionando.
  const yaTablet = await prisma.$executeRawUnsafe(
    `UPDATE devices SET device_token_hash = '${hashDeviceToken(TOKEN_DE_LA_PUERTA)}',
       revoked_at = NULL, name = 'Puerta 112'
     WHERE id = '${TABLET}'`,
  );
  if (yaTablet === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${TABLET}', '${T}', 'ROOM', '${HAB}', NULL, 'Puerta 112',
               '${hashDeviceToken(TOKEN_DE_LA_PUERTA)}')`,
    );
  }

  // ── residencia-4 · LOS DOS MÓVILES DE GUARDIA (D-66) ──────────────
  //
  // Sin `ON CONFLICT DO UPDATE` por lo mismo que la tablet: `devices`
  // lleva el trigger `devices_revoke_previous`. Un `GUARD` no releva a
  // nadie —el trigger filtra `TERMINAL`— pero el patrón se mantiene
  // igual para que los dos sitios se lean igual.
  for (const [id, canal, nombre, token] of [
    [MOVIL_ENFERMERIA, "ENFERMERIA", "Móvil de enfermería", TOKEN_DE_ENFERMERIA],
    [MOVIL_RESPONSABLE, "RESPONSABLE", "Móvil de dirección", TOKEN_DE_RESPONSABLE],
  ] as const) {
    const ya = await prisma.$executeRawUnsafe(
      `UPDATE devices SET device_token_hash = '${hashDeviceToken(token)}',
         revoked_at = NULL, name = '${nombre}', guard_channel = '${canal}'
       WHERE id = '${id}'`,
    );
    if (ya === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, guard_channel, name, device_token_hash)
         VALUES ('${id}', '${T}', 'GUARD', NULL, NULL, '${canal}', '${nombre}',
                 '${hashDeviceToken(token)}')`,
      );
    }
  }

  // ── Y el servicio sanitario de guardia del centro (D-33) ──────────
  //
  // El teléfono es el 112 a propósito: es un número real que no despierta
  // a nadie si alguien toca el botón por error en una demo, y deja claro
  // en la captura que lo que abre es el marcador.
  await prisma.$executeRawUnsafe(
    `INSERT INTO center_guard_settings (tenant_id, escalation_minutes, health_service_name, health_service_phone, updated_at)
     VALUES ('${T}', 5, 'Centro de Salud de Buenaventura', '112', now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       escalation_minutes = 5,
       health_service_name = 'Centro de Salud de Buenaventura',
       health_service_phone = '112',
       updated_at = now()`,
  );

  // ── Una línea MEASURE en el plan de Carmen ────────────────────────
  //
  // Para que «lo que toca» enseñe el botón «Tomar» además de los
  // «Hecho»: sin una línea de constante en el plan, la pantalla de la
  // puerta no tendría dónde enseñarlo y sólo se vería el «+ Constante».
  const yaTemperatura = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM care_plan_items
     WHERE client_id = '${CARMEN}' AND control_code = 'TEMPERATURA' AND to_at IS NULL`,
  );
  if (Number(yaTemperatura[0]?.n ?? 0) === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_plan_items (id, tenant_id, client_id, control_code,
          frequency_kind, shift_codes, from_at, source, created_by_user_id)
       VALUES ('${randomUUID()}', '${T}', '${CARMEN}', 'TEMPERATURA',
               'EVERY_SHIFT', ARRAY['M','T','N'], now() - interval '30 days',
               'MANUAL', '${DIRECCION}')`,
    );
  }

  console.log(
    [
      "Jardín de Gredos sembrado.",
      `  tenant            ${T}`,
      `  dirección         pilar@gredos.local / ${CLAVE_DE_DIRECCION}`,
      `  PIN de Ana        ${PIN_DE_ANA}   (auxiliar, primera planta)`,
      `  PIN de Rosa       ${PIN_DE_ROSA}   (DUE, todo el centro)`,
      `  token de la 112   ${TOKEN_DE_LA_PUERTA}`,
      `  habitación        112 · Carmen Gómez Ruiz (con foto) y Luis Núñez Bravo (sin consentimiento)`,
      `  PIN de Pilar      ${PIN_DE_PILAR}   (dirección, el móvil de responsable)`,
      `  PIN de la médica  ${PIN_DE_SOTO}   (la única que pauta un umbral)`,
      `  móvil enfermería  ${TOKEN_DE_ENFERMERIA}`,
      `  móvil dirección   ${TOKEN_DE_RESPONSABLE}`,
    ].join("\n"),
  );
  await prisma.$disconnect();
}

await main();
