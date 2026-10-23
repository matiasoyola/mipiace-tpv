// clinica-7 · EL CONTRATO DE ENCARGADO DEL TRATAMIENTO, VERSIONADO EN CÓDIGO.
//
// Mi Piace es **encargado del tratamiento de datos de salud** de cada
// clínica (art. 28 RGPD). El art. 28.3 exige que esa relación esté en un
// contrato, y lo que este fichero guarda es **el texto exacto de ese
// contrato, por versión**, para poder contestar dentro de cinco años a la
// misma pregunta que contestan los consentimientos de clinica-4: **qué
// texto exacto aceptó esta persona ese día.**
//
// ── Mismo patrón que `packages/consentimientos`, a propósito ──────────
//
// Versión, texto en párrafos, `textoCanonico` único, huella SHA-256
// FIJADA POR TEST, `pendienteDeValidar`. No es imitación: es que el
// problema es el mismo. Una fila de aceptación guarda la versión y la
// huella del texto; si el texto se reescribiera en su sitio, la fila
// seguiría diciendo «aceptó la v1» y la v1 sería otra cosa — y entonces la
// huella no demuestra nada.
//
// Y la huella la calcula quien tiene `node:crypto` (la API), no este
// paquete: lo que el paquete garantiza es que **el texto que se hashea es
// uno solo**. Dos formas de armar el texto son dos huellas, y la que no
// cuadre será la de alguien que cambió el texto sin que nadie lo sepa.
//
// ── ESTE TEXTO ES DE EJEMPLO Y ESTÁ PENDIENTE DEL ABOGADO ────────────
//
// `pendienteDeValidar: true`. Lo que hay es un punto de partida con **los
// mínimos del art. 28.3 RGPD** (las ocho letras, el objeto, la duración,
// la naturaleza y el fin, el tipo de datos y las categorías de
// interesados), escrito en la lengua que Rosario lee y no en la de un
// despacho. La v1 de verdad la entrega Dirección en
// `docs/clinica/contrato-encargado-v1.md`; cuando llegue entra como
// **versión 2**, no reescribiendo la 1 — hay un test que fija la huella de
// cada versión justamente para eso.
//
// Mientras `pendienteDeValidar` sea `true`, la pantalla de aceptación
// enseña un aviso ámbar. La dueña puede aceptar igual: sin aceptación no
// se escribe nada clínico, y dejarla sin poder aceptar sería dejar la
// clínica sin historia hasta que vuelva el abogado.
//
// ── El texto NO se escribe en el código de pantallas ─────────────────
//
// Misma regla que la declaración responsable y que las plantillas de
// consentimiento. Una pantalla que lleve el texto dentro es un texto que
// nadie versiona, que no se puede hashear y del que no se puede sacar un
// PDF igual al que se aceptó.

/** Lo que una versión del contrato es. */
export interface VersionDelContrato {
  /** Sube de uno en uno. **Nunca se reescribe una versión publicada.** */
  version: number;
  /** El título, tal como se lee en pantalla y como sale en el PDF. */
  titulo: string;
  /** El cuerpo, en apartados. Es el texto que se acepta. */
  apartados: readonly ApartadoDelContrato[];
  /** `true` mientras el texto no lo haya revisado un abogado. */
  pendienteDeValidar: boolean;
}

/** Un apartado con su encabezado. Los encabezados son parte del texto
 *  canónico: quitarlos cambia la huella. */
export interface ApartadoDelContrato {
  encabezado: string;
  parrafos: readonly string[];
}

// ── v1 · DE EJEMPLO, pendiente del abogado ───────────────────────────
//
// El orden de los apartados sigue el del art. 28.3: primero lo que el
// apartado exige nombrar (objeto, duración, naturaleza, fin, tipo de
// datos, categorías de interesados) y después las ocho letras a)…h), cada
// una en su apartado y nombrada, para que el día que el abogado tache algo
// se vea exactamente qué letra queda sin cubrir.
const CONTRATO_V1: VersionDelContrato = {
  version: 1,
  titulo:
    "Contrato de encargado del tratamiento de datos de salud (art. 28 RGPD)",
  apartados: [
    {
      encabezado: "Quiénes somos cada uno",
      parrafos: [
        "La clínica es la RESPONSABLE de la historia clínica de sus pacientes: decide qué se guarda, para qué y durante cuánto tiempo. Mi Piace Software, S.L. es el ENCARGADO: pone el programa y los servidores donde esa historia se guarda, y la trata únicamente porque la clínica se lo encarga.",
        "Mi Piace no es dueña de ninguna historia clínica, no la usa para nada propio y no decide nada sobre ella. Todo lo que hace con esos datos lo hace porque está escrito aquí o porque la clínica se lo pide por escrito.",
      ],
    },
    {
      encabezado: "Qué datos, de quién, para qué y durante cuánto",
      parrafos: [
        "OBJETO Y FIN: dar servicio al módulo de historia clínica del programa de Mi Piace — guardar, enseñar y copiar la historia que la clínica escribe, y nada más.",
        "NATURALEZA DEL TRATAMIENTO: guardar, consultar, copiar en seguridad, cifrar, enseñar a quien la clínica autoriza, exportar cuando la clínica lo pide y borrar cuando la clínica lo ordena.",
        "TIPO DE DATOS: datos de salud (categoría especial del art. 9 RGPD) — valoraciones, anotaciones de la historia, exploraciones, sesiones de tratamiento, fotos clínicas, consentimientos firmados e informes — junto a los datos de identificación y contacto que hacen falta para saber de quién es cada historia.",
        "CATEGORÍAS DE INTERESADOS: los pacientes de la clínica y, cuando firma un representante, la persona que firma por ellos.",
        "DURACIÓN: mientras la clínica tenga el módulo de historia clínica contratado. Al terminar se aplica el apartado de devolución y destrucción.",
      ],
    },
    {
      encabezado: "a) Solo lo que la clínica ordene",
      parrafos: [
        "Mi Piace trata los datos de salud únicamente siguiendo las instrucciones documentadas de la clínica. Las instrucciones permanentes son este contrato y el funcionamiento normal del programa; cualquier otra se pide y se da por escrito.",
        "Si una instrucción de la clínica infringe la normativa de protección de datos, Mi Piace lo dice de inmediato y no la ejecuta.",
      ],
    },
    {
      encabezado: "b) Quien puede ver algo se ha comprometido a callar",
      parrafos: [
        "Las personas de Mi Piace que puedan acceder a los sistemas están obligadas a confidencialidad por escrito, y esa obligación sigue después de que dejen la empresa.",
        "Y además: el programa está construido para que Mi Piace NO PUEDA LEER una historia clínica. Las historias se guardan cifradas con una clave por clínica, el personal de soporte no tiene ninguna ruta ni ninguna pantalla que abra una historia, y lanzar consultas contra la base de datos de producción devuelve texto cifrado. Lo que aquí se promete no depende de que nadie se porte bien.",
      ],
    },
    {
      encabezado: "c) Las medidas de seguridad (art. 32)",
      parrafos: [
        "Las historias clínicas se cifran antes de guardarse, con una clave distinta para cada clínica. Las fotos, los consentimientos firmados y los informes se cifran también en el disco.",
        "Las copias de seguridad se cifran con una clave pública: el servidor puede hacer copias y no puede abrirlas. La clave que las abre se guarda fuera del servidor.",
        "Cada vez que alguien abre una historia queda registrado quién, cuándo, desde qué aparato y qué abrió. Ese registro no se puede editar ni borrar, ni desde el programa ni desde la base de datos.",
        "Solo el personal sanitario que la clínica autoriza ve la historia de un paciente. Las contraseñas y las sesiones caducan, los aparatos se dan de alta uno a uno y se pueden revocar.",
      ],
    },
    {
      encabezado: "d) Si hace falta otro proveedor",
      parrafos: [
        "Mi Piace no mete a nadie más a tratar datos de salud sin avisar antes a la clínica por escrito, con tiempo para que pueda oponerse.",
        "A quien entre se le exige por contrato lo mismo que Mi Piace promete aquí, y Mi Piace sigue respondiendo ante la clínica de lo que ese proveedor haga.",
      ],
    },
    {
      encabezado: "e) Cuando un paciente ejerce sus derechos",
      parrafos: [
        "Los derechos de los pacientes los atiende la clínica: es la responsable. Mi Piace la ayuda con lo que el programa puede dar — sacar la historia completa de un paciente en PDF y en formato legible por máquina, enseñar quién ha accedido a ella, y bloquearla o borrarla cuando la clínica lo ordene.",
        "Si un paciente se dirige a Mi Piace, Mi Piace no le contesta sobre su historia: se lo traslada a la clínica sin demora.",
      ],
    },
    {
      encabezado: "f) Brechas, evaluaciones y consultas",
      parrafos: [
        "Si Mi Piace detecta una brecha de seguridad que afecte a datos de salud, avisa a la clínica SIN DEMORA INDEBIDA y en todo caso dentro de las 24 horas siguientes a conocerla, con lo que se sepa: qué ha pasado, a qué datos afecta, qué consecuencias puede tener y qué se está haciendo. La notificación a la autoridad de control la hace la clínica, que es la responsable.",
        "Mi Piace entrega a la clínica la información técnica que necesite para su evaluación de impacto y para cualquier consulta previa a la autoridad de control.",
      ],
    },
    {
      encabezado: "g) Devolución y destrucción al terminar",
      parrafos: [
        "Al terminar el servicio, la clínica elige: que Mi Piace le DEVUELVA todos los datos de salud, o que los DESTRUYA. Lo normal es devolverlos y después destruirlos.",
        "La devolución es un paquete descargable con la historia completa de cada paciente en PDF, sus fotos y sus consentimientos descifrados, y los mismos datos en un fichero legible por máquina. Lo saca la dueña desde el programa y queda registrado.",
        "La destrucción se hace borrando la clave de cifrado de esa clínica. Con ella borrada, lo que quede en el servidor y en cualquier copia de seguridad anterior deja de poder leerse, también las copias de meses pasados. Es irreversible y por eso hace falta la orden de la clínica.",
        "Lo que la clínica tenga que conservar por ley (la historia clínica, cinco años como mínimo desde el alta de cada proceso) no se destruye hasta que ella lo ordene: cumplir ese plazo es su obligación, y Mi Piace no borra una historia por su cuenta.",
      ],
    },
    {
      encabezado: "h) Demostrarlo y dejarse auditar",
      parrafos: [
        "Mi Piace pone a disposición de la clínica la información necesaria para demostrar que cumple lo de aquí, y se somete a las auditorías o inspecciones que la clínica quiera encargar, avisando con antelación razonable.",
        "La clínica puede pedir en cualquier momento el registro de accesos a las historias de sus pacientes, y verlo desde el propio programa.",
      ],
    },
    {
      encabezado: "Qué pasa si esto se revoca",
      parrafos: [
        "La clínica puede revocar esta aceptación cuando quiera, desde el propio programa. Al revocarla, la historia clínica pasa a SOLO LECTURA: se sigue pudiendo leer, imprimir y exportar todo lo que ya hay, y no se puede escribir nada nuevo.",
        "Se lee todo porque lo que hay se recogió con el contrato aceptado; no se escribe nada porque escribir datos de salud sin contrato de encargado es justo lo que el art. 28 prohíbe.",
        "La agenda y la caja siguen funcionando. Lo único que cambia fuera de la historia es que las citas nuevas no admiten notas escritas a mano: solo hora, paciente y servicio.",
      ],
    },
  ],
  pendienteDeValidar: true,
};

// ── v2 · LA RAZÓN SOCIAL DE VERDAD (clinica-8) ───────────────────────
//
// La v1 nombraba como encargado a «Mi Piace Software, S.L.», que **no
// existe**: es un nombre comercial que se coló en el texto. La sociedad que
// firma es Mi Piace Internet Solutions SL, con su NIF y su domicilio. Lo
// encontró la auditoría del 18-10, y en un contrato de encargado del art. 28
// la identidad de las partes no es un detalle de estilo: es lo que hace que
// el contrato sea de alguien.
//
// ── Por qué una VERSIÓN NUEVA y no un retoque de la v1 ──────────────
//
// Porque la v1 **ya está aceptada y firmada** por la «Clínica demo», con su
// fecha y su huella SHA-256 guardadas. Corregir su texto cambiaría la huella
// de una aceptación que ya ocurrió: la pantalla enseñaría un texto que la
// dueña no vio y la huella guardada dejaría de cuadrar con él. La v1 se
// queda intacta y para siempre en `VERSIONES`; lo que cambia es cuál se
// acepta hoy. Quien aceptó la v1 pasa a «hay una versión nueva» y la vuelve
// a aceptar, que es exactamente para lo que existe el versionado.
//
// ── Y por qué se construye DESDE la v1 ──────────────────────────────
//
// Sólo cambia el primer apartado. Copiar los otros diez a mano sería abrir
// la puerta a que una coma se moviera sin que nadie lo notara — y con la
// huella metida en medio, una coma es un contrato distinto. Así el diff dice
// la verdad: lo único que cambia es quién firma.
//
// Sigue `pendienteDeValidar`: el abogado de protección de datos no lo ha
// visto todavía (tarea humana 11 de clinica-1).
const CONTRATO_V2: VersionDelContrato = {
  ...CONTRATO_V1,
  version: 2,
  apartados: [
    {
      encabezado: "Quiénes somos cada uno",
      parrafos: [
        "La clínica es la RESPONSABLE de la historia clínica de sus pacientes: decide qué se guarda, para qué y durante cuánto tiempo. MI PIACE INTERNET SOLUTIONS, S.L., con NIF B45902186 y domicilio en Carretera CM-5100, km 30,500, Buenaventura, 45634 Toledo, es el ENCARGADO: pone el programa y los servidores donde esa historia se guarda, y la trata únicamente porque la clínica se lo encarga.",
        "Mi Piace no es dueña de ninguna historia clínica, no la usa para nada propio y no decide nada sobre ella. Todo lo que hace con esos datos lo hace porque está escrito aquí o porque la clínica se lo pide por escrito.",
      ],
    },
    ...CONTRATO_V1.apartados.slice(1),
  ],
  pendienteDeValidar: true,
};

/**
 * Todas las versiones que este despliegue sabe leer.
 *
 * **Nunca se quita una.** Una fila de aceptación apunta a su versión para
 * siempre, y quitarla de aquí es dejar una aceptación cuyo texto no se
 * puede volver a enseñar — y el PDF de cada versión aceptada tiene que
 * poder descargarse siempre (decisión 6 del prompt).
 */
const VERSIONES: readonly VersionDelContrato[] = [CONTRATO_V1, CONTRATO_V2];

/** La que se acepta HOY. */
export const CONTRATO_VIGENTE: VersionDelContrato = CONTRATO_V2;

/** El número de la vigente, que es lo que la función de estado compara. */
export const VERSION_VIGENTE: number = CONTRATO_VIGENTE.version;

/**
 * La versión con la que se aceptó. `undefined` para una que este
 * despliegue no conoce.
 *
 * Y NO cae a «la de ahora», por lo mismo que `plantillaDe` de clinica-4:
 * enseñar una aceptación con el texto vigente es afirmar que la dueña
 * aceptó un texto que no existía. Quien llama decide qué hacer con el
 * hueco — en pantalla se enseña la huella y la fecha, que es verdad.
 */
export function contratoDe(version: number): VersionDelContrato | undefined {
  return VERSIONES.find((c) => c.version === version);
}

/** Las versiones conocidas, de la más antigua a la más nueva. */
export function versionesConocidas(): readonly number[] {
  return VERSIONES.map((c) => c.version);
}

/**
 * EL TEXTO EXACTO QUE SE ACEPTA, en una sola cadena.
 *
 * Es lo que se le pone delante a la dueña, lo que va al PDF y lo que se
 * hashea para la columna `text_sha256`. **Una sola función para los tres**:
 * con dos formas de armar el texto, la huella guardada dejaría de cuadrar
 * con lo que la pantalla enseña.
 *
 * El formato (título, línea en blanco, y cada apartado con su encabezado y
 * sus párrafos separados por una línea en blanco) **es parte del contrato
 * de la huella**: cambiarlo cambia la huella de todas las versiones, y eso
 * solo se hace sacando versiones nuevas.
 */
export function textoCanonico(contrato: VersionDelContrato): string {
  const bloques: string[] = [contrato.titulo];
  for (const apartado of contrato.apartados) {
    bloques.push(apartado.encabezado, ...apartado.parrafos);
  }
  return bloques.join("\n\n");
}
