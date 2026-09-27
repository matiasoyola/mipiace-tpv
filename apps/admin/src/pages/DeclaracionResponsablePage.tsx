// declaracion-responsable · la declaración responsable del SIF, dentro del
// panel.
//
// El art. 15 de la Orden HAC/1177/2024 no se conforma con que el documento
// exista: pide que esté «disponible de manera legible e individualizada
// dentro del propio sistema informático» y accesible «de forma rápida, fácil
// e intuitiva». De ahí las tres decisiones de esta pantalla:
//
//   · Un clic desde cualquier sitio. El enlace vive en el pie del menú
//     lateral, encima de la versión, así que está en todas las pantallas del
//     panel — no colgando de un submenú de Ajustes.
//   · Se ve con Holded y sin Holded, para OWNER y para MANAGER. El producto
//     es el mismo y quien lo produce es el mismo: esta pantalla no tiene
//     capability porque el documento no depende de lo que el comercio haya
//     comprado.
//   · El texto se pinta tal cual llega, apartado por apartado y con su clave
//     del art. 15 («1.f)»), porque «individualizada» es exactamente eso: que
//     se pueda leer cada punto por separado.
//
// El contenido NO está aquí. Llega de GET /legal/declaracion-responsable,
// que lo construye desde las constantes del productor. Esta pantalla es una
// ventana, no una copia: si tecleara un dato, se desincronizaría del día que
// alguien cambie una constante — que es el fallo que el bloque entero viene
// a evitar.

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api } from "../api.js";
import { CenteredLoader, FieldError } from "../ui.js";

interface Apartado {
  clave: string;
  rotulo: string;
  valor: string[];
}

interface Declaracion {
  titulo: string;
  apartados: Apartado[];
  anexo: Apartado[];
}

// El PDF se abre por URL directa y no por `api()`: el endpoint es público y
// sin sesión a propósito (es un documento que se entrega a cualquiera), y un
// <a> no puede poner la cabecera Authorization de todas formas. Mismo
// prefijo /api que usa el cliente HTTP del panel.
export const URL_PDF = "/api/legal/declaracion-responsable.pdf";

function ApartadoLeible({ apartado }: { apartado: Apartado }) {
  return (
    <section className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[13px] font-semibold text-mipiace-ink leading-snug">
        <span className="text-slate-400 tabular-nums mr-1.5">
          {apartado.clave}
        </span>
        {apartado.rotulo}
      </h3>
      <div className="mt-1.5 space-y-2">
        {apartado.valor.map((parrafo, i) => (
          <p
            key={i}
            className="text-[13.5px] leading-relaxed text-slate-700 break-words"
          >
            {parrafo}
          </p>
        ))}
      </div>
    </section>
  );
}

export function DeclaracionResponsablePage() {
  const [declaracion, setDeclaracion] = useState<Declaracion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Sin gestión de 401: el endpoint es público. Si falla es que el
    // servidor no responde, y entonces se dice — y el enlace al PDF sigue
    // ahí, que es la vía de entrega que la Orden exige.
    api<{ declaracion: Declaracion }>("/legal/declaracion-responsable")
      .then((res) => setDeclaracion(res.declaracion))
      .catch(() =>
        setError(
          "No se ha podido cargar la declaración responsable. " +
            "Se puede descargar en PDF con el botón de arriba.",
        ),
      );
  }, []);

  return (
    <AdminShell title="Declaración responsable">
      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 text-slate-400 mb-2">
              <FileText className="w-4 h-4" strokeWidth={2.1} />
              <span className="text-[11.5px] font-medium uppercase tracking-wide">
                Orden HAC/1177/2024, art. 15
              </span>
            </div>
            <h2 className="text-[17px] font-semibold text-mipiace-ink tracking-tight leading-snug">
              {declaracion?.titulo ??
                "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN"}
            </h2>
            <p className="mt-2 text-[13px] text-slate-500 max-w-xl">
              Declaración del productor de mipiacetpv sobre la versión que
              estás usando. Se puede descargar e imprimir; es la misma que se
              entrega, gratuitamente, a cualquier cliente o distribuidor que
              la pida.
            </p>
          </div>
          <a
            href={URL_PDF}
            target="_blank"
            rel="noreferrer"
            className="h-11 shrink-0 inline-flex items-center gap-2 px-4 rounded-xl bg-mipiace-coral text-white text-[14px] font-medium hover:bg-mipiace-coral-dark transition-colors"
          >
            <Download className="w-4 h-4" strokeWidth={2.2} />
            Descargar PDF
          </a>
        </div>

        {error && (
          <div className="mt-5">
            <FieldError message={error} />
          </div>
        )}

        {!declaracion && !error && (
          <div className="mt-6">
            <CenteredLoader label="Cargando la declaración…" />
          </div>
        )}

        {declaracion && (
          <>
            <div className="mt-6 space-y-4">
              {declaracion.apartados.map((a) => (
                <ApartadoLeible key={a.clave} apartado={a} />
              ))}
            </div>
            {declaracion.anexo.length > 0 && (
              <>
                <h2 className="mt-8 mb-4 text-[13px] font-semibold uppercase tracking-wide text-slate-400">
                  Anexo
                </h2>
                <div className="space-y-4">
                  {declaracion.anexo.map((a) => (
                    <ApartadoLeible key={a.clave} apartado={a} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </AdminShell>
  );
}
