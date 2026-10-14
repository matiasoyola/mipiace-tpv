// clinica-7 · las pantallas del bloque, montadas de verdad.
//
// Lo que se fija aquí es lo que un test de API no puede ver:
//
//   1. **La guarda falla ABIERTA.** Sin estado de contrato legible se pinta
//      la historia: la autorización está en `conHistoria`, y esta guarda es
//      la mitad que AYUDA. Fallar cerrada dejaría a la podóloga sin
//      pantalla por una petición que no respondió, con la paciente delante.
//   2. **El aviso al que NO es la dueña** no lleva el texto del contrato ni
//      el botón.
//   3. **La banda de solo lectura** sale solo en solo lectura, con el texto
//      del paquete palabra por palabra, y dice POR QUÉ.
//   4. **La clave de 6 cifras**: el campo es `tel`, acepta solo cifras, se
//      queda en seis, y el botón no se enciende antes.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot + act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AVISO_SOLO_LA_DUENA,
  BANDA_SOLO_LECTURA,
  CONTRATO_VIGENTE,
  VERSION_VIGENTE,
} from "@mipiacetpv/contrato-encargado";

// ── El doble de la API ──────────────────────────────────────────────

const llamadas: Array<{ path: string; body?: unknown }> = [];
let respuestaDelContrato: unknown = null;
let fallaElContrato = false;
/** El 423 de `conHistoria` cuando no hay contrato aceptado. */
let fallaLaHistoriaCon423 = false;

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
    if (path === "/clinica/contrato") {
      if (fallaElContrato) throw new ApiErrorFake(500, "se cayó");
      return respuestaDelContrato;
    }
    if (fallaLaHistoriaCon423 && path.includes("/historia")) {
      throw new ApiErrorFake(
        423,
        "La historia clínica todavía no está activa: la dueña tiene que aceptar el contrato de tratamiento de datos.",
        "CONTRATO_SIN_ACEPTAR",
      );
    }
    return {};
  }),
  apiBlobWithCashier: vi.fn(async () => ({
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
    headers: new Headers(),
  })),
  apiBlobPublic: vi.fn(async () => ({
    blob: new Blob(["%PDF-"], { type: "application/pdf" }),
    headers: new Headers(),
  })),
  apiPublic: vi.fn(async () => ({
    clinica: "Clínica del Pie",
    pideCodigo: true,
    aperturasRestantes: 3,
  })),
}));

const {
  BandaDeSoloLectura,
  GuardaDelContrato,
  PantallaDeAceptacion,
  SeccionDelContrato,
} = await import("../src/clinica/ContratoDeTratamiento.js");
const { InformePublico, tokenDelInformeEnLaUrl } = await import(
  "../src/clinica/InformePublico.js"
);
const { HistoriaViva } = await import("../src/clinica/HistoriaViva.js");

let host: HTMLDivElement;
let root: Root;

function vista(over: Record<string, unknown> = {}) {
  return {
    estado: { estado: "VIGENTE", versionAceptada: VERSION_VIGENTE },
    versionVigente: VERSION_VIGENTE,
    pendienteDeValidar: CONTRATO_VIGENTE.pendienteDeValidar,
    titulo: CONTRATO_VIGENTE.titulo,
    apartados: CONTRATO_VIGENTE.apartados,
    huellaVigente: "a".repeat(64),
    aceptaciones: [],
    puedeAceptar: true,
    ...over,
  } as never;
}

async function montar(nodo: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(nodo);
  });
}

const texto = () => host.textContent ?? "";
const botones = () =>
  [...host.querySelectorAll("button")] as HTMLButtonElement[];
const botonConTexto = (t: string | RegExp) =>
  botones().find((b) =>
    typeof t === "string" ? b.textContent?.includes(t) : t.test(b.textContent ?? ""),
  );

async function pulsar(b: HTMLButtonElement | undefined) {
  expect(b, "no se encontró el botón").toBeTruthy();
  await act(async () => {
    b!.click();
  });
}

async function escribir(campo: HTMLInputElement, valor: string) {
  await act(async () => {
    // Lo que React escucha es `input`, y el valor hay que ponerlo por el
    // setter nativo para que el `useState` se enteré (el `value` de React
    // es una propiedad controlada).
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  llamadas.length = 0;
  fallaElContrato = false;
  fallaLaHistoriaCon423 = false;
  respuestaDelContrato = vista();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

// ── 1 · LA GUARDA ───────────────────────────────────────────────────

describe("clinica-7 · la guarda del contrato", () => {
  it("con el contrato VIGENTE pinta la pantalla y NO la banda", async () => {
    await montar(
      <GuardaDelContrato>
        <p>La historia de Carmen</p>
      </GuardaDelContrato>,
    );
    expect(texto()).toContain("La historia de Carmen");
    expect(texto()).not.toContain(BANDA_SOLO_LECTURA);
  });

  it("en SOLO LECTURA pinta LA BANDA y la pantalla debajo", async () => {
    respuestaDelContrato = vista({
      estado: {
        estado: "SOLO_LECTURA",
        motivo: "REVOCADO",
        versionAceptada: null,
      },
    });
    await montar(
      <GuardaDelContrato>
        <p>La historia de Carmen</p>
      </GuardaDelContrato>,
    );
    expect(texto()).toContain(BANDA_SOLO_LECTURA);
    // Y la historia SIGUE PINTÁNDOSE: se lee y se exporta todo.
    expect(texto()).toContain("La historia de Carmen");
  });

  it("SIN CONTRATO la pantalla de dentro NO SE MONTA", async () => {
    // La API no da datos, así que no hay historia que pintar: enseñarla
    // vacía sería enseñar una historia que parece no tener nada.
    respuestaDelContrato = vista({ estado: { estado: "SIN_CONTRATO" } });
    await montar(
      <GuardaDelContrato>
        <p>La historia de Carmen</p>
      </GuardaDelContrato>,
    );
    expect(texto()).toContain(CONTRATO_VIGENTE.titulo);
    expect(texto()).not.toContain("La historia de Carmen");
  });

  it("SI LA PETICIÓN FALLA, pinta la pantalla: falla ABIERTA", async () => {
    // La autorización está en `conHistoria`. Fallar cerrada aquí dejaría a
    // la podóloga sin pantalla por una petición que no respondió, con la
    // historia perfectamente legible.
    fallaElContrato = true;
    await montar(
      <GuardaDelContrato>
        <p>La historia de Carmen</p>
      </GuardaDelContrato>,
    );
    expect(texto()).toContain("La historia de Carmen");
  });

  it("y con una respuesta de OTRA FORMA, también", async () => {
    // Lo encontró la suite de pantallas de clinica-6: mockea la API por
    // path y le devolvía a esta guarda la respuesta de la historia. Una
    // guarda que asume la forma de lo que le llega revienta la pantalla el
    // día que la ruta cambie.
    respuestaDelContrato = { zonas: [], visitas: [] };
    await montar(
      <GuardaDelContrato>
        <p>La historia de Carmen</p>
      </GuardaDelContrato>,
    );
    expect(texto()).toContain("La historia de Carmen");
  });
});

// ── 2 · LA PANTALLA DE ACEPTACIÓN ───────────────────────────────────

describe("clinica-7 · la pantalla de aceptación", () => {
  it("la dueña ve el texto ENTERO, la huella y el aviso de pendiente", async () => {
    await montar(
      <PantallaDeAceptacion
        vista={vista({ estado: { estado: "SIN_CONTRATO" } })}
        onAceptado={() => {}}
      />,
    );
    // Los nueve apartados, no un resumen.
    for (const a of CONTRATO_VIGENTE.apartados) {
      expect(texto(), `falta el apartado «${a.encabezado}»`).toContain(
        a.encabezado,
      );
    }
    expect(texto()).toContain("Huella del texto");
    expect(texto()).toContain("pendiente de que lo revise un abogado");
  });

  it("el botón NO se enciende sin marcar que se ha leído", async () => {
    await montar(
      <PantallaDeAceptacion
        vista={vista({ estado: { estado: "SIN_CONTRATO" } })}
        onAceptado={() => {}}
      />,
    );
    const boton = botonConTexto("Aceptar y activar")!;
    expect(boton.disabled).toBe(true);

    const casilla = host.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      casilla.click();
    });
    expect(botonConTexto("Aceptar y activar")!.disabled).toBe(false);
  });

  it("al aceptar llama a la ruta y avisa a quien la montó", async () => {
    const avisado = vi.fn();
    await montar(
      <PantallaDeAceptacion
        vista={vista({ estado: { estado: "SIN_CONTRATO" } })}
        onAceptado={avisado}
      />,
    );
    const casilla = host.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      casilla.click();
    });
    await pulsar(botonConTexto("Aceptar y activar"));
    expect(avisado).toHaveBeenCalled();
    expect(llamadas.at(-1)?.path).toBe("/clinica/contrato/aceptar");
  });

  it("QUIEN NO ES LA DUEÑA ve el aviso y NO el texto del contrato", async () => {
    await montar(
      <PantallaDeAceptacion
        vista={vista({
          estado: { estado: "SIN_CONTRATO" },
          puedeAceptar: false,
        })}
        onAceptado={() => {}}
      />,
    );
    expect(texto()).toContain(AVISO_SOLO_LA_DUENA);
    // Ni un apartado del contrato, ni el botón.
    expect(texto()).not.toContain(CONTRATO_VIGENTE.apartados[0]!.encabezado);
    expect(botonConTexto("Aceptar")).toBeUndefined();
  });
});

// ── 3 · LA BANDA ────────────────────────────────────────────────────

describe("clinica-7 · la banda de solo lectura", () => {
  it("sale SOLO en solo lectura", async () => {
    for (const estado of [
      { estado: "VIGENTE", versionAceptada: 1 },
      { estado: "SIN_CONTRATO" },
      { estado: "APAGADO" },
      null,
    ]) {
      await montar(<BandaDeSoloLectura estado={estado as never} />);
      expect(texto()).not.toContain(BANDA_SOLO_LECTURA);
      await act(async () => root.unmount());
      host.remove();
    }
    // El `afterEach` desmonta otra vez; `unmount` es idempotente.
    await montar(<span />);
  });

  it("y dice POR QUÉ: revocado", async () => {
    await montar(
      <BandaDeSoloLectura
        estado={
          {
            estado: "SOLO_LECTURA",
            motivo: "REVOCADO",
            versionAceptada: null,
          } as never
        }
      />,
    );
    expect(texto()).toContain(BANDA_SOLO_LECTURA);
    expect(texto()).toContain("La dueña lo revocó");
  });

  it("y por qué: versión nueva sin aceptar", async () => {
    await montar(
      <BandaDeSoloLectura
        estado={
          {
            estado: "SOLO_LECTURA",
            motivo: "VERSION_ANTIGUA",
            versionAceptada: 1,
          } as never
        }
      />,
    );
    expect(texto()).toContain("versión nueva del contrato sin aceptar");
  });
});

// ── 4 · LA SECCIÓN DEL PANEL ────────────────────────────────────────

describe("clinica-7 · la sección del contrato", () => {
  it("enseña quién lo aceptó y cuándo, y NO una fila por revocación", async () => {
    respuestaDelContrato = vista({
      estado: {
        estado: "SOLO_LECTURA",
        motivo: "REVOCADO",
        versionAceptada: null,
      },
      aceptaciones: [
        {
          id: "a1",
          version: 1,
          huella: "b".repeat(64),
          aceptadoEn: "2026-10-14T08:00:00.000Z",
          quien: "Rosario",
          aparato: "Tablet de consulta",
          revocado: true,
          revocadoEn: "2026-10-20T09:00:00.000Z",
          revocadoPor: "Rosario",
          textoDisponible: true,
        },
      ],
    });
    await montar(<SeccionDelContrato />);
    expect(texto()).toContain("Aceptado por Rosario");
    expect(texto()).toContain("Tablet de consulta");
    expect(texto()).toContain("Revocado por Rosario");
    // UNA tarjeta, no dos: la revocación marca su aceptación.
    expect(host.querySelectorAll("li")).toHaveLength(1);
  });

  it("revocar PIDE CONFIRMACIÓN, y la confirmación dice las consecuencias", async () => {
    await montar(<SeccionDelContrato />);
    await pulsar(botonConTexto("Revocar el contrato"));
    expect(texto()).toContain("¿Revocar el contrato");
    // Las consecuencias, no un «¿seguro?».
    expect(texto()).toContain("solo lectura");
    expect(texto()).toContain("No se podrá escribir nada clínico nuevo");
    expect(texto()).toContain("no admitirán notas");
    expect(texto()).toContain("La agenda y la caja siguen funcionando");
    // Y no se ha llamado a nada todavía.
    expect(llamadas.some((l) => l.path.includes("revocar"))).toBe(false);
  });

  it("y «No, dejarlo como está» no revoca", async () => {
    await montar(<SeccionDelContrato />);
    await pulsar(botonConTexto("Revocar el contrato"));
    await pulsar(botonConTexto("No, dejarlo como está"));
    expect(llamadas.some((l) => l.path.includes("revocar"))).toBe(false);
  });

  it("y la devolución de datos está aquí, con su botón", async () => {
    await montar(<SeccionDelContrato />);
    expect(texto()).toContain("Llevarte todas las historias");
    expect(botonConTexto("Descargar todas las historias")).toBeTruthy();
  });
});

// ── 5 · EL ENLACE DEL INFORME ───────────────────────────────────────

describe("clinica-7 · la pantalla pública del informe", () => {
  it("el token sale de la ruta y nada más", () => {
    expect(tokenDelInformeEnLaUrl(`/informe/${"a".repeat(43)}`)).toBe(
      "a".repeat(43),
    );
    // Recortada, de otra longitud, o con el código pegado detrás: no es un
    // token. Y lo último importa: el código NO va en la URL.
    expect(tokenDelInformeEnLaUrl("/informe/corto")).toBeNull();
    expect(
      tokenDelInformeEnLaUrl(`/informe/${"a".repeat(43)}/042318`),
    ).toBeNull();
    expect(tokenDelInformeEnLaUrl(`/valoracion/${"a".repeat(43)}`)).toBeNull();
  });

  it("pide la clave y NO enseña nada de la historia", async () => {
    await montar(<InformePublico token={"a".repeat(43)} />);
    expect(texto()).toContain("Su documento está protegido con una clave");
    expect(texto()).toContain("Clínica del Pie");
    // Dice que la clave NO va en el correo, que es la mitad del mecanismo.
    expect(texto()).toContain("No va en el correo");
    // Ni el tipo de informe ni el nombre de nadie.
    expect(texto().toLowerCase()).not.toContain("resumen");
    expect(texto().toLowerCase()).not.toContain("derivación");
  });

  it("el campo acepta SOLO cifras y se queda en seis", async () => {
    await montar(<InformePublico token={"a".repeat(43)} />);
    const campo = host.querySelector("#codigo-informe") as HTMLInputElement;
    await escribir(campo, "0a4b2c318999");
    expect(campo.value).toBe("042318");
  });

  it("el botón no se enciende con menos de seis cifras", async () => {
    await montar(<InformePublico token={"a".repeat(43)} />);
    const campo = host.querySelector("#codigo-informe") as HTMLInputElement;
    await escribir(campo, "04231");
    expect(botonConTexto("Abrir el documento")!.disabled).toBe(true);
    await escribir(campo, "042318");
    expect(botonConTexto("Abrir el documento")!.disabled).toBe(false);
  });

  it("el campo es `tel`: teclado numérico sin comerse el cero de delante", async () => {
    // Con `number`, `042318` se convierte en `42318` y la persona no
    // entiende por qué falla.
    await montar(<InformePublico token={"a".repeat(43)} />);
    const campo = host.querySelector("#codigo-informe") as HTMLInputElement;
    expect(campo.type).toBe("tel");
    expect(campo.inputMode).toBe("numeric");
    expect(campo.maxLength).toBe(6);
  });

  it("y el objetivo táctil del campo y del botón llega a 48 px", async () => {
    // La abre un paciente mayor en su móvil. Es el mismo mínimo que
    // clinica-4 midió en sus cuatro pantallas.
    await montar(<InformePublico token={"a".repeat(43)} />);
    const campo = host.querySelector("#codigo-informe") as HTMLInputElement;
    const boton = botonConTexto("Abrir el documento")!;
    for (const el of [campo, boton]) {
      // jsdom no calcula layout, así que lo que se comprueba es la clase
      // que lo fija — que es lo que el bucle visual mide después de
      // verdad, sobre la página.
      expect(el.className).toMatch(/min-h-\[56px\]/);
    }
  });
});

// ── 5 · LA GUARDA, POR FUERA DE LA PANTALLA ─────────────────────────
//
// El agujero que encontró el bucle visual del bloque, y que ninguna suite
// veía: la guarda envolvía el árbol de la historia YA CARGADA, así que con
// el contrato sin aceptar la petición daba 423, `HistoriaViva` salía por su
// rama de error y devolvía el mensaje crudo ANTES de llegar a la guarda.
//
// Lo que veía la dueña: un recuadro rojo diciendo que la dueña tiene que
// aceptar el contrato, sin ninguna forma de aceptarlo. La pantalla de
// aceptación existía y no se podía alcanzar desde la ficha de un cliente.

describe("clinica-7 · la guarda envuelve también la rama de error", () => {
  it("con el 423 de la historia, la DUEÑA ve la pantalla de aceptación", async () => {
    respuestaDelContrato = vista({
      estado: { estado: "SIN_CONTRATO" },
      puedeAceptar: true,
    });
    fallaLaHistoriaCon423 = true;
    await montar(<HistoriaViva clientId="c1" />);
    // El texto del contrato y el botón: lo que hace falta para salir del
    // bloqueo.
    expect(texto()).toContain(CONTRATO_VIGENTE.titulo);
    expect(botonConTexto("Aceptar y activar la historia clínica")).toBeTruthy();
  });

  it("y quien no es la dueña ve el aviso, no el mensaje crudo del 423", async () => {
    respuestaDelContrato = vista({
      estado: { estado: "SIN_CONTRATO" },
      puedeAceptar: false,
    });
    fallaLaHistoriaCon423 = true;
    await montar(<HistoriaViva clientId="c1" />);
    expect(texto()).toContain(AVISO_SOLO_LA_DUENA);
    // Y NO el texto del contrato: el que no acepta no tiene que leerlo
    // entero para entender que no le toca a él.
    expect(texto()).not.toContain(CONTRATO_VIGENTE.apartados[0]!.encabezado);
  });

  it("en SOLO LECTURA la banda sale aunque la historia esté cargando", async () => {
    // La banda es lo que evita media hora de trabajo que se va a rechazar.
    // Si saliera solo con la historia ya pintada, llegaría tarde.
    respuestaDelContrato = vista({
      estado: {
        estado: "SOLO_LECTURA",
        motivo: "REVOCADO",
        versionAceptada: null,
      },
    });
    fallaLaHistoriaCon423 = true;
    await montar(<HistoriaViva clientId="c1" />);
    expect(texto()).toContain(BANDA_SOLO_LECTURA);
  });
});
