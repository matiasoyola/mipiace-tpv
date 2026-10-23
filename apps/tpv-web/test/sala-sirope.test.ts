// auditoria-sirope (#13) · EL MAPA DE SALA SE ADAPTA A LA PANTALLA.
//
// `TABLE_SHAPE_SIZE` era un número fijo (144) calculado para el peor
// caso de La Maestranza a 1280 × 800. En el D8 de Sirope —tres zonas de
// pocas mesas a 1442 × 811— dejaba ≈ 190 px muertos a la derecha del
// lienzo (captura 23) y mesas más pequeñas de lo que cabía.
//
// La fila de la tabla de sabotajes que vive aquí:
//
//   | El reparto de sala ignora el ancho

import { describe, expect, it } from "vitest";

import {
  huecoALaDerecha,
  roomFitsWithoutScrollDark,
  TABLE_SHAPE_MAX,
  TABLE_SHAPE_MIN,
  TABLE_SHAPE_SIZE,
  tamanoDeMesaPara,
  type RoomZone,
} from "../src/lib/roomGrid.js";

/**
 * La sala de Sirope, **contada en producción el 18-10-2026**: BARRA 8,
 * SALÓN 7, TERRAZA 8 = 23 mesas, ninguna agrupada. En el orden en que
 * las pinta el lienzo (`ZONE_ORDER`, Barra primero).
 *
 * El 3 + 6 + 4 que había aquí eran 13 y no cuadraban con la pasada del
 * 18-10, que midió 23 sobre la cuenta real (hallazgo 1). Las
 * conclusiones de #13 no cambian: en el D8 sigue eligiendo 152, que es
 * lo que este banco afirma.
 */
const SIROPE: RoomZone[] = [
  { tables: 8, isBar: true },
  { tables: 7 },
  { tables: 8 },
];

/** La Maestranza, que es el caso que fijó el 144. */
const MAESTRANZA: RoomZone[] = [
  { tables: 4, isBar: true },
  { tables: 6 },
  { tables: 6 },
];

/** El D8 de Sirope. */
const D8 = { w: 1442, h: 811 };
/** El AP11 / el peor caso de v1.23. */
const AP11 = { w: 1280, h: 800 };

describe("#13 · el tamaño de mesa sale del ancho que hay", () => {
  it("en el D8, con pocas mesas, la mesa crece sobre los 144 fijos", () => {
    // EL SABOTAJE: devolver `TABLE_SHAPE_SIZE` a pelo deja los 190 px
    // muertos de la captura 23.
    const lado = tamanoDeMesaPara(SIROPE, D8.w, D8.h);
    expect(lado).toBeGreaterThan(TABLE_SHAPE_SIZE);
    expect(lado).toBeLessThanOrEqual(TABLE_SHAPE_MAX);
  });

  it("y la sala sigue cabiendo sin desplazar con ese tamaño", () => {
    const lado = tamanoDeMesaPara(SIROPE, D8.w, D8.h);
    expect(roomFitsWithoutScrollDark(SIROPE, D8.w, D8.h, lado)).toBe(true);
    // Y con el siguiente peldaño ya no: es el MAYOR que cabe, no uno
    // cualquiera que quepa.
    if (lado < TABLE_SHAPE_MAX) {
      expect(roomFitsWithoutScrollDark(SIROPE, D8.w, D8.h, lado + 4)).toBe(
        false,
      );
    }
  });

  it("el hueco muerto a la derecha se reduce", () => {
    const antes = huecoALaDerecha(SIROPE, D8.w, TABLE_SHAPE_SIZE);
    const despues = huecoALaDerecha(
      SIROPE,
      D8.w,
      tamanoDeMesaPara(SIROPE, D8.w, D8.h),
    );
    expect(antes).toBeGreaterThan(100);
    expect(despues).toBeLessThan(antes);
  });

  it("La Maestranza en el peor caso NO se encoge por debajo de lo que tenía", () => {
    // El 144 salió de aquí y tiene que seguir saliendo: esto no es una
    // regresión de v1.23, es el mismo número cuando toca.
    const lado = tamanoDeMesaPara(MAESTRANZA, AP11.w, AP11.h);
    expect(lado).toBeGreaterThanOrEqual(TABLE_SHAPE_SIZE);
    expect(roomFitsWithoutScrollDark(MAESTRANZA, AP11.w, AP11.h, lado)).toBe(
      true,
    );
  });

  it("una sala imposible no baja del suelo táctil", () => {
    // Treinta mesas en un móvil: desplaza, como hacía, pero ninguna mesa
    // se queda tan pequeña que se falle con el dedo.
    const enorme: RoomZone[] = [{ tables: 30 }, { tables: 30 }];
    expect(tamanoDeMesaPara(enorme, 360, 640)).toBe(TABLE_SHAPE_MIN);
  });

  it("una sala vacía se queda con el tamaño de siempre", () => {
    expect(tamanoDeMesaPara([], D8.w, D8.h)).toBe(TABLE_SHAPE_SIZE);
  });
});
