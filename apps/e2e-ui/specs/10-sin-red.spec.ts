// Capítulo 10 · Sin red: el alta de una clienta sin cobertura.
//
// El WiFi del centro se cae y la clienta está delante. El TPV tiene que
// seguir tomando el nombre: el alta se guarda en el caché local con su
// `externalId` y se encola en el outbox, y cuando vuelve la red se manda
// sola. El `externalId` es lo que hace que reenviarlo dos veces no cree dos
// fichas (misma idempotencia que los tickets).
//
// Va el ÚLTIMO del banco y es el único capítulo que el prompt daba por
// opcional: si el TPV servido por Vite no aguantara el modo sin red, se
// caería del vídeo y pasaría a hallazgo. Aguanta.

import { expect, test } from "@playwright/test";

import { cerrarBd, clientas } from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
import { AP11 } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { PROFESIONALES } from "../seed/escenario.js";

const CAP = "Capítulo 10 · Sin red";
const MARTA = PROFESIONALES[0]!;
/** La clienta que entra sin cobertura. */
const SIN_RED = "Maite";

test.use(AP11);

test.afterAll(async () => {
  await cerrarBd();
});

test("se da de alta sin cobertura y se sincroniza al volver", async ({
  page,
  context,
}) => {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await portada(page, "Y si se cae el WiFi", CAP);

  await page.getByRole("button", { name: "Clientes" }).click();
  await expect(page.getByText("Carmen Ruiz").first()).toBeVisible({
    timeout: 30_000,
  });

  const antes = (await clientas()).length;

  // Se cae la red.
  await context.setOffline(true);
  await rotulo(page, "Se cae el WiFi. La clienta sigue delante.", CAP);
  await esconder(page);

  // `exact`: detrás está la pantalla de venta con su «Nuevo servicio».
  await page.getByRole("button", { name: "Nuevo", exact: true }).click();
  await page.locator("#client-nombre").fill(SIN_RED);
  await page.getByRole("button", { name: "Crear cliente", exact: true }).click();

  // En pantalla: la ficha está, con su marca de que todavía no ha salido.
  const fila = page.locator("li").filter({ hasText: SIN_RED });
  await expect(fila).toBeVisible({ timeout: 30_000 });
  await expect(fila.getByText("sin conexión")).toBeVisible();
  await rotulo(page, "La ficha se guarda igual, marcada «sin conexión».", CAP);
  await esconder(page);

  // Y en la BD, todavía NO está: no ha salido del dispositivo.
  expect((await clientas()).length).toBe(antes);

  // Vuelve la red.
  await context.setOffline(false);
  await rotulo(page, "Vuelve el WiFi: la ficha se manda sola.", CAP);
  await esconder(page);

  // El outbox la manda sin que nadie toque nada.
  await expect
    .poll(async () => (await clientas()).length, { timeout: 60_000 })
    .toBe(antes + 1);
  const maite = (await clientas()).find((c) => c.firstName === SIN_RED)!;
  expect(maite).toBeTruthy();
  expect(maite.lastName).toBe("");
  // El `externalId` es la idempotencia del alta offline: con él, un reenvío
  // no crea una segunda ficha.
  expect(maite.externalId).not.toBeNull();

  // Y en pantalla la marca SIGUE PUESTA: la ficha ya está en el servidor
  // —lo acabamos de comprobar en la BD— pero la lista no vuelve a mirar el
  // estado de sincronización mientras la pantalla está abierta. Hallazgo ⚪:
  // la cajera no tiene forma de saber que ya salió.
  //
  // Y de paso, otra cosa que el banco destapó al intentar comprobarlo: tras
  // el alta SIN RED la hoja del formulario se queda abierta por encima de la
  // lista, así que la pantalla de Clientes se ve pero no se puede tocar — el
  // botón «Volver» está visible y los clics no le llegan. Es el mismo
  // hallazgo contado dos veces: cuando el alta se encola, la pantalla no
  // cierra el trámite.
  await expect(fila.getByText("sin conexión")).toHaveCount(1);

  await rotulo(page, "La ficha ya está en el sistema.", CAP);
  await esconder(page);
});
