// alta-minima · **AVISAR MUCHO, Y QUE EL AVISO LLEVE AL CAMPO.**
//
// Lo que hay aquí son las tres piezas nuevas de la pantalla de
// Residentes. Viven en su propio fichero por lo mismo que
// `ResidentesPage.foto.tsx`: la pantalla ya tenía ochocientas líneas y
// cuatro modales, y esto son otras trescientas de una preocupación
// distinta.
//
//   1. `EtiquetaDeFaltan` — «Faltan 4 datos» en cada fila de la lista.
//      Ámbar, o **roja si falta algún imprescindible**.
//   2. `BandaDeLoQueFalta` + `FormularioDeCompletar` — la banda de arriba
//      de la ficha y el formulario que la apaga.
//   3. `ModalAnadirVarios` — pegar 43 nombres y crearlos.
//
// ── EL FILTRO «¿Y QUÉ?» DE CADA AVISO ───────────────────────────────
//
// Lo pide el bloque y es la regla de este fichero: **un aviso tiene que
// llevar a completar el dato con un toque, no sólo decir que falta**. De
// ahí que cada dato de la banda sea un enlace que enfoca su campo, que el
// formulario esté en la misma ficha y no detrás de otro botón, y que
// «Siguiente incompleta» exista — recorrer cuarenta y tres fichas
// volviendo a la lista entre cada una son ciento veintinueve toques de
// más.
//
// ── Y LO QUE NO SE AVISA ────────────────────────────────────────────
//
// Nada de esto llega a la puerta ni al relevo (decisión 4). Un residente
// incompleto se atiende igual: lo que falta es papeleo del despacho, y
// una auxiliar con la tablet en la mano no puede hacer nada con «le falta
// el NSS». Avisarle sería ruido en la pantalla donde el ruido se paga.

import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Users } from "lucide-react";

import {
  claveDeNombre,
  enFormatoDeNombre,
  lineasPegadas,
} from "@mipiacetpv/residencia-plan";

import { api, ApiError } from "../../api.js";
import { FieldError, OutlineButton, PrimaryButton, TextField } from "../../ui.js";
import {
  ANCLA_DEL_CAMPO,
  faltanEnPalabras,
  NIVEL_LABEL,
  PLAZA_LABEL,
  type DatoQueFalta,
  type NivelDependencia,
  type ResidenteFicha,
  type ResidenteFila,
  type TipoDePlaza,
} from "./lib.js";

const NIVELES: NivelDependencia[] = ["VALIDO", "SEMIASISTIDO", "DEPENDIENTE"];
const PLAZAS: TipoDePlaza[] = ["PRIVADA", "CONCERTADA", "TEMPORAL"];

/** El mismo tope que `MAXIMO_DE_UN_LOTE` en la API. */
const MAXIMO_DE_UN_LOTE = 300;

function hayImprescindibles(faltan: DatoQueFalta[]): boolean {
  return faltan.some((f) => f.peso === "IMPRESCINDIBLE");
}

// ════════════════════════════════════════════════════════════════════
//  1 · LA ETIQUETA DE LA FILA
// ════════════════════════════════════════════════════════════════════
//
// Ámbar o roja, y la diferencia es la que la dirección usa para decidir
// por dónde empieza: en rojo están las que no sirven para facturar ni
// para llamar a nadie si pasa algo.
//
// No es un botón: la fila entera ya abre la ficha, y un botón dentro de
// otro botón es `<button>` anidado — HTML inválido que React avisa en
// consola y que en un móvil se toca sin querer.
export function EtiquetaDeFaltan({ faltan }: { faltan: DatoQueFalta[] }) {
  if (faltan.length === 0) return null;
  const rojo = hayImprescindibles(faltan);
  return (
    <span
      className={`shrink-0 rounded-lg px-2.5 py-1 text-[12.5px] font-medium ${
        rojo ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"
      }`}
    >
      {faltanEnPalabras(faltan)}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
//  2 · LA BANDA DE LA FICHA
// ════════════════════════════════════════════════════════════════════

/**
 * «A esta ficha le faltan: fecha de ingreso, DNI, familiar responsable».
 *
 * Cada dato es un enlace que **enfoca su campo**. Y se va sola cuando la
 * ficha está completa: no queda un «0 datos pendientes» en verde, que es
 * una línea más que leer en una pantalla que ya tiene doce.
 */
export function BandaDeLoQueFalta({ faltan }: { faltan: DatoQueFalta[] }) {
  if (faltan.length === 0) return null;
  const rojo = hayImprescindibles(faltan);

  function llevarA(campo: DatoQueFalta["campo"]) {
    const el = document.getElementById(ANCLA_DEL_CAMPO[campo]);
    if (!el) return;
    // **EL FOCO PRIMERO, y el scroll después y protegido.** El orden
    // importa y lo encontró el banco: `scrollIntoView` no existe en
    // jsdom, así que ponerlo delante tiraba el handler entero y el
    // enlace no enfocaba nada. En un navegador real pasa lo mismo con
    // cualquier entorno que no lo implemente — y de las dos cosas, la
    // que hace que el aviso sirva es el foco: el grupo del nivel y el de
    // la plaza llevan `tabIndex={-1}` justo para que el borde de foco
    // diga a qué dato ha llevado el enlace.
    el.focus({ preventScroll: true });
    // `center` y no el `block: start` de serie: el formulario está
    // dentro de un modal con scroll propio y «arriba» dejaba el campo
    // justo debajo de la cabecera pegada.
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }

  return (
    <div
      className={`mb-5 rounded-xl px-3.5 py-2.5 text-[13px] ${
        rojo ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
        <p>
          A esta ficha le {faltan.length === 1 ? "falta" : "faltan"}:{" "}
          {faltan.map((f, i) => (
            <span key={f.campo}>
              {i > 0 && ", "}
              <button
                type="button"
                onClick={() => llevarA(f.campo)}
                className="underline underline-offset-2"
              >
                {f.etiqueta}
              </button>
            </span>
          ))}
          .
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  3 · EL FORMULARIO QUE LA APAGA
// ════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ ESTÁ EN LA FICHA Y NO EN OTRO MODAL ────────────────────
//
// Porque la banda está aquí. Un «Editar» que abre un segundo modal
// encima del primero deja el aviso en la pantalla de atrás, y entonces
// los enlaces de la banda no pueden llevar a ningún campo — que es la
// mitad que hace que el aviso sirva.
//
// ── UN SOLO `PATCH`, con lo que ha cambiado ────────────────────────
//
// Y sólo lo que ha cambiado. Mandar los doce campos en cada guardado
// escribiría `dependencyLevel` igual que estaba, y eso en esta API no es
// inocuo: el PATCH **recalcula el plan de cuidados** cuando el nivel
// cambia, así que reenviar el mismo nivel es la diferencia entre no tocar
// nada y abrirle veinte líneas a alguien.
export function FormularioDeCompletar({
  residente,
  onGuardado,
  onCargarPlan,
}: {
  residente: ResidenteFicha;
  /** Vuelve a pedir la ficha: la banda y lo que falta tienen que seguirla. */
  onGuardado: () => void;
  /** El botón «Cargar el plan de cuidados de …». `null` si no procede. */
  onCargarPlan: (() => void) | null;
}) {
  const [lastName, setLastName] = useState(residente.lastName);
  const [phone, setPhone] = useState(residente.phone ?? "");
  const [birthdate, setBirthdate] = useState(residente.birthdate ?? "");
  const [admissionDate, setAdmissionDate] = useState(residente.admissionDate ?? "");
  const [nivel, setNivel] = useState<NivelDependencia | null>(
    residente.dependencyLevel,
  );
  const [grado, setGrado] = useState<"I" | "II" | "III" | null>(
    residente.dependencyGrade,
  );
  const [plaza, setPlaza] = useState<TipoDePlaza | null>(residente.placeType);
  const [dni, setDni] = useState(residente.dni ?? "");
  const [nss, setNss] = useState(residente.nss ?? "");
  const [responsable, setResponsable] = useState(residente.responsible?.name ?? "");
  const [responsableTel, setResponsableTel] = useState(
    residente.responsible?.phone ?? "",
  );
  const [parentesco, setParentesco] = useState(
    residente.responsible?.relation ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al cambiar de residente —«Siguiente incompleta» reusa el componente—
  // los campos se vuelven a sembrar. Sin esto, la segunda ficha saldría
  // con los datos de la primera escritos encima, y al guardar se los
  // llevaría.
  useEffect(() => {
    setLastName(residente.lastName);
    setPhone(residente.phone ?? "");
    setBirthdate(residente.birthdate ?? "");
    setAdmissionDate(residente.admissionDate ?? "");
    setNivel(residente.dependencyLevel);
    setGrado(residente.dependencyGrade);
    setPlaza(residente.placeType);
    setDni(residente.dni ?? "");
    setNss(residente.nss ?? "");
    setResponsable(residente.responsible?.name ?? "");
    setResponsableTel(residente.responsible?.phone ?? "");
    setParentesco(residente.responsible?.relation ?? "");
    setError(null);
  }, [residente.clientId]);

  async function guardar() {
    const cuerpo: Record<string, unknown> = {};
    const siCambia = (campo: string, ahora: string, antes: string | null) => {
      if (ahora.trim() === (antes ?? "")) return;
      cuerpo[campo] = ahora.trim();
    };
    siCambia("lastName", lastName, residente.lastName);
    siCambia("phone", phone, residente.phone);
    siCambia("dni", dni, residente.dni);
    siCambia("nss", nss, residente.nss);
    siCambia("responsibleName", responsable, residente.responsible?.name ?? null);
    siCambia(
      "responsiblePhone",
      responsableTel,
      residente.responsible?.phone ?? null,
    );
    siCambia(
      "responsibleRelation",
      parentesco,
      residente.responsible?.relation ?? null,
    );
    // Las dos fechas, aparte: la API las quiere en `YYYY-MM-DD` y **no
    // acepta cadena vacía** (`format: "date"`), así que vaciar un campo
    // de fecha no se puede mandar. Borrar una fecha de ingreso que ya
    // estaba no es un caso de este bloque —el bloque va de ponerla— y
    // mandar `""` sería un 400 que la dirección no entendería.
    if (admissionDate !== "" && admissionDate !== (residente.admissionDate ?? "")) {
      cuerpo.admissionDate = admissionDate;
    }
    if (birthdate !== "" && birthdate !== (residente.birthdate ?? "")) {
      cuerpo.birthdate = birthdate;
    }
    if (nivel != null && nivel !== residente.dependencyLevel) {
      cuerpo.dependencyLevel = nivel;
    }
    if (plaza != null && plaza !== residente.placeType) cuerpo.placeType = plaza;
    // El grado SÍ se puede quitar: la API acepta `null` para el que lo
    // tenía por error.
    if (grado !== residente.dependencyGrade) cuerpo.dependencyGrade = grado;

    if (Object.keys(cuerpo).length === 0) {
      // Darle a guardar sin tocar nada no es un error ni una petición:
      // es un doble toque.
      onGuardado();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api(`/residencia/residentes/${residente.clientId}`, {
        method: "PATCH",
        body: cuerpo,
      });
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <h4 className="mb-3 text-[14px] font-semibold text-mipiace-ink">
        Completar la ficha
      </h4>
      <div className="space-y-4">
        <TextField
          id={ANCLA_DEL_CAMPO.apellidos}
          label="Apellidos"
          value={lastName}
          onChange={setLastName}
        />
        <TextField
          id={ANCLA_DEL_CAMPO.fechaDeIngreso}
          label="Fecha de ingreso"
          type="date"
          value={admissionDate}
          onChange={setAdmissionDate}
        />
        <Eleccion
          id={ANCLA_DEL_CAMPO.nivelDeDependencia}
          label="Nivel de dependencia"
          valor={nivel}
          opciones={NIVELES}
          etiquetas={NIVEL_LABEL}
          onChange={setNivel}
        />
        <Eleccion
          id={ANCLA_DEL_CAMPO.tipoDePlaza}
          label="Tipo de plaza"
          valor={plaza}
          opciones={PLAZAS}
          etiquetas={PLAZA_LABEL}
          onChange={setPlaza}
        />
        <Eleccion
          id={ANCLA_DEL_CAMPO.gradoReconocido}
          label={
            plaza === "CONCERTADA"
              ? "Grado reconocido · en plaza concertada hace falta para facturar"
              : "Grado reconocido"
          }
          valor={grado}
          opciones={["I", "II", "III"] as Array<"I" | "II" | "III">}
          etiquetas={{ I: "Grado I", II: "Grado II", III: "Grado III" }}
          onChange={setGrado}
          onQuitar={grado == null ? undefined : () => setGrado(null)}
        />
        <TextField
          id={ANCLA_DEL_CAMPO.dni}
          label="DNI"
          value={dni}
          onChange={setDni}
        />
        <TextField
          id={ANCLA_DEL_CAMPO.nss}
          label="Nº de la Seguridad Social"
          value={nss}
          onChange={setNss}
        />
        <TextField
          id={ANCLA_DEL_CAMPO.fechaDeNacimiento}
          label="Fecha de nacimiento"
          type="date"
          value={birthdate}
          onChange={setBirthdate}
        />
        <TextField
          id={ANCLA_DEL_CAMPO.familiarResponsable}
          label="Familiar responsable"
          value={responsable}
          onChange={setResponsable}
        />
        <TextField
          id={ANCLA_DEL_CAMPO.telefonoDelFamiliar}
          label="Su teléfono"
          value={responsableTel}
          onChange={setResponsableTel}
          inputMode="tel"
        />
        <TextField
          id="ficha-parentesco"
          label="Parentesco"
          value={parentesco}
          onChange={setParentesco}
        />
        <TextField
          id="ficha-telefono"
          label="Teléfono del residente"
          value={phone}
          onChange={setPhone}
          inputMode="tel"
        />
      </div>

      {/* El plan NO se teclea: se carga de la plantilla del nivel. El
          ancla existe igual para que el enlace de la banda llegue hasta
          aquí y la dirección vea el botón, o vea por qué no lo hay. */}
      <div id={ANCLA_DEL_CAMPO.planDeCuidados} tabIndex={-1} className="mt-5">
        {onCargarPlan && nivel != null ? (
          <OutlineButton onClick={onCargarPlan} className="w-full">
            <ClipboardList className="h-4 w-4" /> Cargar el plan de cuidados de
            «{NIVEL_LABEL[nivel].toLocaleLowerCase("es-ES")}»
          </OutlineButton>
        ) : null}
      </div>

      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton type="button" busy={busy} onClick={() => void guardar()}>
          Guardar la ficha
        </PrimaryButton>
      </div>
    </div>
  );
}

/**
 * Los dos o tres botones de una elección corta, a un toque.
 *
 * Vive aquí y no en `ResidentesPage.tsx` —de donde salió— para que la
 * dependencia vaya en un solo sentido: la pantalla usa este fichero, este
 * fichero no usa la pantalla. Y gana dos cosas de este bloque:
 *
 *   · `id` + `tabIndex={-1}` en el contenedor, para que el enlace de la
 *     banda pueda enfocarlo. Un `<div>` no recibe foco sin `tabIndex`, y
 *     sin foco la pantalla salta sin decir a qué dato ha llevado;
 *   · `onQuitar`, para el grado que alguien puso por error. La API ya
 *     aceptaba `null`; lo que no había era por dónde decírselo.
 */
export function Eleccion<T extends string>({
  id,
  label,
  valor,
  opciones,
  etiquetas,
  onChange,
  onQuitar,
}: {
  id?: string;
  label: string;
  valor: T | null;
  opciones: T[];
  etiquetas: Record<string, string>;
  onChange: (v: T) => void;
  onQuitar?: () => void;
}) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className="focus:outline-none">
      <p className="mb-1.5 text-[13px] text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {opciones.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`min-h-[44px] rounded-xl border px-4 text-[13.5px] transition-colors ${
              valor === o
                ? "border-mipiace-coral bg-mipiace-coral/10 text-mipiace-ink font-medium"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {etiquetas[o] ?? o}
          </button>
        ))}
        {onQuitar && (
          <button
            type="button"
            onClick={onQuitar}
            className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-[13.5px] text-slate-500 hover:bg-slate-50"
          >
            Quitar
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  4 · AÑADIR VARIOS
// ════════════════════════════════════════════════════════════════════
//
// Así se cargó el listado de Jardín de Gredos: 43 líneas copiadas de una
// columna de Excel.
//
// ── LA VISTA PREVIA SALE DEL PAQUETE PURO ──────────────────────────
//
// `lineasPegadas` y `claveDeNombre` son **las mismas funciones** que usa
// la ruta. Si la pantalla partiera el texto a su manera, diría «se crean
// 40» y el servidor crearía 41 — y sólo en los casos raros, que son los
// que nadie prueba a mano.
//
// ── Y COMPARA CONTRA LOS QUE SE FUERON TAMBIÉN ─────────────────────
//
// Por eso el modal pide la lista con `incluirAltas=true` al abrirse, en
// vez de usar la que la pantalla ya tiene: la de la pantalla son los que
// viven aquí hoy, y una señora dada de alta en 2019 que vuelve a ingresar
// **ya tiene ficha**. El servidor la va a saltar; si la vista previa
// dijera que se crea, el resultado no cuadraría con lo prometido.
export function ModalAnadirVarios({
  onCerrar,
  onHecho,
}: {
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [plazaPorDefecto, setPlazaPorDefecto] = useState<TipoDePlaza | null>(null);
  const [yaEstan, setYaEstan] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{
    creados: number;
    saltados: Array<{ numero: number; nombre: string; motivo: string }>;
    avisos: string[];
  } | null>(null);

  useEffect(() => {
    api<{ residentes: ResidenteFila[] }>("/residencia/residentes?incluirAltas=true")
      .then((r) =>
        setYaEstan(new Set(r.residentes.map((x) => claveDeNombre(x.nombre)))),
      )
      // Un fallo aquí no bloquea el alta: la vista previa se queda sin
      // poder marcar los repetidos y lo dice. La idempotencia de verdad
      // está en el servidor, no aquí.
      .catch(() => setYaEstan(null));
  }, []);

  const pegado = lineasPegadas(texto);
  const repetidos = pegado.lineas.filter((l) => yaEstan?.has(l.clave) === true);
  const nuevos = pegado.lineas.filter((l) => yaEstan?.has(l.clave) !== true);
  const pasada = nuevos.length > MAXIMO_DE_UN_LOTE;

  async function crear() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{
        creados: number;
        saltados: Array<{ numero: number; nombre: string; motivo: string }>;
        avisos: string[];
      }>("/residencia/residentes/varios", {
        method: "POST",
        body: {
          texto,
          ...(plazaPorDefecto ? { placeTypePorDefecto: plazaPorDefecto } : {}),
        },
      });
      setHecho(r);
      // La lista de atrás se recarga ya, aunque el resultado siga en
      // pantalla: la dirección acaba de crear cuarenta residentes y va a
      // querer verlos al cerrar.
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (hecho) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-mipiace-ink">
          {hecho.creados === 1
            ? "Se ha creado 1 residente."
            : `Se han creado ${hecho.creados} residentes.`}{" "}
          {hecho.creados > 0 && (
            <span className="text-slate-500">
              Les faltan los apellidos y el resto de los datos: la lista te lo
              dice en cada fila.
            </span>
          )}
        </p>
        {hecho.saltados.length > 0 && (
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-600">
            <p className="mb-1 font-medium text-mipiace-ink">
              {hecho.saltados.length === 1
                ? "1 línea saltada"
                : `${hecho.saltados.length} líneas saltadas`}
            </p>
            <ul className="space-y-1">
              {hecho.saltados.map((x) => (
                <li key={`${x.numero}-${x.nombre}`}>
                  Línea {x.numero} · {enFormatoDeNombre(x.nombre) || "(vacía)"} ·{" "}
                  {x.motivo}
                </li>
              ))}
            </ul>
          </div>
        )}
        {hecho.avisos.length > 0 && (
          <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
            <ul className="space-y-1">
              {hecho.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        <PrimaryButton type="button" onClick={onCerrar}>
          Cerrar
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-[13.5px] text-slate-500">
        Pega los nombres, <strong>uno por línea</strong> — tal como salen de
        copiar una columna de Excel. Si tienes el tipo de plaza en la columna de
        al lado, pega las dos: se queda cada uno con el suyo.
      </p>
      <label htmlFor="pegado" className="mb-1.5 block text-[13px] text-slate-500">
        Nombres
      </label>
      <textarea
        id="pegado"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={"ABEL RAMOS DOBLADO\nBEGOÑA AGÜERO PRIETO\nCARMEN DEL RÍO"}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-[13px] text-mipiace-ink focus:border-mipiace-coral/30 focus:outline-none focus:ring-2 focus:ring-mipiace-coral/30"
      />

      <div className="mt-4">
        <Eleccion
          label="Tipo de plaza para los que no la traigan (opcional)"
          valor={plazaPorDefecto}
          opciones={PLAZAS}
          etiquetas={PLAZA_LABEL}
          onChange={setPlazaPorDefecto}
          onQuitar={
            plazaPorDefecto == null ? undefined : () => setPlazaPorDefecto(null)
          }
        />
      </div>

      {/* ── LA VISTA PREVIA ─────────────────────────────────────────
          Se pinta en cuanto hay una línea: ver lo que va a pasar antes de
          darle es lo que hace que nadie tenga que deshacer nada — y un
          residente **no se borra** (las FKs son `RESTRICT`). */}
      {pegado.lineas.length + pegado.rotas.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-[13.5px] font-medium text-mipiace-ink">
            {nuevos.length === 1
              ? "Se va a crear 1 residente"
              : `Se van a crear ${nuevos.length} residentes`}
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-600">
            {nuevos.map((l) => (
              <li key={l.numero}>
                {enFormatoDeNombre(l.nombre)}
                {l.placeType && (
                  <span className="text-slate-400">
                    {" · "}
                    {PLAZA_LABEL[l.placeType as TipoDePlaza] ?? l.placeType}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {yaEstan == null && (
            <p className="text-[13px] text-slate-500">
              No he podido comprobar quién ya existe. Dale igual: los que ya
              estén <strong>no se duplican</strong>.
            </p>
          )}
          {repetidos.length > 0 && (
            <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-600">
              <p className="mb-1 font-medium text-mipiace-ink">
                {repetidos.length === 1
                  ? "1 ya existe y se salta"
                  : `${repetidos.length} ya existen y se saltan`}
              </p>
              <ul className="space-y-1">
                {repetidos.map((l) => (
                  <li key={l.numero}>{enFormatoDeNombre(l.nombre)}</li>
                ))}
              </ul>
            </div>
          )}
          {pegado.repetidasEnElPegado.length > 0 && (
            <p className="text-[13px] text-slate-500">
              {pegado.repetidasEnElPegado.length === 1
                ? "1 línea está repetida en lo que has pegado: se queda la primera."
                : `${pegado.repetidasEnElPegado.length} líneas están repetidas en lo que has pegado: se queda la primera de cada una.`}
            </p>
          )}
          {pegado.rotas.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
              <ul className="space-y-1">
                {pegado.rotas.map((r) => (
                  <li key={r.numero}>
                    Línea {r.numero}: {r.motivo}.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pasada && (
            <p className="text-[13px] text-rose-700">
              Son {nuevos.length} nombres y de una vez caben {MAXIMO_DE_UN_LOTE}.
              Pega el resto en un segundo lote: los que ya estén no se duplican.
            </p>
          )}
        </div>
      )}

      <FieldError message={error} />
      <div className="mt-5">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={nuevos.length === 0 || pasada}
          onClick={() => void crear()}
        >
          {nuevos.length === 1
            ? "Crear 1 residente"
            : `Crear ${nuevos.length} residentes`}
        </PrimaryButton>
      </div>
    </div>
  );
}

/** El botón que abre «Añadir varios», para la cabecera de la lista. */
export function BotonAnadirVarios({ onClick }: { onClick: () => void }) {
  return (
    <OutlineButton onClick={onClick} className="!h-10 !px-4 !text-[13.5px]">
      <Users className="h-4 w-4" /> Añadir varios
    </OutlineButton>
  );
}
