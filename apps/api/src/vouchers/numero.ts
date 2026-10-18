// B-reservas-8 · la NUMERACIÓN de los bonos. `07` pieza 8, entera.
//
// Tres reglas, y las tres salieron de producción en el spa:
//
//   1. **MANDA EL NÚMERO, no el formato.** Se acepta `B87`, `b 87`, `87` y
//      `B-87`. Quien lo teclea en el mostrador está leyendo un papel y no
//      tiene por qué saber cómo lo escribe la base.
//   2. **Contador atómico que SE SALTA los números ya existentes.** El spa
//      se encontró un bono con un número que había llegado desde dev; un
//      contador que no mira acabaría chocando contra el índice único y
//      tumbando una venta —y «cobrar siempre se puede».
//   3. **CANDADO DE PRIMER USO.** Con `arranque` a NULL no se emite ningún
//      bono. El encargado confirma en Ajustes por qué número empieza el
//      talonario: los centros que vienen de papel siguen su numeración, y
//      arrancar en 1 encima de un talonario que va por el 230 es duplicar
//      números en la vida real.

import type { Prisma } from "@mipiacetpv/db";

/** El prefijo del código. Una letra, como en el spa (`P<n>` allí). */
export const PREFIJO_BONO = "B";

/** `B87` a partir de 87. */
export function codigoDeNumero(numero: number): string {
  return `${PREFIJO_BONO}${numero}`;
}

/**
 * Normaliza lo que alguien teclea a un número de bono, o `null` si no hay
 * número dentro.
 *
 *   "B87" → 87 · "b 87" → 87 · "87" → 87 · "B-87" → 87 · "  b087 " → 87
 *   "" → null · "hola" → null · "B0" → null (no existe el bono 0)
 *
 * Deliberadamente tolerante con el prefijo y con los separadores, y
 * deliberadamente ESTRICTA con lo demás: si hay letras que no son el
 * prefijo, no es un número de bono y se dice que no en vez de adivinar.
 */
export function normalizarCodigo(texto: string): number | null {
  const limpio = texto.trim().toLowerCase().replace(/[\s\-_/.]/g, "");
  const m = /^b?(\d{1,9})$/.exec(limpio);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** El candado de primer uso, como resultado y no como excepción: la ruta
 *  tiene que poder contar QUÉ falta y dónde se arregla. */
export type ResultadoNumero =
  | { ok: true; numero: number; code: string }
  | { ok: false; error: "CANDADO_SIN_CONFIRMAR" };

/**
 * El siguiente número libre de este centro, reservado atómicamente.
 *
 * **Va DENTRO de la transacción de la venta.** Así un fallo posterior hace
 * rollback del contador y no deja huecos (el mismo patrón que
 * `register.ticketCounter` en `POST /tickets`), y un ticket que no se cobra
 * no gasta número porque el bono nace al pasar a `PAID`.
 *
 * El `UPDATE … RETURNING` es el candado: dos ventas simultáneas no pueden
 * leer el mismo valor porque la segunda espera a que la primera cometa.
 * **No se usa «filas afectadas = 0» como candado** (`07` pieza 18): aquí la
 * fila existe siempre —se crea al confirmar el arranque— y lo que decide es
 * el valor devuelto.
 *
 * El bucle de la regla 2 tiene tope: si en 1.000 vueltas no encuentra un
 * hueco, algo pasa que no es «un número que llegó desde dev» y es mejor
 * decirlo que girar.
 */
export async function siguienteNumero(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<ResultadoNumero> {
  const filas = await tx.$queryRaw<Array<{ ultimo: number; arranque: number | null }>>`
    SELECT "ultimo", "arranque"
      FROM "voucher_sequence"
     WHERE "tenant_id" = ${tenantId}::uuid
     FOR UPDATE`;
  const fila = filas[0];
  // Sin fila o sin arranque confirmado: el candado está puesto. Son el
  // mismo caso para quien pregunta —«este centro todavía no emite bonos»—
  // y la fila la crea la confirmación del arranque.
  if (!fila || fila.arranque == null) {
    return { ok: false, error: "CANDADO_SIN_CONFIRMAR" };
  }
  // El arranque manda sobre el contador la primera vez: `ultimo = 0`
  // significa «ninguno emitido todavía», así que el primero es `arranque`.
  let candidato = fila.ultimo === 0 ? fila.arranque : fila.ultimo + 1;
  for (let vuelta = 0; vuelta < 1000; vuelta += 1) {
    const choque = await tx.$queryRaw<Array<{ uno: number }>>`
      SELECT 1 AS uno
        FROM "vouchers"
       WHERE "tenant_id" = ${tenantId}::uuid
         AND ("number" = ${candidato} OR "code" = ${codigoDeNumero(candidato)})
       LIMIT 1`;
    if (choque.length === 0) {
      await tx.$executeRaw`
        UPDATE "voucher_sequence"
           SET "ultimo" = ${candidato}, "updated_at" = now()
         WHERE "tenant_id" = ${tenantId}::uuid`;
      return { ok: true, numero: candidato, code: codigoDeNumero(candidato) };
    }
    candidato += 1;
  }
  throw new Error(
    `voucher_sequence: mil números seguidos ocupados en el tenant ${tenantId}; esto no es «un número que llegó desde dev».`,
  );
}

/**
 * ¿Está PUESTO el candado de primer uso de este centro?
 *
 * `true` mientras nadie haya confirmado por qué número empieza el
 * talonario. Y `true` también si no hay fila: son el mismo caso para quien
 * pregunta —«este centro todavía no emite bonos»— y la fila la crea la
 * confirmación.
 *
 * Existe aparte de `siguienteNumero()` porque la pregunta se hace ANTES de
 * vender, no al emitir: con el candado puesto **no se puede ni añadir un
 * bono al ticket**. Ver `CANDADO_MENSAJE`.
 */
export async function candadoPuesto(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<boolean> {
  const filas = await tx.$queryRaw<Array<{ arranque: number | null }>>`
    SELECT "arranque"
      FROM "voucher_sequence"
     WHERE "tenant_id" = ${tenantId}::uuid
     LIMIT 1`;
  return filas[0]?.arranque == null;
}

/** El código y la frase del candado, en UN sitio.
 *
 *  Lo dicen cuatro puertas —el alta de línea del borrador, la venta
 *  rápida, el cobro del borrador y el alta inicial— y tienen que decir lo
 *  mismo: lo que falta no es un dato del bono, es un ajuste del centro, y
 *  está a dos toques. */
export const CANDADO_ERROR = "BONO_NUMERACION_SIN_CONFIRMAR";
export const CANDADO_MENSAJE =
  "Antes de vender bonos, confirma en Ajustes por qué número empieza el talonario.";
