// cogecop-1 · la traducción de la copia, sin base de datos.
//
// Lo que NO está aquí y está en `cogecop.e2e.ts`: que correrlo dos veces
// no duplique, que lo escrito no se pueda editar y que la historia lo
// enseñe. Eso lo tiene que decir el MOTOR, no un Prisma falso.
//
// NI UN DATO REAL. Todo sale del generador de `src/cogecop/generador.ts`,
// que marca con un centinela cada valor que en la copia de verdad sería
// de una persona.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FICHEROS_DEL_EXPORT,
  validarFilas,
} from "../src/cogecop/export-esquema.js";
import {
  MARCA_DEL_CENTINELA,
  generarExport,
} from "../src/cogecop/generador.js";
import {
  camposDeLaNota,
  cuerpoDeLaVisita,
  fechaValida,
  idExternoDePaciente,
  pestanaDeLaVisita,
  telefonoE164,
} from "../src/cogecop/importar.js";
import { informe, leerExport } from "../src/scripts/importar-cogecop.js";

const HOY = new Date(Date.UTC(2026, 9, 29));

// ── El generador y el esquema, en la misma forma ──────────────────────

describe("el generador produce EXACTAMENTE la forma del export", () => {
  const falso = generarExport();

  for (const f of FICHEROS_DEL_EXPORT) {
    it(`${f.nombre}.json pasa su esquema`, () => {
      const filas = (falso.export as unknown as Record<string, unknown[]>)[
        f.nombre
      ];
      expect(filas, `el generador no produce ${f.nombre}`).toBeDefined();
      expect(() => validarFilas(f.nombre, f.fila, filas)).not.toThrow();
    });
  }

  it("están los trece ficheros y ninguno vacío de los obligatorios", () => {
    for (const f of FICHEROS_DEL_EXPORT) {
      const filas = (falso.export as unknown as Record<string, unknown[]>)[
        f.nombre
      ];
      if (f.obligatorio) expect(filas?.length ?? 0, f.nombre).toBeGreaterThan(0);
    }
  });

  it("es DETERMINISTA: la misma semilla da lo mismo", () => {
    expect(generarExport({ semilla: 3 })).toEqual(generarExport({ semilla: 3 }));
  });

  it("marca como centinela todo lo que sería dato de persona", () => {
    const falso2 = generarExport();
    expect(falso2.centinelas.length).toBeGreaterThan(30);
    for (const c of falso2.centinelas) {
      expect(c).toContain(MARCA_DEL_CENTINELA);
    }
  });

  it("un esquema que pide una columna que no está PARA, y dice dónde", () => {
    expect(() =>
      validarFilas("pacientes", FICHEROS_DEL_EXPORT[0]!.fila, [
        { ...falso.export.pacientes[0], nombre: undefined },
      ]),
    ).toThrowError(/pacientes\.json, fila 1: nombre/);
  });
});

// ── EL CENTINELA: la salida no lleva ni un dato de nadie ──────────────

describe("la salida del script no lleva ni un dato de persona", () => {
  it("el informe de recuentos no contiene ningún centinela", () => {
    const falso = generarExport({ pacientes: 8 });
    const recuento = recuentoDeTodo(falso.export);
    const texto = informe(recuento, true);
    // Lo barato primero: la marca del centinela no está en ningún sitio.
    expect(texto).not.toContain(MARCA_DEL_CENTINELA);
    // Y uno a uno, para que el mensaje diga cuál se escapó.
    for (const c of falso.centinelas) {
      expect(texto, `el informe lleva «${c}»`).not.toContain(c);
    }
  });

  it("y sí lleva los nombres del CATÁLOGO, que es lo que hay que leer", () => {
    const falso = generarExport({ pacientes: 8 });
    const texto = informe(recuentoDeTodo(falso.export), true);
    // «Carcinoma basocelular» es catálogo del Colegio y no es de nadie:
    // es justo lo que la podóloga tiene que ver para decidir si merece
    // una lesión nueva en la V3.
    expect(texto).toContain("Carcinoma basocelular");
    expect(texto).toContain("EN SECO");
  });
});

/** Traduce el export entero sin base de datos, sólo para contar. */
function recuentoDeTodo(ex: ReturnType<typeof generarExport>["export"]) {
  const recuento = {
    pacientes: { enElFichero: ex.pacientes.length, nuevos: 0, yaEstaban: 0 },
    visitas: { enElFichero: ex.visitas.length, nuevas: 0, yaEstaban: 0 },
    marcas: { total: 0, conZona: 0, sinZona: 0 },
    sinTraducir: {} as Record<string, number>,
    patologiasDesconocidas: 0,
    fechasImposibles: { nacimiento: 0, otras: 0 },
    difuntos: 0,
    sinTelefono: 0,
    sinEspecialista: 0,
    textoDeOtraPestana: 0,
    sinNota: 0,
    porTipo: { quiropodia: 0, cirugia: 0, biomecanica: 0, general: 0 },
  };
  for (const v of ex.visitas) {
    cuerpoDeLaVisita({
      visita: v,
      marcas: ex.marcas_pie.filter((m) => m.idvisita === v.id),
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento,
    });
    recuento.visitas.nuevas += 1;
  }
  for (const p of ex.pacientes) {
    recuento.pacientes.nuevos += 1;
    if (p.difunto === 1) recuento.difuntos += 1;
    if (p.fechanacimiento != null && fechaValida(p.fechanacimiento, HOY) == null) {
      recuento.fechasImposibles.nacimiento += 1;
    }
    for (const otra of [p.primeravisita, p.ultimavisita]) {
      if (otra != null && fechaValida(otra, HOY) == null) {
        recuento.fechasImposibles.otras += 1;
      }
    }
    const tel =
      telefonoE164(p.telefonomovil) ??
      telefonoE164(p.telefonocasa) ??
      telefonoE164(p.telefonotrabajo);
    if (tel == null) recuento.sinTelefono += 1;
  }
  return recuento;
}

// ── El id determinista ────────────────────────────────────────────────

describe("idExternoDePaciente", () => {
  const T1 = "11111111-1111-4111-8111-111111111111";
  const T2 = "22222222-2222-4222-8222-222222222222";

  it("el mismo paciente de la misma cuenta da SIEMPRE el mismo uuid", () => {
    // El vector fijo es lo que ata la cuenta: si alguien cambia el
    // espacio de nombres o el formato del nombre, correr el script otra
    // vez duplicaría las 3.681 fichas.
    expect(idExternoDePaciente(T1, 12)).toBe(idExternoDePaciente(T1, 12));
    expect(idExternoDePaciente(T1, 12)).toBe(
      "442d77cc-443d-5373-912e-b7c25d3e6c97",
    );
  });

  it("el mismo paciente en OTRA cuenta da otro: `external_id` es único global", () => {
    expect(idExternoDePaciente(T1, 12)).not.toBe(idExternoDePaciente(T2, 12));
  });

  it("es un uuid v5 de verdad", () => {
    expect(idExternoDePaciente(T1, 1)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

// ── Los teléfonos ─────────────────────────────────────────────────────

describe("telefonoE164", () => {
  it("los tres formatos que escribe COGECOP salen iguales", () => {
    expect(telefonoE164("600 11 22 33")).toBe("+34600112233");
    expect(telefonoE164("600 112 233")).toBe("+34600112233");
    expect(telefonoE164("600112233")).toBe("+34600112233");
  });

  it("admite el prefijo ya puesto", () => {
    expect(telefonoE164("+34 600 112 233")).toBe("+34600112233");
    expect(telefonoE164("34600112233")).toBe("+34600112233");
    expect(telefonoE164("0034600112233")).toBe("+34600112233");
  });

  it("lo que NO es un teléfono es null, y entonces va a la nota", () => {
    expect(telefonoE164("hija Marisa")).toBeNull();
    expect(telefonoE164("¿?")).toBeNull();
    expect(telefonoE164("1234")).toBeNull();
    expect(telefonoE164(null)).toBeNull();
    expect(telefonoE164("")).toBeNull();
  });
});

// ── Las fechas ────────────────────────────────────────────────────────

describe("fechaValida", () => {
  it("una fecha normal entra", () => {
    expect(fechaValida("1948-03-12T00:00:00", HOY)?.toISOString()).toBe(
      "1948-03-12T00:00:00.000Z",
    );
  });

  it("las imposibles salen null, que es lo que deja `birthdate` vacío", () => {
    expect(fechaValida("1356-04-02T00:00:00", HOY)).toBeNull();
    expect(fechaValida("8018-01-01T00:00:00", HOY)).toBeNull();
    expect(fechaValida("2027-01-01T00:00:00", HOY)).toBeNull();
    expect(fechaValida("1948-02-31T00:00:00", HOY)).toBeNull();
    expect(fechaValida("no es una fecha", HOY)).toBeNull();
    expect(fechaValida(null, HOY)).toBeNull();
  });
});

// ── La visita ─────────────────────────────────────────────────────────

const VISITA_BASE = {
  id: 1,
  idpaciente: 9,
  fechavisita: "2025-03-04T00:00:00",
  quiropodia: null,
  qidespecialista: null,
  motivovisitaquiro: null,
  evolucionquiro: null,
  quiropodiadiagnostico: null,
  quiropodiarecomendacion: null,
  alertaquiro: null,
  cirugia: null,
  cidespecialista: null,
  motivovisitacirugia: null,
  evolucioncirugia: null,
  cirugiadiagnostico: null,
  cirugiarecomendacion: null,
  alertacirugia: null,
  biomecanica: null,
  bidespecialista: null,
  motivovisitabio: null,
  evolucionbio: null,
  biomecanicadiagnostico: null,
  biomecanicarecomendacion: null,
  alertabio: null,
  general: null,
};

function recuento() {
  return recuentoDeTodo({
    pacientes: [],
    visitas: [],
    marcas_pie: [],
  } as unknown as ReturnType<typeof generarExport>["export"]);
}

describe("de qué clase es una visita", () => {
  it("una pestaña se usó cuando su bandera NO ES NULA, aunque valga 0", () => {
    expect(pestanaDeLaVisita({ ...VISITA_BASE, general: 0 }).tipo).toBe(
      "general",
    );
  });

  it("la quiropodia manda sobre las demás", () => {
    expect(
      pestanaDeLaVisita({ ...VISITA_BASE, quiropodia: 1, cirugia: 1 }).tipo,
    ).toBe("quiropodia");
  });

  it("y una visita sin ninguna bandera sigue siendo una visita", () => {
    expect(pestanaDeLaVisita(VISITA_BASE).tipo).toBe("general");
  });
});

describe("cuerpoDeLaVisita", () => {
  const marca = (patologia: number, x: number, y: number, dibujo = 0) => ({
    id: 1,
    idvisita: 1,
    idquiropodiapatologia: patologia,
    idimagencolocada: dibujo,
    x_1: x - 8,
    y_1: y - 8,
    x_2: x + 8,
    y_2: y + 8,
    fecha: null,
    curado: null,
  });

  it("traduce la patología a su lesión y guarda SIEMPRE el nombre original", () => {
    const r = recuento();
    const c = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [marca(113, 136, 22)],
      tratamientos: ["Q2 QUIROPODIA COMPLETA"],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: r,
    });
    expect(c.origen).toBe("cogecop");
    expect(c.tipo).toBe("quiropodia");
    expect(c.marcas).toEqual([
      {
        dibujo: 0,
        pie: "L",
        zona: "h",
        lesion: "onicogrifosis",
        lesionOriginal: "Onicigrifosis",
        curado: null,
      },
    ]);
    expect(r.marcas).toEqual({ total: 1, conZona: 1, sinZona: 0 });
    expect(r.sinTraducir).toEqual({});
  });

  it("una patología SIN traducir guarda su nombre original y se cuenta", () => {
    const r = recuento();
    const c = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [marca(44, 136, 22)],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: r,
    });
    expect(c.marcas[0]!.lesion).toBeNull();
    expect(c.marcas[0]!.lesionOriginal).toBe("Carcinoma basocelular");
    expect(r.sinTraducir).toEqual({ "Carcinoma basocelular": 1 });
  });

  it("una marca lejos de todo centro entra sin zona y se cuenta", () => {
    const r = recuento();
    const c = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [marca(1, 183, 215, 2)],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: r,
    });
    expect(c.marcas[0]).toMatchObject({ pie: null, zona: null, lesion: "dureza" });
    expect(r.marcas.sinZona).toBe(1);
  });

  it("una patología que no está en el catálogo de 144 no revienta nada", () => {
    const r = recuento();
    const c = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [marca(999, 136, 22)],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: r,
    });
    expect(c.marcas[0]!.lesionOriginal).toBe("Patología 999 de COGECOP");
    expect(r.patologiasDesconocidas).toBe(1);
  });

  it("LA LATERALIDAD CAMBIA EL PIE de todas las marcas", () => {
    const uno = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [marca(1, 136, 22)],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: recuento(),
    });
    const otro = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [marca(1, 136, 22)],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-derecha",
      recuento: recuento(),
    });
    expect(uno.marcas[0]!.pie).toBe("L");
    expect(otro.marcas[0]!.pie).toBe("R");
  });

  it("los textos salen de SU pestaña", () => {
    const c = cuerpoDeLaVisita({
      visita: {
        ...VISITA_BASE,
        cirugia: 1,
        motivovisitacirugia: "revisión",
        cirugiadiagnostico: "uña del gordo",
        alertacirugia: 1,
      },
      marcas: [],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: recuento(),
    });
    expect(c.tipo).toBe("cirugia");
    expect(c.motivo).toBe("revisión");
    expect(c.diagnostico).toBe("uña del gordo");
    expect(c.alerta).toBe(true);
  });

  it("SIN PÉRDIDA: el texto de otra pestaña se pega al final y se cuenta", () => {
    const r = recuento();
    const c = cuerpoDeLaVisita({
      visita: {
        ...VISITA_BASE,
        quiropodia: 1,
        quiropodiarecomendacion: "quiropodia completa",
        cirugiadiagnostico: "algo de cirugía",
      },
      marcas: [],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: r,
    });
    expect(c.recomendacion).toBe(
      "quiropodia completa\n[cirugía] algo de cirugía",
    );
    expect(r.textoDeOtraPestana).toBe(1);
  });

  it("guarda las versiones con las que se tradujo", () => {
    const c = cuerpoDeLaVisita({
      visita: { ...VISITA_BASE, quiropodia: 1 },
      marcas: [],
      tratamientos: [],
      lateralidad: "izquierdo-a-la-izquierda",
      recuento: recuento(),
    });
    expect(c.mapaVersion).toBe(1);
    expect(c.lesionesVersion).toBe(2);
  });
});

// ── La nota de la ficha ───────────────────────────────────────────────

describe("camposDeLaNota", () => {
  const falso = generarExport();
  const paciente = falso.export.pacientes[0]!;

  it("lleva lo que no tiene columna propia", () => {
    const campos = camposDeLaNota({
      paciente,
      datos: falso.export,
      telefonoUsado: telefonoE164(paciente.telefonomovil),
      nacimientoValido: true,
    });
    expect(campos["Enfermedades"]).toBe(paciente.enfermedades);
    expect(campos["Alergias"]).toBe(paciente.alergias);
    expect(campos["Nº en COGECOP"]).toBe(String(paciente.historial));
    expect(campos["LOPD"]).toBe("Firmada");
    expect(campos["Fecha de nacimiento no válida"]).toBeNull();
  });

  it("un teléfono que no es un teléfono NO SE PIERDE: va a la nota", () => {
    const p4 = falso.export.pacientes[3]!;
    const campos = camposDeLaNota({
      paciente: p4,
      datos: falso.export,
      telefonoUsado: null,
      nacimientoValido: true,
    });
    expect(campos["Otros teléfonos"]).toContain(p4.telefonocasa!);
  });

  it("el difunto queda marcado", () => {
    const p3 = falso.export.pacientes[2]!;
    expect(p3.difunto).toBe(1);
    const campos = camposDeLaNota({
      paciente: p3,
      datos: falso.export,
      telefonoUsado: null,
      nacimientoValido: true,
    });
    expect(campos["Difunto"]).toMatch(/No se le manda ningún aviso/);
  });

  it("la fecha imposible se escribe TAL CUAL en la nota", () => {
    const p2 = falso.export.pacientes[1]!;
    const campos = camposDeLaNota({
      paciente: p2,
      datos: falso.export,
      telefonoUsado: null,
      nacimientoValido: false,
    });
    expect(campos["Fecha de nacimiento no válida"]).toBe("02/04/1356");
  });
});

// ── Leer la carpeta ───────────────────────────────────────────────────

describe("leerExport", () => {
  it("lee los trece y valida", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogecop-"));
    try {
      const falso = generarExport({ pacientes: 2 });
      for (const f of FICHEROS_DEL_EXPORT) {
        const filas = (falso.export as unknown as Record<string, unknown[]>)[
          f.nombre
        ];
        await writeFile(join(dir, `${f.nombre}.json`), JSON.stringify(filas));
      }
      const leido = await leerExport(dir);
      expect(leido.pacientes).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("si falta uno OBLIGATORIO para, y dice cuál", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogecop-"));
    try {
      await expect(leerExport(dir)).rejects.toThrow(/falta pacientes\.json/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("y si falta uno de los que sólo ponen nombres, sigue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogecop-"));
    try {
      const falso = generarExport({ pacientes: 2 });
      for (const f of FICHEROS_DEL_EXPORT) {
        if (f.nombre === "cat_profesion") continue;
        const filas = (falso.export as unknown as Record<string, unknown[]>)[
          f.nombre
        ];
        await writeFile(join(dir, `${f.nombre}.json`), JSON.stringify(filas));
      }
      const leido = await leerExport(dir);
      expect(leido.cat_profesion).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
