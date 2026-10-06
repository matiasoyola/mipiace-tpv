// clinica-2 · la puerta del primer tratamiento.
//
// Esta función es la que `clinica-3` va a usar para no dejar registrar un
// tratamiento sin valoración validada. Aquí se fija su tabla de casos
// entera, incluido lo que la función NO hace (caducar).

import { describe, expect, it } from "vitest";

import {
  puedeRecibirPrimerTratamiento,
  type ValoracionParaPuerta,
} from "../src/index.js";

const validada = (
  id: string,
  validadaEn: string,
): ValoracionParaPuerta => ({ id, estado: "VALIDADA", validadaEn });

describe("clinica-2 · ¿puede recibir su primer tratamiento?", () => {
  it("sin ninguna valoración, NO — y el mensaje dice mandar el test", () => {
    const r = puedeRecibirPrimerTratamiento([]);
    expect(r.puede).toBe(false);
    if (!r.puede) {
      expect(r.motivo).toBe("SIN_VALORACION");
      expect(r.mensaje).toMatch(/test/);
    }
  });

  it("con el test mandado y sin contestar, NO", () => {
    const r = puedeRecibirPrimerTratamiento([
      { id: "v1", estado: "PENDIENTE_PACIENTE", validadaEn: null },
    ]);
    expect(r).toMatchObject({ puede: false, motivo: "VALORACION_SIN_RESPONDER" });
  });

  it("CONTESTADA PERO SIN VALIDAR, NO. Es el fallo que el bloque cierra", () => {
    // El paciente contestó que es diabético y anticoagulado y nadie lo ha
    // mirado. Dejar tratar aquí sería tener el dato y no usarlo.
    const r = puedeRecibirPrimerTratamiento([
      { id: "v1", estado: "RESPONDIDA", validadaEn: null },
    ]);
    expect(r).toMatchObject({ puede: false, motivo: "VALORACION_SIN_VALIDAR" });
  });

  it("con una valoración VALIDADA, sí — y dice cuál", () => {
    const r = puedeRecibirPrimerTratamiento([
      validada("v1", "2026-10-06T10:34:00.000Z"),
    ]);
    expect(r).toEqual({
      puede: true,
      valoracionId: "v1",
      validadaEn: "2026-10-06T10:34:00.000Z",
    });
  });

  it("con varias validadas, manda LA MÁS RECIENTE", () => {
    const r = puedeRecibirPrimerTratamiento([
      validada("vieja", "2025-01-02T09:00:00.000Z"),
      validada("nueva", "2026-10-06T10:34:00.000Z"),
    ]);
    expect(r).toMatchObject({ puede: true, valoracionId: "nueva" });
  });

  it("el orden en que llegan no cambia el resultado", () => {
    const a = puedeRecibirPrimerTratamiento([
      validada("nueva", "2026-10-06T10:34:00.000Z"),
      validada("vieja", "2025-01-02T09:00:00.000Z"),
    ]);
    expect(a).toMatchObject({ valoracionId: "nueva" });
  });

  it("UN REPASO ABIERTO NO QUITA EL PERMISO", () => {
    // Decisión 7: la valoración se repasa creando una nueva. Si empezar a
    // repasar suspendiera la consulta, el repaso saldría caro y nadie lo
    // haría. Lo que está en la historia es la validación anterior.
    const r = puedeRecibirPrimerTratamiento([
      validada("v1", "2026-05-02T09:00:00.000Z"),
      { id: "v2", estado: "PENDIENTE_PACIENTE", validadaEn: null },
    ]);
    expect(r).toMatchObject({ puede: true, valoracionId: "v1" });
  });

  it("NO CADUCA: una validación de hace cinco años sigue valiendo", () => {
    // No es un olvido. La ley no pone plazo y Dirección no lo ha fijado;
    // inventar un número aquí sería esconder una decisión de producto en
    // una función. Queda como duda abierta en el done del bloque. Este
    // test está para que, el día que se fije, se vea que cambia aquí.
    const r = puedeRecibirPrimerTratamiento([
      validada("v1", "2021-03-01T09:00:00.000Z"),
    ]);
    expect(r).toMatchObject({ puede: true });
  });

  it("una fila VALIDADA sin fecha no cuenta: la firma es parte de la validación", () => {
    // El estado es un enum y la fecha una columna; la base no deja ese
    // estado (CHECK `clinical_assessments_validada_firmada`), y aun así la
    // función no se fía: una validación sin hora no es una validación.
    const r = puedeRecibirPrimerTratamiento([
      { id: "v1", estado: "VALIDADA", validadaEn: null },
    ]);
    expect(r).toMatchObject({ puede: false });
  });
});
