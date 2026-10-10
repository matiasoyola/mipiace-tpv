// kds-2-wifi · EL BUCLE VISUAL.
//
// Mismo montaje que `kds-1-cocina-shots/banco.mjs`: `playwright-core` en
// el scratchpad, el Chromium de `ms-playwright`, `vite` sirviendo
// `apps/tpv-web` y `page.route` sobre `/api/**`. Nada se instala en el
// repo.
//
// Lo que captura, y es LO ÚNICO que este bloque cambia de lo que se ve:
//
//   1. **La franja ámbar**: sin internet, pero con una comanda que acaba
//      de llegar por la wifi del local. La pantalla NO está roja.
//   2. **La pantalla roja de kds-1**: ni internet ni wifi. Es el control:
//      si las dos capturas salieran iguales, el bloque no habría hecho
//      nada.
//
// ── EL PLUGIN NATIVO, FINGIDO EN EL NAVEGADOR ─────────────────────────
//
// En un navegador no hay puente nativo, así que `hayCaminoDirecto()` es
// false y la pantalla nunca recibiría nada por la wifi. Se inyecta el
// global `Capacitor` con un `KitchenLan` que entrega una comanda: es
// exactamente lo que lee `platform/index.ts`, así que lo que se pinta es
// el camino de producción y no un atajo.
//
// Uso:
//   pnpm --filter @mipiacetpv/tpv-web dev --port 5282   (en otra terminal)
//   BANCO_OUT=docs/blocks/kds-2-wifi-shots node docs/blocks/kds-2-wifi-shots/banco.mjs

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.BANCO_URL ?? "http://localhost:5282";
const OUT = process.env.BANCO_OUT ?? "/tmp/kds2-shots";
mkdirSync(OUT, { recursive: true });

const ahora = new Date();
const haceMin = (m) => new Date(ahora.getTime() - m * 60_000).toISOString();
const AJUSTES = { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false };
const ENVIO = "33333333-3333-4333-8333-333333333333";

/** La comanda del camino directo: la M5 con el celíaco en la silla 3. */
const COMANDA_LAN = {
  kind: "COMANDA",
  opId: ENVIO,
  deviceId: "terminal-1",
  sentAt: haceMin(3),
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
        sentAt: haceMin(3),
        allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
        lines: [
          {
            ticketLineId: "l1",
            name: "Magro con tomate",
            units: 1,
            notes: [],
            course: 1,
            seat: 3,
            fired: true,
            carries: [],
            seatAllergy: "SIN GLUTEN",
            allergyWarning: null,
          },
          {
            ticketLineId: "l2",
            name: "Patatas bravas",
            units: 1,
            notes: ["Sin picante"],
            course: 1,
            seat: 3,
            fired: true,
            carries: ["GLUTEN"],
            seatAllergy: "SIN GLUTEN",
            allergyWarning: "¡LLEVA GLUTEN!",
          },
          {
            ticketLineId: "l3",
            name: "Croquetas",
            units: 2,
            notes: [],
            course: 1,
            seat: null,
            fired: true,
            carries: ["GLUTEN"],
            seatAllergy: null,
            allergyWarning: null,
          },
        ],
      },
    ],
  },
};

/**
 * El doble de la API.
 *
 * `/kitchen/comandas` FALLA: es lo que pone la pantalla en «offline», que
 * es el estado que este bloque viene a arreglar. `/kitchen/me` contesta,
 * porque es lo que la pantalla pidió cuando todavía había red (y de ahí
 * sale la clave de la tienda).
 */
function rutasCocina(page, { conWifi }) {
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
        serverTime: ahora.toISOString(),
        lan: {
          key: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
          port: 8787,
          maxAgeMs: 60_000,
        },
      });
    }
    // INTERNET CAÍDO: el servidor no contesta. Es lo que de verdad
    // significa «sin conexión» para la pantalla (ver `useKitchenFeed`).
    if (p === "/kitchen/comandas" || p === "/kitchen/latido") {
      return route.abort("connectionrefused");
    }
    void conWifi;
    return json({ ok: true });
  });
}

/** El plugin nativo fingido, con o sin comanda en la cola. */
function pluginFingido(page, { conWifi }) {
  return page.addInitScript((entrega) => {
    let cola = entrega ? [JSON.stringify(entrega)] : [];
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
  }, conWifi ? COMANDA_LAN : null);
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
      y: Math.round(r.y),
      fontSize: cs.fontSize,
      background: cs.backgroundColor,
      texto: (el.textContent ?? "").trim().slice(0, 120),
    };
  }, sel);
}

const medidas = {};
const browser = await chromium.launch({ executablePath: CHROME });

for (const caso of [
  { nombre: "cocina-solo-wifi-1280x800", conWifi: true },
  { nombre: "cocina-ni-wifi-1280x800", conWifi: false },
]) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  await pluginFingido(page, caso);
  await rutasCocina(page, caso);
  await page.addInitScript(() => {
    localStorage.setItem("mipiacetpv-device-token", "token-de-la-pantalla");
    localStorage.removeItem("mipiacetpv-kds-marcas");
    localStorage.removeItem("mipiacetpv-kds-recibidas");
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="kds-screen"]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${caso.nombre}.png` });

  medidas[caso.nombre] = {
    franjaAmbar: await rect(page, '[data-testid="kds-solo-wifi"]'),
    pantallaRoja: await rect(page, '[data-testid="kds-sin-conexion"]'),
    pastilla: await rect(page, '[data-testid="kds-en-linea"]'),
    tarjetasEnDom: await page.locator('[data-testid="kds-comanda"]').count(),
    desplaza: await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    ),
  };
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/medidas.json`, `${JSON.stringify(medidas, null, 2)}\n`);
console.log(JSON.stringify(medidas, null, 2));
