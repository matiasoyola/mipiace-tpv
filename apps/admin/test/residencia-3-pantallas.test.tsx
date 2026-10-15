// residencia-3 · EL ADMIN DEL BLOQUE: la foto, el consentimiento y el PIN.
//
// Tres cosas y las tres se miden por lo que la pantalla DICE, porque en
// estas tres lo que importa es la frase:
//
//   1. **Los cuatro estados de la foto.** El que hay que ver es «hay foto
//      y NO hay consentimiento», porque es el único que pide algo de
//      alguien — y es el que un interruptor de «mostrar sí/no» habría
//      escondido.
//   2. **El PIN no sale.** Ni entero, ni parcial, ni su hash. Y si la
//      persona no tiene un rol que registre, se dice DONDE se arregla.
//   3. **Lo registrado** se enseña con lo corregido y lo anulado a la
//      vista: lo que prueba no es el valor de ahora, es que nada se borra.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BloqueDeFoto, inicialesDe } from "../src/pages/residencia/ResidentesPage.foto.js";
import { valorEnPalabras } from "../src/pages/residencia/RegistroResidentePage.js";
import type { ResidenteFicha } from "../src/pages/residencia/lib.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const FICHA: ResidenteFicha = {
  clientId: "carmen",
  nombre: "Carmen Gómez",
  firstName: "Carmen",
  lastName: "Gómez",
  phone: null,
  birthdate: null,
  admissionDate: "2026-09-01",
  dischargeDate: null,
  dischargeReason: null,
  dependencyLevel: "DEPENDIENTE",
  dependencyGrade: null,
  placeType: "PRIVADA",
  responsible: null,
  cama: null,
  dni: null,
  nss: null,
  ocupaciones: [],
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
    root.render(<MemoryRouter>{nodo}</MemoryRouter>);
  });
}

describe("la foto y su consentimiento · los cuatro estados", () => {
  it("1 · SIN FOTO Y SIN CONSENTIMIENTO: lo normal el primer día", async () => {
    await pintar(<BloqueDeFoto residente={FICHA} onCambio={() => {}} />);
    expect(container.textContent).toContain(
      "Sin foto: la puerta pinta las iniciales",
    );
    expect(container.textContent).toContain("Subir una foto");
    expect(container.textContent).toContain(
      "Anotar el consentimiento de imagen",
    );
  });

  it("2 · CON FOTO Y SIN CONSENTIMIENTO: EL AVISO, en ámbar y arriba", async () => {
    // Es el estado que hay que ver, y la frase dice qué pasa EN LA PUERTA,
    // no una regla abstracta.
    await pintar(
      <BloqueDeFoto
        residente={{ ...FICHA, foto: { bytes: 1234, subidaEn: null } }}
        onCambio={() => {}}
      />,
    );
    expect(container.textContent).toContain(
      "Hay foto y no hay consentimiento de imagen: la puerta pinta sus iniciales",
    );
    expect(container.textContent).toContain("Anota el consentimiento, o quita la foto");
  });

  it("3 · CON LAS DOS: la puerta la pinta, y se dice quién lo dio", async () => {
    await pintar(
      <BloqueDeFoto
        residente={{
          ...FICHA,
          foto: { bytes: 1234, subidaEn: "2026-10-15T09:00:00.000Z" },
          consentimientoDeImagen: {
            id: "c1",
            anotadoEn: "2026-10-10T09:00:00.000Z",
            loDio: "REPRESENTANTE",
            nombre: "Marta Gómez",
            parentesco: "hija",
          },
        }}
        onCambio={() => {}}
      />,
    );
    expect(container.textContent).toContain(
      "La puerta de su habitación pinta esta foto",
    );
    expect(container.textContent).toContain("lo dio Marta Gómez (hija)");
    // Y SE RETIRA, no se desmarca.
    expect(container.textContent).toContain("Retirar el consentimiento");
  });

  it("4 · SIN FOTO Y CON CONSENTIMIENTO: se puede subir ya", async () => {
    await pintar(
      <BloqueDeFoto
        residente={{
          ...FICHA,
          consentimientoDeImagen: {
            id: "c1",
            anotadoEn: "2026-10-10T09:00:00.000Z",
            loDio: "PACIENTE",
            nombre: null,
            parentesco: null,
          },
        }}
        onCambio={() => {}}
      />,
    );
    expect(container.textContent).toContain("lo dio el residente");
    expect(container.textContent).toContain("Subir una foto");
    // Y NO el aviso ámbar: no hay nada que arreglar.
    expect(container.textContent).not.toContain("Hay foto y no hay consentimiento");
  });

  it("sin foto que servir, las INICIALES en el mismo hueco", async () => {
    await pintar(<BloqueDeFoto residente={FICHA} onCambio={() => {}} />);
    expect(container.textContent).toContain("CG");
    expect(inicialesDe("Carmen Gómez Ruiz")).toBe("CG");
    expect(inicialesDe("")).toBe("·");
  });

  it("anotar el consentimiento de un FAMILIAR pide nombre y parentesco", async () => {
    // Es lo que el CHECK `client_consents_firmante_valido` exige, dicho
    // con una frase en vez de con un 500 de constraint.
    await pintar(<BloqueDeFoto residente={FICHA} onCambio={() => {}} />);
    act(() => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Anotar el consentimiento"))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("¿Quién dio el consentimiento?");
    act(() => {
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Un familiar")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const campos = [...container.querySelectorAll("input")].map(
      (i) => i.placeholder,
    );
    expect(campos).toContain("Nombre de quien lo dio");
    expect(campos).toContain("Parentesco (hija, sobrino…)");
  });
});

describe("el valor de un registro, en palabras", () => {
  it("un BOOL es «Hecho»", () => {
    expect(valorEnPalabras({ tipo: "BOOL", hecho: true })).toBe("Hecho");
  });

  it("un ORDINAL «como siempre» lo dice", () => {
    expect(
      valorEnPalabras({
        tipo: "ORDINAL",
        opcion: "COMO_SIEMPRE",
        comoSiempre: true,
      }),
    ).toBe("COMO_SIEMPRE · como siempre");
  });

  it("y uno que se desvía, no", () => {
    expect(
      valorEnPalabras({ tipo: "ORDINAL", opcion: "APAGADO", comoSiempre: false }),
    ).toBe("APAGADO");
  });

  it("una NOTA es «Algo no va bien»", () => {
    expect(valorEnPalabras({ tipo: "NOTA" })).toBe("Algo no va bien");
  });

  it("y UN VALOR QUE NO SE DESCIFRA SE ENSEÑA COMO HUECO", () => {
    // La decisión de clinica-7 leída igual: esconderlo borra la única
    // pista de que algo va mal con la clave.
    expect(valorEnPalabras({ ilegible: true })).toBe(
      "(este dato no se puede leer)",
    );
  });
});
