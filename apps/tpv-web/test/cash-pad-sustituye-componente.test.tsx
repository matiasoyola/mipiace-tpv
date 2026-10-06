// v1.22-el-terminal-del-bar · §2 · hallazgo C2, en el componente.
//
// SABOTAJE que tiene que caer: que la sustitución dure más de una tecla
// —es decir, que el pad pase `replace` siempre y no sólo cuando el valor
// viene de fuera—. La regla pura ya está probada en
// `cash-pad-sustituye.test.ts`; lo que se prueba aquí es QUIÉN decide,
// que es donde vive el error fácil: con un `pristine` que se arme al
// montar, la segunda fila del mixto y la segunda denominación del arqueo
// no se podrían sustituir, porque el pad NO se desmonta al cambiar de
// objetivo.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CashPad } from "../src/components/CashPad.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** Un formulario de mentira: posee el importe, como el de verdad. */
class Caja {
  valor: string;
  sustituyendo = false;
  constructor(inicial: string) {
    this.valor = inicial;
  }
}

async function pinta(caja: Caja, maxDecimals = 2) {
  await act(async () => {
    root.render(
      <CashPad
        value={caja.valor}
        maxDecimals={maxDecimals}
        onChange={(next) => {
          caja.valor = next;
          void pinta(caja, maxDecimals);
        }}
        onReplacingChange={(r) => {
          caja.sustituyendo = r;
        }}
      />,
    );
  });
}

async function pulsa(texto: string) {
  const b = Array.from(container.querySelectorAll("button")).find(
    (x) => (x.textContent ?? "").trim() === texto,
  );
  if (!b) throw new Error(`tecla "${texto}" no encontrada`);
  await act(async () => {
    (b as HTMLButtonElement).click();
  });
}

describe("v1.22 §2 · el pad decide cuándo sustituir", () => {
  it("abierto sobre 6,90: pulsar 4 y 5 da 45, no 5", async () => {
    const caja = new Caja("6,90");
    await pinta(caja);
    await pulsa("4");
    expect(caja.valor).toBe("4");
    await pulsa("5");
    expect(caja.valor).toBe("45");
    await pulsa("0");
    expect(caja.valor).toBe("450");
  });

  it("al abrirse avisa de que el valor está para sustituir, y luego ya no", async () => {
    const caja = new Caja("6,90");
    await pinta(caja);
    expect(caja.sustituyendo).toBe(true);
    await pulsa("4");
    expect(caja.sustituyendo).toBe(false);
  });

  it("si el formulario cambia de objetivo, el nuevo valor vuelve a ser sustituible", async () => {
    // Es el caso del arqueo (de una denominación a otra) y el del mixto
    // (de la tarjeta al efectivo) SIN desmontar el pad.
    const caja = new Caja("6,90");
    await pinta(caja);
    await pulsa("4");
    expect(caja.sustituyendo).toBe(false);

    caja.valor = "2,80"; // el formulario apunta a otra fila
    await pinta(caja);
    expect(caja.sustituyendo).toBe(true);
    await pulsa("9");
    expect(caja.valor).toBe("9");
  });

  it("el fondo de apertura: 0,00 y tecleando 1-0-0 queda 100", async () => {
    const caja = new Caja("0,00");
    await pinta(caja);
    await pulsa("1");
    await pulsa("0");
    await pulsa("0");
    expect(caja.valor).toBe("100");
  });

  it("'C' limpia y lo que se teclea después se concatena normal", async () => {
    const caja = new Caja("6,90");
    await pinta(caja);
    await pulsa("C");
    expect(caja.valor).toBe("");
    await pulsa("1");
    await pulsa("2");
    expect(caja.valor).toBe("12");
  });

  it("borrar deja 6,9 y el siguiente dígito se pega detrás, como siempre", async () => {
    const caja = new Caja("6,90");
    await pinta(caja);
    const borrar = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Borrar último dígito"]',
    )!;
    await act(async () => borrar.click());
    expect(caja.valor).toBe("6,9");
    await pulsa("4");
    expect(caja.valor).toBe("6,94");
  });

  it("en el arqueo (sin coma) la segunda denominación también se sustituye", async () => {
    const caja = new Caja("12");
    await pinta(caja, 0);
    await pulsa("3");
    expect(caja.valor).toBe("3");
    await pulsa("4");
    expect(caja.valor).toBe("34");
  });
});
