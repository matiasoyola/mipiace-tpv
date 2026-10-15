// residencia-2 (alcance §5, D-53) · APLICAR UNA PLANTILLA A UN RESIDENTE.
//
// Dos momentos, y los dos dentro de una transacción de otra ruta:
//
//   · **al dar de alta** a un residente, se le abre el plan de su nivel;
//   · **al cambiarle el nivel**, se cierran las líneas que vinieron de la
//     plantilla ANTERIOR y no están en la nueva, se abren las que faltan
//     y **las manuales no se tocan**.
//
// Vive aquí y no en `residentes-routes.ts` por una razón concreta: las dos
// llamadas van dentro de transacciones que ya existen (el alta y el PATCH
// de la ficha), y escribir la lógica dos veces en dos handlers largos es
// la forma de que la segunda se olvide de respetar lo manual.
//
// ── Lo que «no se tocan las manuales» significa exactamente ──────────
//
// Una línea `MANUAL` no se cierra NUNCA por un cambio de nivel, ni aunque
// la plantilla nueva traiga el mismo control con otra frecuencia. Si la
// DUE puso a doña Carmen cambios posturales cada 2 h a mano y luego la
// dirección le sube el nivel a dependiente (cuya plantilla dice 3 h), se
// queda con los de 2 h. La razón: la DUE lo decidió mirando a la señora, y
// la plantilla es un valor por defecto para quien no ha mirado todavía.
//
// Y de ahí sale la otra mitad: la plantilla nueva **no abre** una línea de
// un control que ya tiene una viva, sea manual o de plantilla. El índice
// parcial `care_plan_items_one_live_key` lo impediría de todas formas —con
// un error de constraint a mitad de la transacción del alta—, así que se
// comprueba antes y se dice.

import type {
  CareFrequencyKind,
  CarePlanItemSource,
  DependencyLevel,
  Prisma,
} from "@mipiacetpv/db";

// residencia-1b (D-63) · los dos motivos de una línea del plan van
// cifrados. La DEK la trae quien llama, que es la ruta dueña de la
// transacción: pedirla otra vez aquí sería la misma clave con una consulta
// más, y peor — `asegurarDek` dentro de una función que a veces no escribe
// nada crearía claves en centros que no han cifrado nunca.
import {
  cifrarTexto,
  nuevoIdDeFila,
  sitioMotivoDeCierreDeLinea,
  sitioMotivoDeLinea,
} from "../clinica/cripto-campos.js";

import { aColumnas, deColumnas, mismaFrecuencia } from "./frecuencia-columnas.js";

/** Lo que una plantilla dice de un control. */
export interface LineaDePlantilla {
  controlCode: string;
  frequencyKind: CareFrequencyKind;
  everyNHours: number | null;
  everyNDays: number | null;
  weekdays: number[];
  monthDay: number | null;
  shiftCodes: string[];
  momentCodes: string[];
}

/** Qué hizo el recálculo, para la respuesta de la ruta y para el test. */
export interface ResultadoDelPlan {
  abiertas: string[];
  cerradas: string[];
  /** Controles que la plantilla traía y ya tenían línea viva: no se tocan. */
  yaTenian: string[];
}

/**
 * Las líneas de la plantilla de un nivel, **sólo de controles activos**.
 *
 * El filtro por `active` es lo que evita precargarle a un residente un
 * control que el centro apagó: entraría en su plan, no «tocaría» nunca
 * (`queToca` lo salta) y aparecería en su ficha como una línea muerta que
 * nadie entiende.
 *
 * Y es un filtro y no un error: que la dirección haya apagado la gimnasia
 * es una decisión suya, no un fallo de la plantilla.
 */
export async function lineasDeLaPlantilla(
  tx: Prisma.TransactionClient,
  tenantId: string,
  nivel: DependencyLevel,
): Promise<LineaDePlantilla[]> {
  const [lineas, apagados] = await Promise.all([
    tx.carePlanTemplateItem.findMany({
      where: { tenantId, dependencyLevel: nivel },
      select: {
        controlCode: true,
        frequencyKind: true,
        everyNHours: true,
        everyNDays: true,
        weekdays: true,
        monthDay: true,
        shiftCodes: true,
        momentCodes: true,
      },
    }),
    tx.centerControlSetting.findMany({
      where: { tenantId, active: false },
      select: { controlCode: true },
    }),
  ]);
  const fuera = new Set(apagados.map((a) => a.controlCode));
  return lineas.filter((l) => !fuera.has(l.controlCode));
}

/**
 * Aplica la plantilla de `nivel` al plan de un residente.
 *
 * `nivelAnterior` es `null` en un alta (no había plantilla antes) y el
 * nivel de antes en un cambio. De eso depende qué se cierra: en un alta no
 * se cierra nada, porque no hay nada.
 *
 * Todo con el `tx` que le pasa la ruta: el alta de un residente y su plan
 * son la misma operación. Si el plan se abriera después, en otra
 * transacción, un fallo dejaría a un residente dado de alta sin plan —y
 * eso no se ve hasta el primer turno, cuando la puerta no pide nada.
 */
export async function aplicarPlantilla(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    clientId: string;
    nivel: DependencyLevel;
    nivelAnterior: DependencyLevel | null;
    /** Desde cuándo rigen las líneas nuevas. El alta usa la fecha de ingreso. */
    desde: Date;
    /** Quién lo disparó, para firmar lo que se abre y lo que se cierra. */
    userId: string | null;
    motivo: string;
    /** residencia-1b · la clave del centro, de la transacción de quien
     *  llama. Obligatoria: sin ella el motivo se escribiría en claro, y eso
     *  es lo que el bloque viene a cerrar. */
    dek: Buffer;
  },
): Promise<ResultadoDelPlan> {
  const { tenantId, clientId, nivel, nivelAnterior, desde, userId, motivo, dek } =
    input;

  const [plantilla, vivas] = await Promise.all([
    lineasDeLaPlantilla(tx, tenantId, nivel),
    tx.carePlanItem.findMany({
      where: { tenantId, clientId, toAt: null },
      select: {
        id: true,
        controlCode: true,
        source: true,
        sourceLevel: true,
        frequencyKind: true,
        everyNHours: true,
        everyNDays: true,
        weekdays: true,
        monthDay: true,
        shiftCodes: true,
        momentCodes: true,
      },
    }),
  ]);

  const enLaPlantilla = new Map(plantilla.map((l) => [l.controlCode, l]));
  const fuera: ResultadoDelPlan = { abiertas: [], cerradas: [], yaTenian: [] };
  const ahora = new Date();

  // ── 1 · Cerrar lo que sobra ────────────────────────────────────────
  //
  // Sólo líneas `PROFILE_TEMPLATE`, y sólo las del nivel ANTERIOR. Las dos
  // condiciones importan:
  //
  //   · `MANUAL` no se cierra nunca (ver la cabecera);
  //   · `sourceLevel` distinto del anterior es una línea que puso otra
  //     plantilla en otro momento —un residente puede haber pasado por
  //     tres niveles— y cerrarla sería deshacer un paso que ya estaba
  //     dado. En la práctica, con `one_live_key`, sólo puede haber una
  //     viva por control; la condición está por si el camino cambia.
  for (const viva of vivas) {
    if (viva.source !== "PROFILE_TEMPLATE") continue;
    if (nivelAnterior !== null && viva.sourceLevel !== nivelAnterior) continue;
    if (enLaPlantilla.has(viva.controlCode)) continue;
    await tx.carePlanItem.update({
      where: { id: viva.id },
      data: {
        toAt: ahora,
        closeReason: null,
        closeReasonCifrado: cifrarTexto(
          motivo,
          dek,
          sitioMotivoDeCierreDeLinea(tenantId, viva.id),
        ),
        closedByUserId: userId,
      },
    });
    fuera.cerradas.push(viva.controlCode);
  }

  // ── 2 · Reajustar lo que sigue y cambia de frecuencia ─────────────
  //
  // Un control que está en las dos plantillas pero con otra frecuencia (la
  // hidratación cutánea pasa de diaria a cada turno al subir a
  // dependiente) se cierra y se abre, igual que un cambio a mano. **Si es
  // MANUAL no**: eso es lo que la DUE decidió.
  const yaVivas = new Map(vivas.map((v) => [v.controlCode, v]));
  for (const linea of plantilla) {
    const viva = yaVivas.get(linea.controlCode);
    if (!viva) continue;
    if (viva.source === "MANUAL") {
      fuera.yaTenian.push(linea.controlCode);
      continue;
    }
    if (mismaFrecuencia(deColumnas(viva), deColumnas(linea))) {
      fuera.yaTenian.push(linea.controlCode);
      continue;
    }
    await tx.carePlanItem.update({
      where: { id: viva.id },
      data: {
        toAt: ahora,
        closeReason: null,
        closeReasonCifrado: cifrarTexto(
          motivo,
          dek,
          sitioMotivoDeCierreDeLinea(tenantId, viva.id),
        ),
        closedByUserId: userId,
      },
    });
    // residencia-1b · el uuid, generado aquí: el AAD lo necesita y no se
    // puede leer de una fila que todavía no existe.
    const nuevaId = nuevoIdDeFila();
    await tx.carePlanItem.create({
      data: {
        id: nuevaId,
        tenantId,
        clientId,
        controlCode: linea.controlCode,
        ...aColumnas(deColumnas(linea)),
        // `ahora` y no `desde`: la línea nueva empieza cuando se cambia el
        // nivel, no cuando ingresó. Si empezara en el ingreso, se solaparía
        // con la que acaba de cerrarse y «¿qué le tocaba en marzo?»
        // tendría dos respuestas.
        fromAt: ahora,
        toAt: null,
        source: "PROFILE_TEMPLATE" as CarePlanItemSource,
        sourceLevel: nivel,
        reason: null,
        reasonCifrado: cifrarTexto(
          motivo,
          dek,
          sitioMotivoDeLinea(tenantId, nuevaId),
        ),
        createdByUserId: userId,
      },
    });
    fuera.cerradas.push(linea.controlCode);
    fuera.abiertas.push(linea.controlCode);
  }

  // ── 3 · Abrir lo que falta ────────────────────────────────────────
  const nuevas = plantilla.filter((l) => !yaVivas.has(l.controlCode));
  if (nuevas.length > 0) {
    // residencia-1b · el `createMany` sigue siendo UNA sentencia, y cada
    // fila lleva SU uuid y SU ciphertext. El AAD ata el valor a la fila, así
    // que el mismo «ingreso» en diez líneas son diez ciphertexts distintos
    // — y ninguno vale en la fila de al lado. Es más caro que un literal
    // repetido y es exactamente lo que se compra.
    await tx.carePlanItem.createMany({
      data: nuevas.map((l) => {
        const id = nuevoIdDeFila();
        return {
          id,
          tenantId,
          clientId,
          controlCode: l.controlCode,
          ...aColumnas(deColumnas(l)),
          // En un alta, `desde` es la fecha de ingreso: así `queToca` no le
          // pide nada de antes de llegar al centro. En un cambio de nivel,
          // la ruta pasa `new Date()`.
          fromAt: desde,
          toAt: null,
          source: "PROFILE_TEMPLATE" as CarePlanItemSource,
          sourceLevel: nivel,
          reason: null,
          reasonCifrado: cifrarTexto(motivo, dek, sitioMotivoDeLinea(tenantId, id)),
          createdByUserId: userId,
        };
      }),
    });
    fuera.abiertas.push(...nuevas.map((l) => l.controlCode));
  }

  return fuera;
}

/**
 * Cierra el plan vivo de un residente al que se le da de alta (se va).
 *
 * No se borra nada: `to_at` con la fecha y el motivo. Y hace falta hacerlo
 * en la misma transacción del alta por lo mismo que se cierra su ocupación
 * de cama (residencia-1 §2): si el plan se quedara abierto, la puerta
 * seguiría pidiendo el cambio postural de alguien que ya no vive aquí, y
 * el panel lo contaría como incumplido todos los turnos.
 */
export async function cerrarPlanPorAlta(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    clientId: string;
    cuando: Date;
    userId: string | null;
    motivo: string;
    /** residencia-1b · la clave del centro. Ver `aplicarPlantilla`. */
    dek: Buffer;
  },
): Promise<number> {
  // residencia-1b · ESTO ERA UN `updateMany` Y NO PUEDE SEGUIR SIÉNDOLO.
  //
  // El AAD de `close_reason` lleva el id de la fila, así que el mismo
  // motivo en ocho líneas son ocho ciphertexts distintos y un `updateMany`
  // sólo sabe escribir uno. Se leen las vivas y se cierran una por una, en
  // la misma transacción: el plan de un residente dado de alta tiene ocho
  // líneas, no ocho mil.
  const vivas = await tx.carePlanItem.findMany({
    where: { tenantId: input.tenantId, clientId: input.clientId, toAt: null },
    select: { id: true },
  });
  for (const viva of vivas) {
    await tx.carePlanItem.update({
      where: { id: viva.id },
      data: {
        toAt: input.cuando,
        closeReason: null,
        closeReasonCifrado: cifrarTexto(
          input.motivo,
          input.dek,
          sitioMotivoDeCierreDeLinea(input.tenantId, viva.id),
        ),
        closedByUserId: input.userId,
      },
    });
  }
  return vivas.length;
}
