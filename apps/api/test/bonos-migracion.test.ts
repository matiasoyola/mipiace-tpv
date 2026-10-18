// B-reservas-8 · guardia de regresión sobre la migración.
//
// Mismo papel y misma mecánica que `iva-exento-migracion.test.ts` y
// `clinica-sesion-migracion.test.ts`: la suite de siempre no levanta
// Postgres, así que aquí se fija el CONTRATO del SQL. El comportamiento
// real del motor —los CHECK mordiendo, el trigger, el `FOR UPDATE`— va en
// `test-e2e/bonos-libro.e2e.ts`.
//
// Y existe por la razón de siempre, escrita ya tres veces en esta casa:
// **`prisma migrate dev` ve los CHECK y el trigger como DERIVA y ofrece
// borrarlos.** Si alguien acepta, esto se pone rojo.
//
// Lo que se pone rojo si alguien lo toca:
//
//   1. La migración es ADITIVA. Dos columnas en tablas vivas (`tickets` y
//      `ticket_lines`) y cinco ajustes en `tenants`; nada más.
//   2. **El CHECK del CONVENIO DEL SIGNO.** Es lo que hace que
//      `libres = SUM(sesiones)` no se pueda escribir mal, y con él
//      desaparecido el invariante del libro se desalinearía en silencio.
//   3. **El trigger append-only** y sus DOS escapatorias, las dos medidas
//      contra el estado real: «Eliminar cuenta» y lo marcado `es_prueba`.
//      Ninguna de las dos es la vieja rama «el padre ya no existe», que
//      `20261017030000` tuvo que quitar de cuatro guardias.
//   4. **`bonos_enabled` no se puede encender con Holded.** El 409 de la
//      ruta no basta: hay cuatro puertas de escritura a `tenants`.
//   5. Los enums son TEXTO CON CHECK y no `enum` de Postgres: B-cheques y
//      B-13 añaden tipos al libro, y un enum partiría su migración en dos.
//   6. `voucher_movements.appointment_id` / `ticket_line_id` y
//      `ticket_lines.voucher_id` NO llevan clave ajena, y eso es una
//      decisión (ver los comentarios de la propia migración).

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

import { readFileSync } from "node:fs";

import { MOTIVOS_CORRECCION } from "@mipiacetpv/bonos";
import { describe, expect, it } from "vitest";

const NOMBRE = "20261018030000_reservas_8_bonos";
const sql = readFileSync(
  new URL(
    `../../../packages/db/prisma/migrations/${NOMBRE}/migration.sql`,
    import.meta.url,
  ),
  "utf8",
);
// SÓLO las sentencias. Los comentarios de esta migración hablan largo de
// `DROP`, de enums y de echar atrás, y harían pasar los asserts por lo que
// EXPLICAN en vez de por lo que ejecutan. Lección de clinica-1.
const statements = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("B-reservas-8 · la migración es aditiva", () => {
  it("ni un DROP, ni un TRUNCATE, ni un DELETE, ni un UPDATE", () => {
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TYPE\b/i);
    expect(statements).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(statements).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    // Sin backfill: no hay nada que rellenar. Un UPDATE aquí sería un
    // bloqueo largo sobre `tickets` para escribir el NULL que la columna
    // ya tiene.
    expect(statements).not.toMatch(/\bUPDATE\s+"?(tickets|ticket_lines)"?\b/i);
  });

  it("las dos columnas de tablas vivas nacen NULL y sin DEFAULT", () => {
    // `tickets.client_id` y `ticket_lines.voucher_id`. Un DEFAULT aquí no
    // tendría sentido y un NOT NULL reventaría el despliegue.
    expect(statements).toMatch(
      /ALTER TABLE "tickets" ADD COLUMN "client_id" UUID;/,
    );
    expect(statements).toMatch(
      /ALTER TABLE "ticket_lines" ADD COLUMN "voucher_id" UUID;/,
    );
  });

  it("y los cinco ajustes del tenant nacen con el valor de hoy", () => {
    // `bonos_enabled` apagado: los quince tenants de hoy no notan nada.
    expect(statements).toMatch(/"bonos_enabled"\s+BOOLEAN NOT NULL DEFAULT false/);
    // El no-show por defecto es `consumir`, que es lo que hace el spa.
    expect(statements).toMatch(/"bono_no_show"\s+TEXT\s+NOT NULL DEFAULT 'consumir'/);
    // La palabra por defecto es «bono».
    expect(statements).toMatch(/"bono_etiqueta"\s+VARCHAR\(20\) NOT NULL DEFAULT 'bono'/);
    // El frente P5 arranca en LINEA_CERO.
    expect(statements).toMatch(/"bono_modo_canje"\s+TEXT\s+NOT NULL DEFAULT 'LINEA_CERO'/);
    // Y la caducidad por defecto es NINGUNA (nullable sin default).
    expect(statements).toMatch(/"bono_caducidad_meses" INTEGER;/);
  });
});

describe("B-reservas-8 · los CHECK que son la mitad del bloque", () => {
  it("EL CONVENIO DEL SIGNO vive en la base", () => {
    expect(statements).toMatch(/voucher_movements_signo_por_tipo/);
    // Las siete ramas del convenio, una por tipo.
    expect(statements).toMatch(/WHEN 'VENDIDO'\s+THEN "sesiones" > 0/);
    expect(statements).toMatch(/WHEN 'ALTA_INICIAL'\s+THEN "sesiones" > 0/);
    expect(statements).toMatch(/WHEN 'APARTADA'\s+THEN "sesiones" = -1/);
    expect(statements).toMatch(/WHEN 'LIBERADA'\s+THEN "sesiones" = 1/);
    expect(statements).toMatch(/WHEN 'CORRECCION'\s+THEN "sesiones" <> 0/);
    expect(statements).toMatch(/WHEN 'ANULADO'\s+THEN "sesiones" <= 0/);
    expect(statements).toMatch(/WHEN 'CADUCIDAD_CAMBIADA' THEN "sesiones" = 0/);
    // Y LA QUE LO CIERRA: una CONSUMIDA vale 0 exactamente cuando viene de
    // una cita. Sin esta equivalencia, `libres = SUM(sesiones)` deja de
    // ser verdad y el invariante se desalinea sin que nadie lo vea.
    expect(statements).toMatch(
      /\("sesiones" = 0\) = \("appointment_id" IS NOT NULL\)/,
    );
    // Un tipo desconocido no pasa: el `ELSE` del CASE es `false`.
    expect(statements).toMatch(/ELSE false/);
  });

  it("bonos_enabled NO se puede encender con Holded", () => {
    expect(statements).toMatch(/tenants_bonos_sin_holded/);
    // Se lee `= false` en los dos lados, nunca `NOT`: es el criterio que el
    // propio schema documenta para `holded_enabled` (`@default(true)`).
    expect(statements).toMatch(
      /CHECK \("bonos_enabled" = false OR "holded_enabled" = false\)/,
    );
  });

  it("y ningún CHECK se escribe sin su IS NULL delante", () => {
    // «Un CHECK que da NULL PASA» (`07` pieza 18). Los dos rangos
    // nullables de esta migración llevan su guarda.
    expect(statements).toMatch(
      /CHECK \("bono_caducidad_meses" IS NULL\s*\n?\s*OR \("bono_caducidad_meses" >= 1/,
    );
    expect(statements).toMatch(
      /CHECK \("expires_months" IS NULL\s*\n?\s*OR \("expires_months" >= 1/,
    );
  });

  it("el motivo de corregir es de LISTA CERRADA, y es la misma que el código", () => {
    const m = /CHECK \("motivo" IS NULL\s*\n?\s*OR "motivo" IN \(([^)]*)\)\)/.exec(
      statements,
    );
    expect(m).not.toBeNull();
    const enLaBase = m![1]!
      .split(",")
      .map((x) => x.trim().replace(/^'|'$/g, ""))
      .sort();
    // La MISMA lista que `@mipiacetpv/bonos`. Dos listas distintas es un
    // motivo que el panel ofrece y la base rechaza.
    expect(enLaBase).toEqual([...MOTIVOS_CORRECCION].sort());
  });

  it("un bono que no cubre nada no se puede guardar", () => {
    // Un bono que la clienta paga y no sirve para ningún servicio.
    expect(statements).toMatch(/voucher_templates_cubre_algo/);
    expect(statements).toMatch(/vouchers_cubre_algo/);
  });

  it("el saldo no puede quedar en un estado imposible", () => {
    expect(statements).toMatch(/vouchers_saldo_coherente/);
    expect(statements).toMatch(
      /"sessions_left" \+ "sessions_reserved" <= "sessions_total"/,
    );
  });

  it("un bono de VENTA tiene ticket y uno de papel no", () => {
    expect(statements).toMatch(/vouchers_origen_coherente/);
  });

  it("y B-cheques es aditivo: un SESSIONS no lleva importes de saldo", () => {
    expect(statements).toMatch(/vouchers_tipo_coherente/);
  });

  it("el candado del número de arranque es un CHECK, no una costumbre", () => {
    expect(statements).toMatch(/voucher_sequence_arranque_coherente/);
    // Un arranque sin fecha sería un candado que alguien abrió sin dejar
    // rastro.
    expect(statements).toMatch(
      /\("arranque" IS NULL AND "arranque_confirmado_at" IS NULL\)/,
    );
  });
});

describe("B-reservas-8 · el libro es de solo inserción", () => {
  it("el trigger existe y vigila UPDATE y DELETE", () => {
    expect(statements).toMatch(
      /CREATE FUNCTION mipiacetpv_voucher_movements_append_only\(\)/,
    );
    expect(statements).toMatch(
      /CREATE TRIGGER "voucher_movements_append_only"\s*\n\s*BEFORE UPDATE OR DELETE ON "voucher_movements"/,
    );
  });

  it("y sus DOS escapatorias se miden contra el estado REAL, no contra «el padre ya no existe»", () => {
    // ADR-021 §6 · la única puerta.
    expect(statements).toMatch(/mipiacetpv_eliminando_este_tenant\(OLD.tenant_id\)/);
    // ADR-021 §5.1 · lo marcado como prueba.
    expect(statements).toMatch(/IF OLD\.es_prueba THEN/);
    // Y NO la rama que `20261017030000` tuvo que quitar de cuatro
    // guardias: «si el tenant ya no existe, esto es su cascada». Era una
    // puerta abierta al lado del candado.
    expect(statements).not.toMatch(
      /NOT EXISTS \(SELECT 1 FROM tenants WHERE id = OLD\.tenant_id\)/,
    );
  });

  it("un UPDATE no pasa por NINGÚN camino", () => {
    // Las dos escapatorias están dentro del `IF TG_OP = 'DELETE'`. Si
    // alguien las sacara de ahí, un UPDATE de una línea de prueba pasaría.
    const cuerpo = /CREATE FUNCTION mipiacetpv_voucher_movements_append_only\(\)[\s\S]*?\$fn\$;/.exec(
      statements,
    );
    expect(cuerpo).not.toBeNull();
    const [antes, despues] = cuerpo![0].split("IF OLD.es_prueba THEN");
    expect(antes).toMatch(/IF TG_OP = 'DELETE' THEN/);
    // Y después de la escapatoria viene el RAISE del borrado, no un
    // `RETURN NEW`.
    expect(despues).toMatch(/RAISE EXCEPTION/);
    expect(cuerpo![0]).not.toMatch(/RETURN NEW/);
  });
});

describe("B-reservas-8 · nada de enums de Postgres", () => {
  it("ni un CREATE TYPE: los estados son texto con CHECK", () => {
    // La factura está pagada tres veces (clinica-1, -2 y -3): un enum sólo
    // crece y **no se puede usar un valor nuevo en la misma transacción en
    // la que se añade**, así que cada valor nuevo partiría la migración en
    // dos. B-cheques y B-13 añaden tipos a este libro.
    expect(statements).not.toMatch(/\bCREATE TYPE\b/i);
    expect(statements).toMatch(/voucher_movements_tipo_valido/);
    expect(statements).toMatch(/vouchers_status_valido/);
    expect(statements).toMatch(/vouchers_type_valido/);
    expect(statements).toMatch(/voucher_movements_canal_valido/);
  });
});

describe("B-reservas-8 · los punteros que NO llevan clave ajena", () => {
  it("el libro sobrevive a lo que apunta", () => {
    // Una FK `ON DELETE SET NULL` sería un UPDATE sobre la fila y el
    // propio trigger lo rechazaría; una `RESTRICT` dejaría el borrado del
    // tenant dependiendo del orden de las cascadas.
    expect(statements).not.toMatch(/voucher_movements_appointment_id_fkey/);
    expect(statements).not.toMatch(/voucher_movements_ticket_line_id_fkey/);
  });

  it("y una línea de venta SELLADA también", () => {
    // El guardián del sello (S1) vigila la FILA ENTERA de una línea
    // cobrada: cualquier columna que cambie levanta `SELLO_VIOLADO`.
    expect(statements).not.toMatch(/ticket_lines_voucher_id_fkey/);
  });

  it("pero las que SÍ son dueñas la llevan, y con la acción correcta", () => {
    // El bono de un ticket `TEST` se va con su ticket en el reseteo.
    expect(statements).toMatch(
      /"vouchers_sold_ticket_id_fkey"\s*\n?\s*FOREIGN KEY \("sold_ticket_id"\) REFERENCES "tickets"\("id"\)\s*\n?\s*ON DELETE CASCADE/,
    );
    // Una ficha con un bono vivo NO se borra.
    expect(statements).toMatch(
      /"vouchers_client_id_fkey"\s*\n?\s*FOREIGN KEY \("client_id"\) REFERENCES "clients"\("id"\)\s*\n?\s*ON DELETE RESTRICT/,
    );
    // Y la cita se queda como cita normal si el bono desaparece.
    expect(statements).toMatch(
      /"appointments_voucher_id_fkey"\s*\n?\s*FOREIGN KEY \("voucher_id"\) REFERENCES "vouchers"\("id"\)\s*\n?\s*ON DELETE SET NULL/,
    );
  });
});
