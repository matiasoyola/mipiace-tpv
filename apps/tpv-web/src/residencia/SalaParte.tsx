// residencia-5 (D-67) · **EL PARTE, EN LA PANTALLA DE LA SALA.**
//
// Lo que el turno que entra lee de pie, a un metro de la tablet, con seis
// personas alrededor. De ahí las tres decisiones de esta pantalla:
//
//   1. **Lectura cómoda a un metro.** Cuerpo de 22 px y títulos de 30-34;
//      la pantalla de la puerta usa 22-52 y es la misma distancia.
//   2. **Por planta y por residente**, en el orden en que el turno los
//      recorre: el número de habitación manda.
//   3. **Lo urgente arriba.** El orden de las líneas lo decide el
//      servidor (`ordenarLineas` en `relevo.ts`) y aquí no se reordena:
//      un N4 de las 09:00 va delante de un «no se hizo» de las 14:00, y
//      que lo decida un solo sitio es lo que hace que la pantalla y el
//      admin pinten lo mismo.
//
// ── «TURNO SIN NOVEDADES» ES UNA PANTALLA, NO UN HUECO ──────────────
//
// Y se confirma igual. El denominador cuenta tanto como lo que pasa
// (D-16): lo que la confirmación demuestra es que alguien del turno que
// entra lo miró, no que no hubiera nada.
//
// ── Y LO QUE LLEGÓ DESPUÉS VA APARTE, CON SU HORA ───────────────────
//
// Arriba y en ámbar, porque es lo que el parte congelado **no** podía
// contar: «pasó a las 14:50, lo supimos a las 15:20». No se mezcla con
// las líneas del parte a propósito — el parte es la evidencia de lo que
// se supo, y mezclarlo borraría la diferencia.

import type {
  AnadidoTardio,
  ConfirmacionDelParte,
  LineaDelParte,
  ParteDeRelevo,
} from "./sala-tipos.js";

/** Cómo se lee cada clase de línea. Espejo de `NOMBRE_DE_LA_CLASE` de la
 *  API; se repite aquí para que la tablet sin red no dependa de nada que
 *  venga del servidor, y un test fija que las dos listas coinciden. */
export const NOMBRE_DE_LA_CLASE: Record<string, string> = {
  INCIDENCIA_NUEVA: "Incidencia nueva",
  INCIDENCIA_ABIERTA: "Sigue abierta de antes",
  ALGO_NO_VA_BIEN: "Algo no va bien",
  CONSTANTE_FUERA_DE_RANGO: "Constante fuera de rango",
  NO_HECHO: "No se hizo",
  CAMBIO_DE_PLAN: "Cambio en el plan de cuidados",
  EXCEPCION_NUEVA: "Umbral propio nuevo",
  REGISTRO_SIN_TURNO: "Registro sin turno",
  AVISO_QUE_NO_SALIO: "Aviso que no salió a tiempo",
  SIN_PLAN_DE_CUIDADOS: "Sin plan de cuidados",
};

/** El color de cada nivel. El mismo que el libro de incidencias del
 *  admin: un N3 tiene que verse igual en los dos sitios. */
function colorDelNivel(nivel: string | null): string {
  switch (nivel) {
    case "N4":
      return "bg-red-600 text-white";
    case "N3":
      return "bg-red-100 text-red-800";
    case "N2":
      return "bg-amber-100 text-amber-900";
    case "N1":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export interface SalaParteProps {
  parte: ParteDeRelevo;
  tardios: AnadidoTardio[];
  acuses: ConfirmacionDelParte[];
  confirmado: boolean;
  /** `true` si esta persona ya lo confirmó: el botón lo dice. */
  yaConfirmado: boolean;
  /** `true` mientras sale la confirmación. */
  confirmando?: boolean;
  /** Puesto cuando la confirmación se quedó en la cola (sin red). */
  enLaCola?: boolean;
  error?: string | null;
  quien: { nombre: string; rolName: string };
  onConfirmar: () => void;
  onTerminar: () => void;
}

export function SalaParte({
  parte,
  tardios,
  acuses,
  confirmado,
  yaConfirmado,
  confirmando = false,
  enLaCola = false,
  error = null,
  quien,
  onConfirmar,
  onTerminar,
}: SalaParteProps) {
  return (
    // ── `h-screen` Y NO `min-h-screen` · LO ENCONTRÓ EL BUCLE VISUAL ──
    //
    // Con `min-h-screen`, la columna crece con el parte y la página
    // entera se desplaza: el `overflow-y-auto` del cuerpo no llega a
    // activarse nunca y **«Leído y recibido» se va por debajo del
    // pliegue** a 1280×800. O sea, el botón del bloque entero, escondido
    // en un parte de nueve líneas.
    //
    // Con `h-screen` + `overflow-hidden`, la altura está fijada: lo que
    // se desplaza es el cuerpo y el pie se queda pegado abajo. Es la
    // misma lección que la banda del TPV («una banda paga su altura») por
    // el otro lado.
    //
    // Y no lo vio el test de pantalla: en jsdom no hay layout, así que
    // `shrink-0` en el pie estaba puesto y el botón igualmente no se veía.
    <div className="h-screen overflow-hidden bg-mipiace-stone text-mipiace-ink flex flex-col">
      {/* ── La cabecera: de qué parte es y quién lo está leyendo ── */}
      <header className="shrink-0 bg-white border-b border-slate-200 px-8 py-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="text-[32px] font-semibold leading-none">
          Relevo de {parte.turno.name.toLowerCase()}
        </h1>
        <p className="text-[22px] text-slate-500">
          {parte.careDay} · congelado a las {horaDe(parte.corte)}
        </p>
        <p className="ml-auto text-[20px] text-slate-500">
          {quien.nombre} · {quien.rolName}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* ── Lo que llegó DESPUÉS, arriba y en ámbar ───────────── */}
        {tardios.length > 0 && (
          <section
            aria-label="Llegó después del relevo"
            className="mb-8 rounded-2xl border-2 border-amber-300 bg-amber-50 px-7 py-6"
          >
            <h2 className="text-[26px] font-semibold text-amber-900">
              Llegó después del relevo
            </h2>
            <p className="mt-1 text-[20px] text-amber-800">
              Esto no estaba en el parte cuando se congeló: subió más tarde,
              desde una tablet que estaba sin red.
            </p>
            <ul className="mt-4 space-y-3">
              {tardios.map((t) => (
                <li key={t.id} className="text-[22px]">
                  <span className="tabular-nums font-medium">
                    {horaDe(t.ocurrioEn)}
                  </span>{" "}
                  {t.resumen ?? "(no se puede leer)"}{" "}
                  <span className="text-amber-800">
                    — llegó a las {horaDe(t.llegoEn)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Turno sin novedades ──────────────────────────────── */}
        {parte.sinNovedades ? (
          <section className="rounded-2xl border border-slate-200 bg-white px-8 py-12 text-center">
            <h2 className="text-[34px] font-semibold">Turno sin novedades</h2>
            <p className="mt-3 text-[22px] text-slate-500 max-w-[640px] mx-auto">
              No hay incidencias abiertas, ni constantes fuera de rango, ni
              nada del plan sin hacer. Se confirma igual: lo que queda
              demostrado es que lo has leído.
            </p>
          </section>
        ) : (
          parte.zonas.map((zona) => (
            <section key={zona.floorId ?? "centro"} className="mb-9">
              <h2 className="text-[28px] font-semibold border-b-2 border-slate-300 pb-2">
                {zona.nombre}{" "}
                <span className="text-slate-500 font-normal text-[22px]">
                  · {zona.lineas} {zona.lineas === 1 ? "línea" : "líneas"}
                </span>
              </h2>

              {zona.residentes.map((r) => (
                <article key={r.clientId} className="mt-5">
                  <h3 className="text-[24px] font-medium">
                    {r.habitacion ? (
                      <span className="text-slate-500 tabular-nums">
                        {r.habitacion}{" "}
                      </span>
                    ) : null}
                    {r.nombre}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {r.lineas.map((l, i) => (
                      <Linea key={i} linea={l} />
                    ))}
                  </ul>
                </article>
              ))}

              {zona.sueltas.length > 0 && (
                <article className="mt-5">
                  <h3 className="text-[24px] font-medium text-slate-500">
                    {/* residencia-6 · el rótulo depende de la ZONA. «Del centro,
                        sin residente» es verdad en la zona del centro y mentira
                        en una planta: ahí lo suelto es lo que no cuelga de un
                        residente CONCRETO —una avería del office, o la línea de
                        «sin plan de cuidados», que nombra a varios—. Lo encontró
                        el bucle visual al fotografiar el parte. */}
                    {zona.floorId == null
                      ? "Del centro, sin residente"
                      : "De la planta, sin residente concreto"}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {zona.sueltas.map((l, i) => (
                      <Linea key={i} linea={l} />
                    ))}
                  </ul>
                </article>
              )}
            </section>
          ))
        )}

        {/* ── Quién lo ha confirmado ya ────────────────────────── */}
        {acuses.length > 0 && (
          <section
            aria-label="Confirmaciones"
            className="mt-4 rounded-2xl bg-white border border-slate-200 px-7 py-5"
          >
            <h2 className="text-[22px] font-semibold text-slate-600">
              Ya lo han recibido
            </h2>
            <ul className="mt-2 space-y-1 text-[20px] text-slate-600">
              {acuses.map((a, i) => (
                <li key={i}>
                  {a.nombre} · {a.rol} · {horaDe(a.at)}
                  {a.alcanceTotal
                    ? " · todo el centro"
                    : a.zonas.length > 0
                      ? ` · ${a.zonas.join(", ")}`
                      : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ── El pie: «Leído y recibido» y «Terminar» ───────────────
          Pegado abajo con `shrink-0` y el cuerpo con `overflow-y-auto`,
          que es la lección de la banda del TPV: con la página entera
          desplazándose, el botón de confirmar se va por debajo del
          pliegue en una tablet de 800 px de alto y nadie lo encuentra. */}
      <footer className="shrink-0 border-t border-slate-200 bg-white px-8 py-5">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-red-50 text-red-700 px-6 py-4 text-[22px]"
          >
            {error}
          </p>
        )}
        {enLaCola && (
          <p
            role="status"
            className="mb-4 rounded-xl bg-amber-50 text-amber-900 px-6 py-4 text-[22px]"
          >
            Sin red: tu «Leído y recibido» está firmado y guardado en esta
            tablet con la hora de ahora. Saldrá en cuanto vuelva el wifi.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={confirmando || yaConfirmado}
            className="min-h-tap-puerta px-10 rounded-2xl bg-mipiace-coral text-white text-[28px] font-semibold active:bg-mipiace-coral/80 disabled:opacity-50"
          >
            {yaConfirmado ? "Ya lo has recibido" : "Leído y recibido"}
          </button>
          <p className="text-[20px] text-slate-500 max-w-[520px]">
            {yaConfirmado
              ? "Queda firmado con tu nombre, tu rol y la hora."
              : "Al pulsarlo queda firmado con tu nombre, tu rol y la hora, y qué zonas abarcaba lo que has leído."}
          </p>
          <button
            type="button"
            onClick={onTerminar}
            className="ml-auto min-h-touch-pad px-6 text-[20px] text-slate-500 underline"
          >
            Terminar
          </button>
        </div>
        {confirmado && (
          <p className="mt-4 text-[20px] text-emerald-700">
            Este parte está confirmado: cada planta con contenido tiene a
            alguien que la ha recibido.
          </p>
        )}
      </footer>
    </div>
  );
}

function Linea({ linea }: { linea: LineaDelParte }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[22px]">
      {linea.nivel && (
        <span
          className={`shrink-0 rounded-lg px-2 py-0.5 text-[18px] font-semibold tabular-nums ${colorDelNivel(
            linea.nivel,
          )}`}
        >
          {linea.nivel}
        </span>
      )}
      {/* 64 px y no 52: a 22 px de cuerpo, «09:00» no cabía en 52 y se
          pegaba con la clase de la línea («09:00No se hizo»). Lo
          encontró el bucle visual, no un test — en jsdom no hay layout. */}
      <span className="shrink-0 text-slate-500 tabular-nums w-[64px]">
        {linea.hora ?? "—"}
      </span>
      <span className="shrink-0 text-slate-500 text-[19px]">
        {NOMBRE_DE_LA_CLASE[linea.clase] ?? linea.clase}
      </span>
      <span>{linea.texto}</span>
      {linea.aviso && (
        <span className="text-[19px] text-slate-500">
          {linea.aviso.acusadoPor
            ? `· lo cogió ${linea.aviso.acusadoPor}${
                linea.aviso.acusadoEn ? ` a las ${linea.aviso.acusadoEn}` : ""
              }`
            : "· nadie lo acusó"}
        </span>
      )}
    </li>
  );
}

/** «HH:MM» de un ISO. La hora que el servidor manda ya es de pared del
 *  centro en las líneas; esto es para los instantes completos. */
function horaDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
