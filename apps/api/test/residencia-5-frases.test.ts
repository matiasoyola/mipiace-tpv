// residencia-5 · **LAS TRES COPIAS DE LAS FRASES, CUADRADAS.**
//
// Cada clase de línea del parte («Incidencia nueva», «No se hizo») se
// escribe en castellano en TRES sitios, y son tres a la fuerza:
//
//   · `apps/api/src/residencia/relevo.ts`              — el servidor;
//   · `apps/tpv-web/src/residencia/SalaParte.tsx`      — la tablet de la
//     sala, que **tiene que funcionar sin red** y por tanto no puede
//     depender de que el servidor le mande los nombres;
//   · `apps/admin/src/pages/residencia/relevo-lib.ts`  — el admin.
//
// Entre el navegador y la API no hay import posible (`tpv-web` no puede
// importar de `apps/api`), y ése es el mismo motivo por el que
// `turnoDeLaTablet` duplica `turnoDe` (residencia-1 §7) y por el que las
// cadenas de propósito del PIN están escritas dos veces
// (`puerta-cache.ts`).
//
// Lo que mantiene las tres de acuerdo es **este test**: lee los tres
// ficheros como texto y compara las claves y los valores. El día que
// alguien añada una clase en el servidor y se olvide de la tablet, esto
// se pone rojo — y lo que la sala pintaría mientras tanto es el enum en
// crudo («NO_HECHO»), que es la lección 5 del bucle visual de
// residencia-4: el enum no es la pantalla.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..", "..");

/** Las parejas `CLAVE: "valor"` de un `Record` con ese nombre. */
function frasesDe(ruta: string, nombre: string): Record<string, string> {
  const texto = readFileSync(join(RAIZ, ruta), "utf8");
  const i = texto.indexOf(nombre);
  expect(i, `${ruta} no declara ${nombre}`).toBeGreaterThan(0);
  const abre = texto.indexOf("{", i);
  const cierra = texto.indexOf("};", abre);
  expect(cierra, `${ruta}: ${nombre} no cierra`).toBeGreaterThan(abre);
  const cuerpo = texto.slice(abre + 1, cierra);
  const pares: Record<string, string> = {};
  for (const m of cuerpo.matchAll(/([A-Z_]+):\s*"([^"]+)"/g)) {
    pares[m[1]!] = m[2]!;
  }
  return pares;
}

const DEL_SERVIDOR = frasesDe(
  "apps/api/src/residencia/relevo.ts",
  "NOMBRE_DE_LA_CLASE",
);
const DE_LA_SALA = frasesDe(
  "apps/tpv-web/src/residencia/SalaParte.tsx",
  "NOMBRE_DE_LA_CLASE",
);
const DEL_ADMIN = frasesDe(
  "apps/admin/src/pages/residencia/relevo-lib.ts",
  "NOMBRE_DE_LA_CLASE",
);

describe("los nombres de las clases de línea", () => {
  it("el servidor tiene las NUEVE del prompt", () => {
    expect(Object.keys(DEL_SERVIDOR).sort()).toEqual(
      [
        "ALGO_NO_VA_BIEN",
        "AVISO_QUE_NO_SALIO",
        "CAMBIO_DE_PLAN",
        "CONSTANTE_FUERA_DE_RANGO",
        "EXCEPCION_NUEVA",
        "INCIDENCIA_ABIERTA",
        "INCIDENCIA_NUEVA",
        "NO_HECHO",
        "REGISTRO_SIN_TURNO",
      ].sort(),
    );
  });

  it("la tablet de la sala dice LO MISMO, clave por clave", () => {
    expect(DE_LA_SALA).toEqual(DEL_SERVIDOR);
  });

  it("y el admin también", () => {
    expect(DEL_ADMIN).toEqual(DEL_SERVIDOR);
  });

  it("y ninguna frase es el enum en crudo", () => {
    for (const [clave, frase] of Object.entries(DEL_SERVIDOR)) {
      expect(frase, clave).not.toBe(clave);
      // En castellano: con acentos o con minúsculas, nunca
      // `GRITANDO_CON_GUIONES`.
      expect(frase, clave).toMatch(/[a-záéíóúñ]/);
    }
  });
});
