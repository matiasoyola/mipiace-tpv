// bloque iva-exento-sanitario · el chip «Exento · sanitario» del editor
// de catálogo.
//
// Lo que este banco fija:
//
//   1. **El chip SÓLO aparece con la historia clínica encendida.** Un bar
//      no lo ve. Es la decisión 5 del bloque, y lo que evita es que en el
//      catálogo del Bar La Maestranza haya un botón para dejar de cobrar
//      el IVA de las cañas.
//   2. Elegir «Exento» manda `taxRate: 0` y la causa E1, y el aviso verde
//      del mockup sale en ese momento.
//   3. **El rótulo del campo de precio cambia a «Precio»**: con exento no
//      hay «precio con IVA» distinto del precio (decisión 4), y una
//      etiqueta que no describe el campo es exactamente el bug que
//      catalogo-en-alta vino a arreglar.
//   4. Un producto YA exento abre el formulario con el chip puesto, y
//      desmarcarlo manda `exemptionCause: null` — no `undefined`, que en
//      un PATCH significa «no lo toques».
//   5. Si un producto exento llega a un comercio SIN clínica, el chip se
//      pinta igualmente para poder quitarlo.
//   6. La fila del listado dice «Exento · sanitario», no «IVA 0%».

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
  priceGross: number;
  taxRate: number;
  exemptionCause: string | null;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
  tags: string[];
  source: "HOLDED" | "LOCAL";
  sellableViaTpv: boolean;
  editable: boolean;
}

let items: FakeProduct[] = [];
let localCount = 0;
let clinica = false;
const posted: Array<{ path: string; method?: string; body: Record<string, unknown> }> = [];

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
      posted.push({
        path,
        method: opts.method,
        body: opts.body as Record<string, unknown>,
      });
      return { product: items[0] };
    }
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "rosario@podologia.es", role: "OWNER" },
        tenant: { hasHoldedKey: false, holdedEnabled: false },
      };
    }
    if (path === "/admin/tenant/settings") {
      return { settings: { clinicalRecordsEnabled: clinica } };
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
const { __resetCapacidadesParaTests } = await import("../src/capabilities.js");

let container: HTMLDivElement;
let root: Root;

const QUIROPODIA: FakeProduct = {
  id: "p-quiro",
  name: "Quiropodia",
  sku: "LOC-QUIRO",
  barcode: null,
  basePrice: 35,
  priceGross: 35,
  taxRate: 0,
  exemptionCause: "E1",
  kind: "SERVICE",
  active: true,
  tags: [],
  source: "LOCAL",
  sellableViaTpv: true,
  editable: true,
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  items = [];
  localCount = 0;
  clinica = false;
  posted.length = 0;
  __resetCapacidadesParaTests();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <CatalogoPage />
      </MemoryRouter>,
    );
  });
  // El buscador lleva debounce de 250 ms.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

function setValue(el: HTMLInputElement, value: string): void {
  // React lleva su propio tracker del valor: hay que pasar por el setter
  // nativo del prototipo para que se entere (el mismo truco que Testing
  // Library por dentro).
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const texto = () => container.textContent ?? "";

function botonCon(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;
}

const chipExencion = () => botonCon("Exento · sanitario");

async function abrirAlta() {
  await act(async () => botonCon("Nuevo producto")!.click());
}

async function abrirEdicion() {
  await act(async () => botonCon("Editar")!.click());
}

async function enviar() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

const etiquetaPrecio = () =>
  container.querySelector('label[for="cat-price"]')?.textContent ?? null;

describe("iva-exento-sanitario · el chip sólo existe con clínica", () => {
  it("SIN clínica no se pinta: un bar no ve la exención sanitaria", async () => {
    clinica = false;
    localCount = 1;
    await render();
    await abrirAlta();
    expect(chipExencion()).toBeUndefined();
    // Y los cuatro tramos de siempre siguen ahí.
    expect(texto()).toContain("21 %");
    expect(texto()).toContain("Otro…");
  });

  it("CON clínica se pinta, con su etiqueta y su precepto", async () => {
    clinica = true;
    localCount = 1;
    await render();
    await abrirAlta();
    const chip = chipExencion();
    expect(chip).toBeDefined();
    expect(chip!.textContent).toContain("Exento · sanitario");
    expect(chip!.textContent).toContain("art. 20.Uno.3º");
    // Apagado al abrir el alta: el caso normal es el 21 %.
    expect(chip!.getAttribute("aria-pressed")).toBe("false");
  });

  // Que la etiqueta duplicada en esta pantalla y la de
  // `@mipiacetpv/ticket-model` no se separen lo fija
  // `apps/api/test/iva-exento-sanitario.test.ts`: `apps/admin` no depende
  // del paquete fiscal a propósito (la misma razón que `TAX_RATES`), así
  // que desde aquí no se puede comparar con la fuente.
});

describe("iva-exento-sanitario · elegir la exención", () => {
  beforeEach(() => {
    clinica = true;
    localCount = 1;
  });

  it("enciende el aviso verde del mockup y apaga el tramo que estuviera", async () => {
    await render();
    await abrirAlta();
    expect(texto()).not.toContain("El precio es el que paga el paciente");
    await act(async () => chipExencion()!.click());
    expect(texto()).toContain("El precio es el que paga el paciente. Sin IVA.");
    expect(chipExencion()!.getAttribute("aria-pressed")).toBe("true");
    expect(botonCon("21 %")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("y el campo de precio deja de llamarse «Precio con IVA»", async () => {
    await render();
    await abrirAlta();
    expect(etiquetaPrecio()).toBe("Precio con IVA");
    await act(async () => chipExencion()!.click());
    // Con exento no hay IVA, así que no hay «precio con IVA» distinto del
    // precio. Mantener el rótulo sería volver a poner una etiqueta que no
    // describe el campo — el bug de catalogo-en-alta.
    expect(etiquetaPrecio()).toBe("Precio");
  });

  it("manda taxRate 0 y la causa E1", async () => {
    await render();
    await abrirAlta();
    await act(async () => {
      setValue(container.querySelector("#cat-name") as HTMLInputElement, "Quiropodia");
      setValue(container.querySelector("#cat-price") as HTMLInputElement, "35,00");
      chipExencion()!.click();
    });
    await enviar();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.body).toMatchObject({
      name: "Quiropodia",
      priceGross: 35,
      taxRate: 0,
      exemptionCause: "E1",
    });
  });

  it("y FUERZA el 0 % aunque se venga de «Otro… 7»", async () => {
    // El camino por el que esto se rompería: abrir la ficha, teclear un
    // IGIC del 7 y después pulsar el chip de exento. El 7 no puede viajar.
    await render();
    await abrirAlta();
    await act(async () => {
      setValue(container.querySelector("#cat-name") as HTMLInputElement, "X");
      setValue(container.querySelector("#cat-price") as HTMLInputElement, "10");
      botonCon("Otro…")!.click();
    });
    await act(async () => {
      setValue(container.querySelector("#cat-tax-custom") as HTMLInputElement, "7");
    });
    await act(async () => chipExencion()!.click());
    // El campo libre se esconde al elegir exento: ya no hay tipo que pedir.
    expect(container.querySelector("#cat-tax-custom")).toBeNull();
    await enviar();
    expect(posted[0]!.body).toMatchObject({ taxRate: 0, exemptionCause: "E1" });
  });

  it("sin exención se manda `exemptionCause: null`, no se omite", async () => {
    await render();
    await abrirAlta();
    await act(async () => {
      setValue(container.querySelector("#cat-name") as HTMLInputElement, "Crema");
      setValue(container.querySelector("#cat-price") as HTMLInputElement, "12");
    });
    await enviar();
    expect(posted[0]!.body.exemptionCause).toBeNull();
  });
});

describe("iva-exento-sanitario · editar un producto exento", () => {
  beforeEach(() => {
    items = [QUIROPODIA];
    localCount = 1;
  });

  it("abre con el chip PUESTO y con el aviso verde", async () => {
    clinica = true;
    await render();
    await abrirEdicion();
    expect(chipExencion()!.getAttribute("aria-pressed")).toBe("true");
    expect(texto()).toContain("El precio es el que paga el paciente");
    expect(etiquetaPrecio()).toBe("Precio");
  });

  it("y el precio abre con el precio: ida y vuelta sin céntimos perdidos", async () => {
    clinica = true;
    await render();
    await abrirEdicion();
    // Con coma, que es como se teclea en un teclado español.
    expect((container.querySelector("#cat-price") as HTMLInputElement).value).toBe(
      "35,00",
    );
    await enviar();
    expect(posted[0]!.body).toMatchObject({
      priceGross: 35,
      taxRate: 0,
      exemptionCause: "E1",
    });
  });

  it("desmarcarlo manda `null`, que en un PATCH es «quítala»", async () => {
    clinica = true;
    await render();
    await abrirEdicion();
    await act(async () => chipExencion()!.click());
    expect(texto()).not.toContain("El precio es el que paga el paciente");
    await enviar();
    // `undefined` significaría «no toques la causa» y la ficha se quedaría
    // exenta para siempre.
    expect(posted[0]!.body.exemptionCause).toBeNull();
    expect(posted[0]!.method).toBe("PATCH");
  });

  it("y en un comercio SIN clínica el chip SE PINTA, para poder quitarlo", async () => {
    // No debería pasar, y si pasa, una ficha que cobra exento con una
    // pantalla que dice que lleva el 21 % es peor que una opción de más.
    clinica = false;
    await render();
    await abrirEdicion();
    expect(chipExencion()).toBeDefined();
    expect(chipExencion()!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("iva-exento-sanitario · la fila del listado", () => {
  it("dice «Exento · sanitario», no «IVA 0%»", async () => {
    items = [QUIROPODIA];
    localCount = 1;
    await render();
    expect(texto()).toContain("Exento · sanitario · art. 20.Uno.3º");
    expect(texto()).not.toContain("IVA 0%");
  });

  it("y un producto al 0 % SIN causa sigue diciendo «IVA 0%»", async () => {
    // Es un 0 % SUJETO, que es otra operación. No se confunden nunca.
    items = [{ ...QUIROPODIA, id: "p-folleto", name: "Folleto", exemptionCause: null }];
    localCount = 1;
    await render();
    expect(texto()).toContain("IVA 0%");
    expect(texto()).not.toContain("Exento · sanitario");
  });
});
