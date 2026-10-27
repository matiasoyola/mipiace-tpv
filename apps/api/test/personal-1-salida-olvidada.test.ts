// personal-1 (punto 8) · LA SALIDA OLVIDADA, CON TURNO PLANIFICADO.
//
// `esSalidaOlvidada` sigue siendo **el único sitio que decide**. #45 lo
// dejó así después de arreglar el bug que existía porque tres superficies
// comparaban `localDate` cada una por su cuenta; este bloque amplía esa
// misma función y no añade un segundo criterio en ninguna ruta.
//
// Lo que este fichero fija:
//
//   · los tres casos que el prompt pide cerrar;
//   · que **sin cuadrante el comportamiento es EXACTAMENTE el de #45** —
//     y eso se comprueba contra los mismos números que
//     `f3-fichaje-tiempo.test.ts`, que sigue verde sin tocarlo;
//   · y que ninguna de las tres superficies decide por su cuenta: lo dice
//     un test que lee el código fuente, mismo instrumento que
//     `f1-puertas-del-modulo`.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  esSalidaOlvidada,
  limiteDelTramo,
  MAX_OPEN_HOURS_DEFAULT,
} from "../src/fichaje/time.js";

/** Un instante de pared de Madrid en noviembre (UTC+1). */
function h(dia: string, hora: string): Date {
  return new Date(`2026-11-${dia}T${hora}:00+01:00`);
}

const M_FIN = h("02", "15:00"); // una mañana de 08:00 a 15:00
const N_FIN = h("03", "08:00"); // una noche de 22:00 a 08:00
const MARGEN = 4;

describe("personal-1 · con turno planificado", () => {
  it("[prompt] entrada 08:00 con turno M y nada a las 19:01: OLVIDADA", () => {
    // Y lleva **once** horas, no dieciséis. Antes de este bloque nadie se
    // enteraba hasta medianoche.
    const entry = { startedAt: h("02", "08:00"), endedAt: null };
    const plan = { finAt: M_FIN, margenHoras: MARGEN };
    expect(esSalidaOlvidada(entry, h("02", "19:01"), 16, plan)).toBe(true);
    // El borde: a las 19:00 clavadas todavía NO. Mismo criterio que #45
    // con el máximo — el límite exacto no es olvido.
    expect(esSalidaOlvidada(entry, h("02", "19:00"), 16, plan)).toBe(false);
    expect(limiteDelTramo(entry, 16, plan).toISOString()).toBe(
      h("02", "19:00").toISOString(),
    );
  });

  it("[prompt] la MISMA entrada SIN turno: no es olvidada hasta las 16 h", () => {
    const entry = { startedAt: h("02", "08:00"), endedAt: null };
    expect(esSalidaOlvidada(entry, h("02", "19:01"), 16)).toBe(false);
    expect(esSalidaOlvidada(entry, h("02", "23:59"), 16)).toBe(false);
    // 08:00 + 16 h = las 00:00 del día siguiente.
    expect(esSalidaOlvidada(entry, h("03", "00:00"), 16)).toBe(false);
    expect(esSalidaOlvidada(entry, h("03", "00:01"), 16)).toBe(true);
  });

  it("[prompt] entrada 22:00 con turno N y salida a las 07:58: se cierra", () => {
    // La noche de 22:00 a 08:00 sigue cerrándose de un toque, como ya hace
    // desde #45: su límite son las 12:00 del día siguiente.
    const entry = { startedAt: h("02", "22:00"), endedAt: null };
    const plan = { finAt: N_FIN, margenHoras: MARGEN };
    expect(esSalidaOlvidada(entry, h("03", "07:58"), 16, plan)).toBe(false);
    expect(limiteDelTramo(entry, 16, plan).toISOString()).toBe(
      h("03", "12:00").toISOString(),
    );
    // Y a las 13:00 ya se le pregunta: cinco horas después de su turno, no
    // dieciséis después de entrar (que serían las 14:00).
    expect(esSalidaOlvidada(entry, h("03", "13:00"), 16, plan)).toBe(true);
  });

  it("el turno APRIETA y nunca AFLOJA: un turno largo no pasa del máximo", () => {
    const entry = { startedAt: h("02", "08:00"), endedAt: null };
    // Un turno que acabara a las 20:00 del día siguiente daría, con el
    // margen, veintiocho horas. El máximo del tenant lo corta en dieciséis.
    const plan = { finAt: h("03", "20:00"), margenHoras: MARGEN };
    expect(esSalidaOlvidada(entry, h("03", "00:01"), 16, plan)).toBe(true);
  });

  it("un turno que acaba ANTES de la entrada se ignora", () => {
    // Una mañana en la celda de quien entró a las 23:00 del día anterior.
    // Sin esta rama, el tramo nacería «olvidado» y se le preguntaría por
    // una salida que acaba de empezar.
    const entry = { startedAt: h("02", "23:00"), endedAt: null };
    const plan = { finAt: M_FIN, margenHoras: MARGEN };
    expect(esSalidaOlvidada(entry, h("02", "23:30"), 16, plan)).toBe(false);
    expect(limiteDelTramo(entry, 16, plan).toISOString()).toBe(
      h("03", "15:00").toISOString(),
    );
  });

  it("un tramo CERRADO nunca es una salida olvidada, con turno o sin él", () => {
    const entry = { startedAt: h("02", "08:00"), endedAt: h("02", "15:05") };
    expect(esSalidaOlvidada(entry, h("05", "09:00"), 16)).toBe(false);
    expect(
      esSalidaOlvidada(entry, h("05", "09:00"), 16, {
        finAt: M_FIN,
        margenHoras: MARGEN,
      }),
    ).toBe(false);
  });

  it("el margen del tenant manda, y uno fuera de rango cae al default", () => {
    const entry = { startedAt: h("02", "08:00"), endedAt: null };
    // Con 1 h de margen, a las 16:01 ya se pregunta.
    expect(
      esSalidaOlvidada(entry, h("02", "16:01"), 16, { finAt: M_FIN, margenHoras: 1 }),
    ).toBe(true);
    // Con 12, a las 16:01 no.
    expect(
      esSalidaOlvidada(entry, h("02", "16:01"), 16, { finAt: M_FIN, margenHoras: 12 }),
    ).toBe(false);
  });
});

describe("personal-1 · sin cuadrante, EXACTAMENTE lo de #45", () => {
  // Los mismos números que `f3-fichaje-tiempo.test.ts` afirma, repetidos
  // aquí para que se vea que el cuarto argumento no cambió nada: si
  // alguien rompiera la rama «sin turno», estos tres se ponen rojos igual
  // que aquéllos.
  const entry = { startedAt: h("02", "08:00"), endedAt: null };

  it("el default son dieciséis horas", () => {
    expect(MAX_OPEN_HOURS_DEFAULT).toBe(16);
  });

  it("dieciséis clavadas NO son olvido; a los dieciséis y un minuto, sí", () => {
    expect(esSalidaOlvidada(entry, h("03", "00:00"))).toBe(false);
    expect(esSalidaOlvidada(entry, h("03", "00:01"))).toBe(true);
  });

  it("y un máximo fuera de rango cae al default, no al borde", () => {
    // Un 0 silenciosamente convertido en 8 es peor que un 0
    // silenciosamente convertido en 16 (cabecera de `time.ts`).
    expect(esSalidaOlvidada(entry, h("02", "20:00"), 0)).toBe(false);
    expect(esSalidaOlvidada(entry, h("03", "00:01"), 0)).toBe(true);
  });
});

describe("personal-1 · sigue habiendo UN solo sitio que decide", () => {
  function leer(rel: string): string {
    const src = readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
  }

  const FUENTES = [
    "fichaje/routes.ts",
    "fichaje/admin-routes.ts",
    "fichaje/cuadrante.ts",
    "fichaje/cuadrante-routes.ts",
    "fichaje/personal-routes.ts",
  ];

  it("ninguna ruta compara `localDate` para decidir un olvido", () => {
    // Era el bug de #45: tres superficies con el mismo criterio escrito
    // tres veces, y una de ellas mal.
    for (const f of FUENTES) {
      expect(leer(f), f).not.toMatch(/localDate\([^)]*\)\s*!==\s*localDate/);
    }
  });

  it("ninguna rehace la cuenta de las horas abiertas", () => {
    // `now - startedAt > algo * 3_600_000` fuera de `time.ts` es un
    // segundo criterio esperando a divergir.
    for (const f of FUENTES) {
      expect(leer(f), f).not.toMatch(/3_600_000|3600000/);
    }
  });

  it("y las tres superficies llaman a `esSalidaOlvidada` con el turno", () => {
    const empleado = leer("fichaje/routes.ts");
    const panel = leer("fichaje/admin-routes.ts");
    // `/me` y el cierre, en el fichero del empleado: dos llamadas, las dos
    // con cuarto argumento.
    const llamadas = [...empleado.matchAll(/esSalidaOlvidada\(([^)]*)\)/g)].map(
      (m) => m[1]!,
    );
    expect(llamadas).toHaveLength(2);
    for (const args of llamadas) {
      expect(args.split(",")).toHaveLength(4);
    }
    // Y «Hoy», en el del panel: «dentro» y «salida olvidada», las dos con
    // el mismo `planDe(e)`. Un tramo no puede estar dentro en una columna
    // y olvidado en la de al lado.
    const delPanel = [...panel.matchAll(/esSalidaOlvidada\(([^)]*)\)/g)].map(
      (m) => m[1]!,
    );
    expect(delPanel).toHaveLength(2);
    for (const args of delPanel) {
      // El regex se corta en el primer `)`, que es el de `planDe(e`.
      expect(args).toContain("planDe(e");
    }
  });
});
