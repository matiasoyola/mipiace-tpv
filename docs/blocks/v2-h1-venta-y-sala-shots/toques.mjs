// Cuenta los TOQUES de la comanda canónica del prompt y del cobro, en la
// pantalla que haya montada. Sirve para el «antes» (TPV claro) y para el
// «después» (venta oscura) sin cambiar el guion: la regla de conteo es
// la misma, y es la de un camarero —si el producto no está a la vista,
// hay que tocar su categoría/familia primero—.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BANCO_URL ?? "http://localhost:5281";
const MODO = process.env.BANCO_MODO ?? "despues";
const OUT = process.env.BANCO_OUT ?? "/tmp/toques.json";

const { PRODUCTOS, MAESTRANZA, montaRutas, TOKEN, DEVTOKEN, abre } = await import(
  "./comun.mjs"
);

const browser = await chromium.launch({ executablePath: CHROME });
const res = {};

for (const [name, viewport] of [
  ["1443x812", { width: 1443, height: 812 }],
  ["1280x800", { width: 1280, height: 800 }],
]) {
  const { ctx, page } = await abre(browser, viewport, { tables: MAESTRANZA, lineas: [] });
  await page.locator('[data-testid="table-shape"], button').filter({ hasText: "M1" }).first().click();
  await page.waitForTimeout(1000);

  let toques = 1; // el toque que abre la mesa desde la sala
  const t0 = Date.now();

  const oscuro = (await page.locator('[data-testid="hospitality-workspace"]').count()) > 0;

  /** ¿Está el producto a la vista, sin desplazar? */
  async function visible(nombre) {
    return page.evaluate((n) => {
      const sel = '[data-testid="product-button"], [data-testid="product-tile"]';
      const el = [...document.querySelectorAll(sel)].find((b) =>
        (b.textContent ?? "").includes(n),
      );
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0;
    }, nombre);
  }

  async function tocaProducto(nombre) {
    await page
      .locator('[data-testid="product-button"], [data-testid="product-tile"]')
      .filter({ hasText: nombre })
      .first()
      .click();
    await page.waitForTimeout(220);
    toques += 1;
  }

  /** Lleva la pantalla a donde el producto se vea, contando los toques. */
  async function asegura(nombre, familia) {
    if (await visible(nombre)) return;
    const chip = page
      .locator('[data-testid="family-button"], [data-testid="category-chips"] button, nav button, aside button')
      .filter({ hasText: familia })
      .first();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.waitForTimeout(300);
      toques += 1;
    }
    if (!(await visible(nombre))) {
      // Si aun así no se ve, hay que desplazar: se anota.
      res[`${name}-desplazamientos`] = (res[`${name}-desplazamientos`] ?? 0) + 1;
      await page
        .locator('[data-testid="product-button"], [data-testid="product-tile"]')
        .filter({ hasText: nombre })
        .first()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
    }
  }

  /** N unidades de un producto, con la regla de cada pantalla. */
  async function pide(nombre, familia, unidades) {
    await asegura(nombre, familia);
    if (oscuro && unidades > 1) {
      await page.click(`[data-testid="qty-key"][data-qty="${unidades}"]`);
      await page.waitForTimeout(150);
      toques += 1;
      await tocaProducto(nombre);
    } else {
      for (let i = 0; i < unidades; i += 1) await tocaProducto(nombre);
    }
  }

  // La comanda canónica del prompt.
  await pide("Café con leche", "Cafes", 2);
  await pide("Tostada tomate", "Desayunos", 1);
  await pide("Caña", "Cervezas", 2);

  // Enviar.
  const enviar = oscuro
    ? page.locator('[data-testid="comanda-enviar"]')
    : page.locator("button").filter({ hasText: /^Enviar comanda$|^Enviar$|^Reenviar/ }).first();
  await enviar.click();
  await page.waitForTimeout(500);
  toques += 1;
  const tComanda = Date.now() - t0;

  // Cobrar en efectivo.
  const t1 = Date.now();
  let toquesCobro = 0;
  const cobrar = oscuro
    ? page.locator('[data-testid="comanda-cobrar"]')
    : page.locator("button").filter({ hasText: /Cobrar/ }).first();
  await cobrar.click();
  await page.waitForTimeout(700);
  toquesCobro += 1;
  // Dentro del overlay: «Efectivo» (si hay que elegirlo) y confirmar.
  const efectivo = page.locator("button").filter({ hasText: /^Efectivo$/ });
  if ((await efectivo.count()) > 0) {
    const activo = await efectivo.first().getAttribute("aria-pressed");
    if (activo !== "true") {
      await efectivo.first().click();
      await page.waitForTimeout(250);
      toquesCobro += 1;
    }
  }
  const exacto = page.locator("button").filter({ hasText: /Importe exacto/ });
  if ((await exacto.count()) > 0) {
    await exacto.first().click();
    await page.waitForTimeout(250);
    toquesCobro += 1;
  }
  const confirmar = page
    .locator("button")
    .filter({ hasText: /^Cobrar$|^Cobrar /})
    .last();
  await confirmar.click();
  await page.waitForTimeout(900);
  toquesCobro += 1;
  const tCobro = Date.now() - t1;

  res[name] = {
    pantalla: oscuro ? "oscura (v2-H1)" : "clara (antes)",
    toquesComanda: toques,
    msComanda: tComanda,
    toquesCobro,
    msCobro: tCobro,
  };
  await page.screenshot({ path: `/tmp/toques-${MODO}-${name}.png` });
  await ctx.close();
}

await browser.close();
writeFileSync(OUT, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
