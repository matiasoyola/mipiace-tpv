// agenda-1 · PENDIENTE DE RECEPCIÓN.
//
// La tercera tarjeta de la columna izquierda del tablero 1. Contesta una
// sola pregunta: «¿hay algo que yo tenga que hacer AHORA, con alguien que
// está aquí o que acaba de irse?».
//
// Hasta este bloque cada aviso vivía en su sitio y había que ir a buscarlo:
// la próxima cita propuesta era una banda a todo lo ancho que tapaba la
// agenda (clinica-9, 9), y el test de salud sin contestar era una línea
// ámbar DENTRO del detalle de la cita — o sea, había que abrir la cita de
// cada paciente para enterarse. La recepción no abre siete citas.
//
// ── Por qué es una función y no tres `if` en la pantalla ─────────────
//
// Porque el prompt del bloque dice literalmente: «Lo que Matías no valide
// en hierro se ajusta después: hazlo fácil de mover». Un cuarto pendiente
// —el consentimiento sin firmar, que hoy no viaja en la respuesta del día—
// tiene que ser una entrada más en esta lista y no un bloque nuevo de JSX
// con su propio orden. Así que la pantalla pinta una lista y el orden, el
// texto y la acción salen de aquí.
//
// ── Y por qué el consentimiento NO está todavía ──────────────────────
//
// El diseño enseña «consentimiento sin firmar» como tercer pendiente. La
// respuesta de `GET /agenda` no lo trae: tendría que consultar las firmas
// de los consentimientos de cada paciente del día, que es una consulta
// clínica dentro del camino que se pinta cincuenta veces al día. Queda
// fuera del bloque a propósito; cuando entre, es un `push` más aquí y una
// fila más en la tarjeta.

/** Qué botón lleva el pendiente. */
export type AccionDeRecepcion = "DAR_CITA" | "TABLET";

export interface PendienteDeRecepcion {
  /** Clave estable para React: no se repite dentro de un día. */
  clave: string;
  clientId: string;
  /**
   * Lo que se le dice a la recepción, SIN el nombre: lo pone la pantalla
   * en negrita delante. Ni un dato de salud en ninguna de las dos frases
   * — «le falta un trámite» no dice qué tiene nadie (decisión de producto
   * 6 de clinica-2).
   */
  texto: string;
  accion: AccionDeRecepcion;
  /** El rótulo del botón. */
  boton: string;
  /** `DAR_CITA` · a partir de qué día buscar hueco. */
  desde?: string;
  /** `DAR_CITA` · la cita cuya sesión lo propuso. */
  appointmentId?: string;
  /** `DAR_CITA` · «En 4 semanas», ya en castellano, para el chip de
   *  «¿Cuándo?» del panel. Ausente si el servidor manda una propuesta que
   *  este APK no conoce todavía. */
  comoSeLlama?: string;
}

export interface EntradaDeRecepcion {
  /**
   * clinica-9 (9) · las próximas citas propuestas de las sesiones ya
   * cobradas de este día, cuyo paciente no tiene ninguna cita por delante.
   */
  proximasCitas?: Array<{
    appointmentId: string;
    clientId: string;
    propuesta: string;
    desde: string;
  }>;
  /** Cómo se dice `S2`/`S4`/`S8` en castellano. */
  nombreDeLaPropuesta?: Record<string, string>;
  /** clinica-2 · los pacientes con la valoración inicial sin validar. */
  valoracionesPendientes?: string[];
  /**
   * Los pacientes que tienen cita ESTE día. El test sin contestar sólo es
   * un pendiente de recepción si la persona viene hoy: el de alguien que
   * viene en tres semanas no es nada que hacer ahora, y la lista se
   * llenaría de nombres que nadie reconoce.
   */
  clientesDelDia?: string[];
  /**
   * ¿Esta sesión cobra? Un sanitario sin caja no da citas de recepción —
   * la ruta le contesta 403— así que no se le ofrece «Dársela». El test en
   * la tablet sí: eso lo puede hacer cualquiera de los dos.
   */
  puedeCobrar?: boolean;
}

/**
 * Lo que la recepción tiene pendiente, en el orden en que se hace.
 *
 * Primero las citas que hay que dar: el paciente acaba de pagar y sigue
 * delante del mostrador, y esa persona se va en treinta segundos. El test
 * de la tablet aguanta hasta que se siente en la sala.
 */
export function pendientesDeRecepcion(
  e: EntradaDeRecepcion,
): PendienteDeRecepcion[] {
  const fuera: PendienteDeRecepcion[] = [];
  const nombres = e.nombreDeLaPropuesta ?? {};

  if (e.puedeCobrar !== false) {
    for (const p of e.proximasCitas ?? []) {
      const comoSeLlama = nombres[p.propuesta];
      fuera.push({
        clave: `cita-${p.appointmentId}`,
        clientId: p.clientId,
        texto: comoSeLlama
          ? `se fue sin la próxima cita · propuesta ${comoSeLlama.toLowerCase()}`
          : "se fue sin la próxima cita",
        accion: "DAR_CITA",
        boton: "Dársela",
        ...(comoSeLlama ? { comoSeLlama } : {}),
        desde: p.desde,
        appointmentId: p.appointmentId,
      });
    }
  }

  // Los del día, y en el orden en que vienen: la respuesta del día los
  // trae por hora de cita, que es el orden en que se sientan.
  const delDia = new Set(e.clientesDelDia ?? []);
  const yaNombrado = new Set(fuera.map((p) => p.clientId));
  for (const clientId of e.valoracionesPendientes ?? []) {
    if (!delDia.has(clientId)) continue;
    // Si de esa persona ya hay un pendiente, no se repite el nombre: la
    // tarjeta diría dos veces «Lucía Prueba» y la segunda línea se lee
    // como si fuera de otra persona.
    if (yaNombrado.has(clientId)) continue;
    yaNombrado.add(clientId);
    fuera.push({
      clave: `test-${clientId}`,
      clientId,
      texto: "· test de salud sin contestar",
      accion: "TABLET",
      boton: "Tablet",
    });
  }

  return fuera;
}
