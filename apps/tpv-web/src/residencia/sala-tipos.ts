// residencia-5 (D-67) · LOS TIPOS DE LA TABLET DE LA SALA.
//
// Lo que contestan `/residencia/sala/arranque`, `/residencia/sala/me` y
// `/residencia/sala/relevo`, escrito aparte por lo mismo que
// `puerta-tipos.ts`: lo que la caché guarda y lo que la pantalla pinta
// tienen que ser **el mismo tipo**, y con el tipo dentro del componente
// la caché se queda con un `unknown` que nadie valida.

/** Una línea del parte. Espejo de `LineaDelParte` de la API. */
export interface LineaDelParte {
  clase: string;
  texto: string;
  hora: string | null;
  nivel: string | null;
  incidentId: string | null;
  careRecordId: string | null;
  aviso: {
    canal: string;
    estado: string;
    acusadoPor: string | null;
    acusadoEn: string | null;
  } | null;
}

export interface ResidenteDelParte {
  clientId: string;
  nombre: string;
  habitacion: string | null;
  lineas: LineaDelParte[];
}

export interface ZonaDelParte {
  floorId: string | null;
  nombre: string;
  lineas: number;
  residentes: ResidenteDelParte[];
  sueltas: LineaDelParte[];
}

export interface ParteDeRelevo {
  centro: { id: string; nombre: string };
  turno: { id: string; code: string; name: string; startsAt: string; endsAt: string };
  careDay: string;
  desde: string;
  hasta: string;
  corte: string;
  generadoEn: string;
  sinNovedades: boolean;
  lineas: number;
  zonas: ZonaDelParte[];
}

/** Un añadido tardío, ya descifrado por el servidor. */
export interface AnadidoTardio {
  id: string;
  kind: string;
  clientId: string | null;
  floorId: string | null;
  resumen: string | null;
  ocurrioEn: string;
  llegoEn: string;
  incidentId: string | null;
  careRecordId: string | null;
}

export interface ConfirmacionDelParte {
  userId?: string;
  nombre: string;
  rol: string;
  at: string;
  alcanceTotal: boolean;
  zonas: string[];
}

/** El relevo tal y como lo trae el arranque: ENTERO, sin recortar. */
export interface RelevoDelArranque {
  id: string;
  careDay: string;
  congeladoEn: string;
  confirmado: boolean;
  zonas: Array<{ floorId: string | null; nombre: string; lineas: number }>;
  acuses: ConfirmacionDelParte[];
  tardios: AnadidoTardio[];
  /** `null` si el servidor no lo pudo descifrar. */
  parte: ParteDeRelevo | null;
}

/** Una persona del roster, con lo que hace falta para el PIN sin red. */
export interface PersonaDelRoster {
  userId: string;
  nombre: string;
  pinLookup: string;
  roles: Array<{
    assignmentId: string;
    code: string;
    name: string;
    alcanceTotal: boolean;
  }>;
  /** Las plantas vigentes. `null` dentro de la lista = «todo el centro». */
  zonas: Array<string | null>;
  /** residencia-6 (D-68) · `true` = su PIN se quedó corto para lo que ve
   *  y no abre nada hasta que dirección se lo renueve. Lo calcula el
   *  servidor; el número de cifras no viaja. Opcional: una caché de antes
   *  del bloque no lo trae. */
  porRenovar?: boolean;
}

export interface SalaArranque {
  centro: { id: string; nombre: string };
  device: { id: string; name: string | null };
  turnos: Array<{
    id: string;
    code: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
  roster: PersonaDelRoster[];
  /** Base64 de la subclave con la que se recalculan las huellas de PIN.
   *  `null` cuando el centro no tiene clave clínica todavía. */
  pinSubclave: string | null;
  relevo: RelevoDelArranque | null;
  minutosSinTocar: number;
  serverTime: string;
}

/** La pantalla en reposo. **Nada de salud** (decisión de producto 3). */
export interface SalaReposo {
  device: { id: string; name: string | null };
  centro: { id: string; nombre: string };
  turno: { id: string; code: string; name: string } | null;
  turnos: Array<{
    id: string;
    code: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
  relevo: {
    id: string;
    turno: string;
    careDay: string;
    lineas: number;
    sinNovedades: boolean;
    confirmado: boolean;
    zonasPorConfirmar: number;
    congeladoEn: string;
  } | null;
  minutosSinTocar: number;
  serverTime: string;
}

/** Lo que devuelve `GET /residencia/sala/relevo`, ya recortado. */
export interface RelevoParaLeer {
  relevo: {
    id: string;
    careDay: string;
    turno: { id: string; code: string; name: string };
    congeladoEn: string;
    confirmado: boolean;
    misZonasPorConfirmar: Array<{ floorId: string | null }>;
    yaConfirmado: boolean;
    acuses: ConfirmacionDelParte[];
    tardios: AnadidoTardio[];
    parte: ParteDeRelevo | null;
    ilegible: boolean;
  } | null;
  alcanceTotal?: boolean;
}
