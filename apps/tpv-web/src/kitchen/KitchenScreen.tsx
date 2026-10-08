// kds-1-cocina · LA PANTALLA.
//
// La misma APK en «modo cocina» (decisión 1). Diseñada a **1280 × 800
// horizontal**, que es el peor caso: una tablet de 10" en un soporte de
// pared.
//
// Lo que tiene y lo que no:
//
//   · barra de arriba con «En línea», LA HORA y «Hoy»;
//   · tarjetas en ORDEN DE LECTURA, de izquierda a derecha y luego la
//     fila de abajo, en CUATRO columnas (decisión 7);
//   · franja vertical «+N» en el borde derecho de las tarjetas para lo
//     que no cabe entero, con las mesas debajo;
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
  colorMasN,
  cuentaMasN,
  mesasMasN,
  repartirTarjetas,
} from "../lib/kitchenLayout.js";
import { minutosDesdeMarchado } from "../lib/kitchenSemaforo.js";
import {
  BARRA_SUPERIOR_PX,
  COLUMNA_LISTAS_PX,
  COLUMNAS_A_1280,
  DARK_CANVAS,
  DARK_PANEL,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  EN_LINEA_PX,
  EYEBROW_COCINA_PX,
  EYEBROW_COCINA_TRACKING,
  HOY_PX,
  INDICADOR_MAS_N_PX,
  LISTAS_MESA_PX,
  LISTAS_NOTA_PX,
  MAS_N_ETIQUETA_PX,
  MAS_N_MESAS_PX,
  MAS_N_PX,
  MESA_PX,
  MIN_TOUCH_COCINA_PX,
  PLATO_PX,
  PULSO_CLASS_TARJETA,
  RELOJ_PX,
  ROJO_ALERGIA,
  ROJO_SIN_CONEXION,
  SUBTITULO_BARRA_PX,
  TARJETA_CUERPO,
  TARJETA_HUECO_PX,
  TITULO_BARRA_PX,
  VERDE_EN_LINEA_FONDO,
  VERDE_LISTA,
  VERDE_LISTA_TEXT,
  ZONA_PADDING_PX,
} from "../lib/kitchenTheme.js";
import { ComandaCard } from "./ComandaCard.js";
import { TITULO_SECCION } from "./secciones.js";
import type { Comanda, KitchenMe } from "./types.js";
import { useKitchenFeed } from "./useKitchenFeed.js";

export interface KitchenScreenProps {
  me: KitchenMe;
}

export function KitchenScreen({ me }: KitchenScreenProps) {
  const feed = useKitchenFeed();
  const [hoyAbierto, setHoyAbierto] = useState(false);
  const zonaRef = useRef<HTMLDivElement | null>(null);
  // El valor inicial es la zona de CONTENIDO a 1280 × 800, que es el peor
  // caso para el que esta pantalla se diseñó: 1280 − 160 («Listas») − 60
  // (la franja «+N») − 24 (padding) = 1036; 800 − 60 (barra) − 24 = 716.
  const [zona, setZona] = useState({ ancho: 1036, alto: 716 });

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
        // Se resta el padding: lo que el reparto necesita es la caja de
        // CONTENIDO, y `clientWidth` incluye el relleno. Con el relleno
        // dentro, el reparto creía tener 24 px más de los que tiene.
        setZona({
          ancho: el.clientWidth - 2 * ZONA_PADDING_PX,
          alto: el.clientHeight - 2 * ZONA_PADDING_PX,
        });
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
  const colorFranja = colorMasN(reparto.extra, settings, feed.ahora);

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
        className="shrink-0 flex items-center gap-4 border-b"
        style={{
          height: BARRA_SUPERIOR_PX,
          padding: "0 16px",
          borderColor: DARK_SURFACE_RAISED,
        }}
      >
        <span
          className="font-bold"
          style={{ fontSize: TITULO_BARRA_PX, letterSpacing: "-0.01em" }}
        >
          {me.sections.map((s) => TITULO_SECCION[s]).join(" · ")}
        </span>
        <span style={{ fontSize: SUBTITULO_BARRA_PX, color: DARK_TEXT_MUTED }}>
          {me.store.name}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span
            data-testid="kds-en-linea"
            className="flex items-center gap-2 font-semibold"
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 18,
              background: feed.offline ? ROJO_SIN_CONEXION : VERDE_EN_LINEA_FONDO,
              color: feed.offline ? "#FFFFFF" : VERDE_LISTA,
              fontSize: EN_LINEA_PX,
            }}
          >
            <span
              className="rounded-full shrink-0"
              style={{
                width: 10,
                height: 10,
                background: feed.offline ? "#FFFFFF" : VERDE_LISTA,
              }}
            />
            {feed.offline ? "SIN CONEXIÓN" : "EN LÍNEA"}
          </span>
          {/* LA HORA. La maqueta la lleva y la primera captura no: en una
              cocina sin reloj de pared, «14 min» no dice a qué hora entró
              la comanda, y el cocinero que vuelve de la cámara necesita
              saber si lleva dos minutos fuera o veinte. Es la del
              SERVIDOR, igual que los minutos del semáforo. */}
          <span
            data-testid="kds-hora"
            className="font-semibold tabular-nums"
            style={{ fontSize: RELOJ_PX }}
          >
            {horaCorta(feed.ahora)}
          </span>
          <button
            type="button"
            data-testid="kds-hoy"
            onClick={() => setHoyAbierto(true)}
            className="font-semibold"
            style={{
              minHeight: MIN_TOUCH_COCINA_PX,
              padding: "0 18px",
              borderRadius: 12,
              border: `1px solid ${DARK_SURFACE_RAISED}`,
              background: "transparent",
              color: DARK_TEXT,
              fontSize: HOY_PX,
            }}
          >
            Hoy
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* ── Las tarjetas, en orden de lectura ───────────────────────
            CUATRO columnas a 1280 px. Una cuadrícula de `1fr` y no
            tarjetas de ancho fijo, como en la maqueta: así las cuatro
            reparten el ancho entero y no queda una franja muerta a la
            derecha. El orden del DOM es el orden de lectura, de izquierda
            a derecha y después la fila de abajo — en columnas el ojo se
            saltaba la segunda más antigua, que es la corrección del
            08-10. */}
        <div
          ref={zonaRef}
          data-testid="kds-zona"
          className="flex-1 min-w-0 grid content-start items-start overflow-hidden"
          style={{
            padding: ZONA_PADDING_PX,
            gap: TARJETA_HUECO_PX,
            gridTemplateColumns: `repeat(${reparto.columnas}, minmax(0, 1fr))`,
          }}
        >
          {reparto.visibles.map((c) => (
            <ComandaCard
              key={c.id}
              comanda={c}
              settings={settings}
              ahora={feed.ahora}
              mostrarSeccion={mostrarSeccion}
              onTachar={tachar}
              onVisto={visto}
              onLista={() => void lista(c.id)}
              onUrgente={(u) => void urgente(c.id, u)}
            />
          ))}
          {abiertas.length === 0 && !feed.offline && (
            <p
              data-testid="kds-vacio"
              className="m-auto"
              style={{ fontSize: PLATO_PX, color: DARK_TEXT_MUTED, gridColumn: "1 / -1" }}
            >
              Sin comandas pendientes
            </p>
          )}
        </div>

        {/* ── La franja «+N» ──────────────────────────────────────────
            En el borde derecho DE LAS TARJETAS, no al pie de «Listas»:
            lo que no cabe es una comanda, y las comandas están aquí.

            **Y es NEUTRA.** El rojo sólo entra si una de las escondidas ya
            pasó a rojo en el semáforo —eso sí es una mesa que lleva 25
            minutos y no se ve—; si sólo hay nuevas, parpadea en verde. Una
            franja roja permanente le quita el crédito al rojo de la franja
            «URGENTE» de al lado, que es la regla del rojo.

            Se pinta SIEMPRE, vacía si no hay nada escondido: si apareciera
            y desapareciera, la zona de tarjetas cambiaría de ancho y el
            reparto podría oscilar en cada repintado. */}
        <div
          data-testid="kds-mas-n"
          data-color={colorFranja}
          className={`shrink-0 flex flex-col items-center justify-center gap-1 border-l ${
            colorFranja === "verde" ? PULSO_CLASS_TARJETA : ""
          }`}
          style={{
            width: INDICADOR_MAS_N_PX,
            borderColor: DARK_SURFACE_RAISED,
            background: colorFranja === "rojo" ? ROJO_ALERGIA : TARJETA_CUERPO,
            color: DARK_TEXT,
          }}
        >
          {reparto.extra.length > 0 && (
            <>
              <span className="font-bold" style={{ fontSize: MAS_N_PX }}>
                {cuentaMasN(reparto.extra)}
              </span>
              <span
                className="font-bold"
                style={{
                  fontSize: MAS_N_ETIQUETA_PX,
                  color: colorFranja === "verde" ? VERDE_LISTA : DARK_TEXT_MUTED,
                }}
              >
                {colorFranja === "verde" ? "nuevas" : "no caben"}
              </span>
              <span
                data-testid="kds-mas-n-mesas"
                className="font-semibold text-center"
                style={{
                  fontSize: MAS_N_MESAS_PX,
                  lineHeight: 1.2,
                  color: colorFranja === "rojo" ? "#FFFFFF" : DARK_TEXT_MUTED,
                }}
              >
                {mesasMasN(reparto.extra).map((m) => (
                  <span key={m} className="block">
                    {m}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>

        {/* ── La columna «Listas» ─────────────────────────────────────
            Estrecha y a la derecha: la tarjeta sale del centro al pasar a
            «Lista» y se queda ahí hasta que el camarero marca «Servido».
            Marcar «Servido» es del TPV, no de aquí (decisión 5).

            160 px y no 240: los 80 que suelta son los que hacen que entre
            la CUARTA columna de tarjetas. Lo que cabe en 160 es lo único
            que hace falta — la mesa y cuánto lleva esperando. */}
        <aside
          data-testid="kds-listas"
          className="shrink-0 border-l overflow-y-auto flex flex-col"
          style={{
            width: COLUMNA_LISTAS_PX,
            padding: ZONA_PADDING_PX,
            gap: 10,
            borderColor: DARK_SURFACE_RAISED,
            background: DARK_PANEL,
          }}
        >
          <h2
            className="uppercase font-bold shrink-0"
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
              className="shrink-0 flex flex-col"
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: VERDE_LISTA,
                color: VERDE_LISTA_TEXT,
              }}
            >
              <span className="font-bold leading-none" style={{ fontSize: LISTAS_MESA_PX }}>
                {c.tableName ?? `#${c.number}`}
              </span>
              {/* «esperando · 3 min», que es lo que dice la maqueta. La
                  primera captura ponía «1 plato»: cuántos platos lleva no
                  es asunto de nadie una vez están hechos — lo que hay que
                  saber es CUÁNTO LLEVA EN EL PASE enfriándose. */}
              <span className="font-semibold" style={{ fontSize: LISTAS_NOTA_PX, marginTop: 2 }}>
                esperando · {minutosDesdeMarchado(c.readyAt, feed.ahora) ?? 0} min
              </span>
            </div>
          ))}
          <span className="flex-grow" />
          <span
            className="shrink-0"
            style={{ fontSize: LISTAS_NOTA_PX, color: DARK_TEXT_MUTED, lineHeight: 1.35 }}
          >
            Se van solas cuando el camarero marca «Servido».
          </span>
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
        <h2 className="font-bold" style={{ fontSize: TITULO_BARRA_PX }}>
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
            fontSize: HOY_PX,
          }}
        >
          Cerrar
        </button>
      </header>
      {/* Misma cuadrícula de cuatro columnas que la pantalla: es la
          misma tarjeta y el mismo ancho. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto grid content-start"
        style={{
          padding: ZONA_PADDING_PX,
          gap: TARJETA_HUECO_PX,
          gridTemplateColumns: `repeat(${COLUMNAS_A_1280}, minmax(0, 1fr))`,
        }}
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
          <div key={c.id}>
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

/**
 * «13:41». La hora del SERVIDOR, no la de la tablet.
 *
 * Misma razón que los minutos del semáforo: una tablet de cocina barata se
 * desvía, y un reloj desviado en la pared de una cocina es peor que no
 * tener reloj. Se formatea a mano y no con `toLocaleTimeString` porque el
 * WebView de la APK no trae todos los locales y «1:41 PM» en una cocina
 * española no se lee.
 */
function horaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
