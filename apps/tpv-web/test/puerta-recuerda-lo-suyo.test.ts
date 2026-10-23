// residencia-6 (punto 3) · **SIN RED, LA PUERTA RECUERDA LO SUYO.**
//
// residencia-3 §15.3 lo dejó escrito: *«sin red, "lo que toca" sale todo
// como por hacer: la tablet no sabe qué se registró desde otra pantalla ni
// lo que no llegó a subir»*. La mitad que sí se puede saber es **lo
// propio**, y eso es lo que este fichero fija.
//
// El síntoma que quita, dicho como pasa en el pasillo: la auxiliar marca
// los siete cuidados de la 112 sin wifi, pulsa «Terminar», vuelve a
// entrar con su PIN —porque le han llamado de la 114— y la lista le sale
// ENTERA por hacer. O los repite, o se queda sin saber qué le falta.
//
// ── Lo que se comprueba, en orden ───────────────────────────────────
//
//   1. Lo apuntado **sobrevive a reabrir la app**, que es lo que de
//      verdad pasa (la pantalla se cierra sola al minuto y la APK se
//      reinicia).
//   2. Y **sobrevive a que la cola se vacíe**, que es por lo que esto no
//      puede leerse del outbox: el outbox se vacía al subir, y cinco
//      minutos después la pantalla volvería a mentir.
//   3. Se **poda por día del centro**: hoy y ayer, no meses.
//   4. Deshacer con red **lo borra**: si no, perder el wifi justo después
//      dejaría la pantalla diciendo que aquello sigue hecho.
//   5. Revocar el dispositivo **se lo lleva**, igual que el plan: dentro
//      hay qué se le hizo a quién y cuándo.
//   6. Y `yaHecho` lo cuenta como hecho, que es el punto de todo.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DIAS_EN_LA_TABLET,
  __resetPuertaCacheForTests,
  apuntarEnLaTablet,
  loApuntadoEnLaTablet,
  olvidarApuntado,
  olvidarLaPuerta,
  type RegistroEnLaTablet,
} from "../src/residencia/puerta-cache.js";
import { yaHecho } from "../src/residencia/puerta-gestos.js";

const HOY = "2026-10-15";
const AYER = "2026-10-14";
const HACE_UNA_SEMANA = "2026-10-08";

function registro(
  over: Partial<RegistroEnLaTablet> & { id: string },
): RegistroEnLaTablet {
  return {
    controlCode: "CAMBIO_POSTURAL",
    clientId: "carmen",
    valor: { tipo: "BOOL", hecho: true },
    nota: null,
    tieneVoz: false,
    recordedAt: "2026-10-15T08:20:00.000Z",
    careDay: HOY,
    occurrenceAt: "2026-10-15T08:00:00.000Z",
    shiftCode: null,
    sinTurno: false,
    firmadoPor: "Ana",
    firmadoPorUserId: "u-ana",
    rolCode: "AUXILIAR",
    anulado: false,
    corrigeA: null,
    vigente: true,
    enLaTablet: true,
    ...over,
  };
}

describe("lo que ESTA tablet apuntó", () => {
  beforeEach(async () => {
    await __resetPuertaCacheForTests();
    indexedDB = new IDBFactory();
  });

  it("sobrevive a REABRIR la app", async () => {
    await apuntarEnLaTablet([
      registro({ id: "r-1" }),
      registro({ id: "r-2", controlCode: "ANIMO", occurrenceAt: null }),
    ]);

    // Reabrir la app: se cierra la conexión cacheada del módulo, igual
    // que `puerta-sin-red.test.ts` hace con el outbox. La base de
    // `fake-indexeddb` **no** se recrea: es la del aparato.
    await __resetPuertaCacheForTests();

    const leidos = await loApuntadoEnLaTablet([HOY, AYER]);
    expect(leidos.map((r) => r.id).sort()).toEqual(["r-1", "r-2"]);
    // Y con la marca puesta, que es lo que la pantalla pinta.
    expect(leidos.every((r) => r.enLaTablet)).toBe(true);
  });

  it("y sobrevive a que la cola se VACÍE (por eso no se lee del outbox)", async () => {
    // El outbox se vacía al subir, que es su trabajo. Si la pantalla
    // leyera de ahí, cinco minutos después de volver el wifi volvería a
    // decir que no hay nada hecho — justo cuando se vuelve a caer.
    await apuntarEnLaTablet([registro({ id: "r-1" })]);
    // (aquí el lote sube y el outbox se queda vacío: esto no lo toca)
    expect(await loApuntadoEnLaTablet([HOY, AYER])).toHaveLength(1);
  });

  it("se poda por día del centro: hoy y ayer", async () => {
    expect(DIAS_EN_LA_TABLET).toBe(2);
    await apuntarEnLaTablet([
      registro({ id: "r-hoy" }),
      registro({ id: "r-ayer", careDay: AYER }),
      registro({ id: "r-viejo", careDay: HACE_UNA_SEMANA }),
    ]);

    const leidos = await loApuntadoEnLaTablet([HOY, AYER]);
    expect(leidos.map((r) => r.id).sort()).toEqual(["r-ayer", "r-hoy"]);

    // Y la poda es de verdad: el viejo ya NO está, ni aunque se pregunte
    // por su día. Sin esto, una tablet de pared acumularía meses de
    // registros de dos personas en una base que nadie mira.
    const otraVez = await loApuntadoEnLaTablet([HACE_UNA_SEMANA]);
    expect(otraVez).toHaveLength(0);
  });

  it("una corrección del mismo registro SOBRESCRIBE, no duplica", async () => {
    // La clave es el `id` que genera la tablet, que es el mismo que da la
    // idempotencia del envío (residencia-3 §1).
    await apuntarEnLaTablet([registro({ id: "r-1", firmadoPor: "Ana" })]);
    await apuntarEnLaTablet([registro({ id: "r-1", firmadoPor: "Rosa" })]);
    const leidos = await loApuntadoEnLaTablet([HOY]);
    expect(leidos).toHaveLength(1);
    expect(leidos[0]!.firmadoPor).toBe("Rosa");
  });

  it("DESHACER con red se lo lleva", async () => {
    await apuntarEnLaTablet([registro({ id: "r-1" }), registro({ id: "r-2" })]);
    await olvidarApuntado("r-1");
    expect((await loApuntadoEnLaTablet([HOY])).map((r) => r.id)).toEqual([
      "r-2",
    ]);
  });

  it("REVOCAR el dispositivo se lo lleva todo", async () => {
    // Dentro hay qué se le hizo a quién y a qué hora. Una tablet
    // desemparejada no se queda con eso, por lo mismo que no se queda con
    // el plan de cuidados ni con el roster.
    await apuntarEnLaTablet([registro({ id: "r-1" })]);
    await olvidarLaPuerta();
    expect(await loApuntadoEnLaTablet([HOY, AYER])).toHaveLength(0);
  });

  it("y `yaHecho` lo cuenta como HECHO · el punto de todo el bloque", async () => {
    await apuntarEnLaTablet([
      registro({
        id: "r-1",
        controlCode: "CAMBIO_POSTURAL",
        occurrenceAt: "2026-10-15T08:00:00.000Z",
      }),
    ]);
    const registros = await loApuntadoEnLaTablet([HOY]);

    // El mismo instante escrito de otra forma, que es el caso que
    // residencia-3 ya pagó: `queToca` da «…:00.000Z» y Postgres devuelve
    // «…:00Z». Se comparan como instantes.
    const hecho = yaHecho(registros, {
      controlCode: "CAMBIO_POSTURAL",
      at: "2026-10-15T08:00:00Z",
    });
    expect(hecho).not.toBeNull();
    expect(hecho!.enLaTablet).toBe(true);
    expect(hecho!.firmadoPor).toBe("Ana");

    // Y la ronda de las 12:00 sigue por hacer: lo recordado no marca de
    // más.
    expect(
      yaHecho(registros, {
        controlCode: "CAMBIO_POSTURAL",
        at: "2026-10-15T12:00:00.000Z",
      }),
    ).toBeNull();
  });
});
