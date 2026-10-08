// kds-1-cocina · LA PANTALLA.
//
// La misma APK en «modo cocina» (decisión 1). Diseñada a **1280 × 800
// horizontal**, que es el peor caso: una tablet de 10" en un soporte de
// pared.
//
// Lo que tiene y lo que no:
//
//   · barra de arriba con «En línea» y «Hoy»;
//   · tarjetas en ORDEN DE LECTURA, de izquierda a derecha y luego la
//     fila de abajo (decisión 7, corrección del 08-10);
//   · indicador «+N · M1 · T2» en el borde para lo que no cabe entero;
//   · columna estrecha «Listas» hasta que el camarero marca «Servido»;
//   · parpadeo cada 2,5 s, nunca de la pantalla entera;
//   · **pantalla siempre encendida**;
//   · pantalla ENTERA en rojo sin conexión;
//   · **cero audio**. No hay un `<audio>`, ni un `AudioContext`, ni un
//     `navigator.vibrate` en este fichero ni en ninguno de `kitchen/`.
//     Tiene su fila en la tabla de sabotajes.

import { useEffect, useRef, useState } from "react";

import { apiWithDevice } from "../api.js";
import {
  etiquetaMasN,
  masNParpadea,
  repartirTarjetas,
} from "../lib/kitchenLayout.js";
import {
  BARRA_SUPERIOR_PX,
  COLUMNA_LISTAS_PX,
  DARK_CANVAS,
  DARK_PANEL,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  EYEBROW_COCINA_PX,
  EYEBROW_COCINA_TRACKING,
  MAS_N_PX,
  MESA_PX,
  MIN_TOUCH_COCINA_PX,
  PLATO_PX,
  PULSO_CLASS_ROJO,
  ROJO_SIN_CONEXION,
  TARJETA_ANCHO_PX,
  TARJETA_HUECO_PX,
  VERDE_LISTA,
} from "../lib/kitchenTheme.js";
import { ComandaCard } from "./ComandaCard.js";
import type { Comanda, KitchenMe } from "./types.js";
import { useKitchenFeed } from "./useKitchenFeed.js";

export interface KitchenScreenProps {
  me: KitchenMe;
}

export function KitchenScreen({ me }: KitchenScreenProps) {
  const feed = useKitchenFeed();
  const [hoyAbierto, setHoyAbierto] = useState(false);
  const zonaRef = useRef<HTMLDivElement | null>(null);
  const [zona, setZona] = useState({ ancho: 1016, alto: 700 });

  // La pantalla SIEMPRE ENCENDIDA. En la APK lo hace `svc power stayon`
  // (ya probado en el D8), pero en el WebView y en un navegador normal
  // hace falta además el candado de pantalla: sin él, Android apaga la
  // retroiluminación a los dos minutos y el cocinero tiene que tocar la
  // tablet con las manos llenas para ver si tiene comandas.
  //
  // Se pide y no se exige: `wakeLock` no existe en todos los WebView, y
  // una pantalla que no arranca por no poder bloquear el apagado sería
  // peor que una pantalla que se apaga.
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelado = false;
    const pedir = async () => {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      if (!nav.wakeLock) return;
      try {
        const s = await nav.wakeLock.request("screen");
        if (cancelado) {
          void s.release();
          return;
        }
        sentinel = s;
      } catch {
        /* sin candado: la APK lo cubre con `svc power stayon` */
      }
    };
    void pedir();
    // Android suelta el candado al mandar la app al fondo: se vuelve a
    // pedir al volver.
    const alVolver = () => {
      if (document.visibilityState === "visible") void pedir();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", alVolver);
      void sentinel?.release();
    };
  }, []);

  // El tamaño real de la zona de tarjetas. Es lo que decide cuántas caben
  // enteras; el resto va al «+N».
  useEffect(() => {
    const el = zonaRef.current;
    if (!el) return;
    const medir = () => {
      // **UNA MEDIDA DE 0 NO SE CREE.** Significa «todavía no hay layout»
      // —primer pintado, pestaña en segundo plano, contenedor con
      // `display:none`— y no «no cabe nada». Creérsela mandaría TODAS las
      // comandas al indicador «+N» y dejaría la cocina mirando una
      // pantalla vacía con un «+9» en la esquina.
      //
      // El valor inicial del estado es el de 1280 × 800, que es el peor
      // caso para el que esta pantalla se diseñó: mientras no haya una
      // medida de verdad, se reparte contra ése.
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setZona({ ancho: el.clientWidth, alto: el.clientHeight });
      }
    };
    medir();
    // `ResizeObserver` no existe en todos los WebView viejos ni en jsdom.
    // Sin él, la medida inicial es la que vale: una tablet en un soporte
    // de pared no cambia de tamaño.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const vista = feed.vista;
  const settings = vista?.settings ?? me.settings;
  const mostrarSeccion = me.sections.length > 1;

  const tachar = async (lineId: string, done: boolean) => {
    await apiWithDevice(`/kitchen/lineas/${lineId}/hecho`, {
      method: "POST",
      body: { done },
    });
    feed.recargar();
  };
  const visto = async (lineId: string) => {
    await apiWithDevice(`/kitchen/lineas/${lineId}/visto`, { method: "POST" });
    feed.recargar();
  };
  const lista = async (orderId: string) => {
    await apiWithDevice(`/kitchen/comandas/${orderId}/lista`, { method: "POST" });
    feed.recargar();
  };
  const urgente = async (orderId: string, urgent: boolean) => {
    await apiWithDevice(`/kitchen/comandas/${orderId}/urgente`, {
      method: "POST",
      body: { urgent },
    });
    feed.recargar();
  };

  const abiertas: Comanda[] = vista?.orders ?? [];
  const reparto = repartirTarjetas(abiertas, zona);

  return (
    <div
      data-testid="kds-screen"
      data-theme="dark"
      className="h-screen w-screen overflow-hidden flex flex-col font-sans select-none"
      style={{ background: DARK_CANVAS, color: DARK_TEXT }}
    >
      {/* ── Decisión 9 · SIN CONEXIÓN: la pantalla ENTERA en rojo ──────
          Entera y no un icono: lo que hay que entender desde la plancha,
          sin acercarse, es que lo que se ve ya no es lo que hay. */}
      {feed.offline && (
        <div
          data-testid="kds-sin-conexion"
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 text-center px-10"
          style={{ background: ROJO_SIN_CONEXION, color: "#FFFFFF" }}
        >
          <span className="font-bold" style={{ fontSize: MESA_PX + 8 }}>
            SIN CONEXIÓN
          </span>
          <span className="font-semibold" style={{ fontSize: PLATO_PX }}>
            las comandas no llegan
          </span>
        </div>
      )}

      {/* ── La barra de arriba ─────────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center gap-4 px-5 border-b"
        style={{ height: BARRA_SUPERIOR_PX, borderColor: DARK_SURFACE_RAISED }}
      >
        <span className="font-bold" style={{ fontSize: PLATO_PX }}>
          {me.sections.join(" · ")}
        </span>
        <span style={{ fontSize: EYEBROW_COCINA_PX, color: DARK_TEXT_MUTED }}>
          {me.store.name}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span
            data-testid="kds-en-linea"
            className="flex items-center gap-2 font-semibold"
            style={{ fontSize: EYEBROW_COCINA_PX, color: DARK_TEXT_MUTED }}
          >
            <span
              className="rounded-full"
              style={{
                width: 10,
                height: 10,
                background: feed.offline ? ROJO_SIN_CONEXION : VERDE_LISTA,
              }}
            />
            {feed.offline ? "SIN CONEXIÓN" : "EN LÍNEA"}
          </span>
          <button
            type="button"
            data-testid="kds-hoy"
            onClick={() => setHoyAbierto(true)}
            className="rounded-[12px] px-6 font-semibold"
            style={{
              minHeight: MIN_TOUCH_COCINA_PX,
              background: DARK_SURFACE_RAISED,
              color: DARK_TEXT,
              fontSize: PLATO_PX - 4,
            }}
          >
            Hoy
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* ── Las tarjetas, en orden de lectura ───────────────────────
            `flex-wrap` sobre una lista YA ORDENADA: el orden del DOM es el
            orden de lectura, de izquierda a derecha y luego la fila de
            abajo. En columnas (`columns-*`) el ojo se saltaba la segunda
            más antigua, que es la corrección del 08-10. */}
        <div
          ref={zonaRef}
          data-testid="kds-zona"
          className="flex-1 min-w-0 p-4 flex flex-wrap content-start overflow-hidden"
          style={{ gap: TARJETA_HUECO_PX }}
        >
          {reparto.visibles.map((c) => (
            <div key={c.id} style={{ width: TARJETA_ANCHO_PX, flex: "0 0 auto" }}>
              <ComandaCard
                comanda={c}
                settings={settings}
                ahora={feed.ahora}
                mostrarSeccion={mostrarSeccion}
                onTachar={tachar}
                onVisto={visto}
                onLista={() => void lista(c.id)}
                onUrgente={(u) => void urgente(c.id, u)}
              />
            </div>
          ))}
          {abiertas.length === 0 && !feed.offline && (
            <p
              data-testid="kds-vacio"
              className="m-auto"
              style={{ fontSize: PLATO_PX, color: DARK_TEXT_MUTED }}
            >
              Sin comandas pendientes
            </p>
          )}
        </div>

        {/* ── La columna «Listas» ─────────────────────────────────────
            Estrecha y a la derecha: la tarjeta sale del centro al pasar a
            «Lista» y se queda ahí hasta que el camarero marca «Servido».
            Marcar «Servido» es del TPV, no de aquí (decisión 5). */}
        <aside
          data-testid="kds-listas"
          className="shrink-0 border-l p-3 overflow-y-auto flex flex-col gap-3"
          style={{
            width: COLUMNA_LISTAS_PX,
            borderColor: DARK_SURFACE_RAISED,
            background: DARK_PANEL,
          }}
        >
          <h2
            className="uppercase font-semibold shrink-0"
            style={{
              fontSize: EYEBROW_COCINA_PX,
              letterSpacing: EYEBROW_COCINA_TRACKING,
              color: DARK_TEXT_MUTED,
            }}
          >
            Listas · {feed.listas.length}
          </h2>
          {feed.listas.map((c) => (
            <div
              key={c.id}
              data-testid="kds-lista-item"
              className="rounded-[12px] px-3 py-3"
              style={{ background: DARK_SURFACE_RAISED }}
            >
              <span className="font-bold block" style={{ fontSize: PLATO_PX }}>
                {c.tableName ?? `#${c.number}`}
              </span>
              <span style={{ fontSize: EYEBROW_COCINA_PX, color: DARK_TEXT_MUTED }}>
                {c.lines.length} plato{c.lines.length === 1 ? "" : "s"}
              </span>
            </div>
          ))}

          {/* ── El indicador «+N» ────────────────────────────────────
              Lo que no cabe ENTERO no se corta: pasa aquí, con el nombre
              de las mesas, y parpadea si alguna es nueva (decisión 7). */}
          {reparto.extra.length > 0 && (
            <div
              data-testid="kds-mas-n"
              className={`mt-auto shrink-0 rounded-[12px] px-3 py-4 font-bold text-center ${
                masNParpadea(reparto.extra) ? PULSO_CLASS_ROJO : ""
              }`}
              style={{
                background: DARK_SURFACE_RAISED,
                color: DARK_TEXT,
                fontSize: MAS_N_PX,
              }}
            >
              {etiquetaMasN(reparto.extra)}
            </div>
          )}
        </aside>
      </div>

      {hoyAbierto && (
        <HojaDeHoy
          settings={settings}
          ahora={feed.ahora}
          onCerrar={() => setHoyAbierto(false)}
          onRecuperada={() => {
            setHoyAbierto(false);
            feed.recargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Decisión 7 · «Hoy»: lo terminado del día, y un toque devuelve una
 * tarjeta a la pantalla (por si se tachó sin querer).
 *
 * Es un listado para BUSCAR, no una segunda pantalla de comandas: va en
 * una hoja encima, con las más recientes primero, y se cierra al recuperar.
 */
function HojaDeHoy(props: {
  settings: { greenMaxMin: number; amberMaxMin: number; readyBeep: boolean };
  ahora: string;
  onCerrar: () => void;
  onRecuperada: () => void;
}) {
  const [hoy, setHoy] = useState<Comanda[] | null>(null);
  useEffect(() => {
    void apiWithDevice<{ orders: Comanda[] }>("/kitchen/comandas/hoy").then((d) =>
      setHoy(d.orders),
    );
  }, []);
  const recuperar = async (orderId: string) => {
    await apiWithDevice(`/kitchen/comandas/${orderId}/recuperar`, {
      method: "POST",
    });
    props.onRecuperada();
  };
  return (
    <div
      data-testid="kds-hoy-hoja"
      className="absolute inset-0 z-40 flex flex-col"
      style={{ background: DARK_CANVAS }}
    >
      <header
        className="shrink-0 flex items-center gap-4 px-5 border-b"
        style={{ height: BARRA_SUPERIOR_PX, borderColor: DARK_SURFACE_RAISED }}
      >
        <h2 className="font-bold" style={{ fontSize: PLATO_PX }}>
          Hoy
        </h2>
        <button
          type="button"
          onClick={props.onCerrar}
          className="ml-auto rounded-[12px] px-6 font-semibold"
          style={{
            minHeight: MIN_TOUCH_COCINA_PX,
            background: DARK_SURFACE_RAISED,
            color: DARK_TEXT,
            fontSize: PLATO_PX - 4,
          }}
        >
          Cerrar
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-wrap content-start"
        style={{ gap: TARJETA_HUECO_PX }}
      >
        {hoy == null && (
          <p style={{ fontSize: PLATO_PX, color: DARK_TEXT_MUTED }}>Cargando…</p>
        )}
        {hoy?.length === 0 && (
          <p style={{ fontSize: PLATO_PX, color: DARK_TEXT_MUTED }}>
            Hoy no ha salido nada todavía
          </p>
        )}
        {hoy?.map((c) => (
          <div key={c.id} style={{ width: TARJETA_ANCHO_PX, flex: "0 0 auto" }}>
            <button
              type="button"
              data-testid="kds-recuperar"
              onClick={() => void recuperar(c.id)}
              className="w-full text-left rounded-[14px] px-4 py-4"
              style={{
                background: DARK_PANEL,
                border: `1px solid ${DARK_SURFACE_RAISED}`,
                minHeight: MIN_TOUCH_COCINA_PX,
              }}
            >
              <span className="font-bold block" style={{ fontSize: MESA_PX - 8 }}>
                {c.tableName ?? `#${c.number}`}
              </span>
              <span style={{ fontSize: EYEBROW_COCINA_PX, color: DARK_TEXT_MUTED }}>
                {c.lines.map((l) => l.name).join(" · ")}
              </span>
              <span
                className="block mt-2 font-semibold"
                style={{ fontSize: EYEBROW_COCINA_PX, color: VERDE_LISTA }}
              >
                TOCAR PARA DEVOLVERLA A LA PANTALLA
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
