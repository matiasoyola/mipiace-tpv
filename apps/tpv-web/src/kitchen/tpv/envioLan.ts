// kds-2-wifi · EL TPV MANDA POR LOS DOS CAMINOS.
//
// Cada envío, anulación, marcha, urgente y «Servido» sale **a la nube y,
// además, directamente por la wifi** a las pantallas de cocina de la
// tienda. Con internet el camino directo es sólo refuerzo —la verdad sigue
// en el servidor—; sin internet, el directo es lo único que hay.
//
// ── POR QUÉ LA COMANDA DEL CAMINO DIRECTO LA COMPONE EL TPV ───────────
//
// La decisión 2.14 de kds-1 dice que el papel de respaldo lo construye el
// SERVIDOR, para que no haya dos formatos del mismo papel. Aquí no se
// puede: sin internet no hay servidor al que preguntar. Así que la compone
// este fichero, con **los mismos datos y las mismas funciones** que usa el
// servidor: `GET /tickets/:id/kitchen` ya dice la sección de cada línea
// (resuelta por el servidor, no por el front) y las alergias de la mesa, y
// las franjas y el aviso de choque salen de `@mipiacetpv/ticket-model`,
// que es de donde los saca `envio.ts`. Un solo juego de reglas, dos sitios
// que lo llaman.
//
// Y la comanda del camino directo **no es la verdad**: es una tarjeta para
// que el cocinero cocine AHORA. La del servidor llega cuando vuelve
// internet con el MISMO `clientSendId`, y la tablet no pinta dos tarjetas.
//
// ── EL ORDEN EN QUE SE BUSCA LA TABLET ────────────────────────────────
//
//   1. la última IP conocida (del latido, vía `GET /kitchen/estado`);
//   2. si no contesta, **redescubrimiento NSD** en la red local;
//   3. si tampoco, se reintenta con la última conocida por si fue un bache.
//
// La última conocida va primero porque casi siempre sigue valiendo y
// cuesta 20 ms. NSD en la red de un bar tarda entre medio segundo y
// varios, y el camarero ya pulsó «Enviar».

import {
  avisoChoque,
  choqueAlergenos,
  esAlergeno,
  franjaAlergiaPantalla,
  sinAlergenos,
  type Alergeno,
} from "@mipiacetpv/ticket-model";
import {
  abrirSobre,
  cerrarSobre,
  PUERTO_LAN_POR_DEFECTO,
  type ComandaLan,
  type LineaLan,
  type PayloadRespuesta,
  type SeccionLan,
  type SobreLan,
  type TipoMensaje,
} from "@mipiacetpv/kitchen-lan";

import {
  descubrirPantallasLan,
  enviarPorLan,
  hayCaminoDirecto,
} from "../../platform/KitchenLan.js";
import type { EstadoCocinaMesa } from "../../lib/kitchenComanda.js";
import type { KitchenSection } from "../secciones.js";

/** El bloque `lan` de `GET /kitchen/estado`. `null` sin pantallas. */
export interface LanDeLaTienda {
  key: string;
  defaultPort: number;
  maxAgeMs: number;
  storeId: string;
  /** Este terminal. Con esto firma. */
  deviceId: string;
}

export interface PantallaLan {
  id: string;
  name: string | null;
  sections: KitchenSection[];
  lanIp: string | null;
  lanPort: number | null;
  lanAt: string | null;
}

export interface ResultadoCamino {
  deviceId: string;
  /** `true` si la tablet contestó 200 (también si fue «ya lo tenía»). */
  ok: boolean;
  /** `0` = no se llegó. Es el caso que decide si sale papel. */
  status: number;
  ms: number;
  /** El motivo que dio la tablet, o el de red. */
  error: string | null;
  /** `true` si se encontró redescubriendo por NSD. */
  redescubierta: boolean;
  /** El cuerpo tal cual, para abrir la respuesta de un SONDEO. */
  cuerpo: string | null;
}

export interface EnvioLan {
  /** `true` si alguna pantalla de la tienda acusó recibo. */
  alguna: boolean;
  resultados: ResultadoCamino[];
}

/** Lo que falta para poder hablar por la wifi, o null si no falta nada. */
export function porQueNoHayCaminoDirecto(
  lan: LanDeLaTienda | null,
  pantallas: PantallaLan[],
): string | null {
  if (!hayCaminoDirecto()) {
    return "Este terminal no es la APK de Android: desde un navegador no se puede hablar con la tablet por la wifi.";
  }
  if (!lan) {
    return "Esta tienda no tiene ninguna pantalla de cocina emparejada.";
  }
  if (pantallas.length === 0) {
    return "Esta tienda no tiene ninguna pantalla de cocina emparejada.";
  }
  if (pantallas.every((p) => p.lanIp == null)) {
    return "La tablet de cocina todavía no ha dicho en qué IP escucha. Enciéndela y espera unos segundos.";
  }
  return null;
}

/**
 * Manda un sobre a TODAS las pantallas de la tienda.
 *
 * A todas y no sólo a las de la sección: la tablet filtra por sus propias
 * secciones (es lo que ya hace el `GET /kitchen/comandas`), y decidir aquí
 * a quién le toca obligaría a repetir en el front la regla de qué pantalla
 * ve qué. Una pantalla de barra que recibe una comanda de cocina
 * simplemente no pinta nada.
 */
export async function mandarPorLan(opts: {
  lan: LanDeLaTienda;
  pantallas: PantallaLan[];
  kind: TipoMensaje;
  opId: string;
  payload: unknown;
  /** Hora del servidor corregida. `Date.now()` si no se sabe. */
  ahora?: number;
  timeoutMs?: number;
}): Promise<EnvioLan> {
  const ahora = opts.ahora ?? Date.now();
  const sobre = await cerrarSobre({
    clave: opts.lan.key,
    storeId: opts.lan.storeId,
    deviceId: opts.lan.deviceId,
    kind: opts.kind,
    opId: opts.opId,
    ahora,
    payload: opts.payload,
  });

  const resultados = await Promise.all(
    opts.pantallas.map((p) => aUnaPantalla(p, sobre, opts)),
  );
  return { alguna: resultados.some((r) => r.ok), resultados };
}

async function aUnaPantalla(
  pantalla: PantallaLan,
  sobre: SobreLan,
  opts: { timeoutMs?: number; lan: LanDeLaTienda },
): Promise<ResultadoCamino> {
  const puerto = pantalla.lanPort ?? opts.lan.defaultPort ?? PUERTO_LAN_POR_DEFECTO;

  if (pantalla.lanIp) {
    const r = await enviarPorLan({
      ip: pantalla.lanIp,
      port: puerto,
      sobre,
      timeoutMs: opts.timeoutMs,
    });
    if (r.status > 0) {
      return {
        deviceId: pantalla.id,
        // 200 incluye «ya lo tenía» (`REPETIDO`): el duplicado del doble
        // camino no es un error y cuenta como entregado.
        ok: r.status === 200,
        status: r.status,
        ms: r.elapsedMs,
        error: r.status === 200 ? null : motivoDe(r.bodyJson) ?? r.error,
        redescubierta: false,
        cuerpo: r.bodyJson,
      };
    }
  }

  // Nadie en la última IP conocida: el router se la cambió, o la tablet se
  // reinició. Se pregunta en la propia red.
  const encontradas = await descubrirPantallasLan();
  for (const d of encontradas) {
    if (d.ip === pantalla.lanIp) continue;
    const r = await enviarPorLan({
      ip: d.ip,
      port: d.port,
      sobre,
      timeoutMs: opts.timeoutMs,
    });
    if (r.status > 0) {
      return {
        deviceId: pantalla.id,
        ok: r.status === 200,
        status: r.status,
        ms: r.elapsedMs,
        error: r.status === 200 ? null : motivoDe(r.bodyJson) ?? r.error,
        redescubierta: true,
        cuerpo: r.bodyJson,
      };
    }
  }

  return {
    deviceId: pantalla.id,
    ok: false,
    status: 0,
    ms: 0,
    error: pantalla.lanIp
      ? "No contesta ni en su IP ni redescubriéndola en la red del local."
      : "La tablet no ha dicho en qué IP escucha.",
    redescubierta: false,
    cuerpo: null,
  };
}

function motivoDe(bodyJson: string | null): string | null {
  if (!bodyJson) return null;
  try {
    const b = JSON.parse(bodyJson) as { error?: unknown };
    return typeof b.error === "string" ? b.error : null;
  } catch {
    return null;
  }
}

/** Lo que una pantalla contestó a un sondeo o a una prueba. */
export interface RespuestaDePantalla {
  pantalla: PantallaLan;
  camino: ResultadoCamino;
  /** `null` si no contestó o si su respuesta no pasó la firma. */
  respuesta: PayloadRespuesta | null;
}

/**
 * Pregunta a las pantallas y ABRE sus respuestas.
 *
 * `SONDEO` es el «LISTO» del camarero **sin internet**. Con internet eso
 * lo hacen los eventos de la nube y no se llama a esto: sondear con la red
 * buena sería pedirle a la tablet cada pocos segundos algo que el servidor
 * ya cuenta solo.
 *
 * `PRUEBA` es el mismo viaje, y por eso comparten función: el botón
 * «Probar conexión directa con cocina» tiene que probar EXACTAMENTE el
 * camino que usa el servicio, no una variante parecida que puede estar
 * verde mientras la de verdad no funciona.
 *
 * **La respuesta también va cifrada**, y no es simetría decorativa: lleva
 * qué mesas están listas. Si el TPV no pudiera verificarla, cualquiera en
 * la wifi del bar le diría «la M5 está lista» y el camarero llevaría a la
 * mesa un plato que no existe. Una respuesta que no pasa la firma se
 * devuelve como `respuesta: null` con el camino en `ok`, que es la verdad:
 * se llegó, pero lo que contestaron no vale.
 */
export async function preguntarAPantallas(opts: {
  lan: LanDeLaTienda;
  pantallas: PantallaLan[];
  kind: "SONDEO" | "PRUEBA";
  opId: string;
  ahora?: number;
  timeoutMs?: number;
}): Promise<RespuestaDePantalla[]> {
  const ahora = opts.ahora ?? Date.now();
  const sobre = await cerrarSobre({
    clave: opts.lan.key,
    storeId: opts.lan.storeId,
    deviceId: opts.lan.deviceId,
    kind: opts.kind,
    opId: opts.opId,
    ahora,
    payload: {},
  });
  return Promise.all(
    opts.pantallas.map(async (pantalla) => {
      const camino = await aUnaPantalla(pantalla, sobre, {
        lan: opts.lan,
        timeoutMs: opts.timeoutMs ?? 1_500,
      });
      if (!camino.ok || !camino.cuerpo) {
        return { pantalla, camino, respuesta: null };
      }
      let crudo: unknown;
      try {
        crudo = JSON.parse(camino.cuerpo);
      } catch {
        return { pantalla, camino, respuesta: null };
      }
      const abierto = await abrirSobre<PayloadRespuesta>(crudo, {
        clave: opts.lan.key,
        storeId: opts.lan.storeId,
        ahora,
        edadMaximaMs: opts.lan.maxAgeMs,
      });
      return {
        pantalla,
        camino,
        respuesta: abierto.ok ? abierto.payload : null,
      };
    }),
  );
}

/**
 * La comanda del camino directo, compuesta de lo que el TPV ya tiene.
 *
 * `revision` es la de ESTE envío: la del servidor + 1. Se calcula aquí
 * porque sin internet el servidor no la puede dar, y si el número saliera
 * mal lo que se vería en la tablet es «2ª COMANDA» donde era la 1ª — un
 * detalle que al cocinero le dice si la mesa está añadiendo o empezando.
 */
export function componerComandasLan(opts: {
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  clientSendId: string;
  urgent: boolean;
  estado: EstadoCocinaMesa;
  /** Los alérgenos de cada línea del carrito, por id de línea. */
  alergenosPorLinea: Map<string, string[]>;
  /** Nombre a pintar de cada línea, por id. */
  nombrePorLinea: Map<string, string>;
  /** Modificadores y notas de cada línea, por id. Lo que va bajo el plato. */
  notasPorLinea: Map<string, string[]>;
  ahora: Date;
}): ComandaLan[] {
  const { estado } = opts;

  // Las alergias de la mesa, por silla. Igual que `envio.ts`.
  const porSilla = new Map<number | null, Alergeno[]>();
  for (const a of estado.allergies) {
    if (!esAlergeno(a.allergen)) continue;
    const k = a.seat ?? null;
    porSilla.set(k, [...(porSilla.get(k) ?? []), a.allergen]);
  }
  const deLaMesa = porSilla.get(null) ?? [];
  const deSilla = (seat: number | null): Alergeno[] =>
    seat == null
      ? deLaMesa
      : [...new Set([...(porSilla.get(seat) ?? []), ...deLaMesa])];

  // «Toda la mesa» primero: condiciona cómo se cocina todo lo demás.
  const franjas = [];
  if (deLaMesa.length > 0) franjas.push(franjaAlergiaPantalla(null, deLaMesa));
  for (const seat of [...porSilla.keys()]
    .filter((k): k is number => k != null)
    .sort((a, b) => a - b)) {
    franjas.push(franjaAlergiaPantalla(seat, porSilla.get(seat)!));
  }

  const marchados = new Set(estado.firedCourses.map((c) => c.course));
  marchados.add(1); // el tiempo 1 marcha al enviar (decisión 3)

  const porSeccion = new Map<SeccionLan, LineaLan[]>();
  for (const l of estado.lines) {
    const pendiente = Math.round((l.units - l.sentUnits) * 1000) / 1000;
    if (pendiente <= 0) continue;
    const alergenosPlato = (opts.alergenosPorLinea.get(l.id) ?? []).filter(
      esAlergeno,
    );
    const sillaAlergenos = deSilla(l.seat);
    const linea: LineaLan = {
      ticketLineId: l.id,
      name: opts.nombrePorLinea.get(l.id) ?? "Plato",
      units: pendiente,
      notes: opts.notasPorLinea.get(l.id) ?? [],
      course: l.course,
      seat: l.seat,
      // La BARRA no se retiene nunca: la bebida sale ya (decisión 3).
      fired: l.section === "BARRA" || marchados.has(l.course),
      carries: alergenosPlato,
      seatAllergy: l.seat != null ? sinAlergenos(sillaAlergenos) : null,
      // Capa 3, el grito: sólo si el plato TIENE silla y lleva lo que esa
      // silla no puede comer. Un plato sin silla de una mesa alérgica se
      // marca «lleva gluten» pero no grita: no se sabe de quién es.
      allergyWarning:
        l.seat != null
          ? avisoChoque(choqueAlergenos(alergenosPlato, sillaAlergenos))
          : null,
    };
    const sec = l.section as SeccionLan;
    porSeccion.set(sec, [...(porSeccion.get(sec) ?? []), linea]);
  }

  const out: ComandaLan[] = [];
  for (const [section, lines] of porSeccion) {
    // Sólo las secciones CON PANTALLA: una sección que va a impresora o a
    // ningún sitio no tiene tarjeta, igual que en el servidor.
    if (estado.destinations[section as KitchenSection]?.screen !== true) continue;
    out.push({
      clientSendId: opts.clientSendId,
      section,
      ticketId: opts.ticketId,
      tableId: opts.tableId,
      tableName: opts.tableName,
      number: estado.revision + 1,
      urgent: opts.urgent,
      sentAt: opts.ahora.toISOString(),
      allergyBands: franjas,
      lines,
    });
  }
  return out;
}
