// mover-con-otra · a quién ofrece la hoja de mover.
//
// El espejo de `agenda-lista-matriz-filtro.test.ts`, por el otro lado de la
// matriz: allí se fija la peluquera y se filtran los servicios; aquí se
// fijan los servicios de la cita y se filtran las peluqueras.
//
// El cruce es puro, así que se prueba aquí. Que la lista de la PANTALLA
// cambie lo comprueba el capítulo 7 del banco: el cruce puede estar bien y
// el selector seguir pintando a todas (fila 2 de la tabla de sabotajes).

import { describe, expect, it } from "vitest";

import {
  indexarMatrizPorProfesional,
  profesionalesQuePuedenConLaCita,
  type SkillMatrix,
} from "../src/lib/agenda-health.js";

const CORTE = "svc-corte";
const MECHAS = "svc-mechas";

const MARTA = "u-marta";
const LUCIA = "u-lucia";
const IRENE = "u-irene";

const PERSONAL = [
  { userId: MARTA, displayName: "Marta" },
  { userId: LUCIA, displayName: "Lucía" },
  { userId: IRENE, displayName: "Irene" },
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
        // Lucía no hace mechas. Es el caso del banco, y el del 409 de la API.
        staffUserIds: [MARTA, IRENE],
      },
    ],
    ...over,
  };
}

describe("profesionalesQuePuedenConLaCita", () => {
  const idx = indexarMatrizPorProfesional(matriz());

  it("una cita de mechas no se le ofrece a Lucía", () => {
    expect(
      profesionalesQuePuedenConLaCita(PERSONAL, [MECHAS], idx).map(
        (p) => p.userId,
      ),
    ).toEqual([MARTA, IRENE]);
  });

  it("una cita de corte se le ofrece a las tres", () => {
    expect(profesionalesQuePuedenConLaCita(PERSONAL, [CORTE], idx)).toHaveLength(
      3,
    );
  });

  it("corte + mechas: tiene que poder con las DOS, no con alguna", () => {
    // Media cita no es media respuesta: el motor encadena los items sobre
    // la fijada. Ofrecer a Lucía porque corta acabaría en el 409 de la
    // ruta, sobre un nombre que la pantalla acababa de ofrecer.
    expect(
      profesionalesQuePuedenConLaCita(PERSONAL, [CORTE, MECHAS], idx).map(
        (p) => p.userId,
      ),
    ).toEqual([MARTA, IRENE]);
  });

  it("sin matriz (no llegó, o no hay red) se ofrecen todas", () => {
    // El mismo criterio que agenda-lista §3: inventarse un «no» por una
    // lectura que falló es peor que el fallo que esto viene a arreglar, y
    // el motor sigue siendo la puerta de verdad.
    expect(
      profesionalesQuePuedenConLaCita(PERSONAL, [MECHAS], null),
    ).toHaveLength(3);
  });

  it("una cita sin servicios no filtra a nadie", () => {
    expect(profesionalesQuePuedenConLaCita(PERSONAL, [], idx)).toHaveLength(3);
  });

  it("a quien la matriz no conoce se le ofrece: la ignorancia no descarta", () => {
    const idxSinIrene = indexarMatrizPorProfesional(matriz());
    idxSinIrene.delete(IRENE);
    expect(
      profesionalesQuePuedenConLaCita(PERSONAL, [MECHAS], idxSinIrene).map(
        (p) => p.userId,
      ),
    ).toEqual([MARTA, IRENE]);
  });

  it("quien no hace NINGUNO se queda fuera, no se cuela por el conjunto vacío", () => {
    // `indexarMatrizPorProfesional` mete a todo el personal con el
    // conjunto vacío a propósito. Ese vacío tiene que leerse como «no
    // puede», no como «no se sabe» — que es lo que pasa si el filtro
    // comprueba `!suyos` sin mirar el tamaño.
    const idxVacio = indexarMatrizPorProfesional(
      matriz({
        services: matriz().services.map((s) => ({ ...s, staffUserIds: [] })),
      }),
    );
    expect(
      profesionalesQuePuedenConLaCita(PERSONAL, [CORTE], idxVacio),
    ).toHaveLength(0);
  });
});
