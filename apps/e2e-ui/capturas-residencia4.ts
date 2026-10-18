// residencia-4 · EL BUCLE VISUAL. La puerta, el móvil de guardia y el
// libro, en el producto de verdad y contra Jardín de Gredos sembrado.
//
// No es un test: es una pasada con la cámara. Lo que busca son los
// fallos que ninguna suite ve —un botón tapado, un texto que no cabe,
// una tarjeta bajo el pliegue, un objetivo táctil de 30 px— y de paso
// MIDE los toques y los milisegundos de los dos gestos que el prompt
// nombra: «tomar la temperatura» y «caída sin golpe» (D-05, D-16).
//
// Hermano de `capturas-clinica7.ts` y vive en el repo por lo mismo: el
// día que alguien quiera volver a ver estas pantallas tiene que poder
// hacerlo sin reconstruir el guion de memoria.
//
// ── Cómo entra, y qué NO se siembra ─────────────────────────────────
//
// El token del dispositivo SÍ se siembra (su hash es sha256 del texto
// plano, y `sembrar-gredos.ts` metió el mismo). **El PIN se teclea**,
// porque la pantalla del PIN es parte de lo que hay que mirar y porque
// la sesión de la puerta no se puede sembrar: `PuertaApp` arranca
// siempre en reposo.
//
// ── Antes de correrlo ───────────────────────────────────────────────
//
//   pnpm --filter @mipiacetpv/api exec tsx src/scripts/sembrar-gredos.ts
//   (API en :3001, tpv-web en :5274, admin en :5273)
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx capturas-residencia4.ts

import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@mipiacetpv/db";

const TPV = "http://localhost:5274";
const ADMIN = "http://localhost:5273";
const SALIDA = new URL("../../docs/qa/2026-10-18-residencia-4/", import.meta.url)
  .pathname;

const TOKEN_PUERTA = "gredos-puerta-112-0001-0001-0001";
const TOKEN_ENFERMERIA = "gredos-guardia-enf-0001-0001-0001";
const TOKEN_RESPONSABLE = "gredos-guardia-dir-0001-0001-0001";
const PIN_ANA = "4071";
const PIN_ROSA = "9182";
const PANEL = { email: "pilar@gredos.local", password: "Gredos2026!" };

/** La tablet de la puerta: 1280×800, una de 10" en la pared. */
const PUERTA = { width: 1280, height: 800 };
/** El móvil de guardia: un teléfono normal. */
const MOVIL = { width: 390, height: 844 };
const ESCRITORIO = { width: 1280, height: 800 };
const MOVIL_ADMIN = { width: 390, height: 844 };

const TENANT = "99999999-0000-4000-8000-000000000001";
const CARMEN = "99999999-0000-4000-8000-000000000050";

const medido: string[] = [];

/**
 * Deja el libro vacío antes de empezar.
 *
 * La pasada abre incidencias y las acusa; sin esto, la segunda pasada
 * encuentra los avisos ya acusados y el móvil de guardia sale en reposo
 * en vez de con el aviso delante. Lo encontró la segunda pasada.
 *
 * Los tres triggers se apartan porque una incidencia es inmutable, una
 * acción es append-only y una constancia de familia también — que es
 * justo lo que el bloque promete.
 */
async function vaciarElLibro(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL! } },
  });
  const triggers = [
    ["family_communications", "family_communications_append_only"],
    ["incident_actions", "incident_actions_append_only"],
    ["incidents", "incidents_inmutable"],
    ["care_records", "care_records_inmutable"],
  ] as const;
  for (const [t, g] of triggers) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER ${g}`);
  }
  for (const tabla of [
    "guard_alerts",
    "guard_shift_sessions",
    "family_communications",
    "incident_actions",
    "incident_links",
    "incidents",
    "care_records",
  ]) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${tabla} WHERE tenant_id = '${TENANT}'`,
    );
  }
  for (const [t, g] of triggers) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER ${g}`);
  }
  await prisma.$disconnect();
  console.log("libro vaciado");
}

async function disparar(page: Page, nombre: string): Promise<void> {
  // Un respiro para que la fuente y la foto acaben de pintar: una
  // captura con el texto a medio cargar no sirve para mirar si algo se
  // sale.
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SALIDA}${nombre}.png` });
  console.log(`  · ${nombre}.png`);
}

/**
 * El guardián de los objetivos táctiles.
 *
 * El mockup validado (D-64) fija 56 px de suelo en la puerta y 72 para
 * la acción principal. Esto mide CADA botón y enlace de la página y
 * devuelve los que no llegan, con su texto.
 */
async function toquesPequenos(page: Page, minimo = 56): Promise<string[]> {
  return page.evaluate((min) => {
    const malos: string[] = [];
    for (const el of document.querySelectorAll("button, a[href]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < min) {
        malos.push(`${Math.round(r.height)}px · «${el.textContent?.trim().slice(0, 40)}»`);
      }
    }
    return malos;
  }, minimo);
}

/** ¿Se sale algo a lo ancho? */
async function seSale(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
}

async function revisar(page: Page, donde: string, minimo = 56): Promise<void> {
  const malos = await toquesPequenos(page, minimo);
  if (malos.length > 0) {
    console.warn(`  ⚠ ${donde}: objetivos por debajo de ${minimo} px`);
    for (const m of malos) console.warn(`      ${m}`);
  }
  if (await seSale(page)) console.warn(`  ⚠ ${donde}: algo se sale a lo ancho`);
}

/** Abre una página con un device token ya puesto. */
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
//  LA PUERTA
// ════════════════════════════════════════════════════════════════════

async function laPuerta(browser: Browser): Promise<void> {
  console.log("\n── La puerta de la 112 ──");
  const page = await conDispositivo(browser, TOKEN_PUERTA, PUERTA);
  await page.goto(TPV);
  await page.getByRole("button", { name: /Toca para registrar/ }).click();

  // ── MEDIDO · «tomar la temperatura» ───────────────────────────────
  //
  // Se cuentan los toques desde el PIN hasta «Apuntado», que es lo que
  // la auxiliar hace de verdad: entra, toma la temperatura y sale.
  const t0 = Date.now();
  let toques = 0;
  await tecleaPin(page, PIN_ANA);
  toques += PIN_ANA.length;
  await page.getByRole("heading", { name: /¿Cómo está hoy\?/ }).first().waitFor();
  await revisar(page, "lo que toca", 56);

  // El botón «Tomar» de la línea de temperatura del plan de Carmen.
  await page.getByRole("button", { name: "Tomar" }).first().click();
  toques += 1;
  await page.getByRole("button", { name: "Apuntar" }).waitFor();
  await disparar(page, "1-constante-teclado-vacio-1280x800");

  for (const d of ["3", "8", ",", "6"]) {
    await page.getByRole("button", { name: d, exact: true }).click();
    toques += 1;
  }
  await disparar(page, "2-constante-38-6-con-nivel-1280x800");
  await revisar(page, "teclado de la constante", 56);

  await page.getByRole("button", { name: "Apuntar", exact: true }).click();
  toques += 1;
  await page.getByText("Apuntado", { exact: true }).waitFor();
  const msTemperatura = Date.now() - t0;
  medido.push(
    `tomar la temperatura (PIN + Tomar + 4 teclas + Apuntar): ${toques} toques · ${msTemperatura} ms de máquina`,
  );
  // El servidor contesta en un momento; se espera a que la banda del
  // nivel aparezca para que la captura diga la verdad.
  await page.getByText(/Alguien tiene que verlo ahora/).waitFor({ timeout: 10_000 });
  await disparar(page, "3-n2-avisado-1280x800");
  await revisar(page, "apuntado con aviso", 56);

  // ── El fuera de rango ─────────────────────────────────────────────
  await page.getByRole("button", { name: /Seguir en la habitación 112/ }).click();
  await page.getByRole("button", { name: "Tomar" }).first().click();
  for (const d of ["3", "8", "4"]) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
  await disparar(page, "4-constante-fuera-de-rango-1280x800");

  // ── Los tipos de «algo no va bien» ────────────────────────────────
  await page.getByRole("button", { name: "Volver" }).click();
  const t1 = Date.now();
  let toquesCaida = 0;
  await page.getByRole("button", { name: "Algo no va bien" }).first().click();
  toquesCaida += 1;
  await page.getByText(/¿Sabes qué ha pasado\?/).waitFor();
  await disparar(page, "5-tipos-algo-no-va-bien-1280x800");

  await page.getByRole("button", { name: "Caída", exact: true }).click();
  toquesCaida += 1;
  await page.getByText("¿Se ha dado en la cabeza o hay herida?").waitFor();
  await disparar(page, "6-caida-pregunta-unica-1280x800");
  await revisar(page, "algo no va bien", 56);

  await page.getByRole("button", { name: "No", exact: true }).click();
  toquesCaida += 1;
  await page.getByRole("button", { name: /Apuntarlo para el relevo/ }).click();
  toquesCaida += 1;
  await page.getByText("Apuntado", { exact: true }).waitFor();
  medido.push(
    `caída sin golpe (Algo no va bien + Caída + No + Apuntar): ${toquesCaida} toques · ${Date.now() - t1} ms de máquina`,
  );

  // ── El N4 ─────────────────────────────────────────────────────────
  await page.getByRole("button", { name: /Seguir en la habitación 112/ }).click();
  await page.getByRole("button", { name: "Algo no va bien" }).first().click();
  await page
    .getByRole("button", { name: "No lo encontramos / se ha ido" })
    .click();
  await page.getByRole("button", { name: /Apuntarlo para el relevo/ }).click();
  await page.getByText("Llama al 112").waitFor({ timeout: 10_000 });
  await disparar(page, "7-n4-llama-al-112-1280x800");

  await page.context().close();
}

/**
 * La puerta SIN RED: se registra con el navegador desconectado y la
 * pantalla 6 tiene que decir que el aviso NO ha salido.
 *
 * Es el caso que el prompt nombra como «el peor fallo posible de este
 * bloque», así que la captura va aparte y con su propio contexto: hay
 * que cortar la red DESPUÉS de haber cargado la app y de haber entrado
 * con el PIN, porque las dos cosas necesitan servidor.
 */
async function laPuertaSinRed(browser: Browser): Promise<void> {
  console.log("\n── La puerta sin red ──");
  const page = await conDispositivo(browser, TOKEN_PUERTA, PUERTA);
  await page.goto(TPV);
  await page.getByRole("button", { name: /Toca para registrar/ }).click();
  await tecleaPin(page, PIN_ANA);
  await page.getByRole("heading", { name: /¿Cómo está hoy\?/ }).first().waitFor();

  // Y ahora se va el wifi.
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Tomar" }).first().click();
  for (const d of ["3", "8", ",", "6"]) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
  await page.getByRole("button", { name: "Apuntar", exact: true }).click();
  await page.getByText(/NO ha salido/).waitFor({ timeout: 10_000 });
  await disparar(page, "8-n2-sin-red-no-ha-salido-1280x800");
  await page.context().close();
}

// ════════════════════════════════════════════════════════════════════
//  EL MÓVIL DE GUARDIA
// ════════════════════════════════════════════════════════════════════

async function elMovil(browser: Browser): Promise<void> {
  console.log("\n── El móvil de guardia ──");
  const page = await conDispositivo(browser, TOKEN_ENFERMERIA, MOVIL);
  await page.goto(TPV);
  await page.getByText("Nadie de guardia").waitFor({ timeout: 20_000 });
  await disparar(page, "9-guardia-nadie-390");
  await revisar(page, "guardia en reposo", 56);

  await page.getByRole("button", { name: /Estoy de guardia/ }).click();
  await tecleaPin(page, PIN_ROSA);

  // Con los avisos de la pasada de la puerta ya abiertos, lo que sale es
  // el aviso a pantalla completa y no la lista.
  await page.getByRole("button", { name: "Voy", exact: true }).waitFor({
    timeout: 20_000,
  });
  await disparar(page, "10-guardia-aviso-390");
  await revisar(page, "el aviso", 56);

  await page.getByRole("button", { name: "Voy", exact: true }).click();
  // Se van acusando hasta que no queda ninguno: entonces sale la
  // pantalla en reposo con la lista del turno.
  for (let i = 0; i < 6; i++) {
    const voy = page.getByRole("button", { name: "Voy", exact: true });
    if ((await voy.count()) === 0) break;
    await voy.click();
    await page.waitForTimeout(600);
  }
  await page.getByText(/De guardia: Rosa/).waitFor({ timeout: 20_000 });
  await disparar(page, "11-guardia-reposo-con-el-turno-390");

  await page.context().close();
}

/** Y el móvil de dirección, para ver el escalado desde el otro lado. */
async function elMovilDeDireccion(browser: Browser): Promise<void> {
  console.log("\n── El móvil de dirección ──");
  const page = await conDispositivo(browser, TOKEN_RESPONSABLE, MOVIL);
  await page.goto(TPV);
  await page.getByText(/Móvil de dirección/).waitFor({ timeout: 20_000 });
  await disparar(page, "12-guardia-direccion-reposo-390");
  await page.context().close();
}

// ════════════════════════════════════════════════════════════════════
//  EL ADMIN
// ════════════════════════════════════════════════════════════════════

async function entrarAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.locator("#email").fill(PANEL.email);
  await page.locator("#password").fill(PANEL.password);
  await page.getByRole("button", { name: /^Entrar/ }).click();
  // Se espera a SALIR del login y no a un enlace de la barra lateral: a
  // 390 px la barra es un cajón y sus enlaces no están visibles, así que
  // esperar «Residentes» colgaba la pasada del móvil. Lo encontró esta
  // misma pasada.
  await page.waitForURL(/\/admin\//, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function elLibro(browser: Browser): Promise<void> {
  console.log("\n── El admin ──");
  for (const [sufijo, viewport] of [
    ["escritorio", ESCRITORIO],
    ["390", MOVIL_ADMIN],
  ] as const) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await entrarAdmin(page);

    await page.goto(`${ADMIN}/admin/residencia/incidencias`);
    await page.getByRole("heading", { name: "Incidencias" }).waitFor();
    await page.waitForTimeout(600);
    await disparar(page, `13-libro-${sufijo}`);
    if (sufijo === "escritorio") await revisar(page, "el libro", 36);

    // La ficha de la primera.
    const primera = page.locator("a[href*='/admin/residencia/incidencias/']").first();
    if ((await primera.count()) > 0) {
      await primera.click();
      await page
        .getByRole("heading", { name: "Qué se hizo" })
        .waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      await disparar(page, `14-ficha-${sufijo}`);
    }

    await page.goto(`${ADMIN}/admin/residencia/guardia`);
    await page.getByRole("heading", { name: "Plantilla de gravedad" }).waitFor({
      timeout: 15_000,
    });
    await page.waitForTimeout(400);
    await disparar(page, `15-guardia-configuracion-${sufijo}`);
    // La plantilla entera: se desplaza hasta abajo.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await disparar(page, `16-plantilla-de-gravedad-${sufijo}`);

    // Y los umbrales propios de Carmen.
    await page.goto(`${ADMIN}/admin/residencia/residentes/${CARMEN}/umbrales`);
    await page.getByRole("heading", { name: "Pautar una excepción" }).waitFor({
      timeout: 15_000,
    });
    await page.waitForTimeout(400);
    await disparar(page, `17-umbrales-del-residente-${sufijo}`);

    await ctx.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  await vaciarElLibro();
  const browser = await chromium.launch();
  try {
    await laPuerta(browser);
    await elMovil(browser);
    await elMovilDeDireccion(browser);
    await laPuertaSinRed(browser);
    await elLibro(browser);
  } finally {
    await browser.close();
  }

  writeFileSync(
    `${SALIDA}MEDIDO.txt`,
    [
      "residencia-4 · lo medido en el bucle visual, a 1280×800, en el producto",
      "de verdad y con Jardín de Gredos sembrado.",
      "",
      "Los TOQUES son exactos: son los clics que hay que dar. Los SEGUNDOS son",
      "de máquina —del primer toque a que la pantalla lo diga— y es lo que el",
      "software cuesta. Lo que NO está medido es el tiempo de la persona: eso",
      "se mide con una auxiliar delante, no con un navegador.",
      "",
      ...medido.map((m) => `  ${m}`),
      "",
    ].join("\n"),
  );
  console.log(`\nMEDIDO.txt\n${medido.map((m) => `  ${m}`).join("\n")}`);
}

await main();
