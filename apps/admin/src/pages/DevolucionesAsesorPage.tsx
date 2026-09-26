// holded-desconectar · las devoluciones que hay que llevarle al asesor.
// ADR-020, criterio 5 del bloque.
//
// Esta pantalla existe porque hay un hueco REAL y no se puede tapar con
// código: después de dejar Holded, una devolución no genera documento de
// abono en ningún sitio.
//
//   · Si la venta la facturó HOLDED (antes del corte), el abono tendría que
//     ir a Holded, y mipiacetpv ya no escribe allí.
//   · Si la venta es una factura simplificada NUESTRA, su abono sería una
//     factura rectificativa, y las rectificativas son V3
//     (verifactu-1-done §9): no están construidas.
//
// En los dos casos el dinero SÍ sale del cajón y el arqueo SÍ cuadra: el
// abono se crea, su método se descuenta del turno y el Z lo cuenta. Lo que
// falta es el papel, y el papel lo hace el asesor. Esta pantalla es la lista
// que se le manda, con el número de la factura original de cada caso.
//
// Sólo aparece en la barra lateral del comercio que DEJÓ Holded. En
// cualquier otro no hay nada de esto y una sección vacía que habla de un
// corte que no ha pasado es la clase de mentira que H1 vino a quitar del
// panel.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, FileWarning } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import { CenteredLoader, FieldError, OutlineButton } from "../ui.js";

type Origen = "holded" | "mipiacetpv" | "sin_registro";

interface Devolucion {
  refundId: string;
  numero: string;
  fecha: string;
  total: string;
  motivo: string | null;
  metodo: string | null;
  origen: Origen;
  ticket: {
    id: string;
    numero: string;
    fecha: string;
    holdedDocNumber: string | null;
    holdedDocumentId: string | null;
    facturaSimplificada: string | null;
  };
  queHacer: string;
}

interface Respuesta {
  aplica: boolean;
  holdedDisconnectedAt: string | null;
  devoluciones: Devolucion[];
  resumen: { holded: number; mipiacetpv: number; sin_registro: number; total: string };
}

const ORIGEN_LABEL: Record<Origen, string> = {
  holded: "Facturó Holded",
  mipiacetpv: "Factura nuestra",
  sin_registro: "Sin registro fiscal",
};

const ORIGEN_CLS: Record<Origen, string> = {
  holded: "bg-slate-100 text-slate-700 border-slate-200",
  mipiacetpv: "bg-sky-50 text-sky-800 border-sky-200",
  sin_registro: "bg-red-50 text-red-800 border-red-200",
};

export function DevolucionesAsesorPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setData(await api<Respuesta>("/admin/devoluciones/para-el-asesor"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : "No hemos podido cargarlo.");
    }
  }, [navigate]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Tabulado y no CSV: se pega directamente en una hoja de cálculo, que es
  // lo que el asesor abre. Un CSV con comas se rompe en cuanto un motivo
  // lleve una.
  function copiar(): void {
    if (data == null) return;
    const filas = [
      ["Abono", "Fecha", "Importe", "Método", "Quién facturó", "Factura original", "Motivo"],
      ...data.devoluciones.map((d) => [
        d.numero,
        new Date(d.fecha).toLocaleDateString("es-ES"),
        d.total,
        d.metodo ?? "",
        ORIGEN_LABEL[d.origen],
        d.ticket.holdedDocNumber ?? d.ticket.facturaSimplificada ?? d.ticket.numero,
        (d.motivo ?? "").replace(/\s+/g, " "),
      ]),
    ];
    void navigator.clipboard.writeText(filas.map((f) => f.join("\t")).join("\n"));
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 2500);
  }

  return (
    <AdminShell title="Devoluciones para el asesor">
      {error != null && <FieldError message={error} />}
      {data == null && error == null && (
        <CenteredLoader label="Cargando devoluciones…" />
      )}

      {data != null && !data.aplica && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-[13.5px] text-slate-600">
          Esta pantalla es para un comercio que ha dejado de usar Holded. No es
          el caso, así que aquí no hay nada que llevar a ningún sitio.
        </div>
      )}

      {data != null && data.aplica && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 mb-5">
            <p className="flex items-start gap-2 text-[13.5px] text-slate-700 leading-relaxed">
              <FileWarning className="w-4.5 h-4.5 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Desde el{" "}
                <strong>
                  {new Date(data.holdedDisconnectedAt!).toLocaleDateString("es-ES")}
                </strong>{" "}
                este comercio emite sus propias facturas. El dinero de estas
                devoluciones ya salió de la caja y el arqueo cuadra, pero{" "}
                <strong>su documento de abono hay que hacerlo a mano</strong>.
                Pásale esta lista a tu asesor.
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Resumen label="Facturó Holded" valor={data.resumen.holded} />
            <Resumen label="Factura nuestra" valor={data.resumen.mipiacetpv} />
            {data.resumen.sin_registro > 0 && (
              <Resumen
                label="Sin registro fiscal"
                valor={data.resumen.sin_registro}
                tono="danger"
              />
            )}
            <Resumen label="Total devuelto" valor={`${data.resumen.total} €`} />
            <div className="ml-auto">
              <OutlineButton onClick={copiar} disabled={data.devoluciones.length === 0}>
                {copiado ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="w-4 h-4" /> Copiado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Copy className="w-4 h-4" /> Copiar para el asesor
                  </span>
                )}
              </OutlineButton>
            </div>
          </div>

          {data.devoluciones.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-[13.5px] text-slate-600">
              Ninguna devolución desde el corte. Nada que llevar al asesor.
            </div>
          ) : (
            <div className="space-y-3">
              {data.devoluciones.map((d) => (
                <div
                  key={d.refundId}
                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1.5">
                    <span className="font-mono text-[14px] font-semibold text-slate-900">
                      {d.numero}
                    </span>
                    <span className="text-[12.5px] text-slate-500">
                      {new Date(d.fecha).toLocaleString("es-ES")}
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums text-slate-900">
                      −{d.total} €
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${ORIGEN_CLS[d.origen]}`}
                    >
                      {ORIGEN_LABEL[d.origen]}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-slate-600 mb-1">
                    Venta <span className="font-mono">{d.ticket.numero}</span> del{" "}
                    {new Date(d.ticket.fecha).toLocaleDateString("es-ES")}
                    {d.ticket.holdedDocNumber != null && (
                      <>
                        {" · factura de Holded "}
                        <span className="font-mono">{d.ticket.holdedDocNumber}</span>
                      </>
                    )}
                    {d.ticket.facturaSimplificada != null && (
                      <>
                        {" · factura simplificada "}
                        <span className="font-mono">{d.ticket.facturaSimplificada}</span>
                      </>
                    )}
                  </p>
                  <p className="text-[12px] text-slate-500 leading-relaxed">{d.queHacer}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}

function Resumen({
  label,
  valor,
  tono = "neutral",
}: {
  label: string;
  valor: string | number;
  tono?: "neutral" | "danger";
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-slate-500 font-semibold">
        {label}
      </p>
      <p
        className={`text-[16px] font-semibold tabular-nums ${
          tono === "danger" ? "text-red-700" : "text-slate-900"
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
