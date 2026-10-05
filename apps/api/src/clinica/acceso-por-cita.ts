// clinica-1 · la selección de un sanitario se llena sola desde la agenda.
//
// Decisión de producto (Matías, 05-10-2026): «al asignarle una cita, ese
// paciente entra en su selección». Nadie teclea nada; atender es lo que
// concede el acceso.
//
// ── Dónde se engancha, y por qué ahí ──────────────────────────────────
//
// En el PUNTO ÚNICO donde se persisten las asignaciones
// (`agenda/store.ts::persistirAssignments`), no en la ruta de alta. Los
// caminos que crean o mueven asignaciones son hoy dos (`insertHold` y
// `reschedule`) y mañana más: la rama viva `mover-con-otra` hace que
// mover una cita pueda CAMBIARLA DE PROFESIONAL, y cuando entre, el
// sanitario nuevo tiene que recibir el acceso en esa misma transacción
// sin que nadie se acuerde de añadir una línea aquí. Enganchado en el
// punto de persistencia, lo hereda cualquier camino que reasigne.
//
// El motor de reservas (`engine.ts`) NO SE TOCA: esto no interviene en el
// cálculo de huecos, sólo en la escritura.
//
// ── En la MISMA transacción que la cita ───────────────────────────────
//
// Recibe el `tx` y escribe dentro. Si la cita no se guarda, el acceso
// tampoco; si el acceso no se puede guardar, la cita se cae. Media
// operación aquí sería un sanitario con una cita a la que no puede abrir
// la historia, o al revés: acceso a un paciente que no atiende.
//
// ── Y el "sólo si no hay uno vigente" lo decide la BASE ──────────────
//
// `ON CONFLICT ... DO NOTHING` contra el índice único PARCIAL
// `clinical_access_one_live_key`. De ahí salen tres comportamientos sin
// un solo `if`:
//
//   · mover una cita CONSERVANDO a su profesional no crea filas nuevas;
//   · dos terminales a la vez no crean dos accesos;
//   · y tras una REVOCACIÓN sí se inserta otra fila —la revocada no está
//     en el índice parcial—, así que una cita nueva le devuelve el acceso
//     al sanitario y la revocación se queda en el histórico.

/** Lo mínimo del cliente de Prisma (o de un `tx`) que hace falta. */
export interface EjecutorSql {
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
}

/**
 * Concede acceso a la historia de `clientId` a los `staffUserIds` que
 * sean sanitarios, si el tenant tiene la clínica encendida.
 *
 * No-op silencioso —y es lo correcto— cuando:
 *   · el tenant no tiene la clínica encendida (todos los de hoy);
 *   · la cita no tiene paciente (walk-in, reserva anónima de teléfono);
 *   · ninguno de los asignados es sanitario (una peluquería entera).
 *
 * Devuelve cuántos accesos NUEVOS se crearon. Lo usan los tests para
 * distinguir «no creó filas porque no tocaba» de «no creó filas porque ya
 * había una vigente», que es la diferencia entre mover una cita y no
 * haber enganchado nada.
 */
export async function otorgarAccesoClinicoPorCita(
  tx: EjecutorSql,
  input: {
    tenantId: string;
    clientId: string | null;
    staffUserIds: Array<string | null | undefined>;
  },
): Promise<number> {
  if (!input.clientId) return 0;

  const candidatos = [...new Set(input.staffUserIds.filter((x): x is string => !!x))];
  if (candidatos.length === 0) return 0;

  // La capability se lee DENTRO de la transacción: si se apagara a mitad
  // de la operación, esta lectura y la escritura ven lo mismo.
  const tenantRows = await tx.$queryRawUnsafe<
    Array<{ clinical_records_enabled: boolean }>
  >(
    `SELECT clinical_records_enabled FROM tenants WHERE id = $1::uuid`,
    input.tenantId,
  );
  if (tenantRows[0]?.clinical_records_enabled !== true) return 0;

  // Quién de los asignados es sanitario. La MARCA (`is_clinician`), no el
  // rol: una dueña sanitaria que se asigna una cita también entra aquí, y
  // un `CLINICIAN` lleva la marca por CHECK de la base.
  const sanitarios = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM users
      WHERE tenant_id = $1::uuid
        AND id = ANY($2::uuid[])
        AND is_clinician
        AND deleted_at IS NULL`,
    input.tenantId,
    candidatos,
  );
  if (sanitarios.length === 0) return 0;

  let creados = 0;
  for (const s of sanitarios) {
    creados += await tx.$executeRawUnsafe(
      `INSERT INTO clinical_access
         (tenant_id, clinician_user_id, client_id, source, granted_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'APPOINTMENT'::"ClinicalAccessSource", now())
       ON CONFLICT ("clinician_user_id", "client_id") WHERE "revoked_at" IS NULL
       DO NOTHING`,
      input.tenantId,
      s.id,
      input.clientId,
    );
  }
  return creados;
}
