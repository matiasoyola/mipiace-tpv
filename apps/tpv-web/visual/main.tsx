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

// Catálogo de barra, suficiente para llenar el ticket y estresar el
// listado del bottom-sheet.
const CATALOG = LINES.map((l, i) => ({
  id: `00000000-0000-0000-0000-00000000000${i + 1}`,
  holdedProductId: `h-${i + 1}`,
  sku: l.sku,
  name: l.nameSnapshot,
  basePrice: l.unitPrice,
  priceGross: l.priceGross,
  taxRate: l.taxRate,
  tags: [] as string[],
  kind: "PRODUCT" as const,
}));

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
    "/tpv/tables": { storeId: "store-1", registerId: "reg-1", tables: TABLES },
    "/tpv/catalog/products": {
      items: CATALOG,
      nextCursor: null,
      tenantId: "tenant-1",
      businessType: "HOSPITALITY",
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
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as Request).url ?? input);
    if (!url.includes("/api/")) return real(input as RequestInfo, init);
    const path = url.slice(url.indexOf("/api/") + 4).split("?")[0]!;
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
  }>(null);

  useEffect(() => {
    void (async () => {
      const [checkout, sale, map] = await Promise.all([
        import("../src/pages/CheckoutPage.js"),
        import("../src/pages/SalePage.js"),
        import("../src/pages/TableMapScreen.js"),
      ]);
      setScreens({
        CheckoutOverlay: checkout.CheckoutOverlay,
        SalePage: sale.SalePage,
        TableMapScreen: map.TableMapScreen,
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
      onLogoutCashier={() => {}}
      onCloseShift={() => {}}
    />
  );
}

stubSession();
stubFetch();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bench />
  </StrictMode>,
);
