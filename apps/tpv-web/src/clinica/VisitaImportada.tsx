// cogecop-1 · UNA VISITA QUE NO SE HIZO AQUÍ, de solo lectura.
//
// Es la hermana de `SesionCerrada` para lo que viene del programa
// anterior. Y es una pieza aparte, y no un `if` dentro de aquélla, por
// una razón de fondo: **no son la misma cosa**. Una sesión nuestra tiene
// dolor de 0 a 10, evolución, consejos para casa, próxima cita propuesta,
// pendientes y un bloque de caja. Una visita de COGECOP tiene cuatro
// textos y una lista de marcas, y nada más — porque eso es lo que aquel
// programa pedía.
//
// Meterla en `SesionCerrada` habría obligado a hacer opcional la mitad de
// su cuerpo, y entonces una sesión nuestra a la que le faltara el dolor
// (que es obligatorio) se pintaría igual de bien que ésta. La pantalla
// dejaría de poder decir la verdad sobre lo que falta.
//
// ── Lo que esta pantalla NO tiene, y es a propósito ──────────────────
//
//   · **ningún botón.** No se edita, no se anota desde aquí, no se cobra.
//     Es historia de otro programa: lo único que se hace con ella es
//     leerla.
//   · **ningún importe.** Como toda la historia viva (decisión 8 de
//     clinica-6), y aquí además es que no existe: COGECOP no guardaba lo
//     que se cobró.
//
// ── Y lo que SÍ tiene, y es el punto del bloque ──────────────────────
//
// Las marcas que no se pudieron traducir salen **con su nombre de
// COGECOP**. Si no, un «Carcinoma basocelular» marcado en 2025 se habría
// quedado sin pintar en el mapa y sin aparecer en ningún sitio, que es la
// forma silenciosa de perder un dato.

import {
  COLOR_DE_TIPO_DE_VISITA,
  ETIQUETA_DE_IMPORTADA,
  NOMBRE_DE_TIPO_DE_VISITA,
  TIPO_DE_VISITA_IMPORTADO,
  nombreDeLaMarcaImportada,
  nombreDeZona,
  type CuerpoImportado,
} from "@mipiacetpv/clinica-sesion";
import { FileClock } from "lucide-react";

export interface VisitaImportadaView {
  entryId: string;
  cerradaEn: string;
  firma: { autorNombre: string; colegiado: string | null; firmadaEn: string };
  cuerpo: CuerpoImportado;
}

const DIA = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Madrid",
});

function dia(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : DIA.format(d);
}

export function VisitaImportada(props: {
  visita: VisitaImportadaView;
  paciente: string;
}) {
  const { cuerpo } = props.visita;
  const tipo = TIPO_DE_VISITA_IMPORTADO[cuerpo.tipo];
  const color = COLOR_DE_TIPO_DE_VISITA[tipo];

  const textos: Array<[string, string | null]> = [
    ["Motivo", cuerpo.motivo],
    ["Evolución", cuerpo.evolucion],
    ["Diagnóstico", cuerpo.diagnostico],
    ["Recomendación", cuerpo.recomendacion],
  ];
  const conTexto = textos.filter(([, v]) => v != null && v.trim() !== "");

  return (
    <div data-test="visita-importada" className="mt-4">
      <div className="bg-white border border-slate-200 rounded-3xl px-4 sm:px-6 py-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="rounded-xl px-2.5 py-1.5 text-[13px] font-bold whitespace-nowrap"
            style={{ color, backgroundColor: `${color}1A` }}
          >
            {NOMBRE_DE_TIPO_DE_VISITA[tipo]}
          </span>
          <span
            data-test="visita-importada-etiqueta"
            className="inline-flex items-center gap-1.5 rounded-xl bg-mipiace-stone px-2.5 py-1.5 text-[13px] font-semibold text-slate-600"
          >
            <FileClock className="w-4 h-4" aria-hidden />
            {ETIQUETA_DE_IMPORTADA}
          </span>
        </div>

        <h1 className="m-0 mt-3 text-[22px] font-bold tracking-[-0.01em] text-mipiace-ink">
          {props.paciente}
        </h1>
        <div className="text-[14px] text-slate-500 mt-0.5">
          {dia(props.visita.cerradaEn)}
          {" · "}
          {props.visita.firma.autorNombre}
          {props.visita.firma.colegiado
            ? ` · Col. ${props.visita.firma.colegiado}`
            : ""}
        </div>

        {/* La casilla roja que COGECOP tenía por visita. Lo que decía no
            está en su base: lo único que se puede enseñar es que estaba
            puesta, y eso es lo que se enseña. */}
        {cuerpo.alerta && (
          <div
            data-test="visita-importada-alerta"
            className="mt-3 rounded-2xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-[14px] text-red-800"
          >
            Esta visita estaba marcada con alerta en COGECOP. El programa no
            guardaba de qué.
          </div>
        )}

        <p className="mt-4 mb-0 text-[13px] text-slate-500">
          Viene del programa anterior. No se puede editar ni genera ningún
          cobro.
        </p>
      </div>

      {cuerpo.tratamientos.length > 0 && (
        <Bloque titulo="Lo que se le hizo">
          <div className="flex flex-wrap gap-1.5">
            {cuerpo.tratamientos.map((t) => (
              <span
                key={t}
                className="bg-mipiace-stone rounded-[10px] px-2.5 py-1 text-[14px]"
              >
                {t}
              </span>
            ))}
          </div>
        </Bloque>
      )}

      {conTexto.length > 0 && (
        <Bloque titulo="Lo que escribió">
          <dl className="m-0">
            {conTexto.map(([etiqueta, valor]) => (
              <div key={etiqueta} className="mt-2.5 first:mt-0">
                <dt className="text-[13px] font-semibold text-slate-500">
                  {etiqueta}
                </dt>
                <dd className="m-0 text-[15px] whitespace-pre-wrap break-words">
                  {valor}
                </dd>
              </div>
            ))}
          </dl>
        </Bloque>
      )}

      {cuerpo.marcas.length > 0 && (
        <Bloque titulo={`Lo marcado en el pie (${cuerpo.marcas.length})`}>
          <ul className="m-0 p-0 list-none" data-test="visita-importada-marcas">
            {cuerpo.marcas.map((m, i) => (
              <li
                key={`${m.dibujo}-${m.zona ?? "sin"}-${m.lesionOriginal}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 border-b border-slate-100 last:border-b-0"
              >
                <span className="font-semibold text-[15px] min-w-0 break-words">
                  {nombreDeLaMarcaImportada(m, cuerpo.lesionesVersion)}
                </span>
                <span className="text-[14px] text-slate-500">
                  {m.pie != null && m.zona != null
                    ? nombreDeZona(`${m.pie}:${m.zona}`, cuerpo.mapaVersion)
                    : "Sin sitio en el mapa"}
                </span>
                {m.lesion == null && (
                  <span className="text-[12.5px] rounded-lg bg-amber-50 text-amber-800 px-2 py-0.5">
                    Sin equivalente nuestro
                  </span>
                )}
                {m.curado === true && (
                  <span className="text-[12.5px] rounded-lg bg-emerald-50 text-emerald-800 px-2 py-0.5">
                    Curado
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Bloque>
      )}
    </div>
  );
}

function Bloque(props: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-3xl px-4 sm:px-6 py-5 mt-3">
      <h2 className="m-0 mb-2.5 text-[13px] font-bold tracking-[0.04em] uppercase text-slate-500">
        {props.titulo}
      </h2>
      {props.children}
    </section>
  );
}
