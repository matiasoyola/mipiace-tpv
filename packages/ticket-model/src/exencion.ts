// bloque iva-exento-sanitario · LA CAUSA DE EXENCIÓN, en un solo sitio.
//
// Rosario, podóloga, cobra con el TPV. Sus servicios sanitarios están
// EXENTOS de IVA (art. 20.Uno.3º de la Ley 37/1992) pero **sí obligan a
// facturar**: la AEAT lo pone como excepción expresa a la regla de que lo
// exento no se factura, «con excepción de las operaciones relacionadas con
// los servicios sanitarios y de hospitalización»
// (sede.agenciatributaria.gob.es · IVA · Facturación · «Excepciones a la
// obligación de facturar»). Y la crema que vende en el mostrador sigue
// llevando su 21 % en el mismo papel.
//
// ── Un 0 % sujeto y un exento NO son lo mismo ────────────────────────
//
// Es la decisión de fondo del bloque y la que explica por qué este
// fichero existe en vez de un `taxRate === 0`:
//
//   · un **0 % sujeto** declara `CalificacionOperacion = "S1"`,
//     `TipoImpositivo = 0` y `CuotaRepercutida = 0`;
//   · un **exento** declara `OperacionExenta = "E1"` y **no puede
//     informar** ni `TipoImpositivo` ni `CuotaRepercutida`.
//
// Los dos suman cero euros de cuota y son dos operaciones distintas ante
// la AEAT. Si el modelo las confundiera, el papel diría «IVA 0 %» de una
// operación exenta y el registro declararía una sujeta al 0 % — y nadie se
// enteraría, porque los importes cuadran.
//
// ── Las fuentes, que son de la AEAT y no de nadie más ────────────────
//
// 1. **Diseño de registro** `DsRegistroVeriFactu.xlsx`, hoja
//    `2)D. Registro Facturación Alta`, filas de `DetalleDesglose`:
//    `CalificacionOperacion¹` y `OperacionExenta¹` comparten el fondo
//    coloreado que la hoja `7)Leyenda` define como «Campo de selección
//    (alternativo)», y los dos llevan el superíndice 1 de «Campo
//    obligatorio». O sea: **exactamente uno de los dos**.
// 2. **`SuministroInformacion.xsd`**, `DetalleType`: lo mismo, en código —
//    un `<choice>` sin `minOccurs` entre `CalificacionOperacion` y
//    `OperacionExenta`.
// 3. **Validaciones VERI*FACTU v1.2.2 (08-04-2026) §15.5**: «Si el campo
//    OperacionExenta está cumplimentado no se pueden informar ninguno de
//    estos campos: TipoImpositivo, CuotaRepercutida,
//    TipoRecargoEquivalencia y CuotaRecargoEquivalencia.»
// 4. **Lista L10** (hoja `6)Listas` del diseño de registro), literal.
//
// La lista está completa aquí, y no sólo el E1 que la UI ofrece, porque el
// dato se guarda con el código de la AEAT: tener los seis escritos es lo
// que hace que mañana quepa otro sin migración ni tabla de traducción.

/** Lista L10 del diseño de registro. Para el IVA son E1–E6; el IGIC
 *  admite además E7 y E8 (§15.5), y este SIF no emite IGIC. */
export type CausaExencion = "E1" | "E2" | "E3" | "E4" | "E5" | "E6";

export const CAUSAS_EXENCION: readonly CausaExencion[] = [
  "E1",
  "E2",
  "E3",
  "E4",
  "E5",
  "E6",
] as const;

/** La descripción de la lista L10, literal del diseño de registro. */
export const DESCRIPCION_L10: Record<CausaExencion, string> = {
  E1: "Exenta por el artículo 20",
  E2: "Exenta por el artículo 21",
  E3: "Exenta por el artículo 22",
  E4: "Exenta por los artículos 23 y 24",
  E5: "Exenta por el artículo 25",
  E6: "Exenta por otros",
};

/**
 * Las causas que se pueden declarar con `ClaveRegimen = "01"` (régimen
 * general), que es la única que emite este SIF.
 *
 * **Validaciones §15.5**: «Si Impuesto = "01" (IVA), "03" (IGIC) o no se
 * cumplimenta (considerándose "01" - IVA), y ClaveRegimen es igual a "01",
 * no pueden marcarse los valores de OperacionExenta "E2" y "E3".»
 *
 * Esto CONTRADICE en parte el enunciado del bloque, que pedía que
 * «mañana quepan E2–E6». Manda la AEAT: la COLUMNA admite los seis —de
 * ahí que el CHECK de la base los acepte y no haga falta migración— y es
 * la aplicación la que sólo deja declarar los cuatro que el régimen
 * general permite. Un E2 en régimen general sería un registro rechazado.
 */
export const CAUSAS_REGIMEN_GENERAL: readonly CausaExencion[] = [
  "E1",
  "E4",
  "E5",
  "E6",
] as const;

export function esCausaExencion(v: unknown): v is CausaExencion {
  return typeof v === "string" && (CAUSAS_EXENCION as readonly string[]).includes(v);
}

export function admitidaEnRegimenGeneral(v: CausaExencion): boolean {
  return (CAUSAS_REGIMEN_GENERAL as readonly string[]).includes(v);
}

/**
 * La etiqueta y la referencia legal con las que esta casa presenta cada
 * causa, en la pantalla del catálogo y en la leyenda del papel.
 *
 * **E1 es «Exenta por el artículo 20» a secas para la AEAT**, y aquí vale
 * «sanitario · art. 20.Uno.3º» porque es la única exención del art. 20 que
 * este producto cubre (decisión 2 del bloque). El día que entre una
 * segunda —la enseñanza del 20.Uno.9º, por ejemplo— la referencia deja de
 * poder salir del código de la causa y necesita campo propio: E1 no la
 * distingue. Queda escrito aquí para que ese día se vea de dónde sacarla.
 */
export interface PresentacionExencion {
  /** Lo que se lee en el chip del catálogo: «Exento · sanitario». */
  etiqueta: string;
  /** El precepto que ampara la exención, para el papel. */
  referencia: string;
  /** Cómo se nombra el conjunto cuando hay más de una línea exenta. */
  plural: string;
}

export const PRESENTACION: Record<CausaExencion, PresentacionExencion> = {
  E1: {
    etiqueta: "Exento · sanitario",
    referencia: "art. 20.Uno.3º Ley 37/1992",
    plural: "Servicios sanitarios",
  },
  E2: {
    etiqueta: "Exento · exportación",
    referencia: "art. 21 Ley 37/1992",
    plural: "Operaciones exentas",
  },
  E3: {
    etiqueta: "Exento · operación asimilada a la exportación",
    referencia: "art. 22 Ley 37/1992",
    plural: "Operaciones exentas",
  },
  E4: {
    etiqueta: "Exento · régimen suspensivo",
    referencia: "arts. 23 y 24 Ley 37/1992",
    plural: "Operaciones exentas",
  },
  E5: {
    etiqueta: "Exento · entrega intracomunitaria",
    referencia: "art. 25 Ley 37/1992",
    plural: "Operaciones exentas",
  },
  E6: {
    etiqueta: "Exento · otros",
    referencia: "Ley 37/1992",
    plural: "Operaciones exentas",
  },
};

/**
 * La clave con la que se agrupa un tramo del desglose.
 *
 * **El tramo deja de ser «por tasa» y pasa a ser «por (tasa, causa)»**.
 * Sin esto, un 0 % sujeto y un exento caen en el mismo tramo porque los
 * dos valen 0, y el desglose declara uno de los dos por los dos.
 *
 * Se devuelve un string y no un objeto porque la clave va a un `Map` y
 * dos objetos con los mismos campos no son la misma clave.
 *
 * El parámetro es `string` y no `CausaExencion`, y es deliberado: esto es
 * una clave de AGRUPACIÓN, no una declaración. Un código que esta versión
 * del código no reconozca tiene que seguir separando su tramo — colarlo
 * por un `esCausaExencion` y agruparlo como sujeto por no reconocerlo
 * sería declarar una operación exenta dentro de un tramo al 21 %, que es
 * exactamente el fallo que la clave compuesta existe para evitar. Quién
 * puede declarar qué lo validan la lista L10 (`esCausaExencion`), el
 * esquema de la ruta y el CHECK de la base, cada uno en su puerta.
 */
export function claveTramo(
  rate: number,
  causa: string | null | undefined,
): string {
  return `${rate}|${causa ?? ""}`;
}

/** Deshace `claveTramo`. */
export function leerClaveTramo(clave: string): {
  rate: number;
  causa: CausaExencion | null;
} {
  const i = clave.lastIndexOf("|");
  const rate = Number(clave.slice(0, i));
  const resto = clave.slice(i + 1);
  return { rate, causa: esCausaExencion(resto) ? resto : null };
}

/**
 * Ordena los tramos como se imprimen: **los exentos primero** (es como
 * están en el mockup validado: «Exento 35,00 €» encima de «Base 21 %») y
 * dentro de cada grupo por tipo impositivo ascendente, que es el orden
 * que el desglose tenía hasta este bloque.
 */
export function compararTramos(
  a: { rate: number; exemptionCause?: CausaExencion | null },
  b: { rate: number; exemptionCause?: CausaExencion | null },
): number {
  const ea = a.exemptionCause ? 0 : 1;
  const eb = b.exemptionCause ? 0 : 1;
  if (ea !== eb) return ea - eb;
  if (a.exemptionCause && b.exemptionCause) {
    return a.exemptionCause.localeCompare(b.exemptionCause);
  }
  return a.rate - b.rate;
}

export interface LineaParaLeyenda {
  description: string;
  exemptionCause?: CausaExencion | null;
}

/**
 * La leyenda de la exención que va en recuadro en el papel, o `null` si
 * el documento no tiene ninguna línea exenta.
 *
 * Es el texto del mockup validado el 07-10, y las tres formas que toma son
 * las tres que el mockup enseña:
 *
 *   · **Todo exento** → «Operación exenta de IVA». No hace falta decir
 *     QUÉ está exento: lo está la factura entera.
 *   · **Venta mixta con UNA línea exenta** → «Quiropodia: operación exenta
 *     de IVA». Aquí sí: con una crema al 21 % en el mismo papel, una
 *     leyenda sin sujeto diría que el ticket entero está exento.
 *   · **Venta mixta con VARIAS** → «Servicios sanitarios: operación exenta
 *     de IVA», porque enumerar tres nombres de tratamiento en 42 columnas
 *     de papel térmico no cabe y recortarlos miente más que agruparlos.
 *
 * Y la segunda línea es siempre el precepto, que es lo que el art. 6.1.j)
 * del RD 1619/2012 pide mencionar («la referencia a las disposiciones
 * correspondientes»).
 *
 * Con varias causas distintas en un mismo papel se usa el plural genérico
 * y se listan las referencias separadas por « · ». Hoy no puede pasar
 * —sólo E1 es alcanzable— pero el día que pase, lo que no se puede es
 * citar un precepto que no ampara media factura.
 */
export function leyendaExencion(
  lines: readonly LineaParaLeyenda[],
): { titulo: string; referencia: string } | null {
  const exentas = lines.filter((l) => l.exemptionCause);
  if (exentas.length === 0) return null;
  const causas = [...new Set(exentas.map((l) => l.exemptionCause!))].sort();
  const referencia = causas.map((c) => PRESENTACION[c].referencia).join(" · ");
  const hayTramoSujeto = exentas.length < lines.length;
  if (!hayTramoSujeto) {
    return { titulo: "Operación exenta de IVA", referencia };
  }
  const sujeto =
    exentas.length === 1
      ? exentas[0]!.description.trim()
      : causas.length === 1
        ? PRESENTACION[causas[0]!].plural
        : "Operaciones exentas";
  return {
    titulo: `${sujeto}: operación exenta de IVA`,
    referencia,
  };
}
