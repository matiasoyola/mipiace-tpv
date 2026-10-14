// clinica-7 · LAS TRES NOTAS QUE NO SON DE UNA TABLA CLÍNICA.
//
//   `appointments.notes`          la nota de una cita
//   `clients.notes`               la nota de la ficha
//   `client_technical_notes.body` la ficha técnica por servicio
//
// Las tres existen desde B1 y las usa el spa. Decisión 10: **se cifran en
// los tenants con la clínica encendida.** En una clínica, «viene por lo
// del dedo infectado» acaba en la nota de la cita, y eso es un dato de
// salud en una tabla que nadie trataba como clínica. En la peluquería de
// al lado la misma columna lleva «no le gusta el secador» y no hay nada
// que proteger.
//
// ── Por qué «según el tenant» y no siempre ──────────────────────────
//
// Porque cifrar las notas de todos los negocios tiene un coste que no
// compra nada: la agenda del bar perdería la búsqueda por nota (que la
// usa recepción), y la nota de la ficha de un cliente de peluquería dejaría
// de poder leerse con un `SELECT` cuando Matías está depurando un alta que
// no cuadra. El dato de salud es lo que hay que blindar; «no le gusta el
// secador», no.
//
// ── Y lo que esto NO es ─────────────────────────────────────────────
//
// No es un `if` repartido por la agenda y el CRM. Es **esta** función, que
// contesta las dos preguntas juntas («¿hay que cifrar?» y «¿con qué
// clave?») y devuelve las dos columnas ya escritas. Los llamantes hacen
// `...await notaParaGuardar(...)` y no deciden nada.
//
// ── La caché de «¿es clínico?» ──────────────────────────────────────
//
// `clinicaIsEnabled` es una consulta por llamada, y por aquí pasa cada
// alta de cita y cada alta de cliente de todos los negocios. Se cachea con
// el MISMO TTL que las claves (60 s) y por el mismo motivo: encender el
// módulo tiene que surtir efecto pronto, y un minuto es pronto. El riesgo
// de la ventana es acotado y va en la dirección buena — durante como mucho
// un minuto, una clínica recién encendida guardaría una nota en claro, y
// el script de cifrado la pasa después.

import { clinicaIsEnabled } from "./gate.js";
import { asegurarDek, dekONada, type Ejecutor } from "./claves.js";
import {
  cifrarTexto,
  leerTexto,
  sitioNotaDeCita,
  sitioNotaDeFicha,
  sitioNotaTecnica,
} from "./cripto-campos.js";
import type { SitioDelValor } from "./cripto.js";

const TTL_MS = 60_000;
const esClinico = new Map<string, { si: boolean; hasta: number }>();

/** Para los tests y para cuando el superadmin enciende o apaga el módulo. */
export function olvidarSiEsClinico(tenantId?: string): void {
  if (tenantId == null) esClinico.clear();
  else esClinico.delete(tenantId);
}

async function tenantClinico(tenantId: string): Promise<boolean> {
  const ahora = Date.now();
  const cacheado = esClinico.get(tenantId);
  if (cacheado && cacheado.hasta > ahora) return cacheado.si;
  const si = await clinicaIsEnabled(tenantId);
  esClinico.set(tenantId, { si, hasta: ahora + TTL_MS });
  return si;
}

/** Cuál de las tres notas es. El nombre de la columna lo decide
 *  `cripto-campos.ts`; aquí solo se elige cuál. */
export type QueNota = "CITA" | "FICHA" | "TECNICA";

const SITIO: Record<QueNota, (t: string, id: string) => SitioDelValor> = {
  CITA: sitioNotaDeCita,
  FICHA: sitioNotaDeFicha,
  TECNICA: sitioNotaTecnica,
};

/** Las dos columnas de una nota, ya decididas. */
export interface NotaGuardable {
  /** La columna en claro. `null` en un tenant clínico. */
  claro: string | null;
  /** La cifrada. `null` en un tenant que no es clínico. */
  cifrado: string | null;
}

/**
 * Qué escribir en las dos columnas de una nota.
 *
 * En un tenant clínico: solo la cifrada, y el claro a `null`. En
 * cualquier otro: solo el claro, como siempre.
 *
 * `id` es el de la fila, y el llamante tiene que saberlo antes de
 * insertarla (ver la cabecera de `cripto-campos.ts`). Para un UPDATE ya lo
 * tiene.
 */
export async function notaParaGuardar(
  input: {
    tenantId: string;
    id: string;
    que: QueNota;
    texto: string | null | undefined;
  },
  prisma?: Ejecutor,
): Promise<NotaGuardable> {
  const texto = input.texto?.trim() || null;
  if (texto == null) return { claro: null, cifrado: null };
  if (!(await tenantClinico(input.tenantId))) {
    return { claro: texto, cifrado: null };
  }
  const dek = await asegurarDek(input.tenantId, prisma);
  return {
    claro: null,
    cifrado: cifrarTexto(texto, dek, SITIO[input.que](input.tenantId, input.id)),
  };
}

/**
 * Lee una nota de sus dos columnas. Manda la cifrada.
 *
 * `dek` entra como parámetro y no se lee aquí dentro porque la agenda lee
 * cuarenta citas de un día de una vez: una consulta de clave por cita
 * serían cuarenta consultas por pantalla.
 */
export function leerNota(
  input: {
    tenantId: string;
    id: string;
    que: QueNota;
    claro: string | null;
    cifrado: string | null;
  },
  dek: Buffer | null,
): string | null {
  return leerTexto(
    { cifrado: input.cifrado, claro: input.claro },
    dek,
    SITIO[input.que](input.tenantId, input.id),
  );
}

/**
 * La clave para leer un lote de notas, o `null`.
 *
 * Azúcar sobre `dekONada` para que los llamantes de la agenda y del CRM no
 * tengan que importar el llavero: lo que ellos quieren es «descíframe
 * estas notas si hace falta», y si el tenant no es clínico no hace falta
 * nada.
 */
export async function dekParaNotas(
  tenantId: string,
  prisma?: Ejecutor,
): Promise<Buffer | null> {
  if (!(await tenantClinico(tenantId))) return null;
  return dekONada(tenantId, prisma);
}
