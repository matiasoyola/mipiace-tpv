// Banco visual del PANEL · SOLO desarrollo.
//
// El gemelo del de `apps/tpv-web/visual`, y por la misma razón: abrir con
// los ojos las pantallas que toca un bloque, con la red interceptada y
// sin base de datos detrás. No entra en el bundle de producción — `vite
// build` sólo toma `index.html` como entrada, y este HTML vive fuera de
// ese grafo.
//
//   pnpm --filter @mipiacetpv/admin dev
//   → http://localhost:5173/visual/index.html?screen=mi-cuenta
//
// pin-1 · pantallas:
//   · `mi-cuenta`              — «Mi PIN del TPV», con el campo del actual
//   · `mi-cuenta-olvidado`     — tras pulsar «He olvidado mi PIN»
//   · `mi-cuenta-sin-pin`      — el primer día: «Elige tu PIN del TPV»
//   · `mi-cuenta-provisional`  — con un PIN prestado por soporte
//   · `mi-cuenta-soporte`      — lo que ve Mi Piace en «Configurar como OWNER»
//   · `cajeros`                — la pantalla desde la que se repone un PIN

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import "../src/index.css";

const params = new URLSearchParams(window.location.search);
const screen = params.get("screen") ?? "mi-cuenta";

// ── la sesión falsa ──────────────────────────────────────────────────
//
// `readTokens` lee de `sessionStorage`/`localStorage`, y la
// impersonación de su propia clave: se siembran antes de importar nada
// de la app para que `readEffectiveAuth` conteste lo que toca.
// El rol lo saca `readCurrentRole` del PAYLOAD del access token, así que
// el falso tiene que tener tres partes y un payload legible.
const jwtFalso = (payload: Record<string, unknown>) =>
  `banco.${btoa(JSON.stringify(payload)).replace(/=/g, "")}.banco`;
sessionStorage.setItem(
  "mipiacetpv-admin-access",
  jwtFalso({ sub: "u1", tid: "t1", role: "OWNER", type: "access" }),
);
sessionStorage.setItem("mipiacetpv-admin-refresh", "banco");
if (screen === "mi-cuenta-soporte") {
  // Un JWT con `purpose: "impersonation"` y `mode: "full"`, sin firma
  // válida: el panel sólo lee el payload para decidir qué pinta.
  sessionStorage.setItem(
    "mipiacetpv-admin-impersonation-access",
    jwtFalso({
      sub: "u1",
      tid: "t1",
      role: "OWNER",
      purpose: "impersonation",
      mode: "full",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
}

// ── la red ───────────────────────────────────────────────────────────

const ME = {
  user: {
    id: "u1",
    email: "carmen@sirope.es",
    role: "OWNER",
    twoFactorEnabled: false,
    recoveryCodesRemaining: 0,
    hasPin: screen !== "mi-cuenta-sin-pin",
    pinProvisional: screen === "mi-cuenta-provisional",
  },
  tenant: {
    id: "t1",
    name: "CAFETERÍA SIROPE SL",
    hasHoldedKey: false,
    holdedEnabled: false,
    cajaEnabled: true,
    crmEnabled: true,
    agendaEnabled: false,
    fichajeEnabled: false,
    residenciaEnabled: false,
    businessType: "HOSPITALITY",
    initialSyncStatus: "NOT_APPLICABLE",
    fiscalProfile: {
      businessName: "CAFETERÍA SIROPE SL",
      nif: "B45902186",
      address: "Calle Real 14",
      postalCode: "45600",
      city: "Talavera de la Reina",
      province: "Toledo",
      country: "ES",
    },
    lastIncrementalSyncAt: null,
    facturaDesde: "2026-01-01T00:00:00.000Z",
    holdedDisconnectedAt: null,
    contratoClinico: null,
  },
};

const CAJEROS = {
  cashiers: [
    {
      id: "c1",
      email: "marta@sirope.es",
      alias: "Marta",
      role: "CASHIER",
      lastLoginAt: "2026-10-26T18:40:00.000Z",
      createdAt: "2026-02-10T09:00:00.000Z",
    },
    {
      id: "c2",
      email: "luis@sirope.es",
      alias: "Luis",
      role: "MANAGER",
      lastLoginAt: "2026-10-27T07:05:00.000Z",
      createdAt: "2025-11-02T09:00:00.000Z",
    },
  ],
};

const real = window.fetch.bind(window);
window.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada.toString();
  const json = (cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (url.includes("/api/auth/me")) return json(ME);
  if (url.includes("/api/cashiers")) return json(CAJEROS);
  if (url.startsWith("/api/")) return json({ ok: true });
  return real(entrada, init);
}) as typeof window.fetch;

// ── montaje ──────────────────────────────────────────────────────────

const { AccountPage } = await import("../src/App.js");
const { CashiersPage } = await import("../src/pages/CashiersPage.js");

function Banco() {
  // `mi-cuenta-olvidado` es la misma pantalla con «He olvidado mi PIN»
  // ya pulsado: se pulsa desde aquí para no duplicar el estado.
  useEffect(() => {
    if (screen !== "mi-cuenta-olvidado") return;
    const t = setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="mi-pin-olvidado"]')
        ?.click();
    }, 150);
    return () => clearTimeout(t);
  }, []);
  if (screen === "cajeros") return <CashiersPage />;
  return <AccountPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter>
      <Banco />
    </MemoryRouter>
  </StrictMode>,
);
