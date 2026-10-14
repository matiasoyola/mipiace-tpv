// clinica-4 · QUIÉN FIRMA Y QUIÉN INFORMA (S3, condición 4).
//
// La ley no pide una firma: pide que **el profesional informe** y que
// quien firma sea quien puede consentir. Son dos personas distintas y las
// dos tienen que constar.
//
// ── El firmante ───────────────────────────────────────────────────────
//
// El paciente, o un representante con su nombre y su relación (Ley
// 41/2002 art. 9.3: menores e incapacidad). Lo que NO se hace es dejar el
// hueco en blanco: «firmó alguien» no es consentimiento informado, y una
// historia que no dice quién firmó por una persona de 78 años no sostiene
// nada. Enlaza con S7 (paciente y familiar), que es de otro bloque: aquí
// el representante es nombre y relación en texto, no una ficha.
//
// ── El informante ─────────────────────────────────────────────────────
//
// Un `User` cualquiera **salvo que la plantilla sea clínica**: entonces
// tiene que ser sanitario. Es el acuerdo de S3 con el lado agenda: en el
// spa informa la profesional que da el servicio, que no es sanitaria.
//
// Esta comprobación cruza `users.is_clinician` con la marca de la
// plantilla, así que no cabe en un CHECK de una tabla — vive aquí, pura, y
// la API le pasa lo que ha leído.

export type ClaseDeFirmante = "PACIENTE" | "REPRESENTANTE";

export const CLASES_DE_FIRMANTE: readonly ClaseDeFirmante[] = [
  "PACIENTE",
  "REPRESENTANTE",
] as const;

export interface Firmante {
  clase: ClaseDeFirmante;
  /** El nombre del representante. `null` cuando firma el paciente: su
   *  nombre ya está en la ficha y copiarlo sería una segunda verdad. */
  nombre: string | null;
  /** «Hija», «tutor legal». `null` cuando firma el paciente. */
  relacion: string | null;
}

export type MotivoFirmanteInvalido =
  | "FALTA_EL_REPRESENTANTE"
  | "FALTA_LA_RELACION"
  | "SOBRA_EL_REPRESENTANTE";

export type Veredicto<M> =
  | { ok: true }
  | { ok: false; motivo: M; mensaje: string };

/**
 * ¿Está completo el firmante?
 *
 * Las tres negativas que hacen falta, y la tercera también trabaja: un
 * «firma el paciente» con un nombre de representante dentro es una fila
 * que dice dos cosas a la vez, y la que se leería dentro de cinco años
 * sería la equivocada.
 */
export function firmanteCompleto(
  firmante: Firmante,
): Veredicto<MotivoFirmanteInvalido> {
  if (firmante.clase === "PACIENTE") {
    if (firmante.nombre != null || firmante.relacion != null) {
      return {
        ok: false,
        motivo: "SOBRA_EL_REPRESENTANTE",
        mensaje:
          "Si firma el paciente, no se pone nombre de representante: su nombre ya está en la ficha.",
      };
    }
    return { ok: true };
  }
  if (!firmante.nombre?.trim()) {
    return {
      ok: false,
      motivo: "FALTA_EL_REPRESENTANTE",
      mensaje: "Escribe el nombre de quien firma por el paciente.",
    };
  }
  if (!firmante.relacion?.trim()) {
    return {
      ok: false,
      motivo: "FALTA_LA_RELACION",
      mensaje:
        "Di qué es del paciente quien firma (hija, hijo, tutor legal…). La ley pide que conste.",
    };
  }
  return { ok: true };
}

export type MotivoInformanteInvalido = "INFORMANTE_NO_SANITARIO";

/**
 * ¿Puede ESTA persona figurar como quien informó?
 *
 * Con plantilla clínica, sólo un sanitario. Y la negativa dice por qué, no
 * «no autorizado»: quien la lee es la recepcionista que acaba de intentar
 * firmar un consentimiento de cirugía, y lo que necesita saber es que eso
 * lo tiene que hacer la podóloga delante del paciente.
 */
export function informantePuedeInformar(input: {
  plantillaEsClinica: boolean;
  esSanitario: boolean;
}): Veredicto<MotivoInformanteInvalido> {
  if (input.plantillaEsClinica && !input.esSanitario) {
    return {
      ok: false,
      motivo: "INFORMANTE_NO_SANITARIO",
      mensaje:
        "Un consentimiento clínico lo informa y lo firma el sanitario, con el paciente delante. La ley pide que informe el profesional.",
    };
  }
  return { ok: true };
}
