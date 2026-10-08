// clinica-4 · EL EMAIL DEL INFORME. SIN UN SOLO DATO DE SALUD EN EL CUERPO.
//
// Regla 17: *el cuerpo del email no lleva ningún dato de salud (el PDF va
// adjunto)*. Este fichero es la lista cerrada de lo que el correo puede
// decir, igual que `valoracion-email.ts` de clinica-2.
//
// ── Qué lleva, y la lista es cerrada ──────────────────────────────────
//
//   · el nombre de la clínica,
//   · el nombre de pila de quien lo recibe (o nada, si va al profesional),
//   · que lleva un documento adjunto y que es confidencial,
//   · el teléfono del centro para dudas.
//
// Y nada más. **NI EL TIPO DE INFORME.** Aquí es donde este correo se
// aparta del de clinica-2: «informe de derivación» o «historia clínica
// completa» en el asunto de un correo cuenta que esa persona está siendo
// derivada o que ha pedido su historia, y eso se lee en la vista previa de
// la pantalla de bloqueo de un móvil, que ve quien esté al lado. El asunto
// dice «un documento de su historia», que es verdad y no dice nada.
//
// Un test lo fija comparando asunto y cuerpo contra TODAS las palabras del
// cuestionario de clinica-2 y contra los nombres de los cuatro informes —
// no contra una lista escrita a mano. Así, el día que se añada una
// pregunta o un quinto informe, el guardián ya los cubre.
//
// ── Y el adjunto tampoco lo cuenta en el nombre ───────────────────────
//
// `informe-clinico-resumen.pdf`. No lleva el nombre del paciente ni nada
// de lo que hay dentro: un adjunto se queda en la carpeta de descargas de
// quien lo abre, y ahí el nombre del fichero es lo único que se lee.

export interface DatosDelEmailDelInforme {
  clinica: string;
  /** Sólo el nombre de pila, y sólo cuando va al paciente. `null` cuando
   *  va a otro profesional: ahí no hay a quién tutear y el nombre del
   *  paciente NO entra (el destinatario ya sabe de quién es). */
  nombrePila: string | null;
  /** Para dudas. `null` si el centro no lo tiene puesto. */
  telefono: string | null;
}

export interface EmailDelInforme {
  subject: string;
  text: string;
  html: string;
}

export function emailDelInforme(
  datos: DatosDelEmailDelInforme,
): EmailDelInforme {
  const subject = `${datos.clinica}: un documento de su historia`;
  const saludo = datos.nombrePila ? `Hola, ${datos.nombrePila}.` : "Hola.";
  // «Para cualquier aclaración, llámenos» y no «si tiene alguna duda,
  // puede llamarnos»: «tiene», «alguna», «puede» y «seguro» son palabras
  // DEL CUESTIONARIO de clinica-2, y el guardián de este correo compara
  // palabra con palabra contra todas ellas. Cada excepción que se le
  // añadiera al guardián sería una palabra que deja de vigilar, así que
  // lo que se cambia es el correo, no el guardián.
  const dudas = datos.telefono
    ? `Para cualquier aclaración, llámenos al ${datos.telefono}.`
    : "Para cualquier aclaración, llámenos o pásese por la clínica.";

  const text = [
    saludo,
    "",
    `Le adjuntamos en PDF el documento que nos ha pedido de ${datos.clinica}.`,
    "",
    "Es un documento confidencial: guárdelo donde nadie más lo vea y no lo reenvíe.",
    "",
    dudas,
    "",
    datos.clinica,
  ].join("\n");

  const html = [
    `<p>${escapar(saludo)}</p>`,
    `<p>Le adjuntamos en PDF el documento que nos ha pedido de ${escapar(datos.clinica)}.</p>`,
    `<p style="font-size:14px;color:#374151">Es un documento confidencial: guárdelo donde nadie más lo vea y no lo reenvíe.</p>`,
    `<p style="font-size:14px;color:#374151">${escapar(dudas)}</p>`,
    `<p style="font-size:14px;color:#374151">${escapar(datos.clinica)}</p>`,
  ].join("\n");

  return { subject, text, html };
}

/** Escape mínimo para el HTML del email, los cinco de siempre. */
function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
