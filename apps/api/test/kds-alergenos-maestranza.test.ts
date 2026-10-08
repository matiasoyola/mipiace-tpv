// kds-1-cocina · el lector de la carta de La Maestranza.
//
// Lo que este test guarda no es el script: es que **lea de verdad la carta
// que está impresa**. Si el generador cambia de estructura, `leerCarta`
// devolvería cero platos y el script lo dice y para — pero este test se
// pone rojo antes, que es cuando se puede arreglar sin un implantador
// delante.
//
// Se lee el fichero REAL del generador a propósito. Un fixture copiado se
// quedaría viejo el día que Salomé cambie la carta, y entonces el test
// pasaría comprobando una carta que ya no existe.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  leerCarta,
  normalizarNombre,
} from "../src/scripts/importar-alergenos-maestranza.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const GENERADOR = path.join(
  REPO_ROOT,
  "docs/implantaciones/maestranza/generador/maestranza_carta.py",
);
const FUENTE = readFileSync(GENERADOR, "utf8");

describe("kds-1 · los alérgenos de La Maestranza, de su carta", () => {
  const { platos, repetidosUnidos } = leerCarta(FUENTE);
  const porNombre = new Map(
    platos.map((p) => [normalizarNombre(p.nombre), p]),
  );

  it("lee la carta entera, no un subconjunto", () => {
    // La carta de La Maestranza tiene 128 productos y el generador los
    // lleva repartidos en nueve listas. Un regex que dejara de encajar
    // devolvería cero o un puñado: el suelo es lo que detecta eso.
    expect(platos.length).toBeGreaterThan(50);
  });

  it("los platos del banco del bloque salen con sus alérgenos", () => {
    // Los tres que el prompt nombra por su nombre en la pasada en el
    // hierro: las bravas (gluten), las croquetas (gluten, huevo, lácteos)
    // y el magro (sin alérgenos informados).
    expect(porNombre.get("patatas bravas")!.alergenos).toEqual(["GLUTEN"]);
    expect(porNombre.get("croquetas")!.alergenos).toEqual([
      "GLUTEN",
      "HUEVOS",
      "LACTEOS",
    ]);
    expect(porNombre.get("magro con tomate")!.alergenos).toEqual([]);
  });

  it("los alérgenos salen EN EL ORDEN DEL ANEXO II, no en el de la carta", () => {
    // El generador escribe `["GL","HU","LA","SO"]` para la napolitana; lo
    // que queda guardado es el orden del anexo II, que es el de la rejilla
    // del TPV y el de la leyenda del papel.
    //
    // Y el anexo II pone la **soja (6ª) ANTES que la leche (7ª)**:
    // 1 cereales con gluten · 2 crustáceos · 3 huevos · 4 pescado ·
    // 5 cacahuetes · 6 soja · 7 leche · 8 frutos de cáscara · 9 apio ·
    // 10 mostaza · 11 sésamo · 12 sulfitos · 13 altramuces · 14 moluscos.
    // Este test se escribió primero con LACTEOS delante y se puso rojo: el
    // orden del enum era el correcto.
    const napolitana = porNombre.get("napolitana de chocolate")!;
    expect(napolitana.alergenos).toEqual([
      "GLUTEN",
      "HUEVOS",
      "SOJA",
      "LACTEOS",
    ]);
  });

  it("ningún código del generador se queda sin traducir", () => {
    // Los catorce códigos del generador y los catorce valores del enum se
    // corresponden uno a uno. Un código sin traducir sería un plato
    // diciendo que no lleva lo que lleva.
    const sinTraducir = platos.flatMap((p) => p.desconocidos);
    expect([...new Set(sinTraducir)]).toEqual([]);
  });

  it("un nombre con dos listas distintas se UNE, y se dice", () => {
    // «Calamares» está dos veces: de ración (`GL`, `MC`) y en bocadillo
    // (`GL`, `MC`, con el pan). Y «Filete de pollo» en combinados (`HU`) y
    // en bocadillos (`GL`). Unir es el lado prudente: avisar de más es un
    // plato que no se sirve; callarse uno es un ingreso.
    expect(repetidosUnidos.length).toBeGreaterThan(0);
    const pollo = porNombre.get("filete de pollo")!;
    expect(pollo.alergenos).toContain("GLUTEN");
    expect(pollo.alergenos).toContain("HUEVOS");
  });

  it("normaliza los nombres para poder emparejarlos con el catálogo", () => {
    // El generador escribe «Café bombón» y el CSV de implantación «Café
    // bombon». Sin normalizar, ese plato se quedaría sin alérgenos.
    expect(normalizarNombre("Café bombón")).toBe("cafe bombon");
    expect(normalizarNombre("  Patatas   BRAVAS ")).toBe("patatas bravas");
  });

  it("y el café con leche lleva lácteos: la bebida también se informa", () => {
    // La obligación de informar no distingue entre comida y bebida.
    expect(porNombre.get("cafe con leche")!.alergenos).toEqual(["LACTEOS"]);
    expect(porNombre.get("carajillo")!.alergenos).toEqual(["SULFITOS"]);
  });

  it("si el generador cambiara de estructura, se leen CERO platos", () => {
    // El fallo que se ve, frente al que no: un subconjunto silencioso
    // dejaría media carta sin alérgenos y nadie se enteraría.
    expect(leerCarta("DES_CAFE=[]\nRAC=[]").platos).toEqual([]);
    expect(leerCarta("nada de nada").platos).toEqual([]);
  });
});
