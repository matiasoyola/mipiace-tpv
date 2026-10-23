// residencia-1 · RESIDENTES.
//
// La lista con habitación, cama, nivel de dependencia y tipo de plaza; el
// alta; la ficha; dar de alta (que se va) y cambiar de habitación.
//
// ── Poco texto, todo a un toque ──────────────────────────────────────
//
// La lista es una tabla de una línea por residente y las dos acciones que
// se usan a diario —cambiar de habitación y dar de alta— están en la
// propia línea, no dentro de la ficha. Quien las usa es la dirección a
// mediodía, con el teléfono en la otra mano.
//
// El **ingreso pendiente** (residente sin cama) se pinta como AVISO en
// ámbar y no como error: está permitido y es lo normal el día antes de que
// llegue alguien. Lo que no puede es pasar desapercibido.
//
// ── Qué no está aquí ─────────────────────────────────────────────────
//
// El DNI y el NSS sólo en la ficha, nunca en la lista: la lista se enseña
// en una pantalla que mira cualquiera que pase por el despacho. Lo mismo
// que hace la API, que no los manda en `GET /residencia/residentes`.
//
// ── alta-minima · DAR EL COÑAZO, SIN BLOQUEAR NADA ──────────────────
//
// Un residente se crea con el nombre y nada más, así que esta pantalla
// tiene que convivir con cuarenta y tres fichas a medio llenar y **no
// dejar de recordarlo**. Lo que gana:
//
//   · una etiqueta «Faltan 4 datos» en cada fila, roja si falta algún
//     imprescindible;
//   · «12 de 43 fichas incompletas» arriba, y un filtro **«Sólo
//     incompletas» que viene puesto** mientras quede alguna;
//   · la banda de la ficha y el formulario que la apaga, en el mismo
//     modal (`ResidentesPage.completar.tsx`);
//   · «Añadir varios», que es cómo se carga el listado del primer día;
//   · `?completar=<clientId>` en la URL, que es por donde entra el botón
//     «Completar» de la tarjeta del panel, y «Siguiente incompleta» para
//     recorrerlas sin volver aquí entre cada una.
//
// El filtro puesto POR DEFECTO es la decisión que más se nota, y es
// deliberada: una residencia que acaba de cargar su listado tiene 43 de
// 43 incompletas, y lo que la dirección va a hacer durante dos semanas es
// cerrarlas. Cuando no quede ninguna, el filtro desaparece de la pantalla
// y la lista vuelve a ser la lista.
//
// Nada de esto llega a la puerta ni al relevo (decisión 4): un residente
// incompleto se atiende igual.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BedDouble,
  ClipboardCheck,
  ClipboardList,
  LogOut,
  Plus,
  X,
} from "lucide-react";
// residencia-2 · el enlace al plan de cuidados, desde la ficha.
// primer-acceso · `?alta=1`, que es por donde entra «Nuevo ingreso» de la
// tarjeta del centro vacío.
// alta-minima · y `?completar=…`, por donde entra «Completar» de la
// tarjeta de fichas incompletas. **Un solo par de `searchParams` para los
// dos**: con dos llamadas a `useSearchParams` cada `setSearchParams`
// escribe sobre la instantánea que leyó, y el segundo borra el parámetro
// del primero.
import { Link, useSearchParams } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import {
  fechaCorta,
  hoyISO,
  nombreVisible,
  NIVEL_LABEL,
  PLAZA_LABEL,
  type NivelDependencia,
  type PlantaVista,
  type ResidenteFicha,
  type ResidenteFila,
  type ResumenDeFichas,
  type TipoDePlaza,
} from "./lib.js";
import { BloqueDeFoto } from "./ResidentesPage.foto.js";
// alta-minima · las piezas de «lo que le falta». `Eleccion` SALIÓ de este
// fichero y vive allí para que la dependencia vaya en un solo sentido.
import {
  BandaDeLoQueFalta,
  BotonAnadirVarios,
  Eleccion,
  EtiquetaDeFaltan,
  FormularioDeCompletar,
  ModalAnadirVarios,
} from "./ResidentesPage.completar.js";

const NIVELES: NivelDependencia[] = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"];
const PLAZAS: TipoDePlaza[] = ["PRIVADA", "CONCERTADA", "TEMPORAL"];

export function ResidentesPage() {
  // primer-acceso (punto 4) · `?alta=1` abre el formulario directo.
  //
  // Es lo que hace que la tarjeta del panel vacío sea UN toque: «Nuevo
  // ingreso» en el panel y el formulario encima, sin pasar por una lista
  // que está vacía. El parámetro se consume al montar y se quita de la
  // URL, para que recargar o volver atrás no reabra el modal.
  const [searchParams, setSearchParams] = useSearchParams();
  const [filas, setFilas] = useState<ResidenteFila[] | null>(null);
  const [alcance, setAlcance] = useState<"CENTRO" | "ZONA">("CENTRO");
  const [resumen, setResumen] = useState<ResumenDeFichas | null>(null);
  const [conAltas, setConAltas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState(searchParams.get("alta") === "1");
  const [varios, setVarios] = useState(false);
  const [ficha, setFicha] = useState<ResidenteFicha | null>(null);
  const [moviendo, setMoviendo] = useState<ResidenteFila | null>(null);
  const [dando, setDando] = useState<ResidenteFila | null>(null);
  // alta-minima · «Sólo incompletas». Nace `null` = «lo que decida la
  // pantalla», y la pantalla decide **puesto mientras quede alguna**.
  // Nace `null` y no `true` para poder distinguir «la dirección lo ha
  // quitado» de «todavía no ha tocado nada»: con `true` a secas, cada
  // recarga se lo volvería a poner encima.
  const [soloIncompletas, setSoloIncompletas] = useState<boolean | null>(null);

  async function recargar() {
    try {
      const r = await api<{
        residentes: ResidenteFila[];
        alcance: "CENTRO" | "ZONA";
        resumen: ResumenDeFichas;
      }>(`/residencia/residentes${conAltas ? "?incluirAltas=true" : ""}`);
      setFilas(r.residentes);
      setAlcance(r.alcance);
      setResumen(r.resumen);
      setError(null);
      return r.residentes;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      return null;
    }
  }

  useEffect(() => {
    void recargar();
    // `conAltas` entra en las dependencias: cambiar la casilla recarga.
  }, [conAltas]);

  async function abrirFicha(fila: { clientId: string }) {
    try {
      const r = await api<{ residente: ResidenteFicha }>(
        `/residencia/residentes/${fila.clientId}`,
      );
      setFicha(r.residente);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  // ── LOS DOS PARÁMETROS DE LA URL, JUNTOS ────────────────────────
  //
  // `?alta=1` (primer-acceso) abre «Nuevo ingreso»; `?completar=<id>`
  // (alta-minima) abre la ficha de ese residente. Los dos los manda una
  // tarjeta del panel y los dos **se consumen**: si se quedaran en la
  // URL, cerrar el modal lo volvería a abrir y no se podría salir.
  //
  // Van con el actualizador FUNCIONAL (`(p) => …`) y no construyendo un
  // `URLSearchParams` desde `searchParams`. Es la decisión del merge: con
  // la segunda forma, los dos efectos leen la misma instantánea y el que
  // escribe después borra el parámetro que el otro acababa de quitar —y
  // sólo cuando llegan los dos juntos, que es el caso que nadie prueba a
  // mano. Con el funcional, cada uno parte de lo que hay.
  useEffect(() => {
    if (searchParams.get("alta") !== "1") return;
    setSearchParams(
      (p) => {
        p.delete("alta");
        return p;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  const aCompletar = searchParams.get("completar");
  useEffect(() => {
    if (!aCompletar) return;
    setSearchParams(
      (p) => {
        p.delete("completar");
        return p;
      },
      { replace: true },
    );
    void abrirFicha({ clientId: aCompletar });
  }, [aCompletar]);

  if (!filas) return <CenteredLoader label="Cargando residentes…" error={error} />;

  const viven = filas.filter((f) => f.dischargeDate == null);
  const idos = filas.filter((f) => f.dischargeDate != null);
  const sinCama = viven.filter((f) => f.cama == null);
  // alta-minima · el filtro, con su valor efectivo. Sólo se ofrece si hay
  // alguna incompleta: un filtro que no filtra nada es una casilla más
  // que leer.
  const hayIncompletas = (resumen?.incompletas ?? 0) > 0;
  const filtrando = hayIncompletas && (soloIncompletas ?? true);
  const enElCentro = filtrando ? viven.filter((f) => f.faltan.length > 0) : viven;

  /**
   * alta-minima · **«Siguiente incompleta».**
   *
   * El orden es el de la lista —apellidos, que es como la dirección las
   * busca— y arranca DESPUÉS de la que está abierta. Si no hay ninguna
   * más por detrás, vuelve a empezar por arriba: lo que importa es que el
   * botón no se quede muerto a mitad del recorrido.
   *
   * Y se calcula sobre lo que se acaba de recargar y no sobre `filas`:
   * la ficha que se acaba de guardar puede haber dejado de estar
   * incompleta, y con el estado viejo el botón la volvería a abrir.
   */
  async function siguienteIncompleta(desdeClientId: string) {
    // `filas` es `ResidenteFila[] | null` en el tipo, y aquí ya no puede
    // ser null (hay un `if (!filas)` arriba que devuelve el cargador),
    // pero TypeScript no lo sabe dentro de una función.
    const frescas = (await recargar()) ?? filas ?? [];
    const vivas = frescas.filter((f) => f.dischargeDate == null);
    const i = vivas.findIndex((f) => f.clientId === desdeClientId);
    const enOrden = i < 0 ? vivas : [...vivas.slice(i + 1), ...vivas.slice(0, i)];
    const siguiente = enOrden.find((f) => f.faltan.length > 0);
    if (!siguiente) {
      setFicha(null);
      return;
    }
    await abrirFicha(siguiente);
  }

  return (
    <AdminShell title="Residentes">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Quién vive en el centro, en qué habitación y con qué plaza.
        {alcance === "ZONA" && " Ves los residentes de tu zona."}
      </p>

      {error && <FieldError message={error} />}

      {sinCama.length > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <span>
            {sinCama.length === 1
              ? "Hay 1 residente sin habitación asignada (ingreso pendiente)."
              : `Hay ${sinCama.length} residentes sin habitación asignada (ingreso pendiente).`}
          </span>
        </div>
      )}

      {/* ── alta-minima · «12 de 43 fichas incompletas» ────────────
          Arriba y en ámbar, con el número de datos dentro: «12 fichas» no
          dice si queda una tarde o dos semanas, y «31 datos» sí. */}
      {resumen && resumen.incompletas > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
          <span>
            <strong>
              {resumen.incompletas} de {resumen.total} fichas incompletas
            </strong>
            {" · "}
            {resumen.datosPendientes === 1
              ? "1 dato pendiente"
              : `${resumen.datosPendientes} datos pendientes`}
            {resumen.conImprescindibles > 0 && (
              <>
                {", "}
                {resumen.conImprescindibles === 1
                  ? "1 con algo imprescindible"
                  : `${resumen.conImprescindibles} con algo imprescindible`}
              </>
            )}
            . Se atienden igual: esto es papeleo del despacho.
          </span>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          En el centro{" "}
          <span className="font-normal tabular-nums text-slate-400">
            {filtrando ? `${enElCentro.length} de ${viven.length}` : viven.length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {/* El filtro sólo existe mientras haya algo que filtrar, y viene
              PUESTO: un centro que acaba de cargar su listado tiene 43 de
              43 incompletas y lo que va a hacer dos semanas es cerrarlas.
              Cuando no quede ninguna, esta casilla desaparece. */}
          {hayIncompletas && (
            <label className="flex min-h-[44px] items-center gap-2 text-[13.5px] text-slate-600">
              <input
                type="checkbox"
                checked={filtrando}
                onChange={(e) => setSoloIncompletas(e.target.checked)}
                className="h-4 w-4"
              />
              Sólo incompletas
            </label>
          )}
          <label className="flex min-h-[44px] items-center gap-2 text-[13.5px] text-slate-600">
            <input
              type="checkbox"
              checked={conAltas}
              onChange={(e) => setConAltas(e.target.checked)}
              className="h-4 w-4"
            />
            Ver también los que se fueron
          </label>
          <BotonAnadirVarios onClick={() => setVarios(true)} />
          {/* «Nuevo ingreso» y NO «Dar de alta», y lo encontró su propio
              test: en una residencia **«dar de alta» significa que alguien
              SE VA**. Tener los dos actos con las mismas palabras —el de
              la cabecera y el de cada línea— era la clase de ambigüedad
              que se paga una vez, de noche, con la familia esperando. */}
          <PrimaryButton
            type="button"
            onClick={() => setAlta(true)}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            <Plus className="h-4 w-4" /> Nuevo ingreso
          </PrimaryButton>
        </div>
      </div>

      <Tabla
        filas={enElCentro}
        filtrando={filtrando}
        onFicha={abrirFicha}
        onMover={setMoviendo}
        onDarDeAlta={setDando}
      />

      {conAltas && idos.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-[16px] font-semibold text-mipiace-ink">
            Se fueron{" "}
            <span className="font-normal tabular-nums text-slate-400">
              {idos.length}
            </span>
          </h2>
          <Tabla filas={idos} onFicha={abrirFicha} />
        </>
      )}

      {alta && (
        <ModalAlta
          onClose={() => setAlta(false)}
          onHecho={() => {
            setAlta(false);
            void recargar();
          }}
          // primer-acceso (punto 5) · «Guardar y dar de alta otro». La
          // lista se recarga por detrás y el modal se queda abierto y en
          // blanco: cuarenta y ocho residentes no se cargan volviendo
          // cada vez a la lista.
          onHechoYOtro={() => void recargar()}
        />
      )}
      {varios && (
        <Modal title="Añadir varios residentes" onClose={() => setVarios(false)}>
          <ModalAnadirVarios
            onCerrar={() => setVarios(false)}
            onHecho={() => void recargar()}
          />
        </Modal>
      )}
      {ficha && (
        <ModalFicha
          residente={ficha}
          onClose={() => setFicha(null)}
          onCambio={() => {
            void abrirFicha(ficha);
            void recargar();
          }}
          onSiguienteIncompleta={() => void siguienteIncompleta(ficha.clientId)}
          quedanIncompletas={viven.some(
            (f) => f.clientId !== ficha.clientId && f.faltan.length > 0,
          )}
        />
      )}
      {moviendo && (
        <ModalCama
          residente={moviendo}
          onClose={() => setMoviendo(null)}
          onHecho={() => {
            setMoviendo(null);
            void recargar();
          }}
        />
      )}
      {dando && (
        <ModalDarDeAlta
          residente={dando}
          onClose={() => setDando(null)}
          onHecho={() => {
            setDando(null);
            void recargar();
          }}
        />
      )}
    </AdminShell>
  );
}

function Tabla({
  filas,
  filtrando,
  onFicha,
  onMover,
  onDarDeAlta,
}: {
  filas: ResidenteFila[];
  /** alta-minima · para que el vacío diga por qué está vacío. */
  filtrando?: boolean;
  onFicha: (f: ResidenteFila) => void;
  onMover?: (f: ResidenteFila) => void;
  onDarDeAlta?: (f: ResidenteFila) => void;
}) {
  if (filas.length === 0) {
    // alta-minima · con el filtro puesto, «todavía no hay residentes»
    // sería mentira y además manda a crear uno. Lo que ha pasado es lo
    // contrario y es la buena noticia del bloque: no queda ninguna ficha
    // a medias.
    return (
      <p className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-[13.5px] text-slate-500">
        {filtrando
          ? "No queda ninguna ficha incompleta. Quita «Sólo incompletas» para ver a todos."
          : "Todavía no hay residentes. Dale a «Nuevo ingreso» o a «Añadir varios»."}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {filas.map((f) => (
        <li
          key={f.clientId}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* EL NOMBRE SE LLEVA LA LÍNEA ENTERA en estrecho, y lo
                encontró la captura de 320 px, no un test: con el nombre
                compartiendo línea con los dos distintivos y los dos
                botones, la columna del nombre se quedaba en noventa
                píxeles y «Manuel Cano Álvarez» salía como «Manuel Ca…» —
                lo único que esta pantalla existe para decir. Es el mismo
                arreglo que clinica-1 le hizo a la cabecera de Personal, y
                por la misma razón: trunca el que sobra, y aquí no sobra el
                nombre.

                `basis-full` hasta `sm`, y a partir de ahí comparte línea
                con el resto. */}
            <button
              type="button"
              onClick={() => onFicha(f)}
              className="min-h-[44px] w-full min-w-0 text-left sm:w-auto sm:flex-1 sm:basis-48"
            >
              {/* alta-minima · en formato de nombre, no como viene. El
                  listado del primer día está en mayúsculas y cuarenta y
                  tres nombres a gritos no se leen. Lo guardado no se
                  toca: ver `nombreVisible`. */}
              <span className="block truncate text-[14.5px] font-medium text-mipiace-ink">
                {nombreVisible(f.nombre)}
              </span>
              <span className="block text-[12.5px] text-slate-500">
                {f.cama
                  ? `Hab. ${f.cama.roomNumber} · cama ${f.cama.bedLabel} · ${f.cama.floorName}`
                  : "Sin habitación · ingreso pendiente"}
              </span>
            </button>
            {/* alta-minima · LA ETIQUETA DE LO QUE FALTA, antes que los
                distintivos: en una lista de cuarenta y tres es lo que la
                dirección está buscando, y en estrecho los últimos de la
                línea son los que se pierden. */}
            <EtiquetaDeFaltan faltan={f.faltan} />
            {/* alta-minima · los dos distintivos sólo si hay dato. Un
                `NIVEL_LABEL[null]` es `undefined` y un hueco en blanco
                dentro de una píldora gris, que parece un fallo de
                pintado; lo que falta ya lo dice la etiqueta de al lado. */}
            {f.dependencyLevel && (
              <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] text-slate-600">
                {NIVEL_LABEL[f.dependencyLevel]}
                {f.dependencyGrade ? ` · grado ${f.dependencyGrade}` : ""}
              </span>
            )}
            {f.placeType && (
              <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] text-slate-600">
                {PLAZA_LABEL[f.placeType]}
              </span>
            )}
            {f.dischargeDate ? (
              <span className="shrink-0 text-[12.5px] text-slate-400">
                Alta {fechaCorta(f.dischargeDate)}
              </span>
            ) : (
              <div className="flex shrink-0 gap-2">
                {onMover && (
                  <OutlineButton onClick={() => onMover(f)} className="!h-10 !px-3">
                    <BedDouble className="h-4 w-4" /> Habitación
                  </OutlineButton>
                )}
                {onDarDeAlta && (
                  <OutlineButton
                    onClick={() => onDarDeAlta(f)}
                    className="!h-10 !px-3"
                  >
                    <LogOut className="h-4 w-4" /> Dar de alta
                  </OutlineButton>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-3 py-8">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-mipiace-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalAlta({
  onClose,
  onHecho,
  onHechoYOtro,
}: {
  onClose: () => void;
  onHecho: () => void;
  /** primer-acceso · recarga la lista por detrás y deja el modal abierto
   *  para el siguiente. */
  onHechoYOtro: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  // alta-minima · **vacía, no `hoyISO()`.** Una fecha de ingreso que el
  // formulario rellena solo es un dato que nadie ha mirado y que luego
  // sale en un informe a la Consejería. Lo que se mete en un alta de hoy
  // se teclea; lo que no se sabe, se queda sin saber y la ficha lo canta.
  const [admissionDate, setAdmissionDate] = useState("");
  const [nivel, setNivel] = useState<NivelDependencia | null>(null);
  const [grado, setGrado] = useState<"I" | "II" | "III" | null>(null);
  const [plaza, setPlaza] = useState<TipoDePlaza | null>(null);
  const [responsable, setResponsable] = useState("");
  const [responsableTel, setResponsableTel] = useState("");
  const [parentesco, setParentesco] = useState("");
  const [dni, setDni] = useState("");
  const [bedId, setBedId] = useState<string>("");
  const [libres, setLibres] = useState<
    Array<{ id: string; etiqueta: string }> | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** primer-acceso · el nombre del último que se guardó sin cerrar, para
   *  que la pantalla confirme que se ha hecho. Sin esta línea, «Guardar y
   *  dar de alta otro» deja el formulario en blanco y no se distingue de
   *  un botón que no ha funcionado. */
  const [ultimo, setUltimo] = useState<string | null>(null);

  useEffect(() => {
    api<{ plantas: PlantaVista[] }>("/residencia/edificio")
      .then((r) => setLibres(camasLibres(r.plantas)))
      .catch(() => setLibres([]));
  }, []);

  // primer-acceso · DESPUÉS DE GUARDAR, EL CURSOR VUELVE ARRIBA.
  //
  // Lo vio el bucle visual del 23-10 y no un test: el modal se queda
  // donde estaba —abajo, junto a los dos botones— así que el campo del
  // nombre queda fuera de pantalla y cada residente costaba un scroll de
  // vuelta. Con cuarenta y ocho, son cuarenta y ocho scrolls.
  //
  // `focus()` arrastra el scroll del contenedor solo, así que no hace
  // falta tocarlo: basta con poner el cursor donde se escribe. Por id y
  // no por ref porque `TextField` no reenvía la suya, y cambiar un
  // componente compartido de toda la casa por esto sería pagar de más.
  useEffect(() => {
    if (ultimo == null) return;
    document.getElementById("nombre")?.focus();
  }, [ultimo]);

  // ── alta-minima · SÓLO EL NOMBRE BLOQUEA ────────────────────────
  //
  // Antes bloqueaban tres (nombre, nivel y plaza) y era lo que dejaba a
  // cuarenta y tres señoras fuera del programa. Ahora el único que
  // bloquea es el nombre —sin nombre no hay a quién atender— y los demás
  // se dicen como «puedes completarlo después», que es la verdad: la
  // ficha va a avisar de lo que le falte hasta que esté completa.
  const faltaElNombre = firstName.trim() === "";
  // Y lo que se va a quedar pendiente, dicho ANTES de guardar, para que
  // nadie crea que se le ha olvidado algo: igual que el nº de colegiado
  // en la pantalla de Personal de clinica-1.
  const quedaraPendiente = [
    lastName.trim() ? null : "los apellidos",
    nivel ? null : "el nivel de dependencia",
    plaza ? null : "el tipo de plaza",
    dni.trim() ? null : "el DNI",
    responsable.trim() ? null : "el familiar responsable",
  ].filter((x): x is string => x != null);

  /** Vacía lo que es de la persona y DEJA lo que es del ingreso: la fecha
   *  y, si la hubiera, la cama elegida ya no vale (la acaba de ocupar el
   *  anterior), así que la cama se limpia y la fecha se queda — cuarenta y
   *  ocho ingresos del mismo día llevan la misma fecha. */
  function limpiarParaElSiguiente(nombre: string) {
    setUltimo(nombre);
    setFirstName("");
    setLastName("");
    setPhone("");
    setNivel(null);
    setGrado(null);
    setPlaza(null);
    setResponsable("");
    setResponsableTel("");
    setParentesco("");
    setDni("");
    setBedId("");
    // Las camas libres cambian con cada alta que asigna una: se vuelven a
    // pedir en vez de quedarse con una lista que ya miente.
    api<{ plantas: PlantaVista[] }>("/residencia/edificio")
      .then((r) => setLibres(camasLibres(r.plantas)))
      .catch(() => setLibres([]));
  }

  async function guardar(seguirDandoDeAlta = false) {
    setBusy(true);
    setError(null);
    try {
      await api("/residencia/residentes", {
        method: "POST",
        body: {
          firstName: firstName.trim(),
          ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          // alta-minima · los tres, **sólo si hay dato**. Mandarlos a
          // `null` no es lo mismo que no mandarlos: el esquema de la
          // ruta no los acepta nulos, así que un `null` explícito sería
          // un 400 por un campo que el bloque acaba de hacer opcional.
          ...(admissionDate ? { admissionDate } : {}),
          ...(nivel ? { dependencyLevel: nivel } : {}),
          ...(grado ? { dependencyGrade: grado } : {}),
          ...(plaza ? { placeType: plaza } : {}),
          ...(responsable.trim() ? { responsibleName: responsable.trim() } : {}),
          ...(responsableTel.trim()
            ? { responsiblePhone: responsableTel.trim() }
            : {}),
          ...(parentesco.trim() ? { responsibleRelation: parentesco.trim() } : {}),
          ...(dni.trim() ? { dni: dni.trim() } : {}),
          ...(bedId ? { bedId } : {}),
        },
      });
      if (seguirDandoDeAlta) {
        limpiarParaElSiguiente(
          [firstName.trim(), lastName.trim()].filter(Boolean).join(" "),
        );
        onHechoYOtro();
      } else {
        onHecho();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo ingreso" onClose={onClose}>
      {/* alta-minima · la frase de arriba. Es lo que separa un formulario
          de doce campos que hay que rellenar de uno que se puede cerrar
          en diez segundos, y la dirección tiene que leerlo ANTES de
          empezar a rellenar. */}
      <p className="mb-4 text-[13.5px] text-slate-500">
        Con el nombre basta. Todo lo demás{" "}
        <strong>puedes completarlo después</strong>: la ficha te va a decir
        qué le falta hasta que esté completa.
      </p>
      <TextField
        id="nombre"
        label="Nombre"
        value={firstName}
        onChange={setFirstName}
      />
      <TextField
        id="apellidos"
        label="Apellidos (puedes completarlo después)"
        value={lastName}
        onChange={setLastName}
      />
      <TextField
        id="tel"
        label="Teléfono (opcional)"
        value={phone}
        onChange={setPhone}
        inputMode="tel"
      />
      <TextField
        id="ingreso"
        label="Fecha de ingreso (puedes completarlo después)"
        type="date"
        value={admissionDate}
        onChange={setAdmissionDate}
      />
      {/* `mb-4` en cada `Eleccion` y no dentro del componente: lo
          comparte con el formulario de completar, que las separa con un
          `space-y-4` propio. */}
      <div className="mb-4">
        <Eleccion
          label="Nivel de dependencia · sin él no se precarga el plan de cuidados"
          valor={nivel}
          opciones={NIVELES}
          etiquetas={NIVEL_LABEL}
          onChange={setNivel}
          onQuitar={nivel == null ? undefined : () => setNivel(null)}
        />
      </div>
      <div className="mb-4">
        <Eleccion
          label="Grado reconocido (opcional)"
          valor={grado}
          opciones={["I", "II", "III"] as Array<"I" | "II" | "III">}
          etiquetas={{ I: "Grado I", II: "Grado II", III: "Grado III" }}
          onChange={setGrado}
          onQuitar={grado == null ? undefined : () => setGrado(null)}
        />
      </div>
      <div className="mb-4">
        <Eleccion
          label="Tipo de plaza (puedes completarlo después)"
          valor={plaza}
          opciones={PLAZAS}
          etiquetas={PLAZA_LABEL}
          onChange={setPlaza}
          onQuitar={plaza == null ? undefined : () => setPlaza(null)}
        />
      </div>
      <div className="mb-4">
        <label
          htmlFor="cama"
          className="mb-1.5 block text-[13px] text-slate-500"
        >
          Habitación y cama (opcional · se puede asignar después)
        </label>
        <select
          id="cama"
          value={bedId}
          onChange={(e) => setBedId(e.target.value)}
          className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-[14.5px]"
        >
          <option value="">Sin asignar · ingreso pendiente</option>
          {(libres ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>
      <TextField
        id="responsable"
        label="Familiar responsable (opcional)"
        value={responsable}
        onChange={setResponsable}
      />
      <TextField
        id="responsable-tel"
        label="Su teléfono"
        value={responsableTel}
        onChange={setResponsableTel}
        inputMode="tel"
      />
      <TextField
        id="parentesco"
        label="Parentesco"
        value={parentesco}
        onChange={setParentesco}
      />
      <TextField id="dni" label="DNI (opcional)" value={dni} onChange={setDni} />

      {quedaraPendiente.length > 0 && (
        <p className="mb-3 mt-4 text-[13px] text-slate-500">
          Se va a crear sin {quedaraPendiente.join(", ")}. Aparecerá en la lista
          marcado como incompleto hasta que lo completes.
        </p>
      )}
      {ultimo && (
        <p
          data-test="ultimo-ingreso"
          className="mb-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800"
        >
          {ultimo} queda registrado. Sigue con el siguiente.
        </p>
      )}
      <FieldError message={error} />
      <div className="mt-4 space-y-2">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={faltaElNombre}
          onClick={() => void guardar()}
        >
          Registrar ingreso
        </PrimaryButton>
        {/* primer-acceso (punto 5) · el segundo botón, DEBAJO y en
            contorno: el primario sigue siendo «guardar y cerrar», que es
            lo que se pulsa un día normal. El de abajo es el del día del
            alta, cuando entran los cuarenta y ocho. */}
        {/* alta-minima · **el mismo bloqueo que el primario: sólo el
            nombre.** primer-acceso lo trajo pidiendo los cuatro datos
            (`faltan.length > 0`), que era lo correcto cuando la API los
            exigía; desde este bloque sería peor que inútil — el día del
            alta masiva, que es justo para lo que este botón existe, lo
            que hay es una columna de nombres, así que el botón habría
            estado apagado las cuarenta y ocho veces. */}
        <OutlineButton
          onClick={() => void guardar(true)}
          disabled={busy || faltaElNombre}
          className="w-full"
        >
          Guardar y dar de alta otro
        </OutlineButton>
      </div>
    </Modal>
  );
}

function ModalFicha({
  residente,
  onClose,
  onCambio,
  onSiguienteIncompleta,
  quedanIncompletas,
}: {
  residente: ResidenteFicha;
  onClose: () => void;
  /** residencia-3 · vuelve a pedir la ficha. La foto y el consentimiento
   *  se cambian desde aquí dentro y lo que se pinta tiene que seguirlos.
   *  alta-minima · y lo que le falta, que cambia al guardar. */
  onCambio: () => void;
  /** alta-minima · abre la siguiente ficha incompleta, sin volver a la
   *  lista. Lo que hace que recorrer cuarenta y tres sea posible. */
  onSiguienteIncompleta: () => void;
  /** Si hay alguna OTRA incompleta. Sin esto, el botón se quedaría en
   *  pantalla en la última y al pulsarlo cerraría el modal sin decir por
   *  qué. */
  quedanIncompletas: boolean;
}) {
  const [cargandoPlan, setCargandoPlan] = useState(false);
  const [errorDelPlan, setErrorDelPlan] = useState<string | null>(null);
  const [planCargado, setPlanCargado] = useState<number | null>(null);

  const faltaElPlan = residente.faltan.some((f) => f.campo === "planDeCuidados");

  async function cargarElPlan() {
    setCargandoPlan(true);
    setErrorDelPlan(null);
    try {
      const r = await api<{ plan: { abiertas: string[] } }>(
        `/residencia/residentes/${residente.clientId}/plan/plantilla`,
        { method: "POST" },
      );
      setPlanCargado(r.plan.abiertas.length);
      onCambio();
    } catch (err) {
      setErrorDelPlan(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setCargandoPlan(false);
    }
  }

  return (
    <Modal title={nombreVisible(residente.nombre)} onClose={onClose}>
      {/* alta-minima · LA BANDA, lo primero que se ve, con un enlace por
          dato. Se va sola cuando la ficha está completa. */}
      <BandaDeLoQueFalta faltan={residente.faltan} />
      <dl className="space-y-2.5 text-[13.5px]">
        <Dato k="Habitación">
          {residente.cama
            ? `${residente.cama.roomNumber} · cama ${residente.cama.bedLabel} · ${residente.cama.floorName}`
            : "Sin asignar · ingreso pendiente"}
        </Dato>
        <Dato k="Ingreso">{fechaCorta(residente.admissionDate)}</Dato>
        {residente.dischargeDate && (
          <Dato k="Alta">
            {fechaCorta(residente.dischargeDate)}
            {residente.dischargeReason ? ` · ${residente.dischargeReason}` : ""}
          </Dato>
        )}
        <Dato k="Dependencia">
          {residente.dependencyLevel
            ? `${NIVEL_LABEL[residente.dependencyLevel]}${
                residente.dependencyGrade
                  ? ` · grado ${residente.dependencyGrade}`
                  : ""
              }`
            : "—"}
        </Dato>
        <Dato k="Plaza">
          {residente.placeType ? PLAZA_LABEL[residente.placeType] : "—"}
        </Dato>
        <Dato k="Teléfono">{residente.phone ?? "—"}</Dato>
        <Dato k="Familiar">
          {residente.responsible
            ? `${residente.responsible.name}${
                residente.responsible.relation
                  ? ` (${residente.responsible.relation})`
                  : ""
              }${residente.responsible.phone ? ` · ${residente.responsible.phone}` : ""}`
            : "—"}
        </Dato>
        <Dato k="DNI">{residente.dni ?? "—"}</Dato>
        <Dato k="NSS">{residente.nss ?? "—"}</Dato>
      </dl>

      {/* residencia-2 · de aquí se llega al plan de cuidados. El botón va
          en la ficha y el plan tiene su propia pantalla: veinte líneas en
          cuatro grupos más la vista de «hoy» dentro de un modal, a 320 px,
          es un scroll que no acaba. */}
      <div className="mt-5 space-y-2">
        <Link
          to={`/admin/residencia/residentes/${residente.clientId}/plan`}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-[13.5px] text-mipiace-ink hover:bg-slate-50"
        >
          <ClipboardList className="h-4 w-4" /> Su plan de cuidados
        </Link>
        {/* residencia-3 · «la prueba de que llega». Va JUNTO al plan y en
            ese orden: el plan dice qué le toca, esto dice qué se le hizo, y
            las dos preguntas se miran seguidas. */}
        <Link
          to={`/admin/residencia/residentes/${residente.clientId}/registros`}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-[13.5px] text-mipiace-ink hover:bg-slate-50"
        >
          <ClipboardCheck className="h-4 w-4" /> Lo registrado en la puerta
        </Link>
      </div>

      {/* alta-minima · el resultado de cargar el plan, dicho aquí y no en
          un `alert`: «se han abierto 14 líneas» es lo que convierte un
          botón en algo que se entiende. */}
      {planCargado != null && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800">
          {planCargado === 0
            ? "Ya tenía su plan: no se ha abierto ninguna línea nueva."
            : planCargado === 1
              ? "Se ha abierto 1 línea de plan de cuidados."
              : `Se han abierto ${planCargado} líneas de plan de cuidados.`}
        </p>
      )}
      <FieldError message={errorDelPlan} />

      <BloqueDeFoto residente={residente} onCambio={onCambio} />

      {/* ── alta-minima · EL FORMULARIO QUE APAGA LA BANDA ──────────
          En la MISMA ficha y no detrás de otro botón: los enlaces de la
          banda tienen que poder llevar a un campo que esté en pantalla. */}
      <FormularioDeCompletar
        residente={residente}
        onGuardado={onCambio}
        onCargarPlan={
          faltaElPlan && residente.dependencyLevel != null && !cargandoPlan
            ? () => void cargarElPlan()
            : null
        }
      />

      {/* «Siguiente incompleta» sólo si queda alguna. En la última, el
          botón desaparece y lo que hay es cerrar: un botón que cierra el
          modal sin decir por qué deja a la dirección pensando que se ha
          perdido algo. */}
      {quedanIncompletas && residente.faltan.length > 0 && (
        <div className="mt-3">
          <OutlineButton onClick={onSiguienteIncompleta} className="w-full">
            Guardar esta y pasar a la siguiente incompleta →
          </OutlineButton>
        </div>
      )}

      {residente.ocupaciones.length > 1 && (
        <>
          <h4 className="mb-2 mt-6 text-[14px] font-semibold text-mipiace-ink">
            Habitaciones anteriores
          </h4>
          <ul className="space-y-1.5 text-[13px] text-slate-600">
            {residente.ocupaciones.map((o) => (
              <li key={o.id}>
                Hab. {o.habitacion} · cama {o.cama} ·{" "}
                {new Date(o.desde).toLocaleDateString("es-ES")} →{" "}
                {o.hasta
                  ? new Date(o.hasta).toLocaleDateString("es-ES")
                  : "ahora"}
                {o.motivo ? ` · ${o.motivo}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function Dato({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
      <dd className="min-w-0 flex-1 text-mipiace-ink">{children}</dd>
    </div>
  );
}

function ModalCama({
  residente,
  onClose,
  onHecho,
}: {
  residente: ResidenteFila;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [libres, setLibres] = useState<
    Array<{ id: string; etiqueta: string }> | null
  >(null);
  const [bedId, setBedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ plantas: PlantaVista[] }>("/residencia/edificio")
      .then((r) => setLibres(camasLibres(r.plantas)))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, []);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api(`/residencia/residentes/${residente.clientId}/cama`, {
        method: "POST",
        body: { bedId },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Habitación de ${nombreVisible(residente.nombre)}`} onClose={onClose}>
      <p className="mb-4 text-[13.5px] text-slate-500">
        {residente.cama
          ? `Ahora está en la ${residente.cama.roomNumber}, cama ${residente.cama.bedLabel}. Cambiarla cierra esa ocupación y abre otra: queda el histórico.`
          : "No tiene habitación asignada todavía."}
      </p>
      <div className="mb-4">
        <label htmlFor="nueva-cama" className="mb-1.5 block text-[13px] text-slate-500">
          Cama libre
        </label>
        <select
          id="nueva-cama"
          value={bedId}
          onChange={(e) => setBedId(e.target.value)}
          className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-[14.5px]"
        >
          <option value="">Elige una cama…</option>
          {(libres ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={!bedId}
          onClick={() => void guardar()}
        >
          Mover
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ModalDarDeAlta({
  residente,
  onClose,
  onHecho,
}: {
  residente: ResidenteFila;
  onClose: () => void;
  onHecho: () => void;
}) {
  const [fecha, setFecha] = useState(hoyISO());
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api(`/residencia/residentes/${residente.clientId}/alta`, {
        method: "POST",
        body: {
          dischargeDate: fecha,
          ...(motivo.trim() ? { dischargeReason: motivo.trim() } : {}),
        },
      });
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Dar de alta a ${nombreVisible(residente.nombre)}`} onClose={onClose}>
      {/* La frase importa: en una residencia «dar de alta» es que alguien se
          va, y la dirección tiene que leer que su ficha NO se borra. */}
      <p className="mb-4 text-[13.5px] text-slate-500">
        Su ficha y su historia se conservan: dar de alta no borra nada.
        {residente.cama && " Se libera su cama."}
      </p>
      <TextField
        id="alta-fecha"
        label="Fecha de alta"
        type="date"
        value={fecha}
        onChange={setFecha}
      />
      <TextField
        id="alta-motivo"
        label="Motivo (opcional)"
        value={motivo}
        onChange={setMotivo}
      />
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton type="button" busy={busy} onClick={() => void guardar()}>
          Dar de alta
        </PrimaryButton>
      </div>
    </Modal>
  );
}

/**
 * Las camas LIBRES del centro, como opciones de un `select`.
 *
 * Se calcula en el cliente a partir de la vista del edificio —que ya trae
 * quién ocupa cada cama— en vez de pedir una ruta propia: es una petición
 * menos y la vista del edificio es la misma que la pantalla de al lado ya
 * usa. Con 49 camas no hay nada que optimizar.
 */
function camasLibres(
  plantas: PlantaVista[],
): Array<{ id: string; etiqueta: string }> {
  const out: Array<{ id: string; etiqueta: string }> = [];
  for (const p of plantas) {
    for (const h of p.habitaciones) {
      if (!h.active) continue;
      for (const c of h.camas) {
        if (!c.active || c.ocupa != null) continue;
        out.push({
          id: c.id,
          etiqueta: `Hab. ${h.number} · cama ${c.label} · ${p.name}`,
        });
      }
    }
  }
  return out;
}
