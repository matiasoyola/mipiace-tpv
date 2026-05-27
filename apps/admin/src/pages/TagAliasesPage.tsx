// v1.3-Operativa-Extra · Lote 1: editor de aliases de tags.
//
// El OWNER/MANAGER mapea `slug` Holded ("01cortesypeinados") al `label`
// que el TPV pinta en los chips de categoría ("Cortes y peinados") sin
// tener que renombrar los productos en Holded. El TPV cachea el map en
// localStorage al siguiente refresh completo del catálogo.

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

interface TagAlias {
  id: string;
  slug: string;
  label: string;
}

export function TagAliasesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TagAlias[] | null>(null);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: TagAlias[] }>("/admin/tag-aliases")
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
    if (slug.trim().length === 0 || label.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ alias: TagAlias }>("/admin/tag-aliases", {
        method: "POST",
        body: { slug: slug.trim(), label: label.trim() },
      });
      setItems((curr) => {
        const others = (curr ?? []).filter((it) => it.id !== res.alias.id);
        const next = [...others, res.alias];
        next.sort((a, b) => a.slug.localeCompare(b.slug));
        return next;
      });
      setSlug("");
      setLabel("");
      setSuccess("Alias guardado. El TPV lo verá tras el próximo refresh del catálogo.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm("¿Eliminar este alias? El TPV volverá a usar la capitalización automática.")) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/tag-aliases/${id}`, { method: "DELETE" });
      setItems((curr) => (curr ?? []).filter((it) => it.id !== id));
      setSuccess("Alias eliminado.");
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Error inesperado");
    }
  }

  if (!items) return <CenteredLoader label="Cargando aliases…" />;

  return (
    <AdminShell title="Etiquetas del TPV">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        Renombra cómo se ven en el TPV las etiquetas (tags) de tus
        productos en Holded. Útil cuando usas prefijos numéricos para
        ordenarlas ("01cortesypeinados") y quieres pintar un texto más
        legible ("Cortes y peinados") sin tocar los productos.
      </p>

      {success && <SuccessBanner message={success} />}
      {error && <FieldError message={error} />}

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Añadir o actualizar alias
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          El <em>slug</em> es la etiqueta tal y como llega de Holded (en
          minúsculas, incluyendo el prefijo numérico si lo tiene).
        </p>
        <form onSubmit={onAdd} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              id="slug"
              label="Slug Holded"
              value={slug}
              onChange={setSlug}
              placeholder="01cortesypeinados"
              required
            />
            <TextField
              id="label"
              label="Etiqueta en el TPV"
              value={label}
              onChange={setLabel}
              placeholder="Cortes y peinados"
              required
            />
          </div>
          <div className="flex gap-2.5">
            <PrimaryButton type="submit" busy={busy}>
              <Plus className="w-3.5 h-3.5" />
              Guardar alias
            </PrimaryButton>
          </div>
        </form>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-7 mb-5">
        <h2 className="text-[16px] font-semibold text-mipiace-ink tracking-tight mb-1">
          Aliases actuales
        </h2>
        <p className="text-[13px] text-slate-500 mb-4">
          {items.length === 0
            ? "Aún no has creado ninguno."
            : `${items.length} alias activo${items.length === 1 ? "" : "s"}.`}
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
                  <div className="text-[14.5px] font-medium text-mipiace-ink truncate">
                    {it.label}
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
