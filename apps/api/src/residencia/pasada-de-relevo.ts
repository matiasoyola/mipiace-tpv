// residencia-5 · **LA PASADA DEL RELEVO Y DE LAS OBLIGACIONES.**
//
// Tres cosas que corren solas, y vive fuera del worker por lo mismo que
// `pasada-de-guardia.ts` (residencia-4) y `runDayCutPass` (v1.13): así el
// e2e ejecuta **exactamente esto** con un reloj falso y sin levantar
// Redis, y desconectar una de las tres mitades pone la suite roja en vez
// de pasar desapercibido durante semanas (memoria de la casa: en CI no
// hay Redis).
//
//   1. **Congelar el parte** de cada turno que ha cerrado (D-18).
//   2. **Anotar lo que llegó tarde** a un parte ya congelado (decisión de
//      producto 2).
//   3. **Generar las ocurrencias** de las obligaciones (D-42).
//
// ── POR QUÉ SE MIRAN LAS ÚLTIMAS 24 HORAS, Y NO «EL ÚLTIMO MINUTO» ──
//
// Lo obvio sería: «¿acaba de cerrar un turno? congela». Y entonces un
// despliegue de siete minutos a las 15:00 dejaría al centro **sin el
// parte de la mañana**, para siempre, sin que nadie se enterara hasta que
// el turno de tarde se encontrara la sala vacía.
//
// Así que la pasada pregunta otra cosa: **¿hay algún turno cerrado en las
// últimas 24 h que no tenga parte?** Es auto-reparable —la pasada del
// minuto siguiente lo arregla— y es idempotente por el índice único
// `(tenant, turno, día)`, no por un `if`.
//
// El coste: una consulta por centro de residencia y por minuto, más una
// por turno cerrado sin parte. Con quince clientes y uno de residencia es
// invisible; con cincuenta centros habrá que mirarlo, y está dicho en el
// done.
//
// ── Y RESPETA LOS TURNOS CONFIGURABLES (D-54) ───────────────────────
//
// No hay ninguna hora escrita aquí: los turnos salen de `center_shifts` y
// la ventana de cada uno la calcula `ventanaDelTurno`, que es la misma
// función que el parte usa y la que sabe que **la noche cruza
// medianoche**. Un centro que ponga la mañana de 07 a 14 congela a las
// 14:00 sin tocar código.

import type { PrismaClient } from "@mipiacetpv/db";
import { addDays, utcToWallDate } from "@mipiacetpv/residencia-plan";

import { pasadaDeObligaciones } from "./obligaciones.js";
import { anotarLoQueLlegoTarde, congelarParte, ventanaDelTurno } from "./relevo.js";

/** Cuánto hacia atrás se busca un turno cerrado sin parte. Ver cabecera. */
const VENTANA_DE_RESCATE_MS = 24 * 3_600_000;

/**
 * La hora a la que se generan las ocurrencias de las obligaciones.
 *
 * Las 03:00, y no cada minuto: una obligación mensual no cambia de un
 * minuto a otro, y la ventana que se genera son 90 días por delante. Lo
 * que SÍ es inmediato es el alta de una obligación nueva —la ruta genera
 * sus ocurrencias al crearla—, así que nadie espera a mañana para verla
 * en el panel.
 */
export const HORA_DE_LAS_OBLIGACIONES = 3;

export interface ResultadoDeLaPasadaDeRelevo {
  /** Los partes congelados en esta pasada. */
  congelados: Array<{
    tenantId: string;
    handoverId: string;
    careDay: string;
    shiftCode: string;
    lineas: number;
    sinNovedades: boolean;
  }>;
  /** Cuántos añadidos tardíos se anotaron. */
  tardios: number;
  /** `null` cuando no tocaba (no era la hora). */
  obligaciones: { creadas: number } | null;
  /** Cuántos centros fallaron. El fallo de uno no tumba a los demás. */
  errores: number;
}

export async function pasadaDeRelevo(input: {
  prisma: PrismaClient;
  ahora?: Date;
  /** Fuerza la mitad de las obligaciones aunque no sea la hora. Lo usan el
   *  e2e y el disparo a mano. */
  forzarObligaciones?: boolean;
  log?: { info: (o: object, m: string) => void; error: (o: unknown, m?: string) => void };
}): Promise<ResultadoDeLaPasadaDeRelevo> {
  const { prisma } = input;
  const ahora = input.ahora ?? new Date();
  const resultado: ResultadoDeLaPasadaDeRelevo = {
    congelados: [],
    tardios: 0,
    obligaciones: null,
    errores: 0,
  };

  // Los centros con residencia. **Sin esta consulta, un bar pagaría el
  // resto de la pasada**: es la misma economía que `pasadaDeAusenciasGlobal`.
  const centros = await prisma.tenant.findMany({
    where: { residenciaEnabled: true },
    select: { id: true },
  });
  if (centros.length === 0) return resultado;

  const tocaObligaciones =
    input.forzarObligaciones === true || ahora.getHours() === HORA_DE_LAS_OBLIGACIONES;
  let creadas = 0;

  for (const centro of centros) {
    try {
      // ── 1 · CONGELAR LOS TURNOS CERRADOS SIN PARTE ──────────────
      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: centro.id },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      });

      for (const turno of turnos) {
        // Los `care_day` candidatos: hoy, ayer y anteayer. Tres y no uno
        // porque la ventana de rescate son 24 h y **la noche cruza
        // medianoche**: el turno de noche de anteayer acabó ayer a las
        // 08:00, que puede seguir dentro de la ventana.
        const hoy = utcToWallDate(ahora);
        for (const careDay of [hoy, addDays(hoy, -1), addDays(hoy, -2)]) {
          const { hasta } = ventanaDelTurno(turno, careDay);
          // Cerrado, y no hace más de 24 h.
          if (hasta.getTime() > ahora.getTime()) continue;
          if (ahora.getTime() - hasta.getTime() > VENTANA_DE_RESCATE_MS) continue;

          const congelado = await congelarParte(prisma, {
            tenantId: centro.id,
            turno,
            careDay,
            ahora,
          });
          // `null` = ya estaba. Es la idempotencia funcionando, no un
          // error: esta pasada corre cada minuto.
          if (congelado == null) continue;
          resultado.congelados.push({
            tenantId: centro.id,
            handoverId: congelado.handoverId,
            careDay,
            shiftCode: turno.code,
            lineas: congelado.lineas,
            sinNovedades: congelado.sinNovedades,
          });
          input.log?.info(
            {
              event: "relevo_congelado",
              tenantId: centro.id,
              careDay,
              turno: turno.code,
              // **Cuántas líneas, no cuáles**: ni un dato de salud en los
              // logs, igual que el resto de la casa.
              lineas: congelado.lineas,
            },
            "residencia · parte de relevo congelado",
          );
        }
      }

      // ── 2 · LO QUE LLEGÓ TARDE ──────────────────────────────────
      const tardios = await anotarLoQueLlegoTarde(prisma, {
        tenantId: centro.id,
        ahora,
      });
      resultado.tardios += tardios.anotados;

      // ── 3 · LAS OCURRENCIAS DE LAS OBLIGACIONES ─────────────────
      if (tocaObligaciones) {
        const r = await pasadaDeObligaciones(prisma, {
          tenantId: centro.id,
          ahora,
        });
        creadas += r.creadas;
      }
    } catch (err) {
      // El fallo de un centro **no tumba a los demás**, igual que en la
      // pasada de ausencias: con cinco centros, uno sin clave clínica
      // dejaría a los otros cuatro sin parte.
      resultado.errores += 1;
      input.log?.error(
        { err, tenantId: centro.id },
        "residencia · la pasada de relevo falló en un centro",
      );
    }
  }

  if (tocaObligaciones) resultado.obligaciones = { creadas };
  return resultado;
}
