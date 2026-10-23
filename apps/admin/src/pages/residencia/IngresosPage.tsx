// historia-1 (D-94, D-96, D-97) · **LOS INGRESOS DEL CENTRO Y LOS DOS
// PLAZOS.**
//
// La pantalla de la dirección: qué ingresos tienen el expediente a medias
// y con qué plazos trabaja el centro.
//
// ── EL PLAZO DE LA BAJA NACE VACÍO, Y SE DICE POR QUÉ (D-96) ───────
//
// No hay un valor de serie. El plazo para comunicar una baja a la
// administración es **normativa autonómica**, y escribir «15 días» porque
// suena bien es prometer un plazo que puede no ser el de la Junta.
//
// Mientras no esté puesto, la obligación del alta **nace igual**: con la
// fecha del alta y marcada «periodicidad por verificar», que es lo que
// hace que la dirección la vea y la ajuste en vez de que no exista. La
// pantalla lo explica con esas palabras.
//
// ── Y CAMBIAR UN PLAZO NO MUEVE LO YA ESCRITO ─────────────────────
//
// El plazo del PAI de quien ya ingresó es el que había cuando ingresó:
// eso es lo que un inspector va a comparar con su fecha de ingreso.
// Cambiarlo retroactivamente dejaría expedientes con un plazo que nadie
// pudo conocer.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  PrimaryButton,
  TextField,
} from "../../ui.js";
import { fechaLarga, type IngresoDeUnResidente } from "./ficha-lib.js";

interface Plazos {
  diasDePai: number;
  diasParaComunicarLaBaja: number | null;
}

export function IngresosPage() {
  const [ingresos, setIngresos] = useState<IngresoDeUnResidente[] | null>(null);
  const [plazos, setPlazos] = useState<Plazos | null>(null);
  const [pai, setPai] = useState("");
  const [baja, setBaja] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    try {
      const [i, p] = await Promise.all([
        api<{ ingresos: IngresoDeUnResidente[] }>("/residencia/ingresos"),
        api<Plazos>("/residencia/ingresos/plazos"),
      ]);
      setIngresos(i.ingresos);
      setPlazos(p);
      setPai(String(p.diasDePai));
      setBaja(p.diasParaComunicarLaBaja == null ? "" : String(p.diasParaComunicarLaBaja));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
      setIngresos([]);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!ingresos || !plazos) return <CenteredLoader label="Cargando los ingresos…" />;

  async function guardarPlazos() {
    try {
      await api("/residencia/ingresos/plazos", {
        method: "PUT",
        body: {
          diasDePai: Number(pai),
          // La cadena vacía manda `null`, no se omite: volver a «no lo
          // sé» tiene que ser posible. Omitirlo dejaría el valor viejo.
          diasParaComunicarLaBaja: baja.trim() === "" ? null : Number(baja),
        },
      });
      setGuardado(true);
      setError(null);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  const conPendientes = ingresos.filter((i) => i.pendientes > 0);

  return (
    <AdminShell title="Ingresos">
      <p className="-mt-1 mb-5 text-[13.5px] text-slate-500">
        El expediente de cada residente, con lo que falta. La mitad de los
        elementos no se marcan: se comprueban cuando el dato existe.
      </p>

      {error && <FieldError message={error} />}

      {conPendientes.length === 0 ? (
        <p className="mb-7 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[13.5px] text-emerald-900">
          Todos los expedientes están completos.
        </p>
      ) : (
        <ul className="mb-7 space-y-2">
          {conPendientes.map((i) => (
            <li
              key={i.clientId}
              className={`rounded-2xl border px-4 py-3 text-[13.5px] ${
                i.vencidos > 0
                  ? "border-rose-300 bg-rose-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <Link
                  to={`/admin/residencia/residentes/${i.clientId}/ingreso`}
                  className="text-[15px] font-medium underline"
                >
                  {i.nombre}
                </Link>
                <span className="text-slate-500">
                  ingresó el {fechaLarga(i.ingreso)}
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12.5px] text-slate-700">
                  {i.pendientes} sin cerrar
                </span>
                {i.vencidos > 0 && (
                  <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[12.5px] text-rose-900">
                    {i.vencidos} con el plazo pasado
                  </span>
                )}
              </div>
              <p className="mt-1 text-slate-600">
                Falta:{" "}
                {i.elementos
                  .filter((e) => !e.hecho)
                  .slice(0, 5)
                  .map((e) => e.nombre)
                  .join(" · ")}
                {i.pendientes > 5 ? " …" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* ── LOS DOS PLAZOS DEL CENTRO ─────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="mb-1 text-[16px] font-semibold">Los plazos del centro</h2>
        <p className="mb-4 text-[13px] text-slate-500">
          Cambiarlos no mueve lo que ya está escrito: el plazo de quien ya
          ingresó es el que había cuando ingresó.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <TextField
            id="dias-de-pai"
            label="Días para el PAI inicial"
            inputMode="numeric"
            value={pai}
            onChange={setPai}
          />
          <TextField
            id="dias-de-baja"
            label="Días para comunicar una baja"
            inputMode="numeric"
            value={baja}
            onChange={setBaja}
            placeholder="sin confirmar"
          />
          <PrimaryButton onClick={() => void guardarPlazos()}>
            Guardar
          </PrimaryButton>
        </div>
        {plazos.diasParaComunicarLaBaja == null && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13.5px] text-amber-900">
            <strong>El plazo de la baja no está puesto</strong>, y el programa
            no se lo inventa: es normativa de cada comunidad autónoma.
            Mientras no esté, cada alta de una plaza concertada crea su
            obligación con la fecha del alta y marcada «periodicidad por
            verificar» — así se ve y se ajusta en vez de no existir.
          </p>
        )}
        {guardado && (
          <p className="mt-2 text-[13px] text-emerald-800">Plazos guardados.</p>
        )}
      </section>
    </AdminShell>
  );
}
