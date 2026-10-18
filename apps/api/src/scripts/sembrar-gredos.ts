// residencia-3 · EL CENTRO DE PRUEBA PARA EL BUCLE VISUAL.
//
// Siembra Jardín de Gredos en la base de desarrollo de este worktree: el
// centro, la dirección, una auxiliar con su PIN, la primera planta, la
// 112 con dos camas ocupadas, el plan de cada residente, la tablet de la
// puerta y la foto de doña Carmen con su consentimiento de imagen.
//
// ── residencia-5 le añade el escenario del RELEVO ───────────────────
//
// Una segunda planta con un residente (para que haya DOS zonas y se vea
// que la auxiliar de la primera no ve la segunda), **el día de ayer con
// sus tres turnos cerrados** y lo que pasó en cada uno, los tres partes
// congelados, uno confirmado y otro no, un añadido tardío, la plantilla
// de obligaciones cargada con una vencida y la tablet de la sala.
//
// La segunda planta es lo que hace falta para fotografiar la mitad del
// bloque: sin ella, «cada zona con contenido necesita su confirmación» no
// se puede ver en una captura.
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
import {
  cifrarJson,
  cifrarTexto,
  sitioDescripcionDeIncidencia,
  sitioDniDeResidente,
  sitioNotaDeRegistro,
  sitioValorDeRegistro,
} from "../clinica/cripto-campos.js";
import { hashDeviceToken } from "../devices/auth.js";
import { sembrarResidencia } from "../residencia/semilla.js";
// residencia-5 · el escenario del relevo: los partes congelados, lo que
// llegó tarde y las obligaciones. Se llaman las MISMAS funciones que la
// pasada programada, no un SQL a mano: así lo que se fotografía es el
// producto y no una maqueta.
import {
  anotarLoQueLlegoTarde,
  congelarParte,
  ventanaDelTurno,
} from "../residencia/relevo.js";
import { cargarPlantillaDeObligaciones } from "../residencia/obligaciones.js";
// La hora de pared del centro, que es la del paquete puro: sembrar «las
// 10:40 de ayer» con `setHours` sobre un UTC se va una o dos horas según
// el mes, y entonces la caída sale en otro turno.
import { wallTimeToUtc } from "@mipiacetpv/residencia-plan";
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
// residencia-5 (D-67) · la segunda planta, su habitación y su residente,
// la tablet de la sala y la auxiliar que la cubre.
const PLANTA_2 = "99999999-0000-4000-8000-000000000021";
const HAB_201 = "99999999-0000-4000-8000-000000000031";
const CAMA_201 = "99999999-0000-4000-8000-000000000042";
const ANTONIO = "99999999-0000-4000-8000-000000000052";
const TABLET_SALA = "99999999-0000-4000-8000-000000000063";
const MARI = "99999999-0000-4000-8000-000000000014";

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
/** residencia-5 · la tablet de la sala y la auxiliar de la segunda
 *  planta, que es la que demuestra que no ve la primera. */
export const TOKEN_DE_LA_SALA = "gredos-sala-relevo-0001-0001-001";
export const PIN_DE_MARI = "7788";

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
    // residencia-5 · la auxiliar de la SEGUNDA planta. Existe para que se
    // pueda ver que no ve la primera.
    [MARI, "Mari Carmen", "mari@gredos.local", "CLINICIAN"],
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

  // ── residencia-5 · LA SEGUNDA PLANTA ──────────────────────────────
  //
  // Dos zonas y no una, y es lo que hace fotografiable la mitad del
  // bloque: «cada zona con contenido necesita una confirmación de quien la
  // cubre» no se ve con una sola planta.
  await prisma.$executeRawUnsafe(
    `INSERT INTO floors (id, tenant_id, name, sort_order, updated_at)
     VALUES ('${PLANTA_2}', '${T}', 'Segunda', 2, now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO rooms (id, tenant_id, floor_id, number, name, active, updated_at)
     VALUES ('${HAB_201}', '${T}', '${PLANTA_2}', '201', NULL, true, now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO beds (id, tenant_id, room_id, label, active, updated_at)
     VALUES ('${CAMA_201}', '${T}', '${HAB_201}', 'A', true, now())
     ON CONFLICT (id) DO NOTHING`,
  );

  for (const [u, code] of [
    [DIRECCION, "DIRECCION"],
    [ANA, "AUXILIAR"],
    [ROSA, "DUE"],
    [MARI, "AUXILIAR"],
    [SOTO, "MEDICO"],
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
  // Ana cubre la PRIMERA planta y nada más (D-51); Mari Carmen, la
  // segunda. Es el par que demuestra el recorte por zona.
  for (const [u, planta] of [
    [ANA, PLANTA],
    [MARI, PLANTA_2],
  ] as const) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_zone_assignments (id, tenant_id, user_id, floor_id, from_at, granted_by_user_id)
       SELECT '${randomUUID()}', '${T}', '${u}', '${planta}', now() - interval '400 days', '${DIRECCION}'
       WHERE NOT EXISTS (
         SELECT 1 FROM care_zone_assignments
         WHERE tenant_id = '${T}' AND user_id = '${u}' AND to_at IS NULL)`,
    );
  }
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
    // residencia-5 · el de la segunda planta.
    [ANTONIO, "Antonio", "Vela Prieto", CAMA_201],
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
    [MARI, PIN_DE_MARI],
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

  // ══ residencia-5 · EL ESCENARIO DEL RELEVO ═══════════════════════
  //
  // AYER, con sus tres turnos cerrados. Se siembra ayer y no hoy por una
  // razón: un turno que no ha acabado no tiene parte congelado, y lo que
  // hay que poder ver es el parte congelado.
  await sembrarLaTabletDeLaSala();
  await sembrarElDiaDeAyer(dek);
  await sembrarLasObligaciones();

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
      `  tablet de la sala ${TOKEN_DE_LA_SALA}`,
      `  PIN de Mari       ${PIN_DE_MARI}   (auxiliar, SEGUNDA planta)`,
      "  relevo            tres partes de ayer: mañana CONFIRMADO, tarde y noche sin confirmar",
      "  obligaciones      el catálogo del bloque C cargado, con una vencida",
    ].join("\n"),
  );
  await prisma.$disconnect();
}

// ── residencia-5 · LA TABLET DE LA SALA (D-67) ──────────────────────
//
// Sin `ON CONFLICT DO UPDATE`, por lo mismo que la tablet de la puerta y
// los móviles de guardia: `devices` lleva el trigger
// `devices_revoke_previous`, que toca otra fila de la misma tabla en la
// misma sentencia y hace que Postgres conteste «ON CONFLICT DO UPDATE
// command cannot affect row a second time».
async function sembrarLaTabletDeLaSala(): Promise<void> {
  const ya = await prisma.$executeRawUnsafe(
    `UPDATE devices SET device_token_hash = '${hashDeviceToken(TOKEN_DE_LA_SALA)}',
       revoked_at = NULL, name = 'Tablet de la sala'
     WHERE id = '${TABLET_SALA}'`,
  );
  if (ya === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO devices (id, tenant_id, kind, room_id, register_id, name, device_token_hash)
       VALUES ('${TABLET_SALA}', '${T}', 'HANDOVER', NULL, NULL, 'Tablet de la sala',
               '${hashDeviceToken(TOKEN_DE_LA_SALA)}')`,
    );
  }
}

/**
 * **AYER, CON SUS TRES TURNOS.** Lo que pasó en cada uno, los tres partes
 * congelados, uno confirmado y un añadido tardío.
 *
 * Idempotente: si ya hay un parte de ayer, no hace nada. Correr el
 * sembrador dos veces no duplica el escenario — y no podría aunque
 * quisiera, porque `congelarParte` se apoya en el índice único.
 */
async function sembrarElDiaDeAyer(dek: Buffer): Promise<void> {
  const ayer = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const yaHay = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM handovers WHERE tenant_id = '${T}' AND care_day = '${ayer}'`,
  );
  if (Number(yaHay[0]?.n ?? 0) > 0) return;

  const turnos = await prisma.centerShift.findMany({
    where: { tenantId: T },
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
  });
  const porCodigo = new Map(turnos.map((t) => [t.code, t]));
  const manana = porCodigo.get("M")!;
  const tarde = porCodigo.get("T")!;
  const noche = porCodigo.get("N")!;

  const roles = await prisma.careRoleAssignment.findMany({
    where: { tenantId: T, revokedAt: null },
    select: { id: true, userId: true, careRole: { select: { code: true } } },
  });
  const rolDe = (userId: string): string =>
    roles.find((r) => r.userId === userId)!.id;

  const controles = await prisma.controlType.findMany({
    where: {
      supersededAt: null,
      code: { in: ["CAMBIO_POSTURAL", "TEMPERATURA", "ALGO_NO_VA_BIEN"] },
    },
    select: { id: true, code: true, unit: true },
  });
  const controlDe = (code: string) => controles.find((c) => c.code === code)!;

  /** La hora de pared de ayer como instante UTC. */
  function aLas(hora: string): Date {
    return wallTimeToUtc(ayer, hora);
  }

  /** Un registro de cuidados, como lo escribe la puerta. */
  async function registro(input: {
    clientId: string;
    code: string;
    turnoId: string;
    hora: string;
    valor: Record<string, unknown>;
    nota?: string;
    /** Puesto cuando el registro llegó TARDE: la hora en que subió. */
    recibidoEn?: Date;
  }): Promise<string> {
    const control = controlDe(input.code);
    const id = randomUUID();
    const cuando = aLas(input.hora);
    const valor = cifrarJson(input.valor, dek, sitioValorDeRegistro(T, id));
    const nota =
      input.nota == null ? null : cifrarTexto(input.nota, dek, sitioNotaDeRegistro(T, id));
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
         value_cifrado, note_cifrado, recorded_by_user_id, care_role_assignment_id, device_id,
         recorded_at, received_at, center_shift_id, care_day)
       VALUES ('${id}', '${T}', '${input.clientId}', '${control.id}', '${input.code}',
               '${valor}', ${nota == null ? "NULL" : `'${nota}'`},
               '${ANA}', '${rolDe(ANA)}', '${TABLET}',
               '${cuando.toISOString()}',
               '${(input.recibidoEn ?? cuando).toISOString()}',
               '${input.turnoId}', '${ayer}')
       ON CONFLICT DO NOTHING`,
    );
    return id;
  }

  /** Una incidencia del libro, como la declara la puerta. */
  async function incidencia(input: {
    clientId: string | null;
    tipo: string;
    nivel: string;
    turnoId: string;
    hora: string;
    descripcion: string;
    abierta: boolean;
    subject?: string;
  }): Promise<string> {
    const id = randomUUID();
    const cuando = aLas(input.hora);
    const descripcion = cifrarTexto(
      input.descripcion,
      dek,
      sitioDescripcionDeIncidencia(T, id),
    );
    const cierre = input.abierta
      ? "NULL, NULL, NULL, false, true"
      : `'${cuando.toISOString()}', '${DIRECCION}', '${rolDe(DIRECCION)}', false, false`;
    await prisma.$executeRawUnsafe(
      // `created_at` EXPLÍCITO, y no el `now()` por omisión: es lo que
      // `anotarLoQueLlegoTarde` compara contra el instante de congelado
      // para decidir si algo «llegó después del relevo». Con el default,
      // todo lo que este sembrador escribe habría salido como añadido
      // tardío — que es justo lo que pasó la primera vez.
      `INSERT INTO incidents (id, tenant_id, subject, client_id, origin, incident_type,
         severity, template_version, description_cifrado, opened_at, created_at,
         opened_by_user_id,
         opened_by_care_role_assignment_id, center_shift_id, care_day,
         closed_at, closed_by_user_id, closed_by_care_role_assignment_id, self_closed, open)
       VALUES ('${id}', '${T}', '${input.subject ?? "RESIDENT"}',
               ${input.clientId == null ? "NULL" : `'${input.clientId}'`},
               'DECLARED', '${input.tipo}', '${input.nivel}', 1,
               ${descripcion == null ? "NULL" : `'${descripcion}'`},
               '${cuando.toISOString()}', '${cuando.toISOString()}',
               '${ANA}', '${rolDe(ANA)}',
               '${input.turnoId}', '${ayer}', ${cierre})
       ON CONFLICT DO NOTHING`,
    );
    return id;
  }

  // ── LA MAÑANA ───────────────────────────────────────────────────
  //
  // Una caída con golpe (N3, sigue abierta), una fiebre de Antonio en la
  // segunda planta, un «algo no va bien» de doña Carmen y una avería del
  // office — que NO es de ningún residente y por eso cae en la zona «del
  // centro», que sólo cubre una confirmación de alcance total.
  await incidencia({
    clientId: CARMEN,
    tipo: "CAIDA",
    nivel: "N3",
    turnoId: manana.id,
    hora: "10:40",
    descripcion: "Se ha caído en el baño y se ha dado en la cabeza.",
    abierta: true,
  });
  await registro({
    clientId: ANTONIO,
    code: "TEMPERATURA",
    turnoId: manana.id,
    hora: "11:15",
    // 38,4: fuera del rango de referencia, así que sale en el parte como
    // «constante fuera de rango».
    valor: { tipo: "NUMERIC", numero: 38.4, unidad: "°C" },
  });
  await registro({
    clientId: CARMEN,
    code: "ALGO_NO_VA_BIEN",
    turnoId: manana.id,
    hora: "12:05",
    valor: { tipo: "NOTA" },
    nota: "No ha querido desayunar y está más callada de lo normal.",
  });
  await incidencia({
    clientId: null,
    subject: "MAINTENANCE",
    tipo: "AVERIA",
    nivel: "N2",
    turnoId: manana.id,
    hora: "09:20",
    descripcion: "El asidero del baño de la 112 se mueve.",
    abierta: true,
  });

  // ── LA TARDE: una queja de familia ──────────────────────────────
  await incidencia({
    clientId: LUIS,
    subject: "COMPLAINT",
    tipo: "QUEJA",
    nivel: "N1",
    turnoId: tarde.id,
    hora: "17:30",
    descripcion: "La hija dice que la comida llegó fría.",
    abierta: true,
  });

  // ── EL PLAN DE LA MAÑANA, CASI TODO HECHO ───────────────────────
  //
  // Sin esto el parte de la mañana sale con cincuenta y cinco líneas de
  // «no se hizo», porque el plan de un dependiente son veinte cuidados al
  // día y nadie los ha registrado. Un parte así es verdad y **no se
  // parece a nada**: lo que un turno de verdad deja es casi todo hecho y
  // dos o tres cosas sin registrar.
  //
  // Se registran las franjas de **los tres turnos** de los tres
  // residentes, menos dos de cada uno a propósito: ésas son las que el
  // parte tiene que contar.
  const lineas = await prisma.carePlanItem.findMany({
    where: { tenantId: T, toAt: null },
    select: {
      id: true,
      clientId: true,
      controlCode: true,
      frequencyKind: true,
      shiftCodes: true,
    },
  });
  const catalogo = await prisma.controlType.findMany({
    where: { supersededAt: null },
    select: { id: true, code: true, layer: true, valueDomain: true, options: { select: { code: true, isAsUsual: true } } },
  });
  const porCode = new Map(catalogo.map((c) => [c.code, c]));
  for (const turno of [manana, tarde, noche]) {
  const inicio = wallTimeToUtc(ayer, turno.startsAt);
  let saltadas = 0;
  for (const linea of lineas) {
    if (linea.frequencyKind !== "EVERY_SHIFT" && linea.frequencyKind !== "DAILY") continue;
    if (!linea.shiftCodes.includes(turno.code)) continue;
    const control = porCode.get(linea.controlCode);
    if (control == null) continue;
    // Dos sin registrar por turno: son el «no se hizo» del parte.
    if (saltadas < 2 && linea.clientId === CARMEN) {
      saltadas += 1;
      continue;
    }
    let valor: Record<string, unknown> | null = null;
    if (control.valueDomain === "BOOL") valor = { tipo: "BOOL", hecho: true };
    else if (control.valueDomain === "ORDINAL") {
      const comoSiempre = control.options.find((o) => o.isAsUsual) ?? control.options[0];
      if (comoSiempre == null) continue;
      valor = {
        tipo: "ORDINAL",
        opcion: comoSiempre.code,
        comoSiempre: comoSiempre.isAsUsual,
      };
    }
    // Las constantes y los textos no se siembran en bloque: la
    // temperatura de Antonio ya está arriba, con su valor fuera de rango.
    if (valor == null) continue;
    const id = randomUUID();
    const cifrado = cifrarJson(valor, dek, sitioValorDeRegistro(T, id));
    // La observación diaria guarda `occurrence_at` NULL (residencia-3
    // §1); lo que «toca» guarda el instante de la ocurrencia, que en una
    // franja es su inicio.
    const ocurrencia = control.layer === "OBS" ? null : inicio;
    await prisma.$executeRawUnsafe(
      `INSERT INTO care_records (id, tenant_id, client_id, control_type_id, control_code,
         plan_item_id, occurrence_at, value_cifrado, recorded_by_user_id,
         care_role_assignment_id, device_id, recorded_at, received_at,
         center_shift_id, care_day)
       VALUES ('${id}', '${T}', '${linea.clientId}', '${control.id}', '${linea.controlCode}',
               '${linea.id}',
               ${ocurrencia == null ? "NULL" : `'${ocurrencia.toISOString()}'`},
               '${cifrado}', '${ANA}', '${rolDe(ANA)}', '${TABLET}',
               '${new Date(inicio.getTime() + 90 * 60_000).toISOString()}',
               '${new Date(inicio.getTime() + 90 * 60_000).toISOString()}',
               '${turno.id}', '${ayer}')
       ON CONFLICT DO NOTHING`,
    );
  }
  }

  // ── LOS TRES PARTES, con la MISMA función que la pasada ─────────
  const partes = new Map<string, string | null>();
  for (const turno of [manana, tarde, noche]) {
    const r = await congelarParte(prisma as never, {
      tenantId: T,
      turno,
      careDay: ayer,
      // Congelado al acabar su turno, que es lo que hace la tarea
      // programada.
      ahora: ventanaDelTurno(turno, ayer).hasta,
    });
    partes.set(turno.code, r?.handoverId ?? null);
  }

  // ── EL DE LA MAÑANA, CONFIRMADO POR LA DUE ──────────────────────
  //
  // Rosa tiene alcance total (D-51), así que su confirmación cubre las dos
  // plantas Y la zona del centro: es el caso que D-58 nombra («la DUE
  // confirma el suyo si está de turno»).
  const deLaManana = partes.get("M");
  if (deLaManana != null) {
    const confirmadoEn = new Date(
      ventanaDelTurno(manana, ayer).hasta.getTime() + 4 * 60_000,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO handover_acks (id, tenant_id, handover_id, user_id,
         care_role_assignment_id, device_id, at, received_at, alcance_total)
       VALUES ('${randomUUID()}', '${T}', '${deLaManana}', '${ROSA}', '${rolDe(ROSA)}',
               '${TABLET_SALA}', '${confirmadoEn.toISOString()}',
               '${confirmadoEn.toISOString()}', true)`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE handovers SET confirmed_at = '${confirmadoEn.toISOString()}'
       WHERE id = '${deLaManana}' AND confirmed_at IS NULL`,
    );
  }

  // ── Y UN AÑADIDO TARDÍO al de la mañana ─────────────────────────
  //
  // Un cambio postural de las 14:50 que la puerta sin red subió a las
  // 15:20, cuando el parte ya estaba congelado. Se escribe con su
  // `received_at` de verdad y lo DETECTA la misma pasada que corre en
  // producción: así lo que se fotografía es el mecanismo, no una fila
  // puesta a mano.
  await registro({
    clientId: CARMEN,
    code: "CAMBIO_POSTURAL",
    turnoId: manana.id,
    hora: "14:50",
    valor: { tipo: "BOOL", hecho: true },
    recibidoEn: new Date(ventanaDelTurno(manana, ayer).hasta.getTime() + 20 * 60_000),
  });
  await anotarLoQueLlegoTarde(prisma as never, { tenantId: T, ahora: new Date() });
}

/**
 * **LAS OBLIGACIONES**: la plantilla del bloque C cargada, con una
 * marcada hecha y una vencida.
 *
 * La vencida es el certificado del mantenedor de PCI, que es el que falta
 * de verdad desde 2026 (observación 02 de AENOR).
 */
async function sembrarLasObligaciones(): Promise<void> {
  const res = await cargarPlantillaDeObligaciones(prisma as never, {
    tenantId: T,
    userId: DIRECCION,
    ahora: new Date(),
  });
  if (res.problemas.length > 0) {
    console.warn("la plantilla de obligaciones tiene problemas:", res.problemas);
    return;
  }

  const hace30 = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  await prisma.$executeRawUnsafe(
    `INSERT INTO duty_occurrences (tenant_id, duty_id, due_on)
     SELECT '${T}', id, '${hace30}' FROM management_duties
     WHERE tenant_id = '${T}' AND name = 'Certificado anual del mantenedor de PCI'
     ON CONFLICT DO NOTHING`,
  );

  // Y una HECHA, con firma: el registro de jornada de HOY.
  //
  // De hoy y no de ayer, y es una consecuencia del generador: cargar la
  // plantilla pone `starts_on` en hoy, así que la primera ocurrencia de
  // una diaria es la de hoy. Marcar la de ayer no habría encontrado
  // ninguna fila y el sembrador se habría quedado callado.
  const hoy = new Date().toISOString().slice(0, 10);
  const rol = await prisma.careRoleAssignment.findFirst({
    where: { tenantId: T, userId: DIRECCION, revokedAt: null },
    select: { id: true },
  });
  if (rol != null) {
    await prisma.$executeRawUnsafe(
      `UPDATE duty_occurrences SET done_at = now() - interval '20 hours',
         done_by_user_id = '${DIRECCION}', done_by_care_role_assignment_id = '${rol.id}',
         done_note = 'Revisado el registro de jornada del día.'
       WHERE tenant_id = '${T}' AND due_on = '${hoy}' AND done_at IS NULL
         AND duty_id IN (SELECT id FROM management_duties
                         WHERE tenant_id = '${T}' AND name = 'Registro diario de jornada')`,
    );
  }
}

await main();
