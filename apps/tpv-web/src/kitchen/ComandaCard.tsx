// kds-1-cocina · LA TARJETA.
//
// Lo que el cocinero mira. De arriba abajo, y el orden ES la decisión 3:
//
//   1. franja «⚡ URGENTE», si lo es — lo primero porque cambia el orden
//      en que se cocina todo lo demás;
//   2. cabecera del SEMÁFORO, con la mesa y los minutos en grande: el
//      color de la cabecera entera, no un puntito («se reconoce, no se
//      lee»);
//   3. franjas de ALERGIA de la mesa, antes de los platos, porque
//      condicionan cómo se cocinan;
//   4. los platos MARCHADOS, con su cantidad, sus modificadores y sus
//      notas bien visibles;
//   5. los platos EN ESPERA, en gris y al final, sin semáforo;
//   6. el botón «Lista», de 56 px.
//
// Y lo que NO lleva: precios, hora exacta, camarero, comensales.

import { useEffect, useRef } from "react";

import {
  ALERGIA_PX,
  AMBAR_CAMBIO,
  AMBAR_CAMBIO_TEXT,
  ANULADO_PX,
  DARK_PANEL,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  EYEBROW_COCINA_PX,
  EYEBROW_COCINA_TRACKING,
  LINEA_HEIGHT_PX,
  LISTA_HEIGHT_PX,
  LLEVA_PX,
  MESA_PX,
  MINUTOS_PX,
  NOTA_PX,
  PLATO_PX,
  PULSO_CLASS_AMBAR,
  PULSO_CLASS_ROJO,
  PULSO_CLASS_TARJETA,
  ROJO_ALERGIA,
  ROJO_ALERGIA_TEXT,
  ROJO_ANULADO,
  ROJO_URGENTE,
  ROJO_URGENTE_TEXT,
  SEMAFORO_FILL,
  SEMAFORO_TEXT,
  SILLA_PX,
  URGENTE_PX,
  VERDE_LISTA,
  VERDE_LISTA_TEXT,
  VISTO_HEIGHT_PX,
} from "../lib/kitchenTheme.js";
import { etiquetaMinutos, minutosDesdeMarchado, tonoSemaforo } from "../lib/kitchenSemaforo.js";
import { ETIQUETA_SECCION } from "./secciones.js";
import type { AjustesCocina, Comanda, LineaComanda } from "./types.js";

export interface ComandaCardProps {
  comanda: Comanda;
  settings: AjustesCocina;
  /** Hora del servidor corregida: con la que se cuentan los minutos. */
  ahora: string;
  /** La pantalla muestra más de una sección → se pinta cuál es. */
  mostrarSeccion: boolean;
  /** Un toque: tachar o destachar. */
  onTachar: (lineId: string, done: boolean) => void;
  /** «Visto» de un anulado o un cambio. */
  onVisto: (lineId: string) => void;
  /** El botón grande «Lista». */
  onLista: () => void;
  /** Toque largo: subir o bajar urgente. */
  onUrgente: (urgent: boolean) => void;
  /** En la columna «Listas» la tarjeta se pinta compacta y sin botones. */
  compacta?: boolean;
}

/** Cuánto es un «toque largo». 600 ms: no se dispara al tachar. */
const TOQUE_LARGO_MS = 600;

export function ComandaCard(props: ComandaCardProps) {
  const { comanda: c, settings, ahora } = props;
  const minutos = minutosDesdeMarchado(c.firedAt, ahora);
  const tono = tonoSemaforo(minutos, settings);

  // Decisión 8 · el parpadeo. Rojo si urgente o con alergia; neutro si
  // sólo es nueva. Y NUNCA la pantalla entera: esta clase va en la
  // tarjeta.
  const parpadeo =
    c.isNew && (c.urgent || c.allergyBands.length > 0)
      ? PULSO_CLASS_ROJO
      : c.isNew
        ? PULSO_CLASS_TARJETA
        : "";

  const marchados = c.lines.filter((l) => l.fired);
  const enEspera = c.lines.filter((l) => !l.fired);

  // El toque largo que sube a urgente (decisión 3: «por si el camarero se
  // lo dice a voz»). En un `useRef` y no en una variable del cuerpo: el
  // cuerpo se vuelve a ejecutar en cada repintado —y esta pantalla repinta
  // cada segundo por el reloj del semáforo—, así que una variable local
  // perdería el temporizador a mitad del gesto y el toque largo no se
  // dispararía nunca.
  const toqueLargoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empezarToqueLargo = () => {
    toqueLargoRef.current = setTimeout(() => {
      props.onUrgente(!c.urgent);
      toqueLargoRef.current = null;
    }, TOQUE_LARGO_MS);
  };
  const cancelarToqueLargo = () => {
    if (toqueLargoRef.current) clearTimeout(toqueLargoRef.current);
    toqueLargoRef.current = null;
  };
  useEffect(
    () => () => {
      if (toqueLargoRef.current) clearTimeout(toqueLargoRef.current);
    },
    [],
  );

  return (
    <article
      data-testid="kds-comanda"
      data-comanda-id={c.id}
      data-urgente={c.urgent ? "1" : "0"}
      data-nueva={c.isNew ? "1" : "0"}
      data-tono={tono}
      className={`rounded-[14px] overflow-hidden flex flex-col ${parpadeo}`}
      style={{
        background: DARK_PANEL,
        // El borde rojo de la tarjeta urgente (decisión 7), que se suma a
        // la franja. Dos señales para lo mismo porque es lo único que
        // cambia el ORDEN del trabajo.
        border: c.urgent ? `3px solid ${ROJO_URGENTE}` : `1px solid ${DARK_SURFACE_RAISED}`,
      }}
    >
      {/* 1 · ⚡ URGENTE */}
      {c.urgent && (
        <div
          data-testid="kds-franja-urgente"
          className="flex items-center justify-center font-bold"
          style={{
            background: ROJO_URGENTE,
            color: ROJO_URGENTE_TEXT,
            fontSize: URGENTE_PX,
            padding: "9px 0",
          }}
        >
          ⚡ URGENTE
        </div>
      )}

      {/* 2 · la cabecera del semáforo */}
      <button
        type="button"
        data-testid="kds-cabecera"
        onPointerDown={empezarToqueLargo}
        onPointerUp={cancelarToqueLargo}
        onPointerLeave={cancelarToqueLargo}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full text-left flex items-baseline gap-3 px-4"
        style={{
          background: SEMAFORO_FILL[tono],
          color: SEMAFORO_TEXT[tono],
          paddingTop: 10,
          paddingBottom: 10,
        }}
      >
        <span className="font-bold leading-none" style={{ fontSize: MESA_PX }}>
          {c.tableName ?? `#${c.number}`}
        </span>
        <span
          className="font-semibold leading-none ml-auto"
          style={{ fontSize: minutos == null ? ALERGIA_PX : MINUTOS_PX }}
        >
          {etiquetaMinutos(minutos)}
        </span>
      </button>

      {/* El eyebrow: «2ª COMANDA», la sección y «llegó tarde». */}
      <div
        className="px-4 pt-2 flex items-center gap-2 uppercase font-semibold"
        style={{
          fontSize: EYEBROW_COCINA_PX,
          letterSpacing: EYEBROW_COCINA_TRACKING,
          color: DARK_TEXT_MUTED,
        }}
      >
        {c.number > 1 && <span data-testid="kds-numero">{c.number}ª COMANDA</span>}
        {props.mostrarSeccion && <span>{ETIQUETA_SECCION[c.section]}</span>}
        {/* Decisión 9 · llegó cuando la pantalla volvió de estar sin red.
            Se dice para que el cocinero no lo lea como recién hecho. */}
        {c.lateArrival && (
          <span data-testid="kds-tarde" style={{ color: AMBAR_CAMBIO }}>
            LLEGÓ TARDE
          </span>
        )}
      </div>

      {/* 3 · las alergias de la mesa */}
      {c.allergyBands.map((banda) => (
        <div
          key={banda}
          data-testid="kds-franja-alergia"
          className={`mx-3 mt-2 rounded-[8px] font-bold text-center ${PULSO_CLASS_ROJO}`}
          style={{
            background: ROJO_ALERGIA,
            color: ROJO_ALERGIA_TEXT,
            fontSize: ALERGIA_PX,
            padding: "9px 8px",
          }}
        >
          {banda}
        </div>
      ))}

      {/* 4 · los platos marchados */}
      <ul className="px-3 pt-2 flex flex-col gap-1">
        {marchados.map((l) => (
          <Linea
            key={l.id}
            linea={l}
            compacta={props.compacta === true}
            onTachar={props.onTachar}
            onVisto={props.onVisto}
          />
        ))}
      </ul>

      {/* 5 · los platos EN ESPERA, al final y en gris */}
      {enEspera.length > 0 && (
        <>
          <div
            data-testid="kds-bloque-espera"
            className="px-4 pt-3 uppercase font-semibold"
            style={{
              fontSize: EYEBROW_COCINA_PX,
              letterSpacing: EYEBROW_COCINA_TRACKING,
              color: DARK_TEXT_MUTED,
            }}
          >
            EN ESPERA
          </div>
          <ul className="px-3 pt-1 pb-1 flex flex-col gap-1">
            {enEspera.map((l) => (
              <Linea
                key={l.id}
                linea={l}
                compacta
                onTachar={props.onTachar}
                onVisto={props.onVisto}
              />
            ))}
          </ul>
        </>
      )}

      {/* 6 · «Lista» */}
      {!props.compacta && (
        <button
          type="button"
          data-testid="kds-lista"
          onClick={props.onLista}
          className="mx-3 mb-3 mt-3 rounded-[12px] font-bold"
          style={{
            height: LISTA_HEIGHT_PX,
            minHeight: LISTA_HEIGHT_PX,
            background: VERDE_LISTA,
            color: VERDE_LISTA_TEXT,
            fontSize: PLATO_PX,
          }}
        >
          Lista
        </button>
      )}
    </article>
  );
}

function Linea(props: {
  linea: LineaComanda;
  compacta: boolean;
  onTachar: (lineId: string, done: boolean) => void;
  onVisto: (lineId: string) => void;
}) {
  const l = props.linea;
  const anuladaDelTodo = l.units <= 0;
  // Decisión 8 · la línea afectada parpadea hasta «Visto».
  const parpadeo = l.voidPending
    ? PULSO_CLASS_ROJO
    : l.changePending
      ? PULSO_CLASS_AMBAR
      : l.allergyWarning
        ? PULSO_CLASS_ROJO
        : "";

  return (
    <li
      data-testid="kds-linea"
      data-linea-id={l.id}
      data-hecha={l.done ? "1" : "0"}
      data-espera={l.fired ? "0" : "1"}
      className={`rounded-[10px] ${parpadeo}`}
      style={{
        // Capa 3 · el plato de la silla alérgica que lleva SU alérgeno va
        // RECUADRADO en rojo. Es la única línea que lleva borde.
        border: l.allergyWarning
          ? `3px solid ${ROJO_ALERGIA}`
          : l.seat != null
            ? `2px solid ${ROJO_ALERGIA}`
            : "none",
        background: l.done ? DARK_SURFACE : "transparent",
        opacity: l.fired ? 1 : 0.55,
      }}
    >
      {/* «SILLA 3», encima del plato */}
      {l.seat != null && (
        <div
          data-testid="kds-silla"
          className="px-3 pt-2 font-bold uppercase"
          style={{ fontSize: SILLA_PX, color: ROJO_ALERGIA }}
        >
          SILLA {l.seat}
        </div>
      )}

      <button
        type="button"
        // Un toque tacha el plato; otro lo destacha. EN ESPERA no se
        // puede tachar: todavía no se está cocinando.
        disabled={!l.fired || anuladaDelTodo}
        onClick={() => props.onTachar(l.id, !l.done)}
        className="w-full text-left flex items-center gap-3 px-3"
        style={{
          minHeight: LINEA_HEIGHT_PX,
          color: DARK_TEXT,
        }}
      >
        <span
          className="font-bold"
          style={{
            fontSize: PLATO_PX,
            // Decisión 4 · un toque TACHA. Literalmente: el plato queda
            // tachado, no desaparece — la tarjeta tiene que seguir
            // diciendo lo que se pidió.
            textDecoration: l.done || anuladaDelTodo ? "line-through" : "none",
            color: anuladaDelTodo ? ROJO_ANULADO : DARK_TEXT,
          }}
        >
          {formatearUnidades(l.units)} {l.name}
        </span>
      </button>

      {/* Capa 3 · el grito */}
      {l.allergyWarning && (
        <div
          data-testid="kds-lleva"
          className="px-3 pb-2 font-bold"
          style={{ fontSize: LLEVA_PX, color: ROJO_ALERGIA_TEXT, background: ROJO_ALERGIA }}
        >
          {l.allergyWarning}
        </div>
      )}

      {/* Capa 3 informativa · sin rojo y sin parpadeo: es un aviso, no una
          alarma, y la regla del rojo dice que el rojo es para lo que no
          puede esperar. */}
      {l.allergyWarning == null && l.carries.length > 0 && (
        <div
          data-testid="kds-carries"
          className="px-3 pb-1"
          style={{ fontSize: NOTA_PX, color: AMBAR_CAMBIO }}
        >
          {l.carries.join(" · ")}
        </div>
      )}

      {/* Modificadores y notas, BIEN VISIBLES (decisión 3). */}
      {l.notes.length > 0 && (
        <ul className="px-3 pb-2 flex flex-col gap-[2px]">
          {l.notes.map((n, i) => (
            <li
              key={`${l.id}-n${i}`}
              data-testid="kds-nota"
              style={{ fontSize: NOTA_PX, color: DARK_TEXT }}
            >
              · {n}
            </li>
          ))}
        </ul>
      )}

      {/* Decisión 6 · el anulado y el cambio, con su «Visto». No
          desaparecen hasta que el cocinero lo toca. */}
      {l.voidPending && (
        <div className="px-3 pb-2 flex items-center gap-3">
          <span
            data-testid="kds-anulado"
            className="font-bold"
            style={{ fontSize: ANULADO_PX, color: ROJO_ANULADO }}
          >
            {anuladaDelTodo
              ? "ANULADO"
              : `ERAN ${formatearUnidades(l.unitsOriginal ?? l.units)} · −${formatearUnidades(l.voidedUnits)}`}
            {l.doneBeforeVoid ? " · YA ESTABA HECHO" : ""}
          </span>
          <button
            type="button"
            data-testid="kds-visto"
            onClick={() => props.onVisto(l.id)}
            className="ml-auto rounded-[8px] px-4 font-semibold"
            style={{
              height: VISTO_HEIGHT_PX,
              minHeight: VISTO_HEIGHT_PX,
              background: DARK_SURFACE_RAISED,
              color: DARK_TEXT,
              fontSize: ANULADO_PX,
            }}
          >
            Visto
          </button>
        </div>
      )}
      {!l.voidPending && l.changePending && (
        <div className="px-3 pb-2 flex items-center gap-3">
          <span
            data-testid="kds-cambio"
            className="font-bold rounded-[6px] px-2"
            style={{
              fontSize: ANULADO_PX,
              background: AMBAR_CAMBIO,
              color: AMBAR_CAMBIO_TEXT,
            }}
          >
            CAMBIO{l.changeNote ? ` · ${l.changeNote}` : ""}
          </span>
          <button
            type="button"
            data-testid="kds-visto"
            onClick={() => props.onVisto(l.id)}
            className="ml-auto rounded-[8px] px-4 font-semibold"
            style={{
              height: VISTO_HEIGHT_PX,
              minHeight: VISTO_HEIGHT_PX,
              background: DARK_SURFACE_RAISED,
              color: DARK_TEXT,
              fontSize: ANULADO_PX,
            }}
          >
            Visto
          </button>
        </div>
      )}
    </li>
  );
}

/** «2» · «0,5». Nunca «2.000». */
function formatearUnidades(u: number): string {
  if (Number.isInteger(u)) return String(u);
  return u.toFixed(2).replace(".", ",").replace(/,?0+$/, "");
}
