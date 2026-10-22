// residencia-3 (D-64) · LAS SEIS PANTALLAS DE LA PUERTA.
//
// Lo que se comprueba aquí es lo que el mockup validado promete y lo que
// el bloque prohíbe. No el estilo: las frases y los tamaños que son
// decisiones.
//
//   1. Reposo · el botón coral, la foto o las iniciales, y NI UN DATO DE
//      SALUD. Lo de salud ya lo fija `residencia-puerta.test.tsx`.
//   2. PIN · la frase que avisa de que lo que se registre queda firmado,
//      el teclado de 120 px, y la elección de rol cuando hay dos.
//   3. Lo que toca · «Como siempre» grande, la franja verde con quién y
//      cuándo, lo hecho en gris con «Corregir», y el botón de la enfermera
//      que NO SE PINTA.
//   4. No como siempre · la promesa de arriba y el recuento de cambios.
//   5. Algo no va bien · los dos campos opcionales y, otra vez, el botón
//      que no está.
//   6. Apuntado · la banda ámbar con las tres cosas en orden, el estado
//      fila a fila y «Deshacer el último».
//
// ── Y UNA COSA QUE NO ES DE ESTILO ──────────────────────────────────
//
// **Nada se anima** en las acciones de alta frecuencia. «Hecho» cambia de
// estado. Un test lo fija porque es la clase de cosa que alguien «mejora»
// con una transición de 200 ms, y veinte toques por turno son cuatro
// segundos del presupuesto de D-05.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PuertaScreen } from "../src/residencia/PuertaScreen.js";
import { PuertaPin } from "../src/residencia/PuertaPin.js";
import { PuertaLoQueToca } from "../src/residencia/PuertaLoQueToca.js";
import { PuertaNoComoSiempre } from "../src/residencia/PuertaNoComoSiempre.js";
import { PuertaAlgoNoVaBien } from "../src/residencia/PuertaAlgoNoVaBien.js";
import { PuertaApuntado } from "../src/residencia/PuertaApuntado.js";
import { iniciales } from "../src/residencia/PuertaFoto.js";
import { dimensionesDeLaObservacion } from "../src/residencia/puerta-gestos.js";
import type {
  ControlDeLaPuerta,
  LoQueToca,
} from "../src/residencia/puerta-tipos.js";
import type { PuertaMeResponse } from "../src/hooks/useDeviceBootstrap.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TURNOS = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00" },
];

const ME: PuertaMeResponse = {
  device: { id: "d-1", name: "Tablet 112" },
  habitacion: {
    id: "h-112",
    number: "112",
    name: null,
    active: true,
    plantaId: "p-1",
    plantaName: "Primera",
  },
  ocupantes: [
    { bedId: "b-a", bedLabel: "A", clientId: "carmen", nombre: "Carmen Gómez" },
    { bedId: "b-b", bedLabel: "B", clientId: "luis", nombre: "Luis Núñez" },
  ],
  turnos: TURNOS,
  serverTime: "2026-10-15T08:00:00.000Z",
};

const CONTROLES: ControlDeLaPuerta[] = [
  "ANIMO",
  "COGNICION",
  "DOLOR",
  "DESCANSO_NOCTURNO",
  "PIEL",
  "INGESTA_DIA",
  "MOVILIDAD",
].map((code) => ({
  id: `id-${code}`,
  code,
  name: code === "ANIMO" ? "Ánimo" : code,
  version: 1,
  layer: "OBS" as const,
  nature: "SCHEDULED" as const,
  valueDomain: "ORDINAL" as const,
  groupCode: null,
  opciones: [
    { code: "COMO_SIEMPRE", label: "Como siempre", isAsUsual: true },
    { code: "APAGADO", label: "Apagado / triste", isAsUsual: false },
  ],
}));

const DIMENSIONES = dimensionesDeLaObservacion(CONTROLES, () => true);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // `fetch` existe pero no contesta: la foto se pide y no llega, así que
  // se pintan las iniciales. Es lo que pasa sin red y es el caso que más
  // interesa de esta pantalla.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function pintar(nodo: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(nodo);
  });
}

/** Lo mismo, devolviendo el `rerender` para los casos que tienen que
 *  cambiar una prop SIN perder el estado del componente. Lo pide
 *  residencia-6: un error no puede devolver el teclado a cuatro
 *  casillas, y eso sólo se ve volviendo a pintar el mismo árbol. */
async function pintarConRerender(nodo: React.ReactNode): Promise<{
  rerender: (otro: React.ReactNode) => Promise<void>;
}> {
  await pintar(nodo);
  return { rerender: pintar };
}

function pulsar(texto: string): void {
  const botones = [...container.querySelectorAll("button")];
  const b = botones.find((x) => x.textContent?.includes(texto));
  if (!b) throw new Error(`no hay botón «${texto}»`);
  act(() => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * El botón cuyo texto es EXACTAMENTE ése.
 *
 * Hace falta en la pantalla 4 y la razón es de diseño, no de test: cuando
 * se elige una opción, la cabecera de la tarjeta pasa a decir esa misma
 * etiqueta debajo del nombre («Ánimo / Apagado / triste»), que es
 * justamente lo que hace que se vea lo elegido sin abrirla. Así que
 * buscar «por contiene» encuentra la CABECERA antes que la opción.
 *
 * Es la clase de ambigüedad que un test con un localizador flojo esconde
 * y que un dedo no tiene: la cabecera ocupa toda la fila de arriba y las
 * opciones están debajo.
 */
function pulsarExacto(texto: string): void {
  const botones = [...container.querySelectorAll("button")];
  const b = botones.find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay botón que diga exactamente «${texto}»`);
  act(() => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ══ 1 · REPOSO ════════════════════════════════════════════════════
describe("pantalla 1 · en reposo", () => {
  it("el botón coral a todo el ancho dice «Toca para registrar»", async () => {
    await pintar(<PuertaScreen me={ME} onRegistrar={() => {}} />);
    const b = [...container.querySelectorAll("button")].find((x) =>
      x.textContent?.includes("Toca para registrar"),
    );
    expect(b).toBeTruthy();
    // 96 px: por encima del `tap-puerta` de 72, porque es la única acción
    // de la pantalla y se toca de pie, de lado y con guantes.
    expect(b!.className).toContain("min-h-[96px]");
    expect(b!.className).toContain("bg-mipiace-coral");
  });

  it("sin PIN configurado en el centro, el botón NO SE PINTA", async () => {
    // Un botón que lleva a una pantalla donde ningún PIN entra es un botón
    // que no sirve. `onRegistrar` ausente = la pantalla de residencia-1.
    await pintar(<PuertaScreen me={ME} />);
    expect(container.textContent).not.toContain("Toca para registrar");
  });

  it("SIN FOTO servible, LAS INICIALES en el mismo hueco", async () => {
    // Y el hueco es el mismo tamaño: si fuera más pequeño, la tarjeta de
    // quien no tiene consentimiento se leería distinta — y lo que
    // distingue a esas dos personas no es nada que tenga que verse en un
    // pasillo.
    await pintar(<PuertaScreen me={ME} fotos={{}} />);
    expect(container.textContent).toContain("CG");
    expect(container.textContent).toContain("LN");
  });

  it("las iniciales son NOMBRE + PRIMER APELLIDO", () => {
    expect(iniciales("Carmen Gómez Ruiz")).toBe("CG");
    expect(iniciales("Luis")).toBe("L");
    expect(iniciales("  ")).toBe("·");
  });

  it("y la banda de la cola dice QUE NO HAY QUE REPETIR NADA", async () => {
    await pintar(<PuertaScreen me={ME} pendientes={3} />);
    expect(container.textContent).toContain("3 registros guardados en la tablet");
    expect(container.textContent).toContain("No hay que repetir nada");
  });

  it("y con cero pendientes no hay banda", async () => {
    await pintar(<PuertaScreen me={ME} pendientes={0} />);
    expect(container.textContent).not.toContain("pendientes de enviar");
  });
});

// ══ 2 · EL PIN ════════════════════════════════════════════════════
describe("pantalla 2 · el PIN", () => {
  const props = {
    numeroDeHabitacion: "112",
    nombreDelTurno: "Mañana",
    onPin: () => {},
    onRol: () => {},
    onVolver: () => {},
  };

  it("dice QUÉ VA A PASAR con lo que se registre", async () => {
    // No es decoración: es el consentimiento informado de quien teclea, y
    // tiene que decirse DONDE se teclea.
    await pintar(<PuertaPin {...props} />);
    expect(container.textContent).toContain(
      "Lo que registres queda firmado con tu nombre y la hora",
    );
    expect(container.textContent).toContain("Habitación 112 · turno de mañana");
    expect(container.textContent).toContain("Volver a la puerta");
  });

  it("el teclado es 3×4, y sus teclas 120 px en la tablet y 96 en el móvil", async () => {
    await pintar(<PuertaPin {...props} />);
    const teclas = [...container.querySelectorAll("button")].filter((b) =>
      b.className.includes("tap-puerta-tecla"),
    );
    // Diez dígitos y el borrar. El hueco de abajo a la derecha no es un
    // botón: poner «Entrar» ahí invitaría a pulsarlo cuando el PIN ya se
    // ha enviado solo.
    expect(teclas).toHaveLength(11);
    for (const t of teclas) {
      // residencia-4 · dos tamaños. La misma pantalla la usa el móvil de
      // guardia para ponerse de guardia (D-66), y a 390 px tres teclas
      // de 120 no caben: se pisaban. 96 px en el móvil —el
      // `tap-valoracion` que ya existe— y 120 en la tablet.
      //
      // Lo encontró el bucle visual y no este test: en jsdom no hay
      // layout, así que contar las teclas y mirar su clase seguía verde
      // con las teclas una encima de otra. Lo que este test puede
      // sostener es que las DOS medidas están declaradas.
      expect(t.className).toContain("lg:h-tap-puerta-tecla");
      expect(t.className).toContain("h-tap-valoracion");
    }
  });

  it("NADA SE ANIMA al pulsar: cambia de fondo", async () => {
    await pintar(<PuertaPin {...props} />);
    const teclas = [...container.querySelectorAll("button")].filter((b) =>
      b.className.includes("w-tap-puerta-tecla"),
    );
    for (const t of teclas) {
      expect(t.className).not.toContain("transition");
      expect(t.className).not.toContain("animate");
      expect(t.className).toContain("active:");
    }
  });

  it("el PIN SE ENVÍA SOLO al cuarto dígito", async () => {
    const vistos: string[] = [];
    await pintar(<PuertaPin {...props} onPin={(p) => vistos.push(p)} />);
    for (const d of ["4", "0", "7"]) pulsar(d);
    expect(vistos).toEqual([]);
    pulsar("1");
    expect(vistos).toEqual(["4071"]);
  });

  it("y los puntos NUNCA llevan el PIN dentro", async () => {
    await pintar(<PuertaPin {...props} />);
    for (const d of ["4", "0"]) pulsar(d);
    expect(container.textContent).not.toContain("40");
    expect(container.querySelector("[aria-label='2 de 4 cifras']")).toBeTruthy();
  });

  it("un error VACÍA los puntos", async () => {
    // Si no, el siguiente dígito se añadiría a un PIN que ya falló y la
    // segunda frase diría otra cosa sin que la persona entienda por qué.
    await pintar(<PuertaPin {...props} error="Ese PIN no es correcto." />);
    expect(container.querySelector("[aria-label='0 de 4 cifras']")).toBeTruthy();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "no es correcto",
    );
  });

  // ── residencia-6 (D-68) · EL BOTÓN «PIN DE 6 CIFRAS» ────────────
  //
  // La auxiliar **no gana ni un toque**: sigue entrando sola al cuarto
  // dígito, y el botón es una tecla más que nunca pulsa. Quien tiene PIN
  // de seis lo pulsa una vez por turno.

  it("por defecto son CUATRO casillas, como siempre", async () => {
    await pintar(<PuertaPin {...props} />);
    expect(container.querySelector("[aria-label='0 de 4 cifras']")).toBeTruthy();
    expect(container.textContent).toContain("PIN de 6 cifras");
  });

  // Nota de mecánica: los dígitos se pulsan con `pulsarExacto`. `pulsar`
  // casa por SUBCADENA, y con el teclado en seis casillas el botón dice
  // «PIN de 4 cifras» — así que `pulsar("4")` acertaba al interruptor y
  // volvía a cuatro vaciando lo tecleado. Lo encontró este test al
  // ponerse rojo, y es la misma trampa que `exact: true` en el bucle
  // visual.

  it("pulsando «PIN de 6 cifras» hay SEIS casillas y envía al sexto", async () => {
    const vistos: string[] = [];
    await pintar(<PuertaPin {...props} onPin={(p) => vistos.push(p)} />);
    pulsarExacto("PIN de 6 cifras");
    expect(container.querySelector("[aria-label='0 de 6 cifras']")).toBeTruthy();
    for (const d of ["9", "1", "8", "2", "5"]) pulsarExacto(d);
    // Al cuarto NO manda nada: es la mitad que importa del botón.
    expect(vistos).toEqual([]);
    pulsarExacto("6");
    expect(vistos).toEqual(["918256"]);
  });

  it("es un INTERRUPTOR: vuelve a cuatro con el mismo toque", async () => {
    // Si fuera un camino de ida, un roce dejaría la puerta en seis
    // casillas para la siguiente persona — y la siguiente es la auxiliar.
    await pintar(<PuertaPin {...props} />);
    pulsarExacto("PIN de 6 cifras");
    expect(container.textContent).toContain("PIN de 4 cifras");
    pulsarExacto("PIN de 4 cifras");
    expect(container.querySelector("[aria-label='0 de 4 cifras']")).toBeTruthy();
  });

  it("cambiar de largo VACÍA lo tecleado", async () => {
    // Dejar los dos primeros dígitos puestos al pasar a seis mandaría un
    // PIN a medias en cuanto llegara al sexto.
    const vistos: string[] = [];
    await pintar(<PuertaPin {...props} onPin={(p) => vistos.push(p)} />);
    for (const d of ["9", "1"]) pulsarExacto(d);
    pulsarExacto("PIN de 6 cifras");
    expect(container.querySelector("[aria-label='0 de 6 cifras']")).toBeTruthy();
    for (const d of ["1", "2", "3", "4", "5", "6"]) pulsarExacto(d);
    expect(vistos).toEqual(["123456"]);
  });

  it("un error NO devuelve el teclado a cuatro", async () => {
    // Quien se equivoca de dígito teniendo PIN de seis no tiene que
    // volver a pulsar el botón: eso serían dos toques de penalización por
    // cada error.
    const { rerender } = await pintarConRerender(<PuertaPin {...props} />);
    pulsarExacto("PIN de 6 cifras");
    await rerender(<PuertaPin {...props} error="Ese PIN no es correcto." />);
    expect(container.querySelector("[aria-label='0 de 6 cifras']")).toBeTruthy();
  });

  it("el botón NO es una tecla del teclado, y mide lo que hay que pulsar", async () => {
    // No va en el hueco de abajo a la derecha del teclado: ahí aterriza
    // el pulgar y un roce cambiaría el largo en mitad de un PIN de
    // cuatro. Va debajo de los puntos, y es táctil aunque sea discreto.
    await pintar(<PuertaPin {...props} />);
    const b = [...container.querySelectorAll("button")].find(
      (x) => x.textContent === "PIN de 6 cifras",
    )!;
    expect(b.className).not.toContain("tap-puerta-tecla");
    expect(b.className).toContain("min-h-touch-pad");
    // `block`: un `<button>` es inline, y sin esto se pegaba a «Volver a
    // la puerta» en la misma línea —«PIN de 6 cifrasVolver a la
    // puerta»—. **Lo encontró el bucle visual**, no este test: en jsdom
    // no hay layout. Lo que esto sostiene es el mecanismo.
    expect(b.className).toContain("block");
    const volver = [...container.querySelectorAll("button")].find(
      (x) => x.textContent === "Volver a la puerta",
    )!;
    expect(volver.className).toContain("block");
  });

  it("CON DOS ROLES pregunta con cuál entra, y lo dice", async () => {
    const elegidos: string[] = [];
    await pintar(
      <PuertaPin
        {...props}
        eligiendoRol={{
          nombre: "Marta",
          roles: [
            { assignmentId: "a1", code: "TO", name: "Terapeuta ocupacional" },
            { assignmentId: "a2", code: "CALIDAD", name: "Calidad" },
          ],
        }}
        onRol={(id) => elegidos.push(id)}
      />,
    );
    expect(container.textContent).toContain("¿Con qué rol entras?");
    expect(container.textContent).toContain(
      "Lo que registres queda firmado con el rol que elijas",
    );
    pulsar("Calidad");
    expect(elegidos).toEqual(["a2"]);
  });
});

// ══ 3 · LO QUE TOCA ══════════════════════════════════════════════
describe("pantalla 3 · lo que toca ahora", () => {
  const DATOS: LoQueToca = {
    habitacionLibre: false,
    turno: { id: "t-m", code: "M", name: "Mañana" },
    careDay: "2026-10-15",
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
            at: "2026-10-15T08:00:00.000Z",
            until: null,
            esFranja: false,
            shiftCode: "M",
            momentCode: null,
          },
        ],
        registros: [],
      },
    ],
    controles: [
      {
        code: "CAMBIO_POSTURAL",
        nombre: "Cambio postural",
        layer: "EXEC",
        nature: "SCHEDULED",
        valueDomain: "BOOL",
        opciones: [],
      },
      ...CONTROLES.map((c) => ({
        code: c.code,
        nombre: c.name,
        layer: c.layer,
        nature: c.nature,
        valueDomain: c.valueDomain,
        opciones: c.opciones.map((o) => ({
          code: o.code,
          isAsUsual: o.isAsUsual,
        })),
      })),
    ],
    serverTime: "2026-10-15T08:00:00.000Z",
  };

  const props = {
    numeroDeHabitacion: "112",
    quien: { nombre: "Ana", rolName: "Auxiliar" },
    datos: DATOS,
    segundosParaCerrar: 45,
    dimensiones: DIMENSIONES,
    aDemandaPorResidente: {
      carmen: [
        { code: "HIGIENE_EXTRA", nombre: "Higiene" },
        { code: "DEPOSICION", nombre: "Deposición" },
      ],
    },
    onComoSiempre: () => {},
    onNoComoSiempre: () => {},
    onHecho: () => {},
    onCorregir: () => {},
    onADemanda: () => {},
    // residencia-4 · las constantes. Los dos nuevos van vacíos en el
    // caso base: lo que se prueba aquí son las pantallas de
    // residencia-3, y lo de las constantes tiene su propio fichero
    // (`puerta-constante.test.tsx`).
    onTomarConstante: () => {},
    constantesDisponibles: [],
    onAlgoNoVaBien: () => {},
    onTerminar: () => {},
  };

  it("la cabecera dice quién, con qué rol, en qué turno y cuánto queda", async () => {
    await pintar(<PuertaLoQueToca {...props} />);
    expect(container.textContent).toContain("Ana · Auxiliar · mañana");
    expect(container.textContent).toContain("Se cierra sola en 0:45");
    expect(container.textContent).toContain("Terminar");
  });

  it("«Como siempre» es EL BOTÓN GRANDE y coral", async () => {
    await pintar(<PuertaLoQueToca {...props} />);
    const b = [...container.querySelectorAll("button")].find(
      (x) => x.textContent === "Como siempre",
    )!;
    expect(b.className).toContain("bg-mipiace-coral");
    expect(b.className).toContain("min-h-tap-puerta");
    // Y «No como siempre» está al lado, sin ser el principal.
    const otro = [...container.querySelectorAll("button")].find(
      (x) => x.textContent === "No como siempre",
    )!;
    expect(otro.className).not.toContain("bg-mipiace-coral");
  });

  it("YA REGISTRADO en el turno → franja verde con quién y cuándo", async () => {
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={{
          ...DATOS,
          residentes: [
            {
              ...DATOS.residentes[0]!,
              registros: [
                {
                  id: "r1",
                  controlCode: "ANIMO",
                  clientId: "carmen",
                  valor: { tipo: "ORDINAL", opcion: "COMO_SIEMPRE" },
                  nota: null,
                  tieneVoz: false,
                  recordedAt: "2026-10-15T06:20:00.000Z",
                  careDay: "2026-10-15",
                  occurrenceAt: null,
                  shiftCode: "M",
                  sinTurno: false,
                  firmadoPor: "Ana",
                  firmadoPorUserId: "u1",
                  rolCode: "AUXILIAR",
                  anulado: false,
                  corrigeA: null,
                  vigente: true,
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(container.textContent).toMatch(/Como siempre · lo marcó Ana a las \d\d:\d\d/);
    // Y los dos botones YA NO ESTÁN: no se vuelve a preguntar.
    expect(
      [...container.querySelectorAll("button")].find(
        (x) => x.textContent === "Como siempre",
      ),
    ).toBeUndefined();
  });

  // ── residencia-6 (punto 3) · «EN LA TABLET» ──────────────────────
  //
  // Sin red, «lo que toca» ya no sale entero por hacer: lo que esta
  // tablet apuntó consta. Y consta **marcado**, porque «consta» y
  // «consta aquí» no son lo mismo — lo de aquí no lo ve el relevo
  // todavía.

  function conRegistroPropio(enLaTablet: boolean) {
    return {
      ...DATOS,
      residentes: [
        {
          ...DATOS.residentes[0]!,
          registros: [
            {
              id: "r1",
              controlCode: "CAMBIO_POSTURAL",
              clientId: "carmen",
              valor: { tipo: "BOOL", hecho: true },
              nota: null,
              tieneVoz: false,
              recordedAt: "2026-10-15T06:20:00.000Z",
              careDay: "2026-10-15",
              occurrenceAt: DATOS.residentes[0]!.toca[0]!.at,
              shiftCode: "M",
              sinTurno: false,
              firmadoPor: "Ana",
              firmadoPorUserId: "u1",
              rolCode: "AUXILIAR",
              anulado: false,
              corrigeA: null,
              vigente: true,
              ...(enLaTablet ? { enLaTablet: true } : {}),
            },
          ],
        },
      ],
    };
  }

  it("lo apuntado SIN RED sale hecho, con la marca «en la tablet»", async () => {
    await pintar(
      <PuertaLoQueToca {...props} datos={conRegistroPropio(true)} />,
    );
    // **En la LÍNEA de la ocurrencia, no en cualquier sitio.** La primera
    // versión de este test miraba `container.textContent`, y la banda de
    // arriba también dice «en la tablet»: quitarle la marca a la línea
    // dejaba el test VERDE. Lo encontró la tabla de sabotajes — es la
    // lección de siempre: saboteá lo que el banco ejercita de verdad.
    const linea = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Ana"),
    );
    expect(linea, "no está la línea de lo ya hecho").toBeTruthy();
    expect(linea!.textContent).toContain("en la tablet");
    // Y la pantalla dice lo que NO puede saber: lo registrado desde otra
    // pantalla sin red. Callárselo sería afirmar que no se hizo.
    expect(container.textContent).toContain(
      "registrado desde otra pantalla sin red no se puede saber",
    );
  });

  it("y lo que CONSTA en el servidor no lleva la marca ni la banda", async () => {
    await pintar(
      <PuertaLoQueToca {...props} datos={conRegistroPropio(false)} />,
    );
    const linea = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Ana"),
    );
    expect(linea!.textContent).not.toContain("en la tablet");
    expect(container.textContent).not.toContain("otra pantalla sin red");
  });

  it("«Hecho» es oscuro y NO SE ANIMA: cambia de estado", async () => {
    await pintar(<PuertaLoQueToca {...props} />);
    const b = [...container.querySelectorAll("button")].find(
      (x) => x.textContent === "Hecho",
    )!;
    expect(b.className).toContain("bg-mipiace-ink");
    expect(b.className).not.toContain("transition");
    expect(b.className).not.toContain("animate");
  });

  it("y la PISTA distingue una FRANJA de un INSTANTE", async () => {
    await pintar(<PuertaLoQueToca {...props} />);
    expect(container.textContent).toMatch(/a las \d\d:\d\d/);
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={{
          ...DATOS,
          residentes: [
            {
              ...DATOS.residentes[0]!,
              toca: [{ ...DATOS.residentes[0]!.toca[0]!, esFranja: true }],
            },
          ],
        }}
      />,
    );
    // Decir «a las 08:00» de una franja haría creer que a las 08:01 está
    // incumplida (residencia-2 §5).
    expect(container.textContent).toMatch(/desde las \d\d:\d\d/);
  });

  it("LO HECHO queda en gris discontinuo, con quién, cuándo y «Corregir»", async () => {
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={{
          ...DATOS,
          residentes: [
            {
              ...DATOS.residentes[0]!,
              registros: [
                {
                  id: "r2",
                  controlCode: "CAMBIO_POSTURAL",
                  clientId: "carmen",
                  valor: { tipo: "BOOL", hecho: true },
                  nota: null,
                  tieneVoz: false,
                  recordedAt: "2026-10-15T08:05:00.000Z",
                  careDay: "2026-10-15",
                  occurrenceAt: "2026-10-15T08:00:00.000Z",
                  shiftCode: "M",
                  sinTurno: false,
                  firmadoPor: "Ana",
                  firmadoPorUserId: "u1",
                  rolCode: "AUXILIAR",
                  anulado: false,
                  corrigeA: null,
                  vigente: true,
                },
              ],
            },
          ],
        }}
      />,
    );
    const li = [...container.querySelectorAll("li")].find((x) =>
      x.textContent?.includes("Cambio postural"),
    )!;
    expect(li.className).toContain("border-dashed");
    expect(li.textContent).toContain("Ana");
    expect(li.textContent).toContain("Corregir");
    expect(li.textContent).not.toContain("Hecho");
  });

  it("los `ON_DEMAND` están abajo con su «+»", async () => {
    await pintar(<PuertaLoQueToca {...props} />);
    expect(container.textContent).toContain("+ Higiene");
    expect(container.textContent).toContain("+ Deposición");
  });

  it("residencia-4 · el AVISO no vive en esta pantalla, y es a propósito", async () => {
    // residencia-3 pintaba aquí la frase «si no puede esperar, avisa a
    // la enfermera en persona», porque el aviso no existía. Ya existe, y
    // el botón NO está aquí: está dentro de la pantalla de la constante
    // y de la de «algo no va bien», que es donde hay algo que apuntar
    // con él. Un botón de avisar suelto en esta pantalla sería un aviso
    // sin registro detrás, y quien viniera corriendo no tendría nada que
    // mirar.
    await pintar(<PuertaLoQueToca {...props} />);
    expect(container.textContent).not.toContain("avisar a la enfermera");
    expect(container.textContent).not.toContain(
      "Si no puede esperar, avisa a la enfermera en persona",
    );
  });

  it("SIN TURNO lo dice, y no bloquea nada", async () => {
    await pintar(
      <PuertaLoQueToca {...props} datos={{ ...DATOS, turno: null }} />,
    );
    expect(container.textContent).toContain(
      "Los turnos del centro no cubren esta hora",
    );
    expect(container.textContent).toContain("Lo que registres se guarda igual");
    // Y los botones siguen estando: un cuidado hecho se apunta.
    expect(
      [...container.querySelectorAll("button")].some(
        (x) => x.textContent === "Como siempre",
      ),
    ).toBe(true);
  });

  it("las OBS no salen dos veces: su sitio es «¿Cómo está hoy?»", async () => {
    await pintar(
      <PuertaLoQueToca
        {...props}
        datos={{
          ...DATOS,
          residentes: [
            {
              ...DATOS.residentes[0]!,
              toca: [
                ...DATOS.residentes[0]!.toca,
                {
                  controlCode: "ANIMO",
                  nombre: "Ánimo",
                  planItemId: "l2",
                  at: "2026-10-15T08:00:00.000Z",
                  until: null,
                  esFranja: true,
                  shiftCode: "M",
                  momentCode: null,
                },
              ],
            },
          ],
        }}
      />,
    );
    // «Ánimo» no aparece como línea con botón «Hecho»: pintarla ahí haría
    // que un «como siempre» ya marcado siguiera pidiéndose línea a línea.
    const lineas = [...container.querySelectorAll("li")].map(
      (x) => x.textContent ?? "",
    );
    expect(lineas.some((l) => l.includes("Ánimo"))).toBe(false);
  });
});

// ══ 4 · NO COMO SIEMPRE ══════════════════════════════════════════
describe("pantalla 4 · no está como siempre", () => {
  const props = {
    nombreDelResidente: "Carmen Gómez",
    dimensiones: DIMENSIONES,
    onGuardar: () => {},
    onTambienAlgoNoVaBien: () => {},
    onVolver: () => {},
  };

  it("LA PROMESA está arriba, con esas palabras", async () => {
    await pintar(<PuertaNoComoSiempre {...props} />);
    expect(container.textContent).toContain(
      "Toca solo lo que no está como siempre. Lo demás se guarda como siempre.",
    );
  });

  it("las siete tarjetas EMPIEZAN CERRADAS, con «como siempre» debajo", async () => {
    // El coste es proporcional a la anomalía (D-16): un día con algo son
    // dos toques más, no catorce.
    await pintar(<PuertaNoComoSiempre {...props} />);
    expect(container.querySelectorAll("section")).toHaveLength(7);
    expect(container.textContent).not.toContain("Apagado / triste");
  });

  it("al tocar una se abre, y el «como siempre» NO se ofrece", async () => {
    await pintar(<PuertaNoComoSiempre {...props} />);
    pulsar("Ánimo");
    expect(container.textContent).toContain("Apagado / triste");
    // Ofrecerlo sería pedir que alguien confirme lo que ya está
    // confirmado: el valor por defecto de esta pantalla ya es la
    // normalidad.
    const opciones = [...container.querySelectorAll("section button")].map(
      (b) => b.textContent,
    );
    expect(opciones.filter((o) => o === "Como siempre")).toHaveLength(0);
  });

  it("y el botón DICE CUÁNTOS CAMBIOS lleva", async () => {
    const guardados: Array<Record<string, string>> = [];
    await pintar(
      <PuertaNoComoSiempre {...props} onGuardar={(c) => guardados.push(c)} />,
    );
    expect(container.textContent).toContain("Guardar");
    expect(container.textContent).not.toContain("1 cambio");
    pulsar("Ánimo");
    pulsarExacto("Apagado / triste");
    expect(container.textContent).toContain("Guardar · 1 cambio");
    pulsar("Guardar");
    expect(guardados).toEqual([{ ANIMO: "APAGADO" }]);
  });

  it("volver a tocar la opción elegida la QUITA", async () => {
    await pintar(<PuertaNoComoSiempre {...props} />);
    pulsar("Ánimo");
    pulsarExacto("Apagado / triste");
    expect(container.textContent).toContain("1 cambio");
    pulsarExacto("Apagado / triste");
    expect(container.textContent).not.toContain("1 cambio");
  });

  it("y lleva «Además, algo no va bien» con los cambios dentro", async () => {
    const vistos: Array<Record<string, string>> = [];
    await pintar(
      <PuertaNoComoSiempre
        {...props}
        onTambienAlgoNoVaBien={(c) => vistos.push(c)}
      />,
    );
    pulsar("Ánimo");
    pulsarExacto("Apagado / triste");
    pulsar("Además, algo no va bien");
    // Los dos van en EL MISMO gesto: fue una firma, y partirlo en dos
    // peticiones dejaría media observación apuntada.
    expect(vistos).toEqual([{ ANIMO: "APAGADO" }]);
  });
});

// ══ 5 · ALGO NO VA BIEN ══════════════════════════════════════════
describe("pantalla 5 · algo no va bien", () => {
  const props = {
    nombreDelResidente: "Carmen Gómez",
    onApuntar: () => {},
    onVolver: () => {},
  };

  it("LA FRASE de arriba es la regla 1 de la capa (D-13)", async () => {
    await pintar(<PuertaAlgoNoVaBien {...props} />);
    expect(container.textContent).toContain(
      "No hace falta saber qué es. Con decirlo basta",
    );
    expect(container.textContent).toContain("lo verá el turno siguiente");
  });

  it("los DOS campos son opcionales: apuntar sin nada apunta", async () => {
    const vistos: Array<{ texto: string | null; vozBase64: string | null }> = [];
    await pintar(
      <PuertaAlgoNoVaBien {...props} onApuntar={(x) => vistos.push(x)} />,
    );
    pulsar("Apuntarlo para el relevo");
    // residencia-4 · el tipo y el matiz son OPCIONALES: sin tocar
    // ningún botón siguen siendo `null` y el registro vale N1 (D-13).
    expect(vistos).toEqual([
      {
        texto: null,
        vozBase64: null,
        evento: null,
        matiz: null,
        avisarEnfermera: false,
      },
    ]);
  });

  it("la nota de voz es MANTENER PULSADO, no «grabar / parar»", async () => {
    // Con dos toques el riesgo es dejarse la grabación abierta en un
    // bolsillo; con uno, el audio dura lo que dura el dedo.
    await pintar(<PuertaAlgoNoVaBien {...props} />);
    expect(container.textContent).toContain("Mantén pulsado y cuéntalo");
    expect(container.textContent).not.toContain("Grabar");
  });

  it("residencia-4 · Y EL BOTÓN DE LA ENFERMERA YA SE PINTA", async () => {
    // residencia-3 lo dejó apagado («un botón que parece avisar y no
    // avisa es peor que no tenerlo») y en su sitio puso la frase de
    // avisar en persona. Ya avisa, así que el botón está y la frase se
    // va: tenerlas las dos diría dos cosas distintas a la vez.
    await pintar(<PuertaAlgoNoVaBien {...props} />);
    expect(container.textContent).toContain(
      "No puede esperar: avisar a la enfermera",
    );
    expect(container.textContent).not.toContain(
      "Si no puede esperar, avisa a la enfermera en persona",
    );
  });

  it("y es un INTERRUPTOR: lo que sale es el registro con su nivel subido", async () => {
    // No es una acción que mande un aviso suelto. Pulsarlo cambia el
    // texto del botón de apuntar y viaja dentro del registro, que es lo
    // que hace que quien venga tenga algo que mirar.
    const vistos: Array<{ avisarEnfermera: boolean }> = [];
    await pintar(
      <PuertaAlgoNoVaBien {...props} onApuntar={(x) => vistos.push(x)} />,
    );
    pulsar("No puede esperar: avisar a la enfermera");
    expect(container.textContent).toContain("Se avisará a la enfermera");
    pulsar("Apuntar y avisar");
    expect(vistos[0]?.avisarEnfermera).toBe(true);
  });

  it("los TIPOS están encima de la nota, y la caída pregunta UNA cosa", async () => {
    const vistos: Array<{ evento: string | null; matiz: string | null }> = [];
    await pintar(
      <PuertaAlgoNoVaBien {...props} onApuntar={(x) => vistos.push(x)} />,
    );
    // La pregunta NO está hasta que se elige el tipo: una pantalla con
    // las cinco preguntas abiertas es un formulario.
    expect(container.textContent).not.toContain(
      "¿Se ha dado en la cabeza o hay herida?",
    );
    pulsarExacto("Caída");
    expect(container.textContent).toContain(
      "¿Se ha dado en la cabeza o hay herida?",
    );
    pulsarExacto("Sí");
    pulsar("Apuntarlo para el relevo");
    expect(vistos[0]).toMatchObject({ evento: "CAIDA", matiz: "CON_GOLPE" });
  });

  it("y volver a pulsar el tipo lo QUITA: es el error de dedo más común", async () => {
    const vistos: Array<{ evento: string | null }> = [];
    await pintar(
      <PuertaAlgoNoVaBien {...props} onApuntar={(x) => vistos.push(x)} />,
    );
    pulsarExacto("Vómito");
    pulsarExacto("Vómito");
    pulsar("Apuntarlo para el relevo");
    expect(vistos[0]?.evento).toBeNull();
  });
});

// ══ 6 · APUNTADO ═════════════════════════════════════════════════
describe("pantalla 6 · apuntado", () => {
  const props = {
    numeroDeHabitacion: "112",
    firmadoPor: "Ana López",
    hora: "10:42",
    nombreDelTurno: "Mañana",
    hayRed: true,
    lineas: [
      { id: "r1", texto: "Como siempre", enLaTablet: false },
      { id: "r2", texto: "Cambio postural", enLaTablet: false },
    ],
    onDeshacer: () => {},
    onSeguir: () => {},
  };

  it("el check, «Apuntado» y la firma con hora y turno", async () => {
    await pintar(<PuertaApuntado {...props} />);
    expect(container.textContent).toContain("Apuntado");
    expect(container.textContent).toContain(
      "Firmado por Ana López · 10:42 · turno de mañana",
    );
    expect(container.textContent).toContain("Seguir en la habitación 112");
  });

  it("SIN RED, la banda ámbar con las TRES cosas en orden", async () => {
    await pintar(
      <PuertaApuntado
        {...props}
        hayRed={false}
        lineas={[{ id: "r1", texto: "Como siempre", enLaTablet: true }]}
      />,
    );
    const banda = container.querySelector("[role='status']")!;
    // Qué pasa, qué va a pasar, y qué tiene que hacer ella: nada.
    expect(banda.textContent).toContain("Sin red");
    expect(banda.textContent).toContain("Lo guarda la tablet");
    expect(banda.textContent).toContain("lo envía sola cuando vuelva");
    expect(banda.textContent).toContain("No hay que repetir nada");
  });

  it("el estado va FILA A FILA, no en un resumen", async () => {
    // «3 registros pendientes» no dice si el que le preocupa es uno de
    // ellos.
    await pintar(
      <PuertaApuntado
        {...props}
        lineas={[
          { id: "r1", texto: "Como siempre", enLaTablet: false },
          { id: "r2", texto: "Cambio postural", enLaTablet: true },
        ]}
      />,
    );
    const filas = [...container.querySelectorAll("main li")].map(
      (x) => x.textContent ?? "",
    );
    expect(filas[0]).toContain("enviado");
    expect(filas[1]).toContain("en la tablet");
  });

  it("LO RECHAZADO va ARRIBA y en rojo, con qué hacer", async () => {
    await pintar(
      <PuertaApuntado
        {...props}
        lineas={[
          {
            id: "r1",
            texto: "Como siempre",
            enLaTablet: false,
            rechazo: "la tablet tiene el reloj mal puesto",
          },
        ]}
      />,
    );
    const alerta = container.querySelector("[role='alert']")!;
    expect(alerta.textContent).toContain("no se pudo apuntar");
    expect(alerta.textContent).toContain("reloj mal puesto");
    expect(alerta.textContent).toContain("no se arregla reintentando");
  });

  it("y «Deshacer el último» NO SE PINTA cuando no se puede", async () => {
    await pintar(<PuertaApuntado {...props} onDeshacer={null} />);
    expect(container.textContent).not.toContain("Deshacer el último");
  });
});
