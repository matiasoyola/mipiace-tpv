// hotfix-fichaje-medianoche · correr la suite e2e con el reloj puesto a
// una hora concreta de Madrid.
//
// POR QUÉ EXISTE: el bug de este hotfix sólo se veía entre las 00:00 y las
// 02:00 de Madrid. El CI de master llevaba días en rojo a esas horas y
// verde a las nueve de la mañana, y a nadie le cuadraba porque nadie podía
// reproducirlo sin esperar a la madrugada. Esto es la forma de no esperar.
//
// No hace nada salvo que se pida. Sin `FICHAJE_RELOJ` en el entorno, el
// fichero se carga, no toca el reloj y la suite corre como siempre.
//
//   FICHAJE_RELOJ="2026-09-23T00:30:00+02:00" pnpm --filter @mipiacetpv/api test:e2e
//   FICHAJE_RELOJ="2026-09-23T01:59:00+02:00" pnpm --filter @mipiacetpv/api test:e2e
//
// Sólo se finge `Date`. Fingir los timers de verdad dejaría colgadas las
// consultas de Prisma y los `setTimeout` de Fastify, y entonces lo que
// estaría roto sería el banco, no el código. `shouldAdvanceTime` para que
// el reloj corra desde el instante fijado en lugar de quedarse congelado:
// un instante congelado hace que dos fichajes seguidos tengan la MISMA
// hora de servidor, y eso no pasa en la vida real.
//
// Lo que NO arregla: la base de datos tiene su propio `now()`. Lo único
// que mira la hora del servidor de Postgres en este módulo son los
// `DEFAULT now()` de las columnas de auditoría, que ningún test asevera
// contra la hora fingida.

import { afterAll, beforeAll, vi } from "vitest";

const RELOJ = process.env.FICHAJE_RELOJ;

if (RELOJ) {
  const instante = new Date(RELOJ);
  if (Number.isNaN(instante.getTime())) {
    throw new Error(
      `FICHAJE_RELOJ no es una fecha: ${JSON.stringify(RELOJ)}. ` +
        'Espera un ISO-8601 con huso, p. ej. "2026-09-23T00:30:00+02:00".',
    );
  }
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(instante);
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}

/**
 * Corre `fn` con el reloj puesto en `instante`, y al salir devuelve el
 * reloj A COMO ESTABA: real si la suite corre normal, y fijado en
 * `FICHAJE_RELOJ` si se está reproduciendo la madrugada.
 *
 * Lo segundo es la razón de que esto exista en vez de un
 * `useFakeTimers`/`useRealTimers` suelto en cada test: un `useRealTimers`
 * dentro de un test dejaría al resto del fichero corriendo con el reloj
 * de verdad, y la pasada de las 00:30 dejaría de probar las 00:30 a
 * partir del primer test que fingiera su propia hora.
 */
export async function conReloj<T>(
  instante: Date,
  fn: (avanzar: (a: Date) => void) => Promise<T>,
): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(instante);
  try {
    return await fn((a) => vi.setSystemTime(a));
  } finally {
    if (RELOJ) vi.setSystemTime(new Date(RELOJ));
    else vi.useRealTimers();
  }
}
