// La declaración responsable del SIF (art. 15 de la Orden HAC/1177/2024).
//
// Lo que este banco fija:
//
//   1. Los 13 puntos del art. 15 están, todos, y EN ORDEN (1.a → 1.l).
//   2. Los valores SALEN de `productor.ts`. No están tecleados aquí ni allí
//      dos veces: si alguien cambia una constante, la declaración cambia
//      sola. El test de abajo lo demuestra mockeando el módulo.
//   3. La versión es la que le pasan (la de `getAppVersion()` en la API), no
//      una constante del paquete.
//   4. La fecha es la de la VERSIÓN. Sin fecha horneada se dice; nunca se
//      pone la de hoy.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · teclear el NIF (o la razón social, o el código, o el nombre) a mano en
//     la plantilla en vez de importarlo de productor.ts
//   · cambiar TIPO_USO_POSIBLE_SOLO_VERIFACTU a "N" sin tocar el 1.e)
//   · reescribir el texto de cumplimiento del 1.k) «para que quede mejor»
//   · quitar un apartado o cambiarlos de orden
//   · rellenar la fecha con `new Date()` cuando la build no la lleva

import { describe, expect, it, vi } from "vitest";

import {
  buildDeclaracionResponsable,
  DECLARACION_CUMPLIMIENTO,
  DECLARACION_TITULO,
  formatearFechaLarga,
  PRODUCTOR_DIRECCION_POSTAL,
  PRODUCTOR_LUGAR,
} from "../src/declaracion.js";
import {
  ID_SISTEMA_INFORMATICO,
  NOMBRE_SISTEMA_INFORMATICO,
  PRODUCTOR_NIF,
  PRODUCTOR_NOMBRE_RAZON,
  TIPO_USO_POSIBLE_MULTI_OT,
  TIPO_USO_POSIBLE_SOLO_VERIFACTU,
} from "../src/productor.js";

const ENTRADA = {
  versionServidor: "2310f6e",
  fechaSuscripcion: "2026-09-27",
  emailSoporte: "soporte@mipiacetpv.com",
} as const;

function declaracion(extra: Record<string, unknown> = {}) {
  return buildDeclaracionResponsable({ ...ENTRADA, ...extra });
}

/** Todo el texto de un apartado, en una cadena. */
function valorDe(clave: string, d = declaracion()): string {
  const todos = [...d.apartados, ...d.anexo];
  const apartado = todos.find((a) => a.clave === clave);
  expect(apartado, `falta el apartado ${clave}`).toBeDefined();
  return apartado!.valor.join("\n");
}

describe("los 13 puntos del art. 15", () => {
  it("el título es el literal de la Orden", () => {
    expect(declaracion().titulo).toBe(
      "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN",
    );
    expect(declaracion().titulo).toBe(DECLARACION_TITULO);
  });

  it("están los doce apartados, en el orden del art. 15", () => {
    expect(declaracion().apartados.map((a) => a.clave)).toEqual([
      "1.a)",
      "1.b)",
      "1.c)",
      "1.d)",
      "1.e)",
      "1.f)",
      "1.g)",
      "1.h)",
      "1.i)",
      "1.j)",
      "1.k)",
      "1.l)",
    ]);
  });

  it("el anexo lleva el contacto y la web", () => {
    expect(declaracion().anexo.map((a) => a.clave)).toEqual(["2.a)", "2.b)"]);
    expect(valorDe("2.a)")).toContain("soporte@mipiacetpv.com");
    expect(valorDe("2.b)")).toContain("https://mipiacetpv.com");
  });

  it("ningún apartado se queda sin rótulo ni sin valor", () => {
    for (const a of [...declaracion().apartados, ...declaracion().anexo]) {
      expect(a.rotulo.trim(), `${a.clave} sin rótulo`).not.toBe("");
      expect(a.valor.length, `${a.clave} sin valor`).toBeGreaterThan(0);
      for (const linea of a.valor) {
        expect(linea.trim(), `${a.clave} con una línea vacía`).not.toBe("");
      }
    }
  });

  it("1.d) describe los tres componentes y las funcionalidades", () => {
    const d = valorDe("1.d)");
    for (const esperado of [
      "terminal punto de venta",
      "Android",
      "servidor",
      "panel de gestión",
      "facturas simplificadas",
      "SHA-256",
      "QR tributario",
      "VERI*FACTU",
      "instalación distinta",
    ]) {
      expect(d, `1.d) no menciona «${esperado}»`).toContain(esperado);
    }
  });

  it("1.g) dice que la firma no aplica, y por qué", () => {
    expect(valorDe("1.g)")).toMatch(/^No aplica/);
    expect(valorDe("1.g)")).toContain("exclusivamente");
  });

  it("1.j) lleva la dirección postal completa", () => {
    const j = valorDe("1.j)");
    expect(j).toContain("CM-5100");
    expect(j).toContain("45634 Buenaventura (Toledo)");
    expect(j).toContain("España");
    expect(j).toBe(PRODUCTOR_DIRECCION_POSTAL.join("\n"));
  });

  it("1.k) es el texto de cumplimiento, literal", () => {
    expect(valorDe("1.k)")).toBe(DECLARACION_CUMPLIMIENTO);
    // Las cuatro normas que la frase tiene que citar. Si alguien la
    // reescribe y se deja una fuera, esto se pone rojo.
    for (const norma of [
      "artículo 29.2.j) de la Ley 58/2003",
      "Real Decreto 1007/2023",
      "Orden HAC/1177/2024",
      "Agencia Estatal de Administración Tributaria",
    ]) {
      expect(DECLARACION_CUMPLIMIENTO).toContain(norma);
    }
  });

  it("1.l) lleva la fecha y el lugar", () => {
    expect(valorDe("1.l)")).toContain("27 de septiembre de 2026");
    expect(valorDe("1.l)")).toContain(PRODUCTOR_LUGAR);
    expect(PRODUCTOR_LUGAR).toContain("Buenaventura (Toledo)");
  });
});

describe("los valores salen de productor.ts, no de una plantilla", () => {
  it("1.a), 1.b), 1.h) y 1.i) son exactamente las constantes", () => {
    expect(valorDe("1.a)")).toBe(NOMBRE_SISTEMA_INFORMATICO);
    expect(valorDe("1.b)")).toBe(ID_SISTEMA_INFORMATICO);
    expect(valorDe("1.h)")).toBe(PRODUCTOR_NOMBRE_RAZON);
    expect(valorDe("1.i)")).toBe(PRODUCTOR_NIF);
  });

  it("1.e) y 1.f) derivan de los indicadores de tipo de uso", () => {
    const esperado = (i: string) => (i === "S" ? "S - Sí" : "N - No");
    expect(valorDe("1.e)")).toBe(esperado(TIPO_USO_POSIBLE_SOLO_VERIFACTU));
    expect(valorDe("1.f)").split("\n")[0]).toBe(
      esperado(TIPO_USO_POSIBLE_MULTI_OT),
    );
  });

  // EL sabotaje del bloque: se cambian las constantes del productor y la
  // declaración tiene que cambiar con ellas. Si alguien teclea el NIF a mano
  // en la plantilla, este test se pone rojo — es la única forma de
  // demostrar que la REGLA DE ORO se cumple de verdad.
  it("cambiar las constantes cambia la declaración", async () => {
    vi.resetModules();
    vi.doMock("../src/productor.js", async () => {
      const real = await vi.importActual<
        typeof import("../src/productor.js")
      >("../src/productor.js");
      return {
        ...real,
        PRODUCTOR_NIF: "B00000000",
        PRODUCTOR_NOMBRE_RAZON: "OTRA PRODUCTORA SL",
        NOMBRE_SISTEMA_INFORMATICO: "otrotpv",
        ID_SISTEMA_INFORMATICO: "XX",
        TIPO_USO_POSIBLE_SOLO_VERIFACTU: "N",
        TIPO_USO_POSIBLE_MULTI_OT: "N",
      };
    });
    const { buildDeclaracionResponsable: build } = await import(
      "../src/declaracion.js"
    );
    const saboteada = build({ ...ENTRADA });
    const lee = (clave: string) =>
      saboteada.apartados.find((a) => a.clave === clave)!.valor.join("\n");

    expect(lee("1.a)")).toBe("otrotpv");
    expect(lee("1.b)")).toBe("XX");
    expect(lee("1.h)")).toBe("OTRA PRODUCTORA SL");
    expect(lee("1.i)")).toBe("B00000000");
    expect(lee("1.e)")).toBe("N - No");
    expect(lee("1.f)").split("\n")[0]).toBe("N - No");
    // Y que no quede duda de que lo de arriba es el mock y no el real:
    expect(lee("1.i)")).not.toBe(PRODUCTOR_NIF);

    vi.doUnmock("../src/productor.js");
    vi.resetModules();
  });
});

describe("1.c) · el identificador completo de la versión", () => {
  it("es la versión que le pasan, no una constante del paquete", () => {
    expect(valorDe("1.c)", declaracion({ versionServidor: "2310f6e" }))).toContain(
      "2310f6e",
    );
    const otra = valorDe("1.c)", declaracion({ versionServidor: "deadbee" }));
    expect(otra).toContain("deadbee");
    expect(otra).not.toContain("2310f6e");
  });

  it("añade la versión de la APK cuando se conoce", () => {
    const c = valorDe(
      "1.c)",
      declaracion({ versionApk: { versionName: "1.19.0", versionCode: "11900" } }),
    );
    expect(c).toContain("2310f6e (servidor)");
    expect(c).toContain("1.19.0 (11900) (app Android)");
  });

  it("sin APK publicada sale sólo el servidor", () => {
    const c = valorDe("1.c)", declaracion({ versionApk: null }));
    expect(c).toBe("2310f6e (servidor)");
  });

  it("media versión de APK no se pinta", () => {
    // `versionName` sin `versionCode` sería «1.19.0 ()» en un documento
    // legal. Se omite la línea entera.
    const c = valorDe(
      "1.c)",
      declaracion({ versionApk: { versionName: "1.19.0", versionCode: "" } }),
    );
    expect(c).toBe("2310f6e (servidor)");
  });

  it("una versión vacía es un error, no un hueco", () => {
    expect(() => declaracion({ versionServidor: "  " })).toThrow(RangeError);
  });
});

describe("la fecha es la de la versión, nunca la de hoy", () => {
  it("sin fecha horneada lo dice", () => {
    expect(valorDe("1.l)", declaracion({ fechaSuscripcion: null }))).toContain(
      "no disponible en esta build",
    );
  });

  it("una fecha basura no se cuela como fecha", () => {
    for (const basura of ["ayer", "27/09/2026", "2026-13-01", "2026-02-31"]) {
      expect(
        valorDe("1.l)", declaracion({ fechaSuscripcion: basura })),
        `«${basura}» se colaría como fecha`,
      ).toContain("no disponible en esta build");
    }
  });

  it("formatea en castellano largo, como los ejemplos de la AEAT", () => {
    expect(formatearFechaLarga("2026-09-27")).toBe("27 de septiembre de 2026");
    expect(formatearFechaLarga("2026-01-01")).toBe("1 de enero de 2026");
    expect(formatearFechaLarga("2025-12-31")).toBe("31 de diciembre de 2025");
  });

  it("no se va un día por el huso del proceso", () => {
    // El fallo clásico: `new Date("2026-09-27").getDate()` en un servidor al
    // oeste de Greenwich devuelve 26. La fecha de un documento legal no puede
    // depender de dónde corre el proceso que lo pinta.
    const previo = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(formatearFechaLarga("2026-09-27")).toBe("27 de septiembre de 2026");
      process.env.TZ = "Pacific/Kiritimati";
      expect(formatearFechaLarga("2026-09-27")).toBe("27 de septiembre de 2026");
    } finally {
      process.env.TZ = previo;
    }
  });
});
