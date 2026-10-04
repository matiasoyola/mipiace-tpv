// Capítulo 1 · Encender la agenda.
//
// El «antes» no es decorado. Con `agendaEnabled = false` —que es como está
// producción para todos los tenants menos el que se encienda— el TPV no
// enseña el botón y la API responde 403 AGENDA_DISABLED. Comprobar el antes
// es comprobar el gate; sin eso, el después no dice nada.

import { expect, test } from "@playwright/test";

import { ADMIN, TPV } from "../playwright.config.js";
import { cerrarBd, tenant } from "../lib/bd.js";
import { entrarAdmin, entrarTpv, turnoAbierto } from "../lib/entrar.js";
import { AP11, PANEL } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { PROFESIONALES } from "../seed/escenario.js";

const MARTA = PROFESIONALES[0]!;
const CAP = "Capítulo 1 · Encender";

test.afterAll(async () => {
  await cerrarBd();
});

test.describe("el TPV con la agenda apagada", () => {
  test.use(AP11);

  test("no enseña el botón de agenda", async ({ page }) => {
    await page.goto(TPV);
    await portada(page, "La agenda, de cero a un día normal");
    await rotulo(page, "Así está hoy el TPV de cualquier centro: sin agenda.", CAP);

    await entrarTpv(page, MARTA.email);
    await turnoAbierto(page);
    await esconder(page);

    // La rejilla de venta, con sus botones de siempre.
    await expect(page.getByRole("button", { name: "Clientes" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Agenda" })).toHaveCount(0);

    expect((await tenant()).agendaEnabled).toBe(false);
  });
});

test.describe("la dueña la enciende en Ajustes", () => {
  test.use(PANEL);

  test("el interruptor «Agenda de citas»", async ({ page }) => {
    await entrarAdmin(page);
    await rotulo(page, "La dueña entra en su panel.", CAP);
    // Se va por URL y no por el menú: la entrada «Ajustes» está marcada
    // `superAdminOnly` (`AdminShell.tsx:211`) y la dueña no la tiene. El
    // interruptor sí lo puede tocar (`canEdit` es true para OWNER): lo que
    // falta es el camino. Va como hallazgo del bloque.
    await page.goto(`${ADMIN}/admin/settings`);
    await expect(
      page.getByRole("link", { name: "Ajustes" }),
    ).toHaveCount(0);
    await rotulo(page, "Ajustes → «Agenda de citas».", CAP);
    await esconder(page);

    const interruptor = page.locator("#agendaEnabled");
    await expect(interruptor).toBeVisible();
    await expect(interruptor).not.toBeChecked();
    await interruptor.check();
    await page.getByRole("button", { name: /Guardar cambios/ }).click();

    // En pantalla: el interruptor queda marcado.
    await expect(interruptor).toBeChecked();

    // Pero el menú NO gana las secciones de la agenda todavía: el shell lee
    // las capacidades UNA VEZ al montar (`useTenantCapabilities`), y guardar
    // no las vuelve a pedir. Hay que recargar. Va como hallazgo: es
    // exactamente lo que desconcierta a quien acaba de encenderla («lo he
    // activado y no sale nada»).
    await expect(page.getByRole("link", { name: "Personal" })).toHaveCount(0);

    await page.reload();
    for (const entrada of ["Personal", "Agenda · Catálogo", "Agenda · Horario"]) {
      await expect(
        page.getByRole("link", { name: entrada }),
      ).toBeVisible({ timeout: 20_000 });
    }

    // En la BD: el gate del módulo, que es de donde cuelga todo lo demás.
    expect((await tenant()).agendaEnabled).toBe(true);
  });
});

test.describe("el TPV con la agenda encendida", () => {
  test.use(AP11);

  test("ahora sí enseña el botón", async ({ page }) => {
    await entrarTpv(page, MARTA.email);
    await turnoAbierto(page);
    await rotulo(page, "El mismo TPV, con el botón de la agenda.", CAP);
    await esconder(page);

    await expect(page.getByRole("button", { name: "Agenda" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
