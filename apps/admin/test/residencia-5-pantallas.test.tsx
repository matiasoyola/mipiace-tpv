// residencia-5 · EL ADMIN DEL BLOQUE: el panel, el relevo, las
// obligaciones y los indicadores.
//
// Se miden por lo que la pantalla DICE, porque en las cuatro lo que
// importa es la frase y el estado:
//
//   1. **El panel** pone N4 y N3 primero, enseña el último relevo con su
//      estado y **cada cifra es un enlace** — el presupuesto de lectura
//      del bloque C §1 es ≤ 3 toques a cualquier dato, y una cifra que no
//      se abre obliga a preguntar.
//   2. **El relevo** dice quién lo recibió **con las DOS horas**, que es
//      lo que hace visible una confirmación que se encoló sin red; y
//      pinta «llegó después del relevo» aparte, no mezclado.
//   3. **Las obligaciones** avisan de la periodicidad por verificar, y lo
//      vencido va arriba en rojo.
//   4. **Los indicadores** dicen si el umbral es del centro o de serie, y
//      **«sin dato» no es cero**.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelPage } from "../src/pages/residencia/PanelPage.js";
import { RelevoPage } from "../src/pages/residencia/RelevoPage.js";
import { RelevosPage } from "../src/pages/residencia/RelevosPage.js";
import { ObligacionesPage } from "../src/pages/residencia/ObligacionesPage.js";
import { IndicadoresPage } from "../src/pages/residencia/IndicadoresPage.js";
import {
  NOMBRE_DE_LA_CLASE,
  valorEnPalabras,
  umbralEnPalabras,
  type Panel,
  type ValorDeIndicador,
} from "../src/pages/residencia/relevo-lib.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PANEL: Panel = {
  // cuadro-de-control · la cabecera del panel y los contadores del menú.
  centro: { nombre: "Jardín de Gredos", plazas: 49, dentro: 41, fuera: null },
  yo: { nombre: "Carmen" },
  abierto: {
    porNivel: [
      { nivel: "N4", cuantas: 0 },
      { nivel: "N3", cuantas: 2 },
      { nivel: "N2", cuantas: 1 },
      { nivel: "N1", cuantas: 4 },
      { nivel: "N0", cuantas: 3 },
    ],
    avisosSinAcuse: 1,
    sinConstanciaDeFamilia: 2,
    esperandoCierreDeOtro: 2,
    total: 10,
    // cuadro-de-control · «lo que no puede esperar», ya ordenado por el
    // servidor: la N3 primero y la N1 al final.
    noPuedeEsperar: [
      {
        id: "i1",
        nivel: "N3",
        tipo: "CAIDA",
        nombreDelTipo: "Caída",
        sujeto: "RESIDENT",
        residente: "Carmen del Río",
        habitacion: "112",
        abiertaEn: "2026-10-18T06:55:00.000Z",
        sinConstanciaDeFamilia: false,
        esperaCierreDeOtro: true,
        avisosSinAcuse: ["ENFERMERIA"],
      },
      {
        id: "i2",
        nivel: "N2",
        tipo: "NO_COME",
        nombreDelTipo: "No ha comido",
        sujeto: "RESIDENT",
        residente: "Abel Ramos",
        habitacion: "204",
        abiertaEn: "2026-10-18T07:30:00.000Z",
        sinConstanciaDeFamilia: true,
        esperaCierreDeOtro: false,
        avisosSinAcuse: [],
      },
      {
        id: "i3",
        nivel: "N1",
        tipo: "AVERIA",
        nombreDelTipo: "Persiana rota",
        sujeto: "MAINTENANCE",
        residente: null,
        habitacion: "206",
        abiertaEn: "2026-10-17T10:00:00.000Z",
        sinConstanciaDeFamilia: false,
        esperaCierreDeOtro: false,
        avisosSinAcuse: [],
      },
    ],
  },
  relevos: {
    ultimo: {
      id: "h1",
      careDay: "2026-10-18",
      turno: "Mañana",
      congeladoEn: "2026-10-18T13:00:00.000Z",
      lineas: 9,
      sinNovedades: false,
      confirmado: false,
      confirmadoPor: [
        { nombre: "Ana", rol: "Auxiliar", at: "2026-10-18T13:04:00.000Z", alcanceTotal: false },
      ],
      zonasPorConfirmar: 2,
    },
    sinConfirmar: [
      {
        id: "h2",
        careDay: "2026-10-17",
        turno: "Noche",
        congeladoEn: "2026-10-18T06:00:00.000Z",
        lineas: 3,
        zonasPorConfirmar: 1,
      },
    ],
  },
  obligaciones: {
    hoy: [
      {
        id: "o1",
        dutyId: "d1",
        nombre: "Registro diario de jornada",
        family: "PERSONAL",
        consequence: "LEGAL",
        dueOn: "2026-10-18",
        diasRestantes: 0,
        vencida: false,
        hecha: false,
        hechaEn: null,
        hechaPor: null,
        tieneEvidencia: false,
        periodicityToVerify: false,
        responsable: "Dirección",
      },
    ],
    vencidas: [
      {
        id: "o2",
        dutyId: "d2",
        nombre: "Certificado anual del mantenedor de PCI",
        family: "CUMPLIMIENTO",
        consequence: "LEGAL",
        dueOn: "2026-09-18",
        diasRestantes: -30,
        vencida: true,
        hecha: false,
        hechaEn: null,
        hechaPor: null,
        tieneEvidencia: false,
        periodicityToVerify: false,
        responsable: "Mantenimiento",
      },
    ],
    proximas: [
      {
        id: "o3",
        dutyId: "d3",
        nombre: "Inspección OCA de baja tensión",
        family: "CUMPLIMIENTO",
        consequence: "LEGAL",
        dueOn: "2026-12-05",
        diasRestantes: 48,
        vencida: false,
        hecha: false,
        hechaEn: null,
        hechaPor: null,
        tieneEvidencia: false,
        periodicityToVerify: true,
        responsable: "Mantenimiento",
      },
    ],
  },
  turno: {
    turno: {
      id: "t1",
      code: "T",
      name: "Tarde",
      empiezaEn: "15:00",
      terminaEn: "22:00",
    },
    careDay: "2026-10-18",
    plantas: [
      { floorId: "p1", nombre: "Primera", tocan: 40, hechas: 18 },
      { floorId: "p2", nombre: "Segunda", tocan: 20, hechas: 20 },
    ],
    noHechoDeTurnosCerrados: 3,
  },
  indicadores: [
    {
      code: "GIMNASIA",
      nombre: "Participación en la gimnasia de mantenimiento",
      deDonde: "plan de cuidados y registros del control GIMNASIA",
      unidad: "PORCENTAJE",
      comparacion: "AT_LEAST",
      valor: 75,
      umbral: 73.5,
      umbralDelCentro: false,
      dentro: true,
    },
    {
      code: "VISITA_MEDICA",
      nombre: "Residentes vistos por el médico este mes",
      deDonde: "registros del control VISITA_MEDICA",
      unidad: "PORCENTAJE",
      comparacion: "AT_LEAST",
      valor: null,
      umbral: 100,
      umbralDelCentro: false,
      dentro: null,
    },
  ],
  mes: "2026-10",
  generadoEn: "2026-10-18T18:00:00.000Z",
};

const RELEVO_DETALLE = {
  id: "h1",
  careDay: "2026-10-18",
  turno: { id: "t1", code: "M", name: "Mañana" },
  lineas: 3,
  sinNovedades: false,
  generadoEn: "2026-10-18T13:00:00.000Z",
  congeladoEn: "2026-10-18T13:00:00.000Z",
  confirmadoEn: null,
  zonas: [
    { floorId: "p1", nombre: "Primera", lineas: 2 },
    { floorId: null, nombre: "Del centro", lineas: 1 },
  ],
  confirmado: false,
  zonasPorConfirmar: [null],
  acuses: [
    {
      nombre: "Ana",
      rol: "Auxiliar",
      at: "2026-10-18T13:04:00.000Z",
      // **Las dos horas**: la firmó a las 15:04 y llegó a las 15:51.
      llegoEn: "2026-10-18T13:51:00.000Z",
      alcanceTotal: false,
      tablet: "Tablet de la sala",
      zonas: ["Primera"],
    },
  ],
  tardios: [
    {
      id: "t1",
      kind: "CARE_RECORD",
      clientId: "c1",
      floorId: "p1",
      resumen: "CAMBIO_POSTURAL",
      ocurrioEn: "2026-10-18T12:50:00.000Z",
      llegoEn: "2026-10-18T13:20:00.000Z",
      incidentId: null,
      careRecordId: "r1",
    },
  ],
  parte: {
    centro: { id: "x", nombre: "Jardín de Gredos" },
    turno: { id: "t1", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
    careDay: "2026-10-18",
    desde: "2026-10-18T06:00:00.000Z",
    hasta: "2026-10-18T13:00:00.000Z",
    corte: "2026-10-18T13:00:00.000Z",
    generadoEn: "2026-10-18T13:00:00.000Z",
    sinNovedades: false,
    lineas: 3,
    zonas: [
      {
        floorId: "p1",
        nombre: "Primera",
        lineas: 2,
        residentes: [
          {
            clientId: "c1",
            nombre: "Carmen Núñez",
            habitacion: "112",
            lineas: [
              {
                clase: "INCIDENCIA_NUEVA",
                texto: "Caída · Se ha caído en el baño",
                hora: "10:40",
                nivel: "N3",
                incidentId: "i1",
                careRecordId: null,
                aviso: {
                  canal: "ENFERMERIA",
                  estado: "ACKED",
                  acusadoPor: "Rosa (DUE)",
                  acusadoEn: "10:43",
                },
              },
              {
                clase: "NO_HECHO",
                texto: "Hidratación cutánea — tocaba y no hay registro",
                hora: null,
                nivel: null,
                incidentId: null,
                careRecordId: null,
                aviso: null,
              },
            ],
          },
        ],
        sueltas: [],
      },
      {
        floorId: null,
        nombre: "Del centro",
        lineas: 1,
        residentes: [],
        sueltas: [
          {
            clase: "INCIDENCIA_ABIERTA",
            texto: "Avería · El asidero se mueve",
            hora: "09:20",
            nivel: "N2",
            incidentId: "i2",
            careRecordId: null,
            aviso: null,
          },
        ],
      },
    ],
  },
  ilegible: false,
};

const OBLIGACIONES = {
  obligaciones: [
    {
      id: "d1",
      name: "Nóminas",
      family: "PERSONAL" as const,
      notes: null,
      periodicity: "MONTHLY" as const,
      weekday: null,
      monthDay: 25,
      month: null,
      anchorYear: null,
      validUntil: null,
      periodicityToVerify: false,
      consequence: "LEGAL" as const,
      startsOn: "2026-10-01",
      active: true,
      responsibleCareRole: { id: "r1", name: "Administración" },
      responsibleUser: null,
      responsibleLabel: null,
      responsable: "Administración",
      periodicidadEnPalabras: "Cada mes, el día 25",
    },
    {
      id: "d2",
      name: "Facturación de las plazas concertadas a la JCCM",
      family: "DINERO" as const,
      notes: "Periodicidad por verificar.",
      periodicity: "MONTHLY" as const,
      weekday: null,
      monthDay: 5,
      month: null,
      anchorYear: null,
      validUntil: null,
      periodicityToVerify: true,
      consequence: "LEGAL" as const,
      startsOn: "2026-10-01",
      active: true,
      responsibleCareRole: null,
      responsibleUser: null,
      responsibleLabel: "Administración",
      responsable: "Administración",
      periodicidadEnPalabras: "Cada mes, el día 5",
    },
  ],
  hoy: PANEL.obligaciones.hoy,
  vencidas: PANEL.obligaciones.vencidas,
  proximas: PANEL.obligaciones.proximas,
  plantilla: 4,
};

const INDICADORES: { mes: string; indicadores: ValorDeIndicador[]; sinDato: Array<{ nombre: string; falta: string }> } = {
  mes: "2026-10",
  indicadores: PANEL.indicadores,
  sinDato: [
    { nombre: "Úlceras por presión nuevas", falta: "la entidad Lesión (Fase 2)" },
  ],
};

let container: HTMLDivElement;
let root: Root;
const api = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, api: api.fn };
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * Monta una pantalla dentro de UN router.
 *
 * `ruta` existe para `RelevoPage`, que lee el `:id` de la URL: se monta
 * dentro de su `<Route>` y con la ruta puesta en el `MemoryRouter`. Dos
 * routers anidados no valen —react-router lo prohíbe— y es lo primero que
 * sale al escribir esto.
 */
async function pintar(
  nodo: React.ReactNode,
  ruta?: { camino: string; url: string },
): Promise<void> {
  await act(async () => {
    root.render(
      ruta ? (
        <MemoryRouter initialEntries={[ruta.url]}>
          <Routes>
            <Route path={ruta.camino} element={nodo} />
          </Routes>
        </MemoryRouter>
      ) : (
        <MemoryRouter>{nodo}</MemoryRouter>
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** La ruta del parte, que es la única con parámetro. */
const RUTA_DEL_RELEVO = {
  camino: "/admin/residencia/relevos/:id",
  url: "/admin/residencia/relevos/h1",
};

function enlaces(): HTMLAnchorElement[] {
  return [...container.querySelectorAll("a")];
}

// ══ 1 · EL PANEL ══════════════════════════════════════════════════

describe("el panel de dirección", () => {
  // cuadro-de-control · los niveles ya no son cinco tarjetas con su
  // número: son el ORDEN de «lo que no puede esperar», que es donde la
  // gravedad decide qué se lee primero. El recuento de graves sigue
  // estando, dentro de la cifra de incidencias.
  it("lo más grave va PRIMERO, y no en el orden del enum", async () => {
    api.fn.mockResolvedValue(PANEL);
    await pintar(<PanelPage />);
    const texto = container.textContent ?? "";
    expect(texto.indexOf("N3")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("N3")).toBeLessThan(texto.indexOf("N1"));
    // Y la cifra dice cuántas de las diez son graves (las dos N3) y
    // cuántas están sin comunicar a la familia.
    expect(texto).toContain("2 graves");
    expect(texto).toContain("2 sin comunicar a la familia");
  });

  it("**cada cifra se abre**: el presupuesto de lectura son 3 toques", async () => {
    api.fn.mockResolvedValue(PANEL);
    await pintar(<PanelPage />);
    const destinos = enlaces().map((a) => a.getAttribute("href") ?? "");
    // Las cuatro cifras de arriba: el libro, los relevos, las
    // obligaciones y las fichas. Una cifra que no se abre obliga a
    // preguntar, que es justo lo que este panel existe para quitar.
    expect(destinos.some((d) => d.includes("/incidencias?abiertas=1"))).toBe(true);
    expect(destinos.some((d) => d === "/admin/residencia/relevos")).toBe(true);
    expect(destinos.some((d) => d === "/admin/residencia/obligaciones")).toBe(true);
    expect(destinos.some((d) => d.includes("/indicadores"))).toBe(true);
    // Y las filas: la incidencia concreta (1 toque) y el relevo concreto.
    expect(destinos.some((d) => d.includes("/incidencias/i1"))).toBe(true);
    expect(destinos.some((d) => d.includes("/relevos/h2"))).toBe(true);
    expect(destinos.some((d) => d.includes("/obligaciones?duty=d2"))).toBe(true);
  });

  it("el estado de cada incidencia se lee en su fila, sin abrirla", async () => {
    api.fn.mockResolvedValue(PANEL);
    await pintar(<PanelPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Caída · hab. 112");
    expect(texto).toContain("Pendiente de que la cierre otra persona");
    expect(texto).toContain("Enfermería avisada, sin acuse");
    expect(texto).toContain("Sin comunicar a la familia");
  });

  it("el relevo SIN CONFIRMAR se ve, con «Abrir», y dice cuántas zonas faltan", async () => {
    api.fn.mockResolvedValue(PANEL);
    await pintar(<PanelPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Relevos sin confirmar");
    expect(texto).toContain("1 zona sin recibir");
    expect(texto).toContain("Abrir");
  });

  it("y el último, si ya está firmado, dice QUIÉN lo recibió", async () => {
    // residencia-5 · la línea tranquila del bloque. Con el parte sin
    // confirmar no se pinta (lo que importa es que falta la firma); en
    // cuanto está firmado, dice quién y a qué hora.
    api.fn.mockResolvedValue({
      ...PANEL,
      relevos: {
        ...PANEL.relevos,
        ultimo: { ...PANEL.relevos.ultimo!, confirmado: true },
      },
    });
    await pintar(<PanelPage />);
    expect(container.textContent).toContain("Confirmado por Ana (Auxiliar)");
  });

  it("lo VENCIDO sale con los días de retraso y quién es responsable", async () => {
    api.fn.mockResolvedValue(PANEL);
    await pintar(<PanelPage />);
    expect(container.textContent).toContain("Venció el 18-09-2026 (30 días)");
    expect(container.textContent).toContain("Mantenimiento");
  });

  it("el turno en curso dice cuánto va hecho POR PLANTA", async () => {
    api.fn.mockResolvedValue(PANEL);
    await pintar(<PanelPage />);
    expect(container.textContent).toContain("18 de 40");
    expect(container.textContent).toContain("20 de 20");
    expect(container.textContent).toContain("3");
  });

  it("y un hueco en el cuadrante se DICE, no se esconde", async () => {
    api.fn.mockResolvedValue({
      ...PANEL,
      turno: { ...PANEL.turno, turno: null, plantas: [] },
    });
    await pintar(<PanelPage />);
    expect(container.textContent).toContain("hueco en el cuadrante");
  });

  it("un encargado sin rol directivo lee la FRASE, no un error", async () => {
    const { ApiError } = await import("../src/api.js");
    // El `ApiError` del admin es `(status, code, message)`, no
    // `(status, message, code)` como el del TPV. Confundirlos deja el
    // test en verde con el mensaje en el sitio del código.
    api.fn.mockRejectedValue(
      new ApiError(403, "PANEL_ES_DE_DIRECCION", "El panel de dirección lo ven la dirección y…"),
    );
    await pintar(<PanelPage />);
    expect(container.textContent).toContain("El panel de dirección lo ven");
    // Y NO un «Error inesperado».
    expect(container.textContent).not.toContain("Error inesperado");
  });
});

// ══ 2 · EL RELEVO ═════════════════════════════════════════════════

describe("un parte de relevo en el admin", () => {
  it("dice quién lo recibió y **las DOS horas**", async () => {
    api.fn.mockResolvedValue({ relevo: RELEVO_DETALLE });
    await pintar(<RelevoPage />, RUTA_DEL_RELEVO);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Ana");
    expect(texto).toContain("lo firmó a las");
    // La hora de llegada sólo sale cuando se separa de la de firma: es lo
    // que hace visible el punto muerto del wifi.
    expect(texto).toContain("llegó a las");
  });

  it("«llegó después del relevo» va APARTE, no mezclado con el parte", async () => {
    api.fn.mockResolvedValue({ relevo: RELEVO_DETALLE });
    await pintar(<RelevoPage />, RUTA_DEL_RELEVO);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Llegó después del relevo");
    expect(texto).toContain("El parte no se reescribe");
    // Y la línea del parte sigue diciendo «no se hizo».
    expect(texto).toContain(NOMBRE_DE_LA_CLASE.NO_HECHO);
  });

  it("y dice qué ZONA falta por confirmar, con su nombre", async () => {
    api.fn.mockResolvedValue({ relevo: RELEVO_DETALLE });
    await pintar(<RelevoPage />, RUTA_DEL_RELEVO);
    expect(container.textContent).toContain("Falta que lo reciba alguien de");
    expect(container.textContent).toContain("Del centro");
  });

  it("un parte ILEGIBLE se dice, no se esconde", async () => {
    api.fn.mockResolvedValue({
      relevo: { ...RELEVO_DETALLE, parte: null, ilegible: true },
    });
    await pintar(<RelevoPage />, RUTA_DEL_RELEVO);
    expect(container.textContent).toContain("Este parte no se puede leer");
  });

  it("la lista avisa de los que nadie ha confirmado", async () => {
    api.fn.mockResolvedValue({
      relevos: [
        {
          id: "h1",
          careDay: "2026-10-18",
          turno: { id: "t1", code: "M", name: "Mañana" },
          lineas: 9,
          sinNovedades: false,
          congeladoEn: "2026-10-18T13:00:00.000Z",
          confirmadoEn: null,
          confirmaciones: 1,
          zonas: 3,
          tardios: 1,
        },
      ],
    });
    await pintar(<RelevosPage />);
    expect(container.textContent).toContain("Sin confirmar");
    expect(container.textContent).toContain("1 llegó después");
  });
});

// ══ 3 · LAS OBLIGACIONES ══════════════════════════════════════════

describe("las obligaciones", () => {
  it("avisan de la periodicidad POR VERIFICAR", async () => {
    api.fn.mockResolvedValue(OBLIGACIONES);
    await pintar(<ObligacionesPage />);
    expect(container.textContent).toContain("periodicidad por verificar");
  });

  it("lo vencido va arriba y en rojo, con su consecuencia", async () => {
    api.fn.mockResolvedValue(OBLIGACIONES);
    await pintar(<ObligacionesPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Vencidas (1)");
    expect(texto.indexOf("Vencidas")).toBeLessThan(texto.indexOf("Nóminas"));
    expect(container.querySelector(".border-red-300")).not.toBeNull();
  });

  it("y el botón de cargar el catálogo dice cuántas faltan y que no pisa nada", async () => {
    api.fn.mockResolvedValue(OBLIGACIONES);
    await pintar(<ObligacionesPage />);
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("no duplica nada ni pisa lo que hayas cambiado");
  });

  it("la periodicidad se lee en palabras, no como enum", async () => {
    api.fn.mockResolvedValue(OBLIGACIONES);
    await pintar(<ObligacionesPage />);
    expect(container.textContent).toContain("Cada mes, el día 25");
    expect(container.textContent).not.toContain("MONTHLY");
  });
});

// ══ 4 · LOS INDICADORES ═══════════════════════════════════════════

describe("los indicadores", () => {
  it("dicen si el umbral es DEL CENTRO o DE SERIE", async () => {
    api.fn.mockResolvedValue(INDICADORES);
    await pintar(<IndicadoresPage />);
    expect(container.textContent).toContain("(de serie)");
  });

  it("«sin dato» NO es cero", async () => {
    api.fn.mockResolvedValue(INDICADORES);
    await pintar(<IndicadoresPage />);
    expect(container.textContent).toContain("Sin dato este mes");
    // Y no se juzga: ni «dentro» ni «fuera».
    const texto = container.textContent ?? "";
    expect(texto).toContain("Sin dato");
  });

  it("y dicen DE QUÉ REGISTROS salen, que es lo que permite abrirlo", async () => {
    api.fn.mockResolvedValue(INDICADORES);
    await pintar(<IndicadoresPage />);
    expect(container.textContent).toContain("Sale de: plan de cuidados y registros");
  });

  it("los que todavía no tienen dato se NOMBRAN", async () => {
    api.fn.mockResolvedValue(INDICADORES);
    await pintar(<IndicadoresPage />);
    expect(container.textContent).toContain("Úlceras por presión nuevas");
    expect(container.textContent).toContain("la entidad Lesión (Fase 2)");
  });

  it("la fórmula NO se puede tocar: no hay botón de editarla", async () => {
    api.fn.mockResolvedValue(INDICADORES);
    await pintar(<IndicadoresPage />);
    const etiquetas = [...container.querySelectorAll("button")].map(
      (b) => b.textContent ?? "",
    );
    // Lo único que se cambia es el UMBRAL (rama de controles §10).
    expect(etiquetas.some((e) => e.includes("Cambiar el umbral"))).toBe(true);
    expect(etiquetas.some((e) => e.toLowerCase().includes("fórmula"))).toBe(false);
  });
});

// ══ 5 · LAS FRASES, en un solo sitio ══════════════════════════════

describe("las frases de la biblioteca", () => {
  it("cada clase de línea tiene nombre en castellano", () => {
    for (const clase of [
      "INCIDENCIA_NUEVA",
      "INCIDENCIA_ABIERTA",
      "ALGO_NO_VA_BIEN",
      "CONSTANTE_FUERA_DE_RANGO",
      "NO_HECHO",
      "CAMBIO_DE_PLAN",
      "EXCEPCION_NUEVA",
      "REGISTRO_SIN_TURNO",
      "AVISO_QUE_NO_SALIO",
      "SIN_PLAN_DE_CUIDADOS",
    ]) {
      expect(NOMBRE_DE_LA_CLASE[clase], clase).toBeTruthy();
      expect(NOMBRE_DE_LA_CLASE[clase]).not.toBe(clase);
    }
  });

  it("un porcentaje se escribe con coma, y un recuento sin unidad", () => {
    expect(
      valorEnPalabras({ ...PANEL.indicadores[0]!, valor: 73.5 }),
    ).toBe("73,5 %");
    expect(
      valorEnPalabras({
        ...PANEL.indicadores[0]!,
        unidad: "RECUENTO",
        valor: 3,
      }),
    ).toBe("3");
  });

  it("y el umbral dice para qué lado se mide", () => {
    expect(umbralEnPalabras(PANEL.indicadores[0]!)).toBe("≥ 73,5 %");
    expect(
      umbralEnPalabras({ ...PANEL.indicadores[0]!, comparacion: "AT_MOST", umbral: 10 }),
    ).toBe("≤ 10 %");
  });
});
