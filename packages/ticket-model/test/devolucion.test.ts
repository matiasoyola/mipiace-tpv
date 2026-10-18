// auditoria-sirope (#17) · la regla de «¿es devolvible?».
//
// El caso que estrenó el bloque está el primero: Cafetería Sirope, en
// ensayo y sin Holded, no podía devolver NADA porque el TPV sólo pintaba
// el botón con `SYNCED`.

import { describe, expect, it } from "vitest";

import {
  esDevolvible,
  mensajeNoDevolvible,
  motivoNoDevolvible,
  type ContextoDeDevolucion,
  type EstadoDeTicket,
} from "../src/devolucion.js";

const ENSAYO: ContextoDeDevolucion = { enEnsayo: true, sesionDePrueba: false };
const FACTURANDO: ContextoDeDevolucion = {
  enEnsayo: false,
  sesionDePrueba: false,
};
const CAJERO_TECNICO: ContextoDeDevolucion = {
  enEnsayo: false,
  sesionDePrueba: true,
};

describe("esDevolvible", () => {
  it("un ticket PAID (cuenta SIN Holded) se devuelve", () => {
    // El fallo de Sirope: sin Holded el ticket nace PAID y no pasa nunca
    // por SYNCED (`paidTicketStatus`), así que el botón no aparecía.
    expect(esDevolvible("PAID", FACTURANDO)).toBe(true);
    expect(esDevolvible("PAID", ENSAYO)).toBe(true);
  });

  it("un ticket TEST de una cuenta EN ENSAYO se devuelve", () => {
    // El otro medio fallo: en ensayo los tickets nacen TEST sin que haya
    // ninguna sesión de cajero técnico detrás.
    expect(esDevolvible("TEST", ENSAYO)).toBe(true);
  });

  it("un ticket TEST con sesión de cajero técnico se devuelve (v1.9.5)", () => {
    expect(esDevolvible("TEST", CAJERO_TECNICO)).toBe(true);
  });

  it("un ticket TEST en una cuenta que YA factura no se devuelve", () => {
    // Resto de una prueba vieja: devolverlo movería caja de verdad.
    expect(esDevolvible("TEST", FACTURANDO)).toBe(false);
    expect(motivoNoDevolvible("TEST", FACTURANDO)).toBe(
      "DE_PRUEBA_FUERA_DE_ENSAYO",
    );
  });

  it("SYNCED se devuelve, como siempre", () => {
    expect(esDevolvible("SYNCED", FACTURANDO)).toBe(true);
  });

  it.each<[EstadoDeTicket, string]>([
    ["DRAFT", "NO_COBRADO"],
    ["ON_CREDIT", "NO_COBRADO"],
    ["VOIDED", "YA_ANULADO"],
    ["PENDING_SYNC", "PENDIENTE_DE_SINCRONIZAR"],
    ["SYNC_FAILED", "SINCRONIZACION_FALLIDA"],
  ])("%s no se devuelve (%s)", (status, motivo) => {
    expect(esDevolvible(status, ENSAYO)).toBe(false);
    expect(motivoNoDevolvible(status, ENSAYO)).toBe(motivo);
  });
});

describe("mensajeNoDevolvible", () => {
  it("no menciona Holded en una cuenta que no lo usa", () => {
    // El mensaje viejo —«Sólo se puede devolver un ticket cobrado y
    // sincronizado con Holded»— era mentira en Sirope, que no sincroniza
    // con nadie.
    const todos = (
      [
        "NO_COBRADO",
        "YA_ANULADO",
        "PENDIENTE_DE_SINCRONIZAR",
        "SINCRONIZACION_FALLIDA",
        "DE_PRUEBA_FUERA_DE_ENSAYO",
      ] as const
    ).map(mensajeNoDevolvible);
    for (const m of todos) {
      expect(m).not.toMatch(/Holded/i);
      expect(m.length).toBeGreaterThan(10);
    }
  });
});
