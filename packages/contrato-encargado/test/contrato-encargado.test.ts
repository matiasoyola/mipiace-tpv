// clinica-7 · el contrato de encargado y el estado del módulo.
//
// Dos mitades, y la primera es la que obliga a sacar versiones:
//
//   1. **LA HUELLA DEL TEXTO ESTÁ FIJADA.** Cambiar una coma de la v1 pone
//      este fichero en rojo. Es lo mismo que el test de las plantillas de
//      clinica-4 y existe por lo mismo: la fila de aceptación guarda la
//      huella, y si el texto se reescribe en su sitio la huella guardada
//      deja de cuadrar con lo que la pantalla enseña — y entonces no
//      demuestra nada. Cuando llegue la v1 del abogado, entra como v2 y
//      esta constante no se toca.
//   2. **Los cuatro casos del estado**, cada uno con su sabotaje posible.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  AVISO_SOLO_LA_DUENA,
  BANDA_SOLO_LECTURA,
  CONTRATO_VIGENTE,
  VERSION_VIGENTE,
  admiteNotasEnCita,
  contratoDe,
  MENSAJE_CONTRATO_NO_VIGENTE,
  enseñaBandaDeSoloLectura,
  estadoDelModuloClinico,
  permiteEscribirHistoria,
  permiteLeerHistoria,
  textoCanonico,
  versionesConocidas,
  type EntradaDelEstado,
  type FilaDelContrato,
} from "../src/index.js";

function huella(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

// ── 1 · El texto, fijado ──────────────────────────────────────────────

describe("el texto del contrato", () => {
  // SI ESTE TEST SE PONE ROJO, la respuesta no es cambiar la constante: es
  // sacar una versión nueva. Una versión publicada no se reescribe porque
  // hay filas que apuntan a ella.
  const HUELLA_V1 =
    "7baee64a600f5a9de15038758b7118f99185174acda455df9426b35126bd0d8a";

  it("la huella de la v1 es la que está escrita aquí", () => {
    const v1 = contratoDe(1);
    expect(v1).toBeDefined();
    expect(huella(textoCanonico(v1!))).toBe(HUELLA_V1);
  });

  it("la vigente es la v1 y está marcada como pendiente de validar", () => {
    expect(VERSION_VIGENTE).toBe(1);
    expect(CONTRATO_VIGENTE.version).toBe(1);
    // Mientras sea `true`, la pantalla enseña el aviso ámbar. Cuando
    // llegue el texto del abogado esto pasa a `false` EN LA VERSIÓN NUEVA.
    expect(CONTRATO_VIGENTE.pendienteDeValidar).toBe(true);
  });

  it("el texto canónico lleva el título y todos los apartados", () => {
    const texto = textoCanonico(CONTRATO_VIGENTE);
    expect(texto.startsWith(CONTRATO_VIGENTE.titulo)).toBe(true);
    for (const apartado of CONTRATO_VIGENTE.apartados) {
      expect(texto).toContain(apartado.encabezado);
      for (const p of apartado.parrafos) expect(texto).toContain(p);
    }
  });

  it("cubre las ocho letras del art. 28.3 RGPD, cada una en su apartado", () => {
    // El abogado tiene que poder tachar una letra y ver qué queda sin
    // cubrir. Si un apartado desaparece, este test lo dice.
    const encabezados = CONTRATO_VIGENTE.apartados.map((a) => a.encabezado);
    for (const letra of ["a)", "b)", "c)", "d)", "e)", "f)", "g)", "h)"]) {
      expect(
        encabezados.some((e) => e.startsWith(letra)),
        `falta el apartado ${letra} del art. 28.3`,
      ).toBe(true);
    }
  });

  it("nombra el objeto, la duración, la naturaleza, el fin, el tipo de datos y los interesados", () => {
    // Los seis que el art. 28.3 exige nombrar ADEMÁS de las ocho letras.
    const texto = textoCanonico(CONTRATO_VIGENTE).toUpperCase();
    for (const exigido of [
      "OBJETO",
      "DURACIÓN",
      "NATURALEZA DEL TRATAMIENTO",
      "TIPO DE DATOS",
      "CATEGORÍAS DE INTERESADOS",
    ]) {
      expect(texto, `falta ${exigido}`).toContain(exigido);
    }
  });

  it("no se quita ninguna versión conocida", () => {
    // Una fila de aceptación apunta a su versión para siempre; quitarla de
    // aquí deja una aceptación cuyo PDF no se puede volver a sacar.
    expect(versionesConocidas()).toContain(1);
  });

  it("una versión que este despliegue no conoce es `undefined`, no «la de ahora»", () => {
    // Caer a la vigente sería afirmar que la dueña aceptó un texto que no
    // existía.
    expect(contratoDe(99)).toBeUndefined();
  });
});

// ── 2 · El estado del módulo: los cuatro casos ───────────────────────

const ACEPTACION_V1: FilaDelContrato = {
  id: "a1",
  version: 1,
  revokesAgreementId: null,
};

function entrada(over: Partial<EntradaDelEstado> = {}): EntradaDelEstado {
  return {
    clinicaEncendida: true,
    filas: [],
    versionVigente: 1,
    ...over,
  };
}

describe("el estado del módulo clínico", () => {
  it("APAGADO cuando la clínica no está encendida, sin mirar ninguna fila", () => {
    // Y con filas dentro: un tenant al que se le apagó el módulo no pasa a
    // «vigente» porque un día aceptó.
    expect(
      estadoDelModuloClinico(
        entrada({ clinicaEncendida: false, filas: [ACEPTACION_V1] }),
      ),
    ).toEqual({ estado: "APAGADO" });
  });

  it("SIN_CONTRATO encendido y nunca aceptado", () => {
    expect(estadoDelModuloClinico(entrada())).toEqual({
      estado: "SIN_CONTRATO",
    });
  });

  it("SIN_CONTRATO cuando solo hay revocaciones huérfanas", () => {
    // No puede pasar (la FK lo impide), y si pasara no se inventa una
    // aceptación: sin aceptación no hay contrato.
    expect(
      estadoDelModuloClinico(
        entrada({
          filas: [{ id: "r1", version: 1, revokesAgreementId: "no-existe" }],
        }),
      ),
    ).toEqual({ estado: "SIN_CONTRATO" });
  });

  it("VIGENTE con la versión de hoy aceptada y sin revocar", () => {
    expect(
      estadoDelModuloClinico(entrada({ filas: [ACEPTACION_V1] })),
    ).toEqual({ estado: "VIGENTE", versionAceptada: 1 });
  });

  it("SOLO_LECTURA / REVOCADO cuando la aceptación está revocada", () => {
    expect(
      estadoDelModuloClinico(
        entrada({
          filas: [
            ACEPTACION_V1,
            { id: "r1", version: 1, revokesAgreementId: "a1" },
          ],
        }),
      ),
    ).toEqual({
      estado: "SOLO_LECTURA",
      motivo: "REVOCADO",
      versionAceptada: null,
    });
  });

  it("SOLO_LECTURA / VERSION_ANTIGUA cuando solo se aceptó una versión anterior", () => {
    expect(
      estadoDelModuloClinico(
        entrada({ filas: [ACEPTACION_V1], versionVigente: 2 }),
      ),
    ).toEqual({
      estado: "SOLO_LECTURA",
      motivo: "VERSION_ANTIGUA",
      versionAceptada: 1,
    });
  });

  it("VOLVER A ACEPTAR después de revocar devuelve a VIGENTE, sin editar nada", () => {
    // Es el punto del mecanismo de solo inserción: la fila revocada se
    // queda, y la aceptación nueva es otra fila.
    expect(
      estadoDelModuloClinico(
        entrada({
          filas: [
            ACEPTACION_V1,
            { id: "r1", version: 1, revokesAgreementId: "a1" },
            { id: "a2", version: 1, revokesAgreementId: null },
          ],
        }),
      ),
    ).toEqual({ estado: "VIGENTE", versionAceptada: 1 });
  });

  it("con la v2 viva manda la v2, aunque la v1 también esté viva", () => {
    expect(
      estadoDelModuloClinico(
        entrada({
          filas: [ACEPTACION_V1, { id: "a2", version: 2, revokesAgreementId: null }],
          versionVigente: 2,
        }),
      ),
    ).toEqual({ estado: "VIGENTE", versionAceptada: 2 });
  });

  it("revocar la v2 y dejar la v1 viva deja SOLO_LECTURA por versión antigua", () => {
    expect(
      estadoDelModuloClinico(
        entrada({
          filas: [
            ACEPTACION_V1,
            { id: "a2", version: 2, revokesAgreementId: null },
            { id: "r2", version: 2, revokesAgreementId: "a2" },
          ],
          versionVigente: 2,
        }),
      ),
    ).toEqual({
      estado: "SOLO_LECTURA",
      motivo: "VERSION_ANTIGUA",
      versionAceptada: 1,
    });
  });

  it("una aceptación MÁS NUEVA que la vigente sigue siendo VIGENTE", () => {
    // Un rollback de la API con filas ya escritas. Lo que no puede hacer
    // es bloquear las escrituras de una clínica que aceptó más de lo que
    // se le pedía.
    expect(
      estadoDelModuloClinico(
        entrada({
          filas: [{ id: "a9", version: 9, revokesAgreementId: null }],
          versionVigente: 1,
        }),
      ),
    ).toEqual({ estado: "VIGENTE", versionAceptada: 9 });
  });

  it("el orden de las filas no cambia el resultado", () => {
    const filas: FilaDelContrato[] = [
      { id: "r1", version: 1, revokesAgreementId: "a1" },
      ACEPTACION_V1,
    ];
    const alReves = [...filas].reverse();
    expect(estadoDelModuloClinico(entrada({ filas }))).toEqual(
      estadoDelModuloClinico(entrada({ filas: alReves })),
    );
  });
});

// ── 3 · Lo que cuelga del estado ─────────────────────────────────────

describe("lo que cada estado permite", () => {
  const APAGADO = estadoDelModuloClinico(entrada({ clinicaEncendida: false }));
  const SIN_CONTRATO = estadoDelModuloClinico(entrada());
  const VIGENTE = estadoDelModuloClinico(entrada({ filas: [ACEPTACION_V1] }));
  const REVOCADO = estadoDelModuloClinico(
    entrada({
      filas: [ACEPTACION_V1, { id: "r1", version: 1, revokesAgreementId: "a1" }],
    }),
  );
  const ANTIGUA = estadoDelModuloClinico(
    entrada({ filas: [ACEPTACION_V1], versionVigente: 2 }),
  );

  it("leer: sí con el contrato vigente y sí en solo lectura", () => {
    expect(permiteLeerHistoria(VIGENTE)).toBe(true);
    expect(permiteLeerHistoria(REVOCADO)).toBe(true);
    expect(permiteLeerHistoria(ANTIGUA)).toBe(true);
  });

  it("leer: NO sin contrato y NO con el módulo apagado", () => {
    expect(permiteLeerHistoria(SIN_CONTRATO)).toBe(false);
    expect(permiteLeerHistoria(APAGADO)).toBe(false);
  });

  it("escribir: SOLO con el contrato vigente", () => {
    expect(permiteEscribirHistoria(VIGENTE)).toBe(true);
    expect(permiteEscribirHistoria(REVOCADO)).toBe(false);
    expect(permiteEscribirHistoria(ANTIGUA)).toBe(false);
    expect(permiteEscribirHistoria(SIN_CONTRATO)).toBe(false);
    expect(permiteEscribirHistoria(APAGADO)).toBe(false);
  });

  it("notas en cita nueva: sí con el módulo apagado (la agenda del bar no cambia)", () => {
    expect(admiteNotasEnCita(APAGADO)).toBe(true);
  });

  it("notas en cita nueva: NO en un tenant clínico sin contrato vigente", () => {
    expect(admiteNotasEnCita(VIGENTE)).toBe(true);
    expect(admiteNotasEnCita(REVOCADO)).toBe(false);
    expect(admiteNotasEnCita(ANTIGUA)).toBe(false);
    expect(admiteNotasEnCita(SIN_CONTRATO)).toBe(false);
  });

  it("la banda de solo lectura: solo en SOLO_LECTURA", () => {
    // `SIN_CONTRATO` no lleva banda: lleva la pantalla de aceptación
    // entera, que no es un aviso sobre una pantalla a medias.
    expect(enseñaBandaDeSoloLectura(REVOCADO)).toBe(true);
    expect(enseñaBandaDeSoloLectura(ANTIGUA)).toBe(true);
    expect(enseñaBandaDeSoloLectura(SIN_CONTRATO)).toBe(false);
    expect(enseñaBandaDeSoloLectura(VIGENTE)).toBe(false);
    expect(enseñaBandaDeSoloLectura(APAGADO)).toBe(false);
  });
});

describe("los textos que las pantallas no escriben", () => {
  it("el aviso al que no es la dueña es el de la decisión 2, palabra por palabra", () => {
    expect(AVISO_SOLO_LA_DUENA).toBe(
      "La dueña tiene que aceptar el contrato de tratamiento de datos antes de usar la historia clínica.",
    );
  });

  it("la banda es la de la decisión 5, palabra por palabra", () => {
    expect(BANDA_SOLO_LECTURA).toBe(
      "Historia clínica en solo lectura: el contrato de tratamiento no está vigente.",
    );
  });

  it("el 423 dice QUÉ se puede hacer, no solo que no se puede", () => {
    // Un 423 que solo diga «no se puede escribir» manda a la podóloga a
    // llamar a Mi Piace. El mensaje tiene que decir las dos cosas que ella
    // necesita saber: que leer y exportar sí, y quién lo arregla.
    expect(MENSAJE_CONTRATO_NO_VIGENTE).toContain("solo lectura");
    expect(MENSAJE_CONTRATO_NO_VIGENTE).toContain("exportar");
    expect(MENSAJE_CONTRATO_NO_VIGENTE).toContain("la dueña");
  });
});
