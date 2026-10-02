// Las constantes del productor del SIF.
//
// ⚠ Estos valores tienen que coincidir LITERALMENTE con los de la
// declaración responsable del SIF. Desde el bloque `declaracion-responsable`
// eso ya no es un ruego: la declaración se construye DESDE estas constantes
// (`src/declaracion.ts`) y `declaracion.test.ts` lo demuestra mockeando este
// módulo. Aquí queda lo que sigue siendo cosa de este fichero — que no se
// queden vacíos, mal escritos ni fuera de los límites del anexo.

import { validateSpanishTaxId } from "@mipiacetpv/util-validation/spanish-tax-id";
import { describe, expect, it } from "vitest";

import {
  buildSistemaInformatico,
  ID_SISTEMA_INFORMATICO,
  INDICADOR_MULTIPLES_OT,
  LIMITES_SISTEMA_INFORMATICO,
  NOMBRE_SISTEMA_INFORMATICO,
  PRODUCTOR_NIF,
  PRODUCTOR_NOMBRE_RAZON,
  TIPO_USO_POSIBLE_MULTI_OT,
  TIPO_USO_POSIBLE_SOLO_VERIFACTU,
  validarConstantesDelProductor,
} from "../src/productor.js";

describe("las constantes del productor", () => {
  it("ninguna está vacía", () => {
    for (const [nombre, valor] of Object.entries({
      PRODUCTOR_NOMBRE_RAZON,
      PRODUCTOR_NIF,
      ID_SISTEMA_INFORMATICO,
      NOMBRE_SISTEMA_INFORMATICO,
    })) {
      expect(valor.trim(), `${nombre} está vacío`).not.toBe("");
    }
  });

  it("el NIF es un identificador fiscal español válido, con su dígito de control", () => {
    expect(validateSpanishTaxId(PRODUCTOR_NIF).valid).toBe(true);
  });

  it("el NIF NO lleva el prefijo ES del NIF-IVA intracomunitario", () => {
    // El campo del anexo es `FormatoNIF (9)`. `ESB45902186` son once.
    expect(PRODUCTOR_NIF).not.toMatch(/^ES/i);
    expect(PRODUCTOR_NIF).toHaveLength(9);
  });

  it("el IdSistemaInformatico tiene exactamente dos caracteres", () => {
    expect(ID_SISTEMA_INFORMATICO).toHaveLength(
      LIMITES_SISTEMA_INFORMATICO.IdSistemaInformatico,
    );
  });

  it("caben en las longitudes del diseño de registro", () => {
    expect(PRODUCTOR_NOMBRE_RAZON.length).toBeLessThanOrEqual(
      LIMITES_SISTEMA_INFORMATICO.NombreRazon,
    );
    expect(NOMBRE_SISTEMA_INFORMATICO.length).toBeLessThanOrEqual(
      LIMITES_SISTEMA_INFORMATICO.NombreSistemaInformatico,
    );
  });

  it("los tres indicadores son valores de la lista L4", () => {
    for (const v of [
      TIPO_USO_POSIBLE_SOLO_VERIFACTU,
      TIPO_USO_POSIBLE_MULTI_OT,
      INDICADOR_MULTIPLES_OT,
    ]) {
      expect(["S", "N"]).toContain(v);
    }
  });

  it("declara SOLO VERI*FACTU, que es lo que nos exime del registro de eventos", () => {
    // FAQ de desarrolladores §15, NOTA 1. Si esto pasara a "N" habría que
    // implementar el registro de eventos antes de desplegar.
    expect(TIPO_USO_POSIBLE_SOLO_VERIFACTU).toBe("S");
  });

  it("validarConstantesDelProductor no encuentra nada", () => {
    expect(validarConstantesDelProductor()).toEqual([]);
  });
});

describe("buildSistemaInformatico", () => {
  it("compone el bloque con los nombres del anexo", () => {
    expect(
      buildSistemaInformatico({
        version: "1.16.0",
        numeroInstalacion: "3f7c1f6e-2b4a-4a8e-9c1d-5e6f7a8b9c0d",
      }),
    ).toEqual({
      NombreRazon: "MI PIACE INTERNET SOLUTIONS SL",
      NIF: "B45902186",
      NombreSistemaInformatico: "mipiacetpv",
      IdSistemaInformatico: "MP",
      Version: "1.16.0",
      NumeroInstalacion: "3f7c1f6e-2b4a-4a8e-9c1d-5e6f7a8b9c0d",
      TipoUsoPosibleSoloVerifactu: "S",
      TipoUsoPosibleMultiOT: "S",
      IndicadorMultiplesOT: "N",
    });
  });

  it("no deja pasar una versión ni un número de instalación vacíos", () => {
    expect(() =>
      buildSistemaInformatico({ version: "  ", numeroInstalacion: "x" }),
    ).toThrow(RangeError);
    expect(() =>
      buildSistemaInformatico({ version: "1.0.0", numeroInstalacion: " " }),
    ).toThrow(RangeError);
  });

  it("no deja pasar valores que desbordan el anexo", () => {
    expect(() =>
      buildSistemaInformatico({
        version: "v".repeat(51),
        numeroInstalacion: "x",
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildSistemaInformatico({
        version: "1.0.0",
        numeroInstalacion: "x".repeat(101),
      }),
    ).toThrow(RangeError);
  });
});
