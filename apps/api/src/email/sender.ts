import nodemailer, { type Transporter } from "nodemailer";

import { loadEnv } from "../env.js";

// Interfaz inyectable. Los tests pasan un mock; el bootstrap de
// producción usa SmtpEmailSender; en NODE_ENV=development cae al
// ConsoleEmailSender (registra a stdout). Mantiene B3 implementable sin
// SMTP real configurado.
export interface SentEmail {
  to: string;
  subject: string;
  text: string;
  // Dirección a la que responde el cliente. Si no se indica, el sender
  // pone la suya (SUPER_ADMIN_REPLY_TO_EMAIL). El From es un no-reply:
  // sin esta cabecera, un "responde a este email" se pierde.
  replyTo?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface EmailSender {
  send(email: SentEmail): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async send(email: SentEmail): Promise<void> {
    const banner = "─".repeat(64);
    const reply = email.replyTo ? `\nreply-to: ${email.replyTo}` : "";
    const attach = email.attachments?.length
      ? `\nattachments: ${email.attachments
          .map((a) => `${a.filename} (${a.content.length}B)`)
          .join(", ")}`
      : "";
    // eslint-disable-next-line no-console
    console.log(
      `\n${banner}\n[email] to=${email.to}${reply}\nsubject=${email.subject}${attach}\n${banner}\n${email.text}\n${banner}\n`,
    );
  }
}

/**
 * Escribe cada email a un fichero, una línea JSON por envío.
 *
 * SÓLO se usa cuando `EMAIL_OUTBOX_FILE` está puesta, y producción no la
 * pone nunca. Existe por el banco de pruebas con navegador: ahí la API es
 * un PROCESO de verdad, así que no se le puede inyectar un doble como
 * hacen los tests de la suite (`vi.mock` de `getEmailSender`), y lo que el
 * capítulo tiene que poder comprobar es el email REAL — su asunto, su
 * cuerpo y el enlace que viaja dentro.
 *
 * El alternativo era leer el stdout del `ConsoleEmailSender`, y no vale:
 * Playwright no le da a un test la salida de sus `webServer`.
 *
 * Se añade con el bloque clinica-2, donde el email ES parte de lo que hay
 * que probar («el email no lleva ninguna palabra del cuestionario»), y
 * sirve igual para cualquier capítulo futuro que mire un correo.
 */
export class FileEmailSender implements EmailSender {
  constructor(
    private readonly path: string,
    private readonly tambienPorConsola = new ConsoleEmailSender(),
  ) {}

  async send(email: SentEmail): Promise<void> {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      this.path,
      JSON.stringify({
        at: new Date().toISOString(),
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html ?? null,
        // Los adjuntos van por nombre y tamaño: el contenido de un PDF no
        // tiene nada que hacer en un fichero de texto.
        attachments: (email.attachments ?? []).map((a) => ({
          filename: a.filename,
          bytes: a.content.length,
        })),
      }) + "\n",
      "utf8",
    );
    // Y también por consola, para que `pnpm dev` siga enseñándolo.
    await this.tambienPorConsola.send(email);
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly replyTo?: string;

  constructor(opts: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    replyTo?: string;
  }) {
    this.from = opts.from;
    this.replyTo = opts.replyTo;
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.port === 465,
      auth: { user: opts.user, pass: opts.pass },
    });
  }

  async send(email: SentEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: email.to,
      replyTo: email.replyTo ?? this.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: email.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
  }
}

let cached: EmailSender | null = null;

// Singleton para el ciclo de vida del proceso. Los tests pueden
// inyectar uno propio con `setEmailSender`.
export function getEmailSender(): EmailSender {
  if (cached) return cached;
  const env = loadEnv();
  // El buzón en fichero gana a todo lo demás: si alguien lo pide, es que
  // está mirando los correos y no quiere que salgan de la máquina.
  const buzon = process.env.EMAIL_OUTBOX_FILE;
  if (buzon) {
    cached = new FileEmailSender(buzon);
    return cached;
  }
  if (
    env.SMTP_HOST &&
    env.SMTP_PORT &&
    env.SMTP_USER &&
    env.SMTP_PASS &&
    env.SMTP_FROM
  ) {
    cached = new SmtpEmailSender({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
      replyTo: env.SUPER_ADMIN_REPLY_TO_EMAIL,
    });
  } else {
    cached = new ConsoleEmailSender();
  }
  return cached;
}

export function setEmailSender(sender: EmailSender): void {
  cached = sender;
}
