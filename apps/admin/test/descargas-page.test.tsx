// A3-distribucion · Frente 5 · consola de descargas.
//
// Lo que importa aqui no es el maquetado: es que el codigo se pueda dictar por
// telefono (grande y completo), que la caducidad se vea, y que la pantalla no
// invente versiones cuando no hay ninguna publicada.
//
// Mismo patron sin testing-library que el resto del repo: createRoot + act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ superApi: vi.fn() }));

vi.mock("../src/superadmin/api.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/superadmin/api.js")
  >("../src/superadmin/api.js");
  return { ...actual, superApi: apiMock.superApi };
});

// El shell arrastra la sesion y la nav; aqui sobra.
vi.mock("../src/superadmin/SuperAdminShell.js", () => ({
  SuperAdminShell: ({ children }: { children: unknown }) => children,
}));

import { DescargasPage } from "../src/superadmin/DescargasPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SHA = "a".repeat(64);

const RELEASES = {
  releases: [
    {
      versionCode: 11002,
      versionName: "1.10.2",
      fileName: "mipiacetpv-1.10.2-11002.apk",
      sha256: SHA,
      size: 12 * 1024 * 1024,
      publishedAt: "2026-08-27T10:00:00.000Z",
      gitSha: "7774c51",
    },
  ],
  activeCodes: [
    {
      code: "482913",
      versionCode: 11002,
      createdAt: "2026-08-27T10:00:00.000Z",
      expiresAt: new Date(Date.now() + 42 * 60_000).toISOString(),
      maxDownloads: 3,
      downloadCount: 1,
      note: "Thalia, terminal barra",
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiMock.superApi.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <DescargasPage />
      </MemoryRouter>,
    );
  });
  // Deja resolver la carga inicial.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("DescargasPage", () => {
  it("pide la lista al endpoint con guion (/super-admin/releases)", async () => {
    apiMock.superApi.mockResolvedValue(RELEASES);
    await render();
    expect(apiMock.superApi).toHaveBeenCalledWith("/super-admin/releases");
  });

  it("pinta version, versionCode, tamano, commit y el SHA-256 entero", async () => {
    apiMock.superApi.mockResolvedValue(RELEASES);
    await render();
    const texto = container.textContent ?? "";
    expect(texto).toContain("1.10.2");
    expect(texto).toContain("11002");
    expect(texto).toContain("12.0 MB");
    expect(texto).toContain("7774c51");
    // El SHA se coteja caracter a caracter contra el del terminal: no vale
    // truncarlo con puntos suspensivos.
    expect(texto).toContain(SHA);
  });

  it("lista los codigos activos con su cuenta atras y las descargas gastadas", async () => {
    apiMock.superApi.mockResolvedValue(RELEASES);
    await render();
    const texto = container.textContent ?? "";
    expect(texto).toContain("482913");
    expect(texto).toContain("42 min");
    expect(texto).toContain("1 / 3");
    expect(texto).toContain("Thalia, terminal barra");
  });

  it("sin versiones publicadas lo dice, y no inventa filas", async () => {
    apiMock.superApi.mockResolvedValue({ releases: [], activeCodes: [] });
    await render();
    const texto = container.textContent ?? "";
    expect(texto).toContain("No hay ninguna versión publicada");
    expect(texto).toContain("publicar-apk.sh");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("un fallo de la API se dice, no se traga", async () => {
    apiMock.superApi.mockRejectedValue(new Error("boom"));
    await render();
    expect(container.textContent ?? "").toContain(
      "No se pudieron cargar las versiones publicadas",
    );
  });

  it("generar codigo llama al endpoint de la version y lo enseña grande", async () => {
    apiMock.superApi.mockImplementation(async (path: string) => {
      if (path === "/super-admin/releases") return RELEASES;
      return {
        code: "719204",
        versionCode: 11002,
        versionName: "1.10.2",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        maxDownloads: 3,
        note: null,
      };
    });
    await render();

    const boton = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Generar código"),
    );
    expect(boton).toBeTruthy();
    await act(async () => {
      boton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(apiMock.superApi).toHaveBeenCalledWith(
      "/super-admin/releases/11002/download-codes",
      expect.objectContaining({ method: "POST" }),
    );

    // El codigo se dicta por telefono desde un bar con ruido: tiene que salir
    // grande, no como un dato mas de una tabla.
    const grande = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.trim() === "719204",
    );
    expect(grande).toBeTruthy();
    expect(grande!.className).toMatch(/text-5xl/);
  });

  it("la descarga directa apunta al endpoint autenticado de la consola", async () => {
    apiMock.superApi.mockResolvedValue(RELEASES);
    await render();
    const enlace = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Descargar"),
    );
    expect(enlace?.getAttribute("href")).toBe(
      "/api/super-admin/releases/11002/apk",
    );
  });
});

// Los slugs de auditoria nuevos tienen que estar en ACTIONS de AuditLogPage o
// el log los pinta crudos ("apk_download") a quien investigue una descarga.
describe("etiquetas de auditoria", () => {
  it("las acciones de A3 tienen nombre humano", async () => {
    const { actionLabel } = await import("../src/superadmin/AuditLogPage.js");
    expect(actionLabel("apk_download")).toBe("Descarga de la APK");
    expect(actionLabel("create_apk_download_code")).toBe(
      "Generar código de instalación",
    );
  });

  it("un slug desconocido sigue cayendo a si mismo, no a undefined", async () => {
    const { actionLabel } = await import("../src/superadmin/AuditLogPage.js");
    expect(actionLabel("accion_futura")).toBe("accion_futura");
  });
});
