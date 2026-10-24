// clinica-9 · lo puro de los puntos 12, 14 y 15.
//
// Tres decisiones pequeñas de la pasada en hierro del 24-10 que se pueden
// probar sin navegador, y que se prueban aquí porque son justo las que un
// test de pantalla no mira: con qué día abre la agenda al volver de la
// tablet, cuándo se avisa de poca luz, y qué nombre va arriba del ticket.

import { describe, expect, it } from "vitest";

import {
  MINUTOS_DE_RECUERDO,
  diaConElQueAbrir,
} from "../src/lib/dia-de-la-agenda.js";
import { avisarDePocaLuz, luminanciaMedia } from "../src/clinica/Fotos.js";
import {
  NOMBRE_DE_TIENDA_POR_DEFECTO,
  rotuloDeLaCabecera,
} from "@mipiacetpv/ticket-model";

// ── 12 · LA AGENDA VUELVE AL DÍA EN EL QUE SE ESTABA ────────────────
//
// Captura 16: la recepción está en la agenda del lunes 26, le da la
// tablet a la paciente para el test, la paciente la devuelve — y la
// agenda vuelve a HOY. El camino de la tablet es una navegación de
// verdad (`location.replace`) y se lleva por delante el estado de React.
describe("clinica-9 · con qué día abre la agenda", () => {
  const HOY = "2026-10-24";
  const AHORA = Date.parse("2026-10-24T10:00:00.000Z");
  const recuerdo = (x: Record<string, unknown>) => JSON.stringify(x);

  it("sin recuerdo, hoy", () => {
    expect(
      diaConElQueAbrir({ crudo: null, hoy: HOY, ahora: AHORA, carga: "b" }),
    ).toBe(HOY);
  });

  it("el día en el que se estaba, si lo apuntó OTRA carga y fue hace nada", () => {
    expect(
      diaConElQueAbrir({
        crudo: recuerdo({ dia: "2026-10-26", en: AHORA - 60_000, carga: "a" }),
        hoy: HOY,
        ahora: AHORA,
        carga: "b",
      }),
    ).toBe("2026-10-26");
  });

  it("pero NO si lo apuntó esta misma carga: ahí no hubo recarga", () => {
    // Abrir y cerrar la agenda dentro de la misma pantalla no se lleva
    // nada: ahí se abre en hoy, como siempre.
    expect(
      diaConElQueAbrir({
        crudo: recuerdo({ dia: "2026-10-26", en: AHORA - 60_000, carga: "b" }),
        hoy: HOY,
        ahora: AHORA,
        carga: "b",
      }),
    ).toBe(HOY);
  });

  it("ni si es de hace más de diez minutos", () => {
    expect(
      diaConElQueAbrir({
        crudo: recuerdo({
          dia: "2026-10-26",
          en: AHORA - (MINUTOS_DE_RECUERDO + 1) * 60_000,
          carga: "a",
        }),
        hoy: HOY,
        ahora: AHORA,
        carga: "b",
      }),
    ).toBe(HOY);
  });

  it("ni un día del PASADO: lo que se salva es la cita que viene", () => {
    expect(
      diaConElQueAbrir({
        crudo: recuerdo({ dia: "2026-10-20", en: AHORA - 1000, carga: "a" }),
        hoy: HOY,
        ahora: AHORA,
        carga: "b",
      }),
    ).toBe(HOY);
  });

  it("un recuerdo roto no tumba la agenda: hoy", () => {
    for (const crudo of ["{", "null", '{"dia":5}', '{"dia":"ayer","en":1}']) {
      expect(
        diaConElQueAbrir({ crudo, hoy: HOY, ahora: AHORA, carga: "b" }),
      ).toBe(HOY);
    }
  });
});

// ── 14 · POCA LUZ ───────────────────────────────────────────────────
//
// La Lenovo M11 no tiene flash (`android.flash.info.available = FALSE`),
// así que «Luz» no sale — y está bien. Lo que faltaba era decirlo cuando
// el visor está oscuro, en vez de dejar que la foto salga negra y se vea
// al mirarla.
describe("clinica-9 · el aviso de poca luz", () => {
  /** Un frame RGBA de un solo tono. */
  const frame = (v: number, n = 16) =>
    new Uint8ClampedArray(Array.from({ length: n * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : v,
    ));

  it("la luminancia de un gris es ese gris", () => {
    expect(Math.round(luminanciaMedia(frame(0)))).toBe(0);
    expect(Math.round(luminanciaMedia(frame(128)))).toBe(128);
    expect(Math.round(luminanciaMedia(frame(255)))).toBe(255);
  });

  it("el verde pesa más que el azul (Rec. 601)", () => {
    const verde = new Uint8ClampedArray([0, 255, 0, 255]);
    const azul = new Uint8ClampedArray([0, 0, 255, 255]);
    expect(luminanciaMedia(verde)).toBeGreaterThan(luminanciaMedia(azul));
  });

  it("sin datos NO se avisa: lo que no se puede medir no se dice", () => {
    // En jsdom no hay `getContext` ni frames. El aviso falla hacia
    // callarse, que es lo correcto: un cartel de «poca luz» sobre un
    // visor que se ve bien enseña a no leerlo.
    expect(luminanciaMedia(new Uint8ClampedArray([]))).toBe(255);
    expect(avisarDePocaLuz(luminanciaMedia(new Uint8ClampedArray([])), false))
      .toBe(false);
  });

  it("se enciende por debajo de 55 y no se apaga hasta 75", () => {
    // La banda existe para que el cartel no parpadee mientras la
    // podóloga encuadra.
    expect(avisarDePocaLuz(40, false)).toBe(true);
    expect(avisarDePocaLuz(60, false)).toBe(false);
    expect(avisarDePocaLuz(60, true)).toBe(true);
    expect(avisarDePocaLuz(80, true)).toBe(false);
  });
});

// ── 15 · EL RÓTULO DEL TICKET ───────────────────────────────────────
//
// Captura 37: el ticket de la «Clínica demo» con «Tienda principal»
// arriba del todo. No es el nombre de nada: es el que el sistema le pone
// a la tienda que crea él solo al activar una cuenta sin ninguna.
describe("clinica-9 · qué nombre va arriba del ticket", () => {
  it("el del negocio cuando la tienda la bautizó el sistema", () => {
    expect(
      rotuloDeLaCabecera(NOMBRE_DE_TIENDA_POR_DEFECTO, "Clínica demo"),
    ).toBe("Clínica demo");
  });

  it("y cuando la tienda no tiene nombre", () => {
    expect(rotuloDeLaCabecera("", "Clínica demo")).toBe("Clínica demo");
    expect(rotuloDeLaCabecera("   ", "Clínica demo")).toBe("Clínica demo");
    expect(rotuloDeLaCabecera(null, "Clínica demo")).toBe("Clínica demo");
  });

  it("ni repite el mismo nombre dos veces", () => {
    expect(rotuloDeLaCabecera("clínica demo", "Clínica demo")).toBe(
      "Clínica demo",
    );
  });

  it("pero el nombre que alguien SÍ escribió manda: distingue una tienda de otra", () => {
    expect(rotuloDeLaCabecera("Sirope · Centro", "Sirope")).toBe(
      "Sirope · Centro",
    );
  });
});
