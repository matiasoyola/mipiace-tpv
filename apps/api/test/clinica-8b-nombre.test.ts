// clinica-8 (fase B, 11) · EL NOMBRE DE UNA PERSONA, NO SU EMAIL.
//
// La auditoría del 18-10 (punto 17) leyó `m.oyola+clinica-demo@mipiace.es`
// en «Atiende», en «Firmada por», en «Valoración pedida por», en el
// informe que se lleva la paciente, en los cajeros recientes del PIN y en
// la barra de abajo del TPV. Y anotó la causa de raíz: «El nombre de la
// activación no llega a ningún sitio».
//
// Eran las dos mitades de lo mismo:
//
//   1. **El `alias` no se escribía.** El formulario de activación pide
//      `ownerName`, lo manda en el email de bienvenida y lo apunta en la
//      auditoría — y no tocaba la fila del usuario. La propietaria nacía
//      sin nombre.
//   2. **El respaldo era el email ENTERO.** Seis copias de la misma
//      función de tres líneas en `clinica/`, las seis cayendo al email
//      completo en vez de a su local-part, que es lo que el esquema lleva
//      diciendo desde v1.7.
//
// Aquí vive la mitad 2, que es una función pura. La mitad 1 —que la
// activación escriba el `alias`— se fija en `h1-activacion-sin-caja`,
// que es el banco de la activación y ya tiene su arnés.

import { describe, expect, it } from "vitest";

import { nombreParaMostrar } from "../src/lib/nombre-para-mostrar.js";

// ── 1 · LA FUNCIÓN, que es donde vive la regla ──────────────────────

describe("clinica-8 · el nombre con el que se pinta a alguien", () => {
  it("manda el alias", () => {
    expect(
      nombreParaMostrar({ alias: "Rosa Martín", email: "rosa@clinica.es" }),
    ).toBe("Rosa Martín");
  });

  it("un alias en blanco NO es un alias", () => {
    // Una fila con `alias = '   '` existe: el CHECK de la base prohíbe el
    // blanco del colegiado, no el del alias.
    expect(nombreParaMostrar({ alias: "   ", email: "rosa@clinica.es" })).toBe(
      "rosa",
    );
  });

  it("sin alias, la LOCAL-PART, no el email entero", () => {
    // Éste es el test del bloque. El email de la auditoría, tal cual.
    expect(
      nombreParaMostrar({
        alias: null,
        email: "m.oyola+clinica-demo@mipiace.es",
      }),
    ).toBe("m.oyola+clinica-demo");
    expect(nombreParaMostrar({ alias: null, email: "rosa@clinica.es" })).toBe(
      "rosa",
    );
    // Lo que NUNCA puede devolver: algo con el dominio dentro.
    expect(
      nombreParaMostrar({ alias: null, email: "rosa@clinica.es" }),
    ).not.toContain("@");
  });

  it("sin nadie, el guion — y no una cadena vacía", () => {
    // Una foto sin `withdrawnBy`, una cita sin profesional asignada. Las
    // pantallas esperan el guion desde clinica-4.
    expect(nombreParaMostrar(null)).toBe("—");
    expect(nombreParaMostrar(undefined)).toBe("—");
    expect(nombreParaMostrar({ alias: null, email: null })).toBe("—");
  });

  it("un email sin arroba se devuelve tal cual", () => {
    // No pasa con un alta de hoy (la API valida el email), pero sí con
    // una semilla vieja. Devolver "" dejaría la línea sin firmante.
    expect(nombreParaMostrar({ alias: null, email: "rosa" })).toBe("rosa");
  });
});
