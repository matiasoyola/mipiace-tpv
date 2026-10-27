// clinica-10 (1) · LO RESERVADO NACE MARCADO.
//
// La pasada en hierro del 27-10 (`docs/qa/2026-10-27-clinica-9/`), dos
// capturas y el mismo fallo:
//
//   · **18 y 24a** · cita de «Consulta diagnóstico». La sesión abre con
//     el servicio SIN marcar y el pie dice «Nada que cobrar · General: no
//     has marcado nada». El ticket salió a 20 € sólo porque Matías se
//     acordó de marcarlo a mano. Le pasa a la PRIMERA VISITA DE CADA
//     PACIENTE NUEVA.
//   · **10b** · cita de «Cura». La sesión abre con «Pasa a caja:
//     Quiropodia básica · 25 €» —que nadie ha hecho— y la «Cura» de 13 €
//     ahí al lado, sin marcar. Se cobra lo que no fue y no se cobra lo
//     que sí.
//
// Decisión de producto de Matías (27-10): *lo que el sistema ya sabe
// viene puesto; quien atiende sólo toca para quitar o cambiar.*
//
// Lo que este fichero fija es la pantalla; la regla pura está en
// `clinica-sesion/test/clinica-10-reservado.test.ts` y el cierre, en
// `sesion-v2`. Los tres hacen falta: la regla puede estar bien y la
// pantalla no sembrarla, y la pantalla puede sembrarla y el servidor
// tirarlo.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTOS_QUIROPODIA_V1,
  CONSEJOS_V1,
  ESTADOS_DE_HERIDA,
  FUENTE_DEL_RIESGO,
  LESIONES_V1,
  MAPA_PIE_V1,
  PENDIENTES_V1,
  PISADAS,
  PUNTOS_DE_LA_HERIDA,
  TIPOS_DE_PIE_BIOMECANICA,
  versionesDeHoy,
} from "@mipiacetpv/clinica-sesion";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

// Igual que en `clinica-9-sesion`: el consentimiento reducido a su único
// efecto sobre esta pantalla, que es recargar.
vi.mock("../src/clinica/Consentimientos.js", () => ({
  Consentimientos: (props: { onFirmado?: () => void }) => (
    <button type="button" data-test="stub-firmar" onClick={props.onFirmado}>
      Firmar (stub)
    </button>
  ),
}));

import {
  SesionPodologia,
  type ServicioEnPantalla,
  type VistaDeLaSesion,
} from "../src/clinica/SesionPodologia.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CITA = "55555555-5555-5555-5555-555555555551";
const PACIENTE = "44444444-4444-4444-4444-444444444444";

// El catálogo de Rosario, con los que hacen falta aquí (los ids del CSV
// `docs/implantaciones/rosario/catalogo-tpv.csv`).
const CONSULTA = "s-pod-001";
const BASICA = "s-pod-002";
const COMPLETA = "s-pod-003";
const EXTRA = "s-pod-004";
const CURA = "s-pod-006";

/**
 * El catálogo de sesión: los tres niveles, una cura de la MISMA
 * categoría que la quiropodia y la consulta general.
 *
 * La cura va con `tipo: "QUIROPODIA"` a propósito: así es como está en la
 * «Clínica demo» y es lo que produjo la captura 10b. En el CSV de
 * Rosario la cura es de cirugía, y entonces el caso no se da — lo que
 * este fichero prueba es la regla, no la fila del CSV.
 */
const CATALOGO: ServicioEnPantalla[] = [
  {
    serviceId: CONSULTA,
    nombre: "Consulta diagnóstico",
    tipo: "GENERAL",
    nivelQuiropodia: null,
    precio: 20,
    iva: 0,
  },
  {
    serviceId: BASICA,
    nombre: "Quiropodia básica",
    tipo: "QUIROPODIA",
    nivelQuiropodia: 1,
    precio: 25,
    iva: 0,
  },
  {
    serviceId: COMPLETA,
    nombre: "Quiropodia completa",
    tipo: "QUIROPODIA",
    nivelQuiropodia: 2,
    precio: 26,
    iva: 0,
  },
  {
    serviceId: EXTRA,
    nombre: "Quiropodia extra",
    tipo: "QUIROPODIA",
    nivelQuiropodia: 3,
    precio: 27,
    iva: 0,
  },
  {
    serviceId: CURA,
    nombre: "Cura",
    tipo: "QUIROPODIA",
    nivelQuiropodia: null,
    precio: 13,
    iva: 0,
  },
];

function vista(opts: {
  servicioIds: string[];
  nombres: string[];
  tiposSugeridos: VistaDeLaSesion["tiposSugeridos"];
}): VistaDeLaSesion {
  return {
    cita: {
      id: CITA,
      clientId: PACIENTE,
      empieza: "2026-10-27T13:00:00.000Z",
      status: "IN_SERVICE",
      servicios: opts.nombres,
      servicioIds: opts.servicioIds,
      atiende: { userId: "u1", nombre: "Rosario" },
      ticketId: null,
    },
    cabecera: {
      paciente: {
        id: PACIENTE,
        nombre: "Lucia Prueba",
        edad: 70,
        telefono: "600000002",
      },
      citaDeHoy: {
        empieza: "2026-10-27T13:00:00.000Z",
        servicios: opts.nombres,
      },
      numeroDeVisita: 1,
      visitaAnterior: null,
      atiende: { userId: "u1", nombre: "Rosario" },
      alertas: [],
      alertaIds: [],
    },
    puerta: {
      puede: true,
      valoracionId: "v1",
      validadaEn: "2026-10-27T12:00:00.000Z",
    },
    consentimientos: { puede: true, faltan: [], mensaje: "" },
    tratamientos: CATALOGO,
    tiposSugeridos: opts.tiposSugeridos,
    pendientes: [],
    ultimaCirugia: null,
    anterior: null,
    dolorHistorico: [],
    exploracion: {
      departeDe: {
        pulsos: { L: null, R: null },
        sinSensibilidad: [],
        tipoDePie: null,
      },
      ultima: null,
    },
    cerrada: null,
    listas: {
      mapa: MAPA_PIE_V1,
      lesiones: LESIONES_V1,
      consejos: CONSEJOS_V1,
      actos: ACTOS_QUIROPODIA_V1,
      estadosDeHerida: ESTADOS_DE_HERIDA,
      puntos: PUNTOS_DE_LA_HERIDA,
      tiposDePieBiomecanica: TIPOS_DE_PIE_BIOMECANICA,
      pisadas: PISADAS,
      pendientes: PENDIENTES_V1,
      versiones: versionesDeHoy() as unknown as Record<string, number>,
      fuenteDelRiesgo: FUENTE_DEL_RIESGO,
    },
    verImportes: true,
  };
}

/** La cita de la captura 18/24a: «Consulta diagnóstico», tipo GENERAL. */
const LA_CONSULTA = {
  servicioIds: [CONSULTA],
  nombres: ["Consulta diagnóstico"],
  tiposSugeridos: ["GENERAL"] as VistaDeLaSesion["tiposSugeridos"],
};

/** La cita de la captura 10b: «Cura», de la categoría quiropodia. */
const LA_CURA = {
  servicioIds: [CURA],
  nombres: ["Cura"],
  tiposSugeridos: ["QUIROPODIA"] as VistaDeLaSesion["tiposSugeridos"],
};

/** Y una cita de quiropodia de verdad: un NIVEL reservado. */
const LA_QUIROPODIA = {
  servicioIds: [COMPLETA],
  nombres: ["Quiropodia completa"],
  tiposSugeridos: ["QUIROPODIA"] as VistaDeLaSesion["tiposSugeridos"],
};

let host: HTMLDivElement;
let root: Root;
let enviado: Array<{ url: string; body: unknown }>;

async function montar(opts: Parameters<typeof vista>[0]): Promise<void> {
  enviado = [];
  apiMock.apiWithCashier.mockImplementation(
    async (url: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) enviado.push({ url, body: init.body });
      if (url.includes("/contrato")) {
        return { aceptado: true, version: 2, debeAceptar: false };
      }
      if (url.endsWith("/cerrar")) {
        return {
          yaEstaba: false,
          cerrada: {
            entryId: "e-nueva",
            cerradaEn: "2026-10-27T14:00:00.000Z",
            firma: {
              autorNombre: "Rosario",
              colegiado: "45/0123",
              firmadaEn: "2026-10-27T14:00:00.000Z",
            },
            cuerpo: {
              v: 2,
              dolor: 0,
              evolucion: null,
              consejos: [],
              proximaCita: null,
              nota: null,
              consejosVersion: 1,
            },
            marcas: [],
            resumen: { tratamientos: 1, lineas: [], textoDelBoton: "x" },
            yaCobrada: false,
          },
        };
      }
      if (url.includes("/fotos")) {
        // La pestaña Fotos con el consentimiento SIN firmar, que es la
        // que ofrece el botón de ir a firmarlo (captura 19a-b).
        return {
          fotos: [],
          comparador: [],
          consentimiento: {
            puede: false,
            plantillaId: "fotos-clinicas",
            mensaje: "Antes de la primera foto, hay que firmar…",
          },
          mapaVersion: 1,
        };
      }
      return vista(opts);
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<SesionPodologia appointmentId={CITA} />);
  });
}

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
});

function botones(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")] as HTMLButtonElement[];
}

/** Un chip de servicio por su nombre exacto de catálogo. Los chips de
 *  «Qué se cobra» llevan el precio dentro, así que se busca por prefijo
 *  y se ancla con el `·` — ver la nota de memoria sobre los helpers que
 *  casan por subcadena. */
function chipDeServicio(nombre: string): HTMLButtonElement {
  const b = botones().find((x) => {
    const t = (x.textContent ?? "").trim();
    return t === nombre || t.startsWith(`${nombre} · `);
  });
  if (!b) throw new Error(`no hay chip de «${nombre}»`);
  return b;
}

function pieDeSesion(): string {
  return host.querySelector('[data-test="pie-de-sesion"]')?.textContent ?? "";
}

function nivelElegidoEnPantalla(): string | null {
  const caja = host.querySelector('[data-test="nivel-de-quiropodia"]');
  if (!caja) return null;
  const pulsado = [...caja.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-pressed") === "true",
  );
  return pulsado ? (pulsado.textContent ?? "") : null;
}

async function pulsar(b: HTMLElement | undefined | null) {
  if (!b) throw new Error("botón no encontrado");
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Cierra la sesión y devuelve el cuerpo que se mandó. Hace falta poner
 *  el dolor: sin él no deja cerrar (y eso es de clinica-5). */
async function cerrarYMirarElCuerpo(): Promise<Record<string, unknown>> {
  const escala = host.querySelector('[data-test="escala-de-dolor"]')!;
  await pulsar(
    [...escala.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "0",
    ),
  );
  await pulsar(
    botones().find((b) => (b.textContent ?? "").includes("Cerrar sesión")),
  );
  // Y la hoja de confirmación de clinica-8 (fase B, 12).
  await pulsar(
    botones().find((b) => (b.textContent ?? "").includes("Cerrar y firmar")),
  );
  const ultimo = [...enviado].reverse().find((e) => e.url.endsWith("/cerrar"));
  if (!ultimo) throw new Error("no se ha cerrado nada");
  return ultimo.body as Record<string, unknown>;
}

function bloquesDel(cuerpo: Record<string, unknown>): Record<string, any> {
  return (cuerpo.bloques ?? {}) as Record<string, any>;
}

describe("clinica-10 (1) · la cita de la primera visita", () => {
  it("abre con el servicio reservado YA MARCADO", async () => {
    await montar(LA_CONSULTA);
    expect(
      chipDeServicio("Consulta diagnóstico").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("y el pie dice lo que se cobra, no «Nada que cobrar»", async () => {
    await montar(LA_CONSULTA);
    expect(pieDeSesion()).toContain("Pasa a caja:");
    expect(pieDeSesion()).toContain("Consulta diagnóstico · 20,00 €");
    expect(pieDeSesion()).not.toContain("Nada que cobrar");
    expect(pieDeSesion()).not.toContain("no has marcado nada");
  });

  it("cierra cobrándolo SIN QUE NADIE TOQUE NADA", async () => {
    await montar(LA_CONSULTA);
    const bloques = bloquesDel(await cerrarYMirarElCuerpo());
    expect(bloques.GENERAL?.servicios).toEqual([CONSULTA]);
  });

  it("y desmarcarlo lo quita", async () => {
    await montar(LA_CONSULTA);
    await pulsar(chipDeServicio("Consulta diagnóstico"));
    expect(
      chipDeServicio("Consulta diagnóstico").getAttribute("aria-pressed"),
    ).toBe("false");
    expect(pieDeSesion()).not.toContain("Pasa a caja:");
    const bloques = bloquesDel(await cerrarYMirarElCuerpo());
    expect(bloques.GENERAL?.servicios).toEqual([]);
  });

  it("una recarga no vuelve a marcar lo que se acaba de desmarcar", async () => {
    // clinica-9 (1), la misma regla y el mismo camino: firmar el
    // consentimiento de fotos llama a `cargar()`. Si la semilla viviera
    // fuera del `sembrado`, la consulta volvería marcada.
    await montar(LA_CONSULTA);
    await pulsar(chipDeServicio("Consulta diagnóstico"));
    await pulsar(
      [...host.querySelectorAll('[role="tab"]')].find(
        (x) => (x.textContent ?? "").trim() === "Consentimientos",
      ) as HTMLElement,
    );
    await pulsar(host.querySelector('[data-test="stub-firmar"]'));
    await pulsar(
      [...host.querySelectorAll('[role="tab"]')].find(
        (x) => (x.textContent ?? "").trim() === "Sesión de hoy",
      ) as HTMLElement,
    );
    expect(
      chipDeServicio("Consulta diagnóstico").getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("clinica-10 (1) · la cita de «Cura» no cobra una quiropodia", () => {
  it("marca la cura y NO propone nivel", async () => {
    await montar(LA_CURA);
    expect(chipDeServicio("Cura").getAttribute("aria-pressed")).toBe("true");
    expect(nivelElegidoEnPantalla()).toBeNull();
    expect(pieDeSesion()).toContain("Cura · 13,00 €");
    expect(pieDeSesion()).not.toContain("Quiropodia básica");
  });

  it("y lo dice: la frase del nivel explica por qué no hay nivel", async () => {
    await montar(LA_CURA);
    const caja = host.querySelector('[data-test="nivel-de-quiropodia"]');
    expect(caja?.textContent ?? "").toContain("Hoy no se cobra nivel");
    expect(caja?.textContent ?? "").not.toContain("se propone la básica");
  });

  it("cierra sin nivel: `nivelElegido` va en `null`", async () => {
    await montar(LA_CURA);
    const bloques = bloquesDel(await cerrarYMirarElCuerpo());
    expect(bloques.QUIROPODIA?.nivelElegido).toBeNull();
    expect(bloques.QUIROPODIA?.servicios).toEqual([CURA]);
  });

  it("marcar un acto devuelve el nivel, sin tocar nada más", async () => {
    await montar(LA_CURA);
    await pulsar(
      botones().find((b) => (b.textContent ?? "").startsWith("Deslaminado")),
    );
    expect(nivelElegidoEnPantalla()).toContain("Básica");
    expect(pieDeSesion()).toContain("Quiropodia básica · 25,00 €");
    expect(pieDeSesion()).toContain("Cura · 13,00 €");
  });

  it("y tocar un nivel a mano también, aunque sea el que se propondría", async () => {
    // El toque tiene que HACER algo: «Básica» es el nivel que la
    // propuesta daría, y la regla de clinica-5 («tocar el propuesto
    // vuelve a seguir la propuesta») lo dejaría apagado igual.
    await montar(LA_CURA);
    const caja = host.querySelector('[data-test="nivel-de-quiropodia"]')!;
    await pulsar(
      [...caja.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").startsWith("Básica"),
      ),
    );
    expect(nivelElegidoEnPantalla()).toContain("Básica");
    expect(pieDeSesion()).toContain("Quiropodia básica · 25,00 €");
  });
});

describe("clinica-10 (1) · lo que NO cambia", () => {
  it("con un nivel reservado se sigue proponiendo la básica (clinica-5)", async () => {
    await montar(LA_QUIROPODIA);
    expect(nivelElegidoEnPantalla()).toContain("Básica");
    expect(pieDeSesion()).toContain("Quiropodia básica · 25,00 €");
  });

  it("y el nivel reservado NO se marca como chip: los niveles no son chips", async () => {
    await montar(LA_QUIROPODIA);
    expect(
      botones().some((b) =>
        (b.textContent ?? "").trim().startsWith("Quiropodia completa · "),
      ),
    ).toBe(false);
  });
});

// ── clinica-10 (19b) · al firmar las fotos se vuelve a Fotos ─────────
//
// Para hacer una foto hay que firmar el consentimiento, y el botón que
// lo pide está EN Fotos. Al firmarlo, la pantalla se quedaba en
// Consentimientos: la podóloga tiene la cámara en la mano y la paciente
// con el pie encima, y le tocaba buscar la pestaña otra vez.

describe("clinica-10 (19b) · firmar el consentimiento de fotos", () => {
  async function pestana(nombre: string) {
    await pulsar(
      [...host.querySelectorAll('[role="tab"]')].find(
        (x) => (x.textContent ?? "").trim() === nombre,
      ) as HTMLElement,
    );
  }

  function pestanaActiva(): string {
    const b = [...host.querySelectorAll('[role="tab"]')].find(
      (x) => x.getAttribute("aria-selected") === "true",
    );
    return (b?.textContent ?? "").trim();
  }

  it("se vuelve a Fotos, que es de donde se vino", async () => {
    await montar(LA_CONSULTA);
    await pestana("Fotos");
    await pulsar(host.querySelector('[data-test="ir-a-firmar-fotos"]'));
    expect(pestanaActiva()).toBe("Consentimientos");

    await pulsar(host.querySelector('[data-test="stub-firmar"]'));
    expect(pestanaActiva()).toBe("Fotos");
  });

  it("pero entrando por la pestaña, firmar no mueve a nadie de sitio", async () => {
    // Ahí firmar es el final del recado, no el medio: devolver a Fotos
    // sería moverle la pantalla bajo el dedo.
    await montar(LA_CONSULTA);
    await pestana("Consentimientos");
    await pulsar(host.querySelector('[data-test="stub-firmar"]'));
    expect(pestanaActiva()).toBe("Consentimientos");
  });

  it("y tocar otra pestaña por el camino cancela la vuelta", async () => {
    await montar(LA_CONSULTA);
    await pestana("Fotos");
    await pulsar(host.querySelector('[data-test="ir-a-firmar-fotos"]'));
    await pestana("Sesión de hoy");
    await pestana("Consentimientos");
    await pulsar(host.querySelector('[data-test="stub-firmar"]'));
    expect(pestanaActiva()).toBe("Consentimientos");
  });
});
