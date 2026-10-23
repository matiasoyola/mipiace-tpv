// alta-minima · LA TABLA DE `datosQueFaltan`.
//
// Es una función pura con una tabla dentro, así que el test es una tabla
// contra otra. Lo que se fija aquí:
//
//   · la ficha VACÍA (la que sale del alta rápida con sólo el nombre) y
//     la COMPLETA, que son los dos extremos;
//   · la plaza CONCERTADA sin grado (imprescindible: sin grado no se
//     factura a la Junta) frente a la PRIVADA sin grado (recomendable);
//   · sin plan de cuidados;
//   · con el DNI cifrado presente, que es el caso que demuestra que
//     contar lo que falta no descifra nada.

import { describe, expect, it } from "vitest";

import {
  datosQueFaltan,
  estadoDeLaFicha,
  resumenDeFichas,
  type CampoDeFicha,
  type FichaParaCompletar,
} from "../src/datos-que-faltan.js";

/** La ficha tal y como nace del alta rápida: sólo el nombre. */
const VACIA: FichaParaCompletar = {
  lastName: null,
  admissionDate: null,
  dependencyLevel: null,
  placeType: null,
  dependencyGrade: null,
  birthdate: null,
  responsibleName: null,
  responsiblePhone: null,
  tieneDni: false,
  tieneNss: false,
  tieneCama: false,
  tienePlan: false,
};

/** Y la que no le falta nada. */
const COMPLETA: FichaParaCompletar = {
  lastName: "Ramos Doblado",
  admissionDate: "2026-03-01",
  dependencyLevel: "DEPENDIENTE",
  placeType: "PRIVADA",
  dependencyGrade: "II",
  birthdate: "1941-06-12",
  responsibleName: "Pilar Ramos",
  responsiblePhone: "600111222",
  tieneDni: true,
  tieneNss: true,
  tieneCama: true,
  tienePlan: true,
};

const campos = (f: FichaParaCompletar): CampoDeFicha[] =>
  datosQueFaltan(f).map((d) => d.campo);

const pesoDe = (f: FichaParaCompletar, campo: CampoDeFicha) =>
  datosQueFaltan(f).find((d) => d.campo === campo)?.peso ?? null;

describe("alta-minima · la ficha vacía, que es la del alta rápida", () => {
  it("le faltan los ONCE datos de la tabla", () => {
    expect(campos(VACIA)).toEqual([
      // Imprescindibles, en el orden en que la dirección los cierra.
      "apellidos",
      "fechaDeIngreso",
      "nivelDeDependencia",
      "tipoDePlaza",
      "dni",
      "familiarResponsable",
      "planDeCuidados",
      // Recomendables.
      "gradoReconocido",
      "nss",
      "fechaDeNacimiento",
      "cama",
    ]);
  });

  it("los imprescindibles van DELANTE de los recomendables", () => {
    const pesos = datosQueFaltan(VACIA).map((d) => d.peso);
    const primerRecomendable = pesos.indexOf("RECOMENDABLE");
    expect(primerRecomendable).toBeGreaterThan(0);
    expect(pesos.slice(primerRecomendable)).not.toContain("IMPRESCINDIBLE");
  });

  it("y la pantalla sabe que está incompleta y con imprescindibles", () => {
    const e = estadoDeLaFicha(VACIA);
    expect(e.incompleta).toBe(true);
    expect(e.conImprescindibles).toBe(true);
  });

  it("NO pide el teléfono del familiar antes de saber quién es", () => {
    // Pedir «su teléfono» sin familiar sería un aviso que no se puede
    // cerrar: no hay a quién ponerle teléfono.
    expect(campos(VACIA)).toContain("familiarResponsable");
    expect(campos(VACIA)).not.toContain("telefonoDelFamiliar");
  });
});

describe("alta-minima · la ficha completa", () => {
  it("no le falta NADA, y entonces no se pinta ningún aviso", () => {
    expect(datosQueFaltan(COMPLETA)).toEqual([]);
    expect(estadoDeLaFicha(COMPLETA)).toEqual({
      faltan: [],
      incompleta: false,
      conImprescindibles: false,
    });
  });

  it("un apellido en blanco NO cuenta como apellido", () => {
    // Lo que no se sabe va NULL, no en blanco; pero el espacio llega
    // igual desde un input, y «   » no es un apellido.
    expect(campos({ ...COMPLETA, lastName: "   " })).toEqual(["apellidos"]);
  });
});

describe("alta-minima · el grado depende de la PLAZA", () => {
  it("CONCERTADA sin grado es IMPRESCINDIBLE · sin grado no se factura", () => {
    const f = { ...COMPLETA, placeType: "CONCERTADA", dependencyGrade: null };
    expect(pesoDe(f, "gradoReconocido")).toBe("IMPRESCINDIBLE");
    expect(estadoDeLaFicha(f).conImprescindibles).toBe(true);
  });

  it("PRIVADA sin grado es RECOMENDABLE", () => {
    const f = { ...COMPLETA, placeType: "PRIVADA", dependencyGrade: null };
    expect(pesoDe(f, "gradoReconocido")).toBe("RECOMENDABLE");
    expect(estadoDeLaFicha(f).conImprescindibles).toBe(false);
  });

  it("TEMPORAL sin grado es RECOMENDABLE", () => {
    const f = { ...COMPLETA, placeType: "TEMPORAL", dependencyGrade: null };
    expect(pesoDe(f, "gradoReconocido")).toBe("RECOMENDABLE");
  });

  it("SIN plaza todavía, el grado se queda en RECOMENDABLE", () => {
    // Y sube solo el día que la dirección ponga «concertada». Lo
    // contrario —asumir lo peor— pondría un imprescindible rojo en las
    // 43 fichas del primer día por un dato que depende de otro que
    // tampoco está.
    const f = { ...COMPLETA, placeType: null, dependencyGrade: null };
    expect(pesoDe(f, "gradoReconocido")).toBe("RECOMENDABLE");
    expect(pesoDe(f, "tipoDePlaza")).toBe("IMPRESCINDIBLE");
  });

  it("con grado, la plaza concertada no añade nada", () => {
    expect(campos({ ...COMPLETA, placeType: "CONCERTADA" })).toEqual([]);
  });
});

describe("alta-minima · el plan de cuidados", () => {
  it("sin plan falta, y es IMPRESCINDIBLE", () => {
    const f = { ...COMPLETA, tienePlan: false };
    expect(campos(f)).toEqual(["planDeCuidados"]);
    expect(pesoDe(f, "planDeCuidados")).toBe("IMPRESCINDIBLE");
  });

  it("sin NIVEL faltan los dos: el nivel y el plan", () => {
    // Y en ese orden: sin nivel no hay plantilla que cargar (decisión 5),
    // así que el nivel es lo que hay que poner primero.
    const f = { ...COMPLETA, dependencyLevel: null, tienePlan: false };
    expect(campos(f)).toEqual(["nivelDeDependencia", "planDeCuidados"]);
  });
});

describe("alta-minima · lo cifrado se cuenta sin descifrarlo", () => {
  it("con DNI presente no falta, y la función no ve el valor", () => {
    // `tieneDni` es un booleano: lo que entra aquí es «la columna
    // cifrada tiene algo», no el DNI. Es lo que permite contar lo que
    // falta en los 43 sin abrir la clave del centro.
    expect(campos({ ...COMPLETA, tieneDni: true, tieneNss: true })).toEqual([]);
    expect(campos({ ...COMPLETA, tieneDni: false })).toEqual(["dni"]);
    expect(pesoDe({ ...COMPLETA, tieneNss: false }, "nss")).toBe("RECOMENDABLE");
  });
});

describe("alta-minima · el familiar y su teléfono", () => {
  it("con nombre y SIN teléfono, lo que falta es el teléfono", () => {
    const f = { ...COMPLETA, responsiblePhone: null };
    expect(campos(f)).toEqual(["telefonoDelFamiliar"]);
    expect(pesoDe(f, "telefonoDelFamiliar")).toBe("IMPRESCINDIBLE");
  });

  it("sin nombre, el teléfono no se pide aunque también falte", () => {
    const f = { ...COMPLETA, responsibleName: null, responsiblePhone: null };
    expect(campos(f)).toEqual(["familiarResponsable"]);
  });
});

describe("alta-minima · el resumen del centro", () => {
  it("cuenta fichas y datos, no residentes", () => {
    // El caso de Jardín de Gredos reducido: tres completas, dos a las que
    // les falta algo.
    const r = resumenDeFichas([
      datosQueFaltan(COMPLETA),
      datosQueFaltan(COMPLETA),
      datosQueFaltan(COMPLETA),
      datosQueFaltan({ ...COMPLETA, tieneDni: false }),
      datosQueFaltan({ ...COMPLETA, tieneNss: false, birthdate: null }),
    ]);
    expect(r).toEqual({
      total: 5,
      incompletas: 2,
      datosPendientes: 3,
      conImprescindibles: 1,
    });
  });

  it("un centro entero sin empezar: 43 fichas vacías", () => {
    const r = resumenDeFichas(Array.from({ length: 43 }, () => datosQueFaltan(VACIA)));
    expect(r.total).toBe(43);
    expect(r.incompletas).toBe(43);
    expect(r.conImprescindibles).toBe(43);
    expect(r.datosPendientes).toBe(43 * 11);
  });

  it("un centro completo no tiene nada pendiente", () => {
    expect(resumenDeFichas([datosQueFaltan(COMPLETA)])).toEqual({
      total: 1,
      incompletas: 0,
      datosPendientes: 0,
      conImprescindibles: 0,
    });
  });

  it("y un centro sin residentes no es un centro incompleto", () => {
    expect(resumenDeFichas([])).toEqual({
      total: 0,
      incompletas: 0,
      datosPendientes: 0,
      conImprescindibles: 0,
    });
  });
});
