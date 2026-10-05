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
    // agenda-lista · POR EL MENÚ, no por URL. Hasta este bloque la entrada
    // «Ajustes» estaba marcada `superAdminOnly` y la dueña no la veía: el
    // interruptor sí lo podía tocar (`canEdit` es true para OWNER), lo que
    // faltaba era el camino, y el banco se lo saltaba yendo a la URL. Un
    // paso que el banco se salta es un paso que nadie prueba, y éste lo va
    // a dar Matías delante de Sole.
    const ajustes = page.getByRole("link", { name: "Ajustes" });
    await expect(ajustes).toBeVisible({ timeout: 20_000 });
    await ajustes.click();
    await expect(page).toHaveURL(`${ADMIN}/admin/settings`);
    await rotulo(page, "Ajustes → «Agenda de citas».", CAP);
    await esconder(page);

    const interruptor = page.locator("#agendaEnabled");
    await expect(interruptor).toBeVisible();
    await expect(interruptor).not.toBeChecked();
    await interruptor.check();
    await page.getByRole("button", { name: /Guardar cambios/ }).click();

    // En pantalla: el interruptor queda marcado.
    await expect(interruptor).toBeChecked();

    // Y el menú gana las tres secciones SIN RECARGAR. Antes de este bloque
    // el shell leía las capacidades una sola vez al montar, así que la
    // barra lateral se quedaba igual hasta un F5: quien acaba de pulsar un
    // interruptor y no ve cambiar nada concluye que no ha funcionado.
    // `AdminShell` las mira ahora en `src/capabilities.ts` y la pantalla de
    // Ajustes empuja un refresco al guardar.
    const SECCIONES = ["Personal", "Agenda · Catálogo", "Agenda · Horario"];
    for (const entrada of SECCIONES) {
      await expect(
        page.getByRole("link", { name: entrada }),
      ).toBeVisible({ timeout: 20_000 });
    }
    // Y siguen ahí tras recargar: lo de arriba no es un parpadeo de la
    // pantalla, es el estado guardado.
    await page.reload();
    for (const entrada of SECCIONES) {
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
