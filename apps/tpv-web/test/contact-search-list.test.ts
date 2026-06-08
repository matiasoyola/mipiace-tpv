// v1.4-Buscador-Contactos · cubre la lógica de enmascarado del
// teléfono en el buscador del TPV. La invariante de privacidad es:
// el listado de resultados nunca muestra el teléfono completo.
//
// El test de render React queda como TODO: el paquete `tpv-web` no
// tiene jsdom/testing-library configurado y añadirlo es scope aparte
// (carryover de B-Multi-Vertical v2). Mientras tanto cubrimos el
// helper que decide qué se ve y delegamos en el revisor de PR la
// verificación visual de SalePage.contact.tsx.
//
// TODO test infra React (jsdom + @testing-library/react) — entonces:
//   - render ContactSheet con results = [{ name, email, nif, phone }]
//   - expect screen.queryByText(email) toBeNull
//   - expect screen.queryByText(nif)   toBeNull
//   - expect screen.getByText(/•••• 9999/) toBeVisible
//   - click "Ver datos completos" → email y NIF visibles

import { describe, expect, it } from "vitest";

import { maskPhone } from "../src/pages/SalePage.contact.privacy.js";

describe("maskPhone", () => {
  it("muestra los últimos 4 dígitos cuando el teléfono está completo", () => {
    expect(maskPhone("+34 600 123 456")).toBe("•••• 3456");
    expect(maskPhone("612345678")).toBe("•••• 5678");
  });

  it("nunca expone más de 4 dígitos en la cadena visible", () => {
    const masked = maskPhone("+34 600 123 456");
    expect(masked).not.toBeNull();
    // El visual sólo contiene los 4 últimos dígitos, ningún otro
    // dígito del teléfono original debería filtrarse.
    expect(masked!.replace(/\D/g, "")).toBe("3456");
  });

  it("devuelve null cuando el teléfono está vacío o ausente", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone("")).toBeNull();
    expect(maskPhone("   ")).toBeNull();
  });

  it("tolera teléfonos cortos sin pad de ceros (visual aceptable)", () => {
    // Un móvil de 4 dígitos no es realista, pero la función no debe
    // romperse — sí devolver algo legible y enmascarado.
    expect(maskPhone("1234")).toBe("•••• 1234");
    expect(maskPhone("123")).toBe("•••• 123");
  });
});
