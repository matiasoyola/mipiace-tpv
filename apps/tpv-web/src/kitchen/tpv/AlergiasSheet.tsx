// kds-1-cocina · LA HOJA DE ALERGIAS, decisión 3 capa 1.
//
// Lo que Matías pidió, literal: «si la mesa tiene un comensal celíaco, que
// venga en grande en la comanda», y luego «iría un paso más allá, que se
// pueda marcar en qué silla está el celíaco».
//
// Dos o tres toques en total, que es el presupuesto:
//
//   1. toque en la silla (o en «TODA LA MESA»);
//   2. toque en el alérgeno, de la rejilla de los 14;
//   3. «Guardar».
//
// ── POR QUÉ UN DIBUJO DE LA MESA Y NO UNA LISTA ───────────────────────
//
// Porque el camarero no sabe «el comensal 3»: sabe «el señor de la
// izquierda, el que mira a la barra». El dibujo con las sillas numeradas
// alrededor le deja traducir lo que ve en la mesa a un número sin pensar.
// Una lista «Comensal 1 · Comensal 2 · Comensal 3» le obliga a contar.
//
// La numeración la pone cada local por costumbre (p. ej. la silla 1 es la
// que mira a la barra, y luego en el sentido de las agujas del reloj). Es
// formación del camarero, no código: aquí sólo se ven numeradas.
//
// ── PRIVACIDAD, QUE ES PARTE DEL DISEÑO ───────────────────────────────
//
// **No hay ningún sitio donde escribir un nombre.** La alergia vive en la
// silla de ESTE servicio y se va con el ticket; no se guarda en ningún
// cliente. No es un dato de salud de una persona identificada: es «en la
// silla 3 de esta comida no puede entrar gluten». Lo garantiza el esquema
// (`TicketAllergy` cuelga del ticket, sin clave hacia `Client`), y esta
// pantalla no ofrece la tentación.

import { useMemo, useState } from "react";

import { ALERGENOS, LISTA_ALERGENOS, type Alergeno } from "@mipiacetpv/ticket-model";

import {
  CORAL,
  DARK_CANVAS,
  DARK_ON_CORAL,
  DARK_PANEL,
  DARK_SURFACE,
  DARK_SURFACE_RAISED,
  DARK_TEXT,
  DARK_TEXT_MUTED,
  MIN_TOUCH_PX,
  PRESS_FEEDBACK_CLASS,
} from "../../lib/hospitalityTheme.js";
import { ROJO_ALERGIA, ROJO_ALERGIA_TEXT } from "../../lib/kitchenTheme.js";

export interface AlergiaDeclarada {
  /** `null` = toda la mesa. */
  seat: number | null;
  allergen: string;
}

export interface AlergiasSheetProps {
  /** Comensales de la mesa (`Ticket.diners`). De aquí salen las sillas. */
  diners: number | null;
  /** La forma de la mesa en la sala, para que el dibujo se reconozca. */
  shape: "redonda" | "rectangular";
  tableName: string;
  inicial: AlergiaDeclarada[];
  onCerrar: () => void;
  onGuardar: (alergias: AlergiaDeclarada[]) => Promise<void>;
}

/**
 * Cuántas sillas se dibujan cuando la mesa no dice comensales.
 *
 * Cuatro y no cero: una mesa sin comensales apuntados es lo normal en un
 * bar (el camarero abre la mesa y empieza a comandar), y una hoja de
 * alergias sin sillas sólo dejaría marcar «toda la mesa» — que es perder
 * la mitad del bloque por un campo que nadie rellenó. Con cuatro sillas el
 * camarero puede señalar la del celíaco; si la mesa es de seis, apunta los
 * comensales y vuelven a salir seis.
 */
const SILLAS_POR_DEFECTO = 4;

/** Tope de sillas que se dibujan. Por encima, el dibujo deja de leerse. */
const SILLAS_MAX = 12;

export function AlergiasSheet(props: AlergiasSheetProps) {
  const sillas = Math.min(
    SILLAS_MAX,
    Math.max(1, props.diners ?? SILLAS_POR_DEFECTO),
  );
  // `null` = la pestaña «TODA LA MESA», que es donde abre: es lo que se
  // marca cuando no se sabe quién es, y es el caso rápido.
  const [seat, setSeat] = useState<number | null>(null);
  const [alergias, setAlergias] = useState<AlergiaDeclarada[]>(props.inicial);
  const [guardando, setGuardando] = useState(false);

  const deEstaSilla = useMemo(
    () =>
      new Set(
        alergias.filter((a) => (a.seat ?? null) === seat).map((a) => a.allergen),
      ),
    [alergias, seat],
  );

  const cuantasPorSilla = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const a of alergias) {
      const k = a.seat ?? null;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [alergias]);

  const alternar = (allergen: Alergeno) => {
    setAlergias((prev) => {
      const existe = prev.some(
        (a) => (a.seat ?? null) === seat && a.allergen === allergen,
      );
      if (existe) {
        return prev.filter(
          (a) => !((a.seat ?? null) === seat && a.allergen === allergen),
        );
      }
      return [...prev, { seat, allergen }];
    });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await props.onGuardar(alergias);
      props.onCerrar();
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      data-testid="alergias-sheet"
      data-theme="dark"
      className="fixed inset-0 z-40 flex flex-col font-sans"
      style={{ background: DARK_CANVAS, color: DARK_TEXT }}
    >
      <header
        className="shrink-0 flex items-center gap-3 px-5 h-[72px] border-b"
        style={{ borderColor: DARK_SURFACE_RAISED }}
      >
        <h2 className="font-semibold" style={{ fontSize: 26 }}>
          Alergias · {props.tableName}
        </h2>
        <button
          type="button"
          data-testid="alergias-cerrar"
          onClick={props.onCerrar}
          className={`ml-auto rounded-[14px] px-6 font-semibold ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: MIN_TOUCH_PX,
            background: DARK_SURFACE_RAISED,
            color: DARK_TEXT,
            fontSize: 18,
          }}
        >
          Cancelar
        </button>
        <button
          type="button"
          data-testid="alergias-guardar"
          onClick={() => void guardar()}
          disabled={guardando}
          className={`rounded-[14px] px-8 font-semibold disabled:opacity-40 ${PRESS_FEEDBACK_CLASS}`}
          style={{
            minHeight: MIN_TOUCH_PX,
            background: CORAL,
            color: DARK_ON_CORAL,
            fontSize: 18,
          }}
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* ── El dibujo de la mesa con sus sillas ──────────────────── */}
        <div
          data-testid="alergias-mesa"
          className="shrink-0 lg:w-[420px] p-5 flex flex-col gap-3 border-b lg:border-b-0 lg:border-r"
          style={{ borderColor: DARK_SURFACE_RAISED, background: DARK_PANEL }}
        >
          <button
            type="button"
            data-testid="alergias-toda-la-mesa"
            data-elegida={seat == null ? "1" : "0"}
            onClick={() => setSeat(null)}
            className={`rounded-[14px] px-4 font-semibold text-left ${PRESS_FEEDBACK_CLASS}`}
            style={{
              minHeight: MIN_TOUCH_PX,
              background: seat == null ? ROJO_ALERGIA : DARK_SURFACE,
              color: seat == null ? ROJO_ALERGIA_TEXT : DARK_TEXT,
              fontSize: 19,
            }}
          >
            TODA LA MESA
            {(cuantasPorSilla.get(null) ?? 0) > 0 &&
              ` · ${cuantasPorSilla.get(null)}`}
          </button>

          {/* El tablero. Redondo si la mesa es redonda, para que el dibujo
              se parezca a la mesa que el camarero tiene delante. */}
          <div className="relative flex-1 min-h-[280px] flex items-center justify-center">
            <div
              data-testid="alergias-tablero"
              className={
                props.shape === "redonda" ? "rounded-full" : "rounded-[18px]"
              }
              style={{
                width: "56%",
                height: "52%",
                background: DARK_SURFACE_RAISED,
              }}
            />
            {Array.from({ length: sillas }, (_, i) => i + 1).map((n) => {
              const pos = posicionSilla(n, sillas);
              const cuantas = cuantasPorSilla.get(n) ?? 0;
              const elegida = seat === n;
              return (
                <button
                  key={n}
                  type="button"
                  data-testid="alergias-silla"
                  data-silla={n}
                  data-elegida={elegida ? "1" : "0"}
                  data-con-alergia={cuantas > 0 ? "1" : "0"}
                  onClick={() => setSeat(n)}
                  aria-label={`Silla ${n}${cuantas > 0 ? `, ${cuantas} alergias` : ""}`}
                  className={`absolute rounded-full font-bold flex items-center justify-center ${PRESS_FEEDBACK_CLASS}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: MIN_TOUCH_PX,
                    height: MIN_TOUCH_PX,
                    fontSize: 20,
                    background: cuantas > 0 ? ROJO_ALERGIA : DARK_SURFACE,
                    color: cuantas > 0 ? ROJO_ALERGIA_TEXT : DARK_TEXT,
                    outline: elegida ? `3px solid ${CORAL}` : "none",
                    outlineOffset: 2,
                  }}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 14, color: DARK_TEXT_MUTED }}>
            Toca la silla y luego el alérgeno. Si no sabes en qué silla está,
            marca «toda la mesa»: vale igual.
          </p>
        </div>

        {/* ── La rejilla de los 14 ─────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <h3
            className="font-semibold mb-3"
            style={{ fontSize: 20, color: DARK_TEXT }}
          >
            {seat == null ? "Toda la mesa" : `Silla ${seat}`}
          </h3>
          <div
            data-testid="alergias-rejilla"
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
          >
            {LISTA_ALERGENOS.map((a) => {
              const marcado = deEstaSilla.has(a);
              return (
                <button
                  key={a}
                  type="button"
                  data-testid="alergias-opcion"
                  data-alergeno={a}
                  data-marcado={marcado ? "1" : "0"}
                  onClick={() => alternar(a)}
                  className={`rounded-[14px] px-4 text-left font-semibold ${PRESS_FEEDBACK_CLASS}`}
                  style={{
                    minHeight: MIN_TOUCH_PX,
                    background: marcado ? ROJO_ALERGIA : DARK_SURFACE,
                    color: marcado ? ROJO_ALERGIA_TEXT : DARK_TEXT,
                    fontSize: 19,
                  }}
                >
                  <span className="block">{ALERGENOS[a].etiqueta}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Dónde va la silla `n` de `total` alrededor del tablero, en porcentaje del
 * contenedor.
 *
 * Repartidas en círculo y empezando ARRIBA (−90°), que es de donde el
 * camarero empieza a contar cuando mira la mesa de pie. Vale igual para la
 * mesa redonda y para la rectangular: el reparto queda por fuera del
 * tablero en los dos casos, y lo que importa es el ORDEN y la posición
 * relativa, no la geometría exacta de la mesa.
 */
export function posicionSilla(
  n: number,
  total: number,
): { x: number; y: number } {
  const angulo = -Math.PI / 2 + ((n - 1) / total) * 2 * Math.PI;
  return {
    x: 50 + Math.cos(angulo) * 38,
    y: 50 + Math.sin(angulo) * 38,
  };
}
