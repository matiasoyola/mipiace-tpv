// kds-2b · EL BUCLE VISUAL DE LO QUE CAMBIA EN LA PANTALLA.
//
// Mismo montaje que `kds-2-wifi-shots/banco.mjs`: `playwright-core` en el
// scratchpad, el Chromium de `ms-playwright`, `vite` sirviendo
// `apps/tpv-web` y `page.route` sobre `/api/**`. Nada se instala en el
// repo.
//
// Tres capturas, una por hallazgo que se VE:
//
//   1. `cocina-sin-informar` · la M5 de la pasada, con internet. Las
//      bravas gritan «¡LLEVA GLUTEN!» en rojo y el magro —cuya ficha no
//      informa de nada— sale «SILLA 3 · ALÉRGENOS SIN INFORMAR» en ÁMBAR.
//      Antes los dos se pintaban igual: «SILLA 3 · SIN GLUTEN».
//   2. `cocina-orden-tras-tachar` · se tacha el PRIMER plato y el servidor
//      devuelve las líneas en otro orden (es lo que hace Postgres cuando
//      un `UPDATE` reescribe la fila). La tarjeta las sigue pintando en el
//      orden en que las vio.
//   3. `cocina-tras-lista` · la M5 pasa a «Listas» y su gemela de la wifi
//      **no vuelve al centro**. Es la tarjeta fantasma: antes de este
//      bloque, aquí había una tarjeta más en el centro, sin tachados.
//
// Uso:
//   pnpm --filter @mipiacetpv/tpv-web dev --port 5283   (en otra terminal)
//   BANCO_URL=http://localhost:5283 BANCO_OUT=docs/blocks/kds-2b-hierro-shots \
//     node docs/blocks/kds-2b-hierro-shots/banco.mjs
//
// (el script se corre DESDE el scratchpad donde está `playwright-core`:
//  la resolución de ESM es relativa al fichero, no al cwd)

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BANCO_URL ?? "http://localhost:5283";
const OUT = process.env.BANCO_OUT ?? "/tmp/kds2b-shots";
mkdirSync(OUT, { recursive: true });

const ahora = new Date();
const haceMin = (m) => new Date(ahora.getTime() - m * 60_000).toISOString();
const AJUSTES = { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false };
const ENVIO = "55555555-5555-4555-8555-555555555555";

/** Las tres líneas de la M5, en el orden en que las tecleó el camarero. */
function lineas() {
  return [
    {
      id: "l1",
      name: "Patatas bravas",
      units: 2,
      unitsOriginal: null,
      notes: ["Sin picante"],
      course: 1,
      seat: 3,
      fired: true,
      done: false,
      voidedUnits: 0,
      voidPending: false,
      doneBeforeVoid: false,
      changeNote: null,
      changePending: false,
      carries: ["gluten"],
      seatAllergy: "SIN GLUTEN",
      allergyWarning: "¡LLEVA GLUTEN!",
      allergensUnknown: null,
    },
    {
      id: "l2",
      name: "Magro con tomate",
      units: 1,
      unitsOriginal: null,
      notes: [],
      course: 1,
      seat: 3,
      fired: true,
      done: false,
      voidedUnits: 0,
      voidPending: false,
      doneBeforeVoid: false,
      changeNote: null,
      changePending: false,
      carries: [],
      seatAllergy: "SIN GLUTEN",
      // El hallazgo 4: su ficha no informa de alérgenos.
      allergensUnknown: "ALÉRGENOS SIN INFORMAR",
      allergyWarning: null,
    },
    {
      id: "l3",
      name: "Calamares",
      units: 1,
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
      carries: ["gluten"],
      seatAllergy: null,
      allergyWarning: null,
      allergensUnknown: null,
    },
  ];
}

function comandaDelServidor(over = {}) {
  return {
    id: "o-m5",
    clientSendId: ENVIO,
    section: "COCINA",
    ticketId: "tk-m5",
    tableId: "t-m5",
    tableName: "M5",
    number: 2,
    urgent: false,
    lateArrival: false,
    sentAt: haceMin(6),
    firedAt: haceMin(6),
    orderAt: haceMin(6),
    readyAt: null,
    servedAt: null,
    recoveredAt: null,
    isNew: false,
    allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
    lines: lineas(),
    ...over,
  };
}

/** Y la misma comanda, tal como llega por la wifi del local. */
const COMANDA_LAN = {
  kind: "COMANDA",
  opId: ENVIO,
  deviceId: "terminal-1",
  sentAt: haceMin(6),
  payload: {
    comandas: [
      {
        clientSendId: ENVIO,
        section: "COCINA",
        ticketId: "tk-m5",
        tableId: "t-m5",
        tableName: "M5",
        number: 2,
        urgent: false,
        sentAt: haceMin(6),
        allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
        lines: lineas().map((l) => ({
          ticketLineId: l.id,
          name: l.name,
          units: l.units,
          notes: l.notes,
          course: l.course,
          seat: l.seat,
          fired: l.fired,
          carries: l.carries,
          seatAllergy: l.seatAllergy,
          allergyWarning: l.allergyWarning,
          allergensUnknown: l.allergensUnknown,
        })),
      },
    ],
  },
};

/** Otra mesa, para que la pantalla no salga con una sola tarjeta. */
function laM2() {
  return comandaDelServidor({
    id: "o-m2",
    clientSendId: "66666666-6666-4666-8666-666666666666",
    ticketId: "tk-m2",
    tableId: "t-m2",
    tableName: "M2",
    number: 1,
    sentAt: haceMin(14),
    firedAt: haceMin(14),
    orderAt: haceMin(14),
    allergyBands: [],
    lines: [
      {
        ...lineas()[2],
        id: "m2-l1",
        name: "Croquetas",
        units: 3,
        carries: [],
      },
    ],
  });
}

function rutasCocina(page, caso) {
  /**
   * ¿Se ha tachado ya un plato?
   *
   * La primera versión contaba GETs y cambiaba el orden en el segundo, y
   * salía mal: en `vite dev` React monta dos veces (StrictMode), así que
   * el segundo GET llegaba ANTES del toque y la pantalla ya veía el orden
   * revuelto como el primero que conoció. Lo que hay que atar es el toque,
   * no el número de vueltas.
   */
  let tachado = false;
  return page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, "");
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/devices/me") {
      return json({ error: "KITCHEN_DEVICE_NOT_ALLOWED" }, 403);
    }
    if (p === "/kitchen/me") {
      return json({
        device: { id: "d-cocina", name: "Pase" },
        store: { id: "s-1", name: "La Maestranza" },
        sections: ["COCINA"],
        settings: AJUSTES,
        serverTime: ahora.toISOString(),
        lan: {
          key: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
          port: 8787,
          maxAgeMs: 60_000,
        },
      });
    }
    if (p.startsWith("/kitchen/lineas/")) {
      tachado = true;
      return json({ ok: true });
    }
    if (p === "/kitchen/comandas") {
      const vista = caso.vista(tachado);
      return json({
        serverTime: new Date().toISOString(),
        settings: AJUSTES,
        sections: ["COCINA"],
        ...vista,
      });
    }
    if (p === "/kitchen/comandas/hoy") return json({ orders: [] });
    return json({ ok: true });
  });
}

function pluginFingido(page, entrega) {
  return page.addInitScript((mensaje) => {
    let cola = mensaje ? [JSON.stringify(mensaje)] : [];
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {
        KitchenLan: {
          arrancar: async () => ({
            listening: true,
            port: 8787,
            ip: "192.168.1.44",
            error: null,
          }),
          parar: async () => ({ listening: false }),
          refrescar: async () => ({ ok: true }),
          publicar: async () => ({ ok: true }),
          recibidos: async () => {
            const mensajes = cola;
            cola = [];
            return { mensajes };
          },
          estado: async () => ({ listening: true, port: 8787 }),
          enviar: async () => ({ status: 0, bodyJson: null, error: null }),
          descubrir: async () => ({ destinos: [] }),
        },
      },
    };
  }, entrega ?? null);
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
      fontSize: cs.fontSize,
      background: cs.backgroundColor,
      color: cs.color,
      texto: (el.textContent ?? "").trim().slice(0, 120),
      // ¿Cabe en una línea? Si no, el texto parte en dos y hay que saberlo.
      lineas: Math.round(r.height / parseFloat(cs.lineHeight || "1")) || null,
    };
  }, sel);
}

const CASOS = [
  {
    nombre: "cocina-sin-informar-1280x800",
    lan: null,
    vista: () => ({ orders: [comandaDelServidor(), laM2()], ready: [] }),
  },
  {
    nombre: "cocina-orden-tras-tachar-1280x800",
    lan: null,
    // El 2º GET —el de después de tachar— devuelve las líneas en otro
    // orden: es lo que hace Postgres cuando el `UPDATE` reescribe la fila.
    vista: (tachado) => {
      const c = comandaDelServidor();
      if (!tachado) return { orders: [c, laM2()], ready: [] };
      const [bravas, ...resto] = c.lines;
      return {
        orders: [
          { ...c, lines: [...resto, { ...bravas, done: true }] },
          laM2(),
        ],
        ready: [],
      };
    },
    tacharPrimera: true,
  },
  {
    nombre: "cocina-tras-lista-1280x800",
    // La misma comanda llega TAMBIÉN por la wifi, y el servidor ya la tiene
    // LISTA. Antes de este bloque, la de la wifi reaparecía en el centro.
    lan: COMANDA_LAN,
    vista: () => ({
      orders: [laM2()],
      ready: [comandaDelServidor({ readyAt: haceMin(1) })],
    }),
  },
];

const medidas = {};
const browser = await chromium.launch({ executablePath: CHROME });

for (const caso of CASOS) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) =>
    console.log("  [pageerror]", String(e).slice(0, 300)),
  );
  await pluginFingido(page, caso.lan);
  await rutasCocina(page, caso);
  await page.addInitScript(() => {
    localStorage.setItem("mipiacetpv-device-token", "token-de-la-pantalla");
    localStorage.removeItem("mipiacetpv-kds-marcas");
    localStorage.removeItem("mipiacetpv-kds-recibidas");
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="kds-screen"]', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const ordenAntes = await page.$$eval("[data-linea-id]", (els) =>
    els.map((e) => e.getAttribute("data-linea-id")),
  );
  if (caso.tacharPrimera) {
    // Un toque en el primer plato de la primera tarjeta. El POST contesta
    // 200 y la pantalla se recarga: el 2º GET viene reordenado.
    await page.locator('[data-testid="kds-linea"] button').first().click();
    await page.waitForTimeout(1800);
  }

  await page.screenshot({ path: `${OUT}/${caso.nombre}.png` });

  medidas[caso.nombre] = {
    tarjetasEnElCentro: await page
      .locator('[data-testid="kds-comanda"]')
      .count(),
    enListas: await page.locator('[data-testid="kds-lista-item"]').count(),
    sinInformar: await rect(page, '[data-testid="kds-sin-informar"]'),
    sillaComprobada: await rect(page, '[data-testid="kds-silla"]'),
    ordenAntes,
    ordenDespues: await page.$$eval("[data-linea-id]", (els) =>
      els.map((e) => e.getAttribute("data-linea-id")),
    ),
    tachadas: await page.$$eval('[data-hecha="1"]', (els) =>
      els.map((e) => e.getAttribute("data-linea-id")),
    ),
    desplaza: await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    ),
  };
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/medidas.json`, `${JSON.stringify(medidas, null, 2)}\n`);
console.log(JSON.stringify(medidas, null, 2));
