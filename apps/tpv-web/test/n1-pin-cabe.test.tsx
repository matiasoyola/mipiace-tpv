// n1-vertical · la pantalla de PIN cabe, y el aviso de PIN incorrecto se
// ve donde el cajero está mirando.
//
// En el N1 (viewport de 360×648) las dos tarjetas apiladas suman ~860 px:
// la fila del 0 salía cortada, había que bajar para llegar a «Entrar», y
// el aviso de PIN incorrecto —que vivía DEBAJO del botón— no se veía
// nunca (punto 8 de la pasada del 2026-10-16). En apaisado (720×360) no
// hay reparto en columna que valga.
//
// Lo que fija este banco:
//
//   1. En compacto la pantalla son DOS PASOS: cajero y luego PIN. Elegir
//      un cajero reciente lleva al teclado, y el teclado entero (diez
//      dígitos, borrar y «Entrar») está a la vista en ese paso.
//   2. El paso es estado explícito, no «¿hay email?»: teclear la primera
//      letra de un email NO se lleva la tarjeta del cajero por delante.
//   3. El AVISO (bloqueo, intentos restantes y error) se pinta ARRIBA,
//      pegado a los puntos del PIN y ANTES del teclado y de «Entrar». El
//      sitio donde estaba era el único de la pantalla que no se veía.
//   4. A 720×360 la tarjeta declara el reparto en dos columnas por debajo
//      de 560 px de alto, con el teclado a la izquierda y el estado y
//      «Entrar» a la derecha.
//   5. En los terminales de 10" y 15" (≥ md) NO hay pasos: las dos
//      tarjetas se pintan en paralelo, como hasta hoy.
//
// Qué se mira y qué no: jsdom no aplica hojas de estilo ni evalúa media
// queries, así que aquí no se puede medir si algo queda dentro de la
// pantalla — `getBoundingClientRect` devuelve ceros. Lo que se fija es lo
// que se rompió (qué se monta en cada paso y en qué orden), y la medida
// de verdad a 360×640 y 720×360 está en la pasada del bloque
// (`docs/blocks/n1-vertical-done.md`), con el navegador y en el aparato.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · el aviso vuelve debajo de «Entrar»
//   · el paso compacto se deriva de `activeEmail` en vez de ser estado
//   · la tarjeta del PIN deja de pintarse al elegir cajero
//   · las tarjetas se esconden también en `md` (rompería el AP11)

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithDevice: vi.fn() }));
const storageMock = vi.hoisted(() => ({
  recientes: [] as Array<{
    email: string;
    alias: string | null;
    initials: string;
    lastSeenAt: string;
  }>,
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithDevice: apiMock.apiWithDevice };
});
vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>(
    "../src/storage.js",
  );
  return {
    ...actual,
    getRecentCashiers: () => storageMock.recientes,
    rememberCashier: vi.fn(),
    setCashierSession: vi.fn(),
  };
});
vi.mock("../src/lib/catalog.js", () => ({ setCachedEnsayo: vi.fn() }));
vi.mock("../src/lib/offlineSession.js", () => ({
  offlineLogin: vi.fn(async () => ({ ok: false, reason: "no_bundle" })),
}));

import { ApiError } from "../src/api.js";
import { PinScreen } from "../src/pages/PinScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Declara el tamaño de la ventana. Documenta el caso que se prueba. */
function declaraPantalla(w: number, h: number): void {
  for (const [k, v] of [
    ["innerWidth", w],
    ["innerHeight", h],
  ] as const) {
    Object.defineProperty(window, k, {
      writable: true,
      configurable: true,
      value: v,
    });
  }
}

beforeEach(() => {
  apiMock.apiWithDevice.mockReset();
  storageMock.recientes = [
    {
      email: "sole@tienda.es",
      alias: "Sole",
      initials: "SO",
      lastSeenAt: new Date("2026-10-16T09:00:00Z").toISOString(),
    },
  ];
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderPin() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PinScreen
        registerName="Caja 1"
        onLoggedIn={vi.fn()}
        onDeviceRevoked={vi.fn()}
      />,
    );
  });
  await settle();
}

const tarjetaCajeros = () =>
  container.querySelector<HTMLElement>('[data-testid="pin-cajeros"]')!;
const tarjetaTeclado = () =>
  container.querySelector<HTMLElement>('[data-testid="pin-teclado"]')!;
const aviso = () =>
  container.querySelector<HTMLElement>('[data-testid="pin-aviso"]');

function boton(texto: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find(
    (n) => (n.textContent ?? "").trim() === texto,
  );
  if (!b) throw new Error(`no encuentro el botón «${texto}»`);
  return b as HTMLButtonElement;
}

/** El contenedor de los dígitos: el padre del «5». */
const rejillaDelTeclado = () => boton("5").parentElement!;

/** La fila de Sole en «Cajeros recientes». */
function cajeroReciente(): HTMLButtonElement {
  const b = Array.from(tarjetaCajeros().querySelectorAll("button")).find((n) =>
    (n.textContent ?? "").includes("Sole"),
  );
  if (!b) throw new Error("no encuentro a Sole en los cajeros recientes");
  return b as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => (el as HTMLButtonElement).click());
  await settle();
}

async function tecleaPin(pin: string) {
  for (const d of pin) await click(boton(d));
}

/** ¿`a` va antes que `b` en el documento? */
function vaAntes(a: Node, b: Node): boolean {
  return (
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

/** ¿Oculta en compacto (`hidden` sin anular) pero puesta en `md`? */
function ocultaSoloEnCompacto(el: HTMLElement): boolean {
  const c = el.classList;
  return (
    c.contains("hidden") && (c.contains("md:block") || c.contains("md:grid"))
  );
}

describe("n1-vertical · PIN a 360×640 (el N1 en vertical)", () => {
  beforeEach(() => declaraPantalla(360, 640));

  it("arranca en el paso del cajero, con el teclado fuera", async () => {
    await renderPin();
    expect(ocultaSoloEnCompacto(tarjetaCajeros())).toBe(false);
    expect(ocultaSoloEnCompacto(tarjetaTeclado())).toBe(true);
  });

  it("elegir un cajero reciente lleva al teclado, entero", async () => {
    await renderPin();
    await click(cajeroReciente());

    expect(ocultaSoloEnCompacto(tarjetaTeclado())).toBe(false);
    expect(ocultaSoloEnCompacto(tarjetaCajeros())).toBe(true);
    // Los diez dígitos, borrar y «Entrar», todos en la tarjeta visible.
    for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
      expect(tarjetaTeclado().contains(boton(d))).toBe(true);
    }
    expect(tarjetaTeclado().contains(boton("Borrar"))).toBe(true);
    expect(tarjetaTeclado().contains(boton("Entrar"))).toBe(true);
  });

  it("«Cambiar de cajero» tiene el área táctil de la casa (44 px)", async () => {
    // Medido en el N1 con Sirope el 2026-10-18: 107 × 19 px. Es el único
    // camino de vuelta si te equivocas de cajero, y se falla con prisa.
    // jsdom no calcula layout, así que lo que se fija es la clase que da
    // los 44 px (`min-h-11`); la medida real está en el `-done`.
    await renderPin();
    await click(cajeroReciente());
    const volver = container.querySelector<HTMLElement>(
      '[data-testid="pin-cambiar-cajero"]',
    )!;
    expect(volver.className).toContain("min-h-11");
    // Y sigue centrado y con pinta de enlace: lo que crece es la caja.
    expect(volver.className).toContain("inline-flex");
    expect(volver.className).toContain("underline");
  });

  it("se puede volver al cajero sin recargar", async () => {
    await renderPin();
    await click(cajeroReciente());
    await click(boton("Cambiar de cajero"));
    expect(ocultaSoloEnCompacto(tarjetaCajeros())).toBe(false);
    expect(ocultaSoloEnCompacto(tarjetaTeclado())).toBe(true);
  });

  it("teclear un email NO se lleva por delante la tarjeta del cajero", async () => {
    // Con el paso derivado de `activeEmail.length > 0`, la tarjeta
    // desaparecía en la PRIMERA letra: teclado abierto y campo a medias.
    await renderPin();
    const input = container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    await act(async () => {
      input.value = "s";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(ocultaSoloEnCompacto(tarjetaCajeros())).toBe(false);
    // Y hay una puerta explícita al teclado.
    expect(
      container.querySelector('[data-testid="pin-continuar"]'),
    ).not.toBeNull();
  });

  it("la rejilla fija su columna, o un email largo saca la página de la pantalla", async () => {
    // Medido en el N1 el 2026-10-18: sin `grid-cols-1`, la única columna
    // por debajo de `md` es implícita y `auto` (= `max-content`), así que
    // el email del cajero de pruebas estiraba la tarjeta a 561 px y el
    // `scrollWidth` de la página a 581 con una ventana de 360. Con la
    // clase puesta, 360 y 320.
    storageMock.recientes = [
      {
        email: "mipiacetpv-test-64a68dc7@internal.mipiacetpv.tech",
        alias: null,
        initials: "MT",
        lastSeenAt: new Date("2026-10-18T09:00:00Z").toISOString(),
      },
    ];
    await renderPin();
    const rejilla = tarjetaCajeros().parentElement!;
    expect(rejilla.className).toContain("grid-cols-1");
    // Y la de `md` sigue, que es el layout de los terminales grandes.
    expect(rejilla.className).toContain("md:grid-cols-2");
  });

  it("el aviso de PIN incorrecto se pinta ARRIBA, no debajo de «Entrar»", async () => {
    apiMock.apiWithDevice.mockRejectedValue(
      new ApiError(401, "Email o PIN incorrecto", "INVALID_CREDENTIALS", {
        attemptsRemaining: 2,
      }),
    );
    await renderPin();
    await click(cajeroReciente());
    await tecleaPin("1234");
    await click(boton("Entrar"));

    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain("Email o PIN incorrecto");
    expect(a!.textContent).toContain("2");
    // Dentro de la tarjeta del PIN...
    expect(tarjetaTeclado().contains(a!)).toBe(true);
    // ...y por encima del teclado y del botón, que es donde el cajero
    // está mirando cuando acaba de teclear el PIN.
    expect(vaAntes(a!, rejillaDelTeclado())).toBe(true);
    expect(vaAntes(a!, boton("Entrar"))).toBe(true);
  });

  it("cuatro teclas en el MISMO tick cuentan cuatro, no una", async () => {
    // Medido en el N1 el 2026-10-18: cuatro dígitos seguidos dejaban el
    // PIN en UNO —los puntos sin marcar y «Entrar» apagado— porque
    // `pressDigit` leía `pin` del cierre de su render y las cuatro
    // pulsaciones escribían sobre el mismo valor. Un teclado de PIN es
    // justo donde se teclea rápido, y un dígito perdido se paga con un
    // intento de los cinco que hay antes del bloqueo.
    await renderPin();
    await click(cajeroReciente());

    // Las cuatro DENTRO del mismo `act`: ni un render entre medias, que
    // es lo que reproduce el caso.
    await act(async () => {
      for (const d of ["1", "2", "3", "4"]) boton(d).click();
    });
    await settle();

    // Cuatro puntos marcados y «Entrar» encendido.
    expect(
      container.querySelectorAll(".bg-mipiace-coral.rounded-full"),
    ).toHaveLength(4);
    expect(boton("Entrar").disabled).toBe(false);
  });

  it("el tope de 8 dígitos aguanta aunque lleguen de golpe", async () => {
    await renderPin();
    await click(cajeroReciente());
    await act(async () => {
      for (const d of "1234567890") boton(d).click();
    });
    await settle();
    // Se ve el PIN para poder contarlo: el toggle del ojo.
    await click(container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mostrar PIN"]',
    )!);
    const puntos = container.querySelector<HTMLElement>(".tracking-\\[0\\.35em\\]");
    expect((puntos?.textContent ?? "").length).toBe(8);
  });

  it("el PRIMER PIN mal ya avisa, aunque queden 4 intentos", async () => {
    // El backend contesta `attemptsRemaining: 4` en el primer fallo. Con la
    // condición de antes (`<= 3`) no se pintaba nada: el PIN se borraba solo
    // y el cajero no sabía si había fallado él o la máquina. Es lo que la
    // pasada del N1 anotó como «el aviso de error no se veía».
    apiMock.apiWithDevice.mockRejectedValue(
      new ApiError(401, "Email o PIN incorrectos", "INVALID_CREDENTIALS", {
        attemptsRemaining: 4,
      }),
    );
    await renderPin();
    await click(cajeroReciente());
    await tecleaPin("1234");
    await click(boton("Entrar"));

    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain("Email o PIN incorrecto");
    expect(a!.textContent).toContain("4");
    expect(vaAntes(a!, rejillaDelTeclado())).toBe(true);
  });

  it("el error plano (sin intentos restantes) también se ve arriba", async () => {
    apiMock.apiWithDevice.mockRejectedValue(
      new ApiError(401, "Cajero no encontrado", "INVALID_CREDENTIALS", null),
    );
    await renderPin();
    await click(cajeroReciente());
    await tecleaPin("1234");
    await click(boton("Entrar"));

    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain("Cajero no encontrado");
    expect(vaAntes(a!, boton("Entrar"))).toBe(true);
  });

  it("el bloqueo por intentos también, y sin perder el teclado", async () => {
    apiMock.apiWithDevice.mockRejectedValue(
      new ApiError(429, "Demasiados intentos", "RATE_LIMITED", {
        retryAfterSeconds: 900,
      }),
    );
    await renderPin();
    await click(cajeroReciente());
    await tecleaPin("1234");
    await click(boton("Entrar"));

    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain("Cuenta bloqueada");
    expect(vaAntes(a!, rejillaDelTeclado())).toBe(true);
  });
});

describe("n1-vertical · PIN a 720×360 (el N1 en apaisado)", () => {
  beforeEach(() => declaraPantalla(720, 360));

  it("la tarjeta del PIN declara dos columnas por debajo de 560 px de alto", async () => {
    await renderPin();
    const clases = tarjetaTeclado().className;
    // Teclado a la izquierda, estado y «Entrar» a la derecha: con 360 px
    // de alto no hay reparto en columna que quepa.
    expect(clases).toContain(
      "[@media(max-height:560px)]:grid-cols-[auto_minmax(0,1fr)]",
    );
    // Y es `grid` SIEMPRE, no `flex` que cambia a `grid` dentro de la
    // media query: cambiar de `display` ahí es lo que movería el layout
    // de los terminales grandes.
    expect(clases).toContain("grid");
    expect(clases).not.toContain("flex-col");
  });

  it("el teclado ocupa la columna izquierda y «Entrar» la celda de abajo", async () => {
    await renderPin();
    await click(cajeroReciente());
    const rejilla = rejillaDelTeclado().className;
    expect(rejilla).toContain("[@media(max-height:560px)]:col-start-1");
    expect(rejilla).toContain("[@media(max-height:560px)]:row-span-2");
    const entrar = boton("Entrar").className;
    expect(entrar).toContain("[@media(max-height:560px)]:col-start-2");
    expect(entrar).toContain("[@media(max-height:560px)]:row-start-2");
  });

  it("las teclas se achatan pero siguen siendo tocables (44 px)", async () => {
    await renderPin();
    await click(cajeroReciente());
    // h-11 = 44 px, el mínimo de objetivo táctil que cumple el resto del
    // TPV. Si alguien baja esto, los dedos empiezan a fallar.
    expect(boton("5").className).toContain("[@media(max-height:560px)]:h-11");
    expect(boton("0").className).toContain("[@media(max-height:560px)]:h-11");
  });
});

describe("n1-vertical · los terminales de 10\" y 15\" no cambian", () => {
  beforeEach(() => declaraPantalla(1280, 800));

  it("la tarjeta que el paso esconde sigue puesta en `md`", async () => {
    await renderPin();
    // Paso «cajero»: el teclado se oculta en compacto, pero en un AP11
    // está puesto. Si faltara la anulación, quince terminales perderían
    // el teclado de PIN de golpe.
    expect(tarjetaTeclado().className).toContain("hidden");
    expect(tarjetaTeclado().className).toContain("md:grid");

    await click(cajeroReciente());
    // Paso «pin»: ahora la de cajeros, con la misma anulación.
    expect(tarjetaCajeros().className).toContain("hidden");
    expect(tarjetaCajeros().className).toContain("md:block");
  });

  it("el botón «Continuar» del paso compacto no se ve en `md`", async () => {
    await renderPin();
    const continuar = container.querySelector<HTMLElement>(
      '[data-testid="pin-continuar"]',
    );
    expect(continuar).not.toBeNull();
    expect(continuar!.className).toContain("md:hidden");
  });
});
