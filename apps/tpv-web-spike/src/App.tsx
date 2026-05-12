import { useEffect, useMemo, useState } from "react";
import type { CartLine, Product, TicketResult } from "./types.ts";
import { ApiError, fetchProducts, postTicket } from "./api.ts";

const eur = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PayState =
  | { kind: "idle" }
  | { kind: "paying" }
  | { kind: "done"; result: TicketResult }
  | { kind: "error"; message: string; detail?: unknown };

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogState, setCatalogState] = useState<
    { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pay, setPay] = useState<PayState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    fetchProducts()
      .then((items) => {
        if (cancelled) return;
        setProducts(items);
        setCatalogState({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setCatalogState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const total = useMemo(
    () =>
      cart.reduce((acc, line) => {
        const p = productById.get(line.productId);
        return acc + (p ? p.total * line.units : 0);
      }, 0),
    [cart, productById],
  );

  function addToCart(productId: string) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, units: l.units + 1 } : l,
        );
      }
      return [...prev, { productId, units: 1 }];
    });
  }

  function changeUnits(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.productId === productId ? { ...l, units: l.units + delta } : l,
        )
        .filter((l) => l.units > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  async function handleCobrar() {
    if (cart.length === 0 || pay.kind === "paying") return;
    setPay({ kind: "paying" });
    try {
      const result = await postTicket(cart);
      setPay({ kind: "done", result });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error desconocido";
      const detail = err instanceof ApiError ? err.body : undefined;
      setPay({ kind: "error", message, detail });
    }
  }

  function startNewSale() {
    setCart([]);
    setPay({ kind: "idle" });
  }

  function dismissError() {
    setPay({ kind: "idle" });
  }

  return (
    <div className="tpv">
      <header className="tpv-header">
        <h1>mipiace-tpv</h1>
        <span className="tpv-cashier">Cajero: Test</span>
      </header>
      <div className="tpv-body">
        <section className="tpv-grid">
          <h2>Productos</h2>
          {catalogState.kind === "loading" && (
            <p className="tpv-grid-msg">Cargando catálogo desde Holded…</p>
          )}
          {catalogState.kind === "error" && (
            <p className="tpv-grid-msg tpv-grid-msg-error">
              No se pudo cargar el catálogo: {catalogState.message}
            </p>
          )}
          {catalogState.kind === "ready" && products.length === 0 && (
            <p className="tpv-grid-msg">
              El catálogo está vacío. Comprueba que en Holded haya productos
              con SKU rellenado, forSale=1 y stock&nbsp;&gt;&nbsp;0.
            </p>
          )}
          {catalogState.kind === "ready" && products.length > 0 && (
            <div className="tpv-grid-items">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="tpv-product"
                  onClick={() => addToCart(p.id)}
                  disabled={pay.kind === "paying"}
                >
                  <span className="tpv-product-name">{p.name}</span>
                  <span className="tpv-product-price">{eur(p.total)} €</span>
                  <span className="tpv-product-tax">IVA {p.tax}%</span>
                </button>
              ))}
            </div>
          )}
        </section>
        <aside className="tpv-cart">
          <h2>Carrito</h2>
          <div className="tpv-cart-lines">
            {cart.length === 0 ? (
              <p className="tpv-cart-empty">El carrito está vacío.</p>
            ) : (
              cart.map((line) => {
                const p = productById.get(line.productId);
                if (!p) return null;
                return (
                  <div className="tpv-cart-line" key={line.productId}>
                    <div className="tpv-cart-line-info">
                      <span className="tpv-cart-line-name">{p.name}</span>
                      <span className="tpv-cart-line-sub">
                        {eur(p.total)} € × {line.units} = {eur(p.total * line.units)} €
                      </span>
                    </div>
                    <div className="tpv-cart-line-actions">
                      <button
                        type="button"
                        className="tpv-step"
                        onClick={() => changeUnits(line.productId, -1)}
                        disabled={pay.kind === "paying"}
                        aria-label="Quitar uno"
                      >
                        −
                      </button>
                      <span className="tpv-units">{line.units}</span>
                      <button
                        type="button"
                        className="tpv-step"
                        onClick={() => changeUnits(line.productId, +1)}
                        disabled={pay.kind === "paying"}
                        aria-label="Añadir uno"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="tpv-remove"
                        onClick={() => removeLine(line.productId)}
                        disabled={pay.kind === "paying"}
                        aria-label="Quitar línea"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="tpv-cart-footer">
            <div className="tpv-total-row">
              <span>TOTAL</span>
              <span className="tpv-total">{eur(total)} €</span>
            </div>
            <button
              type="button"
              className="tpv-pay"
              disabled={cart.length === 0 || pay.kind === "paying"}
              onClick={handleCobrar}
            >
              {pay.kind === "paying" ? "Procesando…" : "Cobrar efectivo"}
            </button>
          </div>
        </aside>
      </div>

      {pay.kind === "done" && (
        <Modal kind="success">
          <h3>Ticket emitido</h3>
          <dl className="tpv-modal-fields">
            <dt>Número fiscal</dt>
            <dd className="tpv-modal-docnumber">{pay.result.docNumber}</dd>
            <dt>Total cobrado</dt>
            <dd>{eur(pay.result.total)} €</dd>
            <dt>ID Holded</dt>
            <dd className="tpv-modal-mono">{pay.result.holdedDocumentId}</dd>
            <dt>External ID</dt>
            <dd className="tpv-modal-mono">{pay.result.externalId}</dd>
          </dl>
          <button type="button" className="tpv-modal-cta" onClick={startNewSale}>
            Nueva venta
          </button>
        </Modal>
      )}

      {pay.kind === "error" && (
        <Modal kind="error">
          <h3>No se pudo emitir el ticket</h3>
          <p className="tpv-modal-error-msg">{pay.message}</p>
          {pay.detail !== undefined && (
            <pre className="tpv-modal-detail">
              {typeof pay.detail === "string"
                ? pay.detail
                : JSON.stringify(pay.detail, null, 2)}
            </pre>
          )}
          <button type="button" className="tpv-modal-cta-secondary" onClick={dismissError}>
            Volver al carrito
          </button>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  kind,
  children,
}: {
  kind: "success" | "error";
  children: React.ReactNode;
}) {
  return (
    <div className="tpv-modal-overlay">
      <div className={`tpv-modal tpv-modal-${kind}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
