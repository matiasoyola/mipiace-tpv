// catalogo-en-alta · el panel «Modo prueba» de la ficha del tenant.
//
// Lo que se fija aquí es lo que destrabó el alta de La Maestranza:
//
//   El botón «Probar TPV» estaba `disabled` mientras
//   `testCashierProvisioned` fuera false, y ese flag lo encendía SÓLO el
//   worker del sync inicial. En un comercio sin Holded el sync está en
//   NOT_APPLICABLE y no corre nunca, así que el botón que provisiona el
//   cajero técnico estaba cerrado con la llave que sólo él puede
//   fabricar — y `test-cashier-provisioned` bloquea la activación.
//
// Sabotaje: devolver el `|| !h.testCashierProvisioned` al `disabled`. El
// primer test se pone rojo.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { TestPanel } = await import("../src/superadmin/TenantDetailPage.js");

function tenant(over: {
  provisionado: boolean;
  holdedPrevisto: boolean;
}): never {
  return {
    id: "t-1",
    onboardingHealth: {
      testCashierProvisioned: over.provisionado,
      ticketsTest: { total: 0, lastAt: null },
      holded: { enabled: over.holdedPrevisto, connected: false },
    },
  } as never;
}

let container: HTMLDivElement;
let root: Root;
let pulsado = 0;

async function render(t: unknown): Promise<void> {
  await act(async () => {
    root.render(
      <TestPanel tenant={t as never} busy={false} onTestTpv={() => { pulsado += 1; }} />,
    );
  });
}

function boton(): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("Probar TPV"),
  )!;
}

beforeEach(() => {
  pulsado = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("catalogo-en-alta · modo prueba", () => {
  it("sin cajero técnico todavía, el botón SE PUEDE pulsar", async () => {
    // El endpoint lo provisiona a demanda. Si el botón espera al flag, no
    // se enciende nunca en un comercio sin Holded.
    await render(tenant({ provisionado: false, holdedPrevisto: false }));
    expect(boton().disabled).toBe(false);
    await act(async () => {
      boton().click();
    });
    expect(pulsado).toBe(1);
  });

  it("y sin Holded la nota no habla de un sync que no existe", async () => {
    await render(tenant({ provisionado: false, holdedPrevisto: false }));
    const t = container.textContent ?? "";
    expect(t).toContain("no usa Holded");
    expect(t).toContain("se crea la primera vez que pulses");
    expect(t).not.toContain("Esperando a que el sync inicial termine");
  });

  it("con Holded previsto, la nota sigue nombrando el sync", async () => {
    await render(tenant({ provisionado: false, holdedPrevisto: true }));
    expect(container.textContent).toContain("sync inicial");
  });

  it("una vez provisionado, no hay nota que dar", async () => {
    await render(tenant({ provisionado: true, holdedPrevisto: false }));
    expect(boton().disabled).toBe(false);
    expect(container.textContent).not.toContain("cajero técnico se crea");
  });
});
