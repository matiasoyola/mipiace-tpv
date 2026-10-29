// cogecop-1 · EL GENERADOR DE DATOS FALSOS CON LA FORMA DE COGECOP.
//
// **Ni un registro real entra en el repo.** Ni en un test, ni en un log,
// ni en un `-done`. Lo que los tests importan es esto: un export entero
// con la misma forma que el de verdad, inventado aquí y con semilla, así
// que dos ejecuciones dan exactamente lo mismo.
//
// Que la forma sea la MISMA no es un acto de fe: `export-esquema.ts` es
// el único sitio donde está escrita, el importador lee con él y un test
// pasa lo que sale de aquí por él. El día que la copia de la segunda
// clínica traiga una columna más, el esquema la pide y el generador deja
// de cuadrar — que es justo cuando hay que enterarse.
//
// ── LOS CENTINELAS ───────────────────────────────────────────────────
//
// Todo lo que en la copia de verdad sería un dato de persona —nombre,
// apellidos, teléfono, domicilio, NIF, enfermedades, alergias,
// comentarios, los textos de cada visita— lo escribe este fichero con una
// marca dentro (`ß`-algo). `centinelasDe()` los devuelve todos, y un test
// exige que **ninguno** aparezca en la salida del script.
//
// Es la forma de probar «el `--dry-run` no imprime ni un nombre» sin
// tener que confiar en leerlo: si mañana alguien añade un `console.log`
// con el nombre del paciente para depurar, ese test se pone rojo.
//
// ── Y por qué el generador vive en `src/` y no en `test/` ────────────
//
// Porque lo usan los dos lados: el test unitario del importador y el e2e
// que corre contra Postgres. Un generador en `test/` no lo puede importar
// `test-e2e/` sin una ruta relativa que cruza carpetas, y duplicarlo
// serían dos formas que un día dejan de ser la misma.

import type {
  ExportDeCogecop,
  FilaDeCatalogo,
  Marca,
  Paciente,
  PacienteEspecialista,
  Personal,
  TratamientoDeVisita,
  Visita,
} from "./export-esquema.js";

/** El trozo que llevan dentro todos los valores inventados que, en la
 *  copia de verdad, serían datos de una persona. La `ß` no sale en
 *  ningún texto de la casa, así que buscarla en una salida no da falsos
 *  positivos. */
export const MARCA_DEL_CENTINELA = "ß";

/** Un azar con semilla. Dos llamadas con la misma semilla dan lo mismo,
 *  que es lo que hace que un test pueda afirmar un recuento exacto. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OpcionesDelGenerador {
  semilla?: number;
  /** Cuántos pacientes. Los casos raros de abajo se reparten entre los
   *  primeros, así que con menos de 6 no salen todos. */
  pacientes?: number;
  /** Cuántas visitas por paciente, como mucho. */
  visitasPorPaciente?: number;
}

/** Lo que el generador devuelve: el export y la lista de centinelas. */
export interface ExportFalso {
  export: ExportDeCogecop;
  /** Todos los valores «de persona» que se han escrito dentro. */
  centinelas: string[];
}

/** El catálogo de patologías del Colegio. Son las mismas 144 de verdad
 *  (es catálogo público, no dato de nadie), pero aquí basta con las que
 *  los tests usan: una que traduce de cada clase y dos que no. */
const PATOLOGIAS_DEL_FALSO: Array<[number, string]> = [
  [1, "Hiperqueratosis"],
  [6, "Heloma duro"],
  [113, "Onicigrifosis"],
  [115, "Onicocriptosis"],
  [103, "Onicomicosis"],
  [79, "Xerosis"],
  [117, "Hematoma subungueal"],
  // Las dos que NO se traducen: la marca entra igual, con su nombre.
  [44, "Carcinoma basocelular"],
  [129, "Eritrasma"],
];

const TRATAMIENTOS_DEL_FALSO: Array<[number, string]> = [
  [3, "Q1 QUIROPODIA BASICA"],
  [4, "Q2 QUIROPODIA COMPLETA"],
  [6, "CURA"],
  [11, "CONSULTA DIAGNÓSTICO"],
];

/** Los centros de grupo del dibujo 0 y del 2 que el generador usa para
 *  poner marcas «en el centro de su dedo». Son los mismos que
 *  `CENTROIDES_COGECOP`, escritos aquí a mano a propósito: si el
 *  generador los importara, el test «una marca en el centro de un grupo
 *  cae en su dedo» estaría comparando la tabla consigo misma. */
const CENTROS_DEL_FALSO: Array<{ dibujo: number; x: number; y: number }> = [
  { dibujo: 0, x: 136, y: 22 }, // mitad A, dedo gordo
  { dibujo: 0, x: 44, y: 66 }, // mitad A, 5.º dedo
  { dibujo: 0, x: 220, y: 28 }, // mitad B, dedo gordo
  { dibujo: 2, x: 83, y: 88 }, // mitad A, bajo el 2.º
  { dibujo: 2, x: 147, y: 253 }, // mitad A, talón
  { dibujo: 2, x: 283, y: 90 }, // mitad B, bajo el 2.º
];

/** Y un sitio que no está cerca de nada: el hueco entre las dos plantas.
 *  La marca entra con su nombre y sin zona. */
const SITIO_SIN_ZONA = { dibujo: 2, x: 183, y: 215 };

function iso(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}T00:00:00`;
}

/**
 * Un export entero con la forma de COGECOP.
 *
 * Los casos raros están puestos a mano en los primeros pacientes, para
 * que un test pueda nombrarlos sin buscarlos:
 *
 *   · paciente 1 · completo, con enfermedades y alergias;
 *   · paciente 2 · fecha de nacimiento imposible (año 1356);
 *   · paciente 3 · difunto;
 *   · paciente 4 · sin ningún teléfono utilizable (el campo lleva el
 *     nombre de un familiar, como pasa de verdad);
 *   · paciente 5 · sin enfermedades, sin alergias y sin comentarios: su
 *     ficha NO tiene que llevar nota de COGECOP;
 *   · paciente 6 · con una visita de cirugía y otra de biomecánica.
 */
export function generarExport(
  opciones: OpcionesDelGenerador = {},
): ExportFalso {
  const rnd = azar(opciones.semilla ?? 7);
  const nPacientes = opciones.pacientes ?? 8;
  const maxVisitas = opciones.visitasPorPaciente ?? 3;
  const centinelas: string[] = [];

  /** Un valor «de persona». Se apunta como centinela al crearlo, así que
   *  no hay forma de inventar uno y olvidarse de apuntarlo. */
  const dato = (texto: string): string => {
    const v = `${texto}${MARCA_DEL_CENTINELA}`;
    centinelas.push(v);
    return v;
  };

  const pacientes: Paciente[] = [];
  const visitas: Visita[] = [];
  const marcas: Marca[] = [];
  const tratamientosVisita: TratamientoDeVisita[] = [];
  const pacienteEspecialista: PacienteEspecialista[] = [];

  let idVisita = 100;
  let idMarca = 1000;
  let idTrat = 5000;

  for (let i = 1; i <= nPacientes; i++) {
    // Los ids NO son correlativos en la copia de verdad (empiezan en 5 y
    // tienen huecos), así que aquí tampoco.
    const id = 4 + i * 3;
    const difunto = i === 3 ? 1 : 0;
    const vacio = i === 5;

    const nacimiento =
      i === 2 ? iso(1356, 4, 2) : i === 7 ? null : iso(1940 + i, (i % 12) + 1, 10);

    pacientes.push({
      id,
      nombre: dato(`Nombre${i}`),
      apellidos: dato(`Apellido${i} Segundo${i}`),
      nif: i === 1 ? dato(`1234567${i}Z`) : null,
      idtiponif: null,
      fechanacimiento: nacimiento,
      idsexo: (i % 2) + 1,
      domicilio: vacio ? null : dato(`Calle Inventada ${i}`),
      poblacion: vacio ? null : dato(`Pueblo${i}`),
      codigopostal: i === 4 ? dato("viven fuera") : "45600",
      provincia: "Toledo",
      pais: null,
      // El paciente 4 tiene el nombre de un familiar donde va el
      // teléfono. Pasa de verdad, y no se puede tirar.
      telefonocasa: i === 4 ? dato("hija Marisa") : null,
      telefonotrabajo: null,
      telefonomovil: i === 4 ? null : `6${String(10000000 + i).slice(-8)}`,
      email1: i === 1 ? dato(`paciente${i}@ejemplo.invalid`) : null,
      email2: null,
      lopd: i === 6 ? 0 : 1,
      historialantiguo: String(1000 + i),
      historial: id,
      primeravisita: i === 8 ? iso(8018, 1, 1) : iso(2025, 2, 6),
      ultimavisita: iso(2026, 10, 1),
      numvisitas: 1,
      enfermedades: vacio ? null : dato(`diabetes tipo ${i}`),
      alergias: vacio ? null : dato(`alergia a la cosa ${i}`),
      comentarios: vacio ? null : dato(`comentario largo\r\ncon dos líneas ${i}`),
      otrosdatos: vacio ? null : dato(`MED: pastilla ${i}`),
      alerta: i === 1 ? 1 : 0,
      idprofesion: i === 1 ? 7 : null,
      idformadepago: 1,
      difunto,
    });

    if (i <= 2) pacienteEspecialista.push({ idpaciente: id, idespecialista: i });

    const cuantas = 1 + Math.floor(rnd() * maxVisitas);
    for (let v = 0; v < cuantas; v++) {
      const vid = ++idVisita;
      const esCirugia = i === 6 && v === 0;
      const esBio = i === 6 && v === 1;
      const especialista = (v % 2) + 1;

      visitas.push({
        id: vid,
        idpaciente: id,
        fechavisita: iso(2025, 3 + (v % 9), 4 + v),
        quiropodia: esCirugia || esBio ? null : 1,
        qidespecialista: esCirugia || esBio ? null : especialista,
        motivovisitaquiro: esCirugia || esBio ? null : dato(`motivo ${i}-${v}`),
        evolucionquiro: esCirugia || esBio ? null : null,
        quiropodiadiagnostico:
          esCirugia || esBio ? null : dato(`diagnóstico ${i}-${v}`),
        quiropodiarecomendacion:
          esCirugia || esBio ? null : dato(`recomendación ${i}-${v}`),
        alertaquiro: esCirugia || esBio ? null : 0,
        cirugia: esCirugia ? 1 : null,
        cidespecialista: esCirugia ? 1 : null,
        motivovisitacirugia: esCirugia ? dato(`motivo cirugía ${i}`) : null,
        evolucioncirugia: null,
        cirugiadiagnostico: esCirugia ? dato(`dx cirugía ${i}`) : null,
        cirugiarecomendacion: null,
        alertacirugia: esCirugia ? 1 : null,
        biomecanica: esBio ? 1 : null,
        bidespecialista: esBio ? 2 : null,
        motivovisitabio: esBio ? dato(`motivo bio ${i}`) : null,
        evolucionbio: null,
        biomecanicadiagnostico: null,
        biomecanicarecomendacion: esBio ? dato(`plantillas ${i}`) : null,
        alertabio: esBio ? 0 : null,
        general: null,
      });

      tratamientosVisita.push({
        id: ++idTrat,
        idvisita: vid,
        idtratamiento: TRATAMIENTOS_DEL_FALSO[v % TRATAMIENTOS_DEL_FALSO.length]![0],
      });

      // Las marcas: una en el centro de un grupo (tiene que caer en su
      // dedo), y en la primera visita de cada paciente una más lejos de
      // todo y otra de una patología que no se traduce.
      const centro = CENTROS_DEL_FALSO[(i + v) % CENTROS_DEL_FALSO.length]!;
      const pat = PATOLOGIAS_DEL_FALSO[(i + v) % 7]!;
      marcas.push(marcaEn(++idMarca, vid, pat[0], centro));
      if (v === 0) {
        // Una dureza LEJOS de todo centro: entra con su lesión y sin
        // sitio en el mapa. Y dos patologías que no se traducen, una de
        // ellas en el centro de un dedo: entran con su nombre de
        // COGECOP y sin color.
        marcas.push(marcaEn(++idMarca, vid, 1, SITIO_SIN_ZONA));
        marcas.push(marcaEn(++idMarca, vid, 44, CENTROS_DEL_FALSO[0]!));
        marcas.push(marcaEn(++idMarca, vid, 129, CENTROS_DEL_FALSO[1]!));
      }
    }
  }

  return {
    export: {
      pacientes,
      visitas,
      marcas_pie: marcas,
      tratamientos_visita: tratamientosVisita,
      paciente_especialista: pacienteEspecialista,
      personal: personalDelFalso(dato),
      cat_tratamientos: catalogo("tratamiento", TRATAMIENTOS_DEL_FALSO),
      cat_patologias: PATOLOGIAS_DEL_FALSO.map(([id, patologia]) => ({
        id,
        patologia,
        nombreicono: `${patologia}.png`,
      })),
      cat_servicios: [{ id: 1, servicio: "QUIROPODIA", serviciodetalle: "" }],
      cat_formas_pago: [{ id: 1, formadepago: "EFECTIVO" }],
      cat_tipo_especialista: [{ id: 1, tipoespecialista: "TRAUMATÓLOGO" }],
      cat_profesion: [{ id: 7, descripcion: "Jubilado" }],
      cat_sexo: [
        { id: 1, sexo: "Hombre" },
        { id: 2, sexo: "Mujer" },
      ],
    },
    centinelas,
  };
}

function marcaEn(
  id: number,
  idvisita: number,
  patologia: number,
  centro: { dibujo: number; x: number; y: number },
): Marca {
  // La base guarda la ESQUINA del icono de 16×16, no su centro.
  const x1 = centro.x - 8;
  const y1 = centro.y - 8;
  return {
    id,
    idvisita,
    idquiropodiapatologia: patologia,
    idimagencolocada: centro.dibujo,
    x_1: x1,
    y_1: y1,
    x_2: x1 + 16,
    y_2: y1 + 16,
    fecha: null,
    curado: null,
  };
}

function personalDelFalso(dato: (s: string) => string): Personal[] {
  return [
    {
      id: 1,
      nombre: dato("Podóloga1"),
      apellidos: dato("ApellidoP1"),
      especialista: 1,
      numcolegiado: dato("111111111"),
      email: null,
      movil: null,
    },
    {
      id: 2,
      nombre: dato("Podóloga2"),
      apellidos: dato("ApellidoP2"),
      especialista: 1,
      numcolegiado: dato("222222222"),
      email: null,
      movil: null,
    },
  ];
}

function catalogo(
  columna: string,
  filas: Array<[number, string]>,
): FilaDeCatalogo[] {
  return filas.map(([id, valor]) => ({ id, [columna]: valor }));
}

/** Los centinelas de un export ya generado, por si quien lo tiene no
 *  guardó la pareja. */
export function centinelasDe(falso: ExportFalso): string[] {
  return falso.centinelas;
}
