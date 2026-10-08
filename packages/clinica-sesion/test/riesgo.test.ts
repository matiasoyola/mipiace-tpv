// clinica-5 · la clasificación IWGDF del pie de riesgo, categoría por
// categoría.
//
// El prompt pide el sabotaje de «cada categoría IWGDF», así que hay un
// caso por escalón y, además, los que distinguen un escalón del de al
// lado — que son los que se rompen cuando alguien «simplifica» la tabla a
// una suma de fallos (que es lo que hacía el mockup).

import { describe, expect, it } from "vitest";

import {
  ESCALONES_DE_RIESGO,
  FUENTE_DEL_RIESGO,
  comprobacionesVacias,
  escalonDe,
  faltaPorComprobar,
  riesgoDelPie,
  type ComprobacionesDelPie,
} from "../src/index.js";

/** Un pie normal, con las cuatro comprobaciones contestadas. */
function sano(): ComprobacionesDelPie {
  return {
    sensibilidad: "NORMAL",
    pulsos: { L: "PRESENTE", R: "PRESENTE" },
    ulcera: "NO",
    deformidad: "NO",
  };
}

describe("clinica-5 · sin las cuatro comprobaciones NO hay veredicto", () => {
  it("vacío: null", () => {
    expect(riesgoDelPie(comprobacionesVacias())).toBeNull();
  });

  it.each([
    ["sensibilidad", { sensibilidad: null }],
    ["úlcera", { ulcera: null }],
    ["deformidad", { deformidad: null }],
  ] as const)("falta la %s: null", (_n, parche) => {
    expect(riesgoDelPie({ ...sano(), ...parche })).toBeNull();
  });

  it("falta el pulso de UN pie: null (no se da por presente)", () => {
    expect(
      riesgoDelPie({ ...sano(), pulsos: { L: "PRESENTE", R: null } }),
    ).toBeNull();
  });

  it("dice qué falta, para que la tarjeta no se quede en blanco", () => {
    expect(faltaPorComprobar(comprobacionesVacias())).toEqual([
      "la sensibilidad",
      "los pulsos",
      "la úlcera",
      "la deformidad",
    ]);
    expect(
      faltaPorComprobar({ ...sano(), pulsos: { L: null, R: "PRESENTE" } }),
    ).toEqual(["el pulso del pie izquierdo"]);
    expect(faltaPorComprobar(sano())).toEqual([]);
  });
});

describe("clinica-5 · las cuatro categorías de la IWGDF", () => {
  it("0 · MUY BAJO · todo normal → revisión anual", () => {
    const r = riesgoDelPie(sano())!;
    expect(r.categoria).toBe(0);
    expect(r.nombre).toBe("Riesgo muy bajo");
    expect(r.plazo).toBe("Revisión anual");
    expect(r.plazoMeses).toEqual([12, 12]);
  });

  it("1 · BAJO · pérdida de sensibilidad SOLA → 6–12 meses", () => {
    const r = riesgoDelPie({ ...sano(), sensibilidad: "PERDIDA" })!;
    expect(r.categoria).toBe(1);
    expect(r.plazo).toBe("Revisión cada 6–12 meses");
    expect(r.senales).toEqual({
      perdidaDeSensibilidad: true,
      pulsosAusentes: false,
      ulcera: false,
      deformidad: false,
    });
  });

  it("1 · BAJO · pulsos ausentes SOLOS → 6–12 meses", () => {
    const r = riesgoDelPie({
      ...sano(),
      pulsos: { L: "AUSENTE", R: "PRESENTE" },
    })!;
    expect(r.categoria).toBe(1);
  });

  it("2 · MODERADO · pérdida de sensibilidad Y pulsos ausentes → 3–6 meses", () => {
    const r = riesgoDelPie({
      ...sano(),
      sensibilidad: "PERDIDA",
      pulsos: { L: "AUSENTE", R: "AUSENTE" },
    })!;
    expect(r.categoria).toBe(2);
    expect(r.plazo).toBe("Revisión cada 3–6 meses");
  });

  it("2 · MODERADO · pérdida de sensibilidad Y deformidad → 3–6 meses", () => {
    const r = riesgoDelPie({
      ...sano(),
      sensibilidad: "PERDIDA",
      deformidad: "SI",
    })!;
    expect(r.categoria).toBe(2);
  });

  it("2 · MODERADO · pulsos ausentes Y deformidad → 3–6 meses", () => {
    const r = riesgoDelPie({
      ...sano(),
      pulsos: { L: "PRESENTE", R: "AUSENTE" },
      deformidad: "SI",
    })!;
    expect(r.categoria).toBe(2);
  });

  it("3 · ALTO · pérdida de sensibilidad + úlcera → 1–3 meses", () => {
    const r = riesgoDelPie({
      ...sano(),
      sensibilidad: "PERDIDA",
      ulcera: "SI",
    })!;
    expect(r.categoria).toBe(3);
    expect(r.nombre).toBe("Riesgo alto");
    expect(r.plazo).toBe("Revisión cada 1–3 meses");
    expect(r.motivo).toMatch(/úlcera/i);
  });

  it("3 · ALTO · pulsos ausentes + úlcera → 1–3 meses", () => {
    const r = riesgoDelPie({
      ...sano(),
      pulsos: { L: "AUSENTE", R: "PRESENTE" },
      ulcera: "SI",
    })!;
    expect(r.categoria).toBe(3);
  });

  it("3 · ALTO manda sobre 2: con úlcera no se queda en moderado", () => {
    const r = riesgoDelPie({
      sensibilidad: "PERDIDA",
      pulsos: { L: "AUSENTE", R: "AUSENTE" },
      ulcera: "SI",
      deformidad: "SI",
    })!;
    expect(r.categoria).toBe(3);
  });
});

describe("clinica-5 · los dos casos que una suma de fallos haría mal", () => {
  // El mockup contaba fallos: úlcera valía 2, el resto 1, y ≥2 era alto.
  // Con esa cuenta, una úlcera SOLA sale «riesgo alto» — y la guía no dice
  // eso: sin pérdida de sensibilidad ni pulsos ausentes no hay categoría
  // 3. Este test es el que se pone rojo si alguien vuelve a la suma.
  it("ÚLCERA SOLA, con sensibilidad y pulsos normales: NO es riesgo alto", () => {
    const r = riesgoDelPie({ ...sano(), ulcera: "SI" })!;
    expect(r.categoria).toBe(0);
  });

  // Y el otro lado: la deformidad sola tampoco sube. La guía la usa sólo
  // en combinación, y contarla como un fallo más pondría en «bajo» a medio
  // pueblo con juanetes.
  it("DEFORMIDAD SOLA: no sube de categoría, y lo dice", () => {
    const r = riesgoDelPie({ ...sano(), deformidad: "SI" })!;
    expect(r.categoria).toBe(0);
    expect(r.motivo).toMatch(/la deformidad sola no sube/i);
  });
});

describe("clinica-5 · los pulsos los mira el PEOR pie", () => {
  it("un pie sin pulso basta para la categoría 1", () => {
    expect(
      riesgoDelPie({ ...sano(), pulsos: { L: "AUSENTE", R: "PRESENTE" } })!
        .categoria,
    ).toBe(1);
    expect(
      riesgoDelPie({ ...sano(), pulsos: { L: "PRESENTE", R: "AUSENTE" } })!
        .categoria,
    ).toBe(1);
  });
});

describe("clinica-5 · la tabla y la fuente", () => {
  it("los cuatro escalones están, de más grave a menos", () => {
    expect(ESCALONES_DE_RIESGO.map((e) => e.categoria)).toEqual([3, 2, 1, 0]);
    for (const e of ESCALONES_DE_RIESGO) {
      expect(escalonDe(e.categoria)).toBe(e);
      expect(e.plazoMeses[0]).toBeLessThanOrEqual(e.plazoMeses[1]);
    }
  });

  it("la fuente está citada y dice que está pendiente de validar", () => {
    // El prompt pide las dos cosas: citar la guía en el código y marcar
    // que Rosario no lo ha confirmado.
    expect(FUENTE_DEL_RIESGO).toContain("IWGDF");
    expect(FUENTE_DEL_RIESGO).toContain("2023");
    expect(FUENTE_DEL_RIESGO).toMatch(/pendiente de validar/i);
  });
});
