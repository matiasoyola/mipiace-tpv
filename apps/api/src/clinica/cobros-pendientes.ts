// clinica-3 · la lista de pendientes de cobro de la recepción.
//
// Lo que la recepción necesita saber: qué sesiones se han cerrado y
// todavía no se han cobrado, de quién, y con qué líneas. Y **nada de la
// historia** (prompt §4): ni lesiones, ni dolor, ni evolución, ni
// consejos, ni la nota, ni las alertas.
//
// ── Por qué esto NO es una ruta clínica ──────────────────────────────
//
// Porque lo que devuelve no es historia: es una lista de cobros
// pendientes, que es información de CAJA. Y de ahí salen tres cosas:
//
//   · **No lleva `ensureClinicaEnabled`** y no da 404 con el módulo
//     apagado: da la lista vacía, porque un tenant sin clínica no tiene
//     sesiones y «no hay nada por cobrar» es la verdad. La 404 del módulo
//     existe para no contarle a un bar que este sistema guarda datos de
//     salud; una lista vacía no cuenta nada.
//   · **No pasa por `conHistoria` y no deja línea en el registro de
//     accesos.** Es la misma decisión que clinica-1 tomó con
//     `GET /clients/:id` y clinica-2 con el aviso de la agenda: la
//     recepción pasa por esta lista cincuenta veces al día y no lee una
//     sola respuesta de salud. Apuntar un acceso por cada pintada llenaría
//     de ruido justo la lista de «quién ha abierto la historia de este
//     paciente», y eso hace el registro MENOS útil, que es el daño real.
//   · **La ve quien cobra, y sólo quien cobra.** El sanitario sin caja no
//     ve importes en ninguna parte (regla 8), y ésta es toda importes. La
//     ruta lo rechaza; ver `agenda/routes.ts`.
//
// ── Y no cuesta nada en los catorce tenants no clínicos ──────────────
//
// La capability es lo PRIMERO que mira el WHERE y la función sale antes si
// no hay citas en el rango. Un bar con la agenda llena no paga ni una
// consulta por este bloque. Misma forma que `valoracionesPendientesDe`.

import type { PrismaClient } from "@mipiacetpv/db";
import { resumenDeLaSesion, type CuerpoDeSesion } from "@mipiacetpv/clinica-sesion";

import type { CobroPendiente } from "./sesion-view.js";
import { tratamientosPorId } from "./tratamientos.js";

interface Rango {
  tenantId: string;
  desde: Date;
  hasta: Date;
}

interface CitaPendiente {
  id: string;
  clientId: string;
  empieza: Date;
  cuerpo: CuerpoDeSesion;
  cerradaEn: Date;
}

/**
 * QUÉ ESTÁ PENDIENTE DE COBRO. Un solo sitio lo decide, y las dos
 * funciones públicas de abajo cuelgan de aquí.
 *
 * Dos consultas que contestaran «qué está por cobrar» serían dos
 * respuestas que algún día no coinciden — y la que se vería en la tarjeta
 * de la cita sería justo la que nadie revisa.
 *
 * «Sin cobrar» = la cita no tiene ticket, o el que tiene sigue en DRAFT.
 * Un DRAFT es un cobro empezado y no terminado (alguien abrió el ticket y
 * se fue), y eso SÍ sigue pendiente: dejarlo fuera sería la forma de
 * perder un cobro — la cita desaparecería del sitio donde se mira qué
 * queda por cobrar.
 */
async function citasConSesionSinCobrar(
  prisma: PrismaClient,
  input: Rango,
): Promise<CitaPendiente[]> {
  // La capability primero: sin clínica no hay sesiones.
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: { clinicalRecordsEnabled: true },
  });
  if (tenant?.clinicalRecordsEnabled !== true) return [];

  const citas = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      client_id: string;
      starts_at: Date;
      ticket_status: string | null;
    }>
  >(
    `SELECT a.id, a.client_id, lower(a.timeslot) AS starts_at, t.status AS ticket_status
       FROM appointments a
       LEFT JOIN tickets t ON t.id = a.ticket_id
      WHERE a.tenant_id = $1::uuid
        AND a.client_id IS NOT NULL
        AND a.status <> 'CANCELLED'
        AND a.timeslot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
        AND (t.id IS NULL OR t.status = 'DRAFT')
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
    select: { appointmentId: true, body: true, createdAt: true },
  });
  if (sesiones.length === 0) return [];

  const porCita = new Map(
    sesiones.map((s) => [
      s.appointmentId!,
      { cuerpo: s.body as unknown as CuerpoDeSesion, cerradaEn: s.createdAt },
    ]),
  );
  return citas
    .filter((c) => porCita.has(c.id))
    .map((c) => ({
      id: c.id,
      clientId: c.client_id,
      empieza: c.starts_at,
      cuerpo: porCita.get(c.id)!.cuerpo,
      cerradaEn: porCita.get(c.id)!.cerradaEn,
    }));
}

/**
 * La lista completa que ve la recepción: la cita, el paciente y las líneas
 * con precio. Y nada de la historia.
 */
export async function cobrosPendientesDe(
  prisma: PrismaClient,
  input: Rango,
): Promise<CobroPendiente[]> {
  const conSesion = await citasConSesionSinCobrar(prisma, input);
  if (conSesion.length === 0) return [];

  // Los nombres de los pacientes y de los servicios, de una vez. Y nada
  // más de ellos: ni email, ni notas, ni la ficha técnica.
  const [pacientes, items] = await Promise.all([
    prisma.client.findMany({
      where: {
        tenantId: input.tenantId,
        id: { in: [...new Set(conSesion.map((c) => c.clientId))] },
      },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.appointmentItem.findMany({
      where: { appointmentId: { in: conSesion.map((c) => c.id) } },
      orderBy: { sortOrder: "asc" },
      select: { appointmentId: true, serviceId: true },
    }),
  ]);
  const nombreDelPaciente = new Map(
    pacientes.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
  );

  // Un solo viaje al catálogo para todos los ids que aparecen, los de los
  // tratamientos y los de los servicios de las citas.
  const idsDeTratamientos = conSesion.flatMap(
    (c) => c.cuerpo.tratamientos ?? [],
  );
  const catalogo = await tratamientosPorId(prisma, input.tenantId, [
    ...idsDeTratamientos,
    ...items.map((i) => i.serviceId),
  ]);
  const porId = new Map(catalogo.map((t) => [t.serviceId, t]));

  const serviciosDe = new Map<string, string[]>();
  for (const i of items) {
    const nombre = porId.get(i.serviceId)?.nombre;
    if (!nombre) continue;
    const lista = serviciosDe.get(i.appointmentId) ?? [];
    lista.push(nombre);
    serviciosDe.set(i.appointmentId, lista);
  }

  return conSesion.map((c) => {
    const { cuerpo, cerradaEn } = c;
    // Las líneas y el total los calcula LA MISMA función pura que pinta el
    // pie de la sesión y el ticket de «Sesión cerrada». Tres sitios, una
    // cuenta: si la recepción viera un total distinto del que vio la
    // podóloga, una de las dos tendría razón y nadie sabría cuál.
    const resumen = resumenDeLaSesion({
      tratamientos: cuerpo.tratamientos ?? [],
      catalogo: (cuerpo.tratamientos ?? [])
        .map((id) => porId.get(id))
        .filter((t): t is NonNullable<typeof t> => t != null),
      dolor: cuerpo.dolor ?? null,
      verImportes: true,
    });
    return {
      appointmentId: c.id,
      empieza: c.empieza.toISOString(),
      paciente: {
        id: c.clientId,
        nombre: nombreDelPaciente.get(c.clientId) ?? "—",
      },
      servicios: serviciosDe.get(c.id) ?? [],
      // Del resumen se toman NOMBRE, PRECIO e IVA y nada más. `serviceId`
      // no hace falta en el mostrador y `null` no puede llegar: este
      // resumen se calcula con `verImportes: true` siempre, porque la
      // lista entera es de quien cobra.
      lineas: resumen.lineas.map((l) => ({
        nombre: l.nombre,
        precio: l.precio ?? 0,
        iva: l.iva ?? 0,
      })),
      total: resumen.total ?? 0,
      ivaTexto: resumen.ivaTexto,
      cerradaEn: cerradaEn.toISOString(),
    };
  });
}

/**
 * Sólo los ids de cita, para el aviso de la agenda.
 *
 * Es lo que la tarjeta de la cita necesita para pintar «Por cobrar» sin
 * una petición más, y es una lista de ids y nada más — la misma forma y la
 * misma razón que `valoracionesPendientesDe` de clinica-2.
 *
 * Sale del MISMO `citasConSesionSinCobrar` que la lista completa, así que
 * no puede decir otra cosa. Y **no toca el catálogo ni los nombres de los
 * pacientes**: esto se pinta cada vez que el mostrador abre la agenda, y
 * dos consultas de más por pintada es la clase de coste que se nota en el
 * tenant que más la usa. La lista completa sólo se pide al abrir el panel
 * de cobros, que es una vez.
 */
export async function sesionesPorCobrarDe(
  prisma: PrismaClient,
  input: Rango,
): Promise<string[]> {
  const pendientes = await citasConSesionSinCobrar(prisma, input);
  return pendientes.map((p) => p.id);
}
