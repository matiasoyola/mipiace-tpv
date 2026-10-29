// pin-1 · LA PANTALLA DEL PIN EN EL TPV.
//
// Lo que se mide aquí es lo que un banco de API no puede ver: qué
// campos hay, a qué ruta va cada modo, y que la repetición se comprueba
// ANTES de mandar nada.
//
// Lo que fija:
//
//   1. **Modo «cambiar»**: tres campos (actual, nuevo, repetir) y va a
//      `/auth/me/pin` con la sesión de cajero.
//   2. **Modo «elegir»** (tras un PIN provisional): DOS campos, sin el
//      actual —acaba de teclearlo y no es suyo— y va a
//      `/shift/cashier-pin` con el token del login.
//   3. **«Guardar» no se enciende** hasta que los dos PIN nuevos son
//      iguales y tienen cuatro cifras. Sin esto, la errata que la
//      repetición existe para cazar llega al servidor y la persona se
//      queda con un PIN que no sabe.
//   4. El mensaje del servidor se pinta tal cual: es el que dice POR QUÉ
//      (el actual falló, el elegido es demasiado fácil y por qué…).
//
// Sabotajes que pone en rojo: pedir el PIN actual en el modo «elegir»
// (atrapa a quien no lo tiene), mandar la petición con los dos PIN
// distintos, o reescribir el mensaje del servidor con un «error».

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  apiWithCashier: vi.fn(),
  apiWithDevice: vi.fn(),
}));

vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    apiWithCashier: apiMock.apiWithCashier,
    apiWithDevice: apiMock.apiWithDevice,
  };
});

import { ApiError } from "../src/api.js";
import { CambiarPinSheet, type ModoPin } from "../src/components/CambiarPinSheet.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const hecho = vi.fn();
const cancelado = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  apiMock.apiWithCashier.mockReset().mockResolvedValue({ ok: true });
  apiMock.apiWithDevice.mockReset().mockResolvedValue({ ok: true });
  hecho.mockReset();
  cancelado.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function pintar(contexto: ModoPin) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CambiarPinSheet
        contexto={contexto}
        nombre="Marta"
        onHecho={hecho}
        onCancelar={cancelado}
      />,
    );
  });
}

/** Los rótulos de los campos que hay en pantalla, en orden. */
function campos(): string[] {
  return [...container.querySelectorAll("button")]
    .map((b) => b.querySelector("div")?.textContent ?? "")
    .filter((t) => t.includes("PIN"));
}

function campo(etiqueta: string): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((x) =>
    x.querySelector("div")?.textContent?.includes(etiqueta),
  );
  if (!b) throw new Error(`sin campo «${etiqueta}»: ${campos().join(" | ")}`);
  return b as HTMLButtonElement;
}

function tecla(n: string): HTMLButtonElement {
  // Exacto y no por subcadena: `pulsar("4")` con un `includes` acabaría
  // pulsando «PIN de 4 cifras».
  const b = [...container.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === n,
  );
  if (!b) throw new Error(`sin tecla ${n}`);
  return b as HTMLButtonElement;
}

const guardar = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="pin-guardar"]')!;

async function teclear(etiqueta: string, pin: string) {
  await act(async () => campo(etiqueta).click());
  for (const d of pin) {
    await act(async () => tecla(d).click());
  }
}

// ── 1 · LOS CAMPOS DE CADA MODO ─────────────────────────────────────

describe("qué campos pide cada modo", () => {
  it("cambiar: actual, nuevo y repetir", async () => {
    await pintar({ modo: "cambiar" });
    expect(campos()).toEqual([
      "PIN actual",
      "PIN nuevo",
      "Repite el PIN nuevo",
    ]);
  });

  it("elegir: SIN el actual — acaba de teclearlo y no es suyo", async () => {
    // El sabotaje: pedir el PIN actual también aquí. Atraparía a quien
    // entra con un PIN prestado que no reconoce como propio… y, peor, a
    // quien lo tecleó mal de memoria.
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    expect(campos()).toEqual(["PIN nuevo", "Repite el PIN nuevo"]);
  });

  it("elegir saluda por su nombre, que es lo que el login manda", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    expect(container.textContent).toContain("Hola Marta");
  });
});

// ── 2 · EL BOTÓN NO SE ENCIENDE A MEDIAS ────────────────────────────

describe("«Guardar» exige los dos PIN nuevos iguales", () => {
  it("apagado al abrir", async () => {
    await pintar({ modo: "cambiar" });
    expect(guardar().disabled).toBe(true);
  });

  it("apagado con los dos nuevos DISTINTOS, y lo dice", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    await teclear("PIN nuevo", "9473");
    await teclear("Repite el PIN nuevo", "9474");
    expect(guardar().disabled).toBe(true);
    expect(
      container.querySelector('[data-testid="pin-no-coinciden"]'),
    ).not.toBeNull();
    // Y no ha salido nada hacia el servidor.
    expect(apiMock.apiWithDevice).not.toHaveBeenCalled();
  });

  it("apagado con menos de cuatro cifras", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    await teclear("PIN nuevo", "947");
    await teclear("Repite el PIN nuevo", "947");
    expect(guardar().disabled).toBe(true);
  });

  it("encendido cuando coinciden y llegan a cuatro", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    await teclear("PIN nuevo", "9473");
    await teclear("Repite el PIN nuevo", "9473");
    expect(guardar().disabled).toBe(false);
  });

  it("en modo cambiar, también hace falta el actual", async () => {
    await pintar({ modo: "cambiar" });
    await teclear("PIN nuevo", "9473");
    await teclear("Repite el PIN nuevo", "9473");
    expect(guardar().disabled).toBe(true);
    await teclear("PIN actual", "5061");
    expect(guardar().disabled).toBe(false);
  });

  it("no pasa de ocho cifras", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    await teclear("PIN nuevo", "123456789");
    expect(campo("PIN nuevo").textContent).toContain("•".repeat(8));
    expect(campo("PIN nuevo").textContent).not.toContain("•".repeat(9));
  });
});

// ── 3 · A DÓNDE VA CADA MODO ────────────────────────────────────────

describe("cada modo llama a su ruta", () => {
  it("cambiar → /auth/me/pin con el actual y el nuevo", async () => {
    await pintar({ modo: "cambiar" });
    await teclear("PIN actual", "5061");
    await teclear("PIN nuevo", "9473");
    await teclear("Repite el PIN nuevo", "9473");
    await act(async () => guardar().click());
    expect(apiMock.apiWithCashier).toHaveBeenCalledWith("/auth/me/pin", {
      method: "POST",
      body: { currentPin: "5061", newPin: "9473" },
    });
    // La repetición NO viaja: es cosa de la pantalla.
    const [, opts] = apiMock.apiWithCashier.mock.calls[0]!;
    expect(Object.keys((opts as { body: object }).body)).toEqual([
      "currentPin",
      "newPin",
    ]);
    expect(hecho).toHaveBeenCalledWith("9473");
  });

  it("elegir → /shift/cashier-pin con el token del login", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok-del-login" });
    await teclear("PIN nuevo", "9473");
    await teclear("Repite el PIN nuevo", "9473");
    await act(async () => guardar().click());
    expect(apiMock.apiWithDevice).toHaveBeenCalledWith("/shift/cashier-pin", {
      method: "POST",
      body: { pendingPinChangeToken: "tok-del-login", newPin: "9473" },
    });
    // Y devuelve el PIN elegido, que es con lo que el llamante reintenta
    // el login sin volver a pedir nada.
    expect(hecho).toHaveBeenCalledWith("9473");
  });
});

// ── 4 · EL MENSAJE DEL SERVIDOR ─────────────────────────────────────

describe("lo que el servidor contesta se pinta tal cual", () => {
  it("el porqué del PIN demasiado fácil llega a la pantalla", async () => {
    const mensaje =
      "Ese PIN es demasiado fácil de adivinar: son cifras seguidas. Elige otro — con cinco intentos antes del bloqueo, un PIN así se acierta a la primera.";
    apiMock.apiWithDevice.mockRejectedValue(
      new ApiError(400, mensaje, "PIN_DEMASIADO_FACIL", {}),
    );
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    await teclear("PIN nuevo", "1234");
    await teclear("Repite el PIN nuevo", "1234");
    await act(async () => guardar().click());
    const aviso = container.querySelector('[data-testid="pin-error"]')!;
    expect(aviso.textContent).toContain("son cifras seguidas");
    expect(hecho).not.toHaveBeenCalled();
  });

  it("y los intentos que quedan del PIN actual, igual", async () => {
    apiMock.apiWithCashier.mockRejectedValue(
      new ApiError(401, "El PIN actual no es correcto.", "PIN_ACTUAL_INCORRECTO", {
        attemptsRemaining: 3,
      }),
    );
    await pintar({ modo: "cambiar" });
    await teclear("PIN actual", "0000");
    await teclear("PIN nuevo", "9473");
    await teclear("Repite el PIN nuevo", "9473");
    await act(async () => guardar().click());
    expect(
      container.querySelector('[data-testid="pin-error"]')!.textContent,
    ).toContain("El PIN actual no es correcto");
    // El PIN actual se borra para volver a teclearlo; lo que ya estaba
    // bien no se pierde.
    expect(campo("PIN actual").textContent).not.toContain("•");
    expect(campo("PIN nuevo").textContent).toContain("•".repeat(4));
  });
});

// ── 5 · LA SALIDA ───────────────────────────────────────────────────

describe("siempre hay salida", () => {
  it("en modo elegir, vuelve al inicio de sesión", async () => {
    await pintar({ modo: "elegir", pendingPinChangeToken: "tok" });
    const salir = container.querySelector<HTMLButtonElement>(
      '[data-testid="pin-cancelar"]',
    )!;
    expect(salir.textContent).toContain("Volver al inicio de sesión");
    await act(async () => salir.click());
    expect(cancelado).toHaveBeenCalled();
  });

  it("los dos botones de abajo son de bloque, no comparten línea", async () => {
    // Un `<button>` es inline: dos seguidos salen en la misma fila y
    // jsdom no lo ve. Los dos llevan `w-full`.
    await pintar({ modo: "cambiar" });
    expect(guardar().className).toContain("w-full");
    expect(
      container.querySelector('[data-testid="pin-cancelar"]')!.className,
    ).toContain("w-full");
  });
});
