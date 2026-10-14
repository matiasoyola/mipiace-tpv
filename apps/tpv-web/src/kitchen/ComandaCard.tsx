// kds-1-cocina · LA TARJETA.
//
// Lo que el cocinero mira. De arriba abajo, y el orden ES la decisión 3:
//
//   1. franja «URGENTE», si lo es — lo primero porque cambia el orden en
//      que se cocina todo lo demás;
//   2. cabecera del SEMÁFORO, con la mesa y los minutos en grande: el
//      color de la cabecera entera, no un puntito («se reconoce, no se
//      lee»);
//   3. franja de ALERGIA de la mesa, roja y de ancho completo, antes de
//      los platos, porque condiciona cómo se cocinan;
//   4. los platos MARCHADOS, con su cantidad, sus modificadores y sus
//      notas bien visibles;
//   5. los platos EN ESPERA, en gris y al final, sin semáforo;
//   6. el botón «Lista», de 56 px.
//
// Y lo que NO lleva: precios, hora exacta, camarero, comensales.
//
// ── EL CUERPO VA NEUTRO. SIEMPRE ──────────────────────────────────────
//
// `TARJETA_CUERPO` en las cuatro tarjetas de la maqueta, y es la
// corrección de fondo de kds-1b. El rojo vive en cuatro sitios y en
// ninguno más: la franja «URGENTE» con su anillo de 4 px, la franja de la
// alergia de la mesa, el recuadro del plato de la silla con alergia, y el
// plato que lleva el alérgeno de SU silla.
//
// Antes el pulso rojo se ponía en el `<article>` entero, así que el cuerpo
// de la T4 (urgente) y el de la M5 (alergia) salían rojo oscuro. Sobre un
// cuerpo rojo, la franja «URGENTE» deja de destacar: la tarjeta dice «esta
// comanda es roja» en vez de «esto de aquí dentro no puede esperar». Lo
// que parpadea cuando la comanda es nueva es `PULSO_CLASS_TARJETA`, que va
// del cuerpo a un verde apagado.

import { useEffect, useRef } from "react";

import {
  ALERGIA_ALERGENO_PX,
  ALERGIA_PX,
  AMBAR_CAMBIO,
  AMBAR_CAMBIO_TEXT,
  AMBAR_NOTA,
  ANILLO_URGENTE_PX,
  ANULADO_PX,
  CANTIDAD_ANCHO_PX,
  CANTIDAD_PX,
  CARRIES_PX,
  DARK_CANVAS,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  EYEBROW_COCINA_PX,
  EYEBROW_COCINA_TRACKING,
  FRANJA_URGENTE_ALTO_PX,
  LINEA_HEIGHT_PX,
  LISTA_FONDO,
  LISTA_HEIGHT_PX,
  LISTA_LABEL_PX,
  LISTA_TEXTO,
  LLEVA_PX,
  MESA_PX,
  MINUTOS_PX,
  NOTA_PREFIJO,
  NOTA_PX,
  NOTA_WEIGHT,
  PLATO_PX,
  PULSO_CLASS_AMBAR,
  PULSO_CLASS_ROJO,
  PULSO_CLASS_TARJETA,
  ROJO_ALERGIA,
  ROJO_ALERGIA_BORDE,
  ROJO_ALERGIA_FONDO,
  ROJO_ALERGIA_TEXT,
  ROJO_ANULADO,
  ROJO_URGENTE,
  ROJO_URGENTE_TEXT,
  SEMAFORO_FILL,
  SEMAFORO_TEXT,
  SILLA_PX,
  TARJETA_CUERPO,
  TARJETA_RADIO_PX,
  URGENTE_PX,
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

/** El rayo de la franja «URGENTE». El mismo trazo que la maqueta. */
function IconoUrgente() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

/** El triángulo de aviso de la franja de la alergia. */
function IconoAlergia() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function ComandaCard(props: ComandaCardProps) {
  const { comanda: c, settings, ahora } = props;
  const minutos = minutosDesdeMarchado(c.firedAt, ahora);
  const tono = tonoSemaforo(minutos, settings);

  // Decisión 8 · el parpadeo de lo NUEVO, y SIEMPRE el neutro: va del
  // cuerpo de la tarjeta a un verde apagado. Lo que dice es «nadie ha
  // mirado esto todavía», y eso no es rojo —ni cuando la comanda es
  // urgente ni cuando tiene alergia—. El rojo ya está donde tiene que
  // estar: en la franja y en el plato.
  const parpadeo = c.isNew ? PULSO_CLASS_TARJETA : "";

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

  const eyebrow = [
    c.number > 1 ? `${c.number}ª COMANDA` : null,
    props.mostrarSeccion ? ETIQUETA_SECCION[c.section] : null,
    // Decisión 9 · llegó cuando la pantalla volvió de estar sin red. Se
    // dice para que el cocinero no lo lea como recién hecho.
    c.lateArrival ? "LLEGÓ TARDE" : null,
  ].filter((x): x is string => x != null);

  return (
    <article
      data-testid="kds-comanda"
      data-comanda-id={c.id}
      data-urgente={c.urgent ? "1" : "0"}
      data-nueva={c.isNew ? "1" : "0"}
      data-tono={tono}
      className={`overflow-hidden flex flex-col ${parpadeo}`}
      style={{
        // EL CUERPO, NEUTRO. En las cuatro tarjetas de la maqueta.
        background: TARJETA_CUERPO,
        borderRadius: TARJETA_RADIO_PX,
        // El anillo rojo de la tarjeta urgente (decisión 7), que se suma a
        // la franja. Dos señales para lo mismo porque es lo único que
        // cambia el ORDEN del trabajo. Va por `box-shadow` y no por
        // `border` —como en la maqueta— para que no reste ancho al
        // contenido: con cuatro columnas, 8 px de borde serían un nombre
        // de plato partido.
        boxShadow: c.urgent
          ? `0 0 0 ${ANILLO_URGENTE_PX}px ${ROJO_URGENTE}`
          : undefined,
      }}
    >
      {/* 1 · URGENTE */}
      {c.urgent && (
        <div
          data-testid="kds-franja-urgente"
          className="shrink-0 flex items-center justify-center gap-[10px] font-extrabold"
          style={{
            height: FRANJA_URGENTE_ALTO_PX,
            background: ROJO_URGENTE,
            color: ROJO_URGENTE_TEXT,
            fontSize: URGENTE_PX,
            letterSpacing: "0.12em",
          }}
        >
          <IconoUrgente />
          URGENTE
        </div>
      )}

      {/* 2 · la cabecera del semáforo, con el eyebrow DENTRO */}
      <button
        type="button"
        data-testid="kds-cabecera"
        onPointerDown={empezarToqueLargo}
        onPointerUp={cancelarToqueLargo}
        onPointerLeave={cancelarToqueLargo}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full text-left shrink-0 flex items-center justify-between gap-2"
        style={{
          background: SEMAFORO_FILL[tono],
          color: SEMAFORO_TEXT[tono],
          padding: "10px 14px",
        }}
      >
        <span className="flex flex-col min-w-0">
          <span
            className="font-bold leading-none"
            style={{ fontSize: MESA_PX, letterSpacing: "-0.02em" }}
          >
            {c.tableName ?? `#${c.number}`}
          </span>
          {eyebrow.length > 0 && (
            <span
              data-testid="kds-numero"
              className="uppercase font-bold flex gap-2"
              style={{
                fontSize: EYEBROW_COCINA_PX,
                letterSpacing: EYEBROW_COCINA_TRACKING,
                marginTop: 2,
              }}
            >
              {eyebrow.map((e) => (
                <span key={e} data-testid={e === "LLEGÓ TARDE" ? "kds-tarde" : undefined}>
                  {e}
                </span>
              ))}
            </span>
          )}
        </span>
        <span
          data-testid="kds-minutos"
          className="font-bold leading-none shrink-0 tabular-nums"
          style={{ fontSize: minutos == null ? ALERGIA_PX : MINUTOS_PX }}
        >
          {etiquetaMinutos(minutos)}
        </span>
      </button>

      {/* 3 · la alergia de la mesa: franja ROJA de ancho completo */}
      {c.allergyBands.map((banda) => (
        <div
          key={banda.titulo}
          data-testid="kds-franja-alergia"
          className="shrink-0 flex items-center gap-[10px]"
          style={{
            background: ROJO_ALERGIA,
            color: ROJO_ALERGIA_TEXT,
            padding: "10px 14px",
          }}
        >
          <IconoAlergia />
          <span className="flex flex-col min-w-0">
            <span
              data-testid="kds-franja-alergia-titulo"
              className="font-bold"
              style={{ fontSize: ALERGIA_PX, lineHeight: 1.1 }}
            >
              {banda.titulo}
            </span>
            <span
              data-testid="kds-franja-alergia-alergeno"
              className="font-semibold"
              style={{ fontSize: ALERGIA_ALERGENO_PX, opacity: 0.9 }}
            >
              {banda.alergenos}
            </span>
          </span>
        </div>
      ))}

      {/* 4 · los platos marchados */}
      <ul className="flex flex-col gap-[6px]" style={{ padding: "10px 0" }}>
        {marchados.map((l) => (
          <Linea
            key={l.id}
            linea={l}
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
            className="uppercase font-bold"
            style={{
              margin: "0 14px",
              paddingTop: 8,
              borderTop: `2px dashed ${DARK_SURFACE_RAISED}`,
              fontSize: EYEBROW_COCINA_PX,
              letterSpacing: EYEBROW_COCINA_TRACKING,
              color: DARK_TEXT_MUTED,
            }}
          >
            EN ESPERA · SALE CUANDO LO MARCHEN
          </div>
          <ul className="flex flex-col gap-[6px]" style={{ padding: "8px 0" }}>
            {enEspera.map((l) => (
              <Linea
                key={l.id}
                linea={l}
                onTachar={props.onTachar}
                onVisto={props.onVisto}
              />
            ))}
          </ul>
        </>
      )}

      {/* 6 · «Lista», NEUTRO: el verde de esta pantalla significa «ya
          está», y éste es el botón que hay que tocar para que lo esté. */}
      {!props.compacta && (
        <button
          type="button"
          data-testid="kds-lista"
          onClick={props.onLista}
          className="mt-auto shrink-0 font-semibold"
          style={{
            margin: "0 14px 14px",
            borderRadius: 12,
            height: LISTA_HEIGHT_PX,
            minHeight: LISTA_HEIGHT_PX,
            background: LISTA_FONDO,
            color: LISTA_TEXTO,
            fontSize: LISTA_LABEL_PX,
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
  onTachar: (lineId: string, done: boolean) => void;
  onVisto: (lineId: string) => void;
}) {
  const l = props.linea;
  const anuladaDelTodo = l.units <= 0;

  // ── LAS TRES FORMAS QUE PUEDE TOMAR UNA LÍNEA ──────────────────────
  //
  // Y las tres salen de la maqueta:
  //
  //   · RECUADRO ROJO (borde `#FF5A6E`) con la sub-franja «SILLA 3 · SIN
  //     GLUTEN»: el plato de una silla con alergia. El cuerpo sigue
  //     neutro — lo que es rojo es el marco y la etiqueta.
  //   · CAJA ROJA ENTERA que parpadea, con «SILLA 3 · ¡LLEVA GLUTEN!»:
  //     el plato que lleva el alérgeno de su silla, o la línea anulada
  //     sin «Visto». Aquí sí es roja entera: es lo único que no puede
  //     esperar.
  //   · PLANA: todo lo demás.
  const alarma = l.allergyWarning != null || l.voidPending;
  const recuadrada = !alarma && l.seat != null;
  const enCaja = alarma || recuadrada;

  /** La sub-franja del recuadro. `null` si la línea no lleva recuadro. */
  const subFranja = l.allergyWarning
    ? [l.seat != null ? `SILLA ${l.seat}` : null, l.allergyWarning]
        .filter(Boolean)
        .join(" · ")
    : recuadrada
      ? [`SILLA ${l.seat}`, l.seatAllergy].filter(Boolean).join(" · ")
      : null;

  return (
    <li
      data-testid="kds-linea"
      data-linea-id={l.id}
      data-hecha={l.done ? "1" : "0"}
      data-espera={l.fired ? "0" : "1"}
      data-alarma={alarma ? "1" : "0"}
      className={alarma ? PULSO_CLASS_ROJO : l.changePending ? PULSO_CLASS_AMBAR : ""}
      style={{
        margin: enCaja ? "0 10px" : undefined,
        borderRadius: enCaja ? 12 : undefined,
        overflow: enCaja ? "hidden" : undefined,
        border: recuadrada ? `2px solid ${ROJO_ALERGIA_BORDE}` : undefined,
        background: alarma ? ROJO_ALERGIA : undefined,
        color: alarma ? ROJO_ALERGIA_TEXT : l.fired ? DARK_TEXT : DARK_TEXT_MUTED,
        // Un plato TACHADO se apaga, no cambia de fondo: la tarjeta tiene
        // que seguir diciendo lo que se pidió (decisión 4).
        opacity: l.done && !alarma ? 0.42 : 1,
      }}
    >
      {subFranja && (
        <div
          data-testid={l.allergyWarning && l.seat == null ? "kds-lleva" : "kds-silla"}
          className="font-bold uppercase"
          style={{
            padding: "4px 10px",
            background: l.allergyWarning ? ROJO_ALERGIA_FONDO : ROJO_ALERGIA,
            color: ROJO_ALERGIA_TEXT,
            fontSize: l.allergyWarning ? LLEVA_PX : SILLA_PX,
            letterSpacing: "0.06em",
          }}
        >
          {subFranja}
        </div>
      )}

      {/* LA FILA. El `<button>` de tachar NO envuelve al «Visto»: un
          botón dentro de otro no es HTML válido, y además la línea
          anulada del todo tiene el de fuera `disabled` —con el «Visto»
          dentro, el cocinero no podría quitar el aviso nunca—. */}
      <div
        className="flex items-stretch"
        style={{ paddingLeft: enCaja ? 10 : 14, paddingRight: enCaja ? 10 : 14 }}
      >
        <button
          type="button"
          // Un toque tacha el plato; otro lo destacha. EN ESPERA no se
          // puede tachar: todavía no se está cocinando.
          disabled={!l.fired || anuladaDelTodo}
          onClick={() => props.onTachar(l.id, !l.done)}
          className="flex-grow min-w-0 text-left flex items-center gap-[10px]"
          // EL RELLENO VA DENTRO DEL BOTÓN, no en la fila que lo envuelve.
          // Puesto fuera, los 8 + 8 de la maqueta se SUMABAN a los 56 px
          // de objetivo táctil y cada plato medía 72 en vez de 56: tres
          // platos por tarjeta son 48 px, que es lo que cuesta la segunda
          // fila de tarjetas. Con `box-sizing: border-box` el relleno vive
          // dentro del mínimo y un plato de una línea mide 56 justos, que
          // es lo que la maqueta aparenta.
          style={{ minHeight: LINEA_HEIGHT_PX, padding: "8px 0" }}
        >
          <span
            className="shrink-0 font-bold"
            style={{
              width: CANTIDAD_ANCHO_PX,
              fontSize: CANTIDAD_PX,
              lineHeight: 1.1,
              textDecoration: l.done || anuladaDelTodo ? "line-through" : "none",
            }}
          >
            {formatearUnidades(l.units)}
          </span>
          <span className="flex flex-col min-w-0 flex-grow">
            {/* EL NOMBRE SE PARTE EN DOS LÍNEAS, NO SE CORTA. Con cuatro
                columnas la tarjeta mide ~251 px y «Hamburguesa especial»
                no cabe en una línea; truncarlo escondería lo primero que
                la decisión 3 manda que se lea. */}
            <span
              data-testid="kds-plato"
              className="font-semibold"
              style={{
                fontSize: PLATO_PX,
                lineHeight: 1.2,
                textDecoration: l.done || anuladaDelTodo ? "line-through" : "none",
              }}
            >
              {l.name}
            </span>

            {/* Modificadores y notas, BIEN VISIBLES (decisión 3): ámbar,
                17 px y peso 600, con «— » delante. En gris y pequeños eran
                una etiqueta de sistema, y el cocinero que no lee «sin
                limón» lo pone. */}
            {l.notes.map((n, i) => (
              <span
                key={`${l.id}-n${i}`}
                data-testid="kds-nota"
                style={{
                  fontSize: NOTA_PX,
                  fontWeight: NOTA_WEIGHT,
                  color: alarma ? ROJO_ALERGIA_TEXT : AMBAR_NOTA,
                  marginTop: 2,
                }}
              >
                {NOTA_PREFIJO}
                {n}
              </span>
            ))}

            {/* Decisión 6 · el anulado y el cambio. No desaparecen hasta
                que el cocinero toca «Visto». */}
            {l.voidPending && (
              <span
                data-testid="kds-anulado"
                className="font-bold uppercase"
                style={{ fontSize: ANULADO_PX, letterSpacing: "0.06em", marginTop: 2 }}
              >
                {anuladaDelTodo
                  ? "ANULADO"
                  : `ERAN ${formatearUnidades(l.unitsOriginal ?? l.units)} · −${formatearUnidades(l.voidedUnits)}`}
                {l.doneBeforeVoid ? " · YA ESTABA HECHO" : ""}
              </span>
            )}
            {!l.voidPending && l.changePending && (
              <span
                data-testid="kds-cambio"
                className="font-bold self-start rounded-[6px] px-2"
                style={{
                  fontSize: ANULADO_PX,
                  background: AMBAR_CAMBIO,
                  color: AMBAR_CAMBIO_TEXT,
                  marginTop: 2,
                }}
              >
                CAMBIO{l.changeNote ? ` · ${l.changeNote}` : ""}
              </span>
            )}

            {/* Capa 3 informativa · una pastilla con contorno, sin fondo
                rojo y sin parpadeo: es un aviso, no una alarma, y la regla
                del rojo dice que el rojo es para lo que no puede
                esperar. */}
            {l.allergyWarning == null && l.carries.length > 0 && (
              <span
                data-testid="kds-carries"
                className="flex flex-wrap gap-1"
                style={{ marginTop: 4 }}
              >
                {l.carries.map((a) => (
                  <span
                    key={a}
                    className="font-bold"
                    style={{
                      padding: "2px 8px",
                      borderRadius: 6,
                      border: `1.5px solid ${ROJO_ANULADO}`,
                      color: ROJO_ANULADO,
                      fontSize: CARRIES_PX,
                    }}
                  >
                    {a}
                  </span>
                ))}
              </span>
            )}
          </span>
        </button>

        {/* «Visto» · 44 px, la única excepción de la restricción táctil, y
            acotada: vive DENTRO de una línea que ya es de 56. En claro,
            como en la maqueta: sobre la caja roja de un anulado, un botón
            gris no se ve. */}
        {(l.voidPending || l.changePending) && (
          <button
            type="button"
            data-testid="kds-visto"
            onClick={() => props.onVisto(l.id)}
            className="shrink-0 self-center ml-[10px] rounded-[10px] px-3 font-bold"
            style={{
              height: VISTO_HEIGHT_PX,
              minHeight: VISTO_HEIGHT_PX,
              background: DARK_TEXT,
              color: DARK_CANVAS,
              fontSize: ANULADO_PX,
            }}
          >
            Visto
          </button>
        )}
      </div>
    </li>
  );
}

/** «2» · «0,5». Nunca «2.000». */
function formatearUnidades(u: number): string {
  if (Number.isInteger(u)) return String(u);
  return u.toFixed(2).replace(".", ",").replace(/,?0+$/, "");
}
