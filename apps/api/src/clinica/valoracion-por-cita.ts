// clinica-2 · dar una cita de primera valoración le manda el test al
// paciente. Sin que nadie se acuerde.
//
// ── Dónde se engancha, y por qué ahí ──────────────────────────────────
//
// En `agenda/store.ts::insertHold`, el PUNTO ÚNICO donde nace una cita, y
// no en la ruta de alta. Es la misma lección que clinica-1 dejó escrita y
// que `mover-con-otra` ya cobró: enganchado en la ruta, un camino nuevo
// que cree citas (el alta offline por outbox, una reserva online, un
// import) no mandaría el test, y nadie lo notaría hasta que una podóloga
// se encontrara a un paciente sin valoración en la silla.
//
// Pero con UNA diferencia importante respecto al acceso clínico de
// clinica-1: **esto NO va dentro de la transacción de la cita.**
//
//   · El acceso clínico sí: media operación deja a un sanitario con una
//     cita cuya historia no puede abrir, y las dos cosas son escrituras
//     locales que no pueden fallar por separado.
//   · Mandar un email es I/O a un servidor que no es nuestro, y puede
//     tardar segundos o fallar. Dentro de la transacción, un SMTP lento
//     tendría abierta la transacción que compite por el `EXCLUDE` del
//     anti-solape de la agenda — y un SMTP caído haría que **no se pudiera
//     dar una cita**. Eso no es aceptable: la cita es el acto de negocio y
//     el email es el recado.
//
// Así que el store **recoge lo que hay que mandar** dentro de la
// transacción (lee la marca del servicio, que es una lectura local) y lo
// manda DESPUÉS del commit. Si el envío falla, la cita está dada y la
// valoración creada con su enlace: la podóloga reenvía o da la tablet.
//
// ── Y no se crea nada si el paciente ya tiene valoración ──────────────
//
// «A un paciente sin valoración», dice el prompt. Un paciente que ya tiene
// una validada no recibe otro test por darle una cita de revisión marcada
// como primera valoración: eso lo decide la podóloga creando un repaso a
// mano (decisión de producto 7). Lo comprueba `asegurarValoracionAbierta`
// vía el índice único parcial, y además se mira antes para no mandar un
// email de más.

import type { PrismaClient } from "@mipiacetpv/db";

import { loadEnv } from "../env.js";
import { mandarElTest, type LogDelEnvio } from "./valoracion-envio.js";

/** Lo que el store averigua DENTRO de la transacción y manda fuera. */
export interface EncargoDeValoracion {
  tenantId: string;
  clientId: string;
  appointmentId: string;
}

/** Lo mínimo de un `tx` que hace falta para la lectura. */
export interface EjecutorSql {
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
}

/**
 * ¿Hay que mandarle el test a este paciente por esta cita?
 *
 * Corre DENTRO de la transacción de la cita porque es una lectura local y
 * tiene que ver lo mismo que la escritura: si alguien apagara el módulo o
 * desmarcara el servicio a mitad de la operación, esta lectura y la cita
 * ven el mismo estado.
 *
 * No-op silencioso —y correcto— cuando:
 *   · el tenant no tiene la clínica encendida (los quince de hoy);
 *   · la cita no tiene paciente (walk-in, reserva anónima de teléfono);
 *   · ningún servicio de la cita está marcado como primera valoración;
 *   · el paciente ya tiene una valoración (abierta o validada).
 *
 * Devuelve `null` en todos esos casos. Una consulta por cita en un tenant
 * clínico, cero en los demás: la primera condición del WHERE es la
 * capability, así que la de los otros catorce clientes no llega ni a mirar
 * los servicios.
 */
export async function encargoDeValoracionPorCita(
  tx: EjecutorSql,
  input: {
    tenantId: string;
    clientId: string | null;
    appointmentId: string;
    serviceIds: readonly string[];
  },
): Promise<EncargoDeValoracion | null> {
  if (!input.clientId) return null;
  if (input.serviceIds.length === 0) return null;

  const filas = await tx.$queryRawUnsafe<Array<{ hay: boolean }>>(
    `SELECT EXISTS (
         SELECT 1
           FROM service_scheduling ss
           JOIN tenants t ON t.id = ss.tenant_id
          WHERE ss.tenant_id = $1::uuid
            AND ss.product_id = ANY($2::uuid[])
            AND ss.primera_valoracion
            AND t.clinical_records_enabled
       )
       AND NOT EXISTS (
         SELECT 1 FROM clinical_assessments
          WHERE tenant_id = $1::uuid AND client_id = $3::uuid
       ) AS hay`,
    input.tenantId,
    [...input.serviceIds],
    input.clientId,
  );
  if (filas[0]?.hay !== true) return null;

  return {
    tenantId: input.tenantId,
    clientId: input.clientId,
    appointmentId: input.appointmentId,
  };
}

/**
 * Cumple el encargo: crea la valoración y manda el email. FUERA de la
 * transacción de la cita (ver la cabecera).
 *
 * **No lanza nunca.** Un fallo aquí no puede propagarse al alta de la
 * cita, que ya está dada y confirmada al cliente que tiene delante. Lo
 * único que hace con el fallo es registrarlo.
 */
export async function cumplirEncargoDeValoracion(
  prisma: PrismaClient,
  encargo: EncargoDeValoracion,
  opciones: { log?: LogDelEnvio; cita?: { dia: string; hora: string } | null } = {},
): Promise<void> {
  try {
    await mandarElTest(prisma, {
      tenantId: encargo.tenantId,
      clientId: encargo.clientId,
      // `APPOINTMENT`: no la pide nadie, la pide el hecho de la cita. La
      // columna `requested_by_user_id` se queda NULL y el CHECK de la base
      // lo exige — igual que `clinical_access` cuando nace de la agenda.
      origen: "APPOINTMENT",
      pedidaPorUserId: null,
      appointmentId: encargo.appointmentId,
      baseTpvUrl: loadEnv().PUBLIC_TPV_URL,
      cita: opciones.cita ?? null,
      log: opciones.log,
    });
  } catch (err) {
    opciones.log?.warn(
      {
        event: "clinica_valoracion_por_cita_fallo",
        appointmentId: encargo.appointmentId,
        err: err instanceof Error ? err.message : String(err),
      },
      "no se pudo preparar el test de la valoración para esta cita — la cita está dada",
    );
  }
}
