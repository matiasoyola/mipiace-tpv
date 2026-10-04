// Capítulo 9 · Cerrar el día: el arqueo tiene que cuadrar con las citas.
//
// Es la comprobación que cierra el círculo del bloque. Lo que entró en el
// cajón tiene que ser exactamente el fondo de caja más el EFECTIVO de los
// cobros de citas — ni más (la clienta se llevó su vuelta) ni menos (la parte
// con tarjeta no está en el cajón).
//
// Las cuentas del día, hechas a mano para que se vean:
//
//   fondo de caja .................................. 100,00 €
//   tinte · aplicación de Rosa, en efectivo ......... +30,00 €   (pagó 50
//                                                                 y se
//                                                                 llevó 20)
//   tinte · lavado de Rosa, parte en efectivo ....... +10,00 €   (los otros
//                                                                 5 fueron
//                                                                 con tarjeta)
//   ───────────────────────────────────────────────────────────
//   cash esperado .................................. 140,00 €

import { expect, test } from "@playwright/test";

import { cerrarBd, tickets, turnoActual } from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
import { AP11 } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { PROFESIONALES } from "../seed/escenario.js";

const CAP = "Capítulo 9 · Cerrar el día";
const MARTA = PROFESIONALES[0]!;

/** Lo que tiene que haber en el cajón: 2 billetes de 50 y 2 de 20. */
const RECUENTO: ReadonlyArray<[string, string]> = [
  ["50 €", "2"],
  ["20 €", "2"],
];
const CASH_ESPERADO = "140,00 €";

test.use(AP11);

test.afterAll(async () => {
  await cerrarBd();
});

test("el arqueo cuadra con lo cobrado por citas", async ({ page }) => {
  // Las cuentas, antes de abrir la pantalla: así el banco no se cree lo que
  // el TPV diga, lo compara con lo que hay en la BD.
  const turnoAntes = await turnoActual();
  expect(turnoAntes!.closedAt).toBeNull();
  const efectivoCobrado = (await tickets())
    .filter((t) => t.status !== "DRAFT" && t.turnoId === turnoAntes!.id)
    .flatMap((t) => t.pagos)
    .filter((p) => p.method === "CASH")
    .reduce((suma, p) => suma + Number(p.amount), 0);
  const esperado = Number(turnoAntes!.cashOpening) + efectivoCobrado;
  expect(efectivoCobrado).toBeCloseTo(40, 2);
  expect(esperado).toBeCloseTo(140, 2);

  await entrarTpv(page, MARTA.email);
  await turnoAbierto(page);
  await portada(page, "Cerrar el día", CAP);

  await page.getByRole("button", { name: "Abrir menú" }).click();
  await page.getByRole("button", { name: "Cerrar turno" }).click();

  // La pantalla de cierre hace las cuentas en voz alta, y es exactamente la
  // comprobación del capítulo: las ventas del día son las dos citas, el
  // efectivo es lo que entró en el cajón y la tarjeta no.
  await expect(page.getByText("Cerrar el día")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("2 tickets")).toBeVisible();
  await expect(page.getByText("45,00 €").first()).toBeVisible();
  await expect(page.getByText("40,00 €").first()).toBeVisible();
  await expect(page.getByText("5,00 €").first()).toBeVisible();
  await expect(
    page.getByText("Efectivo esperado en el cajón"),
  ).toBeVisible();
  await expect(page.getByText(CASH_ESPERADO).first()).toBeVisible();
  await expect(
    page.getByText("fondo 100,00 € + efectivo neto 40,00 €"),
  ).toBeVisible();
  await rotulo(
    page,
    "Las dos citas cobradas: 45 € de ventas, 40 en el cajón y 5 en tarjeta.",
    CAP,
  );
  await esconder(page);

  // Y se cuenta el cajón de verdad. Las cantidades son `AmountField`: se
  // activa la casilla y se teclea con el pad (igual que el capítulo 8).
  await page.getByRole("button", { name: "Cuadrar caja" }).click();
  await expect(
    page.getByText("Cuadrar caja y cerrar turno"),
  ).toBeVisible({ timeout: 30_000 });
  await rotulo(page, "Dos de cincuenta y dos de veinte.", CAP);
  await esconder(page);
  for (const [denominacion, cuantos] of RECUENTO) {
    await page.getByLabel(`Cantidad de ${denominacion}`).click();
    await page.getByRole("button", { name: cuantos, exact: true }).click();
  }

  // Cuadra: lo contado es lo esperado, al céntimo.
  await expect(
    page.getByText(`Total contado${CASH_ESPERADO}`),
  ).toBeVisible({ timeout: 20_000 });
  await rotulo(page, "Lo contado es lo esperado, al céntimo.", CAP);
  await esconder(page);

  await page.getByRole("button", { name: "Cerrar turno" }).last().click();

  // En la BD: el turno cerrado, con lo contado igual a lo esperado.
  await expect
    .poll(async () => (await turnoActual())?.closedAt !== null, {
      timeout: 30_000,
    })
    .toBe(true);
  const turnoDespues = await turnoActual();
  expect(Number(turnoDespues!.cashCounted)).toBeCloseTo(esperado, 2);
});

