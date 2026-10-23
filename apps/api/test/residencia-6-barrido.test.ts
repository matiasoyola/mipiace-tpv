// residencia-6 (punto 5) · **EL BARRIDO DE HUÉRFANOS.**
//
// Un script que borra binarios de una historia clínica. Lo que este banco
// fija es lo que no puede fallar nunca:
//
//   1. **Por defecto sólo LISTA.** Ni un `unlink` sin `--borrar`.
//   2. **Nunca toca un fichero referenciado.** Es el sabotaje de la tabla
//      del done: se le quita el `WHERE` que mira la fila y esto se pone
//      rojo.
//   3. **Nunca toca uno más reciente que el margen.** Entre escribir el
//      binario y escribir la fila hay un hueco de milisegundos —el orden
//      es ése a propósito, clinica-4— y una subida de 4 MB con wifi mala
//      lo alarga. Un barrido corriendo en ese hueco borraría la foto que
//      se está subiendo.
//   4. **El resumen no lleva rutas.** Recuentos y bytes. Un nombre de
//      fichero no dice nada de nadie por diseño, pero una lista de la
//      carpeta `residentes/` en un log dice cuántas fotos de residentes
//      hay en el centro.
//
// ── Cómo se prueba sin Postgres ─────────────────────────────────────
//
// El cruce con la base **entra por parámetro** (`referencias`), igual que
// `--vaciar` en `residencia-cifrar.ts`. Lo que se prueba de verdad es
// **el recorrido del disco y la decisión de borrar**, que es donde está
// el riesgo: ficheros reales en un directorio temporal, con su `mtime`
// puesto a mano.
//
// La otra mitad —que las seis consultas miran las seis columnas de
// verdad— la prueba `residencia-6.e2e.ts` contra Postgres.

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it } from "vitest";

import type { ClaseDeFichero } from "../src/clinica/ficheros.js";
import { CARPETA_DE_LA_CLASE } from "../src/clinica/ficheros.js";
import { olvidarEnv } from "../src/env.js";
import {
  MARGEN_POR_DEFECTO_MIN,
  barrer,
  resumen,
} from "../src/scripts/barrer-huerfanos.js";

const AHORA = new Date("2026-10-19T12:00:00.000Z");

let raiz = "";

/** Escribe un fichero en la carpeta de su clase, con la antigüedad que se
 *  le diga. Los minutos son del `mtime`, que es lo que el margen mira. */
function ponerFichero(
  clase: keyof typeof CARPETA_DE_LA_CLASE,
  fileName: string,
  minutosDeAntiguedad: number,
  bytes = 1024,
): void {
  const dir = join(raiz, CARPETA_DE_LA_CLASE[clase]);
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, fileName);
  writeFileSync(ruta, Buffer.alloc(bytes, 7));
  const cuando = new Date(AHORA.getTime() - minutosDeAntiguedad * 60_000);
  utimesSync(ruta, cuando, cuando);
}

function loQueQueda(clase: keyof typeof CARPETA_DE_LA_CLASE): string[] {
  try {
    return readdirSync(join(raiz, CARPETA_DE_LA_CLASE[clase])).sort();
  } catch {
    return [];
  }
}

/** Lo que la base dice que está referenciado. */
let referencias: () => Promise<Map<ClaseDeFichero, Set<string>>> = async () =>
  new Map();

function referenciaSolo(pares: Array<[ClaseDeFichero, string[]]>): void {
  const mapa = new Map(
    pares.map(([clase, nombres]) => [clase, new Set(nombres)] as const),
  );
  referencias = async () => mapa;
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "mipiacetpv-barrido-"));
  process.env.CLINICAL_FILES_DIR = raiz;
  // `loadEnv()` memoiza la primera lectura —en producción el entorno no
  // cambia sin reiniciar— así que sin esto el barrido recorrería el
  // volumen del test anterior y saldría verde sin haber mirado nada.
  olvidarEnv();
  referenciaSolo([]);
});

describe("por defecto SÓLO LISTA", () => {
  it("encuentra el huérfano y NO lo borra", async () => {
    ponerFichero("RESIDENTE", "foto-vieja.jpg", 120);
    referenciaSolo([["RESIDENTE", []]]);

    const b = await barrer({
      borrar: false,
      margenMinutos: MARGEN_POR_DEFECTO_MIN,
      ahora: AHORA,
      referencias,
    });

    expect(b.huerfanos.map((h) => h.fileName)).toEqual(["foto-vieja.jpg"]);
    expect(b.borrados).toBe(0);
    expect(b.bytesLiberados).toBe(0);
    // Y sigue en el disco, que es lo que importa.
    expect(loQueQueda("RESIDENTE")).toEqual(["foto-vieja.jpg"]);
  });

  it("y el resumen lo dice en vez de callarse", async () => {
    ponerFichero("RESIDENTE", "foto-vieja.jpg", 120);
    const b = await barrer({ borrar: false, margenMinutos: 60, ahora: AHORA, referencias });
    expect(resumen(b, false)).toContain("no se ha borrado nada");
    expect(resumen(b, false)).toContain("huérfanos 1");
  });
});

describe("con --borrar", () => {
  it("borra el huérfano y cuenta los bytes", async () => {
    ponerFichero("RESIDENTE", "foto-vieja.jpg", 120, 2048);

    const b = await barrer({ borrar: true, margenMinutos: 60, ahora: AHORA, referencias });

    expect(b.borrados).toBe(1);
    expect(b.bytesLiberados).toBe(2048);
    expect(loQueQueda("RESIDENTE")).toEqual([]);
  });

  it("**NO toca un fichero REFERENCIADO** · el sabotaje de la tabla", async () => {
    ponerFichero("RESIDENTE", "la-de-carmen.jpg", 500);
    ponerFichero("RESIDENTE", "la-que-se-cambió.jpg", 500);
    referenciaSolo([["RESIDENTE", ["la-de-carmen.jpg"]]]);

    const b = await barrer({ borrar: true, margenMinutos: 60, ahora: AHORA, referencias });

    expect(b.huerfanos.map((h) => h.fileName)).toEqual(["la-que-se-cambió.jpg"]);
    expect(b.referenciados.RESIDENTE).toBe(1);
    expect(loQueQueda("RESIDENTE")).toEqual(["la-de-carmen.jpg"]);
  });

  it("**NO toca uno más NUEVO que el margen** · la subida en curso", async () => {
    // El caso de verdad: `guardarFichero` ha escrito el binario y la
    // transacción que escribe la fila todavía no ha terminado.
    ponerFichero("FOTO", "subiendo-ahora.jpg", 1);
    ponerFichero("FOTO", "de-hace-rato.jpg", 90);

    const b = await barrer({ borrar: true, margenMinutos: 60, ahora: AHORA, referencias });

    expect(b.huerfanos.map((h) => h.fileName)).toEqual(["de-hace-rato.jpg"]);
    expect(b.demasiadoNuevos).toBe(1);
    expect(loQueQueda("FOTO")).toEqual(["subiendo-ahora.jpg"]);
  });

  it("y el margen se puede subir: con 180 min, el de 90 tampoco se toca", async () => {
    ponerFichero("FOTO", "de-hace-rato.jpg", 90);
    const b = await barrer({ borrar: true, margenMinutos: 180, ahora: AHORA, referencias });
    expect(b.huerfanos).toEqual([]);
    expect(b.demasiadoNuevos).toBe(1);
    expect(loQueQueda("FOTO")).toEqual(["de-hace-rato.jpg"]);
  });
});

describe("las seis clases, y ninguna más", () => {
  it("recorre las seis carpetas y cuenta por clase", async () => {
    ponerFichero("FOTO", "f.jpg", 500);
    ponerFichero("CONSENTIMIENTO", "c.pdf", 500);
    ponerFichero("INFORME", "i.pdf", 500);
    ponerFichero("RESIDENTE", "r.jpg", 500);
    ponerFichero("VOZ", "v.webm", 500);
    ponerFichero("EVIDENCIA", "e.pdf", 500);

    const b = await barrer({ borrar: false, margenMinutos: 60, ahora: AHORA, referencias });

    expect(b.huerfanos).toHaveLength(6);
    expect([...new Set(b.huerfanos.map((h) => h.clase))].sort()).toEqual([
      "CONSENTIMIENTO",
      "EVIDENCIA",
      "FOTO",
      "INFORME",
      "RESIDENTE",
      "VOZ",
    ]);
  });

  it("una carpeta que no existe no es un error", async () => {
    // Un centro sin obligaciones con evidencia no tiene carpeta
    // `evidencias`. Si esto lanzara, el barrido no se podría correr en el
    // único sitio donde hace falta: un centro recién encendido.
    const b = await barrer({ borrar: true, margenMinutos: 60, ahora: AHORA, referencias });
    expect(b.huerfanos).toEqual([]);
    expect(b.enDisco.EVIDENCIA).toBe(0);
  });
});

describe("el resumen del log", () => {
  it("lleva recuentos y bytes, y NI UNA RUTA", async () => {
    ponerFichero("RESIDENTE", "una-foto-huerfana.jpg", 500);
    ponerFichero("VOZ", "una-nota-huerfana.webm", 500);

    const b = await barrer({ borrar: true, margenMinutos: 60, ahora: AHORA, referencias });
    const linea = resumen(b, true);

    expect(linea).toContain("huérfanos 2");
    expect(linea).toContain("BORRADOS 2");
    // Lo que NO puede llevar: ni nombres, ni la raíz del volumen.
    expect(linea).not.toContain("una-foto-huerfana.jpg");
    expect(linea).not.toContain("una-nota-huerfana.webm");
    expect(linea).not.toContain(raiz);
    expect(linea).not.toContain("/");
  });
});
