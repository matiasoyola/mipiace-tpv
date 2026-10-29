// cogecop-1 · LA FORMA DEL EXPORT DE COGECOP, EN UN SITIO.
//
// La copia de una clínica llega como trece ficheros JSON UTF-8, uno por
// tabla de Firebird, cada uno con una lista de objetos. Este esquema dice
// qué columnas tiene cada uno y de qué tipo, **y lo comparten las dos
// piezas que tienen que estar de acuerdo**:
//
//   · el importador, que lee la copia de verdad;
//   · el generador de datos falsos, con el que corren los tests.
//
// Un test comprueba que lo que el generador produce pasa por este
// esquema. Sin eso, el generador se iría separando del formato real —y
// la primera vez que lo notaríamos sería corriendo el script contra los
// datos de una persona.
//
// ── POR QUÉ UN ESQUEMA Y NO «leer el JSON y ya» ──────────────────────
//
// Porque la copia la exporta otra persona con otra herramienta, y lo que
// no se puede es que un fichero con una columna renombrada entre a medias
// y deje 3.681 fichas con el teléfono en el campo del domicilio. El
// esquema PARA antes de escribir nada, y dice qué fichero y qué fila.
//
// ── Lo que el esquema NO hace ────────────────────────────────────────
//
// No valida que las fechas sean posibles, ni que los teléfonos sean
// teléfonos, ni que las referencias cuadren. Eso es trabajo del
// importador y sale en el informe de recuentos: una fecha de nacimiento
// del año 1356 es un dato de verdad que hay que meter (sin fecha) y
// contar, no un fichero roto. El esquema mira la FORMA.
//
// ── Y por qué `passthrough` ──────────────────────────────────────────
//
// Porque COGECOP tiene columnas que esta clínica no usa y la siguiente
// puede usar, y una columna de más no es motivo para no poder importar a
// nadie. Lo que no se admite es una columna que FALTA o que cambia de
// tipo: eso sí cambia lo que se escribe.

import { z } from "zod";

/** Un texto libre de COGECOP. Puede venir nulo o vacío. */
const texto = z.string().nullable();

/** Una fecha de Firebird, tal como sale al JSON: `2025-02-06T00:00:00` o
 *  con milisegundos. No se valida que sea POSIBLE — eso lo cuenta el
 *  importador, porque una fecha imposible es un dato, no un fichero
 *  roto. */
const fecha = z.string().nullable();

/** Un entero de COGECOP, que puede venir nulo. */
const entero = z.number().int().nullable();

export const PACIENTE = z
  .object({
    id: z.number().int(),
    nombre: z.string(),
    apellidos: z.string(),
    nif: texto,
    idtiponif: entero,
    fechanacimiento: fecha,
    idsexo: entero,
    domicilio: texto,
    poblacion: texto,
    codigopostal: texto,
    provincia: texto,
    pais: texto,
    telefonocasa: texto,
    telefonotrabajo: texto,
    telefonomovil: texto,
    email1: texto,
    email2: texto,
    /** 0 / 1. 63 de los 3.681 de Rosario están a 0. */
    lopd: z.number().int(),
    historialantiguo: texto,
    historial: z.number().int(),
    primeravisita: fecha,
    ultimavisita: fecha,
    numvisitas: z.number().int(),
    enfermedades: texto,
    alergias: texto,
    comentarios: texto,
    otrosdatos: texto,
    /** 0 / 1. La casilla roja de la ficha. */
    alerta: z.number().int(),
    idprofesion: entero,
    idformadepago: entero,
    /** 0 / 1. Entran igual: es historia clínica. */
    difunto: z.number().int(),
  })
  .passthrough();

/**
 * Una visita. COGECOP tiene CUATRO pestañas en la misma fila —quiropodia,
 * cirugía, biomecánica y general— y cada una con sus textos, su
 * especialista y su alerta.
 *
 * Una pestaña se usó cuando su bandera **no es nula**. Esa es la
 * semántica del programa y no «cuando vale 1»: en la copia de Rosario hay
 * una fila con `general = 0`, y un 0 ahí significa que la pestaña se
 * abrió, no que no.
 */
export const VISITA = z
  .object({
    id: z.number().int(),
    idpaciente: z.number().int(),
    fechavisita: z.string(),

    quiropodia: entero,
    qidespecialista: entero,
    motivovisitaquiro: texto,
    evolucionquiro: texto,
    quiropodiadiagnostico: texto,
    quiropodiarecomendacion: texto,
    alertaquiro: entero,

    cirugia: entero,
    cidespecialista: entero,
    motivovisitacirugia: texto,
    evolucioncirugia: texto,
    cirugiadiagnostico: texto,
    cirugiarecomendacion: texto,
    alertacirugia: entero,

    biomecanica: entero,
    bidespecialista: entero,
    motivovisitabio: texto,
    evolucionbio: texto,
    biomecanicadiagnostico: texto,
    biomecanicarecomendacion: texto,
    alertabio: entero,

    general: entero,
  })
  .passthrough();

/**
 * Una marca del mapa del pie: un icono de 16×16 px sobre uno de los tres
 * dibujos. `x_1`/`y_1` son la esquina de arriba a la izquierda.
 *
 * `curado` viene nulo en 51.662 de las 52.003 marcas de Rosario. `null`
 * es «no lo dijo», que no es «no».
 */
export const MARCA = z
  .object({
    id: z.number().int(),
    idvisita: z.number().int(),
    idquiropodiapatologia: z.number().int(),
    /** El dibujo: 0 (las uñas), 2 (las plantas) o 3. */
    idimagencolocada: z.number().int(),
    x_1: z.number().int(),
    y_1: z.number().int(),
    x_2: z.number().int(),
    y_2: z.number().int(),
    fecha: fecha,
    curado: entero,
  })
  .passthrough();

export const TRATAMIENTO_DE_VISITA = z
  .object({
    id: z.number().int(),
    idvisita: z.number().int(),
    idtratamiento: z.number().int(),
  })
  .passthrough();

export const PACIENTE_ESPECIALISTA = z
  .object({
    idpaciente: z.number().int(),
    idespecialista: z.number().int(),
  })
  .passthrough();

export const PERSONAL = z
  .object({
    id: z.number().int(),
    nombre: z.string(),
    apellidos: z.string(),
    especialista: entero,
    numcolegiado: texto,
    email: texto,
    movil: texto,
  })
  .passthrough();

/** Los catálogos. Todos tienen la misma forma —id + una columna de
 *  texto— y lo único que cambia es cómo se llama esa columna. */
const catalogo = (columna: string) =>
  z
    .object({ id: z.number().int() })
    .catchall(z.unknown())
    .refine((x) => typeof (x as Record<string, unknown>)[columna] === "string", {
      message: `falta la columna «${columna}»`,
    });

export const CAT_TRATAMIENTOS = catalogo("tratamiento");
export const CAT_PATOLOGIAS = catalogo("patologia");
export const CAT_SERVICIOS = catalogo("servicio");
export const CAT_FORMAS_PAGO = catalogo("formadepago");
export const CAT_TIPO_ESPECIALISTA = catalogo("tipoespecialista");
export const CAT_PROFESION = catalogo("descripcion");
export const CAT_SEXO = catalogo("sexo");

/**
 * Los trece ficheros, con el nombre con el que llegan (sin `.json`) y su
 * esquema de fila.
 *
 * `obligatorio: false` para los catálogos que sólo sirven para poner
 * nombres bonitos en la nota de la ficha: si faltara `cat_profesion`, lo
 * que pasa es que la nota dice «Profesión: nº 7» en vez del nombre, y eso
 * no es motivo para no poder importar a nadie. Los seis obligatorios son
 * los que, si faltan, dejan la historia incompleta sin decirlo.
 */
export interface FicheroDelExport {
  nombre: string;
  fila: z.ZodTypeAny;
  /** `false` = si falta, la importación sigue. Ver arriba. */
  obligatorio: boolean;
}

export const FICHEROS_DEL_EXPORT: readonly FicheroDelExport[] = [
  { nombre: "pacientes", fila: PACIENTE, obligatorio: true },
  { nombre: "visitas", fila: VISITA, obligatorio: true },
  { nombre: "marcas_pie", fila: MARCA, obligatorio: true },
  { nombre: "tratamientos_visita", fila: TRATAMIENTO_DE_VISITA, obligatorio: true },
  { nombre: "cat_tratamientos", fila: CAT_TRATAMIENTOS, obligatorio: true },
  { nombre: "cat_patologias", fila: CAT_PATOLOGIAS, obligatorio: true },
  { nombre: "personal", fila: PERSONAL, obligatorio: true },
  {
    nombre: "paciente_especialista",
    fila: PACIENTE_ESPECIALISTA,
    obligatorio: false,
  },
  { nombre: "cat_servicios", fila: CAT_SERVICIOS, obligatorio: false },
  { nombre: "cat_formas_pago", fila: CAT_FORMAS_PAGO, obligatorio: false },
  {
    nombre: "cat_tipo_especialista",
    fila: CAT_TIPO_ESPECIALISTA,
    obligatorio: false,
  },
  { nombre: "cat_profesion", fila: CAT_PROFESION, obligatorio: false },
  { nombre: "cat_sexo", fila: CAT_SEXO, obligatorio: false },
];

export type Paciente = z.infer<typeof PACIENTE>;
export type Visita = z.infer<typeof VISITA>;
export type Marca = z.infer<typeof MARCA>;
export type TratamientoDeVisita = z.infer<typeof TRATAMIENTO_DE_VISITA>;
export type PacienteEspecialista = z.infer<typeof PACIENTE_ESPECIALISTA>;
export type Personal = z.infer<typeof PERSONAL>;
export type FilaDeCatalogo = { id: number } & Record<string, unknown>;

/** El export entero, ya leído y validado. */
export interface ExportDeCogecop {
  pacientes: Paciente[];
  visitas: Visita[];
  marcas_pie: Marca[];
  tratamientos_visita: TratamientoDeVisita[];
  paciente_especialista: PacienteEspecialista[];
  personal: Personal[];
  cat_tratamientos: FilaDeCatalogo[];
  cat_patologias: FilaDeCatalogo[];
  cat_servicios: FilaDeCatalogo[];
  cat_formas_pago: FilaDeCatalogo[];
  cat_tipo_especialista: FilaDeCatalogo[];
  cat_profesion: FilaDeCatalogo[];
  cat_sexo: FilaDeCatalogo[];
}

/** Lo que se dice cuando un fichero no tiene la forma. Lleva el fichero y
 *  la fila, **y nunca el valor**: un mensaje de error de un importador de
 *  historias clínicas no puede llevar el dato de nadie ni a un log ni a
 *  una pantalla. */
export class ExportConOtraForma extends Error {
  constructor(
    readonly fichero: string,
    readonly fila: number,
    readonly detalle: string,
  ) {
    super(`${fichero}.json, fila ${fila}: ${detalle}`);
    this.name = "ExportConOtraForma";
  }
}

/**
 * Valida una lista de filas contra su esquema.
 *
 * El mensaje lleva la RUTA del campo que falla (`telefonomovil: expected
 * string, received number`) y no su valor, por lo de arriba.
 */
export function validarFilas(
  fichero: string,
  esquema: z.ZodTypeAny,
  filas: unknown,
): unknown[] {
  if (!Array.isArray(filas)) {
    throw new ExportConOtraForma(fichero, 0, "el fichero no es una lista");
  }
  const out: unknown[] = [];
  for (let i = 0; i < filas.length; i++) {
    const r = esquema.safeParse(filas[i]);
    if (!r.success) {
      const primero = r.error.issues[0];
      const ruta = primero?.path.join(".") || "(raíz)";
      throw new ExportConOtraForma(
        fichero,
        i + 1,
        `${ruta}: ${primero?.message ?? "no cuadra"}`,
      );
    }
    out.push(r.data);
  }
  return out;
}
