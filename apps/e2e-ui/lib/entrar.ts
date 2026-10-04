// Cómo entra el banco en cada sitio. Lo que se puede sembrar y lo que no.
//
// ADMIN: se teclea el login de verdad. Se podría sembrar el `localStorage`
// con un JWT, pero el capítulo 1 del vídeo EMPIEZA en el login de la dueña —
// es la primera pantalla que Sole va a ver — y un banco que se cuela por la
// puerta de atrás no prueba esa pantalla.
//
// TPV: el token del dispositivo SÍ se siembra (su hash es sha256 del texto
// plano, y el seed metió el mismo); el emparejamiento no, porque el código es
// de un solo uso y el banco tiene que poder correr dos veces seguidas. La
// sesión de la cajera NO se puede sembrar: `App.tsx` arranca siempre en
// `needsLogin` y no restaura nada del `localStorage`, así que hay que teclear
// email y PIN como en el mostrador. Y detrás del login puede estar el resumen
// del turno anterior, que hay que confirmar antes de llegar a la rejilla.

import { expect, type Page } from "@playwright/test";

import { ADMIN, TPV } from "../playwright.config.js";
import { DEVICE_TOKEN, DUENA, PASSWORD_DUENA, PIN } from "../seed/escenario.js";

/** El login real del panel: email, contraseña y «Entrar». */
export async function entrarAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.locator("#email").fill(DUENA.email);
  await page.locator("#password").fill(PASSWORD_DUENA);
  await page.getByRole("button", { name: /^Entrar/ }).click();
  // El panel monta cuando el shell ya tiene tenant y capacidades. Se espera
  // a «Tiendas» y no a «Ajustes»: la entrada de Ajustes está marcada
  // `superAdminOnly` en `AdminShell.tsx:211` y la dueña NO la ve en su menú
  // (hallazgo del capítulo 1 — el interruptor sí lo puede usar, pero no hay
  // forma de llegar a él sin saberse la URL).
  await expect(page.getByRole("link", { name: "Tiendas" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Siembra el token del dispositivo ANTES de que cargue la app. */
export async function dispositivoEmparejado(page: Page): Promise<void> {
  await page.addInitScript(
    ([clave, token]) => {
      window.localStorage.setItem(clave as string, token as string);
    },
    ["mipiacetpv-device-token", DEVICE_TOKEN],
  );
}

/**
 * Abre el TPV ya emparejado y teclea el PIN de quien sea.
 *
 * `email` es el de la profesional (o la dueña): cada una entra con el suyo,
 * como en el mostrador. No abre turno — eso lo pide el capítulo que lo
 * necesite, porque el capítulo 1 tiene que poder mirar la pantalla ANTES.
 */
export async function entrarTpv(page: Page, email: string): Promise<void> {
  await dispositivoEmparejado(page);
  await page.goto(TPV);
  const campoEmail = page.locator("#cashierEmail");
  await expect(campoEmail).toBeVisible({ timeout: 30_000 });
  await campoEmail.fill(email);
  // El PIN se marca en el teclado numérico de la pantalla, dígito a dígito:
  // es un pad de botones, no un input donde se pueda escribir.
  for (const d of PIN) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
  await page.getByRole("button", { name: /^Entrar/ }).click();
  await expect(campoEmail).toBeHidden({ timeout: 30_000 });
}

/**
 * Deja el TPV en la rejilla de venta, pase lo que pase detrás del login:
 * el resumen del día anterior (hay que confirmarlo), la reanudación de un
 * turno abierto, o la apertura de uno nuevo con su fondo de caja.
 */
export async function turnoAbierto(page: Page, fondoEuros = 100): Promise<void> {
  const resumen = page.getByRole("button", { name: /Confirmar/ });
  if (await resumen.isVisible().catch(() => false)) {
    await resumen.click();
  }
  const reanudar = page.getByRole("button", { name: /Reanudar turno/ });
  if (await reanudar.isVisible().catch(() => false)) {
    await reanudar.click();
    return;
  }
  const abrir = page.getByRole("button", { name: /^Abrir turno/ });
  if (await abrir.isVisible().catch(() => false)) {
    // El fondo NO se escribe: el campo es el `AmountField` de la app (un
    // `div` con `aria-label`, no un `input`) y el importe se teclea con el
    // CashPad propio — hallazgo H2 de v1.12, el teclado de Android no vale.
    // Para el banco basta uno de los atajos de la propia pantalla.
    await page
      .getByRole("button", { name: `${fondoEuros},00 €`, exact: true })
      .click();
    await abrir.click();
  }
}

/**
 * Pasa por la pantalla Clientes para que la agenda sepa los nombres.
 *
 * NO es un adorno del banco: en un dispositivo recién emparejado la rejilla
 * de la agenda enseña «Sin nombre» en TODAS las citas, porque el nombre de la
 * clienta sale de la caché local (`loadClientsFromCache`) y esa caché la
 * llena la pantalla Clientes, no la agenda. Medido: antes de pasar por
 * Clientes, «09:00 · Sin nombre»; después, «09:00 · Rosa». Va como hallazgo,
 * y el capítulo 7 lo deja comprobado.
 *
 * Los capítulos que necesitan ver el nombre en pantalla llaman a esto antes,
 * igual que tendría que hacer la cajera el primer día.
 */
export async function cebarNombresDeClientas(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Clientes" }).click();
  // La lista llega por red; basta con que aparezca una de las sembradas.
  await expect(page.getByText("Carmen Ruiz").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Volver" }).first().click();
}
