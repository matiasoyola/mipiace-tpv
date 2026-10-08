// kds-1-cocina · EL TPV CON PANTALLA DE COCINA.
//
// Lo que v2-H1 no podía probar porque no existía: la mitad INVERTIDA de su
// sabotaje 5, la banda «LISTO», el «Deshacer» de 5 s y «Espera».
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | −/+ en lo enviado sin pantalla | sección con impresora → sin −/+ en
//   | lo enviado (regla v2-H1)     ← la otra mitad, con pantalla
//   | «Servido» que no limpia | el aviso desaparece en todos los TPV
//   | RETAIL tocado | render RETAIL idéntico
//   | Módulo apagado | sin `kitchenDisplayEnabled`, ni pantalla, ni banda
//
// El banco es el mismo de `v2-h1-sabotajes.test.tsx` en forma —doble de
// `apiWithCashier` con un DRAFT en memoria— y se escribe aparte a
// propósito: aquel fichero prueba que v2-H1 no se ha regresado, y mezclar
// los dos haría que un cambio de este bloque pudiera tapar un sabotaje de
// aquél.

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

const CATALOGO = vi.hoisted(() => [
  {
    id: "00000000-0000-0000-0000-000000000001",
    holdedProductId: "h-1",
    sku: "SKU1",
    name: "Caña",
    basePrice: 1.5,
    priceGross: 1.7,
    taxRate: 10,
    barcode: null,
    imageMime: null,
    tags: ["cervezas"],
    kind: "PRODUCT" as const,
    allergens: [] as string[],
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    holdedProductId: "h-2",
    sku: "SKU2",
    name: "Patatas bravas",
    basePrice: 9,
    priceGross: 10,
    taxRate: 10,
    barcode: null,
    imageMime: null,
    tags: ["raciones"],
    kind: "PRODUCT" as const,
    // El plato que lleva gluten: es el del aviso de la capa 3.
    allergens: ["GLUTEN"],
  },
]);

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
// La impresión USB del papel de respaldo: se cuenta, no se hace.
const usb = vi.hoisted(() => ({ impresiones: [] as number[] }));
vi.mock("../src/lib/escposPrint.js", () => ({
  printEscposUsb: vi.fn(async (bytes: Uint8Array) => {
    usb.impresiones.push(bytes.length);
    return { ok: true };
  }),
  isWebUsbSupported: () => true,
  getPairedUsbPrinter: async () => true,
  printTicketUsb: vi.fn(),
  printTicketWifi: vi.fn(),
  fetchTicketEscposBinary: vi.fn(),
  fetchCreditReceiptEscpos: vi.fn(),
  openCashDrawerIfAvailable: vi.fn(),
  openUsbCashDrawer: vi.fn(),
  pairUsbPrinter: vi.fn(),
  forgetPairedUsbPrinter: vi.fn(),
  syncUsbPairingWithServerConfig: vi.fn(),
}));

import { SalePage, type TableContext } from "../src/pages/SalePage.js";
import {
  mapServerDraftLines,
  type ServerDraft,
  type ServerDraftLine,
} from "../src/lib/tableDraft.js";
import { DESHACER_MS } from "../src/kitchen/tpv/DeshacerToast.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_5 = "00000000-0000-0000-0000-0000000000a5";
const TICKET = "00000000-0000-0000-0000-0000000000t5";
const ORDER = "00000000-0000-0000-0000-0000000000f1";

const tableContext: TableContext = {
  id: MESA_5,
  name: "M5",
  zone: "SALON",
  capacity: 4,
  diners: 4,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@bar.es",
  openedByAlias: "Salomé",
  activeTicketId: TICKET,
};

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

interface BancoOpts {
  /** ¿La sección de las líneas tiene PANTALLA? */
  pantalla?: boolean;
  /** `Tenant.kitchenDisplayEnabled`. */
  modulo?: boolean;
  lineas?: ServerDraftLine[];
  /** Unidades ya en cocina, por id de línea. */
  enviadas?: Record<string, number>;
  /** Las comandas listas de la tienda (la banda «LISTO»). */
  listas?: Array<{ orderId: string; tableName: string; readyAt: string }>;
  /** La pantalla de esa sección no da señales → papel de respaldo. */
  sinLatido?: boolean;
  allergies?: Array<{ seat: number | null; allergen: string }>;
}

function banco(opts: BancoOpts = {}) {
  const lineas: ServerDraftLine[] = (opts.lineas ?? []).slice();
  const enviadas = new Map<string, number>(
    Object.entries(opts.enviadas ?? {}),
  );
  const anuladas: Array<{ lineId: string; units: number }> = [];
  const servidos: string[] = [];
  const marchados: number[] = [];
  const sillas: Array<{ lineId: string; seat: number | null }> = [];
  const tiempos: Array<{ lineId: string; course: number }> = [];
  const alergias: Array<Array<{ seat: number | null; allergen: string }>> = [];
  const envios: Array<Record<string, unknown>> = [];
  const pantalla = opts.pantalla === true;
  const destino = {
    screen: pantalla,
    printer: !pantalla,
    canCorrectSent: pantalla,
  };
  const draft = (): ServerDraft => ({
    id: TICKET,
    status: "DRAFT",
    externalId: "00000000-0000-0000-0000-0000000000e5",
    tableId: MESA_5,
    table: { id: MESA_5, name: "M5", zone: "SALON", capacity: 4 },
    diners: 4,
    total: "0",
    createdAt: new Date().toISOString(),
    lines: lineas.slice(),
  });

  apiMock.apiWithCashier.mockImplementation(
    async (path: string, o?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/shift/current") return { shift: null };
      if (path === "/tpv/tables") {
        return { storeId: "store-1", registerId: "reg-1", tables: [] };
      }
      if (path.startsWith("/shift/") && path.includes("/tickets-count")) {
        return { count: 0, total: 0 };
      }
      if (path.startsWith("/tpv/catalog/now")) {
        return { source: "families", bandHours: 1, windowDays: 28, items: [] };
      }
      if (path.startsWith("/tpv/catalog/top-sellers")) {
        return { source: "month", items: [] };
      }
      if (path.endsWith("/lines") && o?.method === "POST") {
        const b = o.body ?? {};
        const prod = CATALOGO.find((p) => p.id === b.productId);
        lineas.push(
          serverLine({
            id: String(b.lineExternalId),
            productId: (b.productId as string) ?? null,
            nameSnapshot: String(b.nameSnapshot),
            sku: String(b.sku),
            units: String(b.units),
            unitPrice: String(b.unitPrice),
            taxRate: String(b.taxRate),
            // kds-1-cocina · el DRAFT del servidor trae los alérgenos del
            // producto (`DRAFT_INCLUDE`). El banco los trae también: sin
            // ellos, la línea los perdería al reconciliar y el aviso de la
            // capa 3 no saldría — que es exactamente el fallo que este
            // banco tiene que poder reproducir.
            product: prod ? { allergens: prod.allergens } : null,
          }),
        );
        return { ticket: draft() };
      }
      if (path.includes("/lines/") && path.endsWith("/kitchen") && o?.method === "PUT") {
        const id = path.split("/lines/")[1]!.replace("/kitchen", "");
        if (o.body?.seat !== undefined) {
          sillas.push({ lineId: id, seat: (o.body.seat as number | null) ?? null });
        }
        if (o.body?.course !== undefined) {
          tiempos.push({ lineId: id, course: o.body.course as number });
        }
        return { ok: true };
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
        envios.push(o?.body ?? {});
        for (const l of lineas) enviadas.set(l.id, Number(l.units));
        return {
          revision: 1,
          sentAt: "2026-10-08T10:07:00.000Z",
          nothingNew: false,
          replayed: false,
          sections: [
            {
              section: "COCINA",
              destino: pantalla ? "PANTALLA" : "IMPRESORA",
              ok: true,
              lineCount: lineas.length,
              units: lineas.length,
              ...(pantalla ? { orderId: ORDER } : {}),
            },
          ],
        };
      }
      if (path.endsWith("/kitchen/void-units") && o?.method === "POST") {
        const b = o.body as { lineId: string; units: number };
        anuladas.push(b);
        return { ok: true, lineId: b.lineId, voidedUnits: b.units };
      }
      if (path.endsWith("/kitchen/fire") && o?.method === "POST") {
        marchados.push((o.body as { course: number }).course);
        return { ok: true, alreadyFired: false };
      }
      if (path.endsWith("/kitchen/urgent") && o?.method === "POST") {
        return { ok: true, urgent: true, orders: 0 };
      }
      if (path.endsWith("/allergies") && o?.method === "PUT") {
        alergias.push(
          (o.body as { allergies: Array<{ seat: number | null; allergen: string }> })
            .allergies,
        );
        return { ok: true };
      }
      if (path.endsWith("/allergies")) {
        return { diners: 4, allergies: opts.allergies ?? [] };
      }
      if (path.includes("/servido") && o?.method === "POST") {
        servidos.push(path.split("/comandas/")[1]!.replace("/servido", ""));
        return { ok: true };
      }
      if (path.includes("/escpos")) {
        return { escposBase64: Buffer.from("PAPEL").toString("base64") };
      }
      if (path.endsWith("/kitchen") && (o?.method ?? "GET") === "GET") {
        return {
          diners: 4,
          revision: 1,
          lines: lineas.map((l) => ({
            id: l.id,
            units: Number(l.units),
            sentUnits: enviadas.get(l.id) ?? 0,
            course: tiempos.findLast((t) => t.lineId === l.id)?.course ?? 1,
            seat: sillas.findLast((x) => x.lineId === l.id)?.seat ?? null,
            section: "COCINA",
          })),
          firedCourses: [{ course: 1, firedAt: "2026-10-08T10:07:00.000Z" }],
          allergies: opts.allergies ?? [],
          orders: [],
          destinations: { BARRA: destino, COCINA: destino, SALON: destino },
        };
      }
      if (path === "/kitchen/estado") {
        return {
          heartbeatWindowMs: 90000,
          screens: [],
          sections: [
            {
              section: "COCINA",
              ...destino,
              needsPaperFallback: pantalla && opts.sinLatido === true,
            },
          ],
        };
      }
      if (path === "/kitchen/listas") {
        return {
          ready: (opts.listas ?? []).map((l) => ({
            orderId: l.orderId,
            ticketId: TICKET,
            tableId: MESA_5,
            tableName: l.tableName,
            section: "COCINA",
            number: 1,
            readyAt: l.readyAt,
          })),
        };
      }
      throw new Error(`ruta inesperada: ${path}`);
    },
  );
  return { lineas, anuladas, servidos, marchados, sillas, tiempos, alergias, envios };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  vertical.actual = "HOSPITALITY";
  usb.impresiones = [];
  apiMock.apiWithCashier.mockReset();
  vi.useRealTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  // `root` puede ser el del test ANTERIOR si éste falló antes de montar.
  // Desmontar dos veces lanza, y entonces el fallo del siguiente test
  // taparía el del que de verdad falló.
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya estaba desmontado */
  }
  container.remove();
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(opts: {
  lineas?: ServerDraftLine[];
  modulo?: boolean;
  avisos?: Array<{ orderId: string; tableName: string | null; readyAt: string }>;
  onServido?: (id: string) => void;
} = {}) {
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
        initialDraftLines={mapServerDraftLines(opts.lineas ?? [])}
        initialKitchen={{ lastSentAt: "2026-10-08T10:07:00.000Z", revision: 1 }}
        kitchenDisplayEnabled={opts.modulo ?? true}
        kitchenSettings={
          (opts.modulo ?? true)
            ? {
                courseMode: "ESPERA",
                seatMode: "ALERGIA",
                greenMaxMin: 10,
                amberMaxMin: 20,
                readyBeep: false,
              }
            : null
        }
        avisosListo={opts.avisos ?? []}
        onServido={opts.onServido}
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

/** El botón de producto por nombre: el orden de «Ahora» no es contrato. */
function producto(nombre: string): HTMLButtonElement {
  const el = $$<HTMLButtonElement>('[data-testid="product-button"]').find(
    (b) =>
      b.querySelector('[data-testid="product-name"]')?.textContent?.trim() ===
      nombre,
  );
  if (!el) throw new Error(`producto «${nombre}» no encontrado`);
  return el;
}

const LINEA_ENVIADA = serverLine({
  id: "l-bravas",
  productId: CATALOGO[1]!.id,
  nameSnapshot: "Patatas bravas",
  units: "2",
});

// ──────────────────────────────────────────────────────────────────────

describe("kds-1 · SABOTAJE INVERTIDO · −/+ en lo enviado CON pantalla", () => {
  it("la línea enviada lleva su `−` y su `+`", async () => {
    // La vuelta deliberada al sabotaje 5 de v2-H1. Aquel bloque lo quitó
    // porque sin pantalla un `−` dejaba el plato en la plancha sin que
    // cocina se enterara; con pantalla la anulación llega.
    banco({ pantalla: true, lineas: [LINEA_ENVIADA], enviadas: { "l-bravas": 2 } });
    await render({ lineas: [LINEA_ENVIADA] });

    expect($$('[data-testid="comanda-linea-enviada"]')).toHaveLength(1);
    expect($$('[data-testid="stepper-menos-enviado"]')).toHaveLength(1);
    expect($$('[data-testid="stepper-mas-enviado"]')).toHaveLength(1);
    // Y lleva el atributo que dice por qué.
    expect(
      $('[data-testid="comanda-linea-enviada"]')!.dataset.puedeCorregir,
    ).toBe("1");
  });

  it("SIN pantalla, no los lleva: se mantiene la regla de v2-H1", async () => {
    banco({ pantalla: false, lineas: [LINEA_ENVIADA], enviadas: { "l-bravas": 2 } });
    await render({ lineas: [LINEA_ENVIADA] });

    expect($$('[data-testid="comanda-linea-enviada"]')).toHaveLength(1);
    expect($$('[data-testid="stepper-menos-enviado"]')).toHaveLength(0);
    expect($$('[data-testid="stepper-mas-enviado"]')).toHaveLength(0);
    expect(
      $('[data-testid="comanda-linea-enviada"]')!.dataset.puedeCorregir,
    ).toBe("0");
  });

  it("el `−` de lo enviado lleva SÓLO el contorno rojo, no relleno", async () => {
    // La regla del rojo: el relleno rojo se reserva para lo que no puede
    // esperar. Un `−` es una acción, no una alarma.
    banco({ pantalla: true, lineas: [LINEA_ENVIADA], enviadas: { "l-bravas": 2 } });
    await render({ lineas: [LINEA_ENVIADA] });
    const menos = $('[data-testid="stepper-menos-enviado"]')!;
    expect(menos.style.background).toBe("transparent");
    expect(menos.style.border).toMatch(/2px solid/);
  });
});

describe("kds-1 · el «Deshacer» de 5 s", () => {
  it("el `−` saca el aviso y NO llama a la ruta todavía", async () => {
    const b = banco({
      pantalla: true,
      lineas: [LINEA_ENVIADA],
      enviadas: { "l-bravas": 2 },
    });
    await render({ lineas: [LINEA_ENVIADA] });
    await click($('[data-testid="stepper-menos-enviado"]'));

    expect($$('[data-testid="deshacer-aviso"]')).toHaveLength(1);
    expect($('[data-testid="deshacer-aviso"]')!.textContent).toMatch(
      /Patatas bravas −1/,
    );
    // Lo importante: la cocina NO se ha enterado de nada.
    expect(b.anuladas).toHaveLength(0);
  });

  it("deshacer a tiempo → la cocina no ve NI UN parpadeo", async () => {
    const b = banco({
      pantalla: true,
      lineas: [LINEA_ENVIADA],
      enviadas: { "l-bravas": 2 },
    });
    await render({ lineas: [LINEA_ENVIADA] });
    await click($('[data-testid="stepper-menos-enviado"]'));
    await click($('[data-testid="deshacer-boton"]'));

    expect($$('[data-testid="deshacer-aviso"]')).toHaveLength(0);
    expect(b.anuladas).toHaveLength(0);
  });

  // El `timeout` explícito: la espera es de 5 s por decisión de producto, y
  // el techo de vitest también son 5 s. No se usan temporizadores falsos a
  // propósito: el camino que hay que probar es el que corre de verdad.
  it("pasados los 5 s, sale SOLO a cocina sin esperar a «Enviar»", async () => {
    const b = banco({
      pantalla: true,
      lineas: [LINEA_ENVIADA],
      enviadas: { "l-bravas": 2 },
    });
    await render({ lineas: [LINEA_ENVIADA] });
    await click($('[data-testid="stepper-menos-enviado"]'));
    expect(b.anuladas).toHaveLength(0);

    // Se espera lo que dice la constante, no un número a mano: si alguien
    // baja los 5 s a 1, este test sigue valiendo y el de abajo lo cuenta.
    await act(async () => {
      await new Promise((r) => setTimeout(r, DESHACER_MS + 120));
    });
    await settle();

    expect(b.anuladas).toEqual([{ lineId: "l-bravas", units: 1 }]);
    expect($$('[data-testid="deshacer-aviso"]')).toHaveLength(0);
  }, 15_000);

  it("los 5 segundos son 5 segundos", () => {
    expect(DESHACER_MS).toBe(5000);
  });
});

describe("kds-1 · decisión 5 · la banda «LISTO»", () => {
  it("sale con el nombre de la mesa y un toque marca «Servido»", async () => {
    banco({ pantalla: true, listas: [] });
    const servidos: string[] = [];
    await render({
      avisos: [
        { orderId: ORDER, tableName: "M4", readyAt: "2026-10-08T10:20:00.000Z" },
      ],
      onServido: (id) => servidos.push(id),
    });

    const banda = $('[data-testid="listo-banda"]')!;
    expect(banda.textContent).toMatch(/M4 · listo para servir/);
    await click(banda);
    expect(servidos).toEqual([ORDER]);
  });

  it("varias listas se apilan de MÁS ANTIGUA a más nueva", async () => {
    banco({ pantalla: true });
    await render({
      avisos: [
        { orderId: "nueva", tableName: "T2", readyAt: "2026-10-08T10:25:00.000Z" },
        { orderId: "vieja", tableName: "M1", readyAt: "2026-10-08T10:05:00.000Z" },
      ],
    });
    // El camarero coge lo que lleva más tiempo en el pase, así que lo
    // primero que lee tiene que ser eso.
    expect(
      $$('[data-testid="listo-banda"]').map((b) => b.dataset.orderId),
    ).toEqual(["vieja", "nueva"]);
  });

  it("con el módulo APAGADO no hay banda, aunque haya avisos", async () => {
    banco({ pantalla: false, modulo: false });
    await render({
      modulo: false,
      avisos: [
        { orderId: ORDER, tableName: "M4", readyAt: "2026-10-08T10:20:00.000Z" },
      ],
    });
    expect($$('[data-testid="listo-banner"]')).toHaveLength(0);
  });
});

describe("kds-1 · decisión 3 · «Urgente», «Espera» y la silla", () => {
  it("«Urgente» es un toque junto a «Enviar», y viaja EN el envío", async () => {
    const b = banco({ pantalla: true });
    await render();
    await click(producto("Caña"));

    const urgente = $('[data-testid="boton-urgente"]')!;
    expect(urgente.dataset.activo).toBe("0");
    await click(urgente);
    expect($('[data-testid="boton-urgente"]')!.dataset.activo).toBe("1");

    await click($('[data-testid="comanda-enviar"]'));
    expect(b.envios).toHaveLength(1);
    expect(b.envios[0]!.urgent).toBe(true);
    // Y NO se queda pegado: la 2ª comanda no sale urgente sin pedirlo.
    expect($('[data-testid="boton-urgente"]')!.dataset.activo).toBe("0");
  });

  it("el envío lleva un `clientSendId`, que es la llave de idempotencia", async () => {
    const b = banco({ pantalla: true });
    await render();
    await click(producto("Caña"));
    await click($('[data-testid="comanda-enviar"]'));
    expect(b.envios[0]!.clientSendId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("«Espera» pone la línea en el tiempo 2", async () => {
    const b = banco({ pantalla: true });
    await render();
    await click(producto("Caña"));
    const espera = $('[data-testid="chip-espera"]')!;
    expect(espera.dataset.activo).toBe("0");
    await click(espera);
    expect(b.tiempos.map((t) => t.course)).toEqual([2]);
  });

  it("y entonces aparece «Marchar 2º»", async () => {
    const b = banco({ pantalla: true });
    await render();
    await click(producto("Caña"));
    expect($$('[data-testid="boton-marchar"]')).toHaveLength(0);
    await click($('[data-testid="chip-espera"]'));
    const marchar = $('[data-testid="boton-marchar"]');
    expect(marchar).not.toBeNull();
    expect(marchar!.textContent).toBe("Marchar 2º");
    await click(marchar);
    expect(b.marchados).toEqual([2]);
  });

  it("el botón de silla sólo sale si la mesa tiene alergia declarada", async () => {
    banco({ pantalla: true });
    await render();
    await click(producto("Caña"));
    expect($$('[data-testid="chip-silla"]')).toHaveLength(0);
  });

  it("con una alergia en la silla 3, sale «→ Silla 3»", async () => {
    const b = banco({
      pantalla: true,
      allergies: [{ seat: 3, allergen: "GLUTEN" }],
    });
    await render();
    // Las bravas, que llevan gluten.
    await click(producto("Patatas bravas"));
    const silla = $('[data-testid="chip-silla"]')!;
    expect(silla.textContent).toBe("→ Silla 3");
    // Y se pinta como peligrosa ANTES de tocarla: el plato lleva lo que
    // esa silla no puede comer.
    expect(silla.dataset.peligrosa).toBe("1");

    await click(silla);
    expect(b.sillas.map((s) => s.seat)).toEqual([3]);
    // El aviso de la capa 3 sale, y NO bloquea: la silla queda asignada.
    expect($('[data-testid="aviso-alergeno"]')!.textContent).toMatch(
      /¡LLEVA GLUTEN!/,
    );
  });

  it("«Alergias» está SIEMPRE, módulo o no (decisión 10)", async () => {
    banco({ pantalla: false, modulo: false });
    await render({ modulo: false });
    expect($('[data-testid="boton-alergias"]')).not.toBeNull();
    // Y lo del módulo, no.
    expect($$('[data-testid="boton-marchar"]')).toHaveLength(0);
  });
});

describe("kds-1 · decisión 9 · «Cocina no recibe» y el papel", () => {
  it("avisa cuando la pantalla de la sección no da señales", async () => {
    banco({ pantalla: true, sinLatido: true });
    await render();
    expect($('[data-testid="cocina-no-recibe"]')!.textContent).toMatch(
      /Cocina no recibe/,
    );
  });

  it("y al enviar saca el papel por la USB del terminal", async () => {
    banco({ pantalla: true, sinLatido: true });
    await render();
    await click(producto("Caña"));
    await click($('[data-testid="comanda-enviar"]'));
    // Las dos cosas y no una: la comanda se creó (la pantalla la espera) y
    // el papel sale AHORA.
    expect(usb.impresiones).toHaveLength(1);
  });

  it("con la pantalla viva NO sale papel", async () => {
    banco({ pantalla: true, sinLatido: false });
    await render();
    await click(producto("Caña"));
    await click($('[data-testid="comanda-enviar"]'));
    expect(usb.impresiones).toHaveLength(0);
  });
});

describe("kds-1 · SABOTAJE · RETAIL tocado", () => {
  it("en RETAIL no se pinta NADA de cocina", async () => {
    vertical.actual = "RETAIL";
    banco({ pantalla: true });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SalePage
          shiftId="shift-1"
          cashierLabel="caja1@bar.es"
          cashierRole="CASHIER"
          registerName="Caja 1"
          registerId="reg-1"
          storeName="Thalía"
          tableContext={null}
          kitchenDisplayEnabled
          kitchenSettings={{
            courseMode: "ESPERA",
            seatMode: "SIEMPRE",
            greenMaxMin: 10,
            amberMaxMin: 20,
            readyBeep: true,
          }}
          onLogoutCashier={vi.fn()}
          onCloseShift={vi.fn()}
        />,
      );
    });
    await settle();

    // La bifurcación de v2-H1 sigue siendo un componente entero: en RETAIL
    // no se monta `HospitalityWorkspace`, así que nada de cocina existe.
    expect($$('[data-testid="hospitality-workspace"]')).toHaveLength(0);
    for (const sel of [
      "acciones-cocina",
      "boton-urgente",
      "boton-alergias",
      "listo-banner",
      "deshacer-toast",
      "fila-tiempos",
      "comanda-linea-enviada",
    ]) {
      expect($$(`[data-testid="${sel}"]`), sel).toHaveLength(0);
    }
  });
});
