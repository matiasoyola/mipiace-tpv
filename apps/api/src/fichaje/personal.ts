// personal-1 · LA FICHA DE PERSONAL: LEERLA, ESCRIBIRLA Y CONTAR LO QUE
// LE FALTA.
//
// Lo que vive aquí es el trato con la base y con las claves. Las reglas
// —qué falta, con qué peso, cuándo se avisa de un fin de contrato— viven
// en `@mipiacetpv/cuadrante`, que es puro y lo ejecuta también el admin.
//
// ── LOS DOS CIFRADOS ────────────────────────────────────────────────
//
// DNI/NIE y nº de afiliación, con la maquinaria de clinica-7 tal cual:
// `cifrarTexto` / `leerTexto`, los sitios `sitioDniDeEmpleado` y
// `sitioAfiliacionDeEmpleado`, la DEK del tenant envuelta por la
// `CLINICAL_KEK`.
//
// **Escribir usa `asegurarDek`; leer usa `dekONada`.** Es la frontera de
// aquel bloque y aquí vale igual: una lectura que creara la clave dejaría
// filas de clave en empresas que no han escrito un DNI en su vida.
//
// Y la DEK se crea **en la primera escritura**, que para un colegio puede
// ser la primera vez que alguien rellena una ficha. `asegurarDek` no pasa
// por ningún gate de clínica —se comprobó— así que un tenant que sólo
// ficha puede tener su clave sin tener historia.
//
// Lo que NO puede pasar es guardar un DNI en claro porque falte la
// `CLINICAL_KEK`. Eso se contesta con un 503 que dice qué pasa, y el resto
// de la ficha se guarda igual: ver `FaltaLaClaveDelCifrado`.
//
// ── Y LO QUE NO SE REGISTRA ─────────────────────────────────────────
//
// Ni un DNI, ni un nº de afiliación, ni un nombre en ningún log de este
// fichero. Los `catch` del descifrado ya llevan tabla, columna y fila (y
// nada más) por `cripto-campos.ts`.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import {
  datosQueFaltanDePersonal,
  elContratoSeAcaba,
  estadoDeLaFichaDePersonal,
  resumenDeFichasDePersonal,
  type DatoQueFaltaDePersonal,
  type EstadoDeLaFichaDePersonal,
  type FichaExistente,
  type ResumenDeFichasDePersonal,
} from "@mipiacetpv/cuadrante";

import { FaltaLaKek, asegurarDek, dekONada } from "../clinica/claves.js";
import {
  cifrarTexto,
  leerTexto,
  sitioAfiliacionDeEmpleado,
  sitioDniDeEmpleado,
} from "../clinica/cripto-campos.js";
import { localDate } from "./time.js";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

/**
 * No se puede cifrar porque falta la `CLINICAL_KEK` del despliegue.
 *
 * Clase propia para que la ruta pueda contestar un 503 con una frase en
 * vez de un 500 mudo, y **nunca** guardar el valor en claro. Es el mismo
 * reparto que `FaltaLaKek` hace en el arranque de la clínica: si no se
 * puede cifrar, no se escribe.
 */
export class FaltaLaClaveDelCifrado extends Error {
  constructor() {
    super(
      "Este servidor no tiene configurada la clave de cifrado, así que el DNI y el nº de afiliación no se pueden guardar. Avisa a Mi Piace; el resto de la ficha sí se puede completar.",
    );
  }
}

/** Lo que se lee de la base para una ficha. Las dos cifradas incluidas. */
export const FICHA_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  lastName: true,
  email: true,
  phone: true,
  userId: true,
  active: true,
  deactivatedAt: true,
  createdAt: true,
  dniCifrado: true,
  nssCifrado: true,
  categoryId: true,
  weeklyMinutes: true,
  contractKind: true,
  hiredOn: true,
  contractEndsOn: true,
} as const;

export type FilaDeFicha = {
  id: string;
  tenantId: string;
  name: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  userId: string | null;
  active: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  dniCifrado: string | null;
  nssCifrado: string | null;
  categoryId: string | null;
  weeklyMinutes: number | null;
  contractKind: string | null;
  hiredOn: Date | null;
  contractEndsOn: Date | null;
};

/** «YYYY-MM-DD» de una columna `DATE`, sin que ningún huso la mueva. */
export function fechaIso(d: Date | null): string | null {
  if (d == null) return null;
  return d.toISOString().slice(0, 10);
}

/** Y al revés: «YYYY-MM-DD» → la fecha que Prisma escribe en un `DATE`.
 *
 *  Anclada a mediodía UTC y no a medianoche: con `T00:00:00Z`, un servidor
 *  en un huso al oeste guardaría el día anterior. Es la misma precaución
 *  que `diaLargo` en `time.ts`. */
export function fechaDeIso(s: string | null | undefined): Date | null {
  if (s == null || s === "") return null;
  return new Date(`${s}T12:00:00Z`);
}

/**
 * La ficha como la pinta el panel, **con los cifrados descifrados**.
 *
 * Sólo la llaman rutas que ya han pasado por `requireOwnerOrManager`: el
 * DNI de la plantilla no lo ve un cajero. Y devuelve el hueco marcado
 * —`TEXTO_ILEGIBLE`— si un valor no se descifra, en vez de reventar: es la
 * decisión de clinica-7, y aquí vale igual (una ficha de once campos no se
 * esconde entera porque uno no se lea).
 */
export async function fichaDeEmpleado(
  fila: FilaDeFicha,
  dek: Buffer | null,
): Promise<{
  id: string;
  name: string;
  lastName: string | null;
  dni: string | null;
  afiliacion: string | null;
  categoryId: string | null;
  weeklyMinutes: number | null;
  contractKind: string | null;
  hiredOn: string | null;
  contractEndsOn: string | null;
  phone: string | null;
  email: string | null;
  userId: string | null;
  active: boolean;
  faltan: DatoQueFaltaDePersonal[];
  estado: EstadoDeLaFichaDePersonal;
}> {
  const dni = leerTexto(
    { cifrado: fila.dniCifrado, claro: null },
    dek,
    sitioDniDeEmpleado(fila.tenantId, fila.id),
  );
  const afiliacion = leerTexto(
    { cifrado: fila.nssCifrado, claro: null },
    dek,
    sitioAfiliacionDeEmpleado(fila.tenantId, fila.id),
  );
  const estado = estadoDeLaFichaDePersonal(paraCompletar(fila));
  return {
    id: fila.id,
    name: fila.name,
    lastName: fila.lastName,
    dni,
    afiliacion,
    categoryId: fila.categoryId,
    weeklyMinutes: fila.weeklyMinutes,
    contractKind: fila.contractKind,
    hiredOn: fechaIso(fila.hiredOn),
    contractEndsOn: fechaIso(fila.contractEndsOn),
    phone: fila.phone,
    email: fila.email,
    userId: fila.userId,
    active: fila.active,
    faltan: estado.faltan,
    estado,
  };
}

/**
 * Lo que `datosQueFaltanDePersonal` necesita, sacado de la fila.
 *
 * **Presencia y no valor** en los dos cifrados: contar que falta un DNI no
 * exige descifrarlo, y por eso la lista de empleados —21 filas— no toca
 * una clave. Es la misma frontera que alta-minima puso con el DNI del
 * residente.
 */
export function paraCompletar(fila: {
  lastName: string | null;
  dniCifrado: string | null;
  nssCifrado: string | null;
  categoryId: string | null;
  weeklyMinutes: number | null;
  hiredOn: Date | null;
  contractKind: string | null;
  contractEndsOn: Date | null;
  phone: string | null;
  email: string | null;
}) {
  return {
    lastName: fila.lastName,
    tieneDni: fila.dniCifrado != null,
    tieneAfiliacion: fila.nssCifrado != null,
    categoryId: fila.categoryId,
    weeklyMinutes: fila.weeklyMinutes,
    hiredOn: fechaIso(fila.hiredOn),
    contractKind: fila.contractKind,
    contractEndsOn: fechaIso(fila.contractEndsOn),
    phone: fila.phone,
    email: fila.email,
  };
}

/** La misma fila, pero como la quiere el casador del CSV. */
export function paraCasar(fila: FilaDeFicha): FichaExistente {
  return {
    employeeId: fila.id,
    name: fila.name,
    lastName: fila.lastName,
    tieneDni: fila.dniCifrado != null,
    tieneAfiliacion: fila.nssCifrado != null,
    categoryId: fila.categoryId,
    weeklyMinutes: fila.weeklyMinutes,
    hiredOn: fechaIso(fila.hiredOn),
    contractKind: fila.contractKind,
    contractEndsOn: fechaIso(fila.contractEndsOn),
    phone: fila.phone,
    email: fila.email,
  };
}

/** El resumen de la plantilla y a quién se le acaba el contrato. */
export interface ResumenDePersonal extends ResumenDeFichasDePersonal {
  /** Los temporales a quince días o menos de su fin, y los ya vencidos. */
  contratosQueAcaban: Array<{
    employeeId: string;
    nombre: string;
    contractEndsOn: string;
    /** Negativo si ya venció. */
    dias: number;
  }>;
}

/**
 * Lo que pinta el aviso del panel y la cabecera de la lista.
 *
 * Sólo cuenta a quien está **de alta**: la ficha de quien se fue hace tres
 * años está incompleta para siempre y no hay nada que completar. Contarla
 * dejaría el aviso encendido sin forma de apagarlo, que es la manera de
 * enseñar a la gente a ignorarlo.
 */
export function resumenDePersonal(
  filas: FilaDeFicha[],
  hoy: string = localDate(new Date()),
): ResumenDePersonal {
  const activos = filas.filter((f) => f.active);
  const base = resumenDeFichasDePersonal(
    activos.map((f) => datosQueFaltanDePersonal(paraCompletar(f))),
  );
  const contratosQueAcaban = activos
    .filter((f) =>
      elContratoSeAcaba(
        {
          contractKind: f.contractKind,
          contractEndsOn: fechaIso(f.contractEndsOn),
        },
        hoy,
      ),
    )
    .map((f) => ({
      employeeId: f.id,
      nombre: nombreCompleto(f),
      contractEndsOn: fechaIso(f.contractEndsOn)!,
      dias: diasEntre(hoy, fechaIso(f.contractEndsOn)!),
    }))
    // Lo que vence antes, primero. Y lo ya vencido, lo primero de todo.
    .sort((a, b) => a.dias - b.dias);
  return { ...base, contratosQueAcaban };
}

function diasEntre(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000,
  );
}

/** «Ana Soler Ruiz». Para los avisos y para el cuadrante. */
export function nombreCompleto(f: {
  name: string;
  lastName: string | null;
}): string {
  return f.lastName ? `${f.name} ${f.lastName}` : f.name;
}

// ── Escribir ──────────────────────────────────────────────────────────

/** Los campos que una edición de ficha puede mover. */
export interface CambiosDeFicha {
  name?: string;
  lastName?: string | null;
  /** El valor EN CLARO. Aquí se cifra; de aquí no sale. */
  dni?: string | null;
  afiliacion?: string | null;
  categoryId?: string | null;
  weeklyMinutes?: number | null;
  contractKind?: "INDEFINIDO" | "TEMPORAL" | null;
  hiredOn?: string | null;
  contractEndsOn?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Convierte los cambios en el `data` de Prisma, cifrando lo que toca.
 *
 * `undefined` no se toca; `null` **sí** borra. Es la diferencia entre «no
 * me has dicho nada de este campo» y «quítalo», y las dos hacen falta: la
 * importación CSV usa la primera y la ficha del panel la segunda.
 *
 * Y la clave sólo se pide **si hay algo que cifrar**. Una edición que sólo
 * cambia el teléfono no crea la DEK de una empresa que nunca ha guardado
 * un DNI.
 */
export async function datosDeFicha(
  prisma: Ejecutor,
  empleado: { id: string; tenantId: string },
  cambios: CambiosDeFicha,
): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};
  if (cambios.name !== undefined) data.name = cambios.name.trim();
  if (cambios.lastName !== undefined) {
    data.lastName = cambios.lastName?.trim() || null;
  }
  if (cambios.categoryId !== undefined) data.categoryId = cambios.categoryId;
  if (cambios.weeklyMinutes !== undefined) {
    data.weeklyMinutes = cambios.weeklyMinutes;
  }
  if (cambios.contractKind !== undefined) {
    data.contractKind = cambios.contractKind;
  }
  if (cambios.hiredOn !== undefined) data.hiredOn = fechaDeIso(cambios.hiredOn);
  if (cambios.contractEndsOn !== undefined) {
    data.contractEndsOn = fechaDeIso(cambios.contractEndsOn);
  }
  if (cambios.phone !== undefined) data.phone = cambios.phone?.trim() || null;
  if (cambios.email !== undefined) data.email = cambios.email?.trim() || null;

  const hayQueCifrar =
    (cambios.dni !== undefined && cambios.dni != null && cambios.dni !== "") ||
    (cambios.afiliacion !== undefined &&
      cambios.afiliacion != null &&
      cambios.afiliacion !== "");

  let dek: Buffer | null = null;
  if (hayQueCifrar) {
    try {
      dek = await asegurarDek(empleado.tenantId, prisma);
    } catch (err) {
      // Y si no hay KEK, NO se guarda en claro. Nunca.
      if (err instanceof FaltaLaKek) throw new FaltaLaClaveDelCifrado();
      throw err;
    }
  }

  if (cambios.dni !== undefined) {
    data.dniCifrado =
      cambios.dni == null || cambios.dni === ""
        ? null
        : cifrarTexto(
            cambios.dni.trim(),
            dek!,
            sitioDniDeEmpleado(empleado.tenantId, empleado.id),
          );
  }
  if (cambios.afiliacion !== undefined) {
    data.nssCifrado =
      cambios.afiliacion == null || cambios.afiliacion === ""
        ? null
        : cifrarTexto(
            cambios.afiliacion.trim(),
            dek!,
            sitioAfiliacionDeEmpleado(empleado.tenantId, empleado.id),
          );
  }
  return data;
}

/** La DEK para LEER, o `null` si esta empresa no tiene nada cifrado. */
export async function dekParaLeer(
  tenantId: string,
  prisma: Ejecutor,
): Promise<Buffer | null> {
  return dekONada(tenantId, prisma);
}
