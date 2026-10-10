// kds-2-wifi · EL SOBRE DEL CAMINO DIRECTO.
//
// Lo que viaja por la wifi del bar entre el TPV y la tablet de cocina
// cuando internet se cae. Es el ÚNICO contrato entre tres
// implementaciones: el TPV (este fichero), la pieza nativa de la tablet
// (`KitchenLanProtocol.java`) y el servidor, que emite la clave y recibe
// después lo que pasó.
//
// ── POR QUÉ VA CIFRADO Y NO SÓLO FIRMADO ──────────────────────────────
//
// El prompt dejaba la decisión abierta («cifrado si el coste es
// razonable»). Va **cifrado**, y el coste es menor que el de no hacerlo:
//
//   · Lo que viaja lleva el plato de la silla 3 de una mesa con un
//     celíaco. Es la wifi de un bar, con el móvil de cualquier cliente
//     dentro; en claro, cualquiera con un sniffer lee las comandas.
//   · AES-GCM está en las dos plataformas sin añadir nada: `crypto.subtle`
//     en el WebView y `javax.crypto` en Android. No hay librería nueva.
//   · **Y es un primitivo menos.** GCM autentica además de cifrar: su
//     etiqueta ES la firma que pedía el prompt. Con HMAC + nada haría
//     falta firmar y además decidir qué se firma; aquí es lo mismo.
//
// Lo que NO va cifrado es la cabecera —versión, tienda, aparato, tipo, id
// de la operación y sello de tiempo—, y es deliberado: el que recibe tiene
// que poder rechazar por tienda ajena o por viejo **sin descifrar nada**.
// Va como AAD, así que está autenticada: cambiar un byte de la cabecera
// invalida la etiqueta igual que cambiar el cuerpo.
//
// ── EL ORDEN DE LOS RECHAZOS, QUE IMPORTA ─────────────────────────────
//
//   1. versión distinta      → `VERSION`     (una APK vieja contra otra nueva)
//   2. otra tienda           → `OTRA_TIENDA` (el bar de al lado en la misma wifi)
//   3. más viejo que la ventana → `VIEJO`    (un mensaje grabado y resoplado)
//   4. id de operación repetido → `REPETIDO` (el duplicado del doble camino)
//   5. la etiqueta no vale   → `FIRMA`       (no tiene la clave de la tienda)
//
// Los cuatro primeros son baratos y no tocan la clave. El quinto es el que
// de verdad cierra la puerta, y es el último porque es el caro.

/** Versión del sobre. Sube cuando cambie el formato, y una APK vieja lo rechaza. */
export const SOBRE_VERSION = 1;

/**
 * Puerto por defecto del servidor de la tablet.
 *
 * 8787 y no 80/8080: por encima de 1024 (no hace falta ser root, que en
 * Android no lo somos nunca) y lejos de lo que suele haber en una red de
 * bar (8080 de cámaras y grabadores, 9100 de las térmicas de red, 5555 del
 * adb). Es **configurable por aparato** (`devices.kitchen_lan_port`): si en
 * un local hay algo en 8787, se cambia sin tocar código.
 */
export const PUERTO_LAN_POR_DEFECTO = 8787;

/**
 * Cuánto puede llevar un mensaje en el aire antes de ser «demasiado viejo».
 *
 * 60 s. Lo que tiene que caber dentro: el viaje por la wifi del bar (ms),
 * un reintento, y el desvío entre el reloj del TPV y el de la tablet. Lo
 * que NO puede caber: un mensaje grabado a media mañana y soltado a la
 * hora de comer, que es el sabotaje «aceptar un mensaje firmado de hace 10
 * min».
 *
 * El desvío de reloj se resuelve antes de llegar aquí: las dos partes
 * cuentan con la **hora del servidor** (el `serverTime` que ya viaja en
 * cada `GET /kitchen/comandas` y en el latido), no con la del cacharro.
 * Ver `descifrarSobre` y la cabecera del plugin.
 */
export const EDAD_MAXIMA_MS = 60_000;

/** Lo que el TPV le manda a la tablet, y lo que la tablet contesta. */
export type TipoMensaje =
  /** Un envío. `opId` = `clientSendId`. */
  | "COMANDA"
  /** Anular unidades ya enviadas (pasados los 5 s del «Deshacer»). */
  | "ANULACION"
  /** «Marchar 2º». */
  | "MARCHA"
  /** Urgente / dejar de ser urgente. */
  | "URGENTE"
  /** El camarero tocó «Servido» en la banda. */
  | "SERVIDO"
  /** El sondeo del TPV sin internet: «¿qué tienes listo?». */
  | "SONDEO"
  /** El botón «Probar conexión directa con cocina». */
  | "PRUEBA"
  /** Lo que contesta la tablet a un SONDEO o a una PRUEBA. */
  | "RESPUESTA";

export interface SobreLan {
  /** `SOBRE_VERSION`. */
  v: number;
  /** La tienda. Un mensaje de otra tienda se rechaza sin descifrarlo. */
  storeId: string;
  /** Quién manda: el terminal, o la tablet en una RESPUESTA. */
  deviceId: string;
  kind: TipoMensaje;
  /**
   * El id de LA OPERACIÓN, generado por quien manda. Es por lo que el que
   * recibe descarta el duplicado del doble camino: el mismo `opId` llega
   * por la nube y por la wifi y sólo cuenta una vez.
   */
  opId: string;
  /** ISO-8601. La hora del SERVIDOR corregida, no la del cacharro. */
  sentAt: string;
  /** 12 bytes en base64url. Nunca se repite con la misma clave. */
  nonce: string;
  /** AES-256-GCM del cuerpo, con la etiqueta pegada detrás, en base64url. */
  ct: string;
}

export type MotivoRechazo =
  | "VERSION"
  | "OTRA_TIENDA"
  | "VIEJO"
  | "REPETIDO"
  | "FIRMA"
  | "MALFORMADO";

export type Apertura<T = unknown> =
  | { ok: true; sobre: SobreLan; payload: T }
  | { ok: false; motivo: MotivoRechazo };

// ── base64url, a mano ────────────────────────────────────────────────
//
// Sin `Buffer` (no existe en el WebView) y sin padding, que es lo que hace
// que la cadena pase por una URL y por un JSON sin escapar nada. El lado
// Java usa `Base64.URL_SAFE | NO_WRAP | NO_PADDING`, que es esto mismo.

export function aBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deBase64Url(texto: string): Uint8Array {
  const base = texto.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * La cabecera serializada, tal como entra en el AAD.
 *
 * Campos separados por `\n`. Ninguno de ellos puede contener un salto de
 * línea —son UUID, un enum y un ISO-8601— así que la separación no es
 * ambigua y el lado Java la reproduce con un `String.join`.
 *
 * **Cualquier cambio aquí rompe la compatibilidad con la APK instalada.**
 * Por eso existe `v`: una tablet vieja rechaza con `VERSION` en vez de
 * fallar la etiqueta y hacer creer que alguien está atacando la red.
 */
export function cabeceraCanonica(s: Omit<SobreLan, "ct">): string {
  return [
    String(s.v),
    s.storeId,
    s.deviceId,
    s.kind,
    s.opId,
    s.sentAt,
    s.nonce,
  ].join("\n");
}

// ── El mínimo de Web Crypto que hace falta, declarado AQUÍ ───────────
//
// Y no importado de `lib.dom`: este paquete lo cargan el WebView del TPV
// (que tiene DOM) y la API en Node (que no la incluye en su `tsconfig`).
// Declarar los cuatro métodos que se usan es más barato que meterle
// `lib: ["DOM"]` a la API, que arrastraría `window`, `document` y la
// tentación de usarlos en el servidor.
//
// En tiempo de ejecución es el mismo objeto en los dos sitios:
// `globalThis.crypto`, que Node trae desde la 19 y el WebView desde
// siempre (en contexto seguro, que `https://` lo es).

interface ParametrosGcm {
  name: "AES-GCM";
  iv: Uint8Array;
  additionalData: Uint8Array;
  tagLength: 128;
}

interface SubtleMinima {
  importKey(
    formato: "raw",
    clave: Uint8Array,
    algoritmo: { name: "AES-GCM" },
    exportable: boolean,
    usos: string[],
  ): Promise<unknown>;
  encrypt(
    params: ParametrosGcm,
    clave: unknown,
    datos: Uint8Array,
  ): Promise<ArrayBuffer>;
  decrypt(
    params: ParametrosGcm,
    clave: unknown,
    datos: Uint8Array,
  ): Promise<ArrayBuffer>;
}

interface CryptoMinimo {
  subtle?: SubtleMinima;
  getRandomValues(buffer: Uint8Array): Uint8Array;
}

function elCrypto(): CryptoMinimo {
  const c = (globalThis as unknown as { crypto?: CryptoMinimo }).crypto;
  if (!c) throw new Error("kitchen-lan: este entorno no tiene crypto");
  return c;
}

function subtle(): SubtleMinima {
  const s = elCrypto().subtle;
  if (!s) throw new Error("kitchen-lan: este entorno no tiene crypto.subtle");
  return s;
}

function azar(n: number): Uint8Array {
  return elCrypto().getRandomValues(new Uint8Array(n));
}

/** La clave de tienda: 32 bytes en base64url. La emite el servidor. */
export function generarClaveTienda(): string {
  return aBase64Url(azar(32));
}

async function importar(claveB64: string): Promise<unknown> {
  const raw = deBase64Url(claveB64);
  if (raw.length !== 32) {
    throw new Error("kitchen-lan: la clave de tienda no son 32 bytes");
  }
  return subtle().importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface CerrarOpts {
  clave: string;
  storeId: string;
  deviceId: string;
  kind: TipoMensaje;
  opId: string;
  /** Hora del servidor corregida, en epoch ms. */
  ahora: number;
  payload: unknown;
}

/** Cierra el sobre. Lo que sale de aquí es lo que va por la wifi. */
export async function cerrarSobre(opts: CerrarOpts): Promise<SobreLan> {
  const nonce = azar(12);
  const cabecera: Omit<SobreLan, "ct"> = {
    v: SOBRE_VERSION,
    storeId: opts.storeId,
    deviceId: opts.deviceId,
    kind: opts.kind,
    opId: opts.opId,
    sentAt: new Date(opts.ahora).toISOString(),
    nonce: aBase64Url(nonce),
  };
  const clave = await importar(opts.clave);
  const cuerpo = new TextEncoder().encode(JSON.stringify(opts.payload));
  const aad = new TextEncoder().encode(cabeceraCanonica(cabecera));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    clave,
    cuerpo,
  );
  return { ...cabecera, ct: aBase64Url(new Uint8Array(ct)) };
}

export interface AbrirOpts {
  clave: string;
  /** La tienda de ESTE aparato. Todo lo demás es «otra tienda». */
  storeId: string;
  /** Hora del servidor corregida, en epoch ms. */
  ahora: number;
  edadMaximaMs?: number;
  /**
   * `true` si este `opId` ya se procesó. Es el descarte del duplicado del
   * doble camino, y lo lleva quien recibe (la tablet en memoria, el
   * servidor en la base).
   */
  yaVisto?: (opId: string) => boolean;
}

/**
 * Abre el sobre, o dice por qué no.
 *
 * Nunca lanza por un sobre malo: un mensaje roto en la wifi de un bar no
 * puede tumbar el servidor de la tablet. Lanza sólo si la CLAVE es
 * inservible, que es un error de programación.
 */
export async function abrirSobre<T = unknown>(
  sobre: unknown,
  opts: AbrirOpts,
): Promise<Apertura<T>> {
  if (!esSobre(sobre)) return { ok: false, motivo: "MALFORMADO" };
  if (sobre.v !== SOBRE_VERSION) return { ok: false, motivo: "VERSION" };
  if (sobre.storeId !== opts.storeId) return { ok: false, motivo: "OTRA_TIENDA" };
  const sentAt = Date.parse(sobre.sentAt);
  if (Number.isNaN(sentAt)) return { ok: false, motivo: "MALFORMADO" };
  const edad = Math.abs(opts.ahora - sentAt);
  if (edad > (opts.edadMaximaMs ?? EDAD_MAXIMA_MS)) {
    return { ok: false, motivo: "VIEJO" };
  }
  if (opts.yaVisto?.(sobre.opId)) return { ok: false, motivo: "REPETIDO" };

  const clave = await importar(opts.clave);
  const aad = new TextEncoder().encode(
    cabeceraCanonica({
      v: sobre.v,
      storeId: sobre.storeId,
      deviceId: sobre.deviceId,
      kind: sobre.kind,
      opId: sobre.opId,
      sentAt: sobre.sentAt,
      nonce: sobre.nonce,
    }),
  );
  let plano: ArrayBuffer;
  try {
    plano = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: deBase64Url(sobre.nonce),
        additionalData: aad,
        tagLength: 128,
      },
      clave,
      deBase64Url(sobre.ct),
    );
  } catch {
    // La etiqueta no cuadra: o no tiene la clave de la tienda, o alguien
    // tocó un byte. Las dos cosas son lo mismo desde aquí.
    return { ok: false, motivo: "FIRMA" };
  }
  try {
    return {
      ok: true,
      sobre,
      payload: JSON.parse(new TextDecoder().decode(plano)) as T,
    };
  } catch {
    return { ok: false, motivo: "MALFORMADO" };
  }
}

function esSobre(x: unknown): x is SobreLan {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.v === "number" &&
    typeof s.storeId === "string" &&
    typeof s.deviceId === "string" &&
    typeof s.kind === "string" &&
    typeof s.opId === "string" &&
    typeof s.sentAt === "string" &&
    typeof s.nonce === "string" &&
    typeof s.ct === "string"
  );
}

/**
 * Lo que el que recibe apunta para no procesar dos veces el mismo `opId`.
 *
 * Acotado a propósito: la tablet no puede crecer sin techo en un servicio
 * de seis horas. `MAX` entradas y fuera la más antigua. El techo es muy
 * superior a los envíos de un servicio (un bar de pueblo manda decenas,
 * no miles), así que en la práctica no se olvida nada que pueda volver
 * dentro de la ventana de `EDAD_MAXIMA_MS`.
 */
export class MemoriaDeOperaciones {
  private readonly vistos = new Set<string>();
  private readonly orden: string[] = [];

  constructor(private readonly max = 2_000) {}

  yaVisto = (opId: string): boolean => this.vistos.has(opId);

  apuntar(opId: string): void {
    if (this.vistos.has(opId)) return;
    this.vistos.add(opId);
    this.orden.push(opId);
    while (this.orden.length > this.max) {
      const viejo = this.orden.shift()!;
      this.vistos.delete(viejo);
    }
  }

  get tamano(): number {
    return this.vistos.size;
  }
}
