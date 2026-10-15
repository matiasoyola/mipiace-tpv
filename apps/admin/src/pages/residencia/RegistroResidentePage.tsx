// residencia-3 · **LO REGISTRADO, POR TURNO.** La prueba de que llega.
//
// Se llega desde la ficha del residente. Solo lectura, y es a propósito:
// lo que se registra en la puerta **no se edita desde el panel**. Una
// corrección se hace donde se hizo el cuidado y la firma quien está
// delante del residente; un botón «editar» aquí convertiría la evidencia
// en un formulario.
//
// ── POR QUÉ ESTA PANTALLA EXISTE ────────────────────────────────────
//
// Porque es la que la dirección abre el primer día para ver que la tablet
// de la 112 está escribiendo de verdad. Y es la que se enseña en una
// auditoría: la hoja de cambios posturales que hoy se reconstruye a mano,
// ya hecha, con persona, rol y hora.
//
// ── Y POR QUÉ SE ENSEÑA LO CORREGIDO Y LO ANULADO ───────────────────
//
// Porque lo que esto prueba no es «el valor de ahora»: es que **nada se
// borra**. La corrección aparece al lado de lo corregido, con quién
// corrigió y cuándo; lo anulado aparece tachado con quién lo deshizo. Una
// vista que sólo enseñara lo vigente sería más fácil de leer y sería otro
// documento — uno que no prueba lo que este prueba.
//
// Lo que las distingue de un vistazo: lo vigente en negro, lo corregido y
// lo anulado en gris con su etiqueta. Y **la etiqueta dice qué pasó**, no
// un icono: «corregido a las 11:00» se entiende sin leer una leyenda.

import { useEffect, useState } from "react";
import { ArrowLeft, Mic } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, apiBlob, ApiError } from "../../api.js";
import { CenteredLoader, OutlineButton } from "../../ui.js";

interface RegistroDeLaFicha {
  id: string;
  controlCode: string;
  nombre: string;
  layer: string | null;
  valor: unknown;
  nota: string | null;
  tieneVoz: boolean;
  recordedAt: string;
  careDay: string;
  occurrenceAt: string | null;
  shiftCode: string | null;
  sinTurno: boolean;
  firmadoPor: string;
  rolCode: string;
  anulado: boolean;
  corrigeA: string | null;
  vigente: boolean;
}

interface LoRegistrado {
  dia: string;
  esHoy: boolean;
  diaDePared: string;
  porTurno: Array<{
    code: string;
    name: string;
    desde: string;
    hasta: string;
    registros: RegistroDeLaFicha[];
  }>;
  sinTurno: RegistroDeLaFicha[];
  total: number;
}

export function RegistroResidentePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [datos, setDatos] = useState<LoRegistrado | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let vivo = true;
    void (async () => {
      try {
        const res = await api<LoRegistrado>(
          `/residencia/residentes/${clientId}/registros${dia ? `?dia=${dia}` : ""}`,
        );
        if (vivo) {
          setDatos(res);
          setError(null);
        }
      } catch (err) {
        if (vivo) {
          setError(
            err instanceof ApiError
              ? err.message
              : "No se pudo leer lo registrado.",
          );
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [clientId, dia]);

  return (
    <AdminShell title="Lo registrado">
      <div className="mx-auto max-w-3xl px-4 py-5">
        <Link
          to="/admin/residencia/residentes"
          className="mb-4 inline-flex min-h-[44px] items-center gap-2 text-[13.5px] text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" /> Residentes
        </Link>

        {error && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-[13.5px] text-red-700">
            {error}
          </p>
        )}

        {!datos ? (
          <CenteredLoader label="Leyendo lo registrado…" />
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <label
                htmlFor="dia"
                className="text-[13.5px] font-medium text-mipiace-ink"
              >
                Día del centro
              </label>
              <input
                id="dia"
                type="date"
                value={datos.dia}
                onChange={(e) => setDia(e.target.value)}
                className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-[13.5px]"
              />
              {!datos.esHoy && (
                <OutlineButton onClick={() => setDia(null)}>
                  Volver a hoy
                </OutlineButton>
              )}
              <span className="text-[13px] text-slate-500">
                {datos.total === 1
                  ? "1 registro"
                  : `${datos.total} registros`}
              </span>
            </div>

            {/* El día del CENTRO no es siempre el del calendario: a las
                02:00 el turno de noche sigue siendo el de ayer. Se dice,
                porque si no quien mire a las tres de la mañana creerá que
                la tablet no ha escrito nada. */}
            {datos.dia !== datos.diaDePared && (
              <p className="mb-4 rounded-xl bg-slate-100 px-4 py-3 text-[13px] text-slate-600">
                Hoy en el calendario es {datos.diaDePared}. Se está viendo el
                día del centro {datos.dia}, porque el turno de noche empieza
                antes de medianoche y acaba después.
              </p>
            )}

            {datos.total === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-[13.5px] text-slate-500">
                Todavía no hay nada registrado este día.
              </p>
            )}

            {datos.porTurno
              .filter((t) => t.registros.length > 0)
              .map((t) => (
                <section key={t.code} className="mb-6">
                  <h3 className="mb-2 text-[14px] font-semibold text-mipiace-ink">
                    {t.name}{" "}
                    <span className="font-normal text-slate-500">
                      {t.desde}–{t.hasta}
                    </span>
                  </h3>
                  <ul className="space-y-2">
                    {t.registros.map((r) => (
                      <Linea key={r.id} r={r} />
                    ))}
                  </ul>
                </section>
              ))}

            {datos.sinTurno.length > 0 && (
              <section className="mb-6">
                <h3 className="mb-2 text-[14px] font-semibold text-amber-800">
                  Sin turno
                </h3>
                {/* Un cuidado SIN turno es un cuidado hecho: se apuntó y se
                    enseña. Lo que hay que arreglar es el cuadrante, y lo
                    dice aquí porque es donde se ve. */}
                <p className="mb-2 text-[13px] text-amber-800">
                  Estos registros no caen en ningún turno configurado. El
                  cuidado se hizo; lo que falta es cubrir esa hora en la
                  pantalla de Turnos.
                </p>
                <ul className="space-y-2">
                  {datos.sinTurno.map((r) => (
                    <Linea key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}

/**
 * La nota de voz.
 *
 * Se pide con `apiBlob` y se pinta desde un `<audio>` con un object URL,
 * **no con `<audio src="/api/…">`**: esa ruta necesita el `Authorization`
 * en una cabecera y un `<audio>` no manda cabeceras. Es la misma razón por
 * la que `apiBlobWithCashier` existe en la clínica.
 *
 * Y se pide **al pulsar**, no al pintar la lista: cada escucha deja su
 * línea en el registro de accesos (`conHistoria` con `READ`), y descargar
 * veinte audios por abrir una ficha llenaría ese registro de accesos que
 * nadie hizo — que es justo lo que lo hace menos útil (decisión 1 de
 * clinica-1).
 */
function NotaDeVoz({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (url) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio controls src={url} className="mt-1 h-10 w-full max-w-xs" />;
  }
  return (
    <button
      type="button"
      onClick={() => {
        void (async () => {
          try {
            setUrl(URL.createObjectURL(await apiBlob(`/residencia/registros/${id}/voz`)));
          } catch {
            setFallo("no se pudo abrir");
          }
        })();
      }}
      className="inline-flex min-h-[44px] items-center gap-1 underline"
    >
      <Mic className="h-3.5 w-3.5" /> {fallo ?? "nota de voz"}
    </button>
  );
}

function Linea({ r }: { r: RegistroDeLaFicha }) {
  const apagado = !r.vigente;
  return (
    <li
      className={`rounded-xl border px-4 py-3 text-[13.5px] ${
        apagado
          ? "border-dashed border-slate-300 text-slate-500"
          : "border-slate-200 text-mipiace-ink"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {r.nombre}
          {r.anulado && " · deshecho"}
          {!r.anulado && !r.vigente && " · corregido después"}
        </span>
        <span className="tabular-nums text-slate-500">
          {new Date(r.recordedAt).toLocaleTimeString("es-ES", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <p className="mt-1 text-slate-600">
        {valorEnPalabras(r.valor)}
        {r.nota ? ` · «${r.nota}»` : ""}
      </p>
      <p className="mt-1 flex items-center gap-2 text-[13px] text-slate-500">
        {r.firmadoPor} · {r.rolCode.toLowerCase()}
        {r.corrigeA && " · es una corrección"}
        {r.tieneVoz && <NotaDeVoz id={r.id} />}
      </p>
    </li>
  );
}

/**
 * El valor, en palabras.
 *
 * El valor llega **descifrado** de la API y con la forma que le puso la
 * puerta. `ilegible` es el hueco marcado de clinica-7: un valor que no se
 * descifra **se enseña como hueco y no se esconde**, porque esconderlo
 * borra la única pista de que algo va mal con la clave.
 */
export function valorEnPalabras(valor: unknown): string {
  if (valor == null) return "—";
  const v = valor as {
    tipo?: unknown;
    hecho?: unknown;
    opcion?: unknown;
    comoSiempre?: unknown;
    ilegible?: unknown;
  };
  if (v.ilegible === true) return "(este dato no se puede leer)";
  if (v.tipo === "BOOL") return v.hecho === true ? "Hecho" : "—";
  if (v.tipo === "ORDINAL") {
    const code = typeof v.opcion === "string" ? v.opcion : "—";
    return v.comoSiempre === true ? `${code} · como siempre` : code;
  }
  if (v.tipo === "NOTA") return "Algo no va bien";
  return "—";
}
