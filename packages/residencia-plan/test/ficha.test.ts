// historia-1 (D-91) · **LA TABLA DE LA FRANJA DE ALERTAS.**
//
// Lo que esta tabla fija, por orden de importancia:
//
//   1. **que la frase de la puerta no lleva diagnósticos**. Es la mitad
//      de D-91 y lo único de aquí que, si se rompe, publica un dato de
//      salud en la pared de un pasillo;
//   2. qué alerta y qué no (una alergia leve no, una grave sí; unas gafas
//      no, una sonda sí; una dieta normal no, un espesante sí);
//   3. que una dieta que **no existe** no se inventa normal;
//   4. que el orden es estable, porque la auxiliar lee la primera línea
//      de reojo cuarenta veces por turno.
//
// Pura: cada caso es una ficha de datos y una aserción. Ninguna maqueta
// de Prisma y ningún reloj.

import { describe, expect, it } from "vitest";

import {
  CODIGOS_DE_DISPOSITIVO,
  DISPOSITIVOS_DE_SERIE,
  RESTRICCIONES_DE_SERIE,
  alertasDeLaFicha,
  dispositivoDeSerie,
  frasesParaLaPuerta,
  nombreDeRestriccion,
  nombreDeTextura,
} from "../src/ficha.js";
import type { FichaParaLaFranja } from "../src/ficha.js";

/** Una ficha vacía, y lo que haga falta encima. */
function ficha(extra: Partial<FichaParaLaFranja> = {}): FichaParaLaFranja {
  return {
    diagnosticos: [],
    alergias: [],
    dispositivos: [],
    dieta: null,
    ...extra,
  };
}

describe("el catálogo de dispositivos es dato del producto", () => {
  it("los diez de D-90, y `OTRO` el último", () => {
    expect(CODIGOS_DE_DISPOSITIVO).toEqual([
      "SILLA_DE_RUEDAS",
      "ANDADOR",
      "GRUA",
      "SONDA",
      "OXIGENO",
      "ABSORBENTES",
      "AUDIFONO",
      "PROTESIS_DENTAL",
      "GAFAS",
      "OTRO",
    ]);
  });

  it("y SÓLO tres son de riesgo: grúa, sonda y oxígeno", () => {
    // Si alguien marca `riesgo: true` en las gafas, la banda de la puerta
    // se llena y deja de leerse. Que sean exactamente tres está escrito
    // aquí para que ampliarlo sea una decisión y no un descuido.
    expect(DISPOSITIVOS_DE_SERIE.filter((d) => d.riesgo).map((d) => d.code)).toEqual([
      "GRUA",
      "SONDA",
      "OXIGENO",
    ]);
  });

  it("un código que no existe no revienta: devuelve `undefined`", () => {
    expect(dispositivoDeSerie("CPAP")).toBeUndefined();
  });

  it("las cuatro restricciones de dieta, y una desconocida se enseña tal cual", () => {
    expect(RESTRICCIONES_DE_SERIE.map((r) => r.code)).toEqual([
      "DIABETICA",
      "SIN_SAL",
      "SIN_GLUTEN",
      "OTRAS",
    ]);
    expect(nombreDeRestriccion("SIN_SAL")).toBe("Sin sal");
    // Esconder lo que no se conoce sería borrar la única pista.
    expect(nombreDeRestriccion("SIN_LACTOSA")).toBe("SIN_LACTOSA");
  });

  it("las cuatro texturas, en palabras", () => {
    expect(nombreDeTextura("NORMAL")).toBe("Normal");
    expect(nombreDeTextura("TRITURADA")).toBe("Triturada");
    expect(nombreDeTextura("ENTERAL")).toBe("Enteral");
  });
});

describe("las alergias", () => {
  it("una GRAVE alerta, con el agente y sin la reacción en la frase", () => {
    const a = alertasDeLaFicha(
      ficha({
        alergias: [
          {
            id: "a1",
            clase: "MEDICAMENTO",
            gravedad: "GRAVE",
            agente: "penicilina",
            reaccion: "urticaria y edema de labios",
          },
        ],
      }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.clase).toBe("ALERGIA");
    // Lo accionable es QUÉ no se le da, no qué le pasaría.
    expect(a[0]!.frase).toBe("Alergia: penicilina");
    expect(a[0]!.detalle).toBe("urticaria y edema de labios");
  });

  it("una LEVE y una MODERADA no alertan", () => {
    const a = alertasDeLaFicha(
      ficha({
        alergias: [
          { id: "a1", clase: "ALIMENTO", gravedad: "LEVE", agente: "lactosa", reaccion: null },
          { id: "a2", clase: "OTRA", gravedad: "MODERADA", agente: "polen", reaccion: null },
        ],
      }),
    );
    // Están en la ficha, donde las mira quien prescribe y quien cocina.
    // En la banda de la puerta gastarían la única línea que se lee.
    expect(a).toEqual([]);
  });

  it("dos graves salen ordenadas por el agente, no por el id", () => {
    const a = alertasDeLaFicha(
      ficha({
        alergias: [
          { id: "z", clase: "ALIMENTO", gravedad: "GRAVE", agente: "frutos secos", reaccion: null },
          { id: "a", clase: "MEDICAMENTO", gravedad: "GRAVE", agente: "amoxicilina", reaccion: null },
        ],
      }),
    );
    expect(a.map((x) => x.frase)).toEqual([
      "Alergia: amoxicilina",
      "Alergia: frutos secos",
    ]);
  });
});

describe("los diagnósticos marcados", () => {
  it("la frase es la que escribió quien lo marcó; el diagnóstico va al detalle", () => {
    const a = alertasDeLaFicha(
      ficha({
        diagnosticos: [
          {
            id: "d1",
            texto: "Fibrilación auricular en tratamiento con acenocumarol",
            alerta: true,
            frase: "Toma anticoagulantes: cualquier golpe, avisa",
          },
        ],
      }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.frase).toBe("Toma anticoagulantes: cualquier golpe, avisa");
    expect(a[0]!.detalle).toBe("Fibrilación auricular en tratamiento con acenocumarol");
  });

  it("un diagnóstico SIN marca no alerta", () => {
    expect(
      alertasDeLaFicha(
        ficha({
          diagnosticos: [
            { id: "d1", texto: "Artrosis de rodilla", alerta: false, frase: null },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("una marca SIN frase se OMITE, no se rellena con el diagnóstico", () => {
    // El motor lo impide (CHECK `resident_diagnoses_alerta_completa`),
    // así que esto no debería poder llegar. Se comprueba igual porque la
    // alternativa, si llegara, habría sido poner el diagnóstico en la
    // frase — y entonces el diagnóstico acabaría en una tablet de
    // pasillo. Una función que depende de que la base no se equivoque
    // falla en silencio.
    const a = alertasDeLaFicha(
      ficha({
        diagnosticos: [
          { id: "d1", texto: "Neoplasia de colon", alerta: true, frase: null },
          { id: "d2", texto: "Diabetes tipo 2", alerta: true, frase: "   " },
        ],
      }),
    );
    expect(a).toEqual([]);
    expect(frasesParaLaPuerta(ficha({
      diagnosticos: [{ id: "d1", texto: "Neoplasia de colon", alerta: true, frase: null }],
    }))).toEqual([]);
  });
});

describe("la dieta", () => {
  it("triturada con espesante nivel 2 da la frase del prompt", () => {
    const a = alertasDeLaFicha(
      ficha({ dieta: { textura: "TRITURADA", espesante: true, nivelDeEspesante: 2 } }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.frase).toBe("Disfagia: triturado y espesante nivel 2");
    // Y sin detalle: la frase ya lo dice todo, y el POR QUÉ tiene
    // disfagia (un ictus, un párkinson) está en un diagnóstico y no aquí.
    expect(a[0]!.detalle).toBeNull();
  });

  it("textura normal SIN espesante no alerta", () => {
    expect(
      alertasDeLaFicha(
        ficha({ dieta: { textura: "NORMAL", espesante: false, nivelDeEspesante: null } }),
      ),
    ).toEqual([]);
  });

  it("textura normal CON espesante sí alerta", () => {
    const a = alertasDeLaFicha(
      ficha({ dieta: { textura: "NORMAL", espesante: true, nivelDeEspesante: 1 } }),
    );
    expect(a.map((x) => x.frase)).toEqual(["Disfagia: espesante nivel 1"]);
  });

  it("textura blanda sin espesante alerta sólo con la textura", () => {
    const a = alertasDeLaFicha(
      ficha({ dieta: { textura: "BLANDA", espesante: false, nivelDeEspesante: null } }),
    );
    // «blando» y no «blanda»: la palabra concuerda con lo que se le da
    // de comer, no con la columna «Textura» de la ficha. Ver los dos
    // diccionarios en `ficha.ts`.
    expect(a.map((x) => x.frase)).toEqual(["Disfagia: blando"]);
  });

  it("**una dieta que NO existe no alerta y no se inventa normal**", () => {
    // Es el caso que importa: pintar «normal» por no tener fila sería
    // afirmar algo que nadie ha comprobado, y a alguien con disfagia sin
    // ficha se le daría un filete. El hueco lo dice la pantalla de la
    // ficha y lo tiene el ingreso guiado como pendiente.
    expect(alertasDeLaFicha(ficha({ dieta: null }))).toEqual([]);
  });

  it("las restricciones NO alertan por sí solas", () => {
    // Una dieta diabética es una propiedad del plato que sale de la
    // cocina, no algo que la auxiliar tenga que saber al abrir la puerta.
    expect(
      alertasDeLaFicha(
        ficha({ dieta: { textura: "NORMAL", espesante: false, nivelDeEspesante: null } }),
      ),
    ).toEqual([]);
  });
});

describe("los dispositivos", () => {
  it("una sonda alerta, con el detalle fuera de la frase", () => {
    const a = alertasDeLaFicha(
      ficha({
        dispositivos: [{ id: "p1", code: "SONDA", detalle: "vesical Foley 16" }],
      }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.frase).toBe("Lleva sonda");
    expect(a[0]!.detalle).toBe("vesical Foley 16");
  });

  it("unas gafas y un audífono no alertan", () => {
    expect(
      alertasDeLaFicha(
        ficha({
          dispositivos: [
            { id: "p1", code: "GAFAS", detalle: null },
            { id: "p2", code: "AUDIFONO", detalle: null },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("un código que no está en el catálogo no alerta", () => {
    expect(
      alertasDeLaFicha(
        ficha({ dispositivos: [{ id: "p1", code: "CPAP", detalle: "nocturna" }] }),
      ),
    ).toEqual([]);
  });
});

describe("el orden de la franja", () => {
  it("alergias, diagnósticos, dieta y dispositivos, en ese orden", () => {
    // El orden es el del riesgo inmediato, no el de la base.
    const a = alertasDeLaFicha({
      dispositivos: [{ id: "p1", code: "OXIGENO", detalle: null }],
      dieta: { textura: "TRITURADA", espesante: false, nivelDeEspesante: null },
      diagnosticos: [
        { id: "d1", texto: "FA anticoagulada", alerta: true, frase: "Anticoagulado" },
      ],
      alergias: [
        { id: "a1", clase: "MEDICAMENTO", gravedad: "GRAVE", agente: "penicilina", reaccion: null },
      ],
    });
    expect(a.map((x) => x.clase)).toEqual([
      "ALERGIA",
      "DIAGNOSTICO",
      "DIETA",
      "DISPOSITIVO",
    ]);
  });

  it("y es ESTABLE: dos llamadas con los datos en otro orden dan lo mismo", () => {
    const dispositivos = [
      { id: "p1", code: "SONDA", detalle: null },
      { id: "p2", code: "OXIGENO", detalle: null },
    ];
    const uno = alertasDeLaFicha(ficha({ dispositivos }));
    const otro = alertasDeLaFicha(ficha({ dispositivos: [...dispositivos].reverse() }));
    expect(uno.map((x) => x.frase)).toEqual(otro.map((x) => x.frase));
  });
});

describe("**LO QUE LLEGA A LA PUERTA NO LLEVA DIAGNÓSTICOS** (D-91)", () => {
  // Es la prueba del bloque. Una ficha con todo dentro, y lo que sale
  // para la tablet no contiene ni un trozo de ningún `detalle`.
  const COMPLETA: FichaParaLaFranja = {
    diagnosticos: [
      {
        id: "d1",
        texto: "Adenocarcinoma de próstata con metástasis óseas",
        alerta: true,
        frase: "Toma morfina: si tiene dolor, avisa a la DUE",
      },
      { id: "d2", texto: "Demencia tipo Alzheimer GDS 6", alerta: false, frase: null },
    ],
    alergias: [
      {
        id: "a1",
        clase: "MEDICAMENTO",
        gravedad: "GRAVE",
        agente: "penicilina",
        reaccion: "shock anafiláctico en 2019",
      },
    ],
    dispositivos: [{ id: "p1", code: "SONDA", detalle: "vesical permanente por retención" }],
    dieta: { textura: "TRITURADA", espesante: true, nivelDeEspesante: 2 },
  };

  it("las frases son exactamente cuatro y son accionables", () => {
    expect(frasesParaLaPuerta(COMPLETA)).toEqual([
      "Alergia: penicilina",
      "Toma morfina: si tiene dolor, avisa a la DUE",
      "Disfagia: triturado y espesante nivel 2",
      "Lleva sonda",
    ]);
  });

  it("y NINGUNA contiene un diagnóstico, una reacción ni un detalle clínico", () => {
    const juntas = frasesParaLaPuerta(COMPLETA).join(" | ").toLowerCase();
    for (const prohibido of [
      "adenocarcinoma",
      "próstata",
      "metástasis",
      "alzheimer",
      "gds",
      "anafiláctico",
      "2019",
      "retención",
      "permanente",
      "vesical",
    ]) {
      expect(juntas).not.toContain(prohibido);
    }
  });

  it("el `detalle` sí los lleva: es lo que ve el despacho", () => {
    // La otra mitad de la decisión. Si esto saliera vacío, la pantalla de
    // la ficha habría perdido el porqué y la franja del admin diría menos
    // que el papel que viene a sustituir.
    const detalles = alertasDeLaFicha(COMPLETA)
      .map((a) => a.detalle)
      .filter((d): d is string => d != null)
      .join(" | ");
    expect(detalles).toContain("Adenocarcinoma");
    expect(detalles).toContain("anafiláctico");
    expect(detalles).toContain("vesical");
  });
});
