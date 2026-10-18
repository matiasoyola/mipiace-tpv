// residencia-1b · EL AAD DE LAS SEIS COLUMNAS DE LA RESIDENCIA, Y EL
// GUARDIÁN DEL «UN SOLO SITIO».
//
// Este fichero no monta Fastify ni toca Postgres: lo que prueba es la
// pieza que decide si un dato cifrado se puede mover, y la que impide que
// el AAD se arme en dos sitios distintos.
//
// Los tres que importan de verdad:
//
//   1. **El AAD está FIJADO POR TEST**, los quince sitios. Cambiar una de
//      esas cadenas deja ilegible todo lo cifrado antes —no «mal», sino
//      para siempre— así que el test está para que ese cambio no pase por
//      descuido. Misma lección que la huella del contrato en clinica-7 §1.
//   2. **Un valor movido no se descifra.** Ni a otra fila, ni a otra
//      columna de la misma fila, ni a otro centro. No «se descifra mal»:
//      da error de autenticación, que es lo que hace que el fallo se vea
//      en vez de convertirse en la ficha de una señora con el DNI de otra.
//   3. **NI UNA LLAMADA A `aadDe` FUERA DE `cripto-campos.ts`.** La
//      cabecera de ese fichero dice «un test lo vigila» desde clinica-7.
//      No lo vigilaba ninguno. Ahora sí, y cubre los seis sitios nuevos.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it } from "vitest";

import {
  NoSeDescifra,
  aadDe,
  cifrarValor,
  descifrarValor,
} from "../src/clinica/cripto.js";
import {
  TEXTO_ILEGIBLE,
  cifrarTexto,
  configurarAvisoDeIlegible,
  leerTexto,
  nuevoIdDeFila,
  sitioAnotacion,
  sitioContenidoAFamilia,
  sitioCorreccion,
  sitioDescripcionDeIncidencia,
  sitioDniDeResidente,
  sitioEntrada,
  sitioMotivoDeAlta,
  sitioMotivoDeCierreDeLinea,
  sitioMotivoDeExcepcion,
  sitioMotivoDeLinea,
  sitioMotivoDeOcupacion,
  sitioMotivoDeRetirada,
  sitioMotivoDeRevocacion,
  sitioNotaDeCita,
  sitioNotaDeFicha,
  sitioNotaTecnica,
  sitioNotaDeRegistro,
  sitioNssDeResidente,
  sitioRespuestaDeFamilia,
  sitioTextoDeAccion,
  sitioValorDeRegistro,
  sitioZonaDeFoto,
} from "../src/clinica/cripto-campos.js";

const DEK_A = randomBytes(32);
const DEK_B = randomBytes(32);

const CENTRO = "00000000-0000-0000-0000-00000000c001";
const OTRO_CENTRO = "00000000-0000-0000-0000-00000000c002";
const CARMEN = "44444444-4444-4444-4444-444444444444";
const LUIS = "55555555-5555-5555-5555-555555555555";

const SRC = new URL("../src/", import.meta.url).pathname;

// ── 1 · EL INVENTARIO, FIJADO ────────────────────────────────────────

describe("el AAD de cada columna cifrada está fijado", () => {
  // Las nueve de clinica-7, las SEIS de residencia-1b, las DOS del
  // registro de cuidados (residencia-3) y las CINCO del libro de
  // incidencias (residencia-4), con el nombre de tabla y el nombre
  // LÓGICO de columna que va dentro del ciphertext.
  //
  // El nombre lógico es el de la columna EN CLARO (`dni`, no
  // `dni_cifrado`): lo que el AAD identifica es el dato, y el dato es el
  // mismo antes y después de cifrarse.
  const SITIOS: Array<[string, (t: string, id: string) => unknown, string, string]> = [
    ["entrada", sitioEntrada, "clinical_entries", "body"],
    ["anotación", sitioAnotacion, "clinical_addenda", "body"],
    ["zona de foto", sitioZonaDeFoto, "clinical_photos", "zona"],
    ["motivo de retirada", sitioMotivoDeRetirada, "clinical_photos", "withdraw_reason"],
    ["motivo de revocación", sitioMotivoDeRevocacion, "client_consents", "revoke_reason"],
    ["corrección", sitioCorreccion, "clinical_assessment_corrections", "correccion"],
    ["nota de cita", sitioNotaDeCita, "appointments", "notes"],
    ["nota de ficha", sitioNotaDeFicha, "clients", "notes"],
    ["nota técnica", sitioNotaTecnica, "client_technical_notes", "body"],
    // residencia-1b (D-63)
    ["DNI del residente", sitioDniDeResidente, "resident_profiles", "dni"],
    ["NSS del residente", sitioNssDeResidente, "resident_profiles", "nss"],
    ["motivo del alta", sitioMotivoDeAlta, "resident_profiles", "discharge_reason"],
    ["motivo de la línea", sitioMotivoDeLinea, "care_plan_items", "reason"],
    ["motivo del cierre", sitioMotivoDeCierreDeLinea, "care_plan_items", "close_reason"],
    ["motivo de la ocupación", sitioMotivoDeOcupacion, "bed_assignments", "reason"],
    // residencia-3 · el registro de cuidados. **Dos columnas lógicas y no
    // una**: con el mismo nombre, el texto de la nota de «algo no va
    // bien» se podría copiar a la columna del valor y descifraría.
    ["valor del registro", sitioValorDeRegistro, "care_records", "value"],
    ["nota del registro", sitioNotaDeRegistro, "care_records", "note"],
    // residencia-4 (D-63) · el libro de incidencias. **Cinco columnas
    // lógicas y no tres**, y por lo mismo: con el mismo nombre lógico,
    // lo que se le dijo a la familia se podría copiar al motivo de no
    // habérselo dicho, y descifraría.
    ["descripción de la incidencia", sitioDescripcionDeIncidencia, "incidents", "description"],
    ["texto de la acción", sitioTextoDeAccion, "incident_actions", "text"],
    ["lo que se le dijo a la familia", sitioContenidoAFamilia, "family_communications", "content"],
    ["lo que contestó la familia", sitioRespuestaDeFamilia, "family_communications", "response"],
    ["motivo de la excepción", sitioMotivoDeExcepcion, "resident_threshold_overrides", "reason"],
  ];

  it.each(SITIOS)("%s → tenant|%s|%s|fila", (_, sitioDe, tabla, columna) => {
    expect(aadDe(sitioDe(CENTRO, CARMEN) as never)).toBe(
      `${CENTRO}|${tabla}|${columna}|${CARMEN}`,
    );
  });

  it("son VEINTIDÓS, y no se añade una columna cifrada sin su sitio", () => {
    // El CHECK de formato (`~ '^c[0-9]+:…'`) es la marca de una columna
    // cifrada con una DEK: se cuentan los de TODAS las migraciones y se
    // comparan con los sitios de este inventario.
    //
    // El único que sobra es `clinical_tenant_keys.canary`, cuyo sitio vive
    // en `cripto.ts` (`sitioDelCanario`) porque no es el dato de nadie: su
    // trabajo es cuadrar, no significar.
    const raiz = join(SRC, "../../../packages/db/prisma/migrations");
    let conCheck = 0;
    for (const dir of readdirSync(raiz, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const sql = readFileSync(join(raiz, dir.name, "migration.sql"), "utf8");
      // Las líneas de CHECK de formato, sin contar las del bloque `down`
      // (que van comentadas).
      for (const linea of sql.split("\n")) {
        if (linea.trimStart().startsWith("--")) continue;
        if (linea.includes("~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'")) conCheck += 1;
      }
    }
    expect(conCheck).toBe(SITIOS.length + 1);
  });
});

// ── 2 · UN VALOR MOVIDO NO SE DESCIFRA ───────────────────────────────

describe("un valor cifrado de la residencia no se puede mover", () => {
  it("el DNI de una residente NO se descifra en la ficha de otra", () => {
    const cifrado = cifrarValor("12345678Z", DEK_A, sitioDniDeResidente(CENTRO, CARMEN));
    // Vuelve en su sitio.
    expect(descifrarValor(cifrado, DEK_A, sitioDniDeResidente(CENTRO, CARMEN))).toBe(
      "12345678Z",
    );
    // Y no vuelve en la de Luis. Es el `UPDATE` a mano que copia una
    // columna de una fila a otra.
    expect(() =>
      descifrarValor(cifrado, DEK_A, sitioDniDeResidente(CENTRO, LUIS)),
    ).toThrow(NoSeDescifra);
  });

  it("el DNI NO se descifra como NSS de la misma ficha", () => {
    const cifrado = cifrarValor("12345678Z", DEK_A, sitioDniDeResidente(CENTRO, CARMEN));
    expect(() =>
      descifrarValor(cifrado, DEK_A, sitioNssDeResidente(CENTRO, CARMEN)),
    ).toThrow(NoSeDescifra);
  });

  it("el motivo de APERTURA de una línea del plan no vale como motivo de CIERRE", () => {
    // Las dos columnas de la misma fila. Con el mismo nombre lógico, el
    // motivo del cierre se podría copiar al de la apertura y descifraría:
    // «se le retiró la sonda» pasaría a ser por qué se le puso.
    const linea = randomUUID();
    const cifrado = cifrarValor(
      "úlcera sacra grado II",
      DEK_A,
      sitioMotivoDeLinea(CENTRO, linea),
    );
    expect(() =>
      descifrarValor(cifrado, DEK_A, sitioMotivoDeCierreDeLinea(CENTRO, linea)),
    ).toThrow(NoSeDescifra);
  });

  it("el motivo de una línea del plan no vale en otra línea del MISMO residente", () => {
    const una = randomUUID();
    const otra = randomUUID();
    const cifrado = cifrarValor("glucemia alta", DEK_A, sitioMotivoDeLinea(CENTRO, una));
    expect(() =>
      descifrarValor(cifrado, DEK_A, sitioMotivoDeLinea(CENTRO, otra)),
    ).toThrow(NoSeDescifra);
  });

  it("el motivo de un cambio de habitación no vale en otra ocupación", () => {
    const una = randomUUID();
    const otra = randomUUID();
    const cifrado = cifrarValor(
      "aislamiento por GEA",
      DEK_A,
      sitioMotivoDeOcupacion(CENTRO, una),
    );
    expect(() =>
      descifrarValor(cifrado, DEK_A, sitioMotivoDeOcupacion(CENTRO, otra)),
    ).toThrow(NoSeDescifra);
  });

  it("nada de un centro se descifra en otro, ni con el mismo id de fila", () => {
    const cifrado = cifrarValor(
      "fallecimiento",
      DEK_A,
      sitioMotivoDeAlta(CENTRO, CARMEN),
    );
    expect(() =>
      descifrarValor(cifrado, DEK_A, sitioMotivoDeAlta(OTRO_CENTRO, CARMEN)),
    ).toThrow(NoSeDescifra);
  });

  it("y con la DEK de otro centro tampoco, ni en el sitio bueno", () => {
    const cifrado = cifrarValor(
      "fallecimiento",
      DEK_A,
      sitioMotivoDeAlta(CENTRO, CARMEN),
    );
    expect(() =>
      descifrarValor(cifrado, DEK_B, sitioMotivoDeAlta(CENTRO, CARMEN)),
    ).toThrow(NoSeDescifra);
  });
});

// ── 3 · EL HUECO MARCADO, Y LA FICHA SE SIGUE SIRVIENDO ──────────────

describe("un valor que no se descifra sale como hueco marcado", () => {
  const avisos: Array<{ tabla: string; columna: string; filaId: string }> = [];

  beforeEach(() => {
    avisos.length = 0;
    configurarAvisoDeIlegible((sitio) => {
      avisos.push({
        tabla: sitio.tabla,
        columna: sitio.columna,
        filaId: sitio.filaId,
      });
    });
  });

  it("el DNI de otra fila sale como hueco, no revienta la ficha", () => {
    // Lo que pasaría con un `UPDATE` a mano que copió el DNI de Carmen a
    // la ficha de Luis.
    const deCarmen = cifrarTexto("12345678Z", DEK_A, sitioDniDeResidente(CENTRO, CARMEN))!;
    const leido = leerTexto(
      { cifrado: deCarmen, claro: null },
      DEK_A,
      sitioDniDeResidente(CENTRO, LUIS),
    );
    expect(leido).toBe(TEXTO_ILEGIBLE);
    // Y lo que se apunta es DÓNDE está el problema. Nunca el ciphertext.
    expect(avisos).toEqual([
      { tabla: "resident_profiles", columna: "dni", filaId: LUIS },
    ]);
  });

  it("sin la clave del centro, también el hueco", () => {
    const cifrado = cifrarTexto("fallecimiento", DEK_A, sitioMotivoDeAlta(CENTRO, CARMEN))!;
    expect(
      leerTexto({ cifrado, claro: null }, null, sitioMotivoDeAlta(CENTRO, CARMEN)),
    ).toBe(TEXTO_ILEGIBLE);
  });

  it("y NO se cae a la columna en claro cuando la cifrada está y falla", () => {
    // Es la mitad que importa del orden del EXPAND. Caerse al claro
    // convertiría un «la clave no es la buena» en un sistema que parece
    // funcionar sirviendo el texto de respaldo que la migración dejó.
    const deCarmen = cifrarTexto("12345678Z", DEK_A, sitioDniDeResidente(CENTRO, CARMEN))!;
    expect(
      leerTexto(
        { cifrado: deCarmen, claro: "87654321X" },
        DEK_A,
        sitioDniDeResidente(CENTRO, LUIS),
      ),
    ).toBe(TEXTO_ILEGIBLE);
  });

  it("una fila que el script todavía no pasó se lee del claro", () => {
    // Mientras el expand no termine, la ficha tiene que seguir leyéndose.
    expect(
      leerTexto(
        { cifrado: null, claro: "87654321X" },
        DEK_A,
        sitioDniDeResidente(CENTRO, LUIS),
      ),
    ).toBe("87654321X");
    expect(avisos).toEqual([]);
  });

  it("y una columna vacía sigue vacía: no se cifra la nada", () => {
    expect(cifrarTexto(null, DEK_A, sitioMotivoDeAlta(CENTRO, CARMEN))).toBeNull();
    expect(cifrarTexto("", DEK_A, sitioMotivoDeAlta(CENTRO, CARMEN))).toBeNull();
  });
});

// ── 4 · EL GUARDIÁN: `aadDe` SE LLAMA EN UN SOLO SITIO ───────────────

describe("el AAD se arma en un solo sitio", () => {
  /** Todos los `.ts` de `apps/api/src`, recursivo. */
  function ficherosDeSrc(dir: string): string[] {
    const salida: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) salida.push(...ficherosDeSrc(ruta));
      else if (entrada.name.endsWith(".ts")) salida.push(ruta);
    }
    return salida;
  }

  it("ni una llamada a `aadDe` fuera de `cripto.ts` y `cripto-campos.ts`", () => {
    // `cripto.ts` es quien lo define y quien lo pasa a `setAAD`;
    // `cripto-campos.ts` es quien decide qué sitio le toca a cada columna.
    // Cualquier tercero que lo llamara sería una segunda forma de armar el
    // AAD, y el que no cuadrara dejaría una fila ilegible para siempre.
    const permitidos = new Set([
      join(SRC, "clinica/cripto.ts"),
      join(SRC, "clinica/cripto-campos.ts"),
    ]);
    const culpables = ficherosDeSrc(SRC)
      .filter((f) => !permitidos.has(f))
      .filter((f) => /\baadDe\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length));
    expect(culpables).toEqual([]);
  });

  it("y ningún fichero de residencia construye un `SitioDelValor` a mano", () => {
    // El otro camino para el mismo fallo: armar `{ tenantId, tabla,
    // columna, filaId }` con una cadena a mano en vez de pedir el `sitio*`.
    // Se reconoce por el nombre de la tabla literal.
    const culpables = ficherosDeSrc(join(SRC, "residencia"))
      .filter((f) =>
        /(tabla:\s*["']|columna:\s*["'])/.test(readFileSync(f, "utf8")),
      )
      .map((f) => f.slice(SRC.length));
    expect(culpables).toEqual([]);
  });

  it("`nuevoIdDeFila` devuelve uuids distintos", () => {
    // Lo mínimo que hay que saber de la pieza que hace falta para que el
    // AAD exista antes de la fila.
    const unos = new Set(Array.from({ length: 50 }, () => nuevoIdDeFila()));
    expect(unos.size).toBe(50);
  });
});
