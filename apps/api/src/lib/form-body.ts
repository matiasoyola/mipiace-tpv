// A3-distribución · parser de `application/x-www-form-urlencoded`.
//
// La página /apk es un <form method="POST"> sin JavaScript (tiene que
// sobrevivir al Chrome 81 del AP11), así que el navegador manda el body
// urlencoded. Fastify no trae parser para ese content-type.
//
// No se añade `@fastify/formbody` por un único formulario: `URLSearchParams` es
// de Node y hace exactamente esto. El límite de tamaño es defensivo — el único
// campo que esperamos son 6 dígitos, y sin tope un POST público a esta ruta es
// una invitación.

import type { FastifyInstance } from "fastify";

const MAX_FORM_BYTES = 4 * 1024;

export function registerFormBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: MAX_FORM_BYTES },
    (_req, payload, done) => {
      try {
        const params = new URLSearchParams((payload as string) ?? "");
        const out: Record<string, string> = {};
        for (const [key, value] of params) out[key] = value;
        done(null, out);
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );
}
