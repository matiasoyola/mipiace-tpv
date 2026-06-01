// v1.4-Bar-Operativa-MVP Lote 2 · editor del mapa `tag → sección`.
//
// El OWNER/MANAGER asigna cada tag de su catálogo (los slugs que
// llegan de Holded — "cafes", "tapas", "vinos") a la sección que la
// preparará: BARRA, COCINA o SALÓN. Cuando el camarero pulsa "Enviar
// comanda" en una mesa, el backend agrupa las líneas por sección y
// genera un PDF por sección con sus líneas.
//
// Tags no listados aquí caen a SALÓN en el endpoint de envío — es el
// default razonable, el camarero lo lleva en mano. Por eso en la
// práctica este editor sólo se rellena con entradas BARRA y COCINA.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import {
  CenteredLoader,
  FieldError,
  OutlineButton,
  PrimaryButton,
  SuccessBanner,
  TextField,
} from "../ui.js";

type Section = "BARRA" | "COCINA" | "SALON";

interface TagSection {
  id: string;
  slug: string;
  section: Section;
}

const SECTION_LABEL: Record<Section, string> = {
  BARRA: "Barra",
  COCINA: "Cocina",
  SALON: "Salón",
};

const SECTION_COLOR: Record<Section, string> = {
  BARRA: "bg-amber-50 text-amber-800",
  COCINA: "bg-rose-50 text-rose-800",
  SALON: "bg-slate-100 text-slate-700",
};

export function TagSectionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TagSection[] | null>(null);
  const [slug, setSlug] = useState("");
  const [section, setSection] = useState<Section>("BARRA");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: TagSection[] }>("/admin/tag-sections")
      .then((res) => setItems(res.items))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
          navigate("/login", { replace: true });
        } else if (err instanceof ApiError) {
          setError(err.message);
        }
      });
  }, [navigate]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (slug.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ tagSection: TagSection }>("/admin/tag-sections", {
        method: "POST",
        body: { slug: slug.trim(), section },
      });
      setItems((curr) => {
        const others = (curr ?? []).filter((it) => it.id !== res.tagSection.id);
        const next = [...others, res.tagSection];
        next.sort(
          (a, b) =>
            a.section.localeCompare(b.section) || a.slug.localeCompare(b.slug),
        );
        return next;
      });
      setSlug("");
      setSuccess(
        "Mapeo guardado. El TPV lo aplicará en el próximo envío de comanda.",
      );
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (
      !window.confirm(
        "¿Quitar este mapeo? Las líneas con este tag caerán a SALÓN por defecto.",
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/tag-sections/${id}`, { method: "DELETE" });
      setItems((curr) => (curr ?? []).filter((it) => it.id !== id));
      setSuccess("Mapeo eliminado.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  if (!items) return <CenteredLoader label="Cargando secciones…" />;

  return (
    <AdminShell title="Comanderas por sección">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Cuando el camarero pulsa "Enviar comanda" en una mesa, las
        líneas se agrupan por sección (Barra, Cocina, Salón) y se
        imprime un papel para cada una. Aquí decides qué etiqueta (tag)
        de tus productos va a qué sección. Tags no listados van a
        Salón por defecto — el camarero los lleva en mano.
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Asignar etiqueta a una sección
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          El <em>slug</em> es la etiqueta tal y como la usas en Holded
          (en minúsculas — por ejemplo <code>cafes</code>, <code>tapas</code>,{" "}
          <code>vinos</code>).
        </p>
        <form onSubmit={onAdd} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              id="slug"
              label="Slug Holded"
              value={slug}
              onChange={setSlug}
              placeholder="cafes"
              required
            />
            <div>
              <label
                htmlFor="section"
                className="block text-[13px] font-medium text-mipiace-ink mb-2"
              >
                Sección
              </label>
              <select
                id="section"
                value={section}
                onChange={(e) => setSection(e.target.value as Section)}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-[14px] text-mipiace-ink focus:ring-2 focus:ring-mipiace-coral/40 focus:border-mipiace-coral/30 focus:outline-none"
              >
                <option value="BARRA">Barra</option>
                <option value="COCINA">Cocina</option>
                <option value="SALON">Salón</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2.5">
            <PrimaryButton type="submit" busy={busy}>
              <Plus className="w-3.5 h-3.5" />
              Guardar mapeo
            </PrimaryButton>
          </div>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Mapeos actuales
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          {items.length === 0
            ? "Aún no has asignado etiquetas a secciones."
            : `${items.length} mapeo${items.length === 1 ? "" : "s"} configurado${items.length === 1 ? "" : "s"}.`}
        </p>
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-3 p-3.5 rounded-xl bg-mipiace-stone"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] uppercase tracking-wider text-slate-400 font-medium">
                    {it.slug}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-[12.5px] font-medium ${SECTION_COLOR[it.section]}`}
                    >
                      {SECTION_LABEL[it.section]}
                    </span>
                  </div>
                </div>
                <OutlineButton
                  onClick={() => onDelete(it.id)}
                  className="!h-9 !text-[12.5px] !text-red-600 !border-red-200 hover:!bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Quitar
                </OutlineButton>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
