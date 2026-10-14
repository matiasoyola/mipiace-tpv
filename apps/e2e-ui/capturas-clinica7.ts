// clinica-7 · EL BUCLE VISUAL. Las cinco pantallas del bloque, a tres
// anchos, en el producto de verdad.
//
// No es un test: es una pasada con la cámara. Lo que busca son los fallos
// que ninguna suite ve — un botón tapado, un texto que no cabe, una tarjeta
// bajo el pliegue, un objetivo táctil de 30 px.
//
// Las cinco que el prompt pide:
//
//   1. la pantalla de ACEPTACIÓN (la dueña, sin contrato)
//   2. el AVISO al que no es la dueña (la sanitaria, sin contrato)
//   3. la BANDA de solo lectura sobre la historia (contrato revocado)
//   4. la SECCIÓN del contrato en el panel (contrato vigente)
//   5. el ENVÍO del informe con la clave en pantalla (contrato vigente)
//
// Los tres estados del contrato se mueven EN LA BASE y no en el front: lo
// que la cámara ve es lo que el producto hace con esos datos. Y después de
// cada cambio hay que esperar el TTL de la caché de `estadoDelTenant`
// (30 s): la API no vuelve a preguntar antes.

import { chromium, type Browser, type Page } from "@playwright/test";
import {
  elegirClienta,
  elegirServicio,
  irAlDia,
  pulsarFranja,
  reservar,
} from "./lib/agenda-ui.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@mipiacetpv/db";

const TPV = "http://localhost:5274";
const ADMIN = "http://localhost:5273";
const SALIDA =
  "/Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv-clinica-7/docs/qa/2026-10-14-clinica-7";

const DEVICE_TOKEN = "banco-clinica-dispositivo-0001";
const PIN = "2468";
const PODOLOGA = "lucia@clinicademo.local";   // dueña Y sanitaria
const SANITARIA = "ana@clinicademo.local";    // sanitaria que NO es la dueña
const PANEL = { email: "lucia@clinicademo.local", password: "BancoClinica2026!" };
const TENANT = "33333333-3333-4333-8333-333333333331";
const DUENA_ID = "33333333-3333-4333-8333-333333333341";
const ANA_ID = "33333333-3333-4333-8333-333333333343";
const PACIENTE_ID = "33333333-3333-4333-8333-333333333351";
const PACIENTE_NOMBRE = "Carmen Rodríguez López";
const QUIROPODIA = "Quiropodia";
/** La cita de hoy con Ana: es la puerta de la sanitaria a la historia.
 *  Ana NO tiene caja —entra y cae en su agenda, sin rejilla de venta— así
 *  que a su historia se llega por la tarjeta de una cita, no por Clientes. */
const HOY = new Date().toISOString().slice(0, 10);
// Tarde, no mañana: la agenda rechaza dar cita a una hora que ya ha
// pasado («Esa hora ya ha pasado. El primer hueco es a las 17:15») y el
// bucle se corre a la hora que sea.
const HORA = "18:30";
/** La de la dueña, para que ella también llegue a la historia POR LA
 *  AGENDA — que es a pantalla completa, como se usa. */
const HORA_DUENA = "19:00";
/** La huella CANÓNICA de la v1 (la que fija el test del paquete). Se usa
 *  la de verdad y no una de relleno para que la captura del panel enseñe
 *  la huella que verá Rosario, no sesenta y cuatro aes. */
const SHA_V1 =
  "7baee64a600f5a9de15038758b7118f99185174acda455df9426b35126bd0d8a";
const TTL_CACHE_MS = 32_000;

const ANCHOS = [
  { nombre: "1366", width: 1366, height: 900 },
  { nombre: "1024", width: 1024, height: 768 },
  { nombre: "390", width: 390, height: 844 },
];

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL! } },
});

const hallazgos: string[] = [];

/** El mínimo táctil de la casa: 48 px. Lo mide SOBRE LA PÁGINA. */
async function medirToques(page: Page, donde: string): Promise<void> {
  const pequenos = await page.evaluate(() => {
    const malos: Array<{ texto: string; w: number; h: number }> = [];
    for (const el of document.querySelectorAll(
      "button, a[href], input, [role=button], [role=tab]",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 || r.width < 44) {
        malos.push({
          texto: (el.textContent ?? el.getAttribute("aria-label") ?? "?")
            .trim()
            .slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return malos;
  });
  if (pequenos.length > 0) {
    hallazgos.push(
      `${donde}: ${pequenos.length} objetivo(s) por debajo de 44 px → ${pequenos
        .map((p) => `«${p.texto}» ${p.w}x${p.h}`)
        .join(" · ")}`,
    );
  }
}

/** Scroll horizontal: en una tablet es la pantalla rota. */
async function medirScrollH(page: Page, donde: string): Promise<void> {
  const w = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (w.scroll > w.client + 1) {
    hallazgos.push(
      `${donde}: SCROLL HORIZONTAL (${w.scroll} px de contenido en ${w.client} px de ancho)`,
    );
  }
}

async function foto(page: Page, nombre: string, ancho: string): Promise<void> {
  await page.screenshot({
    path: `${SALIDA}/${nombre}-${ancho}.png`,
    fullPage: true,
  });
  await medirToques(page, `${nombre} @${ancho}`);
  await medirScrollH(page, `${nombre} @${ancho}`);
  console.log(`  · ${nombre}-${ancho}.png`);
}

function vigilar(page: Page, donde: string): void {
  page.on("pageerror", (e) =>
    hallazgos.push(`${donde}: ERROR DE PÁGINA — ${e.message}`),
  );
  page.on("console", (m) => {
    if (m.type() === "error") {
      hallazgos.push(`${donde}: consola — ${m.text().slice(0, 160)}`);
    }
  });
}

async function entrarTpv(page: Page, email: string): Promise<void> {
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    ["mipiacetpv-device-token", DEVICE_TOKEN],
  );
  await page.goto(TPV);
  const campo = page.locator("#cashierEmail");
  await campo.waitFor({ state: "visible", timeout: 30_000 });
  await campo.fill(email);
  for (const d of PIN) {
    await page.getByRole("button", { name: d, exact: true }).click();
  }
  await page.getByRole("button", { name: /^Entrar/ }).click();
  await campo.waitFor({ state: "hidden", timeout: 30_000 });
}

/**
 * Deja el TPV en la rejilla de venta, pase lo que pase detrás del login.
 * El bucle (y no tres `if`) es el hallazgo de `lib/entrar.ts`: el resumen
 * del turno llega por red y los tres `isVisible()` preguntan antes.
 */
async function hastaLaRejilla(page: Page): Promise<void> {
  const venta = page.getByRole("button", { name: "Clientes" });
  for (let i = 0; i < 60; i++) {
    if (await venta.isVisible().catch(() => false)) return;
    for (const nombre of [/^Confirmar/, /Reanudar turno/, /^Abrir turno/]) {
      const b = page.getByRole("button", { name: nombre }).first();
      if (await b.isVisible().catch(() => false)) {
        if (/Abrir turno/.test(nombre.source)) {
          await page
            .getByRole("button", { name: "100,00 €", exact: true })
            .click()
            .catch(() => {});
        }
        await b.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error("el TPV no llegó a la rejilla de venta");
}

/** Abre la pestaña Historia de Carmen desde la pantalla Clientes. */
async function abrirHistoria(page: Page): Promise<void> {
  await hastaLaRejilla(page);
  await page.getByRole("button", { name: "Clientes" }).click();
  // El buscador DE LA PANTALLA CLIENTES, por su placeholder: el primer
  // `input[type=search]` del documento es el de productos de la venta, que
  // sigue montada detrás del overlay. Costó una pasada.
  const buscador = page.getByPlaceholder("Buscar por nombre, teléfono o email…");
  await buscador.waitFor({ state: "visible", timeout: 30_000 });
  await buscador.fill("Carmen");
  const ficha = page
    .getByRole("button")
    .filter({ hasText: "Carmen Rodríguez López" })
    .first();
  await ficha.waitFor({ state: "visible", timeout: 30_000 });
  await ficha.click();
  const historia = page.getByRole("button", { name: "Historia", exact: true });
  await historia.waitFor({ state: "visible", timeout: 30_000 });
  await historia.click();
  await page.waitForTimeout(2500);
}

/**
 * Deja a Ana con una cita de Carmen hoy a las 11:00, si no la tiene ya.
 *
 * Se da POR LA UI de la dueña y no por SQL: una cita son tres filas
 * (`appointments`, su item y su asignación) con un `tstzrange` y el
 * anti-solape del motor, y sembrarla a mano es inventarse un estado que la
 * aplicación no produce. La dueña la da como la daría Rosario.
 */
async function citasDeHoy(
  ctx: import("@playwright/test").BrowserContext,
): Promise<void> {
  const falta = async (staffUserId: string) => {
    const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM appointments a
         JOIN appointment_assignments s ON s.appointment_id = a.id
        WHERE a.tenant_id = '${TENANT}' AND a.client_id = '${PACIENTE_ID}'
          AND s.staff_user_id = '${staffUserId}'
          AND lower(a.timeslot)::date = '${HOY}'::date`,
    );
    return Number(r[0]!.n) === 0;
  };
  const pendientes: Array<[string, string]> = [];
  if (await falta(ANA_ID)) pendientes.push([ANA_ID, HORA]);
  if (await falta(DUENA_ID)) pendientes.push([DUENA_ID, HORA_DUENA]);
  if (pendientes.length === 0) {
    console.log("  · las citas de hoy ya están");
    return;
  }
  const page = await ctx.newPage();
  try {
    vigilar(page, "citas de hoy");
    await entrarTpv(page, PODOLOGA);
    await hastaLaRejilla(page);
    await page.getByRole("button", { name: "Agenda" }).first().click();
    await irAlDia(page, HOY);
    for (const [staffUserId, hora] of pendientes) {
      await pulsarFranja(page, staffUserId, hora);
      await elegirClienta(page, "Carmen", PACIENTE_NOMBRE);
      await elegirServicio(page, QUIROPODIA);
      await reservar(page);
      console.log(`  · cita dada a las ${hora}`);
    }
  } catch (err) {
    hallazgos.push(
      `no se pudieron dar las citas del banco: ${(err as Error).message.split("\n")[0]}`,
    );
  } finally {
    await page.close();
  }
}

/** La historia DESDE LA AGENDA: tarjeta de la cita → «Historia del
 *  paciente». Es el camino de quien no tiene caja. */
async function abrirHistoriaDesdeAgenda(
  page: Page,
  staffUserId: string,
  hora: string,
): Promise<void> {
  await page.getByRole("button", { name: "Hoy" }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await irAlDia(page, HOY);
  const tarjeta = page
    .locator(`[data-columna="${staffUserId}"] [data-cita]`)
    .filter({ hasText: hora })
    .first();
  await tarjeta.waitFor({ state: "visible", timeout: 20_000 });
  await tarjeta.click();
  const boton = page.getByRole("button", { name: "Historia del paciente" });
  await boton.waitFor({ state: "visible", timeout: 20_000 });
  await boton.click();
  await page.waitForTimeout(2500);
}

// ── Los tres estados del contrato, movidos a mano ───────────────────
//
// `DISABLE TRIGGER` porque la tabla es de solo inserción: el banco necesita
// volver al estado «sin contrato», y en producción eso no se puede hacer
// —que es justo lo que el trigger garantiza.
async function sinContrato(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE clinical_processor_agreements DISABLE TRIGGER "clinical_processor_agreements_append_only"`,
  );
  // Las revocaciones primero: la FK a la fila que revocan es RESTRICT y se
  // comprueba fila a fila, así que un DELETE de todo a la vez falla.
  await prisma.$executeRawUnsafe(
    `DELETE FROM clinical_processor_agreements
      WHERE tenant_id = '${TENANT}' AND revokes_agreement_id IS NOT NULL`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM clinical_processor_agreements WHERE tenant_id = '${TENANT}'`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE clinical_processor_agreements ENABLE TRIGGER "clinical_processor_agreements_append_only"`,
  );
}

async function contratoAceptado(): Promise<void> {
  await sinContrato();
  await prisma.$executeRawUnsafe(
    `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id)
     VALUES (gen_random_uuid(), '${TENANT}', 1, '${SHA_V1}', '${DUENA_ID}')`,
  );
}

async function contratoRevocado(): Promise<void> {
  await contratoAceptado();
  const filas = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM clinical_processor_agreements
      WHERE tenant_id = '${TENANT}' AND revokes_agreement_id IS NULL`,
  );
  for (const f of filas) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO clinical_processor_agreements (id, tenant_id, version, text_sha256, user_id, revokes_agreement_id)
       VALUES (gen_random_uuid(), '${TENANT}', 1, '${SHA_V1}', '${DUENA_ID}', '${f.id}')`,
    );
  }
}

/** La caché de `estadoDelTenant` dura 30 s y no hay forma de vaciarla
 *  desde fuera del proceso. Se espera. */
async function esperarCache(page: Page, que: string): Promise<void> {
  console.log(`  (esperando el TTL de la caché — ${que})`);
  await page.waitForTimeout(TTL_CACHE_MS);
}

async function main(): Promise<void> {
  mkdirSync(SALIDA, { recursive: true });
  const navegador: Browser = await chromium.launch();

  // La cita de Ana, una sola vez y con el contrato VIGENTE: dar una cita
  // con el contrato sin aceptar es otra pantalla (la nota libre desaparece)
  // y lo que hace falta aquí es la cita, no esa prueba.
  console.log("\n── preparando la cita de Ana ──");
  await contratoAceptado();
  {
    const ctx = await navegador.newContext({
      viewport: { width: 1366, height: 900 },
      locale: "es-ES",
    });
    const p = await ctx.newPage();
    await esperarCache(p, "vigente");
    await p.close();
    await citasDeHoy(ctx);
    await ctx.close();
  }

  for (const ancho of ANCHOS) {
    console.log(`\n── ${ancho.width}x${ancho.height} ──`);
    const ctx = await navegador.newContext({
      viewport: { width: ancho.width, height: ancho.height },
      deviceScaleFactor: 1,
      locale: "es-ES",
    });

    // ── 1 · la pantalla de ACEPTACIÓN (la dueña, sin contrato) ─────
    await sinContrato();
    const p1 = await ctx.newPage();
    vigilar(p1, `aceptacion @${ancho.nombre}`);
    await esperarCache(p1, "sin contrato");
    await entrarTpv(p1, PODOLOGA);
    await hastaLaRejilla(p1);
    await p1.getByRole("button", { name: "Agenda" }).first().click();
    await abrirHistoriaDesdeAgenda(p1, DUENA_ID, HORA_DUENA);
    await foto(p1, "1-aceptacion", ancho.nombre);
    await p1.close();

    // Y LA MISMA PANTALLA DESDE LA FICHA DEL CLIENTE, que es el otro sitio
    // desde el que se abre la historia. En pestaña aparte —la historia de
    // la agenda es un overlay a pantalla completa que tapa «Clientes»— y
    // como captura aparte porque ahí se pinta dentro de la tarjeta estrecha
    // del cliente (448 px): es el hallazgo del bucle.
    const p1b = await ctx.newPage();
    vigilar(p1b, `historia en la ficha @${ancho.nombre}`);
    await entrarTpv(p1b, PODOLOGA);
    await abrirHistoria(p1b);
    await foto(p1b, "6-historia-en-la-ficha", ancho.nombre);
    await p1b.close();

    // ── 2 · el AVISO al que NO es la dueña ─────────────────────────
    //
    // Ana, no Marta: la recepción no tiene la marca de sanitaria y la
    // pestaña «Historia» no existe para ella. El aviso de «esto lo acepta
    // la dueña» es para la sanitaria que SÍ entra en la historia.
    const p2 = await ctx.newPage();
    vigilar(p2, `aviso @${ancho.nombre}`);
    await entrarTpv(p2, SANITARIA);
    // Ana cae DIRECTA en su agenda: ni turno, ni rejilla de venta.
    await abrirHistoriaDesdeAgenda(p2, ANA_ID, HORA);
    await foto(p2, "2-aviso-no-duena", ancho.nombre);
    await p2.close();

    // ── 3 · la BANDA de solo lectura ───────────────────────────────
    await contratoRevocado();
    const p3 = await ctx.newPage();
    vigilar(p3, `banda @${ancho.nombre}`);
    await esperarCache(p3, "revocado");
    await entrarTpv(p3, PODOLOGA);
    await hastaLaRejilla(p3);
    await p3.getByRole("button", { name: "Agenda" }).first().click();
    await abrirHistoriaDesdeAgenda(p3, DUENA_ID, HORA_DUENA);
    await foto(p3, "3-banda-solo-lectura", ancho.nombre);
    await p3.close();

    // ── 4 · la SECCIÓN del contrato, en el panel ───────────────────
    await contratoAceptado();
    const p4 = await ctx.newPage();
    vigilar(p4, `panel @${ancho.nombre}`);
    await esperarCache(p4, "vigente");
    await p4.goto(`${ADMIN}/login`);
    await p4.locator("#email").fill(PANEL.email);
    await p4.locator("#password").fill(PANEL.password);
    await p4.getByRole("button", { name: /^Entrar/ }).click();
    await p4.waitForTimeout(3000);
    await p4.goto(`${ADMIN}/admin/contrato-tratamiento`);
    await p4.waitForTimeout(2500);
    await foto(p4, "4-seccion-panel", ancho.nombre);
    await p4.close();

    // ── 5 · el ENVÍO del informe, con la clave ─────────────────────
    //
    // La clave se enseña UNA vez y sólo después de enviar, así que hay que
    // enviarlo de verdad. El correo no sale de la máquina: lo recoge el
    // buzón en fichero del entorno de desarrollo.
    const p5 = await ctx.newPage();
    vigilar(p5, `informe @${ancho.nombre}`);
    await entrarTpv(p5, PODOLOGA);
    await hastaLaRejilla(p5);
    await p5.getByRole("button", { name: "Agenda" }).first().click();
    await abrirHistoriaDesdeAgenda(p5, DUENA_ID, HORA_DUENA);
    await p5.getByRole("tab", { name: "Informe" }).click();
    const enviar = p5.locator('[data-test="enviar-email"]');
    await enviar.waitFor({ state: "visible", timeout: 30_000 });
    await enviar.click();
    await p5.waitForTimeout(4000);
    await foto(p5, "5-informe-con-clave", ancho.nombre);
    await p5.close();

    await ctx.close();
  }

  await navegador.close();
  await prisma.$disconnect();

  const informe =
    hallazgos.length === 0 ? "Sin hallazgos." : hallazgos.map((h) => `· ${h}`).join("\n");
  console.log(`\n── HALLAZGOS ──\n${informe}`);
  writeFileSync(`${SALIDA}/hallazgos.txt`, `${informe}\n`);
}

main().catch(async (err) => {
  console.error(err);
  const informe = hallazgos.map((h) => `· ${h}`).join("\n");
  console.log(`\n── HALLAZGOS HASTA EL FALLO ──\n${informe}`);
  await prisma.$disconnect();
  process.exit(1);
});
