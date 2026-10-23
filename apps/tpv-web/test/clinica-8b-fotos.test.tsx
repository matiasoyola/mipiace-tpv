// clinica-8 (fase B, 10) · «SE APUNTA Y SE DISPARA».
//
// Matías, 18-10, sobre la cámara de clinica-4: «elegir la zona antes de
// disparar no es intuitivo». Y la auditoría, en el mismo punto: «el
// disparador parece activo y no lo está; el aviso queda lejos; el botón
// de zona no se distingue; icono gigante de "play" mientras arranca la
// cámara».
//
// Lo que este banco fija:
//
//   1. la cámara abre con la ZONA DE HOY puesta, y lo dice;
//   2. sin ninguna zona marcada se dispara IGUAL, y la zona se elige
//      mirando la foto que se acaba de hacer;
//   3. el disparador bloqueado no parece un disparador, y lo que lo
//      bloquea es lo que de verdad lo impide (no «falta la zona»);
//   4. mientras la cámara arranca hay una capa opaca que tapa el póster
//      de «play» de Android.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  apiWithCashier: vi.fn(),
  apiBlobWithCashier: vi.fn(),
}));
vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    apiWithCashier: apiMock.apiWithCashier,
    apiBlobWithCashier: apiMock.apiBlobWithCashier,
  };
});
vi.mock("../src/platform/camera/CameraPermission.js", () => ({
  ensureCameraPermission: async () => "granted" as const,
}));

import { MAPA_PIE_V1 } from "@mipiacetpv/clinica-sesion";

import { Fotos } from "../src/clinica/Fotos.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PACIENTE = "cl-carmen";
const CITA = "ap-carmen";

const VISTA = {
  fotos: [],
  comparador: [],
  consentimiento: { puede: true, plantillaId: "fotos-clinicas", mensaje: "" },
  mapaVersion: 1,
};

let container: HTMLDivElement;
let root: Root;
let subidas: Array<{ zona: string; jpegBase64: string }>;

beforeEach(() => {
  subidas = [];
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string, init?: any) => {
    if (path.endsWith("/fotos") && init?.method === "POST") {
      subidas.push(init.body);
      return {};
    }
    return VISTA;
  });

  // La cámara del navegador. jsdom no tiene `mediaDevices`, así que se
  // pone una que entrega una pista sin capacidades: ni linterna, ni
  // `getCapabilities`. Es lo que hace un WebView viejo.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop() {} }],
        getVideoTracks: () => [{ stop() {} }],
      }),
      enumerateDevices: async () => [],
    },
  });
  // jsdom no implementa `play()` ni el canvas: los dos se tapan aquí.
  HTMLMediaElement.prototype.play = async () => undefined;
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: () => {},
  })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/jpeg;base64,ZkFLRQ==";

  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function asentar() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function montar(zonasDeHoy: string[]) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Fotos
        clientId={PACIENTE}
        mapa={MAPA_PIE_V1}
        appointmentId={CITA}
        zonasDeHoy={zonasDeHoy}
      />,
    );
  });
  await asentar();
  await pulsar(container.querySelector('[data-test="hacer-foto"]')!);
}

async function pulsar(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await asentar();
}

/** Simula el primer frame del vídeo, que es lo que quita la capa. */
async function llegaElPrimerFrame() {
  const video = container.querySelector("video")!;
  await act(async () => {
    video.dispatchEvent(new Event("loadeddata"));
  });
  await asentar();
}

function texto(): string {
  return container.textContent ?? "";
}

function disparador(): HTMLButtonElement {
  return container.querySelector('[data-test="disparar"]')!;
}

// ── 1 · La zona viene puesta ────────────────────────────────────────

describe("clinica-8 (10) · la zona viene puesta con la de hoy", () => {
  it("abre con la zona marcada en el mapa, y la dice", async () => {
    await montar(["L:h"]);
    expect(texto()).toContain("Zona: Pie izq. · Dedo gordo");
    expect(
      container
        .querySelector('[data-test="zona-L:h"]')!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // Y ya no hay orden de elegir antes: eso es lo que el prompt quita.
    expect(texto()).not.toContain("Elige antes de disparar");
    expect(texto()).not.toContain("Elige la zona para poder disparar");
  });

  it("con varias marcadas se queda con la primera, y se puede cambiar", async () => {
    await montar(["L:h", "R:h"]);
    expect(texto()).toContain("Zona: Pie izq. · Dedo gordo");
    await pulsar(container.querySelector('[data-test="zona-R:h"]')!);
    expect(texto()).toContain("Zona: Pie der. · Dedo gordo");
  });

  it("con la zona puesta, el disparo guarda y no pregunta nada", async () => {
    await montar(["L:h"]);
    await llegaElPrimerFrame();
    await pulsar(disparador());
    expect(subidas).toEqual([{ zona: "L:h", jpegBase64: "ZkFLRQ==" }]);
    // No ha habido pantalla intermedia.
    expect(
      container.querySelector('[data-test="camara-zona-despues"]'),
    ).toBeNull();
  });
});

// ── 2 · Sin zona, se dispara igual y se elige DESPUÉS ───────────────

describe("clinica-8 (10) · sin zona marcada, la zona se elige después", () => {
  it("el disparador NO está bloqueado por no haber zona", async () => {
    await montar([]);
    await llegaElPrimerFrame();
    expect(disparador().disabled).toBe(false);
    expect(texto()).toContain("Dispara y luego eliges de qué zona es");
  });

  it("dispara, SE QUEDA la foto, y nada se ha guardado todavía", async () => {
    await montar([]);
    await llegaElPrimerFrame();
    await pulsar(disparador());
    // Nada en el servidor: una foto sin zona no entra en la historia.
    expect(subidas).toEqual([]);
    const hoja = container.querySelector('[data-test="camara-zona-despues"]');
    expect(hoja).not.toBeNull();
    expect(texto()).toContain("¿De qué zona es esta foto?");
    expect(texto()).toContain("Todavía no está guardada");
    // Y se enseña LA FOTO, que es lo que hay que mirar para contestar.
    const img = hoja!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,ZkFLRQ==");
  });

  it("tocar la zona guarda ESA foto con ESA zona", async () => {
    await montar([]);
    await llegaElPrimerFrame();
    await pulsar(disparador());
    await pulsar(
      container.querySelector('[data-test="zona-despues-R:d2"]')!,
    );
    expect(subidas).toEqual([{ zona: "R:d2", jpegBase64: "ZkFLRQ==" }]);
  });

  it("«Repetir la foto» vuelve al visor y suelta la que había", async () => {
    await montar([]);
    await llegaElPrimerFrame();
    await pulsar(disparador());
    await pulsar(container.querySelector('[data-test="repetir-foto"]')!);
    expect(
      container.querySelector('[data-test="camara-zona-despues"]'),
    ).toBeNull();
    expect(container.querySelector('[data-test="camara"]')).not.toBeNull();
    expect(subidas).toEqual([]);
  });
});

// ── 3 · El disparador no finge ──────────────────────────────────────

describe("clinica-8 (10) · el disparador bloqueado no parece un disparador", () => {
  it("mientras la cámara arranca, ni se puede pulsar ni es un círculo blanco", async () => {
    await montar(["L:h"]);
    // Sin el primer frame todavía.
    const b = disparador();
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    // El aspecto: aro punteado, sin relleno. El círculo blanco pleno es
    // el gesto aprendido de cualquier cámara y se toca.
    expect(b.className).toContain("border-dashed");
    expect(b.className).not.toContain("bg-white");
  });

  it("con el primer frame se convierte en el disparador de siempre", async () => {
    await montar(["L:h"]);
    await llegaElPrimerFrame();
    const b = disparador();
    expect(b.disabled).toBe(false);
    expect(b.className).toContain("bg-white");
    expect(b.className).not.toContain("border-dashed");
  });
});

// ── 4 · La capa que tapa el póster de «play» de Android ─────────────

describe("clinica-8 (10) · el póster de «play» no se ve", () => {
  it("mientras no hay frame, hay una capa OPACA encima y no recibe toques", async () => {
    await montar(["L:h"]);
    const capa = container.querySelector('[data-test="camara-arrancando"]');
    expect(capa).not.toBeNull();
    // Opaca: un velo translúcido deja ver el triángulo gigante debajo.
    expect(capa!.className).toContain("bg-black");
    expect(capa!.className).not.toContain("bg-black/");
    // Y sin tocar: el dedo que caiga ahí no puede hacer nada.
    expect(capa!.className).toContain("pointer-events-none");
  });

  it("y se va con el primer frame", async () => {
    await montar(["L:h"]);
    await llegaElPrimerFrame();
    expect(
      container.querySelector('[data-test="camara-arrancando"]'),
    ).toBeNull();
  });
});
