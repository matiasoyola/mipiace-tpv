// residencia-4 · LA MECÁNICA DE `gravedadDe`, con reglas de juguete.
//
// Aquí NO está la tabla del §3: ésa es el test de oro y vive en
// `apps/api/test/residencia-4-gravedad.test.ts`, porque necesita el
// fichero de datos del producto y este paquete no puede importarlo.
//
// Lo que se fija aquí son las cuatro decisiones de la función, que es lo
// que se puede romper sin que el test de oro se entere:
//
//   1. **gana la más grave, no la primera** — el orden de las reglas no
//      puede cambiar un nivel;
//   2. **la excepción SUSTITUYE, no se suma** — y vacía significa «este
//      control no gradúa para esta persona»;
//   3. **la vigencia de la excepción** se mira contra el instante del
//      registro, no contra «ahora»;
//   4. **el aviso forzado sube a N2 y nunca baja** — pulsarlo sobre un
//      N3 no puede convertirlo en N2.

import { describe, expect, it } from "vitest";

import {
  canalesDe,
  conAvisoForzado,
  excepcionVigente,
  gravedadDe,
  gravedadDeEvento,
  masGrave,
  nivelMaximo,
  type ExcepcionDeUmbral,
  type ReglaDeGravedad,
} from "../src/gravedad.js";

/** Reglas de juguete: dos bandas de temperatura, deliberadamente en el
 *  orden «equivocado» (la más grave primero y la menos grave después). */
const REGLAS: ReglaDeGravedad[] = [
  { kind: "THRESHOLD", controlCode: "T", comparador: "GTE", valor: 39.5, nivel: "N3", tipo: "FIEBRE" },
  { kind: "THRESHOLD", controlCode: "T", comparador: "GTE", valor: 37.5, nivel: "N1", tipo: "FIEBRE" },
  { kind: "THRESHOLD", controlCode: "T", comparador: "GTE", valor: 38, nivel: "N2", tipo: "FIEBRE" },
  { kind: "THRESHOLD", controlCode: "S", comparador: "LT", valor: 92, nivel: "N2", tipo: "HIPOXIA" },
  { kind: "EVENT", evento: "CAIDA", matiz: null, nivel: "N1", tipo: "CAIDA" },
  { kind: "EVENT", evento: "CAIDA", matiz: "CON_GOLPE", nivel: "N3", tipo: "CAIDA" },
  { kind: "EVENT", evento: "CAIDA", matiz: "SIN_GOLPE", nivel: "N1", tipo: "CAIDA" },
  { kind: "EVENT", evento: "AVERIA", matiz: "PELIGROSA", nivel: "N2", tipo: "AVERIA" },
  { kind: "EVENT", evento: "AVERIA", matiz: "SIN_RIESGO", nivel: "N0", tipo: "AVERIA" },
];

describe("gravedadDe · la mecánica", () => {
  it("GANA LA MÁS GRAVE y no la primera que casa", () => {
    // Las tres reglas casan con 40; la que manda es N3 aunque esté la
    // primera, y seguiría mandando si estuviera la última. Es lo que
    // impide que el `sortOrder` de unas filas de la base cambie un nivel.
    expect(gravedadDe("T", 40, REGLAS)?.nivel).toBe("N3");
    expect(gravedadDe("T", 38.4, REGLAS)?.nivel).toBe("N2");
    expect(gravedadDe("T", 37.6, REGLAS)?.nivel).toBe("N1");
  });

  it("y con las reglas BARAJADAS da exactamente lo mismo", () => {
    const alReves = [...REGLAS].reverse();
    for (const n of [36, 37.5, 38, 39.5, 41]) {
      expect(gravedadDe("T", n, alReves)?.nivel ?? null).toBe(
        gravedadDe("T", n, REGLAS)?.nivel ?? null,
      );
    }
  });

  it("una constante SIN REGLAS no gradúa nada, y no es un error", () => {
    // Pulso, peso y diastólica caen aquí en la plantilla de verdad.
    expect(gravedadDe("PULSO", 180, REGLAS)).toBeNull();
    expect(gravedadDe("T", 36.2, REGLAS)).toBeNull();
  });

  it("un número que no es número no gradúa", () => {
    expect(gravedadDe("T", Number.NaN, REGLAS)).toBeNull();
    expect(gravedadDe("T", Number.POSITIVE_INFINITY, REGLAS)).toBeNull();
  });
});

describe("la excepción por residente (D-22)", () => {
  const excepcion: ExcepcionDeUmbral = {
    controlCode: "T",
    desde: new Date("2026-10-01T00:00:00Z"),
    hasta: new Date("2026-11-01T00:00:00Z"),
    reglas: [{ comparador: "GTE", valor: 38.5, nivel: "N2", tipo: "FIEBRE" }],
  };

  it("SUSTITUYE a las de serie: 38,0 deja de graduar", () => {
    // Sin excepción, 38,0 es N2. Con la del paliativo, no es nada — y eso
    // es lo que la excepción existe para conseguir.
    expect(gravedadDe("T", 38, REGLAS)?.nivel).toBe("N2");
    expect(gravedadDe("T", 38, REGLAS, excepcion)).toBeNull();
    expect(gravedadDe("T", 38.6, REGLAS, excepcion)?.nivel).toBe("N2");
  });

  it("y NO SE SUMA: la de serie no dispara por debajo de la suya", () => {
    // Si se sumaran, 37,6 seguiría siendo N1 por la regla de serie, que
    // es exactamente el ruido que la pauta médica quiere quitar.
    expect(gravedadDe("T", 37.6, REGLAS, excepcion)).toBeNull();
  });

  it("sólo toca SU control: la saturación del mismo residente sigue igual", () => {
    expect(gravedadDe("S", 90, REGLAS, excepcion)?.nivel).toBe("N2");
  });

  it("una excepción VACÍA es una pauta válida: no gradúa nada", () => {
    const sinReglas: ExcepcionDeUmbral = { ...excepcion, reglas: [] };
    expect(gravedadDe("T", 41, REGLAS, sinReglas)).toBeNull();
  });

  it("la vigencia se mira contra EL INSTANTE DEL REGISTRO", () => {
    expect(excepcionVigente(excepcion, new Date("2026-10-15T10:00:00Z"))).toBe(true);
    // El borde de abajo entra…
    expect(excepcionVigente(excepcion, new Date("2026-10-01T00:00:00Z"))).toBe(true);
    // …y el de arriba no: `hasta` es exclusivo, como `toAt` en el resto
    // de las vigencias de la casa.
    expect(excepcionVigente(excepcion, new Date("2026-11-01T00:00:00Z"))).toBe(false);
    expect(excepcionVigente(excepcion, new Date("2026-09-30T23:59:59Z"))).toBe(false);
  });

  it("CADUCADA, vuelve la de serie sin que nadie haga nada", () => {
    const instante = new Date("2026-11-02T10:00:00Z");
    const aplicada = excepcionVigente(excepcion, instante) ? excepcion : null;
    expect(aplicada).toBeNull();
    expect(gravedadDe("T", 38, REGLAS, aplicada)?.nivel).toBe("N2");
  });

  it("sin fecha de fin, sigue vigente dentro de un año", () => {
    const sinFin: ExcepcionDeUmbral = { ...excepcion, hasta: null };
    expect(excepcionVigente(sinFin, new Date("2027-10-01T00:00:00Z"))).toBe(true);
  });
});

describe("gravedadDeEvento", () => {
  it("con MATIZ manda el matiz, aunque sea MENOS grave que la base", () => {
    // «Avería sin riesgo» es N0 y «caída sin golpe» es N1. Coger la más
    // grave de las dos convertiría responder «no» en no responder.
    expect(gravedadDeEvento("AVERIA", "SIN_RIESGO", REGLAS)?.nivel).toBe("N0");
    expect(gravedadDeEvento("AVERIA", "PELIGROSA", REGLAS)?.nivel).toBe("N2");
    expect(gravedadDeEvento("CAIDA", "SIN_GOLPE", REGLAS)?.nivel).toBe("N1");
    expect(gravedadDeEvento("CAIDA", "CON_GOLPE", REGLAS)?.nivel).toBe("N3");
  });

  it("SIN matiz cae a la regla base", () => {
    expect(gravedadDeEvento("CAIDA", null, REGLAS)?.nivel).toBe("N1");
  });

  it("un matiz DESCONOCIDO cae a la base en vez de perderse", () => {
    // Una tablet nueva contra una plantilla vieja. Lo que no puede pasar
    // es que el registro no gradúe nada.
    expect(gravedadDeEvento("CAIDA", "CON_FRACTURA", REGLAS)?.nivel).toBe("N1");
  });

  it("un evento que SÓLO tiene matices y llega sin ninguno avisa de MÁS", () => {
    // `AVERIA` no tiene regla base. Un cliente roto o viejo manda el
    // evento sin matiz, y entonces gana el más grave de los suyos: avisar
    // de más es el lado correcto del error.
    expect(gravedadDeEvento("AVERIA", null, REGLAS)?.nivel).toBe("N2");
  });

  it("un evento que la plantilla no conoce devuelve null", () => {
    expect(gravedadDeEvento("INCENDIO", null, REGLAS)).toBeNull();
  });
});

describe("el botón de la enfermera (alcance 7)", () => {
  it("fuerza COMO MÍNIMO N2, y nunca baja", () => {
    expect(conAvisoForzado(null)).toBe("N2");
    expect(conAvisoForzado("N0")).toBe("N2");
    expect(conAvisoForzado("N1")).toBe("N2");
    expect(conAvisoForzado("N2")).toBe("N2");
    // Lo que importa: pulsarlo sobre una caída con golpe NO la baja.
    expect(conAvisoForzado("N3")).toBe("N3");
    expect(conAvisoForzado("N4")).toBe("N4");
  });
});

describe("los niveles se comparan por gravedad", () => {
  it("N4 > N3 > N2 > N1 > N0", () => {
    expect(masGrave("N4", "N3")).toBe(true);
    expect(masGrave("N1", "N2")).toBe(false);
    expect(masGrave("N2", "N2")).toBe(false);
    expect(nivelMaximo("N1", "N3")).toBe("N3");
    expect(nivelMaximo("N3", "N1")).toBe("N3");
  });
});

describe("a quién le suena cada nivel (D-66)", () => {
  it("de serie: N2 enfermería, N3 y N4 los dos, N0 y N1 nadie", () => {
    expect(canalesDe("N0")).toEqual([]);
    expect(canalesDe("N1")).toEqual([]);
    expect(canalesDe("N2")).toEqual(["ENFERMERIA"]);
    expect(canalesDe("N3")).toEqual(["ENFERMERIA", "RESPONSABLE"]);
    expect(canalesDe("N4")).toEqual(["ENFERMERIA", "RESPONSABLE"]);
  });

  it("y el centro puede cambiarlos, incluido DEJAR UN NIVEL SIN AVISO", () => {
    // Vacío no es «no configurado»: es «este nivel no suena», y es una
    // decisión legítima que la pantalla pinta como tal.
    expect(canalesDe("N2", { N2: [] })).toEqual([]);
    expect(canalesDe("N2", { N2: ["RESPONSABLE"] })).toEqual(["RESPONSABLE"]);
    // Lo que no configura cae a lo de serie.
    expect(canalesDe("N3", { N2: [] })).toEqual(["ENFERMERIA", "RESPONSABLE"]);
  });
});
