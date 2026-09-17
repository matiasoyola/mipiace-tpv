// B-reservas-mostrador F6 · el selector encuentra a los clientes de Holded.
//
// El 13-09 en el AP11 la recepcionista buscó «Dem…», no salió nadie, y la
// clienta llevaba tres años en Holded. Son dos listas y no tiene por qué
// saberlo.
//
// Lo que se fija aquí:
//   · el selector SIGUE siendo local y sin esperas: los del CRM salen ya;
//   · los de Holded llegan después, con debounce y desde 2 caracteres;
//   · un contacto ya enlazado NO sale dos veces: sale como cliente;
//   · elegir uno llama al endpoint idempotente, UNA vez, y devuelve el
//     cliente;
//   · sin conexión la sección no aparece y un aviso lo dice;
//   · sin contactos no hay sección vacía;
//   · el teléfono va enmascarado (invariante de v1.4).

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import { useClientPicker } from "../src/hooks/useClientPicker.js";
import type { ClientRow } from "../src/lib/clients.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no implementa `scrollIntoView`, y el foco del buscador lo llama
// (`visualViewportSync`, que en el hierro empuja el campo por encima del
// teclado). Sin esto el test se cae por algo que no es del bloque.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

function cliente(
  id: string,
  firstName: string,
  lastName: string,
  holdedContactId: string | null = null,
): ClientRow {
  return {
    id,
    externalId: null,
    firstName,
    lastName,
    phone: "600111222",
    email: null,
    birthdate: null,
    holdedContactId,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const CARMEN = cliente("cl-carmen", "Carmen", "Ruiz");

function contacto(id: string, name: string, holdedContactId: string, phone: string | null = "+34 600 123 456") {
  return { id, holdedContactId, name, nif: null, email: null, phone };
}

let clientesDelServidor: ClientRow[];
let contactosDeHolded: ReturnType<typeof contacto>[];
/** `true` → `/contacts/search` revienta, como sin red. */
let holdedCaido: boolean;
let elegido: ClientRow | null;
let llamadas: string[];

let container: HTMLDivElement;
let root: Root;

/** Un anfitrión mínimo que abre el selector al montar. */
function Anfitrion() {
  const picker = useClientPicker();
  return (
    <div>
      <button
        data-abrir
        onClick={() =>
          picker.open((c) => {
            elegido = c;
          })
        }
      >
        abrir
      </button>
      {picker.element}
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  clientesDelServidor = [CARMEN];
  contactosDeHolded = [];
  holdedCaido = false;
  elegido = null;
  llamadas = [];
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, init?: { method?: string }) => {
      llamadas.push(`${init?.method ?? "GET"} ${path}`);
      if (path.startsWith("/clients?")) {
        return { items: clientesDelServidor, nextCursor: null };
      }
      if (path.startsWith("/contacts/search")) {
        if (holdedCaido) throw new Error("sin red");
        const q = decodeURIComponent(
          new URLSearchParams(path.slice(path.indexOf("?"))).get("q") ?? "",
        ).toLowerCase();
        return {
          results: contactosDeHolded.filter((c) =>
            c.name.toLowerCase().includes(q),
          ),
          source: "local",
          holdedFallback: null,
        };
      }
      const enlace = /^\/clients\/from-contact\/(.+)$/.exec(path);
      if (enlace) {
        const c = contactosDeHolded.find((x) => x.id === enlace[1]);
        if (!c) throw new Error("contacto desconocido");
        const [nombre, ...resto] = c.name.split(" ");
        return {
          client: cliente(
            `cl-de-${c.id}`,
            nombre!,
            resto.join(" "),
            c.holdedContactId,
          ),
          created: true,
        };
      }
      throw new Error(`ruta no mockeada: ${path}`);
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function settle() {
  // `fake-indexeddb` y el `refreshClients()` de fondo despiertan por
  // macrotareas: hay que dejar correr el reloj falso, no sólo vaciar
  // microtareas.
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
  }
}

/** Pasa el debounce de 250 ms y deja llegar la respuesta. */
async function pasaElDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await settle();
}

/** Lo que se ve ANTES de que el debounce dispare: el selector no espera. */
async function sinPasarElDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

async function abrir() {
  root = createRoot(container);
  await act(async () => {
    root.render(<Anfitrion />);
  });
  await settle();
  await act(async () => {
    container
      .querySelector("[data-abrir]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function teclear(texto: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, texto);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function seccionHolded(): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-seccion-holded]");
}

function filasHolded(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("[data-contacto-holded]"),
  );
}

function texto(): string {
  return container.textContent ?? "";
}

const busquedas = () => llamadas.filter((l) => l.includes("/contacts/search"));

// ── La sección ────────────────────────────────────────────────────────

describe("los contactos de Holded salen en su propia sección, debajo", () => {
  it("con menos de 2 caracteres NO se pregunta por red", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("d");
    await pasaElDebounce();
    expect(busquedas()).toHaveLength(0);
    expect(seccionHolded()).toBeNull();
  });

  it("con 2 caracteres sí, y la sección aparece con su título", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("de");
    await pasaElDebounce();
    expect(busquedas()).toHaveLength(1);
    expect(seccionHolded()).not.toBeNull();
    expect(texto()).toContain("De Holded");
    expect(texto()).toContain("Demetria Salas");
  });

  it("es EL caso del 13-09: «dem» no daba nada y la clienta estaba en Holded", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    expect(texto()).toContain("Demetria Salas");
    // Y ya no se dice «Sin coincidencias» con tres resultados debajo.
    expect(texto()).not.toContain("Sin coincidencias");
  });

  it("hay DEBOUNCE: teclear rápido no dispara una búsqueda por letra", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("de");
    await teclear("dem");
    await teclear("deme");
    await pasaElDebounce();
    expect(busquedas()).toHaveLength(1);
    expect(busquedas()[0]).toContain("q=deme");
  });

  it("el selector NO espera a Holded: el CRM ya está en pantalla antes", async () => {
    contactosDeHolded = [contacto("ct-1", "Carmen Otra", "h-1")];
    await abrir();
    await teclear("car");
    await sinPasarElDebounce();
    // Todavía sin pasar el debounce: los del CRM ya se ven.
    expect(texto()).toContain("Carmen Ruiz");
    expect(seccionHolded()).toBeNull();
    await pasaElDebounce();
    expect(texto()).toContain("Carmen Ruiz");
    expect(texto()).toContain("Carmen Otra");
  });

  it("los del CRM van ARRIBA y los de Holded DEBAJO", async () => {
    contactosDeHolded = [contacto("ct-1", "Carmen Otra", "h-1")];
    await abrir();
    await teclear("car");
    await pasaElDebounce();
    const delCrm = container.querySelector('[data-testid="client-picker-results"]')!;
    expect(
      delCrm.compareDocumentPosition(seccionHolded()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("el teléfono va ENMASCARADO: la invariante de v1.4 se hereda", async () => {
    contactosDeHolded = [
      contacto("ct-1", "Demetria Salas", "h-1", "+34 600 123 456"),
    ];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    const fila = filasHolded()[0]!;
    expect(fila.textContent).toContain("•••• 3456");
    expect(fila.textContent).not.toContain("600 123");
  });

  it("un contacto sin teléfono lo dice, no enseña un hueco", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1", null)];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    expect(filasHolded()[0]!.textContent).toContain("Sin teléfono");
  });
});

// ── Deduplicación ─────────────────────────────────────────────────────

describe("un contacto YA enlazado sale UNA vez, y como cliente", () => {
  it("no se repite en la sección de Holded", async () => {
    clientesDelServidor = [cliente("cl-dem", "Demetria", "Salas", "h-1")];
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();

    expect(texto()).toContain("Demetria Salas");
    // Está arriba, como cliente, y NO abajo.
    expect(
      container.querySelectorAll('[data-testid="client-picker-result"]'),
    ).toHaveLength(1);
    expect(filasHolded()).toHaveLength(0);
    expect(seccionHolded()).toBeNull();
  });

  it("y los que NO están enlazados sí salen, en la misma búsqueda", async () => {
    clientesDelServidor = [cliente("cl-dem", "Demetria", "Salas", "h-1")];
    contactosDeHolded = [
      contacto("ct-1", "Demetria Salas", "h-1"),
      contacto("ct-2", "Demelza Ortiz", "h-2"),
    ];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    expect(filasHolded()).toHaveLength(1);
    expect(filasHolded()[0]!.textContent).toContain("Demelza Ortiz");
  });
});

// ── Elegir uno ────────────────────────────────────────────────────────

describe("elegir un contacto de Holded", () => {
  it("llama UNA vez al endpoint idempotente y devuelve el cliente", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas Gil", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    await click(filasHolded()[0]!);

    const enlaces = llamadas.filter((l) => l.includes("/clients/from-contact/"));
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]).toBe("POST /clients/from-contact/ct-1");
    // El cliente que sale es el del servidor, con el nombre partido por él.
    expect(elegido).not.toBeNull();
    expect(elegido!.firstName).toBe("Demetria");
    expect(elegido!.lastName).toBe("Salas Gil");
    expect(elegido!.holdedContactId).toBe("h-1");
  });

  it("NO se busca-y-si-no-se-crea desde el front: ni un POST /clients", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    await click(filasHolded()[0]!);
    expect(llamadas).not.toContain("POST /clients");
  });

  it("y el selector se cierra, como al elegir un cliente normal", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    await click(filasHolded()[0]!);
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });

  it("si el enlace falla, lo dice y no cierra nada", async () => {
    contactosDeHolded = [contacto("ct-9", "Nadie", "h-9")];
    await abrir();
    await teclear("nad");
    await pasaElDebounce();
    // El mock revienta con un id que no conoce.
    contactosDeHolded = [];
    await click(filasHolded()[0]!);
    expect(texto()).toContain("No se ha podido traer ese contacto");
    expect(elegido).toBeNull();
  });
});

// ── Sin red y sin resultados ──────────────────────────────────────────

describe("sin conexión y sin contactos", () => {
  it("SIN RED la sección no aparece, y un aviso pequeño lo dice", async () => {
    holdedCaido = true;
    await abrir();
    await teclear("dem");
    await pasaElDebounce();

    expect(seccionHolded()).toBeNull();
    expect(
      container.querySelector("[data-aviso-sin-red]"),
    ).not.toBeNull();
    expect(texto()).toContain("Sin conexión: no se buscan contactos de Holded.");
  });

  it("sin red los del CRM SIGUEN saliendo: el selector no depende de Holded", async () => {
    holdedCaido = true;
    await abrir();
    await teclear("car");
    await pasaElDebounce();
    expect(texto()).toContain("Carmen Ruiz");
  });

  it("un tenant SIN contactos no ve una sección vacía", async () => {
    contactosDeHolded = [];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    expect(seccionHolded()).toBeNull();
    expect(texto()).not.toContain("De Holded");
    // Y no hay aviso de sin red: la red va bien, no hay nadie.
    expect(container.querySelector("[data-aviso-sin-red]")).toBeNull();
    expect(texto()).toContain("Sin coincidencias.");
  });

  it("borrar la búsqueda se lleva la sección y el aviso", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    expect(seccionHolded()).not.toBeNull();

    await teclear("");
    await pasaElDebounce();
    expect(seccionHolded()).toBeNull();
    expect(container.querySelector("[data-aviso-sin-red]")).toBeNull();
  });

  it("el TPV NUNCA manda `includeAll`: el propietario no ve sus proveedores", async () => {
    contactosDeHolded = [contacto("ct-1", "Demetria Salas", "h-1")];
    await abrir();
    await teclear("dem");
    await pasaElDebounce();
    for (const l of busquedas()) expect(l).not.toContain("includeAll");
  });
});
