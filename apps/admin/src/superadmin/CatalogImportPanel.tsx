// catalogo-en-alta · «Cargar catálogo» en la ficha del tenant.
//
// Es la pantalla que permite activar un bar nuevo sin Holded: su
// catálogo entra de un fichero ANTES de activar, se ensaya en modo
// prueba sin un solo registro fiscal, y el dueño ve su carta en el TPV el
// día de la visita. El bucle que rompe está en la cabecera de
// `api/src/superadmin/tenant-catalog.ts`.
//
// ── Dos decisiones de pantalla ─────────────────────────────────────────
//
// 1. **No es un modal.** Esto se mira con el dueño al lado y con el CSV
//    abierto en otra ventana: la vista previa puede tener 128 filas
//    buenas y seis malas con su número de línea, y eso no cabe en un
//    diálogo —menos a 320 px, donde un modal con scroll dentro de un
//    scroll es ilegible—. Mismo criterio que `DejarHoldedPanel`.
//
// 2. **Dos cifras por fila: la de la carta y la que se guarda.** El
//    fichero trae el precio CON IVA, que es el que el dueño reconoce, y
//    la columna de la base es NETA. Enseñar sólo una de las dos obliga a
//    confiar; enseñar las dos deja ver que 1,60 € se guarda como 1,4545
//    y que el TPV volverá a pintar 1,60 €.

import { useRef, useState } from "react";
import { FileUp, Upload } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { humanizeError } from "./error-messages.js";
import type { CatalogImportResult } from "./types.js";

function errToHuman(err: unknown): string {
  if (err instanceof SuperAdminApiError) {
    return humanizeError({ error: err.code, message: err.message });
  }
  if (err instanceof Error) return err.message;
  return humanizeError(err);
}

// Importes con `tabular-nums` y coma decimal: es un precio, se lee en
// columna y se compara con la carta.
function euros(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// El neto lleva cuatro decimales porque es lo que se guarda. Redondearlo
// a dos en la pantalla sería enseñar un número que no está en la base.
function netoEuros(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

export function CatalogImportPanel({
  tenantId,
  onCargado,
}: {
  tenantId: string;
  /** Lo llama tras escribir, para que la ficha recargue la salud: con el
   *  catálogo dentro, `products-sellable` pasa a verde y el botón de
   *  activar se enciende. */
  onCargado: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fichero, setFichero] = useState<string | null>(null);
  const [previa, setPrevia] = useState<CatalogImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  function limpiar(): void {
    setCsv(null);
    setFichero(null);
    setPrevia(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFichero(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setHecho(null);
    setPrevia(null);
    setBusy(true);
    try {
      // El fichero se lee en el navegador y se manda como texto: el
      // parser y las reglas viven en el servidor, que es lo que hace que
      // la carga y el alta de una ficha validen igual. Parsear aquí
      // habría sido una segunda copia de la regla del precio.
      const texto = await file.text();
      setCsv(texto);
      setFichero(file.name);
      setPrevia(
        await superApi<CatalogImportResult>(
          `/super-admin/tenants/${tenantId}/catalog/import`,
          { method: "POST", body: { csv: texto } },
        ),
      );
    } catch (err) {
      setError(errToHuman(err));
      setCsv(null);
      setFichero(null);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmar(): Promise<void> {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const r = await superApi<CatalogImportResult>(
        `/super-admin/tenants/${tenantId}/catalog/import`,
        { method: "POST", body: { csv, confirmar: true } },
      );
      setHecho(
        `${r.entran.length} producto${r.entran.length === 1 ? "" : "s"} cargado${
          r.entran.length === 1 ? "" : "s"
        }` + (r.saltadas.length > 0 ? `, ${r.saltadas.length} saltado(s).` : "."),
      );
      limpiar();
      onCargado();
    } catch (err) {
      setError(errToHuman(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-6 min-w-0">
      <h3 className="font-semibold text-slate-900 mb-2">Cargar catálogo</h3>
      <p className="text-[12.5px] text-slate-600 mb-4">
        Para un comercio sin Holded, su catálogo entra de un fichero. Columnas:{" "}
        <code className="text-[11.5px] bg-slate-100 px-1 py-0.5 rounded">
          sku,nombre,precio_con_iva,iva,categoria
        </code>
        . El precio es <strong>con IVA</strong>, el de la carta. Un SKU que ya
        exista no se pisa.
      </p>

      {hecho && (
        <p
          role="status"
          className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-[12.5px] text-emerald-900"
        >
          {hecho}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-800"
        >
          {error}
        </p>
      )}

      {previa === null ? (
        <div>
          {/* El input de verdad va oculto y la etiqueta es el botón: un
              `<input type=file>` sin vestir es el único control de esta
              consola que no se parece al resto. */}
          <label
            className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg text-[13px] font-medium cursor-pointer ${
              busy
                ? "bg-slate-200 text-slate-500 cursor-wait"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            <FileUp className="w-4 h-4" />
            {busy ? "Leyendo el fichero…" : "Elegir fichero CSV"}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void onFichero(e)}
            />
          </label>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
            <p className="text-[13px] text-slate-900 font-medium">
              {fichero}
            </p>
            <p className="text-[12.5px] text-slate-600">
              Entran <strong className="tabular-nums">{previa.entran.length}</strong>
              {previa.saltadas.length > 0 && (
                <>
                  {" · "}se saltan{" "}
                  <strong className="tabular-nums">{previa.saltadas.length}</strong>
                </>
              )}
              {previa.yaTenia > 0 && (
                <>
                  {" · "}ya tenía{" "}
                  <strong className="tabular-nums">{previa.yaTenia}</strong> en el
                  catálogo
                </>
              )}
            </p>
          </div>

          <p className="text-[12px] text-slate-500 mb-3">
            Nada de esto se ha escrito todavía.
          </p>

          {previa.saltadas.length > 0 && (
            <div className="mb-4 border border-amber-200 bg-amber-50 rounded-lg p-3">
              <p className="text-[12.5px] font-medium text-amber-900 mb-1.5">
                No entran {previa.saltadas.length} fila
                {previa.saltadas.length === 1 ? "" : "s"}
              </p>
              <ul className="space-y-1">
                {previa.saltadas.map((s) => (
                  <li key={`${s.linea}-${s.sku}`} className="text-[12px] text-amber-900">
                    <span className="tabular-nums font-medium">Línea {s.linea}</span>
                    {s.sku && <> · {s.sku}</>} — {s.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {previa.entran.length > 0 && (
            // A 320 px la tabla no cabe: scrollea en su propia caja y la
            // página no se va de lado.
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-200 rounded-lg mb-4">
              <table className="w-full text-[13px]">
                <thead className="text-slate-500 text-[11.5px] uppercase bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-3">SKU</th>
                    <th className="text-left py-2 px-3">Nombre</th>
                    <th className="text-right py-2 px-3">Con IVA</th>
                    <th className="text-right py-2 px-3">IVA</th>
                    <th className="text-right py-2 px-3">Se guarda</th>
                    <th className="text-left py-2 px-3">Categoría</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.entran.map((p) => (
                    <tr key={p.sku} className="border-t border-slate-100">
                      <td className="py-1.5 px-3 tabular-nums text-slate-600">{p.sku}</td>
                      <td className="py-1.5 px-3 text-slate-900">{p.nombre}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-900 font-medium">
                        {euros(p.precioConIva)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">
                        {p.iva} %
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-500">
                        {netoEuros(p.precioSinIva)}
                      </td>
                      <td className="py-1.5 px-3 text-slate-600">
                        {p.categorias.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onConfirmar()}
              disabled={busy || previa.entran.length === 0}
              className="inline-flex items-center gap-2 h-10 px-4 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-800 disabled:opacity-40"
            >
              <Upload className="w-4 h-4" />
              {busy
                ? "Cargando…"
                : `Cargar ${previa.entran.length} producto${
                    previa.entran.length === 1 ? "" : "s"
                  }`}
            </button>
            <button
              type="button"
              onClick={limpiar}
              disabled={busy}
              className="h-10 px-3 text-[13px] text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
