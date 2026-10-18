// residencia-4 (D-65, D-66, rama §10) · **LA GUARDIA DEL CENTRO Y LA
// PLANTILLA DE SERIE.**
//
// Dos mitades en una pantalla, y están juntas a propósito: «¿por qué sonó
// esto?» se contesta con las dos. Arriba, lo que el centro configura
// —minutos de escalado, destinatarios por nivel, servicio sanitario de
// guardia y los móviles emparejados—; abajo, la plantilla de gravedad
// **en solo lectura**.
//
// ── LA PLANTILLA NO SE EDITA, Y NO ES UN OLVIDO (D-65, D-21) ────────
//
// No hay botón. Los umbrales clínicos son estándar médico y un centro no
// los toca; lo único que los cambia es una excepción por residente
// firmada por la médica (D-22), que vive en la ficha del residente.
//
// Que se VEA sí hace falta, y por dos razones concretas: para que la
// dirección pueda enseñársela a su médica cuando pregunte, y para que
// cuando alguien diga «¿por qué sonó el móvil a las tres?», la respuesta
// esté escrita en una pantalla y no en la cabeza de nadie.
//
// ── Y LO QUE EL CENTRO SÍ TOCA ──────────────────────────────────────
//
// La frontera de la rama §10, literal: «motor de gravedad y de escalado»
// del producto, «destinatarios de cada nivel» del centro. Vaciar los
// destinatarios de un nivel lo deja sin aviso **a propósito**, y la
// pantalla lo dice con esas palabras en vez de impedirlo: un centro que
// decide que los N2 de noche no suenan en dirección está tomando una
// decisión suya, y lo que hace falta es que la vea escrita.

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../../ui.js";
import {
  colorDelNivel,
  fechaYHora,
  nombreDelCanal,
  type Canal,
  type ConfiguracionDeGuardia,
  type PlantillaDeGravedad,
} from "./incidencias-lib.js";

const CANALES: Canal[] = ["ENFERMERIA", "RESPONSABLE"];
const NIVELES_CON_AVISO = ["N2", "N3", "N4"] as const;

export function GuardiaPage() {
  const [config, setConfig] = useState<ConfiguracionDeGuardia | null>(null);
  const [plantilla, setPlantilla] = useState<PlantillaDeGravedad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<{ code: string; canal: Canal } | null>(
    null,
  );

  const recargar = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        api<ConfiguracionDeGuardia>("/residencia/guardia/configuracion"),
        api<PlantillaDeGravedad>("/residencia/plantilla-de-gravedad"),
      ]);
      setConfig(c);
      setPlantilla(p);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!config || !plantilla) {
    return error ? (
      <AdminShell title="Guardia">
        <FieldError message={error} />
      </AdminShell>
    ) : (
      <CenteredLoader label="Cargando la guardia…" />
    );
  }

  async function guardar(cambio: Partial<ConfiguracionDeGuardia>) {
    try {
      await api("/residencia/guardia/configuracion", {
        method: "PUT",
        body: {
          minutosDeEscalado: cambio.minutosDeEscalado,
          destinatarios: cambio.destinatarios,
          servicio: cambio.servicio,
        },
      });
      setGuardado("Guardado.");
      setTimeout(() => setGuardado(null), 2500);
      await recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  async function emparejar(canal: Canal) {
    try {
      const r = await api<{ code: string; canal: Canal }>(
        "/residencia/guardia/pairing-codes",
        { method: "POST", body: { canal } },
      );
      setCodigo(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }

  return (
    <AdminShell title="Guardia">
      <p className="-mt-2 mb-5 text-[13.5px] text-slate-500">
        A quién le suena cada aviso, en cuántos minutos escala y qué móviles
        están emparejados. Abajo, la plantilla de gravedad que trae el
        producto.
      </p>

      {error && <FieldError message={error} />}
      {guardado && <SuccessBanner message={guardado} />}

      {/* ── Los móviles ───────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            Móviles de guardia
          </h2>
          <div className="flex gap-2">
            {CANALES.map((c) => (
              <OutlineButton
                key={c}
                type="button"
                onClick={() => void emparejar(c)}
                className="!h-10 !w-auto !px-4 !text-[13.5px]"
              >
                <Plus className="h-4 w-4" /> {nombreDelCanal(c)}
              </OutlineButton>
            ))}
          </div>
        </div>

        {codigo && (
          <div className="mb-3 rounded-2xl border-2 border-mipiace-coral bg-white px-5 py-4">
            <p className="text-[13px] text-slate-500">
              Código para emparejar un móvil de {nombreDelCanal(codigo.canal)}.
              Caduca en una hora y se usa una vez.
            </p>
            <p className="mt-1 text-[40px] font-semibold tabular-nums tracking-[0.2em]">
              {codigo.code}
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              Instala la app en el móvil y teclea este código. El canal lo
              decide este código, no el teléfono.
            </p>
          </div>
        )}

        {config.moviles.length === 0 ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
            No hay ningún móvil de guardia emparejado:{" "}
            <strong>ahora mismo ningún aviso suena en ninguna parte.</strong>{" "}
            Lo que se registre queda en el libro y en el relevo.
          </p>
        ) : (
          <ul className="space-y-2">
            {config.moviles.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13.5px]"
              >
                <span className="font-medium">
                  {m.nombre ?? "Móvil sin nombre"}
                </span>
                <span className="text-slate-500">
                  {m.canal ? nombreDelCanal(m.canal) : "—"}
                </span>
                {m.revocado && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[12.5px] text-slate-500">
                    revocado
                  </span>
                )}
                {m.deGuardia ? (
                  <span className="text-emerald-800">
                    De guardia: {m.deGuardia.nombre} desde{" "}
                    {fechaYHora(m.deGuardia.desde)}
                  </span>
                ) : (
                  <span className="text-amber-700">nadie de guardia</span>
                )}
                <span className="ml-auto text-slate-400">
                  {m.vistoEn ? `visto ${fechaYHora(m.vistoEn)}` : "nunca visto"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── A quién le suena cada nivel ───────────────────────────── */}
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          A quién le suena
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">
          N0 y N1 no suenan nunca: N0 es constancia y N1 va al parte de
          relevo. Eso no se configura.
        </p>
        <div className="mt-3 space-y-3">
          {NIVELES_CON_AVISO.map((n) => (
            <div key={n} className="flex flex-wrap items-center gap-3">
              <span
                className={`w-10 rounded-md px-2 py-0.5 text-center text-[13px] font-semibold ${colorDelNivel(n)}`}
              >
                {n}
              </span>
              {CANALES.map((c) => {
                const puesto = config.destinatarios[n].includes(c);
                return (
                  <label
                    key={c}
                    className="flex items-center gap-2 text-[13.5px]"
                  >
                    <input
                      type="checkbox"
                      checked={puesto}
                      onChange={() => {
                        const destinatarios = {
                          ...config.destinatarios,
                          [n]: puesto
                            ? config.destinatarios[n].filter((x) => x !== c)
                            : [...config.destinatarios[n], c],
                        };
                        void guardar({ destinatarios });
                      }}
                    />
                    {nombreDelCanal(c)}
                  </label>
                );
              })}
              {config.destinatarios[n].length === 0 && (
                <span className="text-[13px] text-amber-700">
                  Un {n} no sonará en ningún móvil.
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-[13.5px] text-slate-600">
            Si nadie acusa en{" "}
            <input
              type="number"
              min={1}
              max={60}
              defaultValue={config.minutosDeEscalado}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 60 && v !== config.minutosDeEscalado) {
                  void guardar({ minutosDeEscalado: v });
                }
              }}
              className="mx-1 h-9 w-16 rounded-lg border border-slate-300 px-2 text-center tabular-nums"
            />
            minutos, el aviso pasa a dirección.
          </label>
          <span className="text-[13px] text-slate-400">
            Y si no hay nadie de guardia en enfermería, pasa al momento.
          </span>
        </div>
      </section>

      {/* ── El servicio sanitario de guardia (D-33) ───────────────── */}
      <ServicioSanitario config={config} onGuardar={guardar} />

      {/* ── La plantilla, en solo lectura ─────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-[16px] font-semibold text-mipiace-ink">
          Plantilla de gravedad{" "}
          <span className="font-normal text-slate-400">
            versión {plantilla.version}
            {plantilla.vigenteDesde
              ? ` · desde ${fechaYHora(plantilla.vigenteDesde)}`
              : ""}
          </span>
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">
          La trae el producto y no se edita aquí: los umbrales clínicos son
          estándar médico. Lo único que los cambia es una excepción para un
          residente concreto, que pauta la médica desde su ficha.
        </p>

        {plantilla.version === 0 && (
          <p className="mt-2 rounded-xl bg-red-50 px-4 py-3 text-[13.5px] text-red-800">
            No hay ninguna versión cargada: <strong>nada gradúa</strong>. Las
            constantes se registran y no abren incidencia. Avisa a Mi Piace.
          </p>
        )}

        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-[13.5px]">
            <thead className="bg-mipiace-stone text-left text-[12.5px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Qué</th>
                <th className="px-4 py-2">Cuándo</th>
                <th className="px-4 py-2">Nivel</th>
                <th className="px-4 py-2">Abre</th>
              </tr>
            </thead>
            <tbody>
              {plantilla.reglas.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {r.clase === "THRESHOLD" ? r.control : r.evento}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.clase === "THRESHOLD"
                      ? `${simbolo(r.comparador)} ${String(r.valor).replace(".", ",")}`
                      : (r.matiz ?? "—")}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[12.5px] font-semibold ${colorDelNivel(r.nivel)}`}
                    >
                      {r.nivel}
                    </span>{" "}
                    <span className="text-slate-500">{r.nombreDelNivel}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {r.nombreDelTipo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}

function simbolo(c: string | null): string {
  switch (c) {
    case "GTE":
      return "≥";
    case "GT":
      return ">";
    case "LTE":
      return "≤";
    case "LT":
      return "<";
    default:
      return "";
  }
}

function ServicioSanitario({
  config,
  onGuardar,
}: {
  config: ConfiguracionDeGuardia;
  onGuardar: (c: Partial<ConfiguracionDeGuardia>) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(config.servicio?.nombre ?? "");
  const [telefono, setTelefono] = useState(config.servicio?.telefono ?? "");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <h2 className="text-[16px] font-semibold text-mipiace-ink">
        Servicio sanitario de guardia
      </h2>
      <p className="mt-1 text-[13px] text-slate-500">
        En un N3 o un N4, el móvil de guardia muestra «Recomendado: llamar a
        …» con un botón que abre el marcador.{" "}
        <strong>La llamada la hace la persona</strong>: el sistema no llama
        ni escribe a nadie de fuera por su cuenta.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextField
          id="servicio-nombre"
          label="Nombre"
          value={nombre}
          onChange={setNombre}
          placeholder="Centro de Salud de Buenaventura"
        />
        <TextField
          id="servicio-telefono"
          label="Teléfono"
          value={telefono}
          onChange={setTelefono}
          inputMode="tel"
          placeholder="925 00 00 00"
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <OutlineButton
          type="button"
          onClick={() => {
            setNombre("");
            setTelefono("");
            void onGuardar({ servicio: null });
          }}
          className="!h-10 !w-auto !px-4 !text-[13.5px]"
        >
          Quitarlo
        </OutlineButton>
        <PrimaryButton
          type="button"
          disabled={nombre.trim() === "" || telefono.trim() === ""}
          onClick={() =>
            void onGuardar({
              servicio: { nombre: nombre.trim(), telefono: telefono.trim() },
            })
          }
          className="!h-10 !w-auto !px-4 !text-[13.5px]"
        >
          Guardar
        </PrimaryButton>
      </div>
    </section>
  );
}
