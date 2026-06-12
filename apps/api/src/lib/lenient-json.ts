// v1.0-pilotos · Lote 2 (#9): parser JSON tolerante con body vacío.
//
// El wrapper fetch del TPV manda `Content-Type: application/json` en
// TODOS los requests, incluidos los POST sin body (reimprimir ticket,
// enviar comanda, gift-receipt-intent). El parser por defecto de
// Fastify responde FST_ERR_CTP_EMPTY_JSON_BODY (400) antes de llegar
// al handler — el síntoma reportado de "reimprimir falla con body
// vacío". Tratamos `""` como `{}`: los endpoints sin body funcionan y
// los que exigen body required siguen devolviendo 400 vía schema.

import type { FastifyInstance } from "fastify";

export function registerLenientJsonParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, payload, done) => {
      if (payload === "" || payload == null) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(payload as string));
      } catch (err) {
        // Igual que el parser por defecto: JSON malformado es culpa del
        // cliente → 400, no 500.
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );
}
