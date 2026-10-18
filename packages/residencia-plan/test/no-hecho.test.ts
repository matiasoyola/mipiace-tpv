// residencia-5 · **LA TABLA DEL «NO HECHO».**
//
// Los seis casos que el prompt enumera, más los bordes que salieron al
// escribirla:
//
//   · tocaba y no se hizo;
//   · se hizo TARDE pero dentro de la franja → se hizo;
//   · llegó sin red DESPUÉS del congelado → deshace el «no hecho»;
//   · lo `ON_DEMAND` nunca es «no hecho»;
//   · un residente ausente o dado de baja no cuenta;
//   · el turno de noche que cruza medianoche.
//
// La función es pura: cada caso es una fila de datos y una aserción.
// Ninguna maqueta de Prisma y ningún reloj.

import { describe, expect, it } from "vitest";

import { loQueNoSeHizo, cuantoVaHecho } from "../src/no-hecho.js";
import type { ControlParaNoHecho, RegistroHecho } from "../src/no-hecho.js";
import { queToca } from "../src/que-toca.js";
import type { AjusteDelCentro, LineaDePlan, Ocurrencia } from "../src/que-toca.js";
import type { Frecuencia } from "../src/frecuencia.js";
import type { TurnoDelCentro } from "../src/turnos.js";
import { addDays, wallTimeToUtc } from "../src/tiempo.js";

const TURNOS: TurnoDelCentro[] = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00" },
];

const SIN_AJUSTES: AjusteDelCentro[] = [];

/** Los tres controles que hacen falta para los casos de la tabla. */
const CONTROLES: ControlParaNoHecho[] = [
  { code: "CAMBIO_POSTURAL", layer: "EXEC", nature: "SCHEDULED" },
  { code: "DEPOSICION", layer: "EXEC", nature: "ON_DEMAND" },
  { code: "ANIMO", layer: "OBS", nature: "SCHEDULED" },
];

function linea(
  controlCode: string,
  frecuencia: Frecuencia,
  extra: Partial<LineaDePlan> = {},
): LineaDePlan {
  return {
    id: `l-${controlCode}`,
    clientId: "carmen",
    controlCode,
    frecuencia,
    fromAt: new Date("2020-01-01T00:00:00.000Z"),
    toAt: null,
    ...extra,
  };
}

/** La ventana de un día de PARED del centro: de las 00:00 de pared a las
 *  00:00 del siguiente. Construida con `addDays` y no sumando al texto,
 *  que es lo que se rompe el día 31. */
function elDia(fecha: string): [Date, Date] {
  return [wallTimeToUtc(fecha, "00:00"), wallTimeToUtc(addDays(fecha, 1), "00:00")];
}

function registro(extra: Partial<RegistroHecho> = {}): RegistroHecho {
  return {
    clientId: "carmen",
    controlCode: "CAMBIO_POSTURAL",
    careDay: "2026-10-19",
    shiftCode: "M",
    occurrenceAt: null,
    recordedAt: wallTimeToUtc("2026-10-19", "10:00"),
    voidedAt: null,
    ...extra,
  };
}

// ── 1 · Tocaba y no se hizo ──────────────────────────────────────────

describe("tocaba y no se hizo", () => {
  // Cuatro cambios posturales al día (cada 6 h, anclados a medianoche:
  // 00:00, 06:00, 12:00 y 18:00) y ninguno registrado.
  const plan = [linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 6 })];
  const [desde, hasta] = elDia("2026-10-19");
  const ocurrencias = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta);

  it("las cuatro del día salen cuando el corte es el final del día", () => {
    expect(ocurrencias).toHaveLength(4);
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [],
      controles: CONTROLES,
      corte: hasta,
    });
    expect(no.map((n) => n.at.toISOString())).toEqual(
      ocurrencias.map((o) => o.at.toISOString()),
    );
  });

  it("a mediodía sólo salen las que YA pasaron", () => {
    // Corte a las 12:30: las de 00:00, 06:00 y 12:00 están cerradas; la
    // de 18:00 no. Decir a las 12:30 que la ronda de las seis de la tarde
    // «no se ha hecho» es el error que llena el parte de mentiras.
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [],
      controles: CONTROLES,
      corte: wallTimeToUtc("2026-10-19", "12:30"),
    });
    expect(no).toHaveLength(3);
  });

  it("una franja ABIERTA no cuenta todavía", () => {
    // La hidratación cutánea es una franja de mañana (08:00–15:00). A las
    // 11:00 la auxiliar tiene cuatro horas para hacerla.
    const franja = queToca(
      [linea("CAMBIO_POSTURAL", { kind: "EVERY_SHIFT", shiftCodes: ["M"] })],
      SIN_AJUSTES,
      TURNOS,
      [],
      desde,
      hasta,
    );
    expect(franja).toHaveLength(1);
    expect(
      loQueNoSeHizo({
        ocurrencias: franja,
        registros: [],
        controles: CONTROLES,
        corte: wallTimeToUtc("2026-10-19", "11:00"),
      }),
    ).toHaveLength(0);
    // Y a las 15:00 en punto, sí: la franja es semiabierta y se cierra.
    expect(
      loQueNoSeHizo({
        ocurrencias: franja,
        registros: [],
        controles: CONTROLES,
        corte: wallTimeToUtc("2026-10-19", "15:00"),
      }),
    ).toHaveLength(1);
  });
});

// ── 2 · Se hizo TARDE, dentro de la franja ───────────────────────────

describe("se hizo tarde pero dentro de la franja", () => {
  const plan = [linea("CAMBIO_POSTURAL", { kind: "EVERY_SHIFT", shiftCodes: ["M"] })];
  const [desde, hasta] = elDia("2026-10-19");
  const ocurrencias = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta);

  it("a las 14:55 de una franja que acaba a las 15:00 → SE HIZO", () => {
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [
        registro({
          // La puerta escribe la ocurrencia que le dio `queToca`, que es
          // el INICIO de la franja — no la hora en que se hizo.
          occurrenceAt: ocurrencias[0]!.at,
          recordedAt: wallTimeToUtc("2026-10-19", "14:55"),
        }),
      ],
      controles: CONTROLES,
      corte: hasta,
    });
    expect(no).toHaveLength(0);
  });

  it("un registro ANULADO no cuenta como hecho", () => {
    // Anular es decir que aquello no fue (residencia-3 §1). Si contara,
    // anular sería la forma de tapar un incumplimiento.
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [
        registro({
          occurrenceAt: ocurrencias[0]!.at,
          voidedAt: wallTimeToUtc("2026-10-19", "14:58"),
        }),
      ],
      controles: CONTROLES,
      corte: hasta,
    });
    expect(no).toHaveLength(1);
  });

  it("el registro de OTRO residente no tapa el de éste", () => {
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [registro({ clientId: "luis", occurrenceAt: ocurrencias[0]!.at })],
      controles: CONTROLES,
      corte: hasta,
    });
    expect(no).toHaveLength(1);
    expect(no[0]!.clientId).toBe("carmen");
  });
});

// ── 3 · Llegó sin red DESPUÉS del congelado ──────────────────────────

describe("llegó sin red después del congelado", () => {
  // El caso del prompt, literal: la puerta sin red sube a las 15:20 el
  // cambio postural de las 14:50, y el parte de la mañana se congeló a
  // las 15:00.
  const plan = [linea("CAMBIO_POSTURAL", { kind: "EVERY_SHIFT", shiftCodes: ["M"] })];
  const [desde, hasta] = elDia("2026-10-19");
  const ocurrencias = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta);
  const congelado = wallTimeToUtc("2026-10-19", "15:00");
  const tardio = registro({
    occurrenceAt: ocurrencias[0]!.at,
    recordedAt: wallTimeToUtc("2026-10-19", "14:50"),
  });

  it("al congelar, sin el registro, la línea dice «no se hizo»", () => {
    expect(
      loQueNoSeHizo({ ocurrencias, registros: [], controles: CONTROLES, corte: congelado }),
    ).toHaveLength(1);
  });

  it("y cualquier cálculo POSTERIOR con el registro dentro dice que SÍ", () => {
    // Las dos afirmaciones son verdad y las dos hacen falta: la primera
    // es la evidencia de lo que se supo en el relevo, la segunda es lo
    // que pasó. Por eso el parte congelado no se reescribe y el añadido
    // tardío se pinta aparte.
    expect(
      loQueNoSeHizo({
        ocurrencias,
        registros: [tardio],
        controles: CONTROLES,
        corte: congelado,
      }),
    ).toHaveLength(0);
  });
});

// ── 4 · Lo `ON_DEMAND` NUNCA ─────────────────────────────────────────

describe("lo ON_DEMAND nunca es «no hecho»", () => {
  it("`queToca` no lo agenda…", () => {
    const [desde, hasta] = elDia("2026-10-19");
    const ocurrencias = queToca(
      [linea("DEPOSICION", { kind: "ON_DEMAND" })],
      SIN_AJUSTES,
      TURNOS,
      [],
      desde,
      hasta,
    );
    expect(ocurrencias).toHaveLength(0);
  });

  it("…y aunque alguien le pase una ocurrencia a mano, se descarta", () => {
    // La comprobación por naturaleza existe por esto: una función que
    // depende de que la otra no se equivoque falla en silencio. Si un día
    // `queToca` agendara un `ON_DEMAND` por un cambio mal hecho, el parte
    // no acusaría a nadie de no hacer algo que nadie le pidió.
    const aMano: Ocurrencia = {
      clientId: "carmen",
      controlCode: "DEPOSICION",
      planItemId: "l-DEPOSICION",
      at: wallTimeToUtc("2026-10-19", "09:00"),
      until: null,
      esFranja: false,
      shiftCode: "M",
      momentCode: null,
      dia: "2026-10-19",
    };
    expect(
      loQueNoSeHizo({
        ocurrencias: [aMano],
        registros: [],
        controles: CONTROLES,
        corte: wallTimeToUtc("2026-10-20", "00:00"),
      }),
    ).toHaveLength(0);
  });
});

// ── 5 · La observación diaria, con `occurrenceAt` NULL ───────────────

describe("la observación diaria se empareja por turno, no por instante", () => {
  const plan = [linea("ANIMO", { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] })];
  const [desde, hasta] = elDia("2026-10-19");
  const ocurrencias = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta);

  it("el «como siempre» de la mañana tapa la ocurrencia de la mañana", () => {
    expect(ocurrencias).toHaveLength(2);
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [
        // Así lo escribe la puerta: capa `OBS` → `occurrenceAt` NULL
        // (`ocurrenciaDe`, residencia-3).
        registro({ controlCode: "ANIMO", occurrenceAt: null, shiftCode: "M" }),
      ],
      controles: CONTROLES,
      corte: hasta,
    });
    // Queda la de la tarde.
    expect(no).toHaveLength(1);
    expect(no[0]!.shiftCode).toBe("T");
  });

  it("el de la mañana NO tapa el de la tarde", () => {
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [registro({ controlCode: "ANIMO", occurrenceAt: null, shiftCode: "M" })],
      controles: CONTROLES,
      corte: hasta,
    });
    expect(no.map((n) => n.shiftCode)).toEqual(["T"]);
  });
});

// ── 6 · El residente que no cuenta ───────────────────────────────────

describe("un residente ausente o dado de baja no cuenta", () => {
  const plan = [
    linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 6 }),
    linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 6 }, {
      id: "l-luis",
      clientId: "luis",
    }),
  ];
  const [desde, hasta] = elDia("2026-10-19");
  const ocurrencias = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta);

  it("ocho sin nadie fuera", () => {
    expect(
      loQueNoSeHizo({ ocurrencias, registros: [], controles: CONTROLES, corte: hasta }),
    ).toHaveLength(8);
  });

  it("cuatro cuando Luis está en el hospital", () => {
    // Su plan sigue vigente —nadie lo cierra por un ingreso de tres
    // días— y sin esto saldrían veintiocho cuidados «no hechos» de
    // alguien que no estaba en el centro.
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [],
      controles: CONTROLES,
      corte: hasta,
      fuera: new Set(["luis"]),
    });
    expect(no).toHaveLength(4);
    expect(new Set(no.map((n) => n.clientId))).toEqual(new Set(["carmen"]));
  });
});

// ── 7 · La noche que cruza medianoche ────────────────────────────────

describe("el turno de noche que cruza medianoche", () => {
  // La franja de la noche del 19 va de las 22:00 del 19 a las 08:00 del
  // 20, y su `care_day` es el 19. Es el tramo en que la residencia está
  // más sola y el que un cálculo por fecha de reloj parte en dos.
  const plan = [linea("CAMBIO_POSTURAL", { kind: "EVERY_SHIFT", shiftCodes: ["N"] })];

  it("a las 06:00 del 20 la franja sigue ABIERTA", () => {
    const ocurrencias = queToca(
      plan,
      SIN_AJUSTES,
      TURNOS,
      [],
      wallTimeToUtc("2026-10-19", "00:00"),
      wallTimeToUtc("2026-10-20", "00:00"),
    );
    expect(ocurrencias).toHaveLength(1);
    expect(ocurrencias[0]!.dia).toBe("2026-10-19");
    expect(
      loQueNoSeHizo({
        ocurrencias,
        registros: [],
        controles: CONTROLES,
        corte: wallTimeToUtc("2026-10-20", "06:00"),
      }),
    ).toHaveLength(0);
  });

  it("a las 08:00 del 20 se cierra, y el «no hecho» es DEL 19", () => {
    const ocurrencias = queToca(
      plan,
      SIN_AJUSTES,
      TURNOS,
      [],
      wallTimeToUtc("2026-10-19", "00:00"),
      wallTimeToUtc("2026-10-20", "00:00"),
    );
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [],
      controles: CONTROLES,
      corte: wallTimeToUtc("2026-10-20", "08:00"),
    });
    expect(no).toHaveLength(1);
    // El día del parte es el 19, no el 20: la ronda de la madrugada
    // pertenece a la noche del lunes.
    expect(no[0]!.dia).toBe("2026-10-19");
  });

  it("un registro de las 02:00 del 20 con `care_day` del 19 lo tapa", () => {
    const ocurrencias = queToca(
      plan,
      SIN_AJUSTES,
      TURNOS,
      [],
      wallTimeToUtc("2026-10-19", "00:00"),
      wallTimeToUtc("2026-10-20", "00:00"),
    );
    const no = loQueNoSeHizo({
      ocurrencias,
      registros: [
        registro({
          careDay: "2026-10-19",
          shiftCode: "N",
          occurrenceAt: ocurrencias[0]!.at,
          recordedAt: wallTimeToUtc("2026-10-20", "02:00"),
        }),
      ],
      controles: CONTROLES,
      corte: wallTimeToUtc("2026-10-20", "08:00"),
    });
    expect(no).toHaveLength(0);
  });
});

// ── 8 · `cuantoVaHecho`, que es otra pregunta ────────────────────────

describe("cuánto va hecho (la cuarta fila del panel)", () => {
  const plan = [linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 6 })];
  const [desde, hasta] = elDia("2026-10-19");
  const ocurrencias = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta);

  it("cuenta sobre TODO lo que toca, cerrado o no", () => {
    // A mitad de la mañana la respuesta correcta es «1 de 4», no «cero
    // incumplimientos»: la pregunta del panel es «¿cuánto llevamos?».
    const r = cuantoVaHecho({
      ocurrencias,
      registros: [registro({ occurrenceAt: ocurrencias[0]!.at })],
      controles: CONTROLES,
    });
    expect(r).toEqual({ tocan: 4, hechas: 1 });
  });

  it("lo `ON_DEMAND` no entra en el denominador", () => {
    const conDemanda: Ocurrencia[] = [
      ...ocurrencias,
      {
        clientId: "carmen",
        controlCode: "DEPOSICION",
        planItemId: "l-DEPOSICION",
        at: wallTimeToUtc("2026-10-19", "09:00"),
        until: null,
        esFranja: false,
        shiftCode: "M",
        momentCode: null,
        dia: "2026-10-19",
      },
    ];
    expect(
      cuantoVaHecho({ ocurrencias: conDemanda, registros: [], controles: CONTROLES }),
    ).toEqual({ tocan: 4, hechas: 0 });
  });
});
