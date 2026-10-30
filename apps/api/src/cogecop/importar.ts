// cogecop-1 · EL IMPORTADOR. Lo que convierte la copia en historia.
//
// El script de `src/scripts/importar-cogecop.ts` es la línea de órdenes;
// esto es lo que hace el trabajo, y está separado por la razón de siempre
// con los scripts de esta casa: **un test lo puede importar sin que corra
// nada**, y el e2e lo llama contra Postgres de verdad.
//
// ── LAS CUATRO GARANTÍAS ─────────────────────────────────────────────
//
//   1. **IDEMPOTENTE.** El id del paciente es determinista (UUID v5 de
//      `cogecop:<tenantId>:paciente:<id>`, en `Client.externalId`) y cada
//      visita lleva su `cogecopId` dentro del cuerpo. Antes de escribir
//      las visitas de un paciente se leen las que ya tiene y se descartan
//      las que ya están. Correrlo dos veces no duplica nada; correrlo con
//      un export más nuevo mete sólo lo que falta.
//   2. **UNA TRANSACCIÓN POR PACIENTE.** Si se corta a la mitad, lo que
//      hay dentro es paciente entero o nada, y la siguiente pasada sigue
//      por donde iba. Un paciente son como mucho 33 visitas en la copia
//      de Rosario: la transacción es corta y no se pelea con nadie.
//   3. **EL `--dry-run` NO ESCRIBE.** No es un `if` al final: es que en
//      seco **no se abre ni una transacción**. Se hace toda la cuenta y
//      se tira.
//   4. **NI UN DATO DE PERSONA EN LA SALIDA.** Lo que sale son números y
//      nombres de CATÁLOGO (las patologías del Colegio). Ni un nombre, ni
//      un teléfono, ni un texto clínico, ni en el informe ni en un error.
//      Un test lo comprueba con centinelas.
//
// ── SIN PÉRDIDA ──────────────────────────────────────────────────────
//
// Decisión de Dirección. Lo que tiene columna propia en `Client` va a su
// columna; **todo lo demás que tenga contenido va cifrado a la nota de la
// ficha**, con su encabezado. Incluido lo que parece basura: un código
// postal que dice «viven fuera» y un teléfono que lleva el nombre de una
// hija son datos que alguien escribió sabiendo por qué.

import {
  type CuerpoImportado,
  type LateralidadDeCogecop,
  type MarcaImportada,
  type TipoImportado,
  esCuerpoImportado,
  lesionDePatologia,
  nombreDePatologia,
  notaDeCogecop,
  sitioDeLaMarca,
  versionesDeLaImportacion,
  type CampoDeLaNota,
} from "@mipiacetpv/clinica-sesion";
import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import { createHash } from "node:crypto";

import { dekDe } from "../clinica/claves.js";
import {
  cuerpoDeEntrada,
  cuerpoParaEntrada,
  esIlegible,
  nuevoIdDeFila,
} from "../clinica/cripto-campos.js";
import { notaParaGuardar } from "../clinica/notas.js";
import type {
  ExportDeCogecop,
  FilaDeCatalogo,
  Marca,
  Paciente,
  Visita,
} from "./export-esquema.js";

// ── El id determinista ────────────────────────────────────────────────
//
// UUID v5 (SHA-1 sobre un espacio de nombres), que es lo que hace que el
// mismo paciente de la misma clínica dé siempre el mismo uuid — en este
// portátil, en el VPS y dentro de tres años.
//
// El espacio de nombres es uno nuestro, fijo, y **el nombre lleva el
// tenant dentro**: `Client.externalId` es único GLOBAL (no por tenant),
// así que dos clínicas que vinieran de COGECOP con el paciente nº 12
// chocarían si el tenant no entrara en la cuenta.
//
// Se hace a mano y no con una librería porque la casa no tiene ninguna
// que haga v5, y son doce líneas que un test ata con un vector fijo.

/** El espacio de nombres de las importaciones de COGECOP. No se cambia
 *  nunca: cambiarlo sería no reconocer nada de lo ya importado. */
export const NAMESPACE_COGECOP = "1f2b9c40-2d1a-5a6e-9c3f-7b1e0a4d8c55";

function uuidV5(nombre: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1")
    .update(ns)
    .update(Buffer.from(nombre, "utf8"))
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // versión 5
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const hex = b.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** El `externalId` de un paciente de COGECOP en una cuenta. */
export function idExternoDePaciente(tenantId: string, idCogecop: number): string {
  return uuidV5(`cogecop:${tenantId}:paciente:${idCogecop}`, NAMESPACE_COGECOP);
}

// ── Los teléfonos ─────────────────────────────────────────────────────

/**
 * Un teléfono español en E.164, o `null` si lo que hay no es un teléfono.
 *
 * `null` **no tira el dato**: lo que no se puede normalizar se escribe en
 * la nota de la ficha, con su etiqueta. En la copia de Rosario hay
 * catorce campos de teléfono que llevan el nombre de un familiar («hija
 * Marisa»), y ése es el teléfono al que de verdad se llama.
 */
export function telefonoE164(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const mas = valor.trim().startsWith("+");
  const d = valor.replace(/\D/g, "");
  if (d === "") return null;
  if (mas && d.length >= 11) return `+${d}`;
  if (d.length === 9) return `+34${d}`;
  if (d.length === 11 && d.startsWith("34")) return `+${d}`;
  if (d.length === 13 && d.startsWith("0034")) return `+${d.slice(2)}`;
  return null;
}

// ── Las fechas ────────────────────────────────────────────────────────

/** El año más antiguo que admite una fecha de nacimiento. Por debajo es
 *  una errata de tecleo, no una persona. */
export const ANO_MINIMO = 1900;

/** Una fecha de COGECOP a `Date`, o `null` si es imposible.
 *  «Imposible» es: no parsea, o cae fuera de [1900, el día de hoy]. */
export function fechaValida(
  valor: string | null | undefined,
  hoy: Date,
): Date | null {
  if (valor == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (m == null) return null;
  const a = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (a < ANO_MINIMO || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(a, mes - 1, dia));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  if (d.getTime() > hoy.getTime()) return null;
  return d;
}

/** Cómo se escribe una fecha en la nota: dd/mm/aaaa si se puede leer, y
 *  tal cual si no (una fecha del año 8018 también es un dato). */
function fechaLegible(valor: string | null | undefined): string | null {
  if (valor == null || valor.trim() === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (m == null) return valor.trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ── El recuento ───────────────────────────────────────────────────────
//
// Lo ÚNICO que sale por pantalla. Números y nombres de catálogo.

export interface RecuentoDeImportacion {
  pacientes: { enElFichero: number; nuevos: number; yaEstaban: number };
  visitas: { enElFichero: number; nuevas: number; yaEstaban: number };
  marcas: { total: number; conZona: number; sinZona: number };
  /** Nombre de la patología del CATÁLOGO del Colegio → cuántas marcas
   *  suyas no tienen lesión nuestra. Es catálogo, no dato de nadie. */
  sinTraducir: Record<string, number>;
  /** Marcas cuya patología no está en el catálogo de 144. */
  patologiasDesconocidas: number;
  fechasImposibles: { nacimiento: number; otras: number };
  difuntos: number;
  sinTelefono: number;
  /** Visitas cuya pestaña no decía qué especialista la hizo: entran con
   *  la autora 1 y se cuentan, porque una historia clínica sin autor no
   *  es historia. */
  sinEspecialista: number;
  /** Visitas con texto en una pestaña que no es la suya. En la copia de
   *  Rosario son 0; si alguna vez no lo son, el texto se pega al final de
   *  la recomendación con su etiqueta y aquí se dice cuántas. */
  textoDeOtraPestana: number;
  /** Fichas que no llevan nota de COGECOP porque no había nada que
   *  escribir. */
  sinNota: number;
  porTipo: Record<TipoImportado, number>;
}

function recuentoVacio(): RecuentoDeImportacion {
  return {
    pacientes: { enElFichero: 0, nuevos: 0, yaEstaban: 0 },
    visitas: { enElFichero: 0, nuevas: 0, yaEstaban: 0 },
    marcas: { total: 0, conZona: 0, sinZona: 0 },
    sinTraducir: {},
    patologiasDesconocidas: 0,
    fechasImposibles: { nacimiento: 0, otras: 0 },
    difuntos: 0,
    sinTelefono: 0,
    sinEspecialista: 0,
    textoDeOtraPestana: 0,
    sinNota: 0,
    porTipo: { quiropodia: 0, cirugia: 0, biomecanica: 0, general: 0 },
  };
}

// ── Lo que el importador necesita saber ───────────────────────────────

export interface OpcionesDeImportacion {
  tenantId: string;
  lateralidad: LateralidadDeCogecop;
  /** El `User.id` de cada una de las dos especialistas de COGECOP. */
  autora1: string;
  autora2: string;
  /** `false` = seco: no se abre ni una transacción. */
  ejecutar: boolean;
  /** El día de la importación. Entra por la puerta: ni este fichero ni
   *  el paquete puro miran el reloj. */
  hoy: Date;
  /** Para ir diciendo por dónde va. Sólo recibe números. */
  avisar?: (linea: string) => void;
}

/** Lo que el importador se niega a hacer. */
export class NoSePuedeImportar extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "NoSePuedeImportar";
  }
}

// ── La traducción de una visita ───────────────────────────────────────

/** Las cuatro pestañas de COGECOP, en orden de prioridad. Una pestaña se
 *  usó cuando su bandera **no es nula** — ver `export-esquema.ts`. */
const PESTANAS: ReadonlyArray<{
  tipo: TipoImportado;
  bandera: keyof Visita;
  especialista: keyof Visita;
  motivo: keyof Visita;
  evolucion: keyof Visita;
  diagnostico: keyof Visita;
  recomendacion: keyof Visita;
  alerta: keyof Visita;
}> = [
  {
    tipo: "quiropodia",
    bandera: "quiropodia",
    especialista: "qidespecialista",
    motivo: "motivovisitaquiro",
    evolucion: "evolucionquiro",
    diagnostico: "quiropodiadiagnostico",
    recomendacion: "quiropodiarecomendacion",
    alerta: "alertaquiro",
  },
  {
    tipo: "cirugia",
    bandera: "cirugia",
    especialista: "cidespecialista",
    motivo: "motivovisitacirugia",
    evolucion: "evolucioncirugia",
    diagnostico: "cirugiadiagnostico",
    recomendacion: "cirugiarecomendacion",
    alerta: "alertacirugia",
  },
  {
    tipo: "biomecanica",
    bandera: "biomecanica",
    especialista: "bidespecialista",
    motivo: "motivovisitabio",
    evolucion: "evolucionbio",
    diagnostico: "biomecanicadiagnostico",
    recomendacion: "biomecanicarecomendacion",
    alerta: "alertabio",
  },
  {
    tipo: "general",
    bandera: "general",
    especialista: "general",
    motivo: "general",
    evolucion: "general",
    diagnostico: "general",
    recomendacion: "general",
    alerta: "general",
  },
];

const NOMBRE_DE_PESTANA: Record<TipoImportado, string> = {
  quiropodia: "quiropodia",
  cirugia: "cirugía",
  biomecanica: "biomecánica",
  general: "general",
};

function texto(v: Visita, k: keyof Visita): string | null {
  const x = v[k];
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t === "" ? null : t;
}

/** Qué clase de visita es, y qué pestaña manda. La primera cuya bandera
 *  no sea nula; `general` si ninguna lo dice (no existe en la copia de
 *  Rosario, pero una visita sin clase sigue siendo una visita). */
export function pestanaDeLaVisita(v: Visita): (typeof PESTANAS)[number] {
  for (const p of PESTANAS) {
    if (v[p.bandera] != null) return p;
  }
  return PESTANAS[3]!;
}

/** El cuerpo de una visita importada, ya traducido. */
export function cuerpoDeLaVisita(input: {
  visita: Visita;
  marcas: readonly Marca[];
  tratamientos: readonly string[];
  lateralidad: LateralidadDeCogecop;
  recuento: RecuentoDeImportacion;
}): CuerpoImportado {
  const { visita, recuento } = input;
  const p = pestanaDeLaVisita(visita);

  let recomendacion = texto(visita, p.recomendacion);
  // Sin pérdida: si OTRA pestaña tiene texto, se pega al final con su
  // etiqueta en vez de quedarse fuera. En la copia de Rosario esto no
  // pasa nunca, y el recuento lo dice.
  const sobrantes: string[] = [];
  for (const otra of PESTANAS) {
    if (otra.tipo === p.tipo) continue;
    for (const campo of [
      otra.motivo,
      otra.evolucion,
      otra.diagnostico,
      otra.recomendacion,
    ]) {
      if (campo === "general") continue;
      const t = texto(visita, campo);
      if (t != null) sobrantes.push(`[${NOMBRE_DE_PESTANA[otra.tipo]}] ${t}`);
    }
  }
  if (sobrantes.length > 0) {
    recuento.textoDeOtraPestana += 1;
    recomendacion = [recomendacion, ...sobrantes].filter(Boolean).join("\n");
  }

  const marcas: MarcaImportada[] = [];
  for (const m of input.marcas) {
    recuento.marcas.total += 1;
    const sitio = sitioDeLaMarca({
      dibujo: m.idimagencolocada,
      x1: m.x_1,
      y1: m.y_1,
      lateralidad: input.lateralidad,
    });
    if (sitio.zona == null) recuento.marcas.sinZona += 1;
    else recuento.marcas.conZona += 1;

    const nombre = nombreDePatologia(m.idquiropodiapatologia);
    if (nombre == null) recuento.patologiasDesconocidas += 1;
    const lesion = lesionDePatologia(m.idquiropodiapatologia);
    const lesionOriginal =
      nombre ?? `Patología ${m.idquiropodiapatologia} de COGECOP`;
    if (lesion == null) {
      recuento.sinTraducir[lesionOriginal] =
        (recuento.sinTraducir[lesionOriginal] ?? 0) + 1;
    }
    marcas.push({
      dibujo: m.idimagencolocada,
      pie: sitio.pie,
      zona: sitio.zona,
      lesion,
      lesionOriginal,
      curado: m.curado == null ? null : m.curado === 1,
    });
  }

  recuento.porTipo[p.tipo] += 1;

  return {
    origen: "cogecop",
    cogecopId: visita.id,
    tipo: p.tipo,
    motivo: texto(visita, p.motivo),
    evolucion: texto(visita, p.evolucion),
    diagnostico: texto(visita, p.diagnostico),
    recomendacion,
    alerta: visita[p.alerta] === 1,
    tratamientos: input.tratamientos,
    marcas,
    ...versionesDeLaImportacion(),
  };
}

/** Quién firma una visita: la autora de su especialista. Sin
 *  especialista, la 1 — y se cuenta. */
function autoraDe(
  v: Visita,
  o: OpcionesDeImportacion,
  recuento: RecuentoDeImportacion,
): string {
  const p = pestanaDeLaVisita(v);
  const id = p.especialista === "general" ? null : v[p.especialista];
  if (id === 1) return o.autora1;
  if (id === 2) return o.autora2;
  recuento.sinEspecialista += 1;
  return o.autora1;
}

// ── La ficha ──────────────────────────────────────────────────────────

function nombreDeCatalogo(
  filas: readonly FilaDeCatalogo[],
  columna: string,
  id: number | null | undefined,
): string | null {
  if (id == null) return null;
  const fila = filas.find((f) => f.id === id);
  const v = fila?.[columna];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : `nº ${id}`;
}

/** Los campos de la nota de una ficha. Todo lo que no tiene columna
 *  propia en `Client` y tiene algo escrito. */
export function camposDeLaNota(input: {
  paciente: Paciente;
  datos: ExportDeCogecop;
  /** El que se ha usado como `Client.phone`, para no repetirlo. */
  telefonoUsado: string | null;
  nacimientoValido: boolean;
}): Partial<Record<CampoDeLaNota, string | null>> {
  const p = input.paciente;
  const d = input.datos;

  const otrosTelefonos: string[] = [];
  for (const [etiqueta, campo] of [
    ["móvil", p.telefonomovil],
    ["casa", p.telefonocasa],
    ["trabajo", p.telefonotrabajo],
  ] as const) {
    const bruto = campo?.trim();
    if (!bruto) continue;
    if (input.telefonoUsado != null && telefonoE164(bruto) === input.telefonoUsado) {
      continue;
    }
    otrosTelefonos.push(`${etiqueta}: ${bruto}`);
  }

  const especialistas = d.paciente_especialista
    .filter((x) => x.idpaciente === p.id)
    .map((x) => {
      const quien = d.personal.find((y) => y.id === x.idespecialista);
      const nombre = quien
        ? `${quien.nombre} ${quien.apellidos}`.trim()
        : "sin nombre en el fichero";
      return `${nombre} (nº ${x.idespecialista})`;
    });

  return {
    Enfermedades: p.enfermedades,
    Alergias: p.alergias,
    Comentarios: p.comentarios,
    "Otros datos": p.otrosdatos,
    Alerta: p.alerta === 1 ? "Sí, marcada en COGECOP" : null,
    Difunto:
      p.difunto === 1
        ? "Sí. No se le manda ningún aviso ni recordatorio."
        : null,
    "Nº de historial antiguo": p.historialantiguo,
    "Nº en COGECOP": String(p.historial),
    NIF: p.nif,
    Sexo: nombreDeCatalogo(d.cat_sexo, "sexo", p.idsexo),
    Profesión: nombreDeCatalogo(d.cat_profesion, "descripcion", p.idprofesion),
    Domicilio: p.domicilio,
    Población: p.poblacion,
    "Código postal": p.codigopostal,
    Provincia: p.provincia,
    País: p.pais,
    "Otros teléfonos": otrosTelefonos.join(" · ") || null,
    "Otro email": p.email2,
    "Forma de pago": nombreDeCatalogo(
      d.cat_formas_pago,
      "formadepago",
      p.idformadepago,
    ),
    LOPD: p.lopd === 1 ? "Firmada" : "NO consta firmada",
    "Fecha de nacimiento no válida": input.nacimientoValido
      ? null
      : fechaLegible(p.fechanacimiento),
    "Primera visita": fechaLegible(p.primeravisita),
    "Última visita": fechaLegible(p.ultimavisita),
    "Visitas en COGECOP": String(p.numvisitas),
    Especialista: especialistas.join(" · ") || null,
  };
}

// ── La importación ────────────────────────────────────────────────────

const SELECT_IMPORTADA = {
  id: true,
  tenantId: true,
  body: true,
  bodyCifrado: true,
} satisfies Prisma.ClinicalEntrySelect;

/**
 * Importa la copia entera.
 *
 * Se niega —y no escribe nada— si la cuenta no es de vertical clínica, si
 * no tiene clave clínica, o si alguna de las dos autoras no es una
 * usuaria de la cuenta. Las tres antes de tocar la primera ficha: un
 * importador que se para a la mitad porque la autora 2 no existe deja
 * media clínica firmada por la 1.
 */
export async function importarCogecop(
  prisma: PrismaClient,
  datos: ExportDeCogecop,
  opciones: OpcionesDeImportacion,
): Promise<RecuentoDeImportacion> {
  const avisar = opciones.avisar ?? (() => {});
  const recuento = recuentoVacio();

  const tenant = await prisma.tenant.findUnique({
    where: { id: opciones.tenantId },
    select: { id: true, clinicalRecordsEnabled: true },
  });
  if (tenant == null) {
    throw new NoSePuedeImportar("esa cuenta no existe");
  }
  if (tenant.clinicalRecordsEnabled !== true) {
    throw new NoSePuedeImportar(
      "esa cuenta no tiene la historia clínica encendida: lo importado no tendría dónde vivir ni con qué cifrarse",
    );
  }
  // Tira `SinClaveTodavia` si la clínica no tiene DEK. Se pide ANTES de
  // escribir nada, por lo mismo.
  await dekDe(opciones.tenantId, prisma);

  for (const [etiqueta, userId] of [
    ["--autora-1", opciones.autora1],
    ["--autora-2", opciones.autora2],
  ] as const) {
    const u = await prisma.user.findFirst({
      where: { id: userId, tenantId: opciones.tenantId },
      select: { id: true },
    });
    if (u == null) {
      throw new NoSePuedeImportar(
        `${etiqueta} no es una usuaria de esta cuenta`,
      );
    }
  }

  // Los índices en memoria. Son 52.003 marcas: buscarlas con `filter` por
  // cada una de las 9.569 visitas sería medio millón de recorridos.
  const visitasPorPaciente = new Map<number, Visita[]>();
  for (const v of datos.visitas) {
    const lista = visitasPorPaciente.get(v.idpaciente) ?? [];
    lista.push(v);
    visitasPorPaciente.set(v.idpaciente, lista);
  }
  const marcasPorVisita = new Map<number, Marca[]>();
  for (const m of datos.marcas_pie) {
    const lista = marcasPorVisita.get(m.idvisita) ?? [];
    lista.push(m);
    marcasPorVisita.set(m.idvisita, lista);
  }
  const tratamientosPorVisita = new Map<number, string[]>();
  for (const t of datos.tratamientos_visita) {
    const nombre = nombreDeCatalogo(
      datos.cat_tratamientos,
      "tratamiento",
      t.idtratamiento,
    );
    if (nombre == null) continue;
    const lista = tratamientosPorVisita.get(t.idvisita) ?? [];
    lista.push(nombre);
    tratamientosPorVisita.set(t.idvisita, lista);
  }

  recuento.pacientes.enElFichero = datos.pacientes.length;
  recuento.visitas.enElFichero = datos.visitas.length;

  let hechos = 0;
  for (const paciente of datos.pacientes) {
    await importarUnPaciente(prisma, {
      paciente,
      datos,
      visitas: (visitasPorPaciente.get(paciente.id) ?? []).sort(
        (a, b) => a.id - b.id,
      ),
      marcasPorVisita,
      tratamientosPorVisita,
      opciones,
      recuento,
    });
    hechos += 1;
    // La PRIMERA también, y no sólo cada 250.
    //
    // Dos razones, y la segunda es la que lo puso aquí. La primera es de
    // uso: con una clínica de treinta fichas, «cada 250» no se imprime
    // nunca y el script parece colgado. La segunda la encontró un
    // sabotaje — meter el nombre del paciente en esta línea y ver qué
    // test se pone rojo: **ninguno**, porque el e2e corre con ocho
    // fichas y esta línea no llegaba a ejecutarse. Un centinela que
    // vigila una línea que no se ejecuta no vigila nada.
    if (hechos === 1 || hechos % 250 === 0) {
      avisar(`  … ${hechos} / ${datos.pacientes.length} fichas`);
    }
  }

  return recuento;
}

interface UnPaciente {
  paciente: Paciente;
  datos: ExportDeCogecop;
  visitas: Visita[];
  marcasPorVisita: Map<number, Marca[]>;
  tratamientosPorVisita: Map<number, string[]>;
  opciones: OpcionesDeImportacion;
  recuento: RecuentoDeImportacion;
}

async function importarUnPaciente(
  prisma: PrismaClient,
  ctx: UnPaciente,
): Promise<void> {
  const { paciente, opciones, recuento } = ctx;
  const tenantId = opciones.tenantId;
  const externalId = idExternoDePaciente(tenantId, paciente.id);

  const nacimiento = fechaValida(paciente.fechanacimiento, opciones.hoy);
  if (paciente.fechanacimiento != null && nacimiento == null) {
    recuento.fechasImposibles.nacimiento += 1;
  }
  for (const otra of [paciente.primeravisita, paciente.ultimavisita]) {
    if (otra != null && fechaValida(otra, opciones.hoy) == null) {
      recuento.fechasImposibles.otras += 1;
    }
  }
  if (paciente.difunto === 1) recuento.difuntos += 1;

  const telefono =
    telefonoE164(paciente.telefonomovil) ??
    telefonoE164(paciente.telefonocasa) ??
    telefonoE164(paciente.telefonotrabajo);
  if (telefono == null) recuento.sinTelefono += 1;

  const existente = await prisma.client.findFirst({
    where: { externalId, tenantId },
    select: { id: true },
  });
  if (existente == null) recuento.pacientes.nuevos += 1;
  else recuento.pacientes.yaEstaban += 1;

  // Qué visitas suyas ya entraron. Hay que DESCIFRAR para saberlo: el
  // `cogecopId` vive dentro del cuerpo, que es donde tiene que vivir
  // (una columna en claro con el id del paciente en otro programa es un
  // identificador más de los que no hacen falta).
  const yaImportadas = new Set<number>();
  if (existente != null) {
    const dek = await dekDe(tenantId, prisma);
    const filas = await prisma.clinicalEntry.findMany({
      where: { tenantId, clientId: existente.id, kind: "IMPORTED_VISIT" },
      select: SELECT_IMPORTADA,
    });
    for (const f of filas) {
      const cuerpo = cuerpoDeEntrada(f, dek);
      if (esIlegible(cuerpo) || !esCuerpoImportado(cuerpo)) continue;
      yaImportadas.add(cuerpo.cogecopId);
    }
  }

  // La traducción se hace SIEMPRE, también en seco. Es lo que hace que
  // el `--dry-run` pueda decir cuántas marcas se quedan sin zona y qué
  // patologías no se traducen: si sólo se tradujera al escribir, el seco
  // contaría pacientes y poco más.
  const porEscribir: Array<{
    visita: Visita;
    cuerpo: CuerpoImportado;
    autorUserId: string;
  }> = [];
  for (const v of ctx.visitas) {
    if (yaImportadas.has(v.id)) {
      recuento.visitas.yaEstaban += 1;
      continue;
    }
    recuento.visitas.nuevas += 1;
    porEscribir.push({
      visita: v,
      autorUserId: autoraDe(v, opciones, recuento),
      cuerpo: cuerpoDeLaVisita({
        visita: v,
        marcas: ctx.marcasPorVisita.get(v.id) ?? [],
        tratamientos: ctx.tratamientosPorVisita.get(v.id) ?? [],
        lateralidad: opciones.lateralidad,
        recuento,
      }),
    });
  }

  const campos = camposDeLaNota({
    paciente,
    datos: ctx.datos,
    telefonoUsado: telefono,
    nacimientoValido: nacimiento != null,
  });
  const nota = notaDeCogecop({ hoy: opciones.hoy, campos });
  if (nota == null) recuento.sinNota += 1;

  if (!opciones.ejecutar) return;

  const dek = await dekDe(tenantId, prisma);

  await prisma.$transaction(async (tx) => {
    let clientId = existente?.id ?? null;
    if (clientId == null) {
      // El id se genera aquí porque el AAD de la nota lo necesita, y el
      // AAD no se puede armar sobre una fila que todavía no existe.
      clientId = nuevoIdDeFila();
      const guardable = await notaParaGuardar(
        { tenantId, id: clientId, que: "FICHA", texto: nota },
        tx,
      );
      await tx.client.create({
        data: {
          id: clientId,
          tenantId,
          externalId,
          firstName: paciente.nombre.trim(),
          lastName: paciente.apellidos.trim(),
          phone: telefono,
          email: correoDe(paciente.email1),
          birthdate: nacimiento,
          marketingOptIn: false,
          notes: guardable.claro,
          notesCifradas: guardable.cifrado,
          // «Paciente desde…» es de verdad desde su primera visita en
          // COGECOP, no desde el día que corrimos el script.
          createdAt: fechaValida(paciente.primeravisita, opciones.hoy) ?? undefined,
        },
      });
    }

    for (const { visita, cuerpo, autorUserId } of porEscribir) {
      const id = nuevoIdDeFila();
      await tx.clinicalEntry.create({
        data: {
          id,
          tenantId,
          clientId,
          authorUserId: autorUserId,
          kind: "IMPORTED_VISIT",
          // La fecha de la visita, no la de hoy: la historia ordena por
          // aquí, y una historia de nueve años con todas las fechas de
          // hoy no es una historia.
          createdAt: new Date(visita.fechavisita),
          ...cuerpoParaEntrada({ tenantId, id, cuerpo, dek }),
        },
      });
    }
  });
}

/** Un `Client.email` sólo si de verdad parece un correo. Lo que no lo
 *  parece va a la nota con su etiqueta: en la copia de Rosario el
 *  `email2` de una ficha lleva un DNI. */
function correoDe(valor: string | null | undefined): string | null {
  const t = valor?.trim();
  if (!t) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}
