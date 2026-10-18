// auditoria-sirope (#21) · EL VIGILANTE DE ARRANQUE.
//
// Lo que se prueba es el script CLÁSICO de `index.html`, no un módulo: es
// el que tiene que funcionar el día que el bundle no llega. Se lee del
// propio `index.html` y se ejecuta, para que el test caiga si alguien lo
// borra o lo rompe al tocar la plantilla.
//
// La fila de la tabla de sabotajes que vive aquí:
//
//   | El vigilante no salta | la pantalla se queda en blanco sin salida

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { arranqueFallidoPendiente } from "../src/lib/vigilante-arranque.js";

// Ruta desde la raíz del repo: en jsdom `import.meta.url` no es `file:`.
const INDEX_HTML = readFileSync(
  resolve(process.cwd(), "apps/tpv-web/index.html"),
  "utf8",
);

/** El `<script>` en línea del vigilante, tal cual está en la plantilla. */
function scriptDelVigilante(): string {
  const m = INDEX_HTML.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no hay script en línea en index.html");
  return m[1]!;
}

function montarPagina(): void {
  document.body.innerHTML = '<div id="root"></div>';
  delete (window as unknown as Record<string, unknown>).__tpvVigilante;
  // eslint-disable-next-line no-new-func
  new Function(scriptDelVigilante())();
}

function vigilante(): { ok: () => void } {
  return (window as unknown as { __tpvVigilante: { ok: () => void } })
    .__tpvVigilante;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  montarPagina();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("#21 · el vigilante de arranque", () => {
  it("es ES5: nada que un WebView viejo no sepa parsear", () => {
    const src = scriptDelVigilante();
    // Lo que no puede llevar, porque el día que haga falta el motor que
    // lo ejecute puede ser el que no entiende el bundle.
    expect(src).not.toMatch(/=>/);
    expect(src).not.toMatch(/\bconst\b|\blet\b/);
    expect(src).not.toMatch(/`/);
    expect(src).not.toMatch(/\?\./);
  });

  it("si la app no pinta, enseña una salida con «Reintentar»", async () => {
    // EL SABOTAJE: quitar el `setTimeout` deja la pantalla en blanco.
    await vi.advanceTimersByTimeAsync(8_000);
    const boton = document.querySelector(
      '[data-testid="vigilante-reintentar"]',
    );
    expect(boton).not.toBeNull();
    expect(document.body.textContent).toMatch(/No ha arrancado bien/i);
  });

  it("y deja el parte para que el siguiente arranque lo cuente", async () => {
    await vi.advanceTimersByTimeAsync(8_000);
    const parte = arranqueFallidoPendiente();
    expect(parte).not.toBeNull();
    // El user-agent es donde viaja la versión del WebView.
    expect(typeof parte!.userAgent).toBe("string");
    expect(parte!.esperaSegundos).toBe(8);
    // Se cuenta UNA vez.
    expect(arranqueFallidoPendiente()).toBeNull();
  });

  it("si la app pinta, no enseña nada y no anota fallo", async () => {
    vigilante().ok();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(document.querySelector('[data-testid="vigilante-reintentar"]')).toBeNull();
    expect(arranqueFallidoPendiente()).toBeNull();
    // El #root sigue como estaba: el vigilante no pisa la app.
    expect(document.getElementById("root")!.innerHTML).toBe("");
  });
});
