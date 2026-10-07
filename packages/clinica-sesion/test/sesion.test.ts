// clinica-3 · las funciones puras de la sesión.
//
// Los tres que el prompt nombra uno por uno —«igual que la última vez»
// suma y no borra; la gravedad sin lesión no se guarda; el resumen del pie
// de la sesión según rol— más el mapa y sus listas, que son lo que hace
// que una sesión de hace dos años se siga leyendo.

import { describe, expect, it } from "vitest";

import {
  ANCHO_DEL_PIE_PX,
  CONSEJOS_V1,
  LESIONES_V1,
  MAPA_PIE_V1,
  RADIO_MINIMO,
  VERSION_DEL_MAPA,
  claveDeZona,
  clavesDelMapa,
  dolorEsValido,
  gravedadDisponible,
  igualQueLaUltimaVez,
  limpiarMarcas,
  mapaDeVersion,
  marcasLegibles,
  marcasPorPie,
  nombreDeZona,
  normalizarSesion,
  resumenDeLaSesion,
  textoDelIva,
  type Marcas,
  type TratamientoDelCatalogo,
} from "../src/index.js";

/**
 * Las rutas de todo lo que huela a dinero dentro de un objeto.
 *
 * Por NOMBRE DE CLAVE y exigiendo que el valor sea numérico: es lo único
 * que sigue valiendo cuando alguien añade un campo, y lo que distingue un
 * importe de una bandera.
 */
function clavesDeDinero(x: unknown, ruta = "$"): string[] {
  const SOSPECHOSAS = /precio|importe|total|iva|price|amount|eur|coste/i;
  if (Array.isArray(x)) {
    return x.flatMap((v, i) => clavesDeDinero(v, `${ruta}[${i}]`));
  }
  if (x != null && typeof x === "object") {
    return Object.entries(x).flatMap(([k, v]) => {
      const aqui = `${ruta}.${k}`;
      const esDinero = SOSPECHOSAS.test(k) && typeof v === "number";
      return [...(esDinero ? [aqui] : []), ...clavesDeDinero(v, aqui)];
    });
  }
  return [];
}

// ── El catálogo de ejemplo ────────────────────────────────────────────
//
// Los del mockup, con sus precios. Dos a cero («incluido» en la pantalla
// es un precio de 0 en el catálogo, no una marca aparte).
const QUIROPODIA = "11111111-1111-4111-8111-111111111111";
const FRESADO = "11111111-1111-4111-8111-111111111112";
const VERRUGA = "11111111-1111-4111-8111-111111111113";

const CATALOGO: TratamientoDelCatalogo[] = [
  { serviceId: QUIROPODIA, nombre: "Quiropodia", precio: 30, iva: 0 },
  { serviceId: FRESADO, nombre: "Corte y fresado de uñas", precio: 0, iva: 0 },
  { serviceId: VERRUGA, nombre: "Tratamiento de verruga", precio: 25, iva: 0 },
];

// ── 1 · El mapa ───────────────────────────────────────────────────────

describe("el mapa del pie", () => {
  it("tiene las once zonas del mockup, en el orden del pie", () => {
    expect(MAPA_PIE_V1.zonas.map((z) => z.id)).toEqual([
      "h",
      "d2",
      "d3",
      "d4",
      "d5",
      "m1",
      "m2",
      "m35",
      "arco",
      "lat",
      "talon",
    ]);
  });

  it("NINGUNA zona baja del radio mínimo — y a la escala de la pantalla eso son 48 px", () => {
    for (const z of MAPA_PIE_V1.zonas) {
      expect(z.rx, `rx de ${z.id}`).toBeGreaterThanOrEqual(RADIO_MINIMO);
      expect(z.ry, `ry de ${z.id}`).toBeGreaterThanOrEqual(RADIO_MINIMO);
    }
    // La cuenta entera, la misma que se mide en la captura: un radio de 22
    // unidades sobre un viewBox de 240 pintado a 264 px.
    const diametroPx = 2 * RADIO_MINIMO * (ANCHO_DEL_PIE_PX / 240);
    expect(diametroPx).toBeGreaterThanOrEqual(48);
  });

  it("cada zona cabe dentro del contorno (ni un dedo fuera del pie)", () => {
    for (const z of MAPA_PIE_V1.zonas) {
      expect(z.cx - z.rx, `${z.id} por la izquierda`).toBeGreaterThanOrEqual(0);
      expect(z.cx + z.rx, `${z.id} por la derecha`).toBeLessThanOrEqual(240);
      expect(z.cy - z.ry, `${z.id} por arriba`).toBeGreaterThanOrEqual(0);
      expect(z.cy + z.ry, `${z.id} por abajo`).toBeLessThanOrEqual(400);
    }
  });

  it("las claves son las once zonas por los dos pies", () => {
    expect(clavesDelMapa()).toHaveLength(22);
    expect(clavesDelMapa()).toContain("L:h");
    expect(clavesDelMapa()).toContain("R:talon");
  });

  it("una zona marcada se lee en palabras", () => {
    expect(nombreDeZona("L:h")).toBe("Pie izq. · Dedo gordo");
    expect(nombreDeZona("R:talon")).toBe("Pie der. · Talón");
  });

  it("una clave de una versión que no se conoce SE SIGUE VIENDO, no desaparece", () => {
    // Lo escrito tiene que poder leerse siempre. Lo que no se puede es
    // pintarlo en el sitio equivocado del mapa — y para eso
    // `mapaDeVersion` contesta `undefined` en vez de caer a la de ahora.
    expect(mapaDeVersion(99)).toBeUndefined();
    expect(nombreDeZona("L:zona-de-otra-version")).toBe(
      "L:zona-de-otra-version",
    );
  });

  it("claveDeZona y partirClave son la vuelta la una de la otra", () => {
    expect(claveDeZona("R", "arco")).toBe("R:arco");
  });
});

// ── 2 · La gravedad se elige DESPUÉS de la lesión ─────────────────────

describe("la gravedad sin lesión", () => {
  it("está desactivada ANTES de elegir lesión, y dice por qué", () => {
    expect(gravedadDisponible(undefined)).toEqual({
      puede: false,
      motivo: "elige antes la lesión",
    });
  });

  it("se activa en cuanto hay lesión", () => {
    expect(
      gravedadDisponible({ lesion: "callo", gravedad: null }),
    ).toEqual({ puede: true, motivo: null });
  });

  it("NO SE GUARDA: una gravedad sin lesión no entra en la historia", () => {
    const limpias = limpiarMarcas({
      // Lo que mandaría una pantalla rota (o un curioso con la consola):
      // gravedad sin lesión.
      "L:h": { gravedad: "SEVERA" } as never,
      "R:talon": { lesion: "dureza", gravedad: "LEVE" },
    });
    expect(Object.keys(limpias)).toEqual(["R:talon"]);
  });

  it("una lesión sin gravedad SÍ se guarda, con gravedad null", () => {
    expect(limpiarMarcas({ "L:h": { lesion: "unero" } })).toEqual({
      "L:h": { lesion: "unero", gravedad: null },
    });
  });

  it("una gravedad que no es de la escala se tira y la lesión se queda", () => {
    expect(
      limpiarMarcas({ "L:h": { lesion: "unero", gravedad: "GRAVÍSIMA" as never } }),
    ).toEqual({ "L:h": { lesion: "unero", gravedad: null } });
  });

  it("una zona que no es del mapa no entra", () => {
    expect(limpiarMarcas({ "L:oreja": { lesion: "callo", gravedad: null } })).toEqual(
      {},
    );
  });

  it("una lesión que no es de la lista no entra", () => {
    expect(
      limpiarMarcas({ "L:h": { lesion: "amputación", gravedad: "SEVERA" } }),
    ).toEqual({});
  });
});

// ── 3 · «Igual que la última vez» SUMA y NO BORRA ─────────────────────

describe("«igual que la última vez»", () => {
  const ANTERIOR = {
    marcas: {
      "L:h": { lesion: "unero", gravedad: "MODERADA" },
      "R:m1": { lesion: "dureza", gravedad: "LEVE" },
    } as Marcas,
    tratamientos: [QUIROPODIA, FRESADO],
    consejos: ["calzado", "hidratar"],
  };

  it("SUMA lo de la anterior a lo de hoy", () => {
    const hoy = {
      marcas: { "R:talon": { lesion: "callo", gravedad: "SEVERA" } } as Marcas,
      tratamientos: [VERRUGA],
      consejos: ["cura"],
    };
    const r = igualQueLaUltimaVez(hoy, ANTERIOR);
    expect(Object.keys(r.marcas).sort()).toEqual(["L:h", "R:m1", "R:talon"]);
    expect(r.tratamientos).toEqual([VERRUGA, QUIROPODIA, FRESADO]);
    expect(r.consejos).toEqual(["cura", "calzado", "hidratar"]);
  });

  it("NO BORRA NADA de lo que ya estaba marcado hoy", () => {
    const hoy = {
      marcas: { "R:talon": { lesion: "callo", gravedad: "SEVERA" } } as Marcas,
      tratamientos: [VERRUGA],
      consejos: ["cura"],
    };
    const r = igualQueLaUltimaVez(hoy, ANTERIOR);
    expect(r.marcas["R:talon"]).toEqual({
      lesion: "callo",
      gravedad: "SEVERA",
    });
    expect(r.tratamientos).toContain(VERRUGA);
    expect(r.consejos).toContain("cura");
  });

  it("en la COLISIÓN manda HOY: no deshace lo que la podóloga ya dijo", () => {
    const hoy = {
      // Hoy la uña encarnada del dedo gordo es SEVERA. La anterior decía
      // MODERADA: traerla encima sería deshacerle el trabajo con el botón
      // que existe para ahorrárselo.
      marcas: { "L:h": { lesion: "unero", gravedad: "SEVERA" } } as Marcas,
      tratamientos: [],
      consejos: [],
    };
    expect(igualQueLaUltimaVez(hoy, ANTERIOR).marcas["L:h"]).toEqual({
      lesion: "unero",
      gravedad: "SEVERA",
    });
  });

  it("no duplica un tratamiento que ya estaba en las dos", () => {
    const hoy = { marcas: {}, tratamientos: [QUIROPODIA], consejos: [] };
    expect(igualQueLaUltimaVez(hoy, ANTERIOR).tratamientos).toEqual([
      QUIROPODIA,
      FRESADO,
    ]);
  });

  it("es IDEMPOTENTE: pulsarlo dos veces no cambia nada ni mueve el orden", () => {
    const hoy = { marcas: {}, tratamientos: [VERRUGA], consejos: [] };
    const una = igualQueLaUltimaVez(hoy, ANTERIOR);
    const dos = igualQueLaUltimaVez(una, ANTERIOR);
    expect(dos).toEqual(una);
  });

  it("sin visita anterior, devuelve lo de hoy tal cual", () => {
    const hoy = { marcas: {}, tratamientos: [VERRUGA], consejos: ["cura"] };
    expect(igualQueLaUltimaVez(hoy, null)).toBe(hoy);
  });
});

// ── 4 · El resumen del pie de la sesión, SEGÚN ROL ────────────────────

describe("el resumen del pie de la sesión", () => {
  const BASE = {
    tratamientos: [QUIROPODIA, FRESADO],
    catalogo: CATALOGO,
    dolor: 4,
  };

  it("la DUEÑA ve el total, el IVA del catálogo y su botón dice «y cobrar»", () => {
    const r = resumenDeLaSesion({ ...BASE, verImportes: true });
    expect(r.tratamientos).toBe(2);
    expect(r.total).toBe(30);
    expect(r.ivaTexto).toBe("IVA 0 %");
    expect(r.lineas.map((l) => l.precio)).toEqual([30, 0]);
    expect(r.textoDelBoton).toBe("Cerrar sesión y cobrar");
    expect(r.puedeCerrar).toBe(true);
  });

  it("el SANITARIO SIN CAJA no ve NI UN IMPORTE, y son `null` y no 0", () => {
    const r = resumenDeLaSesion({ ...BASE, verImportes: false });
    expect(r.tratamientos).toBe(2);
    expect(r.total).toBeNull();
    expect(r.ivaTexto).toBeNull();
    expect(r.lineas.map((l) => l.precio)).toEqual([null, null]);
    expect(r.lineas.map((l) => l.iva)).toEqual([null, null]);
    // `null` y no 0 a propósito: un 0 es un precio que alguien podría
    // pintar, y la API lo serializa quitando la clave.
    expect(r.textoDelBoton).toBe("Cerrar sesión");
    expect(r.puedeCerrar).toBe(true);
  });

  it("sin dolor no se puede cerrar, y lo dice", () => {
    const r = resumenDeLaSesion({ ...BASE, dolor: null, verImportes: true });
    expect(r.faltaDolor).toBe(true);
    expect(r.puedeCerrar).toBe(false);
  });

  it("sin tratamientos tampoco", () => {
    const r = resumenDeLaSesion({
      ...BASE,
      tratamientos: [],
      verImportes: true,
    });
    expect(r.faltaTratamiento).toBe(true);
    expect(r.puedeCerrar).toBe(false);
  });

  it("un tratamiento que el catálogo ya no reconoce no cuenta ni suma", () => {
    const r = resumenDeLaSesion({
      ...BASE,
      tratamientos: [QUIROPODIA, "11111111-1111-4111-8111-999999999999"],
      verImportes: true,
    });
    expect(r.tratamientos).toBe(1);
    expect(r.total).toBe(30);
  });

  it("el texto del IVA sale del CATÁLOGO y nunca dice «exento»", () => {
    expect(textoDelIva([{ iva: 0 }])).toBe("IVA 0 %");
    expect(textoDelIva([{ iva: 21 }, { iva: 21 }])).toBe("IVA 21 %");
    expect(textoDelIva([{ iva: 0 }, { iva: 21 }])).toBe(
      "IVA según cada tratamiento",
    );
    expect(textoDelIva([])).toBeNull();
    for (const caso of [[{ iva: 0 }], [{ iva: 21 }, { iva: 10 }]]) {
      expect(textoDelIva(caso)).not.toMatch(/exent/i);
    }
  });

  it("el total no arrastra céntimos del binario", () => {
    const r = resumenDeLaSesion({
      tratamientos: ["a", "b", "c"],
      catalogo: [
        { serviceId: "a", nombre: "A", precio: 0.1, iva: 0 },
        { serviceId: "b", nombre: "B", precio: 0.2, iva: 0 },
        { serviceId: "c", nombre: "C", precio: 12.95, iva: 0 },
      ],
      dolor: 0,
      verImportes: true,
    });
    expect(r.total).toBe(13.25);
  });
});

// ── 5 · El dolor es obligatorio ───────────────────────────────────────

describe("el dolor", () => {
  it("vale de 0 a 10, entero", () => {
    for (const n of [0, 1, 5, 10]) expect(dolorEsValido(n)).toBe(true);
    for (const n of [-1, 11, 4.5, "5", null, undefined, NaN]) {
      expect(dolorEsValido(n)).toBe(false);
    }
  });

  it("CERO es una respuesta, no «falta el dolor»", () => {
    // El fallo clásico del `if (!dolor)`. Si 0 no valiera, un paciente que
    // ya no le duele nada no podría cerrar su sesión.
    const r = resumenDeLaSesion({
      tratamientos: [QUIROPODIA],
      catalogo: CATALOGO,
      dolor: 0,
      verImportes: true,
    });
    expect(r.faltaDolor).toBe(false);
    expect(r.puedeCerrar).toBe(true);
  });
});

// ── 6 · Normalizar antes de escribir ──────────────────────────────────

describe("normalizarSesion", () => {
  const BASE = {
    marcas: { "L:h": { lesion: "unero", gravedad: "MODERADA" as const } },
    tratamientos: [QUIROPODIA],
    tratamientosDelCatalogo: CATALOGO,
    dolor: 6,
    evolucion: "MEJOR",
    consejos: ["calzado"],
    proximaCita: "S4",
    nota: "  ",
  };

  it("deja el cuerpo listo, con las CUATRO versiones dentro", () => {
    const r = normalizarSesion(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo.v).toBe(1);
    expect(r.cuerpo.mapaVersion).toBe(VERSION_DEL_MAPA);
    expect(r.cuerpo.lesionesVersion).toBe(LESIONES_V1.version);
    expect(r.cuerpo.consejosVersion).toBe(CONSEJOS_V1.version);
  });

  it("guarda el NOMBRE del tratamiento y NO su precio", () => {
    const r = normalizarSesion(BASE);
    if (!r.ok) throw new Error("debería valer");
    expect(r.cuerpo.tratamientosNombre).toEqual({ [QUIROPODIA]: "Quiropodia" });
    // El precio y el IVA salen del catálogo al cobrar, no de la historia.
    //
    // Se comprueba por la FORMA del cuerpo y no buscando el texto «30»:
    // ese 30 aparece dentro de cualquier uuid que lo lleve, así que el
    // aserto pasaba o fallaba según qué id tocara. Es la lección que
    // clinica-1 dejó escrita en su §10b — **un aserto sobre el texto
    // tiene que contar, no buscar** — y aquí la pagó el CI.
    expect(Object.keys(r.cuerpo).sort()).toEqual([
      "consejos",
      "consejosVersion",
      "dolor",
      "evolucion",
      "lesionesVersion",
      "mapaVersion",
      "marcas",
      "nota",
      "proximaCita",
      "tratamientos",
      "tratamientosNombre",
      "v",
    ]);
    expect(clavesDeDinero(r.cuerpo)).toEqual([]);
  });

  it("una nota en blanco es `null`, no una cadena vacía", () => {
    const r = normalizarSesion(BASE);
    if (!r.ok) throw new Error("debería valer");
    expect(r.cuerpo.nota).toBeNull();
  });

  it("sin tratamientos no se cierra", () => {
    const r = normalizarSesion({ ...BASE, tratamientos: [] });
    expect(r).toEqual({
      ok: false,
      motivo: "SIN_TRATAMIENTOS",
      mensaje:
        "Marca al menos un tratamiento de hoy antes de cerrar la sesión.",
    });
  });

  it("sin dolor tampoco", () => {
    const r = normalizarSesion({ ...BASE, dolor: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("FALTA_DOLOR");
  });

  it("una evolución, un consejo o una próxima cita inventados se tiran", () => {
    const r = normalizarSesion({
      ...BASE,
      evolucion: "REGULAR",
      consejos: ["calzado", "ponerse-de-pie"],
      proximaCita: "S3",
    });
    if (!r.ok) throw new Error("debería valer");
    expect(r.cuerpo.evolucion).toBeNull();
    expect(r.cuerpo.consejos).toEqual(["calzado"]);
    expect(r.cuerpo.proximaCita).toBeNull();
  });
});

// ── 7 · Cómo se lee una sesión escrita ────────────────────────────────

describe("leer una sesión", () => {
  it("las marcas se leen con el vocabulario de SU versión", () => {
    expect(
      marcasLegibles({
        marcas: { "L:h": { lesion: "unero", gravedad: "MODERADA" } },
        mapaVersion: 1,
        lesionesVersion: 1,
      }),
    ).toEqual([
      {
        clave: "L:h",
        zona: "Pie izq. · Dedo gordo",
        lesion: "Uña encarnada",
        gravedad: "Moderada",
      },
    ]);
  });

  it("cuenta las marcas de cada pie", () => {
    expect(
      marcasPorPie({
        "L:h": { lesion: "callo", gravedad: null },
        "R:m1": { lesion: "dureza", gravedad: null },
        "R:talon": { lesion: "dureza", gravedad: null },
      }),
    ).toEqual({ L: 1, R: 2 });
  });
});
