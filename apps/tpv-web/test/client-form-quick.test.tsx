// B-reservas-mostrador F3 · el mismo formulario, dos urgencias.
//
//   · el alta RÁPIDA (selector de cliente de la agenda y de la venta) no pide
//     la fecha de nacimiento: al reservar no permite tomar ninguna decisión;
//   · la FICHA sí, pero ya no con el `type="date"` que en el AP11 abre el
//     calendario en el mes actual cuando la fecha está cuarenta años atrás;
//   · y los apellidos no frenan el alta en ninguno de los dos.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const creado = vi.hoisted(() => ({ ultimo: null as Record<string, unknown> | null }));

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim(),
  createClient: async (input: Record<string, unknown>) => {
    creado.ultimo = input;
    return { client: { id: "cl-1", ...input }, phoneWarning: undefined };
  },
  updateClient: async (_id: string, patch: Record<string, unknown>) => {
    creado.ultimo = patch;
    return { id: "cl-1", ...patch };
  },
}));

import { ClientForm } from "../src/pages/ClientForm.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  creado.ultimo = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: Parameters<typeof ClientForm>[0]) {
  root = createRoot(container);
  await act(async () => {
    root.render(<ClientForm {...props} />);
  });
}

function campo(slug: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`#client-${slug}`);
}

async function escribir(slug: string, valor: string) {
  const input = campo(slug);
  if (!input) throw new Error(`no hay campo "${slug}"`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function boton(texto: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll("button")).find(
    (x) => (x.textContent ?? "").trim() === texto,
  );
  if (!b) throw new Error(`no hay botón "${texto}"`);
  return b as HTMLButtonElement;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const noop = () => {};

describe("el alta RÁPIDA no pide la fecha de nacimiento", () => {
  it("el campo no está", async () => {
    await render({ modo: "rapido", onSaved: noop, onCancel: noop });
    expect(campo("fecha-de-nacimiento")).toBeNull();
    expect(container.textContent).not.toContain("Fecha de nacimiento");
  });

  it("lo que sí hace falta para reservar sigue estando", async () => {
    await render({ modo: "rapido", onSaved: noop, onCancel: noop });
    expect(campo("nombre")).not.toBeNull();
    expect(campo("apellidos")).not.toBeNull();
    // El slug sale del label (`Teléfono` → `tel-fono`: la é no es [a-z]).
    expect(campo("tel-fono")).not.toBeNull();
    expect(campo("email")).not.toBeNull();
  });

  it("y el alta se puede completar con SÓLO el nombre", async () => {
    await render({ modo: "rapido", onSaved: noop, onCancel: noop });
    await escribir("nombre", "Sole");
    expect(boton("Crear cliente").disabled).toBe(false);
    await click(boton("Crear cliente"));
    expect(creado.ultimo).toMatchObject({ firstName: "Sole" });
    expect(creado.ultimo!.birthdate).toBeUndefined();
  });
});

describe("la FICHA sí la pide, con máscara y teclado numérico", () => {
  it("el campo existe y NO es un type=date", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    const f = campo("fecha-de-nacimiento")!;
    expect(f).not.toBeNull();
    expect(f.getAttribute("type")).not.toBe("date");
    expect(f.getAttribute("inputmode")).toBe("numeric");
    expect(f.getAttribute("placeholder")).toBe("dd/mm/aaaa");
  });

  it("«ficha» es el valor por defecto: la sección Clientes no cambia", async () => {
    await render({ onSaved: noop, onCancel: noop });
    expect(campo("fecha-de-nacimiento")).not.toBeNull();
  });

  it("la máscara coloca las barras mientras se teclea", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    await escribir("fecha-de-nacimiento", "07031961");
    expect(campo("fecha-de-nacimiento")!.value).toBe("07/03/1961");
  });

  it("y a la API va en YYYY-MM-DD", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    await escribir("nombre", "Carmen");
    await escribir("fecha-de-nacimiento", "07/03/1961");
    await click(boton("Crear cliente"));
    expect(creado.ultimo).toMatchObject({
      firstName: "Carmen",
      birthdate: "1961-03-07",
    });
  });

  it("una fecha imposible avisa JUNTO AL CAMPO y no deja guardar", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    await escribir("nombre", "Carmen");
    await escribir("fecha-de-nacimiento", "31/02/1990");

    const aviso = container.querySelector<HTMLElement>(
      '[data-error-campo="fecha-de-nacimiento"]',
    );
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toContain("31");
    // El aviso está pegado al input, no en un toast ni en un tooltip.
    expect(campo("fecha-de-nacimiento")!.getAttribute("aria-invalid")).toBe("true");
    expect(campo("fecha-de-nacimiento")!.getAttribute("aria-describedby")).toBe(
      aviso!.id,
    );
    expect(boton("Crear cliente").disabled).toBe(true);
  });

  it("una fecha futura también", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    await escribir("nombre", "Carmen");
    await escribir("fecha-de-nacimiento", "01/01/2099");
    const aviso = container.querySelector<HTMLElement>(
      '[data-error-campo="fecha-de-nacimiento"]',
    );
    expect(aviso!.textContent).toContain("todavía no ha llegado");
    expect(boton("Crear cliente").disabled).toBe(true);
  });

  it("dejar la fecha en blanco NO es un error: es opcional", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    await escribir("nombre", "Carmen");
    expect(
      container.querySelector('[data-error-campo="fecha-de-nacimiento"]'),
    ).toBeNull();
    expect(boton("Crear cliente").disabled).toBe(false);
    await click(boton("Crear cliente"));
    expect(creado.ultimo!.birthdate).toBeUndefined();
  });

  it("editando una ficha, la fecha que ya había arranca en dd/mm/aaaa", async () => {
    await render({
      modo: "ficha",
      existing: {
        id: "cl-1",
        externalId: null,
        firstName: "Carmen",
        lastName: "Ruiz",
        phone: null,
        email: null,
        birthdate: "1961-03-07",
        holdedContactId: null,
        marketingOptIn: false,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      onSaved: noop,
      onCancel: noop,
    });
    expect(campo("fecha-de-nacimiento")!.value).toBe("07/03/1961");
  });
});

describe("los apellidos no frenan el alta", () => {
  it("no llevan asterisco de obligatorio, y el nombre sí", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    expect(campo("apellidos")!.hasAttribute("required")).toBe(false);
    expect(campo("nombre")!.hasAttribute("required")).toBe(true);
  });

  it("«Crear cliente» se activa con sólo el nombre", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    expect(boton("Crear cliente").disabled).toBe(true);
    await escribir("nombre", "Sole");
    expect(boton("Crear cliente").disabled).toBe(false);
  });

  it("sin nombre NO se activa: un cliente sin nombre no es nadie", async () => {
    await render({ modo: "ficha", onSaved: noop, onCancel: noop });
    await escribir("apellidos", "Ruiz");
    expect(boton("Crear cliente").disabled).toBe(true);
  });
});
