// B-reservas-9 · Panel de salud de la agenda.
//
// La pantalla que habría ahorrado dos semanas. Seis tarjetas, y ni una
// cifra sin la consulta que la produce al lado (ADR-F3): cada tarjeta trae
// un «Cómo se calcula esto» que enseña la explicación en lenguaje llano Y
// la consulta literal que el servidor ha ejecutado. Una cifra que no se
// puede explicar acaba apagada por desconfianza.
//
// Reglas de acabado que se saldan aquí (§H7 del cruce):
//   · carga = ESQUELETO, no spinner (la estructura ya informa);
//   · error de red = la última foto CON SU HORA + reintentar;
//   · vacío informativo: «0 servicios sin nadie» es una buena noticia y se
//     dice con palabras, no se deja en blanco;
//   · sin tooltips ni hover como única vía, targets ≥ 44 px, `tabular-nums`,
//     sin emojis, iconografía Lucide.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Hourglass,
  RefreshCw,
  Wrench,
} from "lucide-react";

import {
  CARD_SIN_PROFESIONAL,
  fetchAgendaHealth,
  fotoHora,
  readHealthSnapshot,
  unidad,
  type AgendaHealth,
  type HealthCard,
} from "../lib/agenda-health.js";

export function AgendaHealthPanel(props: {
  onClose: () => void;
  /** A la matriz, opcionalmente con el servicio que hay que arreglar. */
  onOpenMatrix: (focusServiceId: string | null) => void;
}) {
  const { onClose, onOpenMatrix } = props;
  // La última foto se lee ANTES del primer fetch: si no hay red, la
  // pantalla abre con datos de antes en vez de con un error a secas.
  const [snapshot, setSnapshot] = useState(() => readHealthSnapshot());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setSnapshot(await fetchAgendaHealth());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const health: AgendaHealth | null = snapshot?.health ?? null;
  const hero = health?.cards.find((c) => c.key === CARD_SIN_PROFESIONAL) ?? null;
  const resto = health?.cards.filter((c) => c.key !== CARD_SIN_PROFESIONAL) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-mipiace-stone flex flex-col font-sans">
      <div className="flex items-center gap-2 px-3 md:px-6 h-16 bg-white border-b border-slate-200 shrink-0">
        <button
          onClick={onClose}
          className="h-11 w-11 shrink-0 rounded-2xl hover:bg-slate-100 flex items-center justify-center text-mipiace-ink"
          aria-label="Volver a la agenda"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2.25} />
        </button>
        <h1 className="text-[17px] font-semibold text-mipiace-ink truncate">
          Salud de la agenda
        </h1>
        <div className="flex-1" />
        <button
          onClick={() => void load()}
          disabled={loading}
          className="h-11 px-3 shrink-0 rounded-2xl bg-mipiace-stone hover:bg-slate-200 text-[13px] font-medium text-mipiace-ink flex items-center gap-2 disabled:opacity-60"
        >
          {/* El icono gira SÓLO cuando se relee algo que ya está en
              pantalla. La primera carga es esqueleto, y un spinner al lado
              la convertiría en media regla. */}
          <RefreshCw
            className={`w-4 h-4 ${loading && snapshot ? "animate-spin" : ""}`}
            strokeWidth={2.25}
          />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-4">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          {/* El error NO vacía la pantalla: dice de cuándo es lo que se ve. */}
          {error && (
            <div
              data-test="salud-error"
              className="rounded-2xl bg-amber-50 border border-amber-200 p-3 flex flex-wrap items-center gap-3"
            >
              <span className="text-[13.5px] text-amber-900">
                {snapshot
                  ? `Sin respuesta del servidor. Esto es la foto de las ${fotoHora(
                      snapshot.fetchedAt,
                    )}.`
                  : "Sin respuesta del servidor y no hay ninguna foto guardada."}
              </span>
              <button
                onClick={() => void load()}
                className="h-11 px-4 rounded-2xl bg-white border border-amber-200 hover:bg-amber-100 text-[13px] font-medium text-amber-900"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Carga: esqueleto. La estructura ya dice qué va a salir. */}
          {loading && !health ? (
            <Esqueleto />
          ) : !health ? (
            <p className="text-[14px] text-slate-500 py-10 text-center">
              No hay nada que enseñar todavía.
            </p>
          ) : (
            <>
              {hero && (
                <TarjetaHero
                  card={hero}
                  onArreglar={(serviceId) => onOpenMatrix(serviceId)}
                />
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {resto.map((card) => (
                  <Tarjeta key={card.key} card={card} />
                ))}
              </div>
              <p className="text-[12px] text-slate-500 pt-1 pb-6">
                Datos del {fotoHora(health.generatedAt)}
                {snapshot ? ` · última lectura ${fotoHora(snapshot.fetchedAt)}` : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── La tarjeta nº 1, en grande ────────────────────────────────────────
//
// Es el fallo que costó dos semanas, así que no comparte rejilla con las
// demás: ocupa el ancho, la cifra es lo primero que se lee y la acción
// («Arreglarlo») está a un dedo, dentro del flujo, no en una barra flotante.

function TarjetaHero(props: {
  card: HealthCard;
  onArreglar: (serviceId: string | null) => void;
}) {
  const { card, onArreglar } = props;
  const alarma = card.status === "ok" && (card.value ?? 0) > 0;
  return (
    <section
      data-test="tarjeta-servicios-sin-profesional"
      className={`rounded-2xl border p-4 md:p-5 ${
        alarma
          ? "bg-mipiace-coral-soft border-mipiace-coral"
          : "bg-white border-slate-200"
      }`}
    >
      <h2 className="text-[14px] font-semibold text-mipiace-ink">
        {card.title}
      </h2>
      {card.status === "unavailable" ? (
        <NoDisponible card={card} />
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              data-test="cifra"
              className={`text-[56px] leading-none font-semibold tabular-nums ${
                alarma ? "text-mipiace-coral-dark" : "text-mipiace-ink"
              }`}
            >
              {card.value}
            </span>
            <span className="text-[14px] text-slate-600">{unidad(card)}</span>
          </div>
          {alarma ? (
            <>
              <p className="text-[13.5px] text-mipiace-ink mt-2">
                Estos servicios no ofrecen ni un hueco, y hasta ahora lo hacían
                sin decirlo.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {card.items.map((it) => (
                  <li key={it.id}>
                    <button
                      onClick={() => onArreglar(it.id)}
                      className="w-full min-h-touch px-3 py-2 rounded-xl bg-white border border-mipiace-coral/40 hover:bg-white/70 text-left flex items-center gap-3"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium text-mipiace-ink truncate">
                          {it.label}
                        </span>
                        {it.detail && (
                          <span className="block text-[12.5px] text-slate-600">
                            {it.detail}
                          </span>
                        )}
                      </span>
                      <ArrowRight
                        className="w-4 h-4 shrink-0 text-mipiace-coral-dark"
                        strokeWidth={2.25}
                      />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => onArreglar(null)}
                className="mt-3 w-full sm:w-auto min-h-touch-pad px-4 rounded-2xl bg-mipiace-coral hover:bg-mipiace-coral-dark text-white text-[14px] font-medium flex items-center justify-center gap-2"
              >
                <Wrench className="w-[18px] h-[18px]" strokeWidth={2.25} />
                Arreglarlo en la matriz
              </button>
            </>
          ) : (
            <p
              data-test="buena-noticia"
              className="text-[13.5px] text-emerald-700 mt-2"
            >
              {card.goodNews}
            </p>
          )}
        </>
      )}
      <ComoSeCalcula card={card} />
    </section>
  );
}

// ── Las otras cinco ───────────────────────────────────────────────────

function Tarjeta(props: { card: HealthCard }) {
  const { card } = props;
  return (
    <section
      data-test={`tarjeta-${card.key}`}
      className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col"
    >
      <h2 className="text-[14px] font-semibold text-mipiace-ink">
        {card.title}
      </h2>
      {card.status === "unavailable" ? (
        <NoDisponible card={card} />
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              data-test="cifra"
              className="text-[36px] leading-none font-semibold tabular-nums text-mipiace-ink"
            >
              {card.value}
            </span>
            <span className="text-[13px] text-slate-600">{unidad(card)}</span>
          </div>
          {card.value === 0 ? (
            <p
              data-test="buena-noticia"
              className="text-[13px] text-emerald-700 mt-2"
            >
              {card.goodNews}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {/* El nombre en su línea y el dato que desambigua debajo: en
                  una sola fila, a 320 px, el nombre se truncaba a nada y lo
                  que sobrevivía era el detalle — justo al revés. */}
              {card.items.map((it) => (
                <li key={it.id} className="text-[13px]">
                  <span className="block text-mipiace-ink">{it.label}</span>
                  {it.detail && (
                    <span className="block text-[12.5px] text-slate-600">
                      {it.detail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ComoSeCalcula card={card} />
    </section>
  );
}

/**
 * Una tarjeta cuya dependencia no está NO enseña un cero: un cero parece un
 * dato bueno y éste sería mentira. Enseña de qué depende y por qué.
 */
function NoDisponible(props: { card: HealthCard }) {
  const { card } = props;
  return (
    <div data-test="no-disponible" className="mt-2 flex items-start gap-2">
      <Hourglass
        className="w-4 h-4 mt-0.5 shrink-0 text-slate-400"
        strokeWidth={2.25}
      />
      <div>
        <p className="text-[13.5px] font-medium text-slate-600">
          Todavía no se puede calcular
        </p>
        {card.unavailableReason && (
          <p className="text-[13px] text-slate-500 mt-0.5">
            {card.unavailableReason}
          </p>
        )}
        {card.dependsOn && (
          <p data-test="depende-de" className="text-[13px] text-slate-500 mt-0.5">
            Depende de {card.dependsOn.block}: {card.dependsOn.what}.
          </p>
        )}
      </div>
    </div>
  );
}

// ── El desplegable que sostiene el bloque entero ──────────────────────
//
// No es un tooltip ni un hover: es un botón de 44 px que se toca con el
// dedo en la tablet del mostrador. Dentro va la explicación llana y la
// consulta LITERAL que ha corrido el servidor.

function ComoSeCalcula(props: { card: HealthCard }) {
  const { card } = props;
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full min-h-touch px-2 -mx-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2 text-left"
      >
        <span className="text-[13px] font-medium text-slate-600">
          Cómo se calcula esto
        </span>
        {abierto ? (
          <ChevronUp className="w-4 h-4 text-slate-500" strokeWidth={2.25} />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" strokeWidth={2.25} />
        )}
      </button>
      {abierto && (
        <div data-test="explicacion" className="mt-2 flex flex-col gap-2">
          <p className="text-[13px] text-slate-700">{card.explain}</p>
          <ul className="text-[12.5px] text-slate-500 flex flex-col gap-0.5">
            {card.params.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <pre className="text-[11.5px] leading-[1.45] text-slate-700 bg-mipiace-stone rounded-xl p-3 overflow-x-auto whitespace-pre">
            {card.query}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── El esqueleto ──────────────────────────────────────────────────────

function Esqueleto() {
  return (
    <div data-test="esqueleto" className="flex flex-col gap-3" aria-hidden>
      <div className="rounded-2xl bg-white border border-slate-200 p-4 md:p-5">
        <div className="h-4 w-56 max-w-full rounded bg-slate-200 animate-pulse" />
        <div className="h-12 w-24 rounded bg-slate-200 animate-pulse mt-3" />
        <div className="h-3 w-full rounded bg-slate-100 animate-pulse mt-4" />
        <div className="h-3 w-2/3 rounded bg-slate-100 animate-pulse mt-2" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-white border border-slate-200 p-4"
          >
            <div className="h-4 w-40 max-w-full rounded bg-slate-200 animate-pulse" />
            <div className="h-8 w-16 rounded bg-slate-200 animate-pulse mt-3" />
            <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse mt-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
