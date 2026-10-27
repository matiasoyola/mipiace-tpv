// personal-1 (decisión 3) · IMPORTAR LA PLANTILLA DESDE UN CSV.
//
// Dos pasos y una pantalla: se pega (o se suelta) el fichero, se ve **fila
// a fila qué va a pasar** y se aplica. La vista previa no es un adorno: es
// lo que convierte «importar 21 fichas» en una decisión en vez de una
// apuesta.
//
// Lo que esta pantalla NO hace: entender el fichero. Eso lo hace el
// servidor con la misma función pura que decide la idempotencia, así que
// lo que se enseña aquí es exactamente lo que se va a escribir. Si la
// pantalla parseara por su cuenta, mentiría en los casos raros — que son
// los que nadie prueba a mano.

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileUp, TriangleAlert } from "lucide-react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import {
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
} from "../../ui.js";
import { COLUMNAS_LEGIBLES } from "./importar-lib.js";

interface CambioDeCampo {
  campo: string;
  antes: string | null;
  despues: string;
}

interface Accion {
  linea: number;
  nombreCompleto: string;
  que: "COMPLETAR" | "SIN_CAMBIOS" | "CREAR" | "ERROR";
  employeeId: string | null;
  casaCon: string | null;
  cambios: CambioDeCampo[];
  motivo?: string;
}

interface VistaPrevia {
  separador: string;
  columnas: string[];
  maxFilas: number;
  acciones: Accion[];
  resumen: {
    completar: number;
    sinCambios: number;
    crear: number;
    errores: number;
  };
  errores: Array<{ linea: number; mensaje: string }>;
}

export function ImportarPersonalPage() {
  const [csv, setCsv] = useState("");
  const [previa, setPrevia] = useState<VistaPrevia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const fichero = useRef<HTMLInputElement>(null);

  async function verPrevia(texto = csv) {
    setCargando(true);
    setError(null);
    setHecho(null);
    try {
      setPrevia(
        await api<VistaPrevia>("/admin/fichaje/personal/importar/vista-previa", {
          method: "POST",
          body: { csv: texto },
        }),
      );
    } catch (err) {
      setPrevia(null);
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setCargando(false);
    }
  }

  async function aplicar() {
    setCargando(true);
    setError(null);
    try {
      const r = await api<{
        creadas: number;
        completadas: number;
        sinCambios: number;
      }>("/admin/fichaje/personal/importar", {
        method: "POST",
        body: { csv },
      });
      setHecho(
        [
          r.completadas > 0 && `${r.completadas} ficha(s) completada(s)`,
          r.creadas > 0 && `${r.creadas} creada(s)`,
          r.sinCambios > 0 && `${r.sinCambios} sin cambios`,
        ]
          .filter(Boolean)
          .join(" · ") || "No había nada que cambiar.",
      );
      // Y se vuelve a pedir la previa: después de aplicar, TODO tiene que
      // decir «sin cambios». Es la idempotencia enseñada, no prometida.
      await verPrevia();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    } finally {
      setCargando(false);
    }
  }

  function leerFichero(f: File) {
    const r = new FileReader();
    r.onload = () => {
      const texto = String(r.result ?? "");
      setCsv(texto);
      void verPrevia(texto);
    };
    // UTF-8: es lo que exporta «CSV UTF-8» de Excel, y el BOM lo quita el
    // servidor.
    r.readAsText(f, "utf-8");
  }

  return (
    <AdminShell title="Importar personal">
      <Link
        to="/admin/fichaje/personal"
        className="-mt-2 mb-4 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-mipiace-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Toda la plantilla
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-[13.5px] text-slate-600">
          Sube el fichero o pega su contenido. Tiene que traer una cabecera con
          los nombres de las columnas; el separador puede ser{" "}
          <code className="rounded bg-mipiace-stone px-1">;</code> o{" "}
          <code className="rounded bg-mipiace-stone px-1">,</code> y las fechas
          van en <strong>dd/mm/aaaa</strong>.
        </p>
        <p className="mt-2 text-[12.5px] text-slate-500">
          Columnas que se entienden: {COLUMNAS_LEGIBLES}. Lo demás se ignora.
          Una celda vacía <strong>no borra</strong> lo que ya está puesto.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <input
            ref={fichero}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) leerFichero(f);
            }}
          />
          <OutlineButton
            className="!w-auto px-4"
            onClick={() => fichero.current?.click()}
          >
            <FileUp className="h-4 w-4" />
            Elegir fichero
          </OutlineButton>
        </div>

        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={
            "nombre;apellidos;dni_nie;num_afiliacion_ss;categoria;jornada_semanal_h;fecha_alta;tipo_contrato\nAna;Soler Ruiz;…;…;AUXILIAR;37,5;01/06/2026;indefinido"
          }
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 font-mono text-[12.5px] text-mipiace-ink outline-none focus:border-mipiace-coral"
        />

        <div className="mt-3 flex flex-wrap gap-2.5">
          <div className="w-full sm:w-auto sm:min-w-[180px]">
            <OutlineButton
              onClick={() => void verPrevia()}
              busy={cargando && !previa}
              disabled={csv.trim() === ""}
            >
              Ver qué va a pasar
            </OutlineButton>
          </div>
        </div>
      </div>

      {error && <FieldError message={error} />}
      {hecho && <SuccessBanner message={hecho} />}

      {previa && (
        <section className="mt-5">
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
            <p className="text-[14.5px] font-medium text-mipiace-ink">
              {previa.resumen.completar > 0 &&
                `Se completan ${previa.resumen.completar} ficha(s)`}
              {previa.resumen.completar > 0 && previa.resumen.crear > 0 && " · "}
              {previa.resumen.crear > 0 && `se crean ${previa.resumen.crear}`}
              {previa.resumen.completar === 0 &&
                previa.resumen.crear === 0 &&
                "No hay nada que cambiar"}
            </p>
            <p className="mt-0.5 text-[12.5px] text-slate-600">
              {previa.resumen.sinCambios > 0 &&
                `${previa.resumen.sinCambios} fila(s) ya estaban como dice el fichero`}
              {previa.resumen.sinCambios > 0 && previa.resumen.errores > 0 && " · "}
              {previa.resumen.errores > 0 &&
                `${previa.resumen.errores} fila(s) que no se entienden`}
              {previa.resumen.sinCambios === 0 &&
                previa.resumen.errores === 0 &&
                `Separador «${previa.separador}», ${previa.columnas.length} columna(s) reconocida(s)`}
            </p>
          </div>

          {previa.errores.length > 0 && (
            <div className="mb-3 rounded-2xl border border-mipiace-coral/30 bg-mipiace-coral-soft px-4 py-3.5">
              <p className="flex items-center gap-2 text-[14px] font-medium text-mipiace-ink">
                <TriangleAlert className="h-4 w-4 text-mipiace-coral-dark" />
                Estas filas se quedan fuera
              </p>
              <ul className="mt-1.5 space-y-1">
                {previa.errores.map((e) => (
                  <li key={e.linea} className="text-[12.5px] text-slate-700">
                    {e.mensaje}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-slate-600">
                El resto se importa igual: una fila mal escrita no tumba el
                fichero.
              </p>
            </div>
          )}

          <ul className="space-y-2">
            {previa.acciones.map((a) => (
              <li
                key={`${a.linea}-${a.nombreCompleto}`}
                className={`rounded-2xl border px-4 py-3 ${
                  a.que === "ERROR"
                    ? "border-mipiace-coral/30 bg-mipiace-coral-soft"
                    : a.que === "SIN_CAMBIOS"
                      ? "border-slate-200 bg-mipiace-stone"
                      : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-[11.5px] tabular-nums text-slate-400">
                    fila {a.linea}
                  </span>
                  <span className="text-[14.5px] font-medium text-mipiace-ink">
                    {a.nombreCompleto}
                  </span>
                  <span className="ml-auto text-[12.5px] text-slate-600">
                    {a.que === "CREAR" && "se crea"}
                    {a.que === "COMPLETAR" && `completa la ficha de ${a.casaCon}`}
                    {a.que === "SIN_CAMBIOS" && "ya está así"}
                    {a.que === "ERROR" && "no se entiende"}
                  </span>
                </div>
                {a.motivo && (
                  <p className="mt-1 text-[12.5px] text-slate-700">{a.motivo}</p>
                )}
                {a.cambios.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {a.cambios.map((c) => (
                      <li
                        key={c.campo}
                        className="text-[12.5px] text-slate-600"
                      >
                        <span className="text-slate-500">
                          {etiquetaDeCampo(c.campo)}:
                        </span>{" "}
                        {c.antes == null ? (
                          <span className="text-slate-400">sin poner</span>
                        ) : (
                          <span className="line-through decoration-slate-300">
                            {c.antes}
                          </span>
                        )}{" "}
                        → <span className="text-mipiace-ink">{c.despues}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {previa.resumen.completar + previa.resumen.crear > 0 && (
            <div className="mt-4 sm:max-w-[260px]">
              <PrimaryButton type="button" onClick={aplicar} busy={cargando}>
                Importar{" "}
                {previa.resumen.completar + previa.resumen.crear} fila(s)
              </PrimaryButton>
            </div>
          )}
        </section>
      )}
    </AdminShell>
  );
}

function etiquetaDeCampo(campo: string): string {
  const mapa: Record<string, string> = {
    nombre: "Nombre",
    apellidos: "Apellidos",
    dni: "DNI o NIE",
    afiliacion: "Nº de afiliación",
    categoria: "Categoría",
    jornadaSemanal: "Jornada",
    fechaDeAlta: "Fecha de alta",
    tipoDeContrato: "Tipo de contrato",
    finPrevisto: "Fin previsto",
    telefono: "Teléfono",
    email: "Email",
  };
  return mapa[campo] ?? campo;
}
