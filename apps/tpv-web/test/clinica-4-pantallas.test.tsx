// clinica-4 · las tres pantallas del bloque, montadas de verdad.
//
// Lo que se fija aquí es lo que un test de API no puede ver:
//
//   1. **No se firma sin trazo**: el botón sale desactivado y se enciende
//      al dibujar.
//   2. **La cámara es la de la app**: NO hay un `input[type=file]` en
//      ninguna de las tres pantallas (decisión 9).
//   3. **La zona se elige antes de disparar**: el disparador nace
//      desactivado y se enciende al tocar una zona.
//   4. **Sin consentimiento de fotos, la pantalla LLEVA A FIRMARLO** en
//      vez de abrir una cámara que va a dar un 409.
//   5. **El comparador** enseña antes y última con su fecha; con una sola
//      foto dice que con la segunda se podrá comparar.
//   6. **Una foto retirada sigue en la rejilla**, marcada.
//   7. **NI UN IMPORTE en el papel del informe.**
//   8. La derivación pide su motivo.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot + act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAPA_PIE_V1 } from "@mipiacetpv/clinica-sesion";

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

// La cámara: el permiso de plataforma es un no-op en el navegador, y
// `getUserMedia` no existe en jsdom. Se dobla lo justo para que la
// pantalla llegue a pintarse — lo que este fichero mira es la pantalla, no
// el vídeo.
vi.mock("../src/platform/camera/CameraPermission.js", () => ({
  ensureCameraPermission: async () => "web" as const,
}));

import { Consentimientos } from "../src/clinica/Consentimientos.js";
import { Fotos } from "../src/clinica/Fotos.js";
import { Informe } from "../src/clinica/Informe.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PACIENTE = "44444444-4444-4444-4444-444444444444";
const CITA = "55555555-5555-5555-5555-555555555555";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  apiMock.apiWithCashier.mockReset();
  apiMock.apiBlobWithCashier.mockReset();
  apiMock.apiBlobWithCashier.mockResolvedValue({
    blob: new Blob(["x"], { type: "image/jpeg" }),
    headers: new Headers(),
  });
  // jsdom no implementa el canvas; la pantalla sólo necesita que
  // `getContext` devuelva algo con los métodos que usa.
  (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext =
    () => ({
      fillRect: () => undefined,
      scale: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      fillStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      strokeStyle: "",
    });
  (
    HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  ).toDataURL = () => "data:image/png;base64,QUJD";
  URL.createObjectURL = () => "blob:x";
  URL.revokeObjectURL = () => undefined;

  // `getUserMedia` no existe en jsdom. Se dobla con un stream de pega:
  // sin esto la pantalla entra por su rama de error y el disparador se
  // queda desactivado — que es justo lo que este fichero quiere poder
  // distinguir de «falta elegir la zona».
  const pista = { stop: () => undefined };
  const stream = { getTracks: () => [pista] } as unknown as MediaStream;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => stream,
      enumerateDevices: async () => [],
    },
  });
  // Y el `<video>` de jsdom no sabe reproducir ni capturar punteros.
  (HTMLMediaElement.prototype as unknown as Record<string, unknown>).play =
    async () => undefined;
  (HTMLElement.prototype as unknown as Record<string, unknown>)
    .setPointerCapture = () => undefined;
});

/**
 * Un evento de puntero que jsdom sí sabe construir.
 *
 * `PointerEvent` no existe en jsdom, y React engancha por NOMBRE de
 * evento: un `MouseEvent` llamado `pointerdown` llega igual a
 * `onPointerDown`. Lo que hay que añadir a mano es el `pointerId`, que es
 * lo único de la interfaz de puntero que la pantalla usa.
 */
function eventoDePuntero(tipo: string, x: number, y: number): Event {
  const e = new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const texto = () => host.textContent ?? "";

async function pulsar(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

// ── Los consentimientos ──────────────────────────────────────────────

const VISTA_CONSENTIMIENTOS = {
  plantillas: [
    {
      id: "cirugia-ungueal",
      titulo: "Consentimiento para cirugía de uña (matricectomía)",
      version: 1,
      parrafos: ["Se me ha explicado en qué consiste la cirugía.", "Riesgos."],
      clinica: true,
      pendienteDeValidar: true,
      laPideLaCita: true,
      vigente: null,
    },
    {
      id: "fotos-clinicas",
      titulo: "Consentimiento para hacer fotos de mi historia clínica",
      version: 1,
      parrafos: ["Autorizo que se hagan fotos de mis pies."],
      clinica: true,
      pendienteDeValidar: true,
      laPideLaCita: false,
      vigente: null,
    },
  ],
  firmados: [],
  pideLaCita: ["cirugia-ungueal"],
};

describe("clinica-4 · el consentimiento se firma con el dedo", () => {
  async function montarConsentimientos(vista = VISTA_CONSENTIMIENTOS) {
    apiMock.apiWithCashier.mockResolvedValue(vista);
    await act(async () => {
      root.render(
        <Consentimientos
          clientId={PACIENTE}
          paciente="Carmen Rodríguez López"
          appointmentId={CITA}
        />,
      );
    });
  }

  it("la lista dice CUÁL pide la cita de hoy", async () => {
    await montarConsentimientos();
    expect(texto()).toContain("Lo pide la cita de hoy");
    // Y el de fotos dice que lo pide la primera foto, no un servicio.
    expect(texto()).toContain("Lo pide la primera foto del paciente");
  });

  it("al abrirlo se lee el texto, con el aviso de que es de ejemplo", async () => {
    await montarConsentimientos();
    await pulsar(host.querySelector('[data-test="plantilla-cirugia-ungueal"]'));
    expect(texto()).toContain("Se me ha explicado en qué consiste la cirugía");
    expect(texto()).toContain("pendiente de revisar por la profesional");
    // Y el nombre del paciente, que es lo que se firma.
    expect(texto()).toContain("Carmen Rodríguez López");
  });

  it("NO SE FIRMA SIN TRAZO: el botón nace desactivado", async () => {
    await montarConsentimientos();
    await pulsar(host.querySelector('[data-test="plantilla-cirugia-ungueal"]'));
    const firmar = host.querySelector(
      '[data-test="firmar"]',
    ) as HTMLButtonElement;
    expect(firmar.disabled).toBe(true);
    expect(texto()).toContain("Falta la firma");
  });

  it("y se enciende al dibujar en la caja de firma", async () => {
    await montarConsentimientos();
    await pulsar(host.querySelector('[data-test="plantilla-cirugia-ungueal"]'));
    const canvas = host.querySelector(
      '[data-test="caja-de-firma"]',
    ) as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    await act(async () => {
      canvas.dispatchEvent(eventoDePuntero("pointerdown", 10, 10));
      canvas.dispatchEvent(eventoDePuntero("pointermove", 40, 30));
    });
    const firmar = host.querySelector(
      '[data-test="firmar"]',
    ) as HTMLButtonElement;
    expect(firmar.disabled).toBe(false);
    expect(texto()).not.toContain("Falta la firma");
  });

  it("firmar manda el PNG, la plantilla y el firmante", async () => {
    await montarConsentimientos();
    await pulsar(host.querySelector('[data-test="plantilla-cirugia-ungueal"]'));
    const canvas = host.querySelector(
      '[data-test="caja-de-firma"]',
    ) as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(eventoDePuntero("pointerdown", 1, 1));
      canvas.dispatchEvent(eventoDePuntero("pointermove", 9, 9));
    });
    apiMock.apiWithCashier.mockResolvedValueOnce({
      consentimiento: {
        id: "c1",
        titulo: "Consentimiento para cirugía de uña (matricectomía)",
        firmadoEn: "2026-10-09T09:34:00.000Z",
        firmante: { clase: "PACIENTE", nombre: null, relacion: null },
        informante: { nombre: "Lucía Martín", colegiado: "45-0312" },
        tienePdf: true,
        revocado: false,
      },
    });
    await pulsar(host.querySelector('[data-test="firmar"]'));
    const llamada = apiMock.apiWithCashier.mock.calls.find(
      ([, opts]: [string, { method?: string }?]) => opts?.method === "POST",
    )!;
    expect(llamada[0]).toBe(
      `/clinica/clients/${PACIENTE}/consentimientos`,
    );
    expect(llamada[1].body).toMatchObject({
      plantillaId: "cirugia-ungueal",
      firmante: { clase: "PACIENTE", nombre: null, relacion: null },
      firmaPngBase64: "QUJD",
    });
    // Y el acuse dice quién firmó y delante de quién.
    expect(texto()).toContain("Firmado por");
    expect(texto()).toContain("Lucía Martín");
  });

  it("con representante pide su nombre y su relación", async () => {
    await montarConsentimientos();
    await pulsar(host.querySelector('[data-test="plantilla-cirugia-ungueal"]'));
    const botones = [...host.querySelectorAll("button")];
    await pulsar(
      botones.find((b) =>
        (b.textContent ?? "").includes("Un familiar o representante"),
      )!,
    );
    const inputs = [...host.querySelectorAll("input")];
    expect(inputs.length).toBe(2);
    expect(texto()).toContain("Qué es del paciente");
  });

  it("y NO hay ningún input[type=file] en toda la pantalla", async () => {
    await montarConsentimientos();
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });
});

// ── Las fotos ────────────────────────────────────────────────────────

function foto(
  id: string,
  hecha: string,
  retirada = false,
): Record<string, unknown> {
  return {
    id,
    zona: "L:h",
    zonaNombre: "Pie izq. · Dedo gordo",
    mapaVersion: 1,
    hecha,
    autor: "Lucía Martín",
    retirada,
    retiradaEn: retirada ? hecha : null,
    retiradaMotivo: retirada ? "Salió en blanco" : null,
    retiradaPor: retirada ? "Lucía Martín" : null,
  };
}

describe("clinica-4 · las fotos", () => {
  async function montarFotos(vista: Record<string, unknown>) {
    apiMock.apiWithCashier.mockResolvedValue(vista);
    await act(async () => {
      root.render(
        <Fotos
          clientId={PACIENTE}
          mapa={MAPA_PIE_V1}
          appointmentId={CITA}
          zonasDeHoy={["L:h"]}
          onFirmarConsentimiento={() => undefined}
        />,
      );
    });
  }

  const SIN_CONSENTIMIENTO = {
    fotos: [],
    comparador: [],
    consentimiento: {
      puede: false,
      plantillaId: "fotos-clinicas",
      mensaje:
        "Antes de la primera foto, el paciente tiene que firmar el consentimiento de fotos clínicas.",
    },
    mapaVersion: 1,
  };

  it("SIN CONSENTIMIENTO lleva a firmarlo, y no abre la cámara", async () => {
    await montarFotos(SIN_CONSENTIMIENTO);
    expect(texto()).toContain("Antes de la primera foto");
    expect(
      host.querySelector('[data-test="ir-a-firmar-fotos"]'),
    ).not.toBeNull();
    // Y no hay botón de hacer foto: la cámara no se abre para dar un 409.
    expect(host.querySelector('[data-test="hacer-foto"]')).toBeNull();
    expect(host.querySelector('input[type="file"]')).toBeNull();
  });

  it("con consentimiento, la cámara se abre y la ZONA va antes del disparo", async () => {
    await montarFotos({
      fotos: [],
      comparador: [],
      consentimiento: { puede: true, plantillaId: "fotos-clinicas", mensaje: "" },
      mapaVersion: 1,
    });
    await pulsar(host.querySelector('[data-test="hacer-foto"]'));
    expect(texto()).toContain("Elige antes de disparar");
    const disparar = host.querySelector(
      '[data-test="disparar"]',
    ) as HTMLButtonElement;
    expect(disparar.disabled).toBe(true);
    expect(texto()).toContain("Elige la zona para poder disparar");

    await pulsar(host.querySelector('[data-test="zona-L:h"]'));
    const yPuede = host.querySelector(
      '[data-test="disparar"]',
    ) as HTMLButtonElement;
    expect(yPuede.disabled).toBe(false);
  });

  it("la cámara NO usa un input[type=file]: es getUserMedia en la app", async () => {
    // Decisión 9, y la razón no es de estilo: un `input file` abre la app
    // de cámara del sistema, que guarda la foto en la galería del aparato
    // antes de dársela a nadie.
    await montarFotos({
      fotos: [],
      comparador: [],
      consentimiento: { puede: true, plantillaId: "fotos-clinicas", mensaje: "" },
      mapaVersion: 1,
    });
    await pulsar(host.querySelector('[data-test="hacer-foto"]'));
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(host.querySelector("video")).not.toBeNull();
    expect(texto()).toContain("nunca en la galería de la tablet");
  });

  it("el COMPARADOR enseña antes y última con su fecha", async () => {
    await montarFotos({
      fotos: [
        foto("b", "2026-09-21T10:00:00.000Z"),
        foto("a", "2026-09-07T10:00:00.000Z"),
      ],
      comparador: [
        {
          zona: "L:h",
          antes: foto("a", "2026-09-07T10:00:00.000Z"),
          ultima: foto("b", "2026-09-21T10:00:00.000Z"),
          cuantas: 2,
        },
      ],
      consentimiento: { puede: true, plantillaId: "fotos-clinicas", mensaje: "" },
      mapaVersion: 1,
    });
    expect(host.querySelector('[data-test="comparador"]')).not.toBeNull();
    expect(texto()).toContain("Antes · 7 sept");
    expect(texto()).toContain("Última · 21 sept");
  });

  it("con UNA sola, lo dice en vez de enseñarla dos veces", async () => {
    await montarFotos({
      fotos: [foto("a", "2026-09-07T10:00:00.000Z")],
      comparador: [
        {
          zona: "L:h",
          antes: null,
          ultima: foto("a", "2026-09-07T10:00:00.000Z"),
          cuantas: 1,
        },
      ],
      consentimiento: { puede: true, plantillaId: "fotos-clinicas", mensaje: "" },
      mapaVersion: 1,
    });
    expect(host.querySelector('[data-test="comparador"]')).toBeNull();
    expect(
      host.querySelector('[data-test="comparador-una-sola"]'),
    ).not.toBeNull();
    expect(texto()).toContain("Con la segunda podrás comparar");
  });

  it("una foto RETIRADA sigue en la rejilla, marcada y con su motivo", async () => {
    await montarFotos({
      fotos: [foto("a", "2026-09-07T10:00:00.000Z", true)],
      comparador: [],
      consentimiento: { puede: true, plantillaId: "fotos-clinicas", mensaje: "" },
      mapaVersion: 1,
    });
    expect(texto()).toContain("RETIRADA");
    expect(texto()).toContain("Salió en blanco");
    expect(texto()).toContain("Una foto no se borra: se retira");
    // Y la retirada no ofrece «Retirar» otra vez.
    const retirar = [...host.querySelectorAll("button")].filter((b) =>
      (b.textContent ?? "").trim().startsWith("Retirar"),
    );
    expect(retirar).toHaveLength(0);
  });
});

// ── El informe ───────────────────────────────────────────────────────

const VISTA_INFORME = {
  informe: {
    tipo: "RESUMEN",
    titulo: "Resumen de la historia",
    subtitulo: "Resumen de la historia clínica.",
    piePropio: null,
    secciones: [
      {
        id: "ALERTAS",
        titulo: "Alertas",
        parrafos: ["Diabetes · Anticoagulación"],
        filas: [],
        grafica: [],
      },
      {
        id: "SESIONES",
        titulo: "Visitas",
        parrafos: [],
        filas: [["7 de septiembre de 2026", "Quiropodia completa", "Corte", "Dolor 7"]],
        grafica: [],
      },
      {
        id: "DOLOR",
        titulo: "Dolor",
        parrafos: ["Mejora en cada visita"],
        filas: [],
        grafica: [
          { fecha: "2026-09-07T10:00:00.000Z", dolor: 7 },
          { fecha: "2026-09-21T10:00:00.000Z", dolor: 3 },
        ],
      },
    ],
  },
  centro: {
    nombre: "Clínica Podológica Demo S.L.",
    nif: "B12345678",
    direccion: "Calle de Ejemplo 1",
    telefono: "915551122",
  },
  profesional: {
    nombre: "Lucía Martín",
    colegiado: "45-0312",
    titulo: "Podología",
  },
  paciente: { nombre: "Carmen Rodríguez López", edad: 78, email: "c@e.com" },
  fecha: "9 de octubre de 2026",
  entregas: [],
};

describe("clinica-4 · el informe", () => {
  async function montarInforme(vista = VISTA_INFORME) {
    apiMock.apiWithCashier.mockResolvedValue(vista);
    await act(async () => {
      root.render(<Informe clientId={PACIENTE} />);
    });
  }

  it("los cuatro tipos y el papel con el colegiado y la fecha", async () => {
    await montarInforme();
    for (const t of ["RESUMEN", "SESIONES", "DERIVACION", "COMPLETA"]) {
      expect(host.querySelector(`[data-test="informe-${t}"]`), t).not.toBeNull();
    }
    const papel = host.querySelector('[data-test="papel"]')!;
    expect(papel.textContent).toContain("Clínica Podológica Demo S.L.");
    expect(papel.textContent).toContain("Col. 45-0312");
    expect(papel.textContent).toContain("Nº de colegiado 45-0312");
    expect(papel.textContent).toContain("9 de octubre de 2026");
    expect(papel.textContent).toContain("Carmen Rodríguez López · 78 años");
  });

  it("NI UN IMPORTE en el papel", async () => {
    await montarInforme();
    const papel = host.querySelector('[data-test="papel"]')!.textContent ?? "";
    expect(papel).not.toContain("€");
    expect(papel).not.toMatch(/\bIVA\b/);
    expect(papel).not.toMatch(/\bTotal\b/i);
  });

  it("la gráfica del dolor se pinta con sus barras", async () => {
    await montarInforme();
    const papel = host.querySelector('[data-test="papel"]')!.textContent ?? "";
    expect(papel).toContain("Mejora en cada visita");
    expect(papel).toContain("7");
    expect(papel).toContain("3");
  });

  it("la DERIVACIÓN pide su motivo, y los otros tres no", async () => {
    await montarInforme();
    expect(host.querySelector('[data-test="motivo-derivacion"]')).toBeNull();
    await pulsar(host.querySelector('[data-test="informe-DERIVACION"]'));
    expect(
      host.querySelector('[data-test="motivo-derivacion"]'),
    ).not.toBeNull();
    expect(texto()).toContain("Sin él no se entrega");
  });

  it("al PROFESIONAL pide su email; al paciente usa el de su ficha", async () => {
    await montarInforme();
    expect(texto()).toContain("Se manda a c@e.com, el email de su ficha");
    const botones = [...host.querySelectorAll("button")];
    await pulsar(
      botones.find((b) => (b.textContent ?? "").trim() === "Otro profesional")!,
    );
    expect(host.querySelector('[data-test="email-profesional"]')).not.toBeNull();
  });

  it("sin email en la ficha, enviar no se puede: se imprime", async () => {
    await montarInforme({
      ...VISTA_INFORME,
      paciente: { ...VISTA_INFORME.paciente, email: null },
    } as typeof VISTA_INFORME);
    const enviar = host.querySelector(
      '[data-test="enviar-email"]',
    ) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    const imprimir = host.querySelector(
      '[data-test="imprimir"]',
    ) as HTMLButtonElement;
    expect(imprimir.disabled).toBe(false);
    expect(texto()).toContain("sólo se puede imprimir");
  });

  it("y al enviarlo dice que el correo no lleva datos de salud", async () => {
    await montarInforme();
    apiMock.apiWithCashier.mockResolvedValueOnce({
      entregaId: "e1",
      enviadoA: "c@e.com",
    });
    await pulsar(host.querySelector('[data-test="enviar-email"]'));
    const aviso = host.querySelector('[data-test="informe-entregado"]');
    expect(aviso?.textContent).toContain("Enviado a c@e.com");
    expect(aviso?.textContent).toContain("no lleva ningún dato de salud");
    expect(aviso?.textContent).toContain("registro de accesos");
  });
});
