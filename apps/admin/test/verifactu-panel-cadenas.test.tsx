// V1-verifactu · el panel de cadenas del super-admin.
//
// Lo que este banco fija:
//
//   1. Un registro que no encadena SE VE, con su motivo. Guardarlo y no
//      enseñarlo sería la misma ceguera que descartarlo, con más pasos.
//   2. Un comercio con Holded no ve el panel. No tiene cadenas que mirar,
//      y un panel vacío que dice «0 registros» invita a pensar que falla
//      algo.
//   3. Mientras el QR apunte al entorno de pruebas, el panel lo dice. Es
//      lo que impide prometerle a un cliente un cotejo que hoy no existe.
//
// Sabotajes que este fichero pone en rojo:
//   · esconder los registros marcados en vez de listarlos
//   · pintar el panel a un comercio que factura con Holded
//   · quitar el aviso del entorno de pruebas

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let respuesta: unknown = null;
const llamadas: string[] = [];

vi.mock("../src/superadmin/api.js", () => ({
  superApi: async (path: string) => {
    llamadas.push(path);
    return respuesta;
  },
  SuperAdminApiError: class extends Error {},
}));

const { FiscalChainsPanel } = await import("../src/superadmin/TenantDetailPage.js");

const TENANT = "11111111-1111-1111-1111-111111111111";

let container: HTMLDivElement;
let root: Root;

async function pintar(): Promise<void> {
  await act(async () => {
    root.render(<FiscalChainsPanel tenantId={TENANT} />);
  });
}

beforeEach(() => {
  llamadas.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("el comercio que emite sus facturas", () => {
  it("lista sus cadenas y dice cuáles están íntegras", async () => {
    respuesta = {
      emite: true,
      entorno: "PRUEBAS",
      cadenas: [
        {
          registerId: "r1",
          registerName: "Caja 1",
          serie: "C1",
          numeroInstalacion: "inst-1",
          total: 42,
          integra: true,
          primerFalloIndex: null,
          marcadosBroken: 0,
          fallos: [],
        },
      ],
      rotos: [],
    };
    await pintar();
    expect(llamadas).toEqual([`/super-admin/tenants/${TENANT}/fiscal`]);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Caja 1");
    expect(texto).toContain("C1");
    expect(texto).toContain("Íntegra");
    expect(texto).toContain(
      "Ninguno. Todos los registros recibidos encadenaron",
    );
  });

  it("SABOTAJE · un registro que no encadena se VE, con su motivo", async () => {
    respuesta = {
      emite: true,
      entorno: "PRUEBAS",
      cadenas: [
        {
          registerId: "r2",
          registerName: "Caja 2",
          serie: "C2",
          numeroInstalacion: "inst-2",
          total: 3,
          integra: false,
          primerFalloIndex: 2,
          marcadosBroken: 1,
          fallos: [],
        },
      ],
      rotos: [
        {
          id: "f1",
          registerId: "r2",
          chainIndex: 2,
          numSerieFactura: "C2/000002",
          chainError:
            "ENLACE_ROTO: la huella anterior que declara no es la del registro que ocupa la posición de antes en esta caja.",
          generatedAt: "2026-09-24T08:00:00.000Z",
          receivedAt: "2026-09-24T09:00:00.000Z",
        },
      ],
    };
    await pintar();
    const texto = container.textContent ?? "";
    expect(texto).toContain("Rota desde el registro 2");
    expect(texto).toContain("C2/000002");
    expect(texto).toContain("ENLACE_ROTO");
    expect(container.querySelector('[data-testid="fiscal-rotos"]')).not.toBeNull();
  });

  it("y dice que una cadena rota no se arregla sola", async () => {
    respuesta = {
      emite: true,
      entorno: "PRODUCCION",
      cadenas: [
        {
          registerId: "r2",
          registerName: "Caja 2",
          serie: "C2",
          numeroInstalacion: "i",
          total: 3,
          integra: false,
          primerFalloIndex: 2,
          marcadosBroken: 1,
          fallos: [],
        },
      ],
      rotos: [],
    };
    await pintar();
    expect(container.textContent).toContain("no se arregla sola");
  });
});

describe("el aviso del entorno", () => {
  const base = {
    emite: true,
    cadenas: [],
    rotos: [],
  };

  it("SABOTAJE · en PRUEBAS avisa de que el QR no cuadra todavía", async () => {
    respuesta = { ...base, entorno: "PRUEBAS" };
    await pintar();
    expect(
      container.querySelector('[data-testid="fiscal-entorno-pruebas"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("todavía no se remiten");
  });

  it("en PRODUCCION no avisa de nada", async () => {
    respuesta = { ...base, entorno: "PRODUCCION" };
    await pintar();
    expect(
      container.querySelector('[data-testid="fiscal-entorno-pruebas"]'),
    ).toBeNull();
  });
});

describe("el comercio que factura con Holded", () => {
  it("SABOTAJE · no ve el panel", async () => {
    respuesta = { emite: false, entorno: "PRUEBAS", cadenas: [], rotos: [] };
    await pintar();
    expect(
      container.querySelector('[data-testid="fiscal-chains-panel"]'),
    ).toBeNull();
    expect(container.textContent).toBe("");
  });
});
