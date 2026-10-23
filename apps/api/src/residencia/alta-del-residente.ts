// historia-1 (D-96) · **EL ALTA, COMPLETA.**
//
// residencia-1 ya cerraba la cama y residencia-2 el plan. Lo que falta, y
// es lo de este fichero:
//
//   1. **la ausencia abierta** se cierra (`ausencias.ts`), porque un
//      residente dado de alta y ausente se queda ausente para siempre;
//   2. **la clase del alta** —traslado, voluntaria, fallecimiento, otra—,
//      que es lo que la estadística y la comunicación necesitan y que un
//      texto libre no puede decidir;
//   3. si la plaza es **concertada**, una **obligación con fecha** de
//      comunicar la baja a la administración.
//
// Y lo que **no** cambia: la historia se conserva (≥ 5 años, Ley
// 41/2002). Aquí no se borra nada; todas las FK son `RESTRICT` y lo
// impedirían igual.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import { addDays } from "@mipiacetpv/residencia-plan";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

/**
 * **Qué clases de plaza obligan a comunicar la baja.**
 *
 * Sólo `CONCERTADA`, y la decisión está en que `TEMPORAL` **no** entra:
 * una plaza temporal puede ser privada o pública y el enum no lo dice
 * (ver su comentario: «los pagadores y la vigencia de la plaza son Fase
 * 3»). Crear la obligación para todas las temporales llenaría el panel de
 * dirección de comunicaciones que no hay que hacer; no crearla para
 * ninguna deja fuera las temporales concertadas.
 *
 * Se elige **no inventar**: la obligación se crea para lo que se sabe que
 * es concertado, y queda anotado como duda abierta para facturacion-1,
 * que es el bloque que va a saber quién paga cada plaza.
 */
export const PLAZAS_QUE_SE_COMUNICAN: readonly string[] = ["CONCERTADA"];

/**
 * El nombre de la obligación de un residente.
 *
 * Lleva su nombre dentro porque `management_duties.name` es **único entre
 * las vivas** del centro (índice parcial `management_duties_nombre_key`):
 * sin el nombre, la segunda baja del mes chocaría con la primera y la
 * obligación no se crearía — justo la que hay que comunicar.
 *
 * Y va **en claro**, como toda la tabla. No añade nada que no esté ya en
 * claro: `clients.first_name` y `resident_profiles.discharge_date` dicen
 * lo mismo, y de ahí sale «los que viven aquí hoy». Lo que esta fila no
 * dice —y no puede decir— es por qué se fue: el motivo del alta va
 * cifrado y la clase no entra aquí.
 */
export function nombreDeLaObligacionDeBaja(nombre: string): string {
  return `Comunicar a la administración la baja de ${nombre}`;
}

export interface BajaQueSeComunica {
  tenantId: string;
  clientId: string;
  /** Como se le llama en la pantalla. */
  nombre: string;
  /** La fecha del alta, «YYYY-MM-DD». */
  alta: string;
  /**
   * El plazo del centro en días, o `null` si no lo ha configurado.
   *
   * `null` **no cancela la obligación**: la crea con la fecha del alta y
   * marcada «periodicidad por verificar». Ver abajo.
   */
  diasDePlazo: number | null;
  userId: string;
}

export interface ObligacionDeBaja {
  dutyId: string;
  dueOn: string;
  /** `true` = el centro no tiene plazo configurado y la fecha es la del
   *  alta, por verificar. */
  plazoPorVerificar: boolean;
}

/**
 * **Crea la obligación de comunicar una baja** (D-96).
 *
 * ── EL PLAZO NO SE INVENTA, Y LA OBLIGACIÓN SE CREA IGUAL ──────────
 *
 * El plazo de comunicación de una baja es **normativa autonómica**.
 * Escribir «15 días» de serie porque suena bien es prometer un plazo que
 * puede no ser el de la Junta, y una obligación con una fecha inventada
 * es peor que una con fecha por confirmar: la primera parece correcta.
 *
 * Así que, sin plazo configurado:
 *
 *   · la fecha es **la del alta** —lo antes posible, que es el lado
 *     seguro de un plazo desconocido—;
 *   · y la fila nace con **`periodicityToVerify = true`**, que es la
 *     columna que residencia-5 creó para exactamente esto: «la
 *     periodicidad es la que alguien supuso y nadie ha confirmado». El
 *     panel lo pinta, la pantalla deja quitarlo y **no bloquea nada**.
 *
 * Reutilizar esa columna en vez de inventar una `fechaPorVerificar` es la
 * decisión: es la misma pregunta («¿esta fecha la ha confirmado
 * alguien?») y un segundo flag con el mismo significado serían dos sitios
 * donde el panel tendría que acordarse de mirar.
 *
 * ── VALIDITY, y no MONTHLY ni ANNUAL ───────────────────────────────
 *
 * Una baja se comunica **una vez** y caduca; no se repite «el 25 de cada
 * mes». `VALIDITY` es exactamente eso (ver el enum
 * `DutyPeriodicity.VALIDITY`), y su ocurrencia es una: la de su fecha.
 *
 * ── Y LA OCURRENCIA SE ESCRIBE AQUÍ, no en la pasada ───────────────
 *
 * `generarOcurrenciasDe` sólo materializa lo que cae en
 * `[hoy − 31, hoy + 90]`, y un plazo de 120 días configurado por el
 * centro se quedaría sin ocurrencia hasta que la pasada lo alcanzara —
 * o sea, invisible en el panel el día del alta, que es el día que a
 * alguien se le tiene que decir. Se escribe directamente, con
 * `skipDuplicates` sobre `(duty_id, due_on)`, así que la pasada
 * programada no la duplica después.
 */
export async function crearObligacionDeBaja(
  prisma: Ejecutor,
  input: BajaQueSeComunica,
): Promise<ObligacionDeBaja> {
  const plazoPorVerificar = input.diasDePlazo == null;
  const dueOn =
    input.diasDePlazo == null ? input.alta : addDays(input.alta, input.diasDePlazo);

  const duty = await prisma.managementDuty.create({
    data: {
      tenantId: input.tenantId,
      name: nombreDeLaObligacionDeBaja(input.nombre),
      // `CUMPLIMIENTO`: es una comunicación a la administración, como el
      // resto de lo reglamentario del bloque C. No `PERSONAL` ni
      // `DINERO`, que son las otras dos familias en las que alguien
      // podría ponerla.
      family: "CUMPLIMIENTO",
      notes: plazoPorVerificar
        ? "El centro no tiene configurado el plazo para comunicar una baja. La fecha es la del alta; confírmala con la administración y ajústala."
        : null,
      periodicity: "VALIDITY",
      validUntil: dueOn,
      periodicityToVerify: plazoPorVerificar,
      // **LEGAL**: no comunicar una baja de una plaza concertada es un
      // incumplimiento con la administración, no un desorden interno. De
      // eso depende que el panel la pinte arriba cuando vence.
      consequence: "LEGAL",
      // El responsable como ETIQUETA y no como rol, a propósito: quien
      // comunica una baja a la Junta es «Administración» en la mayoría de
      // los centros, pero este fichero no puede saber si ESTE centro
      // tiene ese rol sembrado y activo. Una etiqueta se lee igual y la
      // dirección la reasigna desde la pantalla.
      responsibleLabel: "Administración",
      startsOn: input.alta,
      createdByUserId: input.userId,
    },
    select: { id: true },
  });

  await prisma.dutyOccurrence.createMany({
    data: [{ tenantId: input.tenantId, dutyId: duty.id, dueOn }],
    skipDuplicates: true,
  });

  return { dutyId: duty.id, dueOn, plazoPorVerificar };
}

/** ¿Hay que comunicar la baja de esta plaza? */
export function seComunicaLaBaja(placeType: string): boolean {
  return PLAZAS_QUE_SE_COMUNICAN.includes(placeType);
}
