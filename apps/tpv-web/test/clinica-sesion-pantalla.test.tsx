// clinica-3 · la pantalla de la sesión, montada de verdad.
//
// Lo que se fija aquí es lo que un test de API no puede ver: que la
// pantalla pinta lo que el servidor manda y nada más. En particular —
//
//   1. **El sanitario sin caja NO VE NI UN IMPORTE** en la pantalla
//      renderizada, y su botón dice «Cerrar sesión». La dueña sí los ve y
//      el suyo dice «y cobrar». Es la regla 8 mirada desde el DOM: la API
//      ya quita las claves (y eso lo prueba `clinica-sesion-rutas`), aquí
//      se comprueba que no se cuela un `0,00 €` por un `?? 0`.
//   2. **«Igual que la última vez» SUMA**: marca los tratamientos de la
//      visita anterior sin desmarcar lo de hoy.
//   3. **La gravedad está desactivada antes de elegir la lesión**, con su
//      motivo escrito al lado.
//   4. **Las 22 zonas del mapa están y pasan el mínimo táctil**, medido
//      sobre la geometría que la pantalla pinta.
//   5. **La franja roja es la intensa**, con «Cuidado» y `role="alert"`.
//   6. La puerta de la valoración cerrada no deja cerrar la sesión, y
//      ofrece el camino.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot + act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANCHO_DEL_PIE_PX,
  CONSEJOS_V1,
  LESIONES_V1,
  MAPA_PIE_V1,
  VIEWBOX,
} from "@mipiacetpv/clinica-sesion";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import {
  SesionPodologia,
  type VistaDeLaSesion,
} from "../src/clinica/SesionPodologia.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CITA = "55555555-5555-5555-5555-555555555551";
const QUIROPODIA = "66666666-6666-6666-6666-666666666661";
const FRESADO = "66666666-6666-6666-6666-666666666662";
const VERRUGA = "66666666-6666-6666-6666-666666666663";

/** La vista que devuelve la API. `verImportes` manda. */
function vista(opts: {
  verImportes: boolean;
  puertaAbierta?: boolean;
  conAnterior?: boolean;
}): VistaDeLaSesion {
  const conPrecio = opts.verImportes;
  return {
    cita: {
      id: CITA,
      clientId: "44444444-4444-4444-4444-444444444444",
      empieza: "2026-10-07T08:30:00.000Z",
      status: "IN_SERVICE",
      servicios: ["Quiropodia"],
      atiende: { userId: "u1", nombre: "Lucía Martín" },
      ticketId: null,
    },
    cabecera: {
      paciente: {
        id: "44444444-4444-4444-4444-444444444444",
        nombre: "Carmen Rodríguez López",
        edad: 78,
        telefono: "600 123 456",
      },
      citaDeHoy: {
        empieza: "2026-10-07T08:30:00.000Z",
        servicios: ["Quiropodia"],
      },
      numeroDeVisita: 3,
      visitaAnterior: "2026-09-21T08:30:00.000Z",
      atiende: { userId: "u1", nombre: "Lucía Martín" },
      alertas: ["Diabetes", "Anticoagulación", "Alergia: látex"],
    },
    puerta:
      opts.puertaAbierta === false
        ? {
            puede: false,
            motivo: "VALORACION_SIN_VALIDAR",
            mensaje:
              "La valoración inicial está contestada pero sin validar. Revísala con el paciente y válidala antes del primer tratamiento.",
          }
        : {
            puede: true,
            valoracionId: "v1",
            validadaEn: "2026-09-07T09:00:00.000Z",
          },
    tratamientos: [
      {
        serviceId: QUIROPODIA,
        nombre: "Quiropodia",
        ...(conPrecio ? { precio: 30, iva: 0 } : {}),
      },
      {
        serviceId: FRESADO,
        nombre: "Corte y fresado de uñas",
        ...(conPrecio ? { precio: 0, iva: 0 } : {}),
      },
      {
        serviceId: VERRUGA,
        nombre: "Tratamiento de verruga",
        ...(conPrecio ? { precio: 25, iva: 0 } : {}),
      },
    ],
    anterior:
      opts.conAnterior === false
        ? null
        : {
            entryId: "e1",
            fecha: "2026-09-21T08:30:00.000Z",
            marcas: { "L:h": { lesion: "unero", gravedad: "MODERADA" } },
            tratamientos: [QUIROPODIA, FRESADO],
            consejos: ["calzado"],
            dolor: 5,
          },
    dolorHistorico: [
      { fecha: "2026-09-07T09:00:00.000Z", dolor: 7 },
      { fecha: "2026-09-21T09:00:00.000Z", dolor: 5 },
    ],
    exploracion: {
      departeDe: {
        pulsos: { L: "PRESENTE", R: "PRESENTE" },
        sinSensibilidad: [],
        tipoDePie: "NORMAL",
      },
      ultima: null,
    },
    cerrada: null,
    listas: {
      mapa: MAPA_PIE_V1,
      lesiones: LESIONES_V1,
      consejos: CONSEJOS_V1,
    },
    verImportes: opts.verImportes,
  };
}

let host: HTMLDivElement;
let root: Root;

async function montar(v: VistaDeLaSesion) {
  apiMock.apiWithCashier.mockResolvedValue(v);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<SesionPodologia appointmentId={CITA} />);
  });
}

function texto(): string {
  return host.textContent ?? "";
}

function botones(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")] as HTMLButtonElement[];
}

function botonPorTexto(t: string): HTMLButtonElement | undefined {
  return botones().find((b) => (b.textContent ?? "").trim() === t);
}

/** El pulso marcado en la fila de un pie, por su etiqueta. */
function pulsoMarcado(pie: "izquierdo" | "derecho"): string | undefined {
  const fila = [...host.querySelectorAll("div")].find(
    (d) =>
      d.children.length === 2 &&
      d.children[0]?.textContent === `Pie ${pie}`,
  );
  if (!fila) throw new Error(`no hay fila del pie ${pie}`);
  return [...fila.querySelectorAll("button")]
    .find((b) => b.getAttribute("aria-pressed") === "true")
    ?.textContent?.trim();
}

async function pulsar(b: HTMLElement | undefined) {
  if (!b) throw new Error("botón no encontrado");
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

// ── 1 · LOS IMPORTES, SEGÚN ROL ─────────────────────────────────────

describe("clinica-3 · el sanitario sin caja no ve importes en la pantalla", () => {
  it("ni un euro en todo el DOM, y el botón dice «Cerrar sesión»", async () => {
    await montar(vista({ verImportes: false }));
    // Se marcan dos tratamientos: es cuando el pie enseñaría el total.
    await pulsar(botonPorTexto("Quiropodia"));
    await pulsar(botonPorTexto("Tratamiento de verruga"));
    await pulsar(botonPorTexto("4"));

    expect(texto()).not.toContain("€");
    // Ni un «0,00», que es lo que saldría de un `?? 0`.
    expect(texto()).not.toMatch(/\d+,\d\d\s*€/);
    expect(texto()).not.toMatch(/iva/i);
    expect(botonPorTexto("Cerrar sesión")).toBeDefined();
    expect(botonPorTexto("Cerrar sesión y cobrar")).toBeUndefined();
    // Pero SÍ cuántos tratamientos lleva: lo necesita para cerrar.
    expect(texto()).toContain("2 tratamientos");
  });

  it("LA DUEÑA sí los ve, con el total y el IVA del catálogo", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Quiropodia"));
    await pulsar(botonPorTexto("Tratamiento de verruga"));
    await pulsar(botonPorTexto("4"));
    expect(texto()).toContain("55,00 €");
    expect(texto()).toContain("iva 0 %");
    expect(botonPorTexto("Cerrar sesión y cobrar")).toBeDefined();
  });

  it("y NUNCA dice «exento», aunque el IVA sea 0", async () => {
    // El mockup escribe «exento de IVA»; aquí el texto sale del catálogo
    // porque `registro.ts` sigue declarando S1 y el ticket va a llevar lo
    // que diga el catálogo.
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Quiropodia"));
    expect(texto()).not.toMatch(/exent/i);
  });
});

// ── 2 · «IGUAL QUE LA ÚLTIMA VEZ» SUMA ──────────────────────────────

describe("clinica-3 · «igual que la última vez»", () => {
  it("SUMA lo de la anterior sin desmarcar lo de hoy", async () => {
    await montar(vista({ verImportes: true }));
    // Hoy la podóloga ha marcado la verruga.
    await pulsar(botonPorTexto("Tratamiento de verruga"));
    expect(
      botonPorTexto("Tratamiento de verruga")!.getAttribute("aria-pressed"),
    ).toBe("true");

    await pulsar(botonPorTexto("↺ Igual que la última vez"));

    // Los dos de la anterior entran…
    expect(botonPorTexto("Quiropodia")!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      botonPorTexto("Corte y fresado de uñas")!.getAttribute("aria-pressed"),
    ).toBe("true");
    // …y LO DE HOY SIGUE MARCADO.
    expect(
      botonPorTexto("Tratamiento de verruga")!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(texto()).toContain("3 tratamientos");
  });

  it("también trae las marcas del pie de la visita anterior", async () => {
    await montar(vista({ verImportes: true }));
    expect(texto()).not.toContain("Uña encarnada");
    await pulsar(botonPorTexto("↺ Igual que la última vez"));
    // Y se leen en palabras, con el nombre de la zona entero.
    expect(texto()).toContain("Pie izq. · Dedo gordo");
    expect(texto()).toContain("Uña encarnada");
  });

  it("está DESACTIVADO en la primera visita: no hay última", async () => {
    await montar(vista({ verImportes: true, conAnterior: false }));
    expect(botonPorTexto("↺ Igual que la última vez")!.disabled).toBe(true);
  });
});

// ── 3 · LA GRAVEDAD, DESPUÉS DE LA LESIÓN ───────────────────────────

describe("clinica-3 · la gravedad se elige después de la lesión", () => {
  it("al tocar una zona, los tres chips de gravedad están desactivados y se dice por qué", async () => {
    await montar(vista({ verImportes: true }));
    const zona = host.querySelector('[data-zona="L:h"]') as HTMLElement;
    expect(zona).not.toBeNull();
    await pulsar(zona);

    expect(texto()).toContain("elige antes la lesión");
    for (const g of ["Leve", "Moderada", "Severa"]) {
      expect(botonPorTexto(g)!.disabled, g).toBe(true);
    }
  });

  it("y se activan en cuanto se elige una lesión", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(host.querySelector('[data-zona="L:h"]') as HTMLElement);
    await pulsar(botonPorTexto("Uña encarnada"));
    for (const g of ["Leve", "Moderada", "Severa"]) {
      expect(botonPorTexto(g)!.disabled, g).toBe(false);
    }
    expect(texto()).not.toContain("elige antes la lesión");
  });

  it("«Quitar» borra la marca de esa zona", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(host.querySelector('[data-zona="L:h"]') as HTMLElement);
    await pulsar(botonPorTexto("Uña encarnada"));
    await pulsar(botonPorTexto("Moderada"));
    expect(texto()).toContain("Uña encarnada");
    await pulsar(botonPorTexto("Quitar"));
    expect(texto()).not.toContain("Uña encarnada (moderada)");
  });
});

// ── 4 · EL MAPA Y SU MÍNIMO TÁCTIL ──────────────────────────────────

describe("clinica-3 · el mapa de los dos pies", () => {
  it("tiene las 22 zonas, once por pie, y cada una con su nombre completo", async () => {
    await montar(vista({ verImportes: true }));
    const zonas = [...host.querySelectorAll("[data-zona]")];
    expect(zonas).toHaveLength(22);
    const etiquetas = zonas.map((z) => z.getAttribute("aria-label"));
    expect(etiquetas).toContain("Pie izquierdo · Dedo gordo");
    expect(etiquetas).toContain("Pie derecho · Talón");
    // Y son pulsables con teclado: un mapa sólo para dedos deja fuera a
    // quien lo necesite.
    for (const z of zonas) {
      expect(z.getAttribute("role")).toBe("button");
      expect(z.getAttribute("tabindex")).toBe("0");
    }
  });

  it("NINGUNA zona baja de 48 px a la escala a la que se pinta el pie", async () => {
    // La cuenta, sobre la geometría que el DOM lleva puesta y no sobre una
    // constante: radio × 2 × (ancho del pie en px / ancho del viewBox).
    // El mínimo del prompt es 44 px; el de la casa, 48.
    await montar(vista({ verImportes: true }));
    const escala = ANCHO_DEL_PIE_PX / VIEWBOX.ancho;
    const zonas = [...host.querySelectorAll("ellipse[data-zona]")];
    expect(zonas.length).toBeGreaterThan(0);
    for (const z of zonas) {
      const rx = Number(z.getAttribute("rx"));
      const ry = Number(z.getAttribute("ry"));
      const ancho = 2 * rx * escala;
      const alto = 2 * ry * escala;
      const etiqueta = z.getAttribute("aria-label");
      expect(ancho, `ancho de ${etiqueta}`).toBeGreaterThanOrEqual(48);
      expect(alto, `alto de ${etiqueta}`).toBeGreaterThanOrEqual(48);
    }
  });

  it("y el SVG no se pinta por encima de su ancho nominal", async () => {
    await montar(vista({ verImportes: true }));
    const svgs = [...host.querySelectorAll("svg[viewBox]")].filter(
      (s) => s.getAttribute("viewBox") === `0 0 ${VIEWBOX.ancho} ${VIEWBOX.alto}`,
    );
    expect(svgs).toHaveLength(2);
    for (const s of svgs) {
      expect((s as SVGElement).style.maxWidth).toBe(`${ANCHO_DEL_PIE_PX}px`);
    }
  });

  it("lo de la visita anterior se pinta en naranja SUAVE y lo de hoy en pleno", async () => {
    await montar(vista({ verImportes: true }));
    const anterior = host.querySelector('[data-zona="L:h"]')!;
    expect(anterior.getAttribute("class")).toContain("coral-soft");

    await pulsar(host.querySelector('[data-zona="R:talon"]') as HTMLElement);
    await pulsar(botonPorTexto("Dureza"));
    const hoy = host.querySelector('[data-zona="R:talon"]')!;
    expect(hoy.getAttribute("class")).toContain("fill-mipiace-coral ");
    expect(hoy.getAttribute("class")).not.toContain("coral-soft");
  });
});

// ── 5 · LA FRANJA ROJA INTENSA ──────────────────────────────────────

describe("clinica-3 · la franja de alertas", () => {
  it("es ROJA INTENSA, dice «Cuidado» y se anuncia como alerta", async () => {
    await montar(vista({ verImportes: true }));
    const franja = host.querySelector('[role="alert"]');
    expect(franja).not.toBeNull();
    expect(franja!.getAttribute("class")).toContain("bg-red-700");
    expect(franja!.textContent).toContain("Cuidado");
    for (const a of ["Diabetes", "Anticoagulación", "Alergia: látex"]) {
      expect(franja!.textContent).toContain(a);
    }
  });

  it("sin alertas no hay franja roja, y se dice «Sin alertas»", async () => {
    const v = vista({ verImportes: true });
    v.cabecera.alertas = [];
    await montar(v);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(texto()).toContain("Sin alertas");
  });
});

// ── 6 · LA PUERTA DE LA VALORACIÓN ──────────────────────────────────

describe("clinica-3 · sin valoración validada no se cierra la sesión", () => {
  it("se enseña «Falta validar la valoración inicial» con el motivo", async () => {
    await montar(vista({ verImportes: true, puertaAbierta: false }));
    expect(texto()).toContain("Falta validar la valoración inicial");
    expect(texto()).toContain("válidala antes del primer tratamiento");
  });

  it("y el botón de cerrar NO se activa ni con todo marcado", async () => {
    await montar(vista({ verImportes: true, puertaAbierta: false }));
    await pulsar(botonPorTexto("Quiropodia"));
    await pulsar(botonPorTexto("4"));
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(true);
  });

  it("pero se dice que la EXPLORACIÓN sí se puede registrar", async () => {
    await montar(vista({ verImportes: true, puertaAbierta: false }));
    expect(texto()).toContain(
      "La exploración del pie sí se puede registrar",
    );
  });
});

// ── 7 · EL DOLOR ES OBLIGATORIO, Y CERO VALE ────────────────────────

describe("clinica-3 · el dolor", () => {
  it("sin dolor no se puede cerrar, y el pie lo dice", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Quiropodia"));
    expect(texto()).toContain("falta el dolor de hoy");
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(true);
  });

  it("CERO vale: «ya no me duele» es una respuesta", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Quiropodia"));
    await pulsar(botonPorTexto("0"));
    expect(texto()).not.toContain("falta el dolor de hoy");
    expect(botonPorTexto("Cerrar sesión y cobrar")!.disabled).toBe(false);
  });

  it("y la barra de hoy entra en la gráfica en cuanto se marca", async () => {
    await montar(vista({ verImportes: true }));
    const antes = [...host.querySelectorAll('[aria-label*="Hoy"]')];
    expect(antes.map((b) => b.getAttribute("aria-label"))).toContain(
      "Hoy: sin marcar",
    );
    await pulsar(botonPorTexto("6"));
    expect(
      [...host.querySelectorAll('[aria-label*="Hoy"]')].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toContain("Hoy: 6 de 10");
  });
});

// ── 8 · LA PESTAÑA DE EXPLORACIÓN ───────────────────────────────────

describe("clinica-3 · la exploración", () => {
  it("tiene su propio botón de guardar, y el mapa cambia de significado", async () => {
    await montar(vista({ verImportes: true }));
    await pulsar(botonPorTexto("Exploración"));
    expect(texto()).toContain("Toca los puntos donde NO siente el filamento");
    expect(texto()).toContain("No siente el monofilamento");
    expect(botonPorTexto("Guardar exploración")).toBeDefined();
    // Y en esta pestaña NO hay pie de sesión: no se cierra desde aquí.
    expect(botonPorTexto("Cerrar sesión y cobrar")).toBeUndefined();
  });

  it("arranca con lo de la última exploración, no en blanco", async () => {
    const v = vista({ verImportes: true });
    v.exploracion = {
      departeDe: {
        pulsos: { L: "DEBIL", R: "AUSENTE" },
        sinSensibilidad: ["L:h"],
        tipoDePie: "CAVO",
      },
      ultima: { fecha: "2026-03-01T10:00:00.000Z", autor: "Lucía Martín" },
    };
    await montar(v);
    await pulsar(botonPorTexto("Exploración"));
    // POR FILA y no por texto: «Débil» y «Ausente» salen DOS veces, una
    // por pie, y buscar por texto cogería siempre la del izquierdo —
    // que es justo el error que haría pasar el test con los dos pulsos
    // confundidos. Es la misma lección que clinica-1 dejó escrita sobre
    // los asertos de texto: hay que contar, no buscar.
    expect(pulsoMarcado("izquierdo")).toBe("Débil");
    expect(pulsoMarcado("derecho")).toBe("Ausente");
    expect(botonPorTexto("Cavo")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-zona="L:h"]')!.getAttribute("class")).toContain(
      "fill-mipiace-coral ",
    );
  });
});

// ── 9 · LA CABECERA ─────────────────────────────────────────────────

describe("clinica-3 · la cabecera son fichas con título", () => {
  it("cada dato con su etiqueta encima", async () => {
    await montar(vista({ verImportes: true }));
    const t = texto();
    expect(t).toContain("Carmen Rodríguez López");
    for (const etiqueta of [
      "Edad",
      "Cita de hoy",
      "Visita",
      "Atiende",
      "Teléfono",
    ]) {
      expect(t, etiqueta).toContain(etiqueta);
    }
    expect(t).toContain("78 años");
    expect(t).toContain("3.ª");
    expect(t).toContain("Lucía Martín");
  });

  it("sin fecha de nacimiento, la ficha de edad NO se pinta", async () => {
    // Una edad inventada en una historia clínica es peor que un hueco.
    const v = vista({ verImportes: true });
    v.cabecera.paciente.edad = null;
    await montar(v);
    expect(texto()).not.toContain("Edad");
  });
});
