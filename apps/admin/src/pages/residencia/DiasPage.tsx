// historia-1 (D-93, D-97) · **LOS DÍAS DEL MES DEL CENTRO.**
//
// Los tres números que hoy alguien teclea a mano en `meses/AAAA-MM.json`
// para facturar las plazas concertadas de la JCCM
// (`05-plazas-facturacion.md`): ordinarios, hospital y vacaciones, por
// residente y sumados.
//
// Es la mitad del valor de las ausencias y no se parece a nada de lo que
// hay: el resto del producto contesta «qué pasa hoy», y esto contesta
// «qué le cobramos a la Junta por octubre».
//
// ── LA REGLA DE LOS DÍAS FRONTERA, A LA VISTA ──────────────────────
//
// Se cuenta **dónde pernocta el residente**: el día del ingreso cuenta y
// el día del alta no. Es dato de cada comunidad autónoma (D-93) y está
// **por confirmar con la Junta** antes de facturacion-1, así que la
// pantalla lo dice. Un número de facturación sin su regla al lado es un
// número que alguien copia mal.
//
// ── Y ESTO NO FACTURA ──────────────────────────────────────────────
//
// No hay tarifas, ni liquidación, ni PDF: eso es facturacion-1. Lo que
// esta pantalla da es **el dato que hoy se teclea**, contado por el
// sistema. Prometer más sería prometer un bloque que no está.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "../../AdminShell.js";
import { api, ApiError } from "../../api.js";
import { CenteredLoader, FieldError, OutlineButton } from "../../ui.js";
import {
  mesDeHoy,
  mesDesplazado,
  mesEnPalabras,
  type DiasDelMes,
} from "./ficha-lib.js";

interface FilaDeDias extends DiasDelMes {
  nombre: string;
  plaza: string | null;
}

interface Respuesta {
  mes: string;
  residentes: FilaDeDias[];
  total: Omit<DiasDelMes, "mes" | "clientId">;
}

const NOMBRE_DE_LA_PLAZA: Record<string, string> = {
  PRIVADA: "Privada",
  CONCERTADA: "Concertada",
  TEMPORAL: "Temporal",
};

export function DiasPage() {
  const [mes, setMes] = useState(mesDeHoy());
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<Respuesta>(`/residencia/dias?mes=${mes}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error inesperado");
    }
  }, [mes]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!datos) return <CenteredLoader label="Contando los días…" />;

  return (
    <AdminShell title="Días del mes">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-semibold">{mesEnPalabras(mes)}</h2>
        <span className="flex gap-2">
          <OutlineButton onClick={() => setMes(mesDesplazado(mes, -1))}>
            ← Mes anterior
          </OutlineButton>
          <OutlineButton onClick={() => setMes(mesDesplazado(mes, 1))}>
            Mes siguiente →
          </OutlineButton>
        </span>
      </div>

      <p className="mb-5 text-[13.5px] text-slate-500">
        Se cuenta <strong>dónde pernocta el residente</strong>: el día del
        ingreso cuenta y el día del alta no. La regla de los días frontera es
        de cada comunidad autónoma y <strong>está por confirmar con la
        Junta</strong>. Esta pantalla no factura: da el dato que hoy se
        teclea a mano.
      </p>

      {error && <FieldError message={error} />}

      {datos.residentes.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-[13.5px] text-slate-500">
          Nadie tuvo plaza en {mesEnPalabras(mes)}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-[13.5px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[12.5px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Residente</th>
                <th className="px-4 py-2 font-medium">Plaza</th>
                <th className="px-4 py-2 text-right font-medium">Ordinarios</th>
                <th className="px-4 py-2 text-right font-medium">Hospital</th>
                <th className="px-4 py-2 text-right font-medium">Familia</th>
                <th className="px-4 py-2 text-right font-medium">Otros</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {datos.residentes.map((r) => (
                <tr key={r.clientId} className="border-b border-slate-100">
                  <td className="px-4 py-2">{r.nombre}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {r.plaza ? (NOMBRE_DE_LA_PLAZA[r.plaza] ?? r.plaza) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{r.ordinarios}</td>
                  <td className="px-4 py-2 text-right">{r.hospital}</td>
                  <td className="px-4 py-2 text-right">{r.vacaciones}</td>
                  {/* «Otros» en ámbar cuando no es cero: una noche fuera
                      que no es un hospital ni una salida con la familia es
                      algo que hay que mirar — una salida no controlada, o
                      una consulta que se alargó. */}
                  <td
                    className={`px-4 py-2 text-right ${
                      r.otros > 0 ? "bg-amber-50 font-medium text-amber-900" : ""
                    }`}
                  >
                    {r.otros}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {r.presencia}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-medium">
              <tr>
                <td className="px-4 py-2" colSpan={2}>
                  Total del centro
                </td>
                <td className="px-4 py-2 text-right">{datos.total.ordinarios}</td>
                <td className="px-4 py-2 text-right">{datos.total.hospital}</td>
                <td className="px-4 py-2 text-right">{datos.total.vacaciones}</td>
                <td className="px-4 py-2 text-right">{datos.total.otros}</td>
                <td className="px-4 py-2 text-right">{datos.total.presencia}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
