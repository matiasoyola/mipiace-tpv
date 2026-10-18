// B-reservas-8 · LA PUERTA DE CANJE.
//
// Cuatro operaciones, y son la ÚNICA forma de tocar un bono desde fuera de
// este módulo. La agenda, la caja, la clínica y —mañana— la reserva online
// llaman aquí; **nadie más lee ni escribe las tablas de bonos.**
//
//   · `consultar()`  — ¿qué pasa con este código? Lista cerrada de estados.
//   · `apartar()`    — reserva una sesión para una cita. Fila bloqueada.
//   · `consumir()`   — lo apartado pasa a consumido. Idempotente.
//   · `liberar()`    — lo apartado vuelve a libre. Idempotente.
//
// ── Las dos reglas que explican todo el fichero ────────────────────────
//
// **1. Lo que dijo `consultar()` medio segundo antes aquí ya no vale.**
// `apartar()` vuelve a comprobar TODO con la fila del bono bloqueada
// (`SELECT … FOR UPDATE`). No es paranoia: dos recepcionistas dando la
// última sesión del mismo bono a la vez es el caso que el spa midió, y el
// test lo repite cinco veces.
//
// **2. `consumir()` y `liberar()` las decide EL ESTADO DEL LIBRO, no quién
// llamó primero.** Una anulación puede llegar por dos caminos (el botón del
// mostrador y el enlace de autogestión), y «filas afectadas = 0» no es un
// candado: no distingue «no me tocaba» de «ya estaba» (`07` pieza 18). Así
// que las dos leen el libro de ese bono, ven si la sesión de esa cita sigue
// apartada, y sólo entonces escriben.
//
// ── Y la que se nota en la pantalla ────────────────────────────────────
//
// **La puerta no elige.** Si dos bonos vivos de la clienta cubren el mismo
// servicio, `bonosQueCubren()` devuelve LOS DOS y el front pregunta. Elegir
// el primero por fecha sería gastar el bono equivocado —el de 10 sesiones
// en vez del de 1 que caduca el viernes— y nadie se enteraría hasta que el
// de 1 caducara con una sesión dentro.

// `Prisma` como VALOR y no sólo como tipo: se usa `Prisma.sql` para
// compartir la lista de columnas entre las cinco consultas de este fichero.
import { Prisma } from "@mipiacetpv/db";

import { estaCaducado } from "./caducidad.js";
import {
  cubreTodos,
  resolverCobertura,
  type CoberturaDelBono,
  type ServicioACubrir,
} from "./cobertura.js";
import { derivarSaldo, type CanalMovimiento } from "@mipiacetpv/bonos";

import { escribirLinea, leerLibro } from "./libro.js";
import { normalizarCodigo } from "./numero.js";

// ══════════════════════════════════════════════════════════════════════
// LO QUE SALE POR LA PUERTA
// ══════════════════════════════════════════════════════════════════════

/**
 * La LISTA CERRADA de estados de `consultar()`. Cerrada de verdad: el front
 * tiene un mensaje por cada uno y un `default` que dice «llama al centro».
 * Añadir uno es tocar los dos lados a la vez, que es justo lo que se quiere.
 */
export type EstadoConsulta =
  | "ok"
  | "noexiste"
  | "otro_cliente"
  | "no_cubre"
  | "agotado"
  | "caducado"
  | "anulado";

/** El bono como lo ve quien pregunta. **Sin un solo importe**: los euros
 *  los añade quien tenga derecho a verlos (ver `vistas.ts`). */
export interface BonoResumen {
  id: string;
  code: string;
  clientId: string;
  nombre: string;
  sesionesTotal: number;
  sesionesLibres: number;
  sesionesApartadas: number;
  /** El instante exclusivo en que deja de valer. `null` = sin caducidad. */
  caducaAt: Date | null;
  status: string;
  esPrueba: boolean;
}

export interface ResultadoConsulta {
  estado: EstadoConsulta;
  /** El bono, cuando se ha encontrado algo —aunque el estado sea un «no».
   *  Recepción necesita poder decir «el B87 está caducado», con su nombre. */
  bono: BonoResumen | null;
  /** Por qué cubre, cuando se preguntó por un servicio y lo cubre. */
  porQueCubre: "servicio" | "categoria" | null;
}

/** La fila del bono tal y como la lee este módulo. */
interface FilaBono {
  id: string;
  tenant_id: string;
  client_id: string;
  code: string;
  name_snapshot: string;
  sessions_total: number;
  sessions_left: number;
  sessions_reserved: number;
  covers_service_ids: string[];
  covers_tag_slugs: string[];
  expires_at: Date | null;
  status: string;
  es_prueba: boolean;
}

const COLUMNAS_BONO = Prisma.sql`
  "id", "tenant_id", "client_id", "code", "name_snapshot", "sessions_total",
  "sessions_left", "sessions_reserved", "covers_service_ids",
  "covers_tag_slugs", "expires_at", "status", "es_prueba"`;

/** La cobertura congelada, en la forma que espera la función pura. El SQL
 *  crudo devuelve snake_case y `resolverCobertura` es de todos: la
 *  traducción vive en un sitio y no en cinco llamadas. */
function aCobertura(f: FilaBono): CoberturaDelBono {
  return {
    coversServiceIds: f.covers_service_ids,
    coversTagSlugs: f.covers_tag_slugs,
  };
}

function aResumen(f: FilaBono): BonoResumen {
  return {
    id: f.id,
    code: f.code,
    clientId: f.client_id,
    nombre: f.name_snapshot,
    sesionesTotal: Number(f.sessions_total),
    sesionesLibres: Number(f.sessions_left),
    sesionesApartadas: Number(f.sessions_reserved),
    caducaAt: f.expires_at,
    status: f.status,
    esPrueba: f.es_prueba,
  };
}

// ══════════════════════════════════════════════════════════════════════
// CONSULTAR
// ══════════════════════════════════════════════════════════════════════

export interface ConsultarInput {
  tenantId: string;
  /** Lo que alguien teclea: `B87`, `b 87`, `87`, `B-87`. */
  texto: string;
  /** Si se da, un bono de otra ficha sale `otro_cliente`. */
  clienteId?: string | null;
  /** Si se da, se comprueba la cobertura y puede salir `no_cubre`. */
  servicio?: ServicioACubrir | null;
  ahora: Date;
}

/**
 * ¿Qué pasa con este código?
 *
 * ── EL ORDEN DE LAS COMPROBACIONES, que es una decisión ───────────────
 *
 * `05` §4.1 lo dice así: «primero lo que se arregla en el momento, luego lo
 * que hay que mirar». En el spa lo que se arreglaba solo era el teléfono de
 * la clienta, que aquí no existe (no hay reserva online todavía), así que lo
 * que queda es:
 *
 *   1. `noexiste`     — sin fila no se puede comprobar nada más.
 *   2. `otro_cliente` — **lo que recepción arregla en el mostrador**: es el
 *      bono de su madre, o se buscó la ficha equivocada. No toca el bono.
 *   3. `anulado` / `caducado` / `agotado` — EL ESTADO DEL BONO.
 *   4. `no_cubre`     — lo único que depende de qué se intenta canjear.
 *
 * **Y aquí hay una desviación del orden literal de la lista del prompt**,
 * que pone `no_cubre` antes de `agotado`/`caducado`/`anulado`: un bono
 * caducado no cubre NADA, así que contestar «no vale para quiropodia»
 * mandaría a recepción a buscar otro servicio que tampoco va a funcionar.
 * Lo que necesita oír es «ese bono está caducado», que sí tiene arreglo
 * (que el encargado lo prolongue). Queda dicho en el `-done`.
 */
export async function consultar(
  tx: Prisma.TransactionClient,
  input: ConsultarInput,
): Promise<ResultadoConsulta> {
  const numero = normalizarCodigo(input.texto);
  if (numero == null) {
    return { estado: "noexiste", bono: null, porQueCubre: null };
  }
  const filas = await tx.$queryRaw<FilaBono[]>`
    SELECT ${COLUMNAS_BONO}
      FROM "vouchers"
     WHERE "tenant_id" = ${input.tenantId}::uuid
       AND "number" = ${numero}
     LIMIT 1`;
  const fila = filas[0];
  if (!fila) return { estado: "noexiste", bono: null, porQueCubre: null };
  const bono = aResumen(fila);

  if (input.clienteId != null && fila.client_id !== input.clienteId) {
    return { estado: "otro_cliente", bono, porQueCubre: null };
  }
  if (fila.status === "ANULADO") {
    return { estado: "anulado", bono, porQueCubre: null };
  }
  if (estaCaducado(fila.expires_at, input.ahora)) {
    return { estado: "caducado", bono, porQueCubre: null };
  }
  if (Number(fila.sessions_left) <= 0) {
    return { estado: "agotado", bono, porQueCubre: null };
  }
  if (input.servicio) {
    const motivo = resolverCobertura(aCobertura(fila), input.servicio);
    if (!motivo.cubre) {
      return { estado: "no_cubre", bono, porQueCubre: null };
    }
    return {
      estado: "ok",
      bono,
      porQueCubre: motivo.por === "servicio" ? "servicio" : "categoria",
    };
  }
  return { estado: "ok", bono, porQueCubre: null };
}

/**
 * Los bonos VIVOS de una clienta que cubren TODOS estos servicios.
 *
 * **No elige.** Si hay dos, devuelve dos y el front pregunta. Ordenados por
 * caducidad más próxima primero y luego por número, para que la lista sea
 * estable y la sugerencia de arriba sea la sensata — pero la elección sigue
 * siendo de la persona.
 */
export async function bonosQueCubren(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    clientId: string;
    servicios: ServicioACubrir[];
    ahora: Date;
  },
): Promise<BonoResumen[]> {
  if (input.servicios.length === 0) return [];
  const filas = await tx.$queryRaw<FilaBono[]>`
    SELECT ${COLUMNAS_BONO}
      FROM "vouchers"
     WHERE "tenant_id" = ${input.tenantId}::uuid
       AND "client_id" = ${input.clientId}::uuid
       AND "type" = 'SESSIONS'
       AND "status" = 'ACTIVO'
       AND "sessions_left" > 0
       AND ("expires_at" IS NULL OR "expires_at" > ${input.ahora})
     ORDER BY "expires_at" ASC NULLS LAST, "number" ASC`;
  return filas.filter((f) => cubreTodos(aCobertura(f), input.servicios)).map(aResumen);
}

// ══════════════════════════════════════════════════════════════════════
// APARTAR
// ══════════════════════════════════════════════════════════════════════

export type MotivoNoApartar =
  | "noexiste"
  | "otro_cliente"
  | "no_cubre"
  | "agotado"
  | "caducado"
  | "anulado"
  /** Un solo bono por cita (S6). */
  | "ya_aplicado";

export type ResultadoApartar =
  | { ok: true; bono: BonoResumen; movimientoId: string }
  | { ok: false; motivo: MotivoNoApartar; bono: BonoResumen | null };

export interface ApartarInput {
  tenantId: string;
  voucherId: string;
  appointmentId: string;
  clientId: string | null;
  /** Los servicios de la cita. El bono tiene que cubrirlos TODOS. */
  servicios: ServicioACubrir[];
  /** Para el `detalle` que lee recepción: «para la cita del 3-nov 10:30». */
  detalle: string;
  canal: CanalMovimiento;
  userId: string | null;
  actor: string | null;
  ahora: Date;
}

/**
 * Aparta una sesión para una cita. **Va dentro de la transacción de la
 * cita: o las dos o ninguna.**
 *
 * La fila del bono se bloquea con `FOR UPDATE` y se vuelve a comprobar
 * TODO, incluido el saldo. El decremento es condicionado
 * (`WHERE sessions_left > 0`) sobre la fila ya bloqueada, así que de dos
 * procesos por la última sesión gana uno y el otro recibe `agotado`.
 *
 * El `UPDATE` de `appointments.voucher_id` va aquí y no en el llamante para
 * que la fila de la cita y el libro no puedan contar cosas distintas: si
 * esta función devuelve `ok`, la cita ES de bono.
 */
export async function apartar(
  tx: Prisma.TransactionClient,
  input: ApartarInput,
): Promise<ResultadoApartar> {
  const filas = await tx.$queryRaw<FilaBono[]>`
    SELECT ${COLUMNAS_BONO}
      FROM "vouchers"
     WHERE "id" = ${input.voucherId}::uuid
       AND "tenant_id" = ${input.tenantId}::uuid
     FOR UPDATE`;
  const fila = filas[0];
  if (!fila) return { ok: false, motivo: "noexiste", bono: null };
  const bono = aResumen(fila);

  // Un solo bono por cita, decidido por EL LIBRO y por la fila de la cita.
  // Las dos: el libro cubre «ya se apartó algo para esta cita» incluso de
  // otro bono, y la fila cubre el caso de una cita enlazada por un camino
  // que todavía no escribió su línea.
  const yaEnElLibro = await tx.$queryRaw<Array<{ uno: number }>>`
    SELECT 1 AS uno
      FROM "voucher_movements"
     WHERE "tenant_id" = ${input.tenantId}::uuid
       AND "appointment_id" = ${input.appointmentId}::uuid
       AND "tipo" IN ('APARTADA', 'CONSUMIDA')
     LIMIT 1`;
  if (yaEnElLibro.length > 0) {
    return { ok: false, motivo: "ya_aplicado", bono };
  }
  const citaEnlazada = await tx.$queryRaw<Array<{ voucher_id: string | null }>>`
    SELECT "voucher_id"
      FROM "appointments"
     WHERE "id" = ${input.appointmentId}::uuid
       AND "tenant_id" = ${input.tenantId}::uuid
     LIMIT 1`;
  if (citaEnlazada[0]?.voucher_id != null) {
    return { ok: false, motivo: "ya_aplicado", bono };
  }

  if (input.clientId != null && fila.client_id !== input.clientId) {
    return { ok: false, motivo: "otro_cliente", bono };
  }
  if (fila.status === "ANULADO") return { ok: false, motivo: "anulado", bono };
  if (estaCaducado(fila.expires_at, input.ahora)) {
    return { ok: false, motivo: "caducado", bono };
  }
  if (!cubreTodos(aCobertura(fila), input.servicios)) {
    return { ok: false, motivo: "no_cubre", bono };
  }

  // El decremento condicionado, sobre la fila ya bloqueada. Si otro proceso
  // se llevó la última sesión antes de que llegáramos al `FOR UPDATE`, aquí
  // `sessions_left` ya vale 0 y no se toca nada.
  const tocadas = await tx.$executeRaw`
    UPDATE "vouchers"
       SET "sessions_left" = "sessions_left" - 1,
           "sessions_reserved" = "sessions_reserved" + 1,
           "updated_at" = ${input.ahora}
     WHERE "id" = ${input.voucherId}::uuid
       AND "sessions_left" > 0`;
  if (tocadas === 0) return { ok: false, motivo: "agotado", bono };

  const movimientoId = await escribirLinea(tx, {
    tenantId: input.tenantId,
    voucherId: input.voucherId,
    tipo: "APARTADA",
    sesiones: -1,
    appointmentId: input.appointmentId,
    detalle: input.detalle,
    canal: input.canal,
    userId: input.userId,
    actor: input.actor,
    esPrueba: fila.es_prueba,
    createdAt: input.ahora,
  });

  await tx.$executeRaw`
    UPDATE "appointments"
       SET "voucher_id" = ${input.voucherId}::uuid, "updated_at" = ${input.ahora}
     WHERE "id" = ${input.appointmentId}::uuid
       AND "tenant_id" = ${input.tenantId}::uuid`;

  return {
    ok: true,
    movimientoId,
    bono: {
      ...bono,
      sesionesLibres: bono.sesionesLibres - 1,
      sesionesApartadas: bono.sesionesApartadas + 1,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// CONSUMIR
// ══════════════════════════════════════════════════════════════════════

export type ResultadoConsumir =
  /** Se escribió la línea. */
  | { ok: true; movimientoId: string; bono: BonoResumen; yaEstaba: false }
  /** Ya estaba consumido: idempotencia por el libro, sin segunda línea. */
  | { ok: true; movimientoId: null; bono: BonoResumen; yaEstaba: true }
  /** Lo que se hizo NO lo cubre el bono: lo apartado se LIBERÓ y la línea
   *  se cobra normal. Nunca se consume un bono contra lo que no cubre. */
  | { ok: false; motivo: "no_cubre"; bono: BonoResumen; liberado: boolean }
  | { ok: false; motivo: "sin_apartar" | "noexiste" | "anulado"; bono: BonoResumen | null };

export interface ConsumirInput {
  tenantId: string;
  /** El camino de la CITA: lo apartado pasa a consumido. */
  appointmentId?: string | null;
  /** El camino SIN CITA (peluquería sin agenda): se consume directo. */
  voucherId?: string | null;
  /** La línea del ticket a la que se imputa. Es lo que enlaza el libro con
   *  el cobro sin duplicarlo. */
  ticketLineId: string | null;
  /** Lo que SE HIZO. Se comprueba contra la cobertura congelada. */
  servicio: ServicioACubrir;
  detalle: string;
  /** La frase del libro cuando lo hecho NO lo cubre el bono. La escribe el
   *  llamante porque es el único que sabe cómo se llama el servicio que
   *  acabó haciéndose (aquí sólo llegan ids y tags). */
  detalleSiNoCubre?: string;
  canal: CanalMovimiento;
  userId: string | null;
  actor: string | null;
  ahora: Date;
}

/**
 * Lo apartado pasa a consumido, contra LO QUE SE HIZO.
 *
 * Idempotente **por el estado del libro**: si ya hay una `CONSUMIDA` de esa
 * cita, no se escribe una segunda y se contesta `yaEstaba`. Un cobro que se
 * reintenta por un corte de red no gasta dos sesiones.
 *
 * Y la regla dura del bloque: **nunca se consume un bono contra un servicio
 * que no cubre.** Si la sesión clínica acabó siendo otra cosa (clinica-3: se
 * cobra lo que se hizo, no lo que se reservó), lo apartado se LIBERA y la
 * línea se cobra normal. El cobro no se cae por eso —cobrar siempre se
 * puede— y la ficha enseña por qué.
 */
export async function consumir(
  tx: Prisma.TransactionClient,
  input: ConsumirInput,
): Promise<ResultadoConsumir> {
  if (input.appointmentId != null) {
    return consumirDeCita(tx, input, input.appointmentId);
  }
  if (input.voucherId != null) {
    return consumirSinCita(tx, input, input.voucherId);
  }
  return { ok: false, motivo: "noexiste", bono: null };
}

async function consumirDeCita(
  tx: Prisma.TransactionClient,
  input: ConsumirInput,
  appointmentId: string,
): Promise<ResultadoConsumir> {
  // Qué dice el libro de esta cita. Es lo que decide, no «filas afectadas».
  const lineas = await tx.$queryRaw<
    Array<{ voucher_id: string; tipo: string }>
  >`
    SELECT "voucher_id", "tipo"
      FROM "voucher_movements"
     WHERE "tenant_id" = ${input.tenantId}::uuid
       AND "appointment_id" = ${appointmentId}::uuid
     ORDER BY "created_at", "id"`;
  if (lineas.length === 0) {
    return { ok: false, motivo: "sin_apartar", bono: null };
  }
  const voucherId = lineas[0]!.voucher_id;
  const consumidas = lineas.filter((l) => l.tipo === "CONSUMIDA").length;
  const apartadas = lineas.filter((l) => l.tipo === "APARTADA").length;
  const liberadas = lineas.filter((l) => l.tipo === "LIBERADA").length;

  const fila = await bloquear(tx, input.tenantId, voucherId);
  if (!fila) return { ok: false, motivo: "noexiste", bono: null };
  const bono = aResumen(fila);

  if (consumidas > 0) {
    return { ok: true, movimientoId: null, bono, yaEstaba: true };
  }
  // Lo apartado ya se liberó (anulación que llegó por el otro camino): no
  // hay nada que consumir, y eso no es un error.
  if (apartadas - liberadas <= 0) {
    return { ok: false, motivo: "sin_apartar", bono };
  }
  if (fila.status === "ANULADO") return { ok: false, motivo: "anulado", bono };

  // LA REGLA DURA. Si lo que se hizo no lo cubre, se libera y se cobra.
  if (!resolverCobertura(aCobertura(fila), input.servicio).cubre) {
    await liberarApartada(tx, {
      tenantId: input.tenantId,
      voucherId,
      appointmentId,
      detalle:
        input.detalleSiNoCubre ??
        "Liberada: lo que se hizo no lo cubre este bono, así que la línea se cobra normal.",
      canal: input.canal,
      userId: input.userId,
      actor: input.actor,
      esPrueba: fila.es_prueba,
      ahora: input.ahora,
    });
    return { ok: false, motivo: "no_cubre", bono, liberado: true };
  }

  // La sesión pasa de APARTADA a CONSUMIDA. `libres` no se mueve —salió al
  // apartarse— y por eso la línea vale 0 (ver el convenio del signo).
  await tx.$executeRaw`
    UPDATE "vouchers"
       SET "sessions_reserved" = "sessions_reserved" - 1,
           "updated_at" = ${input.ahora}
     WHERE "id" = ${voucherId}::uuid
       AND "sessions_reserved" > 0`;
  const movimientoId = await escribirLinea(tx, {
    tenantId: input.tenantId,
    voucherId,
    tipo: "CONSUMIDA",
    sesiones: 0,
    appointmentId,
    ticketLineId: input.ticketLineId,
    detalle: input.detalle,
    canal: input.canal,
    userId: input.userId,
    actor: input.actor,
    esPrueba: fila.es_prueba,
    createdAt: input.ahora,
  });
  await recalcularEstado(tx, input.tenantId, voucherId, input.ahora);
  return {
    ok: true,
    movimientoId,
    yaEstaba: false,
    bono: { ...bono, sesionesApartadas: bono.sesionesApartadas - 1 },
  };
}

async function consumirSinCita(
  tx: Prisma.TransactionClient,
  input: ConsumirInput,
  voucherId: string,
): Promise<ResultadoConsumir> {
  // Idempotencia por LÍNEA DE TICKET: el mismo cobro reintentado no gasta
  // dos sesiones. Sin línea no hay idempotencia posible y se dice: este
  // camino no se llama sin ella (lo garantiza el llamante en `caja.ts`).
  if (input.ticketLineId == null) {
    return { ok: false, motivo: "sin_apartar", bono: null };
  }
  const yaEstaba = await tx.$queryRaw<Array<{ uno: number }>>`
    SELECT 1 AS uno
      FROM "voucher_movements"
     WHERE "tenant_id" = ${input.tenantId}::uuid
       AND "ticket_line_id" = ${input.ticketLineId}::uuid
       AND "tipo" = 'CONSUMIDA'
     LIMIT 1`;
  const fila = await bloquear(tx, input.tenantId, voucherId);
  if (!fila) return { ok: false, motivo: "noexiste", bono: null };
  const bono = aResumen(fila);
  if (yaEstaba.length > 0) {
    return { ok: true, movimientoId: null, bono, yaEstaba: true };
  }
  if (fila.status === "ANULADO") return { ok: false, motivo: "anulado", bono };
  if (estaCaducado(fila.expires_at, input.ahora)) {
    return { ok: false, motivo: "sin_apartar", bono };
  }
  if (!resolverCobertura(aCobertura(fila), input.servicio).cubre) {
    return { ok: false, motivo: "no_cubre", bono, liberado: false };
  }
  const tocadas = await tx.$executeRaw`
    UPDATE "vouchers"
       SET "sessions_left" = "sessions_left" - 1,
           "updated_at" = ${input.ahora}
     WHERE "id" = ${voucherId}::uuid
       AND "sessions_left" > 0`;
  if (tocadas === 0) return { ok: false, motivo: "sin_apartar", bono };
  const movimientoId = await escribirLinea(tx, {
    tenantId: input.tenantId,
    voucherId,
    tipo: "CONSUMIDA",
    sesiones: -1,
    ticketLineId: input.ticketLineId,
    detalle: input.detalle,
    canal: input.canal,
    userId: input.userId,
    actor: input.actor,
    esPrueba: fila.es_prueba,
    createdAt: input.ahora,
  });
  await recalcularEstado(tx, input.tenantId, voucherId, input.ahora);
  return {
    ok: true,
    movimientoId,
    yaEstaba: false,
    bono: { ...bono, sesionesLibres: bono.sesionesLibres - 1 },
  };
}

// ══════════════════════════════════════════════════════════════════════
// LIBERAR
// ══════════════════════════════════════════════════════════════════════

export type ResultadoLiberar =
  | { ok: true; movimientoId: string; yaEstaba: false; bono: BonoResumen }
  | { ok: true; movimientoId: null; yaEstaba: true; bono: BonoResumen | null };

/**
 * Lo apartado vuelve a libre. Idempotente **por el estado del libro**.
 *
 * Una anulación puede llegar por dos caminos —el botón del mostrador y, el
 * día que exista, el enlace de autogestión—, así que dos llamadas dejan UNA
 * línea. Y una cita que nunca apartó nada no es un error: se contesta
 * `yaEstaba` y no se escribe nada.
 */
export async function liberar(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    appointmentId: string;
    detalle: string;
    canal: CanalMovimiento;
    userId: string | null;
    actor: string | null;
    ahora: Date;
  },
): Promise<ResultadoLiberar> {
  const lineas = await tx.$queryRaw<Array<{ voucher_id: string; tipo: string }>>`
    SELECT "voucher_id", "tipo"
      FROM "voucher_movements"
     WHERE "tenant_id" = ${input.tenantId}::uuid
       AND "appointment_id" = ${input.appointmentId}::uuid
     ORDER BY "created_at", "id"`;
  if (lineas.length === 0) {
    return { ok: true, movimientoId: null, yaEstaba: true, bono: null };
  }
  const voucherId = lineas[0]!.voucher_id;
  const apartadas = lineas.filter((l) => l.tipo === "APARTADA").length;
  const liberadas = lineas.filter((l) => l.tipo === "LIBERADA").length;
  const consumidas = lineas.filter((l) => l.tipo === "CONSUMIDA").length;
  const fila = await bloquear(tx, input.tenantId, voucherId);
  if (!fila) return { ok: true, movimientoId: null, yaEstaba: true, bono: null };
  const bono = aResumen(fila);
  // Nada vivo que liberar: ya se liberó, o ya se consumió. En los dos casos
  // la respuesta es la misma y no se escribe una segunda línea.
  if (apartadas - liberadas - consumidas <= 0) {
    return { ok: true, movimientoId: null, yaEstaba: true, bono };
  }
  const movimientoId = await liberarApartada(tx, {
    tenantId: input.tenantId,
    voucherId,
    appointmentId: input.appointmentId,
    detalle: input.detalle,
    canal: input.canal,
    userId: input.userId,
    actor: input.actor,
    esPrueba: fila.es_prueba,
    ahora: input.ahora,
  });
  return {
    ok: true,
    movimientoId,
    yaEstaba: false,
    bono: {
      ...bono,
      sesionesLibres: bono.sesionesLibres + 1,
      sesionesApartadas: bono.sesionesApartadas - 1,
    },
  };
}

/** El cuerpo de la liberación, compartido por `liberar()` y por la rama de
 *  «lo que se hizo no lo cubre» de `consumir()`. */
async function liberarApartada(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string;
    voucherId: string;
    appointmentId: string;
    detalle: string;
    canal: CanalMovimiento;
    userId: string | null;
    actor: string | null;
    esPrueba: boolean;
    ahora: Date;
  },
): Promise<string> {
  await tx.$executeRaw`
    UPDATE "vouchers"
       SET "sessions_left" = "sessions_left" + 1,
           "sessions_reserved" = "sessions_reserved" - 1,
           "updated_at" = ${p.ahora}
     WHERE "id" = ${p.voucherId}::uuid
       AND "sessions_reserved" > 0`;
  const movimientoId = await escribirLinea(tx, {
    tenantId: p.tenantId,
    voucherId: p.voucherId,
    tipo: "LIBERADA",
    sesiones: 1,
    appointmentId: p.appointmentId,
    detalle: p.detalle,
    canal: p.canal,
    userId: p.userId,
    actor: p.actor,
    esPrueba: p.esPrueba,
    createdAt: p.ahora,
  });
  // La fila de la cita y el libro no pueden contar cosas distintas: si la
  // sesión volvió a libre, esta cita ya no es una cita de bono. La TRAZA de
  // que lo fue se queda en el libro, que es donde no se borra nada.
  await tx.$executeRaw`
    UPDATE "appointments"
       SET "voucher_id" = NULL, "updated_at" = ${p.ahora}
     WHERE "id" = ${p.appointmentId}::uuid
       AND "tenant_id" = ${p.tenantId}::uuid`;
  await recalcularEstado(tx, p.tenantId, p.voucherId, p.ahora);
  return movimientoId;
}

// ══════════════════════════════════════════════════════════════════════
// PIEZAS COMPARTIDAS
// ══════════════════════════════════════════════════════════════════════

async function bloquear(
  tx: Prisma.TransactionClient,
  tenantId: string,
  voucherId: string,
): Promise<FilaBono | null> {
  const filas = await tx.$queryRaw<FilaBono[]>`
    SELECT ${COLUMNAS_BONO}
      FROM "vouchers"
     WHERE "id" = ${voucherId}::uuid
       AND "tenant_id" = ${tenantId}::uuid
     FOR UPDATE`;
  return filas[0] ?? null;
}

/**
 * `AGOTADO` cuando no queda NADA que hacer con el bono: ni libres ni
 * apartadas. Mientras haya una apartada sigue `ACTIVO` —se puede liberar—,
 * y por eso no basta con mirar `sessions_left`.
 *
 * `ANULADO` no se toca nunca desde aquí: lo pone la devolución de la venta.
 * `CADUCADO` tampoco: la verdad es `expires_at` y la columna se pone al día
 * cuando alguien lee la ficha (`marcarCaducados`), no con un job.
 */
async function recalcularEstado(
  tx: Prisma.TransactionClient,
  tenantId: string,
  voucherId: string,
  ahora: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "vouchers"
       SET "status" = CASE
             WHEN "sessions_left" = 0 AND "sessions_reserved" = 0 THEN 'AGOTADO'
             ELSE 'ACTIVO'
           END,
           "updated_at" = ${ahora}
     WHERE "id" = ${voucherId}::uuid
       AND "tenant_id" = ${tenantId}::uuid
       AND "status" IN ('ACTIVO', 'AGOTADO')`;
}

/**
 * Pone al día la columna `status` de los bonos que ya han caducado.
 *
 * **No hay job.** La verdad es `expires_at` y todas las comprobaciones de
 * este fichero la miran, así que un bono caducado NUNCA se aparta ni se
 * consume por mucho que su columna diga `ACTIVO`. Esta función existe para
 * que la ficha, los listados y los informes digan «caducado» sin que cada
 * uno repita la comparación —y se llama desde donde ya se iba a leer, así
 * que no añade una consulta a nadie.
 */
export async function marcarCaducados(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ahora: Date,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "vouchers"
       SET "status" = 'CADUCADO', "updated_at" = ${ahora}
     WHERE "tenant_id" = ${tenantId}::uuid
       AND "status" IN ('ACTIVO', 'AGOTADO')
       AND "expires_at" IS NOT NULL
       AND "expires_at" <= ${ahora}`;
}

/** El saldo derivado del LIBRO de un bono. Para la ruta de salud y para el
 *  test del invariante: aquí no se lee ninguna columna de caché. */
export async function saldoSegunElLibro(
  tx: Prisma.TransactionClient,
  voucherId: string,
) {
  return derivarSaldo(await leerLibro(tx, voucherId));
}
