// residencia-3 · **QUÉ SE PUEDE APUNTAR, Y CON QUÉ CONDICIONES.**
//
// El dominio del registro de cuidados, fuera de las rutas: la forma del
// valor, los límites del instante de la tablet, la cadena de correcciones
// y la escritura de un lote. Las rutas sólo traducen HTTP.
//
// ── LA INVARIANTE DE ESTE FICHERO ───────────────────────────────────
//
// **Un cuidado hecho se apunta.** Es el «cobrar siempre se puede» de este
// módulo (residencia-1 §11.5), y de ahí salen tres decisiones que de otra
// forma parecerían flojas:
//
//   · un registro cuyo instante NO cae en ningún turno **se guarda sin
//     turno** y se pinta como aviso. No se rechaza: el cuidado ocurrió.
//   · un lote con un registro malo **guarda los buenos**. Siete filas de
//     un «como siempre» no se pierden porque una de las siete dimensiones
//     se desactivara en el centro mientras la tablet estaba sin red.
//   · lo único que se rechaza de verdad es lo que **no se puede creer**:
//     un instante del futuro o de hace un mes, una firma que no existía, o
//     un residente que no vive en esta habitación.
//
// Y al revés, la otra mitad: lo rechazado **se dice**. Si no se pudo
// guardar nada, el lote contesta 409 y la cola del TPV lo marca
// `rejected`, que es un estado visible en el chip de pendientes y que no
// se reintenta en bucle. Un 200 silencioso sobre un lote que no entró
// sería un cuidado perdido que nadie echa en falta.

import { Prisma, type PrismaClient } from "@mipiacetpv/db";

import {
  asegurarDek,
  dekONada,
} from "../clinica/claves.js";
import {
  cifrarJson,
  cifrarTexto,
  leerJson,
  leerTexto,
  sitioNotaDeRegistro,
  sitioValorDeRegistro,
} from "../clinica/cripto-campos.js";
import {
  decodificarNotaDeVoz,
  guardarFichero,
  MIME_DE_VOZ,
} from "../clinica/ficheros.js";

// ── Los límites del `recordedAt` (decisión de producto 5) ────────────
//
// El servidor acepta el instante de la tablet, que es lo que hace que un
// cuidado hecho a las 02:00 sin red se apunte a las 02:00 y no a las 08:00.
// Pero no cualquiera.
//
// **Futuro: cinco minutos.** El reloj de una tablet de pared se va unos
// segundos; cinco minutos cubren eso de sobra. Más allá no es desvío: es
// un reloj mal puesto, y un registro del futuro cae en un turno que
// todavía no ha pasado — la DUE del relevo leería un cambio postural que
// nadie ha hecho.
//
// **Pasado: siete días.** El número sale de dos cosas y las dos importan:
//
//   1. una tablet que lleva una semana sin red es una tablet que alguien
//      tiene que ir a mirar, no un caso que el servidor deba tragarse en
//      silencio;
//   2. el parte de relevo de residencia-5 se confirma con PIN al acabar el
//      turno. Un registro de hace un mes que entra hoy cambia un parte que
//      alguien ya firmó, y eso es peor que perderlo: convierte una
//      evidencia confirmada en una evidencia que cambió después.
//
// Siete días deja holgura para un puente largo con el router caído y se
// queda muy por debajo del plazo del relevo. Los dos códigos son **400**:
// la cola del TPV los trata como rechazo permanente (no los reintenta en
// bucle) y los deja visibles.
export const MARGEN_FUTURO_MS = 5 * 60_000;
export const MARGEN_PASADO_MS = 7 * 24 * 3600_000;

/** Y cuánto dura la ventana del «Deshacer el último» (decisión 1). */
export const VENTANA_DE_ANULACION_MS = 10 * 60_000;

// ── La forma del VALOR ───────────────────────────────────────────────
//
// Tres y no cinco, y la razón es que las dos que faltan ya las dicen otras
// columnas:
//
//   · el «como siempre» de una dimensión **es** un `ORDINAL` con la opción
//     marcada `isAsUsual`. No es un tipo aparte: es un valor con nombre, y
//     eso es justo lo que D-15 cierra («es un registro con valor»).
//   · lo «a demanda» **es** un `BOOL`. Que sólo se cuente en vez de
//     cumplirse o incumplirse lo dice `ControlType.nature`, no el valor.
//     Un tipo `CONTEO` habría sido una segunda forma de decir lo mismo.
//
// `NUMERIC` y `SCORE` no entran: las constantes son residencia-4 y las
// escalas Fase 2 (decisión de producto 11). Se rechazan con su código en
// vez de aceptarse «por si acaso», porque un valor guardado sin umbral que
// lo mire es un dato que nadie lee y que parece que sí.
export type ValorDeRegistro =
  | { tipo: "BOOL"; hecho: true }
  | { tipo: "ORDINAL"; opcion: string; comoSiempre: boolean }
  | { tipo: "NOTA" };

/**
 * Lo que la tablet manda como valor, antes de comprobarlo contra el
 * catálogo.
 *
 * `hecho` sólo admite `true`, y es una decisión de producto: **«no hecho»
 * es la AUSENCIA de registro**, no un registro. Quien lo deriva es
 * residencia-4 (evento por ausencia, D-20) cruzando `queToca` con lo
 * registrado. Si además se pudiera apuntar `hecho: false`, el indicador de
 * cumplimiento tendría dos fuentes para la misma pregunta y habría que
 * decidir cuál manda — y la pantalla tendría un botón «no hecho» que
 * invita a justificarse en vez de a avisar.
 */
export interface ValorEntrante {
  tipo: "BOOL" | "ORDINAL" | "NOTA";
  hecho?: boolean;
  opcion?: string;
}

/** Lo que hace falta saber de un control para validar un registro suyo. */
export interface ControlParaRegistrar {
  id: string;
  code: string;
  layer: string;
  nature: string;
  valueDomain: string;
  opciones: Array<{ code: string; isAsUsual: boolean }>;
}

export class RegistroInvalido extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/**
 * Comprueba el valor contra el control y lo normaliza.
 *
 * Normalizar es la mitad que importa: `comoSiempre` **no se cree, se
 * calcula** desde `isAsUsual` de la opción elegida. Si viniera del cuerpo,
 * una tablet con un error de redondeo conceptual podría marcar como «como
 * siempre» un «no ha dormido» — y el indicador de descanso nocturno del
 * centro saldría impecable con la planta entera sin dormir.
 */
export function valorDeRegistro(
  entrante: ValorEntrante,
  control: ControlParaRegistrar,
): ValorDeRegistro {
  if (control.valueDomain === "NUMERIC" || control.valueDomain === "SCORE") {
    throw new RegistroInvalido(
      "CONTROL_FUERA_DE_ALCANCE",
      `«${control.code}» es una medida y la puerta todavía no la registra: las constantes, sus umbrales y los eventos que disparan son residencia-4, y las escalas validadas la Fase 2.`,
    );
  }
  if (control.valueDomain === "BOOL") {
    if (entrante.tipo !== "BOOL" || entrante.hecho !== true) {
      throw new RegistroInvalido(
        "VALOR_NO_CUADRA",
        `«${control.code}» se apunta como hecho, y «no hecho» no se apunta: es la ausencia de registro.`,
      );
    }
    return { tipo: "BOOL", hecho: true };
  }
  if (control.valueDomain === "ORDINAL") {
    if (entrante.tipo !== "ORDINAL" || typeof entrante.opcion !== "string") {
      throw new RegistroInvalido(
        "VALOR_NO_CUADRA",
        `«${control.code}» se apunta eligiendo una de sus opciones.`,
      );
    }
    const opcion = control.opciones.find((o) => o.code === entrante.opcion);
    if (!opcion) {
      // Puede pasar de verdad y sin que nadie se equivoque: una versión
      // nueva del control retira una opción mientras la tablet está sin
      // red, y lo que llega es una opción que ya no existe. Se rechaza con
      // su nombre dentro, para que quien lo lea sepa qué pasó.
      throw new RegistroInvalido(
        "OPCION_DESCONOCIDA",
        `«${entrante.opcion}» no es una opción de «${control.code}». Puede que el catálogo haya cambiado desde que se apuntó.`,
      );
    }
    return {
      tipo: "ORDINAL",
      opcion: opcion.code,
      comoSiempre: opcion.isAsUsual,
    };
  }
  // `TEXT_SHORT`: «algo no va bien». El texto y la voz son OPCIONALES y
  // van aparte (columna propia y fichero propio); el valor en sí sólo dice
  // que alguien lo dijo. D-13: «algo no va bien» a secas es un registro
  // completo.
  if (control.valueDomain === "TEXT_SHORT") {
    if (entrante.tipo !== "NOTA") {
      throw new RegistroInvalido(
        "VALOR_NO_CUADRA",
        `«${control.code}» se apunta como nota.`,
      );
    }
    return { tipo: "NOTA" };
  }
  throw new RegistroInvalido(
    "CONTROL_FUERA_DE_ALCANCE",
    `«${control.code}» tiene un dominio de valor que la puerta no sabe registrar (${control.valueDomain}).`,
  );
}

/**
 * ¿A qué ocurrencia se adscribe este registro? (la columna
 * `occurrence_at`, que sostiene el índice único).
 *
 * Tres casos y los tres son la misma pregunta: «¿cuántas veces puede
 * repetirse esto?».
 *
 *   · **Observación diaria** (capa `OBS`) → `null`. Una vez por residente
 *     y turno, que es lo que dice la decisión 4. Y da igual que su línea
 *     del plan tenga ocurrencias: el toque de «¿cómo está hoy?» no
 *     responde a una ronda, responde al turno.
 *   · **`ON_DEMAND`** → el instante del propio registro. No cuelga de
 *     ninguna agenda, así que dos deposiciones del mismo turno son dos
 *     cosas distintas y las dos entran.
 *   · **Lo demás** (lo que «toca») → el instante que devolvió `queToca`.
 *     Tres cambios posturales de un turno son tres ocurrencias.
 *
 * Y **no se cree lo que manda la tablet** más que en el tercer caso: en
 * los dos primeros lo decide el catálogo, porque de esta columna depende
 * cuántas filas caben y eso no puede quedar en manos del cuerpo del POST.
 */
export function ocurrenciaDe(
  control: ControlParaRegistrar,
  recordedAt: Date,
  ocurrenciaDeLaTablet: Date | null,
): Date | null {
  if (control.layer === "OBS") return null;
  if (control.nature === "ON_DEMAND") return recordedAt;
  return ocurrenciaDeLaTablet;
}

/**
 * Comprueba el instante de la tablet. Ver los dos márgenes de arriba.
 *
 * `ahora` entra por parámetro —no se lee el reloj aquí— para que los dos
 * casos del borde sean una tabla y no una espera.
 */
export function comprobarInstante(recordedAt: Date, ahora: Date): void {
  if (Number.isNaN(recordedAt.getTime())) {
    throw new RegistroInvalido("INSTANTE_INVALIDO", "El instante del registro no es una fecha.");
  }
  if (recordedAt.getTime() > ahora.getTime() + MARGEN_FUTURO_MS) {
    throw new RegistroInvalido(
      "REGISTRO_EN_EL_FUTURO",
      "Este registro viene con una hora del futuro. La tablet tiene el reloj mal puesto: avisa a dirección.",
    );
  }
  if (recordedAt.getTime() < ahora.getTime() - MARGEN_PASADO_MS) {
    throw new RegistroInvalido(
      "REGISTRO_DEMASIADO_VIEJO",
      "Este registro lleva más de siete días esperando en la tablet. No se guarda solo: avisa a dirección para que alguien lo mire.",
    );
  }
}

// ── La cadena de correcciones ────────────────────────────────────────

/** Una fila de la cadena de una ocurrencia, en lo que aquí importa. */
export interface EslabonDeCadena {
  id: string;
  correctsRecordId: string | null;
  voidedAt: Date | null;
  recordedAt: Date;
}

/**
 * **La COLA de la cadena**: el eslabón que nadie corrige. Es el valor de
 * ahora.
 *
 * `null` cuando no hay nada registrado para esa ocurrencia.
 *
 * Por qué una función y no un `orderBy recordedAt desc` + `take 1`: porque
 * el orden de la cadena es el de las correcciones, no el del reloj. Un
 * registro hecho sin red a las 02:00 puede llegar DESPUÉS de su corrección
 * de las 02:05 —la cola del TPV reintenta en el orden en que los items
 * suelten el lock—, y entonces «el último por hora» y «el último de la
 * cadena» no son el mismo. El que manda es el de la cadena.
 */
export function colaDeLaCadena(
  eslabones: EslabonDeCadena[],
): EslabonDeCadena | null {
  if (eslabones.length === 0) return null;
  const corregidos = new Set(
    eslabones.map((e) => e.correctsRecordId).filter((x): x is string => x != null),
  );
  const colas = eslabones.filter((e) => !corregidos.has(e.id));
  if (colas.length === 0) {
    // No puede pasar: el índice único de la correccion garantiza que la
    // cadena es una línea, y una línea tiene una cola. Se comprueba igual
    // porque la alternativa sería un `!` sobre una invariante del motor, y
    // si la cadena se rompiera lo que se quiere es un fallo visible.
    return null;
  }
  // Si hubiera más de una (índice caído), gana la que se registró después:
  // pintar la vieja sería enseñar un valor corregido.
  return colas.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0]!;
}

/** ¿Hay algo VIVO para esta ocurrencia? Vivo = es la cola y no está
 *  anulada. */
export function vivoDeLaCadena(
  eslabones: EslabonDeCadena[],
): EslabonDeCadena | null {
  const cola = colaDeLaCadena(eslabones);
  if (cola == null || cola.voidedAt != null) return null;
  return cola;
}

// ── Escribir ─────────────────────────────────────────────────────────

/** Un registro tal y como llega de la tablet. */
export interface RegistroEntrante {
  /** El uuid que generó la tablet: idempotencia y AAD. */
  id: string;
  clientId: string;
  controlCode: string;
  planItemId?: string | null;
  /** El instante de la ocurrencia de `queToca`, si cuelga de una. */
  occurrenceAt?: string | null;
  recordedAt: string;
  centerShiftId?: string | null;
  careDay: string;
  valor: ValorEntrante;
  /** El texto corto de «algo no va bien». Opcional (D-13). */
  nota?: string | null;
  /** La nota de voz, en base64. Opcional (D-13). */
  voz?: { webmBase64: string } | null;
}

export type EstadoDeRegistro = "guardado" | "corrige" | "ya-estaba" | "rechazado";

export interface ResultadoDeRegistro {
  id: string;
  estado: EstadoDeRegistro;
  /** Puesto cuando `estado = "corrige"`: a quién corrige. */
  corrigeA?: string;
  /** Puestos cuando `estado = "rechazado"`. */
  codigo?: string;
  mensaje?: string;
}

/** Lo que `escribirLote` necesita saber del contexto, ya resuelto. */
export interface ContextoDelLote {
  tenantId: string;
  deviceId: string;
  /** Quién firma cada registro: ya comprobado contra las zonas y los roles
   *  por `firmasDelLote` en las rutas. */
  firma: { userId: string; careRoleAssignmentId: string };
  /** Los residentes que viven en ESTA habitación. */
  clientesDeLaHabitacion: Set<string>;
  /** Los controles vigentes y activos del centro, por código. */
  controles: Map<string, ControlParaRegistrar>;
  /** Los turnos del centro, por id. Para comprobar que el turno que manda
   *  la tablet es de este centro. */
  turnos: Set<string>;
  ahora: Date;
}

/**
 * Escribe UN registro, y nunca lanza por un dato malo: lo cuenta.
 *
 * ── Una escritura por REGISTRO, y no una transacción por lote ──────
 *
 * Porque cada fila es evidencia independiente y porque la idempotencia es
 * por fila: con una transacción para todo el lote, un registro malo haría
 * `rollback` de los seis buenos, y un reenvío del lote reescribiría los
 * seis que ya estaban. Siete filas de un «como siempre» son un gesto para
 * la auxiliar y siete hechos para la norma.
 *
 * El coste es real y está aceptado: siete escrituras cortas en vez de una.
 * A cambio, el peor caso de un lote es «seis apuntados y uno dicho».
 */
export async function escribirRegistro(
  prisma: PrismaClient,
  ctx: ContextoDelLote,
  entrante: RegistroEntrante,
): Promise<ResultadoDeRegistro> {
  try {
    return await escribirUno(prisma, ctx, entrante);
  } catch (err) {
    if (err instanceof RegistroInvalido) {
      return {
        id: entrante.id,
        estado: "rechazado",
        codigo: err.codigo,
        mensaje: err.message,
      };
    }
    throw err;
  }
}

async function escribirUno(
  prisma: PrismaClient,
  ctx: ContextoDelLote,
  entrante: RegistroEntrante,
): Promise<ResultadoDeRegistro> {
  // ── 1 · IDEMPOTENCIA, antes de cualquier otra cosa ────────────────
  //
  // El mismo uuid es la misma fila. Y se comprueba PRIMERO porque un
  // reenvío de un lote de ayer puede traer registros cuyo `recordedAt` ya
  // está fuera del margen de siete días: si el límite se mirara antes, un
  // reintento tardío convertiría en «rechazado» algo que **ya está
  // guardado**, y la tablet borraría de su cola un registro que sí llegó
  // creyendo que no.
  const existe = await prisma.careRecord.findUnique({
    where: { id: entrante.id },
    select: { id: true, tenantId: true, correctsRecordId: true },
  });
  if (existe) {
    if (existe.tenantId !== ctx.tenantId) {
      // Un uuid que ya existe en OTRO centro. Imposible en la práctica
      // (son uuid v4) y, si pasara, lo que no se puede hacer es decir «ya
      // estaba»: sería dar por apuntado en este centro algo que está en
      // otro.
      throw new RegistroInvalido(
        "ID_DE_OTRO_CENTRO",
        "Ese identificador de registro ya existe y no es de este centro.",
      );
    }
    return {
      id: existe.id,
      estado: "ya-estaba",
      ...(existe.correctsRecordId ? { corrigeA: existe.correctsRecordId } : {}),
    };
  }

  // ── 2 · ¿Vive este residente en ESTA habitación? ──────────────────
  //
  // Es el aislamiento de la puerta y va antes que el permiso de la
  // persona: la tablet de la 112 no apunta nada de la 114 ni aunque quien
  // esté delante alcance a las dos. La identidad de la tablet es su
  // habitación, y lo que firme tiene que caber en ella.
  if (!ctx.clientesDeLaHabitacion.has(entrante.clientId)) {
    throw new RegistroInvalido(
      "RESIDENTE_DE_OTRA_HABITACION",
      "Ese residente no ocupa ninguna cama de esta habitación.",
    );
  }

  // ── 3 · El control, vigente y activo en el centro ─────────────────
  const control = ctx.controles.get(entrante.controlCode);
  if (!control) {
    throw new RegistroInvalido(
      "CONTROL_DESCONOCIDO",
      `«${entrante.controlCode}» no es un control activo de este centro. Puede que lo hayan desactivado desde que se apuntó.`,
    );
  }

  // ── 4 · El valor, comprobado y normalizado contra el catálogo ─────
  const valor = valorDeRegistro(entrante.valor, control);

  // ── 5 · El instante ──────────────────────────────────────────────
  const recordedAt = new Date(entrante.recordedAt);
  comprobarInstante(recordedAt, ctx.ahora);

  // ── 6 · El turno, que puede ser NULL y es legítimo ────────────────
  //
  // `null` = los turnos del centro no cubren esa hora. Se guarda sin turno
  // y la pantalla lo pinta como aviso (residencia-1 §11.5). Lo que no se
  // acepta es un turno que **no es de este centro**: eso no es un hueco en
  // el cuadrante, es un dato que no cuadra.
  const centerShiftId = entrante.centerShiftId ?? null;
  if (centerShiftId != null && !ctx.turnos.has(centerShiftId)) {
    throw new RegistroInvalido(
      "TURNO_DESCONOCIDO",
      "Ese turno no es de este centro. Puede que lo hayan cambiado desde que se apuntó.",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrante.careDay)) {
    throw new RegistroInvalido(
      "DIA_INVALIDO",
      "El día del registro no tiene la forma AAAA-MM-DD.",
    );
  }

  const occurrenceAt = ocurrenciaDe(
    control,
    recordedAt,
    entrante.occurrenceAt ? new Date(entrante.occurrenceAt) : null,
  );

  // ── 7 · ¿Es una CORRECCIÓN? Lo decide el servidor, no el cuerpo ───
  //
  // «Repetirlo en el mismo turno sustituye a lo anterior por la vía de la
  // corrección, no duplica» (decisión 4). Quien lo sabe es quien puede
  // mirar la cadena entera, y eso es el servidor: la tablet pudo registrar
  // sin red y no saber que otra cosa ya estaba.
  //
  // Por eso el cuerpo **no lleva** un campo `corrige`. Si lo llevara,
  // habría dos fuentes para la misma decisión y una cadena mal armada
  // dejaría sin respuesta «¿cuál es el valor de ahora?». Lo que la tablet
  // manda es lo que pasó; lo que es una corrección de qué, se deduce.
  const cadena = await prisma.careRecord.findMany({
    where: {
      clientId: entrante.clientId,
      controlCode: entrante.controlCode,
      careDay: entrante.careDay,
      centerShiftId,
      occurrenceAt,
    },
    select: {
      id: true,
      correctsRecordId: true,
      voidedAt: true,
      recordedAt: true,
    },
  });
  const cola = colaDeLaCadena(cadena);
  const correctsRecordId = cola?.id ?? null;

  // ── 8 · La nota de voz: PRIMERO el fichero, después la fila ───────
  //
  // El orden es el de clinica-4: al revés, un fallo al escribir el disco
  // dejaría una fila que apunta a un audio que no existe — y un hueco que
  // dice «aquí había una nota de voz» es peor que no tener la fila.
  const dek = await asegurarDek(ctx.tenantId, prisma);
  let voz: {
    voiceFileName: string;
    voiceSha256: string;
    voiceBytes: number;
    voiceMimeType: string;
  } | null = null;
  if (entrante.voz) {
    const audio = decodificarNotaDeVoz(entrante.voz);
    const guardado = await guardarFichero("VOZ", audio, {
      tenantId: ctx.tenantId,
      dek,
    });
    voz = {
      voiceFileName: guardado.fileName,
      voiceSha256: guardado.sha256,
      voiceBytes: guardado.bytes,
      voiceMimeType: MIME_DE_VOZ,
    };
  }

  try {
    await prisma.careRecord.create({
      data: {
        // El id lo pone la tablet: es la idempotencia y es el AAD.
        id: entrante.id,
        tenantId: ctx.tenantId,
        clientId: entrante.clientId,
        controlTypeId: control.id,
        controlCode: control.code,
        planItemId: entrante.planItemId ?? null,
        occurrenceAt,
        valueCifrado: cifrarJson(
          valor,
          dek,
          sitioValorDeRegistro(ctx.tenantId, entrante.id),
        ),
        // El texto de la nota, en su propia columna lógica. `cifrarTexto`
        // devuelve `null` para `null` y para la cadena vacía: una nota sin
        // texto no guarda ciphertext que no dice nada.
        noteCifrado: cifrarTexto(
          entrante.nota ?? null,
          dek,
          sitioNotaDeRegistro(ctx.tenantId, entrante.id),
        ),
        ...(voz ?? {}),
        recordedByUserId: ctx.firma.userId,
        careRoleAssignmentId: ctx.firma.careRoleAssignmentId,
        deviceId: ctx.deviceId,
        recordedAt,
        centerShiftId,
        careDay: entrante.careDay,
        correctsRecordId,
      },
    });
  } catch (err) {
    // El índice `care_records_una_por_ocurrencia_key` saltando significa
    // que otra fila ganó la carrera entre el `findMany` de arriba y este
    // `create`. Con una tablet por habitación no debería pasar; si pasa,
    // lo que NO se puede hacer es tragárselo: el reintento de la cola
    // vuelve a leer la cadena y entra como corrección.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new RegistroInvalido(
        "OCURRENCIA_YA_REGISTRADA",
        "Otro registro de esa misma ocurrencia entró a la vez. Reintenta: entrará como corrección.",
      );
    }
    throw err;
  }

  return correctsRecordId
    ? { id: entrante.id, estado: "corrige", corrigeA: correctsRecordId }
    : { id: entrante.id, estado: "guardado" };
}

// ── Leer ─────────────────────────────────────────────────────────────

/** Lo que la pantalla necesita de un registro, ya descifrado. */
export interface VistaDeRegistro {
  id: string;
  controlCode: string;
  clientId: string;
  valor: unknown;
  nota: string | null;
  tieneVoz: boolean;
  recordedAt: string;
  careDay: string;
  shiftCode: string | null;
  /** `true` cuando el registro no cayó en ningún turno. Es el aviso. */
  sinTurno: boolean;
  firmadoPor: string;
  firmadoPorUserId: string;
  rolCode: string;
  anulado: boolean;
  /** Puesto cuando esta fila corrige a otra. */
  corrigeA: string | null;
  /** `true` si es la cola de su cadena y no está anulada: el valor de
   *  ahora. Lo que la puerta pinta en verde. */
  vigente: boolean;
}

/** El `select` mínimo para construir una `VistaDeRegistro`. */
export const REGISTRO_SELECT = {
  id: true,
  tenantId: true,
  clientId: true,
  controlCode: true,
  valueCifrado: true,
  noteCifrado: true,
  voiceFileName: true,
  recordedAt: true,
  careDay: true,
  occurrenceAt: true,
  centerShiftId: true,
  correctsRecordId: true,
  voidedAt: true,
  centerShift: { select: { code: true } },
  recordedBy: { select: { id: true, alias: true, email: true } },
  careRoleAssignment: { select: { careRole: { select: { code: true, name: true } } } },
} as const;

type FilaDeRegistro = {
  id: string;
  tenantId: string;
  clientId: string;
  controlCode: string;
  valueCifrado: string;
  noteCifrado: string | null;
  voiceFileName: string | null;
  recordedAt: Date;
  careDay: string;
  occurrenceAt: Date | null;
  centerShiftId: string | null;
  correctsRecordId: string | null;
  voidedAt: Date | null;
  centerShift: { code: string } | null;
  recordedBy: { id: string; alias: string | null; email: string };
  careRoleAssignment: { careRole: { code: string; name: string } };
};

/**
 * Cómo se llama quien firmó, para la frase «lo marcó Ana a las 08:20».
 *
 * El alias si lo tiene; si no, **la parte local del email y no el email
 * entero**. Un email completo en la pantalla de un pasillo es un dato
 * personal publicado donde no hace falta, y lo que la auxiliar necesita
 * saber es quién fue, no cómo escribirle.
 */
export function nombreDeQuienFirma(u: {
  alias: string | null;
  email: string;
}): string {
  return u.alias ?? (u.email.split("@")[0] ?? u.email);
}

/**
 * Descifra y arma la vista de un conjunto de registros.
 *
 * Calcula `vigente` **sobre el conjunto que recibe**, agrupando por
 * ocurrencia. Por eso quien llama tiene que traer la cadena COMPLETA de
 * cada ocurrencia que quiera pintar: con media cadena, una corrección
 * saldría como vigente y la corregida también.
 */
export function vistaDeRegistros(
  filas: FilaDeRegistro[],
  dek: Buffer | null,
): VistaDeRegistro[] {
  const corregidos = new Set(
    filas.map((f) => f.correctsRecordId).filter((x): x is string => x != null),
  );
  return filas.map((f) => ({
    id: f.id,
    controlCode: f.controlCode,
    clientId: f.clientId,
    valor: leerJson(
      { cifrado: f.valueCifrado, claro: null },
      dek,
      sitioValorDeRegistro(f.tenantId, f.id),
    ),
    nota: leerTexto(
      { cifrado: f.noteCifrado, claro: null },
      dek,
      sitioNotaDeRegistro(f.tenantId, f.id),
    ),
    tieneVoz: f.voiceFileName != null,
    recordedAt: f.recordedAt.toISOString(),
    careDay: f.careDay,
    shiftCode: f.centerShift?.code ?? null,
    sinTurno: f.centerShiftId == null,
    firmadoPor: nombreDeQuienFirma(f.recordedBy),
    firmadoPorUserId: f.recordedBy.id,
    rolCode: f.careRoleAssignment.careRole.code,
    anulado: f.voidedAt != null,
    corrigeA: f.correctsRecordId,
    vigente: !corregidos.has(f.id) && f.voidedAt == null,
  }));
}

/** La DEK para LEER. No crea clave: un centro que no ha escrito nada
 *  cifrado no tiene nada que descifrar (residencia-1b §4). */
export function dekParaLeer(
  tenantId: string,
  prisma: PrismaClient,
): Promise<Buffer | null> {
  return dekONada(tenantId, prisma);
}
