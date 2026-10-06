// clinica-3 · la gráfica del dolor, sesión a sesión.
//
// Las barras del mockup: las sesiones anteriores en naranja suave y la de
// hoy en naranja pleno, con el número encima de cada una. Es lo que la
// paciente mira para ver que le duele menos.
//
// ── Por qué barras y no una línea ────────────────────────────────────
//
// Porque el dolor es una medida PUNTUAL de cada visita y no una función
// continua: una línea entre el 7 del 7 de septiembre y el 5 del 21 insinúa
// que el día 14 estaba en 6, y nadie lo midió. Y porque una barra se lee
// de un vistazo a dos metros, que es la distancia a la que la paciente ve
// la tablet cuando la podóloga se la gira.
//
// ── Y por qué no hay ejes ────────────────────────────────────────────
//
// La escala es 0–10 y no hace falta decirlo: cada barra lleva su número
// encima. Un eje Y con once marcas en una tarjeta de 90 px de alto es
// ruido sobre la única señal que hay que leer, que es si la última barra es
// más baja que la anterior.

/** Un punto de la gráfica. `dolor` es 0–10. */
export interface PuntoDeDolor {
  /** ISO-8601 del día de la sesión. */
  fecha: string;
  dolor: number;
}

/** Los píxeles por punto de dolor. 8 × 10 = 80 px de alto máximo, que es
 *  lo que cabe en la tarjeta del mockup. */
const PX_POR_PUNTO = 8;

export function GraficaDolor(props: {
  historico: PuntoDeDolor[];
  /** Lo marcado hoy, o `null` si todavía no. La barra de hoy sale igual,
   *  vacía y con un guion: así se ve que falta. */
  hoy: number | null;
}) {
  const barras: Array<{ etiqueta: string; dolor: number | null; esHoy: boolean }> =
    [
      ...props.historico.map((p) => ({
        etiqueta: diaCorto(p.fecha),
        dolor: p.dolor,
        esHoy: false,
      })),
      { etiqueta: "Hoy", dolor: props.hoy, esHoy: true },
    ];

  return (
    <div>
      <div className="flex items-end gap-2.5 h-[90px] pt-2 px-1 border-b border-slate-200">
        {barras.map((b, i) => (
          <div
            key={`${b.etiqueta}-${i}`}
            className={`flex-1 rounded-t-lg relative ${
              b.esHoy ? "bg-mipiace-coral" : "bg-mipiace-coral-soft"
            }`}
            style={{
              // 2 px cuando no hay valor: una raya, para que la barra
              // exista y se vea que le falta el dato. Y un mínimo de 6 px
              // para un dolor de 0, que si no desaparecería — y «0» es una
              // respuesta, no una ausencia.
              height:
                b.dolor == null ? 2 : Math.max(6, b.dolor * PX_POR_PUNTO),
            }}
            // La barra entera es la etiqueta accesible: un lector de
            // pantalla lee «7 de dolor el 7 de septiembre» en vez de un
            // número suelto sin contexto.
            role="img"
            aria-label={
              b.dolor == null
                ? `${b.etiqueta}: sin marcar`
                : `${b.etiqueta}: ${b.dolor} de 10`
            }
          >
            <span className="absolute -top-[18px] left-0 right-0 text-center text-[12px] font-semibold text-mipiace-ink-soft">
              {b.dolor ?? "–"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2.5 text-[11.5px] text-slate-500 pt-1 px-1">
        {barras.map((b, i) => (
          <span key={`l-${b.etiqueta}-${i}`} className="flex-1 text-center">
            {b.etiqueta}
          </span>
        ))}
      </div>
    </div>
  );
}

function diaCorto(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}
