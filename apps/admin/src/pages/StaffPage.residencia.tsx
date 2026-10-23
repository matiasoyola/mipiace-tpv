// residencia-1 · LA SECCIÓN DE RESIDENCIA DE LA PANTALLA DE PERSONAL.
//
// En un fichero aparte y no dentro de `StaffPage.tsx`, igual que
// `StoreDetailPage.kitchen.tsx`: esa pantalla ya tiene 1.300 líneas y
// cuatro editores, y la sección de residencia es el quinto.
//
// Lo que decide esta sección es **quién ve a qué residente**, así que es la
// misma clase de decisión que la sección clínica de al lado y la toma el
// mismo: el OWNER. El servidor lo impone (`requireOwner` en las rutas de
// escritura); aquí el encargado ve y no toca.
//
// ── Dos cosas, y van juntas ──────────────────────────────────────────
//
//   · Los ROLES DE CUIDADO, varios a la vez y con vigencia. Una persona
//     puede ser TO y Calidad (decisión de producto 3).
//   · La ZONA: todo el centro, unas plantas, o ninguna.
//
// Y un resumen de lo que la función de acceso contestaría hoy («ve todo el
// centro», «ve la planta 1», «sin rol de cuidado»), que lo calcula LA API
// y no esta pantalla: deducirlo aquí sería una segunda copia de la regla, y
// el día que se separaran, la pantalla diría que la auxiliar ve a su gente
// y la ficha le diría que no.
//
// ── «Revocar no borra nada» ──────────────────────────────────────────
//
// Se dice con esas palabras, igual que en la lista de pacientes de
// clinica-1, porque es verdad y porque quien lo lee necesita saberlo antes
// de pulsar: la asignación revocada es la capacidad con la que esa persona
// firmó lo que firmó.

import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { api, ApiError } from "../api.js";
import { OutlineButton } from "../ui.js";
import { CATEGORIA_LABEL, type RolDeCuidado } from "./residencia/lib.js";

interface AsignacionDeRol {
  id: string;
  rol: RolDeCuidado;
  desde: string;
  hasta: string | null;
  revocado: string | null;
  vigente: boolean;
}

interface ZonaAsignada {
  id: string;
  floorId: string | null;
  floorName: string | null;
  desde: string;
  hasta: string | null;
  vigente: boolean;
}

interface CuidadoDelProfesional {
  esSanitario: boolean;
  colegiado: string | null;
  roles: AsignacionDeRol[];
  zonas: ZonaAsignada[];
  alcance: "SIN_ROL" | "CENTRO" | "ZONA";
  /** residencia-3 · `null` = no tiene PIN de puerta. **El PIN no llega
   *  aquí**: ni entero, ni parcial, ni su hash. Sólo si hay uno, desde
   *  cuándo, cuántas cifras tiene y si se quedó corto (residencia-6,
   *  D-68). */
  pinDePuerta?: {
    desde: string;
    largo?: number;
    porRenovar?: boolean;
  } | null;
  /** residencia-6 (D-68) · cuántas cifras le tocan por su alcance de
   *  ahora: 4 por zona, 6 si tiene algún rol que ve todo el centro. Lo
   *  calcula la API para que la pantalla no vuelva a escribir la regla. */
  largoDePinRequerido?: number;
}

const ALCANCE_FRASE: Record<CuidadoDelProfesional["alcance"], string> = {
  SIN_ROL: "Sin rol de cuidado vigente: no ve a ningún residente.",
  CENTRO: "Ve a los residentes de todo el centro.",
  ZONA: "Ve a los residentes de su zona.",
};

export function CuidadoEditor({
  userId,
  canEdit,
  onError,
}: {
  userId: string;
  canEdit: boolean;
  onError: (m: string | null) => void;
}) {
  const [cuidado, setCuidado] = useState<CuidadoDelProfesional | null>(null);
  const [roles, setRoles] = useState<RolDeCuidado[] | null>(null);
  const [plantas, setPlantas] = useState<
    Array<{ id: string; name: string }> | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [añadiendo, setAñadiendo] = useState("");
  const [colegiado, setColegiado] = useState("");

  async function recargar() {
    try {
      const [c, cat, edificio] = await Promise.all([
        api<CuidadoDelProfesional>(`/residencia/staff/${userId}/cuidado`),
        api<{ roles: RolDeCuidado[] }>("/residencia/roles-de-cuidado"),
        api<{ plantas: Array<{ id: string; name: string }> }>(
          "/residencia/edificio",
        ),
      ]);
      setCuidado(c);
      setRoles(cat.roles.filter((r) => r.active));
      setPlantas(edificio.plantas.map((p) => ({ id: p.id, name: p.name })));
      onError(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  // La sección se pide al desplegar la tarjeta, no al cargar la pantalla:
  // un centro con veinte personas haría veinte peticiones de golpe. Mismo
  // criterio que la lista de pacientes de un sanitario en clinica-1.
  useEffect(() => {
    void recargar();
  }, [userId]);

  if (!cuidado || !roles || !plantas) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando residencia…
      </div>
    );
  }

  const vigentes = cuidado.roles.filter((r) => r.vigente);
  const historico = cuidado.roles.filter((r) => !r.vigente);
  const yaTiene = new Set(vigentes.map((r) => r.rol.id));
  const disponibles = roles.filter((r) => !yaTiene.has(r.id));
  const rolElegido = roles.find((r) => r.id === añadiendo) ?? null;
  const zonasVigentes = cuidado.zonas.filter((z) => z.vigente);
  const esCentro = zonasVigentes.some((z) => z.floorId == null);
  const plantasVigentes = new Set(
    zonasVigentes.map((z) => z.floorId).filter((id): id is string => id != null),
  );

  async function darRol() {
    if (!añadiendo) return;
    setBusy(true);
    try {
      await api(`/residencia/staff/${userId}/roles-de-cuidado`, {
        method: "POST",
        body: {
          careRoleId: añadiendo,
          ...(colegiado.trim() ? { colegiado: colegiado.trim() } : {}),
        },
      });
      setAñadiendo("");
      setColegiado("");
      await recargar();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function revocar(asignacionId: string) {
    setBusy(true);
    try {
      await api(
        `/residencia/staff/${userId}/roles-de-cuidado/${asignacionId}`,
        { method: "DELETE" },
      );
      await recargar();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function guardarZona(
    alcance: "CENTRO" | "PLANTAS" | "NINGUNA",
    floorIds: string[] = [],
  ) {
    setBusy(true);
    try {
      await api(`/residencia/staff/${userId}/zona`, {
        method: "PUT",
        body: { alcance, ...(alcance === "PLANTAS" ? { floorIds } : {}) },
      });
      await recargar();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  function alternarPlanta(floorId: string) {
    const siguiente = new Set(plantasVigentes);
    if (siguiente.has(floorId)) siguiente.delete(floorId);
    else siguiente.add(floorId);
    if (siguiente.size === 0) void guardarZona("NINGUNA");
    else void guardarZona("PLANTAS", [...siguiente]);
  }

  // El nº de colegiado hace falta ANTES de llegar al 400, igual que en la
  // sección clínica: se pide sólo si el rol elegido lo exige y la persona
  // no lo tiene ya guardado.
  const pideColegiado =
    rolElegido?.requiresLicense === true && !cuidado.colegiado;

  return (
    <div>
      <h4 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-slate-400">
        Residencia
      </h4>
      <p className="mb-3 text-[13px] text-slate-500">
        {ALCANCE_FRASE[cuidado.alcance]}
      </p>

      {/* ── Los roles vigentes ──────────────────────────────────────── */}
      <p className="mb-1.5 text-[13px] text-slate-500">Roles de cuidado</p>
      {vigentes.length === 0 ? (
        <p className="mb-3 text-[13px] text-slate-400">Ninguno.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {vigentes.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-[13.5px] text-mipiace-ink">
                {a.rol.name}
                <span className="ml-2 text-[12px] text-slate-400">
                  {CATEGORIA_LABEL[a.rol.category] ?? a.rol.category}
                  {a.rol.fullScope && " · todo el centro"}
                </span>
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void revocar(a.id)}
                  disabled={busy}
                  aria-label={`Revocar ${a.rol.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && disponibles.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <select
              value={añadiendo}
              onChange={(e) => setAñadiendo(e.target.value)}
              aria-label="Rol de cuidado"
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-[13.5px]"
            >
              <option value="">Añadir rol de cuidado…</option>
              {disponibles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <OutlineButton
              onClick={() => void darRol()}
              busy={busy}
              disabled={!añadiendo || (pideColegiado && !colegiado.trim())}
              className="!px-3"
            >
              <Plus className="h-4 w-4" />
            </OutlineButton>
          </div>
          {pideColegiado && (
            <div>
              <input
                value={colegiado}
                onChange={(e) => setColegiado(e.target.value)}
                placeholder="Nº de colegiado"
                aria-label="Nº de colegiado"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13.5px]"
              />
              <p className="mt-1 text-[12.5px] text-slate-500">
                «{rolElegido?.name}» es una profesión con colegio: el número va
                en la historia y en lo que firme.
              </p>
            </div>
          )}
        </div>
      )}

      {historico.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer text-[12.5px] text-slate-400">
            {historico.length} rol{historico.length === 1 ? "" : "es"} anterior
            {historico.length === 1 ? "" : "es"} · revocar no borra nada
          </summary>
          <ul className="mt-1.5 space-y-1 text-[12.5px] text-slate-500">
            {historico.map((a) => (
              <li key={a.id}>
                {a.rol.name} ·{" "}
                {new Date(a.desde).toLocaleDateString("es-ES")} →{" "}
                {a.revocado
                  ? new Date(a.revocado).toLocaleDateString("es-ES")
                  : a.hasta
                    ? new Date(a.hasta).toLocaleDateString("es-ES")
                    : "—"}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── La zona ─────────────────────────────────────────────────── */}
      <p className="mb-1.5 text-[13px] text-slate-500">Zona</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => void guardarZona("CENTRO")}
          className={`min-h-[44px] rounded-xl border px-4 text-[13.5px] transition-colors disabled:opacity-50 ${
            esCentro
              ? "border-mipiace-coral bg-mipiace-coral/10 font-medium text-mipiace-ink"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Todo el centro
        </button>
        {plantas.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!canEdit || busy}
            onClick={() => alternarPlanta(p.id)}
            className={`min-h-[44px] rounded-xl border px-4 text-[13.5px] transition-colors disabled:opacity-50 ${
              !esCentro && plantasVigentes.has(p.id)
                ? "border-mipiace-coral bg-mipiace-coral/10 font-medium text-mipiace-ink"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {plantas.length === 0 && (
        <p className="mt-1.5 text-[12.5px] text-slate-400">
          Todavía no hay plantas. Créalas en Edificio.
        </p>
      )}
      {/* Los roles de alcance total no necesitan zona, y decirlo evita que
          la dirección le marque plantas a la DUE pensando que hace falta. */}
      {vigentes.some((v) => v.rol.fullScope) && (
        <p className="mt-1.5 text-[12.5px] text-slate-500">
          Su rol ya ve todo el centro: la zona no le hace falta.
        </p>
      )}

      <PinDePuerta
        userId={userId}
        canEdit={canEdit}
        tienePin={cuidado.pinDePuerta ?? null}
        puedeTenerlo={vigentes.some((v) => v.rol.recordsCare)}
        largoRequerido={cuidado.largoDePinRequerido ?? 4}
        onError={onError}
        onCambio={() => void recargar()}
      />
    </div>
  );
}

/**
 * residencia-3 · **EL PIN DE LA PUERTA.**
 *
 * Va aquí, debajo de los roles y la zona, y no en una pantalla propia:
 * **es la tercera mitad de la misma decisión**. Los roles dicen qué puede
 * registrar, la zona a quién, y el PIN es con qué entra. Las tres las
 * decide el OWNER (decisión 6 de residencia-1, D-61) y las tres se tocan
 * seguidas el día que entra alguien nuevo.
 *
 * ── Lo que esta pantalla NO hace ────────────────────────────────────
 *
 * **No enseña el PIN.** Ni entero, ni parcial, ni su hash. Si alguien lo
 * olvida se le pone otro; no hay «ver el PIN» porque eso convertiría la
 * pantalla de Personal en el sitio desde el que se puede firmar como
 * cualquiera.
 *
 * Y **no dice de quién es un PIN repetido**. El servidor contesta «ese PIN
 * ya lo tiene otra persona» sin decir quién, porque decirlo sería regalar
 * el PIN de alguien a quien tiene acceso a esta pantalla.
 */
function PinDePuerta({
  userId,
  canEdit,
  tienePin,
  puedeTenerlo,
  largoRequerido,
  onError,
  onCambio,
}: {
  userId: string;
  canEdit: boolean;
  tienePin: { desde: string; largo?: number; porRenovar?: boolean } | null;
  /** `false` = no tiene ningún rol de cuidado que REGISTRE, así que su PIN
   *  no abriría ninguna puerta. Se dice aquí, donde se arregla. */
  puedeTenerlo: boolean;
  /** residencia-6 (D-68) · 4 o 6, según su alcance. */
  largoRequerido: number;
  onError: (m: string | null) => void;
  onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function guardar() {
    setBusy(true);
    onError(null);
    try {
      await api(`/residencia/personal/${userId}/pin-de-puerta`, {
        method: "PUT",
        body: { pin },
      });
      setPin("");
      setAbierto(false);
      onCambio();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function quitar() {
    setBusy(true);
    onError(null);
    try {
      await api(`/residencia/personal/${userId}/pin-de-puerta`, {
        method: "DELETE",
      });
      onCambio();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <p className="mb-1.5 text-[13px] text-slate-500">PIN de la puerta</p>
      <p className="mb-2 text-[12.5px] text-slate-500">
        Con esto entra en la tablet de una habitación y firma lo que
        registra. Es otro que el PIN del TPV.{" "}
        {/* residencia-6 (D-68) · cuántas cifras le tocan, dicho ANTES de
            que teclee. Decírselo después, con un 409, es hacerle teclear
            dos veces. */}
        {puedeTenerlo &&
          (largoRequerido === 6
            ? "Su rol ve todo el centro: el PIN tiene que ser de 6 cifras."
            : "Son 4 cifras.")}
      </p>
      {/* Y el aviso de lo que está mal AHORA MISMO: tiene PIN de 4 y un
          rol que lo ve todo, así que ese PIN no le abre la puerta, ni la
          sala, ni el móvil de guardia. En ámbar y no en rojo porque no es
          un fallo del sistema: es una configuración a medio terminar, y
          se arregla aquí mismo. */}
      {tienePin?.porRenovar && (
        <p
          role="alert"
          className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800"
        >
          Su PIN es de {tienePin.largo ?? 4} cifras y su rol ve todo el
          centro: <strong>está por renovar y ahora no entra en ningún
          sitio</strong>. Ponle uno de 6 cifras.
        </p>
      )}
      {!puedeTenerlo ? (
        <p className="text-[13px] text-slate-400">
          Dale primero un rol de cuidado que registre: sin él, su PIN no
          abriría ninguna puerta.
        </p>
      ) : tienePin && !abierto ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] text-mipiace-ink">
            Tiene PIN de {tienePin.largo ?? 4} cifras desde el{" "}
            {new Date(tienePin.desde).toLocaleDateString("es-ES")}
          </span>
          {canEdit && (
            <>
              <OutlineButton onClick={() => setAbierto(true)} disabled={busy}>
                Cambiarlo
              </OutlineButton>
              <OutlineButton onClick={() => void quitar()} disabled={busy}>
                Quitarlo
              </OutlineButton>
            </>
          )}
        </div>
      ) : !canEdit ? (
        <p className="text-[13px] text-slate-400">Sin PIN de puerta.</p>
      ) : abierto ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder={`${largoRequerido} cifras`}
            aria-label="PIN de la puerta"
            className="h-11 w-28 rounded-xl border border-slate-200 px-3 text-[13.5px] tabular-nums"
          />
          <OutlineButton
            onClick={() => void guardar()}
            disabled={busy || pin.length < largoRequerido}
          >
            Guardar
          </OutlineButton>
          <OutlineButton
            onClick={() => {
              setAbierto(false);
              setPin("");
            }}
          >
            Cancelar
          </OutlineButton>
        </div>
      ) : (
        <OutlineButton onClick={() => setAbierto(true)} disabled={busy}>
          <Plus className="h-4 w-4" /> Ponerle un PIN
        </OutlineButton>
      )}
    </div>
  );
}
