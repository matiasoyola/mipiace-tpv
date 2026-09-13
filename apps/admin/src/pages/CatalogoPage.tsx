// catalogo-local · la pantalla del catálogo propio (ADR-017).
//
// Antes de este bloque el panel no tenía NINGUNA ruta de escritura de
// producto: la única pantalla bajo "Productos" era la bandeja de SKUs
// silenciados por Holded, que es una bandeja de revisión y no un CRUD.
//
// Decisiones de la pantalla, y por qué:
//
//  · **El formulario NO es un modal.** `docs/ux-principles.md` §1.7 los
//    reserva para operaciones destructivas con autorización, y §6 los
//    prohíbe expresamente "bloqueando todo para algo no-crítico". Dar de
//    alta un producto es lo más cotidiano que hay aquí. Se abre en un
//    panel en línea, encima de la lista, y a 320 px se lee entero sin
//    pelear con un overlay.
//
//  · **El catálogo de Holded se LISTA, marcado, y no se edita.** No es
//    un campo gris: la tarjeta lo dice con palabras. Si se pudiera
//    editar, el sync incremental lo devolvería a su sitio a los 15
//    minutos y el propietario no entendería por qué.
//
//  · **Tres estados vacíos distintos**, porque significan cosas
//    distintas y la salida de cada uno es otra: sin catálogo todavía,
//    búsqueda sin resultados, y comercio con Holded cuyo sync aún no ha
//    traído nada.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Package, Pencil, Plus, Search, X } from "lucide-react";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import { CenteredLoader, FieldError, OutlineButton, PrimaryButton } from "../ui.js";

// catalogo-local (addendum 2) · los cuatro tramos peninsulares, con el
// 21 por delante. La misma constante que la API (`LOCAL_TAX_RATES` en
// `catalog/local-products.ts`), duplicada a propósito: el admin y la API
// no comparten paquete, y la alternativa —sacar cuatro números a un
// `packages/` nuevo— pesa más que la duplicación.
//
// NO salen de `TenantTax`: esa tabla es el cache fiscal de Holded y el
// comercio que usa esta pantalla la tiene vacía.
const TAX_RATES = [21, 10, 4, 0];

type Source = "HOLDED" | "LOCAL";
type Kind = "PRODUCT" | "SERVICE";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: number;
  taxRate: number;
  kind: Kind;
  active: boolean;
  tags: string[];
  source: Source;
  sellableViaTpv: boolean;
  editable: boolean;
}

interface ListResponse {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  localCount: number;
}

type Filter = "ALL" | "LOCAL" | "HOLDED";

// Importes con `tabular-nums` en todas partes: es la regla del sistema
// visual y aquí importa de verdad, porque la lista es una columna de
// precios que se lee en vertical.
function money(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export function CatalogoPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [includeInactive, setIncludeInactive] = useState(false);
  // `null` mientras carga. Decide si se puede dar de alta.
  const [hasHolded, setHasHolded] = useState<boolean | null>(null);
  // `null` = formulario cerrado. `"new"` = alta. Un id = edición.
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (filter !== "ALL") params.set("source", filter);
    if (includeInactive) params.set("includeInactive", "true");
    params.set("pageSize", "200");
    try {
      const res = await api<ListResponse>(`/catalog/products?${params.toString()}`);
      setData(res);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTokens();
        navigate("/login", { replace: true });
        return;
      }
      setError(err instanceof ApiError ? err.message : "No se ha podido cargar el catálogo.");
    }
  }, [search, filter, includeInactive, navigate]);

  useEffect(() => {
    api<{ tenant: { hasHoldedKey?: boolean } }>("/auth/me")
      .then((me) => setHasHolded(me.tenant.hasHoldedKey === true))
      // Al fallar se asume que SÍ hay Holded: esconde el botón de alta
      // en vez de ofrecer un alta que el servidor va a rechazar con un
      // 403. Misma dirección que la puerta del servidor
      // (`lib/catalogo-local-gate.ts`), que también cierra al no saber.
      .catch(() => setHasHolded(true));
  }, []);

  // Debounce del buscador: 250 ms. Sin él, cada tecla es una consulta
  // con `contains` sobre el catálogo entero.
  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(t);
  }, [load]);

  function onSaved(message: string) {
    setEditing(null);
    setFlash(message);
    void load();
    // El aviso se va solo: §1.3 pide confirmación visual inmediata, no
    // un banner que haya que cerrar a mano.
    setTimeout(() => setFlash(null), 4000);
  }

  const canCreate = hasHolded === false;
  const items = data?.items ?? [];

  return (
    <AdminShell title="Catálogo">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        {canCreate
          ? "Los productos y servicios que vendes en el TPV. Aquí los das de alta y los editas."
          : "Los productos y servicios que vendes en el TPV."}
      </p>

      {hasHolded === true && (
        <div className="mb-5 flex items-start gap-2.5 text-[13px] text-mipiace-ink-soft bg-mipiace-coral-soft rounded-xl px-3.5 py-3">
          <Package className="w-4 h-4 mt-px shrink-0 text-mipiace-coral-dark" />
          <span>
            Tu catálogo lo gestiona Holded, así que se edita allí y se sincroniza aquí cada 15
            minutos. Si cambiaras un producto en esta pantalla, la siguiente sincronización lo
            devolvería a como está en Holded.
          </span>
        </div>
      )}

      {flash && (
        <div className="mb-4 flex items-center gap-2 text-[13.5px] text-emerald-800 bg-emerald-50 rounded-xl px-3.5 py-2.5">
          <Check className="w-4 h-4 shrink-0" />
          <span>{flash}</span>
        </div>
      )}

      {/* Buscador + alta. En móvil se apilan; el buscador va primero
          porque con catálogo cargado es lo que más se usa. */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, SKU o código de barras"
            aria-label="Buscar en el catálogo"
            className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-white border border-slate-200 text-[14px] text-mipiace-ink placeholder:text-slate-400 focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none"
          />
        </div>
        {canCreate && editing !== "new" && (
          <PrimaryButton
            type="button"
            onClick={() => setEditing("new")}
            className="!w-full sm:!w-auto !h-11 px-5 !text-[13.5px] shrink-0"
          >
            <Plus className="w-4 h-4" />
            Nuevo producto
          </PrimaryButton>
        )}
      </div>

      {/* Filtros. Los chips de origen sólo aparecen si hay algo que
          filtrar: en un comercio sin Holded todo es local y tres chips
          para un solo grupo son ruido (§1.8, la pantalla no se inunda). */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(data?.localCount ?? 0) > 0 && hasHolded === true && (
          <>
            <FilterChip label="Todos" active={filter === "ALL"} onClick={() => setFilter("ALL")} />
            <FilterChip label="Míos" active={filter === "LOCAL"} onClick={() => setFilter("LOCAL")} />
            <FilterChip
              label="De Holded"
              active={filter === "HOLDED"}
              onClick={() => setFilter("HOLDED")}
            />
            <span className="w-px h-5 bg-slate-200 mx-1" aria-hidden />
          </>
        )}
        <FilterChip
          label="Ver inactivos"
          active={includeInactive}
          onClick={() => setIncludeInactive((v) => !v)}
        />
        {data && (
          <span className="text-[12.5px] text-slate-500 tabular-nums ml-auto">
            {data.total} {data.total === 1 ? "producto" : "productos"}
          </span>
        )}
      </div>

      {error && <FieldError message={error} />}

      {editing === "new" && (
        <ProductForm
          key="new"
          onCancel={() => setEditing(null)}
          onSaved={() => onSaved("Producto creado. Ya se puede vender en el TPV.")}
        />
      )}

      {!data ? (
        <CenteredLoader label="Cargando catálogo…" />
      ) : items.length === 0 ? (
        <EmptyState
          hasSearch={search.trim().length > 0 || filter !== "ALL"}
          canCreate={canCreate}
          onCreate={() => setEditing("new")}
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((p) =>
            editing === p.id ? (
              <ProductForm
                key={p.id}
                product={p}
                onCancel={() => setEditing(null)}
                onSaved={() => onSaved("Cambios guardados.")}
              />
            ) : (
              <ProductRow key={p.id} product={p} onEdit={() => setEditing(p.id)} />
            ),
          )}
        </div>
      )}
    </AdminShell>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "h-9 px-3.5 rounded-xl text-[13px] font-medium bg-mipiace-coral text-white transition-colors"
          : "h-9 px-3.5 rounded-xl text-[13px] font-medium bg-white border border-slate-200 text-mipiace-ink-soft hover:bg-slate-50 transition-colors"
      }
    >
      {label}
    </button>
  );
}

// Los tres filtros de `tpv-catalog/routes.ts:81-86`, en castellano. Lista
// vacía = el TPV lo vende.
function invisibleReasons(p: Product): string[] {
  const reasons: string[] = [];
  if (!p.active) reasons.push("está inactivo");
  if (!p.sku || p.sku.trim() === "") reasons.push("no tiene SKU");
  if (!p.sellableViaTpv) reasons.push("está marcado como no vendible");
  return reasons;
}

function ProductRow({ product, onEdit }: { product: Product; onEdit: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14.5px] font-medium text-mipiace-ink break-words">
              {product.name}
            </span>
            {product.kind === "SERVICE" && <Badge tone="slate">Servicio</Badge>}
            {!product.active && <Badge tone="slate">Inactivo</Badge>}
            {/* El origen se dice siempre que haya algo que distinguir. */}
            {product.source === "HOLDED" && <Badge tone="slate">De Holded</Badge>}
          </div>
          <div className="text-[12.5px] text-slate-500 mt-1 tabular-nums break-all">
            {product.sku ?? "Sin SKU"} · IVA {product.taxRate}%
            {product.barcode ? ` · ${product.barcode}` : ""}
          </div>
          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {product.tags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-lg bg-mipiace-stone text-slate-500 text-[11.5px]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {/* catalogo-local (addendum 1) · POR QUÉ el TPV no lo vende.
              Ésta es la razón de ser de la pantalla: el TPV filtra por
              `active`, `sellableViaTpv` y `sku` no nulo
              (`tpv-catalog/routes.ts:81-86`), y hasta hoy no había
              ningún sitio donde ver cuál de los tres falla. Esa ceguera
              es lo que dejó 54 servicios de Peluquería Sole invisibles
              durante semanas en mayo de 2026.
              Se enumeran TODAS las razones, no la primera: arreglar una
              y que siga sin aparecer es el peor final posible. */}
          {invisibleReasons(product).length > 0 && (
            <div className="text-[12.5px] text-amber-700 mt-2">
              No aparece en el TPV: {invisibleReasons(product).join(", ")}.
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-[15px] font-medium text-mipiace-ink tabular-nums">
            {money(product.basePrice)}
          </span>
          {product.editable ? (
            <button
              type="button"
              onClick={onEdit}
              className="h-9 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-[13px] text-mipiace-ink-soft font-medium transition-colors flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </button>
          ) : (
            // Ni botón deshabilitado ni campo gris: la frase. Un control
            // apagado obliga a adivinar por qué lo está.
            <span className="text-[12px] text-slate-400 text-right max-w-[9rem]">
              Se edita en Holded
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "slate" }) {
  return (
    <span
      className={
        tone === "slate"
          ? "px-2 py-0.5 rounded-lg bg-mipiace-stone text-slate-500 text-[11.5px] font-medium shrink-0"
          : ""
      }
    >
      {children}
    </span>
  );
}

function EmptyState({
  hasSearch,
  canCreate,
  onCreate,
}: {
  hasSearch: boolean;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-7 text-center">
      <div className="h-12 w-12 mx-auto rounded-2xl bg-mipiace-stone text-slate-400 flex items-center justify-center mb-3">
        <Package className="w-6 h-6" />
      </div>
      {hasSearch ? (
        <>
          <h2 className="text-[16px] font-semibold text-mipiace-ink">Sin resultados</h2>
          <p className="text-[13.5px] text-slate-500 mt-1">
            Ningún producto coincide con lo que has buscado. Prueba con otra palabra o quita los
            filtros.
          </p>
        </>
      ) : canCreate ? (
        <>
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            Tu catálogo todavía está vacío
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1 mb-4">
            Da de alta tu primer producto y aparecerá en el TPV al momento.
          </p>
          <PrimaryButton
            type="button"
            onClick={onCreate}
            className="!w-auto !h-11 px-5 !text-[13.5px] mx-auto"
          >
            <Plus className="w-4 h-4" />
            Nuevo producto
          </PrimaryButton>
        </>
      ) : (
        <>
          <h2 className="text-[16px] font-semibold text-mipiace-ink">
            Todavía no hay productos de Holded
          </h2>
          <p className="text-[13.5px] text-slate-500 mt-1">
            En cuanto la sincronización traiga tu catálogo, lo verás aquí.
          </p>
        </>
      )}
    </div>
  );
}

// ── El formulario ────────────────────────────────────────────────────

function ProductForm({
  product,
  onCancel,
  onSaved,
}: {
  product?: Product;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isNew = product == null;
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [price, setPrice] = useState(
    product ? product.basePrice.toFixed(2).replace(".", ",") : "",
  );
  // 21 por defecto en el alta: es el caso normal de los verticales de
  // hoy, y un desplegable sin preselección invita a dejarlo sin tocar.
  const [taxRate, setTaxRate] = useState(product?.taxRate ?? 21);
  // Un producto que ya existe con un tipo fuera de la lista (un IGIC,
  // por ejemplo) abre el formulario con "Otro" ya elegido y su número
  // puesto. Si no, la edición se lo cambiaría al 21 sin avisar.
  const [customTax, setCustomTax] = useState(
    product != null && !TAX_RATES.includes(product.taxRate),
  );
  const [customTaxText, setCustomTaxText] = useState(
    product != null && !TAX_RATES.includes(product.taxRate)
      ? String(product.taxRate).replace(".", ",")
      : "",
  );
  const [kind, setKind] = useState<Kind>(product?.kind ?? "PRODUCT");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [tags, setTags] = useState(product?.tags.join(", ") ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sugerencia de SKU sólo en el alta: en una edición el SKU ya es el
  // que el propietario eligió y proponerle otro sería invitarle a
  // romper su propia llave.
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew) return;
    api<{ sku: string | null }>("/catalog/products/sku-suggestion")
      .then((res) => {
        setSuggested(res.sku);
        // Se rellena, no se impone: el campo queda editable y el
        // propietario lo borra si quiere el suyo.
        setSku((curr) => (curr.length === 0 && res.sku ? res.sku : curr));
      })
      .catch(() => setSuggested(null));
  }, [isNew]);

  function parsePrice(raw: string): number | null {
    // Coma o punto: en un teclado español la coma es lo natural y
    // rechazarla sería castigar al usuario por escribir bien.
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const basePrice = parsePrice(price);
    if (name.trim().length === 0) {
      setError("El nombre es obligatorio.");
      return;
    }
    if (sku.trim().length === 0) {
      setError("El SKU es obligatorio. Es la referencia con la que se identifica el producto.");
      return;
    }
    if (/\s/.test(sku.trim())) {
      setError("El SKU no puede llevar espacios. Usa guiones si necesitas separar.");
      return;
    }
    if (basePrice === null) {
      setError("El precio no es válido. Escribe un número, por ejemplo 12,50.");
      return;
    }
    // catalogo-local (addendum 2) · el tipo de IVA se valida aquí Y en la
    // API. Las dos, no una: esta da el aviso al momento, la de allí es la
    // que impide que entre por otra vía.
    let effectiveTaxRate = taxRate;
    if (customTax) {
      const parsed = Number(customTaxText.replace(",", "."));
      if (customTaxText.trim().length === 0 || !Number.isFinite(parsed)) {
        setError("Escribe el tipo de IVA. Por ejemplo, 7 para el IGIC canario.");
        return;
      }
      if (parsed < 0 || parsed > 100) {
        setError("El tipo de IVA tiene que estar entre 0 y 100.");
        return;
      }
      if (Math.round(parsed * 100) / 100 !== parsed) {
        setError("El tipo de IVA admite como mucho dos decimales.");
        return;
      }
      effectiveTaxRate = parsed;
    }
    const body = {
      name: name.trim(),
      sku: sku.trim(),
      basePrice,
      taxRate: effectiveTaxRate,
      kind,
      barcode: barcode.trim() === "" ? null : barcode.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      active,
    };
    setBusy(true);
    try {
      if (isNew) {
        await api("/catalog/products", { method: "POST", body });
      } else {
        await api(`/catalog/products/${product.id}`, { method: "PATCH", body });
      }
      onSaved();
    } catch (err) {
      // El choque de SKU llega como 409 con su frase; se pinta tal cual
      // en vez de traducirla otra vez aquí.
      setError(err instanceof ApiError ? err.message : "No se ha podido guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-2xl border border-mipiace-coral/30 ring-2 ring-mipiace-coral/10 p-4 sm:p-5 mb-2.5"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-mipiace-ink">
          {isNew ? "Nuevo producto" : "Editar producto"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cerrar el formulario"
          className="h-9 w-9 rounded-xl hover:bg-slate-50 text-slate-400 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3.5">
        <Field id="cat-name" label="Nombre">
          <input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Corte de pelo, Botella de agua…"
            className={INPUT}
            autoFocus
          />
        </Field>

        <Field
          id="cat-sku"
          label="SKU"
          hint={
            isNew
              ? "La referencia del producto. Te proponemos una; cámbiala si tienes la tuya."
              : "Cambiarlo afecta a las ventas futuras, no a los tickets ya emitidos."
          }
        >
          <input
            id="cat-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder={suggested ?? "REF-001"}
            className={`${INPUT} tabular-nums`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id="cat-price" label="Precio con IVA">
            <input
              id="cat-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className={`${INPUT} tabular-nums`}
            />
          </Field>
          <Field id="cat-tax" label="IVA">
            <select
              id="cat-tax"
              value={customTax ? "OTHER" : String(taxRate)}
              onChange={(e) => {
                if (e.target.value === "OTHER") {
                  setCustomTax(true);
                  return;
                }
                setCustomTax(false);
                setTaxRate(Number(e.target.value));
              }}
              className={`${INPUT} tabular-nums`}
            >
              {TAX_RATES.map((r) => (
                <option key={r} value={r}>
                  {r} %
                </option>
              ))}
              {/* La vía de escape del addendum 2. Sin ella, un comercio
                  canario (IGIC 7 / 3 / 0 %) se queda sin poder dar de
                  alta su producto hasta que despleguemos código. */}
              <option value="OTHER">Otro…</option>
            </select>
          </Field>
        </div>

        {customTax && (
          <Field
            id="cat-tax-custom"
            label="Otro tipo de IVA"
            hint="Entre 0 y 100, con dos decimales como mucho. Por ejemplo, el IGIC canario: 7."
          >
            <input
              id="cat-tax-custom"
              value={customTaxText}
              onChange={(e) => setCustomTaxText(e.target.value)}
              inputMode="decimal"
              placeholder="7"
              autoFocus
              className={`${INPUT} tabular-nums`}
            />
          </Field>
        )}

        <Field id="cat-kind" label="Tipo">
          <select
            id="cat-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className={INPUT}
          >
            <option value="PRODUCT">Producto</option>
            <option value="SERVICE">Servicio</option>
          </select>
        </Field>

        <Field id="cat-barcode" label="Código de barras" hint="Opcional.">
          <input
            id="cat-barcode"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            inputMode="numeric"
            placeholder="8412345678905"
            className={`${INPUT} tabular-nums`}
          />
        </Field>

        <Field
          id="cat-tags"
          label="Etiquetas"
          hint="Separadas por comas. El TPV las usa como categorías."
        >
          <input
            id="cat-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="bebidas, frío"
            className={INPUT}
          />
        </Field>

        <label className="flex items-center gap-2.5 text-[13.5px] text-mipiace-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded accent-mipiace-coral"
          />
          Activo — se puede vender en el TPV
        </label>
      </div>

      <FieldError message={error} />

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 mt-5">
        <OutlineButton onClick={onCancel} className="!w-full sm:!w-auto">
          Cancelar
        </OutlineButton>
        <PrimaryButton busy={busy} className="!w-full sm:!w-auto !h-11 px-6 !text-[13.5px]">
          {isNew ? "Crear producto" : "Guardar cambios"}
        </PrimaryButton>
      </div>
    </form>
  );
}

const INPUT =
  "w-full h-11 px-3.5 rounded-xl bg-mipiace-stone border border-transparent text-[14.5px] text-mipiace-ink focus:bg-white focus:border-mipiace-coral/30 focus:ring-2 focus:ring-mipiace-coral/30 focus:outline-none";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] text-slate-400 mt-1.5">{hint}</p>}
    </div>
  );
}
