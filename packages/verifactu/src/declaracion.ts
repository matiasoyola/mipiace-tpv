// La declaración responsable del SIF, art. 15 de la Orden HAC/1177/2024.
//
// El art. 15 no pide sólo que exista: pide que esté «disponible de manera
// legible e individualizada dentro del propio sistema informático»,
// accesible «de forma rápida, fácil e intuitiva», y que se entregue gratis
// en papel o en formato electrónico a clientes y distribuidores. Por eso
// este módulo vive en el paquete y no en un PDF firmado a mano en un
// Drive: la declaración es una pantalla del producto.
//
// ⚠ REGLA DE ORO. Los datos NO se teclean dos veces. Todo lo que también
// viaja dentro de cada registro de facturación sale de `productor.ts`, de
// las MISMAS constantes que firman ese registro — nombre del sistema,
// código identificador, razón social, NIF y los dos indicadores de tipo de
// uso. `posicion-verifactu.md` §4 lo exige: «tienen que coincidir
// literalmente». Si alguien cambia una constante allí, la declaración
// cambia sola, y `test/declaracion.test.ts` se pone rojo si alguien la
// vuelve a teclear aquí.
//
// Lo que SÍ vive aquí son los datos que la declaración pide y el registro
// no lleva: la dirección postal, el lugar de suscripción, la descripción
// de los componentes y el texto de cumplimiento. No están en `productor.ts`
// porque `productor.ts` es el bloque `SistemaInformatico` del registro y
// nada más; meterles la dirección postal sería ensanchar una estructura
// que el diseño de registro tiene cerrada.
//
// El formato sigue los ejemplos oficiales de la AEAT
// (`EjemplosDeclaracionResponsable(V0.5.1).pdf`): apartados numerados
// 1.a) … 1.l) con su rótulo literal, y un ANEXO 2.a) … 2.b) con las otras
// formas de contacto. Los rótulos son los de la Orden, no una paráfrasis:
// un inspector busca «1.f)» y tiene que encontrarlo.

import {
  ID_SISTEMA_INFORMATICO,
  NOMBRE_SISTEMA_INFORMATICO,
  PRODUCTOR_NIF,
  PRODUCTOR_NOMBRE_RAZON,
  TIPO_USO_POSIBLE_MULTI_OT,
  TIPO_USO_POSIBLE_SOLO_VERIFACTU,
} from "./productor.js";

/** Título literal del documento. Los ejemplos de la AEAT lo parten en dos
 *  líneas; aquí va entero porque cada superficie lo maqueta como puede. */
export const DECLARACION_TITULO =
  "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN";

/** Dirección postal completa de contacto del productor (apartado 1.j).
 *
 *  En líneas y no en una sola cadena porque el apartado 1.j de los
 *  ejemplos de la AEAT se pinta a tres renglones (vía, población, país) y
 *  así el PDF no tiene que adivinar dónde partirla. */
export const PRODUCTOR_DIRECCION_POSTAL: readonly string[] = [
  "Carretera CM-5100, km 30,500",
  "45634 Buenaventura (Toledo)",
  "España",
];

/** Lugar de suscripción de la declaración (apartado 1.l). */
export const PRODUCTOR_LUGAR = "Buenaventura (Toledo) – España";

/** Sitio web del producto (anexo 2.b). */
export const PRODUCTOR_WEB = "https://mipiacetpv.com";

/** Texto de cumplimiento del apartado 1.k, literal.
 *
 *  Es la frase que convierte el documento en una declaración responsable:
 *  no se reescribe «para que quede mejor». Un test la compara carácter a
 *  carácter contra esta constante. */
export const DECLARACION_CUMPLIMIENTO =
  "El productor declara que este sistema informático de facturación cumple " +
  "con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de " +
  "diciembre, General Tributaria, en el Reglamento aprobado por el Real " +
  "Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 " +
  "de octubre, y en las especificaciones publicadas por la Agencia Estatal " +
  "de Administración Tributaria en su sede electrónica.";

/** Descripción de componentes y funcionalidades (apartado 1.d).
 *
 *  Un párrafo por renglón. Describe lo que el sistema hace DE VERDAD hoy,
 *  que es la única versión defendible: la remisión a la AEAT todavía no se
 *  hace (`posicion-verifactu.md` §5) y por eso aquí se dice «quedan
 *  listos para su remisión» y no «se remiten». */
export const DECLARACION_COMPONENTES: readonly string[] = [
  "Se trata únicamente de software, sin componente hardware propio: se " +
    "instala en terminales de caja y equipos de propósito general que " +
    "cumplan los requisitos mínimos de la aplicación.",
  "El sistema consta de tres componentes: (1) la aplicación de terminal " +
    "punto de venta, en su versión web y en su versión para Android en " +
    "terminales de caja; (2) el servidor, que comprende la API y la base " +
    "de datos, alojados en la nube; y (3) el panel de gestión con el que " +
    "el usuario administra su negocio y consulta su facturación.",
  "Funcionalidades principales: expedición de facturas simplificadas en el " +
    "terminal en el momento del cobro, con conexión o sin ella; generación " +
    "del registro de facturación de alta y del registro de facturación de " +
    "anulación, con huella SHA-256 encadenada por caja; incorporación a la " +
    "factura del código QR tributario y de la leyenda «VERI*FACTU»; y " +
    "conservación inalterable de los registros en el servidor, donde " +
    "quedan listos para su remisión a la Agencia Estatal de " +
    "Administración Tributaria.",
  "Cada caja registradora constituye una instalación distinta del sistema " +
    "informático de facturación, con su propio número de instalación, su " +
    "serie de facturación y su propia cadena de huellas.",
];

/** Texto del apartado 1.g (tipos de firma).
 *
 *  «No aplica» y su motivo, que es el mismo que exime del registro de
 *  eventos (FAQ AEAT §15, NOTA 1): un SIF que sólo puede funcionar como
 *  VERI*FACTU no firma sus registros con certificado propio. Si algún día
 *  `TIPO_USO_POSIBLE_SOLO_VERIFACTU` pasa a "N", este apartado deja de ser
 *  verdad — y el test que lo ata a la constante se pone rojo. */
export const DECLARACION_TIPOS_FIRMA =
  "No aplica. Este sistema informático de facturación sólo puede funcionar " +
  "exclusivamente en la modalidad «VERI*FACTU», por lo que no realiza una " +
  "firma electrónica expresa de los registros de facturación: la normativa " +
  "considera que quedan firmados al ser remitidos correctamente a los " +
  "servicios electrónicos de la Agencia Estatal de Administración " +
  "Tributaria con la debida autenticación.";

/** Un apartado de la declaración, tal como se pinta. */
export interface ApartadoDeclaracion {
  /** Clave del apartado en la Orden: "1.a)", "1.l)", "2.b)"… */
  clave: string;
  /** Rótulo literal del apartado. */
  rotulo: string;
  /** Valor, un elemento por renglón. Nunca vacío. */
  valor: string[];
}

export interface DeclaracionResponsable {
  titulo: string;
  /** Apartados 1.a) … 1.l), en el orden del art. 15. */
  apartados: ApartadoDeclaracion[];
  /** Anexo 2.a) … 2.b): contacto y direcciones de internet. */
  anexo: ApartadoDeclaracion[];
}

/** Versión de producto de la app Android, si se conoce. */
export interface VersionApk {
  versionName: string;
  versionCode: string;
}

export interface DeclaracionInput {
  /** La versión EN EJECUCIÓN del servidor: el mismo valor que va en el
   *  campo `Version` de cada registro de facturación. */
  versionServidor: string;
  /** Versión de producto de la APK publicada, o null si no se conoce
   *  (entorno de desarrollo, CI, o ninguna release publicada todavía). */
  versionApk?: VersionApk | null;
  /** Fecha de suscripción, `YYYY-MM-DD`: la de la versión en ejecución,
   *  NO la de hoy. `null` si la build no la lleva horneada. */
  fechaSuscripcion: string | null;
  /** Correo de contacto del anexo 2.a). */
  emailSoporte: string;
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/**
 * `2026-09-27` → `27 de septiembre de 2026`, el formato de los ejemplos de
 * la AEAT.
 *
 * Se parte la cadena a mano en vez de pasar por `Date`: `new Date()` en un
 * `YYYY-MM-DD` interpreta UTC y, en un servidor al oeste de Greenwich, un
 * `toLocaleDateString` local devuelve el día ANTERIOR. La fecha de un
 * documento legal no puede depender del huso del proceso que lo pinta.
 *
 * Devuelve null si la cadena no es una fecha civil válida: preferimos que
 * el apartado diga que no hay fecha a que diga una inventada.
 */
export function formatearFechaLarga(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // Rechaza 31 de febrero y compañía: reconstruimos la fecha y
  // comprobamos que el calendario no la haya movido de mes.
  const civil = new Date(Date.UTC(anio, mes - 1, dia));
  if (civil.getUTCMonth() !== mes - 1 || civil.getUTCDate() !== dia) return null;
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/** `"S"` → `"S - Sí"`, `"N"` → `"N - No"`. El formato de la lista L4 en los
 *  ejemplos de la AEAT, derivado de la constante y no escrito a mano. */
function siNo(indicador: string): string {
  return indicador === "S" ? "S - Sí" : "N - No";
}

/**
 * La declaración responsable completa, construida desde las constantes del
 * productor.
 *
 * Función pura: mismas entradas, mismo documento. Quien la llama aporta lo
 * único que varía con el despliegue (la versión, su fecha y el correo de
 * soporte); todo lo demás sale de `productor.ts` y de las constantes de
 * este módulo.
 */
export function buildDeclaracionResponsable(
  input: DeclaracionInput,
): DeclaracionResponsable {
  const version = input.versionServidor.trim();
  if (!version) {
    throw new RangeError("DeclaracionResponsable: versionServidor vacía");
  }

  // 1.c) · el identificador completo de la versión. El servidor siempre; la
  // APK sólo si se conoce. «Media versión es peor que ninguna»
  // (apps/tpv-web/src/platform/AppInfo.ts): no se inventa un versionName.
  const versionLineas = [`${version} (servidor)`];
  const apk = input.versionApk;
  if (apk && apk.versionName.trim() && apk.versionCode.trim()) {
    versionLineas.push(
      `${apk.versionName.trim()} (${apk.versionCode.trim()}) (app Android)`,
    );
  }

  const fechaLarga = formatearFechaLarga(input.fechaSuscripcion);

  const apartados: ApartadoDeclaracion[] = [
    {
      clave: "1.a)",
      rotulo:
        "Nombre del sistema informático a que se refiere esta declaración " +
        "responsable",
      valor: [NOMBRE_SISTEMA_INFORMATICO],
    },
    {
      clave: "1.b)",
      rotulo:
        "Código identificador del sistema informático a que se refiere el " +
        "apartado a) de esta declaración responsable",
      valor: [ID_SISTEMA_INFORMATICO],
    },
    {
      clave: "1.c)",
      rotulo:
        "Identificador completo de la versión concreta del sistema " +
        "informático a que se refiere esta declaración responsable",
      valor: versionLineas,
    },
    {
      clave: "1.d)",
      rotulo:
        "Componentes, hardware y software, de que consta el sistema " +
        "informático a que se refiere esta declaración responsable, junto " +
        "con una breve descripción de lo que hace dicho sistema informático " +
        "y de sus principales funcionalidades",
      valor: [...DECLARACION_COMPONENTES],
    },
    {
      clave: "1.e)",
      rotulo:
        "Indicación de si el sistema informático a que se refiere esta " +
        "declaración responsable se ha producido de tal manera que, a los " +
        "efectos de cumplir con el Reglamento, solo pueda funcionar " +
        "exclusivamente como «VERI*FACTU»",
      valor: [siNo(TIPO_USO_POSIBLE_SOLO_VERIFACTU)],
    },
    {
      clave: "1.f)",
      rotulo:
        "Indicación de si el sistema informático a que se refiere la " +
        "declaración responsable permite ser usado por varios obligados " +
        "tributarios o por un mismo usuario para dar soporte a la " +
        "facturación de varios obligados tributarios",
      valor: [
        siNo(TIPO_USO_POSIBLE_MULTI_OT),
        "Cada caja registradora factura por un único obligado tributario.",
      ],
    },
    {
      clave: "1.g)",
      rotulo:
        "Tipos de firma utilizados para firmar los registros de facturación " +
        "y de evento en el caso de que el sistema informático a que se " +
        "refiere esta declaración responsable no sea utilizado como " +
        "«VERI*FACTU»",
      valor: [DECLARACION_TIPOS_FIRMA],
    },
    {
      clave: "1.h)",
      rotulo:
        "Razón social de la entidad productora del sistema informático a " +
        "que se refiere esta declaración responsable",
      valor: [PRODUCTOR_NOMBRE_RAZON],
    },
    {
      clave: "1.i)",
      rotulo:
        "Número de identificación fiscal (NIF) español de la entidad " +
        "productora del sistema informático a que se refiere esta " +
        "declaración responsable",
      valor: [PRODUCTOR_NIF],
    },
    {
      clave: "1.j)",
      rotulo:
        "Dirección postal completa de contacto de la entidad productora del " +
        "sistema informático a que se refiere esta declaración responsable",
      valor: [...PRODUCTOR_DIRECCION_POSTAL],
    },
    {
      clave: "1.k)",
      rotulo:
        "La entidad productora del sistema informático a que se refiere " +
        "esta declaración responsable hace constar que dicho sistema " +
        "informático, en la versión indicada en ella, cumple con la " +
        "normativa aplicable",
      valor: [DECLARACION_CUMPLIMIENTO],
    },
    {
      clave: "1.l)",
      rotulo:
        "Fecha y lugar en que la entidad productora de este sistema " +
        "informático suscribe esta declaración responsable del mismo",
      valor: [
        // Sin fecha horneada (dev, CI, build a mano) lo decimos en vez de
        // poner la de hoy: la declaración es de la VERSIÓN, y una fecha que
        // cambia cada vez que se abre el documento no es la de ninguna
        // versión. Ver `getAppVersionDate` en apps/api/src/version.ts.
        fechaLarga
          ? `Fecha: ${fechaLarga}`
          : "Fecha: no disponible en esta build",
        `Lugar: ${PRODUCTOR_LUGAR}`,
      ],
    },
  ];

  const anexo: ApartadoDeclaracion[] = [
    {
      clave: "2.a)",
      rotulo:
        "Otras formas de contacto con la entidad productora del sistema " +
        "informático a que se refiere esta declaración responsable",
      valor: [`Correo electrónico: ${input.emailSoporte.trim()}`],
    },
    {
      clave: "2.b)",
      rotulo:
        "Direcciones de internet de la entidad productora del sistema " +
        "informático a que se refiere esta declaración responsable",
      valor: [`Sitio web: ${PRODUCTOR_WEB}`],
    },
  ];

  return { titulo: DECLARACION_TITULO, apartados, anexo };
}
