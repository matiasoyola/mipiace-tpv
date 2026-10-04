// Capítulo 6 · Reservar desde el TPV: los sí y los no.
//
// Los «no» son la mitad que de verdad protege a Sole, y cada uno comprueba
// DOS cosas: el mensaje que ve la cajera —delante de la clienta— y que la
// base de datos no se movió. Un rechazo que deja rastro es peor que no
// rechazar.
//
// Todas las citas se cuelgan de la columna de una profesional concreta
// (`openSlotFirst`): es lo que fija QUIÉN atiende, y sin eso el motor elegiría
// a cualquiera que supiera el servicio y el capítulo no demostraría nada.

import { expect, test } from "@playwright/test";

import {
  asignaciones,
  cerrarBd,
  citas,
  clientas,
  fotoDeLaAgenda,
} from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
import {
  crearClienta,
  elegirClienta,
  elegirServicio,
  irAlDia,
  hhmmDe,
  masMinutos,
  minutosDe,
  panel,
  pulsarFranja,
  pulsarFranjaRechazada,
  reservar,
} from "../lib/agenda-ui.js";
import { AP11 } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import {
  CLIENTA_NUEVA,
  PAUSA_EXPOSICION_MIN,
  PROFESIONALES,
  semanaDelVideo,
} from "../seed/escenario.js";

const CAP = "Capítulo 6 · Reservar";

/** Hoy en Madrid, en `YYYY-MM-DD`: el `min` del selector de día lo pone el
 *  front con el reloj del navegador, que el banco fija en Europe/Madrid. */
function hoyEnMadrid(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
  }).format(new Date());
}

/** El día de la semana en Madrid, ISO-8601 (1 = lunes … 7 = domingo). */
function isoWeekdayEnMadrid(): number {
  const corto = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    weekday: "short",
  }).format(new Date());
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[corto] ?? 0;
}

/** Los minutos transcurridos del día en Madrid. */
function minutosEnMadrid(): number {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return minutosDe(hhmm);
}
const MARTA = PROFESIONALES[0]!;
const LUCIA = PROFESIONALES[1]!;
const SEMANA = semanaDelVideo();

// El día del vídeo y las horas de cada cita. Fijas y no «el primer hueco»:
// una cita que cae donde el motor quiera no demuestra que el hueco de la
// exposición del tinte sea un hueco de verdad.
const TINTE_APLICA = "09:00";
const CORTE_EN_LA_PAUSA = masMinutos(TINTE_APLICA, 30);
const TINTE_LAVA = masMinutos(TINTE_APLICA, 30 + PAUSA_EXPOSICION_MIN);
const CORTE_SONIA = "11:30";
const MECHAS_CARMEN = "12:30";
/** Un corte por la tarde en la columna de Lucía: Irene ya se ha ido. */
const CORTE_DE_LUCIA = "16:00";

test.use(AP11);

test.afterAll(async () => {
  await cerrarBd();
});

/** Abre la agenda del día normal con la sesión de Marta. */
async function agendaDelDia(page: import("@playwright/test").Page) {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await page.getByRole("button", { name: "Agenda" }).click();
  await irAlDia(page, SEMANA.diaNormal);
  await expect(
    page.locator(`[data-columna="${MARTA.id}"]`),
  ).toBeVisible({ timeout: 30_000 });
  return page;
}

test("el tinte en dos mitades, y un corte dentro de la exposición", async ({
  page,
}) => {
  await agendaDelDia(page);
  await portada(page, "Un día de reservas", CAP);

  // 1 · Rosa, tinte: la aplicación.
  await rotulo(page, "Rosa viene a teñirse. Primero, la aplicación.", CAP);
  await esconder(page);
  await pulsarFranja(page, MARTA.id, TINTE_APLICA);
  await elegirClienta(page, "Rosa");
  await elegirServicio(page, "Tinte · aplicación");
  await reservar(page);

  // 2 · Y en la exposición, el corte de Pili. Con la MISMA profesional: es
  // lo que demuestra que el hueco es de verdad.
  await rotulo(
    page,
    `Rosa está con el tinte puesto ${PAUSA_EXPOSICION_MIN} minutos. ` +
      "Marta no se queda mirando: corta a Pili.",
    CAP,
  );
  await esconder(page);
  await pulsarFranja(page, MARTA.id, CORTE_EN_LA_PAUSA);
  await elegirClienta(page, "Pili");
  await elegirServicio(page, "Corte");
  await reservar(page);

  // 3 · Y después, el lavado y peinado de Rosa.
  await rotulo(page, "Y al acabar la exposición, el lavado de Rosa.", CAP);
  await esconder(page);
  await pulsarFranja(page, MARTA.id, TINTE_LAVA);
  await elegirClienta(page, "Rosa");
  await elegirServicio(page, "Tinte · lavado y peinado");
  await reservar(page);

  // En la BD: tres citas, las tres de Marta, y la de Pili ENTRE las dos de
  // Rosa sin pisar ninguna.
  const todas = await citas();
  expect(todas).toHaveLength(3);
  const asg = await asignaciones();
  expect(asg).toHaveLength(3);
  for (const a of asg) {
    expect(a.staffUserId).toBe(MARTA.id);
    expect(a.active).toBe(true);
  }
  const horas = asg.map((a) =>
    a.inicio.toLocaleTimeString("es-ES", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  expect(horas).toEqual([TINTE_APLICA, CORTE_EN_LA_PAUSA, TINTE_LAVA]);
});

test("una clienta nueva, sólo con el nombre de pila", async ({ page }) => {
  await agendaDelDia(page);
  await rotulo(page, "Una clienta nueva. Sole la apunta por el nombre.", CAP);
  await esconder(page);

  const antes = (await clientas()).length;
  await pulsarFranja(page, MARTA.id, CORTE_SONIA);
  await crearClienta(page, CLIENTA_NUEVA.firstName);
  await elegirServicio(page, "Corte");
  await reservar(page);

  // En la BD: la ficha nueva con el apellido VACÍO (la columna es NOT NULL)
  // y la cita colgada de ella.
  const fichas = await clientas();
  expect(fichas).toHaveLength(antes + 1);
  const sonia = fichas.find((c) => c.firstName === CLIENTA_NUEVA.firstName);
  expect(sonia, "no se creó la ficha de la clienta nueva").toBeTruthy();
  expect(sonia!.lastName).toBe("");
  const suya = (await citas()).filter((c) => c.clientId === sonia!.id);
  expect(suya).toHaveLength(1);
});

test("una clienta que ya está, buscada por su nombre", async ({ page }) => {
  await agendaDelDia(page);
  await rotulo(page, "Carmen ya está en la ficha: se busca y se elige.", CAP);
  await esconder(page);

  const antes = (await clientas()).length;
  await pulsarFranja(page, MARTA.id, MECHAS_CARMEN);
  await elegirClienta(page, "Carmen", "Carmen Ruiz");
  await elegirServicio(page, "Mechas");
  await reservar(page);

  // En la BD: NO se creó ninguna ficha, y la cita cuelga de la de Carmen.
  const fichas = await clientas();
  expect(fichas).toHaveLength(antes);
  const carmen = fichas.find((c) => c.firstName === "Carmen")!;
  expect((await citas()).some((c) => c.clientId === carmen.id)).toBe(true);
});

test("la cita cae en la columna que se ha tocado", async ({ page }) => {
  await agendaDelDia(page);

  // Esto es la promesa de la rejilla: tocar la columna de Lucía reserva CON
  // LUCÍA, no «con quien pueda». Lo hace `openSlotFirst` fijando
  // `staffUserId`, y el motor filtra los candidatos por él
  // (`engine.ts:206-208`).
  //
  // Tiene test propio porque sin él NO ESTABA CUBIERTO: al sabotear ese
  // filtro, el banco entero seguía en verde. El corte lo saben las tres y a
  // esta hora Irene ya se ha ido, así que sin el filtro el motor elegiría a
  // Marta — que es lo que pone rojo este test.
  await rotulo(page, "Se toca la columna de Lucía: la cita es de Lucía.", CAP);
  await esconder(page);

  await pulsarFranja(page, LUCIA.id, CORTE_DE_LUCIA);
  await elegirClienta(page, "Pili");
  await elegirServicio(page, "Corte");
  await reservar(page);

  const asg = await asignaciones();
  const aEsaHora = asg.filter(
    (a) =>
      a.active &&
      a.inicio.toLocaleTimeString("es-ES", {
        timeZone: "Europe/Madrid",
        hour: "2-digit",
        minute: "2-digit",
      }) === CORTE_DE_LUCIA,
  );
  expect(aEsaHora).toHaveLength(1);
  expect(aEsaHora[0]!.staffUserId).toBe(LUCIA.id);
});

test("el no del solape: la cita se alargaría sobre otra", async ({ page }) => {
  await agendaDelDia(page);

  // Una franja YA OCUPADA no se puede ni pulsar: la tarjeta de la cita está
  // encima y el toque abre su detalle, no un alta. O sea que el solape de
  // «misma hora» la pantalla ni lo ofrece. El solape que SÍ se puede pedir es
  // el que se alarga: a las 10:00 Marta está libre, pero unas mechas duran
  // 120 minutos y a las 10:15 empieza el lavado de Rosa.
  await rotulo(page, "Unas mechas a las diez: no caben antes del lavado.", CAP);
  await esconder(page);

  const antes = await fotoDeLaAgenda();
  await pulsarFranja(page, MARTA.id, "10:00");
  await elegirClienta(page, "Mari Carmen");
  await elegirServicio(page, "Mechas");
  const p = panel(page);
  await p.reservar.click();

  // El mensaje que ve la cajera, y las alternativas que le ofrece para
  // decirlas por teléfono.
  await expect(
    page.getByText(/no está disponible|no me queda|Te puedo dar/i).first(),
  ).toBeVisible({ timeout: 20_000 });
  await rotulo(page, "La agenda dice que no, y ofrece otras horas.", CAP);
  await esconder(page);

  // Y la BD, intacta.
  expect(await fotoDeLaAgenda()).toBe(antes);
});

test("el no del festivo: el centro está cerrado, y lo dice con su nombre", async ({
  page,
}) => {
  await agendaDelDia(page);
  const antes = await fotoDeLaAgenda();
  await irAlDia(page, SEMANA.festivo);
  await rotulo(page, "El jueves es festivo.", CAP);
  await esconder(page);

  const aviso = await pulsarFranjaRechazada(
    page,
    MARTA.id,
    "11:00",
    /cerrado/i,
  );
  expect(aviso).toContain("Virgen del Prado");
  expect(await fotoDeLaAgenda()).toBe(antes);
});

test("el no de quien no sabe: Lucía y las mechas", async ({ page }) => {
  await agendaDelDia(page);
  const antes = await fotoDeLaAgenda();

  await rotulo(page, "Mechas, pero en la columna de Lucía.", CAP);
  await esconder(page);
  // A las 17:00 y no a las 16:00: a esa hora Lucía ya tiene el corte de
  // Pili del caso anterior, y una franja ocupada ni abre el alta.
  await pulsarFranja(page, LUCIA.id, "17:00");
  await elegirClienta(page, "Mari Carmen");

  // EL SERVICIO SE OFRECE IGUAL. `bookableServices` sólo filtra por «es
  // servicio y tiene duración» (`AgendaPage.tsx:1756`): no cruza con lo que
  // sabe hacer la profesional de la columna. Así que la cajera lo puede
  // elegir, y el «no» llega después. Va como hallazgo 🟡: el mensaje habla
  // de huecos, no de quién.
  await elegirServicio(page, "Mechas");
  const p = panel(page);
  await p.reservar.click();

  const aviso = page.getByText(/no está disponible|no me queda|Te puedo dar|hueco/i);
  await expect(aviso.first()).toBeVisible({ timeout: 20_000 });
  await rotulo(page, "Lucía no sabe hacer mechas: no hay hueco con ella.", CAP);
  await esconder(page);

  expect(await fotoDeLaAgenda()).toBe(antes);
});

test("el no del pasado: esa hora ya pasó", async ({ page }) => {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await page.getByRole("button", { name: "Agenda" }).click();

  // Lo primero, que es estructural y vale siempre: al selector de día no se
  // le puede pedir ayer. El `min` del campo es hoy (`AgendaPage.tsx:822`),
  // así que un día entero en el pasado no se puede ni mirar.
  await expect(page.locator("[data-ir-a-dia]")).toHaveAttribute(
    "min",
    hoyEnMadrid(),
  );

  // Y la hora pasada DE HOY. Esto sólo se puede probar si hoy el centro abre
  // (martes a sábado) y ya son más de las 09:15: antes de que abra no hay
  // ninguna hora pasada que tocar. Cuando no aplica se dice en voz alta —
  // una prueba que se salta en silencio miente.
  const diaDeSemana = isoWeekdayEnMadrid();
  const abiertoHoy = diaDeSemana >= 2 && diaDeSemana <= 6;
  const minutosAhora = minutosEnMadrid();
  if (!abiertoHoy || minutosAhora < 9 * 60 + 30) {
    console.log(
      `[banco] El «no» del pasado no aplica hoy: ${
        abiertoHoy ? "el centro aún no ha abierto" : "hoy el centro cierra"
      } (día ISO ${diaDeSemana}, ${hhmmDe(minutosAhora)} en Madrid). ` +
        "El 409 BOOKING_IN_PAST del servidor sí está cubierto por " +
        "apps/api/test-e2e/agenda-suelo.e2e.ts.",
    );
    return;
  }

  const antes = await fotoDeLaAgenda();
  await irAlDia(page, hoyEnMadrid());
  await expect(
    page.locator(`[data-columna="${MARTA.id}"]`),
  ).toBeVisible({ timeout: 30_000 });
  await rotulo(page, "Una cita a una hora que ya pasó.", CAP);
  await esconder(page);

  const aviso = await pulsarFranjaRechazada(
    page,
    MARTA.id,
    "09:00",
    /ya ha pasado/i,
  );
  expect(aviso).toMatch(/El primer hueco es a las \d\d:\d\d/);
  expect(await fotoDeLaAgenda()).toBe(antes);
});
