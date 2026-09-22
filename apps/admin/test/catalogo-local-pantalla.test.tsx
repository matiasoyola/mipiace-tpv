// catalogo-local · la pantalla de catálogo en el panel.
//
// Lo que este banco fija:
//
//   1. El botón de alta SÓLO se pinta sin Holded. Es cortesía — la
//      puerta de verdad es el 403 del servidor, probado aparte en
//      `apps/api/test/catalogo-local-crud.test.ts` — pero si se pintara,
//      el propietario de Sole daría al botón y comería un error.
//   2. Con Holded se explica POR QUÉ no se edita, con palabras y no con
//      un campo gris.
//   3. Por qué el TPV no vende un producto: los tres filtros de
//      `tpv-catalog/routes.ts:81-86`, legibles en la fila. Es la razón
//      de ser de la pantalla (addendum 1) y lo que habría evitado los 54
//      servicios invisibles de Peluquería Sole.
//   4. Los tres estados vacíos, que significan cosas distintas.
//   5. El SKU obligatorio en la interfaz (criterio 5 del bloque).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: number;
  taxRate: number;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
  tags: string[];
  source: "HOLDED" | "LOCAL";
  sellableViaTpv: boolean;
  editable: boolean;
}

// catalogo-local (addendum 3) · la pantalla pregunta "¿usa Holded?"
// (`holdedEnabled`), no "¿lo tiene conectado?" (`hasHoldedKey`). Mismo
// predicado exacto que la puerta del servidor, para que el botón de alta
// y el 403 no puedan discrepar.
let usaHolded = false;
let hasHoldedKey = false;
let items: FakeProduct[] = [];
let localCount = 0;
const posted: Array<{ path: string; body: unknown }> = [];

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method) {
      posted.push({ path, body: opts.body });
      return { product: items[0] };
    }
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "o@x.es", role: "OWNER" },
        tenant: { hasHoldedKey, holdedEnabled: usaHolded },
      };
    }
    if (path.startsWith("/catalog/products/sku-suggestion")) {
      return { sku: "LOC-AB12CD34" };
    }
    if (path.startsWith("/catalog/products")) {
      return { items, total: items.length, page: 1, pageSize: 200, localCount };
    }
    return {};
  }),
  readTokens: () => ({ access: "a", refresh: "r" }),
  clearTokens: vi.fn(),
  readCurrentRole: () => "OWNER",
  readImpersonationState: () => null,
}));

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-shell={title}>{children}</div>
  ),
}));

const { CatalogoPage } = await import("../src/pages/CatalogoPage.js");

let container: HTMLDivElement;
let root: Root;

function product(p: Partial<FakeProduct> & { name: string }): FakeProduct {
  return {
    id: p.name.toLowerCase().replace(/\s/g, "-"),
    sku: "SKU-1",
    barcode: null,
    basePrice: 12.5,
    taxRate: 21,
    kind: "PRODUCT",
    active: true,
    tags: [],
    source: "LOCAL",
    sellableViaTpv: true,
    editable: true,
    ...p,
  };
}

beforeEach(() => {
  usaHolded = false;
  hasHoldedKey = false;
  items = [];
  localCount = 0;
  posted.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <CatalogoPage />
      </MemoryRouter>,
    );
  });
  // El buscador lleva debounce de 250 ms: hay que dejarlo correr.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

// React 18 lleva su propio tracker del valor de los inputs: asignar
// `.value` a pelo y lanzar "input" NO dispara el `onChange`, porque React
// compara contra el valor que él recuerda y no ve cambio. Hay que pasar
// por el setter nativo del prototipo para que el tracker se entere. Es el
// mismo truco que usa Testing Library por dentro.
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

const text = () => container.textContent ?? "";

function buttonWith(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;
}

describe("catalogo-local · el alta sólo se ofrece sin Holded", () => {
  it("sin Holded se pinta el botón de nuevo producto", async () => {
    localCount = 1;
    items = [product({ name: "Corte de pelo" })];
    await render();
    expect(buttonWith("Nuevo producto")).toBeDefined();
  });

  it("CON Holded NO se pinta el botón, y se explica por qué", async () => {
    usaHolded = true;
    hasHoldedKey = true;
    items = [product({ name: "Champú", source: "HOLDED", editable: false })];
    await render();
    expect(buttonWith("Nuevo producto")).toBeUndefined();
    expect(text()).toContain("Tu catálogo lo gestiona Holded");
    // La frase dice la consecuencia, no sólo la regla.
    expect(text()).toContain("sincronización lo devolvería");
  });

  it("un producto de Holded no trae botón de editar: trae la razón escrita", async () => {
    usaHolded = true;
    hasHoldedKey = true;
    items = [product({ name: "Champú", source: "HOLDED", editable: false })];
    await render();
    expect(buttonWith("Editar")).toBeUndefined();
    expect(text()).toContain("Se edita en Holded");
  });

  it("un producto local sí trae botón de editar", async () => {
    localCount = 1;
    items = [product({ name: "Corte de pelo" })];
    await render();
    expect(buttonWith("Editar")).toBeDefined();
  });
});

describe("catalogo-local · por qué el TPV no lo vende", () => {
  it("inactivo: lo dice", async () => {
    items = [product({ name: "Viejo", active: false })];
    await render();
    expect(text()).toContain("No aparece en el TPV");
    expect(text()).toContain("está inactivo");
  });

  it("sin SKU: lo dice", async () => {
    items = [product({ name: "Sin ref", sku: null })];
    await render();
    expect(text()).toContain("no tiene SKU");
  });

  it("no vendible: lo dice", async () => {
    items = [product({ name: "Bloqueado", sellableViaTpv: false })];
    await render();
    expect(text()).toContain("está marcado como no vendible");
  });

  it("enumera TODAS las razones, no la primera", async () => {
    // Arreglar una y que siga sin aparecer es el peor final posible.
    items = [product({ name: "Todo mal", active: false, sku: null, sellableViaTpv: false })];
    await render();
    expect(text()).toContain("está inactivo");
    expect(text()).toContain("no tiene SKU");
    expect(text()).toContain("está marcado como no vendible");
  });

  it("un producto sano NO lleva aviso: el ruido constante no se lee", async () => {
    items = [product({ name: "Perfecto" })];
    await render();
    expect(text()).not.toContain("No aparece en el TPV");
  });
});

describe("catalogo-local · los estados vacíos dicen cosas distintas", () => {
  it("sin catálogo y sin Holded: invita a crear el primero", async () => {
    items = [];
    localCount = 0;
    await render();
    expect(text()).toContain("Tu catálogo todavía está vacío");
    expect(buttonWith("Nuevo producto")).toBeDefined();
  });

  it("con Holded y sin catálogo: dice que llegará por sync, no invita a crear", async () => {
    usaHolded = true;
    hasHoldedKey = true;
    items = [];
    await render();
    expect(text()).toContain("Todavía no hay productos de Holded");
    expect(text()).not.toContain("Tu catálogo todavía está vacío");
  });

  it("búsqueda sin resultados: NO dice que el catálogo esté vacío", async () => {
    items = [];
    localCount = 4;
    await render();
    const input = container.querySelector("input[aria-label]") as HTMLInputElement;
    await act(async () => {
      setValue(input, "zzzz");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(text()).toContain("Sin resultados");
    expect(text()).not.toContain("Tu catálogo todavía está vacío");
  });
});

describe("catalogo-local · el formulario", () => {
  async function openForm(): Promise<void> {
    await render();
    await act(async () => {
      buttonWith("Nuevo producto")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("no es un modal: el formulario convive con la lista", async () => {
    // `docs/ux-principles.md` §6 prohíbe "modales bloqueando todo para
    // algo no-crítico", y dar de alta un producto es lo más cotidiano
    // que hay aquí.
    items = [product({ name: "Ya existente" })];
    localCount = 1;
    await openForm();
    expect(container.querySelector("form")).not.toBeNull();
    // La lista sigue ahí detrás.
    expect(text()).toContain("Ya existente");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("propone un SKU con prefijo LOC-, y lo deja editable", async () => {
    await openForm();
    const sku = container.querySelector("#cat-sku") as HTMLInputElement;
    expect(sku.value).toBe("LOC-AB12CD34");
    expect(sku.disabled).toBe(false);
    expect(sku.readOnly).toBe(false);
  });

  it("sin SKU no deja guardar: lo corta en la interfaz", async () => {
    await openForm();
    const name = container.querySelector("#cat-name") as HTMLInputElement;
    const sku = container.querySelector("#cat-sku") as HTMLInputElement;
    const price = container.querySelector("#cat-price") as HTMLInputElement;
    await act(async () => {
      setValue(name, "Producto");
      setValue(sku, "");
      setValue(price, "10");
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(text()).toContain("El SKU es obligatorio");
    // Y no ha llamado a la API.
    expect(posted).toHaveLength(0);
  });

  it("el IVA ofrece los cuatro tramos y la vía de escape", async () => {
    await openForm();
    const select = container.querySelector("#cat-tax") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(["21", "10", "4", "0", "OTHER"]);
    // El 21 preseleccionado: es el caso normal de los verticales de hoy.
    expect(select.value).toBe("21");
  });

  it('elegir "Otro…" abre el campo libre (el IGIC canario)', async () => {
    await openForm();
    const select = container.querySelector("#cat-tax") as HTMLSelectElement;
    expect(container.querySelector("#cat-tax-custom")).toBeNull();
    await act(async () => {
      setValue(select, "OTHER");
    });
    expect(container.querySelector("#cat-tax-custom")).not.toBeNull();
    expect(text()).toContain("IGIC");
  });

  it("un IVA libre fuera de rango se corta en la interfaz, sin llamar a la API", async () => {
    await openForm();
    const name = container.querySelector("#cat-name") as HTMLInputElement;
    const price = container.querySelector("#cat-price") as HTMLInputElement;
    const select = container.querySelector("#cat-tax") as HTMLSelectElement;
    await act(async () => {
      setValue(name, "Producto");
      setValue(price, "10");
      setValue(select, "OTHER");
    });
    const custom = container.querySelector("#cat-tax-custom") as HTMLInputElement;
    await act(async () => {
      setValue(custom, "150");
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(text()).toContain("entre 0 y 100");
    expect(posted).toHaveLength(0);
  });

  it("el precio acepta coma: en un teclado español es lo natural", async () => {
    await openForm();
    const name = container.querySelector("#cat-name") as HTMLInputElement;
    const price = container.querySelector("#cat-price") as HTMLInputElement;
    await act(async () => {
      setValue(name, "Producto");
      setValue(price, "18,50");
    });
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(posted).toHaveLength(1);
    expect((posted[0]!.body as { basePrice: number }).basePrice).toBe(18.5);
  });
});
