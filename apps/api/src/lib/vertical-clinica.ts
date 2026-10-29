// clinica-11 · QUÉ ES UNA CLÍNICA, DICHO UNA SOLA VEZ.
//
// La pregunta no es «¿tiene la historia clínica encendida?», porque una
// residencia la tiene: `residenciaEnabled` enciende la clínica y el CRM
// por diseño (residencia-1), y hay un CHECK en la base que lo obliga
// (`tenants_residencia_exige_clinica`). La pregunta es «¿es una CONSULTA?
// — una podóloga que llega, atiende y cobra».
//
// Esa distinción ya existía, y existía dentro de un solo fichero: el
// `applies.clinicaDePodologia` de `superadmin/onboarding-health.ts`, que
// clinica-8 (fase B) tuvo que escribir cuando el check «Catálogo clínico
// completo» bloqueó la activación de TODAS las residencias. Sube aquí
// porque este bloque la necesita en un segundo sitio —la apertura
// automática del turno— y dos sitios con la misma pregunta escrita a mano
// son dos sitios que se separan: el día que llegue un tercer vertical con
// la clínica encendida, uno se enteraría y el otro no.
//
// ── POR QUÉ NO ES `businessType` ─────────────────────────────────────
//
// `BusinessType` tiene tres valores (HOSPITALITY, RETAIL, SERVICES) y una
// clínica es `SERVICES`, igual que una peluquería y un taller. Una
// peluquería SÍ abre turno: hay mostrador, hay cajón y hay varias
// personas cobrando. Lo que cambia el flujo de caja no es el vertical
// comercial, es que la consulta no tiene mostrador.

/** Lo que hay que leer del tenant para contestar. Dos columnas. */
export interface TenantConVertical {
  clinicalRecordsEnabled?: boolean | null;
  residenciaEnabled?: boolean | null;
}

/** El `select` de Prisma que trae esas dos columnas, para que los
 *  llamantes no las escriban a mano. */
export const SELECT_VERTICAL_CLINICA = {
  clinicalRecordsEnabled: true,
  residenciaEnabled: true,
} as const;

/**
 * ¿Es esto una consulta clínica?
 *
 * `=== true` en la primera y `!== true` en la segunda, cada una con su
 * razón y no por gusto:
 *
 *   · `clinicalRecordsEnabled` es `@default(false)`, así que lo explícito
 *     es el ENCENDIDO. Un doble de Prisma que no devuelva la columna deja
 *     esto en `false`, y `false` es el lado seguro: la cuenta se comporta
 *     como se comportaba ayer (con su pantalla de abrir turno).
 *   · `residenciaEnabled` también es `@default(false)`, pero aquí lo que
 *     se pregunta es la NEGACIÓN, y `!== true` significa «mientras no me
 *     consten de que es una residencia». Si la columna no viniera, una
 *     residencia se trataría como clínica — y de las dos equivocaciones
 *     posibles ésa es la barata: una residencia tiene mostrador y turno,
 *     así que su primer cobro del día ya encuentra el turno abierto y la
 *     apertura automática no se dispara nunca.
 */
export function esVerticalClinica(tenant: TenantConVertical | null): boolean {
  if (!tenant) return false;
  return (
    tenant.clinicalRecordsEnabled === true && tenant.residenciaEnabled !== true
  );
}
