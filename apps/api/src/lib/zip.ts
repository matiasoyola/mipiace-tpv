// clinica-7 · UN ZIP, escrito a mano y SIN COMPRIMIR.
//
// Lo necesita la devolución de datos del art. 28.3.g: un paquete con la
// historia completa de cada paciente en PDF, sus fotos, sus
// consentimientos y un JSON con todo.
//
// ── Por qué a mano y no con una librería ─────────────────────────────
//
// Porque el formato que hace falta son 120 líneas y la alternativa era
// meter una dependencia nueva **en el bloque cuyo propósito entero es
// reducir superficie**. Un `archiver` trae su árbol de dependencias
// transitivas a un camino por el que pasa la historia clínica descifrada
// de una clínica entera; eso es exactamente el tipo de decisión que este
// bloque existe para no tomar a la ligera.
//
// Y es el mismo criterio con el que la casa escribió `escpos-builder` y
// `documento-a4.ts`: cuando el formato es pequeño y auditable, se escribe.
//
// ── SIN COMPRIMIR (método «store»), y no es pereza ──────────────────
//
// Lo que va dentro son PDF y JPEG, que **ya están comprimidos**. Pasarlos
// por deflate gastaría CPU para ganar un 1-2 %, y el único fichero que sí
// comprimiría —el JSON— es el más pequeño del paquete.
//
// Y «store» quita de encima la mitad del formato: sin deflate no hay
// estado de compresión, no hay descriptores de datos, y el CRC y los dos
// tamaños se saben antes de escribir cada entrada. Lo que queda es poner
// bytes en su sitio.
//
// ── El límite de 4 GiB, dicho en voz alta ───────────────────────────
//
// El ZIP clásico guarda tamaños y desplazamientos en 32 bits, así que no
// pasa de 4 GiB. **ZIP64 no está implementado**, y en vez de generar un
// paquete corrupto al pasarse, `cerrar()` LEVANTA. Quien llama lo
// convierte en un 413 que explica qué hacer.
//
// Es un límite real: una clínica con cinco años y veinte mil fotos lo
// alcanza. Está dicho en el `-done` con su salida — exportar por paciente,
// que ya existe (el informe «historia completa» de clinica-4) — y ZIP64
// queda apuntado como lo que lo levanta.
//
// Mejor un error claro que un `.zip` de seis gigas que no abre.

import { crc32 } from "node:zlib";

/** El tope del ZIP clásico. Ver la cabecera. */
export const MAXIMO_DEL_ZIP = 0xffffffff;

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FINAL = 0x06054b50;

/** Método «store»: los bytes, tal cual. */
const METODO_STORE = 0;
/** Bit 11: los nombres van en UTF-8. Sin esto, «Rodríguez» se abre mal en
 *  Windows — y los nombres de los pacientes llevan tildes y eñes. */
const BANDERA_UTF8 = 0x0800;
/** La versión que hace falta para leerlo: 2.0. */
const VERSION = 20;

interface EntradaEscrita {
  nombre: Buffer;
  crc: number;
  tamano: number;
  desplazamiento: number;
  fecha: number;
  hora: number;
}

export class ZipDemasiadoGrande extends Error {
  constructor(bytes: number) {
    super(
      `El paquete pasa de 4 GiB (${bytes} bytes) y este formato no llega: hay que exportar por paciente.`,
    );
  }
}

/**
 * Un ZIP que se construye entrada a entrada.
 *
 * `añadir` devuelve los trozos de esa entrada y `cerrar` el directorio
 * final, así que el llamante puede ir soltándolos a una respuesta HTTP sin
 * tener el paquete entero en memoria. Lo único que se guarda aquí es una
 * ficha por entrada (nombre, CRC, tamaño, desplazamiento), que para diez
 * mil ficheros son unos cientos de kilobytes.
 */
export class Zip {
  private readonly entradas: EntradaEscrita[] = [];
  private escrito = 0;
  private cerrado = false;

  /**
   * Una entrada. `fecha` entra como parámetro y no se lee del reloj aquí:
   * el mismo paquete exportado dos veces con la misma fecha tiene que dar
   * los mismos bytes, y eso es lo que permite que un test lo compruebe.
   */
  anadir(nombre: string, contenido: Buffer, fecha: Date): Buffer {
    if (this.cerrado) throw new Error("el zip ya está cerrado");
    const nombreBuf = Buffer.from(nombre, "utf8");
    const crc = crc32(contenido) >>> 0;
    const { dosFecha, dosHora } = aDos(fecha);

    const cabecera = Buffer.alloc(30 + nombreBuf.length);
    cabecera.writeUInt32LE(FIRMA_LOCAL, 0);
    cabecera.writeUInt16LE(VERSION, 4);
    cabecera.writeUInt16LE(BANDERA_UTF8, 6);
    cabecera.writeUInt16LE(METODO_STORE, 8);
    cabecera.writeUInt16LE(dosHora, 10);
    cabecera.writeUInt16LE(dosFecha, 12);
    cabecera.writeUInt32LE(crc, 14);
    // Comprimido y sin comprimir son el MISMO número con «store». Es la
    // mitad de por qué este formato cabe en un fichero.
    cabecera.writeUInt32LE(contenido.length, 18);
    cabecera.writeUInt32LE(contenido.length, 22);
    cabecera.writeUInt16LE(nombreBuf.length, 26);
    cabecera.writeUInt16LE(0, 28); // sin «extra»
    nombreBuf.copy(cabecera, 30);

    this.entradas.push({
      nombre: nombreBuf,
      crc,
      tamano: contenido.length,
      desplazamiento: this.escrito,
      fecha: dosFecha,
      hora: dosHora,
    });
    this.escrito += cabecera.length + contenido.length;
    return Buffer.concat([cabecera, contenido]);
  }

  /** El directorio central y el cierre. Después de esto no se añade más. */
  cerrar(): Buffer {
    if (this.cerrado) throw new Error("el zip ya está cerrado");
    this.cerrado = true;

    const trozos: Buffer[] = [];
    for (const e of this.entradas) {
      if (e.desplazamiento > MAXIMO_DEL_ZIP) {
        throw new ZipDemasiadoGrande(this.escrito);
      }
      const c = Buffer.alloc(46 + e.nombre.length);
      c.writeUInt32LE(FIRMA_CENTRAL, 0);
      c.writeUInt16LE(VERSION, 4); // hecho por
      c.writeUInt16LE(VERSION, 6); // hace falta
      c.writeUInt16LE(BANDERA_UTF8, 8);
      c.writeUInt16LE(METODO_STORE, 10);
      c.writeUInt16LE(e.hora, 12);
      c.writeUInt16LE(e.fecha, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.tamano, 20);
      c.writeUInt32LE(e.tamano, 24);
      c.writeUInt16LE(e.nombre.length, 28);
      c.writeUInt16LE(0, 30); // extra
      c.writeUInt16LE(0, 32); // comentario
      c.writeUInt16LE(0, 34); // disco
      c.writeUInt16LE(0, 36); // atributos internos
      c.writeUInt32LE(0, 38); // atributos externos
      c.writeUInt32LE(e.desplazamiento, 42);
      e.nombre.copy(c, 46);
      trozos.push(c);
    }

    const tamanoDirectorio = trozos.reduce((n, t) => n + t.length, 0);
    const desplazamientoDirectorio = this.escrito;
    if (desplazamientoDirectorio + tamanoDirectorio > MAXIMO_DEL_ZIP) {
      throw new ZipDemasiadoGrande(desplazamientoDirectorio + tamanoDirectorio);
    }

    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(FIRMA_FINAL, 0);
    fin.writeUInt16LE(0, 4); // este disco
    fin.writeUInt16LE(0, 6); // disco del directorio
    fin.writeUInt16LE(this.entradas.length, 8);
    fin.writeUInt16LE(this.entradas.length, 10);
    fin.writeUInt32LE(tamanoDirectorio, 12);
    fin.writeUInt32LE(desplazamientoDirectorio, 16);
    fin.writeUInt16LE(0, 20); // sin comentario
    trozos.push(fin);
    return Buffer.concat(trozos);
  }

  /** Cuántas entradas lleva. Para el log y para el test. */
  get cuantas(): number {
    return this.entradas.length;
  }

  /** Cuántos bytes de datos van escritos (sin el directorio). */
  get bytes(): number {
    return this.escrito;
  }
}

/** La fecha y la hora en el formato de MS-DOS, que es el que el ZIP usa
 *  desde 1989. Resolución de dos segundos y el año desde 1980; con fechas
 *  anteriores a 1980 se queda en 1980, que es lo que cualquier
 *  descompresor espera ver. */
function aDos(fecha: Date): { dosFecha: number; dosHora: number } {
  const ano = Math.max(1980, fecha.getFullYear());
  return {
    dosFecha:
      ((ano - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate(),
    dosHora:
      (fecha.getHours() << 11) |
      (fecha.getMinutes() << 5) |
      Math.floor(fecha.getSeconds() / 2),
  };
}

/**
 * Un nombre de fichero que vale dentro de un ZIP y en los tres sistemas.
 *
 * Fuera: las barras invertidas, los dos puntos, los que Windows prohíbe
 * (`* ? " < > |`), los de control y los `..`. La barra normal SÍ se deja
 * —es el separador de carpetas del ZIP— y los espacios también: valen en
 * los tres sistemas, y «Rodríguez Gómez, Carmen» se lee mejor que
 * «Rodríguez-Gómez--Carmen».
 *
 * Importa más de lo que parece. Los nombres de este paquete llevan el del
 * paciente («Rodríguez Gómez, Carmen/historia.pdf»), y un paciente que se
 * llamara «../otra-clínica» no puede escribir fuera de su carpeta.
 */
export function nombreSeguroEnZip(nombre: string): string {
  return nombre
    // ── Y LAS TILDES FUERA, que no es cosmético ───────────────────────
    //
    // El `unzip` de macOS (Info-ZIP 6.0, de 2009) **no entiende el bit de
    // UTF-8** y se niega a crear una carpeta con tildes: «illegal byte
    // sequence». Se comprobó con el `unzip` de este Mac, y el paquete
    // estaba bien —`unzip -t` da «No errors detected»— pero no se podía
    // extraer con la herramienta que cualquiera tiene a mano.
    //
    // Este paquete lo abre la dueña y, si hace falta, un abogado. Que se
    // abra con lo que haya instalado vale más que una tilde en el nombre
    // de una carpeta. **El nombre exacto, con sus tildes, está dentro**:
    // en el JSON y en la cabecera de cada PDF.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    // Lo que Windows prohíbe, los de control y los `..`. La barra normal
    // se deja: es el separador de carpetas del ZIP.
    .replace(/[\\:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^\/+/, "")
    // Lo que quede sin pasar por el ASCII imprimible, fuera. Un nombre
    // chino o cirílico se queda en guiones, y el JSON lo dice entero.
    .replace(/[^\x20-\x7e/]/g, "-")
    .slice(0, 180);
}
