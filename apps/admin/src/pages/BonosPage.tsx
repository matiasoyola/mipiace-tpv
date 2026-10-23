// B-reservas-8 · LOS BONOS, en el panel del propietario.
//
// Cuatro cosas en una pantalla, en el orden en que hacen falta:
//
//   1. **LA NUMERACIÓN.** Lo primero, porque hasta que no se confirme por
//      qué número empieza el talonario **no se emite ningún bono**. Es el
//      candado de primer uso (`07` pieza 8): los centros que vienen de
//      papel siguen su numeración, y arrancar en 1 encima de un talonario
//      que va por el 230 es duplicar números en la vida real.
//   2. **Los ajustes del negocio**: la palabra que ve el centro, qué pasa
//      con la sesión de un no-show y la caducidad por defecto.
//   3. **Las plantillas**: qué productos del catálogo son bonos, cuántas
//      sesiones dan y qué cubren.
//   4. **El alta inicial**: los bonos que venían en papel, con su saldo y
//      su número.
//
// Lo que NO hay aquí, y es a propósito:
//
//   · **El interruptor del módulo.** Lo mueve sólo el super-admin, igual
//      que la caja, la clínica y la cocina: encenderlo es vender un
//      producto. Y además no se puede encender con Holded conectado.
//   · **El precio del bono.** Un bono es un producto normal y su precio se
//      edita en el catálogo. Si se pudiera editar en dos sitios habría dos
//      sitios donde mirar el IVA de un bono.
//   · **El modo de canje** (`LINEA_CERO` / `PRORRATEO`). Es el frente P5 de
//      la asesoría: se LEE y se dice de qué depende, pero no lo cambia el
//      propietario. Cambiarlo es decidir cómo declara su IVA.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Ticket, Trash2 } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import { useTenantCapabilities } from "../capabilities.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../ui.js";

interface Ajustes {
  etiqueta: string;
  noShow: "consumir" | "liberar";
  caducidadMeses: number | null;
  modoCanje: string;
}

interface Numeracion {
  candadoPuesto: boolean;
  arranque: number | null;
  confirmadoEl: string | null;
  ultimoEmitido: number;
  bonosEmitidos: number;
  siguienteSiConfirmas: string | null;
}

interface Plantilla {
  id: string;
  productId: string;
  sessions: number;
  coversServiceIds: string[];
  coversTagSlugs: string[];
  expiresMonths: number | null;
  producto: {
    nombre: string;
    sku: string | null;
    precioCents: number;
    taxRate: number;
    exemptionCause: string | null;
    activo: boolean;
  };
}

export function BonosPage() {
  const navigate = useNavigate();
  const caps = useTenantCapabilities();
  const [ajustes, setAjustes] = useState<Ajustes | null>(null);
  const [numeracion, setNumeracion] = useState<Numeracion | null>(null);
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // hotfix-menu-capabilities · lo que contestó la PUERTA del servidor. La
  // 404 del gate (`ensureBonosEnabled`) no es un error que contarle a
  // nadie: es «este negocio no tiene el módulo», y se pinta como tal.
  // Vive en su propio estado y no se deduce de `caps` porque las dos
  // respuestas pueden discrepar —`caps` cae a `bonos: false` cuando falla
  // la llamada de capacidades— y la que manda es la del servidor.
  const [sinModulo, setSinModulo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        api<{ ajustes: Ajustes; numeracion: Numeracion }>(
          "/admin/bonos/ajustes",
        ),
        api<{ plantillas: Plantilla[] }>("/admin/bonos/plantillas"),
      ]);
      setAjustes(a.ajustes);
      setNumeracion(a.numeracion);
      setPlantillas(p.plantillas);
      setSinModulo(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
        return;
      }
      // La 404 del gate del módulo. No es un fallo: es la respuesta.
      if (err instanceof ApiError && err.status === 404) {
        setSinModulo(true);
        setError(null);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudieron cargar los bonos.",
      );
    }
  }, [navigate]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El gate del módulo. La puerta de verdad es la del servidor —404— y
  // ésta es para que una cuenta a la que todavía no se le ha encendido lea
  // algo en vez de un error.
  //
  // hotfix-menu-capabilities · antes esta condición llevaba además
  // `error === null`, y ahí estaba el cuelgue: en una cuenta sin bonos la
  // carga contesta 404, el `catch` guardaba el error, el aviso se saltaba
  // por el `error === null` y el `return` de abajo dejaba «Cargando
  // bonos…» girando para siempre. Ahora la 404 se reconoce en el `catch`
  // (`sinModulo`) y el aviso se pinta por los DOS caminos: el que dice
  // `caps` y el que contestó el servidor.
  if (sinModulo || (caps?.bonos === false && ajustes === null)) {
    return (
      <AdminShell title="Bonos">
        <div className="bg-white rounded-2xl border border-slate-200 p-7 max-w-lg mx-auto text-center">
          <Ticket className="w-6 h-6 mx-auto mb-3 text-slate-300" />
          <p className="text-[14px] text-mipiace-ink-soft">
            Este negocio no tiene los bonos de sesiones encendidos. Lo
            enciende Mi Piace, y hoy sólo en cuentas que no facturan con
            Holded.
          </p>
        </div>
      </AdminShell>
    );
  }
  if (!ajustes || !numeracion || !plantillas) {
    // Y cualquier otro fallo —500, red caída— se cuenta aquí en vez de
    // esconderse detrás del cargador.
    return <CenteredLoader label="Cargando bonos…" error={error} />;
  }

  const etiqueta = ajustes.etiqueta;
  return (
    <AdminShell title="Bonos">
      <div className="max-w-3xl mx-auto space-y-5">
        {success && <SuccessBanner message={success} />}
        <FieldError message={error} />

        <Numeracion
          numeracion={numeracion}
          etiqueta={etiqueta}
          onHecho={async (msg) => {
            setSuccess(msg);
            setError(null);
            await cargar();
          }}
          onError={setError}
        />

        <AjustesDelNegocio
          ajustes={ajustes}
          onHecho={async (msg) => {
            setSuccess(msg);
            setError(null);
            await cargar();
          }}
          onError={setError}
        />

        <Plantillas plantillas={plantillas} etiqueta={etiqueta} />

        <AltaInicial
          etiqueta={etiqueta}
          onHecho={async (msg) => {
            setSuccess(msg);
            setError(null);
            await cargar();
          }}
          onError={setError}
        />
      </div>
    </AdminShell>
  );
}

// ─── 1 · LA NUMERACIÓN Y SU CANDADO ──────────────────────────────────

function Numeracion({
  numeracion,
  etiqueta,
  onHecho,
  onError,
}: {
  numeracion: Numeracion;
  etiqueta: string;
  onHecho: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [numero, setNumero] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmar() {
    setBusy(true);
    onError(null);
    try {
      await api("/admin/bonos/arranque", {
        method: "POST",
        body: { numero },
      });
      setNumero("");
      await onHecho(
        `Numeración confirmada. El primer ${etiqueta} saldrá con ese número.`,
      );
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : "No se pudo confirmar la numeración.",
      );
    } finally {
      setBusy(false);
    }
  }

  // Ya confirmado y con bonos emitidos: se enseña y no se toca. Cambiar el
  // arranque después renumeraría bonos que ya están en manos de clientas.
  if (!numeracion.candadoPuesto) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
          Numeración
        </h2>
        <p className="text-[13px] text-mipiace-ink-soft">
          Empieza por el <strong>{numeracion.arranque}</strong>. Lleva{" "}
          {numeracion.bonosEmitidos}{" "}
          {numeracion.bonosEmitidos === 1
            ? `${etiqueta} emitido`
            : `${etiqueta}s emitidos`}
          {numeracion.siguienteSiConfirmas
            ? `; el siguiente será el ${numeracion.siguienteSiConfirmas}`
            : ""}
          .
        </p>
        {numeracion.bonosEmitidos > 0 && (
          <p className="text-[12px] text-slate-500 mt-2">
            Ya no se puede cambiar: renumerar movería {etiqueta}s que están en
            manos de clientas.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl border-2 border-amber-300 bg-amber-50/40 p-5">
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
            Confirma por qué número empiezas
          </h2>
          <p className="text-[13px] text-mipiace-ink-soft mb-3">
            Hasta que lo confirmes <strong>no se emite ningún {etiqueta}</strong>
            : una venta que los incluya se cobrará igual, pero el {etiqueta} se
            quedará sin emitir. Si vienes de talonario de papel, escribe el
            número por el que vas; si empiezas de cero, escribe 1.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <TextField
                id="arranque"
                label="Número de arranque"
                value={numero}
                onChange={setNumero}
                inputMode="numeric"
                placeholder="por ejemplo 231, o B231"
              />
            </div>
            <PrimaryButton
              type="button"
              busy={busy}
              disabled={numero.trim().length === 0}
              onClick={() => void confirmar()}
              className="!w-auto px-5 mb-0.5"
            >
              Confirmar
            </PrimaryButton>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 2 · LOS AJUSTES DEL NEGOCIO ─────────────────────────────────────

function AjustesDelNegocio({
  ajustes,
  onHecho,
  onError,
}: {
  ajustes: Ajustes;
  onHecho: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [etiqueta, setEtiqueta] = useState(ajustes.etiqueta);
  const [noShow, setNoShow] = useState(ajustes.noShow);
  const [caducidad, setCaducidad] = useState(
    ajustes.caducidadMeses == null ? "" : String(ajustes.caducidadMeses),
  );
  const [busy, setBusy] = useState(false);

  async function guardar() {
    setBusy(true);
    onError(null);
    try {
      await api("/admin/bonos/ajustes", {
        method: "POST",
        body: {
          etiqueta: etiqueta.trim(),
          noShow,
          // Vacío = SIN CADUCIDAD, y hay que poder volver a eso: se manda
          // `null` explícito, que la ruta distingue de «no lo toques».
          caducidadMeses:
            caducidad.trim() === "" ? null : Number(caducidad.trim()),
        },
      });
      await onHecho("Ajustes guardados.");
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "No se pudieron guardar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <h2 className="text-[15px] font-semibold text-mipiace-ink">
        Cómo funcionan en tu negocio
      </h2>

      <TextField
        id="etiqueta"
        label="Cómo los llamas"
        value={etiqueta}
        onChange={setEtiqueta}
        placeholder="bono"
      />
      <p className="text-[12px] text-slate-500 -mt-2">
        La palabra que verán tus clientas y tu gente: «bono», «programa»,
        «abono»…
      </p>

      <div>
        <label className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
          Si la clienta no viene (no-show)
        </label>
        <div className="flex gap-2">
          {(
            [
              ["consumir", "Se gasta la sesión"],
              ["liberar", "La sesión vuelve"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setNoShow(v)}
              className={
                "flex-1 h-11 rounded-2xl border text-[13.5px] font-medium " +
                (noShow === v
                  ? "border-mipiace-coral bg-mipiace-coral/10 text-mipiace-coral-dark"
                  : "border-slate-200 text-mipiace-ink-soft hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-slate-500 mt-1.5">
          La hora se ha perdido igual. Decide tú si la sesión también.
        </p>
      </div>

      <TextField
        id="caducidad"
        label="Caducan a los… (meses)"
        value={caducidad}
        onChange={setCaducidad}
        inputMode="numeric"
        placeholder="déjalo vacío para que no caduquen"
      />
      <p className="text-[12px] text-slate-500 -mt-2">
        Meses de calendario: uno vendido el 31 de agosto con 6 meses caduca el
        28 de febrero, y ese día entero sigue valiendo. Un bono del catálogo
        puede tener su propia caducidad, y entonces manda la suya.
      </p>

      {/* El frente P5: se LEE y se dice de qué depende. */}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
        <div className="text-[12.5px] text-mipiace-ink-soft">
          Al canjear una sesión, la línea del servicio sale{" "}
          <strong>
            {ajustes.modoCanje === "PRORRATEO"
              ? "con su parte del precio"
              : "a 0 €"}
          </strong>
          .
        </div>
        <div className="text-[12px] text-slate-500 mt-1">
          Esto no se cambia desde aquí: depende de cómo tu asesoría declare el
          IVA de un bono, y lo configura Mi Piace cuando esa respuesta esté
          por escrito.
        </div>
      </div>

      <PrimaryButton type="button" busy={busy} onClick={() => void guardar()}>
        Guardar
      </PrimaryButton>
    </section>
  );
}

// ─── 3 · LAS PLANTILLAS ──────────────────────────────────────────────

function Plantillas({
  plantillas,
  etiqueta,
}: {
  plantillas: Plantilla[];
  etiqueta: string;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
        Qué {etiqueta}s vendes
      </h2>
      <p className="text-[13px] text-mipiace-ink-soft mb-3">
        Un {etiqueta} es un producto de tu catálogo con sesiones detrás. El
        precio y el IVA se editan en el catálogo, como cualquier otro
        producto: aquí sólo vive cuántas sesiones da y para qué vale.
      </p>
      {plantillas.length === 0 ? (
        <p className="text-[13px] text-slate-500">
          Todavía no hay ninguno. Se crean desde el catálogo de la agenda,
          marcando un producto como {etiqueta}.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {plantillas.map((p) => (
            <li key={p.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-[14px] text-mipiace-ink truncate">
                  {p.producto.nombre}
                </span>
                <span className="text-[13px] text-mipiace-ink-soft tabular-nums shrink-0">
                  {(p.producto.precioCents / 100).toFixed(2).replace(".", ",")} €
                </span>
              </div>
              <div className="text-[12.5px] text-slate-500 mt-0.5">
                {p.sessions} {p.sessions === 1 ? "sesión" : "sesiones"}
                {p.expiresMonths
                  ? ` · caduca a los ${p.expiresMonths} meses`
                  : " · sin caducidad"}
                {p.producto.exemptionCause ? " · exento" : ""}
                {!p.producto.activo ? " · oculto en el catálogo" : ""}
              </div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                Vale para{" "}
                {p.coversTagSlugs.length > 0
                  ? `la categoría ${p.coversTagSlugs.join(", ")}`
                  : ""}
                {p.coversTagSlugs.length > 0 && p.coversServiceIds.length > 0
                  ? " y "
                  : ""}
                {p.coversServiceIds.length > 0
                  ? `${p.coversServiceIds.length} ${
                      p.coversServiceIds.length === 1
                        ? "servicio"
                        : "servicios"
                    }`
                  : ""}
                .
              </div>
              {!p.producto.activo && (
                <div className="text-[12px] text-slate-500 mt-1">
                  Ocultarlo en el catálogo no invalida los que ya vendiste:
                  siguen canjeándose por lo que se vendieron.
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── 4 · EL ALTA INICIAL ─────────────────────────────────────────────

function AltaInicial({
  etiqueta,
  onHecho,
  onError,
}: {
  etiqueta: string;
  onHecho: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [clientId, setClientId] = useState("");
  const [nombre, setNombre] = useState("");
  const [sesiones, setSesiones] = useState("");
  const [categoria, setCategoria] = useState("");
  const [codigo, setCodigo] = useState("");
  const [caducidad, setCaducidad] = useState("");
  const [busy, setBusy] = useState(false);

  async function dar() {
    setBusy(true);
    onError(null);
    try {
      const res = await api<{ bono: { bono: { code: string } } }>(
        "/bonos/alta-inicial",
        {
          method: "POST",
          body: {
            clientId: clientId.trim(),
            nombre: nombre.trim(),
            sesiones: Number(sesiones.trim()),
            coversTagSlugs: categoria.trim() ? [categoria.trim()] : [],
            ...(codigo.trim() ? { codigo: codigo.trim() } : {}),
            ...(caducidad.trim()
              ? { caducidadMeses: Number(caducidad.trim()) }
              : {}),
          },
        },
      );
      setClientId("");
      setNombre("");
      setSesiones("");
      setCategoria("");
      setCodigo("");
      setCaducidad("");
      setAbierto(false);
      await onHecho(
        `Dado de alta el ${etiqueta} ${res.bono.bono.code} con las sesiones que quedaban.`,
      );
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : `No se pudo dar de alta el ${etiqueta}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!abierto) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="text-[15px] font-semibold text-mipiace-ink mb-1">
          {etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1)}s que venían en
          papel
        </h2>
        <p className="text-[13px] text-mipiace-ink-soft mb-3">
          Si ya vendías {etiqueta}s antes de usar el TPV, se dan de alta aquí
          con <strong>las sesiones que le queden</strong> —no con las que
          vendiste— y con el número del papel. No se crea ninguna venta: ese
          dinero entró por otro sitio.
        </p>
        <OutlineButton onClick={() => setAbierto(true)}>
          Dar de alta uno
        </OutlineButton>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <h2 className="text-[15px] font-semibold text-mipiace-ink">
        Dar de alta un {etiqueta} de papel
      </h2>
      {/* El id de la ficha se teclea: el buscador de clientas del panel es
          de otra pantalla y traerlo entero aquí no cabe en este bloque. Está
          dicho en el `-done` como lo que falta. */}
      <TextField
        id="clientId"
        label="Ficha de la clienta (id)"
        value={clientId}
        onChange={setClientId}
        placeholder="pégalo desde la ficha en el TPV"
      />
      <TextField
        id="nombre"
        label="Cómo se llama"
        value={nombre}
        onChange={setNombre}
        placeholder={`${etiqueta} de 5 quiropodias`}
      />
      <TextField
        id="sesiones"
        label="Sesiones que LE QUEDAN"
        value={sesiones}
        onChange={setSesiones}
        inputMode="numeric"
      />
      <TextField
        id="categoria"
        label="Categoría que cubre"
        value={categoria}
        onChange={setCategoria}
        placeholder="podologia"
      />
      <TextField
        id="codigo"
        label="Número del papel (opcional)"
        value={codigo}
        onChange={setCodigo}
        placeholder="si lo dejas vacío, se usa el siguiente de tu numeración"
      />
      <TextField
        id="caducidadAlta"
        label="Caduca a los… meses (opcional)"
        value={caducidad}
        onChange={setCaducidad}
        inputMode="numeric"
      />
      <div className="flex gap-2">
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={
            clientId.trim() === "" ||
            nombre.trim() === "" ||
            sesiones.trim() === "" ||
            categoria.trim() === ""
          }
          onClick={() => void dar()}
        >
          Dar de alta
        </PrimaryButton>
        <OutlineButton onClick={() => setAbierto(false)}>
          <Trash2 className="w-3.5 h-3.5" /> Cancelar
        </OutlineButton>
      </div>
    </section>
  );
}
