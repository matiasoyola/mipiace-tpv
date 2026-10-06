// clinica-3 · la pantalla «Sesión cerrada», en sus DOS variantes de rol.
//
// Es la pieza donde la regla 8 se ve con los ojos (decisión de producto 8,
// Matías 06-10-2026):
//
//   · **Dueña / encargado / cajero-sanitario** · «Pasa a caja» con las
//     líneas y sus importes, el total, y el botón «Cobrar ahora».
//   · **Sanitario sin caja** · «Enviada a recepción para cobrar» con la
//     lista SIN precios, un ✓ por línea, y ningún botón de cobro.
//
// ── Y la diferencia no la decide esta pantalla ───────────────────────
//
// La decide el SERVIDOR: cuando `verImportes` es `false`, las claves de
// precio **no están en la respuesta** (`clinica/sesion-view.ts`). Esta
// pantalla pinta lo que hay. Si mañana alguien le quitara el `if`, no
// aparecería un importe: aparecería `undefined`, porque no hay ningún
// número que pintar. Eso es lo que hace que la regla esté comprobada en la
// API y no escondida aquí.
//
// El `verImportes` se usa para elegir el TEXTO y el botón, no para filtrar
// datos — filtrar ya está hecho antes de que esto se monte.

import { Check } from "lucide-react";
import {
  NOMBRE_DE_PROXIMA_CITA,
  nombreDeConsejo,
  type ProximaCita,
} from "@mipiacetpv/clinica-sesion";

import { euros } from "./SesionPodologia.js";

/** Lo que devuelve la API al cerrar (y en la vista, si ya estaba cerrada). */
export interface SesionCerradaView {
  entryId: string;
  cerradaEn: string;
  firma: {
    autorNombre: string;
    colegiado: string | null;
    firmadaEn: string;
  };
  cuerpo: {
    dolor: number;
    evolucion: string | null;
    consejos: string[];
    proximaCita: ProximaCita | null;
    nota: string | null;
    consejosVersion: number;
  };
  marcas: Array<{
    clave: string;
    zona: string;
    lesion: string;
    gravedad: string | null;
  }>;
  resumen: {
    tratamientos: number;
    /** `precio` e `iva` NO VIENEN si el actor no ve importes. */
    lineas: Array<{
      serviceId: string;
      nombre: string;
      precio?: number;
      iva?: number;
    }>;
    total?: number;
    ivaTexto?: string | null;
    textoDelBoton: string;
  };
  yaCobrada: boolean;
}

export function SesionCerrada(props: {
  cerrada: SesionCerradaView;
  verImportes: boolean;
  paciente: string;
  /** Sólo para quien cobra, y sólo si no está ya cobrada. */
  onCobrar?: () => void;
}) {
  const { cerrada } = props;
  const prox = cerrada.cuerpo.proximaCita;
  return (
    // `data-test` por lo mismo que el pie de la sesión: detrás del overlay
    // sigue estando la pantalla de venta con sus precios.
    <div className="max-w-[760px] mx-auto py-6" data-test="sesion-cerrada">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-mipiace-ink m-0 mb-1.5">
        Sesión cerrada
      </h1>
      {/* LA FIRMA, con el colegiado tal como estaba al cerrar. */}
      <div className="text-[12.5px] text-slate-500">
        Firmada por {cerrada.firma.autorNombre}
        {cerrada.firma.colegiado ? ` (${cerrada.firma.colegiado})` : ""} ·{" "}
        {fechaYHora(cerrada.cerradaEn)} · ya no se puede editar, solo añadir
        anotaciones.
      </div>

      {props.verImportes ? (
        <div className="bg-white border border-slate-200 rounded-3xl px-5 py-4 mt-4">
          <div className="text-[13px] font-medium text-mipiace-ink-soft mb-1">
            Pasa a caja
          </div>
          {cerrada.resumen.lineas.map((l) => (
            <Linea key={l.serviceId} nombre={l.nombre}>
              {/* «Incluido» es un precio de 0 en el catálogo, no una marca
                  aparte: el ticket lleva su línea a 0 igual. */}
              {l.precio === 0 ? "incluido" : euros(l.precio ?? 0)}
            </Linea>
          ))}
          <div className="flex justify-between pt-2 mt-1 border-t border-slate-200 font-semibold text-[16px]">
            <span>
              Total
              {/* EL TEXTO DEL IVA SALE DEL CATÁLOGO. El mockup escribe
                  «exento de IVA» porque su clínica lo es; aquí no se
                  escribe «exento» nunca, porque el registro de Verifactu
                  sigue declarando S1 y el ticket va a llevar el IVA que
                  diga el catálogo. Es la única divergencia declarada con
                  el mockup validado. */}
              {cerrada.resumen.ivaTexto &&
                ` · ${cerrada.resumen.ivaTexto.toLowerCase()}`}
            </span>
            <span className="tabular-nums">
              {euros(cerrada.resumen.total ?? 0)}
            </span>
          </div>
          {props.onCobrar && (
            <button
              type="button"
              onClick={props.onCobrar}
              className="mt-3 h-touch-lg px-7 rounded-[18px] bg-mipiace-coral text-white font-medium text-[16px]"
            >
              Cobrar ahora
            </button>
          )}
          {cerrada.yaCobrada && (
            <div className="text-[13px] text-emerald-700 mt-3">
              Esta cita ya se cobró.
            </div>
          )}
          <div className="text-[12.5px] text-slate-500 mt-2">
            La recepción lo ve en caja sin ver nada de la historia.
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-3xl px-5 py-4 mt-4">
          <div className="text-[13px] font-medium text-mipiace-ink-soft mb-1">
            Enviada a recepción para cobrar
          </div>
          {cerrada.resumen.lineas.map((l) => (
            <Linea key={l.serviceId} nombre={l.nombre}>
              <Check
                className="w-[18px] h-[18px] inline text-emerald-700"
                strokeWidth={2.5}
                aria-label="hecho"
              />
            </Linea>
          ))}
          <div className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
            Sin importes: el personal sanitario sin caja no ve precios ni
            cobra. La recepción la tiene ya en su lista de pendientes de
            cobro.
          </div>
        </div>
      )}

      {prox && prox !== "SIN_CITA" && (
        <Nota verde>
          Próxima cita propuesta: dentro de{" "}
          {NOMBRE_DE_PROXIMA_CITA[prox].toLowerCase()}. La recepción elige el
          hueco con {props.paciente.split(" ")[0]} al cobrar.
        </Nota>
      )}

      {cerrada.cuerpo.consejos.length > 0 && (
        <Nota>
          Hoja de consejos lista:{" "}
          {cerrada.cuerpo.consejos
            .map((id) => nombreDeConsejo(id, cerrada.cuerpo.consejosVersion))
            .join(" · ")
            .toLowerCase()}
          .{" "}
          {/* Imprimirla o mandarla por email va con el informe PDF
              (clinica-4, fuera de alcance declarado). Se dice en vez de
              pintar un botón que no hace nada. */}
          <span className="text-slate-500">
            Imprimirla o enviarla llega con el informe.
          </span>
        </Nota>
      )}

      {cerrada.marcas.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-3xl px-5 py-4 mt-4">
          <div className="text-[13px] font-medium text-mipiace-ink-soft mb-2">
            Lo marcado en el pie
          </div>
          <div className="text-[13.5px] leading-relaxed">
            {cerrada.marcas.map((m) => (
              <div key={m.clave}>
                · <b className="font-medium">{m.zona}</b>: {m.lesion}
                {m.gravedad && ` (${m.gravedad.toLowerCase()})`}
              </div>
            ))}
          </div>
        </div>
      )}

      {cerrada.cuerpo.nota && (
        <div className="bg-mipiace-stone rounded-2xl px-4 py-3 mt-4 text-[13.5px] leading-relaxed">
          <span className="text-slate-500">Nota · </span>
          {cerrada.cuerpo.nota}
        </div>
      )}
    </div>
  );
}

function Linea(props: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-t border-slate-100 first:border-t-0 text-[14.5px]">
      <span>{props.nombre}</span>
      <span className="tabular-nums">{props.children}</span>
    </div>
  );
}

function Nota(props: { verde?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 text-[14px] leading-snug mt-3.5 ${
        props.verde
          ? "bg-emerald-50 text-emerald-700"
          : "bg-mipiace-stone text-mipiace-ink"
      }`}
    >
      {props.children}
    </div>
  );
}

function fechaYHora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  })} a las ${d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
