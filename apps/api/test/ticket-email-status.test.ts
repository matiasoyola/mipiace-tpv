// Sole · "¿en qué estado está el email de este ticket?", una sola vez.
//
// Es función pura y se prueba aparte porque la consumen tres pantallas
// (el histórico del TPV, la pantalla post-cobro y el resumen del panel)
// y el criterio del bloque es que no puedan discrepar: si el TPV dice
// "enviado" y el panel dice "pendiente", la peluquería deja de creerse
// los dos.

import { describe, expect, it } from "vitest";

import {
  deriveTicketEmailState,
  humanEmailFailureReason,
} from "../src/tickets/email-status.js";

const T0 = new Date("2026-09-17T11:00:00Z");
const T1 = new Date("2026-09-17T11:05:00Z");
const T2 = new Date("2026-09-18T09:00:00Z");

function job(over: Partial<Parameters<typeof deriveTicketEmailState>[0]["jobs"][number]> = {}) {
  return {
    toEmail: "ana@ejemplo.com",
    status: "PENDING",
    sentAt: null as Date | null,
    createdAt: T0,
    lastError: null as unknown,
    ...over,
  };
}

describe("deriveTicketEmailState", () => {
  it("sin job no hay envío, pero el email tecleado se conserva", () => {
    // Para que el campo de reenvío del histórico nazca prellenado.
    expect(
      deriveTicketEmailState({
        jobs: [],
        emailIntent: "ana@ejemplo.com",
        emailFailedAt: null,
      }),
    ).toEqual({
      to: "ana@ejemplo.com",
      status: null,
      reason: null,
      at: null,
    });
  });

  it("recién encolado es PENDIENTE, no enviado · es el badge del cobro", () => {
    // El fallo de origen: la pantalla post-cobro decía "Enviado" porque
    // existía la fila. Existir un job no es haberse enviado.
    const state = deriveTicketEmailState({
      jobs: [job()],
      emailIntent: "ana@ejemplo.com",
      emailFailedAt: null,
    });
    expect(state.status).toBe("PENDING");
    expect(state.to).toBe("ana@ejemplo.com");
  });

  it("DONE es ENVIADO, con la hora en que salió", () => {
    const state = deriveTicketEmailState({
      jobs: [job({ status: "DONE", sentAt: T1 })],
      emailIntent: null,
      emailFailedAt: null,
    });
    expect(state.status).toBe("SENT");
    expect(state.at).toBe(T1.toISOString());
  });

  it("FAILED trae el motivo en lenguaje de persona", () => {
    const state = deriveTicketEmailState({
      jobs: [job({ status: "FAILED", lastError: { reason: "invalid_email" } })],
      emailIntent: null,
      emailFailedAt: T1,
    });
    expect(state.status).toBe("FAILED");
    expect(state.reason).toBe("La dirección no es válida");
    expect(state.at).toBe(T1.toISOString());
  });

  it("el 000257 · un job de ANTES del bloque: PENDING en la fila pero el ticket marcado", () => {
    // El worker viejo escribía `Ticket.email_failed_at` y dejaba la fila
    // en PENDING. Decir "pendiente" sobre eso es la misma mentira en el
    // otro sentido: el envío murió hace seis días.
    const state = deriveTicketEmailState({
      jobs: [job({ toEmail: "abc", status: "PENDING", createdAt: T0 })],
      emailIntent: "abc",
      emailFailedAt: T1,
    });
    expect(state.status).toBe("FAILED");
    expect(state.to).toBe("abc");
    expect(state.at).toBe(T1.toISOString());
  });

  it("y un reenvío POSTERIOR a esa marca vuelve a estar pendiente", () => {
    // El 18-09 el 000257 se reenvió a mano. Un job nuevo, creado después
    // de la marca de fallo, no hereda el fallo de ayer.
    const state = deriveTicketEmailState({
      jobs: [job({ status: "PENDING", createdAt: T2 })],
      emailIntent: "abc",
      emailFailedAt: T1,
    });
    expect(state.status).toBe("PENDING");
  });

  it("manda el job MÁS RECIENTE: un reenvío bueno tapa el fallo de antes", () => {
    const state = deriveTicketEmailState({
      jobs: [
        job({ status: "DONE", sentAt: T2, createdAt: T2 }),
        job({ toEmail: "abc", status: "FAILED", createdAt: T0 }),
      ],
      emailIntent: "abc",
      emailFailedAt: T1,
    });
    expect(state.status).toBe("SENT");
    expect(state.to).toBe("ana@ejemplo.com");
  });

  it("el ticket de modo prueba se distingue: ni enviado ni fallido", () => {
    const state = deriveTicketEmailState({
      jobs: [job({ status: "SKIPPED_TEST", sentAt: T1 })],
      emailIntent: null,
      emailFailedAt: null,
    });
    expect(state.status).toBe("SKIPPED_TEST");
  });
});

describe("humanEmailFailureReason", () => {
  it("traduce las causas que se pueden arreglar desde la peluquería", () => {
    expect(humanEmailFailureReason({ reason: "invalid_email" })).toBe(
      "La dirección no es válida",
    );
    expect(
      humanEmailFailureReason({
        reason: "send_failed",
        message: "550 5.1.1 Recipient address rejected: User unknown",
      }),
    ).toBe("El servidor de correo la rechazó");
  });

  it("y distingue las que no son culpa de nadie de allí", () => {
    expect(
      humanEmailFailureReason({
        reason: "send_failed",
        message: "connect ETIMEDOUT 10.0.0.1:587",
      }),
    ).toBe("No hubo respuesta del servidor de correo");
    expect(
      humanEmailFailureReason({
        reason: "send_failed",
        message: "getaddrinfo ENOTFOUND smtp.ejemplo.com",
      }),
    ).toBe("No hubo respuesta del servidor de correo");
  });

  it("nunca enseña un volcado técnico: lo desconocido es 'No se pudo enviar'", () => {
    expect(humanEmailFailureReason(null)).toBe("No se pudo enviar");
    expect(humanEmailFailureReason("vaya")).toBe("No se pudo enviar");
    expect(
      humanEmailFailureReason({ reason: "send_failed", message: "EPIPE" }),
    ).toBe("No se pudo enviar");
  });
});
