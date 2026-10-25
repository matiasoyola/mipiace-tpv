// contrato-lectura-completa · **EL TPV TAMPOCO ACEPTA SIN RECORRER EL
// TEXTO.**
//
// El contrato se acepta desde dos sitios: el panel y esta pantalla del
// TPV (la dueña de una clínica, con la tablet en la mano). La API da 400 a
// una aceptación que no traiga `textoMostradoCompleto`, así que si esta
// pantalla no lo manda, la dueña se queda con un botón que da error — que
// es exactamente lo que no puede pasar con la paciente delante.
//
// ── Por qué este fichero y no el banco de clinica-7 ─────────────────
//
// `clinica-7-pantallas.test.tsx` monta esta misma pantalla y sigue verde
// con la puerta puesta, **y tiene que seguir verde**: jsdom no trae
// `IntersectionObserver`, y la pantalla cuenta «sin observador» como
// «visto» a propósito (si no, con el observador caído nadie podría aceptar
// nunca el contrato). O sea: aquel banco NO EJERCITA la puerta.
//
// Éste la ejercita porque instala el observador. Sin instalarlo, los dos
// tests de abajo pasarían en verde con la puerta arrancada.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTRATO_VIGENTE, VERSION_VIGENTE } from "@mipiacetpv/contrato-encargado";

// ── El observador, a mano ───────────────────────────────────────────

interface Observado {
  cb: (entradas: { isIntersecting: boolean }[]) => void;
  vivo: boolean;
}
const observadores: Observado[] = [];

class ObservadorFalso {
  private yo: Observado;
  constructor(cb: (entradas: { isIntersecting: boolean }[]) => void) {
    this.yo = { cb, vivo: true };
    observadores.push(this.yo);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.yo.vivo = false;
  }
}

async function verElFinal(): Promise<void> {
  await act(async () => {
    for (const o of observadores) if (o.vivo) o.cb([{ isIntersecting: true }]);
  });
}

// ── El doble de la API ──────────────────────────────────────────────

const llamadas: Array<{ path: string; body?: unknown }> = [];

class ApiErrorFake extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

vi.mock("../src/api.js", () => ({
  ApiError: ApiErrorFake,
  apiWithCashier: vi.fn(async (path: string, opts?: { body?: unknown }) => {
    llamadas.push({ path, body: opts?.body });
    return {};
  }),
  apiBlobWithCashier: vi.fn(async () => ({
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
    headers: new Headers(),
  })),
  apiBlobPublic: vi.fn(async () => ({
    blob: new Blob(),
    headers: new Headers(),
  })),
  apiPublic: vi.fn(async () => ({})),
}));

const { PantallaDeAceptacion } = await import(
  "../src/clinica/ContratoDeTratamiento.js"
);

let host: HTMLDivElement;
let root: Root;

function vistaSinContrato() {
  return {
    estado: { estado: "SIN_CONTRATO" },
    versionVigente: VERSION_VIGENTE,
    pendienteDeValidar: CONTRATO_VIGENTE.pendienteDeValidar,
    titulo: CONTRATO_VIGENTE.titulo,
    apartados: CONTRATO_VIGENTE.apartados,
    huellaVigente: "a".repeat(64),
    aceptaciones: [],
    puedeAceptar: true,
  } as never;
}

beforeEach(async () => {
  llamadas.length = 0;
  observadores.length = 0;
  (globalThis as Record<string, unknown>).IntersectionObserver = ObservadorFalso;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PantallaDeAceptacion vista={vistaSinContrato()} onAceptado={() => {}} />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
});

const texto = () => host.textContent ?? "";
const casilla = () =>
  host.querySelector('[data-test="contrato-casilla"]') as HTMLInputElement;
const aceptar = () =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Aceptar y activar"),
  ) as HTMLButtonElement;

describe("la pantalla de aceptación del TPV", () => {
  it("nace con la casilla y el botón CERRADOS, y lo dice", async () => {
    expect(casilla().disabled).toBe(true);
    expect(aceptar().disabled).toBe(true);
    expect(texto()).toContain(
      "Baja hasta el final del contrato para poder aceptarlo",
    );
  });

  it("al llegar el final del texto se abren, y el aviso lo anuncia", async () => {
    await verElFinal();
    expect(casilla().disabled).toBe(false);
    const aviso = host.querySelector('[data-test="contrato-aviso-recorrer"]')!;
    expect(aviso.getAttribute("aria-live")).toBe("polite");
    expect(aviso.textContent).toContain("Has llegado al final del contrato");
    // Recorrerlo no es aceptarlo: la casilla sigue haciendo falta.
    expect(aceptar().disabled).toBe(true);
    await act(async () => casilla().click());
    expect(aceptar().disabled).toBe(false);
  });

  it("la aceptación manda `textoMostradoCompleto` y el instante", async () => {
    await verElFinal();
    await act(async () => casilla().click());
    await act(async () => aceptar().click());
    await act(async () => {
      await Promise.resolve();
    });
    const post = llamadas.find((l) => l.path === "/clinica/contrato/aceptar")!;
    expect(post).toBeTruthy();
    const body = post.body as {
      textoMostradoCompleto: boolean;
      finalDelTextoEn: string;
    };
    expect(body.textoMostradoCompleto).toBe(true);
    expect(Number.isNaN(Date.parse(body.finalDelTextoEn))).toBe(false);
  });

  it("el centinela va DESPUÉS del texto completo", async () => {
    const centinela = host.querySelector('[data-test="contrato-final-del-texto"]')!;
    const ultimoApartado = [...host.querySelectorAll("h2")].at(-1)!;
    expect(
      ultimoApartado.compareDocumentPosition(centinela) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
