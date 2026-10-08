// clinica-5 · la pantalla de la sesión por tipos, montada de verdad.
//
// Lo que se fija aquí es lo que un test de API no puede ver: que la
// pantalla pinta lo que el servidor manda, que no calcula el dinero y que
// el cuerpo que manda al cerrar es el que se ve. En particular —
//
//   1. **El sanitario sin caja NO VE NI UN IMPORTE** en el DOM, y su
//      botón dice «Cerrar sesión». La dueña sí los ve y el suyo dice «y
//      cobrar». Es la regla 8 de clinica-3 mirada desde el DOM: la API ya
//      quita las claves, aquí se comprueba que no se cuela un `0,00 €`
//      por un `?? 0`.
//   2. **Los chips de tipo son multiselección y como mínimo uno**, y cada
//      tipo marcado añade su tarjeta (decisión 1).
//   3. **El nivel de quiropodia sale de los actos** y se cambia con un
//      toque, y la barra de caja cambia de producto con él (decisión 4).
//   4. **El riesgo del pie sale de las cuatro comprobaciones** y dice qué
//      falta mientras no estén (decisión 6).
//   5. **El aviso cruzado aparece EN EL MOMENTO**, dentro de la tarjeta
//      que lo dispara (decisión 9).
//   6. **«Hoy toca» se cierra solo al tocar la zona, y si no, el cierre
//      pregunta** — y contestar «todavía no» cierra igual y arrastra el
//      pendiente (decisión 10).
//   7. Y lo de clinica-3 que sigue siendo verdad: la gravedad después de
//      la lesión, las 22 zonas con su mínimo táctil, la franja roja
//      intensa, la puerta de la valoración, el dolor obligatorio y la
//      pestaña de exploración.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot +
// act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTOS_QUIROPODIA_V1,
  ANCHO_DEL_PIE_PX,
  CONSEJOS_V1,
  ESTADOS_DE_HERIDA,
  FUENTE_DEL_RIESGO,
  LESIONES_V1,
  MAPA_PIE_V1,
  PENDIENTES_V1,
  PISADAS,
  PUNTOS_DE_LA_HERIDA,
  TIPOS_DE_PIE_BIOMECANICA,
  VIEWBOX,
  versionesDeHoy,
} from "@mipiacetpv/clinica-sesion";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import {
  SesionPodologia,
  type VistaDeLaSesion,
} from "../src/clinica/SesionPodologia.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CITA = "55555555-5555-5555-5555-555555555551";
const PACIENTE = "44444444-4444-4444-4444-444444444444";
const BASICA = "66666666-6666-6666-6666-666666666661";
const COMPLETA = "66666666-6666-6666-6666-666666666662";
const EXTRA = "66666666-6666-6666-6666-666666666663";
const PAPILOMA = "66666666-6666-6666-6666-666666666664";
const CURA = "66666666-6666-6666-6666-666666666665";

/** La zona del dedo gordo izquierdo, la que usa «Hoy toca». */
const ZONA = "L:h";

/** La vista que devuelve la API. `verImportes` manda. */
function vista(opts: {
  verImportes: boolean;
  puertaAbierta?: boolean;
  conAnterior?: boolean;
  conPendiente?: boolean;
  tiposSugeridos?: VistaDeLaSesion["tiposSugeridos"];
}): VistaDeLaSesion {
  const conPrecio = opts.verImportes;
  const precio = (p: number) => (conPrecio ? { precio: p, iva: 0 } : {});
  return {
    cita: {
      id: CITA,
      clientId: PACIENTE,
      empieza: "2026-10-07T08:30:00.000Z",
      status: "IN_SERVICE",
      servicios: ["Quiropodia"],
      servicioIds: [BASICA],
      atiende: { userId: "u1", nombre: "Lucía Martín" },
      ticketId: null,
    },
    cabecera: {
      paciente: {
        id: PACIENTE,
        nombre: "Carmen Rodríguez López",
        edad: 78,
        telefono: "600 123 456",
      },
      citaDeHoy: {
        empieza: "2026-10-07T08:30:00.000Z",
        servicios: ["Quiropodia"],
      },
      numeroDeVisita: 3,
      visitaAnterior: "2026-09-21T08:30:00.000Z",
      atiende: { userId: "u1", nombre: "Lucía Martín" },
      alertas: ["Diabetes", "Anticoagulación", "Alergia: látex"],
      // Las IDS, que es por lo que cruzan las alertas de clinica-5.
      alertaIds: ["diab", "antic", "aler"],
    },
    puerta:
      opts.puertaAbierta === false
        ? {
            puede: false,
            motivo: "VALORACION_SIN_VALIDAR",
            mensaje:
              "La valoración inicial está contestada pero sin validar. Revísala con el paciente y válidala antes del primer tratamiento.",
          }
        : {
            puede: true,
            valoracionId: "v1",
            validadaEn: "2026-09-07T09:00:00.000Z",
          },
    tratamientos: [
      {
        serviceId: BASICA,
        nombre: "Quiropodia básica",
        tipo: "QUIROPODIA",
        nivelQuiropodia: 1,
        ...precio(25),
      },
      {
        serviceId: COMPLETA,
        nombre: "Quiropodia completa",
        tipo: "QUIROPODIA",
        nivelQuiropodia: 2,
        ...precio(26),
      },
      {
        serviceId: EXTRA,
        nombre: "Quiropodia extra",
        tipo: "QUIROPODIA",
        nivelQuiropodia: 3,
        ...precio(27),
      },
      {
        serviceId: PAPILOMA,
        nombre: "Tratamiento de papiloma",
        tipo: "QUIROPODIA",
        nivelQuiropodia: null,
        ...precio(30),
      },
      {
        serviceId: CURA,
        nombre: "Cura",
        tipo: "CIRUGIA",
        nivelQuiropodia: null,
        ...precio(13),
      },
    ],
    tiposSugeridos: opts.tiposSugeridos ?? ["QUIROPODIA"],
    pendientes:
      opts.conPendiente === true
        ? [
            {
              id: "revisar_una",
              zona: ZONA,
              nota: null,
              desde: "2026-09-09T09:00:00.000Z",
            },
          ]
        : [],
    ultimaCirugia: {
      fecha: "2026-10-06T09:00:00.000Z",
      tecnica: ["Matricectomía parcial"],
      zonas: ["Pie izq. · Dedo gordo"],
    },
    anterior:
      opts.conAnterior === false
        ? null
        : {
            entryId: "e1",
            fecha: "2026-09-21T08:30:00.000Z",
            marcas: { [ZONA]: { lesion: "unero", gravedad: "MODERADA" } },
            tratamientos: [BASICA],
            consejos: ["calzado"],
            dolor: 5,
          },
    dolorHistorico: [
      { fecha: "2026-09-07T09:00:00.000Z", dolor: 7 },
      { fecha: "2026-09-21T09:00:00.000Z", dolor: 5 },
    ],
    exploracion: {
      departeDe: {
        pulsos: { L: "PRESENTE", R: "PRESENTE" },
        sinSensibilidad: [],
        tipoDePie: "NORMAL",
      },
      ultima: null,
    },
    cerrada: null,
    listas: {
      mapa: MAPA_PIE_V1,
      lesiones: LESIONES_V1,
      consejos: CONSEJOS_V1,
      actos: ACTOS_QUIROPODIA_V1,
      estadosDeHerida: ESTADOS_DE_HERIDA,
      puntos: PUNTOS_DE_LA_HERIDA,
      tiposDePieBiomecanica: TIPOS_DE_PIE_BIOMECANICA,
      pisadas: PISADAS,
      pendientes: PENDIENTES_V1,
      versiones: versionesDeHoy() as unknown as Record<string, number>,
      fuenteDelRiesgo: FUENTE_DEL_RIESGO,
    },
    verImportes: opts.verImportes,
  };
}

let host: HTMLDivElement;
let root: Root;
/** Lo que la pantalla ha mandado a cada endpoint, en orden. */
let enviado: Array<{ url: string; body: unknown }>;

async function montar(v: VistaDeLaSesion) {
  enviado = [];
  apiMock.apiWithCashier.mockImplementation(
    async (url: string, opciones?: { method?: string; body?: unknown }) => {
      if (opciones?.method === "POST") {
        enviado.push({ url, body: opciones.body });
        if (url.endsWith("/cerrar")) {
          return {
            yaEstaba: false,
            cerrada: {
              entryId: "nueva",
              cerradaEn: "2026-10-07T09:00:00.000Z",
              firma: {
                autorNombre: "Lucía Martín",
                colegiado: "Col. 45-0312",
                firmadaEn: "2026-10-07T09:00:00.000Z",
              },
              cuerpo: {
                v: 2,
                dolor: 4,
                evolucion: null,
                consejos: [],
                proximaCita: null,
                nota: null,
                consejosVersion: 1,
              },
              marcas: [],
              resumen: { tratamientos: 1, lineas: [], textoDelBoton: "x" },
              yaCobrada: false,
            },
          };
        }
        return { exploracion: null, ultima: null };
      }
      return v;
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<SesionPodologia appointmentId={CITA} />);
  });
}

function texto(): string {
  return host.textContent ?? "";
}

function botones(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")] as HTMLButtonElement[];
}

function botonPorTexto(t: string): HTMLButtonElement | undefined {
  return botones().find((b) => (b.textContent ?? "").trim() === t);
}

/** Un botón cuyo texto CONTIENE esto.
 *
 *  Hace falta para los botones de acto: al marcarse ganan un «✓» dentro,
 *  así que su `textContent` cambia y el match exacto deja de encontrarlos
 *  — que es justo lo que hay que poder hacer para desmarcarlos. */
function botonQueContiene(t: string): HTMLButtonElement | undefined {
  return botones().find((b) => (b.textContent ?? "").includes(t));
}

/** Un botón dentro de UNA comprobación del pie de riesgo, por el título
 *  de la comprobación.
 *
 *  Por caja y no por texto: «Sí» y «No» salen cuatro veces en esa tarjeta
 *  (los dos pulsos, la úlcera y la deformidad), y buscar por texto cogería
 *  siempre el primero — que es el error que haría pasar el test con las
 *  comprobaciones cruzadas. Misma lección que el `pulsoMarcado` de
 *  clinica-3. */
function enComprobacion(titulo: string, etiqueta: string): HTMLButtonElement {
  const caja = [...host.querySelectorAll("div")].find(
    (d) => (d.firstElementChild?.textContent ?? "") === titulo,
  );
  if (!caja) throw new Error(`no hay comprobación «${titulo}»`);
  const b = [...caja.querySelectorAll("button")].find(
    (x) => (x.textContent ?? "").trim() === etiqueta,
  );
  if (!b) throw new Error(`no hay «${etiqueta}» en «${titulo}»`);
  return b as HTMLButtonElement;
}

/** Los chips de tipo viven en su propio contenedor, así que se buscan
 *  ahí: «Quiropodia» es también parte del nombre de tres servicios y
 *  buscar por texto en todo el DOM cogería el que no es. */
function chipDeTipo(nombre: string): HTMLButtonElement {
  const caja = host.querySelector('[data-test="chips-de-tipo"]');
  if (!caja) throw new Error("no hay chips de tipo");
  const b = [...caja.querySelectorAll("button")].find((x) =>
    (x.textContent ?? "").includes(nombre),
  );
  if (!b) throw new Error(`no hay chip de ${nombre}`);
  return b as HTMLButtonElement;
}

/** El pulso marcado en la fila de un pie, por su etiqueta. */
function pulsoMarcado(pie: "izquierdo" | "derecho"): string | undefined {
  const fila = [...host.querySelectorAll("div")].find(
    (d) =>
      d.children.length === 2 && d.children[0]?.textContent === `Pie ${pie}`,
  );
  if (!fila) throw new Error(`no hay fila del pie ${pie}`);
  return [...fila.querySelectorAll("button")]
    .find((b) => b.getAttribute("aria-pressed") === "true")
    ?.textContent?.trim();
}

async function pulsar(b: HTMLElement | undefined) {
  if (!b) throw new Error("botón no encontrado");
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** El cuerpo del último POST al cierre. */
function cuerpoDelCierre(): Record<string, unknown> {
  const ultimo = [...enviado].reverse().find((e) => e.url.endsWith("/cerrar"));
  if (!ultimo) throw new Error("no se ha cerrado nada");
  return ultimo.body as Record<string, unknown>;
}

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

// ── 1 · LOS IMPORTES, SEGÚN ROL ─────────────────────────────────────

describe("clinica-5 · el sanitario sin caja no ve importes en la pantalla", () => {
  it("ni un euro en todo el DOM, y el botón dice «Cerrar sesión»", async () => {
    await montar(vista({ verImportes: false }));
    // Con un acto marcado, la barra de caja enseñaría el nivel y su
    // precio: es el momento en el que un `?? 0` se vería.
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(botonPorTexto("4"));

    expect(texto()).not.toContain("€");
    // Ni un «0,00», que es lo que saldría de un `?? 0`.
    expect(texto()).not.toMatch(/\d+,\d\d\s*€/);
    expect(texto()).not.toMatch(/iva/i);
    expect(botonPorTexto("Cerrar sesión")).toBeDefined();
    expect(botonPorTexto("Cerrar sesión y cobrar")).toBeUndefined();
    // Pero SÍ qué pasa a caja, por su nombre: tiene que poder ver qué se
    // le hizo.
    expect(texto()).toContain("Quiropodia básica");
  });

  it("y el selector de nivel dice «sin servicio» en vez de un precio", async () => {
    await montar(vista({ verImportes: false }));
    const nivel = host.querySelector('[data-test="nivel-de-quiropodia"]')!;
    expect(nivel.textContent).toContain("Básica");
    expect(nivel.textContent).not.toContain("€");
  });

  it("LA DUEÑA sí los ve, con el total y el IVA del catálogo", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(chipDeTipo("Cirugía"));
    await pulsar(botonPorTexto("Cura · 13,00 €"));
    await pulsar(botonPorTexto("4"));
    const pie = host.querySelector('[data-test="pie-de-sesion"]')!;
    expect(pie.textContent).toContain("Quiropodia básica · 25,00 €");
    expect(pie.textContent).toContain("Cura · 13,00 €");
    expect(pie.textContent).toContain("38,00 €");
    expect(pie.textContent).toContain("iva 0 %");
    expect(botonPorTexto("Cerrar sesión y cobrar")).toBeDefined();
  });

  it("y NUNCA dice «exento» si el catálogo no lo dice", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    expect(texto()).not.toMatch(/exent/i);
  });
});

// ── 2 · LOS CHIPS DE TIPO ───────────────────────────────────────────

describe("clinica-5 · los tipos de visita", () => {
  it("vienen marcados los de los servicios de la cita", async () => {
    await montar(vista({ verImportes: true }));
    expect(chipDeTipo("Quiropodia").getAttribute("aria-pressed")).toBe("true");
    expect(chipDeTipo("Cirugía").getAttribute("aria-pressed")).toBe("false");
    expect(texto()).toContain("se anotan y se cobran todos");
  });

  it("marcar otro AÑADE su tarjeta, sin quitar la primera", async () => {
    await montar(vista({ verImportes: true }));
    expect(texto()).toContain("Qué haces hoy");
    expect(texto()).not.toContain("Revisión de la cirugía");
    await pulsar(chipDeTipo("Cirugía"));
    expect(texto()).toContain("Qué haces hoy");
    expect(texto()).toContain("Revisión de la cirugía");
    // Y la cabecera de la tarjeta dice DE QUÉ cirugía habla.
    expect(texto()).toContain("Matricectomía parcial");
  });

  it("EL ÚLTIMO no se puede quitar: como mínimo uno", async () => {
    await montar(vista({ verImportes: true }));
    expect(chipDeTipo("Quiropodia").disabled).toBe(true);
    // Con dos marcados, los dos se pueden quitar.
    await pulsar(chipDeTipo("Cirugía"));
    expect(chipDeTipo("Quiropodia").disabled).toBe(false);
    expect(chipDeTipo("Cirugía").disabled).toBe(false);
    await pulsar(chipDeTipo("Quiropodia"));
    expect(texto()).not.toContain("Qué haces hoy");
    expect(chipDeTipo("Cirugía").disabled).toBe(true);
  });

  it("cada tipo lleva su tarjeta y las cinco se pueden abrir a la vez", async () => {
    await montar(vista({ verImportes: true }));
    for (const t of ["Pie de riesgo", "Cirugía", "Biomecánica", "General"]) {
      await pulsar(chipDeTipo(t));
    }
    for (const titulo of [
      "Qué haces hoy",
      "Pie de riesgo",
      "Revisión de la cirugía",
      "Biomecánica",
      "Visita general",
    ]) {
      expect(texto(), titulo).toContain(titulo);
    }
  });

  it("los tipos marcados viajan en el cierre, en el orden de la lista", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(chipDeTipo("General"));
    await pulsar(chipDeTipo("Cirugía"));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    expect(cuerpoDelCierre().tipos).toEqual([
      "QUIROPODIA",
      "CIRUGIA",
      "GENERAL",
    ]);
  });
});

// ── 3 · EL NIVEL DE QUIROPODIA ──────────────────────────────────────

describe("clinica-5 · el nivel sale de lo que se hace", () => {
  function nivelElegido(): string | undefined {
    const caja = host.querySelector('[data-test="nivel-de-quiropodia"]')!;
    return [...caja.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-pressed") === "true")
      ?.textContent?.trim();
  }

  it("sin nada marcado propone la básica y lo dice", async () => {
    await montar(vista({ verImportes: true }));
    expect(nivelElegido()).toContain("Básica");
    expect(texto()).toContain("Todavía no has marcado nada");
  });

  it("la enucleación sube a completa, y el fresado a extra", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    expect(nivelElegido()).toContain("Completa");
    expect(texto()).toContain("por el enucleación (helomas)");
    await pulsar(botonPorTexto("Fresadouñas gruesas"));
    expect(nivelElegido()).toContain("Extra");
  });

  it("la barra de caja cambia DE PRODUCTO con el nivel", async () => {
    await montar(vista({ verImportes: true }));
    const pie = () =>
      host.querySelector('[data-test="pie-de-sesion"]')!.textContent ?? "";
    await pulsar(botonPorTexto("Corte de uñas"));
    expect(pie()).toContain("Quiropodia básica · 25,00 €");
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    expect(pie()).toContain("Quiropodia completa · 26,00 €");
    expect(pie()).not.toContain("Quiropodia básica");
  });

  it("cambiarlo a mano queda escrito, y se manda el nivel elegido", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    const caja = host.querySelector('[data-test="nivel-de-quiropodia"]')!;
    const extra = [...caja.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Extra"),
    )!;
    await pulsar(extra as HTMLElement);
    expect(texto()).toContain("lo propuesto era completa");

    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    const bloques = cuerpoDelCierre().bloques as Record<string, any>;
    expect(bloques.QUIROPODIA.nivelElegido).toBe(3);
    expect(bloques.QUIROPODIA.actos).toEqual(["corte", "helomas"]);
    // `nivelPropuesto` y `productoDelNivel` NO se mandan: los calcula el
    // servidor. Dejar que la pantalla los mande sería dejarle elegir qué
    // se cobra sin pasar por la regla.
    expect(bloques.QUIROPODIA.nivelPropuesto).toBeUndefined();
    expect(bloques.QUIROPODIA.productoDelNivel).toBeUndefined();
  });

  it("tocar OTRO acto suelta el nivel puesto a mano", async () => {
    // Si no, la frase de «cambiado a mano» mentiría sobre qué se había
    // propuesto.
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    const caja = () => host.querySelector('[data-test="nivel-de-quiropodia"]')!;
    const extra = [...caja().querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Extra"),
    )!;
    await pulsar(extra as HTMLElement);
    expect(texto()).toContain("lo propuesto era básica");
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    expect(texto()).not.toContain("Cambiado a mano");
    expect(nivelElegido()).toContain("Completa");
  });

  it("los tres niveles NO salen como chips sueltos de «y además»", async () => {
    await montar(vista({ verImportes: true }));
    expect(botonPorTexto("Quiropodia básica · 25,00 €")).toBeUndefined();
    expect(botonPorTexto("Tratamiento de papiloma · 30,00 €")).toBeDefined();
  });
});

// ── 4 · EL PIE DE RIESGO ────────────────────────────────────────────

describe("clinica-5 · el riesgo del pie (IWGDF)", () => {
  async function conPieDeRiesgo() {
    await montar(vista({ verImportes: true }));
    await pulsar(chipDeTipo("Pie de riesgo"));
  }

  function veredicto(): string {
    return (
      host.querySelector('[data-test="riesgo-del-pie"]')?.textContent ?? ""
    );
  }

  it("mientras falte una comprobación, dice CUÁL falta", async () => {
    await conPieDeRiesgo();
    expect(texto()).toContain("Falta la sensibilidad, los pulsos");
    expect(veredicto()).toBe("");
  });

  /** Contesta las cuatro, cada una en su caja. */
  async function contestarLasCuatro(opts: {
    sensibilidad: "Normal" | "Pérdida";
    pulsoIzq: "Sí" | "No";
    ulcera: "Sí" | "No";
    deformidad: "Sí" | "No";
  }) {
    await pulsar(enComprobacion("Sensibilidad (monofilamento)", opts.sensibilidad));
    const pulsos = [...host.querySelectorAll("div")].filter((d) =>
      ["Izq", "Der"].includes(d.children[0]?.textContent ?? ""),
    );
    await pulsar(
      [...pulsos[0]!.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === opts.pulsoIzq,
      ) as HTMLElement,
    );
    await pulsar(
      [...pulsos[1]!.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Sí",
      ) as HTMLElement,
    );
    await pulsar(enComprobacion("¿Úlcera previa o actual?", opts.ulcera));
    await pulsar(enComprobacion("¿Deformidad del pie?", opts.deformidad));
  }

  it("con las cuatro normales: riesgo muy bajo y revisión anual", async () => {
    await conPieDeRiesgo();
    await contestarLasCuatro({
      sensibilidad: "Normal",
      pulsoIzq: "Sí",
      ulcera: "No",
      deformidad: "No",
    });
    expect(veredicto()).toContain("Riesgo muy bajo");
    expect(veredicto()).toContain("Revisión anual");
  });

  it("pérdida de sensibilidad + úlcera: riesgo alto, y el motivo lo explica", async () => {
    await conPieDeRiesgo();
    await contestarLasCuatro({
      sensibilidad: "Pérdida",
      pulsoIzq: "Sí",
      ulcera: "Sí",
      deformidad: "No",
    });
    expect(veredicto()).toContain("Riesgo alto");
    expect(veredicto()).toContain("Revisión cada 1–3 meses");
    expect(veredicto()).toMatch(/úlcera/i);
    expect(veredicto()).toContain("no se reserva sola");
  });

  it("la DEFORMIDAD sola no sube el riesgo, y la tarjeta lo dice", async () => {
    await conPieDeRiesgo();
    await contestarLasCuatro({
      sensibilidad: "Normal",
      pulsoIzq: "Sí",
      ulcera: "No",
      deformidad: "Sí",
    });
    expect(veredicto()).toContain("Riesgo muy bajo");
    expect(veredicto()).toMatch(/la deformidad sola no sube/i);
  });

  it("y las cuatro viajan en el cierre, sin el veredicto", async () => {
    await conPieDeRiesgo();
    await contestarLasCuatro({
      sensibilidad: "Pérdida",
      pulsoIzq: "No",
      ulcera: "No",
      deformidad: "No",
    });
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    const b = (cuerpoDelCierre().bloques as Record<string, any>).PIE_RIESGO;
    expect(b).toEqual({
      sensibilidad: "PERDIDA",
      pulsos: { L: "AUSENTE", R: "PRESENTE" },
      ulcera: "NO",
      deformidad: "NO",
      servicios: [],
    });
    // El veredicto lo calcula el SERVIDOR: no se manda.
    expect(b.riesgo).toBeUndefined();
  });

  it("y la guía se cita en la tarjeta, con su «pendiente de validar»", async () => {
    await conPieDeRiesgo();
    expect(texto()).toContain("IWGDF");
    expect(texto()).toMatch(/pendiente de validar/i);
  });

  it("el pie de riesgo sin servicio asignado se ve «sin cobro»", async () => {
    // En este catálogo no hay ningún servicio de la categoría de pie de
    // riesgo: la visita se anota y no se cobra (regla 11).
    await conPieDeRiesgo();
    expect(texto()).toContain("sin cobro");
    await pulsar(botonPorTexto("4"));
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(false);
  });

  it("enciende la capa de sensibilidad del mapa, y es de LECTURA", async () => {
    const v = vista({ verImportes: true });
    v.exploracion = {
      departeDe: {
        pulsos: { L: "PRESENTE", R: "PRESENTE" },
        sinSensibilidad: [ZONA],
        tipoDePie: "NORMAL",
      },
      ultima: { fecha: "2026-03-01T10:00:00.000Z", autor: "Lucía Martín" },
    };
    await montar(v);
    // Sin pie de riesgo, el selector de capa no existe.
    expect(botonPorTexto("Sensibilidad")).toBeUndefined();
    await pulsar(chipDeTipo("Pie de riesgo"));
    await pulsar(botonPorTexto("Sensibilidad"));
    expect(
      host.querySelector(`[data-zona="${ZONA}"]`)!.getAttribute("class"),
    ).toContain("fill-red-500");
    expect(texto()).toContain("haz una exploración nueva en su pestaña");
    // Y tocar la zona en esta capa NO abre el panel de lesiones.
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    expect(texto()).not.toContain("elige antes la lesión");
  });
});

// ── 5 · LAS ALERTAS CRUZADAS, EN EL MOMENTO ─────────────────────────

describe("clinica-5 · el aviso aparece al marcar lo que choca", () => {
  function avisos(): string[] {
    return [...host.querySelectorAll('[data-test="aviso-cruzado"]')].map(
      (x) => x.textContent ?? "",
    );
  }

  it("anticoagulada + enucleación: avisa DENTRO de la tarjeta de quiropodia", async () => {
    await montar(vista({ verImportes: true }));
    expect(avisos()).toEqual([]);
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toMatch(/anticoagulada/i);
    expect(avisos()[0]).toMatch(/hemostático/i);
  });

  it("y se va al desmarcar el acto", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonQueContiene("Enucleación"));
    expect(avisos()).toHaveLength(1);
    // Por texto PARCIAL: el botón marcado gana un «✓» dentro.
    await pulsar(botonQueContiene("Enucleación"));
    expect(avisos()).toEqual([]);
  });

  it("corte y deslaminado NO avisan: no cortan carne", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(botonPorTexto("Deslaminadodurezas"));
    expect(avisos()).toEqual([]);
  });

  it("diabética + signos de infección: avisa en la tarjeta de cirugía", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(chipDeTipo("Cirugía"));
    await pulsar(botonPorTexto("Signos de infección"));
    const textos = avisos().join(" ");
    expect(textos).toMatch(/48 h/);
    expect(textos).toMatch(/derivar/i);
  });

  it("sin la alerta en la valoración, no avisa aunque se enuclee", async () => {
    const v = vista({ verImportes: true });
    v.cabecera.alertaIds = ["aler"];
    await montar(v);
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    expect(avisos()).toEqual([]);
  });

  it("los avisos NO viajan en el cierre: los calcula el servidor", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Enucleaciónhelomas"));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    expect(cuerpoDelCierre().avisos).toBeUndefined();
  });
});

// ── 6 · «HOY TOCA» Y EL PENDIENTE QUE NO SE CAE ─────────────────────

describe("clinica-5 · «Hoy toca»", () => {
  function banda(): string {
    return host.querySelector('[data-test="hoy-toca"]')?.textContent ?? "";
  }

  it("sale arriba, con su zona y cuánto lleva apuntado", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    expect(banda()).toContain("Hoy toca: Revisar la uña operada");
    expect(banda()).toContain("Pie izq. · Dedo gordo");
    expect(banda()).toMatch(/apuntado hace/);
  });

  it("sin pendientes no hay banda", async () => {
    await montar(vista({ verImportes: true }));
    expect(host.querySelector('[data-test="hoy-toca"]')).toBeNull();
  });

  it("se marca HECHO SOLO al tocar esa zona, y ya no se puede desmarcar", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    await pulsar(botonPorTexto("Uña encarnada"));
    expect(banda()).toContain("Hecho: revisar la uña operada");
    expect(banda()).toContain("al tocar esa zona");
    const boton = host.querySelector(
      '[data-test="hoy-toca"] button',
    ) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });

  it("tocar OTRA zona no lo cierra", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    await pulsar(host.querySelector('[data-zona="R:talon"]') as HTMLElement);
    await pulsar(botonPorTexto("Dureza"));
    expect(banda()).toContain("Hoy toca:");
  });

  it("se puede marcar A MANO tocando la banda, y desmarcar", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    const boton = () =>
      host.querySelector('[data-test="hoy-toca"] button') as HTMLButtonElement;
    await pulsar(boton());
    expect(banda()).toContain("Hecho:");
    await pulsar(boton());
    expect(banda()).toContain("Hoy toca:");
  });

  it("CERRAR con el pendiente sin hacer PREGUNTA, y no manda nada todavía", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    const dialogo = host.querySelector('[data-test="dialogo-de-pendiente"]');
    expect(dialogo).not.toBeNull();
    expect(dialogo!.textContent).toContain("¿Has revisado la uña operada?");
    expect(enviado.filter((e) => e.url.endsWith("/cerrar"))).toHaveLength(0);
  });

  it("«Sí, hecho» cierra Y manda el pendiente cerrado como PREGUNTA", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    await pulsar(botonPorTexto("Sí, hecho"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(cuerpoDelCierre().pendientesCerrados).toEqual([
      { id: "revisar_una", zona: ZONA, como: "PREGUNTA" },
    ]);
  });

  it("«Todavía no» cierra IGUAL y no lo marca: pasa a la siguiente", async () => {
    // No es un bloqueo: es que nadie se entere tarde. El arrastre lo hace
    // el servidor, que es lo que garantiza que no se cae.
    await montar(vista({ verImportes: true, conPendiente: true }));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    await pulsar(botonPorTexto("Todavía no"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(cuerpoDelCierre().pendientesCerrados).toEqual([]);
  });

  it("si ya se cerró solo, el cierre NO pregunta", async () => {
    await montar(vista({ verImportes: true, conPendiente: true }));
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    await pulsar(botonPorTexto("Uña encarnada"));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    expect(host.querySelector('[data-test="dialogo-de-pendiente"]')).toBeNull();
    expect(enviado.filter((e) => e.url.endsWith("/cerrar"))).toHaveLength(1);
  });
});

describe("clinica-5 · «Para la próxima visita»", () => {
  it("apunta lo que no pide zona con un toque", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Control de pie de riesgo"));
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    expect(cuerpoDelCierre().pendientesNuevos).toEqual([
      { id: "control_riesgo", zona: null, nota: null },
    ]);
  });

  it("lo que PIDE ZONA está desactivado hasta tocar una, y lo dice", async () => {
    await montar(vista({ verImportes: true }));
    expect(botonPorTexto("Revisar la uña operada")!.disabled).toBe(true);
    expect(texto()).toContain("Toca primero la zona del pie");
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    expect(botonPorTexto("Revisar la uña operada")!.disabled).toBe(false);
  });

  it("y se queda con la zona tocada", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    await pulsar(botonPorTexto("Revisar la uña operada"));
    // Y el chip, una vez puesto, enseña a qué zona apunta.
    expect(botonQueContiene("Revisar la uña operada")!.textContent).toContain(
      "Pie izq. · Dedo gordo",
    );
    await pulsar(botonPorTexto("4"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    expect(cuerpoDelCierre().pendientesNuevos).toEqual([
      { id: "revisar_una", zona: ZONA, nota: null },
    ]);
  });
});

// ── 7 · LO DE CLINICA-3 QUE SIGUE SIENDO VERDAD ─────────────────────

describe("clinica-3 · «igual que la última vez»", () => {
  it("trae las marcas del pie de la visita anterior", async () => {
    await montar(vista({ verImportes: true }));
    expect(texto()).not.toContain("Uña encarnada (moderada)");
    await pulsar(botonPorTexto("↺ Igual que la última vez"));
    expect(texto()).toContain("Pie izq. · Dedo gordo");
    expect(texto()).toContain("Uña encarnada (moderada)");
  });

  it("y los consejos, sin desmarcar lo de hoy", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Hidratar cada día"));
    await pulsar(botonPorTexto("↺ Igual que la última vez"));
    expect(
      botonPorTexto("Calzado ancho")!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      botonPorTexto("Hidratar cada día")!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("está DESACTIVADO en la primera visita: no hay última", async () => {
    await montar(vista({ verImportes: true, conAnterior: false }));
    expect(botonPorTexto("↺ Igual que la última vez")!.disabled).toBe(true);
  });
});

describe("clinica-3 · la gravedad se elige después de la lesión", () => {
  it("al tocar una zona, los tres chips están desactivados y se dice por qué", async () => {
    await montar(vista({ verImportes: true }));
    const zona = host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement;
    expect(zona).not.toBeNull();
    await pulsar(zona);
    expect(texto()).toContain("elige antes la lesión");
    for (const g of ["Leve", "Moderada", "Severa"]) {
      expect(botonPorTexto(g)!.disabled, g).toBe(true);
    }
  });

  it("y se activan en cuanto se elige una lesión", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    await pulsar(botonPorTexto("Uña encarnada"));
    for (const g of ["Leve", "Moderada", "Severa"]) {
      expect(botonPorTexto(g)!.disabled, g).toBe(false);
    }
    expect(texto()).not.toContain("elige antes la lesión");
  });

  it("«Quitar» borra la marca de esa zona", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(host.querySelector(`[data-zona="${ZONA}"]`) as HTMLElement);
    await pulsar(botonPorTexto("Uña encarnada"));
    await pulsar(botonPorTexto("Moderada"));
    expect(texto()).toContain("Uña encarnada (moderada)");
    await pulsar(botonPorTexto("Quitar"));
    expect(texto()).not.toContain("Uña encarnada (moderada)");
  });
});

describe("clinica-3 · el mapa de los dos pies", () => {
  it("tiene las 22 zonas, once por pie, y cada una con su nombre completo", async () => {
    await montar(vista({ verImportes: true }));
    const zonas = [...host.querySelectorAll("[data-zona]")];
    expect(zonas).toHaveLength(22);
    const etiquetas = zonas.map((z) => z.getAttribute("aria-label"));
    expect(etiquetas).toContain("Pie izquierdo · Dedo gordo");
    expect(etiquetas).toContain("Pie derecho · Talón");
    for (const z of zonas) {
      expect(z.getAttribute("role")).toBe("button");
      expect(z.getAttribute("tabindex")).toBe("0");
    }
  });

  it("NINGUNA zona baja de 48 px a la escala a la que se pinta el pie", async () => {
    // La cuenta, sobre la geometría que el DOM lleva puesta y no sobre una
    // constante: radio × 2 × (ancho del pie en px / ancho del viewBox).
    // El mínimo del prompt es 44 px; el de la casa, 48.
    await montar(vista({ verImportes: true }));
    const escala = ANCHO_DEL_PIE_PX / VIEWBOX.ancho;
    const zonas = [...host.querySelectorAll("ellipse[data-zona]")];
    expect(zonas.length).toBeGreaterThan(0);
    for (const z of zonas) {
      const rx = Number(z.getAttribute("rx"));
      const ry = Number(z.getAttribute("ry"));
      const etiqueta = z.getAttribute("aria-label");
      expect(2 * rx * escala, `ancho de ${etiqueta}`).toBeGreaterThanOrEqual(48);
      expect(2 * ry * escala, `alto de ${etiqueta}`).toBeGreaterThanOrEqual(48);
    }
  });

  it("y el SVG no se pinta por encima de su ancho nominal", async () => {
    await montar(vista({ verImportes: true }));
    const svgs = [...host.querySelectorAll("svg[viewBox]")].filter(
      (s) =>
        s.getAttribute("viewBox") === `0 0 ${VIEWBOX.ancho} ${VIEWBOX.alto}`,
    );
    expect(svgs).toHaveLength(2);
    for (const s of svgs) {
      expect((s as SVGElement).style.maxWidth).toBe(`${ANCHO_DEL_PIE_PX}px`);
    }
  });

  it("lo de la visita anterior se pinta en naranja SUAVE y lo de hoy en pleno", async () => {
    await montar(vista({ verImportes: true }));
    expect(
      host.querySelector(`[data-zona="${ZONA}"]`)!.getAttribute("class"),
    ).toContain("coral-soft");
    await pulsar(host.querySelector('[data-zona="R:talon"]') as HTMLElement);
    await pulsar(botonPorTexto("Dureza"));
    const hoy = host.querySelector('[data-zona="R:talon"]')!;
    expect(hoy.getAttribute("class")).toContain("fill-mipiace-coral ");
    expect(hoy.getAttribute("class")).not.toContain("coral-soft");
  });
});

describe("clinica-3 · la franja de alertas", () => {
  it("es ROJA INTENSA, dice «Cuidado» y se anuncia como alerta", async () => {
    await montar(vista({ verImportes: true }));
    const franja = host.querySelector('[role="alert"]');
    expect(franja).not.toBeNull();
    expect(franja!.getAttribute("class")).toContain("bg-red-700");
    expect(franja!.textContent).toContain("Cuidado");
    for (const a of ["Diabetes", "Anticoagulación", "Alergia: látex"]) {
      expect(franja!.textContent).toContain(a);
    }
  });

  it("sin alertas no hay franja roja, y se dice «Sin alertas»", async () => {
    const v = vista({ verImportes: true });
    v.cabecera.alertas = [];
    v.cabecera.alertaIds = [];
    await montar(v);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(texto()).toContain("Sin alertas");
  });
});

describe("clinica-3 · sin valoración validada no se cierra la sesión", () => {
  it("se enseña «Falta validar la valoración inicial» con el motivo", async () => {
    await montar(vista({ verImportes: true, puertaAbierta: false }));
    expect(texto()).toContain("Falta validar la valoración inicial");
    expect(texto()).toContain("válidala antes del primer tratamiento");
  });

  it("y el botón de cerrar NO se activa ni con todo marcado", async () => {
    await montar(vista({ verImportes: true, puertaAbierta: false }));
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(botonPorTexto("4"));
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(true);
  });

  it("pero se dice que la EXPLORACIÓN sí se puede registrar", async () => {
    await montar(vista({ verImportes: true, puertaAbierta: false }));
    expect(texto()).toContain("La exploración del pie sí se puede registrar");
  });
});

describe("clinica-3 · el dolor", () => {
  it("sin dolor no se puede cerrar, y el pie lo dice", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    expect(texto()).toContain("Falta el dolor de hoy");
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(true);
  });

  it("CERO vale: «ya no me duele» es una respuesta", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Corte de uñas"));
    await pulsar(botonPorTexto("0"));
    expect(texto()).not.toContain("Falta el dolor de hoy");
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(false);
  });

  it("y la barra de hoy entra en la gráfica en cuanto se marca", async () => {
    await montar(vista({ verImportes: true }));
    expect(
      [...host.querySelectorAll('[aria-label*="Hoy"]')].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toContain("Hoy: sin marcar");
    await pulsar(botonPorTexto("6"));
    expect(
      [...host.querySelectorAll('[aria-label*="Hoy"]')].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toContain("Hoy: 6 de 10");
  });
});

describe("clinica-3 · la exploración sigue en su pestaña", () => {
  it("tiene su propio botón de guardar, y el mapa cambia de significado", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Exploración"));
    expect(texto()).toContain("Toca los puntos donde NO siente el filamento");
    expect(botonPorTexto("Guardar exploración")).toBeDefined();
    // Y en esta pestaña NO hay barra de caja ni chips de tipo: no se
    // cierra desde aquí.
    expect(botonPorTexto("Cerrar sesión y cobrar")).toBeUndefined();
    expect(host.querySelector('[data-test="chips-de-tipo"]')).toBeNull();
  });

  it("arranca con lo de la última exploración, no en blanco", async () => {
    const v = vista({ verImportes: true });
    v.exploracion = {
      departeDe: {
        pulsos: { L: "DEBIL", R: "AUSENTE" },
        sinSensibilidad: [ZONA],
        tipoDePie: "CAVO",
      },
      ultima: { fecha: "2026-03-01T10:00:00.000Z", autor: "Lucía Martín" },
    };
    await montar(v);
    await pulsar(botonPorTexto("Exploración"));
    // POR FILA y no por texto: «Débil» y «Ausente» salen DOS veces, una
    // por pie, y buscar por texto cogería siempre la del izquierdo — que
    // es justo el error que haría pasar el test con los dos pulsos
    // confundidos.
    expect(pulsoMarcado("izquierdo")).toBe("Débil");
    expect(pulsoMarcado("derecho")).toBe("Ausente");
    expect(botonPorTexto("Cavo")!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("clinica-3 · la cabecera son fichas con título", () => {
  it("cada dato con su etiqueta encima", async () => {
    await montar(vista({ verImportes: true }));
    const t = texto();
    expect(t).toContain("Carmen Rodríguez López");
    for (const etiqueta of [
      "Edad",
      "Cita de hoy",
      "Visita",
      "Atiende",
      "Teléfono",
    ]) {
      expect(t, etiqueta).toContain(etiqueta);
    }
    expect(t).toContain("78 años");
    expect(t).toContain("3.ª");
    expect(t).toContain("Lucía Martín");
  });

  it("sin fecha de nacimiento, la ficha de edad NO se pinta", async () => {
    // Una edad inventada en una historia clínica es peor que un hueco.
    const v = vista({ verImportes: true });
    v.cabecera.paciente.edad = null;
    await montar(v);
    expect(texto()).not.toContain("Edad");
  });
});
