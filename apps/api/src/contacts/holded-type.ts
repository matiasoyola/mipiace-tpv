// v1.4-Buscador-Contactos · normalización del campo `type` del contacto
// remoto de Holded a nuestro enum `ContactType`. Holded devuelve la
// cadena en minúsculas pero defensivamente toleramos cualquier casing
// (y futuros valores) cayendo a UNKNOWN para no esconder contactos
// legítimos preexistentes a la migración b29.

import type { ContactType } from "@mipiacetpv/db";

export function mapHoldedType(raw: unknown): ContactType {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (t) {
    case "client":
      return "CLIENT";
    case "supplier":
      return "SUPPLIER";
    case "lead":
      return "LEAD";
    case "debtor":
      return "DEBTOR";
    case "creditor":
      return "CREDITOR";
    default:
      return "UNKNOWN";
  }
}
