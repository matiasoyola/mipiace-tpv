// v1.12-manos-de-camarero · navegador sin `gap` en flexbox (hallazgo H1).
//
// El AP11 llega de fábrica con Chrome 81. Ahí la UI no se ve "un poco
// apretada": se lee "Sala5 abiertas" y "GEgemmamgc720,00 €", con el
// nombre del camarero pegado al importe de la mesa. Este bloque decide
// bloquear en vez de polirrellenar 245 `gap-*`, así que lo que hay que
// probar es que la detección no miente y que la pantalla de bloqueo no
// depende de lo mismo que está roto.

import { afterEach, describe, expect, it } from "vitest";

import {
  describeBrowser,
  flexGapSupported,
  renderUnsupportedBrowser,
} from "../src/lib/browser-support.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("v1.12 · flexGapSupported", () => {
  it("mide el alto de verdad, no pregunta a CSS.supports", () => {
    // jsdom no maquetea: `scrollHeight` es 0 siempre, así que aquí la
    // detección devuelve `false`. Eso es exactamente lo que queremos
    // demostrar — que la respuesta sale de medir la caja y no de una
    // consulta que Chrome 81 contesta `true` (soportaba `gap` en grid).
    expect(flexGapSupported()).toBe(false);
  });

  it("no deja el elemento de prueba colgando del DOM", () => {
    const before = document.body.childElementCount;
    flexGapSupported();
    expect(document.body.childElementCount).toBe(before);
  });
});

describe("v1.12 · describeBrowser", () => {
  it("reconoce el Chrome 81 de fábrica del AP11", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 11; AP11-1006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36";
    expect(describeBrowser(ua)).toBe("Chrome 81.0.4044.138");
  });

  it("no confunde con Chrome a los que se hacen pasar por él", () => {
    expect(
      describeBrowser(
        "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/93.0 SamsungBrowser/15.0 Safari/537.36",
      ),
    ).toBe("Samsung Internet 15.0");
    expect(
      describeBrowser(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0.2210.91",
      ),
    ).toBe("Edge 120.0.2210.91");
  });

  it("con un UA que no reconoce, dice el UA en crudo (soporte necesita algo)", () => {
    expect(describeBrowser("cacharro raro/1")).toBe("cacharro raro/1");
    expect(describeBrowser("")).toBe("navegador desconocido");
  });
});

describe("v1.12 · pantalla de bloqueo", () => {
  it("dice qué pasa, qué hacer y qué navegador ha detectado", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    renderUnsupportedBrowser(mount, "Chrome 81.0.4044.138");

    const text = mount.textContent ?? "";
    expect(text).toContain("Este navegador es demasiado antiguo para el TPV");
    expect(text).toContain("Actualiza Chrome desde Play Store");
    expect(text).toContain("Mi Piace TPV");
    // La versión detectada, para que soporte sepa qué tiene delante sin
    // pedir capturas.
    expect(text).toContain("Chrome 81.0.4044.138");
  });

  it("no usa `gap` en ningún sitio: si dependiera de gap saldría rota igual", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    renderUnsupportedBrowser(mount);
    expect(mount.innerHTML).not.toMatch(/gap/i);
  });

  it("no ofrece «continuar igualmente»", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    renderUnsupportedBrowser(mount);
    expect(mount.querySelectorAll("button, a")).toHaveLength(0);
    expect(mount.textContent ?? "").not.toMatch(/continuar/i);
  });

  it("escapa el user agent en vez de inyectarlo", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    renderUnsupportedBrowser(mount, "<img src=x onerror=alert(1)>");
    expect(mount.querySelector("img")).toBeNull();
    expect(mount.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
