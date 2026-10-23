// clinica-4 · las plantillas, la vigencia y el firmante.
//
// Lo que este fichero guarda, y es el corazón del bloque:
//
//   1. **Una versión publicada no se reescribe**: la huella del texto
//      canónico de cada plantilla está FIJADA aquí. Si alguien cambia una
//      coma de un texto ya firmado, este test se pone rojo — que es lo que
//      obliga a sacar una versión nueva en vez de reescribir la vieja.
//   2. **Revocar es una fila nueva**, y un revocado cuenta como que falta.
//   3. **Un alta manual sin plantilla no satisface nada.**
//   4. **«Fotos clínicas» no se ata a un servicio.**
//   5. El firmante y el informante, con sus negativas.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  consentimientoVigente,
  consentimientosQueFaltan,
  estadoDeUnaPlantilla,
  estaRevocada,
  firmanteCompleto,
  informantePuedeInformar,
  plantillaDe,
  plantillaVigente,
  claseDeLaPlantilla,
  PLANTILLAS_DEL_INGRESO,
  PLANTILLAS_DE_SERVICIO,
  PLANTILLAS_IDS,
  PLANTILLAS_VIGENTES,
  PLANTILLA_DE_FOTOS,
  textoCanonico,
  type FilaFirmada,
} from "../src/index.js";

function huella(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

// ── 1 · las plantillas ───────────────────────────────────────────────

describe("clinica-4 · las plantillas son dato versionado", () => {
  it("hay cinco, con ids estables", () => {
    // Las tres de clinica-4 y **las dos de la residencia** (historia-1,
    // D-95). Los ids viajan en la fila firmada para siempre: cambiar uno
    // deja un consentimiento que no se puede volver a enseñar.
    expect([...PLANTILLAS_IDS]).toEqual([
      "cirugia-ungueal",
      "anestesia-local",
      "fotos-clinicas",
      "proteccion-datos-residente",
      "imagen-residente",
    ]);
  });

  it("todas están pendientes de validar", () => {
    // Las cinco llevan texto de ejemplo: el `-done` lo lista, y este test
    // es lo que impide que se olvide quitar la marca cuando un jurista o
    // la profesional los dé por buenos.
    for (const p of PLANTILLAS_VIGENTES) {
      expect(p.pendienteDeValidar, p.id).toBe(true);
    }
  });

  it("las tres de la CLÍNICA son clínicas; las dos de la RESIDENCIA, no", () => {
    // `clinica` significa «contenido mínimo de la historia clínica» (Ley
    // 41/2002 art. 15.2) y de ella cuelgan dos reglas: el PDF pasa por
    // `conHistoria` y **el informante tiene que ser sanitario**.
    //
    // La segunda es la que decide en la residencia: quien informa de la
    // protección de datos de un ingreso es la administrativa del centro,
    // no la DUE. Con `clinica: true`, la plantilla que D-94 pone en la
    // lista de TODO ingreso sólo la podría firmar personal sanitario — y
    // los ingresos se quedarían esperando a que pase la DUE.
    for (const id of ["cirugia-ungueal", "anestesia-local", "fotos-clinicas"]) {
      expect(plantillaVigente(id)!.clinica, id).toBe(true);
    }
    for (const id of PLANTILLAS_DEL_INGRESO) {
      expect(plantillaVigente(id)!.clinica, id).toBe(false);
    }
  });

  // ── historia-1 (D-95) · EL `kind` DE LA FILA ─────────────────────
  it("el `kind` sale de la plantilla, y sin él es TREATMENT", () => {
    // `TREATMENT` por defecto es lo que las tres de clinica-4 ya hacían:
    // nada de lo firmado antes de este bloque cambia de significado.
    expect(claseDeLaPlantilla(plantillaVigente("cirugia-ungueal")!)).toBe(
      "TREATMENT",
    );
    expect(claseDeLaPlantilla(plantillaVigente("fotos-clinicas")!)).toBe(
      "TREATMENT",
    );
    // Y las dos de la residencia llevan el suyo. **El de imagen importa
    // de verdad**: D-64 pinta la foto del residente en la puerta sólo con
    // un consentimiento `IMAGE` vigente, así que una fila `TREATMENT`
    // dejaría la foto apagada para siempre con el consentimiento firmado.
    expect(claseDeLaPlantilla(plantillaVigente("proteccion-datos-residente")!)).toBe(
      "DATA",
    );
    expect(claseDeLaPlantilla(plantillaVigente("imagen-residente")!)).toBe(
      "IMAGE",
    );
  });

  it("las tres clases son EXACTAMENTE las del enum de la base", () => {
    // Este paquete es puro y no puede importar `ClientConsentKind` de
    // `@mipiacetpv/db`, así que la unión de cadenas se repite. Lo que
    // impide que las dos listas se separen es esto: se lee el enum del
    // `schema.prisma` y se comparan.
    //
    // Sin el test, añadir un valor al enum y olvidarlo aquí dejaría una
    // plantilla que no se puede firmar — y el fallo saldría como un error
    // de Prisma en la cara de quien firma, no al desplegar.
    const schema = readFileSync(
      join(import.meta.dirname, "..", "..", "db", "prisma", "schema.prisma"),
      "utf8",
    );
    const bloque = /enum ClientConsentKind \{([\s\S]*?)\n\}/.exec(schema);
    expect(bloque, "no se encontró el enum ClientConsentKind").toBeTruthy();
    const valores = bloque![1]!
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => /^[A-Z_]+$/.test(l));
    expect(valores.sort()).toEqual(["DATA", "IMAGE", "TREATMENT"]);
  });

  it("la de FOTOS no se ata a ningún servicio", () => {
    // Decisión 4: la pide la primera foto, en la visita que sea. Si
    // entrara en la lista de atables, una paciente a la que se le hace
    // una foto en una quiropodia normal se quedaría sin consentimiento.
    expect(PLANTILLAS_DE_SERVICIO).not.toContain(PLANTILLA_DE_FOTOS);
    expect([...PLANTILLAS_DE_SERVICIO]).toEqual([
      "cirugia-ungueal",
      "anestesia-local",
    ]);
    expect(plantillaVigente(PLANTILLA_DE_FOTOS)!.disparador).toBe(
      "PRIMERA_FOTO",
    );
  });

  it("una versión que no existe NO cae a la vigente", () => {
    // Enseñar el texto de hoy sobre una firma de otra versión sería
    // afirmar que el paciente leyó un documento que no existía.
    expect(plantillaDe("cirugia-ungueal", 1)).toBeDefined();
    expect(plantillaDe("cirugia-ungueal", 2)).toBeUndefined();
    expect(plantillaDe("no-existe", 1)).toBeUndefined();
  });

  it("el texto canónico es título + párrafos, y SU HUELLA ESTÁ FIJADA", () => {
    // Las cinco huellas, calculadas sobre el texto de hoy. **Este es el
    // test que impide reescribir una versión publicada**: cambiar una
    // palabra de un texto que alguien ya firmó rompe la correspondencia
    // entre la fila (`text_sha256`) y la plantilla, y entonces la huella
    // guardada no demuestra nada.
    //
    // Cuando Rosario dé sus textos, lo que se hace es **una versión
    // nueva** y estos números se quedan donde están, con su versión.
    //
    // historia-1 añade las dos de la residencia (D-95) y **las tres de la
    // clínica no cambian ni un dígito**, que es la mitad de lo que este
    // test guarda: una plantilla nueva no puede tocar lo firmado antes.
    const huellas: Record<string, string> = {};
    for (const p of PLANTILLAS_VIGENTES) {
      huellas[`${p.id} v${p.version}`] = huella(textoCanonico(p));
    }
    expect(huellas).toMatchInlineSnapshot(`
      {
        "anestesia-local v1": "ac844e8cb6f6fc35bdddd7bfe14fd2f4c35e02f706522abd5914381df6e1982f",
        "cirugia-ungueal v1": "eea51d83e23263365fd7ca2b57de9a0ec7d1442d2c35c7aa4625bd2dc65becd9",
        "fotos-clinicas v1": "f48d36c2e5d850d5677f6fa1fe3ae8dbe8af18b9ddb451e0c806ebf6921f9c24",
        "imagen-residente v1": "9ad844c534be006ef11642bef2b73745d2bbd9435e3ccbb12fa88108882f0223",
        "proteccion-datos-residente v1": "5c3a32c8d57637f7ea971bd08114dc84448b5a5a08b4c320056b59408520662f",
      }
    `);
  });

  it("el canónico empieza por el título y separa con línea en blanco", () => {
    const p = plantillaVigente("anestesia-local")!;
    const texto = textoCanonico(p);
    expect(texto.startsWith(p.titulo)).toBe(true);
    expect(texto.split("\n\n").length).toBe(p.parrafos.length + 1);
    // Y el formato es parte del contrato de la huella: cambiarlo cambia
    // la huella de TODAS las plantillas de golpe.
    expect(texto).toBe([p.titulo, ...p.parrafos].join("\n\n"));
  });
});

// ── 2 · la vigencia ──────────────────────────────────────────────────

const AYER = "2026-10-08T09:00:00.000Z";
const HOY = "2026-10-09T09:00:00.000Z";
const MAÑANA = "2026-10-10T09:00:00.000Z";

function concesion(
  id: string,
  plantillaId: string | null,
  firmadoEn = HOY,
): FilaFirmada {
  return {
    id,
    plantillaId,
    plantillaVersion: plantillaId ? 1 : null,
    firmadoEn,
    revocaA: null,
  };
}

function revocacion(
  id: string,
  revocaA: string,
  plantillaId: string | null,
  firmadoEn = MAÑANA,
): FilaFirmada {
  return {
    id,
    plantillaId,
    plantillaVersion: plantillaId ? 1 : null,
    firmadoEn,
    revocaA,
  };
}

describe("clinica-4 · ¿vale hoy este consentimiento?", () => {
  it("una concesión sin revocar vale", () => {
    const filas = [concesion("a", "cirugia-ungueal")];
    expect(consentimientoVigente(filas, "cirugia-ungueal")?.id).toBe("a");
  });

  it("sin ninguna fila, no vale", () => {
    expect(consentimientoVigente([], "cirugia-ungueal")).toBeNull();
  });

  it("REVOCADO no vale, y la revocación no concede nada", () => {
    const filas = [
      concesion("a", "cirugia-ungueal"),
      revocacion("r", "a", "cirugia-ungueal"),
    ];
    expect(estaRevocada(filas, "a")).toBe(true);
    expect(consentimientoVigente(filas, "cirugia-ungueal")).toBeNull();
    // Y la fila de revocación no se cuenta como concesión aunque lleve el
    // mismo `plantillaId` (lo lleva para que la lista se lea).
    expect(consentimientoVigente([revocacion("r", "a", "cirugia-ungueal")], "cirugia-ungueal")).toBeNull();
  });

  it("firmado → revocado → firmado otra vez SÍ vale", () => {
    const filas = [
      concesion("a", "cirugia-ungueal", AYER),
      revocacion("r", "a", "cirugia-ungueal", HOY),
      concesion("b", "cirugia-ungueal", MAÑANA),
    ];
    expect(consentimientoVigente(filas, "cirugia-ungueal")?.id).toBe("b");
  });

  it("con dos vivas manda la MÁS RECIENTE", () => {
    const filas = [
      concesion("vieja", "cirugia-ungueal", AYER),
      concesion("nueva", "cirugia-ungueal", MAÑANA),
    ];
    expect(consentimientoVigente(filas, "cirugia-ungueal")?.id).toBe("nueva");
  });

  it("un ALTA MANUAL sin plantilla no satisface ninguna plantilla", () => {
    // Las filas de antes de este bloque (el spa, desde la ficha del
    // cliente): están en la historia y no valen como prueba de que se
    // informó de un texto que no se sabe cuál fue.
    const filas = [concesion("manual", null)];
    expect(consentimientoVigente(filas, "cirugia-ungueal")).toBeNull();
    expect(
      consentimientosQueFaltan({ pide: ["cirugia-ungueal"], filas }),
    ).toEqual(["cirugia-ungueal"]);
  });

  it("el estado completo separa la vigente de las revocadas", () => {
    const filas = [
      concesion("a", "fotos-clinicas", AYER),
      revocacion("r", "a", "fotos-clinicas", HOY),
      concesion("b", "fotos-clinicas", MAÑANA),
    ];
    const e = estadoDeUnaPlantilla(filas, "fotos-clinicas");
    expect(e.vigente?.id).toBe("b");
    expect(e.revocadas.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("clinica-4 · qué falta de lo que pide la cita", () => {
  it("lo que no está firmado", () => {
    const filas = [concesion("a", "anestesia-local")];
    expect(
      consentimientosQueFaltan({
        pide: ["cirugia-ungueal", "anestesia-local"],
        filas,
      }),
    ).toEqual(["cirugia-ungueal"]);
  });

  it("nada, si están los dos", () => {
    const filas = [
      concesion("a", "anestesia-local"),
      concesion("b", "cirugia-ungueal"),
    ];
    expect(
      consentimientosQueFaltan({
        pide: ["cirugia-ungueal", "anestesia-local"],
        filas,
      }),
    ).toEqual([]);
  });

  it("un REVOCADO cuenta como que falta", () => {
    // Es el punto de todo el mecanismo: revocar es una fila nueva
    // precisamente para que la cuenta cambie sin tocar la prueba de que un
    // día se firmó.
    const filas = [
      concesion("a", "cirugia-ungueal"),
      revocacion("r", "a", "cirugia-ungueal"),
    ];
    expect(
      consentimientosQueFaltan({ pide: ["cirugia-ungueal"], filas }),
    ).toEqual(["cirugia-ungueal"]);
  });

  it("dos servicios que piden lo mismo lo piden UNA vez", () => {
    expect(
      consentimientosQueFaltan({
        pide: ["anestesia-local", "anestesia-local", "cirugia-ungueal"],
        filas: [],
      }),
    ).toEqual(["anestesia-local", "cirugia-ungueal"]);
  });

  it("sin servicios no pide nada: los quince tenants de hoy", () => {
    expect(consentimientosQueFaltan({ pide: [], filas: [] })).toEqual([]);
  });

  it("y el ORDEN es el de los servicios de la cita", () => {
    expect(
      consentimientosQueFaltan({
        pide: ["cirugia-ungueal", "anestesia-local"],
        filas: [],
      }),
    ).toEqual(["cirugia-ungueal", "anestesia-local"]);
  });
});

// ── 3 · el firmante y el informante ──────────────────────────────────

describe("clinica-4 · quién firma", () => {
  it("el paciente, sin nombre ni relación", () => {
    expect(
      firmanteCompleto({ clase: "PACIENTE", nombre: null, relacion: null }),
    ).toEqual({ ok: true });
  });

  it("un representante CON nombre y relación", () => {
    expect(
      firmanteCompleto({
        clase: "REPRESENTANTE",
        nombre: "Ana",
        relacion: "hija",
      }),
    ).toEqual({ ok: true });
  });

  it("un representante sin nombre, NO", () => {
    const r = firmanteCompleto({
      clase: "REPRESENTANTE",
      nombre: "  ",
      relacion: "hija",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("FALTA_EL_REPRESENTANTE");
  });

  it("un representante sin relación, NO (la ley pide que conste)", () => {
    const r = firmanteCompleto({
      clase: "REPRESENTANTE",
      nombre: "Ana",
      relacion: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("FALTA_LA_RELACION");
  });

  it("«firma el paciente» CON nombre de representante, NO", () => {
    // Una fila que dice dos cosas a la vez; la que se leería dentro de
    // cinco años sería la equivocada.
    const r = firmanteCompleto({
      clase: "PACIENTE",
      nombre: "Ana",
      relacion: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("SOBRA_EL_REPRESENTANTE");
  });

  it("y cada negativa trae una frase que dice qué hacer", () => {
    for (const f of [
      { clase: "REPRESENTANTE" as const, nombre: null, relacion: null },
      { clase: "REPRESENTANTE" as const, nombre: "Ana", relacion: null },
      { clase: "PACIENTE" as const, nombre: "Ana", relacion: "hija" },
    ]) {
      const r = firmanteCompleto(f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.mensaje.length).toBeGreaterThan(20);
    }
  });
});

describe("clinica-4 · quién informa", () => {
  it("una plantilla CLÍNICA exige sanitario", () => {
    const r = informantePuedeInformar({
      plantillaEsClinica: true,
      esSanitario: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("INFORMANTE_NO_SANITARIO");
  });

  it("con sanitario, pasa", () => {
    expect(
      informantePuedeInformar({ plantillaEsClinica: true, esSanitario: true }),
    ).toEqual({ ok: true });
  });

  it("una plantilla NO clínica la informa cualquiera (el spa)", () => {
    // En el spa informa la profesional que da el servicio, que no es
    // sanitaria. Es el acuerdo de S3 con el lado agenda.
    expect(
      informantePuedeInformar({
        plantillaEsClinica: false,
        esSanitario: false,
      }),
    ).toEqual({ ok: true });
  });
});
