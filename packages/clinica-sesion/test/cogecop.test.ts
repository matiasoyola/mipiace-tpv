// cogecop-1 · la traducción del programa anterior.
//
// NI UN DATO REAL. Todas las marcas, nombres y textos de este fichero
// están inventados aquí o salen del catálogo del Colegio (que es público
// y no es de nadie). El generador de datos falsos con la forma del export
// vive en `apps/api/src/cogecop/generador.ts` y lo prueba su propio test.

import { describe, expect, it } from "vitest";

import {
  CAMPOS_DE_LA_NOTA,
  CENTROIDES_COGECOP,
  ETIQUETA_DE_IMPORTADA,
  LADO_DEL_ICONO,
  PATOLOGIAS_COGECOP,
  PATOLOGIAS_DE_COGECOP,
  RADIO_DE_LA_MARCA,
  datosDeCogecopDeLaNota,
  esCuerpoImportado,
  esLateralidadDeCogecop,
  lesionDePatologia,
  marcasDeLoImportado,
  nombreDeLaMarcaImportada,
  notaDeCogecop,
  pieDeLaMitad,
  sinValidarDeLaNota,
  sitioDeLaMarca,
  versionesDeLaImportacion,
  visitaImportadaDeLaHistoria,
  visitaImportadaLegible,
  type CuerpoImportado,
  type MarcaImportada,
} from "../src/cogecop.js";
import { estadoDeLasZonas } from "../src/historia.js";
import {
  LESIONES_V1,
  LESIONES_V2,
  VERSION_DE_LAS_LESIONES,
  lesionDe,
  lesionesDeVersion,
  nombreDeLesion,
} from "../src/listas.js";
import { MAPA_PIE_V1 } from "../src/mapa.js";

// ── Las listas de lesiones ────────────────────────────────────────────

describe("LESIONES_V2", () => {
  it("la V1 se sigue leyendo IGUAL: siete lesiones, mismas ids y mismas etiquetas", () => {
    expect(LESIONES_V1.version).toBe(1);
    expect(LESIONES_V1.lesiones.map((l) => l.id)).toEqual([
      "callo",
      "dureza",
      "unero",
      "onico",
      "verruga",
      "herida",
      "juanete",
    ]);
    // Lo escrito con la V1 se lee con la V1, aunque la de hoy sea otra.
    expect(nombreDeLesion("callo", 1)).toBe("Callo (heloma)");
    expect(lesionesDeVersion(1)).toBe(LESIONES_V1);
  });

  it("la V2 empieza por las siete de la V1, en su orden, y añade cinco", () => {
    const v2 = LESIONES_V2.lesiones;
    expect(v2.slice(0, 7)).toEqual(LESIONES_V1.lesiones);
    expect(v2.slice(7).map((l) => l.id)).toEqual([
      "onicogrifosis",
      "hematoma",
      "xerosis",
      "onicolisis",
      "distrofica",
    ]);
    expect(nombreDeLesion("onicogrifosis", 2)).toBe(
      "Uña engrosada (onicogrifosis)",
    );
    expect(nombreDeLesion("xerosis", 2)).toBe("Piel seca (xerosis)");
  });

  it("hoy se escribe con la V2, y ninguna id se repite", () => {
    expect(VERSION_DE_LAS_LESIONES).toBe(2);
    const ids = LESIONES_V2.lesiones.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("las cinco nuevas NO existen en la V1: lo viejo no cambia de sentido", () => {
    for (const id of ["onicogrifosis", "hematoma", "xerosis", "onicolisis", "distrofica"]) {
      expect(lesionDe(id, 1)).toBeUndefined();
      expect(lesionDe(id, 2)).toBeDefined();
    }
  });
});

// ── La tabla de patologías ────────────────────────────────────────────

describe("PATOLOGIAS_COGECOP", () => {
  it("están las 144 del catálogo del Colegio, de la 1 a la 144", () => {
    const ids = Object.keys(PATOLOGIAS_COGECOP).map(Number).sort((a, b) => a - b);
    expect(ids.length).toBe(PATOLOGIAS_DE_COGECOP);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(144);
  });

  it("toda lesión traducida EXISTE en la V2", () => {
    for (const [id, p] of Object.entries(PATOLOGIAS_COGECOP)) {
      if (p.lesion == null) continue;
      expect(
        lesionDe(p.lesion, 2),
        `la patología ${id} (${p.nombre}) apunta a «${p.lesion}», que no está en la V2`,
      ).toBeDefined();
    }
  });

  it("ninguna fila se queda sin nombre", () => {
    for (const [id, p] of Object.entries(PATOLOGIAS_COGECOP)) {
      expect(p.nombre.trim(), `la patología ${id} no tiene nombre`).not.toBe("");
    }
  });

  it("traduce la partida de Dirección donde el catálogo la tiene", () => {
    expect(lesionDePatologia(1)).toBe("dureza"); // Hiperqueratosis
    expect(lesionDePatologia(52)).toBe("dureza"); // QPP-Difusa
    expect(lesionDePatologia(6)).toBe("callo"); // Heloma duro
    expect(lesionDePatologia(115)).toBe("unero"); // Onicocriptosis
    expect(lesionDePatologia(103)).toBe("onico"); // Onicomicosis
    expect(lesionDePatologia(92)).toBe("verruga"); // Papilomas
    expect(lesionDePatologia(97)).toBe("verruga"); // Epidermodisplasia
    expect(lesionDePatologia(113)).toBe("onicogrifosis"); // «Onicigrifosis»
    expect(lesionDePatologia(128)).toBe("herida"); // Tinea pedís ulcerativa
  });

  it("y las cinco de la V2 tienen quien las escriba", () => {
    expect(lesionDePatologia(113)).toBe("onicogrifosis");
    expect(lesionDePatologia(117)).toBe("hematoma");
    expect(lesionDePatologia(79)).toBe("xerosis");
    expect(lesionDePatologia(114)).toBe("onicolisis");
    expect(lesionDePatologia(110)).toBe("distrofica");
  });

  it("lo que el catálogo no dice, NO se inventa", () => {
    // Un eczema no es una hiperqueratosis, ni una tiña tampoco.
    expect(lesionDePatologia(87)).toBeNull(); // Eczema hiperqueratósico
    expect(lesionDePatologia(127)).toBeNull(); // Tinea pedís hiperqueratósica
    // Y un carcinoma no es ninguna de las doce.
    expect(lesionDePatologia(44)).toBeNull(); // Carcinoma basocelular
    expect(lesionDePatologia(47)).toBeNull(); // Melanoma
  });

  it("una patología fuera del catálogo no revienta: null y a seguir", () => {
    expect(lesionDePatologia(999)).toBeNull();
    expect(lesionDePatologia(0)).toBeNull();
  });

  it("NINGUNA patología se traduce a «juanete»: el catálogo no tiene deformidades", () => {
    const juanetes = Object.values(PATOLOGIAS_COGECOP).filter(
      (p) => p.lesion === "juanete",
    );
    expect(juanetes).toEqual([]);
  });
});

// ── Los centroides del mapa ───────────────────────────────────────────

const esquina = (x: number, y: number) => ({
  x1: x - LADO_DEL_ICONO / 2,
  y1: y - LADO_DEL_ICONO / 2,
});

describe("CENTROIDES_COGECOP", () => {
  it("toda zona de la tabla existe en MAPA_PIE_V1", () => {
    const zonas = new Set(MAPA_PIE_V1.zonas.map((z) => z.id));
    for (const c of CENTROIDES_COGECOP) {
      expect(zonas.has(c.zona), `${c.zona} no es una zona del mapa`).toBe(true);
    }
  });

  it("no hay dos centroides para la misma zona de la misma mitad del mismo dibujo", () => {
    const claves = CENTROIDES_COGECOP.map(
      (c) => `${c.dibujo}:${c.mitad}:${c.zona}`,
    );
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("las dos mitades son ESPEJO: cada zona tiene su pareja a menos de 3 px del eje", () => {
    // Es lo que dice que los grupos son los dedos de dos pies y no una
    // casualidad de k-medias. El eje sale de los propios datos.
    for (const dibujo of [0, 2]) {
      const delDibujo = CENTROIDES_COGECOP.filter((c) => c.dibujo === dibujo);
      const ejes: number[] = [];
      for (const a of delDibujo.filter((c) => c.mitad === "A")) {
        const b = delDibujo.find((c) => c.mitad === "B" && c.zona === a.zona);
        expect(b, `al dibujo ${dibujo} le falta ${a.zona} en la mitad B`).toBeDefined();
        ejes.push((a.x + b!.x) / 2);
      }
      const min = Math.min(...ejes);
      const max = Math.max(...ejes);
      expect(max - min, `el eje del dibujo ${dibujo} no cuadra`).toBeLessThanOrEqual(6);
    }
  });

  it("el dibujo 3 no tiene centroides: sus doce marcas entran sin zona", () => {
    expect(CENTROIDES_COGECOP.filter((c) => c.dibujo === 3)).toEqual([]);
  });
});

describe("sitioDeLaMarca", () => {
  it("una marca en el CENTRO de un grupo del dibujo 0 cae en su dedo", () => {
    for (const c of CENTROIDES_COGECOP.filter((x) => x.dibujo === 0)) {
      const r = sitioDeLaMarca({
        dibujo: 0,
        ...esquina(c.x, c.y),
        lateralidad: "izquierdo-a-la-izquierda",
      });
      expect(r.zona, `${c.mitad}:${c.zona}`).toBe(c.zona);
      expect(r.pie).toBe(c.mitad === "A" ? "L" : "R");
    }
  });

  it("y en el dibujo 2 también, las once zonas de cada mitad", () => {
    for (const c of CENTROIDES_COGECOP.filter((x) => x.dibujo === 2)) {
      const r = sitioDeLaMarca({
        dibujo: 2,
        ...esquina(c.x, c.y),
        lateralidad: "izquierdo-a-la-izquierda",
      });
      expect(r.zona, `${c.mitad}:${c.zona}`).toBe(c.zona);
    }
  });

  it("LA LATERALIDAD CAMBIA EL PIE, y nada más", () => {
    const uno = sitioDeLaMarca({
      dibujo: 0,
      ...esquina(136, 22),
      lateralidad: "izquierdo-a-la-izquierda",
    });
    const otro = sitioDeLaMarca({
      dibujo: 0,
      ...esquina(136, 22),
      lateralidad: "izquierdo-a-la-derecha",
    });
    expect(uno).toEqual({ pie: "L", zona: "h" });
    expect(otro).toEqual({ pie: "R", zona: "h" });
  });

  it("lejos de todo centro: sin pie y sin zona", () => {
    // El hueco entre las dos plantas del dibujo 2, a mitad de camino.
    const r = sitioDeLaMarca({
      dibujo: 2,
      ...esquina(183, 220),
      lateralidad: "izquierdo-a-la-izquierda",
    });
    expect(r).toEqual({ pie: null, zona: null });
  });

  it("justo en el borde del radio entra, y un píxel más allá no", () => {
    const dentro = sitioDeLaMarca({
      dibujo: 0,
      ...esquina(136, 22 + RADIO_DE_LA_MARCA),
      lateralidad: "izquierdo-a-la-izquierda",
      // Sin vecinos por debajo: el de al lado (d2) está a 28 px en x.
      radio: RADIO_DE_LA_MARCA,
    });
    expect(dentro.zona).not.toBeNull();
    const fuera = sitioDeLaMarca({
      dibujo: 0,
      ...esquina(136, 22 + 400),
      lateralidad: "izquierdo-a-la-izquierda",
    });
    expect(fuera.zona).toBeNull();
  });

  it("el dibujo 3 nunca da zona", () => {
    expect(
      sitioDeLaMarca({
        dibujo: 3,
        x1: 150,
        y1: 150,
        lateralidad: "izquierdo-a-la-izquierda",
      }),
    ).toEqual({ pie: null, zona: null });
  });

  it("pieDeLaMitad contesta las dos direcciones y nada más", () => {
    expect(pieDeLaMitad("A", "izquierdo-a-la-izquierda")).toBe("L");
    expect(pieDeLaMitad("B", "izquierdo-a-la-izquierda")).toBe("R");
    expect(pieDeLaMitad("A", "izquierdo-a-la-derecha")).toBe("R");
    expect(pieDeLaMitad("B", "izquierdo-a-la-derecha")).toBe("L");
    expect(esLateralidadDeCogecop("izquierdo-a-la-izquierda")).toBe(true);
    expect(esLateralidadDeCogecop("izquierda")).toBe(false);
    expect(esLateralidadDeCogecop(undefined)).toBe(false);
  });
});

// ── El cuerpo importado ───────────────────────────────────────────────

function marca(p: Partial<MarcaImportada> = {}): MarcaImportada {
  return {
    dibujo: 2,
    pie: "L",
    zona: "m1",
    lesion: "dureza",
    lesionOriginal: "Hiperqueratosis",
    curado: null,
    ...p,
  };
}

function cuerpo(p: Partial<CuerpoImportado> = {}): CuerpoImportado {
  return {
    origen: "cogecop",
    cogecopId: 1,
    tipo: "quiropodia",
    motivo: null,
    evolucion: null,
    diagnostico: null,
    recomendacion: null,
    alerta: false,
    tratamientos: [],
    marcas: [],
    ...versionesDeLaImportacion(),
    ...p,
  };
}

describe("el cuerpo importado", () => {
  it("se reconoce por su origen, y una sesión nuestra no se confunde", () => {
    expect(esCuerpoImportado(cuerpo())).toBe(true);
    expect(esCuerpoImportado({ v: 2, marcas: {} })).toBe(false);
    expect(esCuerpoImportado(null)).toBe(false);
    expect(esCuerpoImportado("cogecop")).toBe(false);
  });

  it("se traduce con las versiones de HOY, y las guarda", () => {
    const c = cuerpo();
    expect(c.lesionesVersion).toBe(2);
    expect(c.mapaVersion).toBe(1);
  });
});

describe("marcasDeLoImportado", () => {
  it("convierte la lista en el diccionario que la historia ya sabe leer", () => {
    const m = marcasDeLoImportado(
      cuerpo({ marcas: [marca(), marca({ pie: "R", zona: "talon", lesion: "callo" })] }),
    );
    expect(m).toEqual({
      "L:m1": { lesion: "dureza", gravedad: null },
      "R:talon": { lesion: "callo", gravedad: null },
    });
  });

  it("sin zona o sin lesión NO entra en el mapa (pero sigue en el cuerpo)", () => {
    const c = cuerpo({
      marcas: [
        marca({ zona: null, pie: null, lesionOriginal: "Melanoma", lesion: null }),
        marca({ zona: "talon", lesion: null, lesionOriginal: "Eritrasma" }),
      ],
    });
    expect(marcasDeLoImportado(c)).toEqual({});
    expect(c.marcas).toHaveLength(2);
  });

  it("dos marcas en la misma zona: manda la PRIMERA", () => {
    const m = marcasDeLoImportado(
      cuerpo({
        marcas: [
          marca({ lesion: "onico", lesionOriginal: "Onicomicosis" }),
          marca({ lesion: "onicogrifosis", lesionOriginal: "Onicigrifosis" }),
        ],
      }),
    );
    expect(m["L:m1"]).toEqual({ lesion: "onico", gravedad: null });
  });

  it("una zona que no existe en el mapa de su versión se queda fuera", () => {
    expect(marcasDeLoImportado(cuerpo({ marcas: [marca({ zona: "m4" })] }))).toEqual(
      {},
    );
  });
});

describe("visitaImportadaLegible", () => {
  const meta = { entryId: "e1", fecha: "2025-03-04T09:00:00.000Z" };

  it("va marcada como importada y se titula con su tipo", () => {
    const v = visitaImportadaLegible(cuerpo({ tipo: "cirugia" }), meta);
    expect(v.importada).toBe(true);
    expect(v.titulo).toBe("Cirugía · revisión");
    expect(v.tipos).toEqual(["CIRUGIA"]);
    expect(ETIQUETA_DE_IMPORTADA).toBe("Importada de COGECOP");
  });

  it("los chips son los tratamientos de SU catálogo, congelados", () => {
    const v = visitaImportadaLegible(
      cuerpo({ tratamientos: ["Quiropodia", "Cura"] }),
      meta,
    );
    expect(v.chips).toEqual(["Quiropodia", "Cura"]);
  });

  it("y la lesión que no se tradujo se lee de chip: si no, no se vería en ningún sitio", () => {
    const v = visitaImportadaLegible(
      cuerpo({
        marcas: [
          marca(),
          marca({ lesion: null, lesionOriginal: "Queratosis seborreica" }),
        ],
      }),
      meta,
    );
    expect(v.chips).toEqual(["Queratosis seborreica"]);
  });

  it("no trae dolor ni evolución: COGECOP no los pedía", () => {
    const v = visitaImportadaLegible(cuerpo(), meta);
    expect(v.dolor).toBeNull();
    expect(v.evolucion).toBeNull();
    expect(v.nivel).toBeNull();
  });
});

describe("la historia viva parte de la última visita importada", () => {
  it("el estado de la zona sale de lo importado, y la zona LO DICE", () => {
    const importada = visitaImportadaDeLaHistoria(
      cuerpo({ marcas: [marca({ pie: "L", zona: "h", lesion: "onicogrifosis" })] }),
      { entryId: "imp1", fecha: "2025-06-02T10:00:00.000Z" },
    );
    const zonas = estadoDeLasZonas([importada]);
    expect(zonas).toHaveLength(1);
    expect(zonas[0]!.clave).toBe("L:h");
    expect(zonas[0]!.estado).toBe("ACTIVA");
    expect(zonas[0]!.lesion).toBe("onicogrifosis");
    expect(zonas[0]!.lesionNombre).toBe("Uña engrosada (onicogrifosis)");
    expect(zonas[0]!.importada).toBe(true);
    expect(zonas[0]!.pasos[0]!.importada).toBe(true);
  });

  it("una quiropodia importada SÍ miró el pie: puede curar una zona", () => {
    const conMarca = visitaImportadaDeLaHistoria(
      cuerpo({ marcas: [marca({ pie: "L", zona: "h", lesion: "callo" })] }),
      { entryId: "imp1", fecha: "2025-01-10T10:00:00.000Z" },
    );
    const limpia = visitaImportadaDeLaHistoria(cuerpo({ cogecopId: 2 }), {
      entryId: "imp2",
      fecha: "2025-02-10T10:00:00.000Z",
    });
    const zonas = estadoDeLasZonas([conMarca, limpia]);
    expect(zonas[0]!.estado).toBe("CURADA");
    expect(zonas[0]!.curadaEn?.entryId).toBe("imp2");
  });

  it("una consulta GENERAL importada no cura nada", () => {
    const conMarca = visitaImportadaDeLaHistoria(
      cuerpo({ marcas: [marca({ pie: "L", zona: "h", lesion: "callo" })] }),
      { entryId: "imp1", fecha: "2025-01-10T10:00:00.000Z" },
    );
    const general = visitaImportadaDeLaHistoria(
      cuerpo({ cogecopId: 2, tipo: "general" }),
      { entryId: "imp2", fecha: "2025-02-10T10:00:00.000Z" },
    );
    expect(estadoDeLasZonas([conMarca, general])[0]!.estado).toBe("ACTIVA");
  });

  it("y una sesión nuestra posterior deja de estar marcada como importada", () => {
    const importada = visitaImportadaDeLaHistoria(
      cuerpo({ marcas: [marca({ pie: "L", zona: "h", lesion: "callo" })] }),
      { entryId: "imp1", fecha: "2025-01-10T10:00:00.000Z" },
    );
    const nuestra = {
      entryId: "s1",
      fecha: "2026-10-10T10:00:00.000Z",
      v: 2,
      tipos: ["QUIROPODIA"] as const,
      marcas: { "L:h": { lesion: "callo", gravedad: null } },
      mapaVersion: 1,
      lesionesVersion: 2,
      importada: false,
    };
    const zonas = estadoDeLasZonas([importada, nuestra]);
    expect(zonas[0]!.importada).toBe(false);
    expect(zonas[0]!.pasos.map((p) => p.importada)).toEqual([true, false]);
  });
});

describe("nombreDeLaMarcaImportada", () => {
  it("la nuestra si se tradujo, y el nombre de COGECOP si no", () => {
    expect(nombreDeLaMarcaImportada(marca())).toBe("Dureza");
    expect(
      nombreDeLaMarcaImportada(
        marca({ lesion: null, lesionOriginal: "Quiste sinovial" }),
      ),
    ).toBe("Quiste sinovial");
  });

  it("con la versión de la marca, no con la de hoy", () => {
    expect(nombreDeLaMarcaImportada(marca({ lesion: "callo" }), 1)).toBe(
      "Callo (heloma)",
    );
  });
});

// ── La nota de la ficha ───────────────────────────────────────────────

const HOY = new Date(Date.UTC(2026, 9, 29));

describe("la nota de la ficha", () => {
  it("se escribe con encabezado, aviso y una línea por campo", () => {
    const nota = notaDeCogecop({
      hoy: HOY,
      campos: { Enfermedades: "diabetes tipo 2", Alergias: "ninguna" },
    });
    expect(nota).toBe(
      [
        "Importado de COGECOP el 29/10/2026",
        "Sin validar: lo de abajo viene del programa anterior y nadie lo ha repasado con el paciente.",
        "",
        "Enfermedades: diabetes tipo 2",
        "Alergias: ninguna",
      ].join("\n"),
    );
  });

  it("IDA Y VUELTA: todo campo que se escribe se vuelve a leer igual", () => {
    const campos: Record<string, string> = {};
    for (const c of CAMPOS_DE_LA_NOTA) campos[c] = `valor de ${c}`;
    const nota = notaDeCogecop({ hoy: HOY, campos });
    const leido = datosDeCogecopDeLaNota(nota);
    expect(leido?.importadoEl).toBe("2026-10-29");
    expect(leido?.campos).toEqual(campos);
  });

  it("los saltos de línea de un valor se vuelven « · » y la nota sigue leyéndose", () => {
    const nota = notaDeCogecop({
      hoy: HOY,
      campos: { Comentarios: "primera línea\n\nsegunda línea\r\ntercera" },
    });
    expect(datosDeCogecopDeLaNota(nota)?.campos["Comentarios"]).toBe(
      "primera línea · segunda línea · tercera",
    );
  });

  it("un campo vacío no se escribe, y sin nada que escribir no hay nota", () => {
    expect(
      notaDeCogecop({ hoy: HOY, campos: { Enfermedades: "  ", Alergias: null } }),
    ).toBeNull();
    const nota = notaDeCogecop({
      hoy: HOY,
      campos: { Enfermedades: "", Alergias: "polen" },
    });
    expect(nota).not.toContain("Enfermedades");
    expect(nota).toContain("Alergias: polen");
  });

  it("una nota que NO es de COGECOP no se lee como si lo fuera", () => {
    expect(datosDeCogecopDeLaNota("viene por lo del dedo")).toBeNull();
    expect(datosDeCogecopDeLaNota(null)).toBeNull();
    expect(datosDeCogecopDeLaNota("")).toBeNull();
  });

  it("una línea añadida a mano no rompe la lectura", () => {
    const nota =
      notaDeCogecop({ hoy: HOY, campos: { Alergias: "polen" } }) +
      "\nOjo: llamó el lunes";
    expect(datosDeCogecopDeLaNota(nota)?.campos).toEqual({ Alergias: "polen" });
  });

  it("sinValidarDeLaNota saca lo que la ficha enseña en rojo", () => {
    const nota = notaDeCogecop({
      hoy: HOY,
      campos: { Enfermedades: "diabetes", Alergias: "iodo", Provincia: "Cádiz" },
    });
    expect(sinValidarDeLaNota(nota)).toEqual({
      importadoEl: "2026-10-29",
      enfermedades: "diabetes",
      alergias: "iodo",
    });
  });

  it("y es null cuando no traía ni enfermedades ni alergias: la banda no se pinta vacía", () => {
    const nota = notaDeCogecop({ hoy: HOY, campos: { Provincia: "Cádiz" } });
    expect(sinValidarDeLaNota(nota)).toBeNull();
  });
});
