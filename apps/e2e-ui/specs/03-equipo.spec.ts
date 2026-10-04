// Capítulo 3 · El equipo: quién es cada una, qué sabe hacer y cuándo trabaja.
//
// Tres cosas en la misma pantalla, y las tres hacen falta para que la agenda
// ofrezca un hueco: el perfil (con su color, que es lo que distingue sus
// citas en la rejilla), la matriz de servicios (el motor sólo propone a quien
// sabe hacerlo) y el turno (la ventana de la profesional, que luego se corta
// con el horario del centro).
//
// Las tres se dan de alta EN ESTE ORDEN —Marta, Lucía, Irene— y SIN tocar el
// selector de color: la pantalla propone sola el primer color libre de la
// paleta, y el banco comprueba que salen tres distintos. Ese fallo ya existió
// (las tres nacían en el mismo coral y el tinte de la agenda dejaba de
// distinguir de quién era cada cita); esto es lo que impide que vuelva.
//
// El tinte se queda SIN NADIE a propósito: es el aviso que provoca el
// capítulo 5.

import { expect, test, type Page } from "@playwright/test";

import { ADMIN } from "../playwright.config.js";
import { cerrarBd, perfiles, servicio, skills, turnos } from "../lib/bd.js";
import { entrarAdmin } from "../lib/entrar.js";
import { PANEL } from "../lib/pantallas.js";
import { esconder, portada, rotulo } from "../lib/rotulo.js";
import { PROFESIONALES, SERVICIOS } from "../seed/escenario.js";

const CAP = "Capítulo 3 · Equipo";

/** Hoy, para el «válido desde» de los turnos. Que caiga en ayer por el huso
 *  es inofensivo: un turno vigente desde antes cubre igual la semana del
 *  vídeo, que empieza el lunes que viene. */
const HOY = new Date().toISOString().slice(0, 10);

/** El turno de cada una. Días en el código del selector (L M X J V S D). */
const TURNOS: Record<string, { dias: string[]; desde: string; hasta: string }> = {
  Marta: { dias: ["M", "X", "J", "V", "S"], desde: "09:00", hasta: "20:00" },
  Lucía: { dias: ["M", "X", "J", "V", "S"], desde: "10:00", hasta: "20:00" },
  // Irene hace mañanas y no trabaja viernes ni sábado: así el banco tiene
  // una profesional que NO está disponible a cualquier hora.
  Irene: { dias: ["M", "X", "J"], desde: "09:00", hasta: "15:00" },
};

/** Qué sabe hacer cada una, por alias. El tinte no lo sabe nadie todavía. */
const SABEN: Record<string, string[]> = {
  Marta: ["Corte", "Lavar y peinar", "Mechas"],
  Lucía: ["Corte", "Lavar y peinar"],
  Irene: ["Corte", "Lavar y peinar", "Barba"],
};

/** Abre la fila de una profesional por su email (el nombre todavía puede
 *  ser la local-part: antes del perfil no hay `displayName`). */
function fila(page: Page, email: string) {
  return page.getByRole("button").filter({ hasText: email });
}

/** El checkbox de un servicio, por su nombre EXACTO: «Tinte · aplicación» y
 *  «Tinte · lavado y peinado» comparten prefijo. */
function casillaDeServicio(page: Page, nombre: string) {
  return page
    .locator("label")
    .filter({ hasText: new RegExp(`^\\s*${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) })
    .getByRole("checkbox");
}

test.use(PANEL);

test.afterAll(async () => {
  await cerrarBd();
});

test("las tres profesionales, su color, lo que saben y su turno", async ({
  page,
}) => {
  await entrarAdmin(page);
  await page.goto(`${ADMIN}/admin/staff`);
  await portada(page, "El equipo", CAP);

  // Antes: las tres son usuarias del TPV, ninguna es profesional de la agenda.
  await expect(page.getByText("Sin perfil")).toHaveCount(PROFESIONALES.length + 1);
  await rotulo(
    page,
    "Marta, Lucía e Irene ya entran en el TPV, pero todavía no son " +
      "profesionales de la agenda.",
    CAP,
  );
  await esconder(page);

  for (const p of PROFESIONALES) {
    const cabecera = fila(page, p.email);
    await cabecera.click();

    // El alta: no se toca el color. La pantalla propone el primer libre.
    await rotulo(page, `${p.alias}, de alta. El color lo propone la pantalla.`, CAP);
    await esconder(page);
    await page
      .getByRole("button", { name: "Dar de alta como profesional" })
      .click();
    await expect(
      page.getByRole("button", { name: "Guardar perfil" }),
    ).toBeVisible({ timeout: 20_000 });

    // Lo que sabe hacer.
    for (const nombre of SABEN[p.alias]!) {
      await casillaDeServicio(page, nombre).check();
    }
    await page.getByRole("button", { name: "Guardar servicios" }).click();

    // Su turno.
    const t = TURNOS[p.alias]!;
    await page.getByRole("button", { name: "+ Añadir turno" }).click();
    for (const dia of t.dias) {
      await page.getByRole("button", { name: dia, exact: true }).click();
    }
    // Por posición y no por etiqueta: el `Field` del formulario de turnos
    // pinta un `<label>` SIN `htmlFor` y los `<input>` SIN `id`
    // (`StaffPage.tsx:733-747`), así que la etiqueta no está asociada a su
    // campo — ni para `getByLabel` ni para un lector de pantalla. Va como
    // hallazgo ⚪. En el formulario abierto hay exactamente dos horas:
    // «Desde» y «Hasta».
    const horas = page.locator('input[type="time"]');
    await horas.nth(0).fill(t.desde);
    await horas.nth(1).fill(t.hasta);
    // «Válido desde» nace VACÍO y es obligatorio (`StaffPage.tsx:611`): sin
    // fecha, el alta del turno no sale de la pantalla. Se pone hoy.
    await page.locator('input[type="date"]').nth(0).fill(HOY);
    await page.getByRole("button", { name: "Crear turno" }).click();
    await expect(
      page.getByRole("button", { name: "Crear turno" }),
    ).toHaveCount(0, { timeout: 20_000 });

    // Se cierra la fila antes de abrir la siguiente: la pantalla deja
    // abiertas todas las que se pulsen, y con dos abiertas hay dos botones
    // «Guardar perfil» en pantalla.
    await cabecera.click();
  }

  await rotulo(page, "Las tres, cada una con su color.", CAP);
  await esconder(page);

  // En pantalla: ninguna sin perfil (salvo la dueña, que no atiende).
  await expect(page.getByText("Sin perfil")).toHaveCount(1);

  // En la BD: tres perfiles, y tres colores DISTINTOS sin haber elegido
  // ninguno — que es lo que de verdad protege la rejilla.
  const filas = await perfiles();
  expect(filas).toHaveLength(3);
  for (const p of PROFESIONALES) {
    const perfil = filas.find((f) => f.userId === p.id);
    expect(perfil, `falta el perfil de ${p.alias}`).toBeTruthy();
    expect(perfil!.displayName).toBe(p.alias);
    expect(perfil!.active).toBe(true);
    expect(perfil!.color?.toLowerCase()).toBe(p.colorEsperado);
  }
  const colores = new Set(filas.map((f) => f.color?.toLowerCase()));
  expect(colores.size).toBe(3);

  // La matriz: cada una con lo suyo, y el tinte sin nadie.
  const matriz = await skills();
  for (const p of PROFESIONALES) {
    const suyos = matriz.filter((m) => m.userId === p.id);
    expect(suyos).toHaveLength(SABEN[p.alias]!.length);
    for (const nombre of SABEN[p.alias]!) {
      const sku = SERVICIOS.find((s) => s.nombre === nombre)!.sku;
      const prod = await servicio(sku);
      expect(suyos.some((m) => m.serviceId === prod.id)).toBe(true);
    }
  }
  for (const sku of ["SVC-TINTE-APLICA", "SVC-TINTE-LAVA"]) {
    const prod = await servicio(sku);
    expect(matriz.filter((m) => m.serviceId === prod.id)).toHaveLength(0);
  }

  // Los turnos, con su rrule y sus horas de pared.
  const ts = await turnos();
  expect(ts).toHaveLength(3);
  for (const p of PROFESIONALES) {
    const t = ts.find((x) => x.userId === p.id);
    expect(t, `falta el turno de ${p.alias}`).toBeTruthy();
    expect(t!.startTime).toBe(TURNOS[p.alias]!.desde);
    expect(t!.endTime).toBe(TURNOS[p.alias]!.hasta);
    expect(t!.rrule).toContain("FREQ=WEEKLY");
  }
});
