// B-reservas-mostrador F3 · la fecha de nacimiento con máscara.
//
// El `<input type="date">` del AP11 abre el calendario en el mes actual y una
// fecha de nacimiento está treinta o cuarenta años atrás. Se cambia por
// dd/mm/aaaa con teclado numérico. Aquí se fija lo que hace el parser, que es
// lo único que puede mandarle algo raro a la API.

import { describe, expect, it } from "vitest";

import {
  aplicarMascara,
  esFechaMala,
  formatearDesdeIso,
  parsearFecha,
} from "../src/lib/birthdate-mask.js";

// Martes 15-09-2026. Fijo, para que "fecha futura" no dependa del día del CI.
const HOY = new Date("2026-09-15T10:00:00.000Z");

describe("la máscara coloca las barras según se teclea", () => {
  it("va poniendo las barras sola", () => {
    expect(aplicarMascara("")).toBe("");
    expect(aplicarMascara("0")).toBe("0");
    expect(aplicarMascara("07")).toBe("07");
    expect(aplicarMascara("073")).toBe("07/3");
    expect(aplicarMascara("0703")).toBe("07/03");
    expect(aplicarMascara("07031")).toBe("07/03/1");
    expect(aplicarMascara("07031961")).toBe("07/03/1961");
  });

  it("da igual cómo venga: barras, guiones o pegado desde otro sitio", () => {
    expect(aplicarMascara("07/03/1961")).toBe("07/03/1961");
    expect(aplicarMascara("07-03-1961")).toBe("07/03/1961");
    expect(aplicarMascara("7 3 1961")).toBe("73/19/61");
  });

  it("no se traga más de ocho dígitos", () => {
    expect(aplicarMascara("070319611234")).toBe("07/03/1961");
  });

  it("borrar la barra no deja el campo atascado", () => {
    // El usuario borra hacia atrás: "07/03/1" → "07/03/" → "07/03" → "07/0"
    expect(aplicarMascara("07/03/")).toBe("07/03");
    expect(aplicarMascara("07/0")).toBe("07/0");
  });
});

describe("la ficha arranca con la fecha que ya había", () => {
  it("YYYY-MM-DD → dd/mm/aaaa", () => {
    expect(formatearDesdeIso("1961-03-07")).toBe("07/03/1961");
  });

  it("sin fecha, el campo arranca vacío", () => {
    expect(formatearDesdeIso(null)).toBe("");
    expect(formatearDesdeIso(undefined)).toBe("");
    expect(formatearDesdeIso("")).toBe("");
    expect(formatearDesdeIso("1961-03-07T00:00:00Z")).toBe("");
  });
});

describe("el parser manda a la API un YYYY-MM-DD o no manda nada", () => {
  it("una fecha buena sale en el formato de la API", () => {
    expect(parsearFecha("07/03/1961", HOY)).toEqual({ iso: "1961-03-07" });
    expect(parsearFecha("01/01/1900", HOY)).toEqual({ iso: "1900-01-01" });
  });

  it("el campo vacío NO es un error: la fecha es opcional", () => {
    expect(parsearFecha("", HOY)).toEqual({ vacio: true });
    expect(parsearFecha("   ", HOY)).toEqual({ vacio: true });
  });

  it("a medio escribir avisa, pero con la frase de «sigue»", () => {
    const r = parsearFecha("07/03/19", HOY);
    expect(esFechaMala(r)).toBe(true);
    expect((r as { error: string }).error).toContain("dd/mm/aaaa");
  });

  it("el 31 de febrero no existe, y lo dice CON EL NOMBRE DEL MES", () => {
    // «El 02 no tiene 31 días» es una frase de programador: hay que traducir
    // el 02 antes de entenderla, y eso no se hace con una clienta delante.
    const r = parsearFecha("31/02/1990", HOY);
    expect(esFechaMala(r)).toBe(true);
    expect((r as { error: string }).error).toBe("Febrero no tiene 31 días.");
  });

  it("y cada mes dice el suyo", () => {
    expect((parsearFecha("31/04/1990", HOY) as { error: string }).error).toBe(
      "Abril no tiene 31 días.",
    );
    expect((parsearFecha("31/09/1990", HOY) as { error: string }).error).toBe(
      "Septiembre no tiene 31 días.",
    );
  });

  it("el 30 de febrero tampoco, ni el 31 de abril", () => {
    expect(esFechaMala(parsearFecha("30/02/1990", HOY))).toBe(true);
    expect(esFechaMala(parsearFecha("31/04/1990", HOY))).toBe(true);
  });

  it("pero el 29 de febrero de un bisiesto SÍ", () => {
    expect(parsearFecha("29/02/2000", HOY)).toEqual({ iso: "2000-02-29" });
    expect(parsearFecha("29/02/1996", HOY)).toEqual({ iso: "1996-02-29" });
    expect(esFechaMala(parsearFecha("29/02/1999", HOY))).toBe(true);
  });

  it("un mes que no existe se dice como mes, no como fecha rara", () => {
    const r = parsearFecha("07/13/1961", HOY);
    expect(esFechaMala(r)).toBe(true);
    expect((r as { error: string }).error).toContain("01 al 12");
    expect(esFechaMala(parsearFecha("07/00/1961", HOY))).toBe(true);
  });

  it("el día 00 tampoco cuela", () => {
    expect(esFechaMala(parsearFecha("00/03/1961", HOY))).toBe(true);
  });

  it("una fecha futura se rechaza", () => {
    const r = parsearFecha("16/09/2026", HOY);
    expect(esFechaMala(r)).toBe(true);
    expect((r as { error: string }).error).toContain("todavía no ha llegado");
    expect(esFechaMala(parsearFecha("01/01/2030", HOY))).toBe(true);
  });

  it("HOY sí vale: alguien puede cumplir años hoy", () => {
    expect(parsearFecha("15/09/2026", HOY)).toEqual({ iso: "2026-09-15" });
  });

  it("un dedazo en el año se dice como año", () => {
    const r = parsearFecha("07/03/1061", HOY);
    expect(esFechaMala(r)).toBe(true);
    expect((r as { error: string }).error).toContain("1061");
  });

  it("el redondeo de fin de mes NO se cuela como fecha buena", () => {
    // El fallo clásico: `new Date(1990, 1, 31)` da el 3 de marzo y se guarda
    // una fecha que el usuario no escribió.
    const r = parsearFecha("31/02/1990", HOY);
    expect("iso" in r).toBe(false);
  });
});
