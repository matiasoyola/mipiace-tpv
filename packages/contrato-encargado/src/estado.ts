// clinica-7 · EL ESTADO DEL MÓDULO CLÍNICO, EN UNA SOLA FUNCIÓN PURA.
//
// Decisión 4 del prompt, y el «una sola» es lo que importa: de este estado
// cuelgan **cuatro comportamientos distintos** (la 404 del gate, la
// pantalla de aceptación, el 423 de las escrituras y la banda de solo
// lectura) en **tres capas** (la API, el TPV y el panel). Con una copia
// por capa, la pantalla diría «puedes escribir» sobre algo que el servidor
// considera revocado — que es exactamente el fallo que clinica-4 evitó
// sacando la vigencia de los consentimientos a una función pura, y por la
// misma razón: *la pantalla ayuda, la ruta garantiza, y las dos tienen que
// decir lo mismo.*
//
// Sin Prisma, sin Fastify, sin React y sin `node:crypto`: entra la fila
// del tenant y las filas del contrato, sale el estado. Así se puede probar
// cada caso sin base de datos, y es lo que el prompt pide ver en rojo.
//
// ── Los cuatro casos y qué los distingue ─────────────────────────────
//
//   APAGADO        `clinicalRecordsEnabled = false`. La 404 de clinica-1,
//                  sin cambios. No se mira ni una fila de contrato: un bar
//                  no tiene contrato de encargado que aceptar.
//   SIN_CONTRATO   encendido y NUNCA aceptado. Ni una ruta clínica
//                  contesta con datos. La dueña ve la pantalla de
//                  aceptación; el resto, el aviso.
//   VIGENTE        aceptada la versión de hoy y sin revocar. Todo como
//                  ayer.
//   SOLO_LECTURA   revocado, o aceptada solo una versión anterior. Se lee
//                  y se exporta todo; no se escribe nada.
//
// ── Por qué SOLO_LECTURA y no un apagado ─────────────────────────────
//
// Regla de Matías (14-10): «lo que lea está recogido con lo que aceptó
// hasta ese momento». Lo que hay en la historia se escribió con el
// contrato aceptado, así que leerlo es legítimo — y además la clínica
// TIENE QUE poder leerlo: la Ley 41/2002 la obliga a conservar la historia
// cinco años y a dársela al paciente que la pida. Apagar la lectura al
// revocar convertiría una revocación administrativa en una infracción
// sanitaria.
//
// Escribir es otra cosa: datos de salud nuevos sin contrato de encargado
// vigente es justo lo que el art. 28.3 prohíbe.
//
// ── Y por qué «una versión anterior» cae en SOLO_LECTURA ─────────────
//
// Porque es el mismo caso. Si la v2 cambia lo que Mi Piace promete hacer
// con los datos, lo que la clínica aceptó fue la v1 — y la v1 no cubre
// tratamientos nuevos bajo reglas nuevas. Lo recogido con la v1 se lee; lo
// que entre a partir de ahora necesita que alguien acepte la v2. Es la
// forma que tiene este mecanismo de no quedarse nunca «medio aceptado».

/** El estado, con el motivo cuando hay más de uno posible. */
export type EstadoDelModuloClinico =
  | { estado: "APAGADO" }
  | { estado: "SIN_CONTRATO" }
  | { estado: "VIGENTE"; versionAceptada: number }
  | {
      estado: "SOLO_LECTURA";
      motivo: "REVOCADO" | "VERSION_ANTIGUA";
      /** La versión viva más alta, cuando el motivo es `VERSION_ANTIGUA`.
       *  `null` cuando todo está revocado. */
      versionAceptada: number | null;
    };

export type NombreDelEstado = EstadoDelModuloClinico["estado"];

/**
 * Una fila de `clinical_processor_agreements`, con lo mínimo que la cuenta
 * necesita.
 *
 * **Aceptar y revocar son filas del mismo tipo**, y las distingue
 * `revokesAgreementId`: con valor, es una revocación y apunta a la
 * aceptación que revoca; sin valor, es una aceptación. Es el mecanismo de
 * `ClientConsent.revokesConsentId` de clinica-4, y por la misma razón: la
 * tabla es de solo inserción, así que revocar no puede ser un UPDATE.
 */
export interface FilaDelContrato {
  id: string;
  version: number;
  /** `null` en una aceptación; el id de la aceptación que revoca en una
   *  revocación. */
  revokesAgreementId: string | null;
}

export interface EntradaDelEstado {
  /** La capability del tenant (`Tenant.clinicalRecordsEnabled`). */
  clinicaEncendida: boolean;
  /** TODAS las filas del contrato de este tenant, aceptaciones y
   *  revocaciones, en cualquier orden. El orden no importa: lo que decide
   *  es a qué apunta cada revocación, no cuándo llegó. */
  filas: readonly FilaDelContrato[];
  /** La versión que se acepta hoy (`VERSION_VIGENTE`). */
  versionVigente: number;
}

/**
 * EL estado del módulo clínico de un tenant.
 *
 * Una aceptación está VIVA cuando ninguna revocación la apunta. Volver a
 * aceptar después de revocar es una aceptación nueva, viva, y entonces el
 * estado vuelve a `VIGENTE` — sin que nadie haya editado ninguna fila.
 */
export function estadoDelModuloClinico(
  entrada: EntradaDelEstado,
): EstadoDelModuloClinico {
  // Lo primero, y sin mirar ninguna fila: un tenant sin el módulo no tiene
  // contrato que aceptar, y la respuesta es la 404 de clinica-1.
  if (!entrada.clinicaEncendida) return { estado: "APAGADO" };

  const revocadas = new Set<string>();
  for (const fila of entrada.filas) {
    if (fila.revokesAgreementId != null) revocadas.add(fila.revokesAgreementId);
  }

  const aceptaciones = entrada.filas.filter((f) => f.revokesAgreementId == null);
  if (aceptaciones.length === 0) return { estado: "SIN_CONTRATO" };

  const vivas = aceptaciones.filter((a) => !revocadas.has(a.id));

  // Había aceptaciones y ninguna sigue viva: revocado.
  if (vivas.length === 0) {
    return { estado: "SOLO_LECTURA", motivo: "REVOCADO", versionAceptada: null };
  }

  // De las vivas manda la más alta: con la v2 viva, que la v1 también lo
  // esté no quita nada.
  const masAlta = vivas.reduce(
    (max, a) => (a.version > max ? a.version : max),
    vivas[0]!.version,
  );

  // `>=` y no `===`: una aceptación de una versión que este despliegue no
  // conoce todavía (un rollback de la API con filas ya escritas) es más
  // nueva que la vigente, y lo que NO puede hacer es caer en «versión
  // antigua» y bloquear las escrituras de una clínica que aceptó más de lo
  // que se le pedía.
  if (masAlta >= entrada.versionVigente) {
    return { estado: "VIGENTE", versionAceptada: masAlta };
  }

  return {
    estado: "SOLO_LECTURA",
    motivo: "VERSION_ANTIGUA",
    versionAceptada: masAlta,
  };
}

// ── Lo que cuelga del estado, y cuelga AQUÍ ──────────────────────────
//
// Cuatro predicados en vez de cuatro `switch` repartidos. El día que
// aparezca un quinto estado, el compilador obliga a decidir qué hace cada
// predicado con él; con `switch` sueltos por la aplicación, el caso nuevo
// se cuela por el `default` de cada uno y nadie lo ve.

/**
 * ¿Se puede LEER la historia clínica?
 *
 * Sí con el contrato vigente y sí en solo lectura. No sin contrato: lo que
 * se haya podido escribir antes de que existiera este mecanismo no se
 * enseña hasta que alguien acepte, porque es la primera vez que se
 * pregunta y la respuesta prudente es no.
 */
export function permiteLeerHistoria(e: EstadoDelModuloClinico): boolean {
  return e.estado === "VIGENTE" || e.estado === "SOLO_LECTURA";
}

/** ¿Se puede ESCRIBIR algo clínico? Solo con el contrato vigente. */
export function permiteEscribirHistoria(e: EstadoDelModuloClinico): boolean {
  return e.estado === "VIGENTE";
}

/**
 * ¿Una cita NUEVA admite notas libres?
 *
 * Decisión 5: con el contrato no vigente, en un tenant clínico, las citas
 * nuevas no admiten `Appointment.notes` — solo hora, paciente y servicio.
 * Las notas que ya existen se siguen viendo.
 *
 * `APAGADO` dice **sí**, y no es una excepción: un tenant sin el módulo
 * clínico no tiene este mecanismo encima, y la agenda del bar de la
 * esquina sigue teniendo su campo de notas como ayer. Lo que esta función
 * contesta es «en ESTA agenda, hoy, ¿se puede escribir texto libre?».
 */
export function admiteNotasEnCita(e: EstadoDelModuloClinico): boolean {
  return e.estado === "APAGADO" || e.estado === "VIGENTE";
}

/**
 * ¿Hay que enseñar la banda de solo lectura en las pantallas clínicas?
 *
 * Solo en `SOLO_LECTURA`. `SIN_CONTRATO` no lleva banda: lleva la pantalla
 * de aceptación completa, que no es un aviso sobre una pantalla que
 * funciona a medias.
 */
export function enseñaBandaDeSoloLectura(e: EstadoDelModuloClinico): boolean {
  return e.estado === "SOLO_LECTURA";
}

// ── Los textos, y viven aquí por lo mismo que el contrato ────────────
//
// Son los dos textos que la decisión 2 y la decisión 5 citan palabra por
// palabra. En el código de una pantalla serían dos textos que nadie
// versiona y que la siguiente pantalla copia y cambia una coma.

/** Lo que ve quien NO es la dueña con el contrato sin aceptar. */
export const AVISO_SOLO_LA_DUENA =
  "La dueña tiene que aceptar el contrato de tratamiento de datos antes de usar la historia clínica.";

/** La banda fija de las pantallas clínicas en solo lectura. */
export const BANDA_SOLO_LECTURA =
  "Historia clínica en solo lectura: el contrato de tratamiento no está vigente.";

/** El código y el mensaje del 423 de las escrituras. Uno solo para todas
 *  las rutas de escritura: con uno por ruta, el día que alguien ajuste el
 *  de una, dos rutas dirían cosas distintas del mismo estado. */
export const CODIGO_CONTRATO_NO_VIGENTE = "CONTRATO_ENCARGADO_NO_VIGENTE";

export const MENSAJE_CONTRATO_NO_VIGENTE =
  "La historia clínica está en solo lectura: el contrato de tratamiento de datos no está vigente. Se puede leer y exportar todo; para escribir, la dueña tiene que aceptarlo en Ajustes › Contrato de tratamiento de datos.";

/** El del 409 de aceptar sin ser la dueña. */
export const CODIGO_SOLO_LA_DUENA = "SOLO_LA_DUENA_ACEPTA";
