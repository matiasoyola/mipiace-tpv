// v1.0-pilotos · Lote 4 addendum: re-login in situ ante un 401.
//
// Escenario de producción (Peluquería Sole): la sesión caduca a mitad
// de un checkout. El TPV debe abrir el modal de PIN sin navegar, sin
// perder el carrito ni el checkout, y al validar el PIN reintentar la
// request que falló. Usamos el api.ts REAL (fetch mockeado) + el modal
// real — sólo el harness que los une está simplificado respecto a App.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiWithCashier,
  registerSessionExpiredHandler,
} from "../src/api.js";
import { ReloginPinModal } from "../src/components/ReloginPinModal.js";
import { getCashierSession, setCashierSession, setDeviceToken } from "../src/storage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const OLD_TOKEN = "jwt-caducado";
const NEW_TOKEN = "jwt-fresco";
const PIN = "1234";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// fetch fake con el guion del escenario: el token viejo da 401, el
// cashier-login con PIN correcto emite token nuevo, y con el token
// nuevo el checkout entra.
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
  if (url.endsWith("/shift/cashier-login")) {
    const body = JSON.parse(String(init?.body));
    if (body.pin !== PIN) {
      return jsonResponse(401, {
        error: "INVALID_CREDENTIALS",
        message: "Email o PIN incorrectos",
      });
    }
    return jsonResponse(200, {
      sessionToken: NEW_TOKEN,
      sessionTtlMinutes: 720,
      user: { id: "u1", email: "caja1@bar.es", role: "CASHIER" },
      shiftState: { kind: "active", shift: { id: "s1" } },
    });
  }
  if (url.endsWith("/tickets")) {
    if (auth !== `Bearer ${NEW_TOKEN}`) {
      return jsonResponse(401, {
        error: "UNAUTHENTICATED",
        message: "Sesión inválida o expirada",
      });
    }
    return jsonResponse(201, {
      ticket: { id: "t1", internalNumber: "000123" },
    });
  }
  throw new Error(`fetch inesperado: ${url}`);
});

// Harness mínimo con la misma mecánica que App: carrito en estado
// local, handler de 401 registrado que monta el modal real, y un
// "checkout" que llama a apiWithCashier.
function Harness() {
  const [cart] = useState([{ sku: "CAFE", units: 2 }]);
  const [prompt, setPrompt] = useState<{
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(true);

  useEffect(() => {
    registerSessionExpiredHandler(
      () =>
        new Promise<boolean>((resolve) => {
          setPrompt({ resolve });
        }),
    );
    return () => registerSessionExpiredHandler(null);
  }, []);

  async function checkout() {
    const res = await apiWithCashier<{ ticket: { internalNumber: string } }>(
      "/tickets",
      { method: "POST", body: { lines: cart, payments: [] } },
    );
    setResult(res.ticket.internalNumber);
    setCheckoutOpen(false);
  }

  return (
    <div>
      <div data-testid="cart">{JSON.stringify(cart)}</div>
      <div data-testid="checkout">{checkoutOpen ? "abierto" : "cerrado"}</div>
      {result && <div data-testid="result">{result}</div>}
      <button data-testid="cobrar" onClick={() => void checkout()}>
        Cobrar
      </button>
      {prompt && (
        <ReloginPinModal
          email="caja1@bar.es"
          onDone={(renewed) => {
            prompt.resolve(renewed);
            setPrompt(null);
          }}
        />
      )}
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  localStorage.clear();
  setDeviceToken("device-token-1");
  setCashierSession({
    sessionToken: OLD_TOKEN,
    sessionTtlMinutes: 720,
    userId: "u1",
    email: "caja1@bar.es",
    role: "CASHIER",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  registerSessionExpiredHandler(null);
});

function byTestId(id: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`No existe [data-testid=${id}]`);
  return el as HTMLElement;
}

describe("401 a mitad de checkout → modal PIN → reintento", () => {
  it("flujo completo: 401 → modal sin perder estado → PIN → checkout reintentado OK", async () => {
    await act(async () => {
      root.render(<Harness />);
    });

    // El cajero pulsa Cobrar con el token caducado.
    await act(async () => {
      byTestId("cobrar").click();
    });

    // 401 → aparece el modal de PIN. El checkout sigue abierto y el
    // carrito intacto (nada navegó ni se desmontó).
    expect(container.textContent).toContain("Sesión caducada");
    expect(container.textContent).toContain("caja1@bar.es");
    expect(byTestId("checkout").textContent).toBe("abierto");
    expect(byTestId("cart").textContent).toContain("CAFE");

    // Teclea el PIN y continúa.
    const pinInput = container.querySelector(
      'input[aria-label="PIN del cajero"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(pinInput, PIN);
      pinInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const continuar = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Continuar"),
    )!;
    await act(async () => {
      continuar.click();
    });

    // La sesión se renovó, la request original se reintentó con el
    // token nuevo y el checkout terminó — mismo carrito, sin re-tap.
    expect(getCashierSession()?.sessionToken).toBe(NEW_TOKEN);
    expect(byTestId("result").textContent).toBe("000123");
    expect(byTestId("checkout").textContent).toBe("cerrado");
    expect(container.textContent).not.toContain("Sesión caducada");

    // 3 llamadas: checkout (401) → login → checkout (201).
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.endsWith("/tickets"))).toHaveLength(2);
    expect(urls.filter((u) => u.endsWith("/shift/cashier-login"))).toHaveLength(1);
  });

  it("PIN incorrecto: el modal muestra el error y permite reintentar sin perder el flujo", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      byTestId("cobrar").click();
    });
    expect(container.textContent).toContain("Sesión caducada");

    const pinInput = container.querySelector(
      'input[aria-label="PIN del cajero"]',
    ) as HTMLInputElement;
    const typePin = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(pinInput, value);
        pinInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const clickContinuar = async () => {
      const btn = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Continuar"),
      )!;
      await act(async () => {
        btn.click();
      });
    };

    await typePin("9999");
    await clickContinuar();
    expect(container.textContent).toContain("Email o PIN incorrectos");
    expect(byTestId("checkout").textContent).toBe("abierto");

    // Segundo intento con el PIN bueno → todo fluye.
    await typePin(PIN);
    await clickContinuar();
    expect(byTestId("result").textContent).toBe("000123");
  });

  it("cancelar el modal propaga el 401 original (la acción falla limpiamente)", async () => {
    let captured: unknown = null;
    function CancelHarness() {
      const [prompt, setPrompt] = useState<{
        resolve: (ok: boolean) => void;
      } | null>(null);
      useEffect(() => {
        registerSessionExpiredHandler(
          () =>
            new Promise<boolean>((resolve) => {
              setPrompt({ resolve });
            }),
        );
        return () => registerSessionExpiredHandler(null);
      }, []);
      return (
        <div>
          <button
            data-testid="cobrar"
            onClick={() => {
              apiWithCashier("/tickets", { method: "POST", body: {} }).catch(
                (err) => {
                  captured = err;
                },
              );
            }}
          >
            Cobrar
          </button>
          {prompt && (
            <ReloginPinModal
              email="caja1@bar.es"
              onDone={(renewed) => {
                prompt.resolve(renewed);
                setPrompt(null);
              }}
            />
          )}
        </div>
      );
    }
    await act(async () => {
      root.render(<CancelHarness />);
    });
    await act(async () => {
      byTestId("cobrar").click();
    });
    const cancelar = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Cancelar"),
    )!;
    await act(async () => {
      cancelar.click();
    });
    expect(captured).toBeTruthy();
    expect((captured as { status: number }).status).toBe(401);
  });
});
