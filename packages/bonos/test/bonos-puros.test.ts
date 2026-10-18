// B-reservas-8 · lo PURO: cobertura, saldo, devolución y calendario.
//
// Vive en el paquete y no en la API porque lo que prueba lo comparten los
// tres lados. Lo que NO está aquí —el `FOR UPDATE`, el trigger, los CHECK—
// se prueba contra Postgres real en `apps/api/test-e2e/bonos-*.e2e.ts`: «un
// `FOR UPDATE` no se puede fingir».

import { describe, expect, it } from "vitest";

import {
  derivarSaldo,
  desviacionDelInvariante,
  frasePorSesiones,
  porQueNoDevolvible,
  sumarMesesDeCalendario,
  diaSiguiente,
  fechaCorta,
  mensajeDeEstado,
  mensajeNoApartar,
  seArreglaEnElMomento,
  MOTIVOS_CORRECCION,
} from "../src/index.js";

describe("el saldo se DERIVA del libro", () => {
  const CITA = "11111111-1111-4111-8111-111111111111";

  it("una venta de 5 sesiones: cinco libres y nada más", () => {
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
    ]);
    expect(s).toEqual({ total: 5, consumidas: 0, apartadas: 0, libres: 5 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("apartar saca la sesión de LIBRES sin gastarla", () => {
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "APARTADA", sesiones: -1, appointmentId: CITA },
    ]);
    expect(s).toEqual({ total: 5, consumidas: 0, apartadas: 1, libres: 4 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("consumir DESDE UNA CITA no mueve libres: la sesión ya había salido", () => {
    // Es la pieza del convenio del signo que el CHECK de la base obliga.
    // Si esta línea valiera -1, la sesión se contaría dos veces.
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "APARTADA", sesiones: -1, appointmentId: CITA },
      { tipo: "CONSUMIDA", sesiones: 0, appointmentId: CITA },
    ]);
    expect(s).toEqual({ total: 5, consumidas: 1, apartadas: 0, libres: 4 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("y consumir SIN cita sí lo mueve: no pasó por apartada", () => {
    // El canje en caja de la peluquería sin agenda.
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "CONSUMIDA", sesiones: -1, appointmentId: null },
    ]);
    expect(s).toEqual({ total: 5, consumidas: 1, apartadas: 0, libres: 4 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("liberar devuelve la sesión a libres", () => {
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "APARTADA", sesiones: -1, appointmentId: CITA },
      { tipo: "LIBERADA", sesiones: 1, appointmentId: CITA },
    ]);
    expect(s).toEqual({ total: 5, consumidas: 0, apartadas: 0, libres: 5 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("una corrección mueve el total Y los libres", () => {
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "CORRECCION", sesiones: 2, appointmentId: null },
    ]);
    expect(s).toEqual({ total: 7, consumidas: 0, apartadas: 0, libres: 7 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("anular lleva el total a cero y el invariante sigue cuadrando", () => {
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "ANULADO", sesiones: -5, appointmentId: null },
    ]);
    expect(s).toEqual({ total: 0, consumidas: 0, apartadas: 0, libres: 0 });
    expect(desviacionDelInvariante(s)).toBe(0);
  });

  it("y una caducidad cambiada no mueve ninguna cifra", () => {
    const s = derivarSaldo([
      { tipo: "VENDIDO", sesiones: 5, appointmentId: null },
      { tipo: "CADUCIDAD_CAMBIADA", sesiones: 0, appointmentId: null },
    ]);
    expect(s).toEqual({ total: 5, consumidas: 0, apartadas: 0, libres: 5 });
  });

  it("el invariante aguanta un libro largo y revuelto", () => {
    const citas = Array.from({ length: 6 }, (_, i) => `cita-${i}`);
    const libro = [
      { tipo: "VENDIDO", sesiones: 10, appointmentId: null },
      { tipo: "APARTADA", sesiones: -1, appointmentId: citas[0]! },
      { tipo: "APARTADA", sesiones: -1, appointmentId: citas[1]! },
      { tipo: "CONSUMIDA", sesiones: 0, appointmentId: citas[0]! },
      { tipo: "LIBERADA", sesiones: 1, appointmentId: citas[1]! },
      { tipo: "APARTADA", sesiones: -1, appointmentId: citas[2]! },
      { tipo: "CONSUMIDA", sesiones: -1, appointmentId: null },
      { tipo: "CORRECCION", sesiones: -2, appointmentId: null },
      { tipo: "APARTADA", sesiones: -1, appointmentId: citas[3]! },
    ];
    const s = derivarSaldo(libro);
    expect(desviacionDelInvariante(s)).toBe(0);
    // 10 vendidas − 2 de la corrección = 8 totales; 2 consumidas; 2
    // apartadas vivas (las citas 2 y 3); 4 libres.
    expect(s).toEqual({ total: 8, consumidas: 2, apartadas: 2, libres: 4 });
  });
});

describe("la frase que lee el sanitario sin caja", () => {
  it("«quedan 3 · 1 apartada» — y en singular", () => {
    expect(frasePorSesiones(3, 1)).toBe("quedan 3 · 1 apartada");
    expect(frasePorSesiones(3, 2)).toBe("quedan 3 · 2 apartadas");
    // Sin apartadas, la mitad de la frase no se escribe.
    expect(frasePorSesiones(3, 0)).toBe("quedan 3");
    expect(frasePorSesiones(0, 0)).toBe("quedan 0");
  });
});

describe("porQueNoDevolvible · una sola función para el botón y el servidor", () => {
  const limpio = {
    status: "ACTIVO",
    sesionesConsumidas: 0,
    sesionesApartadas: 0,
    tieneVenta: true,
  };

  it("un bono intacto se devuelve", () => {
    expect(porQueNoDevolvible(limpio)).toBeNull();
  });

  it("con una sesión CONSUMIDA, no: sería devolver un trabajo hecho", () => {
    const no = porQueNoDevolvible({ ...limpio, sesionesConsumidas: 1 });
    expect(no?.motivo).toBe("con_sesiones_consumidas");
    // En singular, y diciendo qué pasa con la devolución parcial.
    expect(no?.mensaje).toContain("1 sesión consumida");
    expect(no?.mensaje).toMatch(/parcial no está en esta versión/);
  });

  it("con una sesión APARTADA tampoco, pero el mensaje dice QUÉ HACER", () => {
    const no = porQueNoDevolvible({ ...limpio, sesionesApartadas: 2 });
    expect(no?.motivo).toBe("con_sesiones_apartadas");
    expect(no?.mensaje).toContain("2 sesiones apartadas");
    expect(no?.mensaje).toMatch(/Anula esas citas/);
  });

  it("un bono ya anulado no se vuelve a devolver", () => {
    expect(porQueNoDevolvible({ ...limpio, status: "ANULADO" })?.motivo).toBe(
      "ya_anulado",
    );
  });

  it("y un bono de PAPEL no tiene venta que devolver", () => {
    const no = porQueNoDevolvible({ ...limpio, tieneVenta: false });
    expect(no?.motivo).toBe("sin_venta");
    expect(no?.mensaje).toMatch(/a mano/);
  });

  it("el orden es: lo que no tiene arreglo antes de lo que sí", () => {
    // Un bono anulado Y con sesiones apartadas: lo primero que hay que
    // saber es que está anulado.
    expect(
      porQueNoDevolvible({
        status: "ANULADO",
        sesionesConsumidas: 3,
        sesionesApartadas: 1,
        tieneVenta: true,
      })?.motivo,
    ).toBe("ya_anulado");
  });
});

describe("meses de CALENDARIO, no 183 días", () => {
  it("31-ago + 6 = 28-feb (el caso del prompt)", () => {
    expect(sumarMesesDeCalendario("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("y en bisiesto, 29-feb", () => {
    expect(sumarMesesDeCalendario("2027-08-31", 6)).toBe("2028-02-29");
  });

  it("31-ene + 1 = 28-feb: el día se recorta al último del mes destino", () => {
    expect(sumarMesesDeCalendario("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("un día que existe en el destino no se toca", () => {
    expect(sumarMesesDeCalendario("2026-03-15", 3)).toBe("2026-06-15");
  });

  it("y cruzar el año funciona", () => {
    expect(sumarMesesDeCalendario("2026-11-30", 3)).toBe("2027-02-28");
    expect(sumarMesesDeCalendario("2026-12-31", 12)).toBe("2027-12-31");
  });

  it("el día siguiente cruza mes y año", () => {
    expect(diaSiguiente("2026-02-28")).toBe("2026-03-01");
    expect(diaSiguiente("2028-02-28")).toBe("2028-02-29");
    expect(diaSiguiente("2026-12-31")).toBe("2027-01-01");
  });

  it("y la fecha se pinta corta, sin hora", () => {
    // La hora de una caducidad no se enseña nunca: el día entra entero.
    expect(fechaCorta("2027-02-28")).toBe("28-feb-2027");
    expect(fechaCorta("2026-01-05")).toBe("5-ene-2026");
  });
});

describe("los estados de la puerta", () => {
  it("cada estado tiene su frase, y `ok` no dice nada", () => {
    expect(mensajeDeEstado("ok")).toBe("");
    for (const estado of [
      "noexiste",
      "otro_cliente",
      "no_cubre",
      "agotado",
      "caducado",
      "anulado",
    ] as const) {
      expect(mensajeDeEstado(estado).length).toBeGreaterThan(10);
    }
  });

  it("y los dos que se arreglan en el mostrador están marcados", () => {
    expect(seArreglaEnElMomento("otro_cliente")).toBe(true);
    expect(seArreglaEnElMomento("no_cubre")).toBe(true);
    expect(seArreglaEnElMomento("caducado")).toBe(false);
    expect(seArreglaEnElMomento("agotado")).toBe(false);
    expect(seArreglaEnElMomento("noexiste")).toBe(false);
  });

  it("«un solo bono por cita» tiene su propia frase", () => {
    expect(mensajeNoApartar("ya_aplicado")).toMatch(/una cita gasta un bono/i);
    // Y los demás reutilizan la de `consultar()`: desde fuera es el mismo
    // «no».
    expect(mensajeNoApartar("agotado")).toBe(mensajeDeEstado("agotado"));
  });

  it("los motivos de corrección son cuatro y `otro` es uno de ellos", () => {
    expect(MOTIVOS_CORRECCION).toEqual([
      "error_venta",
      "cortesia",
      "ajuste_alta_inicial",
      "otro",
    ]);
  });
});
