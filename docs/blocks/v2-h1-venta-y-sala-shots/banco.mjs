// Bucle visual de v2-H1. playwright-core en el scratchpad, Chromium de
// ms-playwright, vite sirviendo apps/tpv-web y `page.route` sobre la API.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BANCO_URL ?? "http://localhost:5281";
const OUT = process.env.BANCO_OUT ?? "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64({ alg: "none", typ: "JWT" })}.${b64(p)}.x`;
const EXP = Math.floor(Date.now() / 1000) + 86400;
const TOKEN = jwt({ purpose: "test-cashier", exp: EXP, tid: "t-maestranza" });
const DEVTOKEN = jwt({ purpose: "test-device", exp: EXP, tid: "t-maestranza" });

// ── La carta de La Maestranza: 9 familias, Licores con 31 ────────────
const FAMILIAS = [
  ["cafes", ["Café con leche", "Cortado", "Café solo", "Cola Cao", "Descafeinado"]],
  ["desayunos", ["Tostada tomate", "Croissant", "Tostada jamón", "Pincho tortilla"]],
  ["cervezas", ["Caña", "Botellín", "Mahou tercio", "Doble"]],
  ["refrescos", ["Coca-Cola", "Agua", "Aquarius", "Tinto verano", "Fanta"]],
  ["vinos", ["Ribera", "Rioja", "Verdejo"]],
  ["licores", Array.from({ length: 31 }, (_, i) => [
    "Whisky JB","Ron Barceló","Gin Beefeater","Vodka Absolut","Baileys","Orujo de hierbas",
    "Pacharán","Licor de café","Anís","Brandy Soberano","Cointreau","Jägermeister",
    "Tequila","Amaretto","Ginebra Larios","Ron Brugal","Whisky Ballantines","Vodka Smirnoff",
    "Licor de melón","Crema de orujo","Patxaran","Sambuca","Grappa","Calvados",
    "Armañac","Oporto","Jerez","Moscatel","Vermut rojo","Vermut blanco","Chupito surtido",
  ][i])],
  ["raciones", ["Croquetas", "Patatas bravas", "Calamares", "Ensaladilla"]],
  ["bocadillos", ["Montado", "Bocadillo", "Hamburguesa"]],
  ["platos", ["Menú del día", "Entrecot", "Merluza"]],
];
const PRODUCTOS = [];
let n = 0;
for (const [fam, nombres] of FAMILIAS) {
  for (const name of nombres) {
    n += 1;
    PRODUCTOS.push({
      id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      holdedProductId: `h-${n}`, name, sku: `SKU${n}`, barcode: null,
      basePrice: 1.5, taxRate: 10, exemptionCause: null, kind: "PRODUCT",
      imageMime: null, tags: [fam], durationMin: null, sellableViaTpv: true,
    });
  }
}
const pick = (nombre) => PRODUCTOS.find((p) => p.name === nombre);

// ── Las mesas ────────────────────────────────────────────────────────
const ahora = new Date();
const haceMin = (m) => new Date(ahora.getTime() - m * 60_000).toISOString();
function mesa(name, zone, over = {}) {
  return {
    id: `t-${name}`, name, capacity: 4, zone,
    positionX: null, positionY: null, width: null, height: null,
    barSeatIndex: zone === "BARRA" ? Number(name.slice(1)) : null,
    groupedIntoTableId: null, state: "FREE", activeTicket: null,
    createdAt: ahora.toISOString(), ...over,
  };
}
function ocupada(name, zone, total, min, estado = "OPEN") {
  return mesa(name, zone, {
    state: estado,
    activeTicket: {
      id: `tk-${name}`, total, diners: 2, openedAt: haceMin(min),
      openedByEmail: "salome@maestranza.es", openedByAlias: "Salomé", lineCount: 3,
    },
  });
}
const MAESTRANZA = [
  ocupada("B1", "BARRA", "4.80", 6), mesa("B2", "BARRA"), mesa("B3", "BARRA"), mesa("B4", "BARRA"),
  ocupada("M1", "SALON", "17.50", 12), mesa("M2", "SALON"), mesa("M3", "SALON"),
  ocupada("M4", "SALON", "55.00", 48), mesa("M5", "SALON"), mesa("M6", "SALON"),
  mesa("T1", "TERRAZA"), ocupada("T2", "TERRAZA", "7.70", 20, "BILLING"), mesa("T3", "TERRAZA"),
  mesa("T4", "TERRAZA"), mesa("T5", "TERRAZA"), mesa("T6", "TERRAZA"),
];
const SIROPE = [
  ocupada("M1", "SALON", "22.40", 15), mesa("M2", "SALON"), mesa("M3", "SALON"),
  mesa("T1", "TERRAZA"),
];

// ── El doble de la API ───────────────────────────────────────────────
function montaRutas(page, { tables, lineas, lastSentAt, revision, ahoraItems }) {
  const draftLines = lineas ?? [];
  const draft = () => ({
    id: "tk-M1", status: "DRAFT", externalId: "e-1", tableId: "t-M1",
    table: { id: "t-M1", name: "M1", zone: "SALON", capacity: 4 },
    diners: 2, total: String(draftLines.reduce((s, l) => s + Number(l.total), 0)),
    totalTax: "0", totalDiscount: "0", createdAt: ahora.toISOString(),
    lastSentAt: lastSentAt ?? null, lastSentRevision: revision ?? 0,
    lines: draftLines,
  });
  // Sólo la API: todo lo demás (módulos de vite, fuentes) pasa intacto.
  return page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (p === "/devices/me") return json({
      device: { id: "d-1", name: "AP13", pairedAt: ahora.toISOString() },
      register: { id: "r-1", name: "Caja 1", numSerieHolded: null },
      store: { id: "s-1", name: "La Maestranza" },
      tenant: { id: "t-maestranza", name: "La Maestranza", cashierAutoLogoutMinutes: 60, requireCashCountOnClose: false },
    });
    if (p === "/shift/cashier-bootstrap") return json({
      user: { id: "u-1", email: "salome@maestranza.es", alias: "Salomé", role: "MANAGER" },
      tenant: { id: "t-maestranza", name: "La Maestranza", cashierAutoLogoutMinutes: 60 },
      register: { id: "r-1", name: "Caja 1", numSerieHolded: null },
      store: { id: "s-1", name: "La Maestranza" },
      shift: { id: "sh-1", openedAt: ahora.toISOString(), cashOpening: "100.00" },
    });
    if (p === "/tpv/catalog/products") return json({
      items: PRODUCTOS, nextCursor: null,
      businessType: "HOSPITALITY", tpvIconPreset: null,
      creditSalesEnabled: false, crmEnabled: false, agendaEnabled: false,
      holdedEnabled: true, clinicalRecordsEnabled: false, tagAliases: [],
      tenantId: "t-maestranza",
    });
    if (p === "/tpv/catalog/modifier-groups") return json({ groups: [] });
    if (p === "/tpv/catalog/wildcards") return json({ items: [] });
    if (p === "/tpv/catalog/now") return json({
      source: ahoraItems ? "sales" : "families", bandHours: 1, windowDays: 28,
      items: ahoraItems ?? [],
    });
    if (p === "/tpv/catalog/top-sellers") return json({ source: "month", items: [] });
    if (p === "/tpv/health/holded") return json({
      level: "ok", reason: "", hasHoldedKey: true, lastIncrementalSyncAt: null,
      lastSyncAgeMs: null, blockedAt: null, pendingSyncCount: 0, syncFailedCount: 0,
    });
    if (p === "/tpv/tables") return json({ storeId: "s-1", registerId: "r-1", tables });
    if (p === "/shift/current") return json({ shift: null });
    if (p.startsWith("/tickets/") && p.endsWith("/day-summary")) return json({ summary: null });
    if (p.includes("/send-to-kitchen")) return json({
      revision: (revision ?? 0) + 1, sentAt: ahora.toISOString(),
      sections: [{ section: "BARRA", ok: true, lineCount: draftLines.length }],
    });
    if (p.startsWith("/tables/") && p.endsWith("/open")) return json({ ticket: draft() }, 201);
    if (p.startsWith("/tables/") && p.endsWith("/lines") && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      draftLines.push({
        id: body.lineExternalId, productId: body.productId ?? null, variantId: null,
        holdedProductId: body.holdedProductId ?? null, sku: body.sku,
        nameSnapshot: body.nameSnapshot, units: String(body.units),
        unitPrice: String(body.unitPrice), discountPct: "0",
        taxRate: String(body.taxRate), subtotal: String(body.units * body.unitPrice),
        total: String(Math.round(body.units * body.unitPrice * 1.1 * 100) / 100),
        modifiers: null,
      });
      return json({ ticket: draft() }, 201);
    }
    if (p.includes("/lines/") && route.request().method() === "PATCH") {
      const id = p.split("/lines/")[1];
      const l = draftLines.find((x) => x.id === id);
      const body = route.request().postDataJSON();
      if (l && body.units !== undefined) l.units = String(body.units);
      return json({ ticket: draft() });
    }
    if (p.includes("/lines/") && route.request().method() === "DELETE") {
      const id = p.split("/lines/")[1];
      const i = draftLines.findIndex((x) => x.id === id);
      if (i >= 0) draftLines.splice(i, 1);
      return json({ ticket: draft() });
    }
    if (p.startsWith("/tickets/tk-M1")) return json({ ticket: draft() });
    if (p === "/shift/day-summary/pending") return json({ summary: null });
    return json({});
  });
}

function linea(id, productoNombre, units, total) {
  const prod = pick(productoNombre);
  return {
    id, productId: prod.id, variantId: null, holdedProductId: prod.holdedProductId,
    sku: prod.sku, nameSnapshot: productoNombre, units: String(units),
    unitPrice: "1.5", discountPct: "0", taxRate: "10",
    subtotal: String(units * 1.5), total: String(total), modifiers: null,
  };
}

// ── El banco ─────────────────────────────────────────────────────────
const medidas = {};

async function abre(browser, viewport, rutas) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: false,
    // El plugin PWA registra un service worker en dev y sus `fetch` NO
    // pasan por `page.route`: sin esto, parte de la API se iba al proxy
    // de vite (que apunta a un backend que no existe) y el catálogo
    // llegaba con un 500.
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) {
      console.log("  [api", r.status() + "]", new URL(r.url()).pathname);
    }
  });
  await montaRutas(page, rutas);
  await page.goto(`${BASE}/?testCashierToken=${TOKEN}&testDeviceToken=${DEVTOKEN}`, {
    waitUntil: "domcontentloaded",
  });
  // El modo prueba recarga una vez para limpiar la URL.
  await page.waitForTimeout(1200);
  // Fuera el banner ámbar de modo prueba: no existe para un camarero
  // real y falsearía el reparto vertical.
  // El banner es el <strong>Modo prueba</strong>: se sube a su
  // contenedor directo y se quita SÓLO ese. (La primera versión buscaba
  // el div más alto que contuviera el texto y se llevó la app entera por
  // delante: la pantalla salía en blanco.)
  await page.evaluate(() => {
    const strong = [...document.querySelectorAll("strong")].find(
      (el) => el.textContent?.trim() === "Modo prueba",
    );
    const banner = strong?.closest("div")?.parentElement;
    if (banner && (banner.textContent ?? "").includes("ventas no se suben")) {
      banner.remove();
    }
  });
  return { ctx, page };
}

async function rect(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      x: Math.round(r.x), y: Math.round(r.y),
      fontSize: cs.fontSize, background: cs.backgroundColor, radius: cs.borderRadius,
    };
  }, sel);
}

async function scroll(page) {
  return page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyScroll: document.body.scrollHeight,
  }));
}

const VIEWPORTS = [
  { name: "1443x812", viewport: { width: 1443, height: 812 } },
  { name: "1280x800", viewport: { width: 1280, height: 800 } },
];

const browser = await chromium.launch({ executablePath: CHROME });

// ── Venta ────────────────────────────────────────────────────────────
for (const { name, viewport } of VIEWPORTS) {
  const { ctx, page } = await abre(browser, viewport, {
    tables: MAESTRANZA,
    lineas: [linea("l1", "Café con leche", 1, 1.65), linea("l2", "Tostada tomate", 1, 2.5)],
    lastSentAt: haceMin(5), revision: 1,
  });
  // Entrar en M1 desde la sala.
  await page.locator('[data-testid="table-shape"]').filter({ hasText: "M1" }).first().click();
  await page.waitForTimeout(900);

  // (a) «Ahora»
  await page.screenshot({ path: `${OUT}/venta-ahora-${name}.png` });
  medidas[`venta-ahora-${name}`] = {
    grid: await rect(page, '[data-testid="product-grid"]'),
    columnas: await page.getAttribute('[data-testid="product-grid"]', "data-columns"),
    filas: await page.getAttribute('[data-testid="product-grid"]', "data-rows"),
    cabe: await page.getAttribute('[data-testid="product-grid"]', "data-fits"),
    productosVisibles: await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      return [...document.querySelectorAll('[data-testid="product-button"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= vh + 0.5 && r.left >= 0 && r.right <= vw + 0.5;
      }).length;
    }),
    productosEnDom: await page.locator('[data-testid="product-button"]').count(),
    nombreProducto: await rect(page, '[data-testid="product-name"]'),
    botonProducto: await rect(page, '[data-testid="product-button"]'),
    familia: await rect(page, '[data-testid="family-button"]'),
    comanda: await rect(page, '[data-testid="comanda"]'),
    lineaEnviada: await rect(page, '[data-testid="comanda-linea-enviada"]'),
    nombreLinea: await rect(page, '[data-testid="cart-line-name"]'),
    total: await rect(page, '[data-testid="comanda-total"]'),
    cobrar: await rect(page, '[data-testid="comanda-cobrar"]'),
    qtyKey: await rect(page, '[data-testid="qty-key"]'),
    scroll: await scroll(page),
  };

  // (b) Cervezas
  await page.click('[data-testid="family-button"]:has-text("Cervezas")');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/venta-cervezas-${name}.png` });

  // (c) Licores: los 31, el caso que el prompt manda medir
  await page.click('[data-testid="family-button"]:has-text("Licores")');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/venta-licores-${name}.png` });
  medidas[`venta-licores-${name}`] = {
    columnas: await page.getAttribute('[data-testid="product-grid"]', "data-columns"),
    filas: await page.getAttribute('[data-testid="product-grid"]', "data-rows"),
    cabe: await page.getAttribute('[data-testid="product-grid"]', "data-fits"),
    productosEnDom: await page.locator('[data-testid="product-button"]').count(),
    productosVisibles: await page.evaluate(() => {
      const vh = window.innerHeight, vw = window.innerWidth;
      return [...document.querySelectorAll('[data-testid="product-button"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= vh + 0.5 && r.left >= 0 && r.right <= vw + 0.5;
      }).length;
    }),
    botonProducto: await rect(page, '[data-testid="product-button"]'),
    nombreProducto: await rect(page, '[data-testid="product-name"]'),
    gridScroll: await page.evaluate(() => {
      const el = document.querySelector('[data-testid="product-grid"]');
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    }),
    scroll: await scroll(page),
  };

  // (d) con comanda sin enviar: cantidad 2 + Caña
  await page.click('[data-testid="family-button"]:has-text("Cervezas")');
  await page.waitForTimeout(250);
  await page.click('[data-testid="qty-key"][data-qty="2"]');
  await page.locator('[data-testid="product-button"]').filter({ hasText: "Caña" }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/venta-sin-enviar-${name}.png` });
  medidas[`venta-sin-enviar-${name}`] = {
    lineaPendiente: await rect(page, '[data-testid="comanda-linea-pendiente"]'),
    stepperMenos: await rect(page, '[data-testid="stepper-menos"]'),
    stepperMas: await rect(page, '[data-testid="stepper-mas"]'),
    qtyPendiente: await rect(page, '[data-testid="pendiente-qty"]'),
    importePendiente: await rect(page, '[data-testid="pendiente-importe"]'),
    nombrePendiente: await rect(page, '[data-testid="comanda-linea-pendiente"] [data-testid="cart-line-name"]'),
    insignia: await rect(page, '[data-testid="product-units"]'),
    total: await rect(page, '[data-testid="comanda-total"]'),
    // El importe no se sale de la comanda.
    importeDentro: await page.evaluate(() => {
      const c = document.querySelector('[data-testid="comanda"]').getBoundingClientRect();
      const i = document.querySelector('[data-testid="pendiente-importe"]').getBoundingClientRect();
      return { desborde: Math.round((i.right - c.right) * 10) / 10 };
    }),
  };
  await ctx.close();
}

// ── Sala ─────────────────────────────────────────────────────────────
for (const [salaNombre, tables] of [["maestranza", MAESTRANZA], ["sirope", SIROPE]]) {
  for (const { name, viewport } of VIEWPORTS) {
    const { ctx, page } = await abre(browser, viewport, { tables });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/sala-${salaNombre}-${name}.png` });
    medidas[`sala-${salaNombre}-${name}`] = {
      scroll: await scroll(page),
      canvas: await rect(page, '[data-testid="room-canvas"]'),
      // Todas las formas: tamaño, zona, estado y radio. Si dos zonas
      // dieran tamaños distintos, se ve aquí.
      formas: await page.evaluate(() => {
        return [...document.querySelectorAll('[data-testid="table-shape"]')].map((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            nombre: el.querySelector('[data-testid="table-name"]')?.textContent?.trim()
              ?? el.textContent?.trim().slice(0, 4),
            zona: el.getAttribute("data-zone"),
            estado: el.getAttribute("data-state"),
            tarde: el.getAttribute("data-late"),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            x: Math.round(r.x), y: Math.round(r.y),
            radio: cs.borderTopLeftRadius,
            fondo: cs.backgroundColor,
          };
        });
      }),
      bandas: await page.evaluate(() =>
        [...document.querySelectorAll("[data-zone-label]")].map((el) => {
          const r = el.closest("section").getBoundingClientRect();
          return {
            zona: el.getAttribute("data-zone-label"),
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height),
          };
        }),
      ),
      nombreMesa: await rect(page, '[data-testid="table-name"]'),
      importeMesa: await rect(page, '[data-testid="table-card-amount"]'),
      cabecera: await rect(page, "header"),
      contador: await page.textContent('[data-testid="room-counter"]'),
      leyenda: await rect(page, '[data-testid="room-legend"]'),
    };
    // Filtrada por Barra: el mismo tamaño que en «Todas».
    if (salaNombre === "maestranza" && name === "1443x812") {
      await page.click('[data-testid="zone-chip"][data-zone="BARRA"]');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/sala-maestranza-barra-${name}.png` });
      medidas[`sala-filtrada-barra-${name}`] = {
        formas: await page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="table-shape"]')].map((el) => {
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          }),
        ),
        mostrador: await rect(page, '[data-testid="bar-counter"]'),
      };
    }
    await ctx.close();
  }
}

// ── Handheld 390 ─────────────────────────────────────────────────────
{
  const { ctx, page } = await abre(browser, { width: 390, height: 844 }, { tables: MAESTRANZA });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/sala-handheld-390.png`, fullPage: true });
  medidas["sala-handheld-390"] = {
    scroll: await scroll(page),
    formas: await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="table-shape"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { zona: el.getAttribute("data-zone"), w: Math.round(r.width), h: Math.round(r.height) };
      }),
    ),
    columnasPorBanda: await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="room-grid"]')].map((g) => {
        const tops = new Set(
          [...g.children].map((c) => Math.round(c.getBoundingClientRect().top)),
        );
        return { mesas: g.children.length, filas: tops.size };
      }),
    ),
  };
  await page.click('[data-testid="table-shape"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/venta-handheld-390.png`, fullPage: true });
  medidas["venta-handheld-390"] = {
    barra: await rect(page, '[data-testid="handheld-bar"]'),
    grid: await rect(page, '[data-testid="product-grid"]'),
    familyBar: await rect(page, '[data-testid="family-bar"]'),
    familyCols: await page.getAttribute('[data-testid="family-bar"]', "data-columns"),
    nombreProducto: await rect(page, '[data-testid="product-name"]'),
    comandaEnFlujo: await page.locator('[data-testid="comanda"]').count(),
    buscadorMontado: await page.locator('input[type="search"]').count(),
    inputMode: await page.getAttribute('input[type="search"]', "inputmode"),
    // Scroll HORIZONTAL: prohibido por ux-principles §1.8.
    desbordeHorizontal: await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    })),
    qtyCols: await page.getAttribute('[data-testid="qty-row"]', "data-columns"),
    qtyKey: await page.evaluate(() => {
      const el = document.querySelector('[data-testid="qty-key"]');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }),
  };
  // La comanda en la hoja.
  await page.click('[aria-label="Abrir la comanda"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/venta-handheld-390-comanda.png` });
  medidas["venta-handheld-390"].comandaEnHoja = await page
    .locator('[data-testid="comanda"]')
    .count();
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/medidas.json`, JSON.stringify(medidas, null, 2));
console.log("OK · medidas en", `${OUT}/medidas.json`);
