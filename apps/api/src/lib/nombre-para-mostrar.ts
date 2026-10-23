// clinica-8 (fase B, punto 11) · EL NOMBRE DE UNA PERSONA, PARA PINTARLO.
//
// La auditoría del 18-10 vio el email de la propietaria
// —`m.oyola+clinica-demo@mipiace.es`— en «Atiende», en «Firmada por», en
// «Valoración pedida por», en el informe que se le entrega al paciente, en
// los cajeros recientes del PIN y en la barra de abajo del TPV. En un
// informe que sale de la consulta, el email de trabajo de quien firma no
// es un nombre: es un dato de contacto interno que acaba en el bolso de
// una paciente.
//
// La casa ya tenía la regla escrita en el esquema (`User.alias`, v1.7):
// «nombre visible del cajero; sustituye al email en todos los puntos de
// display; el email queda como credencial y canal», y «la API hace
// fallback a la local-part del email al mostrar».
//
// Lo que no había era UN SITIO donde eso estuviera escrito una vez. Había
// seis copias de la misma función de tres líneas —`clinica/sesion.ts`,
// `clinica/fotos.ts`, `clinica/contrato.ts`, `clinica/valoracion.ts`,
// `clinica/consentimientos.ts`, `clinica/informe.ts`— y **las seis caían
// al email entero**, no a la local-part. Seis copias de la misma frase
// mal: es lo que pasa cuando la regla vive en un comentario del esquema y
// no en una función.
//
// ── Por qué la local-part y no «—» ────────────────────────────────────
//
// Porque hay que poder saber QUIÉN firmó. Un informe clínico firmado por
// «—» es un informe sin firmante, y la ley pide lo contrario. La
// local-part es el mal menor y además es casi siempre legible: `rosa`,
// `m.oyola`, `maria.lopez`. Lo que se deja fuera es el dominio, que es la
// parte que no dice nada de la persona y sí de la casa.
//
// ── Y el `alias` ahora NACE con la cuenta ─────────────────────────────
//
// El nombre que el implantador teclea al activar («Rosa Martín») se
// usaba para el email de bienvenida y para la auditoría, y **no se
// escribía en la fila del usuario**. Por eso la local-part era lo único
// que quedaba. Ahora la activación escribe el `alias` (ver
// `superadmin/tenants.ts`), así que en una cuenta nueva estas funciones
// devuelven el nombre de verdad y la local-part es sólo el suelo.

/** Lo mínimo que hace falta para pintar a alguien. */
export interface PersonaParaMostrar {
  alias: string | null;
  email: string | null;
}

/**
 * La local-part de un email, o el email entero si no tiene arroba.
 *
 * Un email sin `@` no existe en la base (`users.email` lo valida la API
 * al crear), pero esta función se llama sobre filas que pueden venir de
 * un seed viejo: devolver la cadena tal cual es mejor que devolver "".
 */
function localPart(email: string): string {
  const corte = email.indexOf("@");
  if (corte <= 0) return email;
  return email.slice(0, corte);
}

/**
 * El nombre con el que se pinta a una persona: su `alias` si lo tiene, y
 * si no la local-part de su email.
 *
 * `null`/`undefined` → el guion: es lo que ya devolvían las seis copias
 * para una fila sin autor (una foto sin `withdrawnBy`, una cita sin
 * profesional asignada) y las pantallas lo esperan.
 */
export function nombreParaMostrar(
  u: PersonaParaMostrar | null | undefined,
): string {
  if (!u) return "—";
  const alias = u.alias?.trim();
  if (alias) return alias;
  const email = u.email?.trim();
  if (email) return localPart(email);
  return "—";
}
