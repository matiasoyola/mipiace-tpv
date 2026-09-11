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
//   v1.14.1-el-catalogo-manda: venta-mesa-1 · venta-mesa-2 · venta-mesa-8
//     (el hueco del desglose: se llena con 1 y 2 líneas, se va con 8) y
//     venta-mesa-fotos (catálogo con foto: la tarjeta NO cambia de alto)
//   v1.15-la-vuelta-existe: ticket-emitido (3,00 € cobrados con un billete
//     de 5: TOTAL / ENTREGADO / CAMBIO) · ticket-emitido-sin-vuelta (el
//     mismo cobro clavado: el bloque no se pinta)
//   B-reservas-6a-el-suelo: agenda con `?at=` (el reloj) — lo anterior al
//     comienzo de la franja EN CURSO sale apagado — y `?fallo=pasado`, que
//     devuelve el 409 BOOKING_IN_PAST con su frase y sus tres alternativas

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "../src/index.css";

import type { CartLine, CartTotals } from "../src/lib/cart.js";
import type { ApiTable } from "../src/pages/TableMapScreen.js";
import type { AppointmentContext } from "../src/pages/SalePage.js";

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

// v1.15-la-vuelta-existe · el payload digital del ticket #000020 de la
// auditoría: 3,00 € (café con leche + botellín) pagados con un billete
// de 5. Sirve para que la pantalla de éxito pinte sus tres acciones —
// el bloque no quita ninguna— y para poder abrir "Ver ticket" y mirar
// el PDF con su línea de Entregado / Cambio.
const TICKET_DIGITAL = {
  publicSlug: "a1b2c3d4e5f60718",
  emailedTo: null,
  ticketDelivery: {
    emailAutoIfCustomerHasEmail: false,
    showQrButton: true,
    showDownloadButton: true,
    showViewButton: true,
    emailSubject: "Tu ticket",
    emailBody: "Gracias por tu visita",
    qrCaption: "Escanea para ver tu ticket",
  },
  document: {
    fiscal: {
      legalName: "Sirope Café SL",
      taxId: "B12345678",
      address: "c/ Mayor 5, 28001 Madrid",
      phone: "+34 911 234 567",
    },
    store: { name: "Cafetería Sirope", address: "c/ Mayor 5" },
    ticket: {
      internalNumber: "000020",
      publicSlug: "a1b2c3d4e5f60718",
      issuedAt: new Date(now).toISOString(),
      cashierName: "Matías",
      registerName: "Caja 1",
      businessType: "HOSPITALITY",
    },
    lines: [
      {
        name: "Café con leche",
        units: 1,
        unitPrice: 1.5,
        discount: 0,
        subtotal: 1.36,
        taxRate: 10,
        total: 1.5,
      },
      {
        name: "Botellín",
        units: 1,
        unitPrice: 1.5,
        discount: 0,
        subtotal: 1.24,
        taxRate: 21,
        total: 1.5,
      },
    ],
    totals: {
      subtotal: 2.6,
      taxBreakdown: [
        { rate: 10, base: 1.36, tax: 0.14 },
        { rate: 21, base: 1.24, tax: 0.26 },
      ],
      total: 3,
    },
    // §1: `paid` es lo cobrado (= total); el billete vive en `received`.
    payment: { method: "CASH", paid: 3, received: 5, change: 2 },
    footer: {
      thankYouMessage: "¡Gracias por tu visita!",
      qrCaption: "Escanea para ver tu ticket",
    },
  },
};

// ── red de mentira ────────────────────────────────────────────────────

// Sesión de mentira: `apiWithCashier` corta con 401 antes de tocar la
// red si no hay cajero en localStorage, así que el banco necesita una.
// ── B-reservas-5 · fixtures de la peluquería (Sole) ───────────────────
//
// El banco necesitaba un vertical SERVICES con agenda para el bucle
// visual de este bloque: 3 profesionales, servicios con `durationMin` y
// un día con las seis situaciones que la agenda sabe pintar (pendiente,
// confirmada, en sala, finalizada, multi-servicio y hueco libre).
//
// Las horas se componen como HORA DE PARED de Europe/Madrid, igual que
// hace el motor (`apps/api/src/agenda/time.ts`): así la captura sale
// idéntica se tome desde el Mac o desde CI, que no comparten zona.

// B-reservas-5 · reloj congelado del banco.
//
// Sin esto, dos capturas de la misma pantalla NUNCA salen iguales: la
// agenda pinta la línea de "ahora" y hace auto-scroll hasta ella, y la
// barra inferior lleva la hora. Eso convierte el antes/después de la
// mudanza en un ejercicio de fe. Con `?at=HH:MM` (por defecto 11:20) el
// banco fija el instante y la comparación es byte a byte.
//
// Sólo el banco visual. No entra en el bundle de producción.
function freezeClock(): void {
  const at = new URLSearchParams(window.location.search).get("at") ?? "11:20";
  const [hh, mm] = at.split(":").map(Number);
  const fixed = new Date(madridIso(hh ?? 11, mm ?? 20)).getTime();
  const RealDate = Date;
  const FrozenDate = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new RealDate(fixed);
    return new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  (FrozenDate as { prototype: unknown }).prototype = RealDate.prototype;
  FrozenDate.now = () => fixed;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  window.Date = FrozenDate;

  // Con `?congelaAvisos=1` los temporizadores largos (los que apagan
  // toasts y overlays de éxito) no llegan a disparar. Los avisos duran
  // 3,5 s y una captura de Playwright tarda más que eso: sin esto, el
  // estado de error del bucle visual es infotografiable. Sólo el banco.
  if (new URLSearchParams(window.location.search).get("congelaAvisos") === "1") {
    const realTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if ((ms ?? 0) >= 3000) return 0 as unknown as number;
      return realTimeout(fn, ms, ...rest);
    }) as typeof window.setTimeout;
  }
}

const TZ_MADRID = "Europe/Madrid";

function benchToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_MADRID,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function madridIso(hh: number, mm: number): string {
  const date = benchToday();
  const pad = (n: number) => String(n).padStart(2, "0");
  const guess = new Date(`${date}T${pad(hh)}:${pad(mm)}:00Z`);
  const [gh, gm] = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_MADRID,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(guess)
    .split(":")
    .map(Number);
  const deltaMin = (gh! % 24) * 60 + gm! - (hh * 60 + mm);
  return new Date(guess.getTime() - deltaMin * 60_000).toISOString();
}

const SOLE_STAFF = [
  { userId: "st-sole", displayName: "Sole", color: "#8b5cf6", active: true },
  { userId: "st-marta", displayName: "Marta", color: "#ec4899", active: true },
  { userId: "st-nuria", displayName: "Nuria", color: "#0ea5e9", active: true },
];

function mkService(
  id: string,
  name: string,
  sku: string,
  priceGross: number,
  durationMin: number,
) {
  return {
    id,
    holdedProductId: `h-${id}`,
    name,
    sku,
    barcode: null,
    basePrice: Math.round((priceGross / 1.21) * 10_000) / 10_000,
    priceGross,
    taxRate: 21,
    kind: "SERVICE" as const,
    imageMime: null,
    tags: ["peluqueria"],
    durationMin,
  };
}

const SOLE_CATALOG = [
  mkService("sv-corte", "Corte de pelo", "CORTE", 18, 30),
  mkService("sv-lavado", "Lavado y peinado", "PEINADO", 15, 30),
  mkService("sv-tinte", "Tinte completo", "TINTE", 45, 90),
  mkService("sv-mechas", "Mechas balayage", "MECHAS", 70, 120),
  mkService("sv-manicura", "Manicura", "MANI", 22, 45),
  mkService("sv-recogido", "Recogido de novia", "RECOGIDO", 90, 120),
];

function mkClient(id: string, firstName: string, lastName: string, phone: string) {
  return {
    id,
    externalId: null,
    firstName,
    lastName,
    phone,
    email: null,
    birthdate: null,
    holdedContactId: null,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-01-15T09:00:00.000Z",
    updatedAt: "2026-01-15T09:00:00.000Z",
  };
}

const SOLE_CLIENTS = [
  mkClient("cl-carmen", "Carmen", "Ruiz", "600 111 222"),
  mkClient("cl-lucia", "Lucía", "Prieto", "600 333 444"),
  mkClient("cl-anabelen", "Ana Belén", "Soto", "600 555 666"),
  mkClient("cl-rosa", "Rosa", "Marín", "600 777 888"),
  mkClient("cl-isabel", "Isabel", "Cano", "600 999 000"),
];

function mkAppt(
  id: string,
  clientId: string | null,
  staffUserId: string,
  status: string,
  hh: number,
  mm: number,
  services: Array<[string, number]>,
  ticketId: string | null = null,
) {
  let offset = 0;
  const items = services.map(([serviceId, durationMin], i) => {
    const it = {
      id: `${id}-i${i}`,
      serviceId,
      durationMin,
      sortOrder: i,
      startOffsetMin: offset,
    };
    offset += durationMin;
    return it;
  });
  const start = madridIso(hh, mm);
  return {
    id,
    clientId,
    status,
    source: "PRESENCIAL",
    start,
    end: new Date(new Date(start).getTime() + offset * 60_000).toISOString(),
    ticketId,
    notes: null,
    items,
    assignments: items.map(() => ({
      reservableType: "STAFF" as const,
      staffUserId,
      resourceId: null,
    })),
  };
}

const SOLE_DAY = {
  from: madridIso(0, 0),
  to: madridIso(23, 59),
  staff: SOLE_STAFF,
  appointments: [
    mkAppt("ap-1", "cl-carmen", "st-sole", "COMPLETED", 9, 30, [["sv-corte", 30]]),
    mkAppt("ap-2", "cl-lucia", "st-marta", "IN_SERVICE", 10, 0, [["sv-tinte", 90]]),
    mkAppt("ap-3", "cl-anabelen", "st-nuria", "CONFIRMED", 10, 30, [["sv-mechas", 120]]),
    // Multi-servicio encadenado: corte + peinado en la misma visita.
    mkAppt("ap-4", "cl-rosa", "st-sole", "CONFIRMED", 12, 0, [
      ["sv-corte", 30],
      ["sv-lavado", 30],
    ]),
    mkAppt("ap-5", "cl-isabel", "st-marta", "PENDING", 12, 30, [["sv-manicura", 45]]),
    // Sin cliente: la reserva de teléfono que aún no tiene ficha.
    mkAppt("ap-6", null, "st-nuria", "CONFIRMED", 16, 0, [["sv-corte", 30]]),
    mkAppt("ap-7", "cl-carmen", "st-sole", "CONFIRMED", 17, 0, [["sv-recogido", 120]]),
  ],
};

// El DRAFT que abriría el puente cita→caja: una línea por servicio del
// visit, resuelta por `serviceId`, units 1 y sin descuento — igual que
// `apps/api/src/agenda/checkout.ts`.
function cartForAppointment(appointmentId: string): CartLine[] {
  const appt = SOLE_DAY.appointments.find((a) => a.id === appointmentId);
  if (!appt) return [];
  return appt.items.map((it, i) => {
    const svc = SOLE_CATALOG.find((p) => p.id === it.serviceId)!;
    return {
      id: `${appointmentId}-l${i}`,
      productId: svc.id,
      variantId: null,
      holdedProductId: svc.holdedProductId,
      sku: svc.sku,
      nameSnapshot: svc.name,
      units: 1,
      unitPrice: svc.basePrice,
      unitPriceOverride: null,
      priceGross: svc.priceGross,
      discountPct: 0,
      taxRate: svc.taxRate,
      modifiers: [],
    };
  });
}

function benchFallo(): string | null {
  return new URLSearchParams(window.location.search).get("fallo");
}

function isAgendaScreen(): boolean {
  return benchScreen().startsWith("agenda");
}

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
  // B-reservas-5 · las capabilities se leen en el PRIMER pintado (igual
  // que el vertical): sin esto, `agenda-entrada` saldría sin el botón
  // "Agenda", que es justo lo que esa captura viene a fijar.
  localStorage.setItem(
    "mipiacetpv-catalog-agenda-enabled",
    isAgendaScreen() ? "1" : "0",
  );
  localStorage.setItem(
    "mipiacetpv-catalog-crm-enabled",
    isAgendaScreen() ? "1" : "0",
  );
}

// v1.14 · el banco necesita variar catálogo y vertical por pantalla: los
// chips salen del catálogo y la barra superior del `businessType`.
function benchScreen(): string {
  return new URLSearchParams(window.location.search).get("screen") ?? "checkout";
}

function benchCatalog() {
  const screen = benchScreen();
  // B-reservas-5 · la agenda pinta nombres de servicio desde la caché
  // del catálogo; sin esto las citas saldrían todas como "Servicio".
  if (isAgendaScreen()) return SOLE_CATALOG;
  if (screen === "venta-20-categorias") return catalogWithTags(TAGS_20);
  if (screen === "venta-retail") return catalogWithTags(TAGS_SIROPE.slice(0, 5));
  const base = catalogWithTags(TAGS_SIROPE);
  // v1.14.1-el-catalogo-manda §1 · el caso "con foto". Marca la mitad de
  // los productos con `imageMime` para que `productImageUrl` devuelva
  // ruta y la tarjeta pinte el `<img>`. Los bytes de la imagen NO viven
  // aquí: el banco no sirve `/product-images/...`, así que la captura de
  // esta pantalla rellena los `src` con un data-URI desde Playwright.
  // Lo que se comprueba es lo que el bloque exige —que la tarjeta con
  // foto y la tarjeta sin foto midan lo mismo—, y eso no depende de qué
  // imagen sea.
  if (screen === "venta-mesa-fotos") {
    return base.map((p, i) =>
      i % 2 === 0 ? { ...p, imageMime: "image/jpeg" } : p,
    );
  }
  return base;
}

// v1.14.1-el-catalogo-manda §3 · el hueco del desglose depende del
// NÚMERO de líneas, así que el banco necesita poder pedir 0, 1, 2, 6 y 8.
function benchLines(): CartLine[] {
  const screen = benchScreen();
  if (screen === "venta-mesa-vacia") return [];
  if (screen === "venta-mesa-1") return LINES.slice(0, 1);
  if (screen === "venta-mesa-2") return LINES.slice(0, 2);
  if (screen === "venta-mesa-8") return LINES_12.slice(0, 8);
  if (screen === "venta-mesa-12") return LINES_12;
  return LINES;
}

function benchBusinessType(): string {
  if (isAgendaScreen()) return "SERVICES";
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
      crmEnabled: isAgendaScreen(),
      agendaEnabled: isAgendaScreen(),
    },
    // B-reservas-5 · el día de la peluquería. La query (`?date=`) la
    // recorta el dispatcher, así que la clave es la ruta pelada.
    "/agenda": SOLE_DAY,
    "/clients": { items: SOLE_CLIENTS, nextCursor: null },
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
  const seed = benchLines();
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
    // digital. El primero lo servimos siempre; el segundo, sólo en las
    // pantallas de v1.15 — que son las que tienen que enseñar que
    // **ninguna acción existente desaparece** (Mostrar QR · Descargar
    // PDF · Ver ticket). En el resto se deja caer con 404 a propósito,
    // que es el camino degradado que el overlay ya sabe recorrer.
    // B-reservas-5 · el puente cita→caja. Devuelve el DRAFT pre-poblado
    // con las líneas del visit, como `agenda/checkout.ts`.
    const cita = /^\/agenda\/appointments\/([^/]+)\/checkout$/.exec(path);
    if (cita) {
      const id = cita[1]!;
      // B-reservas-5 F8 · el estado de error del bucle visual. La cita
      // ya se cobró: el servidor corta antes de pasear a la cajera por
      // el modal (F5). `?fallo=cobrada` lo reproduce en el banco.
      if (benchFallo() === "cobrada") {
        return new Response(
          JSON.stringify({
            error: "APPOINTMENT_ALREADY_PAID",
            message: "Esta cita ya se cobró.",
            ticketId: `tk-${id}`,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      const cart = cartForAppointment(id);
      return new Response(
        JSON.stringify({
          ticket: {
            id: `tk-${id}`,
            externalId: `ext-${id}`,
            status: "DRAFT",
            total: cart
              .reduce((a, l) => a + l.priceGross * l.units, 0)
              .toFixed(2),
            totalTax: "0.00",
            totalDiscount: "0.00",
            lines: cart.map((l) => ({
              id: l.id,
              productId: l.productId,
              sku: l.sku,
              nameSnapshot: l.nameSnapshot,
              units: String(l.units),
              unitPrice: String(l.unitPrice),
              taxRate: String(l.taxRate),
              total: String(l.priceGross * l.units),
            })),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    // B-reservas-6a · el 409 del suelo. `?fallo=pasado` reproduce en el
    // banco lo que el servidor manda cuando la hora ya pasó: la frase que
    // se le lee a la clienta y los tres huecos que sí se le pueden dar.
    // Es el estado de error del bucle visual de este bloque.
    if (path === "/agenda/appointments" && init?.method === "POST") {
      if (benchFallo() === "pasado") {
        return new Response(
          JSON.stringify({
            error: "BOOKING_IN_PAST",
            code: "BOOKING_IN_PAST",
            message:
              "Esa hora ya ha pasado. Te puedo dar las 11:30, las 11:45 o las 12:00.",
            alternatives: [
              { start: madridIso(11, 30), end: madridIso(12, 0), options: 1 },
              { start: madridIso(11, 45), end: madridIso(12, 15), options: 1 },
              { start: madridIso(12, 0), end: madridIso(12, 30), options: 1 },
            ],
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          appointment: {
            id: "ap-nueva",
            clientId: null,
            status: "CONFIRMED",
            source: "PRESENCIAL",
            start: madridIso(12, 0),
            end: madridIso(12, 30),
            ticketId: null,
            notes: null,
            items: [],
            assignments: [],
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    // B-reservas-5 F8 · el cobro del borrador de la cita. Devuelve el
    // ticket emitido para poder fotografiar "Ticket emitido" con la
    // vuelta de v1.15, que es la razón de que la cita NO herede el
    // patrón mesa (decisión P1 del bloque).
    if (/^\/tickets\/[^/]+\/checkout$/.test(path)) {
      return new Response(
        JSON.stringify({
          ticket: {
            id: "tk-cita",
            internalNumber: "000042",
            status: "TEST",
            holdedDocNumber: null,
          },
          syncStatus: "TEST",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (/^\/tickets\/[^/]+\/digital$/.test(path)) {
      if (!benchScreen().startsWith("ticket-emitido") && !isAgendaScreen()) {
        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(TICKET_DIGITAL), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (/^\/tickets\/[^/]+$/.test(path)) {
      // v1.15 · las pantallas de "Ticket emitido" reproducen el ticket
      // #000020 de la auditoría, que se emitió en MODO PRUEBA. Así el
      // antes/después compara la misma pantalla y no una versión con
      // número fiscal que el AP11 nunca llegó a ver.
      const esTicketEmitido = benchScreen().startsWith("ticket-emitido");
      return new Response(
        JSON.stringify({
          ticket: esTicketEmitido
            ? {
                id: path.slice("/tickets/".length),
                internalNumber: "000020",
                status: "TEST",
                holdedDocNumber: null,
              }
            : {
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

// B-reservas-5 F1 · el cableado de `App`, replicado.
//
// El banco no monta `App` (pide sesión, turno y catálogo reales), pero la
// mudanza consiste justamente en QUIÉN pinta la agenda. Así que aquí se
// reproduce el contrato exacto que ahora tiene `App`: el botón sólo avisa
// (`onOpenAgenda`) y el overlay lo pinta el de arriba. Si ese contrato se
// rompiera, esta pantalla dejaría de abrir la agenda al tocar el botón.
function AgendaEntrada({
  Screens,
}: {
  Screens: {
    SalePage: typeof import("../src/pages/SalePage.js")["SalePage"];
    AgendaPage: typeof import("../src/pages/AgendaPage.js")["AgendaPage"];
  };
}) {
  const [showAgenda, setShowAgenda] = useState(false);
  const [appointmentContext, setAppointmentContext] = useState<
    AppointmentContext | null
  >(null);
  const draftCart = appointmentContext
    ? cartForAppointment(appointmentContext.appointmentId)
    : undefined;
  return (
    <>
      {showAgenda && (
        <Screens.AgendaPage
          onClose={() => setShowAgenda(false)}
          onEnterDraft={(entry) => {
            setAppointmentContext({
              appointmentId: entry.appointmentId,
              activeTicketId: entry.ticketId,
              clientName: entry.clientName,
              serviceLabel: entry.serviceLabel,
            });
          }}
        />
      )}
      <Screens.SalePage
        key={appointmentContext?.activeTicketId ?? "quick-sale"}
        shiftId="shift-1"
        cashierLabel="Sole"
        cashierRole="MANAGER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Peluquería Sole"
        onOpenAgenda={() => setShowAgenda(true)}
        appointmentContext={appointmentContext}
        initialDraftLines={draftCart}
        onBackToAgenda={() => {
          setAppointmentContext(null);
          setShowAgenda(true);
        }}
        onBackToMap={() => {}}
        onLogoutCashier={() => {}}
        onCloseShift={() => {}}
      />
    </>
  );
}

// ── pantallas ─────────────────────────────────────────────────────────

function Bench() {
  const params = new URLSearchParams(window.location.search);
  const screen = params.get("screen") ?? "checkout";
  const [Screens, setScreens] = useState<null | {
    CheckoutOverlay: typeof import("../src/pages/CheckoutPage.js")["CheckoutOverlay"];
    SuccessOverlay: typeof import("../src/pages/CheckoutPage.successOverlay.js")["SuccessOverlay"];
    SalePage: typeof import("../src/pages/SalePage.js")["SalePage"];
    TableMapScreen: typeof import("../src/pages/TableMapScreen.js")["TableMapScreen"];
    CloseShiftModal: typeof import("../src/pages/CloseShiftModal.js")["CloseShiftModal"];
    ShiftOpenScreen: typeof import("../src/pages/ShiftOpenScreen.js")["ShiftOpenScreen"];
    ConfirmSheet: typeof import("../src/components/ConfirmSheet.js")["ConfirmSheet"];
    AgendaPage: typeof import("../src/pages/AgendaPage.js")["AgendaPage"];
  }>(null);

  useEffect(() => {
    void (async () => {
      const [checkout, success, sale, map, close, open, confirmSheet, agenda] =
        await Promise.all([
          import("../src/pages/CheckoutPage.js"),
          import("../src/pages/CheckoutPage.successOverlay.js"),
          import("../src/pages/SalePage.js"),
          import("../src/pages/TableMapScreen.js"),
          import("../src/pages/CloseShiftModal.js"),
          import("../src/pages/ShiftOpenScreen.js"),
          import("../src/components/ConfirmSheet.js"),
          import("../src/pages/AgendaPage.js"),
        ]);
      // B-reservas-5 · la agenda lee servicios y clientes de la CACHÉ
      // (IndexedDB), no de la red: sin sembrarla, las citas saldrían como
      // "Servicio" / "Cliente" y el panel de alta, vacío. Se siembra
      // contra los mismos stubs que sirve el banco.
      if (isAgendaScreen()) {
        const [cat, cli] = await Promise.all([
          import("../src/lib/catalog.js"),
          import("../src/lib/clients.js"),
        ]);
        await Promise.all([
          cat.refreshCatalog().catch(() => {}),
          cli.refreshClients().catch(() => {}),
        ]);
      }
      setScreens({
        CheckoutOverlay: checkout.CheckoutOverlay,
        SuccessOverlay: success.SuccessOverlay,
        SalePage: sale.SalePage,
        TableMapScreen: map.TableMapScreen,
        CloseShiftModal: close.CloseShiftModal,
        ShiftOpenScreen: open.ShiftOpenScreen,
        ConfirmSheet: confirmSheet.ConfirmSheet,
        AgendaPage: agenda.AgendaPage,
      });
    })();
  }, []);

  if (!Screens) return <div style={{ padding: 24 }}>cargando…</div>;

  // ── v1.15-la-vuelta-existe ─────────────────────────────────────────
  // El segundo siguiente al cobro. `ticket-emitido` es el caso de la
  // auditoría (3,00 € y un billete de 5); `-sin-vuelta`, el mismo cobro
  // clavado, para mirar que el bloque no aparece y la pantalla queda
  // como estaba.
  if (screen.startsWith("ticket-emitido")) {
    const conVuelta = screen !== "ticket-emitido-sin-vuelta";
    return (
      <Screens.SuccessOverlay
        ticketId="tk-000020"
        internalNumber="000020"
        cash={
          conVuelta
            ? { total: 3, received: 5, change: 2 }
            : { total: 3, received: 3, change: 0 }
        }
        onDone={() => {}}
      />
    );
  }

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
        initialDraftLines={benchLines()}
        onBackToMap={() => {}}
        onTicketMovedToTable={null}
        onLogoutCashier={() => {}}
        onCloseShift={() => {}}
      />
    );
  }

  // ── B-reservas-5 · la agenda ───────────────────────────────────────
  // `AgendaPage` es un overlay a pantalla completa (`fixed inset-0`), así
  // que se pinta igual montada suelta que montada dentro de `SalePage`.
  // Ese es justo el punto de la MUDANZA SIN REFORMA: esta captura tiene
  // que salir idéntica antes y después de que la agenda suba a `App`.
  if (screen === "agenda") {
    return <Screens.AgendaPage onClose={() => {}} />;
  }

  // El punto de ENTRADA a la agenda: la venta de Sole con el botón
  // "Agenda" en la barra. La mudanza cambia a quién llama ese botón, así
  // que la captura tiene que salir igual antes y después.
  if (screen === "agenda-entrada") {
    return <AgendaEntrada Screens={Screens} />;
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

freezeClock();
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
