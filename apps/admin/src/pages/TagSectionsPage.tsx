// v1.4-Bar-Operativa-MVP Lote 2 · editor del mapa `etiqueta → sección`.
//
// ── auditoria-sirope (#19) · lo que cambió el 18-10 ───────────────────
//
// La página pedía teclear «el slug de Holded». Dos cosas malas a la vez:
//
//   · Sirope no usa Holded. El rótulo mandaba a buscar un dato que no
//     existe en su cuenta.
//   · Una etiqueta mal tecleada no da error. No mapea nada y sus platos
//     caen a SALÓN en silencio — que es exactamente lo que pasó con la
//     primera comanda de la T6: el D8 dijo «Comanda nº 1 enviada ·
//     SALÓN: 3 líneas» y la cocina no vio nada.
//
// Ahora la página LISTA las etiquetas reales del catálogo y pone un
// selector Barra / Cocina / Salón al lado de cada una. Lo que no se
// teclea, no se puede teclear mal.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import { CenteredLoader, FieldError, SuccessBanner } from "../ui.js";

type Section = "BARRA" | "COCINA" | "SALON";

interface Etiqueta {
  slug: string;
  productCount: number;
  /** `null` = sin asignar. Sus platos caen a SALÓN. */
  section: Section | null;
  mapeoId: string | null;
}

const SECCIONES: Array<{ value: Section; label: string }> = [
  { value: "BARRA", label: "Barra" },
  { value: "COCINA", label: "Cocina" },
  { value: "SALON", label: "Salón" },
];

const SECTION_COLOR: Record<Section, string> = {
  BARRA: "bg-amber-50 text-amber-800 border-amber-200",
  COCINA: "bg-rose-50 text-rose-800 border-rose-200",
  SALON: "bg-slate-100 text-slate-700 border-slate-200",
};

export function TagSectionsPage() {
  const navigate = useNavigate();
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await api<{ etiquetas: Etiqueta[] }>(
        "/admin/tag-sections/etiquetas",
      );
      setEtiquetas(res.etiquetas);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
      } else if (err instanceof ApiError) {
        setError(err.message);
      }
    }
  }, [navigate]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function asignar(e: Etiqueta, section: Section | null) {
    setError(null);
    setSuccess(null);
    setGuardando(e.slug);
    try {
      if (section == null) {
        if (e.mapeoId) {
          await api(`/admin/tag-sections/${e.mapeoId}`, { method: "DELETE" });
        }
        setEtiquetas((curr) =>
          (curr ?? []).map((x) =>
            x.slug === e.slug ? { ...x, section: null, mapeoId: null } : x,
          ),
        );
        setSuccess(
          `«${e.slug}» vuelve a Salón: sus platos los lleva el camarero.`,
        );
      } else {
        const res = await api<{ tagSection: { id: string; section: Section } }>(
          "/admin/tag-sections",
          { method: "POST", body: { slug: e.slug, section } },
        );
        setEtiquetas((curr) =>
          (curr ?? []).map((x) =>
            x.slug === e.slug
              ? {
                  ...x,
                  section: res.tagSection.section,
                  mapeoId: res.tagSection.id,
                }
              : x,
          ),
        );
        setSuccess("Guardado. El TPV lo aplicará en el próximo envío.");
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
      // Si falló, lo que hay en pantalla puede no ser lo que hay en la
      // base: se vuelve a pedir en vez de dejar una mentira puesta.
      void cargar();
    } finally {
      setGuardando(null);
    }
  }

  if (!etiquetas) return <CenteredLoader label="Cargando etiquetas…" error={error} />;

  const sinAsignar = etiquetas.filter(
    (e) => e.section == null && e.productCount > 0,
  );

  return (
    <AdminShell title="Comanderas por sección">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Al enviar una comanda, las líneas se agrupan por sección y cada
        sección va a su pantalla de cocina o a su impresora. Aquí decides a
        qué sección pertenece cada etiqueta de tu catálogo.
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      {/* auditoria-sirope (#19) · el aviso que faltaba. Una etiqueta sin
          sección no da error: manda sus platos a Salón en silencio. */}
      {sinAsignar.length > 0 && (
        <div
          data-testid="aviso-sin-seccion"
          className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
          <div className="text-[13px] text-amber-900">
            <strong>
              {sinAsignar.length === 1
                ? "1 etiqueta sin sección"
                : `${sinAsignar.length} etiquetas sin sección`}
            </strong>
            : {sinAsignar.map((e) => e.slug).join(", ")}. Sus platos van a
            Salón, o sea que no aparecen en la pantalla de cocina ni salen
            por su impresora — se los lleva el camarero en mano.
          </div>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Etiquetas de tu catálogo
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          {etiquetas.length === 0
            ? "Tu catálogo todavía no tiene etiquetas."
            : `${etiquetas.length} etiqueta${etiquetas.length === 1 ? "" : "s"}.`}
        </p>
        <div className="space-y-2">
          {etiquetas.map((e) => (
            <div
              key={e.slug}
              data-testid={`etiqueta-${e.slug}`}
              className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl bg-mipiace-stone"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-mipiace-ink truncate">
                  {e.slug}
                </div>
                <div className="text-[12px] text-slate-500">
                  {e.productCount === 0
                    ? "sin productos (sobra)"
                    : `${e.productCount} producto${e.productCount === 1 ? "" : "s"}`}
                </div>
              </div>
              <div className="flex gap-1.5">
                {SECCIONES.map((s) => {
                  const activa = e.section === s.value;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      disabled={guardando === e.slug}
                      onClick={() => void asignar(e, activa ? null : s.value)}
                      aria-pressed={activa}
                      data-testid={`etiqueta-${e.slug}-${s.value}`}
                      className={`h-10 px-3.5 rounded-xl border text-[13px] font-medium disabled:opacity-50 ${
                        activa
                          ? SECTION_COLOR[s.value]
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
