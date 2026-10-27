// personal-1 (decisión 2) · LA FICHA DE UNA PERSONA.
//
// Once campos, la banda de arriba con lo que falta —y **cada dato es un
// enlace que lleva al campo y lo enfoca**, que es el filtro «¿y qué?» de
// alta-minima aplicado aquí— y lo que la ficha ENSEÑA de las otras dos
// «personas» del sistema cuando están vinculadas.
//
// El DNI y el nº de afiliación se piden y se enseñan en claro **sólo en
// esta pantalla**, que es la única ruta que los descifra. Se guardan
// cifrados; de la base no se pueden leer sin la clave del centro.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, HeartHandshake, Lock } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  PrimaryButton,
  SuccessBanner,
} from "../../ui.js";
import type { CategoriaRow, FichaResponse, PersonalResponse } from "./lib.js";

/** De qué campo de la ficha es cada dato que puede faltar. Es lo que hace
 *  que el enlace de la banda enfoque el input que lo arregla. */
const CAMPO_A_INPUT: Record<string, string> = {
  apellidos: "lastName",
  dni: "dni",
  afiliacion: "afiliacion",
  categoria: "categoryId",
  jornadaSemanal: "weeklyHours",
  fechaDeAlta: "hiredOn",
  finPrevisto: "contractEndsOn",
  tipoDeContrato: "contractKind",
  telefono: "phone",
  email: "email",
};

interface Formulario {
  name: string;
  lastName: string;
  dni: string;
  afiliacion: string;
  categoryId: string;
  weeklyHours: string;
  contractKind: string;
  hiredOn: string;
  contractEndsOn: string;
  phone: string;
  email: string;
}

function deLaFicha(f: FichaResponse["ficha"]): Formulario {
  return {
    name: f.name,
    lastName: f.lastName ?? "",
    dni: f.dni ?? "",
    afiliacion: f.afiliacion ?? "",
    categoryId: f.categoryId ?? "",
    weeklyHours:
      f.weeklyMinutes == null
        ? ""
        : String(Math.round((f.weeklyMinutes / 60) * 100) / 100).replace(".", ","),
    contractKind: f.contractKind ?? "",
    hiredOn: f.hiredOn ?? "",
    contractEndsOn: f.contractEndsOn ?? "",
    phone: f.phone ?? "",
    email: f.email ?? "",
  };
}

export function FichaPersonalPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<FichaResponse | null>(null);
  const [categorias, setCategorias] = useState<CategoriaRow[]>([]);
  const [form, setForm] = useState<Formulario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campos = useRef<Record<string, HTMLElement | null>>({});

  const cargar = useCallback(() => {
    if (!id) return;
    Promise.all([
      api<FichaResponse>(`/admin/fichaje/personal/${id}`),
      api<PersonalResponse>("/admin/fichaje/personal"),
    ])
      .then(([ficha, lista]) => {
        setData(ficha);
        setForm(deLaFicha(ficha.ficha));
        setCategorias(lista.categorias);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Error inesperado"),
      );
  }, [id]);

  useEffect(cargar, [cargar]);

  function enfocar(campo: string) {
    const nombre = CAMPO_A_INPUT[campo];
    if (!nombre) return;
    const el = campos.current[nombre];
    // **El foco PRIMERO y el desplazamiento después, y éste guardado.**
    // Al revés, un `scrollIntoView` que no existe —jsdom no lo
    // implementa, y algún WebView viejo tampoco— revienta antes de
    // enfocar, y el enlace de la banda deja de llevar a ningún sitio sin
    // que nada lo diga. Lo encontró el banco de pantallas.
    (el as HTMLInputElement | null)?.focus();
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  async function guardar() {
    if (!form || !id) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      // El cuerpo lleva `null` donde el campo está vacío: eso BORRA, que
      // es lo que hace falta para quitar un teléfono mal tecleado. El
      // servidor distingue `null` («quítalo») de ausente («no me has
      // dicho nada»).
      const vacioANull = (v: string) => (v.trim() === "" ? null : v.trim());
      const horas = form.weeklyHours.replace(",", ".").trim();
      const res = await api<FichaResponse>(`/admin/fichaje/personal/${id}`, {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          lastName: vacioANull(form.lastName),
          dni: vacioANull(form.dni),
          afiliacion: vacioANull(form.afiliacion),
          categoryId: vacioANull(form.categoryId),
          weeklyHours: horas === "" ? null : Number(horas),
          contractKind: vacioANull(form.contractKind),
          hiredOn: vacioANull(form.hiredOn),
          contractEndsOn: vacioANull(form.contractEndsOn),
          phone: vacioANull(form.phone),
          email: vacioANull(form.email),
        },
      });
      setData((d) => (d ? { ...d, ficha: res.ficha } : d));
      setForm(deLaFicha(res.ficha));
      setOk(
        res.ficha.estado.incompleta
          ? `Guardado. Siguen faltando ${res.ficha.estado.faltan.length} dato(s).`
          : "Guardado. La ficha está completa.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setGuardando(false);
    }
  }

  if (error && !data) {
    return (
      <AdminShell title="Ficha">
        <FieldError message={error} />
      </AdminShell>
    );
  }
  if (!data || !form) return <CenteredLoader label="Cargando…" />;

  const { ficha, vinculo } = data;
  const esTemporal = form.contractKind === "TEMPORAL";

  const texto = (
    nombre: keyof Formulario,
    etiqueta: string,
    extra: { tipo?: string; ayuda?: string; placeholder?: string } = {},
  ) => (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-slate-600">
        {etiqueta}
      </span>
      <input
        ref={(el) => {
          campos.current[nombre] = el;
        }}
        type={extra.tipo ?? "text"}
        value={form[nombre]}
        placeholder={extra.placeholder}
        onChange={(e) =>
          setForm((f) => (f ? { ...f, [nombre]: e.target.value } : f))
        }
        className="h-11 w-full rounded-xl border border-slate-300 px-3 text-[14.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
      />
      {extra.ayuda && (
        <span className="mt-1 block text-[11.5px] text-slate-400">
          {extra.ayuda}
        </span>
      )}
    </label>
  );

  return (
    <AdminShell title="Ficha">
      <Link
        to="/admin/fichaje/personal"
        className="-mt-2 mb-4 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-mipiace-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Toda la plantilla
      </Link>

      {/* ── LA BANDA ──────────────────────────────────────────────────
          Se va sola cuando la ficha está completa. Cada dato es un enlace
          que enfoca el campo: el aviso tiene que llevar a arreglarlo con
          un toque, no sólo decir que falta. */}
      {ficha.estado.incompleta && (
        <div
          className={`mb-5 rounded-2xl border px-4 py-3.5 ${
            ficha.estado.conImprescindibles
              ? "border-mipiace-coral/30 bg-mipiace-coral-soft"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className="text-[14px] text-mipiace-ink">
            <span className="font-medium">A esta ficha le falta</span>
            {ficha.estado.faltan.length === 1 ? ": " : "n: "}
            {ficha.estado.faltan.map((d, i) => (
              <span key={d.campo}>
                {i > 0 && ", "}
                <button
                  type="button"
                  onClick={() => enfocar(d.campo)}
                  className="underline decoration-slate-400 hover:decoration-mipiace-ink"
                >
                  {d.etiqueta}
                </button>
                {d.peso === "RECOMENDABLE" && (
                  <span className="text-slate-500"> (recomendable)</span>
                )}
              </span>
            ))}
          </p>
        </div>
      )}

      {ok && <SuccessBanner message={ok} />}
      {error && <FieldError message={error} />}

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {texto("name", "Nombre")}
          {texto("lastName", "Apellidos")}

          {/* Los dos cifrados, con su candado: quien rellena la ficha
              tiene que saber que esto no se guarda como lo demás. */}
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              DNI o NIE
            </span>
            <input
              ref={(el) => {
                campos.current.dni = el;
              }}
              value={form.dni}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, dni: e.target.value } : f))
              }
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-[14.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
            />
            <span className="mt-1 block text-[11.5px] text-slate-400">
              Se guarda cifrado: de la base de datos no se puede leer sin la
              clave de este centro.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-slate-600">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              Nº de afiliación a la Seguridad Social
            </span>
            <input
              ref={(el) => {
                campos.current.afiliacion = el;
              }}
              value={form.afiliacion}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, afiliacion: e.target.value } : f))
              }
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-[14.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
            />
            <span className="mt-1 block text-[11.5px] text-slate-400">
              También cifrado.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">
              Categoría profesional
            </span>
            <select
              ref={(el) => {
                campos.current.categoryId = el;
              }}
              value={form.categoryId}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, categoryId: e.target.value } : f))
              }
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[14.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
            >
              <option value="">Sin poner</option>
              {categorias
                .filter((c) => c.active !== false || c.id === form.categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.countsAsDirectCare ? " · atención directa" : ""}
                  </option>
                ))}
            </select>
            <span className="mt-1 block text-[11.5px] text-slate-400">
              De la categoría depende si esta persona cuenta en la ratio de
              atención directa y en la cobertura de su turno.
            </span>
          </label>

          {texto("weeklyHours", "Jornada contratada", {
            ayuda: "Horas a la semana. «37,5» o «40».",
            placeholder: "37,5",
          })}

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">
              Tipo de contrato
            </span>
            <select
              ref={(el) => {
                campos.current.contractKind = el;
              }}
              value={form.contractKind}
              onChange={(e) =>
                setForm((f) =>
                  f
                    ? {
                        ...f,
                        contractKind: e.target.value,
                        // Pasar a indefinido quita la fecha de fin: la base
                        // no admite las dos cosas, y dejar el campo puesto
                        // haría que guardar diera un 400 que no se entiende.
                        contractEndsOn:
                          e.target.value === "TEMPORAL" ? f.contractEndsOn : "",
                      }
                    : f,
                )
              }
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-[14.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
            >
              <option value="">Sin poner</option>
              <option value="INDEFINIDO">Indefinido</option>
              <option value="TEMPORAL">Temporal</option>
            </select>
          </label>

          {texto("hiredOn", "Fecha de alta", { tipo: "date" })}

          {/* Sólo en los temporales, como la base. */}
          {esTemporal ? (
            texto("contractEndsOn", "Fecha de fin prevista", {
              tipo: "date",
              ayuda:
                "A quince días de esta fecha, el panel avisa de que el contrato se acaba.",
            })
          ) : (
            <div className="rounded-xl bg-mipiace-stone px-3 py-2.5 text-[12.5px] text-slate-500 sm:self-end">
              La fecha de fin prevista es sólo de los contratos temporales.
            </div>
          )}

          {texto("phone", "Teléfono", { tipo: "tel" })}
          {texto("email", "Email", { tipo: "email" })}
        </div>

        <div className="mt-5 sm:max-w-[220px]">
          <PrimaryButton type="button" onClick={guardar} busy={guardando}>
            Guardar
          </PrimaryButton>
        </div>
      </div>

      {/* ── LO QUE LA FICHA ENSEÑA, Y NO MUEVE (decisión 1) ───────────── */}
      {vinculo && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-mipiace-ink">
            <HeartHandshake className="h-4 w-4 text-slate-400" />
            Esta persona además entra al programa
          </h2>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Su cuenta es {vinculo.nombre ?? "—"}
            {vinculo.rol ? ` (${vinculo.rol})` : ""}. Lo de abajo se configura
            en sus pantallas y aquí sólo se enseña.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[12px] font-medium text-slate-500">
                Roles de cuidado vigentes
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-mipiace-ink">
                {vinculo.rolesDeCuidado.length === 0
                  ? "Ninguno"
                  : vinculo.rolesDeCuidado.map((r) => r.name).join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] font-medium text-slate-500">
                Perfil de agenda
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-mipiace-ink">
                {vinculo.perfilDeAgenda
                  ? `${vinculo.perfilDeAgenda.displayName}${vinculo.perfilDeAgenda.active ? "" : " (inactivo)"}`
                  : "No atiende citas"}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </AdminShell>
  );
}
