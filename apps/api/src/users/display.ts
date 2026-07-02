// v1.7-alias-cajeros: label humano del cajero para tickets, comandas
// e informes. Preferencia: alias; fallback a la local-part del email
// (usuarios legacy sin alias hasta que el admin los edite). El fallback
// es obligatorio en TODOS los puntos que imprimen o muestran cajero.
export function cashierLabelFrom(user: {
  alias: string | null;
  email: string;
}): string {
  const alias = user.alias?.trim();
  if (alias) return alias;
  const at = user.email.indexOf("@");
  return at <= 0 ? user.email : user.email.slice(0, at);
}
