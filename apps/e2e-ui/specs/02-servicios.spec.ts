// Capítulo 2 · Los servicios y sus duraciones.
//
// Los servicios ya están en el catálogo (son productos de tipo SERVICE); lo
// que no tienen es duración, y sin duración la agenda los ignora: el motor
// descarta en seco cualquier servicio sin fila en `service_scheduling`
// (`engine.ts:173` — «servicio sin fila service_scheduling → ignorado»).
// Este capítulo es el que los hace agendables.
//
// EL TINTE VA PARTIDO EN DOS, y es la decisión del bloque: la pausa de
// exposición no se puede expresar en un servicio (las pausas OCUPAN a la
// profesional), así que se modela como dos servicios de 30 minutos. El
// rótulo lo dice en voz alta.

import { expect, test } from "@playwright/test";

import { ADMIN } from "../playwright.config.js";
import { agendaDeLosServicios, cerrarBd, servicio } from "../lib/bd.js";
import { entrarAdmin } from "../lib/entrar.js";
import { PANEL } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { SERVICIOS, TINTE_SKUS } from "../seed/escenario.js";

const CAP = "Capítulo 2 · Servicios";

test.use(PANEL);

test.afterAll(async () => {
  await cerrarBd();
});

test("cada servicio gana su duración", async ({ page }) => {
  await entrarAdmin(page);
  await page.goto(`${ADMIN}/admin/agenda-catalog`);
  await portada(page, "Los servicios y lo que dura cada uno", CAP);

  // Antes: los seis están ahí, y los seis sin datos de agenda.
  await expect(page.getByText("Sin datos de agenda")).toHaveCount(
    SERVICIOS.length,
  );
  await rotulo(
    page,
    "Los servicios ya están en el catálogo, pero sin duración la agenda no los ve.",
    CAP,
  );
  await esconder(page);

  for (const s of SERVICIOS) {
    const producto = await servicio(s.sku);

    if (TINTE_SKUS[0] === s.sku) {
      await rotulo(
        page,
        "El tinte va partido en dos: la exposición es el hueco de en medio, " +
          "y ahí entra otra clienta.",
        CAP,
      );
      await esconder(page);
    }

    // La tarjeta se abre y se cierra pulsando el nombre del servicio. Hay
    // que CERRARLA antes de abrir la siguiente: la página deja abiertas
    // todas las que se hayan pulsado, y con dos abiertas hay dos botones
    // «Guardar servicio» en pantalla.
    const cabecera = page
      .getByRole("button", { name: new RegExp(s.nombre) })
      .first();
    await cabecera.click();
    const duracion = page.locator(`#dur-${producto.id}`);
    await expect(duracion).toBeVisible();
    await duracion.fill(String(s.duracionMin));
    if (s.pausaDespuesMin > 0) {
      await page.locator(`#ba-${producto.id}`).fill(String(s.pausaDespuesMin));
    }
    await page.getByRole("button", { name: "Guardar servicio" }).click();

    // En pantalla: la tarjeta deja de decir «Sin datos de agenda» y empieza
    // a decir los minutos.
    await expect(
      page.getByText(`${s.duracionMin} min`, { exact: false }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await cabecera.click();
    await expect(duracion).toBeHidden();
  }

  await rotulo(page, "Los seis, con su duración de verdad.", CAP);
  await esconder(page);
  await expect(page.getByText("Sin datos de agenda")).toHaveCount(0);

  // En la BD: una fila por servicio, con la duración exacta que se tecleó.
  const agenda = await agendaDeLosServicios();
  expect(agenda).toHaveLength(SERVICIOS.length);
  for (const s of SERVICIOS) {
    const producto = await servicio(s.sku);
    const fila = agenda.find((a) => a.productId === producto.id);
    expect(fila, `falta la agenda de ${s.nombre}`).toBeTruthy();
    expect(fila!.durationMin).toBe(s.duracionMin);
    expect(fila!.bufferAfterMin).toBe(s.pausaDespuesMin);
    expect(fila!.staffRequired).toBe(1);
  }
});
