// cuadro-de-control · **EL MENÚ DE CINCO Y EL PANEL QUE CABE EN UNA
// PANTALLA.**
//
// Lo abrió Matías el 23-10-2026, mirando el panel de Carmen el día que
// Jardín de Gredos se encendió en producción: «hay demasiadas opciones, no
// parece un cuadro de control». Lo que fija este fichero:
//
//   1. **El menú de una residencia son cinco entradas y «Configuración»**,
//      en ese orden y con sus contadores (decisiones 1 y 2).
//   2. **El de un comercio no cambia ni una línea.** Es la mitad del
//      bloque que no se ve, y la que rompería quince clientes.
//   3. **Ninguna pantalla se queda sin forma de llegar**: todo lo que pasa
//      el filtro está en el menú, en «Configuración» o nombrado a mano en
//      `FUERA_EN_RESIDENCIA`.
//   4. **Los contadores son las cifras del panel**, de la misma petición.
//      Si el menú dice 4 y la pantalla 3, nadie sabe cuál miente.
//   5. **El panel con 0 de todo está tranquilo**, no son cuatro ceros
//      rojos.
//   6. Y lo que sale de la residencia: la banda del ensayo del TPV, la
//      declaración responsable, la marca del TPV y las dos pantallas de
//      agenda.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

// ── El servidor de este fichero ──────────────────────────────────────
let settings: Record<string, unknown> = {};
let tenant: Record<string, unknown> = {};
/** Lo que contesta `GET /residencia/panel`. Un `FakeApiError` lo lanza. */
let panelDelServidor: unknown = null;
/** Las llamadas al panel, para contar que es UNA. */
let llamadasAlPanel = 0;
/** Lo que se marcó hecho desde el panel. */
const marcadas: string[] = [];

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    if (path === "/admin/tenant/settings") return { settings };
    if (path === "/auth/me") {
      return { user: { id: "u1", email: "carmen@gredos.es", role: "OWNER" }, tenant };
    }
    if (path === "/residencia/panel") {
      llamadasAlPanel += 1;
      if (panelDelServidor instanceof FakeApiError) throw panelDelServidor;
      return panelDelServidor;
    }
    if (path.includes("/hecha") && init?.method === "POST") {
      marcadas.push(path);
      return { id: "x", hechaEn: "2026-10-23T09:00:00.000Z" };
    }
    return { count: 0, items: [], errors: [], pendingCount: 0 };
  }),
  clearTokens: vi.fn(),
  readCurrentRole: () => "OWNER",
  readImpersonationState: () => null,
  readEffectiveAuth: () => ({ canEdit: true, readonlyReason: null }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const real = await orig<typeof import("react-router-dom")>();
  return { ...real, useNavigate: () => navigate };
});

const {
  AdminShell,
  NAV_ITEMS,
  FUERA_EN_RESIDENCIA,
  entradasDelMenu,
  entradasDeConfiguracion,
} = await import("../src/AdminShell.js");
const { PanelPage } = await import("../src/pages/residencia/PanelPage.js");
const { ConfiguracionPage } = await import(
  "../src/pages/residencia/ConfiguracionPage.js"
);
const { __resetCapacidadesParaTests } = await import("../src/capabilities.js");
const { __resetPanelParaTests } = await import("../src/residencia-panel.js");
const { contadorDelMenu } = await import("../src/residencia-panel.js");
type Panel = import("../src/pages/residencia/relevo-lib.js").Panel;

// ── EL PANEL DE JARDÍN DE GREDOS, con los números del mockup ─────────
function panelDePrueba(cambios: Partial<Panel> = {}): Panel {
  return {
    centro: { nombre: "Jardín de Gredos", plazas: 49, dentro: 41, fuera: null },
    yo: { nombre: "Carmen" },
    abierto: {
      porNivel: [
        { nivel: "N4", cuantas: 0 },
        { nivel: "N3", cuantas: 1 },
        { nivel: "N2", cuantas: 2 },
        { nivel: "N1", cuantas: 1 },
        { nivel: "N0", cuantas: 0 },
      ],
      avisosSinAcuse: 0,
      sinConstanciaDeFamilia: 2,
      esperandoCierreDeOtro: 1,
      total: 4,
      noPuedeEsperar: [
        {
          id: "i1",
          nivel: "N3",
          tipo: "CAIDA",
          nombreDelTipo: "Caída",
          sujeto: "RESIDENT",
          residente: "Carmen del Río",
          habitacion: "112",
          abiertaEn: "2026-10-23T06:55:00.000Z",
          sinConstanciaDeFamilia: false,
          esperaCierreDeOtro: true,
          avisosSinAcuse: [],
        },
      ],
    },
    relevos: {
      ultimo: {
        id: "h1",
        careDay: "2026-10-22",
        turno: "Noche",
        congeladoEn: "2026-10-23T06:00:00.000Z",
        lineas: 14,
        sinNovedades: false,
        confirmado: false,
        confirmadoPor: [],
        zonasPorConfirmar: 1,
      },
      sinConfirmar: [
        {
          id: "h1",
          careDay: "2026-10-22",
          turno: "Noche",
          congeladoEn: "2026-10-23T06:00:00.000Z",
          lineas: 14,
          zonasPorConfirmar: 1,
        },
        {
          id: "h2",
          careDay: "2026-10-21",
          turno: "Tarde",
          congeladoEn: "2026-10-21T21:00:00.000Z",
          lineas: 4,
          zonasPorConfirmar: 2,
        },
      ],
    },
    obligaciones: {
      hoy: [
        ocurrencia({ id: "o1", dutyId: "d1", nombre: "Registros APPCC de cocina", consequence: "ISO" }),
        ocurrencia({ id: "o2", dutyId: "d2", nombre: "Pedido de alimentación", consequence: "INTERNO" }),
        ocurrencia({ id: "o3", dutyId: "d3", nombre: "Registro diario de jornada", consequence: "LEGAL", hecha: true }),
      ],
      vencidas: [
        ocurrencia({
          id: "o9",
          dutyId: "d9",
          nombre: "Revisión mensual de extintores",
          consequence: "LEGAL",
          dueOn: "2026-10-20",
          diasRestantes: -3,
          vencida: true,
        }),
      ],
      proximas: [],
    },
    turno: {
      turno: { id: "t1", code: "M", name: "Mañana", empiezaEn: "08:00", terminaEn: "15:00" },
      careDay: "2026-10-23",
      plantas: [
        { floorId: "p1", nombre: "Primera", tocan: 29, hechas: 18 },
        { floorId: "p2", nombre: "Segunda", tocan: 22, hechas: 9 },
      ],
      noHechoDeTurnosCerrados: 0,
    },
    porArreglar: { pinesPorRenovar: [], residentesSinPlan: [] },
    fichasIncompletas: {
      total: 43,
      incompletas: 12,
      datosPendientes: 31,
      conImprescindibles: 0,
      primeras: [
        { clientId: "c1", nombre: "ABEL RAMOS", habitacion: "112", faltan: [] },
      ],
    },
    indicadores: [],
    mes: "2026-10",
    centroVacio: false,
    generadoEn: "2026-10-23T08:42:00.000Z",
    ...cambios,
  } as Panel;
}

function ocurrencia(o: Record<string, unknown>) {
  return {
    family: "CUMPLIMIENTO",
    dueOn: "2026-10-23",
    diasRestantes: 0,
    vencida: false,
    hecha: false,
    hechaEn: null,
    hechaPor: null,
    tieneEvidencia: false,
    periodicityToVerify: false,
    responsable: "Dirección",
    ...o,
  } as never;
}

/** El panel con TODO a cero: ni una incidencia, ni un relevo, ni nada. */
function panelTranquilo(): Panel {
  return panelDePrueba({
    abierto: {
      porNivel: [
        { nivel: "N4", cuantas: 0 },
        { nivel: "N3", cuantas: 0 },
        { nivel: "N2", cuantas: 0 },
        { nivel: "N1", cuantas: 0 },
        { nivel: "N0", cuantas: 0 },
      ],
      avisosSinAcuse: 0,
      sinConstanciaDeFamilia: 0,
      esperandoCierreDeOtro: 0,
      total: 0,
      noPuedeEsperar: [],
    },
    relevos: { ultimo: null, sinConfirmar: [] },
    obligaciones: { hoy: [], vencidas: [], proximas: [] },
    fichasIncompletas: {
      total: 43,
      incompletas: 0,
      datosPendientes: 0,
      conImprescindibles: 0,
      primeras: [],
    },
  });
}

const CAPS_RESIDENCIA = {
  agenda: true,
  caja: false,
  fichaje: false,
  clinica: true,
  residencia: true,
  bonos: false,
  holded: false,
  holdedEnabled: false,
  holdedDejado: false,
  cocina: false,
  businessType: null,
  bonoEtiqueta: "bono",
  enEnsayo: true,
  nombreDelCentro: "Jardín de Gredos",
} as const;

/** Lo que el super-admin enciende en una residencia (residencia-1, D-48). */
function servidorDeResidencia(): void {
  settings = {
    cajaEnabled: false,
    residenciaEnabled: true,
    clinicalRecordsEnabled: true,
    // La agenda SIGUE encendida por debajo: la exige la clínica, y de
    // ella cuelga «Personal». Lo que no se ve son sus dos pantallas.
    agendaEnabled: true,
  };
  tenant = { name: "Jardín de Gredos", hasHoldedKey: false, facturaDesde: null };
  panelDelServidor = panelDePrueba();
}

/** Y lo que tiene una peluquería de las de siempre. */
function servidorDeComercio(): void {
  settings = { cajaEnabled: true, agendaEnabled: true };
  tenant = { name: "Peluquería Sole", hasHoldedKey: true, facturaDesde: "2026-01-01T00:00:00Z" };
  panelDelServidor = new FakeApiError(404, "no existe", "NOT_FOUND");
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  settings = {};
  tenant = {};
  panelDelServidor = null;
  llamadasAlPanel = 0;
  marcadas.length = 0;
  navigate.mockClear();
  __resetCapacidadesParaTests();
  __resetPanelParaTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(nodo: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter>{nodo}</MemoryRouter>);
  });
  // Tres vueltas: las capacidades, el panel que dispara el efecto con las
  // capacidades ya puestas, y el re-render de los contadores.
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const shell = (
  <AdminShell title="Panel de dirección">
    <div />
  </AdminShell>
);

function texto(): string {
  return container.textContent ?? "";
}

/** Los `href` del menú y del pie de la barra, en orden de pintado. */
function destinosDelMenu(): string[] {
  return [...container.querySelectorAll("aside a")]
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.startsWith("/admin"));
}

// ════════════════════════════════════════════════════════════════════
//  1 · EL MENÚ DE UNA RESIDENCIA
// ════════════════════════════════════════════════════════════════════

describe("cuadro-de-control · el menú de una residencia", () => {
  it("son CINCO entradas y «Configuración», en ese orden y nada más", async () => {
    servidorDeResidencia();
    await pintar(shell);
    expect(destinosDelMenu()).toEqual([
      "/admin/residencia/panel",
      "/admin/residencia/residentes",
      "/admin/residencia/incidencias",
      "/admin/residencia/relevos",
      "/admin/residencia/obligaciones",
      "/admin/residencia/configuracion",
    ]);
  });

  it("y las dieciocho de antes ya no están: ni Edificio, ni Turnos, ni agenda", async () => {
    servidorDeResidencia();
    await pintar(shell);
    const menu = destinosDelMenu();
    for (const fuera of [
      "/admin/stores",
      "/admin/residencia/edificio",
      "/admin/residencia/turnos",
      "/admin/residencia/controles",
      "/admin/residencia/plantillas",
      "/admin/residencia/guardia",
      "/admin/residencia/indicadores",
      "/admin/staff",
      "/admin/agenda-catalog",
      "/admin/agenda-hours",
      "/admin/account",
      "/admin/security",
      "/admin/settings",
    ]) {
      expect(menu, fuera).not.toContain(fuera);
    }
  });

  it("arriba va el centro y sus plazas, no la marca del TPV", async () => {
    servidorDeResidencia();
    await pintar(shell);
    expect(texto()).toContain("Jardín de Gredos");
    expect(texto()).toContain("Residencia · 49 plazas");
    // Y la marca del TPV no está. Se mira por `data-test` y no por texto
    // (ver `Logo.tsx`): el pie de la barra imprime «mipiacetpv v1.0», que
    // es la VERSIÓN y sí se queda, así que un canario de subcadena casaría
    // con ella y este test pasaría en verde sin mirar nada.
    expect(container.querySelector('[data-test="marca-tpv"]')).toBeNull();
  });

  it("la banda de «cuenta en ensayo» del TPV no sale, aunque la cuenta lo esté", async () => {
    servidorDeResidencia();
    // `facturaDesde: null` = en ensayo. En un comercio esto pinta seis
    // líneas sobre vender, cobrar y Hacienda.
    await pintar(shell);
    expect(container.querySelector('[data-testid="ensayo-aviso-panel"]')).toBeNull();
    expect(texto()).not.toContain("Tu cuenta está en ensayo");
  });

  it("y «Declaración responsable» tampoco: un centro sin caja no factura", async () => {
    servidorDeResidencia();
    await pintar(shell);
    expect(texto()).not.toContain("Declaración responsable");
  });
});

// ════════════════════════════════════════════════════════════════════
//  2 · EL MENÚ DE UN COMERCIO NO CAMBIA
// ════════════════════════════════════════════════════════════════════

describe("cuadro-de-control · un comercio no nota el bloque", () => {
  it("sigue viendo «Tiendas», «Mi cuenta», «Seguridad» y «Ajustes» en el menú", async () => {
    servidorDeComercio();
    await pintar(shell);
    const menu = destinosDelMenu();
    for (const dentro of [
      "/admin/stores",
      "/admin/account",
      "/admin/security",
      "/admin/settings",
      "/admin/devices",
      "/admin/cashiers",
      "/admin/agenda-catalog",
      "/admin/agenda-hours",
    ]) {
      expect(menu, dentro).toContain(dentro);
    }
  });

  it("y NO ve «Configuración»: el índice es de un centro de residencia", async () => {
    servidorDeComercio();
    await pintar(shell);
    expect(destinosDelMenu()).not.toContain("/admin/residencia/configuracion");
  });

  it("se llama «Tiendas» y no «Centro»", async () => {
    servidorDeComercio();
    await pintar(shell);
    expect(texto()).toContain("Tiendas");
    expect(texto()).not.toContain("Centro");
  });

  it("sigue con su marca del TPV arriba y su declaración responsable abajo", async () => {
    servidorDeComercio();
    await pintar(shell);
    expect(texto()).toContain("Declaración responsable");
  });

  it("y no se le pide el panel de la residencia ni una vez", async () => {
    // La ruta contesta 404 en una cuenta sin el módulo: pedirla sería un
    // 404 por pantalla en los quince clientes que no lo tienen.
    servidorDeComercio();
    await pintar(shell);
    expect(llamadasAlPanel).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
//  3 · NINGUNA PANTALLA SE QUEDA SIN FORMA DE LLEGAR
// ════════════════════════════════════════════════════════════════════

describe("cuadro-de-control · «Configuración» es otra forma de llegar", () => {
  it("todo lo que pasa el filtro está en el menú, en Configuración, o nombrado a mano", async () => {
    // El test que hace que esto no se pueda olvidar. Si mañana alguien
    // añade una sección a `NAV_ITEMS` y no la quiere en una residencia,
    // tiene que escribirlo en `FUERA_EN_RESIDENCIA` — o aparece aquí en
    // rojo con el nombre de la sección que se quedó sin puerta.
    //
    // Se mide con TODAS las capabilities encendidas, que es el peor caso:
    // así entra también lo que en Jardín de Gredos no está (la caja, los
    // bonos, Holded).
    const todo = {
      ...CAPS_RESIDENCIA,
      caja: true,
      // `fichaje` encendido no es un caso de laboratorio: una residencia
      // con control horario del personal es exactamente el cliente que
      // viene detrás, y sus tres pantallas tienen que seguir teniendo
      // puerta. Las encontró este test.
      fichaje: true,
      holded: true,
      holdedEnabled: true,
      holdedDejado: true,
      bonos: true,
      cocina: true,
      businessType: "HOSPITALITY",
    } as const;
    const alcanzables = new Set([
      ...entradasDelMenu(todo, "OWNER", true).map((i) => i.to),
      ...entradasDeConfiguracion(todo, "OWNER", true).map((i) => i.to),
      ...FUERA_EN_RESIDENCIA,
    ]);
    const huerfanas = NAV_ITEMS.filter(
      (i) =>
        !alcanzables.has(i.to) &&
        !i.superAdminOnly &&
        i.capability !== "holdedDejado",
    ).map((i) => `${i.label} (${i.to})`);
    expect(huerfanas).toEqual([]);
  });

  it("y las rutas no cambian: cada tarjeta lleva al mismo sitio de siempre", async () => {
    servidorDeResidencia();
    await pintar(<ConfiguracionPage />);
    const destinos = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    for (const ruta of [
      "/admin/stores",
      "/admin/residencia/edificio",
      "/admin/residencia/turnos",
      "/admin/residencia/controles",
      "/admin/residencia/plantillas",
      "/admin/residencia/guardia",
      "/admin/staff",
      "/admin/residencia/indicadores",
      "/admin/contrato-tratamiento",
      "/admin/account",
      "/admin/security",
      "/admin/settings",
    ]) {
      expect(destinos, ruta).toContain(ruta);
    }
  });

  it("«Tiendas» se llama «Centro» dentro de una residencia", async () => {
    servidorDeResidencia();
    await pintar(<ConfiguracionPage />);
    const centro = [...container.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/admin/stores",
    )!;
    expect(centro.textContent).toContain("Centro");
    expect(centro.textContent).not.toContain("Tiendas");
  });

  it("y la agenda NO entra: una residencia no da citas", async () => {
    servidorDeResidencia();
    await pintar(<ConfiguracionPage />);
    const destinos = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(destinos).not.toContain("/admin/agenda-catalog");
    expect(destinos).not.toContain("/admin/agenda-hours");
    // Pero «Personal» sí, que es de la misma capability y es donde se dan
    // los roles de cuidado y se renuevan los PIN.
    expect(destinos).toContain("/admin/staff");
  });
});

// ════════════════════════════════════════════════════════════════════
//  4 · LOS CONTADORES SON LAS CIFRAS DEL PANEL
// ════════════════════════════════════════════════════════════════════

describe("cuadro-de-control · los contadores del menú", () => {
  it("son los números del panel, y de la MISMA petición", async () => {
    servidorDeResidencia();
    await pintar(shell);
    const dato = (clave: string) =>
      container.querySelector(`[data-test="contador-${clave}"]`);
    expect(dato("incidencias")?.textContent).toBe("4");
    expect(dato("relevos")?.textContent).toBe("2");
    expect(dato("obligaciones")?.textContent).toBe("1");
    expect(dato("fichas")?.textContent).toBe("12");
    // UNA petición, no cinco: la barra lateral y la pantalla comparten el
    // mismo panel (ver `residencia-panel.ts`). Con dos, el menú podría
    // decir 4 y la pantalla 3.
    expect(llamadasAlPanel).toBe(1);
  });

  it("y los dice con su sustantivo para quien usa lector de pantalla", async () => {
    servidorDeResidencia();
    await pintar(shell);
    const dato = (clave: string) =>
      container
        .querySelector(`[data-test="contador-${clave}"]`)
        ?.getAttribute("aria-label");
    expect(dato("incidencias")).toBe("4 incidencias abiertas");
    expect(dato("relevos")).toBe("2 relevos sin confirmar");
    expect(dato("obligaciones")).toBe("1 obligación vencida");
    expect(dato("fichas")).toBe("12 fichas de residentes incompletas");
  });

  it("rojo lo grave y lo vencido, ámbar lo demás", async () => {
    servidorDeResidencia();
    await pintar(shell);
    const clase = (clave: string) =>
      container.querySelector(`[data-test="contador-${clave}"]`)?.className ?? "";
    // Hay una N3 abierta y una obligación vencida.
    expect(clase("incidencias")).toContain("text-red-700");
    expect(clase("obligaciones")).toContain("text-red-700");
    // Un relevo sin firmar y una ficha sin imprescindibles no son graves.
    expect(clase("relevos")).toContain("text-amber-700");
    expect(clase("fichas")).toContain("text-amber-700");
  });

  it("con todo a cero NO hay contadores: un menú tranquilo no lleva números", async () => {
    servidorDeResidencia();
    panelDelServidor = panelTranquilo();
    await pintar(shell);
    for (const clave of ["incidencias", "relevos", "obligaciones", "fichas"]) {
      expect(
        container.querySelector(`[data-test="contador-${clave}"]`),
        clave,
      ).toBeNull();
    }
  });

  it("y un panel con otra forma deja el menú sin contadores, NO sin menú", async () => {
    // El despliegue a medias. Lo que no puede pasar es que la directora
    // se quede sin barra lateral y sin forma de llegar a ninguna parte.
    servidorDeResidencia();
    panelDelServidor = { hola: "qué tal" };
    await pintar(shell);
    expect(destinosDelMenu()).toHaveLength(6);
    expect(
      container.querySelector('[data-test="contador-incidencias"]'),
    ).toBeNull();
  });

  it("y con un 403 de «esto es de dirección», tampoco se cae", async () => {
    servidorDeResidencia();
    panelDelServidor = new FakeApiError(
      403,
      "El panel de dirección lo ven la dirección y quien tenga un rol directivo.",
      "PANEL_ES_DE_DIRECCION",
    );
    await pintar(shell);
    expect(destinosDelMenu()).toHaveLength(6);
  });

  it("el contador de obligaciones enseña lo VENCIDO antes que lo de hoy", () => {
    // Función pura: con una vencida, el contador es 1 y rojo, aunque hoy
    // toquen tres. Sumarlas daría un número que no baja nunca a cero.
    const panel = panelDePrueba();
    expect(contadorDelMenu("obligaciones", panel)).toEqual({
      n: 1,
      grave: true,
      texto: "1 obligación vencida",
    });
    // Y sin nada vencido, lo de hoy que falte, en ámbar: dos de las tres
    // (la tercera está hecha).
    const sinVencidas = panelDePrueba({
      obligaciones: { ...panel.obligaciones, vencidas: [] },
    });
    expect(contadorDelMenu("obligaciones", sinVencidas)).toEqual({
      n: 2,
      grave: false,
      texto: "2 obligaciones para hoy",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
//  5 · EL PANEL
// ════════════════════════════════════════════════════════════════════

describe("cuadro-de-control · el panel", () => {
  it("la cabecera saluda, da la fecha, el turno y cuántos hay dentro", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    const t = texto();
    expect(t).toContain("Carmen");
    expect(t).toContain("23 de octubre");
    expect(t).toContain("turno de mañana, hasta las 15:00");
    expect(t).toContain("41");
    expect(t).toContain("residentes en el centro");
    // Las ausencias todavía no existen, así que no se enseña un «0 fuera»
    // que afirmaría que no hay nadie en el hospital.
    expect(t).not.toMatch(/\d+ fuera/);
  });

  it("las cuatro cifras se abren, cada una en su sitio", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    const href = (marca: string) =>
      container.querySelector(`[data-test="cifra-${marca}"]`)?.getAttribute("href");
    expect(href("incidencias")).toBe("/admin/residencia/incidencias?abiertas=1");
    expect(href("relevos")).toBe("/admin/residencia/relevos");
    expect(href("obligaciones")).toBe("/admin/residencia/obligaciones");
    expect(href("fichas")).toBe("/admin/residencia/residentes?completar=c1");
  });

  it("la cifra de incidencias dice cuántas graves y cuántas sin comunicar", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    expect(texto()).toContain("1 grave · 2 sin comunicar a la familia");
  });

  it("con 0 de todo enseña «Nada abierto. Todo al día.» y NO cuatro ceros rojos", async () => {
    servidorDeResidencia();
    panelDelServidor = panelTranquilo();
    await pintar(<PanelPage />);
    expect(container.querySelector('[data-test="panel-tranquilo"]')).not.toBeNull();
    expect(texto()).toContain("Nada abierto. Todo al día.");
    // Las cuatro tarjetas no están: cuatro números grandes con un cero
    // son cuatro avisos de que no pasa nada.
    for (const marca of ["incidencias", "relevos", "obligaciones", "fichas"]) {
      expect(container.querySelector(`[data-test="cifra-${marca}"]`), marca).toBeNull();
    }
    // Y «Ahora» y «Hoy» siguen ahí: en un día tranquilo son lo que tiene
    // contenido.
    expect(texto()).toContain("Ahora");
    expect(texto()).toContain("Hoy");
  });

  it("«Hoy» pone lo vencido delante y lo tacha desde aquí", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    const t = texto();
    expect(t.indexOf("Revisión mensual de extintores")).toBeLessThan(
      t.indexOf("Registros APPCC de cocina"),
    );
    expect(t).toContain("Venció el 20-10-2026 (3 días)");
    // La casilla de una ISO o de una interna marca hecho sin salir.
    const casillas = [...container.querySelectorAll('[data-test="casilla-tachable"]')];
    expect(casillas.length).toBe(2);
    await act(async () => {
      (casillas[0] as HTMLButtonElement).click();
    });
    expect(marcadas).toEqual(["/residencia/ocurrencias/o1/hecha"]);
  });

  it("y la casilla de una LEGAL abre la obligación: ahí va la evidencia", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    const conEvidencia = [
      ...container.querySelectorAll('[data-test="casilla-con-evidencia"]'),
    ];
    // La vencida (extintores) es LEGAL; la de jornada ya está hecha.
    expect(conEvidencia).toHaveLength(1);
    expect(conEvidencia[0]!.getAttribute("href")).toBe(
      "/admin/residencia/obligaciones?duty=d9",
    );
    expect(marcadas).toEqual([]);
  });

  it("«Ahora» da el turno por planta y lo que no puede esperar", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    const t = texto();
    expect(t).toContain("Primera");
    expect(t).toContain("18 de 29");
    expect(t).toContain("Lo que no puede esperar");
    expect(t).toContain("Caída · hab. 112");
    expect(t).toContain("Pendiente de que la cierre otra persona");
  });

  it("y «Vence en los próximos 60 días» ya no está: eso es Obligaciones", async () => {
    servidorDeResidencia();
    await pintar(<PanelPage />);
    expect(texto()).not.toContain("próximos 60 días");
  });
});
