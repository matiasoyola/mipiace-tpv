// residencia-3 · EL DOMINIO DEL REGISTRO, como tabla de verdad.
//
// Lo de este fichero es **puro**: la forma del valor, la ocurrencia, los
// límites del instante de la tablet y la cadena de correcciones. Sin
// Prisma y sin Fastify, por lo mismo que `queToca` es un paquete puro —
// los casos del borde son filas de una tabla y no una maqueta.
//
// Lo que NO está aquí y está en `residencia-3.e2e.ts`: todo lo que lo
// contesta Postgres (que no se borra, que no se edita, que el claro no
// cabe, que una ocurrencia no se duplica) y todo lo que contesta el camino
// completo por HTTP (la zona, la habitación, la idempotencia). Eso es
// justamente lo que un falso no puede probar.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { describe, expect, it } from "vitest";

import {
  MARGEN_FUTURO_MS,
  MARGEN_PASADO_MS,
  RegistroInvalido,
  colaDeLaCadena,
  comprobarInstante,
  nombreDeQuienFirma,
  ocurrenciaDe,
  valorDeRegistro,
  vivoDeLaCadena,
  type ControlParaRegistrar,
} from "../src/residencia/registro.js";

const AHORA = new Date("2026-10-15T09:00:00.000Z");

function control(p: Partial<ControlParaRegistrar> = {}): ControlParaRegistrar {
  return {
    id: "c1",
    code: "CAMBIO_POSTURAL",
    name: "Cambio postural",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    opciones: [],
    ...p,
  };
}

const ANIMO = control({
  code: "ANIMO",
  layer: "OBS",
  valueDomain: "ORDINAL",
  opciones: [
    { code: "COMO_SIEMPRE", isAsUsual: true },
    { code: "APAGADO", isAsUsual: false },
  ],
});

describe("el VALOR, comprobado contra el catálogo", () => {
  it("un BOOL se apunta como hecho", () => {
    expect(valorDeRegistro({ tipo: "BOOL", hecho: true }, control())).toEqual({
      tipo: "BOOL",
      hecho: true,
    });
  });

  it("y «NO HECHO» NO SE APUNTA: es la ausencia de registro", () => {
    // Si se pudiera apuntar, el indicador de cumplimiento tendría dos
    // fuentes para la misma pregunta y habría que decidir cuál manda. Quien
    // deriva el incumplimiento es residencia-4 cruzando `queToca` con lo
    // registrado.
    expect(() =>
      valorDeRegistro({ tipo: "BOOL", hecho: false }, control()),
    ).toThrow(/no se apunta/);
  });

  it("un ORDINAL exige una de SUS opciones", () => {
    expect(
      valorDeRegistro({ tipo: "ORDINAL", opcion: "APAGADO" }, ANIMO),
    ).toEqual({ tipo: "ORDINAL", opcion: "APAGADO", comoSiempre: false });
  });

  it("y una opción que ya no existe se RECHAZA con su nombre dentro", () => {
    // Pasa de verdad y sin que nadie se equivoque: una versión nueva del
    // control retira una opción mientras la tablet está sin red.
    try {
      valorDeRegistro({ tipo: "ORDINAL", opcion: "EUFORICO" }, ANIMO);
      throw new Error("tenía que fallar");
    } catch (err) {
      expect(err).toBeInstanceOf(RegistroInvalido);
      expect((err as RegistroInvalido).codigo).toBe("OPCION_DESCONOCIDA");
      expect((err as Error).message).toContain("EUFORICO");
    }
  });

  it("`comoSiempre` NO SE CREE: se calcula desde `isAsUsual`", () => {
    // Es la mitad que importa. Si viniera del cuerpo, una tablet podría
    // marcar como «como siempre» un «no ha dormido» y el indicador de
    // descanso nocturno del centro saldría impecable con la planta entera
    // sin dormir.
    expect(
      valorDeRegistro({ tipo: "ORDINAL", opcion: "COMO_SIEMPRE" }, ANIMO),
    ).toEqual({ tipo: "ORDINAL", opcion: "COMO_SIEMPRE", comoSiempre: true });
    expect(
      valorDeRegistro({ tipo: "ORDINAL", opcion: "APAGADO" }, ANIMO),
    ).toEqual({ tipo: "ORDINAL", opcion: "APAGADO", comoSiempre: false });
  });

  it("una NOTA no lleva valor: con decirlo basta (D-13)", () => {
    expect(
      valorDeRegistro(
        { tipo: "NOTA" },
        control({ code: "ALGO_NO_VA_BIEN", valueDomain: "TEXT_SHORT" }),
      ),
    ).toEqual({ tipo: "NOTA" });
  });

  // ── residencia-4 · LAS MEDIDAS YA ENTRAN ────────────────────────
  //
  // residencia-3 las rechazaba con `CONTROL_FUERA_DE_ALCANCE` y un
  // mensaje que decía de qué bloque eran. Es ese bloque.
  it("una MEDIDA se guarda, con su número y SU UNIDAD dentro", () => {
    // La unidad viaja con el número y no se deduce del catálogo al leer,
    // por lo mismo que el registro guarda el `controlTypeId` y no sólo
    // el código: el día que una versión nueva cambie la unidad, «38,4»
    // tiene que seguir diciendo grados.
    expect(
      valorDeRegistro(
        { tipo: "NUMERIC", numero: 38.4 },
        control({
          code: "TEMPERATURA",
          layer: "MEASURE",
          valueDomain: "NUMERIC",
          unit: "°C",
          inputMin: 30,
          inputMax: 45,
        }),
      ),
    ).toEqual({ tipo: "NUMERIC", numero: 38.4, unidad: "°C" });
  });

  it("FUERA DE RANGO no se guarda, y la frase dice el rango", () => {
    // Es la única validación del fichero que rechaza algo que
    // «ocurrió», porque NO ocurrió: 384 °C es un dedo que se saltó la
    // coma. Guardarlo haría sonar el móvil de guardia a las tres de la
    // mañana por una fiebre que nadie tuvo.
    try {
      valorDeRegistro(
        { tipo: "NUMERIC", numero: 384 },
        control({
          code: "TEMPERATURA",
          name: "Temperatura",
          layer: "MEASURE",
          valueDomain: "NUMERIC",
          unit: "°C",
          inputMin: 30,
          inputMax: 45,
        }),
      );
      throw new Error("tenía que fallar");
    } catch (err) {
      expect((err as RegistroInvalido).codigo).toBe("VALOR_FUERA_DE_RANGO");
      expect((err as Error).message).toContain("de 30 a 45");
      expect((err as Error).message).toContain("Repite la toma");
    }
  });

  it("y una medida que llega como BOOL no cuadra", () => {
    try {
      valorDeRegistro(
        { tipo: "BOOL", hecho: true },
        control({ code: "TEMPERATURA", layer: "MEASURE", valueDomain: "NUMERIC" }),
      );
      throw new Error("tenía que fallar");
    } catch (err) {
      expect((err as RegistroInvalido).codigo).toBe("VALOR_NO_CUADRA");
      expect((err as Error).message).toContain("se apunta con un número");
    }
  });

  it("residencia-4 · «algo no va bien» con TIPO y MATIZ, los dos opcionales", () => {
    const control_ = control({
      code: "ALGO_NO_VA_BIEN",
      valueDomain: "TEXT_SHORT",
    });
    // Sin nada: sigue siendo un registro completo (D-13).
    expect(valorDeRegistro({ tipo: "NOTA" }, control_)).toEqual({ tipo: "NOTA" });
    // Con tipo y matiz, normalizados a mayúsculas: son identificadores.
    expect(
      valorDeRegistro(
        { tipo: "NOTA", evento: "caida", matiz: " con_golpe " },
        control_,
      ),
    ).toEqual({ tipo: "NOTA", evento: "CAIDA", matiz: "CON_GOLPE" });
  });

  it("…y un tipo que la plantilla NO conoce se guarda igual", () => {
    // Una tablet nueva contra un servidor viejo. Perder el registro por
    // un código que no cuadra sería perder el aviso; lo que pasa es que
    // gradúa como «algo no va bien» (N1).
    expect(
      valorDeRegistro(
        { tipo: "NOTA", evento: "INCENDIO" },
        control({ code: "ALGO_NO_VA_BIEN", valueDomain: "TEXT_SHORT" }),
      ),
    ).toEqual({ tipo: "NOTA", evento: "INCENDIO" });
  });

  it("y una ESCALA también, con la Fase 2 en el mensaje", () => {
    try {
      valorDeRegistro(
        { tipo: "BOOL", hecho: true },
        control({ code: "BARTHEL", layer: "SCALE", valueDomain: "SCORE" }),
      );
      throw new Error("tenía que fallar");
    } catch (err) {
      expect((err as Error).message).toContain("Fase 2");
    }
  });
});

describe("la OCURRENCIA · cuántas veces puede repetirse esto", () => {
  const ocurrencia = new Date("2026-10-15T08:00:00.000Z");

  it("la OBSERVACIÓN DIARIA no cuelga de ninguna: una por residente y turno", () => {
    // Y da igual que su línea del plan tenga ocurrencias: el toque de
    // «¿cómo está hoy?» responde al turno, no a una ronda. De aquí sale
    // «repetirlo en el mismo turno corrige» (decisión 4).
    expect(ocurrenciaDe(ANIMO, AHORA, ocurrencia)).toBeNull();
  });

  it("lo `ON_DEMAND` se adscribe a SU PROPIO instante: dos deposiciones son dos", () => {
    const deposicion = control({ code: "DEPOSICION", nature: "ON_DEMAND" });
    expect(ocurrenciaDe(deposicion, AHORA, null)).toEqual(AHORA);
  });

  it("y lo que TOCA lleva el instante que devolvió `queToca`", () => {
    expect(ocurrenciaDe(control(), AHORA, ocurrencia)).toEqual(ocurrencia);
  });
});

describe("el INSTANTE de la tablet, con sus dos márgenes", () => {
  it("un cuidado de hace tres horas entra: es lo normal sin red", () => {
    expect(() =>
      comprobarInstante(new Date(AHORA.getTime() - 3 * 3600_000), AHORA),
    ).not.toThrow();
  });

  it("un desvío de reloj de dos minutos entra", () => {
    expect(() =>
      comprobarInstante(new Date(AHORA.getTime() + 2 * 60_000), AHORA),
    ).not.toThrow();
  });

  it("UN RELOJ PUESTO EN MAÑANA se rechaza, con su código", () => {
    // Un registro del futuro cae en un turno que todavía no ha pasado: la
    // DUE del relevo leería un cambio postural que nadie ha hecho.
    try {
      comprobarInstante(new Date(AHORA.getTime() + 24 * 3600_000), AHORA);
      throw new Error("tenía que fallar");
    } catch (err) {
      expect((err as RegistroInvalido).codigo).toBe("REGISTRO_EN_EL_FUTURO");
      expect((err as Error).message).toContain("reloj");
    }
  });

  it("y un registro de hace un mes también", () => {
    try {
      comprobarInstante(new Date(AHORA.getTime() - 30 * 24 * 3600_000), AHORA);
      throw new Error("tenía que fallar");
    } catch (err) {
      expect((err as RegistroInvalido).codigo).toBe("REGISTRO_DEMASIADO_VIEJO");
    }
  });

  it("los dos bordes exactos: dentro entra, un milisegundo más no", () => {
    expect(() =>
      comprobarInstante(new Date(AHORA.getTime() + MARGEN_FUTURO_MS), AHORA),
    ).not.toThrow();
    expect(() =>
      comprobarInstante(new Date(AHORA.getTime() + MARGEN_FUTURO_MS + 1), AHORA),
    ).toThrow();
    expect(() =>
      comprobarInstante(new Date(AHORA.getTime() - MARGEN_PASADO_MS), AHORA),
    ).not.toThrow();
    expect(() =>
      comprobarInstante(new Date(AHORA.getTime() - MARGEN_PASADO_MS - 1), AHORA),
    ).toThrow();
  });

  it("una fecha que no es fecha se rechaza antes de compararla", () => {
    expect(() => comprobarInstante(new Date("mañana por la tarde"), AHORA)).toThrow(
      /no es una fecha/,
    );
  });
});

describe("la CADENA de correcciones", () => {
  const a = {
    id: "a",
    correctsRecordId: null,
    voidedAt: null,
    recordedAt: new Date("2026-10-15T08:20:00Z"),
  };
  const b = {
    id: "b",
    correctsRecordId: "a",
    voidedAt: null,
    recordedAt: new Date("2026-10-15T08:25:00Z"),
  };
  const c = {
    id: "c",
    correctsRecordId: "b",
    voidedAt: null,
    recordedAt: new Date("2026-10-15T11:00:00Z"),
  };

  it("sin nada registrado, no hay cola", () => {
    expect(colaDeLaCadena([])).toBeNull();
    expect(vivoDeLaCadena([])).toBeNull();
  });

  it("LA COLA es el eslabón que nadie corrige", () => {
    expect(colaDeLaCadena([a, b, c])?.id).toBe("c");
  });

  it("y el ORDEN es el de la cadena, NO el del reloj", () => {
    // Un registro hecho sin red a las 08:20 puede llegar DESPUÉS de su
    // corrección: la cola del TPV reintenta en el orden en que los items
    // sueltan el lock. «El último por hora» y «el último de la cadena» no
    // son el mismo, y el que manda es el de la cadena.
    const tarde = { ...a, recordedAt: new Date("2026-10-15T23:00:00Z") };
    expect(colaDeLaCadena([tarde, b])?.id).toBe("b");
  });

  it("anular la cola deja la ocurrencia SIN NADA VIVO", () => {
    const anulada = { ...c, voidedAt: new Date("2026-10-15T11:05:00Z") };
    expect(colaDeLaCadena([a, b, anulada])?.id).toBe("c");
    expect(vivoDeLaCadena([a, b, anulada])).toBeNull();
  });

  it("y registrar otra vez después de anular vuelve a dejar algo vivo", () => {
    // Es lo que hace que «Deshacer el último» y volver a pulsar «Hecho»
    // funcione: la fila nueva corrige a la anulada y es la cola.
    const anulada = { ...c, voidedAt: new Date("2026-10-15T11:05:00Z") };
    const d = {
      id: "d",
      correctsRecordId: "c",
      voidedAt: null,
      recordedAt: new Date("2026-10-15T11:06:00Z"),
    };
    expect(vivoDeLaCadena([a, b, anulada, d])?.id).toBe("d");
  });
});

describe("cómo se llama quien firma", () => {
  it("el alias si lo tiene", () => {
    expect(nombreDeQuienFirma({ alias: "Ana", email: "ana@gredos.es" })).toBe(
      "Ana",
    );
  });

  it("y si no, LA PARTE LOCAL del email y no el email entero", () => {
    // Un email completo en la pantalla de un pasillo es un dato personal
    // publicado donde no hace falta, y lo que la auxiliar necesita saber es
    // quién fue, no cómo escribirle.
    expect(
      nombreDeQuienFirma({ alias: null, email: "ana.lopez@gredos.es" }),
    ).toBe("ana.lopez");
  });
});
