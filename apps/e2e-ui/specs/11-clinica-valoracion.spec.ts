// Capítulo 11 · La valoración inicial, por la interfaz real.
//
// El viaje entero que pide el prompt de clinica-2, de punta a punta y por
// las pantallas de verdad:
//
//   1. La recepcionista da una cita de PRIMERA VALORACIÓN a Carmen.
//   2. Sale el email con el enlace. Se lee del buzón del banco y se
//      comprueba que **no lleva ni una palabra del cuestionario**.
//   3. Carmen contesta desde el enlace **a 390 px**, en su móvil, y marca
//      una pregunta como «No lo sé».
//   4. La podóloga lo abre, ve la alerta, CORRIGE el «No lo sé», marca las
//      tres confirmaciones y valida.
//   5. La puerta del primer tratamiento dice sí.
//
// Y de paso, las dos negativas que el bloque existe para sostener:
//   · la recepcionista NO lee las respuestas, y el intento queda escrito;
//   · el enlace NO se reutiliza.
//
// ── Por qué este capítulo tiene que ser con navegador ────────────────
//
// Porque lo que se prueba no es una ruta: es que las piezas se encuentran.
// El enganche del alta de cita está en `agenda/store.ts` y el que lo
// dispara es el motor de reservas al insertar; el email lo manda un camino
// que corre DESPUÉS del commit; el enlace lo abre la PWA en una ruta que
// se desvía antes de montar el TPV; y la pantalla del sanitario pinta el
// botón con la misma función pura que la API usa para decidir. Cada una
// tiene su test, y ninguno de ellos ve si la cadena está unida.
//
// Es el mismo argumento que dejó escrito clinica-1 (§10b de su done): el
// bug de verdad del bloque lo encontró el banco por la interfaz, no la
// suite — «un aserto sobre el TEXTO de un fichero tiene que contar, no
// buscar».
//
// ── Corre sobre SU PROPIO tenant ─────────────────────────────────────
//
// La clínica del banco (`seed/clinica-demo.ts`) es un tenant aparte de la
// peluquería. Los diez capítulos anteriores siguen siendo la prueba de que
// **la clínica no se le nota a nadie más**.

import { readFileSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { CUESTIONARIO_V1 } from "@mipiacetpv/clinica-valoracion";

import { bd, cerrarBd } from "../lib/bd.js";
import { entrarTpv, turnoAbierto } from "../lib/entrar.js";
import {
  elegirClienta,
  elegirServicio,
  irAlDia,
  pulsarFranja,
  reservar,
} from "../lib/agenda-ui.js";
import { AP11, MOVIL } from "../lib/pantallas.js";
import { BUZON, TPV } from "../playwright.config.js";
import {
  CLINICA,
  CLINICA_DEVICE_TOKEN,
  CLINICA_PIN,
  PACIENTE,
  PODOLOGA,
  RECEPCION,
  SERVICIO_VALORACION,
} from "../seed/clinica-demo.js";

const CAP = "Capítulo 11 · La valoración inicial";

/** Mañana a las 10:30: un día laborable con hueco de sobra. */
function manana(): { fecha: string; hora: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  // Domingo no: el centro de la clínica abre de lunes a sábado.
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return { fecha: d.toISOString().slice(0, 10), hora: "10:30" };
}

interface EmailDelBuzon {
  to: string;
  subject: string;
  text: string;
  html: string | null;
}

/** Lo que hay en el buzón del banco, en orden de llegada. */
function buzon(): EmailDelBuzon[] {
  let crudo = "";
  try {
    crudo = readFileSync(BUZON, "utf8");
  } catch {
    return [];
  }
  return crudo
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EmailDelBuzon);
}

function vaciarBuzon(): void {
  writeFileSync(BUZON, "", "utf8");
}

/** La valoración de Carmen, mirada en la BD. */
async function valoracion() {
  return bd().clinicalAssessment.findFirst({
    where: { clientId: PACIENTE.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      channel: true,
      source: true,
      requestedByUserId: true,
      questionnaireVersion: true,
      appointmentId: true,
      linkTokenHash: true,
      linkUsedAt: true,
      entryId: true,
      answeredBy: true,
      confirmedAllergies: true,
      confirmedMedication: true,
      confirmedAlerts: true,
      validatedAt: true,
      validatedByUserId: true,
    },
  });
}

/** El registro de accesos de Carmen, lo más reciente primero. */
async function registro() {
  return bd().clinicalAccessLog.findMany({
    where: { clientId: PACIENTE.id },
    orderBy: { at: "desc" },
    select: { userId: true, action: true, outcome: true, route: true },
  });
}

/** Contesta las diez preguntas del test, dejando `noSe` en «No lo sé». */
async function contestarElTest(page: Page, noSe: string): Promise<void> {
  await page.getByRole("button", { name: "Empezar" }).click();
  // «¿Quién está respondiendo?» — contesta Carmen misma.
  await page.getByRole("button", { name: `Soy ${PACIENTE.firstName}` }).click();
  await page.getByRole("button", { name: "Seguir" }).click();

  for (const pregunta of CUESTIONARIO_V1.preguntas) {
    await expect(
      page.getByRole("heading", { name: pregunta.texto }),
    ).toBeVisible({ timeout: 15_000 });
    if (pregunta.id === noSe) {
      await page.getByRole("button", { name: "No lo sé" }).click();
    } else {
      // Todo «No»: la valoración limpia es la que deja ver que lo que
      // enciende las alertas es la corrección de la podóloga.
      await page.getByRole("button", { name: "No", exact: true }).click();
    }
  }
  await expect(
    page.getByRole("heading", { name: /Gracias, Carmen/ }),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe(CAP, () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await cerrarBd();
  });

  // ── 1 y 2 · la cita dispara el test, y el email no dice nada de salud ──

  test("la recepcionista da la cita de primera valoración y sale el email", async ({
    browser,
  }) => {
    vaciarBuzon();
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();

    await entrarTpv(page, RECEPCION.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await page.getByRole("button", { name: "Agenda" }).click();

    const { fecha, hora } = manana();
    // `irAlDia` y no un `fill` a secas: la agenda revierte la fecha si se
    // teclea mientras carga, y el campo llega a enseñar la nueva un
    // instante antes de volver atrás. La función lo asienta y lo comprueba.
    await irAlDia(page, fecha);
    await pulsarFranja(page, PODOLOGA.id, hora);
    // El NOMBRE COMPLETO como segundo argumento: el selector pinta «Carmen
    // Rodríguez López» y buscar sólo «Carmen» no casa (y con otra paciente
    // llamada Mari Carmen colgaría la cita de la equivocada — la lección
    // que `elegirClienta` lleva escrita desde el capítulo 6).
    await elegirClienta(
      page,
      PACIENTE.firstName,
      `${PACIENTE.firstName} ${PACIENTE.lastName}`,
    );
    await elegirServicio(page, SERVICIO_VALORACION.name);
    await reservar(page);

    // La cita está dada…
    const citas = await bd().$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM appointments WHERE tenant_id = '${CLINICA.tenant}' AND client_id = '${PACIENTE.id}'`,
    );
    expect(citas).toHaveLength(1);

    // …y con ella nació la valoración, SIN que nadie la pidiera.
    const v = await valoracion();
    expect(v).not.toBeNull();
    expect(v!.status).toBe("PENDIENTE_PACIENTE");
    expect(v!.channel).toBe("EMAIL");
    // `APPOINTMENT` y sin usuario: no la pidió nadie, la pidió el hecho de
    // la cita. Es el mismo criterio que `clinical_access` de clinica-1.
    expect(v!.source).toBe("APPOINTMENT");
    expect(v!.requestedByUserId).toBeNull();
    expect(v!.appointmentId).toBe(citas[0]!.id);
    expect(v!.questionnaireVersion).toBe(CUESTIONARIO_V1.version);
    // El token se guarda HASHEADO: 64 hex y no un base64url de 43.
    expect(v!.linkTokenHash).toMatch(/^[0-9a-f]{64}$/);

    // EL EMAIL. Uno, a Carmen, con su enlace.
    const correos = buzon().filter((e) => e.to === PACIENTE.email);
    expect(correos).toHaveLength(1);
    const correo = correos[0]!;
    expect(correo.text).toMatch(/\/valoracion\/[A-Za-z0-9_-]{43}/);

    // Y NI UNA PALABRA DEL CUESTIONARIO, construido desde el cuestionario
    // y no desde una lista a mano (igual que en la suite).
    const texto = `${correo.subject}\n${correo.text}\n${correo.html ?? ""}`;
    const enElCorreo = new Set(palabras(texto));
    const delTest = new Set<string>();
    for (const p of CUESTIONARIO_V1.preguntas) {
      for (const frase of [p.texto, p.ayuda, p.corto, p.alerta ?? ""]) {
        for (const w of palabras(frase)) delTest.add(w);
      }
      for (const o of p.opciones ?? []) {
        for (const w of palabras(o)) delTest.add(w);
      }
      if (p.seguimiento) {
        for (const frase of [p.seguimiento.texto, p.seguimiento.corto]) {
          for (const w of palabras(frase)) delTest.add(w);
        }
      }
    }
    for (const inocente of ["puede", "también", "seguro"]) {
      delTest.delete(inocente);
    }
    expect([...delTest].filter((w) => enElCorreo.has(w))).toEqual([]);

    // Y tampoco el apellido de Carmen.
    expect(texto).not.toContain("Rodríguez");

    await ctx.close();
  });

  // ── 3 · Carmen contesta desde su móvil, a 390 px ─────────────────────

  test("Carmen contesta por el enlace, a 390 px, y marca un «No lo sé»", async ({
    browser,
  }) => {
    const correo = buzon().filter((e) => e.to === PACIENTE.email)[0]!;
    const token = /\/valoracion\/([A-Za-z0-9_-]{43})/.exec(correo.text)![1]!;

    // El móvil de Carmen: SIN device token y sin sesión. Lo único que tiene
    // es la URL, que es la credencial.
    const ctx = await browser.newContext(MOVIL);
    const page = await ctx.newPage();
    await page.goto(`${TPV}/valoracion/${token}`);

    // No ha caído en la pantalla de emparejar el terminal, que es lo que
    // pasaría si el desvío de `main.tsx` no estuviera.
    await expect(
      page.getByRole("heading", { name: /Hola, Carmen/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Clínica Podológica Demo")).toBeVisible();

    await contestarElTest(page, "antic");

    // La despedida del canal EMAIL (no la de la tablet) y la cuenta de los
    // «No lo sé».
    await expect(
      page.getByText(/Ya puede cerrar esta página/),
    ).toBeVisible();
    await expect(page.getByText(/1 pregunta que ha marcado como «No lo sé»/)).toBeVisible();

    const v = await valoracion();
    expect(v!.status).toBe("RESPONDIDA");
    expect(v!.answeredBy).toBe("PACIENTE");
    expect(v!.entryId).not.toBeNull();
    // EL ENLACE QUEDA SELLADO.
    expect(v!.linkUsedAt).not.toBeNull();

    // Y la entrada de historia la firma EL PACIENTE, no el personal.
    const entrada = await bd().clinicalEntry.findUniqueOrThrow({
      where: { id: v!.entryId! },
      select: { kind: true, author: { select: { alias: true, isSystemActor: true } } },
    });
    expect(entrada.kind).toBe("INITIAL_ASSESSMENT");
    expect(entrada.author.isSystemActor).toBe(true);
    expect(entrada.author.alias).toBe("Paciente (por enlace)");

    // Deja su línea WRITE en el registro.
    const lineas = await registro();
    expect(lineas[0]).toMatchObject({
      action: "WRITE",
      outcome: "ALLOWED",
      route: "POST /valoracion/:token",
    });

    // EL ENLACE NO SE REUTILIZA: recargarlo ya no abre.
    await page.goto(`${TPV}/valoracion/${token}`);
    await expect(
      page.getByRole("heading", { name: "Este enlace ya no sirve" }),
    ).toBeVisible({ timeout: 20_000 });

    await ctx.close();
  });

  // ── La recepcionista no lee ──────────────────────────────────────────

  test("la recepcionista abre la pestaña y NO ve las respuestas", async ({
    browser,
  }) => {
    const antes = (await registro()).length;
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    await entrarTpv(page, RECEPCION.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await page.getByRole("button", { name: "Clientes" }).click();
    await page.getByText(PACIENTE.firstName, { exact: false }).first().click();
    // Se espera a que la ficha ASIENTE antes de tocar la pestaña: el panel
    // crece mientras carga el historial.
    await expect(
      page.getByRole("heading", { name: PACIENTE.lastName, exact: false }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Cita", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    // `exact: true` NO es cosmético: detrás de la ficha está la pantalla de
    // venta con la tarjeta del servicio «Primera visita · valoración», y
    // sin él la pestaña y la tarjeta casan las dos. Playwright lo canta como
    // «strict mode violation», pero el primer síntoma fue un clic que caía
    // en el fondo y cerraba la ficha.
    await page.getByRole("button", { name: "Valoración", exact: true }).click();

    // Lo que ve es la frase que explica por qué no, y los dos botones que
    // SÍ puede usar. No una respuesta.
    await expect(
      page.getByText(/sólo las ve el personal sanitario/),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Enviar el test/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Test en la tablet/ })).toBeVisible();
    await expect(page.getByText("Anticoagulantes")).toBeHidden();

    // Y no ha pedido la valoración, así que no ha dejado un DENIED: la
    // pantalla no ofrece lo que siempre falla (ver la nota de
    // `esSanitario`). El registro no ha crecido.
    expect((await registro()).length).toBe(antes);

    await ctx.close();
  });

  // ── 4 y 5 · la podóloga corrige, valida, y la puerta se abre ─────────

  test("la podóloga corrige el «No lo sé», marca las tres y valida", async ({
    browser,
  }) => {
    const ctx = await browser.newContext(AP11);
    const page = await ctx.newPage();
    await entrarTpv(page, PODOLOGA.email, {
      deviceToken: CLINICA_DEVICE_TOKEN,
      pin: CLINICA_PIN,
    });
    await turnoAbierto(page);
    await page.getByRole("button", { name: "Agenda" }).click();

    const { fecha, hora } = manana();
    await irAlDia(page, fecha);
    // La tarjeta de la cita de Carmen, por su gancho (`data-cita`) y dentro
    // de la columna de la podóloga — igual que el capítulo 7.
    const tarjeta = page
      .locator(`[data-columna="${PODOLOGA.id}"] [data-cita]`)
      .filter({ hasText: hora })
      .first();
    await expect(tarjeta).toBeVisible({ timeout: 20_000 });
    await tarjeta.click();

    // SU AVISO DISCRETO, en el detalle.
    await expect(page.getByText("Valoración pendiente")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Valoración inicial" }).click();

    // La pantalla del sanitario: por validar, y el botón DESACTIVADO CON
    // SU MOTIVO — que es el «No lo sé» y no las casillas, porque eso es
    // trabajo con el paciente delante.
    await expect(page.getByText("Valoración por validar")).toBeVisible({
      timeout: 20_000,
    });
    const validar = page.getByRole("button", { name: "Validar valoración" });
    await expect(validar).toBeDisabled();
    await expect(
      page.getByText("Queda 1 respuesta «No lo sé» por resolver con el paciente."),
    ).toBeVisible();

    // CORREGIR: la fila de los anticoagulantes, a «Sí». Por su gancho
    // (`data-pregunta`) y no filtrando `div` por texto: un filtro de texto
    // casa también con el contenedor interior, que no lleva los botones.
    const fila = page.locator('[data-pregunta="antic"]');
    await expect(fila).toBeVisible({ timeout: 20_000 });
    await fila.getByRole("button", { name: "Sí", exact: true }).click();

    // La alerta aparece, y el motivo cambia: ya sólo faltan las casillas.
    await expect(page.getByText("Anticoagulación")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Marca las tres confirmaciones.")).toBeVisible();
    await expect(validar).toBeDisabled();

    // Y LO QUE DIJO CARMEN SIGUE AHÍ, al lado de la corrección.
    await expect(
      page.getByText(/Paciente: No lo sé · corregido por Lucía Martín/),
    ).toBeVisible();

    // Las tres confirmaciones.
    for (const texto of [
      "He revisado las alergias con el paciente",
      "He revisado la medicación que toma",
      "Las alertas de arriba son correctas",
    ]) {
      await page.getByRole("button", { name: texto }).click();
    }
    await expect(validar).toBeEnabled();
    await validar.click();

    // El aviso verde, con su autora, su colegiado y la hora.
    await expect(page.getByText("Valoración validada")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText(
        new RegExp(`por ${PODOLOGA.alias} \\(${PODOLOGA.colegiado.replace(".", "\\.")}\\)`),
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Ya puedes registrar el primer tratamiento"),
    ).toBeVisible();

    // La fila, firmada y con las tres.
    const v = await valoracion();
    expect(v!.status).toBe("VALIDADA");
    expect(v!.validatedByUserId).toBe(PODOLOGA.id);
    expect(v!.validatedAt).not.toBeNull();
    expect(v!.confirmedAllergies).toBe(true);
    expect(v!.confirmedMedication).toBe(true);
    expect(v!.confirmedAlerts).toBe(true);

    // La corrección, con su autora, y la respuesta de Carmen intacta.
    const correcciones = await bd().clinicalAssessmentCorrection.findMany({
      where: { assessmentId: v!.id },
      select: { questionId: true, value: true, authorUserId: true },
    });
    expect(correcciones).toEqual([
      { questionId: "antic", value: "SI", authorUserId: PODOLOGA.id },
    ]);
    const entrada = await bd().clinicalEntry.findUniqueOrThrow({
      where: { id: v!.entryId! },
      select: { body: true },
    });
    const cuerpo = entrada.body as {
      respuestas: Record<string, string>;
    };
    expect(cuerpo.respuestas.antic).toBe("NO_SE");

    // LA PUERTA DEL PRIMER TRATAMIENTO DICE SÍ.
    const { puedeRecibirPrimerTratamiento } = await import(
      "@mipiacetpv/clinica-valoracion"
    );
    const puerta = puedeRecibirPrimerTratamiento([
      {
        id: v!.id,
        estado: "VALIDADA",
        validadaEn: v!.validatedAt!.toISOString(),
      },
    ]);
    expect(puerta.puede).toBe(true);

    // Y el aviso de la agenda se ha apagado: ya no hay nada pendiente.
    await page.getByRole("button", { name: "Volver a la agenda" }).click();
    await expect(page.getByText("Valoración pendiente")).toBeHidden({
      timeout: 20_000,
    });

    await ctx.close();
  });
});

/** Las palabras de contenido (más de cuatro letras) de una frase. */
function palabras(frase: string): string[] {
  return frase
    .toLowerCase()
    .split(/[^\wáéíóúñü]+/)
    .filter((w) => w.length > 4);
}
