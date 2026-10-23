// hotfix-menu-capabilities · lo que se vio en producción, en la cuenta de
// Jardín de Gredos:
//
//   1. «Bonos» aparecía en el menú de TODAS las cuentas y «Contrato de
//      datos» en el de todo OWNER aunque su cuenta no tuviera la clínica.
//      El filtro de `AdminShell` evaluaba seis capabilities a mano y las
//      dos últimas que se añadieron al tipo caían en un `return true`.
//   2. Al entrar en «Bonos» desde una cuenta sin bonos, la pantalla se
//      quedaba en «Cargando bonos…» para siempre: la carga contestaba la
//      404 del gate, el `catch` guardaba el error y el aviso de «no tiene
//      el módulo» se saltaba porque sólo se pintaba con `error === null`.
//
// Lo que fija este fichero:
//
//   · Cada capability esconde SUS entradas y sólo las suyas. Se comprueba
//     recorriendo `NAV_ITEMS` entero, no con una lista escrita a mano:
//     así una capability nueva sin rama en el filtro —o con la rama
//     cableada al flag equivocado— sale en rojo sin tocar este fichero.
//     (La OTRA mitad de la garantía es de tipos: el `switch` de
//     `capabilidadActiva` es exhaustivo y el `default` asigna a un
//     `never`, así que una capability sin rama no compila. Eso lo caza
//     `tsc -b`, que corre en CI.)
//   · Mientras las capacidades no han llegado (`caps === null`) no se
//     pinta ninguna entrada gateada: no parpadea.
//   · `BonosPage` con la 404 del gate pinta el aviso, y con cualquier
//     otro fallo pinta el fallo. Nunca el cargador.

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
//
// `settings` y `tenant` son lo que contestan las dos llamadas de las que
// salen las capacidades. Cada test los deja como quiere antes de pintar.
let settings: Record<string, unknown> = {};
let tenant: Record<string, unknown> = {};
// Lo que contesta la carga de la pantalla de Bonos: `null` = contesta
// bien; un `FakeApiError` = lo lanza.
let falloDeBonos: FakeApiError | null = null;
// Cuántas peticiones de capacidades se quedan colgadas a propósito (para
// el caso `caps === null`).
let capacidadesColgadas = false;

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string) => {
    if (path === "/admin/tenant/settings") {
      if (capacidadesColgadas) return new Promise(() => {});
      return { settings };
    }
    if (path === "/auth/me") {
      if (capacidadesColgadas) return new Promise(() => {});
      return { user: { id: "u1", email: "o@x.es", role: "OWNER" }, tenant };
    }
    if (path.startsWith("/admin/bonos/")) {
      if (falloDeBonos) throw falloDeBonos;
      return {
        ajustes: {
          etiqueta: "bono",
          noShow: "consumir",
          caducidadMeses: null,
          modoCanje: "LINEA_CERO",
        },
        numeracion: {
          candadoPuesto: true,
          arranque: null,
          confirmadoEl: null,
          ultimoEmitido: 0,
          bonosEmitidos: 0,
          siguienteSiConfirmas: null,
        },
        plantillas: [],
      };
    }
    // El badge de la bandeja de Holded y lo que pida cualquier entrada.
    return { count: 0, items: [], errors: [] };
  }),
  clearTokens: vi.fn(),
  // OWNER + impersonando: así `ownerOnly` y `superAdminOnly` dejan pasar
  // TODAS las entradas y lo único que decide es la capability, que es lo
  // que este fichero prueba.
  readCurrentRole: () => "OWNER",
  readImpersonationState: () => ({ tenantId: "t1", tenantName: "X" }),
  readEffectiveAuth: () => ({ canEdit: true, readonlyReason: null }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const real = await orig<typeof import("react-router-dom")>();
  return { ...real, useNavigate: () => navigate };
});

const { AdminShell, NAV_ITEMS } = await import("../src/AdminShell.js");
const { BonosPage } = await import("../src/pages/BonosPage.js");
const { CenteredLoader } = await import("../src/ui.js");
const { refrescarCapacidades, __resetCapacidadesParaTests } = await import(
  "../src/capabilities.js"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  settings = {};
  tenant = {};
  falloDeBonos = null;
  capacidadesColgadas = false;
  navigate.mockClear();
  __resetCapacidadesParaTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function enlace(href: string): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
}

async function pintar(nodo: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter>{nodo}</MemoryRouter>);
  });
  // Dos vueltas: la primera resuelve el `Promise.all` de las capacidades,
  // la segunda el re-render que provoca.
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const shell = (
  <AdminShell title="X">
    <div />
  </AdminShell>
);

// ── Cómo se enciende cada capability en el servidor de arriba ─────────
//
// Es el ÚNICO sitio de este fichero donde se nombra una capability a
// mano, y a propósito: la lista de abajo tiene que cubrir todas las que
// use `NAV_ITEMS`, y el primer test lo comprueba. Una capability nueva
// sin su línea aquí deja el fichero en rojo.
const ENCENDER: Record<
  string,
  () => { settings?: Record<string, unknown>; tenant?: Record<string, unknown> }
> = {
  agenda: () => ({ settings: { agendaEnabled: true } }),
  caja: () => ({ settings: { cajaEnabled: true } }),
  fichaje: () => ({ settings: { fichajeEnabled: true } }),
  clinica: () => ({ settings: { clinicalRecordsEnabled: true } }),
  residencia: () => ({ settings: { residenciaEnabled: true } }),
  bonos: () => ({ settings: { bonosEnabled: true } }),
  holded: () => ({ tenant: { hasHoldedKey: true } }),
  holdedDejado: () => ({ tenant: { holdedDisconnectedAt: "2026-01-01T00:00:00Z" } }),
  // clinica-8 (fase B, 18) · «hosteleria» no es una columna del tenant:
  // es su VERTICAL. Se enciende igual que las demás porque mira UN solo
  // dato, que es lo que este banco exige de una capability del menú.
  hosteleria: () => ({ tenant: { businessType: "HOSPITALITY" } }),
};

/** Deja el servidor con TODO apagado menos la capability que se pide.
 *  `cajaEnabled: false` explícito porque la caja es la única que se lee
 *  con `!== false` (la columna es `@default(true)`). */
function soloEncendida(capability: string | null): void {
  const extra = capability == null ? {} : ENCENDER[capability]!();
  settings = { cajaEnabled: false, ...extra.settings };
  tenant = { hasHoldedKey: false, ...extra.tenant };
}

const CAPABILIDADES_DEL_MENU = [
  ...new Set(
    NAV_ITEMS.map((item) => item.capability).filter(
      (c): c is string => c != null,
    ),
  ),
];

describe("hotfix-menu-capabilities · el filtro del menú", () => {
  it("cada capability del menú tiene su forma de encenderse en este banco", () => {
    // Si esto falla, alguien añadió una capability a `NAV_ITEMS` y el
    // recorrido de abajo no la estaría probando.
    for (const c of CAPABILIDADES_DEL_MENU) {
      expect(Object.keys(ENCENDER)).toContain(c);
    }
  });

  it("los destinos de NAV_ITEMS son únicos, así que buscar por href no miente", () => {
    const destinos = NAV_ITEMS.map((i) => i.to);
    expect(new Set(destinos).size).toBe(destinos.length);
  });

  it.each(CAPABILIDADES_DEL_MENU)(
    "con sólo «%s» encendida se ven SUS entradas y ninguna otra gateada",
    async (capability) => {
      soloEncendida(capability);
      await pintar(shell);

      for (const item of NAV_ITEMS) {
        const visible = enlace(item.to) != null;
        if (item.capability == null) {
          expect(visible, `${item.label} (sin capability)`).toBe(true);
        } else if (item.capability === capability) {
          expect(visible, `${item.label} (${item.capability})`).toBe(true);
        } else {
          expect(visible, `${item.label} (${item.capability})`).toBe(false);
        }
      }
    },
  );

  it("con todas apagadas no se ve ninguna entrada gateada", async () => {
    soloEncendida(null);
    await pintar(shell);
    for (const item of NAV_ITEMS) {
      if (item.capability == null) continue;
      expect(enlace(item.to), `${item.label} (${item.capability})`).toBeNull();
    }
  });

  it("una cuenta sin bonos no ve «Bonos» (el fallo nº 1 de Jardín de Gredos)", async () => {
    // Todo lo demás encendido, bonos NO: antes de este hotfix «Bonos»
    // caía en el `return true` del filtro y se pintaba igual.
    settings = {
      cajaEnabled: true,
      agendaEnabled: true,
      fichajeEnabled: true,
      clinicalRecordsEnabled: true,
      residenciaEnabled: true,
      bonosEnabled: false,
    };
    tenant = { hasHoldedKey: true };
    await pintar(shell);
    expect(enlace("/admin/bonos")).toBeNull();
    // Y el control: con el módulo encendido sí sale. Por el camino de
    // `refrescarCapacidades` —lo que hace Ajustes al guardar— y no
    // volviendo a montar, que es lo que haría un F5.
    settings = { ...settings, bonosEnabled: true };
    await act(async () => {
      await refrescarCapacidades();
    });
    expect(enlace("/admin/bonos")).not.toBeNull();
  });

  it("una cuenta sin clínica no ve «Contrato de datos» (el fallo nº 2)", async () => {
    settings = { cajaEnabled: true, agendaEnabled: true, clinicalRecordsEnabled: false };
    tenant = { hasHoldedKey: true };
    await pintar(shell);
    expect(enlace("/admin/contrato-tratamiento")).toBeNull();
  });

  it("una residencia sí lo ve: tiene la clínica encendida debajo", async () => {
    // Un tenant de residencia tiene además la clínica (lo dice
    // `capabilities.ts`), y el contrato de encargado es justo lo que ese
    // centro necesita aceptar.
    settings = { cajaEnabled: true, residenciaEnabled: true, clinicalRecordsEnabled: true };
    tenant = { hasHoldedKey: false };
    await pintar(shell);
    expect(enlace("/admin/contrato-tratamiento")).not.toBeNull();
  });

  it("mientras las capacidades no llegan no se pinta nada gateado", async () => {
    capacidadesColgadas = true;
    await pintar(shell);
    for (const item of NAV_ITEMS) {
      if (item.capability == null) continue;
      expect(enlace(item.to), `${item.label} (${item.capability})`).toBeNull();
    }
  });
});

describe("hotfix-menu-capabilities · BonosPage no se queda cargando", () => {
  const texto = () => container.textContent ?? "";

  it("con la 404 del gate pinta el aviso del módulo, no el cargador", async () => {
    settings = { cajaEnabled: true, bonosEnabled: false };
    tenant = { hasHoldedKey: false };
    falloDeBonos = new FakeApiError(
      404,
      "Route GET:/admin/bonos/ajustes not found",
      "NOT_FOUND",
    );
    await pintar(<BonosPage />);
    expect(texto()).toContain("no tiene los bonos de sesiones encendidos");
    expect(texto()).not.toContain("Cargando bonos");
  });

  it("y lo pinta aunque las capacidades digan que sí: manda el servidor", async () => {
    // El caso que dejaba el cuelgue más raro: `bonosEnabled: true` en los
    // ajustes y la puerta contestando 404 (un despliegue a medias, o la
    // columna cambiada con la pantalla abierta).
    settings = { cajaEnabled: true, bonosEnabled: true };
    tenant = { hasHoldedKey: false };
    falloDeBonos = new FakeApiError(404, "not found", "NOT_FOUND");
    await pintar(<BonosPage />);
    expect(texto()).toContain("no tiene los bonos de sesiones encendidos");
    expect(texto()).not.toContain("Cargando bonos");
  });

  it("con un 500 cuenta el error y da «Reintentar», no el cargador", async () => {
    settings = { cajaEnabled: true, bonosEnabled: true };
    tenant = { hasHoldedKey: false };
    falloDeBonos = new FakeApiError(500, "La base no responde", "BOOM");
    await pintar(<BonosPage />);
    expect(texto()).toContain("La base no responde");
    expect(texto()).toContain("Reintentar");
    expect(texto()).not.toContain("Cargando bonos");
  });

  it("y con el módulo encendido y el servidor contestando, la pantalla de siempre", async () => {
    settings = { cajaEnabled: true, bonosEnabled: true };
    tenant = { hasHoldedKey: false };
    await pintar(<BonosPage />);
    expect(texto()).not.toContain("Cargando bonos");
    expect(texto()).not.toContain("no tiene los bonos de sesiones encendidos");
  });
});

describe("hotfix-menu-capabilities · el cargador compartido", () => {
  // El mecanismo con el que se arreglaron de golpe las otras quince
  // pantallas que tenían el mismo patrón (ver el done del bloque): el
  // error le gana al cargador en el ÚNICO sitio donde se decide.
  it("sin error pinta la etiqueta de siempre", async () => {
    await pintar(<CenteredLoader label="Cargando tiendas…" />);
    expect(container.textContent).toContain("Cargando tiendas…");
  });

  it("con error pinta el error y «Reintentar», y NO la etiqueta", async () => {
    await pintar(
      <CenteredLoader label="Cargando tiendas…" error="La base no responde" />,
    );
    expect(container.textContent).toContain("La base no responde");
    expect(container.textContent).toContain("Reintentar");
    expect(container.textContent).not.toContain("Cargando tiendas…");
  });
});
