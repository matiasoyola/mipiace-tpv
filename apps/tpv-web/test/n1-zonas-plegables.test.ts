// n1-hosteleria-2 · hallazgo 2 · LAS ZONAS SE PLIEGAN Y PLEGADAS DICEN
// LO QUE IMPORTA.
//
// Matías, 23-10: en «Todas» hay que usar el zoom del sistema para ver la
// sala. La pasada medía 14 de 23 mesas a la vista y aquel criterio («al
// menos 9») se cumplía — lo que no decía es que las 14 son las de
// ARRIBA: BARRA entera y media sala.
//
// Lo que este banco tiene que atar no es sólo que el pliegue funcione:
// es la CUENTA que lo justifica. Una cabecera de 48 px por zona, por sí
// sola, es un EMPEORAMIENTO (de 11 mesas a 8), y lo que la paga es que
// el marco discontinuo desaparezca. Si alguien devuelve el marco «que se
// veía mejor», o sube la cabecera a los 56 de la casa, se pierden tres
// mesas sin que nada lo diga. Eso es lo que se mide aquí.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | La cabecera de zona a 56 px        | 8 mesas de 23 en vez de 11
//   | El marco se queda con la cabecera  | 8 mesas de 23 en vez de 11

import { beforeEach, describe, expect, it } from "vitest";

import { MIN_TOUCH_PX } from "../src/lib/hospitalityTheme.js";
import {
  BAR_COUNTER_HEIGHT,
  BAR_COUNTER_HEIGHT_MANO,
  CABECERA_DE_ZONA_PX,
  mesasALaVistaDeMano,
  REPARTO_MANO,
  roomAvailableHeightDark,
  roomAvailableWidthDark,
  type RoomZone,
  ZONE_GAP,
} from "../src/lib/roomGrid.js";
import {
  guardarZonasPlegadas,
  leerZonasPlegadas,
  olvidarZonasPlegadas,
  resumenDeZona,
  rotuloDeZonaPlegada,
  zonasSePliegan,
} from "../src/lib/zonasPlegadas.js";

/** Sirope de verdad: 23 mesas, 8 / 7 / 8, contadas en producción. */
const SIROPE: RoomZone[] = [
  { tables: 8, isBar: true, name: "BARRA" },
  { tables: 7, name: "SALON" },
  { tables: 8, name: "TERRAZA" },
];

const N1 = { w: 360, h: 720 };
const ANCHO = roomAvailableWidthDark(N1.w, REPARTO_MANO);
const ALTO = roomAvailableHeightDark(N1.h, REPARTO_MANO);

const aLaVista = (plegadas: string[] = []) =>
  mesasALaVistaDeMano(SIROPE, ANCHO, ALTO, undefined, undefined, {
    plegables: true,
    plegadas: new Set(plegadas),
    barCounter: BAR_COUNTER_HEIGHT_MANO,
  });

describe("n1-hosteleria-2 · la cabecera de zona y lo que cuesta", () => {
  it("mide 48 px: cumple R3 y NO es el suelo de la casa", () => {
    // R3 pide «todo lo que se toca mide ≥ 48 px», y 48 lo cumple. Es el
    // único sitio del bloque donde no se usa `MIN_TOUCH_PX`, y la razón
    // es la medida del test de abajo.
    expect(CABECERA_DE_ZONA_PX).toBe(48);
    expect(CABECERA_DE_ZONA_PX).toBeGreaterThanOrEqual(48);
    expect(CABECERA_DE_ZONA_PX).toBeLessThan(MIN_TOUCH_PX);
  });

  it("el mostrador de la BARRA en la mano mide 24, no los 42 del terminal", () => {
    // `n1-hosteleria` dejó el mostrador compacto en el DOM (14 px y
    // `mb-2.5`) pero la aritmética seguía con los 42 del terminal, así
    // que contaba 18 px de más por la zona BARRA. El error iba al lado
    // seguro —menos mesas de las que se ven— y por eso no se notó: el
    // criterio era «al menos 9» y salían 11 cuando en el aparato se
    // veían 14. Este bloque gasta justo esos píxeles en la cabecera, así
    // que con el número viejo la cuenta decidiría mal.
    expect(BAR_COUNTER_HEIGHT_MANO).toBe(24);
    expect(BAR_COUNTER_HEIGHT).toBe(42);
  });

  it("con cabecera y sin marco se siguen viendo las 11 de antes", () => {
    // 11 es lo que da esta misma aritmética sin cabeceras y con marco,
    // con el mostrador de la mano. O sea: el pliegue sale gratis.
    expect(
      mesasALaVistaDeMano(SIROPE, ANCHO, ALTO, undefined, undefined, {
        plegables: false,
        barCounter: BAR_COUNTER_HEIGHT_MANO,
      }),
    ).toBe(11);
    expect(aLaVista()).toBe(11);
  });

  it("SABOTAJE · a 56 px la cabecera se lleva tres mesas", () => {
    // La cuenta a mano, con los 56 de `MIN_TOUCH_PX` en vez de los 48.
    // BARRA se lleva tres filas de 88 y deja a SALÓN justo en el límite,
    // así que 8 px por zona empujan su primera fila fuera de la pantalla.
    expect(conCabeceraDe(56)).toBe(8);
    expect(conCabeceraDe(CABECERA_DE_ZONA_PX)).toBe(11);
  });

  it("SABOTAJE · si el marco se queda, la cabecera cuesta tres mesas", () => {
    // Esto es lo que pasaría si alguien devolviera el borde discontinuo
    // «que se veía mejor»: la cabecera deja de salir gratis.
    expect(conCabeceraDe(CABECERA_DE_ZONA_PX, true)).toBe(8);
  });

  /**
   * La misma cuenta que `mesasALaVistaDeMano`, con la cabecera y el
   * marco como parámetros, para poder sabotear los dos sin tocar el
   * módulo. Es el patrón que `n1-sala-de-mano` ya usa con `cardWidth`.
   */
  function conCabeceraDe(cab: number, conMarco = false): number {
    const columnas = 3;
    const huecoDeFila = 14;
    let y = 0;
    let vistas = 0;
    for (const z of SIROPE) {
      const marco = conMarco ? 2 * REPARTO_MANO.zonePadding + 2 : 0;
      const chrome = cab + marco + (z.isBar ? BAR_COUNTER_HEIGHT_MANO : 0);
      const filas = Math.ceil(z.tables / columnas);
      for (let r = 0; r < filas; r += 1) {
        const bottom = y + chrome + (r + 1) * 88 + r * huecoDeFila;
        if (bottom > ALTO) return vistas;
        vistas += Math.min(columnas, z.tables - r * columnas);
      }
      y += chrome + filas * 88 + (filas - 1) * huecoDeFila + ZONE_GAP;
    }
    return vistas;
  }
});

describe("n1-hosteleria-2 · plegada, la zona dice lo que importa", () => {
  it("la sala ENTERA cabe en una pantalla con las tres plegadas", () => {
    // Éste es el criterio del hallazgo, y es mejor que «9 de 23 mesas»:
    // con las tres plegadas el camarero ve el estado de TODA la sala sin
    // desplazar y sin zoom, y despliega la que va a trabajar.
    const alto = 3 * CABECERA_DE_ZONA_PX + 2 * ZONE_GAP;
    expect(alto).toBeLessThanOrEqual(ALTO);
    // Y sobra pantalla de verdad, no por un píxel.
    expect(ALTO - alto).toBeGreaterThan(300);
  });

  it("cuenta ocupadas, por recoger y con algo listo", () => {
    const mesas = [
      { id: "a", state: "FREE" },
      { id: "b", state: "OPEN" },
      { id: "c", state: "BILLING" },
      { id: "d", state: "POR_RECOGER" },
      { id: "e", state: "OPEN" },
    ];
    const r = resumenDeZona(mesas, new Set(["b", "e"]));
    // «Pide la cuenta» cuenta como ocupada: desde una cabecera plegada no
    // se decide nada distinto para una que para la otra.
    expect(r).toEqual({ total: 5, ocupadas: 3, porRecoger: 1, listas: 2 });
  });

  it("sólo nombra lo que NO es cero", () => {
    // Una cabecera que dijera «0 ocupadas · 0 por recoger · 0 listos» son
    // tres números para enterarse de que no pasa nada.
    expect(
      rotuloDeZonaPlegada({ total: 8, ocupadas: 0, porRecoger: 0, listas: 0 }),
    ).toBe("8 libres");
    expect(
      rotuloDeZonaPlegada({ total: 1, ocupadas: 0, porRecoger: 0, listas: 0 }),
    ).toBe("1 mesa libre");
    expect(
      rotuloDeZonaPlegada({ total: 8, ocupadas: 3, porRecoger: 0, listas: 0 }),
    ).toBe("3 ocupadas");
    expect(
      rotuloDeZonaPlegada({ total: 8, ocupadas: 1, porRecoger: 2, listas: 0 }),
    ).toBe("1 ocupada · 2 por recoger");
  });

  it("y lo urgente va primero: un plato en el pase se enfría", () => {
    const r = { total: 8, ocupadas: 3, porRecoger: 2, listas: 1 };
    expect(rotuloDeZonaPlegada(r)).toBe("1 listo · 3 ocupadas · 2 por recoger");
  });
});

describe("n1-hosteleria-2 · el pliegue se recuerda en el aparato", () => {
  beforeEach(() => olvidarZonasPlegadas());

  it("se guarda y se vuelve a leer", () => {
    guardarZonasPlegadas(new Set(["TERRAZA", "SALON"]));
    expect([...leerZonasPlegadas()].sort()).toEqual(["SALON", "TERRAZA"]);
  });

  it("sin nada guardado, las tres zonas están DESPLEGADAS", () => {
    expect(leerZonasPlegadas().size).toBe(0);
  });

  it("con basura dentro falla hacia desplegado, no hacia plegado", () => {
    // Una zona desplegada de más se ve y se pliega. Una plegada de más
    // esconde mesas que el camarero cree que no existen, y en un
    // servicio eso es una mesa sin atender.
    localStorage.setItem("mipiacetpv-zonas-plegadas", "{no es json");
    expect(leerZonasPlegadas().size).toBe(0);
    localStorage.setItem("mipiacetpv-zonas-plegadas", '{"TERRAZA":true}');
    expect(leerZonasPlegadas().size).toBe(0);
    localStorage.setItem("mipiacetpv-zonas-plegadas", '["TERRAZA",7,null]');
    expect([...leerZonasPlegadas()]).toEqual(["TERRAZA"]);
  });
});

describe("n1-hosteleria-2 · dónde se pliega y dónde no", () => {
  it("en la mano y en «Todas», sí", () => {
    expect(zonasSePliegan({ deMano: true, filtro: "ALL" })).toBe(true);
  });

  it("con el filtro de una zona puesto, no", () => {
    // Hay una sola sección en pantalla: plegarla deja el lienzo vacío con
    // una cabecera, y el camarero ya eligió qué quiere ver.
    for (const z of ["BARRA", "SALON", "TERRAZA", "RESERVADO"]) {
      expect(zonasSePliegan({ deMano: true, filtro: z })).toBe(false);
    }
  });

  it("en el TERMINAL nunca, pase lo que pase", () => {
    // Las 23 de Sirope caben enteras a 1280 y a 1442 (23/23 medidas), así
    // que plegar sólo quitaría de la vista algo que ya se ve. Es la
    // restricción del bloque.
    for (const f of ["ALL", "BARRA", "SALON", "TERRAZA"]) {
      expect(zonasSePliegan({ deMano: false, filtro: f })).toBe(false);
    }
  });

  it("una zona sin nombre NUNCA se considera plegada", () => {
    // Todo lo anterior a este bloque cuenta zonas sin nombrarlas. Sin
    // nombre, el lado seguro es desplegada.
    const sinNombre: RoomZone[] = [{ tables: 8, isBar: true }, { tables: 7 }];
    expect(
      mesasALaVistaDeMano(sinNombre, ANCHO, ALTO, undefined, undefined, {
        plegables: true,
        plegadas: new Set(["BARRA", "SALON", ""]),
        barCounter: BAR_COUNTER_HEIGHT_MANO,
      }),
    ).toBe(11);
  });
});
