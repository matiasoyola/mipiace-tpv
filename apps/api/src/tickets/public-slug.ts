// Helper para generar el `publicSlug` del ticket (B-Print fase 1).
//
// 8 bytes random → 16 caracteres hex. ~96 bits de entropía: secreto
// suficiente para servir como capability URL sin TTL. Si en algún
// momento queremos rotar slugs (cliente lo compartió a un tercero
// y quiere revocar), podemos invalidar a nivel registro sin tocar el
// formato.

import { randomBytes } from "node:crypto";

export function generatePublicSlug(): string {
  return randomBytes(8).toString("hex");
}
