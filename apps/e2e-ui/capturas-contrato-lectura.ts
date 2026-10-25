// contrato-lectura-completa · EL BUCLE VISUAL. La pantalla del contrato
// antes y después de recorrer el texto, en el producto de verdad.
//
// No es un test: es una pasada con la cámara. Lo que busca son los fallos
// que ninguna suite ve, y aquí hay uno concreto que medir: **que la
// casilla y «Acepto» queden por encima del pliegue** con el texto
// desplegado delante. El recuadro tiene `max-h-[46vh]` justo por eso, y
// un número mal elegido deja el botón fuera de pantalla a 390 — que es el
// fallo que la banda del TPV ya costó una vez.
//
// Las cuatro fotos del prompt (dos anchos × dos estados):
//
//   1. el contrato AL CARGAR, con el botón desactivado
//   2. el contrato AL FINAL del texto, con el botón activo
//
// Y de paso, lo del punto 6: que al entrar en una cuenta SIN CAJA no
// aparece la pantalla «Tu PIN de respaldo».
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
//   pnpm --filter @mipiacetpv/e2e-ui exec tsx capturas-contrato-lectura.ts

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
    return m[1].trim().replace(/^["']|["']$/g, "");
  })();

const SALIDA = new URL(
  "../../docs/qa/2026-10-24-contrato-lectura-completa/",
  import.meta.url,
).pathname;

const ESCRITORIO = { width: 1280, height: 800 };
/** 390×844: el iPhone de la directora. */
const MOVIL = { width: 390, height: 844 };

const medido: string[] = [];

function anota(linea: string): void {
  medido.push(linea);
  console.log(`  · ${linea}`);
}

async function foto(page: Page, nombre: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SALIDA}${nombre}.png`, fullPage: true });
}

/** La foto de LO QUE SE VE sin bajar la página, que es lo que se mide. */
async function fotoDelPliegue(page: Page, nombre: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SALIDA}${nombre}.png`, fullPage: false });
}

function ultimoCorreo(): { to: string; subject: string; text: string } {
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

/**
 * LA MEDIDA DEL BLOQUE: con el recuadro del texto en pantalla, ¿se ven a
 * la vez el recuadro y el botón de aceptar?
 *
 * Y se mide así y no desde arriba de la página a propósito — es la
 * memoria de la casa: *medir contra el contenedor, no contra el
 * viewport*. Desde `scrollY = 0` el botón cae siempre bajo el pliegue,
 * porque encima del recuadro están la entradilla, la banda de estado y
 * las tres líneas en llano, y eso es normal: se baja hasta el contrato
 * como se baja hasta cualquier sección. Lo que decisión 1 pide es que el
 * recuadro no sea tan alto que, estando ya delante de él, haya que
 * volver a bajar para encontrar el botón.
 */
async function recuadroYBotonALaVez(page: Page): Promise<{
  cabe: boolean;
  necesita: number;
  alto: number;
}> {
  await page.$eval('[data-test="contrato-texto"]', (el) => {
    el.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const caja = document.querySelector(
      '[data-test="contrato-texto"]',
    ) as HTMLElement;
    const boton = document.querySelector(
      '[data-test="contrato-aceptar"]',
    ) as HTMLElement;
    const aviso = document.querySelector(
      '[data-test="contrato-aviso-recorrer"]',
    ) as HTMLElement;
    const arriba = caja.getBoundingClientRect().top;
    const abajo = Math.max(
      boton.getBoundingClientRect().bottom,
      aviso.getBoundingClientRect().bottom,
    );
    return {
      cabe: abajo <= window.innerHeight,
      necesita: Math.round(abajo - arriba),
      alto: window.innerHeight,
    };
  });
}

async function alFinalDelTexto(page: Page): Promise<void> {
  await page.$eval('[data-test="contrato-texto"]', (el) => {
    el.scrollTo({ top: el.scrollHeight });
  });
  // El observador avisa en el siguiente cuadro.
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[data-test="contrato-aviso-recorrer"]',
        ) as HTMLElement | null
      )?.textContent?.includes("Has llegado al final") === true,
    undefined,
    { timeout: 10_000 },
  );
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  writeFileSync(OUTBOX, "");

  const navegador: Browser = await chromium.launch();
  try {
    // ══ 1 · El implantador activa la cuenta ════════════════════════
    console.log("\n1 · el super-admin activa Jardín de Gredos");
    const jefe = await navegador.newPage({ viewport: ESCRITORIO });
    await jefe.goto(`${ADMIN}/superadmin/login`);
    await jefe.fill('input[type="email"]', SUPER_ADMIN.email);
    await jefe.fill("#superAdminPassword", SUPER_ADMIN.password);
    await jefe.getByRole("button", { name: "Iniciar sesión" }).click();
    await jefe.waitForURL(/\/superadmin\/(tenants|hub)/, { timeout: 20_000 });
    await jefe.goto(`${ADMIN}/superadmin/tenants/${TENANT}`);
    await jefe.getByRole("button", { name: "Activar cuenta" }).last().click();
    await jefe.fill('input[placeholder="propietario@negocio.es"]', CARMEN.email);
    await jefe.fill('input[placeholder="María Pérez"]', CARMEN.nombre);
    await jefe.getByRole("button", { name: /Confirmar activación/ }).click();
    await jefe.getByText(/Invitación enviada a/).waitFor({ timeout: 20_000 });
    await jefe.close();
    const token = tokenDelCorreo(ultimoCorreo().text);

    // ══ 2 · Carmen entra ═══════════════════════════════════════════
    //
    // Y el punto 6 se mide aquí: SIN CAJA no hay pantalla de PIN. Lo que
    // la directora vio el 24-10 era esta pantalla, entre «Entrar» y el
    // contrato.
    console.log("\n2 · Carmen elige la contraseña y entra");
    const paginas: Record<string, Page> = {};
    for (const [nombre, viewport] of [
      ["escritorio", ESCRITORIO],
      ["390", MOVIL],
    ] as const) {
      const p = await navegador.newPage({ viewport });
      await p.goto(`${ADMIN}/bienvenida?token=${token}`);
      await p.getByText(`Hola ${CARMEN.nombre}`).waitFor({ timeout: 15_000 });
      await p.fill("#nuevaContrasena", CARMEN.password);
      await p.getByRole("button", { name: "Entrar" }).click();
      await p.waitForURL(/\/admin\/contrato-tratamiento/, { timeout: 20_000 });
      // Si la pantalla del PIN volviera, estaría AQUÍ en medio y el
      // `waitForURL` de arriba se habría caído. Se comprueba además por
      // texto, que es lo que ella leyó.
      const pin = await p.getByText("Tu PIN de respaldo").count();
      if (pin !== 0) {
        throw new Error(
          "VOLVIÓ el PIN de respaldo en una cuenta sin caja (punto 6 del bloque).",
        );
      }
      paginas[nombre] = p;
      // Sólo una de las dos sesiones puede aceptar: Carmen es una, y la
      // segunda pestaña usa su misma cuenta.
      break;
    }
    // La segunda pestaña hereda la sesión por `localStorage`.
    const escritorio = paginas.escritorio!;
    const sesion = await escritorio.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    const movil = await navegador.newPage({ viewport: MOVIL });
    await movil.goto(`${ADMIN}/login`);
    await movil.evaluate((s) => {
      for (const [k, v] of Object.entries(
        JSON.parse(s.local) as Record<string, string>,
      ))
        localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(
        JSON.parse(s.session) as Record<string, string>,
      ))
        sessionStorage.setItem(k, v);
    }, sesion);
    anota("entre «Entrar» y el contrato NO hay pantalla de PIN de respaldo");

    // ══ 3 · El contrato, AL CARGAR ═════════════════════════════════
    console.log("\n3 · el contrato al cargar: el botón desactivado");
    for (const [nombre, p] of [
      ["escritorio", escritorio],
      ["390", movil],
    ] as const) {
      if (nombre === "390") {
        await p.goto(`${ADMIN}/admin/contrato-tratamiento`);
      }
      await p
        .getByText("Contrato de tratamiento de datos")
        .first()
        .waitFor({ timeout: 15_000 });
      await p.waitForSelector('[data-test="contrato-texto"]');

      const desactivado = await p.$eval(
        '[data-test="contrato-aceptar"]',
        (b) => (b as HTMLButtonElement).disabled,
      );
      const casilla = await p.$eval(
        '[data-test="contrato-casilla"]',
        (b) => (b as HTMLInputElement).disabled,
      );
      anota(
        `${nombre} al cargar: «Acepto» desactivado=${desactivado}, casilla desactivada=${casilla}`,
      );
      const aviso = await p.$eval(
        '[data-test="contrato-aviso-recorrer"]',
        (e) => e.textContent?.trim() ?? "",
      );
      anota(`${nombre} · el aviso dice: «${aviso}»`);

      await foto(p, `01-contrato-al-cargar-${nombre}`);
      await fotoDelPliegue(p, `01-contrato-al-cargar-pliegue-${nombre}`);

      const caja = await p.$eval('[data-test="contrato-texto"]', (el) => ({
        alto: Math.round(el.clientHeight),
        contenido: Math.round(el.scrollHeight),
      }));
      anota(
        `${nombre} · el recuadro mide ${caja.alto} px y el texto ${caja.contenido} px: ${caja.contenido > caja.alto ? "scrollea" : "CABE sin scroll"}`,
      );
      const juntos = await recuadroYBotonALaVez(p);
      anota(
        `${nombre} · recuadro y «Acepto» a la vez: ${juntos.cabe ? "SÍ" : "NO"} — hacen falta ${juntos.necesita} px de los ${juntos.alto} del alto`,
      );
      await fotoDelPliegue(p, `01-contrato-recuadro-y-boton-${nombre}`);
      await p.evaluate(() => window.scrollTo(0, 0));
    }

    // ══ 4 · El contrato, AL FINAL del texto ════════════════════════
    console.log("\n4 · al final del texto: el botón activo");
    for (const [nombre, p] of [
      ["escritorio", escritorio],
      ["390", movil],
    ] as const) {
      await alFinalDelTexto(p);
      const desactivado = await p.$eval(
        '[data-test="contrato-aceptar"]',
        (b) => (b as HTMLButtonElement).disabled,
      );
      const casilla = await p.$eval(
        '[data-test="contrato-casilla"]',
        (b) => (b as HTMLInputElement).disabled,
      );
      anota(
        `${nombre} al final: casilla desactivada=${casilla}, «Acepto» desactivado=${desactivado} (sigue cerrado hasta marcarla)`,
      );
      await p.check('[data-test="contrato-casilla"]');
      const tras = await p.$eval(
        '[data-test="contrato-aceptar"]',
        (b) => (b as HTMLButtonElement).disabled,
      );
      anota(`${nombre} · y marcada la casilla: «Acepto» desactivado=${tras}`);
      await foto(p, `02-contrato-al-final-${nombre}`);
      await fotoDelPliegue(p, `02-contrato-al-final-pliegue-${nombre}`);
    }

    // ══ 5 · «Residentes», no «pacientes» ══════════════════════════
    console.log("\n5 · la palabra del centro");
    // Se parte en dos a propósito: la PROSA de la pantalla (que este
    // bloque cambia) y el TEXTO LEGAL del recuadro (que no se toca aquí —
    // cambiarlo es una versión nueva del contrato y otra aceptación).
    const prosa = await escritorio.evaluate(() => {
      const todo = document.body.textContent ?? "";
      const legal =
        (document.querySelector('[data-test="contrato-texto"]') as HTMLElement)
          ?.textContent ?? "";
      return { todo: todo.replace(legal, ""), legal };
    });
    anota(
      `la prosa de la pantalla: «residentes»=${prosa.todo.includes("de tus residentes")}, «paciente»=${/paciente/i.test(prosa.todo)}`,
    );
    anota(
      `el texto legal del recuadro (versionado, NO se toca aquí) dice «paciente» ${(prosa.legal.match(/paciente/gi) ?? []).length} veces`,
    );

    // ══ 6 · Y acepta: la prueba lo guarda ═════════════════════════
    console.log("\n6 · acepta, y la fila lo cuenta");
    await escritorio.getByRole("button", { name: "Acepto" }).click();
    await escritorio.waitForURL(/\/admin\/residencia\/panel/, { timeout: 20_000 });
    await escritorio.goto(`${ADMIN}/admin/contrato-tratamiento`);
    await escritorio
      .getByText("El texto completo se mostró y se recorrió hasta el final")
      .waitFor({ timeout: 15_000 });
    await foto(escritorio, "03-aceptado-la-prueba-lo-cuenta-escritorio");
    anota(
      "y después de aceptar, el historial dice «el texto completo se mostró y se recorrió hasta el final»",
    );

    writeFileSync(`${SALIDA}MEDIDO.md`, `${medido.map((l) => `- ${l}`).join("\n")}\n`);
    console.log(`\nFotos y medidas en ${SALIDA}`);
  } finally {
    await navegador.close();
  }
}

await main();
