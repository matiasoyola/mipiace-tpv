// Banco visual del bloque v1.10.3-barra · SOLO desarrollo.
//
// Sirve para el "bucle visual" de la metodología: abrir las pantallas
// tocadas por el bloque a 320 / 390 / 768 / 1024 / 1280 px y comprobar
// con los ojos lo que los tests comprueban con asserts. No entra en el
// bundle de producción: `vite build` sólo toma `index.html` como
// entrada, este HTML vive fuera de ese grafo.
//
// La red va interceptada (`stubFetch`): las pantallas reales se montan
// con fixtures deterministas, sin API, sin BD y sin emparejar nada.
//
//   pnpm --filter @mipiacetpv/tpv-web dev
//   → http://localhost:5173/visual/index.html?screen=checkout
//
// screens: checkout · checkout-mixto · checkout-error · sale · mapa
//   v1.12-manos-de-camarero: arqueo · abrir-turno · confirmar · bloqueo
//   v1.14-la-comanda-se-ve: venta-mesa · venta-mesa-12 · venta-mesa-vacia ·
//     venta-20-categorias · venta-retail

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/index.css";

import type { CartLine, CartTotals } from "../src/lib/cart.js";
import type { ApiTable } from "../src/pages/TableMapScreen.js";

// ── fixtures ──────────────────────────────────────────────────────────

// La cuenta del grupo T4 + M3 + M5 de la simulación: 14,00 €.
const LINES: CartLine[] = [
  mkLine("l1", "Coca-Cola", 2, 2.2727, 2.5, 10),
  mkLine("l2", "Fanta naranja", 1, 2.2727, 2.5, 10),
  mkLine("l3", "Cerveza Mahou", 2, 1.6529, 2.0, 21),
  mkLine("l4", "Vino tinto de la casa", 1, 2.0661, 2.5, 21),
  mkLine("l5", "Café cortado con leche de avena", 3, 1.0909, 1.2, 10),
  mkLine("l6", "Tostada de tomate y jamón", 1, 2.7273, 3.0, 10),
];

function mkLine(
  id: string,
  name: string,
  units: number,
  unitPrice: number,
  priceGross: number,
  taxRate: number,
): CartLine {
  return {
    id,
    productId: `p-${id}`,
    variantId: null,
    holdedProductId: null,
    sku: id.toUpperCase(),
    nameSnapshot: name,
    units,
    unitPrice,
    unitPriceOverride: null,
    priceGross,
    discountPct: 0,
    taxRate,
    modifiers: [],
  };
}

const TOTALS: CartTotals = {
  subtotalNet: 12.4,
  tax: 1.6,
  discount: 0,
  total: 14,
} as CartTotals;

const HOURS = 3_600_000;
const now = Date.now();

// T1 es la mesa zombi de la simulación: 1037 h abiertas (≈43 días) con
// 0,00 € y un alias largo. Es el caso que rompía la tarjeta.
const TABLES: ApiTable[] = [
  mkTable("t1", "T1", 4, "SALON", "OPEN", "0.00", now - 1037 * HOURS, "matias.oyola.sanchez@mipiace.es"),
  mkTable("t2", "T4", 4, "SALON", "OPEN", "6.50", now - 22 * 60_000, "Gemma"),
  mkTable("t3", "M3", 2, "SALON", "BILLING", "3.50", now - 3 * HOURS - 20 * 60_000, "Gemma Martín García"),
  mkTable("t4", "M5", 6, "TERRAZA", "OPEN", "1240.00", now - 25 * HOURS, "jose.antonio.perez@sirope.es"),
  mkTable("t5", "M6", 2, "TERRAZA", "FREE", null, 0, null),
  mkTable("t6", "B1", 1, "BARRA", "OPEN", "12.00", now - 47 * HOURS, "Ana"),
  mkTable("t7", "B2", 1, "BARRA", "FREE", null, 0, null),
];

function mkTable(
  id: string,
  name: string,
  capacity: number,
  zone: ApiTable["zone"],
  state: ApiTable["state"],
  total: string | null,
  openedAtMs: number,
  alias: string | null,
): ApiTable {
  return {
    id,
    name,
    capacity,
    zone,
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    barSeatIndex: zone === "BARRA" ? Number(id.slice(1)) : null,
    groupedIntoTableId: null,
    state,
    activeTicket:
      total === null
        ? null
        : {
            id: `tk-${id}`,
            total,
            diners: capacity,
            openedAt: new Date(openedAtMs).toISOString(),
            openedByEmail: alias && alias.includes("@") ? alias : null,
            openedByAlias: alias && !alias.includes("@") ? alias : null,
            lineCount: 3,
          },
    createdAt: new Date(now).toISOString(),
  };
}

// v1.14-la-comanda-se-ve · el ticket de 12 líneas, que es el caso real
// de un bar en hora punta y el que la ronda 2 del AP11 NO llegó a
// probar (queda declarado en "Verificación pendiente" de la auditoría).
// Con el reparto viejo, aquí es donde Total y "Cobrar" se iban de la
// vista.
const LINES_12: CartLine[] = [
  mkLine("m01", "Café solo", 2, 1.0909, 1.2, 10),
  mkLine("m02", "Café con leche", 3, 1.0909, 1.2, 10),
  mkLine("m03", "Cortado", 1, 1.0909, 1.2, 10),
  mkLine("m04", "Colacao con churros", 1, 2.7273, 3.0, 10),
  mkLine("m05", "Zumo de naranja natural", 2, 2.2727, 2.5, 10),
  mkLine("m06", "Tostada de tomate y jamón", 2, 2.7273, 3.0, 10),
  mkLine("m07", "Croissant a la plancha", 1, 1.8182, 2.0, 10),
  mkLine("m08", "Bocadillo de tortilla", 1, 3.6364, 4.0, 10),
  mkLine("m09", "Caña de Mahou", 4, 1.6529, 2.0, 21),
  mkLine("m10", "Copa de vino tinto de la casa", 2, 2.0661, 2.5, 21),
  mkLine("m11", "Coca-Cola", 3, 2.2727, 2.5, 10),
  mkLine("m12", "Agua mineral 50 cl", 2, 1.3636, 1.5, 10),
];

const TOTALS_12: CartTotals = {
  subtotalNet: 52.36,
  tax: 6.24,
  discount: 0,
  total: 58.6,
} as CartTotals;

// Las ocho categorías de Sirope, tal cual llegan de Holded: sin tildes y
// alguna pegada (`Croissantysandwich` es literal del catálogo real).
const TAGS_SIROPE = [
  "cafes",
  "bolleria",
  "refrescos",
  "cervezas",
  "vinos",
  "tostadas",
  "croissantysandwich",
  "postres",
];

// v1.14 · el sabotaje del bloque: 20 categorías. Con el reparto viejo
// llegaban al borde de la pantalla sin ninguna señal.
const TAGS_20 = [
  ...TAGS_SIROPE,
  "raciones",
  "ensaladas",
  "hamburguesas",
  "pizzas",
  "arroces",
  "carnes",
  "pescados",
  "helados",
  "licores",
  "cocteles",
  "infusiones",
  "batidos",
];

// Catálogo de barra, suficiente para llenar el ticket, estresar el
// listado y repartir las categorías entre productos.
const CATALOG = LINES_12.map((l, i) => ({
  id: `00000000-0000-0000-0000-0000000000${String(i + 10)}`,
  holdedProductId: `h-${i + 1}`,
  sku: l.sku,
  name: l.nameSnapshot,
  basePrice: l.unitPrice,
  priceGross: l.priceGross,
  taxRate: l.taxRate,
  tags: [] as string[],
  kind: "PRODUCT" as const,
}));

/** Reparte `tags` entre los productos del catálogo, en bucle. */
function catalogWithTags(tags: string[]) {
  // Con más categorías que productos, se generan productos de relleno
  // para que ninguna categoría se quede sin nada que enseñar.
  const base = tags.map((tag, i) => {
    const src = CATALOG[i % CATALOG.length]!;
    return {
      ...src,
      id: `00000000-0000-0000-0000-000000${String(1000 + i)}`,
      sku: `${src.sku}-${i}`,
      name: src.name,
      tags: [tag],
    };
  });
  return [...CATALOG.map((p, i) => ({ ...p, tags: [tags[i % tags.length]!] })), ...base];
}

// ── red de mentira ────────────────────────────────────────────────────

// Sesión de mentira: `apiWithCashier` corta con 401 antes de tocar la
// red si no hay cajero en localStorage, así que el banco necesita una.
function stubSession(): void {
  localStorage.setItem("mipiacetpv-device-token", "banco-visual-device");
  localStorage.setItem(
    "mipiacetpv-cashier-session",
    JSON.stringify({
      sessionToken: "banco-visual-token",
      sessionTtlMinutes: 600,
      userId: "u-1",
      email: "matias@sirope.es",
      alias: "Matías",
      role: "MANAGER",
    }),
  );
  // v1.14 · el vertical y el tenant se leen de localStorage en el PRIMER
  // pintado (antes de que llegue el catálogo), y de ellos dependen la
  // barra superior y el reparto de tonos por categoría. Sin esto, la
  // primera captura de `venta-retail` saldría con la barra de hostelería.
  localStorage.setItem("mipiacetpv-catalog-tenant", "tenant-banco-visual");
  localStorage.setItem("mipiacetpv-catalog-business-type", benchBusinessType());
}

// v1.14 · el banco necesita variar catálogo y vertical por pantalla: los
// chips salen del catálogo y la barra superior del `businessType`.
function benchScreen(): string {
  return new URLSearchParams(window.location.search).get("screen") ?? "checkout";
}

function benchCatalog() {
  const screen = benchScreen();
  if (screen === "venta-20-categorias") return catalogWithTags(TAGS_20);
  if (screen === "venta-retail") return catalogWithTags(TAGS_SIROPE.slice(0, 5));
  return catalogWithTags(TAGS_SIROPE);
}

function benchBusinessType(): string {
  return benchScreen() === "venta-retail" ? "RETAIL" : "HOSPITALITY";
}

function stubFetch(): void {
  const routes: Record<string, unknown> = {
    "/tpv/health/holded": {
      level: "ok",
      reason: "",
      hasHoldedKey: true,
      lastIncrementalSyncAt: null,
      lastSyncAgeMs: null,
      blockedAt: null,
      pendingSyncCount: 0,
      syncFailedCount: 0,
    },
    "/shift/current": { shift: null },
    // v1.12 · el arqueo del banco entra por la tabla de denominaciones
    // (el resumen del día es de v1.11 y ya tiene sus capturas).
    "/shift/shift-1/summary": { error: "NOT_FOUND" },
    "/tpv/tables": { storeId: "store-1", registerId: "reg-1", tables: TABLES },
    // v1.14 §4 · los más vendidos del turno para el estado vacío del
    // ticket. `venta-mesa-vacia` es la pantalla que los enseña.
    "/tpv/catalog/top-sellers": {
      source: "shift",
      items: [
        { productId: CATALOG[0]!.id, units: 48 },
        { productId: CATALOG[8]!.id, units: 41 },
        { productId: CATALOG[5]!.id, units: 33 },
        { productId: CATALOG[10]!.id, units: 27 },
        { productId: CATALOG[1]!.id, units: 22 },
      ],
    },
    "/tpv/catalog/products": {
      items: benchCatalog(),
      nextCursor: null,
      tenantId: "tenant-1",
      businessType: benchBusinessType(),
      tpvIconPreset: null,
      tagAliases: [],
      creditSalesEnabled: false,
      crmEnabled: false,
      agendaEnabled: false,
    },
    "/tpv/catalog/wildcards": { items: [] },
    "/tpv/catalog/modifier-groups": { groups: [] },
    "/tickets": {
      ticket: {
        id: "tk-nuevo",
        internalNumber: "000015",
        status: "PAID",
        holdedDocNumber: null,
      },
      syncStatus: "SYNCED",
    },
  };
  // v1.14 · el DRAFT de mesa vive en el servidor y `tableCreateLine`
  // reconcilia el carrito con la respuesta: sin un ticket de verdad en
  // la respuesta, la línea optimista se revierte y el banco no deja
  // probar el destaque al añadir, que es el núcleo del bloque. El
  // backend real reutiliza el `lineExternalId` del cliente como id de la
  // línea (`tables/operativa.ts`), y por eso el destaque sobrevive a la
  // reconciliación: aquí se replica.
  // Sembrado con las líneas que ya trae la mesa, para que la primera
  // reconciliación no borre lo que había.
  const seed = benchScreen() === "venta-mesa-vacia"
    ? []
    : benchScreen() === "venta-mesa-12"
      ? LINES_12
      : LINES;
  const draftLines: Array<Record<string, unknown>> = seed.map((l) => ({
    id: l.id,
    productId: l.productId,
    variantId: null,
    holdedProductId: l.holdedProductId,
    sku: l.sku,
    nameSnapshot: l.nameSnapshot,
    units: String(l.units),
    unitPrice: String(l.unitPrice),
    discountPct: "0",
    taxRate: String(l.taxRate),
    subtotal: String(l.unitPrice * l.units),
    total: String(l.priceGross * l.units),
    modifiers: null,
  }));
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as Request).url ?? input);
    if (!url.includes("/api/")) return real(input as RequestInfo, init);
    const path = url.slice(url.indexOf("/api/") + 4).split("?")[0]!;
    if (/^\/tables\/[^/]+\/lines$/.test(path) && init?.method === "POST") {
      const b = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      draftLines.push({
        id: b.lineExternalId,
        productId: b.productId ?? null,
        variantId: null,
        holdedProductId: b.holdedProductId ?? null,
        sku: b.sku,
        nameSnapshot: b.nameSnapshot,
        units: String(b.units),
        unitPrice: String(b.unitPrice),
        discountPct: "0",
        taxRate: String(b.taxRate),
        subtotal: String(b.unitPrice),
        total: String(b.unitPrice),
        modifiers: null,
      });
      return new Response(
        JSON.stringify({ ticket: { id: "tk-m1", lines: draftLines } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    // El overlay de éxito pide el ticket recién emitido y su payload
    // digital. El primero lo servimos; el segundo lo dejamos caer con
    // 404 a propósito, que es el camino degradado que el overlay ya
    // sabe recorrer (y que no toca este bloque).
    if (/^\/tickets\/[^/]+\/digital$/.test(path)) {
      return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (/^\/tickets\/[^/]+$/.test(path)) {
      return new Response(
        JSON.stringify({
          ticket: {
            id: path.slice("/tickets/".length),
            internalNumber: "000015",
            status: "SYNCED",
            holdedDocNumber: "T-000015",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    const body = routes[path] ?? {};
    // eslint-disable-next-line no-console
    console.log("[banco-visual] stub", path);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// ── pantallas ─────────────────────────────────────────────────────────

function Bench() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") ?? "checkout";
  const [Screens, setScreens] = useState<null | {
    CheckoutOverlay: typeof import("../src/pages/CheckoutPage.js")["CheckoutOverlay"];
    SalePage: typeof import("../src/pages/SalePage.js")["SalePage"];
    TableMapScreen: typeof import("../src/pages/TableMapScreen.js")["TableMapScreen"];
    CloseShiftModal: typeof import("../src/pages/CloseShiftModal.js")["CloseShiftModal"];
    ShiftOpenScreen: typeof import("../src/pages/ShiftOpenScreen.js")["ShiftOpenScreen"];
    ConfirmSheet: typeof import("../src/components/ConfirmSheet.js")["ConfirmSheet"];
  }>(null);

  useEffect(() => {
    void (async () => {
      const [checkout, sale, map, close, open, confirmSheet] = await Promise.all([
        import("../src/pages/CheckoutPage.js"),
        import("../src/pages/SalePage.js"),
        import("../src/pages/TableMapScreen.js"),
        import("../src/pages/CloseShiftModal.js"),
        import("../src/pages/ShiftOpenScreen.js"),
        import("../src/components/ConfirmSheet.js"),
      ]);
      setScreens({
        CheckoutOverlay: checkout.CheckoutOverlay,
        SalePage: sale.SalePage,
        TableMapScreen: map.TableMapScreen,
        CloseShiftModal: close.CloseShiftModal,
        ShiftOpenScreen: open.ShiftOpenScreen,
        ConfirmSheet: confirmSheet.ConfirmSheet,
      });
    })();
  }, []);

  if (!Screens) return <div style={{ padding: 24 }}>cargando…</div>;

  if (screen.startsWith("checkout")) {
    return (
      <Screens.CheckoutOverlay
        shiftId="shift-1"
        registerId="reg-1"
        lines={LINES}
        totals={TOTALS}
        contact={null}
        notes={
          screen === "checkout-error"
            ? "Grupo T4 + M3 + M5 · mesa 4 de la terraza"
            : ""
        }
        businessType="HOSPITALITY"
        onClose={() => {}}
        onConfirmed={() => {}}
      />
    );
  }

  // ── v1.12-manos-de-camarero ────────────────────────────────────────

  if (screen === "arqueo") {
    return (
      <Screens.CloseShiftModal
        shiftId="shift-1"
        cashierRole="MANAGER"
        requireCashCountOnClose
        onClose={() => {}}
        onClosed={() => {}}
      />
    );
  }

  if (screen === "abrir-turno") {
    return (
      <Screens.ShiftOpenScreen
        cashierLabel="matias@sirope.es"
        registerName="Caja 1"
        storeName="Cafetería Sirope"
        onOpened={() => {}}
        onBack={() => {}}
      />
    );
  }

  if (screen === "confirmar") {
    return (
      <Screens.ConfirmSheet
        title="Vaciar mesa"
        body="Se cancela la cuenta de M3 y la mesa queda libre para las demás cajas. Lo consumido no se cobra."
        confirmLabel="Vaciar mesa"
        cancelLabel="Volver"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
  }

  // ── v1.14-la-comanda-se-ve ─────────────────────────────────────────

  if (screen.startsWith("venta-mesa") || screen === "venta-20-categorias") {
    const vacia = screen === "venta-mesa-vacia";
    const doce = screen === "venta-mesa-12";
    return (
      <Screens.SalePage
        shiftId="shift-1"
        cashierLabel="Matías"
        cashierRole="MANAGER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Cafetería Sirope"
        tableContext={{
          id: "t3",
          name: "M1",
          zone: "SALON",
          capacity: 4,
          diners: 2,
          openedAt: new Date(now - 22 * 60_000).toISOString(),
          openedByEmail: null,
          openedByAlias: "Gemma",
          activeTicketId: "tk-m1",
        }}
        initialTableLines={vacia ? [] : doce ? LINES_12 : LINES}
        onBackToMap={() => {}}
        onTicketMovedToTable={null}
        onLogoutCashier={() => {}}
        onCloseShift={() => {}}
      />
    );
  }

  if (screen === "mapa") {
    return (
      <Screens.TableMapScreen
        cashierLabel="Matías"
        storeName="Cafetería Sirope"
        registerName="Caja 1"
        registerId="reg-1"
        shiftId="shift-1"
        cashierRole="MANAGER"
        onPickTable={() => {}}
        onQuickSale={() => {}}
        onLogoutCashier={() => {}}
        onCloseShift={() => {}}
      />
    );
  }

  return (
    <Screens.SalePage
      shiftId="shift-1"
      cashierLabel="Matías"
      cashierRole="MANAGER"
      registerName="Caja 1"
      registerId="reg-1"
      storeName="Cafetería Sirope"
      onBackToMap={() => {}}
      onLogoutCashier={() => {}}
      onCloseShift={() => {}}
    />
  );
}

stubSession();
stubFetch();

const mount = document.getElementById("root")!;

// v1.12 · la pantalla de bloqueo de navegador viejo se pinta sin React
// y sin `gap`, así que en el banco se invoca igual que en `main.tsx`.
if (new URLSearchParams(window.location.search).get("screen") === "bloqueo") {
  void import("../src/lib/browser-support.js").then((m) =>
    m.renderUnsupportedBrowser(
      mount,
      "Chrome 81.0.4044.138",
    ),
  );
} else {
  createRoot(mount).render(
    <StrictMode>
      <Bench />
    </StrictMode>,
  );
}
