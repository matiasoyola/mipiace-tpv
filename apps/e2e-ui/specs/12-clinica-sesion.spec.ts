// Capítulo 12 · La sesión y el mapa del pie, por la interfaz real.
//
// Arranca donde acabó el 11: Carmen ya tiene su valoración VALIDADA, así que
// la puerta del primer tratamiento está abierta. El viaje que pide el prompt
// de clinica-3, de punta a punta y por las pantallas de verdad:
//
//   1. La podóloga abre la sesión desde la cita, toca una zona del mapa,
//      elige lesión y gravedad, marca los tratamientos y el dolor, y cierra.
//   2. **(dueña)** ve el ticket con sus líneas y cobra desde ahí mismo.
//   3. En la visita siguiente, **«Igual que la última vez» SUMA** lo de la
//      anterior a lo que ya hay marcado hoy.
//   4. **(sanitario sin caja)** cierra su sesión SIN VER UN IMPORTE…
//   5. …y la recepción la encuentra en «Por cobrar» y la cobra.
//
// Y las dos negativas que el bloque existe para sostener:
//   · cerrar dos veces no crea dos cobros;
//   · el sanitario sin caja no puede cobrar, ni por la pantalla ni por la
//     ruta.
//
// ── Por qué este capítulo tiene que ser con navegador ────────────────
//
// Porque lo que se prueba no es una ruta: es que las piezas se encuentran.
// La sesión se abre desde la tarjeta de una cita que pinta la agenda; el
// mapa es un SVG cuyas zonas tienen que caer donde está el pie; el pie de la
// sesión se calcula con la misma función pura que la API; y el cobro sale
// por `POST /agenda/appointments/:id/checkout`, que es el camino de
// B-reservas-5 sin tocar. Cada pieza tiene su test y ninguno ve si la cadena
// está unida.
//
// Es el mismo argumento que clinica-1 dejó escrito (§10b de su done): el bug
// de verdad del bloque lo encontró el banco por la interfaz, no la suite.
//
// ── Corre sobre SU PROPIO tenant ─────────────────────────────────────
//
// La clínica del banco (`seed/clinica-demo.ts`) es un tenant aparte de la
// peluquería. Los diez primeros capítulos siguen siendo la prueba de que
// **la clínica no se le nota a nadie más**.

import { expect, test, type Page } from "@playwright/test";

import { bd, cerrarBd } from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
import {
  elegirClienta,
  elegirServicio,
  irAlDia,
  pulsarFranja,
  reservar,
} from "../lib/agenda-ui.js";
import { AP11 } from "../lib/pantallas.js";
import {
  CLINICA,
  CLINICA_DEVICE_TOKEN,
  CLINICA_PIN,
  PACIENTE,
  PODOLOGA,
  RECEPCION,
  SANITARIA,
  TRATAMIENTOS,
} from "../seed/clinica-demo.js";

const CAP = "Capítulo 12 · La sesión y el mapa del pie";

const QUIROPODIA = TRATAMIENTOS[0];
const FRESADO = TRATAMIENTOS[1];
const VERRUGA = TRATAMIENTOS[2];

/** Pasado mañana y a los cuatro días: las dos visitas del capítulo, cada
 *  una en su día para que no choquen con la del capítulo 11 (mañana). */
function dia(masDias: number): { fecha: string; hora: string } {
  const d = new Date();
  d.setDate(d.getDate() + masDias);
  // Domingo no: el centro de la clínica abre de lunes a sábado.
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return { fecha: d.toISOString().slice(0, 10), hora: "11:00" };
}

const VISITA_1 = dia(2);
const VISITA_2 = dia(4);
const VISITA_3 = dia(6);

/**
 * El pie de la sesión, por su gancho.
 *
 * NO por texto: detrás del overlay sigue montada la pantalla de VENTA, con
 * sus tarjetas de producto y sus precios. Un `getByText("30,00 €")` casa con
 * el total del pie Y con la tarjeta de «Quiropodia», y Playwright lo canta
 * como «strict mode violation». Costó una pasada; es la misma lección que el
 * `data-pregunta` del capítulo 11.
 */
function pieDeSesion(page: Page) {
  return page.locator('[data-test="pie-de-sesion"]');
}

/** La pantalla de «Sesión cerrada», por su gancho y por lo mismo. */
function sesionCerrada(page: Page) {
  return page.locator('[data-test="sesion-cerrada"]');
}

/** El panel de cobros de la recepción, por su gancho y por lo mismo. */
function panelDeCobros(page: Page) {
  return page.locator('[data-test="panel-cobros"]');
}

/** Las sesiones cerradas de Carmen, lo más reciente primero. */
async function sesiones() {
  return bd().clinicalEntry.findMany({
    where: { clientId: PACIENTE.id, kind: "TREATMENT_SESSION" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      appointmentId: true,
      authorUserId: true,
      body: true,
      createdAt: true,
    },
  });
}

/**
 * Espera a que la clínica tenga `n` tickets y los devuelve.
 *
 * `expect.poll` y no un `toBeVisible` de pantalla: «Cobrar ahora» abre el
 * borrador por el camino de siempre, y lo que hay que esperar es el EFECTO
 * EN LA BASE. El aserto de pantalla que había antes
 * (`getByText(QUIROPODIA.name)`) casaba con la tarjeta de producto de la
 * venta, que está visible desde el primer instante — así que no esperaba
 * nada y el capítulo salía flojo una vez de cada tres.
 */
async function tickets(n: number): Promise<Awaited<ReturnType<typeof losTickets>>> {
  await expect
    .poll(async () => (await losTickets()).length, { timeout: 20_000 })
    .toBe(n);
  return losTickets();
}

/** Los tickets de la clínica, lo más antiguo primero. */
async function losTickets() {
  return bd().ticket.findMany({
    where: { tenantId: CLINICA.tenant },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      total: true,
      lines: { select: { nameSnapshot: true, unitPrice: true } },
    },
  });
}

/** La cita de Carmen de un día, por su hora. */
async function citaDe(fecha: string): Promise<string> {
  const filas = await bd().$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM appointments
      WHERE tenant_id = '${CLINICA.tenant}' AND client_id = '${PACIENTE.id}'
        AND lower(timeslot)::date = '${fecha}'::date`,
  );
  expect(filas).toHaveLength(1);
  return filas[0]!.id;
}

/**
 * Deja la agenda abierta, esté ya abierta o no.
 *
 * El `if` no es defensivo: después de `reservar()` la agenda SIGUE abierta,
 * y volver a pulsar «Agenda» es un «strict mode violation» de Playwright
 * —hay dos botones con ese nombre accesible, el de la venta de detrás y el
 * `title="Agenda"` de la propia pantalla— que se lee como «no encuentro el
 * botón». Costó una pasada.
 */
async function enLaAgenda(page: Page): Promise<void> {
  const rejilla = page.getByRole("button", { name: "Hoy" });
  if (await rejilla.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Agenda" }).first().click();
  await expect(rejilla).toBeVisible({ timeout: 25_000 });
}

/** Da una cita de un tratamiento a Carmen con la profesional que sea. */
async function darCita(
  page: Page,
  staffUserId: string,
  cuando: { fecha: string; hora: string },
  servicio: string,
): Promise<void> {
  await enLaAgenda(page);
  await irAlDia(page, cuando.fecha);
  await pulsarFranja(page, staffUserId, cuando.hora);
  await elegirClienta(
    page,
    PACIENTE.firstName,
    `${PACIENTE.firstName} ${PACIENTE.lastName}`,
  );
  await elegirServicio(page, servicio);
  await reservar(page);
}

/** Abre la sesión desde la tarjeta de la cita de ese día. */
async function abrirSesion(
  page: Page,
  staffUserId: string,
  cuando: { fecha: string; hora: string },
): Promise<void> {
  await enLaAgenda(page);
  await irAlDia(page, cuando.fecha);
  const tarjeta = page
    .locator(`[data-columna="${staffUserId}"] [data-cita]`)
    .filter({ hasText: cuando.hora })
    .first();
  await expect(tarjeta).toBeVisible({ timeout: 20_000 });
  await tarjeta.click();
  await page.getByRole("button", { name: "Sesión de hoy" }).click();
  // Se espera al TÍTULO DEL OVERLAY y no al nombre del paciente, que es lo
  // que había al principio: una sesión YA CERRADA no pinta la cabecera con
  // el nombre —pinta «Sesión cerrada»— así que ese aserto sólo valía para
  // una sesión nueva y el capítulo se caía al volver a abrir la cerrada.
  // `exact: true` para que no case con el «Sesión cerrada» de dentro.
  await expect(
    page.getByRole("heading", { name: "Sesión", exact: true }),
  ).toBeVisible({ timeout: 25_000 });
}

test.describe(CAP, () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await cerrarBd();
  });

  // ── 1 y 2 · la podóloga cierra la sesión y cobra ────────────────────

  test("la podóloga marca el pie, cierra la sesión y la cobra", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();

    await entrarTpv(page, PODOLOGA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await darCita(page, PODOLOGA.id, VISITA_1, QUIROPODIA.name);
    await abrirSesion(page, PODOLOGA.id, VISITA_1);

    // La cabecera, con el nombre entero del paciente.
    await expect(
      page.getByRole("heading", {
        name: `${PACIENTE.firstName} ${PACIENTE.lastName}`,
      }),
    ).toBeVisible({ timeout: 25_000 });

    // LA FRANJA ROJA, con «Cuidado» y la alerta que la podóloga corrigió en
    // el capítulo 11. Si esto no sale, lo que falla es el camino entero: la
    // valoración, el cálculo de alertas y la cabecera de la sesión.
    const franja = page.getByRole("alert");
    await expect(franja).toBeVisible({ timeout: 20_000 });
    await expect(franja).toContainText("Cuidado");
    await expect(franja).toContainText("Anticoagulación");

    // Y la cabecera dice que es su PRIMERA visita (de sesión).
    await expect(page.getByText("1.ª · la primera")).toBeVisible();

    // EL MAPA: se toca el dedo gordo izquierdo por su nombre accesible, que
    // es el que un lector de pantalla lee.
    await page
      .getByRole("button", { name: "Pie izquierdo · Dedo gordo" })
      .click();

    // LA GRAVEDAD ESTÁ DESACTIVADA, y se dice por qué.
    await expect(page.getByText("elige antes la lesión")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Moderada", exact: true }),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Uña encarnada" }).click();
    const moderada = page.getByRole("button", { name: "Moderada", exact: true });
    await expect(moderada).toBeEnabled();
    await moderada.click();
    await expect(
      page.getByText("Pie izq. · Dedo gordo", { exact: false }).first(),
    ).toBeVisible();

    // LOS TRATAMIENTOS y el DOLOR. Antes del dolor, el pie lo pide.
    await page.getByRole("button", { name: QUIROPODIA.name, exact: true }).click();
    await page.getByRole("button", { name: FRESADO.name, exact: true }).click();
    await expect(pieDeSesion(page)).toContainText("falta el dolor de hoy");
    const cerrar = page.getByRole("button", { name: "Cerrar sesión y cobrar" });
    await expect(cerrar).toBeDisabled();

    await page.getByRole("button", { name: "7", exact: true }).click();

    // LA DUEÑA VE EL IMPORTE: 30 € + 0 € («incluido» en el catálogo).
    await expect(pieDeSesion(page)).toContainText("30,00 €");
    await expect(pieDeSesion(page)).toContainText("iva 0 %");
    // Y NUNCA dice «exento»: el registro de Verifactu declara S1.
    await expect(pieDeSesion(page)).not.toContainText(/exent/i);

    await page.getByRole("button", { name: "Mejor", exact: true }).click();
    await page.getByRole("button", { name: "Calzado ancho" }).click();
    await page.getByRole("button", { name: "4 semanas" }).click();

    await expect(cerrar).toBeEnabled();
    await cerrar.click();

    // LA PANTALLA DE SESIÓN CERRADA, firmada.
    await expect(
      page.getByRole("heading", { name: "Sesión cerrada" }),
    ).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByText(
        new RegExp(
          `Firmada por ${PODOLOGA.alias} \\(${PODOLOGA.colegiado.replace(".", "\\.")}\\)`,
        ),
      ),
    ).toBeVisible();
    await expect(sesionCerrada(page)).toContainText("Pasa a caja");
    await expect(sesionCerrada(page)).toContainText("incluido");
    await expect(sesionCerrada(page)).toContainText(
      "Próxima cita propuesta: dentro de 4 semanas",
    );

    // CONTRA LA BD: una sesión, firmada por ella, con su cuerpo entero.
    const citaId = await citaDe(VISITA_1.fecha);
    const todas = await sesiones();
    expect(todas).toHaveLength(1);
    expect(todas[0]!.appointmentId).toBe(citaId);
    expect(todas[0]!.authorUserId).toBe(PODOLOGA.id);
    const cuerpo = todas[0]!.body as Record<string, any>;
    expect(cuerpo.dolor).toBe(7);
    expect(cuerpo.evolucion).toBe("MEJOR");
    expect(cuerpo.consejos).toEqual(["calzado"]);
    expect(cuerpo.proximaCita).toBe("S4");
    expect(cuerpo.marcas["L:h"]).toEqual({
      lesion: "unero",
      gravedad: "MODERADA",
    });
    expect(cuerpo.tratamientos).toEqual([QUIROPODIA.id, FRESADO.id]);
    // El NOMBRE sí, el precio NO: el precio sale del catálogo al cobrar.
    expect(cuerpo.tratamientosNombre[QUIROPODIA.id]).toBe(QUIROPODIA.name);
    expect(cuerpo.firma.colegiado).toBe(PODOLOGA.colegiado);
    // **Y NINGUNA PRÓXIMA CITA RESERVADA**: queda como propuesta (prompt §3).
    const citas = await bd().$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM appointments
        WHERE tenant_id = '${CLINICA.tenant}' AND client_id = '${PACIENTE.id}'`,
    );
    // La del capítulo 11 y la de esta visita. Ni una más.
    expect(Number(citas[0]!.n)).toBe(2);

    // ── COBRAR AHORA, que es el camino de siempre ────────────────────
    await page.getByRole("button", { name: "Cobrar ahora" }).click();

    // CONTRA LA BD: UN ticket, con DOS líneas, y los precios del catálogo.
    const t = await tickets(1);
    expect(t[0]!.status).toBe("DRAFT");
    expect(
      t[0]!.lines.map((l) => l.nameSnapshot).sort(),
    ).toEqual([FRESADO.name, QUIROPODIA.name].sort());
    expect(Number(t[0]!.total)).toBe(30);

    await ctx.close();
  });

  // ── 3 · CERRAR DOS VECES NO CREA DOS COBROS ─────────────────────────

  test("volver a la sesión cerrada no deja cerrarla otra vez", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    await entrarTpv(page, PODOLOGA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await abrirSesion(page, PODOLOGA.id, VISITA_1);

    // La pantalla entra DIRECTA a «Sesión cerrada»: no hay forma de volver a
    // marcar nada, que es lo que «no se edita» quiere decir en la práctica.
    await expect(
      page.getByRole("heading", { name: "Sesión cerrada" }),
    ).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByRole("button", { name: "Cerrar sesión y cobrar" }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "↺ Igual que la última vez" }),
    ).toBeHidden();

    // Y en la BD sigue habiendo UNA sesión y UN ticket.
    expect(await sesiones()).toHaveLength(1);
    expect(await losTickets()).toHaveLength(1);

    await ctx.close();
  });

  // ── 4 · «IGUAL QUE LA ÚLTIMA VEZ» SUMA ──────────────────────────────

  test("en la visita siguiente, «igual que la última vez» suma y no borra", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    await entrarTpv(page, PODOLOGA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await darCita(page, PODOLOGA.id, VISITA_2, QUIROPODIA.name);
    await abrirSesion(page, PODOLOGA.id, VISITA_2);

    // Es la 2.ª visita, y la anterior sale en la cabecera.
    await expect(page.getByText("2.ª · la anterior,", { exact: false })).toBeVisible();
    // Y la sesión NO está cerrada: es una nueva.
    await expect(sesionCerrada(page)).toBeHidden();
    // LA GRÁFICA DEL DOLOR ya tiene la barra del 7.
    await expect(page.getByRole("img", { name: /: 7 de 10$/ })).toBeVisible();

    // HOY la podóloga marca la verruga ANTES de pulsar el botón.
    await page.getByRole("button", { name: VERRUGA.name, exact: true }).click();
    await expect(pieDeSesion(page)).toContainText("1 tratamiento");

    await page.getByRole("button", { name: "↺ Igual que la última vez" }).click();

    // LOS TRES: los dos de la anterior MÁS el de hoy. Si el botón borrara,
    // aquí habría dos.
    await expect(pieDeSesion(page)).toContainText("3 tratamientos");
    // Y las marcas del pie de la visita anterior también han venido.
    await expect(page.getByText("Uña encarnada").first()).toBeVisible();
    // El importe: 30 + 0 + 25.
    await expect(pieDeSesion(page)).toContainText("55,00 €");

    await page.getByRole("button", { name: "4", exact: true }).click();
    await page.getByRole("button", { name: "Cerrar sesión y cobrar" }).click();
    await expect(
      page.getByRole("heading", { name: "Sesión cerrada" }),
    ).toBeVisible({ timeout: 25_000 });

    // CONTRA LA BD: la segunda sesión, con los tres tratamientos y la marca
    // heredada — que ahora es también de HOY, que es lo que ese botón
    // significa.
    const todas = await sesiones();
    expect(todas).toHaveLength(2);
    const cuerpo = todas[0]!.body as Record<string, any>;
    expect(cuerpo.tratamientos).toHaveLength(3);
    expect(cuerpo.tratamientos).toContain(VERRUGA.id);
    expect(cuerpo.tratamientos).toContain(QUIROPODIA.id);
    expect(cuerpo.tratamientos).toContain(FRESADO.id);
    expect(cuerpo.marcas["L:h"].lesion).toBe("unero");
    expect(cuerpo.dolor).toBe(4);

    await ctx.close();
  });

  // ── 5 · EL SANITARIO SIN CAJA NO VE IMPORTES ────────────────────────

  test("la sanitaria sin caja cierra su sesión sin ver un solo importe", async ({
    browser,
  }) => {
    // La cita la da la podóloga (la sanitaria sin caja no configura nada), y
    // la atiende Ana.
    const ctxDuena = await browser.newContext(AP11);
    const pDuena = await ctxDuena.newPage();
    await entrarTpv(pDuena, PODOLOGA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(pDuena);
    await darCita(pDuena, SANITARIA.id, VISITA_3, QUIROPODIA.name);
    await ctxDuena.close();

    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    // Ana entra con su PIN y cae DIRECTA en su agenda: ni turno, ni venta.
    await entrarTpv(page, SANITARIA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await expect(page.getByRole("button", { name: "Hoy" })).toBeVisible({
      timeout: 30_000,
    });

    await irAlDia(page, VISITA_3.fecha);
    const tarjeta = page
      .locator(`[data-columna="${SANITARIA.id}"] [data-cita]`)
      .filter({ hasText: VISITA_3.hora })
      .first();
    await expect(tarjeta).toBeVisible({ timeout: 20_000 });
    await tarjeta.click();
    // Y NO SE LE OFRECE COBRAR.
    await expect(
      page.getByRole("button", { name: "Cobrar en caja" }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Sesión de hoy" }).click();
    await expect(
      page.getByRole("heading", { name: `${PACIENTE.firstName} ${PACIENTE.lastName}` }),
    ).toBeVisible({ timeout: 25_000 });

    await page.getByRole("button", { name: QUIROPODIA.name, exact: true }).click();
    await page.getByRole("button", { name: VERRUGA.name, exact: true }).click();
    await page.getByRole("button", { name: "2", exact: true }).click();

    // NI UN IMPORTE EN TODA LA PANTALLA. Medido sobre el texto entero y no
    // sobre un selector: lo que hay que comprobar es que no hay un euro en
    // NINGÚN sitio.
    // El TPV de una sanitaria sin caja no tiene pantalla de venta detrás
    // (clinica-1 §7: el `if` de `App.tsx` la salta entera), así que aquí el
    // `body` ES la sesión. Se mide el body a propósito: lo que hay que
    // comprobar es que no hay un euro en NINGÚN sitio de su pantalla.
    const texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(texto).not.toContain("€");
    expect(texto).not.toMatch(/\d+,\d\d\s*€/);
    expect(texto).not.toMatch(/IVA/i);
    // Pero sí cuántos tratamientos lleva, que es lo que necesita para
    // cerrar.
    expect(texto).toContain("2 tratamientos");

    // Y SU BOTÓN DICE «Cerrar sesión», sin «y cobrar».
    await expect(
      page.getByRole("button", { name: "Cerrar sesión y cobrar" }),
    ).toBeHidden();
    const cerrar = page.getByRole("button", { name: "Cerrar sesión", exact: true });
    await expect(cerrar).toBeEnabled();
    await cerrar.click();

    // «ENVIADA A RECEPCIÓN PARA COBRAR», con la lista y sin precios.
    await expect(
      page.getByRole("heading", { name: "Sesión cerrada" }),
    ).toBeVisible({ timeout: 25_000 });
    await expect(sesionCerrada(page)).toContainText(
      "Enviada a recepción para cobrar",
    );
    await expect(sesionCerrada(page)).not.toContainText("Pasa a caja");
    await expect(page.getByRole("button", { name: "Cobrar ahora" })).toBeHidden();
    const cerrada = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(cerrada).not.toContain("€");
    // Las líneas SÍ están: tiene que poder ver qué hizo.
    expect(cerrada).toContain(QUIROPODIA.name);
    expect(cerrada).toContain(VERRUGA.name);

    // CONTRA LA BD: la sesión la firma ELLA, con su colegiado, y no hay
    // ticket nuevo — el cobro todavía no existe.
    const todas = await sesiones();
    expect(todas).toHaveLength(3);
    expect(todas[0]!.authorUserId).toBe(SANITARIA.id);
    expect((todas[0]!.body as Record<string, any>).firma.colegiado).toBe(
      SANITARIA.colegiado,
    );
    // Y NO HAY TICKET NUEVO: el cobro de Ana todavía no existe. El único
    // ticket de la clínica sigue siendo el que cobró la podóloga en el
    // primer caso — la sesión de la 2.ª visita se cerró y no se cobró, que
    // es exactamente lo que «queda pendiente» significa.
    expect(await losTickets()).toHaveLength(1);

    await ctx.close();
  });

  // ── 6 · Y LA RECEPCIÓN LO COBRA ─────────────────────────────────────

  test("la recepción lo encuentra en «Por cobrar» y lo cobra, sin ver nada clínico", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    await entrarTpv(page, RECEPCION.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await enLaAgenda(page);
    await irAlDia(page, VISITA_3.fecha);

    // EL AVISO DE LA AGENDA: una cita con la sesión cerrada y sin cobrar.
    await page.getByRole("button", { name: "Sesiones por cobrar" }).click();
    await expect(page.getByRole("heading", { name: /^Por cobrar/ })).toBeVisible({
      timeout: 20_000,
    });

    // Se espera a que la LISTA LLEGUE antes de leerla: el panel pide los
    // cobros al abrirse y el `innerText` de un «Cargando…» no prueba nada.
    await expect(panelDeCobros(page)).toContainText(
      `${PACIENTE.firstName} ${PACIENTE.lastName}`,
      { timeout: 20_000 },
    );

    // LO QUE VE: el paciente, la cita y las líneas con precio. Medido
    // DENTRO del panel, que es lo que la recepción tiene delante — el body
    // entero llevaría también la pantalla de venta de detrás.
    const lista = (await panelDeCobros(page).innerText()).replace(/\s+/g, " ");
    expect(lista).toContain(`${PACIENTE.firstName} ${PACIENTE.lastName}`);
    expect(lista).toContain(QUIROPODIA.name);
    expect(lista).toContain(VERRUGA.name);
    expect(lista).toContain("55,00 €");

    // Y NADA DE LA HISTORIA: ni la lesión, ni el dolor, ni los consejos, ni
    // una alerta. Es la regla 8 mirada desde el mostrador.
    for (const prohibido of [
      "Uña encarnada",
      "Dedo gordo",
      "Dolor",
      "Anticoagulación",
      "Diabetes",
      "Calzado ancho",
      "Mejor",
      "Cuidado",
    ]) {
      expect(lista, `«${prohibido}» no puede verse en la lista de cobros`).not.toContain(
        prohibido,
      );
    }

    // COBRAR EN CAJA, desde la hoja. Es el mismo endpoint de siempre.
    await page.getByRole("button", { name: "Cobrar en caja" }).first().click();

    // CONTRA LA BD: el segundo ticket de la clínica, con las DOS líneas que
    // marcó Ana y los precios del catálogo.
    const t = await tickets(2);
    const ultimo = t[1]!;
    expect(ultimo.lines.map((l) => l.nameSnapshot).sort()).toEqual(
      [QUIROPODIA.name, VERRUGA.name].sort(),
    );
    expect(Number(ultimo.total)).toBe(55);

    await ctx.close();
  });

  // ── 7 · Y la sanitaria sin caja no puede cobrar ni por la ruta ──────

  test("la sanitaria sin caja recibe un 403 si llama al cobro a mano", async ({
    browser,
  }) => {
    // Esconder el botón es por no ofrecer una acción que siempre falla; la
    // frontera está en la API. Esto lo comprueba desde el navegador de Ana,
    // con su sesión de verdad.
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    await entrarTpv(page, SANITARIA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await expect(page.getByRole("button", { name: "Hoy" })).toBeVisible({
      timeout: 30_000,
    });

    const citaId = await citaDe(VISITA_1.fecha);
    const res = await page.evaluate(async (id) => {
      const token = window.localStorage.getItem("mipiacetpv-cashier-session");
      // El campo es `sessionToken` (ver `storage.ts`): la sesión del TPV
      // guarda más cosas que el token.
      const sesion = token
        ? (JSON.parse(token) as { sessionToken?: string })
        : null;
      const r = await fetch(`/api/agenda/appointments/${id}/checkout`, {
        method: "POST",
        headers: { authorization: `Bearer ${sesion?.sessionToken ?? ""}` },
      });
      return { status: r.status, body: await r.text() };
    }, citaId);

    expect(res.status).toBe(403);
    expect(res.body).toContain("CLINICIAN_NO_CAJA");

    // Y la lista de cobros tampoco.
    const lista = await page.evaluate(async () => {
      const token = window.localStorage.getItem("mipiacetpv-cashier-session");
      const sesion = token
        ? (JSON.parse(token) as { sessionToken?: string })
        : null;
      const r = await fetch(
        `/api/agenda/cobros-pendientes?from=2026-01-01`,
        { headers: { authorization: `Bearer ${sesion?.sessionToken ?? ""}` } },
      );
      return { status: r.status, body: await r.text() };
    });
    expect(lista.status).toBe(403);
    expect(lista.body).toContain("CLINICIAN_NO_CAJA");

    await ctx.close();
  });
});
