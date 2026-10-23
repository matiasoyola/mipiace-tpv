// historia-1 (D-91, D-92) · **LA FRANJA DE ALERTAS Y EL RESIDENTE QUE NO
// ESTÁ, EN LA PANTALLA DE LA PUERTA.**
//
// Lo que esta pantalla cambia es poco y es lo que más se mira: dos
// bloques encima de «¿cómo está hoy?».
//
//   1. **La franja** pinta las frases accionables que manda el servidor
//      —`string[]`— y nada más. Aquí no hay ningún diagnóstico que
//      pintar, y no por costumbre: no llega. Lo que este fichero fija es
//      que la banda **existe, se lee y no está cuando no hay nada**.
//   2. **El ausente**: cuando alguien está fuera, lo de abajo **no se
//      pinta**. Ni «¿cómo está hoy?» ni «toca ahora» ni los botones —
//      porque pedirle a la auxiliar que registre la higiene de quien está
//      en el hospital es pedirle que invente un cuidado, y un «como
//      siempre» de un residente ausente es un dato falso firmado con su
//      PIN.
//
// Y **la auxiliar no gana ni un toque** (D-97): las dos cosas son texto.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PuertaLoQueToca } from "../src/residencia/PuertaLoQueToca.js";
import type { LoQueToca } from "../src/residencia/puerta-tipos.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(nodo: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(nodo);
  });
}

const CONTROLES: LoQueToca["controles"] = [
  {
    code: "CAMBIO_POSTURAL",
    nombre: "Cambio postural",
    layer: "EXEC",
    nature: "SCHEDULED",
    valueDomain: "BOOL",
    opciones: [],
  },
];

function datos(
  residente: Partial<LoQueToca["residentes"][number]>,
): LoQueToca {
  return {
    habitacionLibre: false,
    turno: { id: "t-m", code: "M", name: "Mañana" },
    careDay: "2026-10-23",
    residentes: [
      {
        clientId: "carmen",
        bedLabel: "A",
        nombre: "Carmen Gómez",
        tieneFoto: false,
        toca: [
          {
            controlCode: "CAMBIO_POSTURAL",
            nombre: "Cambio postural",
            planItemId: "l1",
            at: "2026-10-23T06:00:00.000Z",
            until: null,
            esFranja: false,
            shiftCode: "M",
            momentCode: null,
          },
        ],
        registros: [],
        ...residente,
      },
    ],
    controles: CONTROLES,
    serverTime: "2026-10-23T08:00:00.000Z",
  };
}

const props = {
  numeroDeHabitacion: "112",
  quien: { nombre: "Ana", rolName: "Auxiliar" },
  segundosParaCerrar: 45,
  dimensiones: [],
  aDemandaPorResidente: {},
  onComoSiempre: () => {},
  onNoComoSiempre: () => {},
  onHecho: () => {},
  onCorregir: () => {},
  onADemanda: () => {},
  onTomarConstante: () => {},
  constantesDisponibles: [],
  onAlgoNoVaBien: () => {},
  onTerminar: () => {},
};

describe("historia-1 · la franja de alertas de la puerta (D-91)", () => {
  it("pinta las frases, y SIN banda cuando no hay alertas", async () => {
    await pintar(
      <PuertaLoQueToca {...props} datos={datos({ alertas: [] })} />,
    );
    // **Nada de un hueco que diga «sin alertas»**: una banda gris en
    // cuarenta puertas es la que hace que nadie mire la roja de la
    // cuarenta y una.
    expect(container.textContent).not.toContain("Sin alertas");
    expect(container.querySelectorAll(".bg-rose-50")).toHaveLength(0);
  });

  it("con alertas, la banda está y las frases se leen", async () => {
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={datos({
          alertas: [
            "Alergia: penicilina",
            "Disfagia: triturado y espesante nivel 2",
            "Lleva sonda",
          ],
        })}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Alergia: penicilina");
    expect(texto).toContain("Disfagia: triturado y espesante nivel 2");
    expect(texto).toContain("Lleva sonda");
  });

  it("y se lee a la distancia de un pasillo: 22 px y negrita", async () => {
    // No es estilo: la banda tiene que ganarle la mirada al nombre, que
    // está justo encima. 22 px es el tamaño de los botones de esta
    // pantalla.
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={datos({ alertas: ["Alergia: penicilina"] })}
      />,
    );
    const linea = [...container.querySelectorAll("li")].find((l) =>
      l.textContent?.includes("penicilina"),
    )!;
    expect(linea.className).toContain("text-[22px]");
    expect(linea.className).toContain("font-semibold");
    // **`block`**, porque un `<li>` con varias frases seguidas saldría en
    // la misma línea y jsdom no lo ve. Es la lección de residencia-6 con
    // los dos botones del PIN.
    expect(linea.className).toContain("block");
  });

  it("cada frase es UNA línea, no un párrafo pegado", async () => {
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={datos({ alertas: ["Alergia: penicilina", "Lleva sonda"] })}
      />,
    );
    const lineas = [...container.querySelectorAll("li")].filter(
      (l) => l.className.includes("text-rose-900"),
    );
    expect(lineas).toHaveLength(2);
  });
});

describe("historia-1 · el residente que no está (D-92)", () => {
  const AUSENTE = {
    corta: "En el hospital",
    frase: "Ausente: ingresado en el hospital desde el martes",
  };

  it("pinta el rótulo corto grande y la frase entera debajo", async () => {
    await pintar(
      <PuertaLoQueToca {...props} datos={datos({ ausente: AUSENTE })} />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("En el hospital");
    expect(texto).toContain("desde el martes");
    expect(texto).toContain("No le toca nada mientras esté fuera");
  });

  it("**y NO pinta lo de abajo**: ni «como siempre» ni «toca ahora»", async () => {
    await pintar(
      <PuertaLoQueToca {...props} datos={datos({ ausente: AUSENTE })} />,
    );
    const texto = container.textContent ?? "";
    // Un «como siempre» de un residente ausente es un dato falso firmado
    // con el PIN de quien lo pulsó.
    expect(texto).not.toContain("Como siempre");
    expect(texto).not.toContain("Toca ahora");
    expect(texto).not.toContain("Algo no va bien");
    expect(
      [...container.querySelectorAll("button")].map((b) => b.textContent),
    ).not.toContain("Como siempre");
  });

  it("pero SÍ el nombre y su franja: es lo que evita que vayan a buscarla", async () => {
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={datos({ ausente: AUSENTE, alertas: ["Alergia: penicilina"] })}
      />,
    );
    const texto = container.textContent ?? "";
    expect(texto).toContain("Carmen Gómez");
    expect(texto).toContain("Alergia: penicilina");
  });

  it("y es AZUL y no rojo: no es una alerta, es una explicación", async () => {
    // Pintarlo del color de una alergia grave gastaría el rojo que la
    // franja de arriba necesita.
    await pintar(
      <PuertaLoQueToca {...props} datos={datos({ ausente: AUSENTE })} />,
    );
    const caja = [...container.querySelectorAll("div")].find((d) =>
      d.className.includes("bg-sky-50"),
    );
    expect(caja, "la tarjeta del ausente no es azul").toBeTruthy();
  });

  it("sin `ausente`, la pantalla es la de siempre", async () => {
    await pintar(<PuertaLoQueToca {...props} datos={datos({})} />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Como siempre");
    expect(texto).toContain("Toca ahora");
  });
});
