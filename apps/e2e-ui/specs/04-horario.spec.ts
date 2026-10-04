// Capítulo 4 · El horario del centro: el TECHO de la agenda.
//
// Hasta B-reservas-7a la disponibilidad salía SÓLO de los turnos del
// personal: si nadie definía turno el centro no abría, y si alguien lo
// definía de par en par el centro abría de par en par. Con esto, la ventana
// de una profesional en una fecha es `turno ∩ horario del centro`.
//
// Y dos días que no son la semana tipo:
//   · un FESTIVO (cerrado, con nombre: la rejilla lo lee en voz alta),
//   · un DÍA ESPECIAL (abierto con horario propio, más corto).
// Un día especial SUSTITUYE al horario semanal de ese día; no se suma.

import { expect, test } from "@playwright/test";

import { ADMIN } from "../playwright.config.js";
import { cerrarBd, diasEspeciales, horarioDelCentro } from "../lib/bd.js";
import { entrarAdmin } from "../lib/entrar.js";
import { PANEL } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import {
  DIA_ESPECIAL_HORAS,
  DIA_ESPECIAL_NOMBRE,
  FESTIVO_NOMBRE,
  HORARIO_SEMANAL,
  semanaDelVideo,
} from "../seed/escenario.js";

const CAP = "Capítulo 4 · Horario";
const SEMANA = semanaDelVideo();

test.use(PANEL);

test.afterAll(async () => {
  await cerrarBd();
});

test("la semana del centro, el festivo y el día especial", async ({ page }) => {
  await entrarAdmin(page);
  await page.goto(`${ADMIN}/admin/agenda-hours`);
  await portada(page, "Cuándo abre el centro", CAP);

  // Antes: sin ninguna hora puesta el centro no tiene techo, y la pantalla
  // lo dice con todas las letras.
  await expect(
    page.getByText(/el centro .*no tiene techo/i),
  ).toBeVisible();
  await rotulo(
    page,
    "Sin horario, la agenda ofrece lo que digan los turnos. El centro no " +
      "tiene techo.",
    CAP,
  );
  await esconder(page);

  // La semana tipo: martes a sábado, 9:00–20:00. Lunes y domingo en blanco
  // = cerrados. Los campos tienen gancho propio (`data-hora="<día>-<campo>"`),
  // que es lo que hay que usar: por clase de Tailwind no se pincha nada.
  for (const dia of HORARIO_SEMANAL.diasAbiertos) {
    await page.locator(`[data-hora="${dia}-m1"]`).fill(HORARIO_SEMANAL.abre);
    await page.locator(`[data-hora="${dia}-m2"]`).fill(HORARIO_SEMANAL.cierra);
  }
  await rotulo(page, "Martes a sábado, de nueve a ocho.", CAP);
  await esconder(page);
  await page.getByRole("button", { name: "Guardar horario" }).click();

  // En pantalla: lunes y domingo quedan marcados «cerrado», y el aviso de
  // «sin techo» desaparece.
  await expect(page.getByText(/no tiene techo/i)).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.locator('tr[data-dia="1"]').getByText("cerrado")).toBeVisible();
  await expect(page.locator('tr[data-dia="7"]').getByText("cerrado")).toBeVisible();

  // El festivo: cerrado y con nombre.
  await rotulo(page, `El jueves es festivo: ${FESTIVO_NOMBRE}.`, CAP);
  await esconder(page);
  await page.locator("[data-nuevo-dia-fecha]").fill(SEMANA.festivo);
  await page.locator("[data-nuevo-dia-nombre]").fill(FESTIVO_NOMBRE);
  await expect(page.locator("[data-nuevo-dia-cerrado]")).toBeChecked();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.locator(`[data-dia-especial="${SEMANA.festivo}"]`),
  ).toBeVisible({ timeout: 20_000 });

  // El día especial: abierto, pero sólo por la mañana.
  await rotulo(
    page,
    `El viernes se cierra a las ${DIA_ESPECIAL_HORAS.cierra}: ${DIA_ESPECIAL_NOMBRE}.`,
    CAP,
  );
  await esconder(page);
  await page.locator("[data-nuevo-dia-fecha]").fill(SEMANA.diaEspecial);
  await page.locator("[data-nuevo-dia-nombre]").fill(DIA_ESPECIAL_NOMBRE);
  await page.locator("[data-nuevo-dia-cerrado]").uncheck();
  await page.locator("[data-nuevo-dia-abre]").fill(DIA_ESPECIAL_HORAS.abre);
  await page.locator("[data-nuevo-dia-cierra]").fill(DIA_ESPECIAL_HORAS.cierra);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.locator(`[data-dia-especial="${SEMANA.diaEspecial}"]`),
  ).toBeVisible({ timeout: 20_000 });

  // En la BD: cinco filas de semana (una por día abierto) y dos días
  // especiales, uno cerrado sin horas y otro abierto con las dos.
  const semana = await horarioDelCentro();
  expect(semana.map((h) => h.weekday)).toEqual([
    ...HORARIO_SEMANAL.diasAbiertos,
  ]);
  for (const h of semana) {
    expect(h.openTime).toBe(HORARIO_SEMANAL.abre);
    expect(h.closeTime).toBe(HORARIO_SEMANAL.cierra);
  }

  const dias = await diasEspeciales();
  expect(dias).toHaveLength(2);
  const festivo = dias.find(
    (d) => d.date.toISOString().slice(0, 10) === SEMANA.festivo,
  );
  expect(festivo, "falta el festivo").toBeTruthy();
  expect(festivo!.closed).toBe(true);
  expect(festivo!.name).toBe(FESTIVO_NOMBRE);
  expect(festivo!.openTime).toBeNull();
  expect(festivo!.closeTime).toBeNull();

  const especial = dias.find(
    (d) => d.date.toISOString().slice(0, 10) === SEMANA.diaEspecial,
  );
  expect(especial, "falta el día especial").toBeTruthy();
  expect(especial!.closed).toBe(false);
  expect(especial!.name).toBe(DIA_ESPECIAL_NOMBRE);
  expect(especial!.openTime).toBe(DIA_ESPECIAL_HORAS.abre);
  expect(especial!.closeTime).toBe(DIA_ESPECIAL_HORAS.cierra);
});
