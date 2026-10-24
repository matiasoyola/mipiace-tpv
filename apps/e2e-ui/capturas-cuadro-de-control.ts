// cuadro-de-control · EL BUCLE VISUAL. El menú de cinco, el panel que
// tiene que caber en una pantalla y el índice de «Configuración», en el
// producto de verdad y contra Jardín de Gredos sembrado.
//
// No es un test: es una pasada con la cámara, y de paso **MIDE** lo que el
// bloque promete y una suite de jsdom no puede comprobar — que el panel
// **cabe en 1366×768 sin scroll** (decisión 4). jsdom no tiene alto: ahí
// `scrollHeight` es siempre 0 y cualquier maqueta pasa en verde.
//
// Hermano de `capturas-residencia5.ts` y vive en el repo por lo mismo: el
// día que alguien quiera volver a ver estas pantallas tiene que poder
// hacerlo sin reconstruir el guion de memoria.
//
// ── Antes de correrlo ───────────────────────────────────────────────
//
//   docker exec -i mipiacetpv-postgres psql -U mipiacetpv \
//     -c "CREATE DATABASE mipiacetpv_cuadro;"
//   (DATABASE_URL de este worktree apuntando a ella)
//   pnpm --filter @mipiacetpv/db exec prisma migrate deploy
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/sembrar-gredos.ts
//   (API y admin arriba; sus puertos salen de las variables de abajo)
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx capturas-cuadro-de-control.ts

import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, type Browser, type Page } from "@playwright/test";

const ADMIN = process.env.CAPTURAS_ADMIN ?? "http://localhost:5281";
const SALIDA = new URL("../../docs/qa/2026-10-24-cuadro-de-control/", import.meta.url)
  .pathname;

const PANEL = { email: "pilar@gredos.local", password: "Gredos2026!" };

/**
 * **1366×768 es la medida del bloque**, y no es un número redondo: es el
 * portátil de la directora. El panel tiene que caber ahí sin scroll con
 * datos normales, y es el criterio de cierre.
 */
const ESCRITORIO = { width: 1366, height: 768 };
const MOVIL = { width: 390, height: 844 };

const medido: string[] = [];

async function entrar(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  // Por `id` y no por etiqueta: el campo de contraseña lleva al lado el
  // botón «Mostrar contraseña», que `getByLabel(/contraseña/i)` también
  // casa, y Playwright se para en el modo estricto.
  await page.locator("#email").fill(PANEL.email);
  await page.locator("#password").fill(PANEL.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/admin\//, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await aceptarElContratoSiHaceFalta(page);
}

/**
 * El contrato de encargado, si está sin aceptar.
 *
 * Jardín de Gredos sembrado entra en `/admin/contrato-tratamiento` y no en
 * el panel: es primer-acceso haciendo su trabajo (sin contrato aceptado la
 * historia clínica no se usa, y el panel contesta 423). Para fotografiar
 * el panel hay que hacer antes lo que hace la dueña, así que se hace: se
 * marca la casilla y se acepta.
 *
 * Es idempotente: en la segunda pasada el botón ya no está y no se toca
 * nada.
 */
async function aceptarElContratoSiHaceFalta(page: Page): Promise<void> {
  if (!page.url().includes("contrato-tratamiento")) return;
  const boton = page.locator('[data-test="contrato-aceptar"]');
  if ((await boton.count()) === 0) return;
  await page.locator('input[type="checkbox"]').first().check();
  await boton.click();
  await page.waitForTimeout(800);
  console.log("  (contrato de encargado aceptado)");
}

async function disparar(page: Page, nombre: string): Promise<void> {
  // Un respiro para que la fuente acabe de pintar: una captura con el
  // texto a medio cargar no sirve para mirar si algo se sale.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SALIDA}${nombre}.png` });
  console.log(`  · ${nombre}.png`);
}

/**
 * ¿Cabe sin scroll?
 *
 * Se miden LAS DOS cajas, y hacen falta las dos: el `body` (por si algo
 * se sale a lo ancho o empuja la página entera) y el `<main>`, que es
 * quien tiene el `overflow-y-auto` del shell y por tanto quien se
 * convierte en una barra de scroll cuando el contenido no cabe. Mirar
 * sólo el `body` daría «cabe» con el panel desbordando dentro de main.
 */
async function medirElScroll(page: Page, nombre: string): Promise<void> {
  const m = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return {
      pagina: {
        alto: document.documentElement.clientHeight,
        contenido: document.documentElement.scrollHeight,
        ancho: document.documentElement.clientWidth,
        contenidoAncho: document.documentElement.scrollWidth,
      },
      main: { alto: main.clientHeight, contenido: main.scrollHeight },
    };
  });
  const cabeAlto = m.main.contenido <= m.main.alto && m.pagina.contenido <= m.pagina.alto;
  const cabeAncho = m.pagina.contenidoAncho <= m.pagina.ancho;
  const linea = [
    `${nombre}:`,
    `main ${m.main.contenido}px de contenido en ${m.main.alto}px`,
    `· página ${m.pagina.contenido}/${m.pagina.alto}`,
    `· ancho ${m.pagina.contenidoAncho}/${m.pagina.ancho}`,
    `→ ${cabeAlto && cabeAncho ? "CABE SIN SCROLL" : "NO CABE"}`,
  ].join(" ");
  console.log(`    ${linea}`);
  medido.push(linea);
}

/**
 * ¿Se sale algo por la derecha?
 *
 * No vale mirar `scrollWidth` de la página: el `<main>` del shell lleva
 * `overflow-y-auto`, y eso hace que el eje X **se recorte** en vez de
 * crecer. Así que la página dice 390/390 tan contenta mientras el texto
 * de las tarjetas se corta a media palabra — que es exactamente lo que
 * pasó en la primera pasada a 390, y lo que esta medida existe para que
 * no vuelva a pasar en verde.
 *
 * Se busca el PRIMER elemento que se sale y cuyo padre no: ése es el
 * culpable, y los demás son sus hijos arrastrados.
 */
async function medirElAncho(page: Page, nombre: string): Promise<void> {
  const malos = await page.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    const fuera: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      const r = el.getBoundingClientRect();
      const padre = el.parentElement?.getBoundingClientRect();
      if (r.right > ancho + 1 && (!padre || padre.right <= ancho + 1)) {
        fuera.push(
          `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> ${Math.round(r.width)}px`,
        );
      }
    }
    return fuera;
  });
  const linea =
    malos.length === 0
      ? `${nombre}: nada se sale por la derecha`
      : `${nombre}: ${malos.length} se salen · ${malos.slice(0, 3).join(" · ")}`;
  console.log(`    ${linea}`);
  medido.push(linea);
}

/** Cuenta las entradas del menú de la barra lateral, con su etiqueta. */
async function medirElMenu(page: Page, nombre: string): Promise<void> {
  // Sólo la barra VISIBLE. A 390 hay dos `aside` en el DOM —la de
  // escritorio, que lleva `hidden`, y el cajón— y contarlas las dos daba
  // «12 entradas», que no es lo que nadie ve.
  const entradas = await page.evaluate(() =>
    [...document.querySelectorAll("aside")]
      .filter((a) => (a as HTMLElement).offsetParent !== null)
      .flatMap((a) => [...a.querySelectorAll("a")])
      .filter((a) => (a.getAttribute("href") ?? "").startsWith("/admin"))
      .map((a) => (a.textContent ?? "").trim()),
  );
  const linea = `${nombre}: ${entradas.length} entradas · ${entradas.join(" | ")}`;
  console.log(`    ${linea}`);
  medido.push(linea);
}

/**
 * El guardián de los objetivos táctiles del admin.
 *
 * Mismo criterio que `capturas-residencia5.ts`: se miden los BOTONES con
 * el suelo de 36 px y no los enlaces en prosa. En este panel hay un
 * botón nuevo que importa —**la casilla de tachar una obligación**— y es
 * justo el que un cuadro de control apretado puede dejar en 16 px.
 */
async function medirLosToques(page: Page, nombre: string): Promise<void> {
  const pequenos = await page.evaluate(() => {
    const malos: Array<{ texto: string; w: number; h: number }> = [];
    for (const el of document.querySelectorAll("button, a[data-test^='casilla']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 36 || r.width < 36) {
        malos.push({
          texto:
            (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 48) ||
            (el.getAttribute("data-test") ?? "(sin texto)"),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return malos;
  });
  const linea =
    pequenos.length === 0
      ? `${nombre}: todos los botones ≥ 36 px`
      : `${nombre}: ${pequenos.length} por debajo de 36 px · ${pequenos
          .map((p) => `«${p.texto}» ${p.w}×${p.h}`)
          .join(" · ")}`;
  console.log(`    ${linea}`);
  medido.push(linea);
}

async function pasada(browser: Browser): Promise<void> {
  // ── El escritorio de la directora ─────────────────────────────────
  const ctx = await browser.newContext({ viewport: ESCRITORIO, locale: "es-ES" });
  const page = await ctx.newPage();
  await entrar(page);

  console.log("el panel, a 1366×768");
  await page.goto(`${ADMIN}/admin/residencia/panel`);
  await page.waitForLoadState("networkidle");
  await disparar(page, "01-panel-1366x768");
  await medirElScroll(page, "panel a 1366×768");
  await medirElMenu(page, "menú de la residencia");
  await medirLosToques(page, "panel a 1366×768");

  console.log("«Configuración»");
  await page.getByRole("link", { name: "Configuración" }).click();
  await page.waitForURL(/configuracion/);
  await page.waitForLoadState("networkidle");
  await disparar(page, "02-configuracion-1366x768");
  await medirElScroll(page, "Configuración a 1366×768");

  // ── El panel TRANQUILO ────────────────────────────────────────────
  //
  // Con todo a cero. No se puede fotografiar en Gredos sembrado —tiene
  // partes sin confirmar y una obligación vencida a propósito— así que se
  // interceptan las CIFRAS de la respuesta y se dejan en cero. Lo que se
  // mira aquí es la maqueta del día tranquilo: que diga «Nada abierto.
  // Todo al día.» y no cuatro ceros rojos.
  console.log("el panel tranquilo (cifras a cero, interceptadas)");
  await page.route("**/api/residencia/panel", async (route) => {
    const res = await route.fetch();
    const p = await res.json();
    route.fulfill({
      response: res,
      json: {
        ...p,
        abierto: {
          ...p.abierto,
          porNivel: p.abierto.porNivel.map((n: { nivel: string }) => ({
            nivel: n.nivel,
            cuantas: 0,
          })),
          avisosSinAcuse: 0,
          sinConstanciaDeFamilia: 0,
          esperandoCierreDeOtro: 0,
          total: 0,
          noPuedeEsperar: [],
        },
        relevos: { ultimo: null, sinConfirmar: [] },
        obligaciones: { hoy: [], vencidas: [], proximas: [] },
        fichasIncompletas: {
          ...p.fichasIncompletas,
          incompletas: 0,
          datosPendientes: 0,
          conImprescindibles: 0,
          primeras: [],
        },
      },
    });
  });
  await page.goto(`${ADMIN}/admin/residencia/panel`);
  await page.waitForLoadState("networkidle");
  await disparar(page, "03-panel-tranquilo-1366x768");
  await medirElScroll(page, "panel tranquilo a 1366×768");
  await page.unroute("**/api/residencia/panel");
  await ctx.close();

  // ── Y en la mano ──────────────────────────────────────────────────
  const ctxMovil = await browser.newContext({ viewport: MOVIL, locale: "es-ES" });
  const movil = await ctxMovil.newPage();
  await entrar(movil);

  console.log("el panel a 390");
  await movil.goto(`${ADMIN}/admin/residencia/panel`);
  await movil.waitForLoadState("networkidle");
  await disparar(movil, "04-panel-390");
  await medirElAncho(movil, "panel a 390");
  await movil.evaluate(() => window.scrollTo(0, 10_000));
  await disparar(movil, "05-panel-390-abajo");
  await medirLosToques(movil, "panel a 390");

  console.log("el menú plegado a 390");
  await movil.evaluate(() => window.scrollTo(0, 0));
  await movil.getByRole("button", { name: "Abrir menú" }).click();
  await movil.waitForTimeout(300);
  await disparar(movil, "06-menu-390");
  await medirElMenu(movil, "menú plegado a 390");
  await movil.getByRole("button", { name: "Cerrar menú" }).click();

  console.log("«Configuración» a 390");
  await movil.goto(`${ADMIN}/admin/residencia/configuracion`);
  await movil.waitForLoadState("networkidle");
  await disparar(movil, "07-configuracion-390");
  await medirElAncho(movil, "Configuración a 390");
  await ctxMovil.close();
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  const browser = await chromium.launch();
  try {
    await pasada(browser);
  } finally {
    await browser.close();
  }
  writeFileSync(
    `${SALIDA}MEDIDO.txt`,
    [
      "cuadro-de-control · lo medido en el bucle visual, en el producto de",
      "verdad y con Jardín de Gredos sembrado. El escritorio a 1366×768 (el",
      "portátil de la directora, que es la medida del bloque) y la mano a 390.",
      "",
      "Lo que se mide y por qué: que el panel CABE EN UNA PANTALLA es la",
      "decisión 4 del bloque y jsdom no la puede comprobar — ahí el alto es",
      "siempre 0 y cualquier maqueta pasa en verde. Se miden las dos cajas: la",
      "página y el <main>, que es quien lleva el overflow del shell.",
      "",
      ...medido.map((l) => `  ${l}`),
      "",
    ].join("\n"),
  );
  console.log(`\nmedido en ${SALIDA}MEDIDO.txt`);
}

await main();
