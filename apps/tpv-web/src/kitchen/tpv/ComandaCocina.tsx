// kds-1-cocina · LO QUE LA COCINA AÑADE A LA COMANDA DEL TPV.
//
// Piezas sueltas que `SalePage.hospitality.tsx` monta dentro de la comanda
// que v2-H1 dejó hecha. Van en su propio fichero y no dentro de aquél por
// dos razones:
//
//   1. **RETAIL y SERVICES no cambian** (restricción dura del bloque), y
//      tampoco debe cambiar la hostelería con el módulo apagado. Teniendo
//      estas piezas aparte, el `enabled: false` las deja fuera del árbol y
//      no hay un reguero de `if` dentro de la comanda.
//   2. `SalePage.hospitality.tsx` ya tiene 1.200 líneas.
//
// Lo que hay aquí, decisión por decisión:
//
//   · `SentLineCocina`  — la línea YA ENVIADA, con `−`/`+` **sólo donde hay
//                         pantalla** (decisión 6, regla por destino).
//   · `ChipsDeLinea`    — «→ Silla 3» y «Espera» / el tiempo.
//   · `FilaDeTiempos`   — 1º · 2º · 3º · Postre, que SE QUEDA PUESTA.
//   · `AccionesCocina`  — «Urgente», «Marchar 2º» y «Alergias».

import { useState } from "react";

import { ALERGENOS, avisoChoque, type Alergeno } from "@mipiacetpv/ticket-model";

import {
  CORAL,
  DARK_SURFACE,
  DARK_SURFACE_KEY,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  DARK_TEXT_SOFT,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
  SENT_LINE_AMOUNT_PX,
  SENT_LINE_NAME_PX,
  STEPPER_KEY_PX,
} from "../../lib/hospitalityTheme.js";
import { ROJO_ALERGIA, ROJO_ALERGIA_TEXT, ROJO_ANULADO } from "../../lib/kitchenTheme.js";
import {
  alergenosDeSilla,
  etiquetaMarchar,
  mesaConAlergia,
  sillasConAlergia,
  type EstadoCocinaMesa,
} from "../../lib/kitchenComanda.js";

/** El tiempo que el modo «Todo a la vez + Espera» usa para «Espera». */
export const TIEMPO_ESPERA = 2;

/** Los tiempos de la fila del modo «Por tiempos». */
export const TIEMPOS: ReadonlyArray<{ course: number; label: string }> = [
  { course: 1, label: "1º" },
  { course: 2, label: "2º" },
  { course: 3, label: "3º" },
  { course: 4, label: "Postre" },
];

// ──────────────────────────────────────────────────────────────────────
// La línea YA ENVIADA
// ──────────────────────────────────────────────────────────────────────

export interface SentLineCocinaProps {
  lineId: string;
  nombre: string;
  /** Las unidades que la cocina tiene de esta línea. */
  units: number;
  importe: string;
  /**
   * **La regla por destino** (decisión 6). `true` sólo donde la sección de
   * esta línea tiene PANTALLA.
   *
   * v2-H1 quitó el `−`/`+` de lo enviado porque sin pantalla un `−` quitaba
   * el plato de la cuenta mientras el papel seguía en la plancha y cocina
   * nunca se enteraba. Con pantalla la anulación llega, así que el motivo
   * desaparece y queda sólo el riesgo del dedo gordo, que cubre el
   * «Deshacer» de 5 s.
   *
   * `false` → se mantiene lo de v2-H1: sin `−`/`+`, y «Anular» vive en la
   * hoja de la línea con el aviso «cocina ya tiene el papel: díselo».
   */
  puedeCorregir: boolean;
  onClick: () => void;
  /** Anula UNA unidad ya enviada. Arranca el «Deshacer» de 5 s. */
  onAnular: () => void;
  /** Una unidad nueva SIN ENVIAR. Sale con el siguiente «Enviar». */
  onSumar: () => void;
  chips?: React.ReactNode;
}

export function SentLineCocina(props: SentLineCocinaProps) {
  return (
    <div
      data-testid="comanda-linea-enviada"
      data-line-id={props.lineId}
      data-puede-corregir={props.puedeCorregir ? "1" : "0"}
      className="rounded-xl"
    >
      {/* EL NOMBRE, EN SU PROPIA FILA cuando la línea lleva `−`/`+`.
          Lo encontró el bucle visual: con el `−`, la cantidad, el `+`, el
          nombre y el importe en la misma fila de 420 px, «Magro con
          tomate» se quedaba en «Magro con…» y «Patatas bravas» en «Patatas
          br…». v2-H1 subió el nombre de 16 a 23 px precisamente para que
          se LEYERA; truncarlo deshace su decisión 1.

          Sin `−`/`+` (la regla por destino, sin pantalla) la fila es la de
          v2-H1 y no se toca: ahí el nombre tiene todo el ancho. */}
      {props.puedeCorregir && (
        <button
          type="button"
          onClick={props.onClick}
          data-testid="cart-line-name"
          className="w-full flex items-baseline gap-2 px-2.5 pt-2 text-left"
        >
          <span
            className="flex-grow min-w-0 truncate font-medium"
            style={{ fontSize: SENT_LINE_NAME_PX, color: DARK_TEXT_SOFT }}
          >
            {props.nombre}
          </span>
          <span
            className="shrink-0 font-medium tabular-nums whitespace-nowrap"
            style={{ fontSize: SENT_LINE_AMOUNT_PX, color: DARK_TEXT_MUTED }}
          >
            {props.importe}
          </span>
        </button>
      )}
      <div
        className="flex items-center gap-2.5 px-2.5"
        style={{ minHeight: props.puedeCorregir ? 60 : 52, color: DARK_TEXT_MUTED }}
      >
        {props.puedeCorregir ? (
          <>
            {/* El `−` de lo enviado lleva **sólo el contorno rojo**
                (decisión 6): tiene que distinguirse del `−` de lo sin
                enviar, porque uno corrige y el otro ANULA algo que está en
                la plancha. Relleno rojo no, que la regla del rojo lo
                reserva para lo que no puede esperar. */}
            <button
              type="button"
              data-testid="stepper-menos-enviado"
              aria-label="Anular una unidad que ya está en cocina"
              onClick={props.onAnular}
              className={`shrink-0 rounded-[14px] flex items-center justify-center font-semibold ${PRESS_FEEDBACK_CLASS}`}
              style={{
                width: STEPPER_KEY_PX,
                height: STEPPER_KEY_PX,
                background: "transparent",
                border: `2px solid ${ROJO_ANULADO}`,
                color: ROJO_ANULADO,
                fontSize: 26,
              }}
            >
              −
            </button>
            <span
              data-testid="enviada-qty"
              className="shrink-0 w-[30px] text-center font-semibold tabular-nums"
              style={{ fontSize: SENT_LINE_AMOUNT_PX, color: DARK_TEXT_SOFT }}
            >
              {props.units}
            </span>
            <button
              type="button"
              data-testid="stepper-mas-enviado"
              aria-label="Sumar una unidad, que saldrá en el siguiente envío"
              onClick={props.onSumar}
              className={`shrink-0 rounded-[14px] border-0 flex items-center justify-center font-semibold ${PRESS_FEEDBACK_CLASS}`}
              style={{
                width: STEPPER_KEY_PX,
                height: STEPPER_KEY_PX,
                background: DARK_SURFACE_KEY,
                color: DARK_TEXT,
                fontSize: 26,
              }}
            >
              +
            </button>
          </>
        ) : (
          <span
            className="w-7 shrink-0 font-semibold tabular-nums"
            style={{ fontSize: SENT_LINE_AMOUNT_PX }}
          >
            {props.units}
          </span>
        )}
        {/* Sin `−`/`+`, la fila es la de v2-H1: nombre e importe aquí. */}
        {!props.puedeCorregir && (
          <>
            <button
              type="button"
              onClick={props.onClick}
              data-testid="cart-line-name"
              className="flex-grow min-w-0 truncate font-medium text-left"
              style={{ fontSize: SENT_LINE_NAME_PX }}
            >
              {props.nombre}
            </button>
            <span
              className="shrink-0 font-medium tabular-nums whitespace-nowrap"
              style={{ fontSize: SENT_LINE_AMOUNT_PX }}
            >
              {props.importe}
            </span>
          </>
        )}
      </div>
      {props.chips}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Los chips de una línea: la silla y el tiempo
// ──────────────────────────────────────────────────────────────────────

export interface ChipsDeLineaProps {
  lineId: string;
  /**
   * `true` en el bloque «EN COCINA».
   *
   * Lo encontró el bucle visual: el botón «Espera» salía también en las
   * líneas YA ENVIADAS, y ahí no significa nada — ese plato ya marchó y
   * retenerlo no lo devuelve de la plancha. Lo que se hace con algo que
   * ya está en cocina es anularlo, que es el `−` de al lado.
   */
  enviada?: boolean;
  /** Los alérgenos del plato, del catálogo. `[]` = no informado. */
  alergenosDelPlato: readonly string[];
  seat: number | null;
  course: number;
  estado: EstadoCocinaMesa;
  courseMode: "ESPERA" | "TIEMPOS";
  seatMode: "ALERGIA" | "SIEMPRE";
  /** Comensales de la mesa. Con `seatMode = SIEMPRE` salen todas. */
  diners: number | null;
  onSilla: (seat: number | null) => void;
  onTiempo: (course: number) => void;
}

export function ChipsDeLinea(props: ChipsDeLineaProps) {
  const [avisando, setAvisando] = useState<string | null>(null);

  // Decisión 3, capa 2 · el botón de silla sale **sólo si la mesa tiene
  // alergia** (bares), o SIEMPRE si el restaurante lo tiene puesto así.
  // Mismo dato, otro ajuste: no se rehace nada al cambiar de modo.
  const conAlergia = mesaConAlergia(props.estado);
  const mostrarSillas = props.seatMode === "SIEMPRE" || conAlergia;
  const sillas =
    props.seatMode === "SIEMPRE"
      ? Array.from({ length: Math.max(1, props.diners ?? 4) }, (_, i) => i + 1)
      : sillasConAlergia(props.estado);

  const elegirSilla = (seat: number) => {
    // **El aviso, SIN BLOQUEAR** (decisión 3, capa 3). A veces la cocina
    // tiene la versión sin gluten, así que el TPV avisa y deja asignar: el
    // camarero sabe cosas que el catálogo no.
    const choque = props.alergenosDelPlato.filter((a) =>
      alergenosDeSilla(props.estado, seat).includes(a),
    ) as Alergeno[];
    const aviso = avisoChoque(choque);
    if (aviso) setAvisando(aviso);
    props.onSilla(props.seat === seat ? null : seat);
  };

  const hayAlgo =
    (mostrarSillas && sillas.length > 0) ||
    (props.courseMode === "ESPERA" && !props.enviada) ||
    (props.courseMode === "TIEMPOS" && props.course > 1);
  if (!hayAlgo) return null;

  return (
    <div
      data-testid="comanda-linea-chips"
      data-line-id={props.lineId}
      className="flex flex-wrap items-center gap-2 px-2.5 pb-2"
    >
      {mostrarSillas &&
        sillas.map((n) => {
          const elegida = props.seat === n;
          const peligrosa =
            props.alergenosDelPlato.length > 0 &&
            props.alergenosDelPlato.some((a) =>
              alergenosDeSilla(props.estado, n).includes(a),
            );
          return (
            <button
              key={n}
              type="button"
              data-testid="chip-silla"
              data-silla={n}
              data-elegida={elegida ? "1" : "0"}
              data-peligrosa={peligrosa ? "1" : "0"}
              onClick={() => elegirSilla(n)}
              className={`rounded-[12px] px-3 font-semibold ${PRESS_FEEDBACK_CLASS}`}
              style={{
                minHeight: MIN_TOUCH_PX,
                background: elegida ? ROJO_ALERGIA : DARK_SURFACE,
                color: elegida ? ROJO_ALERGIA_TEXT : DARK_TEXT_SOFT,
                border: peligrosa && !elegida ? `2px solid ${ROJO_ALERGIA}` : "none",
                fontSize: 17,
              }}
            >
              → Silla {n}
            </button>
          );
        })}

      {/* Modo «Todo a la vez + Espera»: UN botón, y por debajo es el
          tiempo 2. Cero toques más en el caso normal (decisión 3).
          Nunca sobre algo que YA está en cocina. */}
      {props.courseMode === "ESPERA" && !props.enviada && (
        <button
          type="button"
          data-testid="chip-espera"
          data-activo={props.course >= TIEMPO_ESPERA ? "1" : "0"}
          onClick={() =>
            props.onTiempo(props.course >= TIEMPO_ESPERA ? 1 : TIEMPO_ESPERA)
          }
          className={`rounded-[12px] px-4 font-semibold ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: MIN_TOUCH_PX,
            background: props.course >= TIEMPO_ESPERA ? CORAL : DARK_SURFACE,
            color: props.course >= TIEMPO_ESPERA ? "#FFFFFF" : DARK_TEXT_SOFT,
            fontSize: 17,
          }}
        >
          Espera
        </button>
      )}

      {/* Modo «Por tiempos»: el tiempo se elige en la fila de arriba y
          aquí sólo se enseña cuál es, para poder corregirlo de un toque. */}
      {props.courseMode === "TIEMPOS" && props.course > 1 && (
        <span
          data-testid="chip-tiempo"
          className="rounded-[12px] px-3 font-semibold flex items-center"
          style={{
            minHeight: MIN_TOUCH_PX,
            background: DARK_SURFACE,
            color: DARK_TEXT_SOFT,
            fontSize: 17,
          }}
        >
          {props.course}º
        </span>
      )}

      {avisando && (
        <button
          type="button"
          data-testid="aviso-alergeno"
          onClick={() => setAvisando(null)}
          className="w-full rounded-[12px] px-3 py-2 font-bold text-left"
          style={{
            background: ROJO_ALERGIA,
            color: ROJO_ALERGIA_TEXT,
            fontSize: 18,
          }}
        >
          {avisando} · toca para cerrar
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// La fila de tiempos del modo «Por tiempos»
// ──────────────────────────────────────────────────────────────────────

export interface FilaDeTiemposProps {
  /**
   * El tiempo elegido. **SE QUEDA PUESTO** (decisión 3): los productos que
   * se pulsen después van a ese tiempo hasta que se cambie.
   *
   * Es lo que hace que comandar una mesa de cuatro a la carta cueste 2-3
   * toques más y no uno por plato.
   */
  course: number;
  onCourse: (course: number) => void;
}

export function FilaDeTiempos(props: FilaDeTiemposProps) {
  return (
    <div
      data-testid="fila-tiempos"
      className="shrink-0 flex items-center gap-2 px-3 pb-2"
    >
      {TIEMPOS.map((t) => {
        const elegido = props.course === t.course;
        return (
          <button
            key={t.course}
            type="button"
            data-testid="tiempo-tecla"
            data-course={t.course}
            data-elegido={elegido ? "1" : "0"}
            onClick={() => props.onCourse(t.course)}
            className={`flex-1 rounded-[14px] font-semibold ${PRESS_FEEDBACK_CLASS}`}
            style={{
              minHeight: MIN_TOUCH_PX,
              background: elegido ? CORAL : DARK_SURFACE,
              color: elegido ? "#FFFFFF" : DARK_TEXT_SOFT,
              fontSize: 18,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Las acciones de cocina del pie de la comanda
// ──────────────────────────────────────────────────────────────────────

export interface AccionesCocinaProps {
  /**
   * `Tenant.kitchenDisplayEnabled`. Apagado, se pinta SÓLO «Alergias».
   *
   * «Urgente» y «Marchar» son del módulo —son órdenes a una pantalla que
   * no existe—; «Alergias» es de serie en hostelería porque informar de
   * alérgenos es obligación legal (decisión 10).
   */
  moduloEncendido: boolean;
  estado: EstadoCocinaMesa;
  /** El toggle de «Urgente» que viaja EN el próximo envío (decisión 3). */
  urgentePendiente: boolean;
  onUrgente: () => void;
  /** Los tiempos retenidos con líneas dentro. Vacío → no se pinta. */
  porMarchar: number[];
  onMarchar: (course: number) => void;
  onAlergias: () => void;
  /** Cuántas alergias hay declaradas, para el contador del botón. */
  alergias: number;
}

export function AccionesCocina(props: AccionesCocinaProps) {
  return (
    <div
      data-testid="acciones-cocina"
      className="shrink-0 flex flex-wrap items-center gap-2 px-3 pb-2"
    >
      {/* «Urgente», junto a «Enviar» (decisión 3). Un toque. */}
      {props.moduloEncendido && (
        <button
          type="button"
          data-testid="boton-urgente"
          data-activo={props.urgentePendiente ? "1" : "0"}
          onClick={props.onUrgente}
          className={`rounded-[14px] px-4 font-semibold ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: MIN_TOUCH_PX,
            background: props.urgentePendiente ? ROJO_ANULADO : DARK_SURFACE,
            color: props.urgentePendiente ? "#FFFFFF" : DARK_TEXT_SOFT,
            fontSize: 17,
          }}
        >
          ⚡ Urgente
        </button>
      )}

      {/* «Marchar 2º». Sólo si hay un tiempo retenido con algo dentro: un
          botón que no hace nada ocupa 56 px de una pantalla donde no
          sobran. */}
      {props.porMarchar.map((c) => (
        <button
          key={c}
          type="button"
          data-testid="boton-marchar"
          data-course={c}
          onClick={() => props.onMarchar(c)}
          className={`rounded-[14px] px-4 font-semibold ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: MIN_TOUCH_PX,
            background: CORAL,
            color: "#FFFFFF",
            fontSize: 17,
          }}
        >
          {etiquetaMarchar(c)}
        </button>
      ))}

      {/* «Alergias». Siempre visible en hostelería: es de serie, módulo o
          no (decisión 10). El contador dice si ya hay algo declarado, para
          que el camarero no tenga que abrirla para comprobarlo. */}
      <button
        type="button"
        data-testid="boton-alergias"
        onClick={props.onAlergias}
        className={`ml-auto rounded-[14px] px-4 font-semibold ${PRESS_FEEDBACK_CLASS}`}
        style={{
          minHeight: MIN_TOUCH_PX,
          background: props.alergias > 0 ? ROJO_ALERGIA : DARK_SURFACE_RAISED,
          color: props.alergias > 0 ? ROJO_ALERGIA_TEXT : DARK_TEXT_SOFT,
          fontSize: 17,
        }}
      >
        ⚠ Alergias{props.alergias > 0 ? ` · ${props.alergias}` : ""}
      </button>
    </div>
  );
}

/** Los nombres largos de unos alérgenos, para un aviso legible. */
export function nombresDeAlergenos(codigos: readonly string[]): string {
  return codigos
    .map((c) => (c in ALERGENOS ? ALERGENOS[c as Alergeno].etiqueta : c))
    .join(", ");
}
