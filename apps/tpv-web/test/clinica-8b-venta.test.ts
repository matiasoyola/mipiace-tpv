// clinica-8 (fase B, 19) · LOS ICONOS DE LA VENTA.
//
// Auditoría del 18-10, punto 28: «Venta: nombres cortados en lo que
// distingue; iconos de taza».
//
// Las tazas no son una errata del catálogo de Rosario: ninguna de sus
// categorías —«quiropodia», «cirugía», «biomecánica», «órtesis»,
// «consulta»— casa con las palabras de hostelería, así que todas caían
// al icono POR TONO, y el tono del primer reparto es ámbar → `Coffee`.
//
// Lo que este banco fija, además de que las nuevas palabras acierten:
// **que el reparto de los quince comercios de hoy no se mueve**. El
// icono de una categoría se aprende, y cambiarlo cuesta un segundo por
// toque durante días.

import { beforeEach, describe, expect, it } from "vitest";

import { iconNameForTag, resolveToneAssignments } from "../src/lib/categoryTones.js";

beforeEach(() => localStorage.clear());

describe("clinica-8 (19) · una clínica no se pinta con tazas de café", () => {
  it("cada categoría de Rosario tiene SU icono", () => {
    // El tono que se le pase es indiferente: la palabra manda.
    expect(iconNameForTag("quiropodia", "amber")).toBe("Footprints");
    expect(iconNameForTag("cirugía", "amber")).toBe("Syringe");
    expect(iconNameForTag("biomecánica", "amber")).toBe("Activity");
    expect(iconNameForTag("órtesis", "amber")).toBe("Activity");
    expect(iconNameForTag("consulta", "amber")).toBe("Stethoscope");
  });

  it("y ninguna de las cinco acaba en la taza", () => {
    for (const tag of [
      "quiropodia",
      "cirugía",
      "biomecánica",
      "órtesis",
      "consulta",
    ]) {
      expect(iconNameForTag(tag, "amber"), tag).not.toBe("Coffee");
    }
  });

  it("las palabras aciertan con y sin tilde: los tags llegan como vengan", () => {
    expect(iconNameForTag("cirugia", "stone")).toBe("Syringe");
    expect(iconNameForTag("Biomecanica", "stone")).toBe("Activity");
    expect(iconNameForTag("ORTESIS", "stone")).toBe("Activity");
  });

  it("una categoría clínica que no casa cae en el icono POR DEFECTO", () => {
    // «Bonos de sesiones», «Material»… En una clínica el respaldo es el
    // estetoscopio y no la taza, y lo decide la pantalla (que sabe de
    // qué negocio es el catálogo), no este módulo.
    expect(iconNameForTag("bonos", "amber")).toBe("Coffee");
    expect(iconNameForTag("bonos", "amber", "Stethoscope")).toBe(
      "Stethoscope",
    );
  });

  it("y EL REPARTO DE HOSTELERÍA NO SE MUEVE", () => {
    // Las palabras de clínica se añadieron DESPUÉS de las de hostelería
    // justo para esto.
    expect(iconNameForTag("cafes", "amber")).toBe("Coffee");
    expect(iconNameForTag("cerveza", "amber")).toBe("Beer");
    expect(iconNameForTag("bolleria", "amber")).toBe("Croissant");
    expect(iconNameForTag("postres", "rose")).toBe("Cake");
    expect(iconNameForTag("ensaladas", "green")).toBe("Salad");
    // Y la peluquería, que es el otro vertical que ya tenía icono.
    expect(iconNameForTag("cortes", "stone")).toBe("Scissors");
  });

  it("lo clínico tiene pista de tono, y es el AZUL", () => {
    // Una sola categoría clínica se lleva su pista limpia.
    expect(resolveToneAssignments(["quiropodia"], "c1")["quiropodia"]).toBe(
      "sky",
    );
    expect(resolveToneAssignments(["cirugía"], "c2")["cirugía"]).toBe("sky");
    expect(resolveToneAssignments(["biomecánica"], "c3")["biomecánica"]).toBe(
      "sky",
    );
  });

  it("y con cinco clínicas el tono se reparte, pero el ICONO no depende de él", () => {
    // La regla de v1.14 sigue en pie: la pista manda salvo que su tono ya
    // vaya un peldaño por delante del menos usado, «así que un catálogo
    // con Cafés, Café con leche y Cafetería no se pinta entero en
    // ámbar». O sea que la segunda categoría clínica PUEDE salir en
    // ámbar — y eso es exactamente por lo que el icono tiene que salir
    // de la palabra y no del tono, que es lo que este bloque cambia.
    const tonos = resolveToneAssignments(
      ["quiropodia", "cirugía", "biomecánica", "órtesis", "consulta"],
      "clinica-demo",
    );
    for (const tag of Object.keys(tonos)) {
      expect(iconNameForTag(tag, tonos[tag]!), tag).not.toBe("Coffee");
    }
  });
});
