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
// MOVER UNA CITA NO SE PUEDE, y no es un olvido del banco. La API lo
// soporta (`PATCH /agenda/appointments/:id` acepta `start`) y el cliente del
// TPV también (`patchAppointment`), pero la pantalla no lo ofrece: no hay
// arrastrar, y el detalle sólo manda `status`. Hallazgo 🟡.

import { expect, test } from "@playwright/test";

import { asignaciones, cerrarBd, citas } from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
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

async function abrirAgenda(page: import("@playwright/test").Page) {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await page.getByRole("button", { name: "Agenda" }).click();
  await irAlDia(page, SEMANA.diaNormal);
  await expect(
    page.locator(`[data-columna="${MARTA.id}"]`),
  ).toBeVisible({ timeout: 30_000 });
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

  test("mover una cita no se puede desde la agenda", async ({ page }) => {
    await abrirAgenda(page);

    // El detalle de una cita viva ofrece cobrar y cambiar de estado. Nada
    // más: ni «cambiar la hora», ni arrastrar la tarjeta. La API sí sabe
    // mover (`PATCH` con `start`) y el cliente del TPV también; lo que falta
    // es la pantalla. Esto NO se construye aquí (regla del bloque): se deja
    // comprobado para que el día que exista, este test se ponga rojo y haya
    // que venir a contarlo.
    await tarjetaDeLaCita(page, MARTA.id, "09:00").click();
    await expect(
      page.getByRole("button", { name: "Cobrar en caja" }),
    ).toBeVisible({ timeout: 20_000 });
    // «Confirmar» no sale: una cita dada de alta en el mostrador nace ya
    // CONFIRMED, y ese botón sólo existe mientras está PENDING (el hold de
    // una reserva online). Lo que hay es lo que pasa en un día.
    for (const accion of ["En sala", "Finalizar", "No-show", "Cancelar"]) {
      await expect(page.getByRole("button", { name: accion })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Confirmar" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /mover|cambiar la hora|reprogramar/i }),
    ).toHaveCount(0);
    await rotulo(
      page,
      "Para cambiar una cita de hora hay que cancelarla y volver a darla.",
      CAP,
    );
    await esconder(page);
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
