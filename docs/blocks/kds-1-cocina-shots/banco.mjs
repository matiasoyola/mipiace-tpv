// kds-1-cocina · EL BUCLE VISUAL.
//
// Mismo montaje que v2-H1 (`docs/blocks/v2-h1-venta-y-sala-shots/`):
// `playwright-core` en el scratchpad, el Chromium de `ms-playwright`,
// `vite` sirviendo `apps/tpv-web` y `page.route` sobre `/api/**`. Nada se
// instala en el repo.
//
// Lo que captura:
//
//   · la PANTALLA DE COCINA a 1280 × 800, que es el peor caso de la
//     decisión 1 (tablet de 10" en un soporte de pared);
//   · la COMANDA DEL TPV a 1443 × 812 (el D8/AP13) y a 1280 × 800.
//
// Y lo que MIDE, que es lo que entra en el `-done`: cuántas tarjetas caben
// enteras, el alto de cada una, el tamaño de la mesa y de los minutos, el
// alto de la línea de plato, el «Lista», el «Visto» y si la página
// desplaza.
//
// Uso:
//   pnpm --filter @mipiacetpv/tpv-web dev --port 5281   (en otra terminal)
//   BANCO_OUT=docs/blocks/kds-1-cocina-shots node docs/blocks/kds-1-cocina-shots/banco.mjs

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BANCO_URL ?? "http://localhost:5281";
const OUT = process.env.BANCO_OUT ?? "/tmp/kds-shots";
mkdirSync(OUT, { recursive: true });

const ahora = new Date();
const haceMin = (m) => new Date(ahora.getTime() - m * 60_000).toISOString();

// ── El servicio de media mañana que pide la decisión 7 ───────────────
//
// Una mesa en verde, una en ámbar, una en rojo, una urgente, una con
// alergia por silla y cruce, una con un anulado sin «Visto» y una con un
// tiempo en espera. Es el escenario literal del «siguiente paso» de
// `docs/kds/00-decisiones.md`.
function linea(id, name, units, over = {}) {
  return {
    id,
    name,
    units,
    unitsOriginal: null,
    notes: [],
    course: 1,
    seat: null,
    fired: true,
    done: false,
    voidedUnits: 0,
    voidPending: false,
    doneBeforeVoid: false,
    changeNote: null,
    changePending: false,
    carries: [],
    allergyWarning: null,
    ...over,
  };
}

function comanda(id, tableName, min, over = {}) {
  const t = haceMin(min);
  return {
    id,
    section: "COCINA",
    ticketId: `tk-${id}`,
    tableId: `t-${tableName}`,
    tableName,
    number: 1,
    urgent: false,
    lateArrival: false,
    sentAt: t,
    firedAt: t,
    orderAt: t,
    readyAt: null,
    servedAt: null,
    recoveredAt: null,
    isNew: false,
    allergyBands: [],
    lines: [linea(`${id}-l1`, "Patatas bravas", 2)],
    ...over,
  };
}

const COMANDAS = [
  // Urgente, la primera. Franja roja y borde.
  comanda("o-t4", "T4", 2, {
    urgent: true,
    isNew: true,
    number: 1,
    lines: [
      linea("o-t4-l1", "Croquetas", 2),
      linea("o-t4-l2", "Calamares", 1, { notes: ["Sin limón"] }),
    ],
  }),
  // La de la alergia por silla CON cruce: el caso del prompt.
  comanda("o-m5", "M5", 7, {
    number: 2,
    isNew: true,
    allergyBands: ["⚠ SILLA 3 · SIN GLUTEN"],
    lines: [
      linea("o-m5-l1", "Magro con tomate", 1, { seat: 3 }),
      linea("o-m5-l2", "Patatas bravas", 1, {
        seat: 3,
        allergyWarning: "¡LLEVA GLUTEN!",
      }),
      linea("o-m5-l3", "Croquetas", 2),
    ],
  }),
  // Verde.
  comanda("o-m1", "M1", 4, {
    lines: [
      linea("o-m1-l1", "Ensaladilla rusa", 1),
      linea("o-m1-l2", "Jamón serrano", 1),
      linea("o-m1-l3", "Queso curado", 1),
    ],
  }),
  // Ámbar.
  comanda("o-m2", "M2", 14, {
    lines: [
      linea("o-m2-l1", "Calamares", 2, { notes: ["Punto: poco hecho"] }),
      linea("o-m2-l2", "Chopitos", 1),
    ],
  }),
  // Rojo, y con un ANULADO sin «Visto».
  comanda("o-m4", "M4", 26, {
    number: 2,
    lines: [
      linea("o-m4-l1", "Croquetas", 2, {
        unitsOriginal: 3,
        voidedUnits: 1,
        voidPending: true,
      }),
      linea("o-m4-l2", "Alitas de pollo", 1, { done: true }),
    ],
  }),
  // Con un tiempo EN ESPERA.
  comanda("o-t2", "T2", 9, {
    lines: [
      linea("o-t2-l1", "Patatas alioli", 1),
      linea("o-t2-l2", "Filete de ternera", 2, { fired: false, course: 2 }),
    ],
  }),
  // Dos más, para que el indicador «+N» tenga trabajo.
  comanda("o-m6", "M6", 11, {
    lines: [linea("o-m6-l1", "Hamburguesa especial", 2, { notes: ["Sin cebolla"] })],
  }),
  comanda("o-b1", "B1", 3, {
    isNew: true,
    lines: [linea("o-b1-l1", "Torrezno", 1), linea("o-b1-l2", "Fingers de pollo", 2)],
  }),
];

const LISTAS = [
  comanda("o-m3", "M3", 18, { readyAt: haceMin(2) }),
];

const AJUSTES = { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false };

// ── El doble de la API, para la PANTALLA DE COCINA ───────────────────
function rutasCocina(page) {
  return page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    // Lo que convierte esta tablet en una pantalla: el 403 de la puerta
    // del TPV. Es la respuesta de verdad del servidor, no un atajo.
    if (p === "/devices/me") {
      return json(
        {
          error: "KITCHEN_DEVICE_NOT_ALLOWED",
          message:
            "Una pantalla de cocina no vende: ni cobra, ni abre turno, ni emite registros.",
        },
        403,
      );
    }
    if (p === "/kitchen/me") {
      return json({
        device: { id: "d-cocina", name: "Pase" },
        store: { id: "s-1", name: "La Maestranza" },
        sections: ["COCINA"],
        settings: AJUSTES,
      });
    }
    if (p === "/kitchen/comandas") {
      return json({
        serverTime: ahora.toISOString(),
        settings: AJUSTES,
        sections: ["COCINA"],
        orders: COMANDAS,
        ready: LISTAS,
      });
    }
    if (p === "/kitchen/comandas/hoy") {
      return json({
        serverTime: ahora.toISOString(),
        settings: AJUSTES,
        sections: ["COCINA"],
        orders: LISTAS,
        ready: [],
      });
    }
    return json({ ok: true });
  });
}

async function rect(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      x: Math.round(r.x),
      y: Math.round(r.y),
      fontSize: cs.fontSize,
      background: cs.backgroundColor,
      animationDuration: cs.animationDuration,
    };
  }, sel);
}

const medidas = {};
const browser = await chromium.launch({ executablePath: CHROME });

// ── 1 · LA PANTALLA DE COCINA, a 1280 × 800 ─────────────────────────
{
  const viewport = { width: 1280, height: 800 };
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: false,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  await rutasCocina(page);
  // El token de dispositivo lo deja el modo prueba del arranque.
  await page.addInitScript(() => {
    localStorage.setItem("mipiacetpv-device-token", "token-de-la-pantalla");
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="kds-screen"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/cocina-1280x800.png` });

  medidas["cocina-1280x800"] = {
    barra: await rect(page, "header"),
    zona: await rect(page, '[data-testid="kds-zona"]'),
    columnaListas: await rect(page, '[data-testid="kds-listas"]'),
    tarjetasEnDom: await page.locator('[data-testid="kds-comanda"]').count(),
    // Las que caben ENTERAS dentro del área, que es lo que la decisión 7
    // prohíbe cortar.
    tarjetasQueCaben: await page.evaluate(() => {
      const zona = document.querySelector('[data-testid="kds-zona"]');
      const z = zona.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="kds-comanda"]')].filter(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.top >= z.top - 0.5 && r.bottom <= z.bottom + 0.5;
        },
      ).length;
    }),
    // El sabotaje «cortar una tarjeta», medido: cuántas se salen del área.
    tarjetasCortadas: await page.evaluate(() => {
      const zona = document.querySelector('[data-testid="kds-zona"]');
      const z = zona.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="kds-comanda"]')].filter(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > z.bottom + 0.5 || r.top < z.top - 0.5;
        },
      ).length;
    }),
    ordenDelDom: await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="kds-comanda"]')].map((el) => ({
        mesa: el.dataset.comandaId,
        urgente: el.dataset.urgente,
        tono: el.dataset.tono,
      })),
    ),
    tarjeta: await rect(page, '[data-testid="kds-comanda"]'),
    cabecera: await rect(page, '[data-testid="kds-cabecera"]'),
    mesa: await rect(page, '[data-testid="kds-cabecera"] span'),
    franjaUrgente: await rect(page, '[data-testid="kds-franja-urgente"]'),
    franjaAlergia: await rect(page, '[data-testid="kds-franja-alergia"]'),
    lleva: await rect(page, '[data-testid="kds-lleva"]'),
    linea: await rect(page, '[data-testid="kds-linea"] button'),
    nota: await rect(page, '[data-testid="kds-nota"]'),
    lista: await rect(page, '[data-testid="kds-lista"]'),
    visto: await rect(page, '[data-testid="kds-visto"]'),
    masN: await rect(page, '[data-testid="kds-mas-n"]'),
    masNTexto: await page
      .locator('[data-testid="kds-mas-n"]')
      .textContent()
      .catch(() => null),
    // ── LA CALIBRACIÓN DE `altoTarjeta` ───────────────────────────────
    //
    // `kitchenLayout.altoTarjeta` ESTIMA la altura de los tokens en vez de
    // medirla con el DOM (ver su cabecera: medir pide dos pasadas y
    // parpadea en cada cambio). La estimación tiene que ir POR LO ALTO: si
    // fuera por lo bajo, el reparto creería que una fila cabe cuando no
    // cabe y una tarjeta se CORTARÍA, que es justo lo que la decisión 7
    // prohíbe.
    //
    // Esto es lo que lo comprueba contra el navegador de verdad: la altura
    // REAL de cada tarjeta pintada. El `-done` lleva el número.
    alturasReales: await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="kds-comanda"]')].map((el) => ({
        id: el.dataset.comandaId,
        alto: Math.round(el.getBoundingClientRect().height * 10) / 10,
        lineas: el.querySelectorAll('[data-testid="kds-linea"]').length,
        notas: el.querySelectorAll('[data-testid="kds-nota"]').length,
        bandas: el.querySelectorAll('[data-testid="kds-franja-alergia"]').length,
        urgente: el.dataset.urgente === "1",
        sillas: el.querySelectorAll('[data-testid="kds-silla"]').length,
        avisos: el.querySelectorAll('[data-testid="kds-lleva"]').length,
        anulados: el.querySelectorAll('[data-testid="kds-anulado"]').length,
        espera: el.querySelectorAll('[data-testid="kds-bloque-espera"]').length,
      })),
    ),
    hoy: await rect(page, '[data-testid="kds-hoy"]'),
    // El parpadeo: lo que la decisión 8 fija en 2,5 s.
    pulsoTarjeta: await page.evaluate(() => {
      const el = document.querySelector(".kds-pulso-tarjeta");
      return el ? getComputedStyle(el).animationDuration : null;
    }),
    pulsoRojo: await page.evaluate(() => {
      const el = document.querySelector(".kds-pulso-rojo");
      return el ? getComputedStyle(el).animationDuration : null;
    }),
    // Que la PÁGINA no desplace: una pantalla de pared no se scrollea.
    scroll: await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    })),
    // Sin audio: ni un elemento, ni un AudioContext creado.
    audio: await page.evaluate(() => document.querySelectorAll("audio").length),
  };

  // «Hoy», la hoja de recuperar.
  await page.click('[data-testid="kds-hoy"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/cocina-hoy-1280x800.png` });
  await ctx.close();
}

// ── 2 · LA COMANDA DEL TPV, a 1443 × 812 y a 1280 × 800 ─────────────
//
// El D8/AP13 es 1443 × 812 y el AP11 1280 × 800: los dos terminales de la
// pasada en el hierro.

const PRODUCTOS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    holdedProductId: "h-1",
    name: "Caña",
    sku: "CER-001",
    barcode: null,
    basePrice: 1.36,
    taxRate: 10,
    exemptionCause: null,
    kind: "PRODUCT",
    imageMime: null,
    tags: ["cervezas"],
    durationMin: null,
    sellableViaTpv: true,
    allergens: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    holdedProductId: "h-2",
    name: "Patatas bravas",
    sku: "RAC-004",
    barcode: null,
    basePrice: 9.09,
    taxRate: 10,
    exemptionCause: null,
    kind: "PRODUCT",
    imageMime: null,
    tags: ["raciones"],
    durationMin: null,
    sellableViaTpv: true,
    allergens: ["GLUTEN"],
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    holdedProductId: "h-3",
    name: "Croquetas",
    sku: "RAC-003",
    barcode: null,
    basePrice: 9.09,
    taxRate: 10,
    exemptionCause: null,
    kind: "PRODUCT",
    imageMime: null,
    tags: ["raciones"],
    durationMin: null,
    sellableViaTpv: true,
    allergens: ["GLUTEN", "HUEVOS", "LACTEOS"],
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    holdedProductId: "h-4",
    name: "Magro con tomate",
    sku: "RAC-007",
    barcode: null,
    basePrice: 9.09,
    taxRate: 10,
    exemptionCause: null,
    kind: "PRODUCT",
    imageMime: null,
    tags: ["raciones"],
    durationMin: null,
    sellableViaTpv: true,
    allergens: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000005",
    holdedProductId: "h-5",
    name: "Filete de ternera",
    sku: "COM-001",
    barcode: null,
    basePrice: 9.09,
    taxRate: 10,
    exemptionCause: null,
    kind: "PRODUCT",
    imageMime: null,
    tags: ["platos"],
    durationMin: null,
    sellableViaTpv: true,
    allergens: ["HUEVOS"],
  },
];

const MESAS = [
  {
    id: "t-M5",
    name: "M5",
    capacity: 4,
    zone: "SALON",
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    barSeatIndex: null,
    groupedIntoTableId: null,
    state: "OPEN",
    activeTicket: {
      id: "tk-M5",
      total: "31.90",
      diners: 4,
      openedAt: haceMin(14),
      openedByEmail: "salome@maestranza.es",
      openedByAlias: "Salomé",
      lineCount: 4,
    },
    createdAt: ahora.toISOString(),
  },
  {
    id: "t-M4",
    name: "M4",
    capacity: 4,
    zone: "SALON",
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    barSeatIndex: null,
    groupedIntoTableId: null,
    state: "OPEN",
    activeTicket: {
      id: "tk-M4",
      total: "18.00",
      diners: 2,
      openedAt: haceMin(25),
      openedByEmail: "salome@maestranza.es",
      openedByAlias: "Salomé",
      lineCount: 2,
    },
    createdAt: ahora.toISOString(),
  },
];

// Las cuatro líneas de la pasada en el hierro: magro para la silla 3,
// bravas para la silla 3 (con gluten: el aviso), 2 croquetas y 2 cañas.
// Las tres primeras YA están en cocina; el filete está en espera.
function lineaTpv(id, prod, units, over = {}) {
  const p = PRODUCTOS.find((x) => x.name === prod);
  return {
    id,
    productId: p.id,
    variantId: null,
    holdedProductId: p.holdedProductId,
    sku: p.sku,
    nameSnapshot: prod,
    units: String(units),
    unitPrice: String(p.basePrice),
    discountPct: "0",
    taxRate: "10",
    subtotal: String((units * p.basePrice).toFixed(2)),
    total: String((units * p.basePrice * 1.1).toFixed(2)),
    modifiers: null,
    product: { allergens: p.allergens },
    ...over,
  };
}

const LINEAS_TPV = [
  lineaTpv("l-magro", "Magro con tomate", 1, { seat: 3 }),
  lineaTpv("l-bravas", "Patatas bravas", 1, { seat: 3 }),
  lineaTpv("l-croquetas", "Croquetas", 2),
  lineaTpv("l-cana", "Caña", 2),
  lineaTpv("l-filete", "Filete de ternera", 2, { course: 2 }),
];
const ENVIADAS = {
  "l-magro": 1,
  "l-bravas": 1,
  "l-croquetas": 2,
  "l-cana": 2,
};

function rutasTpv(page) {
  const draftLines = LINEAS_TPV.map((l) => ({ ...l }));
  const draft = () => ({
    id: "tk-M5",
    status: "DRAFT",
    externalId: "e-M5",
    tableId: "t-M5",
    table: { id: "t-M5", name: "M5", zone: "SALON", capacity: 4 },
    diners: 4,
    total: String(draftLines.reduce((a, l) => a + Number(l.total), 0).toFixed(2)),
    totalTax: "0",
    totalDiscount: "0",
    createdAt: ahora.toISOString(),
    lastSentAt: haceMin(7),
    lastSentRevision: 1,
    lines: draftLines,
  });
  const destino = { screen: true, printer: false, canCorrectSent: true };
  return page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/devices/me")
      return json({
        device: { id: "d-1", name: "AP13", pairedAt: ahora.toISOString() },
        register: { id: "r-1", name: "Caja 1", numSerieHolded: null },
        store: { id: "s-1", name: "La Maestranza" },
        tenant: {
          id: "t-maestranza",
          name: "La Maestranza",
          cashierAutoLogoutMinutes: 60,
          requireCashCountOnClose: false,
          kitchenDisplayEnabled: true,
        },
        kitchen: {
          courseMode: "ESPERA",
          seatMode: "ALERGIA",
          greenMaxMin: 10,
          amberMaxMin: 20,
          readyBeep: false,
        },
      });
    if (p === "/shift/cashier-bootstrap")
      return json({
        user: {
          id: "u-1",
          email: "salome@maestranza.es",
          alias: "Salomé",
          role: "MANAGER",
        },
        tenant: {
          id: "t-maestranza",
          name: "La Maestranza",
          cashierAutoLogoutMinutes: 60,
          kitchenDisplayEnabled: true,
        },
        register: { id: "r-1", name: "Caja 1", numSerieHolded: null },
        store: { id: "s-1", name: "La Maestranza" },
        shift: { id: "sh-1", openedAt: ahora.toISOString(), cashOpening: "100.00" },
        kitchen: {
          courseMode: "ESPERA",
          seatMode: "ALERGIA",
          greenMaxMin: 10,
          amberMaxMin: 20,
          readyBeep: false,
        },
      });
    if (p === "/tpv/catalog/products")
      return json({
        items: PRODUCTOS,
        nextCursor: null,
        businessType: "HOSPITALITY",
        tpvIconPreset: null,
        creditSalesEnabled: false,
        crmEnabled: false,
        agendaEnabled: false,
        holdedEnabled: true,
        clinicalRecordsEnabled: false,
        tagAliases: [],
        tenantId: "t-maestranza",
      });
    if (p === "/tpv/catalog/modifier-groups") return json({ groups: [] });
    if (p === "/tpv/catalog/wildcards") return json({ items: [] });
    if (p === "/tpv/catalog/now")
      return json({ source: "families", bandHours: 1, windowDays: 28, items: [] });
    if (p === "/tpv/catalog/top-sellers") return json({ source: "month", items: [] });
    if (p === "/tpv/health/holded")
      return json({
        level: "ok",
        reason: "",
        hasHoldedKey: true,
        lastIncrementalSyncAt: null,
        lastSyncAgeMs: null,
        blockedAt: null,
        pendingSyncCount: 0,
        syncFailedCount: 0,
      });
    if (p === "/tpv/tables")
      return json({ storeId: "s-1", registerId: "r-1", tables: MESAS });
    if (p === "/shift/current") return json({ shift: null });
    if (p === "/shift/day-summary/pending") return json({ summary: null });
    if (p.startsWith("/tables/") && p.endsWith("/open")) return json({ ticket: draft() }, 201);
    if (p.startsWith("/tickets/tk-M5") && p.endsWith("/kitchen"))
      return json({
        diners: 4,
        revision: 1,
        lines: draftLines.map((l) => ({
          id: l.id,
          units: Number(l.units),
          sentUnits: ENVIADAS[l.id] ?? 0,
          course: l.course ?? 1,
          seat: l.seat ?? null,
          section: "COCINA",
        })),
        firedCourses: [{ course: 1, firedAt: haceMin(7) }],
        allergies: [{ seat: 3, allergen: "GLUTEN" }],
        orders: [],
        destinations: { BARRA: destino, COCINA: destino, SALON: destino },
      });
    if (p.startsWith("/tickets/") && p.endsWith("/allergies"))
      return json({ diners: 4, allergies: [{ seat: 3, allergen: "GLUTEN" }] });
    if (p === "/kitchen/estado")
      return json({
        heartbeatWindowMs: 90000,
        screens: [
          {
            id: "d-cocina",
            name: "Pase",
            sections: ["COCINA"],
            alive: true,
            lastSeenAt: ahora.toISOString(),
          },
        ],
        sections: [{ section: "COCINA", ...destino, needsPaperFallback: false }],
      });
    if (p === "/kitchen/listas")
      return json({
        ready: [
          {
            orderId: "o-m4",
            ticketId: "tk-M4",
            tableId: "t-M4",
            tableName: "M4",
            section: "COCINA",
            number: 1,
            readyAt: haceMin(2),
          },
        ],
      });
    if (p.startsWith("/tickets/tk-M5")) return json({ ticket: draft() });
    return json({ ok: true });
  });
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwtFalso = (p) => `${b64({ alg: "none", typ: "JWT" })}.${b64(p)}.x`;
const EXP = Math.floor(Date.now() / 1000) + 86400;
const TOKEN = jwtFalso({ purpose: "test-cashier", exp: EXP, tid: "t-maestranza" });
const DEVTOKEN = jwtFalso({ purpose: "test-device", exp: EXP, tid: "t-maestranza" });

for (const { name, viewport } of [
  { name: "1443x812", viewport: { width: 1443, height: 812 } },
  { name: "1280x800", viewport: { width: 1280, height: 800 } },
]) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: false,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  await rutasTpv(page);
  await page.goto(`${BASE}/?testCashierToken=${TOKEN}&testDeviceToken=${DEVTOKEN}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1400);
  // Fuera el banner del modo prueba: no existe para un camarero real.
  await page.evaluate(() => {
    const strong = [...document.querySelectorAll("strong")].find(
      (el) => el.textContent?.trim() === "Modo prueba",
    );
    const banner = strong?.closest("div")?.parentElement;
    if (banner && (banner.textContent ?? "").includes("ventas no se suben")) {
      banner.remove();
    }
  });
  await page
    .locator('[data-testid="table-shape"]')
    .filter({ hasText: "M5" })
    .first()
    .click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/tpv-comanda-${name}.png` });

  medidas[`tpv-comanda-${name}`] = {
    comanda: await rect(page, '[data-testid="comanda"]'),
    lineasEnviadas: await page.locator('[data-testid="comanda-linea-enviada"]').count(),
    lineasPendientes: await page
      .locator('[data-testid="comanda-linea-pendiente"]')
      .count(),
    // La vuelta al sabotaje 5 de v2-H1, medida: el `−` de lo enviado.
    menosEnviado: await rect(page, '[data-testid="stepper-menos-enviado"]'),
    masEnviado: await rect(page, '[data-testid="stepper-mas-enviado"]'),
    chipSilla: await rect(page, '[data-testid="chip-silla"]'),
    chipEspera: await rect(page, '[data-testid="chip-espera"]'),
    botonUrgente: await rect(page, '[data-testid="boton-urgente"]'),
    botonMarchar: await rect(page, '[data-testid="boton-marchar"]'),
    botonAlergias: await rect(page, '[data-testid="boton-alergias"]'),
    bandaListo: await rect(page, '[data-testid="listo-banda"]'),
    bandaListoTexto: await page
      .locator('[data-testid="listo-banda"]')
      .textContent()
      .catch(() => null),
    enviar: await rect(page, '[data-testid="comanda-enviar"]'),
    cobrar: await rect(page, '[data-testid="comanda-cobrar"]'),
    scroll: await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    })),
    // Que el importe no se salga de la comanda, como medía v2-H1.
    desbordeImporte: await page.evaluate(() => {
      const comanda = document.querySelector('[data-testid="comanda"]');
      if (!comanda) return null;
      const c = comanda.getBoundingClientRect();
      let peor = -9999;
      for (const el of document.querySelectorAll(
        '[data-testid="pendiente-importe"]',
      )) {
        const r = el.getBoundingClientRect();
        peor = Math.max(peor, Math.round(r.right - c.right));
      }
      return peor === -9999 ? null : peor;
    }),
  };

  // El «Deshacer» de 5 s: se toca el `−` de una línea enviada.
  const menos = page.locator('[data-testid="stepper-menos-enviado"]').first();
  if (await menos.count()) {
    await menos.click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/tpv-deshacer-${name}.png` });
    medidas[`tpv-comanda-${name}`].deshacer = await rect(
      page,
      '[data-testid="deshacer-aviso"]',
    );
    medidas[`tpv-comanda-${name}`].deshacerTexto = await page
      .locator('[data-testid="deshacer-aviso"]')
      .textContent()
      .catch(() => null);
    await page.click('[data-testid="deshacer-boton"]');
    await page.waitForTimeout(250);
  }

  // La hoja de alergias.
  await page.click('[data-testid="boton-alergias"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/tpv-alergias-${name}.png` });
  medidas[`tpv-alergias-${name}`] = {
    hoja: await rect(page, '[data-testid="alergias-sheet"]'),
    sillas: await page.locator('[data-testid="alergias-silla"]').count(),
    sillaConAlergia: await page
      .locator('[data-testid="alergias-silla"][data-con-alergia="1"]')
      .count(),
    silla: await rect(page, '[data-testid="alergias-silla"]'),
    opciones: await page.locator('[data-testid="alergias-opcion"]').count(),
    opcion: await rect(page, '[data-testid="alergias-opcion"]'),
    tablero: await rect(page, '[data-testid="alergias-tablero"]'),
    scroll: await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    })),
  };
  await ctx.close();
}

writeFileSync(`${OUT}/medidas.json`, JSON.stringify(medidas, null, 2));
console.log(JSON.stringify(medidas, null, 2));
await browser.close();
