// personal-1 · LA MEDIDA: `comprobarCuadrante` sobre 21 personas × 31 días.
//
// «Tiene que pintarse al momento» (el prompt). La pantalla la llama en
// cada toque mientras alguien pinta el mes, así que lo que importa no es
// que termine: es que termine **dentro de un fotograma**.
//
// ── LOS DOS PRESUPUESTOS, Y POR QUÉ SON TAN DISTINTOS ───────────────
//
// **En caliente, 10 ms**, que es el que de verdad guarda algo: es lo que
// la pantalla paga en cada toque, y es donde se vería una regla nueva que
// recorra el mes otra vez. Medido a solas da 3 ms y en medio de la suite
// 5-6; diez deja margen y sigue siendo un techo.
//
// **En frío, 60 ms**, deliberadamente holgado. La primera pasada la domina
// la inicialización de `Intl`, que bajo la carga de 482 ficheros de test
// repartidos por los núcleos da entre 8 y 16 ms sin que el código haya
// cambiado nada. Un presupuesto ajustado ahí es un test que se pone rojo
// según lo que corra al lado — y ya pasó una vez.
//
// Lo que esto significa y conviene no esconder: **el presupuesto en frío
// casi no guarda nada**. Lo que cubre el caso que importa —que alguien
// quite la memoria de `instanteDePared`— es el de caliente: sin ella las
// dos medidas se van a 24 ms, y el de 10 lo caza.

import { describe, expect, it } from "vitest";

import {
  REGLAS_DE_SERIE,
  comprobarCuadrante,
  diasDe,
  olvidarInstantes,
  type CeldaDelCuadrante,
  type Cuadrante,
  type PersonaDelCuadrante,
  type TurnoDelCuadrante,
} from "../src/index.js";

/** El mes más largo, el centro entero y todas las reglas encendidas. */
function cuadranteDeJardinDeGredos(): Cuadrante {
  const turnos: TurnoDelCuadrante[] = [
    { id: "M", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00", sortOrder: 1, coberturaMinima: 4 },
    { id: "T", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00", sortOrder: 2, coberturaMinima: 3 },
    { id: "N", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00", sortOrder: 3, coberturaMinima: 2 },
  ];
  const personas: PersonaDelCuadrante[] = Array.from({ length: 21 }, (_, i) => ({
    employeeId: `p${i}`,
    nombre: `Persona ${i}`,
    // Dos administrativas, el resto atención directa.
    atencionDirecta: i >= 2,
    minutosContratados: 40 * 60,
    altaEl: "2026-01-01",
    finEl: null,
  }));
  const dias = diasDe("2026-07");
  const celdas: CeldaDelCuadrante[] = [];
  const ocupacionPorDia: Record<string, number> = {};
  for (const [d, dia] of dias.entries()) {
    ocupacionPorDia[dia] = 48;
    for (const [p, persona] of personas.entries()) {
      // Un reparto que rota: cada persona hace M, T, N y libra.
      const cual = (d + p) % 4;
      celdas.push(
        cual === 3
          ? { employeeId: persona.employeeId, dia, turnoId: null, ausencia: "LIBRE" }
          : {
              employeeId: persona.employeeId,
              dia,
              turnoId: ["M", "T", "N"][cual]!,
              ausencia: null,
            },
      );
    }
  }
  return { mes: "2026-07", turnos, personas, celdas, ocupacionPorDia };
}

describe("la medida de comprobarCuadrante", () => {
  it("21 personas × 31 días, con las ocho reglas, en frío y en caliente", () => {
    const c = cuadranteDeJardinDeGredos();
    expect(c.celdas).toHaveLength(21 * 31);
    const reglas = { ...REGLAS_DE_SERIE, conRatioDeResidencia: true };

    // Una pasada para que V8 compile, y se tira la medida.
    comprobarCuadrante(c, reglas);

    // ── LO QUE SE MIDE ES EL MÍNIMO, NO LA MEDIA ─────────────────────
    //
    // Y es una decisión, no un truco para que pase: esta medida corre
    // dentro de `pnpm test`, con 230 ficheros más repartidos por los
    // núcleos de la máquina. La media de veinte pasadas recoge el rato en
    // que el planificador le dio la CPU a otro —medido: 5 ms a solas, 16
    // en medio de la suite— y un presupuesto sobre eso se pone rojo según
    // lo que haya corriendo al lado. Un test que falla por eso es un test
    // que se aprende a reintentar.
    //
    // El mínimo es lo que la máquina SÍ puede hacer, y una regla nueva que
    // duplique el trabajo lo duplica igual. Lo que el mínimo no detecta es
    // un empeoramiento que sólo aparezca bajo carga, y de eso este
    // presupuesto no habla.
    const minimoDe = (cuantas: number, antes?: () => void): number => {
      let mejor = Infinity;
      for (let i = 0; i < cuantas; i += 1) {
        antes?.();
        const t0 = performance.now();
        comprobarCuadrante(c, reglas);
        mejor = Math.min(mejor, performance.now() - t0);
      }
      return mejor;
    };

    // EN FRÍO: sin la memoria de los instantes. Es lo que paga el primer
    // toque después de abrir el mes.
    const enFrio = minimoDe(5, olvidarInstantes);
    // EN CALIENTE: lo que paga cada uno de los toques siguientes, que son
    // todos los demás.
    const enCaliente = minimoDe(20);

    // eslint-disable-next-line no-console
    console.log(
      `comprobarCuadrante · 21 × 31 · frío ${enFrio.toFixed(2)} ms · caliente ${enCaliente.toFixed(2)} ms (mínimo de 5 y de 20)`,
    );
    expect(enFrio).toBeLessThan(60);
    expect(enCaliente).toBeLessThan(10);
    // Y que devuelve algo: una medida sobre una función que no hace nada
    // es una medida que no dice nada.
    expect(comprobarCuadrante(c, reglas).length).toBeGreaterThan(0);
  });
});
