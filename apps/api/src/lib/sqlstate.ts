// El SQLSTATE de un error de Postgres, venga como venga envuelto.
//
// POR QUÉ ESTE FICHERO EXISTE. Prisma no deja el código de Postgres en un
// sitio y ya está:
//
//   · en una consulta normal (`prisma.appointment.create`), el error es un
//     `PrismaClientKnownRequestError` y `code` es un código DE PRISMA
//     (`P2002` unique, `P2003` FK…). El SQLSTATE no aparece;
//   · en una RAW (`$executeRawUnsafe`, que es todo lo que toca `tstzrange`
//     en `agenda/store.ts`), `code` es **`P2010`** —«raw query failed»,
//     que vale para cualquier cosa— y el SQLSTATE de verdad se queda en
//     `meta.code` y repetido en el texto: ``Code: `40P01` ``.
//
// Esa segunda forma es la que dejó el frente carrera-409 sin diagnóstico:
// el deadlock `40P01` de dos altas simultáneas salía por el manejador
// genérico etiquetado `P2010`, y `P2010` no dice nada. Quien mire un 500 de
// la API tiene que poder leer el código de Postgres sin abrir el VPS.

/** Cinco caracteres de la clase A–Z0–9, que es la forma de un SQLSTATE. */
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** `P2010`, `P2028`… Los códigos de Prisma tienen la MISMA forma que un
 *  SQLSTATE y no lo son. (Un SQLSTATE que empiece por P es de la clase
 *  `P0` —`P0001` = `raise_exception` de PL/pgSQL—, y ése llega siempre por
 *  `meta.code`, que se mira antes.) */
const CODIGO_DE_PRISMA = /^P[0-9]{4}$/;

/**
 * Devuelve el SQLSTATE (`"40P01"`, `"23P01"`, `"40001"`…) o `null` si el
 * error no trae ninguno. No lanza nunca: se le puede dar cualquier cosa,
 * incluido `undefined`.
 */
export function sqlStateOf(err: unknown): string | null {
  const e = err as {
    code?: unknown;
    meta?: { code?: unknown } | null;
    message?: unknown;
  };

  // 1. `meta.code` PRIMERO: cuando Prisma envuelve una raw query, el de
  //    fuera es el suyo (`P2010`) y el de Postgres está aquí dentro.
  const meta = e?.meta?.code;
  if (typeof meta === "string" && SQLSTATE.test(meta)) return meta;

  // 2. `code` a pelo: los drivers de Postgres (`pg`) lo ponen ahí. Se
  //    descartan los códigos de Prisma, que se le parecen.
  const directo = e?.code;
  if (
    typeof directo === "string" &&
    SQLSTATE.test(directo) &&
    !CODIGO_DE_PRISMA.test(directo)
  ) {
    return directo;
  }

  // 3. El texto, que es lo único que queda cuando el error viaja
  //    serializado: ``Raw query failed. Code: `40P01`.``
  const m = /Code: `([0-9A-Z]{5})`/.exec(String(e?.message ?? ""));
  return m ? m[1]! : null;
}

/** ¿El error trae ESTE SQLSTATE? Azúcar sobre `sqlStateOf`. */
export function hasSqlState(err: unknown, state: string): boolean {
  return sqlStateOf(err) === state;
}
