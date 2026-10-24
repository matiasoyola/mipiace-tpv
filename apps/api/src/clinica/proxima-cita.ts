// clinica-9 (9) · LA PRÓXIMA CITA PROPUESTA, OFRECIDA DONDE SE DA.
//
// Al cerrar la sesión, la podóloga marca «Próxima cita: 4 semanas» y la
// pantalla lo dice con todas las letras: «Queda como propuesta. La
// recepción elige el hueco con el paciente al cobrar.»
//
// La pasada en hierro del 24-10 cobró esa sesión (capturas 33 y 36) y en
// el cobro **no salió nada**. La propuesta se quedó escrita dentro de la
// historia clínica, que es el único sitio donde la recepción no mira: lo
// que la pantalla le prometió a la sanitaria no lo hacía nadie, y la
// paciente se fue sin cita.
//
// Así que la propuesta sale al único sitio donde la recepción está con
// la paciente delante y acaba de cobrar: **la agenda del día**.
//
// ── Qué sale, y qué NO ───────────────────────────────────────────────
//
// Sale un recordatorio de mostrador: de quién es, cuántas semanas
// propuso la sanitaria y a partir de qué día buscar. **Nada de la
// historia** — ni qué se le hizo, ni el riesgo que lo motivó. Es la misma
// frontera que `cobros-pendientes.ts` dibuja para la lista de cobros, y
// por la misma razón: esto lo lee la recepción cincuenta veces al día.
//
// Y no deja línea en el registro de accesos, también como los cobros
// pendientes: apuntar un acceso por cada pintada de la agenda llenaría de
// ruido la lista de «quién ha abierto la historia de este paciente».
//
// ── Cuándo DEJA de salir ─────────────────────────────────────────────
//
// En cuanto el paciente tiene una cita por delante. No se marca nada ni
// se escribe en ningún sitio: se mira si existe una cita futura suya, que
// es el hecho que la propuesta persigue. Un recordatorio que hay que
// apagar a mano es un recordatorio que acaba encendido para siempre.
//
// ── Y no cuesta nada en los catorce tenants no clínicos ──────────────
//
// La capability es lo primero, igual que en `cobros-pendientes.ts`.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  SEMANAS_DE_PROXIMA_CITA,
  esProximaCita,
  type CuerpoDeSesionCualquiera,
  type ProximaCita,
} from "@mipiacetpv/clinica-sesion";

import { dekONada } from "./claves.js";
import { cuerpoDeEntrada } from "./cripto-campos.js";

export interface ProximaCitaPropuesta {
  /** La cita de la que salió la propuesta. */
  appointmentId: string;
  clientId: string;
  /** `S2` / `S4` / `S8`. Nunca `SIN_CITA`: eso no es una propuesta. */
  propuesta: Exclude<ProximaCita, "SIN_CITA">;
  /** El día a partir del cual buscar hueco, «YYYY-MM-DD». */
  desde: string;
}

/** El día de pared, sumando semanas a una fecha. */
function diaSumandoSemanas(base: Date, semanas: number, tz: string): string {
  const d = new Date(base.getTime() + semanas * 7 * 24 * 3600 * 1000);
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return partes;
}

/**
 * Las propuestas vivas de las citas de este rango.
 *
 * «Viva» = la sesión se cerró con una propuesta, la cita ya está cobrada
 * (si no, lo que toca antes es cobrarla y eso ya tiene su aviso) y el
 * paciente **no tiene ninguna cita por delante**.
 */
export async function proximasCitasPropuestasDe(
  prisma: PrismaClient,
  input: { tenantId: string; desde: Date; hasta: Date; tz: string },
): Promise<ProximaCitaPropuesta[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { clinicalRecordsEnabled: true },
  });
  if (tenant?.clinicalRecordsEnabled !== true) return [];

  // Las citas COBRADAS del rango. Una cita sin cobrar tiene su propio
  // aviso («Sesión cerrada · queda cobrarla») y dos avisos a la vez sobre
  // la misma tarjeta se leen como uno solo.
  const citas = await prisma.$queryRawUnsafe<
    Array<{ id: string; client_id: string }>
  >(
    `SELECT a.id, a.client_id
       FROM appointments a
       JOIN tickets t ON t.id = a.ticket_id
      WHERE a.tenant_id = $1::uuid
        AND a.client_id IS NOT NULL
        AND a.status <> 'CANCELLED'
        AND t.status <> 'DRAFT'
        AND a.timeslot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      ORDER BY lower(a.timeslot) ASC`,
    input.tenantId,
    input.desde.toISOString(),
    input.hasta.toISOString(),
  );
  if (citas.length === 0) return [];

  const sesiones = await prisma.clinicalEntry.findMany({
    where: {
      tenantId: input.tenantId,
      kind: "TREATMENT_SESSION",
      appointmentId: { in: citas.map((c) => c.id) },
    },
    // clinica-7 · `id` y `tenantId` los pide el AAD del cuerpo.
    select: {
      id: true,
      tenantId: true,
      appointmentId: true,
      body: true,
      bodyCifrado: true,
      createdAt: true,
    },
  });
  if (sesiones.length === 0) return [];

  const dek = await dekONada(input.tenantId, prisma);
  const propuestas: ProximaCitaPropuesta[] = [];
  const porCita = new Map(citas.map((c) => [c.id, c.client_id]));
  for (const s of sesiones) {
    const clientId = s.appointmentId ? porCita.get(s.appointmentId) : null;
    if (!s.appointmentId || !clientId) continue;
    let cuerpo: CuerpoDeSesionCualquiera | null = null;
    try {
      cuerpo = cuerpoDeEntrada(
        { ...s, body: s.body as unknown },
        dek,
      ) as CuerpoDeSesionCualquiera | null;
    } catch {
      // Un cuerpo ilegible no es una propuesta: se calla. Misma regla que
      // `lineas-de-la-sesion.ts` — lo clínico que no se puede leer no
      // puede ser el motivo de que algo salga mal en el mostrador.
      continue;
    }
    const p = (cuerpo as { proximaCita?: unknown } | null)?.proximaCita;
    if (!esProximaCita(p) || p === "SIN_CITA") continue;
    const semanas = SEMANAS_DE_PROXIMA_CITA[p];
    if (semanas == null) continue;
    propuestas.push({
      appointmentId: s.appointmentId,
      clientId,
      propuesta: p,
      // Se cuenta desde el día en que se CERRÓ la sesión, que es el día
      // de la visita: «dentro de cuatro semanas» es desde que estuvo
      // aquí, no desde que alguien abra la agenda.
      desde: diaSumandoSemanas(s.createdAt, semanas, input.tz),
    });
  }
  if (propuestas.length === 0) return [];

  // Y fuera las de quien ya tiene cita por delante.
  const futuras = await prisma.$queryRawUnsafe<Array<{ client_id: string }>>(
    `SELECT DISTINCT a.client_id
       FROM appointments a
      WHERE a.tenant_id = $1::uuid
        AND a.status <> 'CANCELLED'
        AND lower(a.timeslot) > $2::timestamptz
        AND a.client_id = ANY($3::uuid[])`,
    input.tenantId,
    input.hasta.toISOString(),
    propuestas.map((p) => p.clientId),
  );
  const yaTienen = new Set(futuras.map((f) => f.client_id));
  return propuestas.filter((p) => !yaTienen.has(p.clientId));
}
