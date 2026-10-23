// clinica-8 (fase B, 18) · «COMANDERAS» NO ES DE UNA CLÍNICA.
//
// Auditoría del 18-10, en los menores: «"Comanderas" en el menú de una
// clínica». La sección reparte las etiquetas del catálogo entre las
// impresoras de barra y de cocina. En una clínica no hay barra, no hay
// cocina y no hay comanda; lo que hay es una podóloga mirando una
// entrada del menú que no sabe qué es.
//
// Iba con `capability: "caja"`, y la «Clínica demo» tiene caja: cobra.
// Lo que la distingue es el VERTICAL, y es la misma corrección que el
// addendum 3 de catálogo-local le hizo a «Sync Holded» —«una sección
// cuyo único botón fuerza una sincronización que no existe»— por el
// mismo motivo.
//
// Y de paso el otro medio punto 18: con la sesión caída, las capacidades
// fallaban con 401 y caían a su valor por defecto («asume caja y
// Holded»), que repintaba la barra lateral de otro comercio.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let businessType: "HOSPITALITY" | "RETAIL" | "SERVICES" | undefined;
let cajaEnabled: boolean;
let clinicaEnabled: boolean;
/** `401` = la sesión se ha caído; `500` = un fallo de red cualquiera. */
let fallo: 401 | 500 | null;

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
  api: vi.fn(async (path: string) => {
    if (fallo) throw new FakeApiError(fallo, "no", "NO");
    if (path === "/admin/tenant/settings") {
      return {
        settings: {
          cajaEnabled,
          agendaEnabled: true,
          clinicalRecordsEnabled: clinicaEnabled,
        },
      };
    }
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "rosa@clinicademo.es", role: "OWNER" },
        tenant: {
          id: "t1",
          name: "Clínica demo",
          hasHoldedKey: false,
          holdedEnabled: false,
          businessType,
        },
      };
    }
    return {};
  }),
  clearTokens: vi.fn(),
  readCurrentRole: () => "OWNER",
  readImpersonationState: () => null,
}));

vi.mock("react-router-dom", async (orig) => {
  const real = await orig<typeof import("react-router-dom")>();
  return { ...real, useNavigate: () => vi.fn() };
});

const { AdminShell } = await import("../src/AdminShell.js");
const { __resetCapacidadesParaTests } = await import("../src/capabilities.js");

let container: HTMLDivElement;
let root: Root;

const COMANDERAS = "/admin/tag-sections";

beforeEach(() => {
  businessType = "SERVICES";
  cajaEnabled = true;
  clinicaEnabled = true;
  fallo = null;
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

async function pintar(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AdminShell title="Ajustes">
          <div />
        </AdminShell>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("clinica-8 (18) · «Comanderas» sólo en hostelería", () => {
  it("en una clínica NO está", async () => {
    businessType = "SERVICES";
    await pintar();
    expect(enlace(COMANDERAS)).toBeNull();
    // Y lo que sí es suyo sigue estando: no se ha vaciado el menú.
    expect(enlace("/admin/staff")).not.toBeNull();
    expect(enlace("/admin/cashiers")).not.toBeNull();
  });

  it("en una barra SÍ, igual que siempre", async () => {
    businessType = "HOSPITALITY";
    await pintar();
    expect(enlace(COMANDERAS)).not.toBeNull();
  });

  it("en una tienda tampoco: no hay comanda que repartir", async () => {
    businessType = "RETAIL";
    await pintar();
    expect(enlace(COMANDERAS)).toBeNull();
  });

  it("mientras no se sabe el vertical, no se pinta", async () => {
    // Una API anterior al campo, o la respuesta que todavía no ha
    // llegado. La salida equivocada de este dato es enseñar de más.
    businessType = undefined;
    await pintar();
    expect(enlace(COMANDERAS)).toBeNull();
  });

  it("y sin caja tampoco, aunque sea hostelería: se imprime desde el TPV", async () => {
    businessType = "HOSPITALITY";
    cajaEnabled = false;
    await pintar();
    expect(enlace(COMANDERAS)).toBeNull();
  });
});

describe("clinica-8 (18) · con la sesión caída el menú no miente", () => {
  it("un 401 apaga caja y Holded en vez de asumirlas", async () => {
    fallo = 401;
    await pintar();
    // Lo que la auditoría vio: «Comanderas» y las secciones de Holded
    // encima de una clínica que no tiene ninguna de las dos.
    expect(enlace(COMANDERAS)).toBeNull();
    expect(enlace("/admin/cashiers")).toBeNull();
    expect(enlace("/admin/holded")).toBeNull();
  });

  it("un fallo de red NORMAL sigue dejando el menú de siempre", async () => {
    // Ésta es la asimetría que hay que conservar: sin red no se puede
    // dejar al panel sin menú, y recargar lo arregla.
    fallo = 500;
    await pintar();
    expect(enlace("/admin/cashiers")).not.toBeNull();
  });
});
