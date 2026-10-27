// personal-1 (decisión 3) · LA IMPORTACIÓN DEL CSV.
//
// Los seis casos que el prompt pide cerrar van marcados con «[prompt]»:
//
//   · 21 filas sobre 21 fichas que sólo tienen el nombre completo →
//     completa 21, crea 0;
//   · repetirlo → 0 cambios;
//   · una celda vacía no borra;
//   · una fila con fecha `2026-10-01` → error de fila legible;
//   · BOM y `;` funcionan;
//   · 5 000 filas → límite y mensaje.
//
// Y **ni un dato de un cliente en el repo**: los nombres son inventados.
// El CSV de Jardín de Gredos no se commitea. Lo que se reproduce aquí es
// su FORMA —nombre completo en una sola columna de la ficha, dos columnas
// en el fichero, mayúsculas, dobles espacios— no su contenido.

import { describe, expect, it } from "vitest";

import {
  COLUMNAS_DE_PERSONAL,
  CsvDePersonalInvalido,
  MAX_FILAS_CSV,
  claveDeFicha,
  claveDeFila,
  contratoDeCsv,
  fechaDeCsv,
  jornadaDeCsv,
  leerCsvDePersonal,
  planDeImportacion,
  planParaLaPantalla,
  type CategoriaConocida,
  type FichaExistente,
} from "../src/index.js";

const CATALOGO: CategoriaConocida[] = [
  { id: "cat-aux", code: "AUXILIAR", name: "Gerocultora / auxiliar" },
  { id: "cat-due", code: "DUE", name: "Enfermería (DUE)" },
];

/** Una ficha como las que F1 creó: el nombre completo dentro de `name`. */
function fichaSoloConNombre(nombreCompleto: string, i: number): FichaExistente {
  return {
    employeeId: `emp-${i}`,
    name: nombreCompleto,
    lastName: null,
    tieneDni: false,
    tieneAfiliacion: false,
    categoryId: null,
    weeklyMinutes: null,
    hiredOn: null,
    contractKind: null,
    contractEndsOn: null,
    phone: null,
    email: null,
  };
}

// ── Los conversores ───────────────────────────────────────────────────

describe("las columnas que se entienden", () => {
  it("son once", () => {
    expect(COLUMNAS_DE_PERSONAL).toHaveLength(11);
  });

  it("[prompt] las fechas son dd/mm/aaaa y nada más", () => {
    expect(fechaDeCsv("01/06/2026")).toBe("2026-06-01");
    expect(fechaDeCsv("1/6/2026")).toBe("2026-06-01");
    // El formato ISO **no** se acepta: el prompt lo pide como error de fila
    // porque un fichero mezclando los dos formatos es un fichero en el que
    // «01/06» puede ser junio o enero, y adivinarlo escribe una fecha
    // falsa en la ficha de una persona.
    expect(fechaDeCsv("2026-10-01")).toBeNull();
    expect(fechaDeCsv("31/02/2026")).toBeNull();
    expect(fechaDeCsv("no sé")).toBeNull();
  });

  it("la jornada admite coma y punto, y tope en sesenta horas", () => {
    expect(jornadaDeCsv("37,5")).toBe(2250);
    expect(jornadaDeCsv("37.5")).toBe(2250);
    expect(jornadaDeCsv("40 h")).toBe(2400);
    expect(jornadaDeCsv("0")).toBeNull();
    expect(jornadaDeCsv("61")).toBeNull();
    expect(jornadaDeCsv("media jornada")).toBeNull();
  });

  it("el tipo de contrato entiende lo que un Excel escribe de verdad", () => {
    expect(contratoDeCsv("Indefinido")).toBe("INDEFINIDO");
    expect(contratoDeCsv("FIJO")).toBe("INDEFINIDO");
    expect(contratoDeCsv("temporal")).toBe("TEMPORAL");
    expect(contratoDeCsv("Eventual")).toBe("TEMPORAL");
    expect(contratoDeCsv("interinidad")).toBe("TEMPORAL");
    expect(contratoDeCsv("lo que sea")).toBeNull();
  });
});

// ── Leer ──────────────────────────────────────────────────────────────

describe("leerCsvDePersonal", () => {
  it("[prompt] el BOM y el `;` funcionan", () => {
    // El BOM es lo que pone Excel al exportar «CSV UTF-8», y sin quitarlo
    // la primera cabecera sería «﻿nombre» y la columna del nombre no
    // se reconocería — o sea: el fichero entero sin importar.
    const csv = leerCsvDePersonal(
      "﻿nombre;apellidos;jornada_semanal_h\nAna;Soler;37,5\n",
    );
    expect(csv.separador).toBe(";");
    expect(csv.filas).toHaveLength(1);
    expect(csv.filas[0]!.nombre).toBe("Ana");
    expect(csv.filas[0]!.apellidos).toBe("Soler");
    expect(csv.filas[0]!.minutosSemanales).toBe(2250);
  });

  it("y la coma también, cuando es lo que el fichero usa", () => {
    const csv = leerCsvDePersonal("nombre,apellidos\nAna,Soler\n");
    expect(csv.separador).toBe(",");
    expect(csv.filas[0]!.apellidos).toBe("Soler");
  });

  it("respeta las comillas: una coma dentro de una celda no parte nada", () => {
    const csv = leerCsvDePersonal('nombre,apellidos\n"Ana, Mª","Soler Ruiz"\n');
    expect(csv.filas[0]!.nombre).toBe("Ana, Mª");
    expect(csv.filas[0]!.apellidos).toBe("Soler Ruiz");
  });

  it("aguanta \\r\\n y líneas en blanco en medio", () => {
    const csv = leerCsvDePersonal(
      "nombre;apellidos\r\nAna;Soler\r\n\r\nBea;Ruiz\r\n",
    );
    expect(csv.filas.map((f) => f.nombre)).toEqual(["Ana", "Bea"]);
  });

  it("entiende los alias que un Excel español escribe", () => {
    const csv = leerCsvDePersonal(
      "Nombre;Apellidos;DNI;Nº afiliación SS;Categoría profesional;Horas semana;Fecha de alta;Tipo de contrato;Teléfono;Correo\n" +
        "Ana;Soler;12345678Z;281234567890;AUXILIAR;37,5;01/06/2026;temporal;600111222;ana@x.es\n",
    );
    expect(csv.columnas).toEqual([
      "nombre",
      "apellidos",
      "dni_nie",
      "num_afiliacion_ss",
      "categoria",
      "jornada_semanal_h",
      "fecha_alta",
      "tipo_contrato",
      "telefono",
      "email",
    ]);
    expect(csv.filas[0]!.dniNie).toBe("12345678Z");
    expect(csv.filas[0]!.afiliacion).toBe("281234567890");
    expect(csv.filas[0]!.fechaDeAlta).toBe("2026-06-01");
    expect(csv.filas[0]!.tipoDeContrato).toBe("TEMPORAL");
  });

  it("las columnas que no conoce se ignoran en silencio", () => {
    const csv = leerCsvDePersonal("nombre;talla de bata;n\u00ba de taquilla\nAna;M;14\n");
    expect(csv.columnas).toEqual(["nombre"]);
    expect(csv.filas).toHaveLength(1);
    expect(csv.filas[0]!.nombre).toBe("Ana");
  });

  it("la cabecera sin «nombre» se rechaza y lo dice", () => {
    expect(() => leerCsvDePersonal("apellidos;dni\nSoler;X\n")).toThrow(
      CsvDePersonalInvalido,
    );
    expect(() => leerCsvDePersonal("apellidos;dni\nSoler;X\n")).toThrow(
      /columna «nombre»/,
    );
  });

  it("un fichero vacío se rechaza y lo dice", () => {
    expect(() => leerCsvDePersonal("\n\n")).toThrow(/está vacío/);
  });

  it("[prompt] 5 000 filas: límite y mensaje", () => {
    const texto =
      "nombre\n" +
      Array.from({ length: 5000 }, (_, i) => `Persona ${i}`).join("\n") +
      "\n";
    expect(() => leerCsvDePersonal(texto)).toThrow(CsvDePersonalInvalido);
    expect(() => leerCsvDePersonal(texto)).toThrow(
      new RegExp(`5000 filas y de una vez caben ${MAX_FILAS_CSV}`),
    );
  });

  it("[prompt] una fila con fecha ISO da un error de FILA legible", () => {
    // Y el resto del fichero entra: veinte fichas buenas y una fecha mal
    // escrita importan veinte y señalan la fila.
    const csv = leerCsvDePersonal(
      "nombre;fecha_alta\nAna;01/06/2026\nBea;2026-10-01\nCarmen;15/09/2026\n",
    );
    expect(csv.filas.map((f) => f.nombre)).toEqual(["Ana", "Carmen"]);
    expect(csv.errores).toHaveLength(1);
    expect(csv.errores[0]!.linea).toBe(3);
    expect(csv.errores[0]!.mensaje).toBe(
      "Fila 3: la fecha de alta «2026-10-01» no está en formato dd/mm/aaaa. Así, «01/06/2026».",
    );
  });

  it("una fila sin nombre es un error de fila, no del fichero", () => {
    const csv = leerCsvDePersonal("nombre;apellidos\n;Soler\nBea;Ruiz\n");
    expect(csv.filas.map((f) => f.nombre)).toEqual(["Bea"]);
    expect(csv.errores[0]!.mensaje).toContain("no trae nombre");
  });

  it("una fecha de fin con contrato indefinido es un error de fila", () => {
    const csv = leerCsvDePersonal(
      "nombre;tipo_contrato;fecha_fin\nAna;indefinido;01/12/2026\n",
    );
    expect(csv.filas).toHaveLength(0);
    expect(csv.errores[0]!.mensaje).toContain("sólo de los temporales");
  });

  it("y una fecha de fin anterior al alta, también", () => {
    const csv = leerCsvDePersonal(
      "nombre;tipo_contrato;fecha_alta;fecha_fin\nAna;temporal;01/06/2026;01/05/2026\n",
    );
    expect(csv.errores[0]!.mensaje).toContain("anterior a la de alta");
  });

  it("distingue «la columna no venía» de «venía vacía»", () => {
    const sinColumna = leerCsvDePersonal("nombre\nAna\n");
    expect(sinColumna.filas[0]!.telefono).toBeUndefined();
    const vacia = leerCsvDePersonal("nombre;telefono\nAna;\n");
    expect(vacia.filas[0]!.telefono).toBeNull();
  });
});

// ── Casar ─────────────────────────────────────────────────────────────

describe("las claves con las que se casa", () => {
  it("la de una ficha con el nombre completo dentro y la del CSV coinciden", () => {
    // Es el caso de Jardín de Gredos y la razón de que la clave se arme
    // con `name + lastName`.
    expect(claveDeFicha({ name: "ABEL RAMOS DOBLADO", lastName: null })).toBe(
      claveDeFila({ linea: 2, nombre: "Abel", apellidos: "Ramos Doblado" }),
    );
  });

  it("y siguen coincidiendo DESPUÉS de completarla, ya partida en dos", () => {
    expect(claveDeFicha({ name: "Abel", lastName: "Ramos Doblado" })).toBe(
      claveDeFila({ linea: 2, nombre: "Abel", apellidos: "Ramos Doblado" }),
    );
  });

  it("sin tildes, sin mayúsculas y sin dobles espacios", () => {
    expect(
      claveDeFila({ linea: 2, nombre: "Mª  ÁNGELES", apellidos: "López " }),
    ).toBe(claveDeFila({ linea: 9, nombre: "mª ángeles", apellidos: "lopez" }));
  });
});

describe("planDeImportacion", () => {
  /** 21 nombres inventados, como el listado que llega el primer día. */
  const VEINTIUNO = [
    "ABEL RAMOS DOBLADO",
    "ANA SOLER RUIZ",
    "BEATRIZ MORENO LARA",
    "CARMEN GIL PASTOR",
    "DOLORES NAVAS PEÑA",
    "ELENA BRAVO SANZ",
    "FELIPE OTERO MAS",
    "GLORIA ARIAS LEON",
    "HUGO VEGA MOLINA",
    "IRENE CANO SUAREZ",
    "JAVIER PRIETO ABAD",
    "LAURA NIETO CASAS",
    "MANUEL ROJO ESTEVEZ",
    "NURIA BLANCO TOMAS",
    "OSCAR LARA FUENTES",
    "PILAR SEGURA MOYA",
    "RAQUEL DIAZ ROMAN",
    "SERGIO IBAÑEZ MUÑOZ",
    "TERESA PARRA CALVO",
    "VICTOR LOPEZ ARCE",
    "YOLANDA MESA GALAN",
  ];

  /** El CSV que esos 21 nombres producen, con nombre y apellidos partidos. */
  function csvDeLos21(): string {
    const filas = VEINTIUNO.map((completo) => {
      const [nombre, ...apellidos] = completo.split(" ");
      return `${nombre};${apellidos.join(" ")};37,5;01/06/2026;indefinido`;
    });
    return (
      "nombre;apellidos;jornada_semanal_h;fecha_alta;tipo_contrato\n" +
      filas.join("\n") +
      "\n"
    );
  }

  it("[prompt] 21 filas sobre 21 fichas con sólo el nombre: completa 21, crea 0", () => {
    const existentes = VEINTIUNO.map(fichaSoloConNombre);
    const plan = planDeImportacion(leerCsvDePersonal(csvDeLos21()), existentes, CATALOGO);
    expect(plan.resumen).toEqual({
      completar: 21,
      sinCambios: 0,
      crear: 0,
      errores: 0,
    });
    expect(plan.errores).toEqual([]);
    // Y la primera dice con quién casa y qué le va a hacer: partir el
    // nombre en dos y poner la jornada, el alta y el contrato.
    const abel = plan.acciones[0]!;
    expect(abel.casaCon).toBe("ABEL RAMOS DOBLADO");
    expect(abel.cambios.map((c) => c.campo).sort()).toEqual([
      "apellidos",
      "fechaDeAlta",
      "jornadaSemanal",
      "nombre",
      "tipoDeContrato",
    ]);
    // Y el nombre se guarda **como viene**: «ABEL», no «Abel». Es la
    // decisión 7 de alta-minima aplicada aquí: el listado está en
    // mayúsculas porque el Excel del centro lo está, y convertirlo al
    // guardar perdería el dato que coincide con el papel que la dirección
    // tiene delante. Para enseñarlo ya hay `formatoDeNombre`.
    expect(abel.cambios.find((c) => c.campo === "nombre")).toEqual({
      campo: "nombre",
      antes: "ABEL RAMOS DOBLADO",
      despues: "ABEL",
    });
  });

  it("[prompt] repetirlo: 0 cambios", () => {
    // Las fichas, ya completadas por la primera pasada.
    const completas: FichaExistente[] = VEINTIUNO.map((completo, i) => {
      const [nombre, ...apellidos] = completo.split(" ");
      return {
        ...fichaSoloConNombre(completo, i),
        name: nombre!,
        lastName: apellidos.join(" "),
        weeklyMinutes: 2250,
        hiredOn: "2026-06-01",
        contractKind: "INDEFINIDO",
      };
    });
    const plan = planDeImportacion(leerCsvDePersonal(csvDeLos21()), completas, CATALOGO);
    expect(plan.resumen).toEqual({
      completar: 0,
      sinCambios: 21,
      crear: 0,
      errores: 0,
    });
    expect(plan.acciones.every((a) => a.cambios.length === 0)).toBe(true);
  });

  it("quien no casa con nadie se CREA", () => {
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;apellidos\nZoe;Marín\n"),
      [fichaSoloConNombre("ANA SOLER RUIZ", 1)],
      CATALOGO,
    );
    expect(plan.resumen.crear).toBe(1);
    expect(plan.acciones[0]!.que).toBe("CREAR");
    expect(plan.acciones[0]!.employeeId).toBeNull();
  });

  it("[prompt] una celda vacía NO borra lo que ya hay", () => {
    const con: FichaExistente = {
      ...fichaSoloConNombre("Ana", 1),
      lastName: "Soler",
      phone: "600111222",
      email: "ana@x.es",
      weeklyMinutes: 2400,
    };
    const plan = planDeImportacion(
      leerCsvDePersonal(
        "nombre;apellidos;telefono;email;jornada_semanal_h\nAna;Soler;;;\n",
      ),
      [con],
      CATALOGO,
    );
    expect(plan.acciones[0]!.que).toBe("SIN_CAMBIOS");
    expect(plan.acciones[0]!.cambios).toEqual([]);
  });

  it("y tampoco una columna que no venga", () => {
    const con: FichaExistente = {
      ...fichaSoloConNombre("Ana", 1),
      lastName: "Soler",
      phone: "600111222",
    };
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;apellidos\nAna;Soler\n"),
      [con],
      CATALOGO,
    );
    expect(plan.acciones[0]!.cambios).toEqual([]);
  });

  it("un DNI que ya está NO se sobrescribe", () => {
    // Para saber si el del fichero es otro habría que descifrar el que
    // hay, y descifrar 21 DNI para una vista previa es sacar a pasear
    // veintiuna claves por nada.
    const con: FichaExistente = {
      ...fichaSoloConNombre("Ana", 1),
      lastName: "Soler",
      tieneDni: true,
    };
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;apellidos;dni\nAna;Soler;12345678Z\n"),
      [con],
      CATALOGO,
    );
    expect(plan.acciones[0]!.cambios).toEqual([]);
  });

  it("y uno que falta se pone, con el valor OCULTO en el cambio", () => {
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;apellidos;dni\nAna;Soler;12345678Z\n"),
      [{ ...fichaSoloConNombre("Ana", 1), lastName: "Soler" }],
      CATALOGO,
    );
    const cambio = plan.acciones[0]!.cambios.find((c) => c.campo === "dni")!;
    expect(cambio.despues).toBe("•••");
  });

  it("y el DNI en claro NO sale del servidor", () => {
    // Lo encontró este test y no una revisión: el plan lleva la fila cruda
    // porque el servidor la necesita para aplicar, y la fila cruda lleva
    // el DNI. Devolver el plan tal cual mandaría veintiún DNI al navegador
    // para pintar una tabla que no los enseña.
    const plan = planDeImportacion(
      leerCsvDePersonal(
        "nombre;apellidos;dni;num_afiliacion_ss\nAna;Soler;12345678Z;281234567890\n",
      ),
      [{ ...fichaSoloConNombre("Ana", 1), lastName: "Soler" }],
      CATALOGO,
    );
    // El plan del servidor SÍ lo lleva: es lo que aplica.
    expect(JSON.stringify(plan)).toContain("12345678Z");
    // Lo que va a la pantalla, no.
    const paraLaPantalla = JSON.stringify(planParaLaPantalla(plan));
    expect(paraLaPantalla).not.toContain("12345678Z");
    expect(paraLaPantalla).not.toContain("281234567890");
    expect(paraLaPantalla).toContain("•••");
  });

  it("la categoría casa por código Y por nombre", () => {
    const porCodigo = planDeImportacion(
      leerCsvDePersonal("nombre;categoria\nAna;AUXILIAR\n"),
      [],
      CATALOGO,
    );
    expect(porCodigo.acciones[0]!.categoryId).toBe("cat-aux");
    const porNombre = planDeImportacion(
      leerCsvDePersonal("nombre;categoria\nAna;Enfermería (DUE)\n"),
      [],
      CATALOGO,
    );
    expect(porNombre.acciones[0]!.categoryId).toBe("cat-due");
  });

  it("una categoría que no está en el catálogo es un error que dice qué hacer", () => {
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;categoria\nAna;Fisio de tarde\n"),
      [],
      CATALOGO,
    );
    expect(plan.acciones[0]!.que).toBe("ERROR");
    expect(plan.acciones[0]!.motivo).toContain("no está en el catálogo");
    expect(plan.acciones[0]!.motivo).toContain("Categorías");
  });

  it("dos filas con el mismo nombre: la segunda es un error que nombra la primera", () => {
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;apellidos\nAna;Soler\nANA;SOLER\n"),
      [],
      CATALOGO,
    );
    expect(plan.resumen.crear).toBe(1);
    expect(plan.resumen.errores).toBe(1);
    expect(plan.errores[0]!.mensaje).toContain("ya venía en la fila 2");
  });

  it("y dos fichas con el mismo nombre en la casa: no se elige a ciegas", () => {
    const plan = planDeImportacion(
      leerCsvDePersonal("nombre;apellidos;telefono\nAna;Soler;600111222\n"),
      [
        { ...fichaSoloConNombre("Ana", 1), lastName: "Soler" },
        { ...fichaSoloConNombre("ANA", 2), lastName: "SOLER" },
      ],
      CATALOGO,
    );
    expect(plan.acciones[0]!.que).toBe("ERROR");
    expect(plan.acciones[0]!.motivo).toContain("más de una ficha");
  });
});
