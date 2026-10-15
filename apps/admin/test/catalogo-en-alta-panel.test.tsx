// catalogo-en-alta · el panel «Cargar catálogo» de la ficha del tenant.
//
// Lo que se fija aquí es lo que el implantador ve ANTES de escribir, con
// el dueño al lado:
//
//   · Elegir el fichero pide la vista previa, y la vista previa NO manda
//     `confirmar` — es el servidor quien no escribe, pero si la pantalla
//     mandara `confirmar: true` al elegir el fichero, la promesa se
//     rompería desde este lado.
//   · La tabla enseña las DOS cifras: la de la carta y la que se guarda.
//   · Las filas que no entran salen con su número de línea y su motivo.
//   · Cancelar vuelve al estado inicial sin haber llamado a nada más.
//   · Confirmar manda el mismo CSV con `confirmar: true`.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const llamadas: Array<{ path: string; body: unknown }> = [];
let respuesta: unknown = null;
let lanza: Error | null = null;

class FakeSuperAdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

vi.mock("../src/superadmin/api.js", () => ({
  SuperAdminApiError: FakeSuperAdminApiError,
  superApi: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
    llamadas.push({ path, body: opts?.body });
    if (lanza) throw lanza;
    return respuesta;
  }),
}));

const { CatalogImportPanel } = await import("../src/superadmin/CatalogImportPanel.js");

const PREVIA = {
  escrito: false,
  entran: [
    {
      linea: 2,
      sku: "CAF-001",
      nombre: "Café con leche",
      precioConIva: 1.6,
      precioSinIva: 1.4545,
      iva: 10,
      categorias: ["cafés"],
      // catalogo-servicios-csv · un café es un producto sujeto: las tres
      // columnas nuevas vienen en su forma vacía, que es lo que el
      // servidor manda para el fichero de un bar.
      tipo: "PRODUCT",
      duracionMin: null,
      exencion: null,
      exencionEtiqueta: null,
    },
  ],
  saltadas: [
    { linea: 3, sku: "", nombre: "Sin referencia", motivo: "El SKU es obligatorio." },
  ],
  yaTenia: 0,
};

const CSV = "sku,nombre,precio_con_iva,iva,categoria\nCAF-001,Café con leche,1.60,10,cafés";

// catalogo-servicios-csv · la vista previa de una clínica: un servicio
// exento con duración y la crema del mostrador, sujeta al 21 %. Es lo que
// Rosario revisa con el implantador delante.
const PREVIA_CLINICA = {
  escrito: false,
  entran: [
    {
      linea: 2,
      sku: "POD-002",
      nombre: "Quiropodia básica",
      precioConIva: 25,
      precioSinIva: 25,
      iva: 0,
      categorias: ["quiropodia"],
      tipo: "SERVICE",
      duracionMin: 30,
      exencion: "E1",
      exencionEtiqueta: "Exento · sanitario",
    },
    {
      linea: 3,
      sku: "CRE-001",
      nombre: "Crema urea 20%",
      precioConIva: 12,
      precioSinIva: 9.9174,
      iva: 21,
      categorias: ["mostrador"],
      tipo: "PRODUCT",
      duracionMin: null,
      exencion: null,
      exencionEtiqueta: null,
    },
  ],
  saltadas: [],
  yaTenia: 0,
};

let container: HTMLDivElement;
let root: Root;
let cargado = 0;

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <CatalogImportPanel tenantId="t-1" onCargado={() => { cargado += 1; }} />,
    );
  });
}

// El panel llama a `file.text()`, que es estándar en el navegador y que
// el `Blob` de jsdom NO implementa (jsdom 25). Se le pone encima en el
// fake: lo que se está probando es el panel, no el `File` de jsdom.
function elegirFichero(texto: string): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([texto], "catalogo-tpv.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", {
    value: async () => texto,
    configurable: true,
  });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  return act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function text(): string {
  return container.textContent ?? "";
}

function botonCon(frase: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(frase),
    ) ?? null
  );
}

beforeEach(() => {
  llamadas.length = 0;
  cargado = 0;
  lanza = null;
  respuesta = PREVIA;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("catalogo-en-alta · panel de carga", () => {
  it("de entrada sólo ofrece elegir el fichero, sin llamar a nada", async () => {
    await render();
    expect(text()).toContain("Elegir fichero CSV");
    expect(llamadas).toEqual([]);
  });

  it("dice las columnas y que el precio es con IVA", async () => {
    await render();
    expect(text()).toContain("sku,nombre,precio_con_iva,iva,categoria");
    expect(text()).toContain("con IVA");
  });

  it("elegir el fichero pide la vista previa SIN confirmar", async () => {
    await render();
    await elegirFichero(CSV);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.path).toBe("/super-admin/tenants/t-1/catalog/import");
    expect(llamadas[0]!.body).toEqual({ csv: CSV });
    // Lo que NO lleva es lo que importa.
    expect((llamadas[0]!.body as { confirmar?: boolean }).confirmar).toBeUndefined();
  });

  it("la vista previa dice el precio de la carta y el que se guarda", async () => {
    await render();
    await elegirFichero(CSV);
    expect(text()).toContain("CAF-001");
    expect(text()).toContain("1,60 €");
    expect(text()).toContain("1,4545 €");
    expect(text()).toContain("10 %");
  });

  it("y deja claro que todavía no ha escrito nada", async () => {
    await render();
    await elegirFichero(CSV);
    expect(text()).toContain("Nada de esto se ha escrito todavía");
  });

  it("las filas que no entran salen con su línea y su motivo", async () => {
    await render();
    await elegirFichero(CSV);
    expect(text()).toContain("Línea 3");
    expect(text()).toContain("El SKU es obligatorio.");
  });

  it("el botón dice cuántos productos va a cargar", async () => {
    await render();
    await elegirFichero(CSV);
    expect(botonCon("Cargar 1 producto")).not.toBeNull();
  });

  it("cancelar vuelve al principio y no llama a nada más", async () => {
    await render();
    await elegirFichero(CSV);
    await act(async () => {
      botonCon("Cancelar")!.click();
    });
    expect(text()).toContain("Elegir fichero CSV");
    expect(llamadas).toHaveLength(1);
  });

  it("confirmar manda el MISMO csv con confirmar: true", async () => {
    await render();
    await elegirFichero(CSV);
    respuesta = { ...PREVIA, escrito: true };
    await act(async () => {
      botonCon("Cargar 1 producto")!.click();
      await Promise.resolve();
    });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]!.body).toEqual({ csv: CSV, confirmar: true });
  });

  it("tras cargar, avisa a la ficha para que recargue la salud", async () => {
    // Con el catálogo dentro, `products-sellable` pasa a verde y el botón
    // de activar se enciende. Si el panel no avisara, el implantador
    // tendría que recargar la página a mano para poder activar.
    await render();
    await elegirFichero(CSV);
    respuesta = { ...PREVIA, escrito: true };
    await act(async () => {
      botonCon("Cargar 1 producto")!.click();
      await Promise.resolve();
    });
    expect(cargado).toBe(1);
    expect(text()).toContain("1 producto cargado");
  });

  it("un fichero que no es el catálogo se explica y no deja la pantalla a medias", async () => {
    await render();
    lanza = new FakeSuperAdminApiError(
      400,
      "CSV_INVALIDO",
      "La primera línea tiene que ser la cabecera con las columnas sku, nombre, precio_con_iva, iva, categoria. Falta: sku.",
    );
    await elegirFichero("nombre,nif,email\nPepe,12345678Z,p@p.es");
    expect(text()).toContain("Falta: sku");
    // Y se puede volver a intentar: el botón de elegir fichero sigue ahí.
    expect(text()).toContain("Elegir fichero CSV");
  });

  // ── catalogo-servicios-csv · lo que la dueña de la clínica revisa ──
  //
  // Cada una de estas tres cosas es invisible en el CSV una vez subido, y
  // cada una decide algo que no se arregla después: si el servicio se
  // puede reservar, cuánto ocupa en la agenda y si el ticket sale bien en
  // el papel.

  it("enseña que la fila es un SERVICIO y no un producto", async () => {
    respuesta = PREVIA_CLINICA;
    await render();
    await elegirFichero(CSV);
    expect(text()).toContain("Servicio");
    // Y la crema del mostrador sigue siendo un producto.
    expect(text()).toContain("Producto");
  });

  it("enseña la duración del servicio en minutos", async () => {
    respuesta = PREVIA_CLINICA;
    await render();
    await elegirFichero(CSV);
    expect(text()).toContain("30 min");
  });

  it("un exento se lee «Exento · sanitario» y NO «0 %»", async () => {
    // Los dos valen cero euros de cuota y son dos operaciones distintas
    // ante la AEAT. Si la pantalla pintara «0 %» la dueña no podría
    // distinguirlos, que es justo lo que este bloque viene a arreglar.
    respuesta = PREVIA_CLINICA;
    await render();
    await elegirFichero(CSV);
    expect(text()).toContain("Exento · sanitario");
    expect(text()).not.toContain("0 %");
    // Y la crema sí lleva su tipo.
    expect(text()).toContain("21 %");
  });

  it("dice las tres columnas nuevas y que la duración es obligatoria en un servicio", async () => {
    await render();
    expect(text()).toContain("tipo,exencion,duracion_min");
    expect(text()).toContain("obligatorios en un servicio");
  });

  it("un tenant con Holded recibe el 409 y se lee como una frase", async () => {
    await render();
    lanza = new FakeSuperAdminApiError(
      409,
      "LOCAL_CATALOG_DISABLED",
      "El catálogo de este comercio se gestiona desde Holded, así que no se crean productos aquí. El alta local es para los comercios que no usan Holded.",
    );
    await elegirFichero(CSV);
    expect(text()).toContain("se gestiona desde Holded");
  });
});
