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

// kds-1-cocina · LA MISMA lista de los 14 que usan el TPV, la pantalla de
// cocina y el papel de la comanda. Una copia aquí acabaría en que el panel
// dice «Lácteos» y el papel «Leche», y en una alergia eso no es un detalle
// de estilo (ver la cabecera de `ticket-model/alergenos.ts`).
import { ALERGENOS, LISTA_ALERGENOS } from "@mipiacetpv/ticket-model";

import { AdminShell } from "../AdminShell.js";
import { api, ApiError, clearTokens } from "../api.js";
import { useTenantCapabilities } from "../capabilities.js";
import { CenteredLoader, FieldError, OutlineButton, PrimaryButton } from "../ui.js";

// iva-exento-sanitario · la única causa de exención que esta pantalla
// ofrece, con su etiqueta y su referencia legal.
//
// E1 es «Exenta por el artículo 20» para la AEAT (lista L10 del diseño de
// registro) y aquí se presenta como «Exento · sanitario · art. 20.Uno.3º»,
// que es la única exención del art. 20 que este producto cubre (decisión 2
// del bloque). Los textos están duplicados aquí a propósito y por la misma
// razón que `TAX_RATES`: el admin y la API no comparten paquete, y sacar
// dos frases a un `packages/` nuevo pesa más que la duplicación. La fuente
// de verdad es `PRESENTACION.E1` en `@mipiacetpv/ticket-model`, y un test
// comprueba que las dos dicen lo mismo.
const EXENCION_SANITARIA = "E1";
const EXENCION_ETIQUETA = "Exento · sanitario";
const EXENCION_REFERENCIA = "art. 20.Uno.3º";
// El aviso verde del mockup. Dice lo que cambia en la ficha, que es lo
// único que el propietario necesita saber: con exento no hay conversión
// neto/bruto, el precio ES el precio (decisión 4).
const EXENCION_AVISO = "El precio es el que paga el paciente. Sin IVA.";

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
  /** NETO, que es lo que guarda la columna. */
  basePrice: number;
  // catalogo-en-alta · el precio CON IVA, calculado en el servidor con la
  // MISMA función que usa el TPV para la rejilla (`brutoDesdeNeto`). Es
  // el que esta pantalla pinta y el que se teclea, porque es el de la
  // carta; el neto no se le pide a nadie.
  //
  // Antes esta pantalla enseñaba y mandaba `basePrice` bajo una etiqueta
  // que decía «Precio con IVA», así que un café tecleado a 1,60 se
  // guardaba como neto y el TPV lo vendía a 1,76.
  priceGross: number;
  taxRate: number;
  // iva-exento-sanitario · la causa de exención (lista L10) o null si la
  // operación es sujeta. Un `taxRate` de 0 SIN causa es un 0 % sujeto, que
  // es otra cosa: no se confunden nunca, ni aquí ni en el ticket.
  exemptionCause: string | null;
  // kds-1-cocina · los alérgenos del plato. Opcional porque la respuesta
  // de antes del bloque no los trae y la lista tiene que seguir
  // pintándose: sin el campo, ninguno marcado.
  allergens?: string[];
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
  const [usaHolded, setUsaHolded] = useState<boolean | null>(null);
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
    // catalogo-local (addendum 3) · la pregunta es "¿usa Holded?"
    // (`holdedEnabled`), no "¿lo tiene conectado?" (`hasHoldedKey`). El
    // que lo usa y aún no lo ha conectado TAMPOCO da de alta productos
    // locales: está a mitad de su onboarding. Mismo predicado exacto que
    // la puerta del servidor, para que el botón y el 403 no puedan
    // discrepar.
    api<{ tenant: { holdedEnabled?: boolean } }>("/auth/me")
      .then((me) => setUsaHolded(me.tenant.holdedEnabled !== false))
      // Al fallar se asume que SÍ usa Holded: esconde el botón de alta
      // en vez de ofrecer un alta que el servidor va a rechazar con un
      // 403. Misma dirección que la puerta del servidor
      // (`lib/catalogo-local-gate.ts`), que también cierra al no saber.
      .catch(() => setUsaHolded(true));
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

  const canCreate = usaHolded === false;
  const items = data?.items ?? [];
  // El catálogo vacío de verdad (no una búsqueda sin resultados) pinta su
  // propio "Nuevo producto" dentro del estado vacío. Lo encontró el bucle
  // visual: se veían los DOS a la vez, uno encima del otro, en una
  // pantalla donde no hay nada más. El de la barra se calla.
  const vacioDeVerdad =
    data != null && items.length === 0 && search.trim() === "" && filter === "ALL";

  return (
    <AdminShell title="Catálogo">
      <p className="text-[13.5px] text-slate-500 mb-5 -mt-2">
        {canCreate
          ? "Los productos y servicios que vendes en el TPV. Aquí los das de alta y los editas."
          : "Los productos y servicios que vendes en el TPV."}
      </p>

      {usaHolded === true && (
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
        {canCreate && editing !== "new" && !vacioDeVerdad && (
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
        {(data?.localCount ?? 0) > 0 && usaHolded === true && (
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

      {/* El error y el cargador son EXCLUYENTES. Lo encontró el bucle
          visual: al fallar la carga, `data` seguía en `null` y la
          pantalla pintaba el aviso rojo Y un "Cargando catálogo…"
          girando debajo, para siempre. Quien lo viera entendería que
          todavía está intentándolo. */}
      {!data && error ? null : !data ? (
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
          {/* `break-all` en toda la línea partía el código de barras por
              la mitad a 320 px ("8 412345678905"), y un EAN partido no se
              puede leer ni teclear. Se parte entre campos, no dentro:
              cada trozo va en su `span` que no se rompe. */}
          <div className="text-[12.5px] text-slate-500 mt-1 tabular-nums flex flex-wrap gap-x-1.5">
            <span className="break-all">{product.sku ?? "Sin SKU"}</span>
            <span aria-hidden>·</span>
            {/* iva-exento-sanitario · un producto exento no dice «IVA
                0%»: dice que está exento. Es la misma confusión que el
                bloque cierra en el ticket, y aquí la vería la podóloga
                cada vez que repasa su catálogo. */}
            <span className="whitespace-nowrap">
              {product.exemptionCause
                ? `${EXENCION_ETIQUETA} · ${EXENCION_REFERENCIA}`
                : `IVA ${product.taxRate}%`}
            </span>
            {product.barcode && (
              <>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">{product.barcode}</span>
              </>
            )}
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
            {money(product.priceGross)}
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
  // iva-exento-sanitario · el chip de la exención SÓLO si el comercio
  // tiene la historia clínica encendida (decisión 5 del bloque). Un bar no
  // ve esa opción: una clínica es un tenant de quince, y un chip de
  // exención sanitaria en el catálogo de La Maestranza es una invitación a
  // dejar de cobrar el IVA de las cañas.
  //
  // `capacidades` es `null` mientras carga, y entonces el chip no se
  // pinta: misma dirección que el resto de los gates del panel —esconder
  // una opción que toca es un incordio, enseñar una que no toca se cobra
  // mal durante meses.
  const capacidades = useTenantCapabilities();
  // Y si un producto exento llega a un comercio SIN clínica (no debería),
  // el chip aparece igualmente, marcado, para poder quitarlo. Una ficha
  // que cobra exento y una pantalla que dice que lleva el 21 % es peor que
  // una opción de más.
  const puedeExencion =
    capacidades?.clinica === true || product?.exemptionCause != null;
  // kds-1-cocina · los alérgenos SÓLO en hostelería. Y si un producto ya
  // los tiene en un vertical que no es hostelería (una importación, un
  // cambio de vertical), el bloque se pinta igualmente para poder
  // quitarlos: mismo criterio que la exención de arriba.
  const esHosteleria =
    capacidades?.businessType === "HOSPITALITY" ||
    (product?.allergens?.length ?? 0) > 0;
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  // Ida y vuelta: se abre con el precio CON IVA y se guarda convirtiendo
  // a neto en el servidor. Un producto que se edita y se guarda sin tocar
  // el campo tiene que quedar con el mismo precio que tenía.
  const [price, setPrice] = useState(
    product ? product.priceGross.toFixed(2).replace(".", ",") : "",
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
  // iva-exento-sanitario · la causa de exención elegida. `null` = sujeta.
  // Un producto ya marcado abre el formulario con el chip puesto, igual
  // que el «Otro…» del addendum 2 con su número.
  const [exemptionCause, setExemptionCause] = useState<string | null>(
    product?.exemptionCause ?? null,
  );
  const [kind, setKind] = useState<Kind>(product?.kind ?? "PRODUCT");
  // kds-1-cocina · los alérgenos del plato.
  //
  // **Sin gatear por el módulo «Cocina»**, y es la decisión 10: informar
  // de alérgenos es una obligación legal de cualquier bar, no una función
  // que se vende. Lo que se cobra es la pantalla; esto va de serie.
  //
  // Se pinta sólo en HOSTELERÍA, eso sí: en una peluquería o una papelería
  // catorce casillas de alérgenos serían catorce casillas de ruido.
  const [alergenos, setAlergenos] = useState<string[]>(
    product?.allergens ?? [],
  );
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
    const priceGross = parsePrice(price);
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
    if (priceGross === null) {
      setError("El precio no es válido. Escribe un número, por ejemplo 12,50.");
      return;
    }
    // catalogo-local (addendum 2) · el tipo de IVA se valida aquí Y en la
    // API. Las dos, no una: esta da el aviso al momento, la de allí es la
    // que impide que entre por otra vía.
    let effectiveTaxRate = taxRate;
    // iva-exento-sanitario · exento ⇒ 0 %, y se fuerza aquí en vez de
    // confiar en que los chips estén coherentes. La misma regla la aplican
    // la API (`validateLocalProduct`) y el motor (CHECK
    // `products_exencion_sin_iva`): tres puertas, una regla.
    //
    // Elegir «Exento · sanitario» APAGA el tipo tecleado y el «Otro…», que
    // es lo que el chip significa. No hay forma de quedarse con los dos
    // marcados —son un grupo de selección única— pero sí de abrir la ficha
    // de un producto con «Otro… 7» y pulsar el chip de exento, y entonces
    // el 7 no puede viajar.
    if (exemptionCause != null) {
      effectiveTaxRate = 0;
    } else if (customTax) {
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
      // Con IVA. La conversión a neto la hace el servidor con el mismo
      // `normalizePrice` que usa la carga de fichero del super-admin.
      priceGross,
      taxRate: effectiveTaxRate,
      // `null` explícito y no `undefined`: en el PATCH, ausente significa
      // «no toques la causa» y `null` significa «quítala». Al editar un
      // producto exento y desmarcarlo hay que mandar el `null`.
      exemptionCause,
      kind,
      barcode: barcode.trim() === "" ? null : barcode.trim(),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      active,
      // kds-1-cocina · la lista ENTERA, como los tags: lo que queda es
      // exactamente lo que está marcado. Vacía es un estado válido y
      // significa «no informado».
      allergens: alergenos,
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

        {/* iva-exento-sanitario · el precio y el IVA dejan de ir en la
            misma rejilla de dos columnas.
            El IVA pasa a CHIPS porque la opción de la exención no es un
            número: es «Exento · sanitario  art. 20.Uno.3º», y eso no cabe
            en un `<option>` de 90 px al lado del precio. Es el selector del
            mockup validado el 07-10. */}
        <Field id="cat-price" label={exemptionCause ? "Precio" : "Precio con IVA"}>
          {/* El rótulo cambia con la exención, y no es un detalle: hasta
              catalogo-en-alta esta pantalla enseñaba el NETO bajo una
              etiqueta que decía «Precio con IVA» y un café tecleado a 1,60
              se vendía a 1,76. Con exento no hay «precio con IVA» distinto
              del precio —no hay IVA— y mantener el rótulo sería volver a
              poner una etiqueta que no describe el campo (decisión 4). */}
          <input
            id="cat-price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className={`${INPUT} tabular-nums`}
          />
        </Field>

        <div>
          <span className="block text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
            IVA
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="IVA">
            {TAX_RATES.map((r) => (
              <TaxChip
                key={r}
                label={`${r} %`}
                active={exemptionCause == null && !customTax && taxRate === r}
                onClick={() => {
                  setExemptionCause(null);
                  setCustomTax(false);
                  setTaxRate(r);
                }}
              />
            ))}
            {/* La vía de escape del addendum 2. Sin ella, un comercio
                canario (IGIC 7 / 3 / 0 %) se queda sin poder dar de alta
                su producto hasta que despleguemos código. */}
            <TaxChip
              label="Otro…"
              active={exemptionCause == null && customTax}
              onClick={() => {
                setExemptionCause(null);
                setCustomTax(true);
              }}
            />
            {puedeExencion && (
              /* El chip ANCHO del mockup: ocupa la fila entera porque lleva
                 dos textos —la etiqueta y el precepto— y porque es una
                 elección de otra naturaleza que las de arriba. Las de
                 arriba son «cuánto IVA»; ésta es «no hay IVA, y por este
                 artículo». */
              <button
                type="button"
                aria-pressed={exemptionCause != null}
                onClick={() =>
                  setExemptionCause((curr) =>
                    curr != null ? null : EXENCION_SANITARIA,
                  )
                }
                className={
                  "basis-full h-11 px-3.5 rounded-xl text-[14.5px] font-medium text-left flex items-center gap-2.5 transition-colors " +
                  (exemptionCause != null
                    ? "bg-mipiace-coral text-white"
                    : "bg-mipiace-stone text-mipiace-ink hover:bg-slate-100")
                }
              >
                {EXENCION_ETIQUETA}
                <span
                  className={
                    "text-[12.5px] font-normal " +
                    (exemptionCause != null ? "text-white/85" : "text-slate-400")
                  }
                >
                  {EXENCION_REFERENCIA}
                </span>
              </button>
            )}
          </div>
          {exemptionCause != null && (
            <p className="mt-2.5 text-[13px] text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2.5">
              {EXENCION_AVISO}
            </p>
          )}
        </div>

        {customTax && exemptionCause == null && (
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

        {/* kds-1-cocina · LOS ALÉRGENOS. De serie en hostelería: informar
            de ellos es obligación legal (Reglamento UE 1169/2011), no una
            función del módulo de cocina.

            Catorce casillas y no un desplegable: el propietario las
            repasa de un golpe mirando su propia receta, y lo que tiene
            que poder ver sin abrir nada es QUÉ hay marcado. */}
        {esHosteleria && (
          <div className="sm:col-span-2" data-testid="cat-alergenos">
            <div className="text-[13px] font-medium text-mipiace-ink-soft mb-1.5">
              Alérgenos
            </div>
            <p className="text-[12px] text-slate-500 mb-2">
              Los catorce de declaración obligatoria. Si no marcas ninguno,
              queda como <strong>no informado</strong> — que no es lo mismo que
              «sin alérgenos»: la pantalla de cocina no puede avisar de lo que
              no sabe.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {LISTA_ALERGENOS.map((a) => {
                const puesto = alergenos.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    data-testid="cat-alergeno"
                    data-alergeno={a}
                    data-puesto={puesto ? "1" : "0"}
                    aria-pressed={puesto}
                    onClick={() =>
                      setAlergenos((prev) =>
                        puesto ? prev.filter((x) => x !== a) : [...prev, a],
                      )
                    }
                    className={
                      "h-9 px-3 rounded-lg text-[13px] font-medium border " +
                      (puesto
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-mipiace-stone text-mipiace-ink border-transparent hover:bg-slate-100")
                    }
                  >
                    {ALERGENOS[a].etiqueta}
                  </button>
                );
              })}
            </div>
          </div>
        )}
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

// iva-exento-sanitario · un chip del selector de IVA.
//
// Alto 44 px (`h-11`) como los `INPUT` de esta pantalla y no los 52 del
// mockup: el mockup es un iPad y el panel se usa en el móvil del
// propietario, donde la rejilla de esta ficha ya está calibrada a 44. Sigue
// por encima del mínimo táctil de 44×44 de `docs/ux-principles.md`.
function TaxChip({
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
      aria-pressed={active}
      onClick={onClick}
      className={
        "h-11 min-w-[66px] px-3.5 rounded-xl text-[14.5px] font-medium tabular-nums transition-colors " +
        (active
          ? "bg-mipiace-coral text-white"
          : "bg-mipiace-stone text-mipiace-ink hover:bg-slate-100")
      }
    >
      {label}
    </button>
  );
}

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
