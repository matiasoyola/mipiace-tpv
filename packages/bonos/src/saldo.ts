// B-reservas-8 · el saldo de un bono, DERIVADO DEL LIBRO.
//
// Esta es la única definición de qué significa el saldo, y vive en el
// paquete compartido porque la comparten tres sitios que tienen que decir
// lo mismo: la puerta de canje (API), el test del invariante y la pantalla
// que enseña «quedan 3 · 1 apartada».
//
// ── El convenio del signo ──────────────────────────────────────────────
//
// `sesiones` es el efecto de la línea sobre las sesiones LIBRES, así que
//
//     libres = SUM(sesiones)
//
// es una sola suma y no se puede escribir mal. Lo OBLIGA el CHECK
// `voucher_movements_signo_por_tipo` de la migración, incluida la pieza que
// lo cierra: una `CONSUMIDA` vale 0 exactamente cuando viene de una cita
// —la sesión ya salió de libres al apartarse— y -1 cuando no (el canje en
// caja sin agenda, que no pasa por APARTADA).
//
// Y entonces el invariante del bloque
//
//     total − consumidas − apartadas vivas = libres
//
// no es una comprobación aparte: es una identidad algebraica de las cuatro
// definiciones de abajo. Lo que el test de las 200 operaciones aleatorias
// comprueba no es el álgebra, es que el CÓDIGO que escribe las líneas no se
// sale del convenio — que es lo único que puede romperla.

export type TipoMovimiento =
  | "VENDIDO"
  | "ALTA_INICIAL"
  | "APARTADA"
  | "LIBERADA"
  | "CONSUMIDA"
  | "CORRECCION"
  | "CADUCIDAD_CAMBIADA"
  | "ANULADO";

export type CanalMovimiento = "tpv" | "panel" | "web" | "migracion";

export type MotivoCorreccion =
  | "error_venta"
  | "cortesia"
  | "ajuste_alta_inicial"
  | "otro";

export const MOTIVOS_CORRECCION: readonly MotivoCorreccion[] = [
  "error_venta",
  "cortesia",
  "ajuste_alta_inicial",
  "otro",
];

/** Qué se le enseña a quien corrige. El `otro` exige nota, y la nota va en
 *  el `detalle` — **sin mínimo de caracteres oculto** (`07` pieza 5). */
export const ETIQUETA_MOTIVO: Record<MotivoCorreccion, string> = {
  error_venta: "Error al vender",
  cortesia: "Cortesía",
  ajuste_alta_inicial: "Ajuste del alta inicial",
  otro: "Otro (escribe qué pasó)",
};

/** Los tipos que mueven el TOTAL del bono (lo que el centro debe). */
const TIPOS_DE_TOTAL: ReadonlySet<string> = new Set([
  "VENDIDO",
  "ALTA_INICIAL",
  "CORRECCION",
  "ANULADO",
]);

/** Una línea del libro, lo mínimo para derivar. Estructural a propósito:
 *  vale desde una fila de Prisma, desde SQL crudo y desde un test. */
export interface LineaDelLibro {
  tipo: string;
  sesiones: number;
  appointmentId: string | null;
}

export interface SaldoDerivado {
  total: number;
  consumidas: number;
  apartadas: number;
  libres: number;
}

export function derivarSaldo(lineas: LineaDelLibro[]): SaldoDerivado {
  let total = 0;
  let libres = 0;
  let consumidas = 0;
  let apartadas = 0;
  for (const l of lineas) {
    libres += l.sesiones;
    if (TIPOS_DE_TOTAL.has(l.tipo)) total += l.sesiones;
    if (l.tipo === "CONSUMIDA") {
      consumidas += 1;
      if (l.appointmentId != null) apartadas -= 1;
    } else if (l.tipo === "APARTADA") {
      apartadas += 1;
    } else if (l.tipo === "LIBERADA") {
      apartadas -= 1;
    }
  }
  return { total, consumidas, apartadas, libres };
}

/** El invariante del bloque. `0` = cuadra. Se devuelve la desviación y no
 *  un booleano para que el rojo del test diga de cuánto se ha desviado. */
export function desviacionDelInvariante(s: SaldoDerivado): number {
  return s.total - s.consumidas - s.apartadas - s.libres;
}

/** «quedan 3 · 1 apartada» — la frase que ve el sanitario sin caja, y la
 *  misma que ve recepción al lado del precio. SIN un solo euro. */
export function frasePorSesiones(libres: number, apartadas: number): string {
  const q = `quedan ${libres}`;
  if (apartadas <= 0) return q;
  return `${q} · ${apartadas} ${apartadas === 1 ? "apartada" : "apartadas"}`;
}
