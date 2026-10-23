// residencia-2 · CONTROLES · el catálogo por capas.
//
// Lo que esta pantalla enseña es **la frontera estándar / centro** (rama
// de controles §10). Lo de serie se ve como «estándar» y sus campos
// intocables **no son editables**: la capa, la naturaleza, el dominio, la
// unidad, los rangos y el indicador se pintan como dato, no como campo.
// Lo que el centro decide —si lo usa, cómo lo llama, cada cuánto y quién
// lo registra— son botones.
//
// ── Por qué el catálogo entero en una pantalla y no una lista ────────
//
// Porque la pregunta que la dirección se hace es «¿qué se registra de mis
// residentes?», y eso es la lista completa agrupada por lo que significa
// cada capa. Con una lista paginada habría que buscar, y buscar presupone
// que ya sabes qué buscas.
//
// Las capas llevan su explicación en la cabecera («¿se hizo?», «¿cómo está
// hoy?») porque «capa de ejecución» no significa nada para nadie.
//
// ── Y por qué el panel se abre al tocar la línea ─────────────────────
//
// 36 controles × cinco decisiones son 180 campos. Desplegados, la pantalla
// es ilegible; en un modal por control, cada decisión se toma mirando sólo
// ese control. Lo que SÍ se ve en la línea cerrada es lo que se consulta
// de un golpe: si está activo, cada cuánto y quién lo registra.

import { useEffect, useState } from "react";
import { Plus, Settings2, X } from "lucide-react";

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
  CAPA_AYUDA,
  CAPA_LABEL,
  DOMINIO_LABEL,
  NATURALEZA_LABEL,
  frecuenciaCorta,
  type Capa,
  type ControlDelCatalogo,
  type FrecuenciaUI,
  type MomentoDelDia,
  type RolQueRegistra,
  type TipoDeFrecuencia,
  type TurnoCorto,
} from "./lib.js";
import { Pastilla, SelectorDeFrecuencia } from "./frecuencia-ui.js";

interface Catalogo {
  controles: ControlDelCatalogo[];
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  roles: RolQueRegistra[];
}

/** Las tres capas que este bloque siembra, en el orden en que se leen. */
const CAPAS_VISIBLES: Capa[] = ["EXEC", "OBS", "MEASURE"];

export function ControlesPage() {
  const [datos, setDatos] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<ControlDelCatalogo | null>(null);
  const [creando, setCreando] = useState(false);
  const [editandoMomentos, setEditandoMomentos] = useState(false);

  async function recargar() {
    try {
      setDatos(await api<Catalogo>("/residencia/controles"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  useEffect(() => {
    void recargar();
  }, []);

  if (!datos) return <CenteredLoader label="Cargando controles…" error={error} />;

  const activos = datos.controles.filter((c) => c.ajuste?.active ?? true).length;
  // Los que el sistema tuvo que reconducir al llegar una versión nueva del
  // catálogo clínico. Se avisa arriba porque es lo único de esta pantalla
  // que PASÓ SIN QUE NADIE LO PIDIERA.
  const reconducidos = datos.controles.filter((c) => c.ajuste?.reconducido);

  return (
    <AdminShell title="Controles">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        Qué se registra de cada residente. Lo de serie lo mantiene Mi Piace y
        se actualiza en todos los centros; tú decides si lo usas, cómo lo
        llamas, cada cuánto y quién lo registra.
      </p>

      {error && <FieldError message={error} />}

      {reconducidos.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-[14px] font-semibold text-amber-900">
            {reconducidos.length === 1
              ? "Un control ha cambiado y su ajuste se ha tenido que reconducir"
              : `${reconducidos.length} controles han cambiado y sus ajustes se han tenido que reconducir`}
          </p>
          <ul className="mt-1.5 space-y-1 text-[13px] text-amber-800">
            {reconducidos.map((c) => (
              <li key={c.code}>
                <span className="font-medium">{c.ajuste?.alias ?? c.name}</span> ·{" "}
                {c.ajuste?.reconducido?.motivo}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12.5px] text-amber-700">
            Revísalos y vuelve a elegir lo que quieras: el aviso se va al
            guardar.
          </p>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-slate-500">
          <span className="font-medium tabular-nums text-mipiace-ink">
            {activos}
          </span>{" "}
          de {datos.controles.length} activos
        </p>
        <div className="flex flex-wrap gap-2">
          <OutlineButton
            onClick={() => setEditandoMomentos(true)}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            <Settings2 className="h-4 w-4" /> Momentos del día
          </OutlineButton>
          <PrimaryButton
            type="button"
            onClick={() => setCreando(true)}
            className="!h-10 !w-auto !px-4 !text-[13.5px]"
          >
            <Plus className="h-4 w-4" /> Control propio
          </PrimaryButton>
        </div>
      </div>

      {CAPAS_VISIBLES.map((capa) => {
        const deLaCapa = datos.controles.filter((c) => c.layer === capa);
        if (deLaCapa.length === 0) return null;
        return (
          <section key={capa} className="mb-7">
            <h2 className="text-[16px] font-semibold text-mipiace-ink">
              {CAPA_LABEL[capa]}{" "}
              <span className="font-normal tabular-nums text-slate-400">
                {deLaCapa.length}
              </span>
            </h2>
            <p className="mb-3 text-[12.5px] text-slate-500">{CAPA_AYUDA[capa]}</p>
            <ul className="space-y-2">
              {deLaCapa.map((c) => (
                <Linea
                  key={c.code}
                  control={c}
                  turnos={datos.turnos}
                  momentos={datos.momentos}
                  roles={datos.roles}
                  onAbrir={() => setAbierto(c)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {abierto && (
        <ModalAjuste
          control={abierto}
          turnos={datos.turnos}
          momentos={datos.momentos}
          roles={datos.roles}
          onClose={() => setAbierto(null)}
          onHecho={() => {
            setAbierto(null);
            void recargar();
          }}
        />
      )}
      {creando && (
        <ModalControlPropio
          turnos={datos.turnos}
          momentos={datos.momentos}
          roles={datos.roles}
          onClose={() => setCreando(false)}
          onHecho={() => {
            setCreando(false);
            void recargar();
          }}
        />
      )}
      {editandoMomentos && (
        <ModalMomentos
          momentos={datos.momentos}
          onClose={() => setEditandoMomentos(false)}
          onHecho={() => {
            setEditandoMomentos(false);
            void recargar();
          }}
        />
      )}
    </AdminShell>
  );
}

function Linea({
  control,
  turnos,
  momentos,
  roles,
  onAbrir,
}: {
  control: ControlDelCatalogo;
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  roles: RolQueRegistra[];
  onAbrir: () => void;
}) {
  const ajuste = control.ajuste;
  const activo = ajuste?.active ?? true;
  const nombre = ajuste?.alias ?? control.name;
  const quien = (ajuste?.careRoleCodes ?? control.puedeElegir.roles)
    .map((r) => roles.find((x) => x.code === r)?.name ?? r)
    .join(", ");

  return (
    <li
      className={`rounded-2xl border bg-white px-4 py-3 ${
        activo ? "border-slate-200" : "border-slate-200 bg-slate-50/60"
      }`}
    >
      <button type="button" onClick={onAbrir} className="w-full min-h-[44px] text-left">
        {/* El nombre se lleva la línea entera hasta `sm`. Es el mismo
            arreglo que residencia-1 le hizo a la lista de residentes y por
            la misma razón: trunca el que sobra, y aquí no sobra el nombre. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={`text-[14.5px] font-medium ${
              activo ? "text-mipiace-ink" : "text-slate-400 line-through"
            }`}
          >
            {nombre}
          </span>
          {ajuste?.alias && (
            <span className="text-[12.5px] text-slate-400">({control.name})</span>
          )}
          {control.scope === "STANDARD" ? (
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-500">
              estándar v{control.version}
            </span>
          ) : (
            <span className="rounded-lg bg-mipiace-coral/10 px-2 py-0.5 text-[11.5px] text-mipiace-ink">
              tu centro · v{control.version}
            </span>
          )}
          {control.nature === "ON_DEMAND" && (
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-500">
              a demanda
            </span>
          )}
          {ajuste?.familyVisible && (
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-500">
              la familia lo ve
            </span>
          )}
        </div>
        <p className="mt-1 text-[12.5px] text-slate-500">
          {activo
            ? `${frecuenciaCorta(ajuste?.frecuencia ?? control.frecuenciaDeSerie, turnos, momentos)} · lo registra ${quien}`
            : "No lo usáis"}
        </p>
        {control.valueDomain === "NUMERIC" && (
          <p className="mt-0.5 text-[12.5px] tabular-nums text-slate-400">
            {control.unit}
            {control.refMin !== null && control.refMax !== null
              ? ` · normal ${control.refMin}–${control.refMax}`
              : " · sin rango normal"}
          </p>
        )}
        {ajuste?.reconducido && (
          <p className="mt-1 text-[12.5px] text-amber-700">
            Reconducido: {ajuste.reconducido.motivo}
          </p>
        )}
      </button>
    </li>
  );
}

function Marco({
  title,
  onClose,
  children,
  ancho = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-3 py-8">
      <div
        className={`w-full ${ancho} rounded-3xl border border-slate-200 bg-white p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[16px] font-semibold text-mipiace-ink">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Lo que el centro decide de un control. Cinco cosas y ni una más.
 *
 * Lo del producto se pinta ARRIBA y como dato, no como campo: así la
 * dirección ve por qué no puede cambiar el rango de la temperatura sin
 * tener que probar a cambiarlo.
 */
function ModalAjuste({
  control,
  turnos,
  momentos,
  roles,
  onClose,
  onHecho,
}: {
  control: ControlDelCatalogo;
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  roles: RolQueRegistra[];
  onClose: () => void;
  onHecho: () => void;
}) {
  const ajuste = control.ajuste;
  const [active, setActive] = useState(ajuste?.active ?? true);
  const [alias, setAlias] = useState(ajuste?.alias ?? "");
  const [frecuencia, setFrecuencia] = useState<FrecuenciaUI>(
    ajuste?.frecuencia ?? control.frecuenciaDeSerie,
  );
  const [careRoleCodes, setCareRoleCodes] = useState<string[]>(
    ajuste?.careRoleCodes ?? control.puedeElegir.roles,
  );
  const [familyVisible, setFamilyVisible] = useState(ajuste?.familyVisible ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sólo se ofrecen los roles que el PRODUCTO permite para este control, y
  // de ésos sólo los que este centro tiene activos y que registran. Es la
  // frontera: se puede estrechar, no ensanchar.
  const ofrecidos = roles.filter((r) => control.puedeElegir.roles.includes(r.code));

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api(`/residencia/controles/${control.code}`, {
        method: "PATCH",
        body: {
          active,
          alias: alias.trim() || null,
          frecuencia,
          careRoleCodes,
          familyVisible,
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
    <Marco title={ajuste?.alias ?? control.name} onClose={onClose}>
      {/* ── Del producto · se lee, no se toca ──────────────────────── */}
      <div className="mb-5 rounded-2xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-600">
        <p className="mb-1 font-medium text-slate-500">
          {control.scope === "STANDARD"
            ? `Control del producto · versión ${control.version}`
            : `Control de tu centro · versión ${control.version}`}
        </p>
        <p>
          {CAPA_LABEL[control.layer]} · {NATURALEZA_LABEL[control.nature]} ·{" "}
          {DOMINIO_LABEL[control.valueDomain]}
          {control.unit ? ` en ${control.unit}` : ""}
        </p>
        {control.valueDomain === "NUMERIC" && (
          <p className="tabular-nums">
            Se puede teclear de {control.inputMin} a {control.inputMax}
            {control.refMin !== null && control.refMax !== null
              ? ` · lo normal es ${control.refMin}–${control.refMax}`
              : " · sin rango normal"}
          </p>
        )}
        {control.opciones.length > 0 && (
          <p>
            Opciones:{" "}
            {control.opciones
              .map((o) => (o.comoSiempre ? `${o.label} (como siempre)` : o.label))
              .join(" · ")}
          </p>
        )}
        {control.isoIndicatorCode && <p>Indicador: {control.isoIndicatorCode}</p>}
        {control.scope === "STANDARD" && (
          <p className="mt-1 text-slate-400">
            Esto lo mantiene Mi Piace y se actualiza en todos los centros a la
            vez. Lo que eliges tú es lo de abajo.
          </p>
        )}
      </div>

      {/* ── Del centro ────────────────────────────────────────────── */}
      <div className="mb-4">
        <p className="mb-1.5 text-[13px] text-slate-500">¿Lo usáis?</p>
        <div className="flex flex-wrap gap-2">
          <Pastilla activo={active} onClick={() => setActive(true)}>
            Sí, lo usamos
          </Pastilla>
          <Pastilla activo={!active} onClick={() => setActive(false)}>
            No lo usamos
          </Pastilla>
        </div>
        {!active && (
          <p className="mt-1.5 text-[12.5px] text-slate-500">
            No saldrá en la puerta y no «tocará» a nadie. Las líneas de plan
            que lo nombran se quedan: si lo vuelves a activar, vuelve.
          </p>
        )}
      </div>

      <TextField
        id="ctrl-alias"
        label={`Cómo lo llamáis aquí (si no, «${control.name}»)`}
        value={alias}
        onChange={setAlias}
      />

      {active && (
        <>
          <div className="mb-5">
            <SelectorDeFrecuencia
              valor={frecuencia}
              permitidas={control.puedeElegir.frecuencias}
              turnos={turnos}
              momentos={momentos}
              onChange={setFrecuencia}
            />
          </div>

          <div className="mb-4">
            <p className="mb-1.5 text-[13px] text-slate-500">Quién lo registra</p>
            <div className="flex flex-wrap gap-2">
              {ofrecidos.map((r) => {
                const puesto = careRoleCodes.includes(r.code);
                return (
                  <Pastilla
                    key={r.code}
                    activo={puesto}
                    onClick={() =>
                      setCareRoleCodes(
                        puesto
                          ? careRoleCodes.filter((c) => c !== r.code)
                          : [...careRoleCodes, r.code],
                      )
                    }
                  >
                    {r.name}
                  </Pastilla>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12.5px] text-slate-400">
              Puedes quitar roles de la lista del producto, no añadir.
            </p>
            {careRoleCodes.length === 0 && (
              <p className="mt-1.5 text-[13px] text-amber-700">
                Si no lo registra nadie, no se registraría. Desactiva el control
                en vez de dejarlo sin roles.
              </p>
            )}
          </div>

          <div className="mb-4">
            <p className="mb-1.5 text-[13px] text-slate-500">¿Lo ve la familia?</p>
            <div className="flex flex-wrap gap-2">
              <Pastilla activo={!familyVisible} onClick={() => setFamilyVisible(false)}>
                Sólo interno
              </Pastilla>
              <Pastilla activo={familyVisible} onClick={() => setFamilyVisible(true)}>
                Lo ve la familia
              </Pastilla>
            </div>
            <p className="mt-1.5 text-[12.5px] text-slate-400">
              Todavía no hay portal de familias: esto se guarda para cuando lo
              haya.
            </p>
          </div>
        </>
      )}

      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={active && careRoleCodes.length === 0}
          onClick={() => void guardar()}
        >
          Guardar
        </PrimaryButton>
      </div>
    </Marco>
  );
}

/** Un control que este centro se inventa. No baja a ningún otro. */
function ModalControlPropio({
  turnos,
  momentos,
  roles,
  onClose,
  onHecho,
}: {
  turnos: TurnoCorto[];
  momentos: MomentoDelDia[];
  roles: RolQueRegistra[];
  onClose: () => void;
  onHecho: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [code, setCode] = useState("");
  const [layer, setLayer] = useState<Capa>("EXEC");
  const [esADemanda, setEsADemanda] = useState(false);
  const [frecuencia, setFrecuencia] = useState<FrecuenciaUI>({
    kind: "DAILY",
    shiftCodes: [turnos[0]?.code ?? "M"],
  });
  const [careRoleCodes, setCareRoleCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El código se propone del nombre y se puede corregir: nadie quiere
  // teclear `HIGIENE_PERSONAL`, y a la vez el código es lo que queda en el
  // histórico para siempre, así que se enseña.
  const codigoPropuesto =
    code.trim() ||
    nombre
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  // Un control a demanda no lleva agenda, y el servidor lo rechaza si no
  // coinciden. Aquí se mueven los dos juntos para que no pueda pasar.
  function cambiarNaturaleza(aDemanda: boolean) {
    setEsADemanda(aDemanda);
    setFrecuencia(
      aDemanda
        ? { kind: "ON_DEMAND" }
        : { kind: "DAILY", shiftCodes: [turnos[0]?.code ?? "M"] },
    );
  }

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await api("/residencia/controles", {
        method: "POST",
        body: {
          code: codigoPropuesto,
          name: nombre.trim(),
          layer,
          nature: esADemanda ? "ON_DEMAND" : "SCHEDULED",
          // Los controles propios nacen de sí/no: es el 90 % de lo que un
          // centro se inventa («se le ha puesto la pomada»). Un control con
          // opciones o con número se puede pedir y lo añade el producto —y
          // así no hay que explicar aquí qué es un dominio ordinal.
          valueDomain: "BOOL",
          frecuencia,
          careRoleCodes,
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
    <Marco title="Un control vuestro" onClose={onClose}>
      <p className="mb-4 text-[13px] text-slate-500">
        Algo que registráis aquí y no está en el catálogo. Es sólo de este
        centro: no lo verá ningún otro.
      </p>

      <TextField id="propio-nombre" label="Cómo se llama" value={nombre} onChange={setNombre} />
      <TextField
        id="propio-code"
        label="Código (se queda para siempre en el histórico)"
        value={codigoPropuesto}
        onChange={setCode}
      />

      <div className="mb-4">
        <p className="mb-1.5 text-[13px] text-slate-500">Qué clase de cosa es</p>
        <div className="flex flex-wrap gap-2">
          {(["EXEC", "OBS", "MEASURE"] as Capa[]).map((c) => (
            <Pastilla key={c} activo={layer === c} onClick={() => setLayer(c)}>
              {CAPA_LABEL[c]}
            </Pastilla>
          ))}
        </div>
        <p className="mt-1.5 text-[12.5px] text-slate-400">{CAPA_AYUDA[layer]}</p>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-[13px] text-slate-500">¿Tiene horario?</p>
        <div className="flex flex-wrap gap-2">
          <Pastilla activo={!esADemanda} onClick={() => cambiarNaturaleza(false)}>
            Sí, toca a su hora
          </Pastilla>
          <Pastilla activo={esADemanda} onClick={() => cambiarNaturaleza(true)}>
            No, cuando pase
          </Pastilla>
        </div>
      </div>

      {!esADemanda && (
        <div className="mb-5">
          <SelectorDeFrecuencia
            valor={frecuencia}
            // Un control propio lo puede poner como quiera: el producto no
            // tiene una guía detrás que diga qué frecuencias tienen sentido
            // para algo que acaba de inventar el centro.
            permitidas={[
              "EVERY_SHIFT",
              "DAILY",
              "MOMENTS",
              "EVERY_N_HOURS",
              "WEEKDAYS",
              "EVERY_N_DAYS",
              "MONTHLY",
            ] as TipoDeFrecuencia[]}
            turnos={turnos}
            momentos={momentos}
            onChange={setFrecuencia}
          />
        </div>
      )}

      <div className="mb-4">
        <p className="mb-1.5 text-[13px] text-slate-500">Quién lo registra</p>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => {
            const puesto = careRoleCodes.includes(r.code);
            return (
              <Pastilla
                key={r.code}
                activo={puesto}
                onClick={() =>
                  setCareRoleCodes(
                    puesto
                      ? careRoleCodes.filter((c) => c !== r.code)
                      : [...careRoleCodes, r.code],
                  )
                }
              >
                {r.name}
              </Pastilla>
            );
          })}
        </div>
      </div>

      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={!nombre.trim() || codigoPropuesto.length < 2 || careRoleCodes.length === 0}
          onClick={() => void guardar()}
        >
          Crear el control
        </PrimaryButton>
      </div>
    </Marco>
  );
}

/**
 * Las horas del desayuno, la comida, la merienda, la cena y la noche.
 *
 * Cambiar una mueve a qué hora «toca» todo lo que cuelga de ese momento
 * —las cuatro comidas y las dos medicaciones— **sin tocar ninguna línea de
 * plan**. Es la decisión de que los momentos sean del centro.
 *
 * El código no se edita y no está en la pantalla: es lo que referencian los
 * ajustes, las plantillas y cada línea de plan, y renombrarlo las dejaría
 * apuntando a un momento que no existe.
 */
function ModalMomentos({
  momentos,
  onClose,
  onHecho,
}: {
  momentos: MomentoDelDia[];
  onClose: () => void;
  onHecho: () => void;
}) {
  const [horas, setHoras] = useState<Record<string, string>>(
    Object.fromEntries(momentos.map((m) => [m.code, m.atTime])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      // Uno por uno y sólo los que cambian: son cinco peticiones como
      // mucho, y una ruta de «guardar los cinco» obligaría a decidir qué
      // pasa si el tercero falla.
      for (const m of momentos) {
        if (horas[m.code] === m.atTime) continue;
        await api(`/residencia/momentos/${m.code}`, {
          method: "PATCH",
          body: { atTime: horas[m.code] },
        });
      }
      onHecho();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Marco title="Momentos del día" onClose={onClose}>
      <p className="mb-4 text-[13px] text-slate-500">
        A qué hora se desayuna, se come, se merienda, se cena y se da la
        medicación de la noche. Lo que cuelga de un momento se mueve con él.
      </p>
      <ul className="space-y-2">
        {momentos.map((m) => (
          <li
            key={m.code}
            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-2.5"
          >
            <span className="min-w-0 flex-1 text-[14px] text-mipiace-ink">{m.name}</span>
            <input
              type="time"
              aria-label={`Hora de ${m.name}`}
              value={horas[m.code] ?? m.atTime}
              onChange={(e) => setHoras({ ...horas, [m.code]: e.target.value })}
              className="h-11 w-32 rounded-xl border border-slate-200 px-3 text-[14px] tabular-nums"
            />
          </li>
        ))}
      </ul>
      <FieldError message={error} />
      <div className="mt-4">
        <PrimaryButton type="button" busy={busy} onClick={() => void guardar()}>
          Guardar
        </PrimaryButton>
      </div>
    </Marco>
  );
}
