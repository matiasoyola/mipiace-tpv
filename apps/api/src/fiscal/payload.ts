// Lo que el dispositivo manda dentro de la venta: el registro de
// facturación que acaba de generar.
//
// Va DENTRO del payload del ticket y no en una llamada aparte, y eso no es
// una comodidad: la FAQ de desarrolladores de la AEAT (§5) exige que «no
// puede haber facturas expedidas sin sus RF generados, ni RF generados sin
// sus correspondientes facturas expedidas». Un registro y su factura son el
// mismo acto o no son nada — así que viajan en la misma transacción.
//
// El campo canónico es `payload`: el registro completo tal y como lo generó
// el terminal. Las columnas de `fiscal_records` son un índice sobre él, y
// el servidor las DERIVA de ahí en vez de creerse unas copias sueltas.
// Sólo dos cosas vienen aparte porque no se pueden sacar del payload sin
// parsear texto: la serie y el número (dentro van fundidos en un único
// `NumSerieFactura`).

export interface FiscalRecordBody {
  /** Idempotencia. UUID v4 generado por el terminal. */
  externalId: string;
  kind: "ALTA" | "ANULACION";
  /** Posición en la cadena de la caja, 1-based. */
  chainIndex: number;
  serie: string;
  numero: number;
  /** Reloj del terminal en el momento de generar. */
  generatedAt: string;
  /** La cadena exacta sobre la que se calculó la huella. */
  huellaInput: string;
  /** El `RegistroAlta` o `RegistroAnulacion` completo. */
  payload: Record<string, unknown>;
}

/** El fragmento de JSON Schema para Fastify. Se inyecta tal cual en el
 *  `body` de `POST /tickets` y de `POST /tickets/:id/checkout`.
 *
 *  `payload` va con `additionalProperties: true` a propósito: es el
 *  registro de la AEAT y no lo valida este schema, sino la verificación de
 *  la huella. Recortar aquí un campo que no conociéramos lo alteraría — y
 *  alterarlo es exactamente lo que la norma prohíbe. */
export const FISCAL_RECORD_BODY_SCHEMA = {
  type: "object",
  required: [
    "externalId",
    "kind",
    "chainIndex",
    "serie",
    "numero",
    "generatedAt",
    "huellaInput",
    "payload",
  ],
  additionalProperties: false,
  properties: {
    externalId: { type: "string", format: "uuid" },
    kind: { type: "string", enum: ["ALTA", "ANULACION"] },
    chainIndex: { type: "integer", minimum: 1 },
    serie: { type: "string", minLength: 1, maxLength: 20 },
    numero: { type: "integer", minimum: 1 },
    generatedAt: { type: "string", format: "date-time" },
    huellaInput: { type: "string", minLength: 1, maxLength: 2000 },
    payload: { type: "object", additionalProperties: true },
  },
} as const;
