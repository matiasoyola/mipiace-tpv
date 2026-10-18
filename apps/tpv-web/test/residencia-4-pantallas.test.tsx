// residencia-4 · LAS PANTALLAS NUEVAS, por lo que dicen.
//
// Tres cosas y las tres son del prompt, no del estilo:
//
//   1. **El teclado de una constante**: teclas de 120 px, la unidad a la
//      vista, coma decimal, fuera de rango NO SE APUNTA y el nivel
//      pintado antes de apuntar.
//   2. **La pantalla 6**: qué nivel salió, si el aviso salió y quién lo
//      ha acusado. Y la banda ámbar del «NO ha salido», que es el peor
//      fallo posible del bloque dicho en una frase.
//   3. **El móvil de guardia**: en reposo dice quién está, el aviso
//      ocupa la pantalla entera, «Voy» firma, y la recomendación de
//      llamar sale sólo en N3-N4 y **no llama sola** (D-33).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PuertaConstante,
  aNumero,
  cabeEnElRango,
  formatearDuda,
  fraseDelNivel,
  nivelPrevisto,
  type ConstanteParaTomar,
} from "../src/residencia/PuertaConstante.js";
import { PuertaApuntado } from "../src/residencia/PuertaApuntado.js";
import { GuardiaAviso, type AvisoDeGuardia } from "../src/residencia/GuardiaAviso.js";
import type {
  PlantillaDeLaPuerta,
  ReglaDeGravedadDeLaPuerta,
} from "../src/residencia/puerta-tipos.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Las reglas de la temperatura, como vienen del arranque. */
const REGLAS: ReglaDeGravedadDeLaPuerta[] = [
  { kind: "THRESHOLD", controlCode: "TEMPERATURA", comparador: "GTE", valor: 37.5, nivel: "N1", tipo: "FIEBRE" },
  { kind: "THRESHOLD", controlCode: "TEMPERATURA", comparador: "GTE", valor: 38, nivel: "N2", tipo: "FIEBRE" },
  { kind: "THRESHOLD", controlCode: "TEMPERATURA", comparador: "GTE", valor: 39.5, nivel: "N3", tipo: "FIEBRE" },
  { kind: "THRESHOLD", controlCode: "TA_SISTOLICA", comparador: "GTE", valor: 180, nivel: "N2", tipo: "TENSION" },
];
const PLANTILLA: PlantillaDeLaPuerta = { version: 1, reglas: REGLAS };

const TEMPERATURA: ConstanteParaTomar = {
  code: "TEMPERATURA",
  nombre: "Temperatura",
  unidad: "°C",
  min: 30,
  max: 45,
};
const SISTOLICA: ConstanteParaTomar = {
  code: "TA_SISTOLICA",
  nombre: "Tensión sistólica",
  unidad: "mmHg",
  min: 50,
  max: 300,
};
const DIASTOLICA: ConstanteParaTomar = {
  code: "TA_DIASTOLICA",
  nombre: "Tensión diastólica",
  unidad: "mmHg",
  min: 30,
  max: 200,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
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

function botones(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

function pulsarExacto(texto: string): void {
  const b = botones().find((x) => x.textContent === texto);
  if (!b) throw new Error(`no hay botón que diga exactamente «${texto}»`);
  act(() => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pulsar(texto: string): void {
  const b = botones().find((x) => x.textContent?.includes(texto));
  if (!b) throw new Error(`no hay botón «${texto}»`);
  act(() => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function teclear(digitos: string): void {
  for (const d of digitos) pulsarExacto(d);
}

// ══ 1 · LAS FUNCIONES PURAS DEL TECLADO ═══════════════════════════
describe("de «38,4» a 38.4", () => {
  it("la COMA es el separador, y el punto es del JSON", () => {
    expect(aNumero("38,4")).toBe(38.4);
    expect(aNumero("120")).toBe(120);
    // A medio teclear no es un número todavía, y eso apaga «Apuntar».
    expect(aNumero("")).toBeNull();
    expect(aNumero(",")).toBeNull();
  });

  it("y el rango de entrada es el del catálogo", () => {
    expect(cabeEnElRango(38.4, TEMPERATURA)).toBe(true);
    expect(cabeEnElRango(384, TEMPERATURA)).toBe(false);
    expect(cabeEnElRango(3.65, TEMPERATURA)).toBe(false);
    // Los bordes entran: 30 y 45 son lecturas posibles.
    expect(cabeEnElRango(30, TEMPERATURA)).toBe(true);
    expect(cabeEnElRango(45, TEMPERATURA)).toBe(true);
  });

  it("la duda se pregunta con las dos opciones: «38,4 o 384»", () => {
    expect(formatearDuda(384)).toBe("38,4 o 384");
    expect(formatearDuda(3.65)).toBe("3,65 o 365");
  });

  it("el nivel previsto es el MÁS GRAVE de lo tecleado", () => {
    // La tensión se toma en una pantalla con dos casillas; el nivel que
    // se pinta es el de la peor de las dos.
    expect(
      nivelPrevisto(
        [
          { constante: SISTOLICA, numero: 190 },
          { constante: DIASTOLICA, numero: 80 },
        ],
        REGLAS,
      )?.nivel,
    ).toBe("N2");
    expect(
      nivelPrevisto([{ constante: TEMPERATURA, numero: 36.5 }], REGLAS),
    ).toBeNull();
  });

  it("y la frase dice QUÉ HACER, no el código a secas", () => {
    // «N2» no significa nada delante de una puerta.
    expect(fraseDelNivel("N2")).toContain("Avisa a la enfermera");
    expect(fraseDelNivel("N4")).toContain("Llama al 112");
    expect(fraseDelNivel("N1")).toContain("turno siguiente");
  });
});

// ══ 2 · EL TECLADO ════════════════════════════════════════════════
describe("la pantalla de una constante", () => {
  const props = {
    nombreDelResidente: "Carmen Gómez",
    constantes: [TEMPERATURA],
    plantilla: PLANTILLA,
    onApuntar: () => {},
    onVolver: () => {},
  };

  it("las teclas son de 120 px y hay COMA, no punto", async () => {
    await pintar(<PuertaConstante {...props} />);
    const tecla = botones().find((b) => b.textContent === "7")!;
    expect(tecla.className).toContain("min-h-tap-puerta-tecla");
    expect(botones().some((b) => b.textContent === ",")).toBe(true);
    expect(botones().some((b) => b.textContent === ".")).toBe(false);
  });

  it("la UNIDAD está a la vista desde el principio", async () => {
    await pintar(<PuertaConstante {...props} />);
    expect(container.textContent).toContain("°C");
  });

  it("«Apuntar» está APAGADO hasta que el número es válido", async () => {
    await pintar(<PuertaConstante {...props} />);
    const apuntar = () => botones().find((b) => b.textContent === "Apuntar")!;
    expect(apuntar().disabled).toBe(true);
    teclear("38,4");
    expect(apuntar().disabled).toBe(false);
  });

  it("FUERA DE RANGO no se puede apuntar, y la frase pregunta «38,4 o 384»", async () => {
    await pintar(<PuertaConstante {...props} />);
    teclear("384");
    expect(container.textContent).toContain("no es una lectura posible");
    expect(container.textContent).toContain("38,4 o 384");
    expect(botones().find((b) => b.textContent === "Apuntar")!.disabled).toBe(
      true,
    );
  });

  it("y EL NIVEL se pinta ANTES de apuntar", async () => {
    await pintar(<PuertaConstante {...props} />);
    teclear("38,6");
    expect(container.textContent).toContain("Alguien tiene que verlo ahora");
    expect(container.textContent).toContain("Avisa a la enfermera");
  });

  it("…y con 36,4 dice que no avisa a nadie, en vez de callarse", async () => {
    await pintar(<PuertaConstante {...props} />);
    teclear("36,4");
    expect(container.textContent).toContain("Este valor no avisa a nadie");
  });

  it("SIN PLANTILLA en la caché no se inventa un nivel", async () => {
    // Una tablet que arrancó antes del bloque. Lo que pasa es que no
    // pinta nivel; el servidor lo dirá al subir el lote.
    await pintar(<PuertaConstante {...props} plantilla={null} />);
    teclear("39,8");
    expect(container.textContent).not.toContain("Hay que tomar una decisión");
    expect(botones().find((b) => b.textContent === "Apuntar")!.disabled).toBe(
      false,
    );
  });

  it("LA TENSIÓN se toma en UNA pantalla y sale como DOS registros", async () => {
    const vistos: Array<Array<{ constante: ConstanteParaTomar; numero: number }>> =
      [];
    await pintar(
      <PuertaConstante
        {...props}
        constantes={[SISTOLICA, DIASTOLICA]}
        onApuntar={(v) => vistos.push(v)}
      />,
    );
    expect(container.textContent).toContain("Tensión arterial");
    // La primera casilla está activa; se teclea, se toca la segunda y se
    // teclea.
    teclear("190");
    pulsar("Tensión diastólica");
    teclear("95");
    pulsarExacto("Apuntar");
    expect(vistos[0]).toHaveLength(2);
    expect(vistos[0]![0]).toMatchObject({ numero: 190 });
    expect(vistos[0]![1]).toMatchObject({ numero: 95 });
  });

  it("y con MEDIA tensión no se puede apuntar", async () => {
    await pintar(
      <PuertaConstante {...props} constantes={[SISTOLICA, DIASTOLICA]} />,
    );
    teclear("190");
    expect(botones().find((b) => b.textContent === "Apuntar")!.disabled).toBe(
      true,
    );
  });

  it("el botón de la enfermera es un INTERRUPTOR y viaja con el registro", async () => {
    const vistos: boolean[] = [];
    await pintar(
      <PuertaConstante
        {...props}
        onApuntar={(_v, avisar) => vistos.push(avisar)}
      />,
    );
    teclear("36,8");
    pulsar("No puede esperar: avisar a la enfermera");
    expect(container.textContent).toContain("Se avisará a la enfermera");
    pulsarExacto("Apuntar");
    expect(vistos[0]).toBe(true);
  });
});

// ══ 3 · LA PANTALLA 6 ═════════════════════════════════════════════
describe("pantalla 6 · qué nivel salió y si el aviso salió", () => {
  const base = {
    numeroDeHabitacion: "112",
    firmadoPor: "Ana López",
    hora: "10:41",
    nombreDelTurno: "Mañana",
    hayRed: true,
    lineas: [{ id: "r1", texto: "Temperatura: 38,6 °C", enLaTablet: false }],
    onDeshacer: null,
    onSeguir: () => {},
  };

  it("SIN AVISO no dice nada del libro: el caso normal no cambia", async () => {
    await pintar(<PuertaApuntado {...base} />);
    expect(container.textContent).toContain("Apuntado");
    expect(container.textContent).not.toContain("N2");
  });

  it("CON EL SERVIDOR: dice el tipo, el nivel y dónde ha sonado", async () => {
    await pintar(
      <PuertaApuntado
        {...base}
        aviso={{
          nivelPrevisto: "N2",
          servidor: {
            incidenciaId: "i1",
            nivel: "N2",
            nombreDelTipo: "Fiebre",
            avisadoEn: ["ENFERMERIA"],
            acusadoPor: null,
            acusadoComo: null,
            acusadoEn: null,
          },
        }}
      />,
    );
    expect(container.textContent).toContain("Fiebre");
    expect(container.textContent).toContain("Alguien tiene que verlo ahora (N2)");
    expect(container.textContent).toContain("Avisado en enfermería");
    expect(container.textContent).toContain("Esperando a que alguien lo coja");
  });

  it("y cuando alguien ACUSA, dice QUIÉN y a qué hora", async () => {
    await pintar(
      <PuertaApuntado
        {...base}
        aviso={{
          nivelPrevisto: "N2",
          servidor: {
            incidenciaId: "i1",
            nivel: "N2",
            nombreDelTipo: "Fiebre",
            avisadoEn: ["ENFERMERIA"],
            acusadoPor: "Lucía",
            acusadoComo: "DUE",
            acusadoEn: "2026-10-18T08:43:00.000Z",
          },
        }}
      />,
    );
    expect(container.textContent).toContain("Aviso recibido por Lucía");
  });

  it("SIN RED NO SE FINGE: la banda ámbar dice que el aviso NO ha salido", async () => {
    // Es el peor fallo posible del bloque y por eso tiene su test: un
    // aviso que no sale y parece que sí.
    await pintar(
      <PuertaApuntado
        {...base}
        hayRed={false}
        lineas={[{ id: "r1", texto: "Temperatura: 38,6 °C", enLaTablet: true }]}
        aviso={{ nivelPrevisto: "N2", servidor: null }}
      />,
    );
    expect(container.textContent).toContain("NO ha salido");
    expect(container.textContent).toContain("Avisa a la enfermera en persona");
    // Y NO dice «avisado» por ninguna parte.
    expect(container.textContent).not.toContain("Avisado en");
  });

  it("…pero con un N1 pendiente NO alarma: ese no tenía que sonar", async () => {
    await pintar(
      <PuertaApuntado
        {...base}
        hayRed={false}
        lineas={[{ id: "r1", texto: "Algo no va bien", enLaTablet: true }]}
        aviso={{ nivelPrevisto: "N1", servidor: null }}
      />,
    );
    expect(container.textContent).not.toContain("NO ha salido");
  });

  it("N4 pinta «Llama al 112» en grande y arriba", async () => {
    await pintar(
      <PuertaApuntado
        {...base}
        aviso={{
          nivelPrevisto: "N4",
          servidor: {
            incidenciaId: "i1",
            nivel: "N4",
            nombreDelTipo: "No localizado",
            avisadoEn: ["ENFERMERIA", "RESPONSABLE"],
            acusadoPor: null,
            acusadoComo: null,
            acusadoEn: null,
          },
        }}
      />,
    );
    const banda = [...container.querySelectorAll("p")].find(
      (p) => p.textContent === "Llama al 112",
    );
    expect(banda).toBeTruthy();
    expect(banda!.className).toContain("bg-red-600");
    expect(banda!.getAttribute("role")).toBe("alert");
  });

  it("y un N1 dice que NO suena en ningún sitio, en vez de callarse", async () => {
    await pintar(
      <PuertaApuntado
        {...base}
        aviso={{
          nivelPrevisto: "N1",
          servidor: {
            incidenciaId: "i1",
            nivel: "N1",
            nombreDelTipo: "Algo no va bien",
            avisadoEn: [],
            acusadoPor: null,
            acusadoComo: null,
            acusadoEn: null,
          },
        }}
      />,
    );
    expect(container.textContent).toContain("No suena en ningún móvil");
  });
});

// ══ 4 · EL MÓVIL DE GUARDIA ═══════════════════════════════════════
describe("el aviso en el móvil de guardia", () => {
  const AVISO: AvisoDeGuardia = {
    id: "a1",
    canal: "ENFERMERIA",
    nivel: "N2",
    estado: "DELIVERED",
    apuntadoEn: "2026-10-18T08:41:00.000Z",
    salidoEn: "2026-10-18T08:41:02.000Z",
    escalado: false,
    incidencia: {
      id: "i1",
      tipo: "FIEBRE",
      nombreDelTipo: "Fiebre",
      nivel: "N2",
      origen: "DERIVED_THRESHOLD",
      abiertaEn: "2026-10-18T08:41:00.000Z",
      habitacion: { numero: "112", nombre: null },
      residente: { id: "c1", nombre: "Carmen Gómez" },
      tieneFoto: false,
      descripcion: null,
      medida: { control: "TEMPERATURA", numero: 38.6, unidad: "°C" },
    },
  };
  const props = {
    aviso: AVISO,
    quedan: 0,
    quien: { nombre: "Lucía", rolName: "DUE" },
    servicio: { nombre: "Centro de Salud de Buenaventura", telefono: "925000000" },
    hayRed: true,
    onVoy: () => {},
    onLlamada: () => {},
  };

  it("dice la habitación, el residente, qué pasa y el número", async () => {
    await pintar(<GuardiaAviso {...props} />);
    expect(container.textContent).toContain("Habitación 112");
    expect(container.textContent).toContain("Carmen Gómez");
    expect(container.textContent).toContain("Fiebre");
    expect(container.textContent).toContain("38,6 °C");
  });

  it("«Voy» es UN botón grande y firma con quien lleva el móvil", async () => {
    const pulsados: number[] = [];
    await pintar(<GuardiaAviso {...props} onVoy={() => pulsados.push(1)} />);
    const voy = botones().find((b) => b.textContent === "Voy")!;
    expect(voy.className).toContain("min-h-[120px]");
    expect(container.textContent).toContain("Firmará Lucía · DUE");
    act(() => voy.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(pulsados).toHaveLength(1);
  });

  it("en N2 NO recomienda llamar a nadie (D-33: sólo en N3 y N4)", async () => {
    await pintar(<GuardiaAviso {...props} />);
    expect(container.textContent).not.toContain("Recomendado: llamar");
  });

  it("en N3 SÍ, y el botón ABRE EL MARCADOR: no llama solo", async () => {
    await pintar(
      <GuardiaAviso
        {...props}
        aviso={{ ...AVISO, nivel: "N3", incidencia: { ...AVISO.incidencia, nivel: "N3" } }}
      />,
    );
    expect(container.textContent).toContain(
      "Recomendado: llamar a Centro de Salud de Buenaventura",
    );
    const enlace = container.querySelector("a[href^='tel:']");
    // Es un `<a href="tel:">`, no un `fetch`: **la llamada la hace la
    // persona** y el sistema no habla con el exterior por su cuenta.
    expect(enlace).toBeTruthy();
    expect(enlace!.getAttribute("href")).toBe("tel:925000000");
    // Y «no hace falta llamar» también se apunta: las dos respuestas son
    // constancia.
    expect(container.textContent).toContain("No hace falta llamar");
  });

  it("N4 pinta «Llama al 112» y el fondo entero en rojo", async () => {
    await pintar(
      <GuardiaAviso
        {...props}
        aviso={{ ...AVISO, nivel: "N4", incidencia: { ...AVISO.incidencia, nivel: "N4" } }}
      />,
    );
    expect(container.textContent).toContain("Llama al 112");
    expect(container.firstElementChild!.className).toContain("bg-red-600");
  });

  it("un aviso que llegó TARDE lo dice con los minutos", async () => {
    await pintar(
      <GuardiaAviso
        {...props}
        aviso={{ ...AVISO, salidoEn: "2026-10-18T10:41:00.000Z" }}
      />,
    );
    expect(container.textContent).toContain("llegó 120 min más tarde");
    expect(container.textContent).toContain("la tablet estaba sin red");
  });

  it("y SIN RED el móvil dice que «Voy» no saldrá", async () => {
    await pintar(<GuardiaAviso {...props} hayRed={false} />);
    expect(container.textContent).toContain("«Voy» no saldrá hasta que vuelva");
  });

  it("con más avisos detrás, lo dice en pequeño y no abre una lista", async () => {
    await pintar(<GuardiaAviso {...props} quedan={2} />);
    expect(container.textContent).toContain("Y 2 avisos más detrás de éste");
  });
});
