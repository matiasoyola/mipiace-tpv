// hotfix-fichaje-medianoche · un turno que pasa de las 00:00 se cierra con
// un toque, como cualquier otro.
//
// El bug: «salida olvidada» se decidía comparando el DÍA DEL CALENDARIO de
// la entrada con el de ahora. Quien entra a las 20:00 y sale a la 01:00 no
// podía fichar su salida —se le trataba como un olvido de ayer y tenía que
// corregirlo con motivo—. En una residencia es CADA turno de noche; en un
// bar, cada cierre pasada la medianoche.
//
// Lo que este banco fija:
//
//   1. Lo decide la DURACIÓN, no el calendario. Un tramo abierto es una
//      salida olvidada cuando lleva abierto MÁS del máximo del tenant.
//   2. El límite exacto NO es olvido. 16 h clavadas se cierran con un
//      toque; 16 h y un minuto, se preguntan.
//   3. El máximo es dato del tenant: otro tenant decide otra cosa y el
//      mismo tramo cambia de lado.
//   4. Un tramo ya CERRADO nunca es una salida olvidada, dure lo que dure.
//   5. Un máximo imposible (0, 200, null, una fila vieja) se trata como el
//      default, no se recorta al borde ni revienta.
//
// Sabotajes que este fichero pone en rojo:
//   · volver a `localDate(entry.startedAt) !== localDate(now)`
//   · usar `>=` en vez de `>` en el límite
//   · ignorar el máximo del tenant y usar siempre 16
//   · medir con horas de pared en vez de instantes (la noche del cambio
//     de hora)

import { describe, expect, it } from "vitest";

import {
  esSalidaOlvidada,
  localToUtc,
  MAX_OPEN_HOURS_DEFAULT,
  normalizeMaxOpenHours,
} from "../src/fichaje/time.js";

const H = 3_600_000;

/** Un tramo abierto que empezó a la hora de pared dada. */
const abiertoDesde = (dia: string, hora: string) => ({
  startedAt: localToUtc(dia, hora),
  endedAt: null,
});

describe("hotfix · la salida olvidada se decide por duración", () => {
  // La tabla del prompt, hora de pared de Madrid, lejos del cambio de hora
  // para que lo que se mida sea el criterio y no el DST (eso tiene su
  // propio caso más abajo).
  const tabla: Array<{
    nombre: string;
    entrada: [string, string];
    ahora: [string, string];
    olvidada: boolean;
  }> = [
    {
      // EL CASO DEL PRODUCTO: el turno de noche de una residencia.
      nombre: "turno de noche 22:00 → 08:00 del día siguiente",
      entrada: ["2026-09-22", "22:00"],
      ahora: ["2026-09-23", "08:00"],
      olvidada: false,
    },
    {
      // EL OTRO CASO DEL PRODUCTO: el cierre de un bar.
      nombre: "cierre de bar 20:00 → 01:00",
      entrada: ["2026-09-22", "20:00"],
      ahora: ["2026-09-23", "01:00"],
      olvidada: false,
    },
    {
      // Y lo que SÍ es un olvido: se fue y no fichó.
      nombre: "entró ayer a las 09:00 y son las 10:00 de hoy",
      entrada: ["2026-09-22", "09:00"],
      ahora: ["2026-09-23", "10:00"],
      olvidada: true,
    },
    {
      nombre: "mismo día, cuatro horas dentro",
      entrada: ["2026-09-22", "08:00"],
      ahora: ["2026-09-22", "12:00"],
      olvidada: false,
    },
  ];

  for (const caso of tabla) {
    it(`${caso.nombre} → ${caso.olvidada ? "olvidada" : "se cierra con un toque"}`, () => {
      const entry = abiertoDesde(...caso.entrada);
      const now = localToUtc(...caso.ahora);
      expect(esSalidaOlvidada(entry, now)).toBe(caso.olvidada);
    });
  }

  // EL LÍMITE. Con `>=` en vez de `>` el primero de los dos se pondría
  // rojo, y es el que importa: un turno de 16 h clavadas existe.
  it("16 h EXACTAS todavía se cierran con un toque", () => {
    const entry = { startedAt: new Date("2026-09-22T06:00:00Z"), endedAt: null };
    const now = new Date("2026-09-22T22:00:00Z");
    expect(now.getTime() - entry.startedAt.getTime()).toBe(16 * H);
    expect(esSalidaOlvidada(entry, now)).toBe(false);
  });

  it("16 h y un minuto ya se preguntan", () => {
    const entry = { startedAt: new Date("2026-09-22T06:00:00Z"), endedAt: null };
    const now = new Date("2026-09-22T22:01:00Z");
    expect(esSalidaOlvidada(entry, now)).toBe(true);
  });

  it("el default son 16 horas y es el que se usa sin decir nada", () => {
    expect(MAX_OPEN_HOURS_DEFAULT).toBe(16);
    const entry = { startedAt: new Date("2026-09-22T06:00:00Z"), endedAt: null };
    const justoDespues = new Date("2026-09-22T22:00:01Z");
    expect(esSalidaOlvidada(entry, justoDespues)).toBe(
      esSalidaOlvidada(entry, justoDespues, MAX_OPEN_HOURS_DEFAULT),
    );
  });
});

describe("hotfix · el máximo es dato del tenant", () => {
  // El mismo tramo, dos empresas, dos respuestas. Una residencia con
  // guardias largas lo sube; un colegio que quiere el aviso antes lo baja.
  const entry = abiertoDesde("2026-09-22", "22:00");
  const now = localToUtc("2026-09-23", "08:00"); // 10 h abierto

  it("con 16 de serie, el turno de noche NO es un olvido", () => {
    expect(esSalidaOlvidada(entry, now, 16)).toBe(false);
  });

  it("con un máximo de 24, tampoco", () => {
    expect(esSalidaOlvidada(entry, now, 24)).toBe(false);
  });

  it("con un máximo de 8, el MISMO tramo sí lo es", () => {
    expect(esSalidaOlvidada(entry, now, 8)).toBe(true);
  });

  it("con 10 clavadas sigue sin serlo: el límite exacto no es olvido", () => {
    expect(esSalidaOlvidada(entry, now, 10)).toBe(false);
  });
});

describe("hotfix · lo que nunca es una salida olvidada", () => {
  it("un tramo CERRADO, aunque durara treinta horas", () => {
    const entry = {
      startedAt: localToUtc("2026-09-21", "08:00"),
      endedAt: localToUtc("2026-09-22", "14:00"), // 30 h
    };
    expect(esSalidaOlvidada(entry, localToUtc("2026-09-25", "10:00"))).toBe(false);
  });

  it("un tramo que empieza en el futuro (reloj del móvil adelantado)", () => {
    const entry = abiertoDesde("2026-09-23", "08:00");
    expect(esSalidaOlvidada(entry, localToUtc("2026-09-22", "12:00"))).toBe(false);
  });
});

describe("hotfix · el máximo se mide sobre los INSTANTES", () => {
  // 25-10-2026: a las 03:00 CEST el reloj vuelve a las 02:00 CET, y la
  // noche dura una hora más de lo que dicen los relojes. Con un máximo de
  // 8 h, un tramo de 22:00 a 06:00 de esa noche lleva NUEVE abierto y sí
  // es un olvido — restando horas de pared daría ocho y no lo sería.
  it("la noche del cambio de hora dura lo que dura, no lo que marca el reloj", () => {
    const entry = abiertoDesde("2026-10-24", "22:00");
    const now = localToUtc("2026-10-25", "06:00");
    expect(esSalidaOlvidada(entry, now, 8)).toBe(true);
    expect(esSalidaOlvidada(entry, now, 9)).toBe(false);
  });
});

describe("hotfix · un máximo imposible cae al default", () => {
  // El rango lo defienden el schema de la ruta del super-admin Y un CHECK
  // de la base. Esto es la tercera red: una fila vieja, un cliente de
  // Prisma sin la columna, un `null` que se cuela. Nunca se recorta al
  // borde — un 0 convertido en 8 en silencio sería peor que un 0
  // convertido en 16.
  for (const malo of [0, -1, 7, 25, 200, Number.NaN, null, undefined, "16"]) {
    it(`${JSON.stringify(malo)} → ${MAX_OPEN_HOURS_DEFAULT}`, () => {
      expect(normalizeMaxOpenHours(malo)).toBe(MAX_OPEN_HOURS_DEFAULT);
    });
  }

  for (const bueno of [8, 10, 16, 24]) {
    it(`${bueno} se respeta`, () => {
      expect(normalizeMaxOpenHours(bueno)).toBe(bueno);
    });
  }

  it("y `esSalidaOlvidada` con un máximo imposible se comporta como con 16", () => {
    const entry = { startedAt: new Date("2026-09-22T06:00:00Z"), endedAt: null };
    const now = new Date("2026-09-22T21:00:00Z"); // 15 h
    expect(esSalidaOlvidada(entry, now, 0)).toBe(false);
    expect(esSalidaOlvidada(entry, now, 999)).toBe(false);
  });
});
