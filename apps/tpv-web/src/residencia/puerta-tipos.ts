// residencia-3 · LO QUE LA PUERTA RECIBE Y LO QUE MANDA.
//
// Los tipos del contrato con la API, en un fichero aparte para que los
// compartan la caché, la cola, la máquina de estados y las seis pantallas
// sin que ninguna importe de otra.
//
// Nota sobre los campos `?`: casi todos lo son porque **la caché sobrevive
// a los despliegues** (ver `puerta-cache.ts`). Una tablet que arrancó con
// la versión de ayer tiene un paquete sin los campos de hoy, y lo que no
// puede pasar es que eso la deje sin poder registrar. Es el mismo criterio
// con el que `DeviceMeResponse.kitchen` y `kitchenDisplayEnabled` son
// opcionales.

/** Un control del catálogo vigente, como lo pinta la puerta. */
export interface ControlDeLaPuerta {
  id: string;
  code: string;
  name: string;
  version: number;
  layer: "EXEC" | "OBS" | "MEASURE" | "SCALE" | "EVENT";
  nature: "SCHEDULED" | "ON_DEMAND" | "DERIVED";
  valueDomain: "BOOL" | "ORDINAL" | "NUMERIC" | "SCORE" | "TEXT_SHORT";
  groupCode: string | null;
  /** residencia-4 · lo que el teclado numérico necesita: la unidad a la
   *  vista y el rango que deja teclear. Opcionales como todo lo demás,
   *  porque la caché sobrevive a los despliegues. */
  unit?: string | null;
  inputMin?: number | null;
  inputMax?: number | null;
  opciones: Array<{ code: string; label: string; isAsUsual: boolean }>;
}

// ── residencia-4 · LA PLANTILLA DE GRAVEDAD, EN LA TABLET ────────────
//
// La puerta pinta el nivel **al instante y también sin red**: ejecuta
// `gravedadDe` del paquete puro con estas reglas, exactamente la misma
// función que el servidor. El servidor la ejecuta otra vez y **manda la
// suya**; un test de oro fija que dan lo mismo para toda la tabla del §3.
//
// Lo que NO viaja son las excepciones de cada residente (D-22): son un
// dato clínico suyo. Consecuencia dicha: sin red, la puerta pinta el
// nivel DE SERIE de un residente con excepción. Es lo prudente — una
// excepción baja el nivel o lo deja igual, nunca lo sube.
export interface PlantillaDeLaPuerta {
  version: number;
  reglas: ReglaDeGravedadDeLaPuerta[];
}

export type ReglaDeGravedadDeLaPuerta =
  | {
      kind: "THRESHOLD";
      controlCode: string;
      comparador: "GTE" | "GT" | "LTE" | "LT";
      valor: number;
      nivel: NivelDeLaPuerta;
      tipo: string;
    }
  | {
      kind: "EVENT";
      evento: string;
      matiz: string | null;
      nivel: NivelDeLaPuerta;
      tipo: string;
    };

export type NivelDeLaPuerta = "N0" | "N1" | "N2" | "N3" | "N4";

/** Una línea del plan vivo de un residente de esta habitación. */
export interface LineaDePlanDeLaPuerta {
  id: string;
  clientId: string;
  controlCode: string;
  frecuencia: {
    kind:
      | "EVERY_SHIFT"
      | "DAILY"
      | "MOMENTS"
      | "EVERY_N_HOURS"
      | "WEEKDAYS"
      | "EVERY_N_DAYS"
      | "MONTHLY"
      | "ON_DEMAND";
    everyNHours?: number | null;
    everyNDays?: number | null;
    weekdays?: number[];
    monthDay?: number | null;
    shiftCodes?: string[];
    momentCodes?: string[];
  };
  fromAt: string;
  toAt: string | null;
}

export interface TurnoDeLaPuerta {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

/** Una persona que puede entrar por esta puerta, con sus capacidades. */
export interface EnElRoster {
  userId: string;
  nombre: string;
  /** La huella HMAC de su PIN. Ver `puerta-cache.ts` para el modelo de
   *  confianza de que esto esté en la tablet. */
  pinLookup: string;
  roles: Array<{
    assignmentId: string;
    code: string;
    name: string;
    alcanceTotal: boolean;
  }>;
  /** residencia-6 (D-68) · `true` = su PIN tiene cuatro cifras y ha pasado
   *  a tener un rol que ve todo el centro, así que **no abre nada** hasta
   *  que dirección se lo ponga de seis. Lo calcula el servidor; lo que
   *  NO viaja es cuántas cifras tiene (ver el arranque en la API).
   *
   *  Opcional como todo lo demás de este fichero: una caché de antes de
   *  este bloque no lo trae, y entonces la puerta deja entrar sin red
   *  como hacía ayer y el servidor lo corrige en cuanto haya red. */
  porRenovar?: boolean;
}

/** `GET /residencia/puerta/arranque`. */
export interface PuertaArranque {
  device: { id: string; name: string | null };
  habitacion: {
    id: string;
    /** Hace falta en la tablet para recalcular la huella del PIN: el
     *  `tenantId` entra en el HMAC (ver `huellaDePinDePuerta`). */
    tenantId: string;
    number: string;
    name: string | null;
    plantaId: string;
    plantaName: string;
  };
  ocupantes: Array<{
    clientId: string;
    bedId: string;
    bedLabel: string;
    nombre: string;
    /** `true` = hay foto Y consentimiento de imagen vigente (D-64). La
     *  tablet no sabe de consentimientos: pide la foto si esto es `true` y
     *  pinta las iniciales si no. */
    tieneFoto: boolean;
    /**
     * historia-1 (D-91) · **LAS FRASES DE LA FRANJA DE ALERTAS**, y nada
     * más que las frases: «Disfagia: triturado y espesante nivel 2»,
     * «Alergia: penicilina».
     *
     * **Aquí no llega ni un diagnóstico, y no es una costumbre de quien
     * escribe la pantalla**: el servidor calcula las frases con
     * `frasesParaLaPuerta` y lo que manda es `string[]`. La tablet no
     * tiene el texto del diagnóstico ni la reacción de la alergia, así
     * que no puede pintarlos. Un pasillo de residencia lo cruza
     * cualquiera.
     *
     * Opcional como todo lo de este fichero: una caché de antes del
     * bloque no lo trae y la pantalla no pinta banda.
     */
    alertas?: string[];
  }>;
  /**
   * historia-1 (D-92) · **quién de los ocupantes NO ESTÁ**, para que la
   * tablet lo sepa SIN RED.
   *
   * `queToca` las recibe y no genera las ocurrencias de quien está fuera.
   * Sin esto, una puerta sin wifi seguiría pidiendo los cuidados de quien
   * lleva tres días en el hospital.
   *
   * Lo que viaja es el TIPO y las dos fechas, que es lo que la tarjeta
   * pinta. **Adónde fue y por qué no viajan.**
   */
  ausencias?: Array<{
    clientId: string;
    tipo:
      | "INGRESO_HOSPITALARIO"
      | "URGENCIAS"
      | "VACACIONES_FAMILIA"
      | "CONSULTA_EXTERNA"
      | "SALIDA_NO_CONTROLADA";
    desde: string;
    hasta: string | null;
  }>;
  plan: LineaDePlanDeLaPuerta[];
  ajustes: Array<{ controlCode: string; active: boolean; alias: string | null }>;
  turnos: TurnoDeLaPuerta[];
  momentos: Array<{ code: string; name: string; atTime: string }>;
  controles: ControlDeLaPuerta[];
  roster: EnElRoster[];
  /** `null` si el centro no tiene clave clínica todavía: entonces el PIN
   *  sólo se resuelve con red. */
  pinSubclave: string | null;
  /** residencia-4 · la plantilla de gravedad vigente. Ausente en una
   *  caché de antes del bloque: entonces la puerta no pinta nivel y el
   *  servidor lo dice al subir el lote, que es lo que de verdad manda. */
  plantilla?: PlantillaDeLaPuerta;
  /** Y la configuración de guardia que la pantalla necesita: los minutos
   *  de escalado y a quién se recomienda llamar en N3-N4. */
  guardia?: {
    minutosDeEscalado: number;
    servicio: { nombre: string; telefono: string } | null;
  };
  serverTime: string;
}

/** Un registro ya descifrado, como lo devuelve la API. */
export interface RegistroDeLaPuerta {
  id: string;
  controlCode: string;
  clientId: string;
  valor: unknown;
  nota: string | null;
  tieneVoz: boolean;
  recordedAt: string;
  careDay: string;
  /** A qué ocurrencia del plan responde, o `null` (la observación diaria y
   *  lo «a demanda»). Es con lo que la pantalla sabe si una ronda concreta
   *  ya está hecha. */
  occurrenceAt: string | null;
  shiftCode: string | null;
  sinTurno: boolean;
  firmadoPor: string;
  firmadoPorUserId: string;
  rolCode: string;
  anulado: boolean;
  corrigeA: string | null;
  /** `true` = es el valor de ahora de su ocurrencia. Lo que la pantalla
   *  pinta en verde o en gris discontinuo. */
  vigente: boolean;
  /** residencia-6 · `true` = esto lo apuntó ESTA tablet y puede no haber
   *  subido todavía. La pantalla lo dice («· en la tablet»), porque es
   *  distinto de «consta en el servidor»: lo que está sólo aquí no lo ve
   *  el relevo ni la DUE hasta que vuelva la red.
   *
   *  Nunca viene de la API: lo pone la caché al leer lo propio. */
  enLaTablet?: boolean;
}

/** Una ocurrencia de `queToca`, como la pinta la pantalla 3. */
export interface OcurrenciaDeLaPuerta {
  controlCode: string;
  nombre: string;
  planItemId: string;
  at: string;
  until: string | null;
  esFranja: boolean;
  shiftCode: string | null;
  momentCode: string | null;
}

/** `GET /residencia/puerta/lo-que-toca`. */
export interface LoQueToca {
  habitacionLibre: boolean;
  turno: { id: string; code: string; name: string } | null;
  careDay: string;
  residentes: Array<{
    clientId: string;
    bedLabel: string;
    nombre: string;
    tieneFoto: boolean;
    /** historia-1 (D-91) · las frases de su franja. Ver
     *  `PuertaArranque.ocupantes[].alertas`: **sólo frases**. */
    alertas?: string[];
    /** historia-1 (D-92) · `null` = está en el centro. Si no, lo que la
     *  tarjeta pinta: el rótulo corto y la frase entera. */
    ausente?: { corta: string; frase: string } | null;
    toca: OcurrenciaDeLaPuerta[];
    registros: RegistroDeLaPuerta[];
  }>;
  controles: Array<{
    code: string;
    nombre: string;
    layer: string;
    nature: string;
    valueDomain: string;
    unit?: string | null;
    inputMin?: number | null;
    inputMax?: number | null;
    opciones: Array<{ code: string; isAsUsual: boolean }>;
  }>;
  serverTime: string;
}

/** El valor de un registro, como lo manda la tablet. */
export type ValorParaRegistrar =
  | { tipo: "BOOL"; hecho: true }
  | { tipo: "ORDINAL"; opcion: string }
  /** residencia-4 · una constante. El número con punto decimal; la coma
   *  es de la pantalla. */
  | { tipo: "NUMERIC"; numero: number }
  /** residencia-4 · «algo no va bien», con TIPO y matiz opcionales
   *  (D-13: sin elegir nada sigue siendo un registro completo). */
  | { tipo: "NOTA"; evento?: string | null; matiz?: string | null };

/** Un registro, como lo manda la tablet. */
export interface RegistroParaEnviar {
  /** El uuid que genera LA TABLET: es la idempotencia del envío y es el
   *  AAD del valor cifrado. */
  id: string;
  clientId: string;
  controlCode: string;
  planItemId?: string | null;
  occurrenceAt?: string | null;
  recordedAt: string;
  centerShiftId?: string | null;
  careDay: string;
  valor: ValorParaRegistrar;
  nota?: string | null;
  voz?: { webmBase64: string } | null;
  /** residencia-4 · «No puede esperar: avisar a la enfermera». Fuerza al
   *  menos N2 sobre lo que se esté apuntando. */
  avisarEnfermera?: boolean;
}

/** Lo que la API contesta de cada registro de un lote. */
export interface ResultadoDelRegistro {
  id: string;
  estado: "guardado" | "corrige" | "ya-estaba" | "rechazado";
  corrigeA?: string;
  codigo?: string;
  mensaje?: string;
  /** residencia-4 · qué nivel salió y en qué canales sonó. Puesto sólo
   *  cuando este registro derivó una incidencia. */
  incidencia?: IncidenciaDelRegistro;
}

export interface IncidenciaDelRegistro {
  id: string;
  tipo: string;
  nombreDelTipo: string;
  nivel: NivelDeLaPuerta;
  creada: boolean;
  subioNivel: boolean;
  /** Vacío = **no tocaba avisar** (N0, N1). La pantalla lo dice así y no
   *  con un silencio: «queda apuntado para el relevo». */
  avisadoEn: Array<"ENFERMERIA" | "RESPONSABLE">;
}

/** `GET /residencia/puerta/incidencias/:id` · ¿ya va alguien? */
export interface EstadoDeLaIncidencia {
  id: string;
  tipo: string;
  nombreDelTipo: string;
  nivel: NivelDeLaPuerta;
  abierta: boolean;
  avisadoEn: string | null;
  avisos: Array<{
    canal: "ENFERMERIA" | "RESPONSABLE";
    estado: string;
    apuntadoEn: string;
    salidoEn: string;
    acusadoEn: string | null;
    acusadoPor: string | null;
    acusadoComo: string | null;
  }>;
}
