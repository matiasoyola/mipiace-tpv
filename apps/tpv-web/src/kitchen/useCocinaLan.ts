// kds-2-wifi · LA PANTALLA ESCUCHA EN LA WIFI DEL LOCAL.
//
// Tres cosas, y las tres existen porque el servidor no está:
//
//   1. **Abre el servidor local** (la pieza nativa) y anuncia su IP y su
//      puerto en el latido, para que el TPV sepa dónde hablarle.
//   2. **Recibe y pinta** lo que llega por la wifi: comandas, anulaciones,
//      marchas, urgentes y «Servido». Las tarjetas que sólo han llegado
//      por ahí se mezclan con las del servidor y **no se duplican**: la
//      llave es el `clientSendId`, que es el mismo por los dos caminos.
//   3. **Guarda lo que el cocinero marca** mientras no hay red y lo sube
//      al volver, con la hora de LA TABLET. De ahí salen los tiempos de
//      cocina del informe del dueño, y lo que no se guarda hoy no se
//      cuenta mañana.
//
// ── POR QUÉ LAS MARCAS VAN A `localStorage` ───────────────────────────
//
// Porque un servicio sin internet dura horas y la tablet se puede
// reiniciar en medio (se va la luz un momento, Android mata el proceso, el
// cocinero la desenchufa sin querer). Lo que el cocinero ya tachó no se
// puede perder: es el único sitio donde existe hasta que vuelve la red.
//
// Es la excepción deliberada a «nada se guarda en el navegador» de kds-1.
// Allí la regla era sobre `sentUnits` —qué tiene la cocina— y el motivo era
// que el servidor sí lo sabía. Aquí el servidor NO lo sabe y no puede
// saberlo: no hay camino hasta él.
//
// ── LA HORA ───────────────────────────────────────────────────────────
//
// Todo lo que se mide aquí usa la hora del SERVIDOR corregida por el
// desvío que se midió la última vez que hubo red (`serverTime` del
// arranque y de cada `GET /kitchen/comandas`). Es la misma hora con la que
// la pieza nativa decide si un mensaje es demasiado viejo.

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ComandaLan,
  PayloadAnulacion,
  PayloadMarcha,
  PayloadRespuesta,
  PayloadServido,
  PayloadUrgente,
  SeccionLan,
} from "@mipiacetpv/kitchen-lan";

import { apiWithDevice } from "../api.js";
import {
  arrancarServidorLan,
  escucharMensajesLan,
  hayCaminoDirecto,
  publicarRespuestaLan,
  recogerMensajesLan,
  refrescarServidorLan,
  type ArranqueLan,
} from "../platform/KitchenLan.js";
import type { Comanda, KitchenMe, LineaComanda } from "./types.js";

/** Cada cuánto se vacía la cola de la pieza nativa, por si falla el evento. */
const RECOGIDA_MS = 1_000;

/**
 * Cada cuánto se anuncia la IP y el puerto en el latido.
 *
 * 25 s, por debajo de la ventana de 90 s del servidor
 * (`LATIDO_VIVO_MS`): tres anuncios perdidos son una caída de verdad. Y es
 * también cómo la tablet se entera de que la clave de la tienda se rotó,
 * sin reiniciarse.
 */
const ANUNCIO_MS = 25_000;

/**
 * Cuánto vale «me está llegando por la wifi» desde el último mensaje.
 *
 * 90 s, la misma ventana que usa el servidor para dar una pantalla por
 * viva. Es lo que decide la **franja ámbar** en vez de la pantalla roja:
 * por debajo de esto hay un terminal de la tienda hablándole, así que las
 * comandas SÍ llegan y la pantalla no se puede poner roja. En un servicio
 * real pasa más de minuto y medio entre dos comandas, y por eso el TPV
 * sondea cada 4 s cuando no hay internet: ese sondeo cuenta como mensaje.
 */
export const WIFI_RECIENTE_MS = 90_000;

const CLAVE_MARCAS = "mipiacetpv-kds-marcas";
const CLAVE_RECIBIDAS = "mipiacetpv-kds-recibidas";

export type TipoMarcaLocal = "HECHO" | "VISTO" | "LISTA";

export interface MarcaLocal {
  markId: string;
  kind: TipoMarcaLocal;
  clientSendId: string;
  section: SeccionLan;
  ticketLineId: string | null;
  done: boolean | null;
  /** La hora de LA TABLET, corregida con el desvío del servidor. */
  at: string;
}

export interface CocinaLan {
  /** Qué pasó al abrir el servidor local. `null` fuera de la APK. */
  arranque: ArranqueLan | null;
  /**
   * `true` si algún terminal de la tienda le ha hablado hace poco. Es lo
   * que convierte la pantalla roja en **franja ámbar**.
   */
  recibiendoPorWifi: boolean;
  /** Las tarjetas que han llegado SÓLO por la wifi, sin duplicar. */
  extras: Comanda[];
  /** Marcas hechas sin red y todavía sin subir. */
  pendientes: MarcaLocal[];
  /**
   * Apunta una marca local. La llama la pantalla **cuando el POST a la nube
   * falla**: lo que no puede pasar es que el cocinero toque un plato, no
   * haya red, y el toque se pierda.
   */
  apuntarMarca: (m: Omit<MarcaLocal, "markId" | "at">) => void;
  /** Sube el libro y lo recibido. Se llama sola al volver la red. */
  sincronizar: () => Promise<void>;
}

function leer<T>(clave: string, porDefecto: T): T {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function escribir(clave: string, valor: unknown): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* cuota llena: se pierde al recargar, pero el servicio sigue */
  }
}

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Respaldo para un WebView viejo (WebView 101 no trae `randomUUID`).
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

export function useCocinaLan(opts: {
  me: KitchenMe;
  /** `true` si el último `GET /kitchen/comandas` falló. */
  offline: boolean;
  /** Lo que la pantalla tiene por «Lista» ahora mismo, para el sondeo. */
  listas: Comanda[];
  /** Se llama cuando llega algo por la wifi que cambia lo que se pinta. */
  onCambio: () => void;
}): CocinaLan {
  const { me, offline } = opts;
  const [arranque, setArranque] = useState<ArranqueLan | null>(null);
  const [ultimoMensaje, setUltimoMensaje] = useState(0);
  const [extras, setExtras] = useState<Comanda[]>([]);
  const [pendientes, setPendientes] = useState<MarcaLocal[]>(() =>
    leer<MarcaLocal[]>(CLAVE_MARCAS, []),
  );
  const recibidasRef = useRef<Set<string>>(
    new Set(leer<string[]>(CLAVE_RECIBIDAS, [])),
  );
  // El desvío entre el reloj del servidor y el de la tablet. Se mide al
  // arrancar y no se vuelve a tocar sin red: es lo último que se supo.
  const desvioRef = useRef(
    me.serverTime ? Date.parse(me.serverTime) - Date.now() : 0,
  );
  const onCambioRef = useRef(opts.onCambio);
  onCambioRef.current = opts.onCambio;
  const listasRef = useRef(opts.listas);
  listasRef.current = opts.listas;

  const ahora = useCallback(() => Date.now() + desvioRef.current, []);

  // ── 1 · abrir el servidor local y anunciarse ────────────────────────
  //
  // **Sólo aquí**, y este hook sólo lo monta `KitchenScreen`, que sólo
  // existe cuando `/kitchen/me` ha dicho que este aparato es un `KITCHEN`.
  // Más la clave, que el servidor sólo da a un `KITCHEN`. Más el CHECK de
  // la base, que no admite ni apuntar que un `TERMINAL` escuche. Tres
  // veces la misma regla, a propósito: la primera se puede olvidar en un
  // refactor del front, la segunda depende de que el servidor no se
  // equivoque, y la tercera no se puede olvidar.
  useEffect(() => {
    if (!me.lan || !hayCaminoDirecto()) {
      setArranque(
        me.lan
          ? null
          : {
              listening: false,
              port: 0,
              ip: null,
              error:
                "Esta API no reparte clave de tienda: el camino directo por la wifi no está disponible.",
            },
      );
      return;
    }
    let vivo = true;
    void arrancarServidorLan({
      storeId: me.store.id,
      key: me.lan.key,
      deviceId: me.device.id,
      port: me.lan.port,
      offsetMs: desvioRef.current,
    }).then((r) => {
      if (vivo) setArranque(r);
    });
    return () => {
      vivo = false;
      // **NO se para el servidor al desmontar.** El WebView se recarga solo
      // (el rescate de A4, un `reload` tras un despliegue) y parar el
      // socket en cada recarga dejaría a la cocina sorda unos segundos en
      // mitad del servicio. Lo para `handleOnDestroy` del plugin, que es
      // cuando la app de verdad se va.
    };
  }, [me.lan, me.store.id, me.device.id]);

  // El anuncio en el latido: IP, puerto y si de verdad está escuchando.
  useEffect(() => {
    const anunciar = async () => {
      if (!arranque) return;
      try {
        const r = await apiWithDevice<{
          serverTime?: string;
          lan?: { key?: string };
        }>("/kitchen/latido", {
          method: "POST",
          body: {
            ...(arranque.ip ? { lanIp: arranque.ip } : {}),
            ...(arranque.port > 0 ? { lanPort: arranque.port } : {}),
            lanListening: arranque.listening,
          },
        });
        // Dos cosas de la respuesta, y las dos importan:
        //   · el desvío de reloj, remedido en cada latido;
        //   · la clave, que puede haberse ROTADO (se revocó un aparato de
        //     la tienda). Se le pasa a la pieza nativa sin reiniciar el
        //     socket.
        if (r.serverTime) desvioRef.current = Date.parse(r.serverTime) - Date.now();
        if (r.lan?.key) {
          void refrescarServidorLan({
            key: r.lan.key,
            offsetMs: desvioRef.current,
          });
        }
      } catch {
        // Sin red no hay a quién anunciarse. El TPV usa la última IP
        // conocida y, si cambió, redescubre por NSD.
      }
    };
    void anunciar();
    const id = setInterval(anunciar, ANUNCIO_MS);
    return () => clearInterval(id);
  }, [arranque]);

  // ── 2 · recibir ─────────────────────────────────────────────────────
  const aplicar = useCallback(
    (mensaje: unknown) => {
      if (!mensaje || typeof mensaje !== "object") return;
      const m = mensaje as {
        kind?: string;
        opId?: string;
        payload?: unknown;
      };
      if (!m.kind || !m.payload) return;
      setUltimoMensaje(Date.now());

      switch (m.kind) {
        case "COMANDA": {
          const p = m.payload as { comandas?: ComandaLan[] };
          const mias = (p.comandas ?? []).filter((c) =>
            me.sections.includes(c.section),
          );
          if (mias.length === 0) return;
          for (const c of mias) recibidasRef.current.add(c.clientSendId);
          escribir(CLAVE_RECIBIDAS, [...recibidasRef.current]);
          setExtras((prev) => {
            const next = [...prev];
            for (const c of mias) {
              const i = next.findIndex(
                (x) => x.id === idLan(c.clientSendId, c.section),
              );
              const tarjeta = aComanda(c);
              if (i >= 0) next[i] = tarjeta;
              else next.push(tarjeta);
            }
            return next;
          });
          break;
        }
        case "ANULACION": {
          const p = m.payload as PayloadAnulacion;
          setExtras((prev) =>
            prev.map((c) =>
              c.ticketId === p.ticketId
                ? {
                    ...c,
                    lines: c.lines.map((l) =>
                      l.id === p.ticketLineId
                        ? anular(l, p.units)
                        : l,
                    ),
                  }
                : c,
            ),
          );
          break;
        }
        case "MARCHA": {
          const p = m.payload as PayloadMarcha;
          setExtras((prev) =>
            prev.map((c) =>
              c.ticketId === p.ticketId
                ? {
                    ...c,
                    firedAt: c.firedAt ?? p.firedAt,
                    lines: c.lines.map((l) =>
                      l.course === p.course ? { ...l, fired: true } : l,
                    ),
                  }
                : c,
            ),
          );
          break;
        }
        case "URGENTE": {
          const p = m.payload as PayloadUrgente;
          setExtras((prev) =>
            prev.map((c) =>
              c.ticketId === p.ticketId ? { ...c, urgent: p.urgent } : c,
            ),
          );
          break;
        }
        case "SERVIDO": {
          const p = m.payload as PayloadServido;
          const id = idLan(p.clientSendId, p.section);
          setExtras((prev) =>
            prev.map((c) =>
              c.id === id
                ? { ...c, servedAt: new Date(ahora()).toISOString() }
                : c,
            ),
          );
          break;
        }
        default:
          // Un `kind` que esta APK no conoce: llega de un terminal más
          // nuevo. Se cuenta como señal de vida —por eso el `setUltimoMensaje`
          // está arriba— y no se aplica nada. Lo que NO se hace es
          // ponerse roja: las comandas sí están llegando.
          break;
      }
      onCambioRef.current();
    },
    [me.sections, ahora],
  );

  const recoger = useCallback(async () => {
    const mensajes = await recogerMensajesLan();
    for (const m of mensajes) aplicar(m);
  }, [aplicar]);

  useEffect(() => {
    let vivo = true;
    let quitar: (() => void) | null = null;
    void escucharMensajesLan(() => {
      if (vivo) void recoger();
    }).then((f) => {
      if (vivo) quitar = f;
      else f();
    });
    // Y además un barrido periódico: el evento del bridge puede perderse
    // si el WebView estaba recargándose, y una comanda perdida en la cola
    // es una comanda que el cocinero no ve.
    const id = setInterval(() => void recoger(), RECOGIDA_MS);
    void recoger();
    return () => {
      vivo = false;
      clearInterval(id);
      quitar?.();
    };
  }, [recoger]);

  // ── 3 · lo que se contesta a un sondeo ──────────────────────────────
  //
  // Se publica en la pieza nativa cada vez que cambia lo que hay listo:
  // así el TPV sin internet recibe el «LISTO» en milisegundos, sin que el
  // WebView tenga que despertarse para contestar.
  useEffect(() => {
    const snapshot: PayloadRespuesta = {
      listas: listasRef.current.map((c) => ({
        clientSendId: clientSendIdDe(c),
        section: c.section as SeccionLan,
        ticketId: c.ticketId,
        tableId: c.tableId,
        tableName: c.tableName,
        readyAt: c.readyAt ?? new Date(ahora()).toISOString(),
      })),
      recibidas: recibidasRef.current.size,
      marcasPendientes: pendientes.length,
      sections: me.sections as SeccionLan[],
      deviceName: me.device.name,
    };
    void publicarRespuestaLan(snapshot);
  }, [opts.listas, pendientes.length, me.sections, me.device.name, ahora]);

  // ── 4 · las marcas de cuando no hay red ─────────────────────────────
  const apuntarMarca = useCallback(
    (m: Omit<MarcaLocal, "markId" | "at">) => {
      const marca: MarcaLocal = {
        ...m,
        markId: uuid(),
        at: new Date(ahora()).toISOString(),
      };
      setPendientes((prev) => {
        const next = [...prev, marca];
        escribir(CLAVE_MARCAS, next);
        return next;
      });
    },
    [ahora],
  );

  const sincronizar = useCallback(async () => {
    const marcas = leer<MarcaLocal[]>(CLAVE_MARCAS, []);
    const recibidas = [...recibidasRef.current];
    if (marcas.length === 0 && recibidas.length === 0) return;
    await apiWithDevice("/kitchen/sincronizar", {
      method: "POST",
      body: { marcas, recibidas },
    });
    // Se borra sólo si el servidor contestó. Un fallo deja el libro donde
    // estaba y el siguiente intento lo vuelve a subir: subirlo dos veces
    // no mueve nada (la llave es el `markId` que generó esta tablet), pero
    // perderlo sí.
    escribir(CLAVE_MARCAS, []);
    setPendientes([]);
    recibidasRef.current = new Set();
    escribir(CLAVE_RECIBIDAS, []);
    // Las tarjetas que sólo estaban aquí pasan a estar en el servidor: se
    // sueltan para que las pinte el GET y no se vean dos veces.
    setExtras([]);
  }, []);

  // Al VOLVER la red se sube el libro. `offline` pasa de true a false
  // cuando un `GET /kitchen/comandas` vuelve a funcionar, que es la señal
  // más fiable que tiene la pantalla: significa que el servidor contesta
  // de verdad, no que el sistema operativo crea que hay wifi.
  const estabaOffline = useRef(offline);
  useEffect(() => {
    const volvio = estabaOffline.current && !offline;
    estabaOffline.current = offline;
    if (!volvio) return;
    void sincronizar().catch(() => {
      // El siguiente intento lo vuelve a subir. El libro sigue entero.
    });
  }, [offline, sincronizar]);

  // Y un reintento mientras haya pendientes y haya red: una pantalla que
  // nunca se queda offline del todo (bache corto) no dispararía el efecto
  // de arriba y el libro se quedaría sin subir.
  useEffect(() => {
    if (offline || pendientes.length === 0) return;
    const id = setTimeout(() => void sincronizar().catch(() => undefined), 5_000);
    return () => clearTimeout(id);
  }, [offline, pendientes.length, sincronizar]);

  const recibiendoPorWifi =
    ultimoMensaje > 0 && Date.now() - ultimoMensaje < WIFI_RECIENTE_MS;

  return {
    arranque,
    recibiendoPorWifi,
    extras,
    pendientes,
    apuntarMarca,
    sincronizar,
  };
}

/** El id local de una tarjeta que sólo ha llegado por la wifi. */
export function idLan(clientSendId: string, section: string): string {
  return `lan:${clientSendId}:${section}`;
}

/** Y la vuelta: de dónde salió un id local. */
export function clientSendIdDe(c: Comanda): string {
  if (!c.id.startsWith("lan:")) return c.id;
  const resto = c.id.slice(4);
  const corte = resto.lastIndexOf(":");
  return corte > 0 ? resto.slice(0, corte) : resto;
}

/** `true` si esta tarjeta sólo existe en la tablet. */
export function esDeLaWifi(c: Comanda): boolean {
  return c.id.startsWith("lan:");
}

function anular(l: LineaComanda, units: number): LineaComanda {
  const anuladas = Math.min(l.units + l.voidedUnits, l.voidedUnits + units);
  return {
    ...l,
    unitsOriginal: l.unitsOriginal ?? l.units + l.voidedUnits,
    units: Math.max(0, l.units - units),
    voidedUnits: anuladas,
    // Parpadea en rojo hasta que el cocinero toca «Visto» (decisión 6).
    voidPending: true,
    // Merma: ya estaba tachado cuando se anuló. Es comida hecha y tirada,
    // y es el dato que el dueño quiere ver en el informe.
    doneBeforeVoid: l.done || l.doneBeforeVoid,
  };
}

/**
 * De la comanda del camino directo a la tarjeta que la pantalla pinta.
 *
 * Lo que NO se puede traducir y se dice en voz alta: el **número de
 * comanda** lo calcula el TPV (`revision + 1`) con el último estado que
 * conocía del servidor. Si dos terminales enviaran a la misma mesa en el
 * mismo apagón, los dos dirían «2ª COMANDA». No se corrige aquí porque no
 * hay con qué: sin servidor no hay quien reparta números. Lo que importa
 * —los platos, la mesa, la alergia y la silla— llega bien.
 */
function aComanda(c: ComandaLan): Comanda {
  return {
    id: idLan(c.clientSendId, c.section),
    section: c.section,
    ticketId: c.ticketId,
    tableId: c.tableId,
    tableName: c.tableName,
    number: c.number,
    urgent: c.urgent,
    // No es «llegó tarde»: llegó en su momento, por el otro camino.
    lateArrival: false,
    sentAt: c.sentAt,
    firedAt: c.lines.some((l) => l.fired) ? c.sentAt : null,
    orderAt: c.sentAt,
    readyAt: null,
    servedAt: null,
    recoveredAt: null,
    // Parpadea hasta el primer tachado, igual que una del servidor.
    isNew: true,
    allergyBands: c.allergyBands,
    lines: c.lines.map((l) => ({
      id: l.ticketLineId,
      name: l.name,
      units: l.units,
      unitsOriginal: null,
      notes: l.notes,
      course: l.course,
      seat: l.seat,
      fired: l.fired,
      done: false,
      voidedUnits: 0,
      voidPending: false,
      doneBeforeVoid: false,
      changeNote: null,
      changePending: false,
      carries: l.carries,
      seatAllergy: l.seatAllergy,
      allergyWarning: l.allergyWarning,
    })),
  };
}
