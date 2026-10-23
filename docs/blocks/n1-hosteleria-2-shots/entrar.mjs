import { chromium } from "playwright-core";

export const TPV = "http://localhost:5290";
export const DEVICE = "banco-sirope-dispositivo-0001";
export const EMAIL = "soporte+sirope@banco.local";
export const PIN = "1234";

export async function abrir({ w = 360, h = 720 } = {}) {
  const browser = await chromium.launch({
    executablePath:
      process.env.HOME +
      "/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    args: ["--force-device-scale-factor=1"],
  });
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    isMobile: w < 640,
    hasTouch: w < 640,
  });
  await ctx.addInitScript(
    `localStorage.setItem("mipiacetpv-device-token", ${JSON.stringify(DEVICE)});` +
      // El pliegue de zonas SE RECUERDA en el aparato (hallazgo 2), así
      // que una pasada heredaría el estado de la anterior y las medidas
      // dependerían del orden en que se corrieron. Cada medida que
      // necesite zonas plegadas las pliega ella.
      `localStorage.removeItem("mipiacetpv-zonas-plegadas");`,
  );
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console]", m.text().slice(0, 160));
  });
  await page.goto(TPV, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  return { browser, ctx, page };
}

/** Qué hay en pantalla ahora mismo, para no adivinar selectores. */
export async function queHay(page) {
  return page.evaluate(`(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const botones = [...document.querySelectorAll("button")]
      .filter(vis)
      .map((b) => (b.textContent || "").trim().slice(0, 40))
      .filter(Boolean);
    const inputs = [...document.querySelectorAll("input")].filter(vis).map((i) => ({
      type: i.type, name: i.name, ph: i.placeholder, im: i.inputMode,
    }));
    const testids = [...document.querySelectorAll("[data-testid]")]
      .filter(vis)
      .map((e) => e.getAttribute("data-testid"));
    return {
      url: location.href,
      titulo: (document.querySelector("h1,h2")?.textContent || "").trim().slice(0, 80),
      texto: (document.body.innerText || "").slice(0, 400),
      botones: [...new Set(botones)].slice(0, 25),
      inputs,
      testids: [...new Set(testids)].slice(0, 30),
    };
  })()`);
}

/** El flujo real de acceso: email → 4 dígitos → Entrar. */
export async function entrar(page) {
  const email = page.locator('input[name="email"]');
  if (await email.count()) {
    await email.fill(EMAIL);
    // `pin-continuar` es `md:hidden`: SÓLO existe por debajo de 768 px.
    // En el AP11 y el D8 el botón está en el DOM pero no se ve, así que
    // el locator resuelve y el click agota el tiempo sin decir por qué.
    // Por encima del umbral se envía con Enter.
    const continuar = page.locator('[data-testid="pin-continuar"]');
    if (await continuar.isVisible().catch(() => false)) {
      await continuar.click();
    } else {
      await email.press("Enter");
    }
    await page.waitForTimeout(1500);
  }
  // El teclado de PIN: cuatro dígitos. `pulsar("4")` casaría también con
  // «PIN de 4 cifras», así que se busca el botón EXACTO.
  await page.locator('[data-testid="pin-teclado"]').waitFor({ timeout: 15000 });
  const teclado = page.locator('[data-testid="pin-teclado"]');
  for (const d of PIN.split("")) {
    await teclado
      .locator("button")
      .filter({ hasText: new RegExp(`^${d}$`) })
      .first()
      .click();
    await page.waitForTimeout(150);
  }
  // Y el «Entrar», que no lo hace solo.
  await page
    .locator("button")
    .filter({ hasText: /^Entrar$/ })
    .first()
    .click();
  await page.waitForTimeout(3500);
  return queHay(page);
}
