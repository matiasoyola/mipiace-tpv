// clinica-8 (fase B) · LAS FUNCIONES PURAS DEL BLOQUE.
//
// Cuatro decisiones que no necesitan React para probarse, y que son el
// sitio donde de verdad vive cada arreglo:
//
//   · 17 · el orden de los servicios al dar una cita (categoría + uso);
//   · 17 · lo tecleado en el buscador, repartido en el alta de cliente;
//   · 18 · si este aparato sabe enseñar un PDF dentro de la página;
//   · 11 · el nombre del cajero en la barra del TPV.

import { beforeEach, describe, expect, it } from "vitest";

import { cashierDisplayLabel } from "../src/storage.js";
import { semillaDesdeLaBusqueda } from "../src/hooks/useClientPicker.js";
import { puedeEnseñarPdfIncrustado } from "../src/lib/pdf-en-pantalla.js";
import {
  agruparServiciosDeLaCita,
  apuntarUsoDeServicios,
  leerUsoDeServicios,
} from "../src/lib/servicios-de-la-cita.js";

// Los 17 de Rosario, con sus categorías reales (`catalogo-tpv.csv`).
const ROSARIO = [
  { id: "p1", name: "Consulta diagnóstico", tags: ["consulta"] },
  { id: "p2", name: "Quiropodia básica", tags: ["quiropodia"] },
  { id: "p3", name: "Quiropodia completa", tags: ["quiropodia"] },
  { id: "p4", name: "Quiropodia extra", tags: ["quiropodia"] },
  { id: "p6", name: "Cura", tags: ["cirugía"] },
  { id: "p8", name: "Exploración biomecánica", tags: ["biomecánica"] },
  { id: "p12", name: "Órtesis de silicona pequeña", tags: ["órtesis"] },
];

describe("clinica-8 (17) · los servicios de la cita, por categoría y uso", () => {
  beforeEach(() => localStorage.clear());

  it("los agrupa por su categoría, y nadie se queda fuera", () => {
    const grupos = agruparServiciosDeLaCita(ROSARIO, {});
    expect([...grupos.map((g) => g.categoria)].sort()).toEqual([
      "biomecánica",
      "cirugía",
      "consulta",
      "quiropodia",
      "órtesis",
    ]);
    // Diecisiete líneas planas pasan a cinco encabezados, y los siete
    // servicios siguen estando los siete.
    expect(grupos.flatMap((g) => g.servicios).map((s) => s.id).sort()).toEqual(
      ROSARIO.map((s) => s.id).sort(),
    );
  });

  it("sin uso, el orden es alfabético por categoría y el del catálogo dentro", () => {
    // El primer día. Lo que no puede hacer es inventarse un orden: con
    // el contador vacío, el resultado tiene que ser el mismo cada vez.
    const grupos = agruparServiciosDeLaCita(ROSARIO, {});
    // El alfabético es el del CASTELLANO (`localeCompare("es")`): la «ó»
    // de «órtesis» ordena con la «o», no detrás de la «z» como haría el
    // `sort()` por puntos de código.
    expect(grupos.map((g) => g.categoria)).toEqual([
      "biomecánica",
      "cirugía",
      "consulta",
      "órtesis",
      "quiropodia",
    ]);
    expect(
      grupos.find((g) => g.categoria === "quiropodia")!.servicios.map((s) => s.id),
    ).toEqual(["p2", "p3", "p4"]);
  });

  it("lo más usado sube, dentro de su grupo Y entre grupos", () => {
    const grupos = agruparServiciosDeLaCita(ROSARIO, { p4: 9, p6: 12 });
    // «Cura» (cirugía, 12) pesa más que las tres quiropodias juntas (9).
    expect(grupos[0]!.categoria).toBe("cirugía");
    expect(grupos[1]!.categoria).toBe("quiropodia");
    // Y dentro de quiropodia, la extra —la usada— va primero.
    expect(grupos[1]!.servicios.map((s) => s.id)).toEqual(["p4", "p2", "p3"]);
  });

  it("el peso de un grupo es la SUMA, no el máximo", () => {
    // Tres servicios de cinco se dan más que uno de doce. Con el máximo,
    // la categoría de doce subiría y la lista mentiría sobre el día.
    const grupos = agruparServiciosDeLaCita(ROSARIO, {
      p2: 5,
      p3: 5,
      p4: 5,
      p6: 12,
    });
    expect(grupos[0]!.categoria).toBe("quiropodia");
  });

  it("dos sin uso NO se reordenan entre sí: la lista no baila", () => {
    // La estabilidad es la mitad del valor: lo que se aprende es la
    // posición, y una lista que cambia de un día para otro no se
    // aprende.
    const a = agruparServiciosDeLaCita(ROSARIO, { p3: 1 });
    const b = agruparServiciosDeLaCita(ROSARIO, { p3: 1 });
    expect(a[0]).toEqual(b[0]);
    expect(
      a.find((g) => g.categoria === "quiropodia")!.servicios.map((s) => s.id),
    ).toEqual(["p3", "p2", "p4"]);
  });

  it("un servicio sin etiquetas cae en «otros» y no se pierde", () => {
    const grupos = agruparServiciosDeLaCita(
      [{ id: "x", name: "Suelto", tags: [] }],
      {},
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.categoria).toBe("otros");
    expect(grupos[0]!.titulo).toBe("Otros");
  });

  it("el contador cuenta, y es POR TENANT", () => {
    apuntarUsoDeServicios(["p2", "p3"], "t1");
    apuntarUsoDeServicios(["p2"], "t1");
    expect(leerUsoDeServicios("t1")).toEqual({ p2: 2, p3: 1 });
    // El terminal de otra clínica no hereda el orden de ésta.
    expect(leerUsoDeServicios("t2")).toEqual({});
  });

  it("un contador roto o con basura se lee como vacío, sin lanzar", () => {
    localStorage.setItem("mipiacetpv-uso-servicios-cita:t1", "{{{");
    expect(leerUsoDeServicios("t1")).toEqual({});
    localStorage.setItem(
      "mipiacetpv-uso-servicios-cita:t1",
      JSON.stringify({ p2: "mucho", p3: -4, p4: 2 }),
    );
    expect(leerUsoDeServicios("t1")).toEqual({ p4: 2 });
  });
});

describe("clinica-8 (17) · lo tecleado en el buscador pasa al alta", () => {
  it("un nombre y un apellido se reparten", () => {
    expect(semillaDesdeLaBusqueda("Rosario Jaén")).toEqual({
      firstName: "Rosario",
      lastName: "Jaén",
    });
    expect(semillaDesdeLaBusqueda("Carmen Prueba Demo")).toEqual({
      firstName: "Carmen",
      lastName: "Prueba Demo",
    });
  });

  it("una sola palabra es el nombre", () => {
    expect(semillaDesdeLaBusqueda("Rosario")).toEqual({
      firstName: "Rosario",
    });
  });

  it("si son dígitos, es un TELÉFONO y no el nombre de nadie", () => {
    expect(semillaDesdeLaBusqueda("666 12 34 56")).toEqual({
      phone: "666 12 34 56",
    });
    expect(semillaDesdeLaBusqueda("+34925800123")).toEqual({
      phone: "+34925800123",
    });
    // Dos dígitos no son un teléfono: es alguien buscando por un número
    // dentro de un nombre.
    expect(semillaDesdeLaBusqueda("12")).toEqual({ firstName: "12" });
  });

  it("un email no siembra nada: el alta rápida no tiene ese campo", () => {
    expect(semillaDesdeLaBusqueda("rosario@gmail.com")).toEqual({});
  });

  it("vacío o espacios, nada", () => {
    expect(semillaDesdeLaBusqueda("")).toEqual({});
    expect(semillaDesdeLaBusqueda("   ")).toEqual({});
  });
});

describe("clinica-8 (18) · ¿sabe este aparato enseñar un PDF?", () => {
  it("Android dice que no, y por eso «Ver ticket» salía en blanco", () => {
    expect(puedeEnseñarPdfIncrustado({ pdfViewerEnabled: false })).toBe(false);
  });

  it("el escritorio dice que sí y no cambia nada", () => {
    expect(puedeEnseñarPdfIncrustado({ pdfViewerEnabled: true })).toBe(true);
  });

  it("quien no sabe contestar se trata como que SÍ", () => {
    // Un navegador anterior a la propiedad. Apagar el visor donde hoy
    // funciona sería peor que el fallo que se viene a arreglar.
    expect(puedeEnseñarPdfIncrustado({})).toBe(true);
    expect(puedeEnseñarPdfIncrustado(undefined)).toBe(true);
  });
});

describe("clinica-8 (11) · el nombre del cajero en el TPV", () => {
  it("sin alias, la local-part y nunca el dominio", () => {
    expect(
      cashierDisplayLabel({ email: "m.oyola+clinica-demo@mipiace.es" }),
    ).toBe("m.oyola+clinica-demo");
    expect(cashierDisplayLabel({ alias: "Rosa", email: "r@x.es" })).toBe("Rosa");
  });
});
