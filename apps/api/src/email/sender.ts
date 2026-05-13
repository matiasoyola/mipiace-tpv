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
    const attach = email.attachments?.length
      ? `\nattachments: ${email.attachments
          .map((a) => `${a.filename} (${a.content.length}B)`)
          .join(", ")}`
      : "";
    // eslint-disable-next-line no-console
    console.log(
      `\n${banner}\n[email] to=${email.to}\nsubject=${email.subject}${attach}\n${banner}\n${email.text}\n${banner}\n`,
    );
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(opts: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  }) {
    this.from = opts.from;
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
    });
  } else {
    cached = new ConsoleEmailSender();
  }
  return cached;
}

export function setEmailSender(sender: EmailSender): void {
  cached = sender;
}
