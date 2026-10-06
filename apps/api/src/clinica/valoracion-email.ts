// clinica-2 · el email del test. SIN UN SOLO DATO DE SALUD.
//
// ── Qué lleva, y la lista es cerrada ──────────────────────────────────
//
//   · el nombre de la clínica,
//   · el nombre de pila del paciente,
//   · el día y la hora de su cita,
//   · el enlace.
//
// Y nada más. Ni una pregunta del cuestionario, ni la palabra «diabetes»,
// ni «alergia», ni «anticoagulante», ni el nombre del servicio (que en una
// clínica puede ser «quiropodia diabético»). Un asunto que dijera «test de
// enfermedades crónicas» convierte la bandeja de entrada del paciente —y
// la vista previa en la pantalla de bloqueo de su móvil, que ve quien esté
// al lado— en un dato de salud.
//
// Esto NO es una recomendación de estilo: el email sale del sistema sin
// cifrar y pasa por servidores que no son nuestros. El art. 9 del RGPD
// trata la salud como categoría especial, y «padece X» y «se le está
// preguntando por X» son el mismo dato para cualquiera que lo lea.
//
// Un test lo fija comparando el asunto y el cuerpo contra TODAS las
// palabras del cuestionario, no contra una lista escrita a mano
// (`clinica-valoracion-rutas.test.ts`). Así, el día que se añada una
// pregunta, el guardián ya la cubre.
//
// ── El texto, en palabras de la calle ─────────────────────────────────
//
// Decisión de producto 4. «Unas preguntas» y no «cuestionario
// anamnésico»; «la podóloga necesita saber unas cosas» y no «cumplimente
// el formulario preoperatorio». Lo lee una persona de 78 años en el móvil
// que le ha puesto su hija.

export interface DatosDelEmail {
  clinica: string;
  /** Sólo el nombre de pila. El apellido no hace falta para que se
   *  reconozca y es un dato menos en un correo. */
  nombrePila: string;
  /** La cita, ya formateada en hora del centro. `null` cuando el test se
   *  manda a mano desde la ficha y no cuelga de ninguna cita. */
  cita: { dia: string; hora: string } | null;
  url: string;
}

export interface EmailDelTest {
  subject: string;
  text: string;
  html: string;
}

/**
 * El asunto y el cuerpo. Sin adjuntos: un PDF es una cosa más que abrir y
 * aquí lo único que hay que hacer es tocar un enlace.
 */
export function emailDelTest(datos: DatosDelEmail): EmailDelTest {
  const subject = `${datos.clinica}: unas preguntas antes de su visita`;

  const cuando = datos.cita
    ? `Su cita es el ${datos.cita.dia} a las ${datos.cita.hora}.`
    : "Es para su próxima visita.";

  const text = [
    `Hola, ${datos.nombrePila}.`,
    "",
    `Antes de su visita en ${datos.clinica} necesitamos que nos conteste unas preguntas. Son diez y se contestan con «Sí» o «No»; le llevará unos tres minutos.`,
    "",
    cuando,
    "",
    "Puede contestarlas aquí:",
    datos.url,
    "",
    "Si prefiere, también puede contestarlas en la clínica el día de su cita. Y si le ayuda un familiar, no pasa nada: hay una pregunta para decirnos quién ha contestado.",
    "",
    "Este enlace es sólo suyo. No hace falta contraseña.",
    "",
    datos.clinica,
  ].join("\n");

  const html = [
    `<p>Hola, ${escapar(datos.nombrePila)}.</p>`,
    `<p>Antes de su visita en ${escapar(datos.clinica)} necesitamos que nos conteste unas preguntas. Son diez y se contestan con «Sí» o «No»; le llevará unos tres minutos.</p>`,
    `<p>${escapar(cuando)}</p>`,
    `<p><a href="${escapar(datos.url)}" style="display:inline-block;background:#E97058;color:#ffffff;font-size:18px;font-weight:600;padding:16px 28px;border-radius:16px;text-decoration:none">Contestar las preguntas</a></p>`,
    `<p style="font-size:14px;color:#374151">Si prefiere, también puede contestarlas en la clínica el día de su cita. Y si le ayuda un familiar, no pasa nada: hay una pregunta para decirnos quién ha contestado.</p>`,
    `<p style="font-size:14px;color:#374151">Este enlace es sólo suyo. No hace falta contraseña.</p>`,
    `<p style="font-size:14px;color:#374151">${escapar(datos.clinica)}</p>`,
  ].join("\n");

  return { subject, text, html };
}

/** Escape mínimo para el HTML del email. El `html-escape.ts` de `lib` es
 *  para páginas servidas; aquí sólo hacen falta los cinco. */
function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
