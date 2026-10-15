// catalogo-servicios-csv · el interruptor de la historia clínica, TAMBIÉN
// en DRAFT.
//
// EL CÍRCULO QUE ESTO ROMPE, encontrado recorriendo el alta real de la
// clínica de Rosario (tenant en DRAFT, sin Holded):
//
//   · su catálogo son 17 servicios sanitarios exentos, y un `E1` en el
//     fichero de alta exige `clinicalRecordsEnabled`
//     (`api/src/superadmin/tenant-catalog.ts`). Sin la clínica encendida,
//     las 17 filas se SALTAN con su motivo;
//   · sin catálogo, `products-sellable` no pasa y la cuenta no se activa;
//   · y el interruptor «Historia clínica» vivía dentro de
//     `ActiveTenantActions`, que sólo se pinta cuando el tenant **NO**
//     está en DRAFT.
//
// O sea: **para encender la clínica había que activar la cuenta, y para
// activarla había que tener el catálogo, que necesitaba la clínica.** El
// `PATCH /super-admin/tenants/:id` ya aceptaba el campo en DRAFT —con sus
// guardas de CRM y agenda—, así que lo único que faltaba era la puerta en
// pantalla.
//
// Lo que este banco fija, con sus sabotajes:
//
//   1. **En DRAFT se ve la caja «Datos de salud» con sus dos casillas.**
//      Sabotaje: devolver `<DatosDeSaludPanel>` a dentro de
//      `ActiveTenantActions` (o envolverlo en `!isDraft`).
//   2. **Es el MISMO componente y el MISMO camino**: el confirm de
//      «esto se habla y se firma», el mismo `PATCH` con el campo, y el
//      refresco de la ficha. Sabotaje: una segunda caja escrita a mano
//      para el DRAFT, sin confirm o sin PATCH.
//   3. **Cancelar el confirm no manda nada.** Es el que hace que la frase
//      del DPA signifique algo.
//   4. **En ACTIVE sigue exactamente donde estaba**: debajo de las
//      métricas y encima de «Acciones». Sabotaje: moverla de sitio al
//      extraer el componente — son quince tenants que ya saben dónde
//      buscarla.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

interface Llamada {
  path: string;
  method?: string;
  body?: unknown;
}
const llamadas: Llamada[] = [];
let estado: "DRAFT" | "ACTIVE" = "DRAFT";
let clinicaEncendida = false;

class FakeSuperAdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// La clínica de Rosario tal y como la devuelve
// `GET /super-admin/tenants/:id`: sin Holded, con caja, CRM y agenda —los
// tres que la historia clínica necesita— y todavía sin catálogo, que es
// justo el estado en el que el implantador se queda encerrado.
function tenantDetail() {
  return {
    id: TENANT_ID,
    name: "Clínica de Podología Rosario SL",
    fiscalProfile: { legalName: "Clínica de Podología Rosario SL", taxId: "B90000001" },
    fiscalNif: "B90000001",
    plan: null,
    onboardingState: estado,
    businessType: "SERVICES",
    receiptFooter: null,
    tpvIconPreset: null,
    holdedConnected: false,
    holdedEnabled: false,
    holdedDisconnectedAt: null,
    holdedStatus: "NOT_CONNECTED",
    holdedAuthMode: "API_KEY",
    holdedAccountId: null,
    initialSyncStatus: "NOT_APPLICABLE",
    modules: { caja: true, crm: true, agenda: true },
    kitchenDisplayEnabled: false,
    clinicalRecordsEnabled: clinicaEncendida,
    residenciaEnabled: false,
    lastIncrementalSyncAt: null,
    createdAt: "2026-10-15T08:00:00.000Z",
    blockedAt: null,
    blockedReason: null,
    ownerEmail: null,
    users: [],
    stores: [],
    metrics: {
      ticketsLast7d: 0,
      ticketsSyncFailed: 0,
      ticketsEmailFailed: 0,
      degraded: { state: "ok", lastIncrementalSyncAt: null },
      storesCount: 0,
      activeShifts: 0,
    },
    onboardingHealth: {
      initialSync: { status: "NOT_APPLICABLE", lastRunAt: null, errorMessage: null },
      taxes: { total: 0, withValidRate: 0, withoutRate: 0 },
      products: { total: 0, sellable: 0, withSku: 0, withoutSku: 0 },
      services: { total: 0, sellable: 0 },
      contacts: { total: 0 },
      ticketsTest: { total: 0, lastAt: null },
      ticketsSyncFailed: 0,
      testCashierProvisioned: false,
      modules: { caja: true, crm: true, agenda: true },
      holded: { enabled: false, connected: false },
      ticketsCobradosSinSubir: 0,
      readinessChecks: [
        {
          id: "products-sellable",
          label: "≥50% de productos sellable",
          ok: false,
          value: "0/0 (100%)",
          requires: "caja",
          applies: true,
        },
      ],
      ready: false,
    },
  };
}

vi.mock("../src/superadmin/api.js", () => ({
  SuperAdminApiError: FakeSuperAdminApiError,
  superApi: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
    llamadas.push({ path, method: opts?.method, body: opts?.body });
    // El shell pregunta quién soy en cuanto monta.
    if (path === "/super-admin/auth/me") return { isRoot: true, email: "root@mipiacetpv.tech" };
    if (path === `/super-admin/tenants/${TENANT_ID}/fiscal`) {
      return { registers: [], chains: [] };
    }
    if (path.endsWith("/cashiers")) return { cashiers: [] };
    if (path === `/super-admin/tenants/${TENANT_ID}` && opts?.method === "PATCH") {
      // El PATCH de verdad acepta el campo en DRAFT; aquí se refleja para
      // que el `reload()` de después devuelva la ficha ya encendida.
      const b = opts.body as Record<string, unknown>;
      if (typeof b.clinicalRecordsEnabled === "boolean") {
        clinicaEncendida = b.clinicalRecordsEnabled;
      }
      return { tenant: tenantDetail() };
    }
    if (path === `/super-admin/tenants/${TENANT_ID}`) return tenantDetail();
    return {};
  }),
}));

const { TenantDetailPage } = await import("../src/superadmin/TenantDetailPage.js");

let container: HTMLDivElement;
let root: Root;
let confirmado = true;
const confirmsVistos: string[] = [];

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/super-admin/tenants/${TENANT_ID}`]}>
        <Routes>
          <Route path="/super-admin/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  // Un tick más: el shell y los sub-paneles resuelven sus propias
  // promesas después del primer render.
  await act(async () => {
    await Promise.resolve();
  });
}

function text(): string {
  return container.textContent ?? "";
}

/** La casilla por su etiqueta visible, que es como la encuentra el
 *  implantador: el `<input>` y el texto viven en el mismo `<label>`. */
function casilla(etiqueta: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((l) =>
    (l.textContent ?? "").includes(etiqueta),
  );
  if (!label) throw new Error(`no hay casilla «${etiqueta}» en la pantalla`);
  const input = label.querySelector('input[type="checkbox"]');
  if (!input) throw new Error(`la casilla «${etiqueta}» no tiene checkbox`);
  return input as HTMLInputElement;
}

const patches = () =>
  llamadas.filter((l) => l.method === "PATCH" && l.path === `/super-admin/tenants/${TENANT_ID}`);

beforeEach(() => {
  llamadas.length = 0;
  confirmsVistos.length = 0;
  confirmado = true;
  estado = "DRAFT";
  clinicaEncendida = false;
  vi.stubGlobal("confirm", (msg: string) => {
    confirmsVistos.push(msg);
    return confirmado;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("catalogo-servicios-csv · en DRAFT se puede encender la historia clínica", () => {
  it("la caja «Datos de salud» se pinta con el tenant en DRAFT", async () => {
    await render();
    // Que de verdad estamos en DRAFT y no en una ficha activa: el panel de
    // activar sólo existe ahí.
    expect(text()).toContain("Activar");
    expect(text()).toContain("Datos de salud");
    expect(text()).toContain("Historia clínica");
    expect(text()).toContain("Residencia");
  });

  it("y dice lo que encenderla significa, igual que en una cuenta activa", async () => {
    await render();
    // La frase del RGPD es la razón de que esta caja esté separada del
    // resto. Si el DRAFT tuviera su propia caja escrita a mano, esto es lo
    // primero que se quedaría fuera.
    expect(text()).toContain("encargado de tratamiento");
    expect(text()).toContain("DPA firmado");
    expect(text()).toContain("Necesita CRM y agenda");
  });

  it("marcarla pregunta, manda el PATCH y recarga la ficha", async () => {
    await render();
    expect(casilla("Historia clínica").checked).toBe(false);

    await act(async () => {
      casilla("Historia clínica").click();
      await Promise.resolve();
    });

    // 1 · el confirm, que es el MISMO del tenant activo.
    expect(confirmsVistos).toHaveLength(1);
    expect(confirmsVistos[0]).toContain("Vas a encender la historia clínica");
    expect(confirmsVistos[0]).toContain("¿Está hablado?");

    // 2 · el PATCH, con el campo y nada más.
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.body).toEqual({ clinicalRecordsEnabled: true });

    // 3 · y la ficha vuelve ya encendida, así que la casilla queda marcada
    //     y el implantador puede pasar a cargar el catálogo.
    expect(casilla("Historia clínica").checked).toBe(true);
    expect(text()).toContain("La historia clínica encendida");
  });

  it("cancelar el confirm no manda NADA", async () => {
    confirmado = false;
    await render();
    await act(async () => {
      casilla("Historia clínica").click();
      await Promise.resolve();
    });
    expect(confirmsVistos).toHaveLength(1);
    expect(patches()).toEqual([]);
    expect(casilla("Historia clínica").checked).toBe(false);
  });

  it("y el panel de «Cargar catálogo» está en la misma pantalla", async () => {
    // El paso siguiente del implantador. Los dos tienen que estar en DRAFT
    // o el círculo se cierra otra vez por el otro lado.
    await render();
    expect(text()).toContain("Cargar catálogo");
    expect(text()).toContain("tipo,exencion,duracion_min");
  });
});

describe("catalogo-servicios-csv · en ACTIVE la caja no se ha movido", () => {
  beforeEach(() => {
    estado = "ACTIVE";
    clinicaEncendida = true;
  });

  it("sigue estando, con la casilla ya marcada", async () => {
    await render();
    expect(text()).toContain("Datos de salud");
    expect(casilla("Historia clínica").checked).toBe(true);
  });

  it("y sigue debajo de las métricas y ENCIMA de «Acciones»", async () => {
    // Quince tenants ya saben dónde buscarla. Extraer el componente no
    // puede cambiarle el sitio, y el orden del DOM es la única forma de
    // comprobarlo que no es una captura.
    await render();
    const t = text();
    const salud = t.indexOf("Datos de salud");
    const modulos = t.indexOf("Módulos");
    const acciones = t.indexOf("Acciones");
    expect(modulos).toBeGreaterThanOrEqual(0);
    expect(acciones).toBeGreaterThan(0);
    expect(salud).toBeGreaterThan(modulos);
    expect(salud).toBeLessThan(acciones);
  });

  it("apagarla avisa de lo que se queda dentro", async () => {
    await render();
    await act(async () => {
      casilla("Historia clínica").click();
      await Promise.resolve();
    });
    expect(confirmsVistos[0]).toContain("Vas a apagar la historia clínica");
    expect(confirmsVistos[0]).toContain("se queda en la base");
    expect(patches()[0]!.body).toEqual({ clinicalRecordsEnabled: false });
  });
});
