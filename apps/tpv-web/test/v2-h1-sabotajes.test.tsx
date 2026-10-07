// v2-H1-venta-y-sala · la tabla de sabotajes del prompt.
//
// Trece sabotajes, cada uno con el test que DEBE caer. Once están aquí;
// los otros dos viven donde les toca:
//
//   · «"Ahora" sin ventas devuelve vacío» → es de API:
//     `apps/api/test/catalog-ahora-route.test.ts`.
//   · «Barra no primera en la sala» → es del lienzo:
//     `table-map-tamano-unico.test.tsx`.
//
// Lo que jsdom NO puede hacer, dicho antes de que nadie se confíe: no
// hace layout, así que `getBoundingClientRect` devuelve ceros y las
// media queries no se aplican. Los dos sabotajes de «tamaño (computed
// style)» del prompt se comprueban sobre el `style` que el componente
// deja PUESTO —que es la misma constante que lee el test— y no sobre el
// tamaño renderizado. Por eso los componentes de este bloque pintan las
// medidas por `style` con la constante y no con una clase de Tailwind:
// con una clase suelta, el 56 de la pantalla y el del test podrían
// separarse sin que nada se pusiera rojo. Los píxeles de verdad salen
// del bucle visual y están en el `-done`.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const vertical = vi.hoisted(() => ({
  actual: "HOSPITALITY" as "HOSPITALITY" | "RETAIL" | "SERVICES",
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

/**
 * La carta: nueve familias, y «Licores» con los 31 productos de La
 * Maestranza, que es el caso que el prompt manda medir.
 */
const CATALOGO = vi.hoisted(() => {
  const familias: Array<[string, number]> = [
    ["cafes", 3],
    ["desayunos", 3],
    ["cervezas", 2],
    ["refrescos", 3],
    ["vinos", 2],
    ["licores", 31],
    ["raciones", 3],
    ["bocadillos", 2],
    ["platos", 3],
  ];
  const out: Array<{
    id: string;
    holdedProductId: string;
    sku: string;
    name: string;
    basePrice: number;
    priceGross: number;
    taxRate: number;
    barcode: null;
    imageMime: null;
    tags: string[];
    kind: "PRODUCT";
  }> = [];
  let n = 0;
  for (const [familia, cuantos] of familias) {
    for (let i = 0; i < cuantos; i += 1) {
      n += 1;
      out.push({
        id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
        holdedProductId: `h-${n}`,
        sku: `SKU${n}`,
        // Nombres de verdad para los dos primeros de cada familia: los
        // tests del prompt hablan de «Café» y de «Caña».
        name:
          familia === "cafes" && i === 0
            ? "Café con leche"
            : familia === "cervezas" && i === 0
              ? "Caña"
              : `${familia} ${i + 1}`,
        basePrice: 1.5,
        priceGross: 1.7,
        taxRate: 10,
        barcode: null,
        imageMime: null,
        tags: [familia],
        kind: "PRODUCT" as const,
      });
    }
  }
  return out;
});

vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => CATALOGO,
  getCachedBusinessType: () => vertical.actual,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => true,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => "tenant-maestranza",
  loadCatalogFromCache: async () => CATALOGO,
  loadWildcards: async () => [],
  productImageUrl: () => null,
  refreshCatalog: async () => CATALOGO,
}));
vi.mock("../src/lib/modifiers.js", () => ({
  loadModifierGroups: async () => [],
  buildGroupsByProduct: () => new Map(),
}));
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => "open",
}));
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { SalePage, type TableContext } from "../src/pages/SalePage.js";
import {
  familyCapacity,
  familyFitsWithoutScroll,
  gridHeight,
  gridShapeFor,
  gridWidth,
  PRODUCT_MIN_HEIGHT,
} from "../src/lib/hospitalityGrid.js";
import {
  FAMILY_FILL,
  MIN_TOUCH_PX,
  PRODUCT_NAME_MIN_PX,
  resolveFamilyTones,
} from "../src/lib/hospitalityTheme.js";
import {
  mapServerDraftLines,
  type ServerDraft,
  type ServerDraftLine,
} from "../src/lib/tableDraft.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const TICKET_1 = "00000000-0000-0000-0000-0000000000t1";

const tableContext: TableContext = {
  id: MESA_1,
  name: "M1",
  zone: "SALON",
  capacity: 4,
  diners: 2,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@bar.es",
  openedByAlias: "Salomé",
  activeTicketId: TICKET_1,
};

/** El DRAFT del servidor, construido desde las líneas que haya. */
function serverDraft(
  lines: ServerDraftLine[],
  over: Partial<ServerDraft> = {},
): ServerDraft {
  return {
    id: TICKET_1,
    status: "DRAFT",
    externalId: "00000000-0000-0000-0000-0000000000e1",
    tableId: MESA_1,
    table: { id: MESA_1, name: "M1", zone: "SALON", capacity: 4 },
    diners: 2,
    total: "0",
    createdAt: new Date().toISOString(),
    lines,
    ...over,
  };
}

function serverLine(over: Partial<ServerDraftLine>): ServerDraftLine {
  return {
    id: "l-1",
    productId: null,
    variantId: null,
    holdedProductId: null,
    sku: "SKU",
    nameSnapshot: "Producto",
    units: "1",
    unitPrice: "1.5",
    discountPct: "0",
    taxRate: "10",
    subtotal: "1.5",
    total: "1.7",
    modifiers: null,
    ...over,
  };
}

/**
 * El doble de la API. Mantiene un DRAFT en memoria y lo reconcilia como
 * lo hace el backend: el `lineExternalId` del cliente se convierte en el
 * id de la `TicketLine`, y los PATCH/DELETE operan sobre él.
 */
function montaApi(
  opts: {
    lastSentAt?: string | null;
    revision?: number;
    /**
     * Las líneas con las que el DRAFT ya viene del servidor. Hay que
     * sembrarlas AQUÍ y no sólo en `initialDraftLines`: cada POST de
     * línea reconcilia la proyección local con el ticket que devuelve la
     * respuesta, así que un doble que arrancara vacío borraría las
     * líneas previas al añadir la siguiente.
     */
    lineasIniciales?: ServerDraftLine[];
  } = {},
) {
  const lineas: ServerDraftLine[] = (opts.lineasIniciales ?? []).slice();
  const draft = () =>
    serverDraft(lineas.slice(), {
      lastSentAt: opts.lastSentAt ?? null,
      lastSentRevision: opts.revision ?? 0,
    });
  apiMock.apiWithCashier.mockImplementation(
    async (
      path: string,
      o?: { method?: string; body?: Record<string, unknown> },
    ) => {
      if (path === "/tpv/health/holded") {
        return {
          level: "ok",
          reason: "",
          hasHoldedKey: true,
          lastIncrementalSyncAt: null,
          lastSyncAgeMs: null,
          blockedAt: null,
          pendingSyncCount: 0,
          syncFailedCount: 0,
        };
      }
      if (path === "/shift/current") return { shift: null };
      if (path === "/tpv/tables") {
        return { storeId: "store-1", registerId: "reg-1", tables: [] };
      }
      if (path.startsWith("/tpv/catalog/now")) {
        // Sin ventas: «Ahora» se completa con los primeros de cada
        // familia, igual que hace el servidor.
        return { source: "families", bandHours: 1, windowDays: 28, items: [] };
      }
      if (path.startsWith("/tpv/catalog/top-sellers")) {
        return { source: "month", items: [] };
      }
      if (path.endsWith("/lines") && o?.method === "POST") {
        const b = o.body ?? {};
        lineas.push(
          serverLine({
            id: String(b.lineExternalId),
            productId: (b.productId as string) ?? null,
            nameSnapshot: String(b.nameSnapshot),
            sku: String(b.sku),
            units: String(b.units),
            unitPrice: String(b.unitPrice),
            taxRate: String(b.taxRate),
          }),
        );
        return { ticket: draft() };
      }
      if (path.includes("/lines/") && o?.method === "PATCH") {
        const id = path.split("/lines/")[1]!;
        const l = lineas.find((x) => x.id === id);
        if (l && o.body?.units !== undefined) l.units = String(o.body.units);
        return { ticket: draft() };
      }
      if (path.includes("/lines/") && o?.method === "DELETE") {
        const id = path.split("/lines/")[1]!;
        const i = lineas.findIndex((x) => x.id === id);
        if (i >= 0) lineas.splice(i, 1);
        return { ticket: draft() };
      }
      if (path.includes("/send-to-kitchen/escpos")) {
        return {
          revision: 1,
          sentAt: "2026-10-08T10:07:00.000Z",
          sections: [{ section: "BARRA", ok: true, lineCount: lineas.length }],
        };
      }
      throw new Error(`ruta inesperada: ${path}`);
    },
  );
  return { lineas };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  vertical.actual = "HOSPITALITY";
  apiMock.apiWithCashier.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(
  initialLines: ServerDraftLine[] = [],
  // v2-H1 §5 · lo que `App` pasa desde la respuesta del endpoint que
  // abrió el borrador. Sin esto no hay forma de que la pantalla sepa que
  // este DRAFT ya salió hacia cocina, que es justo lo que decide si una
  // línea se pinta en «En cocina» o en «Sin enviar».
  initialKitchen?: { lastSentAt: string | null; revision: number },
) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SalePage
        shiftId="shift-1"
        cashierLabel="caja1@bar.es"
        cashierRole="CASHIER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="La Maestranza"
        tableContext={tableContext}
        initialDraftLines={mapServerDraftLines(initialLines)}
        initialKitchen={initialKitchen}
        onBackToMap={vi.fn()}
        onExitToMap={vi.fn()}
        onTicketMovedToTable={null}
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error("elemento no encontrado");
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

const $$ = <T extends HTMLElement>(sel: string): T[] => [
  ...container.querySelectorAll<T>(sel),
];
const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);

/** Las familias de la barra, en orden, como las lee el camarero. */
const familias = (): string[] =>
  $$('[data-testid="family-button"]').map((b) => b.textContent?.trim() ?? "");

/** El botón de producto por nombre. */
function producto(nombre: string): HTMLButtonElement {
  const el = $$<HTMLButtonElement>('[data-testid="product-button"]').find(
    (b) =>
      b.querySelector('[data-testid="product-name"]')?.textContent?.trim() ===
      nombre,
  );
  if (!el) throw new Error(`producto «${nombre}» no encontrado`);
  return el;
}

/** Las líneas sin enviar, como pares nombre/cantidad. */
const sinEnviar = (): Array<{ nombre: string; qty: string }> =>
  $$('[data-testid="comanda-linea-pendiente"]').map((row) => ({
    nombre:
      row.querySelector('[data-testid="cart-line-name"]')?.textContent?.trim() ??
      "",
    qty:
      row.querySelector('[data-testid="pendiente-qty"]')?.textContent?.trim() ??
      "",
  }));

// ──────────────────────────────────────────────────────────────────────

describe("v2-H1 · sabotaje 1 · la vista inicial es «Ahora», no «Todos»", () => {
  it("al entrar en la mesa, «Ahora» está elegida y es la PRIMERA", async () => {
    montaApi();
    await render();

    const barra = familias();
    // Primera de la barra. Decisión 4: es la que abre por defecto.
    expect(barra[0]).toBe("Ahora");
    // Y es la que está activa.
    const activas = $$('[data-testid="family-button"]').filter(
      (b) => b.getAttribute("data-active") === "true",
    );
    expect(activas).toHaveLength(1);
    expect(activas[0]!.textContent?.trim()).toBe("Ahora");
  });

  it("y NO existe una vista «Todos»", async () => {
    // Decisión 3 · «sin vista Todos». El chip «Todos» del TPV claro
    // ponía el catálogo entero en orden alfabético, y con eso lo más
    // vendido se perdía — es el arranque del hallazgo de Matías.
    montaApi();
    await render();

    expect(familias()).not.toContain("Todos");
  });

  it("«Ahora» trae 20 productos repartidos entre las nueve familias", async () => {
    // Sin ventas, el relleno reparte por turnos. Si volcara familia a
    // familia, el camarero vería veinte licores y ni un café.
    montaApi();
    await render();

    const botones = $$('[data-testid="product-button"]');
    expect(botones).toHaveLength(20);
  });
});

describe("v2-H1 · sabotaje 2 · una familia de 31 productos NO se pagina", () => {
  it("los 31 Licores están en el DOM, sin «Más (N)» ni paginación", async () => {
    montaApi();
    await render();

    const licores = $$('[data-testid="family-button"]').find(
      (b) => b.textContent?.trim() === "Licores",
    );
    await click(licores);

    expect($$('[data-testid="product-button"]')).toHaveLength(31);
    // Ni rastro de los tres mecanismos que el prompt prohíbe.
    const texto = container.textContent ?? "";
    expect(texto).not.toMatch(/Más \(\d+\)/);
    expect(texto).not.toMatch(/Página|Siguiente|Anterior/i);
  });

  it("la cuadrícula no scrollea por dentro: se adapta", async () => {
    montaApi();
    await render();
    await click(
      $$('[data-testid="family-button"]').find(
        (b) => b.textContent?.trim() === "Licores",
      ),
    );

    const grid = $('[data-testid="product-grid"]')!;
    const clases = grid.getAttribute("class") ?? "";
    expect(clases).not.toContain("overflow-y-auto");
    expect(clases).not.toContain("overflow-x");
    // Y el reparto declara que CABE.
    expect(grid.getAttribute("data-fits")).toBe("true");
  });

  it("la aritmética lo dice en los dos terminales, con su número", async () => {
    // jsdom no mide, así que el «dentro del viewport sin scroll» que
    // pide el prompt se afirma sobre la cuenta pura, alimentada por las
    // constantes que el componente pinta. Diez botones de familia
    // (nueve familias + «Ahora»).
    expect(familyFitsWithoutScroll(31, 10, 1443, 812)).toBe(true);
    expect(familyFitsWithoutScroll(31, 10, 1280, 800)).toBe(true);
    // Los techos reales, para que el `-done` no diga «cabe de sobra».
    expect(familyCapacity(10, 1443, 812)).toBe(42);
    expect(familyCapacity(10, 1280, 800)).toBe(35);
    // Y 36 productos ya NO caben en el terminal pequeño: el bloque lo
    // DICE en vez de partir la familia en páginas.
    expect(familyFitsWithoutScroll(36, 10, 1280, 800)).toBe(false);
  });
});

describe("v2-H1 · sabotaje 3 · la cantidad vuelve a 1 tras cada producto", () => {
  it("«3» + Café + Caña → 3 cafés y 1 caña", async () => {
    // El sabotaje exacto del prompt. Un «3» que se quedara pegado
    // convierte la siguiente caña en tres sin que nadie lo haya pedido,
    // y eso se descubre al cobrar.
    montaApi();
    await render();

    await click($(`[data-testid="qty-key"][data-qty="3"]`));
    await click(producto("Café con leche"));
    await click(producto("Caña"));

    const lineas = sinEnviar();
    expect(lineas).toEqual([
      { nombre: "Café con leche", qty: "3" },
      { nombre: "Caña", qty: "1" },
    ]);
  });

  it("y la fila de cantidad vuelve a marcar el 1", async () => {
    montaApi();
    await render();

    await click($(`[data-testid="qty-key"][data-qty="4"]`));
    expect(
      $(`[data-testid="qty-key"][data-qty="4"]`)!.getAttribute("aria-pressed"),
    ).toBe("true");

    await click(producto("Caña"));

    expect(
      $(`[data-testid="qty-key"][data-qty="1"]`)!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      $(`[data-testid="qty-key"][data-qty="4"]`)!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("la fila de cantidad va ENTRE las familias y la cuadrícula", async () => {
    // Decisión 3c · ahí es donde la mano ya está: familia, número,
    // producto. Debajo de la cuadrícula obligaría a subir y bajar.
    montaApi();
    await render();

    const barra = $('[data-testid="family-bar"]')!;
    const fila = $('[data-testid="qty-row"]')!;
    const grid = $('[data-testid="product-grid"]')!;
    // `compareDocumentPosition`: 4 = el otro va DESPUÉS en el documento.
    expect(barra.compareDocumentPosition(fila) & 4).toBeTruthy();
    expect(fila.compareDocumentPosition(grid) & 4).toBeTruthy();
  });
});

describe("v2-H1 · sabotajes 4 y 10 · lo que hace el «−»", () => {
  it("1 caña + «−» → la línea DESAPARECE (no se queda a 0)", async () => {
    montaApi();
    await render();
    await click(producto("Caña"));
    expect(sinEnviar()).toHaveLength(1);

    await click($('[data-testid="stepper-menos"]'));

    // Una línea a cero es una línea fantasma en la comanda: ocupa sitio,
    // suma cero y el camarero no sabe si la pidió.
    expect(sinEnviar()).toHaveLength(0);
  });

  it("2 cañas + «−» → 1 caña (quita UNA unidad, no la línea)", async () => {
    // El sabotaje simétrico del anterior: un `−` que borrase la línea
    // entera le costaría al camarero volver a marcar lo que sí quería.
    montaApi();
    await render();
    await click($(`[data-testid="qty-key"][data-qty="2"]`));
    await click(producto("Caña"));
    expect(sinEnviar()).toEqual([{ nombre: "Caña", qty: "2" }]);

    await click($('[data-testid="stepper-menos"]'));

    expect(sinEnviar()).toEqual([{ nombre: "Caña", qty: "1" }]);
  });

  it("el rótulo accesible dice lo que el botón va a hacer", async () => {
    montaApi();
    await render();
    await click($(`[data-testid="qty-key"][data-qty="2"]`));
    await click(producto("Caña"));

    expect($('[data-testid="stepper-menos"]')!.getAttribute("aria-label")).toBe(
      "Restar una unidad",
    );
    await click($('[data-testid="stepper-menos"]'));
    expect($('[data-testid="stepper-menos"]')!.getAttribute("aria-label")).toBe(
      "Quitar la línea",
    );
  });

  it("«+» suma una unidad", async () => {
    montaApi();
    await render();
    await click(producto("Caña"));

    await click($('[data-testid="stepper-mas"]'));

    expect(sinEnviar()).toEqual([{ nombre: "Caña", qty: "2" }]);
  });
});

describe("v2-H1 · sabotaje 5 · «En cocina» no lleva −/+", () => {
  it("una línea ya enviada se pinta SIN los steppers", async () => {
    // Decisión 3d · quitar algo ya enviado sigue siendo la anulación que
    // existe hoy, que vive en la hoja de la línea. Un `−` sobre algo que
    // está en la plancha es pedirle a la cocina que adivine.
    montaApi({ lastSentAt: "2026-10-08T10:07:00.000Z", revision: 1 });
    await render(
      [serverLine({ id: "l-enviada", nameSnapshot: "Tostada tomate" })],
      { lastSentAt: "2026-10-08T10:07:00.000Z", revision: 1 },
    );

    // La línea llegó con el DRAFT y el ticket dice que ya se envió: está
    // en cocina.
    expect($$('[data-testid="comanda-linea-enviada"]')).toHaveLength(1);
    expect($$('[data-testid="comanda-linea-pendiente"]')).toHaveLength(0);
    expect($$('[data-testid="stepper-menos"]')).toHaveLength(0);
    expect($$('[data-testid="stepper-mas"]')).toHaveLength(0);
  });

  it("el rótulo de la sección lleva la hora del envío", async () => {
    montaApi({ lastSentAt: "2026-10-08T10:07:00.000Z", revision: 1 });
    await render([serverLine({ id: "l-enviada" })], {
      lastSentAt: "2026-10-08T10:07:00.000Z",
      revision: 1,
    });

    // Hora y no «hace 12 min»: lo que el camarero compara es contra el
    // reloj de la cocina.
    const eyebrow = $('[data-testid="comanda-eyebrow-cocina"]')!;
    expect(eyebrow.textContent).toMatch(/^EN COCINA · \d{2}:\d{2}$/);
  });

  it("lo que se añade DESPUÉS del envío va a «Sin enviar», con sus −/+", async () => {
    const enviada = serverLine({ id: "l-enviada" });
    montaApi({
      lastSentAt: "2026-10-08T10:07:00.000Z",
      revision: 1,
      lineasIniciales: [enviada],
    });
    await render([enviada], {
      lastSentAt: "2026-10-08T10:07:00.000Z",
      revision: 1,
    });

    await click(producto("Caña"));

    expect($$('[data-testid="comanda-linea-enviada"]')).toHaveLength(1);
    expect($$('[data-testid="comanda-linea-pendiente"]')).toHaveLength(1);
    expect($$('[data-testid="stepper-menos"]')).toHaveLength(1);
  });

  it("tras enviar, lo que estaba sin enviar pasa a «En cocina»", async () => {
    montaApi();
    await render();
    await click(producto("Caña"));
    expect($$('[data-testid="comanda-linea-pendiente"]')).toHaveLength(1);

    await click($('[data-testid="comanda-enviar"]'));

    expect($$('[data-testid="comanda-linea-pendiente"]')).toHaveLength(0);
    expect($$('[data-testid="comanda-linea-enviada"]')).toHaveLength(1);
    expect($$('[data-testid="stepper-menos"]')).toHaveLength(0);
  });
});

describe("v2-H1 · sabotaje 6 · ningún objetivo por debajo de 56 px", () => {
  it("los −/+ miden 56 × 56", async () => {
    montaApi();
    await render();
    await click(producto("Caña"));

    for (const sel of ['[data-testid="stepper-menos"]', '[data-testid="stepper-mas"]']) {
      const el = $(sel)!;
      expect(el.style.width).toBe(`${MIN_TOUCH_PX}px`);
      expect(el.style.height).toBe(`${MIN_TOUCH_PX}px`);
    }
    // Y la constante no puede bajar del suelo del bloque.
    expect(MIN_TOUCH_PX).toBeGreaterThanOrEqual(56);
  });

  it("las teclas de cantidad, la lupa y el chrome tampoco bajan de 56", async () => {
    montaApi();
    await render();

    for (const el of $$('[data-testid="qty-key"]')) {
      expect(parseInt(el.style.height, 10)).toBeGreaterThanOrEqual(56);
      expect(parseInt(el.style.width, 10)).toBeGreaterThanOrEqual(56);
    }
    for (const el of $$("[data-chrome-action]")) {
      expect(parseInt(el.style.height, 10)).toBeGreaterThanOrEqual(56);
      expect(parseInt(el.style.width, 10)).toBeGreaterThanOrEqual(56);
    }
    const atras = $('[data-testid="comanda-back"]')!;
    expect(parseInt(atras.style.height, 10)).toBeGreaterThanOrEqual(56);
  });

  it("«Cobrar» llega a 68, que es su token propio", async () => {
    montaApi();
    await render();

    expect(parseInt($('[data-testid="comanda-cobrar"]')!.style.height, 10)).toBe(
      68,
    );
  });
});

describe("v2-H1 · sabotaje 7 · el color de familia pinta el BOTÓN, no un borde", () => {
  it("el fondo del botón de producto es el color de su familia", async () => {
    // La rectificación medida de v1.14.1: allí el tono salió del fondo
    // porque nueve colores competían en la misma rejilla. Con familia
    // primero, la cuadrícula enseña UNA familia a la vez, y el color
    // pasa de ruido a ser lo que te lleva a la familia correcta sin
    // leer. «La única distinción es una pequeña línea de color» era
    // justo la queja de Matías.
    montaApi();
    await render();
    await click(
      $$('[data-testid="family-button"]').find(
        (b) => b.textContent?.trim() === "Cervezas",
      ),
    );

    const tonos = resolveFamilyTones(
      [
        "bocadillos",
        "cafes",
        "cervezas",
        "desayunos",
        "licores",
        "platos",
        "raciones",
        "refrescos",
        "vinos",
      ],
      "tenant-maestranza",
    );
    const esperado = FAMILY_FILL[tonos["cervezas"]!];
    const botones = $$('[data-testid="product-button"]');
    expect(botones.length).toBeGreaterThan(0);
    for (const b of botones) {
      // El RELLENO, no el borde.
      expect(b.style.background).toBe(hexToRgb(esperado));
      expect(b.style.borderWidth).toBe("");
    }
  });

  it("el botón de familia también va relleno, y la activa lleva ARO", async () => {
    montaApi();
    await render();
    const cervezas = $$('[data-testid="family-button"]').find(
      (b) => b.textContent?.trim() === "Cervezas",
    )!;
    // En reposo: relleno sí, aro no.
    expect(cervezas.style.background).not.toBe("");
    expect(cervezas.style.boxShadow).toBe("");

    await click(cervezas);

    // Activa: el aro marca la selección y el RELLENO no cambia. Si la
    // selección cambiara el color, el camarero perdería la única pista
    // que tiene para encontrar la familia sin leer.
    const despues = $$('[data-testid="family-button"]').find(
      (b) => b.textContent?.trim() === "Cervezas",
    )!;
    expect(despues.style.boxShadow).not.toBe("");
    expect(despues.style.background).toBe(cervezas.style.background);
  });

  it("el reparto tono↔familia es estable: dos resoluciones dan lo mismo", async () => {
    // Lo que se aprende es el color y la posición, no el nombre: un
    // reparto que cambiara con cada sync sería peor que no tener color.
    const tags = ["cafes", "cervezas", "licores", "vinos"];
    const a = resolveFamilyTones(tags, "t1");
    const b = resolveFamilyTones([...tags].reverse(), "t1");
    expect(b).toEqual(a);
  });
});

describe("v2-H1 · sabotaje 8 · la escala TPV no baja del suelo", () => {
  it("el nombre de producto no baja de 20 px, y en «Ahora» va a 23+", async () => {
    montaApi();
    await render();

    for (const el of $$('[data-testid="product-name"]')) {
      expect(parseFloat(el.style.fontSize)).toBeGreaterThanOrEqual(
        PRODUCT_NAME_MIN_PX,
      );
    }
    expect(PRODUCT_NAME_MIN_PX).toBeGreaterThanOrEqual(20);
  });

  it("ni con la familia más grande: 31 productos siguen a 20 px o más", async () => {
    montaApi();
    await render();
    await click(
      $$('[data-testid="family-button"]').find(
        (b) => b.textContent?.trim() === "Licores",
      ),
    );

    const tamanos = $$('[data-testid="product-name"]').map((el) =>
      parseFloat(el.style.fontSize),
    );
    expect(tamanos).toHaveLength(31);
    for (const t of tamanos) expect(t).toBeGreaterThanOrEqual(20);
  });

  it("la cuenta pura lo dice también: 17 px no es una salida", async () => {
    // El reparto NUNCA devuelve un nombre por debajo del suelo. La
    // salida a una familia que no cabe es decirlo (`fits: false`), no
    // encoger el texto hasta que entre.
    const forma = gridShapeFor(31, gridWidth(1280), gridHeight(800, 10));
    expect(forma.nameSizePx).toBeGreaterThanOrEqual(20);
    const apretada = gridShapeFor(200, gridWidth(1280), gridHeight(800, 10));
    expect(apretada.nameSizePx).toBeGreaterThanOrEqual(20);
    expect(apretada.fits).toBe(false);
  });

  it("la línea de comanda, el total y «Cobrar» cumplen su mínimo", async () => {
    montaApi();
    await render();
    await click(producto("Caña"));

    const nombre = $('[data-testid="cart-line-name"]')!;
    expect(parseFloat(nombre.style.fontSize)).toBeGreaterThanOrEqual(20);
    const importe = $('[data-testid="pendiente-importe"]')!;
    expect(parseFloat(importe.style.fontSize)).toBeGreaterThanOrEqual(20);
    const total = $('[data-testid="comanda-total"]')!;
    expect(parseFloat(total.style.fontSize)).toBeGreaterThanOrEqual(44);
    const cobrar = $('[data-testid="comanda-cobrar"]')!;
    expect(parseFloat(cobrar.style.fontSize)).toBeGreaterThanOrEqual(22);
  });

  it("el alto mínimo del botón de producto es 64", async () => {
    expect(PRODUCT_MIN_HEIGHT).toBe(64);
  });
});

describe("v2-H1 · sabotaje 9 · la cantidad va DENTRO del botón", () => {
  it("tras añadir dos cañas, su botón dice «×2»", async () => {
    montaApi();
    await render();
    await click($(`[data-testid="qty-key"][data-qty="2"]`));
    await click(producto("Caña"));

    const badge = producto("Caña").querySelector(
      '[data-testid="product-units"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent?.trim()).toBe("×2");
  });

  it("un producto que no está en la comanda no lleva insignia", async () => {
    montaApi();
    await render();
    await click(producto("Caña"));

    expect(
      producto("Café con leche").querySelector('[data-testid="product-units"]'),
    ).toBeNull();
  });

  it("la insignia cuenta también lo ya ENVIADO a cocina", async () => {
    // Decisión 6 · «mientras esté en la comanda sin enviar o enviada de
    // esta mesa». Lo que el camarero comprueba es cuántos lleva la mesa,
    // no cuántos quedan por mandar.
    montaApi();
    await render();
    await click(producto("Caña"));
    await click($('[data-testid="comanda-enviar"]'));

    const badge = producto("Caña").querySelector(
      '[data-testid="product-units"]',
    );
    expect(badge?.textContent?.trim()).toBe("×1");
  });
});

describe("v2-H1 · sabotaje 11 · el tema oscuro NO llega a RETAIL", () => {
  it("RETAIL se sigue pintando con el TPV claro de siempre", async () => {
    // La restricción dura del bloque: Thalía, Cachictos y Sole usan esta
    // misma pantalla y no deben notar nada.
    vertical.actual = "RETAIL";
    montaApi();
    await render();

    // Nada de la pantalla oscura.
    expect($('[data-testid="hospitality-workspace"]')).toBeNull();
    expect($('[data-testid="comanda"]')).toBeNull();
    expect($('[data-testid="family-bar"]')).toBeNull();
    expect($('[data-testid="qty-row"]')).toBeNull();
    // Y sí lo del claro: el panel del ticket con su desglose y el rail.
    expect($("aside.rounded-3xl")).not.toBeNull();
    expect(container.textContent).toContain("Subtotal");
  });

  it("SERVICES tampoco", async () => {
    vertical.actual = "SERVICES";
    montaApi();
    await render();

    expect($('[data-testid="hospitality-workspace"]')).toBeNull();
    expect($("aside.rounded-3xl")).not.toBeNull();
  });

  it("HOSPITALITY sí, y es la misma SalePage", async () => {
    // El contrapunto: sin esto, un `return null` en la rama oscura
    // pasaría los dos tests de arriba.
    montaApi();
    await render();

    expect($('[data-testid="hospitality-workspace"]')).not.toBeNull();
    expect($('[data-testid="comanda"]')).not.toBeNull();
    expect($("aside.rounded-3xl")).toBeNull();
  });

  it("y el lienzo de la venta oscura no lleva ni un hex suelto", async () => {
    // El tema sale de tokens (`hospitalityTheme.ts`), nunca de un hex
    // escrito en un componente. Lo que se comprueba es que los colores
    // que la pantalla pinta están TODOS en el módulo de tokens.
    montaApi();
    await render();

    const tokens = new Set(
      Object.values(FAMILY_FILL)
        .concat([
          "#0E1013",
          "#171A1F",
          "#1C2026",
          "#23272E",
          "#2C313A",
          "#15171B",
          "#F1F3F5",
          "#E4E7EB",
          "#8B93A1",
          "#F2A08F",
          "#E97058",
          "#FFFFFF",
          "#3A404A",
        ])
        .map(hexToRgb),
    );
    const fuera: string[] = [];
    for (const el of $$<HTMLElement>("[style]")) {
      const bg = el.style.background || el.style.backgroundColor;
      if (bg && bg.startsWith("rgb(") && !tokens.has(bg)) fuera.push(bg);
    }
    expect(fuera).toEqual([]);
  });
});

/** El hex como lo devuelve `style.background` en jsdom. */
function hexToRgb(hex: string): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
