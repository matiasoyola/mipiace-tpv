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
  opciones: Array<{ code: string; label: string; isAsUsual: boolean }>;
}

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
    toca: OcurrenciaDeLaPuerta[];
    registros: RegistroDeLaPuerta[];
  }>;
  controles: Array<{
    code: string;
    nombre: string;
    layer: string;
    nature: string;
    valueDomain: string;
    opciones: Array<{ code: string; isAsUsual: boolean }>;
  }>;
  serverTime: string;
}

/** El valor de un registro, como lo manda la tablet. */
export type ValorParaRegistrar =
  | { tipo: "BOOL"; hecho: true }
  | { tipo: "ORDINAL"; opcion: string }
  | { tipo: "NOTA" };

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
}

/** Lo que la API contesta de cada registro de un lote. */
export interface ResultadoDelRegistro {
  id: string;
  estado: "guardado" | "corrige" | "ya-estaba" | "rechazado";
  corrigeA?: string;
  codigo?: string;
  mensaje?: string;
}
