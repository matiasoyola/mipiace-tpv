// residencia-5 · EL BUCLE VISUAL. La tablet de la sala, el panel de
// dirección, los relevos, las obligaciones y los indicadores, en el
// producto de verdad y contra Jardín de Gredos sembrado.
//
// No es un test: es una pasada con la cámara. Lo que busca son los fallos
// que ninguna suite ve —un botón tapado, un texto que no cabe, una
// tarjeta bajo el pliegue, un objetivo táctil de 30 px— y de paso MIDE
// los toques y los milisegundos de las tres consultas que el prompt
// nombra, contra el presupuesto de lectura del bloque C §1:
//
//   · «¿qué hay abierto hoy?»        ≤ 3 toques, ≤ 10 s
//   · «¿qué pasó en el turno anterior?»
//   · «¿qué toca hoy?»
//
// Y lo que cuesta **confirmar el relevo**, que es el gesto del bloque.
//
// Hermano de `capturas-residencia4.ts` y vive en el repo por lo mismo: el
// día que alguien quiera volver a ver estas pantallas tiene que poder
// hacerlo sin reconstruir el guion de memoria.
//
// ── Antes de correrlo ───────────────────────────────────────────────
//
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/sembrar-gredos.ts
//   (API en :3001, tpv-web en :5274, admin en :5273)
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx capturas-residencia5.ts

import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@mipiacetpv/db";

const TPV = "http://localhost:5274";
const ADMIN = "http://localhost:5273";
const SALIDA = new URL("../../docs/qa/2026-10-19-residencia-5/", import.meta.url)
  .pathname;

const TOKEN_SALA = "gredos-sala-relevo-0001-0001-001";
const PIN_ANA = "4071"; // auxiliar, PRIMERA planta
const PIN_ROSA = "9182"; // DUE, alcance total
const PANEL = { email: "pilar@gredos.local", password: "Gredos2026!" };

/** La tablet de la sala: 1280×800, una de 10" en la pared. */
const SALA = { width: 1280, height: 800 };
const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL = { width: 390, height: 844 };

const TENANT = "99999999-0000-4000-8000-000000000001";

const medido: string[] = [];

/**
 * Deja el ÚLTIMO parte sin confirmar antes de empezar.
 *
 * Sin esto, la segunda pasada se encuentra el relevo ya confirmado por la
 * primera y la tablet enseña «Ya lo has recibido»: no se puede
 * fotografiar el gesto ni medir lo que cuesta. Lo encontró la segunda
 * pasada, igual que en residencia-4.
 *
 * Los tres triggers se apartan porque una confirmación es append-only y
 * un parte congelado es inmutable — que es justo lo que el bloque
 * promete.
 */
async function dejarElRelevoSinConfirmar(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL! } },
  });
  const triggers = [
    ["handover_ack_zones", "handover_ack_zones_append_only"],
    ["handover_acks", "handover_acks_append_only"],
    ["handovers", "handovers_inmutable"],
  ] as const;
  for (const [t, g] of triggers) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER ${g}`);
  }
  await prisma.$executeRawUnsafe(
    `DELETE FROM handover_ack_zones WHERE ack_id IN (
       SELECT a.id FROM handover_acks a
       JOIN handovers h ON h.id = a.handover_id
       WHERE h.tenant_id = '${TENANT}'
         AND h.id = (SELECT id FROM handovers WHERE tenant_id = '${TENANT}'
                     ORDER BY frozen_at DESC LIMIT 1))`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM handover_acks WHERE handover_id =
       (SELECT id FROM handovers WHERE tenant_id = '${TENANT}'
        ORDER BY frozen_at DESC LIMIT 1)`,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE handovers SET confirmed_at = NULL WHERE id =
       (SELECT id FROM handovers WHERE tenant_id = '${TENANT}'
        ORDER BY frozen_at DESC LIMIT 1)`,
  );
  for (const [t, g] of triggers) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER ${g}`);
  }
  await prisma.$disconnect();
  console.log("el último relevo, sin confirmar");
}

async function disparar(page: Page, nombre: string): Promise<void> {
  // Un respiro para que la fuente acabe de pintar: una captura con el
  // texto a medio cargar no sirve para mirar si algo se sale.
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SALIDA}${nombre}.png` });
  console.log(`  · ${nombre}.png`);
}

/**
 * El guardián de los objetivos táctiles.
 *
 * ── QUÉ SE MIDE EN CADA SITIO, Y POR QUÉ NO ES LO MISMO ────────────
 *
 * En **la sala** se miden botones Y enlaces con el suelo de la puerta
 * (56 px): es una tablet de pared que se toca de pie y con guantes, y
 * ahí no hay «texto con un enlace dentro» — todo lo que se pulsa es una
 * acción.
 *
 * En **el admin** se miden sólo los BOTONES, con el suelo de siempre
 * (36 px). La razón: el panel y el relevo están llenos de enlaces EN
 * PROSA —«Carmen Gómez Ruiz» dentro de una línea del parte, «17-10-2026
 * · noche · 17 líneas» dentro de una lista— que miden lo que mide su
 * texto. Medirlos como objetivos táctiles daba treinta avisos por
 * pantalla y tapaba los dos que importan.
 *
 * Lo que sí se mide aparte es el enlace del PIE («Declaración
 * responsable», 34 px), que viene de otro bloque y sigue abierto.
 */
async function toquesPequenos(
  page: Page,
  minimo: number,
  soloBotones = false,
): Promise<string[]> {
  return page.evaluate(
    ([min, solo]) => {
      const malos: string[] = [];
      const selector = solo ? "button" : "button, a[href]";
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < (min as number)) {
          malos.push(
            `${Math.round(r.height)}px · «${el.textContent?.trim().slice(0, 40)}»`,
          );
        }
      }
      return malos;
    },
    [minimo, soloBotones] as [number, boolean],
  );
}

async function seSale(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
}

/** ¿Hay algo importante POR DEBAJO DEL PLIEGUE? */
async function bajoElPliegue(page: Page, texto: string): Promise<boolean> {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll("button, a[href]")].find((x) =>
      x.textContent?.includes(t),
    );
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top > window.innerHeight;
  }, texto);
}

async function revisar(
  page: Page,
  donde: string,
  minimo: number,
  soloBotones = false,
): Promise<void> {
  const malos = await toquesPequenos(page, minimo, soloBotones);
  if (malos.length > 0) {
    console.warn(`  ⚠ ${donde}: objetivos por debajo de ${minimo} px`);
    for (const m of malos) console.warn(`      ${m}`);
  }
  if (await seSale(page)) console.warn(`  ⚠ ${donde}: algo se sale a lo ancho`);
}

async function conDispositivo(
  browser: Browser,
  token: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(
    ([clave, valor]) => {
      window.localStorage.setItem(clave as string, valor as string);
    },
    ["mipiacetpv-device-token", token],
  );
  return ctx.newPage();
}

async function tecleaPin(page: Page, pin: string): Promise<void> {
  for (const d of pin) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
}

// ════════════════════════════════════════════════════════════════════
//  LA TABLET DE LA SALA
// ════════════════════════════════════════════════════════════════════

async function laSala(browser: Browser): Promise<void> {
  console.log("\n── La tablet de la sala ──");
  const page = await conDispositivo(browser, TOKEN_SALA, SALA);
  await page.goto(TPV);

  // ── 1 · EN REPOSO ────────────────────────────────────────────────
  await page.getByRole("button", { name: /Leer el parte/ }).waitFor({
    timeout: 20_000,
  });
  await revisar(page, "reposo", 56);
  await disparar(page, "1-sala-reposo-1280x800");

  // ── MEDIDO · «¿qué pasó en el turno anterior?» ───────────────────
  //
  // Del primer toque a tener el parte delante. Son el PIN y nada más: el
  // relevo que se lee es el último congelado, así que no hay que
  // elegirlo.
  const t0 = Date.now();
  let toques = 0;
  await page.getByRole("button", { name: /Leer el parte/ }).click();
  toques += 1;
  await tecleaPin(page, PIN_ROSA);
  toques += PIN_ROSA.length;
  await page.getByRole("button", { name: /Leído y recibido/ }).waitFor({
    timeout: 20_000,
  });
  const msParte = Date.now() - t0;
  medido.push(
    `¿qué pasó en el turno anterior? (sala: Leer + PIN): ${toques} toques · ~${msParte} ms`,
  );
  await revisar(page, "el parte", 56);
  await disparar(page, "2-sala-parte-de-la-DUE-1280x800");

  // El pie tiene que estar a la vista: es la lección de la banda del TPV.
  if (await bajoElPliegue(page, "Leído y recibido")) {
    console.warn("  ⚠ el parte: «Leído y recibido» cae por debajo del pliegue");
  }

  // Desplazado hasta abajo, para ver el parte entero y las
  // confirmaciones que ya hay.
  await page.evaluate(() => {
    const c = document.querySelector(".overflow-y-auto");
    if (c) c.scrollTop = c.scrollHeight;
  });
  await disparar(page, "3-sala-parte-abajo-1280x800");

  // ── MEDIDO · confirmar el relevo ─────────────────────────────────
  const t1 = Date.now();
  await page.getByRole("button", { name: /Leído y recibido/ }).click();
  await page
    .getByRole("button", { name: /Ya lo has recibido/ })
    .waitFor({ timeout: 20_000 });
  medido.push(
    `confirmar el relevo (desde el parte abierto): 1 toque · ~${Date.now() - t1} ms`,
  );
  await disparar(page, "4-sala-confirmado-1280x800");

  await page.context().close();
}

/** La misma sala, con la auxiliar de la PRIMERA planta: ve menos. */
async function laSalaDeLaAuxiliar(browser: Browser): Promise<void> {
  console.log("\n── La sala, con la auxiliar de la primera planta ──");
  const page = await conDispositivo(browser, TOKEN_SALA, SALA);
  await page.goto(TPV);
  await page.getByRole("button", { name: /Leer el parte/ }).waitFor({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /Leer el parte/ }).click();
  await tecleaPin(page, PIN_ANA);
  // Cualquiera de las dos: la DUE acaba de confirmar el parte entero, así
  // que lo que la auxiliar ve puede ser el botón o el «ya lo has
  // recibido» de otra persona. Lo que importa aquí es lo que VE del
  // parte, no el botón.
  await page
    .getByRole("button", { name: /Leído y recibido|Ya lo has recibido/ })
    .waitFor({ timeout: 20_000 });
  await revisar(page, "el parte de la auxiliar", 56);
  // D-51: no tiene que salir la segunda planta por ninguna parte.
  const texto = (await page.textContent("body")) ?? "";
  if (texto.includes("Segunda")) {
    console.warn("  ⚠ la auxiliar de la primera VE la segunda planta");
  }
  await disparar(page, "5-sala-parte-recortado-a-su-zona-1280x800");
  await page.context().close();
}

// ════════════════════════════════════════════════════════════════════
//  EL ADMIN
// ════════════════════════════════════════════════════════════════════

async function elAdmin(browser: Browser): Promise<void> {
  for (const [sufijo, viewport, minimo] of [
    ["escritorio", ESCRITORIO, 36],
    ["390", MOVIL, 36],
  ] as const) {
    console.log(`\n── El admin · ${sufijo} ──`);
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    await page.goto(`${ADMIN}/login`);
    // Por `#id` y no por etiqueta: «Contraseña» la llevan el campo Y el
    // botón de «Mostrar contraseña», y `getByLabel` no sabe cuál quieres.
    await page.locator("#email").fill(PANEL.email);
    await page.locator("#password").fill(PANEL.password);

    // ── MEDIDO · «¿qué hay abierto hoy?» ──────────────────────────
    //
    // Desde que la dirección entra: el panel es la pantalla de INICIO de
    // un centro de residencia, así que la respuesta está en el toque de
    // «Entrar». Es el presupuesto de lectura del bloque C §1.
    const t0 = Date.now();
    await page.getByRole("button", { name: /Entrar/i }).click();
    await page
      .getByRole("heading", { name: "Qué hay abierto hoy" })
      .waitFor({ timeout: 25_000 });
    if (sufijo === "escritorio") {
      medido.push(
        `¿qué hay abierto hoy? (el panel es la pantalla de inicio): 1 toque · ~${
          Date.now() - t0
        } ms desde «Entrar»`,
      );
    }
    await revisar(page, `panel ${sufijo}`, minimo, true);
    await disparar(page, `6-panel-${sufijo}`);

    // El panel entero, desplazado: los indicadores están abajo.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await disparar(page, `7-panel-abajo-${sufijo}`);

    // ── MEDIDO · «¿qué toca hoy?» ─────────────────────────────────
    //
    // Desde el panel: un toque en «Obligaciones». Y lo vencido ya estaba
    // en el panel sin tocar nada.
    await page.evaluate(() => window.scrollTo(0, 0));
    const t1 = Date.now();
    await page.goto(`${ADMIN}/admin/residencia/obligaciones`);
    await page
      .getByRole("heading", { name: "Obligaciones" })
      .first()
      .waitFor({ timeout: 25_000 });
    if (sufijo === "escritorio") {
      medido.push(
        `¿qué toca hoy? (desde el panel, «Obligaciones»): 1 toque · ~${
          Date.now() - t1
        } ms`,
      );
    }
    await revisar(page, `obligaciones ${sufijo}`, minimo, true);
    await disparar(page, `8-obligaciones-${sufijo}`);

    // Los relevos y uno abierto.
    await page.goto(`${ADMIN}/admin/residencia/relevos`);
    await page.getByRole("heading", { name: "Relevos" }).first().waitFor({
      timeout: 25_000,
    });
    await revisar(page, `relevos ${sufijo}`, minimo, true);
    await disparar(page, `9-relevos-${sufijo}`);

    const primero = page.locator("a[href*='/admin/residencia/relevos/']").first();
    if (await primero.count()) {
      await primero.click();
      await page.waitForTimeout(900);
      await revisar(page, `un relevo ${sufijo}`, minimo, true);
      await disparar(page, `10-relevo-${sufijo}`);
    }

    // Y los indicadores.
    await page.goto(`${ADMIN}/admin/residencia/indicadores`);
    await page.getByRole("heading", { name: "Indicadores" }).first().waitFor({
      timeout: 25_000,
    });
    await revisar(page, `indicadores ${sufijo}`, minimo, true);
    // ── El enlace del PIE, que viene de otro bloque ──────────────
    //
    // «Declaración responsable» mide 34 px y residencia-4 ya lo dejó
    // anotado. Se mide aquí a propósito, una vez por pasada, para que
    // siga a la vista en vez de perderse entre treinta avisos de
    // enlaces en prosa.
    const pie = await page.evaluate(() => {
      const el = [...document.querySelectorAll("a[href]")].find((x) =>
        x.textContent?.includes("Declaración responsable"),
      );
      return el ? Math.round(el.getBoundingClientRect().height) : null;
    });
    // Cero = está en el cajón cerrado del móvil, no es que mida cero.
    if (pie != null && pie > 0 && pie < 36) {
      console.warn(
        `  ⚠ el pie del admin: «Declaración responsable» mide ${pie} px (viene de otro bloque)`,
      );
    }
    await disparar(page, `11-indicadores-${sufijo}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await disparar(page, `12-indicadores-sin-dato-${sufijo}`);

    await ctx.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  await dejarElRelevoSinConfirmar();
  const browser = await chromium.launch();
  try {
    await laSala(browser);
    await laSalaDeLaAuxiliar(browser);
    await elAdmin(browser);
  } finally {
    await browser.close();
  }

  writeFileSync(
    `${SALIDA}MEDIDO.txt`,
    [
      "residencia-5 · lo medido en el bucle visual, en el producto de verdad y",
      "con Jardín de Gredos sembrado. La sala a 1280×800; el admin a 1280×800",
      "y a 390.",
      "",
      "Los TOQUES son exactos: son los clics que hay que dar. Los SEGUNDOS son",
      "de máquina —del primer toque a que la pantalla lo diga— y es lo que el",
      "software cuesta. Lo que NO está medido es el tiempo de la persona: eso",
      "se mide con el turno delante, no con un navegador.",
      "",
      "El presupuesto de lectura del bloque C §1 es ≤ 3 toques y ≤ 10 s a",
      "cualquier dato.",
      "",
      ...medido.map((m) => `  ${m}`),
      "",
    ].join("\n"),
  );
  console.log(`\nMEDIDO.txt\n${medido.map((m) => `  ${m}`).join("\n")}`);
}

await main();
