// auditoria-sirope (#19) · «Comanderas» lista las etiquetas de verdad.
//
// La página pedía teclear «el slug de Holded»: un dato que la cuenta de
// Sirope no tiene, y que mal tecleado no da error —manda los platos a
// Salón en silencio—. El 18-10 la primera comanda de la T6 se perdió así.
//
// Sabotaje: volver al campo de texto libre. El primer test se queda sin
// los botones por etiqueta.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    api: apiMock.api,
    readEffectiveAuth: () => ({ canEdit: true, impersonating: false }),
  };
});
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: unknown }) => children as never,
  useLocation: () => ({ pathname: "/admin/tag-sections" }),
}));
vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children?: unknown }) => children as never,
}));

const { TagSectionsPage } = await import("../src/pages/TagSectionsPage.js");

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** El catálogo de Sirope tal como estaba el 18-10, a medio mapear. */
const ETIQUETAS = [
  { slug: "bolleria", productCount: 4, section: null, mapeoId: null },
  { slug: "cafe", productCount: 9, section: "BARRA", mapeoId: "m-cafe" },
  { slug: "tostadas", productCount: 6, section: "COCINA", mapeoId: "m-tos" },
];

let container: HTMLDivElement;
let root: Root;
const guardados: Array<{ slug: string; section: string }> = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  guardados.length = 0;
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, o?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === "/admin/tag-sections/etiquetas") {
        return { etiquetas: ETIQUETAS, sinSeccion: 1 };
      }
      if (path === "/admin/tag-sections" && o?.method === "POST") {
        guardados.push({
          slug: String(o.body!.slug),
          section: String(o.body!.section),
        });
        return {
          tagSection: { id: "m-nuevo", slug: o.body!.slug, section: o.body!.section },
        };
      }
      throw new Error(`ruta inesperada: ${path}`);
    },
  );
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<TagSectionsPage />);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);

describe("#19 · Comanderas lista las etiquetas del catálogo", () => {
  it("pinta una fila por etiqueta, con sus tres secciones", async () => {
    await render();
    for (const e of ETIQUETAS) {
      expect($(`[data-testid="etiqueta-${e.slug}"]`)).not.toBeNull();
      expect($(`[data-testid="etiqueta-${e.slug}-COCINA"]`)).not.toBeNull();
    }
  });

  it("ya no pide «el slug de Holded»", async () => {
    await render();
    // Sirope no usa Holded: la palabra no puede aparecer en esta página.
    expect(container.textContent).not.toMatch(/Holded/i);
    // Y no hay campo de texto libre donde teclearla mal.
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(0);
  });

  it("avisa de las etiquetas sin sección y las nombra", async () => {
    await render();
    const aviso = $('[data-testid="aviso-sin-seccion"]');
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toMatch(/1 etiqueta sin sección/i);
    expect(aviso!.textContent).toMatch(/bolleria/);
  });

  it("un toque asigna la sección, sin teclear nada", async () => {
    await render();
    await act(async () => {
      $<HTMLButtonElement>('[data-testid="etiqueta-bolleria-BARRA"]')!.click();
    });
    expect(guardados).toEqual([{ slug: "bolleria", section: "BARRA" }]);
  });

  it("la etiqueta mapeada marca su sección", async () => {
    await render();
    expect(
      $('[data-testid="etiqueta-cafe-BARRA"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      $('[data-testid="etiqueta-cafe-COCINA"]')!.getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
