// Capítulo 7 · El día: mirarlo y manejarlo.
//
// Tres superficies del mismo día: columnas por profesional (el mostrador),
// el filtro «mi día» de una profesional, y lo mismo a 390 en el móvil.
//
// Y lo que pasa de verdad en un día: una clienta que avisa de que no viene
// (cancelar) y una que no aparece ni avisa (no-show). Las dos tienen que
// DEVOLVER el hueco: `assignment.active = false` es la columna del WHERE del
// EXCLUDE, así que un hueco cancelado deja de bloquear. Eso no se comprueba
// mirando la fila: se comprueba RESERVANDO encima.
//
// agenda-lista · MOVER UNA CITA YA SE PUEDE, desde el detalle. Lo que se
// comprueba aquí es lo que le importa a Sole: que la cita se mueve de
// verdad (pantalla y BD), que CONSERVA SU ID —cancelar y volver a dar la
// cita perdía el histórico, que era el único camino hasta ahora—, que
// CONSERVA SU PROFESIONAL (la clienta cambia de hora, no de peluquera) y
// que un destino imposible se explica y no toca nada. Arrastrar la
// tarjeta sigue sin existir, y es una decisión del bloque, no un olvido.

import { expect, test } from "@playwright/test";

import { asignaciones, cerrarBd, citas } from "../lib/bd.js";
import {
  entrarTpv,
  turnoAbierto,
} from "../lib/entrar.js";
import {
  elegirClienta,
  elegirServicio,
  irAlDia,
  pulsarFranja,
  reservar,
} from "../lib/agenda-ui.js";
import { AP11, MOVIL } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { PROFESIONALES, semanaDelVideo } from "../seed/escenario.js";

const CAP = "Capítulo 7 · El día";
const MARTA = PROFESIONALES[0]!;
const LUCIA = PROFESIONALES[1]!;
const SEMANA = semanaDelVideo();

/** La cita de Pili: la que se cancela. */
const CORTE_DE_PILI = "09:30";
/** La de Sonia: la que no viene. */
const CORTE_DE_SONIA = "11:30";
/** Las mechas de Mari Carmen (capítulo 6). Las mueve —y las devuelve— el
 *  test de mover: sólo las hace Marta, así que no cambia de columna. */
const MECHAS_DE_CARMEN = "12:30";
/** El tinte de Rosa, en sus dos mitades (capítulo 6). Las dos las sabe
 *  hacer Marta Y Lucía desde el capítulo 5, que es lo que hace útil al
 *  test de «los huecos son los suyos». */
const TINTE_APLICA_DE_ROSA = "09:00";
const TINTE_LAVA_DE_ROSA = "10:15";

async function abrirAgenda(page: import("@playwright/test").Page) {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await page.getByRole("button", { name: "Agenda" }).click();
  await irAlDia(page, SEMANA.diaNormal);
  await expect(
    page.locator(`[data-columna="${MARTA.id}"]`),
  ).toBeVisible({ timeout: 30_000 });
}

/** "HH:MM" en hora del centro. Las horas de la BD vienen en UTC y lo que
 *  se compara es lo que la cajera lee en pantalla. */
function hhmmEnMadrid(d: Date): string {
  return d.toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Abre el detalle de la cita que empieza a una hora dada en la columna de
 *  una profesional. Las tarjetas llevan `data-cita=<id>`; se localizan por la
 *  hora que pintan, que es lo que ve la cajera. */
function tarjetaDeLaCita(
  page: import("@playwright/test").Page,
  staffUserId: string,
  hhmm: string,
) {
  return page
    .locator(`[data-columna="${staffUserId}"] [data-cita]`)
    .filter({ hasText: hhmm });
}

test.describe("en el mostrador", () => {
  test.use(AP11);

  test("las tres columnas, y el día de una sola", async ({ page }) => {
    await abrirAgenda(page);
    await portada(page, "Un día normal", CAP);

    // Las tres profesionales, cada una en su columna.
    for (const p of PROFESIONALES) {
      await expect(page.locator(`[data-columna="${p.id}"]`)).toBeVisible();
    }
    await rotulo(page, "El día entero: una columna por profesional.", CAP);
    await esconder(page);

    // Y «mi día»: el filtro deja una sola columna.
    await page.locator("select").selectOption(LUCIA.id);
    await expect(page.locator(`[data-columna="${LUCIA.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-columna="${MARTA.id}"]`)).toHaveCount(0);
    await rotulo(page, "O el día de una sola: «mi día».", CAP);
    await esconder(page);

    await page.locator("select").selectOption("");
    await expect(page.locator(`[data-columna="${MARTA.id}"]`)).toBeVisible();
  });

  test("una clienta avisa de que no viene: el hueco vuelve", async ({ page }) => {
    await abrirAgenda(page);
    await rotulo(page, "Pili llama: no puede venir.", CAP);
    await esconder(page);

    const antes = await citas();
    await tarjetaDeLaCita(page, MARTA.id, CORTE_DE_PILI).click();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(
      page.locator('[data-estado="CANCELLED"]'),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Cerrar" }).last().click();

    // En la BD: la cita cancelada y su asignación DESACTIVADA — que es la
    // columna del WHERE del EXCLUDE.
    const despues = await citas();
    expect(despues).toHaveLength(antes.length);
    const canceladas = despues.filter((c) => c.status === "CANCELLED");
    expect(canceladas).toHaveLength(1);
    const asg = await asignaciones();
    const suya = asg.find((a) => a.appointmentId === canceladas[0]!.id)!;
    expect(suya.active).toBe(false);

    // Y la prueba de verdad: el hueco se puede volver a dar.
    await rotulo(page, "Y el hueco de Pili se puede volver a dar.", CAP);
    await esconder(page);
    await pulsarFranja(page, MARTA.id, CORTE_DE_PILI);
    await elegirClienta(page, "Mari Carmen");
    await elegirServicio(page, "Corte");
    await reservar(page);

    const conLaNueva = await citas();
    expect(conLaNueva).toHaveLength(antes.length + 1);
    const activas = (await asignaciones()).filter(
      (a) => a.active && a.staffUserId === MARTA.id,
    );
    // Dos asignaciones activas a las 09:30 habría sido el solape que el
    // EXCLUDE tiene que impedir: la cancelada no cuenta.
    const aEsaHora = activas.filter(
      (a) =>
        a.inicio.toLocaleTimeString("es-ES", {
          timeZone: "Europe/Madrid",
          hour: "2-digit",
          minute: "2-digit",
        }) === CORTE_DE_PILI,
    );
    expect(aEsaHora).toHaveLength(1);
  });

  test("una clienta que no aparece: no-show", async ({ page }) => {
    await abrirAgenda(page);
    await rotulo(page, "Sonia no ha venido ni ha avisado.", CAP);
    await esconder(page);

    await tarjetaDeLaCita(page, MARTA.id, CORTE_DE_SONIA).click();
    await page.getByRole("button", { name: "No-show" }).click();
    await expect(
      page.locator('[data-estado="NO_SHOW"]'),
    ).toBeVisible({ timeout: 20_000 });
    await esconder(page);

    const noShow = (await citas()).filter((c) => c.status === "NO_SHOW");
    expect(noShow).toHaveLength(1);
    const asg = await asignaciones();
    expect(asg.find((a) => a.appointmentId === noShow[0]!.id)!.active).toBe(
      false,
    );
  });

  test("mover una cita: a otra hora, y de vuelta, con el mismo id", async ({
    page,
  }) => {
    // agenda-lista (hallazgo 🟡 6) · ESTE TEST DECÍA QUE NO SE PODÍA.
    //
    // La API lo soportaba desde B-reservas (`PATCH` con `start`) y el
    // cliente del TPV también (`patchAppointment`), pero la pantalla sólo
    // mandaba `status`. En una peluquería las clientas cambian de hora
    // todos los días y el único camino era cancelar y volver a darla —
    // que PIERDE el histórico de la cita original. Por eso lo que aquí se
    // comprueba, además de la hora, es que el id NO cambia.
    //
    // Arrastrar la tarjeta sigue sin existir, y es una decisión: un
    // detalle claro con dedo de peluquera vale más que un arrastre que
    // falla en el AP12.
    //
    // SE MUEVE LAS MECHAS DE CARMEN (12:30), y se devuelven a su sitio al
    // final. Dos razones, y las dos costaron una pasada:
    //
    //   · **el estado se arrastra entre capítulos.** El 8 cobra las citas
    //     de Rosa de las 09:00 y las 10:15. La primera versión de este
    //     test movía la de las 09:00 y dejaba el 8 y el 9 en rojo
    //     («Expected: 40 · Received: 10» en el arqueo) por un cambio que
    //     no tenía nada que ver con cobrar.
    //   · **las mechas sólo las hace Marta** (la matriz del capítulo 3).
    //     Mover reprograma con `staffUserId: null` —el motor elige a
    //     quien sabe—, así que con cualquier otro servicio la cita podría
    //     caer en otra columna y el test diría cosas distintas según el
    //     día. Con las mechas no hay más candidata que Marta.
    await abrirAgenda(page);

    const tarjeta = tarjetaDeLaCita(page, MARTA.id, MECHAS_DE_CARMEN).first();
    await expect(tarjeta).toBeVisible({ timeout: 20_000 });
    const id = (await tarjeta.getAttribute("data-cita")) as string;
    expect(id).toBeTruthy();
    const antes = (await citas()).find((c) => c.id === id);
    expect(antes).toBeDefined();

    await tarjeta.click();
    await rotulo(page, "Carmen no puede a las doce y media.", CAP);
    await esconder(page);

    await page.locator('[data-accion="mover-cita"]').click();
    const hoja = page.locator('[data-panel="mover-cita"]');
    await expect(hoja).toBeVisible({ timeout: 20_000 });
    // El mismo control que el alta: el día nativo y «Buscar hueco».
    await expect(hoja.locator("#mover-dia")).toHaveValue(SEMANA.diaNormal);
    await hoja.locator('[data-accion="buscar-hueco-mover"]').click();

    // El último hueco del día: el más lejos de donde está, para que «se ha
    // movido» no se pueda confundir con «no se ha movido».
    const chips = hoja.locator("button[aria-pressed]");
    await expect(chips.first()).toBeVisible({ timeout: 20_000 });
    const horaNueva = ((await chips.last().textContent()) ?? "").trim();
    expect(horaNueva).toMatch(/^\d{2}:\d{2}$/);
    expect(horaNueva).not.toBe(MECHAS_DE_CARMEN);
    await chips.last().click();

    await expect(hoja.locator('[data-accion="confirmar-mover"]')).toHaveText(
      `Mover a las ${horaNueva}`,
    );
    await hoja.locator('[data-accion="confirmar-mover"]').click();

    // En pantalla: la MISMA tarjeta, en su hora nueva, y ya no a las 12:30.
    await expect(
      page.locator(`[data-cita="${id}"]`).filter({ hasText: horaNueva }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      tarjetaDeLaCita(page, MARTA.id, MECHAS_DE_CARMEN),
    ).toHaveCount(0);
    await rotulo(page, `Movida a las ${horaNueva}.`, CAP);
    await esconder(page);

    // En la BD: LA MISMA FILA con otra hora. Ni una cancelada y otra nueva.
    const despues = (await citas()).find((c) => c.id === id);
    expect(despues).toBeDefined();
    expect(despues!.status).toBe(antes!.status);
    expect(hhmmEnMadrid(despues!.inicio)).toBe(horaNueva);

    // Y SIGUE SIENDO DE MARTA. Mover cambia la hora, no la peluquera:
    // el PATCH fija la profesional que la cita ya tenía. Antes el motor
    // reprogramaba con `null` y elegía a quien estuviera libre.
    const suyaDespues = (await asignaciones()).filter(
      (x) => x.appointmentId === id && x.active,
    );
    expect(suyaDespues).toHaveLength(1);
    expect(suyaDespues[0]!.staffUserId).toBe(MARTA.id);

    // La hoja se pliega sola al acabar: el trámite está hecho y lo que
    // tiene que verse es el detalle con su hora nueva. Dejarla abierta con
    // los chips del día viejo pide a gritos mover dos veces la misma cita
    // (lo destapó este mismo test, en la primera pasada).
    await expect(hoja).toHaveCount(0);

    // Y de vuelta a su sitio, que es lo que pasa cuando la clienta vuelve
    // a llamar. Deja el día como estaba para los capítulos 8 y 9.
    await page.locator(`[data-cita="${id}"]`).first().click();
    await page.locator('[data-accion="mover-cita"]').click();
    await hoja.locator('[data-accion="buscar-hueco-mover"]').click();
    await hoja
      .getByRole("button", { name: MECHAS_DE_CARMEN, exact: true })
      .click();
    await hoja.locator('[data-accion="confirmar-mover"]').click();

    await expect(
      tarjetaDeLaCita(page, MARTA.id, MECHAS_DE_CARMEN),
    ).toHaveCount(1, { timeout: 20_000 });
    const devuelta = (await citas()).find((c) => c.id === id);
    expect(hhmmEnMadrid(devuelta!.inicio)).toBe(MECHAS_DE_CARMEN);
    expect(devuelta!.fin.getTime()).toBe(antes!.fin.getTime());
  });

  test("los huecos que ofrece mover son los de SU profesional", async ({
    page,
  }) => {
    // El otro lado de «mover conserva la profesional»: si el PATCH la
    // fija, la lista de horas tiene que ser la de ELLA. Con `null` la
    // hoja enseñaría horas en las que está libre OTRA, y al pulsar Mover
    // saldría un «no» sobre una hora que la pantalla acababa de ofrecer.
    //
    // Se mira con el tinte de las 10:15 de Rosa, que desde el capítulo 5
    // saben hacer Marta Y Lucía: a las 09:00 Marta está con la primera
    // mitad del tinte y Lucía está libre, así que esa hora sólo puede
    // aparecer en la lista si alguien dejó de fijar a Marta.
    //
    // NO MUEVE NADA: abre la hoja, mira y cancela. Los capítulos 8 y 9
    // cobran estas citas.
    await abrirAgenda(page);
    await tarjetaDeLaCita(page, MARTA.id, TINTE_LAVA_DE_ROSA).first().click();
    await page.locator('[data-accion="mover-cita"]').click();
    const hoja = page.locator('[data-panel="mover-cita"]');
    await hoja.locator('[data-accion="buscar-hueco-mover"]').click();

    const chips = hoja.locator("button[aria-pressed]");
    await expect(chips.first()).toBeVisible({ timeout: 20_000 });
    const horas = (await chips.allTextContents()).map((h) => h.trim());
    expect(horas.length).toBeGreaterThan(0);
    expect(horas).not.toContain(TINTE_APLICA_DE_ROSA);

    await hoja.getByRole("button", { name: "cancelar" }).click();
    await expect(hoja).toHaveCount(0);
  });

  test("mover a un día cerrado: el motivo con su nombre, y la BD no se mueve", async ({
    page,
  }) => {
    // El «no» que Sole va a pisar de verdad al teclear una fecha: el
    // festivo del capítulo 4. El motor contesta lo mismo que al dar de
    // alta —no hay dos vocabularios— y la cita no se mueve ni cambia de
    // estado: `start` y `status` son ramas distintas del PATCH.
    //
    // El «no» por hueco OCUPADO no se puede pedir desde esta pantalla, y
    // es la misma razón que el `EXCLUDE` del §2 del done del banco: los
    // chips sólo ofrecen huecos libres, calculados con el mismo motor que
    // luego mueve. Decir que el banco lo cubre sería mentir. Ese caso
    // —dos movimientos a la vez, el segundo pierde con `409 TAKEN` y la
    // cita se queda donde estaba— está cubierto por la API, en
    // `apps/api/test-e2e/agenda-carrera.e2e.ts` (casos 4 y 5).
    await abrirAgenda(page);
    const antes = await citas();

    const viva = page
      .locator(`[data-columna="${MARTA.id}"] [data-cita]`)
      .first();
    await expect(viva).toBeVisible({ timeout: 20_000 });
    await viva.click();
    await page.locator('[data-accion="mover-cita"]').click();
    const hoja = page.locator('[data-panel="mover-cita"]');
    await hoja.locator("#mover-dia").fill(SEMANA.festivo);
    await hoja.locator('[data-accion="buscar-hueco-mover"]').click();

    // Ni un hueco que ofrecer, y el panel lo dice en vez de quedarse en
    // blanco. El botón de mover sigue apagado porque no hay hora elegida.
    await expect(hoja.getByText(/No hay huecos ese día/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      hoja.locator('[data-accion="confirmar-mover"]'),
    ).toBeDisabled();
    await rotulo(page, "Ese día el centro está cerrado.", CAP);
    await esconder(page);

    // Y la BD, intacta: ni la hora ni el estado de ninguna cita.
    const despues = await citas();
    expect(despues).toEqual(antes);
  });
});

test.describe("en el móvil de una profesional", () => {
  test.use(MOVIL);

  test("el día cabe en una columna", async ({ page }) => {
    await abrirAgenda(page);
    await rotulo(page, "Y lo mismo en el móvil.", CAP);
    await esconder(page);

    // A 390 la cabecera se compacta (el título y las flechas se van) pero el
    // día y el filtro siguen ahí: es la vista «mi día».
    await expect(page.locator("[data-ir-a-dia]")).toBeVisible();
    await page.locator("select").selectOption(MARTA.id);
    await expect(page.locator(`[data-columna="${MARTA.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-columna="${LUCIA.id}"]`)).toHaveCount(0);
    await expect(
      page.locator(`[data-columna="${MARTA.id}"] [data-cita]`).first(),
    ).toBeVisible();
  });
});

test.describe("el nombre de la clienta en un dispositivo nuevo", () => {
  test.use(AP11);

  test("la agenda trae los nombres sin pasar por Clientes", async ({ page }) => {
    // agenda-lista (hallazgo 🟡 1) · ESTE TEST DECÍA LO CONTRARIO.
    //
    // Hasta este bloque el nombre que pinta cada tarjeta salía de la caché
    // local de clientes y esa caché la llenaba SÓLO la pantalla Clientes:
    // en un dispositivo recién emparejado —el AP11 el primer día en casa
    // de Sole— la agenda abría con TODAS las citas diciendo «Sin nombre»
    // y la recepción no sabía de quién era la cita de las diez.
    //
    // Ahora la agenda se asegura ella de tener los nombres al abrirse
    // (`asegurarClientesEnCache`, que reutiliza el mismo `refreshClients`
    // de la pantalla Clientes). Lo que se comprueba aquí es justo eso: un
    // contexto NUEVO —IndexedDB y localStorage vacíos, como un
    // emparejamiento de hace un rato— y NADIE abre Clientes en todo el
    // test.
    await entrarTpv(page, MARTA.email);
    await turnoAbierto(page);
    await page.getByRole("button", { name: "Agenda" }).click();
    await irAlDia(page, SEMANA.diaNormal);

    const tarjetas = page.locator(`[data-columna="${MARTA.id}"] [data-cita]`);
    await expect(tarjetas.first()).toBeVisible({ timeout: 30_000 });
    await expect(
      tarjetas.filter({ hasText: "Rosa" }).first(),
    ).toBeVisible({ timeout: 30_000 });
    // Y ni una tarjeta huérfana: las tres citas del día tienen su nombre.
    await expect(tarjetas.filter({ hasText: "Sin nombre" })).toHaveCount(0);

    await rotulo(
      page,
      "Dispositivo recién emparejado: la agenda ya sabe de quién es cada cita.",
      CAP,
    );
    await esconder(page);
  });
});
