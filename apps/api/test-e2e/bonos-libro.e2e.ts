// B-reservas-8 · EL LIBRO contra Postgres de verdad: la carrera por la
// última sesión, la idempotencia, el invariante y el append-only.
//
// POR QUÉ ESTE FICHERO EXISTE. Nada de lo que se prueba aquí se puede
// probar con un prisma falso:
//
//   · el `FOR UPDATE` de `apartar()` — «un `FOR UPDATE` no se puede fingir»
//     (`05` §4.1, y el spa lo midió con 34 pruebas contra MySQL real);
//   · el trigger `voucher_movements_append_only`;
//   · los nueve CHECK de la migración, incluido el del CONVENIO DEL SIGNO,
//     que es lo que hace que el invariante no pueda desalinearse.
//
// REGLA, heredada de v1.13: cada aserción va contra la BD por SQL, no
// contra la respuesta del API. Si el test puede pasar con la BD vacía, no
// es un e2e.

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

const { getPrisma, shutdown } = await import("../src/context.js");
const { sembrarEscenario, sembrarBono } = await import("./bonos-escenario.js");
type Escenario = Awaited<ReturnType<typeof sembrarEscenario>>;
const { borrarCuentasDePrueba } = await import("./borrar-tenant.js");
const gate = await import("../src/vouchers/gate.js");
const { derivarSaldo, desviacionDelInvariante } = await import(
  "@mipiacetpv/bonos"
);
const { siguienteNumero, normalizarCodigo } = await import(
  "../src/vouchers/numero.js"
);
const { calcularCaducidad, diaDeCaducidad, estaCaducado } = await import(
  "../src/vouchers/caducidad.js"
);
const { serviciosACubrir } = await import("../src/vouchers/servicios.js");

describe.skipIf(!e2eEnabled)("e2e · el libro de los bonos", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let e: Escenario;
  const tenantsCreados: string[] = [];

  beforeAll(async () => {
    e = await sembrarEscenario(prisma);
    tenantsCreados.push(e.tenantId);
  });

  afterAll(async () => {
    await borrarCuentasDePrueba(prisma, ...tenantsCreados);
    await shutdown();
  });

  // ── aserciones contra la BD ───────────────────────────────────────

  async function filaDelBono(id: string) {
    const rows = await prisma.$queryRaw<
      Array<{
        sessions_total: number;
        sessions_left: number;
        sessions_reserved: number;
        status: string;
      }>
    >`
      SELECT "sessions_total", "sessions_left", "sessions_reserved", "status"
        FROM "vouchers" WHERE "id" = ${id}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function libro(id: string) {
    return prisma.$queryRaw<
      Array<{
        tipo: string;
        sesiones: number;
        appointment_id: string | null;
        detalle: string;
      }>
    >`
      SELECT "tipo", "sesiones", "appointment_id", "detalle"
        FROM "voucher_movements" WHERE "voucher_id" = ${id}::uuid
       ORDER BY "created_at", "id"`;
  }

  /** El saldo DEL LIBRO y el de las columnas, y que coinciden. Es la
   *  comprobación que el prompt pide «en todo momento». */
  async function saldoCuadrado(id: string) {
    const lineas = (await libro(id)).map((l) => ({
      tipo: l.tipo,
      sesiones: Number(l.sesiones),
      appointmentId: l.appointment_id,
    }));
    const delLibro = derivarSaldo(lineas);
    expect(desviacionDelInvariante(delLibro)).toBe(0);
    const fila = await filaDelBono(id);
    // Y la caché no miente: si discrepara, MANDA EL LIBRO — y este test es
    // lo que lo detecta.
    expect({
      total: Number(fila.sessions_total),
      libres: Number(fila.sessions_left),
      apartadas: Number(fila.sessions_reserved),
    }).toEqual({
      total: delLibro.total,
      libres: delLibro.libres,
      apartadas: delLibro.apartadas,
    });
    return delLibro;
  }

  // ── el reloj de las citas ─────────────────────────────────────────
  //
  // El EXCLUDE del anti-solape es REAL aquí: dos citas de Rosario a la
  // misma hora las rechaza el GiST. Así que cada cita de este fichero
  // ocupa su propio hueco de 30 min, contados desde una base y hacia
  // adelante sin fin — un contador y no una hora del día, porque el test
  // del invariante crea doscientas y en un día no caben.
  const BASE_DE_LAS_CITAS = Date.parse("2026-11-03T06:00:00.000Z");
  let huecosGastados = 0;

  /** Una cita de verdad, en el siguiente hueco libre. */
  async function crearCita(
    servicios: string[],
    voucherId?: string | null,
  ): Promise<string> {
    const { createAgendaStore } = await import("../src/agenda/store.js");
    const store = createAgendaStore(prisma);
    // Cada cita, su hueco. `servicios.length` porque una visita de dos
    // servicios ocupa dos tramos de 30 min.
    const start = new Date(
      BASE_DE_LAS_CITAS + huecosGastados * 30 * 60_000,
    );
    huecosGastados += servicios.length;
    const items = servicios.map((serviceId, i) => ({
      serviceId,
      durationMin: 30,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      staffRequired: 1,
      sortOrder: i,
      startOffsetMin: i * 30,
    }));
    const view = await store.insertHold({
      tenantId: e.tenantId,
      externalId: randomUUID(),
      clientId: e.clientId,
      source: "PRESENCIAL",
      status: "CONFIRMED",
      pendingUntil: null,
      notes: null,
      timeslotStart: start,
      timeslotEnd: new Date(start.getTime() + items.length * 30 * 60_000),
      items,
      assignments: items.map((it, i) => ({
        appointmentItemIndex: i,
        reservableType: "STAFF" as const,
        staffUserId: e.cashierId,
        resourceId: null,
        startsAt: new Date(start.getTime() + it.startOffsetMin * 60_000),
        endsAt: new Date(
          start.getTime() + (it.startOffsetMin + it.durationMin) * 60_000,
        ),
      })),
      voucherId: voucherId ?? null,
      voucherCanal: "tpv",
      voucherUserId: e.cashierId,
    });
    return view.id;
  }

  async function apartarEnCita(voucherId: string, appointmentId: string) {
    return prisma.$transaction(async (tx) => {
      const servicios = await serviciosACubrir(tx, e.tenantId, [e.quiropodiaId]);
      return gate.apartar(tx, {
        tenantId: e.tenantId,
        voucherId,
        appointmentId,
        clientId: e.clientId,
        servicios,
        detalle: "Apartada por el test.",
        canal: "tpv",
        userId: e.cashierId,
        actor: null,
        ahora: new Date(),
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // TEST 2 · LA CARRERA POR LA ÚLTIMA SESIÓN LIBRE
  // ══════════════════════════════════════════════════════════════════
  //
  // Dos procesos a la vez por la ÚLTIMA sesión, repetido cinco veces:
  // siempre gana UNO y el otro recibe `agotado`. Es la prueba que el spa
  // midió (`05` §4.1 [M]) y la que no se puede fingir.
  it("2 · carrera por la última sesión libre: gana uno, el otro recibe agotado", async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      const bono = await sembrarBono(prisma, e, { sesiones: 1 });
      const citaA = await crearCita([e.quiropodiaId]);
      const citaB = await crearCita([e.quiropodiaId]);

      const [a, b] = await Promise.all([
        apartarEnCita(bono.id, citaA),
        apartarEnCita(bono.id, citaB),
      ]);
      const ganadores = [a, b].filter((r) => r.ok);
      const perdedores = [a, b].filter((r) => !r.ok);
      expect(ganadores).toHaveLength(1);
      expect(perdedores).toHaveLength(1);
      // Y el «no» es el correcto: la sesión se la llevó el otro, no es que
      // el bono no cubra ni que esté caducado.
      expect((perdedores[0] as { motivo: string }).motivo).toBe("agotado");

      // Contra la BD: UNA sola línea APARTADA y la sesión apartada, no
      // consumida.
      const lineas = await libro(bono.id);
      expect(lineas.filter((l) => l.tipo === "APARTADA")).toHaveLength(1);
      await saldoCuadrado(bono.id);
      const fila = await filaDelBono(bono.id);
      expect(Number(fila.sessions_left)).toBe(0);
      expect(Number(fila.sessions_reserved)).toBe(1);
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 4 · IDEMPOTENCIA POR EL LIBRO
  // ══════════════════════════════════════════════════════════════════
  //
  // `consumir` y `liberar` dos veces dejan UNA línea. Lo decide el estado
  // del libro y no quién llamó primero, porque «filas afectadas = 0» no
  // distingue «no me tocaba» de «ya estaba» (`07` pieza 18).
  it("4 · consumir dos veces deja UNA línea, y liberar dos veces también", async () => {
    const bono = await sembrarBono(prisma, e, { sesiones: 3 });
    const cita = await crearCita([e.quiropodiaId]);
    expect((await apartarEnCita(bono.id, cita)).ok).toBe(true);

    const consumir = () =>
      prisma.$transaction(async (tx) => {
        const servicios = await serviciosACubrir(tx, e.tenantId, [
          e.quiropodiaId,
        ]);
        return gate.consumir(tx, {
          tenantId: e.tenantId,
          appointmentId: cita,
          ticketLineId: null,
          servicio: servicios[0]!,
          detalle: "Consumida por el test.",
          canal: "tpv",
          userId: e.cashierId,
          actor: null,
          ahora: new Date(),
        });
      });

    const primera = await consumir();
    expect(primera.ok).toBe(true);
    expect((primera as { yaEstaba: boolean }).yaEstaba).toBe(false);
    const segunda = await consumir();
    expect(segunda.ok).toBe(true);
    expect((segunda as { yaEstaba: boolean }).yaEstaba).toBe(true);

    const lineas = await libro(bono.id);
    expect(lineas.filter((l) => l.tipo === "CONSUMIDA")).toHaveLength(1);
    const saldo = await saldoCuadrado(bono.id);
    expect(saldo).toEqual({ total: 3, consumidas: 1, apartadas: 0, libres: 2 });

    // Y liberar lo mismo, en otra cita.
    const cita2 = await crearCita([e.quiropodiaId]);
    expect((await apartarEnCita(bono.id, cita2)).ok).toBe(true);
    const liberar = () =>
      prisma.$transaction((tx) =>
        gate.liberar(tx, {
          tenantId: e.tenantId,
          appointmentId: cita2,
          detalle: "Liberada por el test.",
          canal: "tpv",
          userId: e.cashierId,
          actor: null,
          ahora: new Date(),
        }),
      );
    const l1 = await liberar();
    expect(l1.yaEstaba).toBe(false);
    const l2 = await liberar();
    expect(l2.yaEstaba).toBe(true);
    const lineas2 = await libro(bono.id);
    expect(lineas2.filter((l) => l.tipo === "LIBERADA")).toHaveLength(1);
    await saldoCuadrado(bono.id);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 5 · EL INVARIANTE TRAS 200 OPERACIONES ALEATORIAS
  // ══════════════════════════════════════════════════════════════════
  //
  //     total − consumidas − apartadas vivas = libres
  //
  // El álgebra ya lo garantiza (ver `@mipiacetpv/bonos/saldo.ts`). Lo que
  // esto comprueba es que el CÓDIGO QUE ESCRIBE las líneas no se sale del
  // convenio del signo — que es lo único que puede romperlo.
  //
  // La secuencia es aleatoria pero con SEMILLA FIJA: un test que falla una
  // vez cada cuarenta ejecuciones no se puede depurar.
  it("5 · el invariante del libro aguanta 200 operaciones aleatorias", async () => {
    const bono = await sembrarBono(prisma, e, { sesiones: 60 });
    // Generador con semilla (xorshift32). Sin `Math.random()`: la secuencia
    // tiene que ser la misma en el portátil y en el CI.
    let semilla = 20261018;
    const siguiente = (): number => {
      semilla ^= semilla << 13;
      semilla ^= semilla >>> 17;
      semilla ^= semilla << 5;
      return Math.abs(semilla) / 2 ** 31;
    };

    const citasApartadas: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const dado = siguiente();
      if (dado < 0.5 || citasApartadas.length === 0) {
        // APARTAR en una cita nueva. Cada cita ocupa su propio hueco (ver
        // el reloj de arriba): el EXCLUDE es real y lo que se prueba aquí
        // es el libro, no el anti-solape.
        const cita = await crearCita([e.quiropodiaId]);
        const r = await apartarEnCita(bono.id, cita);
        if (r.ok) citasApartadas.push(cita);
      } else if (dado < 0.8) {
        // CONSUMIR una de las apartadas.
        const cita = citasApartadas.shift()!;
        await prisma.$transaction(async (tx) => {
          const servicios = await serviciosACubrir(tx, e.tenantId, [
            e.quiropodiaId,
          ]);
          return gate.consumir(tx, {
            tenantId: e.tenantId,
            appointmentId: cita,
            ticketLineId: null,
            servicio: servicios[0]!,
            detalle: "Consumida (secuencia aleatoria).",
            canal: "tpv",
            userId: e.cashierId,
            actor: null,
            ahora: new Date(),
          });
        });
      } else {
        // LIBERAR una de las apartadas.
        const cita = citasApartadas.shift()!;
        await prisma.$transaction((tx) =>
          gate.liberar(tx, {
            tenantId: e.tenantId,
            appointmentId: cita,
            detalle: "Liberada (secuencia aleatoria).",
            canal: "tpv",
            userId: e.cashierId,
            actor: null,
            ahora: new Date(),
          }),
        );
      }
      // El invariante SE COMPRUEBA EN CADA PASO y no sólo al final: así el
      // rojo dice en qué operación se rompió.
      await saldoCuadrado(bono.id);
    }
  }, 180_000);

  // ══════════════════════════════════════════════════════════════════
  // TEST 6 · LA PUERTA NO ELIGE
  // ══════════════════════════════════════════════════════════════════
  it("6 · dos bonos que cubren lo mismo → la puerta devuelve los DOS", async () => {
    const a = await sembrarBono(prisma, e, { sesiones: 2 });
    const b = await sembrarBono(prisma, e, { sesiones: 4 });
    const bonos = await prisma.$transaction(async (tx) => {
      const servicios = await serviciosACubrir(tx, e.tenantId, [e.quiropodiaId]);
      return gate.bonosQueCubren(tx, {
        tenantId: e.tenantId,
        clientId: e.clientId,
        servicios,
        ahora: new Date(),
      });
    });
    const codigos = bonos.map((x) => x.code);
    expect(codigos).toContain(a.code);
    expect(codigos).toContain(b.code);
    // Y no se queda con uno «el mejor»: devuelve todos los vivos que
    // cubren, y es el front el que pregunta.
    expect(bonos.length).toBeGreaterThanOrEqual(2);
  });

  it("6b · y un bono de OTRA categoría no sale en la lista", async () => {
    const soloEstetica = await sembrarBono(prisma, e, {
      sesiones: 3,
      coversTagSlugs: ["estetica"],
    });
    const bonos = await prisma.$transaction(async (tx) => {
      const servicios = await serviciosACubrir(tx, e.tenantId, [e.quiropodiaId]);
      return gate.bonosQueCubren(tx, {
        tenantId: e.tenantId,
        clientId: e.clientId,
        servicios,
        ahora: new Date(),
      });
    });
    expect(bonos.map((x) => x.code)).not.toContain(soloEstetica.code);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 7 · CADUCIDAD: MESES DE CALENDARIO
  // ══════════════════════════════════════════════════════════════════
  it("7 · 31-ago + 6 meses = 28-feb, y el 28 entra entero", () => {
    // El caso del prompt, calculado en hora del centro.
    const venta = new Date("2026-08-31T10:00:00.000Z");
    const caduca = calcularCaducidad(venta, 6)!;
    expect(diaDeCaducidad(caduca)).toBe("2027-02-28");
    // 183 días desde el 31-ago-2026 serían el 1-mar-2027: si alguien
    // cambiara los meses por días, este test lo dice.
    expect(diaDeCaducidad(caduca)).not.toBe("2027-03-01");
    // El 28 ENTERO vale: las 23:59 locales del último día bueno, sí.
    expect(estaCaducado(caduca, new Date("2027-02-28T22:59:00.000Z"))).toBe(false);
    // Y el día siguiente, no.
    expect(estaCaducado(caduca, new Date("2027-03-01T00:00:00.000Z"))).toBe(true);
    // Bisiesto: 31-ago-2027 + 6 = 29-feb-2028.
    expect(
      diaDeCaducidad(calcularCaducidad(new Date("2027-08-31T10:00:00.000Z"), 6)!),
    ).toBe("2028-02-29");
  });

  it("7b · un bono caducado no aparta ni consume", async () => {
    const bono = await sembrarBono(prisma, e, {
      sesiones: 3,
      // Caducó ayer.
      expiresAt: new Date(Date.now() - 24 * 3600 * 1000),
    });
    const cita = await crearCita([e.quiropodiaId]);
    const r = await apartarEnCita(bono.id, cita);
    expect(r.ok).toBe(false);
    expect((r as { motivo: string }).motivo).toBe("caducado");
    // Contra la BD: ni una línea en el libro más allá del alta.
    const lineas = await libro(bono.id);
    expect(lineas.map((l) => l.tipo)).toEqual(["ALTA_INICIAL"]);
    await saldoCuadrado(bono.id);
  });

  // ══════════════════════════════════════════════════════════════════
  // TEST 8 · LA NUMERACIÓN
  // ══════════════════════════════════════════════════════════════════
  it("8 · el contador SE SALTA un número que ya existe", async () => {
    // El caso del spa: un bono con un número que llegó desde dev.
    const otro = await sembrarEscenario(prisma, { arranque: 1 });
    tenantsCreados.push(otro.tenantId);
    // Alguien metió el B3 por su cuenta.
    await sembrarBono(prisma, otro, { sesiones: 1, numero: 3 });
    // El contador va por el 2 (todavía no ha emitido ninguno).
    await prisma.$executeRaw`
      UPDATE "voucher_sequence" SET "ultimo" = 2
       WHERE "tenant_id" = ${otro.tenantId}::uuid`;
    const n = await prisma.$transaction((tx) =>
      siguienteNumero(tx, otro.tenantId),
    );
    expect(n.ok).toBe(true);
    // 3 está ocupado → se lo salta y da el 4. NO choca contra el índice
    // único, que es lo que tumbaría una venta.
    expect((n as { numero: number }).numero).toBe(4);
  });

  it("8b · con el CANDADO puesto no se emite nada", async () => {
    const sinConfirmar = await sembrarEscenario(prisma, {
      confirmarArranque: false,
    });
    tenantsCreados.push(sinConfirmar.tenantId);
    const n = await prisma.$transaction((tx) =>
      siguienteNumero(tx, sinConfirmar.tenantId),
    );
    expect(n.ok).toBe(false);
    expect((n as { error: string }).error).toBe("CANDADO_SIN_CONFIRMAR");
  });

  it("8c · el primer bono sale por el número de ARRANQUE, no por el 1", async () => {
    // El centro que viene de papel y va por el 231.
    const conTalonario = await sembrarEscenario(prisma, { arranque: 231 });
    tenantsCreados.push(conTalonario.tenantId);
    const n = await prisma.$transaction((tx) =>
      siguienteNumero(tx, conTalonario.tenantId),
    );
    expect(n).toMatchObject({ ok: true, numero: 231, code: "B231" });
  });

  it("8d · se acepta el número suelto: B87, b 87, 87, B-87", () => {
    expect(normalizarCodigo("B87")).toBe(87);
    expect(normalizarCodigo("b 87")).toBe(87);
    expect(normalizarCodigo("87")).toBe(87);
    expect(normalizarCodigo("B-87")).toBe(87);
    expect(normalizarCodigo("  b087 ")).toBe(87);
    // Y lo que NO es un número de bono se dice que no, en vez de adivinar.
    expect(normalizarCodigo("hola")).toBeNull();
    expect(normalizarCodigo("")).toBeNull();
    expect(normalizarCodigo("B0")).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════
  // EL TRIGGER: EL LIBRO ES DE SOLO INSERCIÓN
  // ══════════════════════════════════════════════════════════════════
  it("el libro no se edita ni se borra (trigger append-only)", async () => {
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    const [linea] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "voucher_movements"
       WHERE "voucher_id" = ${bono.id}::uuid LIMIT 1`;
    await expect(
      prisma.$executeRaw`
        UPDATE "voucher_movements" SET "sesiones" = 99
         WHERE "id" = ${linea!.id}::uuid`,
    ).rejects.toThrow(/LIBRO_VIOLADO/);
    await expect(
      prisma.$executeRaw`
        DELETE FROM "voucher_movements" WHERE "id" = ${linea!.id}::uuid`,
    ).rejects.toThrow(/LIBRO_VIOLADO/);
    // Y ni el UPDATE ni el DELETE dejaron nada a medias.
    const lineas = await libro(bono.id);
    expect(lineas).toHaveLength(1);
    expect(Number(lineas[0]!.sesiones)).toBe(2);
  });

  it("y una línea marcada es_prueba SÍ se borra: es la escapatoria del ensayo", async () => {
    // ADR-021 §5.1 · lo de prueba se marca y el reseteo se lo lleva. La
    // escapatoria se mide contra el estado REAL de la fila, no contra «el
    // padre ya no existe» — la rama que `20261017030000` tuvo que quitar.
    const bono = await sembrarBono(prisma, e, { sesiones: 1 });
    const prueba = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "voucher_movements"
        ("id", "tenant_id", "voucher_id", "tipo", "sesiones", "detalle",
         "motivo", "canal", "user_id", "es_prueba", "created_at")
      VALUES
        (gen_random_uuid(), ${e.tenantId}::uuid, ${bono.id}::uuid,
         'CORRECCION', 1, 'Línea de prueba', 'ajuste_alta_inicial', 'panel',
         ${e.cashierId}::uuid, true, ${new Date()})
      RETURNING "id"`;
    const borradas = await prisma.$executeRaw`
      DELETE FROM "voucher_movements" WHERE "id" = ${prueba[0]!.id}::uuid`;
    expect(borradas).toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════
  // EL CONVENIO DEL SIGNO, EN LA BASE
  // ══════════════════════════════════════════════════════════════════
  //
  // Es lo que hace que `libres = SUM(sesiones)` no se pueda escribir mal.
  // Si alguien quitara el CHECK, estas cuatro escrituras pasarían y el
  // invariante se desalinearía en silencio.
  it("el CHECK del signo rechaza una línea que no respeta el convenio", async () => {
    const bono = await sembrarBono(prisma, e, { sesiones: 2 });
    const cita = await crearCita([e.quiropodiaId]);
    const insertar = (tipo: string, sesiones: number, conCita: boolean) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "voucher_movements"
           ("id","tenant_id","voucher_id","tipo","sesiones","appointment_id",
            "detalle","canal","user_id","es_prueba","created_at")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4,
                 ${conCita ? "$5::uuid" : "NULL"},
                 'forzada', 'panel', $6::uuid, false, now())`,
        e.tenantId,
        bono.id,
        tipo,
        sesiones,
        ...(conCita ? [cita, e.cashierId] : [e.cashierId]),
      );
    // Una APARTADA que no resta una.
    await expect(insertar("APARTADA", -2, true)).rejects.toThrow();
    // Una LIBERADA que no suma una.
    await expect(insertar("LIBERADA", 2, true)).rejects.toThrow();
    // Una CONSUMIDA de cita que resta de libres (la sesión ya salió al
    // apartarse: contarla dos veces es el fallo que el CHECK impide).
    await expect(insertar("CONSUMIDA", -1, true)).rejects.toThrow();
    // Y una CONSUMIDA sin cita que NO resta.
    await expect(insertar("CONSUMIDA", 0, false)).rejects.toThrow();
    // Un tipo que no está en la lista.
    await expect(insertar("INVENTADO", 1, false)).rejects.toThrow();
    // El libro sigue con su única línea.
    expect(await libro(bono.id)).toHaveLength(1);
  });
});
