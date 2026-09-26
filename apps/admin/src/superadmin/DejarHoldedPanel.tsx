// holded-desconectar · la pantalla de «Dejar Holded». ADR-020.
//
// Dos pasos y ni uno más:
//
//   1. **La previsualización.** Lo que va a pasar, con los números de ESE
//      comercio, sacados de consultas reales. Si algo lo impide, sale
//      arriba, en rojo, con qué hay que hacer para resolverlo — y el botón
//      de confirmar no existe.
//   2. **La confirmación.** Hay que teclear el nombre del comercio. No es
//      teatro: es la misma clase de confirmación que pide un `DROP
//      DATABASE`, y lo que está en juego es el catálogo y la contabilidad
//      de un negocio que está vendiendo. Un «¿seguro?» se pulsa sin leer.
//
// ── Por qué un panel y no un modal ────────────────────────────────────
//
// Porque hay que LEERLO, y en un móvil de 320 px un modal con esta
// cantidad de información es una caja que hace scroll dentro de otra caja
// que hace scroll. El panel se abre debajo de «Acciones», crece hacia
// abajo y se cierra solo cuando el corte termina.
//
// ── Por qué el aviso del APK no bloquea ───────────────────────────────
//
// Porque decidirlo comparando cadenas de versión es exactamente lo que
// verifactu-1b vino a corregir: «un invariante que se decide comparando
// cadenas de texto se rompe el día que alguien traduce el nombre». Se
// enseña la versión de cada terminal, su último latido y cuántos registros
// fiscales lleva su caja, y decide una persona.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Unplug, X } from "lucide-react";

import { superApi, SuperAdminApiError } from "./api.js";
import { humanizeError } from "./error-messages.js";
import type {
  DejarHoldedBloqueo,
  DejarHoldedPreview,
  DejarHoldedResultado,
} from "./types.js";

export function DejarHoldedPanel({
  tenantId,
  tenantName,
  onCerrar,
  onCortado,
}: {
  tenantId: string;
  tenantName: string;
  onCerrar: () => void;
  onCortado: (r: DejarHoldedResultado) => void;
}) {
  const [previa, setPrevia] = useState<DejarHoldedPreview | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  // Los bloqueos que devuelve el POST cuando algo ha cambiado entre la
  // previsualización y el botón. Se pintan igual que los de la previa: el
  // que pulsó tiene que leer LO MISMO, no un 409 genérico.
  const [bloqueosDelPost, setBloqueosDelPost] = useState<DejarHoldedBloqueo[] | null>(
    null,
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    setBloqueosDelPost(null);
    try {
      setPrevia(
        await superApi<DejarHoldedPreview>(
          `/super-admin/tenants/${tenantId}/dejar-holded`,
        ),
      );
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setCargando(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function confirmar(): Promise<void> {
    setEnviando(true);
    setError(null);
    setBloqueosDelPost(null);
    try {
      const r = await superApi<DejarHoldedResultado>(
        `/super-admin/tenants/${tenantId}/dejar-holded`,
        { method: "POST", body: { confirmacion } },
      );
      onCortado(r);
    } catch (e) {
      // `SuperAdminApiError.detail` trae el cuerpo del 409 entero, y ahí
      // vienen los bloqueos. Se pintan tal cual: si entre la
      // previsualización y el botón alguien ha cobrado, el que pulsó tiene
      // que leer LO MISMO que le enseñó la pantalla, no un 409 genérico.
      const cuerpo =
        e instanceof SuperAdminApiError
          ? (e.detail as { bloqueos?: DejarHoldedBloqueo[] } | null)
          : null;
      if (cuerpo?.bloqueos != null) {
        setBloqueosDelPost(cuerpo.bloqueos);
        // Y se recarga: la pantalla tiene que volver a enseñar la verdad
        // de ahora, no la de hace treinta segundos.
        await cargar();
      } else {
        setError(humanizeError(e));
      }
    } finally {
      setEnviando(false);
    }
  }

  const bloqueos = bloqueosDelPost ?? previa?.bloqueos ?? [];
  const puede = previa?.puedeArrancar === true && bloqueosDelPost == null;
  const nombreOk = confirmacion.trim() === tenantName.trim();

  return (
    <div
      className="bg-white border-2 border-amber-300 rounded-xl p-4 sm:p-6 mb-6"
      data-testid="dejar-holded-panel"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2 text-[15px]">
          <Unplug className="w-4.5 h-4.5 text-amber-700" />
          Dejar Holded
        </h3>
        <button
          onClick={onCerrar}
          className="shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Cerrar"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>
      <p className="text-[12.5px] text-slate-600 mb-4">
        Este comercio pasa a gestionar su catálogo desde el panel y a emitir sus
        propias facturas simplificadas VERI*FACTU. La clave de Holded se borra.
        No hay vuelta atrás desde aquí.
      </p>

      {cargando && (
        <div className="flex items-center gap-2 text-[13px] text-slate-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Midiendo lo que hay en este comercio…
        </div>
      )}

      {error != null && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12.5px] text-red-800">
          {error}
        </div>
      )}

      {previa != null && !cargando && (
        <>
          {/* ── Lo que lo impide ─────────────────────────────────────── */}
          {bloqueos.length > 0 && (
            <div
              className="mb-5 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg"
              data-testid="dejar-holded-bloqueos"
            >
              <p className="flex items-center gap-2 font-semibold text-red-900 text-[13px] mb-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Todavía no se puede
              </p>
              <ul className="space-y-2">
                {bloqueos.map((b) => (
                  <li key={b.codigo} className="text-[12.5px] text-red-800">
                    {b.mensaje}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── El catálogo ──────────────────────────────────────────── */}
          <Seccion titulo="Catálogo">
            <Dato
              etiqueta="Fichas que pasan a ser del comercio"
              valor={`${previa.catalogo.seConvierten}`}
              detalle={`${previa.catalogo.productos} producto(s) · ${previa.catalogo.servicios} servicio(s)`}
            />
            <Dato
              etiqueta="Conservan su enlace con Holded"
              valor={`${previa.catalogo.conservanEnlace}`}
              detalle="Es el hilo para volver a Holded algún día. No se borra."
            />
            {previa.catalogo.archivados > 0 && (
              <Dato
                etiqueta="Archivados en Holded"
                valor={`${previa.catalogo.archivados}`}
                detalle="Siguen archivados: no vuelven a la rejilla del TPV."
              />
            )}
            {previa.catalogo.ivaSinResolver > 0 && (
              <Dato
                etiqueta="Con el IVA sin resolver"
                valor={`${previa.catalogo.ivaSinResolver}`}
                detalle="Siguen sin poder venderse. Ponles el IVA desde Catálogo."
                tono="warning"
              />
            )}
            {previa.catalogo.pasanAVendibles > 0 && (
              <Dato
                etiqueta="Pasan a poder venderse"
                valor={`${previa.catalogo.pasanAVendibles}`}
                detalle="Les faltaba el SKU y la acción se lo da."
              />
            )}
            <p className="text-[11.5px] text-slate-500 leading-relaxed">
              Ninguna ficha cambia de identificador, así que siguen colgando de
              ella {previa.catalogo.cuelgan.lineasDeTicket} línea(s) de ticket
              {previa.catalogo.cuelgan.conAgenda > 0 &&
                `, ${previa.catalogo.cuelgan.conAgenda} servicio(s) de agenda`}
              {previa.catalogo.cuelgan.enCitas > 0 &&
                `, ${previa.catalogo.cuelgan.enCitas} línea(s) de cita`}
              {previa.catalogo.cuelgan.conModificadores > 0 &&
                `, ${previa.catalogo.cuelgan.conModificadores} grupo(s) de modificadores`}
              .
            </p>
          </Seccion>

          {/* ── El SKU ───────────────────────────────────────────────── */}
          {(previa.sku.cambios.length > 0 || previa.sku.choques.length > 0) && (
            <Seccion titulo="SKU">
              {previa.sku.cambios.length > 0 && (
                <>
                  <Dato
                    etiqueta="SKU que hay que acuñar"
                    valor={`${previa.sku.cambios.length}`}
                    detalle="Estaban vacíos o repetidos. Tras el corte el SKU tiene que ser único por comercio."
                  />
                  <ul className="text-[11.5px] text-slate-600 font-mono space-y-0.5 max-h-40 overflow-y-auto">
                    {previa.sku.cambios.slice(0, 30).map((c) => (
                      <li key={c.productoId} className="truncate">
                        {c.nombre} · {c.skuAntes ?? "(vacío)"} → {c.skuDespues}
                      </li>
                    ))}
                  </ul>
                  {previa.sku.cambios.length > 30 && (
                    <p className="text-[11.5px] text-slate-500">
                      …y {previa.sku.cambios.length - 30} más. Todos quedan en el
                      registro de auditoría.
                    </p>
                  )}
                </>
              )}
              {previa.sku.choques.map((c) => (
                <div
                  key={`${c.codigo}-${c.sku ?? "vacio"}`}
                  className="p-2.5 bg-red-50 border border-red-200 rounded-lg"
                >
                  <p className="text-[12.5px] font-medium text-red-900 mb-1">
                    {c.sku == null ? "Ficha sin SKU" : `SKU repetido: ${c.sku}`}
                  </p>
                  <ul className="text-[11.5px] text-red-800 mb-1.5">
                    {c.productos.map((p) => (
                      <li key={p.id} className="truncate">
                        · {p.nombre}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11.5px] text-red-700">{c.comoSeArregla}</p>
                </div>
              ))}
            </Seccion>
          )}

          {/* ── Ventas en vuelo ─────────────────────────────────────── */}
          <Seccion titulo="Ventas y devoluciones">
            <Dato
              etiqueta="Sin cerrar con Holded"
              valor={`${
                previa.ventasEnVuelo.ticketsPendingSync.length +
                previa.ventasEnVuelo.ticketsSyncFailed.length +
                previa.ventasEnVuelo.abonosPendingSync.length +
                previa.ventasEnVuelo.abonosSyncFailed.length
              }`}
              detalle="Tiene que ser 0 antes de cortar."
              tono={
                previa.ventasEnVuelo.ticketsPendingSync.length +
                  previa.ventasEnVuelo.ticketsSyncFailed.length +
                  previa.ventasEnVuelo.abonosPendingSync.length +
                  previa.ventasEnVuelo.abonosSyncFailed.length >
                0
                  ? "danger"
                  : "ok"
              }
            />
            {previa.ventasEnVuelo.subidasHuerfanas.length > 0 && (
              <Dato
                etiqueta="Subidas pendientes sin documento detrás"
                valor={`${previa.ventasEnVuelo.subidasHuerfanas.length}`}
                detalle="No se pueden subir nunca. La acción las cierra."
              />
            )}
            {previa.ventasEnVuelo.turnosAbiertos > 0 && (
              <Dato
                etiqueta="Turnos abiertos"
                valor={`${previa.ventasEnVuelo.turnosAbiertos}`}
                detalle="No impide el corte, pero el arqueo se lee mejor con la tienda cerrada."
                tono="warning"
              />
            )}
            <Dato
              etiqueta="Ventas que facturó Holded y se pueden devolver"
              valor={`${previa.devoluciones.ticketsFacturadosPorHolded}`}
              detalle={`${previa.devoluciones.facturadosPorHoldedUltimos90d} de los últimos 90 días. Sus abonos habrá que crearlos en Holded a mano: saldrán listados en el panel del cliente.`}
            />
            {previa.devoluciones.abonosPorMes.length > 0 && (
              <p className="text-[11.5px] text-slate-500">
                Devoluciones por mes:{" "}
                {previa.devoluciones.abonosPorMes
                  .map((m) => `${m.mes}: ${m.cuantos}`)
                  .join(" · ")}
              </p>
            )}
          </Seccion>

          {/* ── Contactos y CRM ────────────────────────────────────── */}
          <Seccion titulo="Contactos, clientes y fiado">
            <Dato
              etiqueta="Contactos espejo de Holded"
              valor={`${previa.contactosYCrm.contactos}`}
              detalle="Se CONSERVAN. Los tickets antiguos siguen sabiendo a quién se los hicieron, y el listado de deudas sigue poniendo nombres."
            />
            <Dato
              etiqueta="Fichas de cliente del CRM"
              valor={`${previa.contactosYCrm.clientesCrm}`}
              detalle={`${previa.contactosYCrm.clientesConEnlaceHolded} con enlace fiscal a Holded. No se toca ninguna.`}
            />
            <Dato
              etiqueta="Deuda viva (fiado)"
              valor={`${previa.contactosYCrm.deudaVivaTotal} €`}
              detalle={
                previa.contactosYCrm.fiadosVivosConDeudor > 0
                  ? "Hay fiados sin saldar: cóbralos o anúlalos antes."
                  : "Sin fiados pendientes."
              }
              tono={previa.contactosYCrm.fiadosVivosConDeudor > 0 ? "danger" : "ok"}
            />
            <p className="text-[11.5px] text-slate-500 leading-relaxed">
              Tras el corte el cajero deja de poder asignar un contacto de Holded
              al ticket, así que el email AUTOMÁTICO del ticket deja de salir
              (dependía de ese contacto). El email que teclea el cajero a mano
              sigue funcionando igual. Histórico de este comercio:{" "}
              {previa.contactosYCrm.emailsAutomaticosHistoricos} automático(s) y{" "}
              {previa.contactosYCrm.emailsManualesHistoricos} manual(es).
            </p>
          </Seccion>

          {/* ── Fiscal ─────────────────────────────────────────────── */}
          <Seccion titulo="Facturación">
            <div
              className={`p-2.5 rounded-lg border text-[12px] ${
                previa.fiscal.suelo.ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-red-50 border-red-200 text-red-800"
              }`}
            >
              {previa.fiscal.suelo.ok ? (
                <span className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  NIF y razón social comprobados.
                </span>
              ) : (
                previa.fiscal.suelo.problemas.join(" ")
              )}
            </div>
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11.5px] text-amber-900 leading-relaxed">
              {previa.fiscal.avisoApk}
            </div>
            <ul className="text-[11.5px] text-slate-600 space-y-0.5">
              {previa.fiscal.cajas.map((c) => (
                <li key={c.id}>
                  {c.tienda} · {c.nombre ?? "caja"} — serie{" "}
                  <span className="font-mono">{c.serie ?? "—"}</span>,{" "}
                  {c.registrosFiscales} registro(s) fiscal(es)
                </li>
              ))}
              {previa.fiscal.terminales.map((t) => (
                <li key={t.id}>
                  Terminal {t.nombre ?? "sin nombre"} ({t.caja ?? "—"}) · APK{" "}
                  <span className="font-mono">{t.apkVersion ?? "desconocida"}</span>
                  {t.ultimoLatido != null &&
                    ` · último latido ${new Date(t.ultimoLatido).toLocaleString("es-ES")}`}
                </li>
              ))}
              {previa.fiscal.terminales.length === 0 && (
                <li>Sin terminales activos emparejados.</li>
              )}
            </ul>
          </Seccion>

          {/* ── La confirmación ───────────────────────────────────── */}
          <div className="pt-4 border-t border-slate-200">
            {puede ? (
              <>
                <label className="block text-[12.5px] text-slate-700 mb-1.5">
                  Escribe <strong className="font-semibold">{tenantName}</strong>{" "}
                  para confirmar
                </label>
                <input
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                  className="w-full h-11 px-3 border border-slate-300 rounded-lg text-[13px] mb-3"
                  placeholder={tenantName}
                  autoComplete="off"
                  data-testid="dejar-holded-confirmacion"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void confirmar()}
                    disabled={!nombreOk || enviando}
                    data-testid="dejar-holded-confirmar"
                    className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg text-[13px] font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {enviando ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Unplug className="w-4 h-4" />
                    )}
                    Dejar Holded
                  </button>
                  <button
                    onClick={onCerrar}
                    disabled={enviando}
                    className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void cargar()}
                  className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                  data-testid="dejar-holded-revisar"
                >
                  Volver a comprobar
                </button>
                <button
                  onClick={onCerrar}
                  className="h-11 px-4 border border-slate-300 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h4 className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
        {titulo}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  detalle,
  tono = "neutral",
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  tono?: "neutral" | "ok" | "warning" | "danger";
}) {
  const cls =
    tono === "danger"
      ? "text-red-700"
      : tono === "warning"
        ? "text-amber-700"
        : tono === "ok"
          ? "text-emerald-700"
          : "text-slate-900";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] text-slate-700">{etiqueta}</p>
        {detalle != null && (
          <p className="text-[11.5px] text-slate-500 leading-snug">{detalle}</p>
        )}
      </div>
      <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${cls}`}>
        {valor}
      </span>
    </div>
  );
}
