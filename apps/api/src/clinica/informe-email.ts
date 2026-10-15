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
//   · **el enlace** y que hace falta un código que se da aparte,
//   · cuántos días vive el enlace,
//   · que es confidencial,
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
// ── clinica-7 · YA NO HAY ADJUNTO ────────────────────────────────────
//
// Decisión 21. El correo llevaba el PDF adjunto; ahora lleva un enlace que
// caduca a los 7 días, admite 3 aperturas, se puede anular desde la
// historia y **no abre sin un código de 6 cifras que este correo no
// lleva**.
//
// El por qué lo dejó escrito clinica-4 en su «pendiente del abogado»,
// punto 2: el cuerpo del correo no llevaba datos de salud, pero **el
// adjunto viaja por servidores que no son nuestros y sin cifrar**. Un
// informe de derivación en el buzón de Gmail de un paciente es un
// documento de salud en un servidor de Google, para siempre, y una copia
// más en el de quien se lo reenvíe.
//
// Y lo que se gana además: cada apertura del enlace deja su línea en
// `ClinicalAccessLog`. Un adjunto no puede decir nunca quién lo abrió.
//
// ── El correo NO dice cuál es el código, ni da una pista ─────────────
//
// Dice que hay uno y que lo da la clínica. Si el correo llevara el código,
// el código no serviría para nada: lo que protege es que viaje por OTRO
// canal.
//
// ── Y sigue sin decir NI EL TIPO DE INFORME ──────────────────────────
//
// La regla 17 de clinica-4 no cambia, y el guardián que la vigila tampoco:
// compara palabra con palabra contra las 53 del cuestionario y contra los
// nombres de los cuatro informes, sin lista de inocentes. El texto nuevo
// se escribió esquivando esas palabras igual que el viejo.

export interface DatosDelEmailDelInforme {
  clinica: string;
  /** Sólo el nombre de pila, y sólo cuando va al paciente. `null` cuando
   *  va a otro profesional: ahí no hay a quién tutear y el nombre del
   *  paciente NO entra (el destinatario ya sabe de quién es). */
  nombrePila: string | null;
  /** Para dudas. `null` si el centro no lo tiene puesto. */
  telefono: string | null;
  /** clinica-7 · el enlace. La URL lleva el token; el código, no. */
  url: string;
  /** Cuántos días vive. Se dice en el correo para que nadie lo deje para
   *  el mes que viene y después llame porque «no funciona». */
  diasDeVida: number;
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

  // «Aquí está el documento» y no «le adjuntamos»: ya no se adjunta nada.
  // Y «la clave de 6 cifras» y no «el código»: «código» es una palabra que
  // la gente asocia a los códigos de barras del TPV, y aquí hay que
  // teclearla sin dudar.
  const comoSeAbre = `Para abrirlo le hará falta una clave de 6 cifras. No va en este correo: se la damos desde ${datos.clinica}, en mano o por teléfono.`;
  // «admite unas pocas aperturas» y no «se puede abrir unas pocas veces»:
  // «puede» es una palabra DEL CUESTIONARIO de clinica-2, y el guardián de
  // este correo compara palabra con palabra contra todas ellas. Lo cazó en
  // la primera pasada de la suite, que es para lo que existe — y lo que se
  // cambia es el correo, no el guardián: cada excepción que se le añadiera
  // sería una palabra que deja de vigilar.
  const caduca = `El enlace sirve ${datos.diasDeVida} días y admite unas pocas aperturas. Pasado ese plazo, llámenos y le preparamos otro.`;

  const text = [
    saludo,
    "",
    `Aquí está el documento que nos ha pedido de ${datos.clinica}:`,
    datos.url,
    "",
    comoSeAbre,
    "",
    caduca,
    "",
    "Es un documento confidencial: no reenvíe este correo ni comparta el enlace.",
    "",
    dudas,
    "",
    datos.clinica,
  ].join("\n");

  const html = [
    `<p>${escapar(saludo)}</p>`,
    `<p>Aquí está el documento que nos ha pedido de ${escapar(datos.clinica)}:</p>`,
    // El `rel` es belt-and-braces sobre la `Referrer-Policy` que pone la
    // puerta: si el cliente de correo abre el enlace, que no cuente de
    // dónde venía.
    `<p><a href="${escapar(datos.url)}" rel="noreferrer noopener">${escapar(datos.url)}</a></p>`,
    `<p style="font-size:14px;color:#374151">${escapar(comoSeAbre)}</p>`,
    `<p style="font-size:14px;color:#374151">${escapar(caduca)}</p>`,
    `<p style="font-size:14px;color:#374151">Es un documento confidencial: no reenvíe este correo ni comparta el enlace.</p>`,
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
