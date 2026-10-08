// clinica-6 · la historia viva, montada de verdad.
//
// Lo que se fija aquí es lo que un test de API no puede ver:
//
//   1. **En 10 segundos**: la franja roja, «Hoy toca», el dolor, la última
//      vez y el «ojo hoy» están los cinco en el DOM al abrir, sin tocar
//      nada.
//   2. **«Hoy toca» se pulsa y abre la hoja con el tipo del pendiente ya
//      recomendado**, y elegirlo abre la sesión con ese tipo marcado.
//   3. **Sin cita detrás NO SALE el botón**: dice dónde se empieza, en vez
//      de ofrecer lo que no puede cumplir.
//   4. **Sin pendientes, la tarjeta dice «Nada pendiente» y no late.**
//   5. **El pie vivo** pinta cada zona de su color, se toca y sale su
//      línea de evolución — con las 22 zonas y su mínimo táctil.
//   6. **Las fotos son de clinica-4**: el hueco lo dice y no hay subida.
//   7. **Una v1 sale como «Sesión»** en la lista, sin tipo.
//   8. **NI UN IMPORTE en el DOM**, ni para la dueña: es historia, no
//      caja.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot +
// act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANCHO_DEL_PIE_PX,
  ANCHO_DE_LOS_DOS_PIES_PX,
  MAPA_PIE_V1,
  VIEWBOX,
} from "@mipiacetpv/clinica-sesion";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import {
  COLUMNA_DEL_PIE_PX,
  HistoriaViva,
} from "../src/clinica/HistoriaViva.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PACIENTE = "44444444-4444-4444-4444-444444444444";
const ZONA = "L:h";
const AHORA = "2026-10-08T09:00:00.000Z";

type Vista = Record<string, unknown>;

/** La respuesta de `GET …/historia`, con los huecos de Carmen rellenos. */
function vista(opts: {
  conPendiente?: boolean;
  variosPendientes?: boolean;
  conZonas?: boolean;
  conV1?: boolean;
  sinAlertas?: boolean;
} = {}): Vista {
  const pendientes = opts.variosPendientes
    ? [
        {
          id: "revisar_una",
          titulo: "Revisar la uña operada",
          zona: "Pie izq. · Dedo gordo",
          nota: null,
          pregunta: "¿Has revisado la uña operada?",
          desde: "2026-09-08T09:00:00.000Z",
        },
      ]
    : [];
  return {
    cabecera: {
      paciente: {
        id: PACIENTE,
        nombre: "Carmen Rodríguez López",
        iniciales: "CR",
        edad: 78,
        telefono: "600123456",
        desde: "2026-09-01T08:00:00.000Z",
      },
      alertas: opts.sinAlertas
        ? []
        : ["Diabetes", "Anticoagulación", "Alergia: látex"],
      alertaIds: opts.sinAlertas ? [] : ["diab", "antic", "aler"],
      alertasPorValidar: false,
    },
    enDiezSegundos: {
      hoyToca:
        opts.conPendiente === false
          ? null
          : opts.conPendiente || opts.variosPendientes
            ? {
                principal: pendientes[0] ?? {
                  id: "revisar_una",
                  titulo: "Revisar la uña operada",
                  zona: "Pie izq. · Dedo gordo",
                  nota: null,
                  pregunta: "¿Has revisado la uña operada?",
                  desde: "2026-09-08T09:00:00.000Z",
                },
                otros: opts.variosPendientes ? 2 : 0,
                tipo: "CIRUGIA",
              }
            : null,
      dolor: {
        puntos: [
          { fecha: "2026-09-07T09:00:00.000Z", dolor: 7 },
          { fecha: "2026-09-21T09:00:00.000Z", dolor: 5 },
          { fecha: "2026-10-06T09:00:00.000Z", dolor: 3 },
        ],
        ultimo: 3,
        anterior: 5,
        texto: "Mejora en cada visita",
      },
      ultimaVez: {
        entryId: "v3",
        fecha: "2026-10-06T09:00:00.000Z",
        tipos: ["CIRUGIA"],
        tiposNombre: ["Cirugía · revisión"],
        titulo: "Cirugía · revisión",
        nivel: null,
        nivelNombre: null,
        dolor: 3,
        evolucion: "MEJOR",
        evolucionNombre: "Mejor",
        chips: ["Matricectomía parcial"],
      },
      ojoHoy: opts.sinAlertas
        ? null
        : {
            alertaId: "antic",
            titulo: "Anticoagulación",
            linea: "Anticoagulada: más sangrado al cortar. Ten a mano hemostático.",
          },
    },
    zonas:
      opts.conZonas === false
        ? []
        : [
            {
              clave: ZONA,
              pie: "L",
              zonaId: "h",
              nombre: "Pie izq. · Dedo gordo",
              estado: "MEJORANDO",
              lesion: "unero",
              lesionNombre: "Uña encarnada",
              gravedad: "LEVE",
              gravedadNombre: "Leve",
              pasos: [
                {
                  entryId: "v1",
                  fecha: "2026-09-07T09:00:00.000Z",
                  lesion: "unero",
                  lesionNombre: "Uña encarnada",
                  gravedad: "MODERADA",
                  gravedadNombre: "Moderada",
                  tipos: ["QUIROPODIA"],
                  tiposNombre: ["Quiropodia"],
                },
                {
                  entryId: "v3",
                  fecha: "2026-10-06T09:00:00.000Z",
                  lesion: "unero",
                  lesionNombre: "Uña encarnada",
                  gravedad: "LEVE",
                  gravedadNombre: "Leve",
                  tipos: ["CIRUGIA"],
                  tiposNombre: ["Cirugía · revisión"],
                },
              ],
              curadaEn: null,
            },
            {
              clave: "R:talon",
              pie: "R",
              zonaId: "talon",
              nombre: "Pie der. · Talón",
              estado: "CURADA",
              lesion: "dureza",
              lesionNombre: "Dureza",
              gravedad: "LEVE",
              gravedadNombre: "Leve",
              pasos: [
                {
                  entryId: "v1",
                  fecha: "2026-09-07T09:00:00.000Z",
                  lesion: "dureza",
                  lesionNombre: "Dureza",
                  gravedad: "LEVE",
                  gravedadNombre: "Leve",
                  tipos: ["QUIROPODIA"],
                  tiposNombre: ["Quiropodia"],
                },
              ],
              curadaEn: { entryId: "v2", fecha: "2026-09-21T09:00:00.000Z" },
            },
          ],
    sensibilidad: {
      fecha: "2026-09-21T09:00:00.000Z",
      autor: "Lucía Martín",
      sinSensibilidad: [],
      pulsos: { L: "PRESENTE", R: "PRESENTE" },
      tipoDePie: "NORMAL",
      puntosConSensibilidad: 22,
      puntosTotales: 22,
    },
    visitas: [
      {
        entryId: "v3",
        fecha: "2026-10-06T09:00:00.000Z",
        tipos: ["CIRUGIA"],
        tiposNombre: ["Cirugía · revisión"],
        titulo: "Cirugía · revisión",
        nivel: null,
        nivelNombre: null,
        dolor: 3,
        evolucion: "MEJOR",
        evolucionNombre: "Mejor",
        chips: ["Matricectomía parcial", "Evoluciona bien"],
      },
      ...(opts.conV1 === false
        ? []
        : [
            {
              entryId: "v1",
              fecha: "2026-09-07T09:00:00.000Z",
              tipos: [],
              tiposNombre: [],
              titulo: "Sesión",
              nivel: null,
              nivelNombre: null,
              dolor: 7,
              evolucion: null,
              evolucionNombre: null,
              chips: ["Deslaminado"],
            },
          ]),
    ],
    totalDeVisitas: opts.conV1 === false ? 1 : 2,
    documentos: [
      {
        clase: "VALORACION",
        titulo: "Valoración inicial · validada",
        fecha: "2026-09-02T09:00:00.000Z",
        detalles: ["Respondió un familiar", "1 corrección"],
        abre: "VALORACION",
      },
    ],
    recomendada: { tipo: "PIE_RIESGO", motivo: "Recomendada · tiene diabetes" },
    pendientes: [],
    listas: { mapa: MAPA_PIE_V1 },
    ahora: AHORA,
  };
}

let host: HTMLDivElement;
let root: Root;
let empezadas: string[][];

async function montar(
  v: Vista,
  opciones: { conCita?: boolean; detalle?: unknown } = {},
) {
  empezadas = [];
  apiMock.apiWithCashier.mockImplementation(async (url: string) => {
    if (url.includes("/historia/visitas/")) {
      return (
        opciones.detalle ?? {
          entryId: "v1",
          cerradaEn: "2026-09-07T09:00:00.000Z",
          firma: {
            autorNombre: "Lucía Martín",
            colegiado: "Col. 45-0312",
            firmadaEn: "2026-09-07T09:00:00.000Z",
          },
          cuerpo: {
            v: 1,
            dolor: 7,
            evolucion: null,
            consejos: [],
            proximaCita: null,
            nota: null,
            consejosVersion: 1,
          },
          marcas: [],
        }
      );
    }
    return v;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <HistoriaViva
        clientId={PACIENTE}
        onEmpezarVisita={
          opciones.conCita === false
            ? undefined
            : (tipos) => empezadas.push([...tipos])
        }
      />,
    );
  });
}

function texto(): string {
  return host.textContent ?? "";
}

function botones(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")] as HTMLButtonElement[];
}

function botonQueContiene(t: string): HTMLButtonElement | undefined {
  return botones().find((b) => (b.textContent ?? "").includes(t));
}

async function pulsar(b: Element | undefined) {
  if (!b) throw new Error("no hay botón que pulsar");
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function pestania(nombre: string) {
  const b = [...host.querySelectorAll('[role="tab"]')].find(
    (x) => (x.textContent ?? "").trim() === nombre,
  );
  await pulsar(b);
}

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// ── 1 · En 10 segundos ───────────────────────────────────────────────

describe("en 10 segundos", () => {
  it("al abrir ya están las cinco cosas, sin tocar nada", async () => {
    await montar(vista({ conPendiente: true }));
    const t = texto();
    // Quién es.
    expect(t).toContain("Carmen Rodríguez López");
    expect(t).toContain("78 años");
    expect(t).toContain("paciente desde");
    // La franja roja, con sus tres alertas.
    const franja = host.querySelector('[role="alert"]');
    expect(franja?.textContent).toContain("Cuidado");
    expect(franja?.textContent).toContain("Anticoagulación");
    // Las cuatro fichas.
    expect(t).toContain("HOY TOCA");
    expect(t).toContain("Revisar la uña operada");
    expect(t).toContain("DOLOR");
    expect(t).toContain("5 → 3");
    expect(t).toContain("Mejora en cada visita");
    expect(t).toContain("ÚLTIMA VEZ");
    expect(t).toContain("OJO HOY");
    expect(t).toContain("más sangrado al cortar");
  });

  it("y el pie vivo está abierto de entrada, con su zona", async () => {
    await montar(vista({ conPendiente: true }));
    expect(texto()).toContain("Cómo están sus pies");
    expect(texto()).toContain("Uña encarnada");
    expect(texto()).toContain("Mejorando");
  });
});

// ── 2, 3, 4 · «Hoy toca» ─────────────────────────────────────────────

describe("«hoy toca»", () => {
  it("con pendiente, el punto LATE", async () => {
    await montar(vista({ conPendiente: true }));
    expect(
      host.querySelector('[data-test="historia-hoy-toca"] .animate-ping'),
    ).not.toBeNull();
  });

  it("se pulsa, y la hoja llega con el tipo del pendiente recomendado", async () => {
    await montar(vista({ conPendiente: true }));
    await pulsar(host.querySelector('[data-test="historia-hoy-toca"]'));
    expect(texto()).toContain("¿Qué visita es hoy?");
    const cirugia = host.querySelector(
      '[data-test="historia-tipo-CIRUGIA"]',
    ) as HTMLElement;
    // La recomendada es la del pendiente, no la de la diabetes.
    expect(cirugia.textContent).toContain("Lo que toca hoy");
    await pulsar(cirugia);
    expect(empezadas).toEqual([["CIRUGIA"]]);
  });

  it("«Nueva visita» recomienda la del paciente cuando no hay pendiente", async () => {
    await montar(vista({ conPendiente: false }));
    await pulsar(host.querySelector('[data-test="historia-nueva-visita"]'));
    const riesgo = host.querySelector(
      '[data-test="historia-tipo-PIE_RIESGO"]',
    ) as HTMLElement;
    expect(riesgo.textContent).toContain("tiene diabetes");
  });

  it("con varios pendientes sale «+N» y el más antiguo de título", async () => {
    await montar(vista({ variosPendientes: true }));
    const tarjeta = host.querySelector('[data-test="historia-hoy-toca"]')!;
    expect(tarjeta.textContent).toContain("Revisar la uña operada");
    expect(tarjeta.textContent).toContain("+2");
  });

  it("SIN PENDIENTES dice «Nada pendiente» y no late", async () => {
    await montar(vista({ conPendiente: false }));
    const tarjeta = host.querySelector('[data-test="historia-hoy-toca"]');
    expect(tarjeta).toBeNull();
    expect(texto()).toContain("Nada pendiente");
    expect(host.querySelector(".animate-ping")).toBeNull();
  });

  it("SIN CITA DETRÁS no hay botón, y la pantalla dice dónde se empieza", async () => {
    await montar(vista({ conPendiente: true }), { conCita: false });
    expect(texto()).toContain("Revisar la uña operada");
    expect(texto()).toContain("ábrela desde su cita en la agenda");
    expect(botonQueContiene("Empezar esta revisión")).toBeUndefined();
    expect(botonQueContiene("Nueva visita")).toBeUndefined();
  });
});

// ── 5 y 6 · El pie vivo ──────────────────────────────────────────────

describe("el pie vivo", () => {
  it("pinta cada zona de su color y el resto en blanco", async () => {
    await montar(vista({ conPendiente: true }));
    const gordo = host.querySelector(`[data-zona="${ZONA}"]`)!;
    const talon = host.querySelector('[data-zona="R:talon"]')!;
    const libre = host.querySelector('[data-zona="L:arco"]')!;
    expect(gordo.getAttribute("class")).toContain("fill-amber-500");
    expect(talon.getAttribute("class")).toContain("fill-emerald-500");
    expect(libre.getAttribute("class")).toContain("fill-white");
  });

  it("tocar una zona abre SU línea de evolución", async () => {
    await montar(vista({ conPendiente: true }));
    await pulsar(host.querySelector('[data-zona="R:talon"]')!);
    const panel = host.querySelector('[data-test="historia-zona"]')!;
    expect(panel.textContent).toContain("Dureza");
    expect(panel.textContent).toContain("Pie der. · Talón");
    expect(panel.textContent).toContain("Curada");
    // El paso final: la visita en la que dejó de estar marcada.
    expect(panel.textContent).toContain("Ya no estaba marcada");
  });

  it("LAS FOTOS SON DE CLINICA-4: el hueco lo dice y no hay subida", async () => {
    await montar(vista({ conPendiente: true }));
    expect(texto()).toContain("Sin fotos de esta zona");
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });

  it("las 22 zonas pasan el mínimo táctil de la casa", async () => {
    await montar(vista({ conPendiente: true }));
    const zonas = [...host.querySelectorAll("[data-zona]")];
    expect(zonas).toHaveLength(MAPA_PIE_V1.zonas.length * 2);
    // La escala se lee DEL SVG QUE SE HA PINTADO, no de la constante del
    // paquete. La diferencia la encontró un sabotaje: encoger el pie a
    // 200 px dejaba la zona en 36,6 px y el test seguía verde, porque
    // calculaba sobre el ancho nominal — que seguía siendo correcto. Es
    // la misma trampa del §7.3 de clinica-3, y ahí la cazó la medición de
    // la captura en vez del test.
    // Y es EL SVG DEL PIE, no el primero del DOM: los iconos de lucide
    // también llevan `viewBox`, y el primero es el de la franja roja.
    const svg = zonas[0]!.closest("svg") as SVGElement;
    const ancho = Number.parseFloat(svg.style.maxWidth);
    expect(ancho).toBe(ANCHO_DEL_PIE_PX);
    const escala = ancho / VIEWBOX.ancho;
    for (const z of zonas) {
      const rx = Number(z.getAttribute("rx"));
      const ry = Number(z.getAttribute("ry"));
      expect(Math.min(2 * rx * escala, 2 * ry * escala)).toBeGreaterThanOrEqual(
        48,
      );
    }
  });

  it("LOS DOS PIES VAN EN UNA FILA de `lg` para arriba", async () => {
    // Lo encontró la revisión del PR sobre las capturas de 1024: con la
    // rejilla a `lg:grid-cols-2` la columna del pie eran 480 px, los dos
    // pies de 264 no cabían, el `flex-wrap` partía la fila y el pie
    // DERECHO se iba bajo el pliegue. Para ver el estado completo del pie
    // había que hacer scroll — justo lo que esta pantalla existe para no
    // pedir, y la maqueta validada los pone siempre lado a lado.
    //
    // Son las DOS mitades, y las dos hacen trabajo: la fila que no se
    // parte, y la columna que le reserva sitio para que no tenga que
    // encogerlos.
    await montar(vista({ conPendiente: true }));
    const fila = host.querySelector('[data-test="mapa-los-dos-pies"]')!;
    expect(fila.className).toContain("lg:flex-nowrap");
    const rejilla = host.querySelector('[data-test="historia-pie-vivo"]')!;
    expect(rejilla.className).toContain(
      `lg:grid-cols-[${COLUMNA_DEL_PIE_PX}px_minmax(0,1fr)]`,
    );
  });

  it("…y la columna es la pareja de pies más el padding de su tarjeta", () => {
    // La clase de arriba lleva el 576 LITERAL porque Tailwind lee el
    // fichero y no puede generar una clase construida en ejecución. Esto
    // es lo que impide que las dos copias se separen: si alguien encoge
    // el pie o cambia el hueco, el número de la clase deja de cuadrar.
    expect(ANCHO_DE_LOS_DOS_PIES_PX).toBe(2 * ANCHO_DEL_PIE_PX + 8);
    expect(COLUMNA_DEL_PIE_PX).toBe(ANCHO_DE_LOS_DOS_PIES_PX + 40);
    // Y la cuenta de verdad: a 264 por pie, la zona mide 48,4 px.
    expect((2 * 22 * ANCHO_DEL_PIE_PX) / VIEWBOX.ancho).toBeGreaterThanOrEqual(
      48,
    );
  });

  it("EL ESPEJO ES EL DEL PIE IZQUIERDO: los dedos gordos van hacia dentro", async () => {
    await montar(vista({ conPendiente: true }));
    // `CONTORNO_DEL_PIE` dibuja un pie con el dedo gordo a la izquierda
    // del lienzo, así que espejar el IZQUIERDO es lo que deja los dos
    // dedos gordos mirándose — como se ve un par de pies de frente, y
    // como lo pintan los tres mockups validados.
    const grupo = (clave: string) =>
      host
        .querySelector(`[data-zona="${clave}"]`)!
        .closest("g")!
        .getAttribute("transform");
    expect(grupo("L:h")).toContain("scale(-1,1)");
    expect(grupo("R:h")).toBeNull();
  });

  it("la capa de sensibilidad es de LECTURA y lo dice", async () => {
    await montar(vista({ conPendiente: true }));
    await pulsar(botonQueContiene("Sensibilidad"));
    const panel = host.querySelector('[data-test="historia-sensibilidad"]')!;
    expect(panel.textContent).toContain("22 de 22");
    expect(panel.textContent).toContain("Es de LECTURA");
  });

  it("un paciente sin marcas no enseña un pie vacío a secas", async () => {
    await montar(vista({ conZonas: false }));
    expect(texto()).toContain("Nunca se le ha marcado nada en el pie");
  });
});

// ── 7 · Las visitas ──────────────────────────────────────────────────

describe("las visitas", () => {
  it("UNA v1 sale como «Sesión», sin tipo y sin fingirlo", async () => {
    await montar(vista({ conPendiente: true }));
    await pestania("Visitas");
    const filas = [
      ...host.querySelectorAll('[data-test="historia-visita-fila"]'),
    ];
    expect(filas).toHaveLength(2);
    expect(filas[0]!.textContent).toContain("Cirugía · revisión");
    expect(filas[1]!.textContent).toContain("Sesión");
    expect(filas[1]!.textContent).toContain("Deslaminado");
  });

  it("tocar una visita abre su detalle de SOLO LECTURA, sin caja", async () => {
    await montar(vista({ conPendiente: true }));
    await pestania("Visitas");
    await pulsar(
      host.querySelectorAll('[data-test="historia-visita-fila"]')[1]!,
    );
    expect(host.querySelector('[data-test="historia-visita"]')).not.toBeNull();
    expect(texto()).toContain("Firmada por Lucía Martín");
    // NI el bloque de caja de la dueña ni el del sanitario sin caja.
    expect(texto()).not.toContain("Pasa a caja");
    expect(texto()).not.toContain("Enviada a recepción");
  });

  it("UNA VISITA CON UN VALOR QUE NO SE CONOCE SE ABRE IGUAL", async () => {
    // Lo encontró el bucle visual: una `proximaCita` que este despliegue
    // no sabe leer tumbaba la pantalla entera contra el ErrorBoundary, y
    // la pantalla que se caía es la de LEER la historia — un registro
    // legal al que el paciente tiene derecho de acceso.
    await montar(vista({ conPendiente: true }), {
      detalle: {
        entryId: "v1",
        cerradaEn: "2026-09-07T09:00:00.000Z",
        firma: {
          autorNombre: "Lucía Martín",
          colegiado: null,
          firmadaEn: "2026-09-07T09:00:00.000Z",
        },
        cuerpo: {
          v: 1,
          dolor: 7,
          evolucion: null,
          consejos: [],
          proximaCita: "DENTRO_DE_UN_MES",
          nota: null,
          consejosVersion: 1,
        },
        marcas: [],
      },
    });
    await pestania("Visitas");
    await pulsar(
      host.querySelectorAll('[data-test="historia-visita-fila"]')[0]!,
    );
    expect(host.querySelector('[data-test="historia-visita"]')).not.toBeNull();
    expect(texto()).toContain("Firmada por Lucía Martín");
    expect(texto()).not.toContain("Próxima cita propuesta");
  });

  it("y se puede volver", async () => {
    await montar(vista({ conPendiente: true }));
    await pestania("Visitas");
    await pulsar(
      host.querySelectorAll('[data-test="historia-visita-fila"]')[0]!,
    );
    await pulsar(botonQueContiene("Volver a la historia"));
    expect(host.querySelector('[data-test="historia-viva"]')).not.toBeNull();
  });
});

describe("los documentos", () => {
  it("la valoración sale con quién respondió, y nada de clinica-4", async () => {
    await montar(vista({ conPendiente: true }));
    await pestania("Documentos");
    const caja = host.querySelector('[data-test="historia-documentos"]')!;
    expect(caja.textContent).toContain("Valoración inicial · validada");
    expect(caja.textContent).toContain("Respondió un familiar");
    expect(caja.textContent).not.toContain("Consentimiento");
    expect(caja.textContent).not.toContain("Llega pronto");
  });
});

// ── 8 · Ni un importe ────────────────────────────────────────────────

describe("sin importes en ningún sitio", () => {
  it("no hay un solo euro en el DOM, en ninguna pestaña", async () => {
    await montar(vista({ conPendiente: true }));
    expect(texto()).not.toContain("€");
    await pestania("Visitas");
    expect(texto()).not.toContain("€");
    await pestania("Documentos");
    expect(texto()).not.toContain("€");
  });
});
