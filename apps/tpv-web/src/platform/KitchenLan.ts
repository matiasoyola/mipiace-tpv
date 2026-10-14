// kds-2-wifi · EL PUENTE CON EL PLUGIN DEL CAMINO DIRECTO.
//
// Mismo patrón que `SupportAgent.ts` y `printer/`: se lee el global
// `Capacitor` que inyecta el bridge y se habla por `Capacitor.Plugins`. NO
// se importa `@capacitor/core` (ver `platform/index.ts`).
//
// **En navegador todo esto devuelve null o `false`**, y es lo correcto: una
// pestaña de Chrome no puede abrir un puerto ni llamar a una IP local por
// http. El TPV en navegador no tiene camino directo y lo dice; lo que
// tiene es la nube, que es lo que tenía antes de este bloque.
//
// Los dos papeles están aquí porque es la misma APK:
//
//   · la tablet de cocina: `arrancarServidorLan`, `pararServidorLan`,
//     `publicarRespuestaLan`, `recogerMensajesLan`, `estadoServidorLan`;
//   · el terminal de caja: `enviarPorLan`, `descubrirPantallasLan`.

import { getNativePlugin } from "./index.js";

export interface ArranqueLan {
  listening: boolean;
  port: number;
  ip: string | null;
  /** El mensaje real del fallo: «el puerto 8787 está ocupado». */
  error: string | null;
}

export interface EstadoLan {
  listening: boolean;
  port: number;
  ip: string | null;
  /** Epoch ms de la última petición atendida. 0 si ninguna. */
  lastRequestAt: number;
  accepted: number;
  rejected: number;
  queued: number;
}

export interface RespuestaEnvioLan {
  /** HTTP de la tablet, o **0 si no se llegó** (es el caso que importa). */
  status: number;
  bodyJson: string | null;
  error: string | null;
  elapsedMs: number;
}

interface PluginKitchenLan {
  arrancar(o: {
    storeId: string;
    key: string;
    deviceId: string;
    port: number;
    offsetMs: number;
  }): Promise<Record<string, unknown>>;
  parar(): Promise<Record<string, unknown>>;
  refrescar(o: { key: string; offsetMs: number }): Promise<Record<string, unknown>>;
  publicar(o: { snapshotJson: string }): Promise<Record<string, unknown>>;
  recibidos(): Promise<{ mensajes?: unknown }>;
  estado(): Promise<Record<string, unknown>>;
  enviar(o: {
    ip: string;
    port: number;
    bodyJson: string;
    timeoutMs: number;
  }): Promise<Record<string, unknown>>;
  descubrir(o: { waitMs: number }): Promise<{ destinos?: unknown }>;
  addListener?(
    evento: string,
    cb: (data: { enCola?: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function plugin(): PluginKitchenLan | null {
  return getNativePlugin<PluginKitchenLan>("KitchenLan");
}

/** `true` si este aparato puede hablar por la wifi del local. */
export function hayCaminoDirecto(): boolean {
  return plugin() != null;
}

function num(v: unknown, porDefecto = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : porDefecto;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Abre el servidor local de la tablet de cocina.
 *
 * **Sólo lo llama el arranque de la pantalla de cocina**, que sólo existe
 * cuando `/kitchen/me` ha dicho que este aparato es un `KITCHEN`. Y además
 * exige la clave de la tienda, que el servidor sólo da a un `KITCHEN`. Un
 * terminal de caja no tiene de dónde sacarla. Tiene su fila en la tabla de
 * sabotajes: «abrir el servidor local en un TERMINAL».
 *
 * Nunca lanza: devuelve `listening: false` con el motivo, que es lo que el
 * latido manda al servidor para que el TPV no reintente contra un puerto
 * que no escucha.
 */
export async function arrancarServidorLan(opts: {
  storeId: string;
  key: string;
  deviceId: string;
  port: number;
  /** Hora del servidor menos la local, en ms. */
  offsetMs: number;
}): Promise<ArranqueLan> {
  const p = plugin();
  if (!p) {
    return {
      listening: false,
      port: 0,
      ip: null,
      error: "Esta pantalla no es la APK: en navegador no se puede abrir un puerto.",
    };
  }
  try {
    const r = await p.arrancar(opts);
    return {
      listening: r.listening === true,
      port: num(r.port),
      ip: texto(r.ip),
      error: texto(r.error),
    };
  } catch (err) {
    return { listening: false, port: 0, ip: null, error: String(err) };
  }
}

export async function pararServidorLan(): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.parar();
  } catch {
    /* parar algo que no está no es un problema de nadie */
  }
}

/** La clave se rotó, o el desvío de reloj cambió. No reinicia el socket. */
export async function refrescarServidorLan(opts: {
  key: string;
  offsetMs: number;
}): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.refrescar(opts);
  } catch {
    /* el socket sigue con lo anterior */
  }
}

/**
 * Deja en la pieza nativa lo que se contesta a un sondeo del TPV.
 *
 * Es lo que hace que el «LISTO» sin internet tarde milisegundos: la
 * pregunta se contesta en el socket, sin despertar al WebView.
 */
export async function publicarRespuestaLan(snapshot: unknown): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.publicar({ snapshotJson: JSON.stringify(snapshot) });
  } catch {
    /* se contestará con la instantánea anterior */
  }
}

/** Vacía la cola de mensajes ya verificados por la pieza nativa. */
export async function recogerMensajesLan(): Promise<unknown[]> {
  const p = plugin();
  if (!p) return [];
  try {
    const r = await p.recibidos();
    const arr = Array.isArray(r?.mensajes) ? r.mensajes : [];
    const out: unknown[] = [];
    for (const m of arr) {
      if (typeof m !== "string") continue;
      try {
        out.push(JSON.parse(m));
      } catch {
        /* un mensaje que no parsea no es asunto de la pantalla */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function estadoServidorLan(): Promise<EstadoLan | null> {
  const p = plugin();
  if (!p) return null;
  try {
    const r = await p.estado();
    return {
      listening: r.listening === true,
      port: num(r.port),
      ip: texto(r.ip),
      lastRequestAt: num(r.lastRequestAt),
      accepted: num(r.accepted),
      rejected: num(r.rejected),
      queued: num(r.queued),
    };
  } catch {
    return null;
  }
}

/** Avisa cuando llega algo por la wifi. El mensaje se recoge aparte. */
export async function escucharMensajesLan(
  cb: () => void,
): Promise<() => void> {
  const p = plugin();
  if (!p?.addListener) return () => undefined;
  try {
    const h = await p.addListener("mensaje", () => cb());
    return () => {
      void h.remove();
    };
  } catch {
    return () => undefined;
  }
}

/**
 * El POST a la tablet, desde el puente nativo.
 *
 * Una página https **no puede** llamar a `http://192.168.1.44:8787`: lo
 * bloquea el navegador por contenido mixto y no hay cabecera que lo
 * arregle. Es la razón por la que este bloque necesita pieza nativa.
 */
export async function enviarPorLan(opts: {
  ip: string;
  port: number;
  sobre: unknown;
  timeoutMs?: number;
}): Promise<RespuestaEnvioLan> {
  const p = plugin();
  if (!p) {
    return {
      status: 0,
      bodyJson: null,
      error: "Sin puente nativo: en navegador no hay camino directo.",
      elapsedMs: 0,
    };
  }
  try {
    const r = await p.enviar({
      ip: opts.ip,
      port: opts.port,
      bodyJson: JSON.stringify(opts.sobre),
      timeoutMs: opts.timeoutMs ?? 2_500,
    });
    return {
      status: num(r.status),
      bodyJson: texto(r.bodyJson),
      error: texto(r.error),
      elapsedMs: num(r.elapsedMs),
    };
  } catch (err) {
    return { status: 0, bodyJson: null, error: String(err), elapsedMs: 0 };
  }
}

/**
 * Redescubrimiento en la red local (NSD). `["192.168.1.44:8787", …]`.
 *
 * Es lo SEGUNDO que se prueba, no lo primero: primero la última IP
 * conocida, que casi siempre sigue valiendo y cuesta 20 ms. NSD en la red
 * de un bar tarda entre medio segundo y varios, y el camarero ya pulsó
 * «Enviar».
 */
export async function descubrirPantallasLan(
  esperaMs = 1_500,
): Promise<Array<{ ip: string; port: number }>> {
  const p = plugin();
  if (!p) return [];
  try {
    const r = await p.descubrir({ waitMs: esperaMs });
    const arr = Array.isArray(r?.destinos) ? r.destinos : [];
    const out: Array<{ ip: string; port: number }> = [];
    for (const d of arr) {
      if (typeof d !== "string") continue;
      const i = d.lastIndexOf(":");
      if (i <= 0) continue;
      const ip = d.slice(0, i);
      const port = Number(d.slice(i + 1));
      if (ip.length > 0 && Number.isFinite(port) && port > 0) {
        out.push({ ip, port });
      }
    }
    return out;
  } catch {
    return [];
  }
}
