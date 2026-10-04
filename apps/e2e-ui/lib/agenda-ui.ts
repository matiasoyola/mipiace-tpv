// Cómo se maneja la rejilla de la agenda desde el banco.
//
// LA GEOMETRÍA DE LA REJILLA, que es lo único que no se puede pedir por su
// nombre. Una columna de profesional es un `div` con `data-columna=<userId>`
// y su `onClick` traduce la Y del dedo a minutos:
//
//     props.onSlot(dayStartMin + y / PX_PER_MIN)        AgendaPage.tsx:1480-1484
//
// con `PX_PER_MIN = 1.1` y `dayStartMin` = la apertura del centro redondeada
// hacia abajo a la hora, con 30 minutos de margen
// (`visibleRange`, AgendaPage.tsx:144-155). Para el centro del banco
// (09:00–20:00) eso son las 08:00 en punto.
//
// Por eso `pulsarFranja` COMPRUEBA la hora que abrió el panel en vez de
// fiarse del cálculo: si un día el margen de la rejilla cambia, el banco se
// pone rojo diciendo qué hora salió, no reserva a las 10:30 creyendo que son
// las 10:00.

import { expect, type Page } from "@playwright/test";

/** Píxeles por minuto de la rejilla (`AgendaPage.tsx:90`). */
const PX_POR_MIN = 1.1;

/** El minuto en que empieza a pintarse la rejilla del centro del banco:
 *  09:00 − 30 min de margen, redondeado hacia abajo a la hora = 08:00. */
const REJILLA_EMPIEZA_MIN = 8 * 60;

/**
 * Dos minutos DENTRO de la franja, no en su borde.
 *
 * Costó una pasada: pedir las 10:15 con la Y exacta del borde
 * (`(615−480)·1,1 = 148,5 px`) abría el alta a las 10:00. La Y fraccionaria
 * se redondea al pulsar, 148 px vuelven a ser 614,5 minutos, y
 * `openSlotFirst` redondea HACIA ABAJO a la retícula de 15 → 10:00. Medio
 * píxel de menos y la cita se va media hora atrás sin decir nada.
 */
const DENTRO_DE_LA_FRANJA_MIN = 2;

export function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

export function hhmmDe(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Suma minutos a una hora de pared. */
export function masMinutos(hhmm: string, minutos: number): string {
  return hhmmDe(minutosDe(hhmm) + minutos);
}

export function panel(page: Page) {
  return {
    cliente: page.getByRole("button", { name: /Buscar o crear cliente…|^$/ }),
    buscarHueco: page.locator('[data-accion="buscar-hueco"]'),
    motivoHueco: page.locator('[data-motivo="buscar-hueco"]'),
    reservar: page.locator('[data-accion="reservar"]'),
    motivoReservar: page.locator('[data-motivo="reservar"]'),
    reservarYCobrar: page.locator('[data-accion="reservar-y-cobrar"]'),
  };
}

/**
 * Lleva la agenda a un día concreto (el selector de la cabecera).
 *
 * Y lo ASIENTA, que es lo que costó una pasada: si se teclea la fecha
 * mientras la agenda todavía está cargando el día, React vuelve a pintar con
 * su `date` anterior y el campo revierte a hoy. El `toHaveValue` llegaba a
 * pasar en la ventana de antes de la reversión, y el test seguía — con la
 * agenda en OTRO día. El síntoma era absurdo: una rejilla sin ninguna cita y
 * un fallo que decía «no encuentro la tarjeta de las 09:00».
 *
 * Así que se espera a que la rejilla esté montada, se teclea, y se comprueba
 * que la fecha SIGUE puesta un momento después.
 */
export async function irAlDia(page: Page, fecha: string): Promise<void> {
  const campo = page.locator("[data-ir-a-dia]");
  await expect(campo).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-columna]").first()).toBeVisible({
    timeout: 30_000,
  });
  for (let intento = 1; intento <= 4; intento++) {
    await campo.fill(fecha);
    await expect(campo).toHaveValue(fecha);
    await page.waitForTimeout(400);
    if ((await campo.inputValue()) === fecha) return;
  }
  throw new Error(
    `El selector de día no se queda en ${fecha}: la agenda lo revierte.`,
  );
}

/**
 * El toast de la agenda. NO tiene gancho propio (`AgendaPage.tsx:1183`), así
 * que hay que localizarlo por su sitio en la pantalla. Es la única excepción
 * a «nunca por clase de Tailwind» en todo el banco, y va con su hallazgo ⚪:
 * el aviso que la cajera lee delante de la clienta es justo el que ninguna
 * prueba puede pedir por su nombre.
 */
function toast(page: Page) {
  return page.locator('div[class*="bottom-4"][class*="z-50"]');
}

/**
 * Pulsa una franja concreta de la columna de una profesional, que es lo que
 * fija QUIÉN atiende (`openSlotFirst`). Comprueba que el panel abrió a esa
 * hora: ver el comentario de la cabecera.
 *
 * Si la agenda contesta con un aviso en vez de abrir el panel, falla
 * diciendo QUÉ avisó — si no, el fallo es «no encuentro la hora 10:15» y no
 * dice nada.
 */
export async function pulsarFranja(
  page: Page,
  staffUserId: string,
  hhmm: string,
): Promise<void> {
  const columna = page.locator(`[data-columna="${staffUserId}"]`);
  await expect(columna).toBeVisible();
  const y =
    (minutosDe(hhmm) - REJILLA_EMPIEZA_MIN + DENTRO_DE_LA_FRANJA_MIN) *
    PX_POR_MIN;
  await columna.click({ position: { x: 20, y } });
  const cabecera = page.getByRole("heading", { name: "Nueva cita" });
  try {
    await expect(cabecera).toBeVisible({ timeout: 8_000 });
  } catch (err) {
    const aviso = (await toast(page).first().textContent().catch(() => null))?.trim();
    throw new Error(
      aviso
        ? `La agenda no abrió el alta a las ${hhmm}: «${aviso}»`
        : `La agenda no abrió el alta a las ${hhmm} y no dijo por qué ` +
          "(¿una cita encima de la franja interceptó el toque?)",
    );
  }
  await expect(page.getByText(hhmm, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Pulsa una franja esperando que la agenda la RECHACE con un aviso. Comprueba
 * el texto que ve la cajera y que el panel de alta no se abre.
 */
export async function pulsarFranjaRechazada(
  page: Page,
  staffUserId: string,
  hhmm: string,
  patron: RegExp,
): Promise<string> {
  const columna = page.locator(`[data-columna="${staffUserId}"]`);
  await expect(columna).toBeVisible();
  const y =
    (minutosDe(hhmm) - REJILLA_EMPIEZA_MIN + DENTRO_DE_LA_FRANJA_MIN) *
    PX_POR_MIN;
  await columna.click({ position: { x: 20, y } });
  await expect(page.getByText(patron).first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Nueva cita" }),
  ).toHaveCount(0);
  return (await toast(page).first().textContent())?.trim() ?? "";
}

/**
 * Elige una clienta que ya existe.
 *
 * `consulta` es lo que se teclea en el buscador y `nombreCompleto` el
 * resultado que hay que tocar — son distintos a propósito: el buscador casa
 * por trozos («Carmen» saca también a «Mari Carmen») pero el nombre completo
 * no siempre es buscable tal cual. Elegir «.first()» de una búsqueda por
 * trozos cuelga la cita de la clienta equivocada SIN que nada falle, y eso
 * costó una pasada entera.
 */
export async function elegirClienta(
  page: Page,
  consulta: string,
  nombreCompleto = consulta,
): Promise<void> {
  const nombre = nombreCompleto;
  await page.getByRole("button", { name: "Buscar o crear cliente…" }).click();
  await page
    .getByPlaceholder("Buscar por nombre, teléfono o email…")
    .fill(consulta);
  // `nombre` tiene que ser el NOMBRE COMPLETO tal como lo pinta el selector:
  // buscar «Carmen» casa también con «Mari Carmen», y la cita se cuelga de la
  // clienta equivocada sin que nada falle. Costó una pasada.
  const resultado = page
    .locator('[data-testid="client-picker-result"]')
    .filter({ has: page.getByText(nombre, { exact: true }) })
    .first();
  await expect(resultado).toBeVisible({ timeout: 15_000 });
  await resultado.click();
}

/** Crea una clienta nueva SÓLO con el nombre de pila, como la apunta una
 *  peluquera. El apellido se queda vacío a propósito. */
export async function crearClienta(page: Page, nombre: string): Promise<void> {
  await page.getByRole("button", { name: "Buscar o crear cliente…" }).click();
  await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
  await page.locator("#client-nombre").fill(nombre);
  // `exact`: sin él, «Buscar o crear cliente…» también casa.
  await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
}

/** Marca un servicio en el panel de alta, por su nombre exacto. */
export async function elegirServicio(page: Page, nombre: string): Promise<void> {
  const boton = page
    .getByRole("button")
    .filter({ hasText: new RegExp(`^${nombre}\\s*\\d+ min$`) })
    .first();
  await expect(boton).toBeVisible({ timeout: 15_000 });
  await boton.click();
}

/** Reserva y espera a que el panel se cierre. */
export async function reservar(page: Page): Promise<void> {
  const p = panel(page);
  await expect(p.reservar).toBeEnabled({ timeout: 15_000 });
  await p.reservar.click();
  await expect(
    page.getByRole("heading", { name: "Nueva cita" }),
  ).toHaveCount(0, { timeout: 20_000 });
}
