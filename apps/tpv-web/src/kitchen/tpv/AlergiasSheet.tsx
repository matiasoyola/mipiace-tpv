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
// ── EL ROJO ES LA ALERGIA, EL ANILLO ES LO QUE EDITAS (kds-1c) ───────
//
// Dos cosas distintas que la primera captura pintaba igual: salían en rojo
// a la vez «TODA LA MESA» y la silla 3, y la derecha decía «Toda la mesa»
// sin ningún alérgeno marcado. No se sabía qué se estaba editando.
//
//   · **ROJO = TIENE ALERGIA.** Y sólo eso. Es el mismo rojo de la franja
//     de la comanda (`ROJO_ALERGIA`), así que tiene que querer decir lo
//     mismo en las dos pantallas: aquí hay un alérgeno declarado.
//   · **ANILLO BLANCO = ES LO QUE ESTÁS EDITANDO.** No cambia el color,
//     porque lo seleccionado no es una alergia. Blanco y no coral: el
//     coral es de «Cobrar» (principio de venta bajo estrés, regla 1), y
//     sobre una silla ya roja un anillo coral no se distinguía del relleno.
//   · Y la hoja **abre en la primera silla con alergia**, o en «toda la
//     mesa» si no hay ninguna: lo que el camarero viene a mirar casi
//     siempre es lo que ya está declarado.
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

import {
  ALERGENOS,
  LISTA_ALERGENOS,
  nombreCortoDeAlergeno,
  type Alergeno,
} from "@mipiacetpv/ticket-model";

import {
  DARK_CANVAS,
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

/**
 * **EL ANILLO DE LO QUE ESTÁS EDITANDO.** Blanco, 3 px.
 *
 * Una sola constante para la silla y para «toda la mesa»: son la misma
 * cosa —lo que la rejilla de la derecha está editando— y tienen que
 * señalarse igual. Si cada una pusiera su propio contorno, mañana una de
 * las dos se quedaría sin él en un cambio de color.
 */
const ANILLO_ELEGIDA = "3px solid #FFFFFF";

export function AlergiasSheet(props: AlergiasSheetProps) {
  const sillas = Math.min(
    SILLAS_MAX,
    Math.max(1, props.diners ?? SILLAS_POR_DEFECTO),
  );
  // Abre en lo que ya hay declarado (kds-1c). `useState(() => …)` y no un
  // efecto: lo seleccionado al abrir no «cambia» después de pintar, y un
  // efecto haría un primer pintado con «Toda la mesa» y otro con «Silla 3»
  // —el parpadeo que la captura enseñaba al revés—.
  const [seat, setSeat] = useState<number | null>(() =>
    primeraSillaConAlergia(props.inicial),
  );
  const [alergias, setAlergias] = useState<AlergiaDeclarada[]>(props.inicial);
  const [guardando, setGuardando] = useState(false);

  const deEstaSilla = useMemo(
    () =>
      new Set(
        alergias.filter((a) => (a.seat ?? null) === seat).map((a) => a.allergen),
      ),
    [alergias, seat],
  );

  // Los alérgenos de cada silla, no sólo cuántos: la maqueta escribe
  // «gluten» debajo del número, y lo que el camarero necesita leer de un
  // golpe es QUÉ, no cuántos.
  const porSilla = useMemo(() => {
    const m = new Map<number | null, string[]>();
    for (const a of alergias) {
      const k = a.seat ?? null;
      m.set(k, [...(m.get(k) ?? []), a.allergen]);
    }
    return m;
  }, [alergias]);

  /** Los de «toda la mesa», que es lo que decide SU color. */
  const deLaMesa = porSilla.get(null) ?? [];

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
            // EN CLARO, como el «Listo» de la maqueta, y no en coral: el
            // coral es de «Cobrar» (principio de venta bajo estrés, regla
            // 1). Guardar una alergia no cobra nada.
            background: DARK_TEXT,
            color: DARK_CANVAS,
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
          {/* **NEUTRA si no tiene alérgenos** (kds-1c). Antes se pintaba
              roja por estar seleccionada, y en la captura salían rojas a la
              vez «TODA LA MESA» y la silla 3: dos rojos que querían decir
              cosas distintas. El rojo es la alergia; el anillo, lo que
              estás editando. */}
          <button
            type="button"
            data-testid="alergias-toda-la-mesa"
            data-elegida={seat == null ? "1" : "0"}
            data-con-alergia={deLaMesa.length > 0 ? "1" : "0"}
            onClick={() => setSeat(null)}
            className={`rounded-[14px] px-4 font-semibold text-left ${PRESS_FEEDBACK_CLASS}`}
            style={{
              minHeight: MIN_TOUCH_PX,
              background: deLaMesa.length > 0 ? ROJO_ALERGIA : DARK_SURFACE,
              color: deLaMesa.length > 0 ? ROJO_ALERGIA_TEXT : DARK_TEXT,
              fontSize: 19,
              outline: seat == null ? ANILLO_ELEGIDA : "none",
              outlineOffset: 2,
            }}
          >
            TODA LA MESA
            {deLaMesa.length > 0 && ` · ${etiquetaDeAlergenos(deLaMesa)}`}
          </button>

          {/* **LA REFERENCIA DE LA BARRA.**
              Faltaba, y la maqueta la lleva. Es lo que hace que la
              numeración de las sillas sea SIEMPRE LA MISMA: sin un punto
              de partida, el camarero que viene del otro lado de la mesa
              cuenta la silla 1 donde otro contó la 3, y «silla 3 ·
              celíaco» deja de nombrar a nadie. Con la barra como norte, la
              1 es la que la toca y se sigue en el sentido del reloj —que
              es lo que hace `posicionSilla`—. */}
          <span
            data-testid="alergias-referencia"
            className="uppercase font-bold text-center shrink-0"
            style={{
              fontSize: 13,
              letterSpacing: "0.1em",
              color: DARK_TEXT_MUTED,
            }}
          >
            La barra está a este lado
          </span>

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
              const suyos = porSilla.get(n) ?? [];
              const elegida = seat === n;
              const etiqueta = etiquetaDeAlergenos(suyos);
              return (
                <button
                  key={n}
                  type="button"
                  data-testid="alergias-silla"
                  data-silla={n}
                  data-elegida={elegida ? "1" : "0"}
                  data-con-alergia={suyos.length > 0 ? "1" : "0"}
                  onClick={() => setSeat(n)}
                  aria-label={`Silla ${n}${etiqueta ? `, ${etiqueta}` : ""}${
                    elegida ? ", editando" : ""
                  }`}
                  aria-pressed={elegida}
                  className={`absolute font-bold flex flex-col items-center justify-center leading-none ${PRESS_FEEDBACK_CLASS}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: "translate(-50%, -50%)",
                    // Redonda cuando sólo lleva el número, y un rectángulo
                    // redondeado como el de la maqueta cuando lleva el
                    // alérgeno debajo: «gluten» no cabe en 56 px de círculo
                    // y truncarlo dejaría «glu…», que no es un alérgeno.
                    minWidth: MIN_TOUCH_PX,
                    height: MIN_TOUCH_PX,
                    padding: etiqueta ? "0 10px" : 0,
                    borderRadius: etiqueta ? 18 : 999,
                    gap: 2,
                    // **ROJO = TIENE ALERGIA**, no «está seleccionada».
                    background: suyos.length > 0 ? ROJO_ALERGIA : DARK_SURFACE,
                    color: suyos.length > 0 ? ROJO_ALERGIA_TEXT : DARK_TEXT,
                    // El contorno de la silla elegida, BLANCO. En coral
                    // competía con «Cobrar»; y sobre una silla ya roja por
                    // tener alergia, un contorno coral casi no se
                    // distinguía del relleno.
                    outline: elegida ? ANILLO_ELEGIDA : "none",
                    outlineOffset: 2,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{n}</span>
                  {/* «gluten» debajo, como la maqueta. En minúscula: es la
                      palabra, no un grito — el grito es el «¡LLEVA
                      GLUTEN!» de la comanda. */}
                  {etiqueta && (
                    <span
                      data-testid="alergias-silla-alergeno"
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {etiqueta}
                    </span>
                  )}
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
 * **DÓNDE ABRE LA HOJA**: la primera silla con alergia, o «toda la mesa».
 *
 * La primera POR NÚMERO DE SILLA y no por orden de la lista: la lista llega
 * como la devuelva el servidor, y una hoja que abre en la silla 3 unas
 * veces y en la 1 otras, con los mismos datos, es una hoja en la que no se
 * puede confiar. Lo de «toda la mesa» (`seat` null) no cuenta como silla:
 * es el destino cuando no hay ninguna.
 */
export function primeraSillaConAlergia(
  alergias: readonly AlergiaDeclarada[],
): number | null {
  const sillas = alergias
    .map((a) => a.seat)
    .filter((s): s is number => s != null);
  return sillas.length === 0 ? null : Math.min(...sillas);
}

/**
 * «gluten», «gluten +2». Lo que va debajo del número de la silla.
 *
 * En minúscula porque es la palabra y no un grito: el grito es el «¡LLEVA
 * GLUTEN!» de la comanda, y gritar aquí también le quitaría fuerza allí.
 *
 * Con más de uno se escribe el primero y se cuentan los demás: dos nombres
 * seguidos no caben bajo un número, y el camarero que necesita el detalle
 * toca la silla y lo ve marcado en la rejilla de los 14.
 */
export function etiquetaDeAlergenos(alergenos: readonly string[]): string {
  if (alergenos.length === 0) return "";
  const primero = nombreDeAlergeno(alergenos[0]!);
  return alergenos.length === 1 ? primero : `${primero} +${alergenos.length - 1}`;
}

/**
 * «gluten» a partir del código `GLUTEN`.
 *
 * Un código que no esté en los catorce se escribe tal cual en minúscula en
 * vez de desaparecer: un alérgeno guardado que la pantalla no reconoce
 * sigue siendo una alergia, y callarlo es el único fallo que esta hoja no
 * puede tener.
 */
function nombreDeAlergeno(codigo: string): string {
  const conocido = codigo in ALERGENOS;
  const nombre = conocido ? nombreCortoDeAlergeno(codigo as Alergeno) : codigo;
  return nombre.toLocaleLowerCase("es-ES");
}

/**
 * Dónde va la silla `n` de `total` alrededor del tablero, en porcentaje del
 * contenedor.
 *
 * Repartidas en círculo y empezando ARRIBA (−90°), que en el dibujo es **el
 * lado de la barra** —lo dice la etiqueta de encima del tablero—. Ésa es la
 * referencia que hace que la silla 3 sea la misma silla para los dos
 * camareros del turno: sin punto de partida, el que viene del otro lado de
 * la mesa cuenta la 1 donde el otro contó la 3. Vale igual para la
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
