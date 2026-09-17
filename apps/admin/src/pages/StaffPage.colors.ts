// B-reservas-mostrador · el color que se le PROPONE a una profesional nueva.
//
// El filo lo destapó la revisión de cierre, cruzando el frente 2 con el día en
// que Sole da de alta a su equipo:
//
//   El formulario de perfil proponía `COLOR_PRESETS[0]` a TODA profesional sin
//   perfil. Se dan de alta SOLE, ANA e ISA, nadie toca el selector de color
//   —que es lo normal: el campo ya venía relleno— y las tres quedan en el
//   mismo coral. En la agenda, el tinte del frente 2 las pinta idénticas: el
//   color deja de distinguir de quién es cada cita, que es justo para lo que
//   se puso.
//
// La regla: se propone el PRIMER color de la paleta que no esté usando ya otra
// profesional ACTIVA del tenant. Si están todos usados, se vuelve a empezar
// por el principio.
//
// Sólo cambia el VALOR INICIAL del formulario. El color que una profesional ya
// tiene guardado no se toca nunca: esto no repinta a nadie, sólo evita que la
// siguiente alta nazca repetida.

/** La paleta del selector de perfil. Seis tonos bien separados. */
export const COLOR_PRESETS = [
  "#e8663c",
  "#3c8ce8",
  "#2fb686",
  "#b65fd6",
  "#d6a13c",
  "#5f6bd6",
];

/** Normaliza para comparar: el color viaja como texto desde la BD. */
function clave(c: string | null | undefined): string | null {
  const s = c?.trim().toLowerCase();
  return s ? s : null;
}

/**
 * El color que se le propone a una profesional que todavía no tiene perfil.
 *
 * `enUso` son los colores de las demás — se le pasan tal cual estén en la BD,
 * con sus nulos y sus mayúsculas.
 */
export function colorPropuesto(
  enUso: Iterable<string | null | undefined>,
): string {
  const ocupados = new Set<string>();
  for (const c of enUso) {
    const k = clave(c);
    if (k) ocupados.add(k);
  }
  const libre = COLOR_PRESETS.find((c) => !ocupados.has(c.toLowerCase()));
  // Todos usados: se vuelve a empezar por el principio de la paleta.
  return libre ?? COLOR_PRESETS[0]!;
}

/** Lo que hace falta de una fila de personal para saber qué color ocupa. */
export interface FilaConColor {
  userId: string;
  profile: { active: boolean; color: string | null } | null;
}

/**
 * Los colores que ya están pillados, mirando el personal del tenant.
 *
 * Cuentan sólo las profesionales con perfil y ACTIVAS: una dada de baja no
 * tiene citas en la rejilla, así que su color no estorba a nadie. Y se excluye
 * a la propia (`exceptoUserId`), para que abrir su editor no considere
 * «ocupado» su propio color.
 */
export function coloresEnUso(
  personal: readonly FilaConColor[],
  exceptoUserId: string,
): string[] {
  return personal
    .filter((r) => r.userId !== exceptoUserId && r.profile?.active)
    .map((r) => r.profile!.color)
    .filter((c): c is string => Boolean(clave(c)));
}
