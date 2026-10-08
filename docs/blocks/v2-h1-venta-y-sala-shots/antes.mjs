// Las cuatro medidas que el prompt pide ANTES, sobre el TPV claro.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const { MAESTRANZA, abre } = await import("./comun.mjs");
const OUT = process.env.BANCO_OUT ?? "/tmp/antes.json";
const browser = await chromium.launch({ executablePath: CHROME });
const res = {};
for (const [name, viewport] of [
  ["1443x812", { width: 1443, height: 812 }],
  ["1280x800", { width: 1280, height: 800 }],
]) {
  // ── Sala ──
  const s = await abre(browser, viewport, { tables: MAESTRANZA, lineas: [] });
  await s.page.waitForTimeout(700);
  await s.page.screenshot({ path: `${process.env.SHOTS}/antes-sala-${name}.png` });
  res[`sala-${name}`] = await s.page.evaluate(() => {
    const imp = document.querySelector('[data-testid="table-card-amount"]');
    const mesas = [...document.querySelectorAll("button, a")].filter((b) =>
      /^[BMT]\d/.test((b.textContent ?? "").trim()),
    );
    const tam = new Set(
      mesas.map((m) => {
        const r = m.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      }),
    );
    return {
      importeMesa: imp ? getComputedStyle(imp).fontSize : null,
      nombreMesa: mesas[0] ? getComputedStyle(mesas[0].querySelector("span") ?? mesas[0]).fontSize : null,
      tamanosDeMesa: [...tam],
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    };
  });
  await s.ctx.close();

  // ── Venta ──
  const v = await abre(browser, viewport, { tables: MAESTRANZA, lineas: [] });
  await v.page.locator("button, a").filter({ hasText: "M1" }).first().click();
  await v.page.waitForTimeout(1100);
  await v.page.locator('[data-testid="product-tile"]').filter({ hasText: "Café con leche" }).first().click();
  await v.page.waitForTimeout(500);
  await v.page.screenshot({ path: `${process.env.SHOTS}/antes-venta-${name}.png` });
  res[`venta-${name}`] = await v.page.evaluate(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const tiles = [...document.querySelectorAll('[data-testid="product-tile"]')];
    const visibles = tiles.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= vh + 0.5 && r.left >= 0 && r.right <= vw + 0.5;
    });
    const nombre = tiles[0]?.querySelector("span");
    const linea = document.querySelector('[data-testid="cart-line-name"]');
    const total = [...document.querySelectorAll("span")].find(
      (s) => /€/.test(s.textContent ?? "") && parseFloat(getComputedStyle(s).fontSize) > 24,
    );
    const cobrar = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").startsWith("Cobrar"),
    );
    return {
      productosEnDom: tiles.length,
      productosVisibles: visibles.length,
      nombreProducto: nombre ? getComputedStyle(nombre).fontSize : null,
      lineaComanda: linea ? getComputedStyle(linea).fontSize : null,
      total: total ? getComputedStyle(total).fontSize : null,
      cobrarAlto: cobrar ? Math.round(cobrar.getBoundingClientRect().height) : null,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    };
  });
  // Una familia: Licores.
  const chip = v.page.locator("button").filter({ hasText: /^Licores/ }).first();
  if ((await chip.count()) > 0) {
    await chip.click();
    await v.page.waitForTimeout(500);
    await v.page.screenshot({ path: `${process.env.SHOTS}/antes-venta-licores-${name}.png` });
    res[`venta-licores-${name}`] = await v.page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const tiles = [...document.querySelectorAll('[data-testid="product-tile"]')];
      return {
        productosEnDom: tiles.length,
        productosVisibles: tiles.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= vh + 0.5 && r.left >= 0 && r.right <= vw + 0.5;
        }).length,
      };
    });
  }
  await v.ctx.close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
