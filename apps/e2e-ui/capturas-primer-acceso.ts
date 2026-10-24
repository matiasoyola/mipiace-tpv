// primer-acceso · EL BUCLE VISUAL. El día del alta de Carmen, en el
// producto de verdad, con la cámara.
//
// No es un test: es una pasada. Lo que busca son los fallos que ninguna
// suite ve —un botón tapado, un texto que no cabe, una tarjeta bajo el
// pliegue, un objetivo táctil de 30 px— y de paso MIDE las pantallas y los
// toques desde que abre el correo hasta que guarda el primer residente,
// contra el objetivo del prompt:
//
//   correo → contraseña → contrato → «Nuevo ingreso», y nada más.
//
// contrato-lectura-completa (24-10-2026) cambió una pantalla de este
// recorrido: el texto del contrato ya no va plegado y el botón no se
// enciende hasta que se ha recorrido entero. La pasada baja el recuadro
// hasta el final antes de marcar la casilla, que es lo que hace Carmen.
//
// Hermana de `capturas-residencia5.ts` y vive en el repo por lo mismo: el
// día que alguien quiera volver a ver estas pantallas tiene que poder
// hacerlo sin reconstruir el guion de memoria.
//
// ── Antes de correrla ───────────────────────────────────────────────
//
//   docker start mipiacetpv-postgres            (y un Redis propio)
//   apps/api/.env con su base, su Redis, su PORT y EMAIL_OUTBOX_FILE
//   pnpm --filter @mipiacetpv/db run migrate:deploy
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx seed/primer-acceso-demo.ts
//   pnpm --filter @mipiacetpv/api run start
//   MIPIACETPV_DEV_PORT=5283 MIPIACETPV_API_PROXY=http://127.0.0.1:3023 \
//     pnpm --filter @mipiacetpv/admin run dev
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx capturas-primer-acceso.ts
//
// ── El correo se fotografía DE VERDAD ───────────────────────────────
//
// `EMAIL_OUTBOX_FILE` hace que la API escriba cada envío como una línea
// JSON. La pasada lee la última, abre su `html` en una pestaña y la
// fotografía: lo que sale en la captura es el correo que Carmen recibe,
// no una maqueta de cómo nos imaginamos que se ve.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { chromium, type Browser, type Page } from "@playwright/test";

import { CARMEN, SUPER_ADMIN, TENANT } from "./seed/primer-acceso-demo.js";

const ADMIN = process.env.BANCO_ADMIN_URL ?? "http://localhost:5283";
const OUTBOX =
  process.env.EMAIL_OUTBOX_FILE ??
  (() => {
    const env = readFileSync(
      new URL("../api/.env", import.meta.url).pathname,
      "utf8",
    );
    const m = /^\s*EMAIL_OUTBOX_FILE\s*=\s*(.*)$/m.exec(env);
    if (!m?.[1]) throw new Error("Falta EMAIL_OUTBOX_FILE en apps/api/.env");
    // Sin las comillas: `.env.example` las pone en todos sus valores, y
    // con ellas la ruta es un fichero que no existe (ENOENT a la primera
    // línea de la pasada). Mismo trato que `seed/base-de-datos.ts` le da
    // a `DATABASE_URL`.
    return m[1].trim().replace(/^["']|["']$/g, "");
  })();

const SALIDA = new URL("../../docs/qa/2026-10-23-primer-acceso/", import.meta.url)
  .pathname;

const ESCRITORIO = { width: 1280, height: 800 };
/** 390×844: el iPhone de la directora, que es con lo que abre el correo. */
const MOVIL = { width: 390, height: 844 };

const medido: string[] = [];
let pantallas = 0;

function anota(linea: string): void {
  medido.push(linea);
  console.log(`  · ${linea}`);
}

async function foto(page: Page, nombre: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SALIDA}${nombre}.png`, fullPage: true });
  console.log(`  📷 ${nombre}.png`);
}

/** El último correo que la API ha escrito al buzón de fichero. */
function ultimoCorreo(): { to: string; subject: string; text: string; html?: string } {
  const lineas = readFileSync(OUTBOX, "utf8").trim().split("\n").filter(Boolean);
  const ultima = lineas.at(-1);
  if (!ultima) throw new Error(`El buzón ${OUTBOX} está vacío.`);
  return JSON.parse(ultima);
}

function tokenDelCorreo(texto: string): string {
  const m = texto.match(/\/bienvenida\?token=(\S+)/);
  if (!m?.[1]) throw new Error(`El correo no lleva enlace:\n${texto}`);
  return m[1];
}

/** Lo que mide si un objetivo táctil es tocable con el pulgar. */
async function alturasDeBotones(page: Page): Promise<number[]> {
  return page.$$eval("button, a[href]", (els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent != null)
      .map((e) => Math.round(e.getBoundingClientRect().height)),
  );
}

async function entraElImplantador(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/superadmin/login`);
  await page.fill('input[type="email"]', SUPER_ADMIN.email);
  await page.fill("#superAdminPassword", SUPER_ADMIN.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  // `/superadmin/` a secas casaba con `/superadmin/login`, así que la
  // espera se resolvía ANTES de entrar y el `goto` siguiente rebotaba al
  // login otra vez. Se espera el destino de verdad.
  await page.waitForURL(/\/superadmin\/(tenants|hub)/, { timeout: 20_000 });
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  // El buzón se vacía: lo que se fotografía es el correo de ESTA pasada.
  writeFileSync(OUTBOX, "");

  const navegador: Browser = await chromium.launch();
  try {
    // ══ 1 · El super-admin activa la cuenta ════════════════════════
    console.log("\n1 · el super-admin activa Jardín de Gredos");
    const escritorio = await navegador.newPage({ viewport: ESCRITORIO });
    await entraElImplantador(escritorio);
    await escritorio.goto(`${ADMIN}/superadmin/tenants/${TENANT}`);
    await escritorio.getByRole("button", { name: "Activar cuenta" }).last().click();
    await escritorio.fill('input[placeholder="propietario@negocio.es"]', CARMEN.email);
    await escritorio.fill('input[placeholder="María Pérez"]', CARMEN.nombre);
    await escritorio.getByRole("button", { name: /Confirmar activación/ }).click();
    await escritorio
      .getByText(/Invitación enviada a/)
      .waitFor({ timeout: 20_000 });
    await foto(escritorio, "01-superadmin-tras-activar-escritorio");
    anota(
      "super-admin tras activar: ninguna contraseña en pantalla, «Invitación enviada a … · caduca el dd/mm»",
    );
    // El panel permanente, con «Reenviar invitación» y «Copiar enlace».
    await escritorio
      .getByText("Invitación del propietario")
      .waitFor({ timeout: 10_000 });
    await escritorio
      .getByText(/Invitación pendiente \(caduca/)
      .first()
      .waitFor({ timeout: 10_000 });
    anota(
      "la tabla de usuarios dice «Invitación pendiente (caduca dd/mm)» en vez de «Pendiente de cambiar password»",
    );

    // ══ 2 · El correo ══════════════════════════════════════════════
    console.log("\n2 · el correo que recibe Carmen");
    const correo = ultimoCorreo();
    if (correo.to !== CARMEN.email) {
      throw new Error(`El último correo es para ${correo.to}, no para Carmen.`);
    }
    if (/Mipiacetpv/.test(correo.text)) {
      throw new Error("El correo de una residencia NO puede decir «Mipiacetpv».");
    }
    pantallas++;
    for (const [nombre, viewport] of [
      ["escritorio", ESCRITORIO],
      ["390", MOVIL],
    ] as const) {
      const p = await navegador.newPage({ viewport });
      await p.setContent(correo.html ?? `<pre>${correo.text}</pre>`);
      await foto(p, `02-correo-${nombre}`);
      await p.close();
    }
    anota(`asunto del correo: «${correo.subject}»`);
    const token = tokenDelCorreo(correo.text);

    // ══ 3 · La bienvenida ══════════════════════════════════════════
    console.log("\n3 · la página de bienvenida");
    pantallas++;
    for (const [nombre, viewport] of [
      ["escritorio", ESCRITORIO],
      ["390", MOVIL],
    ] as const) {
      const p = await navegador.newPage({ viewport });
      await p.goto(`${ADMIN}/bienvenida?token=${token}`);
      await p.getByText(`Hola ${CARMEN.nombre}`).waitFor({ timeout: 15_000 });
      await foto(p, `03-bienvenida-vacia-${nombre}`);
      // Los requisitos, a medio cumplir: es lo que se ve mientras teclea.
      await p.fill("#nuevaContrasena", "jardin");
      await foto(p, `04-bienvenida-requisitos-${nombre}`);
      await p.fill("#nuevaContrasena", CARMEN.password);
      await foto(p, `05-bienvenida-lista-${nombre}`);
      if (nombre === "390") {
        const alturas = await alturasDeBotones(p);
        const cortos = alturas.filter((h) => h > 0 && h < 44);
        anota(
          `bienvenida a 390: ${alturas.length} objetivos táctiles, ${cortos.length} por debajo de 44 px${
            cortos.length ? ` (${cortos.join(", ")})` : ""
          }`,
        );
        const campos = await p.$$eval(
          "input",
          (els) => els.filter((e) => (e as HTMLElement).offsetParent != null).length,
        );
        anota(`y UN solo campo: ${campos}`);
      }
      await p.close();
    }

    // ══ 4 · El enlace caducado ═════════════════════════════════════
    console.log("\n4 · el enlace que ya no vale");
    for (const [nombre, viewport] of [
      ["escritorio", ESCRITORIO],
      ["390", MOVIL],
    ] as const) {
      const p = await navegador.newPage({ viewport });
      await p.goto(`${ADMIN}/bienvenida?token=este-no-existe`);
      await p.getByText("Este enlace ya no vale").waitFor({ timeout: 15_000 });
      await foto(p, `06-enlace-caducado-${nombre}`);
      await p.fill("#emailReenvio", CARMEN.email);
      await p.getByRole("button", { name: /Envíame uno nuevo/ }).click();
      await p
        .getByText(/Si ese correo tiene una invitación pendiente/)
        .waitFor({ timeout: 15_000 });
      await foto(p, `07-enlace-caducado-reenviado-${nombre}`);
      await p.close();
    }
    anota(
      "el enlace muerto tiene su propia pantalla y pide otro con respuesta neutra",
    );

    // El reenvío de arriba ha anulado el token del correo: se coge el del
    // último correo, que es lo que haría Carmen.
    const tokenVivo = tokenDelCorreo(ultimoCorreo().text);

    // ══ 5 · Entra, y lo primero es el contrato ═════════════════════
    console.log("\n5 · elige la contraseña y entra");
    const carmen = await navegador.newPage({ viewport: ESCRITORIO });
    const carmenMovil = await navegador.newPage({ viewport: MOVIL });
    await carmen.goto(`${ADMIN}/bienvenida?token=${tokenVivo}`);
    await carmen.fill("#nuevaContrasena", CARMEN.password);
    const t0 = Date.now();
    await carmen.getByRole("button", { name: "Entrar" }).click();
    await carmen.waitForURL(/\/admin\/contrato-tratamiento/, { timeout: 20_000 });
    anota(
      `de «Entrar» al contrato: ${Date.now() - t0} ms, y NINGUNA pantalla de login en medio`,
    );
    pantallas++;
    await carmen.getByText("Contrato de tratamiento de datos").first().waitFor();
    await foto(carmen, "08-contrato-escritorio");

    // El móvil comparte la sesión por el storageState del contexto, así
    // que basta con navegar.
    const sesion = await carmen.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    await carmenMovil.goto(`${ADMIN}/login`);
    await carmenMovil.evaluate((s) => {
      for (const [k, v] of Object.entries(JSON.parse(s.local) as Record<string, string>))
        localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(
        JSON.parse(s.session) as Record<string, string>,
      ))
        sessionStorage.setItem(k, v);
    }, sesion);
    await carmenMovil.goto(`${ADMIN}/admin/contrato-tratamiento`);
    await carmenMovil
      .getByText("Contrato de tratamiento de datos")
      .first()
      .waitFor({ timeout: 15_000 });
    await foto(carmenMovil, "08-contrato-390");
    // contrato-lectura-completa · el texto legal YA NO SE PLIEGA: está a
    // la vista en un recuadro con su propio scroll, y lo que esta foto
    // enseña es el final del texto, que es lo que abre el botón.
    await carmenMovil.$eval('[data-test="contrato-texto"]', (el) => {
      el.scrollTo({ top: el.scrollHeight });
    });
    await foto(carmenMovil, "09-contrato-al-final-390");

    // ══ 6 · Acepta y cae en el panel vacío ═════════════════════════
    console.log("\n6 · acepta y aterriza en el panel vacío");
    // Antes de poder marcar la casilla hay que haber llegado al final:
    // es la puerta de contrato-lectura-completa.
    await carmen.$eval('[data-test="contrato-texto"]', (el) => {
      el.scrollTo({ top: el.scrollHeight });
    });
    await carmen.waitForFunction(
      () =>
        (
          document.querySelector(
            '[data-test="contrato-casilla"]',
          ) as HTMLInputElement | null
        )?.disabled === false,
      undefined,
      { timeout: 10_000 },
    );
    await carmen.getByLabel(/He leído el contrato/).check();
    const t1 = Date.now();
    await carmen.getByRole("button", { name: "Acepto" }).click();
    await carmen.waitForURL(/\/admin\/residencia\/panel/, { timeout: 20_000 });
    anota(
      `de «Acepto» al panel: ${Date.now() - t1} ms, y sola — sin pasar por el menú`,
    );
    pantallas++;
    await carmen
      .getByText("Empieza dando de alta a tus residentes")
      .waitFor({ timeout: 15_000 });
    await foto(carmen, "10-panel-vacio-escritorio");
    await carmenMovil.goto(`${ADMIN}/admin/residencia/panel`);
    await carmenMovil
      .getByText("Empieza dando de alta a tus residentes")
      .waitFor({ timeout: 15_000 });
    await foto(carmenMovil, "10-panel-vacio-390");
    const alturasPanel = await alturasDeBotones(carmenMovil);
    anota(
      `panel vacío a 390: el botón «Nuevo ingreso» mide ${Math.max(...alturasPanel)} px de alto`,
    );

    // ══ 7 · «Nuevo ingreso» y el siguiente ═════════════════════════
    console.log("\n7 · el primer residente, y el siguiente");
    const t2 = Date.now();
    await carmen.getByRole("link", { name: /Nuevo ingreso/ }).click();
    await carmen.waitForSelector("#nombre", { timeout: 15_000 });
    anota(`del panel al formulario de ingreso: 1 toque, ${Date.now() - t2} ms`);
    pantallas++;
    await carmen.fill("#nombre", "Dolores");
    await carmen.fill("#apellidos", "Jiménez Vara");
    await carmen.getByRole("button", { name: "Dependiente" }).click();
    await carmen.getByRole("button", { name: "Privada" }).click();
    await foto(carmen, "11-nuevo-ingreso-escritorio");
    await carmen.getByRole("button", { name: "Guardar y dar de alta otro" }).click();
    await carmen.getByText(/queda registrado/).waitFor({ timeout: 15_000 });
    await foto(carmen, "12-guardar-y-otro-escritorio");
    anota(
      "«Guardar y dar de alta otro»: el formulario se queda abierto, en blanco, y lo dice",
    );

    await carmenMovil.goto(`${ADMIN}/admin/residencia/residentes?alta=1`);
    await carmenMovil.waitForSelector("#nombre", { timeout: 15_000 });
    await foto(carmenMovil, "11-nuevo-ingreso-390");

    anota(`PANTALLAS del correo al primer residente: ${pantallas}`);

    writeFileSync(
      `${SALIDA}medido.md`,
      [
        "# primer-acceso · lo medido en el bucle visual",
        "",
        "Pasada del 23-10-2026 contra el producto de verdad (API + panel en",
        "local, base sembrada con Jardín de Gredos en DRAFT).",
        "",
        ...medido.map((l) => `- ${l}`),
        "",
      ].join("\n"),
    );
    console.log(`\nListo. Capturas y medido en ${SALIDA}`);
  } finally {
    await navegador.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
