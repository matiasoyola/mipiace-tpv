// clinica-4 · LAS FOTOS DE LA HISTORIA.
//
// Hoy Rosario las hace con el móvil y acaban en su galería, junto a las de
// su familia. Esto las pone en la historia del paciente, por zona y por
// fecha, y las deja comparar antes/hoy con un toque.
//
// ── Lo que este fichero garantiza, y lo que NO hace ──────────────────
//
// Guarda y lee filas; el fichero lo mueve `ficheros.ts` y el permiso lo
// pone `conHistoria`. Las tres reglas que vive aquí dentro:
//
//   1. **Sin consentimiento de fotos vigente no se guarda ninguna**
//      (decisión 10). La puerta está en `consentimientos.ts` y se llama
//      desde la ruta; aquí se repite la comprobación justo antes de
//      escribir, porque es el último punto por el que pasa todo.
//   2. **La zona se elige antes de disparar** (decisión 9, y el mockup):
//      la zona es obligatoria y se valida contra el mapa versionado. Una
//      foto sin zona no se puede comparar con nada, y una foto en una
//      zona que no existe es una foto de ningún sitio.
//   3. **Una foto no se borra: se retira** (decisión 13), con autor y
//      motivo. Deja de salir en el comparador y sigue en la historia y en
//      la rejilla, marcada.
//
// ── Por qué no son `ClinicalEntry` ───────────────────────────────────
//
// Se pensó. Una foto podría ser una entrada más de la historia con su
// `kind`, y heredaría la inmutabilidad, la autoría y los RESTRICT de
// clinica-1 — que es exactamente el argumento con el que clinica-3 decidió
// no crear tabla.
//
// No encaja por **la retirada**. `clinical_entries` es inmutable del todo:
// su trigger rechaza cualquier `UPDATE`. Una foto tiene UNA transición
// legítima (retirarla), y meterla ahí habría obligado a aflojar el trigger
// de la tabla donde viven las sesiones firmadas — o a inventar una
// «entrada de retirada» que apunta a otra, que es un mecanismo nuevo con
// más piezas que una tabla propia. Tabla propia con el patrón de
// `clinical_access`: inmutable salvo una transición que no se deshace.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import { MAPA_PIE_V1, clavesDelMapa, nombreDeZona } from "@mipiacetpv/clinica-sesion";

import { asegurarDek, dekONada } from "./claves.js";
import {
  cifrarTexto,
  leerTexto,
  nuevoIdDeFila,
  sitioMotivoDeRetirada,
  sitioZonaDeFoto,
} from "./cripto-campos.js";
import { nombreParaMostrar } from "../lib/nombre-para-mostrar.js";
import { guardarFichero, MIME_DE_FOTO } from "./ficheros.js";

/** Cuántas fotos entran en la rejilla de «Todas». */
export const FOTOS_DE_LA_HISTORIA = 120;

export interface FotoEnPantalla {
  id: string;
  /** `"L:h"`, y su nombre con el vocabulario de SU versión del mapa. */
  zona: string;
  zonaNombre: string;
  mapaVersion: number;
  hecha: string;
  autor: string;
  retirada: boolean;
  retiradaEn: string | null;
  retiradaMotivo: string | null;
  retiradaPor: string | null;
}

/** El comparador de una zona: la más antigua y la última que quedan. */
export interface ComparadorDeZona {
  zona: string;
  antes: FotoEnPantalla | null;
  ultima: FotoEnPantalla | null;
  /** Cuántas hay en esa zona sin retirar. Con 1 no se puede comparar. */
  cuantas: number;
}

const SELECT_FOTO = {
  id: true,
  tenantId: true,
  zona: true,
  // clinica-7 · las dos cifradas, al lado de las claras. Mandan ellas
  // cuando están; el claro es el respaldo de las filas que el script
  // todavía no ha pasado (ver `cripto-campos.ts`).
  zonaCifrada: true,
  mapaVersion: true,
  createdAt: true,
  withdrawReason: true,
  withdrawReasonCifrado: true,
  withdrawnAt: true,
  author: { select: { alias: true, email: true } },
  withdrawnBy: { select: { alias: true, email: true } },
} satisfies Prisma.ClinicalPhotoSelect;

type FilaDeFoto = Prisma.ClinicalPhotoGetPayload<{ select: typeof SELECT_FOTO }>;

// clinica-8 (fase B, 11) · el nombre, no el email. Era una copia local
// que caía al email entero; ahora es `lib/nombre-para-mostrar.ts`.
const nombreDe = nombreParaMostrar;

/**
 * clinica-7 · la fila, descifrada.
 *
 * La DEK entra como parámetro y puede ser `null`: una clínica sin clave
 * todavía no ha cifrado nada, y entonces lo que se lee es el claro. No se
 * pide la clave aquí dentro porque esta función la llama un `map` sobre
 * ciento veinte fotos — una lectura de clave por foto sería ciento veinte
 * consultas, y el criterio de rendimiento del bloque son 50 ms.
 */
function aPantalla(f: FilaDeFoto, dek: Buffer | null): FotoEnPantalla {
  const zona =
    leerTexto(
      { cifrado: f.zonaCifrada, claro: f.zona },
      dek,
      sitioZonaDeFoto(f.tenantId, f.id),
    ) ?? "";
  return {
    id: f.id,
    zona,
    // Con el vocabulario de SU versión del mapa, no de la de hoy: una
    // foto apuntada a una zona de otra versión se sigue leyendo, y lo que
    // no se hace nunca es pintarla en el sitio de ahora (clinica-3).
    zonaNombre: nombreDeZona(zona, f.mapaVersion),
    mapaVersion: f.mapaVersion,
    hecha: f.createdAt.toISOString(),
    autor: nombreDe(f.author),
    retirada: f.withdrawnAt != null,
    retiradaEn: f.withdrawnAt?.toISOString() ?? null,
    retiradaMotivo: leerTexto(
      { cifrado: f.withdrawReasonCifrado, claro: f.withdrawReason },
      dek,
      sitioMotivoDeRetirada(f.tenantId, f.id),
    ),
    retiradaPor: f.withdrawnAt ? nombreDe(f.withdrawnBy) : null,
  };
}

/** ¿Es una zona del mapa de esta versión? */
export function esZonaDelMapa(clave: string, version: number): boolean {
  return clavesDelMapa(version).includes(clave);
}

export type MotivoDeNoGuardarFoto =
  | "SIN_CONSENTIMIENTO_DE_FOTOS"
  | "ZONA_DESCONOCIDA";

export type ResultadoDeGuardarFoto =
  | { ok: true; foto: FotoEnPantalla }
  | { ok: false; motivo: MotivoDeNoGuardarFoto; mensaje: string };

/**
 * Guarda una foto: el fichero primero, la fila después.
 *
 * Ese orden por lo mismo que el consentimiento: al revés, un fallo de
 * disco deja una fila que promete una foto que no está, y un hueco que
 * dice «aquí había una foto» en una historia clínica es peor que no tener
 * la fila.
 *
 * `hayConsentimiento` lo resuelve la ruta con `puertaDeFotos` y se pasa
 * aquí: esta función no consulta consentimientos por su cuenta para no
 * tener dos sitios que decidan lo mismo, pero **sí se niega** si le dicen
 * que no hay. La negativa vive en el camino de escritura, no sólo en la
 * pantalla.
 */
export async function guardarFoto(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    appointmentId: string | null;
    autorUserId: string;
    zona: string;
    jpeg: Buffer;
    hayConsentimiento: boolean;
  },
): Promise<ResultadoDeGuardarFoto> {
  if (!input.hayConsentimiento) {
    return {
      ok: false,
      motivo: "SIN_CONSENTIMIENTO_DE_FOTOS",
      mensaje:
        "Antes de la primera foto, el paciente tiene que firmar el consentimiento de fotos clínicas.",
    };
  }
  if (!esZonaDelMapa(input.zona, MAPA_PIE_V1.version)) {
    return {
      ok: false,
      motivo: "ZONA_DESCONOCIDA",
      mensaje: "Elige la zona del pie antes de hacer la foto.",
    };
  }

  // clinica-7 · LA CLAVE DE ESTA CLÍNICA, creándola si es la primera vez.
  // Antes de tocar el disco: si no hay forma de cifrar, no se escribe
  // nada — ni el fichero ni la fila.
  const dek = await asegurarDek(input.tenantId, prisma);
  // Y EL ID DE LA FILA, ANTES DE INSERTARLA. La zona se cifra atada a
  // `tenant|clinical_photos|zona|<id>`, y ese id no se puede leer de una
  // fila que todavía no existe. Ver la cabecera de `cripto-campos.ts`.
  const id = nuevoIdDeFila();

  const guardado = await guardarFichero("FOTO", input.jpeg, {
    tenantId: input.tenantId,
    dek,
  });
  const fila = await prisma.clinicalPhoto.create({
    data: {
      id,
      tenantId: input.tenantId,
      clientId: input.clientId,
      appointmentId: input.appointmentId,
      // La zona en claro se deja VACÍA en las filas nuevas: no hay nada
      // que migrar en una fila que nace cifrada, y escribir las dos sería
      // guardar el dato de salud en claro a propósito. El `''` y no `null`
      // porque la columna es NOT NULL desde clinica-4 y quitarle el NOT
      // NULL sería aflojar una garantía para esto.
      zona: "",
      zonaCifrada: cifrarTexto(
        input.zona,
        dek,
        sitioZonaDeFoto(input.tenantId, id),
      ),
      mapaVersion: MAPA_PIE_V1.version,
      fileName: guardado.fileName,
      sha256: guardado.sha256,
      bytes: guardado.bytes,
      mimeType: MIME_DE_FOTO,
      authorUserId: input.autorUserId,
    },
    select: SELECT_FOTO,
  });
  return { ok: true, foto: aPantalla(fila, dek) };
}

export type MotivoDeNoRetirar = "NO_EXISTE" | "YA_ESTABA_RETIRADA";

export type ResultadoDeRetirar =
  | { ok: true; foto: FotoEnPantalla }
  | { ok: false; motivo: MotivoDeNoRetirar; mensaje: string };

/**
 * RETIRA una foto. No la borra.
 *
 * El fichero se queda en el volumen: lo que cambia es que deja de salir
 * en el comparador y que la rejilla la enseña marcada. **La historia no se
 * borra** (clinica-1), y una foto que se pudiera borrar sería la pieza de
 * la historia que sí se puede hacer desaparecer.
 *
 * El motivo es obligatorio —lo exige el CHECK de la tabla— porque la
 * pregunta que alguien va a hacer dentro de un año es «¿por qué no está
 * la foto del 7 de septiembre?», y «la retiró Lucía» no la contesta.
 */
export async function retirarFoto(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    clientId: string;
    fotoId: string;
    userId: string;
    motivo: string;
    ahora: Date;
  },
): Promise<ResultadoDeRetirar> {
  const fila = await prisma.clinicalPhoto.findFirst({
    where: {
      id: input.fotoId,
      tenantId: input.tenantId,
      clientId: input.clientId,
    },
    select: { id: true, withdrawnAt: true },
  });
  if (!fila) {
    return {
      ok: false,
      motivo: "NO_EXISTE",
      mensaje: "Esa foto no está en la historia de este paciente.",
    };
  }
  if (fila.withdrawnAt != null) {
    return {
      ok: false,
      motivo: "YA_ESTABA_RETIRADA",
      mensaje: "Esa foto ya estaba retirada.",
    };
  }
  const dek = await asegurarDek(input.tenantId, prisma);
  const actualizada = await prisma.clinicalPhoto.update({
    where: { id: fila.id },
    data: {
      withdrawnAt: input.ahora,
      withdrawnByUserId: input.userId,
      // El motivo va SOLO cifrado, por lo mismo que la zona de una foto
      // nueva. El CHECK `clinical_photos_retirada_completa` admite las dos
      // formas desde clinica-7, así que una retirada con el motivo
      // únicamente cifrado es una retirada completa.
      withdrawReason: null,
      withdrawReasonCifrado: cifrarTexto(
        input.motivo.trim(),
        dek,
        sitioMotivoDeRetirada(input.tenantId, fila.id),
      ),
    },
    select: SELECT_FOTO,
  });
  return { ok: true, foto: aPantalla(actualizada, dek) };
}

/** Todas las fotos de un paciente, de la más reciente a la más antigua. */
export async function fotosDelPaciente(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<readonly FotoEnPantalla[]> {
  const filas = await prisma.clinicalPhoto.findMany({
    where: { tenantId: input.tenantId, clientId: input.clientId },
    orderBy: { createdAt: "desc" },
    take: FOTOS_DE_LA_HISTORIA,
    select: SELECT_FOTO,
  });
  // UNA lectura de clave para las ciento veinte. `dekONada` y no
  // `asegurarDek`: leer la historia de una clínica que todavía no ha
  // escrito nada no tiene por qué crearle una clave.
  const dek = await dekONada(input.tenantId, prisma);
  return filas.map((f) => aPantalla(f, dek));
}

/**
 * EL COMPARADOR, zona por zona: la más antigua y la última.
 *
 * Decisión 14: en la historia viva, el comparador deja de decir «Sin fotos
 * de esta zona» cuando las hay. Con UNA sola foto tampoco se compara, y la
 * pantalla lo dice («con la segunda podrás comparar») en vez de enseñar la
 * misma foto dos veces, que es lo que hace el mockup de lado a lado.
 *
 * **Las retiradas no entran.** Es la mitad visible de la decisión 13: la
 * foto sigue en la historia y deja de contar para el antes/después.
 */
export function comparadorPorZona(
  fotos: readonly FotoEnPantalla[],
): readonly ComparadorDeZona[] {
  const porZona = new Map<string, FotoEnPantalla[]>();
  for (const f of fotos) {
    if (f.retirada) continue;
    const lista = porZona.get(f.zona) ?? [];
    lista.push(f);
    porZona.set(f.zona, lista);
  }
  return [...porZona.entries()].map(([zona, lista]) => {
    const orden = [...lista].sort((a, b) => (a.hecha < b.hecha ? -1 : 1));
    return {
      zona,
      antes: orden.length >= 2 ? (orden[0] ?? null) : null,
      ultima: orden[orden.length - 1] ?? null,
      cuantas: orden.length,
    };
  });
}

/** La fila de una foto, para servir su JPEG. */
export async function fotoParaServir(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; fotoId: string },
): Promise<{
  fileName: string;
  sha256: string;
  mimeType: string;
  retirada: boolean;
} | null> {
  const fila = await prisma.clinicalPhoto.findFirst({
    where: {
      id: input.fotoId,
      tenantId: input.tenantId,
      clientId: input.clientId,
    },
    select: {
      fileName: true,
      sha256: true,
      mimeType: true,
      withdrawnAt: true,
    },
  });
  if (!fila) return null;
  return {
    fileName: fila.fileName,
    sha256: fila.sha256,
    mimeType: fila.mimeType,
    // Una foto retirada SE SIGUE SIRVIENDO por su id: está en la historia
    // y el paciente tiene derecho de acceso a lo que haya en ella. Lo que
    // cambia es que no sale en el comparador y que la pantalla la enseña
    // marcada con su motivo.
    retirada: fila.withdrawnAt != null,
  };
}
