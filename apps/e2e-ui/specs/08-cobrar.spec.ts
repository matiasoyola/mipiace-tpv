// Capítulo 8 · Cobrar la cita.
//
// El puente cita → caja: «Cobrar en caja» crea el ticket YA POBLADO con los
// servicios de la cita y lo deja en el borrador del TPV; se cobra como
// cualquier venta, y al cerrarlo la cita queda finalizada con su `ticket_id`.
//
// Dos cobros, porque los dos pasan en un mostrador:
//   · uno en EFECTIVO con vuelta (la clienta paga con un billete),
//   · uno MIXTO (parte en efectivo y parte con tarjeta).
//
// Y una cosa que este centro hace distinta: siendo `businessType = SERVICES`,
// el botón de cerrar la venta no dice «Cobrar» sino **«Cerrar servicio»**
// (`CheckoutPage.tsx:909`). En una peluquería es lo que se dice.

import { expect, test } from "@playwright/test";

import { cerrarBd, citas, tickets, turnoActual } from "../lib/bd.js";
import {
  cebarNombresDeClientas,
  entrarTpv,
  turnoAbierto,
} from "../lib/entrar.js";
import { irAlDia } from "../lib/agenda-ui.js";
import { AP11 } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { PROFESIONALES, semanaDelVideo } from "../seed/escenario.js";

const CAP = "Capítulo 8 · Cobrar";
const MARTA = PROFESIONALES[0]!;
const SEMANA = semanaDelVideo();

/** La cita de Rosa que se cobra en efectivo: la aplicación del tinte, 30 €. */
const EN_EFECTIVO = { hora: "09:00", euros: "30,00" };
/** Y la segunda mitad de Rosa, 15 €, que se cobra mixta. */
const MIXTO = { hora: "10:15", euros: "15,00" };

test.use(AP11);

test.afterAll(async () => {
  await cerrarBd();
});

async function agendaConNombres(page: import("@playwright/test").Page) {
  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  // Sin esto la rejilla diría «Sin nombre» en todas las citas (hallazgo del
  // capítulo 7): en el vídeo tiene que leerse el nombre de la clienta.
  await cebarNombresDeClientas(page);
  await page.getByRole("button", { name: "Agenda" }).click();
  await irAlDia(page, SEMANA.diaNormal);
  await expect(
    page.locator(`[data-columna="${MARTA.id}"] [data-cita]`).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Lleva la cita de una hora dada al borrador de caja y devuelve el botón de
 * cobro de la pantalla de venta.
 *
 * El botón se pide con su IMPORTE («Cobrar 30,00 €») y no con `/^Cobrar/`:
 * detrás de la agenda está la pantalla de venta con su propio «Cobrar 0,00 €»
 * y el detalle de la cita con «Cobrar en caja». Pedirlo con el importe es
 * además la comprobación de que el ticket llegó POBLADO: si la línea del
 * servicio no se hubiera puesto, el botón seguiría a cero.
 */
async function cobrarEnCaja(
  page: import("@playwright/test").Page,
  hora: string,
  euros: string,
) {
  await page
    .locator(`[data-columna="${MARTA.id}"] [data-cita]`)
    .filter({ hasText: hora })
    .click();
  await page.getByRole("button", { name: "Cobrar en caja" }).click();
  const cobrar = page.getByRole("button", {
    name: new RegExp(`^Cobrar\\s*${euros.replace(",", ",")}`),
  });
  await expect(cobrar).toBeEnabled({ timeout: 30_000 });
  return cobrar;
}

test("en efectivo, con vuelta", async ({ page }) => {
  await agendaConNombres(page);
  await portada(page, "La clienta llega y se cobra la cita", CAP);
  await rotulo(page, "Rosa ya está. Se cobra su cita, no una venta suelta.", CAP);
  await esconder(page);

  const cobrar = await cobrarEnCaja(page, EN_EFECTIVO.hora, EN_EFECTIVO.euros);

  // El ticket viene con el servicio de la cita y su importe.
  await expect(page.getByText("Tinte · aplicación").first()).toBeVisible();
  await rotulo(page, "El ticket ya trae el servicio de la cita.", CAP);
  await esconder(page);

  await cobrar.click();
  await expect(page.getByText("Importe del servicio")).toBeVisible({
    timeout: 20_000,
  });

  // Efectivo, y la clienta paga con un billete de 50.
  await page.getByRole("button", { name: "Efectivo", exact: true }).click();
  await page.getByRole("button", { name: "50", exact: true }).click();
  await rotulo(page, "Paga con cincuenta: la vuelta la dice el TPV.", CAP);
  await esconder(page);
  await expect(page.getByText("Cambio")).toBeVisible();
  await expect(page.getByText("20,00 €").first()).toBeVisible();

  await page.getByRole("button", { name: "Cerrar servicio" }).click();

  // En la BD: el ticket cerrado con su pago en efectivo, el efectivo que
  // entregó la clienta (de ahí la vuelta) y la cita FINALIZADA con su ticket.
  // El cierre del ticket pasa por la cola del TPV: se espera al estado, no
  // sólo a que exista la fila (el borrador YA existía antes de cobrar).
  await expect
    .poll(
      async () => (await tickets()).find(() => true)?.status ?? "sin-ticket",
      { timeout: 30_000 },
    )
    .not.toBe("DRAFT");
  const [ticket] = await tickets();
  expect(ticket).toBeTruthy();
  expect(Number(ticket!.total)).toBeCloseTo(30, 2);
  expect(ticket!.pagos).toHaveLength(1);
  expect(ticket!.pagos[0]!.method).toBe("CASH");
  expect(Number(ticket!.pagos[0]!.amount)).toBeCloseTo(30, 2);
  expect(Number(ticket!.efectivoEntregado)).toBeCloseTo(50, 2);

  // La venta entra en el turno ABIERTO, que es el del instante del cobro y
  // no el del día de la cita. (`collectedInShiftId` del pago es otra cosa:
  // se puebla cuando se cobra una deuda más tarde, y aquí viene vacío.)
  const turno = await turnoActual();
  expect(ticket!.turnoId).toBe(turno!.id);
  expect(turno!.closedAt).toBeNull();

  await expect
    .poll(
      async () =>
        (await citas()).find((c) => c.ticketId === ticket!.id)?.status,
      { timeout: 30_000 },
    )
    .toBe("COMPLETED");
});

test("mixto: parte en efectivo y parte con tarjeta", async ({ page }) => {
  await agendaConNombres(page);
  await rotulo(page, "El lavado de Rosa, mitad y mitad.", CAP);
  await esconder(page);

  const cobrar = await cobrarEnCaja(page, MIXTO.hora, MIXTO.euros);
  await cobrar.click();
  await expect(page.getByText("Importe del servicio")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Mixto", exact: true }).click();
  await rotulo(page, "Diez en efectivo y el resto con tarjeta.", CAP);
  await esconder(page);

  // «Mixto» abre las dos filas ya puestas en efectivo y tarjeta: no hay que
  // elegir método, sólo repartir el importe.
  // `getByRole("textbox")` y no `getByLabel`: «Importe Efectivo» casa
  // también con el botón «Limpiar importe efectivo» del pad.
  const importeEfectivo = page.getByRole("textbox", {
    name: "Importe Efectivo",
  });
  await expect(importeEfectivo).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Importe Tarjeta" }),
  ).toBeVisible();

  // El importe NO se escribe: el campo es el `AmountField` de la app (un
  // `div` con `aria-label`, no un `input`) y se teclea con el pad del pie o
  // con los atajos — hallazgo H2 de v1.12, el teclado de Android tapaba el
  // botón de cobrar. Se activa el campo del efectivo y se pulsan 10 €.
  await importeEfectivo.click();
  await page.getByRole("button", { name: "10", exact: true }).click();

  // Y la tarjeta se rellena sola con el resto de la cuenta: eso es lo que
  // hace que el reparto «cuadre» sin teclear dos veces.
  // El total pagado, con su palabra: «15,00 € · cuadra». El `/cuadra/` a
  // secas casa también con la ayuda de la fila («escribe encima si no
  // cuadra»), que dice justo lo contrario.
  await expect(
    page.getByText(new RegExp(`${MIXTO.euros} € · cuadra`)),
  ).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Cerrar servicio" }).click();

  // En la BD: un ticket con DOS pagos.
  await expect
    .poll(
      async () =>
        (await tickets()).filter((t) => t.status !== "DRAFT").length,
      { timeout: 30_000 },
    )
    .toBe(2);
  const ticket = (await tickets()).filter((t) => t.status !== "DRAFT")[1]!;
  expect(Number(ticket.total)).toBeCloseTo(15, 2);
  const metodos = ticket.pagos.map((p) => p.method).sort();
  expect(metodos).toEqual(["CARD", "CASH"]);
  const porMetodo = Object.fromEntries(
    ticket.pagos.map((p) => [p.method, Number(p.amount)]),
  );
  expect(porMetodo["CASH"]).toBeCloseTo(10, 2);
  expect(porMetodo["CARD"]).toBeCloseTo(5, 2);

  await expect
    .poll(
      async () => (await citas()).find((c) => c.ticketId === ticket.id)?.status,
      { timeout: 30_000 },
    )
    .toBe("COMPLETED");
});
