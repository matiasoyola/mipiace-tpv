// clinica-5 · la regla de niveles de la quiropodia, caso por caso.
//
// «Un test por caso», dice el prompt (decisión 5), porque la regla está
// SIN VALIDAR con Rosario y lo que estos tests guardan no es que la regla
// sea correcta: es qué regla está puesta. El día que ella diga otra cosa,
// estos tests son la lista de lo que hay que cambiar — y el de «mover un
// umbral» es el sabotaje que demuestra que la regla es dato y no un `if`
// repartido.

import { describe, expect, it } from "vitest";

import {
  ACTOS_QUIROPODIA_V1,
  NOMBRE_DE_NIVEL,
  REGLA_DE_NIVEL_V1,
  actoDe,
  esNivelDeQuiropodia,
  nivelPropuesto,
  nombreDeActo,
  textoDelCambioDeNivel,
  type ReglaDeNivel,
} from "../src/index.js";

describe("clinica-5 · la lista de actos", () => {
  it("son los seis del mockup, en su orden", () => {
    expect(ACTOS_QUIROPODIA_V1.actos.map((a) => a.id)).toEqual([
      "corte",
      "durezas",
      "helomas",
      "fresado",
      "grietas",
      "onico",
    ]);
  });

  it("todos los actos de la lista tienen un mínimo en la regla", () => {
    // Un acto sin fila en la regla no sube el nivel nunca. Es legítimo
    // como decisión, pero no como olvido: hoy los seis están.
    for (const a of ACTOS_QUIROPODIA_V1.actos) {
      expect(REGLA_DE_NIVEL_V1.minimoPorActo[a.id]).toBeDefined();
    }
  });

  it("un acto de una versión desconocida se sigue leyendo por su id", () => {
    expect(nombreDeActo("corte")).toBe("Corte de uñas");
    expect(nombreDeActo("telequinesis")).toBe("telequinesis");
    expect(actoDe("corte", 99)).toBeUndefined();
  });
});

describe("clinica-5 · el nivel propuesto, caso por caso", () => {
  const casos: Array<[string[], 1 | 2 | 3, string]> = [
    // Básica: corte y/o deslaminado.
    [[], 1, "sin nada marcado se propone la básica"],
    [["corte"], 1, "sólo corte"],
    [["durezas"], 1, "sólo deslaminado"],
    [["corte", "durezas"], 1, "corte y deslaminado siguen siendo básica"],
    // Completa: además enucleación o grietas.
    [["corte", "helomas"], 2, "la enucleación sube a completa"],
    [["grietas"], 2, "las grietas suben a completa"],
    [["corte", "durezas", "grietas"], 2, "tres actos con grietas: completa"],
    // Extra: fresado, uña encarnada, o cuatro actos o más.
    [["fresado"], 3, "el fresado sube a extra"],
    [["onico"], 3, "la uña encarnada sube a extra"],
    [["corte", "helomas", "fresado"], 3, "el fresado manda sobre la enucleación"],
    [
      ["corte", "durezas", "helomas", "grietas"],
      3,
      "cuatro actos son extra aunque ninguno lo sea",
    ],
  ];

  it.each(casos)("%s → nivel %i (%s)", (actos, esperado) => {
    expect(nivelPropuesto(actos).nivel).toBe(esperado);
  });

  it("manda el MAYOR de los mínimos, no el último marcado", () => {
    // Si fuera el último, marcar el corte después del fresado bajaría el
    // nivel — y la podóloga vería la quiropodia abaratarse por tocar un
    // botón de más.
    expect(nivelPropuesto(["fresado", "corte"]).nivel).toBe(3);
    expect(nivelPropuesto(["corte", "fresado"]).nivel).toBe(3);
  });

  it("el umbral de cantidad cuenta actos DISTINTOS", () => {
    // Cuatro veces «corte» es un acto, no cuatro.
    expect(
      nivelPropuesto(["corte", "corte", "corte", "corte"]).nivel,
    ).toBe(1);
  });

  it("un acto que no es de la lista no cuenta para nada", () => {
    expect(
      nivelPropuesto(["corte", "durezas", "inventado", "otro-mas"]).nivel,
    ).toBe(1);
  });

  it("dice POR QUÉ sale ese nivel, y nombra lo que lo decidió", () => {
    const porActo = nivelPropuesto(["corte", "fresado"]);
    expect(porActo.porElActo).toBe("fresado");
    expect(porActo.porLaCantidad).toBe(false);
    expect(porActo.motivo).toContain("fresado");

    const porCantidad = nivelPropuesto([
      "corte",
      "durezas",
      "helomas",
      "grietas",
    ]);
    expect(porCantidad.porLaCantidad).toBe(true);
    expect(porCantidad.porElActo).toBeNull();
    expect(porCantidad.motivo).toContain("4 actos");

    expect(nivelPropuesto([]).motivo).toMatch(/todavía no has marcado/i);
  });
});

// ── EL SABOTAJE: mover un umbral ────────────────────────────────────
//
// La regla es DATO. Este test la cambia desde fuera, sin tocar una línea
// de `nivelPropuesto`, y comprueba que la cuenta cambia con ella. Si
// alguien reescribiera la función con `if (actos.includes("fresado"))`,
// este test se pone rojo: la regla de fuera dejaría de mandar.
describe("clinica-5 · la regla de niveles es DATO (sabotaje)", () => {
  it("subir el umbral de cantidad de 4 a 5 baja el nivel de cuatro actos", () => {
    const conCuatro = ["corte", "durezas", "helomas", "grietas"];
    expect(nivelPropuesto(conCuatro).nivel).toBe(3);

    const reglaMovida: ReglaDeNivel = {
      ...REGLA_DE_NIVEL_V1,
      nivelPorCantidad: [{ desdeActos: 5, nivel: 3 }],
    };
    // Con el umbral en cinco, los mismos cuatro actos se quedan en lo que
    // digan sus mínimos: la enucleación y las grietas son completa.
    expect(nivelPropuesto(conCuatro, reglaMovida).nivel).toBe(2);
  });

  it("bajar el mínimo del deslaminado sube la quiropodia más simple", () => {
    expect(nivelPropuesto(["durezas"]).nivel).toBe(1);
    const reglaMovida: ReglaDeNivel = {
      ...REGLA_DE_NIVEL_V1,
      minimoPorActo: { ...REGLA_DE_NIVEL_V1.minimoPorActo, durezas: 2 },
    };
    expect(nivelPropuesto(["durezas"], reglaMovida).nivel).toBe(2);
  });

  it("quitar el umbral de cantidad lo desactiva entero", () => {
    const reglaMovida: ReglaDeNivel = {
      ...REGLA_DE_NIVEL_V1,
      nivelPorCantidad: [],
    };
    expect(
      nivelPropuesto(["corte", "durezas", "helomas", "grietas"], reglaMovida)
        .nivel,
    ).toBe(2);
  });
});

describe("clinica-5 · el cambio de nivel a mano queda escrito", () => {
  it("propuesto = elegido: no hay nada que decir", () => {
    expect(textoDelCambioDeNivel(2, 2)).toBeNull();
  });

  it("propuesto ≠ elegido: lo dice y nombra el propuesto", () => {
    // «Propuesto completa, cobrado extra» (decisión 4).
    expect(textoDelCambioDeNivel(2, 3)).toBe(
      "Cambiado a mano · lo propuesto era completa",
    );
  });

  it("los tres niveles tienen nombre y sólo esos tres son válidos", () => {
    expect(NOMBRE_DE_NIVEL[1]).toBe("Básica");
    expect(NOMBRE_DE_NIVEL[2]).toBe("Completa");
    expect(NOMBRE_DE_NIVEL[3]).toBe("Extra");
    expect(esNivelDeQuiropodia(1)).toBe(true);
    expect(esNivelDeQuiropodia(4)).toBe(false);
    expect(esNivelDeQuiropodia("2")).toBe(false);
  });
});
