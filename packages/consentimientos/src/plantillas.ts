// clinica-4 · LAS PLANTILLAS DE CONSENTIMIENTO, VERSIONADAS EN CÓDIGO.
//
// Un consentimiento informado firmado tiene que poder contestar, dentro de
// cinco años, a una pregunta concreta: **qué texto exacto leyó y firmó esta
// persona ese día.** De ahí sale toda la forma de este fichero.
//
// ── Por qué versionadas, y por qué eso no es una tabla ────────────────
//
// Misma razón exacta que `CUESTIONARIO_V1` de clinica-2 y que
// `MAPA_PIE_V1` de clinica-3: la fila firmada guarda la plantilla, SU
// VERSIÓN y la huella de su texto. El día que la podóloga cambie una
// palabra, lo firmado el año pasado sigue leyéndose con las palabras que
// se leyeron, y no con las de hoy. Sin la versión, un consentimiento de
// hace dos años se enseñaría con el texto de ahora — que es decir que el
// paciente firmó algo que no se le puso delante.
//
// Y es dato en CÓDIGO: el editor de plantillas para el centro está FUERA
// DE ALCANCE por el prompt del bloque. Una tabla sin pantalla que la edite
// no es más flexible que una constante: es la misma rigidez con una
// migración de por medio y sin revisión de código. El día que haya
// pantalla, cada constante de aquí pasa a ser la fila `version = 1` y
// `plantillaDe` lee de la base; nada de lo que cuelga de aquí (la huella,
// la vigencia, el PDF) cambia de forma.
//
// ── Estos textos SON DE EJEMPLO y están pendientes de Rosario ─────────
//
// Ella ya usa los suyos en papel. Lo que hay aquí es un punto de partida
// escrito con los contenidos mínimos que pide la Ley 41/2002 (art. 10:
// consecuencias, riesgos, alternativas), marcado con
// `pendienteDeValidar: true` para que nadie lo confunda con texto
// aprobado. La pantalla lo dice y el `-done` lo lista.
//
// ── Comunes, no clínicas ──────────────────────────────────────────────
//
// Este paquete lo usan la clínica y el spa (S3: `ClientConsent` es la
// tabla común, y micropigmentación y láser también piden consentimiento).
// Lo que distingue a una plantilla clínica es la marca `clinica`, y de
// ella salen las dos reglas que no valen para el spa: el PDF pasa por el
// control de acceso de la historia, y el informante tiene que ser
// sanitario.

/** Los ids son ESTABLES: viajan en la fila firmada para siempre. */
export type PlantillaId =
  | "cirugia-ungueal"
  | "anestesia-local"
  | "fotos-clinicas"
  // historia-1 (D-95) · las dos de la residencia. Mismo mecanismo, sin
  // tocar una línea de clinica-4: ver `ClaseDeConsentimiento` más abajo.
  | "proteccion-datos-residente"
  | "imagen-residente";

/**
 * QUÉ hace que esta plantilla se pida.
 *
 * `SERVICIO`: la dueña la marca en el servicio del catálogo y la sesión de
 * ese servicio no empieza sin ella (decisión 4 y 7 del prompt).
 *
 * `PRIMERA_FOTO`: no se ata a ningún servicio — la pide la primera foto
 * del paciente, y por eso **no sale en la lista del catálogo**. Atarla a
 * un servicio habría significado que una paciente a la que se le hace una
 * foto en una quiropodia normal no tuviera consentimiento de fotos.
 */
export type DisparadorDePlantilla =
  | "SERVICIO"
  | "PRIMERA_FOTO"
  /**
   * historia-1 (D-94, D-95) · **LO PIDE EL INGRESO** de un residente.
   *
   * No se ata a ningún servicio del catálogo —una residencia no vende
   * servicios— y no sale en la lista del catálogo de la clínica. La pide
   * la lista del ingreso guiado, que es la que sabe que falta.
   */
  | "INGRESO_RESIDENTE";

/**
 * historia-1 (D-95) · **DE QUÉ CLASE ES LA FILA QUE SE ESCRIBE.**
 *
 * Es el único campo que hacía falta para que las plantillas de residencia
 * reutilicen el mecanismo de clinica-4 sin tocarlo: `firmar` escribía
 * `kind: "TREATMENT"` fijo, y una protección de datos no es un
 * tratamiento.
 *
 * Los tres valores son los de `ClientConsentKind` en la base. Se repiten
 * aquí como unión de cadenas y no se importan de `@mipiacetpv/db` porque
 * **este paquete es puro**: ni Prisma, ni Fastify, ni reloj (ver
 * `index.ts`). Un test fija que las dos listas no se separen.
 */
export type ClaseDeConsentimiento = "TREATMENT" | "DATA" | "IMAGE";

export interface PlantillaDeConsentimiento {
  id: PlantillaId;
  /** Sube de uno en uno. Nunca se reescribe una versión publicada. */
  version: number;
  /** El título, tal como lo lee el paciente y como sale en el PDF. */
  titulo: string;
  /** El cuerpo, en párrafos. Es el texto que se firma. */
  parrafos: readonly string[];
  /**
   * `true` = contenido mínimo de la historia clínica (Ley 41/2002 art.
   * 15.2). La fila firmada copia esta marca, y de ella salen las dos
   * reglas de S3: abrir el PDF pasa por `conHistoria` y deja su línea en
   * el registro de accesos, y el informante tiene que ser sanitario.
   */
  clinica: boolean;
  disparador: DisparadorDePlantilla;
  /** `true` mientras el texto no lo haya validado la profesional. */
  pendienteDeValidar: boolean;
  /**
   * historia-1 (D-95) · qué `kind` lleva la fila de `client_consents`.
   *
   * **Opcional, y sin él se escribe `TREATMENT`**: es lo que las tres
   * plantillas de clinica-4 ya hacían, así que nada de lo firmado antes
   * cambia de significado por este campo.
   */
  kind?: ClaseDeConsentimiento;
}

const CIRUGIA_UNGUEAL_V1: PlantillaDeConsentimiento = {
  id: "cirugia-ungueal",
  version: 1,
  titulo: "Consentimiento para cirugía de uña (matricectomía)",
  parrafos: [
    "Se me ha explicado en qué consiste la cirugía parcial de la uña: se retira la parte de la uña que se está clavando y, si hace falta, se trata la zona de la que nace para que no vuelva a crecer torcida.",
    "Se me ha explicado que se hace con anestesia local en el dedo, que después tendré que llevar un vendaje y venir a las revisiones que me indiquen, y que durante unos días puedo tener molestias.",
    "Se me han explicado los riesgos: infección de la zona, sangrado, que la uña vuelva a clavarse con el tiempo, que la uña quede más estrecha, y molestias al apoyar durante unos días.",
    "Se me han explicado las alternativas: seguir con tratamientos sin cirugía (cortes y curas periódicas), sabiendo que en mi caso no han resuelto el problema.",
    "He podido preguntar todo lo que quería y entiendo las respuestas. Sé que puedo retirar este consentimiento en cualquier momento, antes o después de firmarlo, sin tener que dar explicaciones.",
  ],
  clinica: true,
  disparador: "SERVICIO",
  pendienteDeValidar: true,
};

const ANESTESIA_LOCAL_V1: PlantillaDeConsentimiento = {
  id: "anestesia-local",
  version: 1,
  titulo: "Consentimiento para anestesia local",
  parrafos: [
    "Autorizo la aplicación de anestesia local en el pie para el tratamiento que se me ha explicado.",
    "Se me ha preguntado por las alergias que tengo, por la medicación que tomo —en especial si tomo algo para que la sangre no coagule— y por si me ha pasado algo alguna vez con una anestesia.",
    "Se me ha explicado que la zona se quedará dormida un par de horas, que después puede dolerme al pasar el efecto, y que, aunque es poco frecuente, puede haber mareo, hematoma en el punto del pinchazo o una reacción al anestésico.",
    "He podido preguntar todo lo que quería y entiendo las respuestas. Sé que puedo retirar este consentimiento en cualquier momento.",
  ],
  clinica: true,
  disparador: "SERVICIO",
  pendienteDeValidar: true,
};

const FOTOS_CLINICAS_V1: PlantillaDeConsentimiento = {
  id: "fotos-clinicas",
  version: 1,
  titulo: "Consentimiento para hacer fotos de mi historia clínica",
  parrafos: [
    "Autorizo que se hagan fotos de mis pies para seguir cómo va el tratamiento y poder comparar cómo estaban antes y cómo están ahora.",
    "Se me ha explicado que las fotos forman parte de mi historia clínica, que las ve sólo el personal sanitario que me atiende, y que no se usan para nada más: ni para enseñarlas a otras personas, ni para publicarlas, ni para docencia ni para publicidad.",
    "Se me ha explicado que las fotos no se guardan en el móvil ni en la galería de la tablet, y que cada vez que alguien las abre queda registrado quién lo hizo y cuándo.",
    "Sé que puedo retirar este consentimiento en cualquier momento. Las fotos que ya estén hechas se conservan como parte de la historia, que por ley no se borra, pero no se harán más.",
  ],
  clinica: true,
  disparador: "PRIMERA_FOTO",
  pendienteDeValidar: true,
};

// ── historia-1 (D-95) · LAS DOS DE LA RESIDENCIA ─────────────────────
//
// «Protección de datos del residente» e «imagen del residente»,
// versionadas y con `pendienteDeValidar: true` como las tres de la
// clínica: son un punto de partida escrito con los contenidos mínimos del
// RGPD (arts. 13 y 7) y la LOPDGDD, **no texto aprobado por un jurista**.
// La pantalla lo dice y el `-done` lo lista.
//
// ── Por qué `clinica: false` en las dos ────────────────────────────
//
// `clinica` significa «contenido mínimo de la historia clínica» (Ley
// 41/2002 art. 15.2), y de ella cuelgan dos reglas de clinica-4: el PDF
// pasa por `conHistoria` y **el informante tiene que ser sanitario**.
//
// Ninguna de las dos es historia clínica: una es la información del
// tratamiento de datos y la otra el permiso para que su cara se pinte en
// una tablet. Y la segunda regla es la que decide: **quien informa de la
// protección de datos de un ingreso es la administrativa del centro**, no
// la DUE. Con `clinica: true`, la plantilla que D-94 pone en la lista de
// todo ingreso sólo la podría firmar personal sanitario, y entonces los
// ingresos se quedarían esperando a que pase la DUE.
//
// Hoy en el Drive de Jardín de Gredos hay **cero** consentimientos
// individuales de datos (`03` §7). Lo que no se puede permitir es que el
// producto los siga dejando a cero por una marca.

const PROTECCION_DATOS_RESIDENTE_V1: PlantillaDeConsentimiento = {
  id: "proteccion-datos-residente",
  version: 1,
  titulo: "Información y consentimiento sobre el tratamiento de mis datos",
  parrafos: [
    "Se me ha informado de que la residencia va a tratar mis datos personales y los de mi salud para poder atenderme: para organizar mis cuidados, para registrar lo que se me hace cada día, para gestionar mi estancia y para cumplir con lo que la ley y la administración le piden al centro.",
    "Se me ha informado de que mis datos de salud los ve sólo el personal que me atiende, y que cada vez que alguien abre mi historia queda registrado quién lo hizo y cuándo.",
    "Se me ha informado de a quién se comunican mis datos cuando hace falta: a la administración sanitaria y a los servicios sociales en lo que la ley obliga, al hospital o al centro de salud cuando me derivan, y a la persona que yo designe como familiar responsable.",
    "Se me ha informado de que mi historia se conserva al menos cinco años, porque la ley lo exige (Ley 41/2002), y de que eso no depende de que yo retire este consentimiento.",
    "Se me ha informado de que puedo pedir ver mis datos, corregirlos, limitarlos u oponerme a algunos usos, y de que puedo hacerlo en la dirección del centro o ante la Agencia Española de Protección de Datos.",
    "He podido preguntar todo lo que quería y entiendo las respuestas.",
  ],
  clinica: false,
  disparador: "INGRESO_RESIDENTE",
  pendienteDeValidar: true,
  kind: "DATA",
};

const IMAGEN_RESIDENTE_V1: PlantillaDeConsentimiento = {
  id: "imagen-residente",
  version: 1,
  titulo: "Consentimiento para que mi foto se vea en el centro",
  parrafos: [
    "Autorizo que mi fotografía se guarde en mi ficha y se muestre en las pantallas que el personal usa en la puerta de mi habitación, para que quien venga a atenderme sepa quién soy — en especial si es alguien que me sustituye o que no me conoce todavía.",
    "Se me ha explicado que esa pantalla está en el pasillo y que, mientras alguien la está usando, mi foto la puede ver cualquiera que pase por delante.",
    "Se me ha explicado que la foto NO se usa para nada más: ni en la página web del centro, ni en folletos, ni en redes sociales, ni para enseñarla a visitantes, ni para ninguna clase de publicidad.",
    "Se me ha explicado que la foto no se guarda en el móvil de nadie ni en la galería de la tablet.",
    "Sé que puedo retirar este consentimiento en cualquier momento y sin dar explicaciones, y que desde ese momento la pantalla deja de mostrar mi foto y muestra sólo mis iniciales.",
  ],
  clinica: false,
  disparador: "INGRESO_RESIDENTE",
  pendienteDeValidar: true,
  kind: "IMAGE",
};

/**
 * Todas las versiones que este despliegue sabe leer.
 *
 * **Nunca se quita una**: una fila firmada apunta a su versión para
 * siempre, y quitarla de aquí es dejar un consentimiento que no se puede
 * volver a enseñar. Es la misma regla que `VERSIONES` del cuestionario.
 */
const VERSIONES: readonly PlantillaDeConsentimiento[] = [
  CIRUGIA_UNGUEAL_V1,
  ANESTESIA_LOCAL_V1,
  FOTOS_CLINICAS_V1,
  PROTECCION_DATOS_RESIDENTE_V1,
  IMAGEN_RESIDENTE_V1,
];

/** Las vigentes, una por id: lo que se ofrece hoy para firmar. */
export const PLANTILLAS_VIGENTES: readonly PlantillaDeConsentimiento[] = [
  CIRUGIA_UNGUEAL_V1,
  ANESTESIA_LOCAL_V1,
  FOTOS_CLINICAS_V1,
  PROTECCION_DATOS_RESIDENTE_V1,
  IMAGEN_RESIDENTE_V1,
];

/**
 * historia-1 (D-94, D-95) · las que pide el ingreso de un residente.
 *
 * Las mira la lista del ingreso guiado. Se derivan del disparador y no se
 * escriben a mano por lo mismo que `PLANTILLAS_DE_SERVICIO`: una
 * plantilla nueva con `INGRESO_RESIDENTE` entra en el ingreso sola.
 */
export const PLANTILLAS_DEL_INGRESO: readonly PlantillaId[] =
  PLANTILLAS_VIGENTES.filter((p) => p.disparador === "INGRESO_RESIDENTE").map(
    (p) => p.id,
  );

/**
 * El `kind` de `client_consents` que le toca a una plantilla.
 *
 * **`TREATMENT` cuando no lo dice**, que es lo que las tres de clinica-4
 * hacían: nada de lo firmado antes cambia de significado.
 */
export function claseDeLaPlantilla(
  plantilla: PlantillaDeConsentimiento,
): ClaseDeConsentimiento {
  return plantilla.kind ?? "TREATMENT";
}

export const PLANTILLA_DE_FOTOS: PlantillaId = "fotos-clinicas";

/** Los ids que la dueña puede atar a un servicio del catálogo. */
export const PLANTILLAS_DE_SERVICIO: readonly PlantillaId[] =
  PLANTILLAS_VIGENTES.filter((p) => p.disparador === "SERVICIO").map((p) => p.id);

/** Todos los ids, para validar lo que llega por una ruta. */
export const PLANTILLAS_IDS: readonly PlantillaId[] = PLANTILLAS_VIGENTES.map(
  (p) => p.id,
);

/**
 * La plantilla con la que se firmó. `undefined` para una versión que este
 * despliegue no conoce.
 *
 * Y lo que NO se hace nunca es caer a «la de ahora»: enseñar un
 * consentimiento firmado con el texto vigente es afirmar que el paciente
 * leyó un texto que no existía. Quien llama decide qué hacer con el hueco
 * — en la pantalla se enseña la huella y la fecha, que es verdad.
 */
export function plantillaDe(
  id: string,
  version: number,
): PlantillaDeConsentimiento | undefined {
  return VERSIONES.find((p) => p.id === id && p.version === version);
}

/** La vigente de un id, la que se firma hoy. */
export function plantillaVigente(
  id: string,
): PlantillaDeConsentimiento | undefined {
  return PLANTILLAS_VIGENTES.find((p) => p.id === id);
}

/**
 * EL TEXTO EXACTO QUE SE FIRMA, en una sola cadena.
 *
 * Es lo que se le pone delante al paciente, lo que va al PDF y lo que se
 * hashea para la columna `text_hash`. **Una sola función para los tres**,
 * y no es cosmético: con dos formas de armar el texto, la huella guardada
 * dejaría de cuadrar con lo que la pantalla enseña, y entonces la huella
 * no demuestra nada.
 *
 * El formato (título, línea en blanco, párrafos separados por una línea en
 * blanco) es parte del contrato de la huella: cambiarlo cambia la huella
 * de todas las plantillas, y eso sólo se hace sacando versiones nuevas.
 */
export function textoCanonico(plantilla: PlantillaDeConsentimiento): string {
  return [plantilla.titulo, ...plantilla.parrafos].join("\n\n");
}
