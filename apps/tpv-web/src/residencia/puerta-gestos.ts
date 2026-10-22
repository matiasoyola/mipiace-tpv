// residencia-3 · **DE UN TOQUE A UNAS FILAS.** Puro, y por eso testeable.
//
// Cada gesto del mockup se convierte aquí en los registros que hay que
// encolar. Sin React, sin red y sin reloj: la hora entra por parámetro,
// igual que en `queToca`. Así la obligación que residencia-2 dejó
// escrita —«el toque rápido tiene que ESCRIBIR el `CareRecord` de cada
// dimensión activa con su valor, no saltarse la fila» (§11.5 de su
// done)— es una tabla de verdad y no una maqueta de pantalla.
//
// ── LOS CUATRO GESTOS ───────────────────────────────────────────────
//
//   1. **«Como siempre»** → una fila por cada dimensión `OBS` activa que
//      declara su valor «como siempre». N filas, un toque (D-15, D-16).
//   2. **«No como siempre»** → las cambiadas con su valor y **las demás
//      como siempre**: 1 + (N−1). El coste de registro es proporcional a
//      la anomalía, no al tamaño del catálogo.
//   3. **«Hecho»** (y las cuatro opciones de una comida) → una fila para
//      esa ocurrencia.
//   4. **«+ Higiene», «+ Deposición», «Algo no va bien»** → una fila sin
//      ocurrencia: lo `ON_DEMAND` sólo se cuenta.
//
// ── QUÉ DIMENSIONES ENTRAN EN EL «COMO SIEMPRE» ─────────────────────
//
// Las de capa `OBS` **que declaran una opción `isAsUsual`**, y activas en
// el centro. Las tres condiciones hacen falta:
//
//   · `OBS` porque el atajo es de la OBSERVACIÓN («¿cómo está hoy?») y no
//     de la ejecución: las cuatro comidas son `EXEC` y «todo» no es «como
//     siempre», es «hoy se lo comió todo» (residencia-2 §2). Si entraran,
//     la ingesta del centro saldría «todo» cada día y el indicador de
//     nutrición no valdría nada.
//   · **con `isAsUsual`** porque sin esa opción no hay nada que escribir.
//     Es lo que deja fuera a `ALGO_NO_VA_BIEN`, que es `OBS` y no tiene
//     opciones: «como siempre» no puede significar «no me ha parecido que
//     pase nada», porque entonces el día que SÍ pasa algo no se
//     distinguiría de los otros 84.
//   · **activa** porque un control que el centro desactivó no se registra.

import { newId } from "../lib/ids.js";
import type {
  ControlDeLaPuerta,
  RegistroParaEnviar,
} from "./puerta-tipos.js";

/** El contexto de un gesto: quién, cuándo, en qué turno y qué día. */
export interface ContextoDelGesto {
  clientId: string;
  /** El instante de la tablet. Es el `recordedAt` de todas las filas del
   *  gesto: un toque es un instante, aunque escriba siete filas. */
  recordedAt: Date;
  /** El turno calculado en la tablet, o `null` si los turnos del centro no
   *  cubren esta hora (se guarda sin turno y se pinta como aviso). */
  centerShiftId: string | null;
  /** El día del CENTRO (`diaDelTurno`), que en la madrugada del turno de
   *  noche es el de ayer. */
  careDay: string;
}

/** Las dimensiones `OBS` que entran en el toque de «como siempre». */
export function dimensionesDeLaObservacion(
  controles: ControlDeLaPuerta[],
  activos: (code: string) => boolean,
): Array<ControlDeLaPuerta & { comoSiempre: string }> {
  const salida: Array<ControlDeLaPuerta & { comoSiempre: string }> = [];
  for (const c of controles) {
    if (c.layer !== "OBS") continue;
    if (!activos(c.code)) continue;
    const asUsual = c.opciones.find((o) => o.isAsUsual);
    if (!asUsual) continue;
    salida.push({ ...c, comoSiempre: asUsual.code });
  }
  return salida;
}

/**
 * **«Como siempre»**: una fila por dimensión, con SU valor.
 *
 * No es «no registrar nada»: es N registros con valor, que es lo que D-15
 * cierra y lo que hace que exista el denominador. Sin estas filas no se
 * distingue «hoy está normal» de «hoy nadie lo miró», que es justo la
 * distinción que la dirección pidió como métrica de éxito.
 *
 * Y **sin `occurrenceAt`**: la observación se pregunta una vez por
 * residente y turno, no por ocurrencia. De ahí sale que repetir el toque
 * en el mismo turno corrija en vez de duplicar, y eso lo decide el
 * servidor (`registro.ts`).
 */
export function comoSiempre(
  ctx: ContextoDelGesto,
  dimensiones: Array<ControlDeLaPuerta & { comoSiempre: string }>,
): RegistroParaEnviar[] {
  return dimensiones.map((d) => ({
    id: newId(),
    clientId: ctx.clientId,
    controlCode: d.code,
    planItemId: null,
    occurrenceAt: null,
    recordedAt: ctx.recordedAt.toISOString(),
    centerShiftId: ctx.centerShiftId,
    careDay: ctx.careDay,
    valor: { tipo: "ORDINAL", opcion: d.comoSiempre },
  }));
}

/**
 * **«No como siempre»**: las cambiadas con su valor, las demás como
 * siempre.
 *
 * `1 + (N−1)`, no `1`. Las que nadie tocó se registran igual y con su
 * valor de normalidad, porque «toca solo lo que no está como siempre; lo
 * demás se guarda como siempre» es una promesa de la pantalla 4 y tiene
 * que cumplirse en la base. Si sólo se guardara la cambiada, el día que
 * doña Carmen está inquieta su ánimo constaría y su piel no — y la piel
 * sin registrar no significa «estaba bien», significa «nadie la miró».
 *
 * Una opción que no exista en su dimensión se ignora en vez de romper el
 * gesto: lo que no se puede perder son las otras seis filas.
 */
export function noComoSiempre(
  ctx: ContextoDelGesto,
  dimensiones: Array<ControlDeLaPuerta & { comoSiempre: string }>,
  cambiadas: Record<string, string>,
): RegistroParaEnviar[] {
  return dimensiones.map((d) => {
    const elegida = cambiadas[d.code];
    const vale =
      elegida != null && d.opciones.some((o) => o.code === elegida)
        ? elegida
        : d.comoSiempre;
    return {
      id: newId(),
      clientId: ctx.clientId,
      controlCode: d.code,
      planItemId: null,
      occurrenceAt: null,
      recordedAt: ctx.recordedAt.toISOString(),
      centerShiftId: ctx.centerShiftId,
      careDay: ctx.careDay,
      valor: { tipo: "ORDINAL", opcion: vale },
    };
  });
}

/**
 * **«Hecho»** sobre una ocurrencia de `queToca`, y las cuatro opciones de
 * una comida.
 *
 * `occurrenceAt` es el instante que devolvió `queToca`: es lo que hace que
 * tres cambios posturales de un turno sean tres filas y no una repetida.
 */
export function registroDeOcurrencia(
  ctx: ContextoDelGesto,
  input: {
    controlCode: string;
    planItemId: string | null;
    occurrenceAt: string | null;
    /** `null` para un `BOOL` («hecho»); el código de la opción para un
     *  `ORDINAL` (la comida). */
    opcion?: string | null;
  },
): RegistroParaEnviar {
  return {
    id: newId(),
    clientId: ctx.clientId,
    controlCode: input.controlCode,
    planItemId: input.planItemId,
    occurrenceAt: input.occurrenceAt,
    recordedAt: ctx.recordedAt.toISOString(),
    centerShiftId: ctx.centerShiftId,
    careDay: ctx.careDay,
    valor:
      input.opcion != null
        ? { tipo: "ORDINAL", opcion: input.opcion }
        : { tipo: "BOOL", hecho: true },
  };
}

/**
 * **Lo `ON_DEMAND`**: «+ Higiene», «+ Deposición».
 *
 * Sin ocurrencia y sin línea del plan: no cuelga de ninguna agenda y sólo
 * se cuenta. Dos deposiciones del mismo turno son dos cosas distintas, y
 * el servidor las deja entrar las dos porque a lo `ON_DEMAND` le pone
 * `occurrence_at = recorded_at`.
 */
export function registroADemanda(
  ctx: ContextoDelGesto,
  controlCode: string,
): RegistroParaEnviar {
  return {
    id: newId(),
    clientId: ctx.clientId,
    controlCode,
    planItemId: null,
    occurrenceAt: null,
    recordedAt: ctx.recordedAt.toISOString(),
    centerShiftId: ctx.centerShiftId,
    careDay: ctx.careDay,
    valor: { tipo: "BOOL", hecho: true },
  };
}

/**
 * residencia-4 · **UNA CONSTANTE.** El número que la auxiliar tecleó.
 *
 * `ON_DEMAND` sin ocurrencia cuando se toma a demanda («+ Constante»), y
 * con la ocurrencia de `queToca` cuando responde a una línea `MEASURE`
 * del plan. Lo decide quien llama pasándole o no `occurrenceAt`, igual
 * que el resto de los gestos.
 *
 * El número va con PUNTO decimal: la coma es de la pantalla y del
 * teclado, y convertirla aquí es lo que impide que un `38,4` viaje como
 * texto y llegue al servidor como `NaN`.
 */
export function registroDeConstante(
  ctx: ContextoDelGesto,
  input: {
    controlCode: string;
    numero: number;
    planItemId?: string | null;
    occurrenceAt?: string | null;
    avisarEnfermera?: boolean;
  },
): RegistroParaEnviar {
  return {
    id: newId(),
    clientId: ctx.clientId,
    controlCode: input.controlCode,
    planItemId: input.planItemId ?? null,
    occurrenceAt: input.occurrenceAt ?? null,
    recordedAt: ctx.recordedAt.toISOString(),
    centerShiftId: ctx.centerShiftId,
    careDay: ctx.careDay,
    valor: { tipo: "NUMERIC", numero: input.numero },
    ...(input.avisarEnfermera ? { avisarEnfermera: true } : {}),
  };
}

/** El código del control transversal de «algo no va bien». */
export const ALGO_NO_VA_BIEN = "ALGO_NO_VA_BIEN";

// ── residencia-4 · LOS TIPOS DE «ALGO NO VA BIEN» ───────────────────
//
// La fila de botones grandes que va ENCIMA de la nota (alcance 6). Son
// los que la plantilla del §3 gradúa, y ni uno más: una lista larga es un
// formulario, y un formulario es lo que hace que la auxiliar no registre
// (regla 1 de la capa, D-13).
//
// **Sin elegir nada sigue siendo un registro completo y vale N1.** Eso no
// es una concesión: es lo que hace que el botón se use el día que la
// auxiliar no sabe qué es lo que ve, que es el día que más importa.
export const TIPOS_DE_ALGO_NO_VA_BIEN = [
  {
    evento: "CAIDA",
    etiqueta: "Caída",
    /** La PREGUNTA ÚNICA. Dos botones y se acabó: con tres campos, nadie
     *  la contesta. */
    pregunta: {
      texto: "¿Se ha dado en la cabeza o hay herida?",
      opciones: [
        { matiz: "CON_GOLPE", etiqueta: "Sí" },
        { matiz: "SIN_GOLPE", etiqueta: "No" },
      ],
    },
  },
  { evento: "VOMITO", etiqueta: "Vómito", pregunta: null },
  {
    evento: "NO_LOCALIZADO",
    etiqueta: "No lo encontramos / se ha ido",
    pregunta: null,
  },
  {
    evento: "EMERGENCIA_VITAL",
    etiqueta: "No respira bien, no responde o dolor en el pecho",
    pregunta: null,
  },
  {
    evento: "AVERIA",
    etiqueta: "Algo roto en la habitación",
    pregunta: {
      texto: "¿Es peligroso?",
      opciones: [
        { matiz: "PELIGROSA", etiqueta: "Sí" },
        { matiz: "SIN_RIESGO", etiqueta: "No" },
      ],
    },
  },
] as const;

export type TipoDeAlgoNoVaBien = (typeof TIPOS_DE_ALGO_NO_VA_BIEN)[number];

/**
 * **«Algo no va bien»**: una fila, con texto o sin texto, con voz o sin
 * voz.
 *
 * Los dos son OPCIONALES y la fila es completa sin ninguno: «no hace falta
 * saber qué es, con decirlo basta» (D-13, y la regla 1 de la capa 2). Si
 * la pantalla exigiera categorizar, la auxiliar no registraría — que es el
 * fallo que la rama de controles avisa en su primera regla de diseño.
 */
export function algoNoVaBien(
  ctx: ContextoDelGesto,
  input: {
    texto?: string | null;
    vozBase64?: string | null;
    /** residencia-4 · el tipo elegido y su matiz. Los dos opcionales. */
    evento?: string | null;
    matiz?: string | null;
    /** Y «no puede esperar»: fuerza al menos N2. */
    avisarEnfermera?: boolean;
  } = {},
): RegistroParaEnviar {
  const texto = input.texto?.trim();
  return {
    id: newId(),
    clientId: ctx.clientId,
    controlCode: ALGO_NO_VA_BIEN,
    planItemId: null,
    occurrenceAt: null,
    recordedAt: ctx.recordedAt.toISOString(),
    centerShiftId: ctx.centerShiftId,
    careDay: ctx.careDay,
    valor: {
      tipo: "NOTA",
      ...(input.evento ? { evento: input.evento } : {}),
      ...(input.matiz ? { matiz: input.matiz } : {}),
    },
    nota: texto && texto.length > 0 ? texto : null,
    voz: input.vozBase64 ? { webmBase64: input.vozBase64 } : null,
    ...(input.avisarEnfermera ? { avisarEnfermera: true } : {}),
  };
}

// ── Leer lo que ya está ──────────────────────────────────────────────

/**
 * ¿Está ya registrada la observación de este residente en este turno?
 *
 * Mira **una dimensión cualquiera con `isAsUsual`** entre lo vigente: el
 * gesto escribe las N de una vez, así que con una basta y buscarlas todas
 * sería pedir que las N hayan llegado — y con la cola a medias un gesto
 * entero parecería no haber ocurrido.
 *
 * Devuelve quién y cuándo, que es lo que pinta la franja verde: «Como
 * siempre · lo marcó Ana a las 08:20».
 */
export function observacionDelTurno(
  registros: Array<{
    controlCode: string;
    vigente: boolean;
    firmadoPor: string;
    recordedAt: string;
    valor: unknown;
    /** residencia-6 · lo apuntado por ESTA tablet y que puede no haber
     *  subido. Sale en la franja («· en la tablet») porque «consta» y
     *  «consta aquí» no son lo mismo. */
    enLaTablet?: boolean;
  }>,
  dimensiones: Array<{ code: string; comoSiempre: string }>,
): {
  firmadoPor: string;
  recordedAt: string;
  todoComoSiempre: boolean;
  enLaTablet: boolean;
} | null {
  const codigos = new Set(dimensiones.map((d) => d.code));
  const suyos = registros.filter(
    (r) => r.vigente && codigos.has(r.controlCode),
  );
  if (suyos.length === 0) return null;
  const comoSiempreDe = new Map(dimensiones.map((d) => [d.code, d.comoSiempre]));
  // «Todo como siempre» = ninguna de las registradas se desvía. Es lo que
  // decide si la franja dice «Como siempre» o «No como siempre», y se
  // calcula sobre lo que hay: con cuatro de siete en la cola, lo que se
  // pinta es lo que ya consta.
  const todoComoSiempre = suyos.every((r) => {
    const v = r.valor as { opcion?: unknown } | null;
    return (
      typeof v?.opcion === "string" &&
      v.opcion === comoSiempreDe.get(r.controlCode)
    );
  });
  // El más reciente manda para la frase: si Ana marcó a las 08:20 y la DUE
  // corrigió a las 11:00, lo que la pantalla dice es lo de las 11:00.
  const ultimo = suyos.reduce((a, b) =>
    a.recordedAt >= b.recordedAt ? a : b,
  );
  return {
    firmadoPor: ultimo.firmadoPor,
    recordedAt: ultimo.recordedAt,
    todoComoSiempre,
    // residencia-6 · basta con que UNO de los que sostienen la franja
    // esté sólo en la tablet: entonces la frase todavía no es lo que el
    // relevo va a leer, y eso hay que decirlo.
    enLaTablet: suyos.some((r) => r.enLaTablet === true),
  };
}

/**
 * ¿Está ya hecha esta ocurrencia? Devuelve el registro vigente, o `null`.
 *
 * Compara por `(controlCode, occurrenceAt)`, que es lo que identifica una
 * ocurrencia y es la misma clave que usa el índice del motor. Por eso el
 * `occurrenceAt` viaja en la vista del registro: sin él, la pantalla
 * tendría que adivinar a qué ronda responde un cambio postural y acabaría
 * marcando las tres del turno con la primera.
 *
 * Y mira sólo lo VIGENTE: una fila corregida o anulada no cuenta como
 * hecha, que es lo que permite que «Deshacer el último» devuelva el botón
 * a su sitio.
 */
export function yaHecho<
  T extends {
    controlCode: string;
    vigente: boolean;
    occurrenceAt: string | null;
  },
>(registros: T[], ocurrencia: { controlCode: string; at: string }): T | null {
  return (
    registros.find(
      (r) =>
        r.vigente &&
        r.controlCode === ocurrencia.controlCode &&
        r.occurrenceAt != null &&
        // Se comparan como INSTANTES y no como cadenas: el `at` de
        // `queToca` y el `occurrence_at` que vuelve de Postgres son el
        // mismo momento escrito distinto («…:00.000Z» y «…:00Z»), y
        // compararlos como texto habría pintado como «no hecho» algo que
        // sí está — el peor error posible en esta pantalla, porque lleva a
        // hacer dos veces el mismo cuidado.
        new Date(r.occurrenceAt).getTime() === new Date(ocurrencia.at).getTime(),
    ) ?? null
  );
}
