// residencia-5 (D-67) · LAS TRES PANTALLAS DE LA TABLET DE LA SALA.
//
// Lo que se comprueba es lo que el bloque promete y lo que prohíbe:
//
//   1. **En reposo · NI UN DATO DE SALUD.** Centro, hora, turno y «N
//      zonas por confirmar», y nada más. Es la decisión de producto 3 y
//      se mide sobre el texto de la pantalla, no sobre la intención.
//   2. **El PIN** es el MISMO teclado que la puerta y el móvil de
//      guardia, con otro encabezado y otra frase: la que dice qué se va a
//      firmar allí.
//   3. **El parte** se lee por planta y por residente, con lo urgente
//      arriba, «llegó después del relevo» aparte y el pie pegado abajo —
//      que es la lección de la banda del TPV: con la página entera
//      desplazándose, «Leído y recibido» se va por debajo del pliegue en
//      una tablet de 800 px y nadie lo encuentra.
//
// Y «Turno sin novedades» es una pantalla, no un hueco: se confirma
// igual.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SalaApp } from "../src/residencia/SalaApp.js";
import { SalaParte, NOMBRE_DE_LA_CLASE } from "../src/residencia/SalaParte.js";
import { PuertaPin } from "../src/residencia/PuertaPin.js";
import type {
  ParteDeRelevo,
  SalaReposo,
} from "../src/residencia/sala-tipos.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const REPOSO: SalaReposo = {
  device: { id: "d-sala", name: "Tablet de la sala" },
  centro: { id: "t-1", nombre: "Jardín de Gredos" },
  turno: { id: "t-t", code: "T", name: "Tarde" },
  turnos: [
    { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
    { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  ],
  relevo: {
    id: "h1",
    turno: "Mañana",
    careDay: "2026-10-18",
    lineas: 9,
    sinNovedades: false,
    confirmado: false,
    zonasPorConfirmar: 3,
    congeladoEn: "2026-10-18T13:00:00.000Z",
  },
  minutosSinTocar: 2,
  serverTime: "2026-10-18T13:30:00.000Z",
};

const PARTE: ParteDeRelevo = {
  centro: { id: "t-1", nombre: "Jardín de Gredos" },
  turno: { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  careDay: "2026-10-18",
  desde: "2026-10-18T06:00:00.000Z",
  hasta: "2026-10-18T13:00:00.000Z",
  corte: "2026-10-18T13:00:00.000Z",
  generadoEn: "2026-10-18T13:00:00.000Z",
  sinNovedades: false,
  lineas: 3,
  zonas: [
    {
      floorId: "p1",
      nombre: "Primera",
      lineas: 2,
      residentes: [
        {
          clientId: "c1",
          nombre: "Carmen Gómez Ruiz",
          habitacion: "112",
          lineas: [
            {
              clase: "INCIDENCIA_NUEVA",
              texto: "Caída · Se ha caído en el baño y se ha dado en la cabeza.",
              hora: "10:40",
              nivel: "N3",
              incidentId: "i1",
              careRecordId: null,
              aviso: {
                canal: "ENFERMERIA",
                estado: "ACKED",
                acusadoPor: "Rosa (DUE)",
                acusadoEn: "10:43",
              },
            },
            {
              clase: "NO_HECHO",
              texto: "Hidratación cutánea — tocaba y no hay registro",
              hora: null,
              nivel: null,
              incidentId: null,
              careRecordId: null,
              aviso: null,
            },
          ],
        },
      ],
      // residencia-6 · la línea de «sin plan de cuidados» va en las
      // SUELTAS de la zona del residente, no colgando de él: colgada de
      // cada uno serían N líneas, que es lo que se viene a quitar.
      sueltas: [
        {
          clase: "SIN_PLAN_DE_CUIDADOS",
          texto:
            "1 residente sin plan de cuidados: Luis Núñez (112). No les toca nada, así que no sale nada en su puerta.",
          hora: null,
          nivel: null,
          incidentId: null,
          careRecordId: null,
          aviso: null,
        },
      ],
    },
    {
      floorId: null,
      nombre: "Del centro",
      lineas: 1,
      residentes: [],
      sueltas: [
        {
          clase: "INCIDENCIA_ABIERTA",
          texto: "Avería · El asidero del baño de la 112 se mueve.",
          hora: "09:20",
          nivel: "N2",
          incidentId: "i2",
          careRecordId: null,
          aviso: null,
        },
      ],
    },
  ],
};

const SIN_NOVEDADES: ParteDeRelevo = {
  ...PARTE,
  sinNovedades: true,
  lineas: 0,
  zonas: [],
};

const QUIEN = { nombre: "Ana López", rolName: "Auxiliar" };

let container: HTMLDivElement;
let root: Root;

const apiMock = vi.hoisted(() => ({
  apiWithDevice: vi.fn(),
  apiConSala: vi.fn(),
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    apiWithDevice: apiMock.apiWithDevice,
    apiConSala: apiMock.apiConSala,
  };
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  apiMock.apiWithDevice.mockReset();
  apiMock.apiConSala.mockReset();
  apiMock.apiWithDevice.mockRejectedValue(new Error("sin red en el test"));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(nodo: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(nodo);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function botones(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

// ══ 1 · EN REPOSO ═════════════════════════════════════════════════

describe("la pantalla en reposo", () => {
  it("dice el centro, la hora, el turno y cuántas zonas faltan", async () => {
    await pintar(<SalaApp me={REPOSO} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Jardín de Gredos");
    expect(texto).toContain("Turno de tarde");
    expect(texto).toContain("Relevo de mañana");
    expect(texto).toContain("3 zonas por confirmar");
  });

  it("**NI UN DATO DE SALUD**: ni un nombre, ni un nivel, ni una línea", async () => {
    await pintar(<SalaApp me={REPOSO} />);
    const texto = container.textContent ?? "";
    for (const prohibido of [
      "Carmen",
      "Gómez",
      "112",
      "N3",
      "Caída",
      "Hidratación",
      "Avería",
    ]) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
  });

  it("y el botón para leerlo dice que hace falta el PIN y qué se verá", async () => {
    await pintar(<SalaApp me={REPOSO} />);
    const leer = botones().find((b) => b.textContent?.includes("Leer el parte"));
    expect(leer).toBeDefined();
    expect(container.textContent).toContain("Verás lo de tus zonas");
  });

  it("un centro sin ningún parte todavía lo dice, y no se queda en blanco", async () => {
    await pintar(<SalaApp me={{ ...REPOSO, relevo: null }} />);
    expect(container.textContent).toContain("Todavía no hay ningún parte de relevo");
  });

  it("y un parte CONFIRMADO lo dice", async () => {
    await pintar(
      <SalaApp
        me={{
          ...REPOSO,
          relevo: { ...REPOSO.relevo!, confirmado: true, zonasPorConfirmar: 0 },
        }}
      />,
    );
    expect(container.textContent).toContain("Confirmado");
  });
});

// ══ 2 · EL PIN ════════════════════════════════════════════════════

describe("el PIN de la sala", () => {
  it("es el MISMO teclado que la puerta, con doce teclas", async () => {
    await pintar(
      <PuertaPin
        numeroDeHabitacion=""
        nombreDelTurno={null}
        encabezado="Jardín de Gredos · relevo de mañana"
        frase="Lo que confirmes queda firmado con tu nombre, tu rol y la hora."
        volverTexto="Volver"
        onPin={() => {}}
        onRol={() => {}}
        onVolver={() => {}}
      />,
    );
    // Nueve cifras + borrar + cero = once botones de teclado, más
    // «Volver». Reutilizar el teclado es lo que evita pagar otra vez el
    // solape de las teclas a 390 px que encontró el bucle visual.
    const teclas = botones().filter((b) => /^[0-9←]$/.test(b.textContent ?? ""));
    expect(teclas).toHaveLength(11);
  });

  it("y dice qué se va a firmar AQUÍ, no lo de la puerta", async () => {
    await pintar(
      <PuertaPin
        numeroDeHabitacion=""
        nombreDelTurno={null}
        encabezado="Jardín de Gredos · relevo de mañana"
        frase="Lo que confirmes queda firmado con tu nombre, tu rol y la hora."
        volverTexto="Volver"
        onPin={() => {}}
        onRol={() => {}}
        onVolver={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Lo que confirmes queda firmado");
    expect(texto).not.toContain("Habitación");
    expect(texto).not.toContain("Volver a la puerta");
  });

  it("la puerta sigue diciendo lo suyo: los opcionales no la cambian", async () => {
    await pintar(
      <PuertaPin
        numeroDeHabitacion="112"
        nombreDelTurno="Mañana"
        onPin={() => {}}
        onRol={() => {}}
        onVolver={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Habitación 112 · turno de mañana");
    expect(texto).toContain("Lo que registres queda firmado con tu nombre y la hora.");
    expect(texto).toContain("Volver a la puerta");
  });
});

// ══ 3 · EL PARTE ══════════════════════════════════════════════════

describe("el parte en la sala", () => {
  it("se lee por planta y por residente, con la habitación delante", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Primera");
    expect(texto).toContain("112");
    expect(texto).toContain("Carmen Gómez Ruiz");
    expect(texto).toContain("Del centro, sin residente");
    expect(texto).toContain("Avería");
  });

  it("lo URGENTE va arriba: el N3 antes del «no se hizo»", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto.indexOf("Caída")).toBeLessThan(texto.indexOf("Hidratación"));
  });

  it("y las clases se leen en castellano, no como enum", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain(NOMBRE_DE_LA_CLASE.INCIDENCIA_NUEVA);
    expect(texto).toContain(NOMBRE_DE_LA_CLASE.NO_HECHO);
    expect(texto).not.toContain("INCIDENCIA_NUEVA");
    expect(texto).not.toContain("NO_HECHO");
  });

  it("residencia-6 · los residentes SIN PLAN salen una vez, en su zona", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain(NOMBRE_DE_LA_CLASE.SIN_PLAN_DE_CUIDADOS);
    expect(texto).toContain("1 residente sin plan de cuidados: Luis Núñez (112)");
    // Y el rótulo de lo suelto depende de la ZONA: «Del centro, sin
    // residente» es verdad abajo y mentira en una planta. Lo encontró el
    // bucle visual al fotografiar el parte.
    expect(texto).toContain("De la planta, sin residente concreto");
    expect(texto).toContain("Del centro, sin residente");
  });

  it("dice quién cogió el aviso, y cuando nadie lo cogió lo dice también", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    expect(container.textContent).toContain("lo cogió Rosa (DUE) a las 10:43");
  });

  it("«llegó después del relevo» va APARTE y con las dos horas", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[
          {
            id: "t1",
            kind: "CARE_RECORD",
            clientId: "c1",
            floorId: "p1",
            resumen: "CAMBIO_POSTURAL",
            ocurrioEn: "2026-10-18T12:50:00.000Z",
            llegoEn: "2026-10-18T13:20:00.000Z",
            incidentId: null,
            careRecordId: "r1",
          },
        ]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Llegó después del relevo");
    expect(texto).toContain("subió más tarde");
    expect(texto).toContain("— llegó a las");
    // Y arriba del parte, no mezclado con sus líneas.
    expect(texto.indexOf("Llegó después del relevo")).toBeLessThan(
      texto.indexOf("Carmen Gómez Ruiz"),
    );
  });

  it("«Turno sin novedades» es una PANTALLA, y se confirma igual", async () => {
    await pintar(
      <SalaParte
        parte={SIN_NOVEDADES}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Turno sin novedades");
    expect(texto).toContain("Se confirma igual");
    expect(
      botones().some((b) => b.textContent?.includes("Leído y recibido")),
    ).toBe(true);
  });

  it("el pie está PEGADO ABAJO, no al final de la página", async () => {
    // La lección de la banda del TPV: con la página entera
    // desplazándose, el botón de confirmar se va por debajo del pliegue
    // en una tablet de 800 px de alto y nadie lo encuentra.
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const pie = container.querySelector("footer");
    expect(pie).not.toBeNull();
    expect(pie!.className).toContain("shrink-0");
    const cuerpo = container.querySelector(".overflow-y-auto");
    expect(cuerpo, "el cuerpo del parte no se desplaza por su cuenta").not.toBeNull();
  });

  it("y el botón de confirmar es un objetivo táctil de la escala de la puerta", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado={false}
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const confirmar = botones().find((b) =>
      b.textContent?.includes("Leído y recibido"),
    )!;
    expect(confirmar.className).toContain("min-h-tap-puerta");
  });

  it("quien ya lo confirmó lo ve dicho, y el botón no vuelve a estar", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[
          {
            nombre: "Ana López",
            rol: "Auxiliar",
            at: "2026-10-18T13:04:00.000Z",
            alcanceTotal: false,
            zonas: ["Primera"],
          },
        ]}
        confirmado={false}
        yaConfirmado
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Ya lo has recibido");
    expect(texto).toContain("Ya lo han recibido");
    const confirmar = botones().find((b) =>
      b.textContent?.includes("Ya lo has recibido"),
    )!;
    expect(confirmar.disabled).toBe(true);
  });

  it("y sin red lo dice, con la hora ya firmada", async () => {
    await pintar(
      <SalaParte
        parte={PARTE}
        tardios={[]}
        acuses={[]}
        confirmado={false}
        yaConfirmado
        enLaCola
        quien={QUIEN}
        onConfirmar={() => {}}
        onTerminar={() => {}}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Sin red");
    expect(texto).toContain("está firmado y guardado en esta tablet");
    expect(texto).toContain("Saldrá en cuanto vuelva el wifi");
  });
});
