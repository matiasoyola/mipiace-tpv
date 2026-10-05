// agenda-lista (hallazgo 🟡 4) · sólo los servicios que la profesional
// sabe hacer.
//
// El fallo: el panel de alta ofrecía todos los servicios con duración, sin
// cruzar con la matriz. Se elegía «Mechas» en la columna de Lucía, que no
// las hace, y el «no» llegaba al pulsar Reservar hablando de HUECOS: la
// cajera veía que no había sitio con Lucía a ninguna hora del día y no
// tenía forma de saber que el problema era otro.
//
// El cruce es puro, así que se prueba aquí. Que la lista de la pantalla
// cambie lo comprueba el capítulo 6 del banco.

import { describe, expect, it } from "vitest";

import {
  indexarMatrizPorProfesional,
  noHaceNingunServicio,
  serviciosQueSabeHacer,
  type SkillMatrix,
} from "../src/lib/agenda-health.js";

const CORTE = "svc-corte";
const MECHAS = "svc-mechas";
const TINTE = "svc-tinte";

const MARTA = "u-marta";
const LUCIA = "u-lucia";
const IRENE = "u-irene";

const SERVICIOS = [
  { id: CORTE, name: "Corte" },
  { id: MECHAS, name: "Mechas" },
  { id: TINTE, name: "Tinte" },
];

function matriz(over: Partial<SkillMatrix> = {}): SkillMatrix {
  return {
    editable: true,
    staff: [
      { userId: MARTA, displayName: "Marta", active: true, hasProfile: true },
      { userId: LUCIA, displayName: "Lucía", active: true, hasProfile: true },
      { userId: IRENE, displayName: "Irene", active: true, hasProfile: true },
    ],
    services: [
      {
        id: CORTE,
        name: "Corte",
        agendable: true,
        active: true,
        staffRequired: 1,
        staffUserIds: [MARTA, LUCIA, IRENE],
      },
      {
        id: MECHAS,
        name: "Mechas",
        agendable: true,
        active: true,
        staffRequired: 1,
        // Lucía no hace mechas. Es el caso del banco.
        staffUserIds: [MARTA],
      },
      {
        id: TINTE,
        name: "Tinte",
        agendable: true,
        active: true,
        staffRequired: 1,
        staffUserIds: [MARTA],
      },
    ],
    ...over,
  };
}

describe("indexarMatrizPorProfesional", () => {
  it("cada una con lo suyo", () => {
    const idx = indexarMatrizPorProfesional(matriz());
    expect([...idx.get(MARTA)!].sort()).toEqual([CORTE, MECHAS, TINTE].sort());
    expect([...idx.get(LUCIA)!]).toEqual([CORTE]);
  });

  it("quien no da ninguno existe en el mapa, con el conjunto vacío", () => {
    // Si el índice se construyera recorriendo los servicios, una
    // profesional sin nada asignado no aparecería, y «no sabe hacer nada»
    // se confundiría con «no sé nada de ella» — que son dos mensajes
    // distintos en la pantalla.
    const idx = indexarMatrizPorProfesional(
      matriz({
        services: matriz().services.map((s) => ({
          ...s,
          staffUserIds: s.staffUserIds.filter((u) => u !== IRENE),
        })),
      }),
    );
    expect(idx.has(IRENE)).toBe(true);
    expect(idx.get(IRENE)!.size).toBe(0);
  });
});

describe("serviciosQueSabeHacer", () => {
  const idx = indexarMatrizPorProfesional(matriz());

  it("en la columna de Lucía no salen las mechas", () => {
    expect(
      serviciosQueSabeHacer(SERVICIOS, LUCIA, idx).map((s) => s.id),
    ).toEqual([CORTE]);
  });

  it("en la de Marta salen los tres", () => {
    expect(serviciosQueSabeHacer(SERVICIOS, MARTA, idx)).toHaveLength(3);
  });

  it("sin profesional elegida se ofrecen todos: el motor elige a quien sabe", () => {
    expect(serviciosQueSabeHacer(SERVICIOS, null, idx)).toHaveLength(3);
  });

  it("sin matriz (no llegó, o no hay red) no se filtra nada", () => {
    // Inventarse un «no» por una lectura que falló sería peor que el
    // fallo que esto viene a arreglar. El motor sigue siendo la puerta.
    expect(serviciosQueSabeHacer(SERVICIOS, LUCIA, null)).toHaveLength(3);
  });

  it("una profesional que la matriz no conoce tampoco filtra", () => {
    const idxSinLucia = indexarMatrizPorProfesional(
      matriz({ staff: matriz().staff.filter((s) => s.userId !== LUCIA) }),
    );
    idxSinLucia.delete(LUCIA);
    expect(serviciosQueSabeHacer(SERVICIOS, LUCIA, idxSinLucia)).toHaveLength(3);
  });
});

describe("noHaceNingunServicio", () => {
  it("sí cuando la matriz lo dice explícitamente", () => {
    const idx = indexarMatrizPorProfesional(
      matriz({
        services: matriz().services.map((s) => ({ ...s, staffUserIds: [] })),
      }),
    );
    expect(noHaceNingunServicio(IRENE, idx)).toBe(true);
  });

  it("no cuando hace alguno", () => {
    expect(noHaceNingunServicio(LUCIA, indexarMatrizPorProfesional(matriz()))).toBe(
      false,
    );
  });

  it("no cuando no se sabe: sin matriz, o sin profesional elegida", () => {
    expect(noHaceNingunServicio(LUCIA, null)).toBe(false);
    expect(
      noHaceNingunServicio(null, indexarMatrizPorProfesional(matriz())),
    ).toBe(false);
  });
});
