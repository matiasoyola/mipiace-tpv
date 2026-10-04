// El escenario del banco: «Peluquería Demo».
//
// Un solo sitio para los datos del escenario porque los leen DOS cosas que
// tienen que decir lo mismo: el seed, que los mete en la base, y los specs,
// que los teclean en la interfaz y los comprueban en la BD. Si el nombre de
// una clienta viviera en los dos lados, el banco se rompería el día que
// alguien cambie uno.
//
// Reglas del escenario (prompt del bloque):
//   · Tenant ficticio, SIN Holded. Ningún dato real de nadie.
//   · La agenda nace APAGADA: encenderla es el capítulo 1 del vídeo.
//   · Los servicios nacen SIN duración, el equipo SIN perfil de agenda y el
//     centro SIN horario: configurarlos son los capítulos 2, 3 y 4. El seed
//     deja el sustrato, no el resultado.

/** IDs fijos: el spec puede consultar la BD sin buscar por nombre. */
export const ID = {
  tenant: "11111111-1111-4111-8111-111111111111",
  store: "11111111-1111-4111-8111-111111111112",
  register: "11111111-1111-4111-8111-111111111113",
  device: "11111111-1111-4111-8111-111111111114",
  duena: "22222222-2222-4222-8222-222222222201",
  marta: "22222222-2222-4222-8222-222222222202",
  lucia: "22222222-2222-4222-8222-222222222203",
  irene: "22222222-2222-4222-8222-222222222204",
} as const;

export const TENANT_NOMBRE = "Peluquería Demo";

/** El texto plano del token del dispositivo: su hash sha256 va a la BD. */
export const DEVICE_TOKEN = "banco-agenda-dispositivo-0001";

/** Una sola contraseña y un solo PIN en todo el banco: es un tenant de
 *  mentira en una base desechable, y el vídeo no los enseña nunca. */
export const PASSWORD_DUENA = "BancoAgenda2026!";
export const PIN = "1357";

export interface Profesional {
  id: string;
  email: string;
  alias: string;
  /** El color que el admin le PROPONE (COLOR_PRESETS en orden de alta). */
  colorEsperado: string;
}

/** Tres profesionales, como en un centro de verdad. Se dan de alta en este
 *  orden para que el admin les proponga tres colores distintos. */
export const PROFESIONALES: readonly Profesional[] = [
  { id: ID.marta, email: "marta@peluqueriademo.local", alias: "Marta", colorEsperado: "#e8663c" },
  { id: ID.lucia, email: "lucia@peluqueriademo.local", alias: "Lucía", colorEsperado: "#3c8ce8" },
  { id: ID.irene, email: "irene@peluqueriademo.local", alias: "Irene", colorEsperado: "#2fb686" },
] as const;

export const DUENA = {
  id: ID.duena,
  email: "direccion@peluqueriademo.local",
  alias: "Dirección",
} as const;

export interface Servicio {
  sku: string;
  nombre: string;
  /** Precio con IVA, el que se teclea y el que se ve en el ticket. */
  pvpEuros: number;
  /** Base imponible al 21 %, con los 4 decimales de la columna. */
  basePrice: string;
  /** Duración que el capítulo 2 teclea en /admin/agenda-catalog. */
  duracionMin: number;
  /** Pausa después: el rato que la profesional NO atiende a nadie. */
  pausaDespuesMin: number;
  /** Quién lo sabe hacer, por alias. Vacío = nadie (el aviso del cap. 5). */
  loSaben: readonly string[];
}

// Duraciones de peluquería de verdad. El tinte son 90 minutos de los que
// 40 son exposición: ver NOTA DEL TINTE abajo.
export const SERVICIOS: readonly Servicio[] = [
  {
    sku: "SVC-CORTE",
    nombre: "Corte",
    pvpEuros: 18,
    basePrice: "14.8760",
    duracionMin: 30,
    pausaDespuesMin: 0,
    loSaben: ["Marta", "Lucía", "Irene"],
  },
  {
    sku: "SVC-LAVAR",
    nombre: "Lavar y peinar",
    pvpEuros: 15,
    basePrice: "12.3967",
    duracionMin: 30,
    pausaDespuesMin: 0,
    loSaben: ["Marta", "Lucía", "Irene"],
  },
  // EL TINTE VA PARTIDO EN DOS, y es una decisión, no un descuido.
  //
  // Un tinte son 90 minutos de los que ~40 son exposición: la clienta está
  // sentada con el tinte puesto y la peluquera puede cortar a otra. Eso la
  // agenda de hoy NO lo sabe decir — las pausas de un servicio OCUPAN a la
  // profesional (`engine.ts:417-423`) y los servicios de una visita se
  // encadenan seguidos, sin hueco en medio (`engine.ts:183`). Queda como
  // hallazgo 🟡 del bloque.
  //
  // Lo que SÍ se puede hacer con lo que existe: dos servicios, dos citas de
  // la misma clienta, y los 40 minutos de exposición como hueco de verdad
  // entre las dos. En ese hueco entra el corte de otra clienta, y eso es lo
  // que graba el capítulo 6.
  {
    sku: "SVC-TINTE-APLICA",
    nombre: "Tinte · aplicación",
    pvpEuros: 30,
    basePrice: "24.7934",
    duracionMin: 30,
    pausaDespuesMin: 0,
    // Nadie, a propósito: es el aviso que el capítulo 5 provoca y arregla.
    loSaben: [],
  },
  {
    sku: "SVC-TINTE-LAVA",
    nombre: "Tinte · lavado y peinado",
    pvpEuros: 15,
    basePrice: "12.3967",
    duracionMin: 30,
    pausaDespuesMin: 0,
    loSaben: [],
  },
  {
    sku: "SVC-MECHAS",
    nombre: "Mechas",
    pvpEuros: 70,
    basePrice: "57.8512",
    duracionMin: 120,
    pausaDespuesMin: 0,
    // El servicio que SÓLO sabe hacer una: el «no» del capítulo 6.
    loSaben: ["Marta"],
  },
  {
    sku: "SVC-BARBA",
    nombre: "Barba",
    pvpEuros: 8,
    basePrice: "6.6116",
    duracionMin: 15,
    pausaDespuesMin: 0,
    loSaben: ["Irene"],
  },
] as const;

/** Quién arregla el aviso del capítulo 5: las dos mitades del tinte pasan a
 *  saberlas Marta y Lucía (Irene no tiñe). */
export const TINTE_LO_APRENDEN = ["Marta", "Lucía"] as const;

/** Los SKU de las dos mitades del tinte, en orden. */
export const TINTE_SKUS = ["SVC-TINTE-APLICA", "SVC-TINTE-LAVA"] as const;

/**
 * Los minutos de exposición entre la aplicación y el lavado.
 *
 * 40 y no 30: con 30 el hueco mide exactamente lo que un corte, y una cita
 * que encaja al milímetro no prueba que el motor sepa meterla — prueba que
 * los números cuadran. Con 40 el corte entra y SOBRAN 10 minutos, que es lo
 * que pasa en un mostrador de verdad.
 */
export const PAUSA_EXPOSICION_MIN = 40;

export interface Clienta {
  firstName: string;
  /** Vacío a propósito: así apunta una peluquera. La columna es NOT NULL. */
  lastName: string;
  phone: string | null;
}

export const CLIENTAS: readonly Clienta[] = [
  { firstName: "Rosa", lastName: "", phone: null },
  { firstName: "Pili", lastName: "", phone: null },
  { firstName: "Mari Carmen", lastName: "", phone: null },
  // La única con nombre completo y teléfono. Número de la franja de
  // pruebas (600 00 00 00 no es de nadie).
  { firstName: "Carmen", lastName: "Ruiz", phone: "600000001" },
] as const;

/** La clienta NUEVA que el capítulo 6 da de alta desde el TPV: no está en
 *  el seed, y el spec comprueba que después SÍ está en la BD. */
export const CLIENTA_NUEVA = { firstName: "Sonia", lastName: "", phone: null } as const;

// ── El horario del centro (capítulo 4) ────────────────────────────────────
//
// Martes a sábado, 9:00–20:00. Lunes y domingo cerrados: no hay fila, y sin
// fila el centro no abre.
export const HORARIO_SEMANAL = {
  /** ISO-8601: 1 = lunes … 7 = domingo. */
  diasAbiertos: [2, 3, 4, 5, 6] as const,
  abre: "09:00",
  cierra: "20:00",
} as const;

export const FESTIVO_NOMBRE = "Virgen del Prado";
export const DIA_ESPECIAL_NOMBRE = "Víspera · horario reducido";
export const DIA_ESPECIAL_HORAS = { abre: "09:00", cierra: "14:00" } as const;

/**
 * La semana del vídeo: la semana natural que empieza el próximo lunes.
 *
 * Por qué el PRÓXIMO lunes y no esta semana: el capítulo 6 reserva en el
 * futuro (el suelo de la agenda rechaza el pasado) y el capítulo 4 declara
 * un festivo. Con la semana en curso, el día del festivo podría haber
 * quedado ya atrás y el banco cambiaría de resultado según el día en que se
 * lance. Con la semana siguiente, los siete días están siempre por delante.
 *
 * `hoy` se puede inyectar para probar el propio cálculo.
 */
export function semanaDelVideo(hoy = new Date()): {
  lunes: string;
  martes: string;
  miercoles: string;
  jueves: string;
  viernes: string;
  sabado: string;
  domingo: string;
  /** El día normal de trabajo del vídeo (capítulos 6-9). */
  diaNormal: string;
  /** El festivo: cerrado con nombre. */
  festivo: string;
  /** El día especial: abierto con horario propio. */
  diaEspecial: string;
} {
  const base = new Date(
    Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()),
  );
  // getUTCDay(): 0 = domingo. Días hasta el próximo lunes, nunca 0.
  const haciaLunes = ((8 - (base.getUTCDay() || 7)) % 7) || 7;
  const lunes = new Date(base);
  lunes.setUTCDate(base.getUTCDate() + haciaLunes);
  const dia = (offset: number): string => {
    const d = new Date(lunes);
    d.setUTCDate(lunes.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return {
    lunes: dia(0),
    martes: dia(1),
    miercoles: dia(2),
    jueves: dia(3),
    viernes: dia(4),
    sabado: dia(5),
    domingo: dia(6),
    // El miércoles es el día normal; el jueves el festivo; el viernes el
    // día especial. Así el día normal no toca ninguno de los dos raros.
    diaNormal: dia(2),
    festivo: dia(3),
    diaEspecial: dia(4),
  };
}
