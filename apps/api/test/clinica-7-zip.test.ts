// clinica-7 · EL ZIP DE LA DEVOLUCIÓN DE DATOS.
//
// El formato está escrito a mano (`lib/zip.ts`, método «store») en vez de
// meter una dependencia nueva en el bloque cuyo propósito es reducir
// superficie. Y un formato escrito a mano necesita un test que lo abra con
// una herramienta que no es la nuestra.
//
// Así que esto **llama al `unzip` del sistema**:
//
//   · `unzip -t` comprueba el CRC de todas las entradas. Si el CRC saliera
//     mal, el paquete de la devolución de datos de una clínica se abriría
//     «bien» y con los ficheros corruptos — que es el peor fallo posible
//     de esta pieza, porque se descubre cuando ya no hay de dónde
//     sacarlos.
//   · `unzip -o` lo extrae de verdad, y se comparan los bytes.
//
// Un test que solo leyera los bytes que escribimos probaría que escribimos
// lo que escribimos.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  Zip,
  ZipDemasiadoGrande,
  nombreSeguroEnZip,
} from "../src/lib/zip.js";

const FECHA = new Date("2026-10-14T12:30:00Z");

/** Escribe el zip en un temporal y devuelve su ruta. */
function escribir(
  entradas: Array<[string, Buffer]>,
): { ruta: string; dir: string } {
  const z = new Zip();
  const trozos: Buffer[] = [];
  for (const [nombre, contenido] of entradas) {
    trozos.push(z.anadir(nombre, contenido, FECHA));
  }
  trozos.push(z.cerrar());
  const dir = mkdtempSync(join(tmpdir(), "clinica7-zip-"));
  const ruta = join(dir, "paquete.zip");
  writeFileSync(ruta, Buffer.concat(trozos));
  return { ruta, dir };
}

describe("clinica-7 · el ZIP lo abre el `unzip` del sistema", () => {
  const PDF = Buffer.from("%PDF-1.4 la historia completa de Carmen");
  const JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(2048, 7),
  ]);
  const JSON_ = Buffer.from(
    JSON.stringify({ pacientes: [{ nombre: "Carmen Rodríguez" }] }, null, 2),
  );

  const carpeta = nombreSeguroEnZip("Rodríguez Gómez, Carmen");

  it("`unzip -t` no encuentra ni un error (o sea: el CRC cuadra)", () => {
    const { ruta } = escribir([
      [`${carpeta}/historia.pdf`, PDF],
      [`${carpeta}/fotos/2026-09-07-dedo-gordo.jpg`, JPEG],
      ["centro.json", JSON_],
    ]);
    const salida = execFileSync("unzip", ["-t", ruta], { encoding: "utf8" });
    expect(salida).toContain("No errors detected");
  });

  it("y extraído, los bytes son los mismos", () => {
    const { ruta, dir } = escribir([
      [`${carpeta}/historia.pdf`, PDF],
      [`${carpeta}/fotos/foto.jpg`, JPEG],
      ["centro.json", JSON_],
    ]);
    const fuera = join(dir, "fuera");
    execFileSync("unzip", ["-q", "-o", ruta, "-d", fuera]);
    expect(
      readFileSync(join(fuera, carpeta, "historia.pdf")).equals(PDF),
    ).toBe(true);
    expect(
      readFileSync(join(fuera, carpeta, "fotos", "foto.jpg")).equals(JPEG),
    ).toBe(true);
    expect(readFileSync(join(fuera, "centro.json")).equals(JSON_)).toBe(true);
  });

  it("las carpetas van SIN TILDES, y el nombre exacto va dentro", () => {
    // El `unzip` de macOS (Info-ZIP 6.0) no entiende el bit de UTF-8 y se
    // niega a crear una carpeta con tildes. El paquete lo abre la dueña y,
    // si hace falta, un abogado: que se abra con lo que haya instalado
    // vale más que una tilde en un nombre de carpeta.
    expect(nombreSeguroEnZip("Rodríguez Gómez, Carmen")).toBe(
      "Rodriguez Gomez, Carmen",
    );
    expect(nombreSeguroEnZip("Muñoz Peña")).toBe("Munoz Pena");
    // Los espacios y la coma SÍ se quedan: valen en los tres sistemas y se
    // leen mejor.
    expect(nombreSeguroEnZip("Rodríguez Gómez, Carmen")).toContain(", ");
  });

  it("un paciente no puede escribir FUERA de su carpeta", () => {
    // Los nombres de este paquete llevan el del paciente. Uno que se
    // llamara «../otra-clínica» no puede salirse.
    expect(nombreSeguroEnZip("../otra")).toBe("-/otra");
    expect(nombreSeguroEnZip("/absoluta")).toBe("absoluta");
    expect(nombreSeguroEnZip('C:\\Windows\\mal*nombre?')).not.toMatch(
      /[\\:*?]/,
    );
  });

  it("y el 4 GiB se dice en voz alta: LEVANTA en vez de salir corrupto", () => {
    // ZIP64 no está implementado. Un paquete de seis gigas que no abre es
    // peor que un error claro, y la salida (exportar por paciente) ya
    // existe.
    const z = new Zip();
    z.anadir("x.bin", Buffer.alloc(16), FECHA);
    // Se falsea el contador de bytes escritos, que es lo que el cierre
    // compara: construir 4 GiB de verdad en un test no es un test.
    Object.defineProperty(z, "escrito", { value: 0x1_0000_0000 });
    expect(() => z.cerrar()).toThrow(ZipDemasiadoGrande);
  });

  it("un zip cerrado no admite más entradas", () => {
    const z = new Zip();
    z.anadir("a.txt", Buffer.from("a"), FECHA);
    z.cerrar();
    expect(() => z.anadir("b.txt", Buffer.from("b"), FECHA)).toThrow();
    expect(() => z.cerrar()).toThrow();
  });

  it("y cuenta lo que lleva, para el log de la exportación", () => {
    const z = new Zip();
    z.anadir("a.txt", Buffer.from("hola"), FECHA);
    z.anadir("b.txt", Buffer.from("adiós"), FECHA);
    expect(z.cuantas).toBe(2);
    expect(z.bytes).toBeGreaterThan(9);
  });
});
