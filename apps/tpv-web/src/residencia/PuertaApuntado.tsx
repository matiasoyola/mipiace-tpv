// residencia-3 (D-64) · **PANTALLA 6: APUNTADO.**
//
// Check verde, «Apuntado», «Firmado por Ana López · 10:42 · turno de
// mañana», la lista de lo apuntado con su estado («en la tablet» /
// «enviado»), «Deshacer el último» y «Seguir en la habitación 112». A reposo a
// los 10 s sin tocar nada.
//
// Y si no hay red, la banda ámbar de arriba: **«Sin red. Lo guarda la
// tablet y lo envía sola cuando vuelva. No hay que repetir nada.»**
//
// ── POR QUÉ ESA BANDA ES LA PANTALLA ────────────────────────────────
//
// Porque es lo único que hace que una auxiliar con el wifi caído no
// vuelva a apuntarlo en un papel «por si acaso». La promesa del bloque es
// que no se pierde nada; esta frase es donde se dice. Y dice las tres
// cosas en orden: qué pasa (lo guarda la tablet), qué va a pasar (lo envía
// sola) y qué tiene que hacer ella (nada).
//
// ── «en la tablet» / «enviado», fila a fila ─────────────────────────
//
// No un resumen. Lo que el mockup pide es ver CADA cosa con su estado, y
// la razón es la confianza: «3 registros pendientes» no dice si el que le
// preocupa es uno de ellos.
//
// ── «Deshacer el último» ────────────────────────────────────────────
//
// Sólo quien lo firmó y sólo aquí (decisión 1). Es «me he equivocado de
// botón», no «quiero que esto no conste»: pasada esta pantalla lo que hay
// es una corrección, que deja las dos cosas a la vista. Y **anula, no
// borra**: la fila se queda con quién la deshizo y cuándo.

export interface LineaApuntada {
  /** El uuid que generó la tablet. */
  id: string;
  /** Lo que se lee: «Como siempre», «Cambio postural», «Algo no va bien». */
  texto: string;
  /** `true` mientras siga en la cola de esta tablet. */
  enLaTablet: boolean;
  /** Puesto si el servidor lo rechazó: la frase que mandó. */
  rechazo?: string | null;
}

/**
 * residencia-4 (alcance, pantalla 6) · **QUÉ NIVEL SALIÓ, SI EL AVISO
 * SALIÓ Y QUIÉN LO HA ACUSADO.**
 *
 * Tres cosas y las tres hacen falta, porque las tres contestan preguntas
 * distintas que la auxiliar se hace delante de la puerta: «¿esto es
 * grave?», «¿se ha enterado alguien?» y «¿viene alguien?».
 *
 * ── «SIN RED NO SE FINGE» ──────────────────────────────────────────
 *
 * Es el peor fallo posible del bloque. Mientras el lote siga en la
 * tablet, `servidor` es `null` y la pantalla **no dice «avisado»**: dice,
 * en ámbar, que el aviso NO ha salido y que hay que avisar en persona.
 * No es un matiz de redacción — es la diferencia entre que alguien vaya a
 * buscar a la enfermera y que se quede tranquila.
 *
 * Y cuando sale, sale con su hora original y su retraso a la vista: eso
 * lo pinta el móvil de guardia, que es quien lo recibe.
 */
export interface AvisoDeLaPantalla6 {
  /** El nivel que la TABLET previó con la plantilla de su caché. Se pinta
   *  mientras el servidor no conteste, y es lo que decide si la banda
   *  ámbar del «no ha salido» aparece. */
  nivelPrevisto: "N0" | "N1" | "N2" | "N3" | "N4" | null;
  /** Lo que contestó el SERVIDOR, que es el que manda. `null` mientras el
   *  lote siga en la cola. */
  servidor: {
    incidenciaId: string;
    nivel: "N0" | "N1" | "N2" | "N3" | "N4";
    nombreDelTipo: string;
    /** Los canales en los que ha sonado. Vacío = no tocaba avisar. */
    avisadoEn: string[];
    acusadoPor: string | null;
    acusadoComo: string | null;
    acusadoEn: string | null;
  } | null;
}

export interface PuertaApuntadoProps {
  numeroDeHabitacion: string;
  firmadoPor: string;
  hora: string;
  nombreDelTurno: string | null;
  /** `false` = banda ámbar. Es `navigator.onLine` más lo que diga la cola:
   *  una tablet «online» detrás de un punto muerto de wifi también tiene
   *  cosas en la tablet, y lo que la auxiliar necesita saber es si lo suyo
   *  ha salido. */
  hayRed: boolean;
  lineas: LineaApuntada[];
  /** `null` = no se puede deshacer (no es suyo, o ya salió de la ventana). */
  onDeshacer: (() => void) | null;
  onSeguir: () => void;
  /** residencia-4 · `null` cuando el gesto no derivó nada (el caso
   *  normal: un «como siempre», un cambio postural). */
  aviso?: AvisoDeLaPantalla6 | null;
}

export function PuertaApuntado({
  numeroDeHabitacion,
  firmadoPor,
  hora,
  nombreDelTurno,
  hayRed,
  lineas,
  onDeshacer,
  onSeguir,
  aviso = null,
}: PuertaApuntadoProps) {
  const pendientes = lineas.filter((l) => l.enLaTablet).length;
  const rechazados = lineas.filter((l) => l.rechazo);
  const nivel = aviso?.servidor?.nivel ?? aviso?.nivelPrevisto ?? null;
  // «Tenía que avisar» = N2 o más. Es lo que decide si la ausencia de
  // confirmación del servidor es un silencio normal o una banda ámbar.
  const tocabaAvisar = nivel === "N2" || nivel === "N3" || nivel === "N4";
  const salio = (aviso?.servidor?.avisadoEn.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      {(!hayRed || pendientes > 0) && (
        <p
          role="status"
          className="bg-amber-100 text-amber-900 px-8 py-5 text-[24px]"
        >
          Sin red. Lo guarda la tablet y lo envía sola cuando vuelva.{" "}
          <strong>No hay que repetir nada.</strong>
        </p>
      )}

      {/* Lo rechazado va ARRIBA y en rojo, no escondido al final: es lo
          único de esta pantalla que alguien tiene que mirar. */}
      {rechazados.length > 0 && (
        <div
          role="alert"
          className="bg-red-50 text-red-800 px-8 py-5 text-[22px]"
        >
          {rechazados.length === 1
            ? "Una cosa no se pudo apuntar:"
            : `${rechazados.length} cosas no se pudieron apuntar:`}
          <ul className="mt-2 list-disc pl-6">
            {rechazados.map((l) => (
              <li key={l.id}>
                {l.texto} — {l.rechazo}
              </li>
            ))}
          </ul>
          <p className="mt-2">Avisa a dirección: no se arregla reintentando.</p>
        </div>
      )}

      {/* ── residencia-4 · N4: LLAMA AL 112, EN GRANDE Y ARRIBA ───── */}
      {nivel === "N4" && (
        <p
          role="alert"
          className="bg-red-600 text-white px-8 py-6 text-[40px] font-bold text-center"
        >
          Llama al 112
        </p>
      )}

      {/* ── El nivel y el aviso ─────────────────────────────────────── */}
      {aviso && nivel && nivel !== "N0" && (
        <div className="px-8 pt-5">
          <p
            role="status"
            className={`rounded-xl px-6 py-4 text-[24px] ${bandaDelNivel(nivel)}`}
          >
            {aviso.servidor
              ? `${aviso.servidor.nombreDelTipo} · ${nombreCortoDelNivel(nivel)}`
              : `${nombreCortoDelNivel(nivel)} — lo está comprobando el servidor`}
          </p>

          {aviso.servidor == null && tocabaAvisar && (
            // **La banda que no se puede ahorrar.** Ver la cabecera de
            // `AvisoDeLaPantalla6`.
            <p
              role="alert"
              className="mt-3 rounded-xl bg-amber-100 text-amber-900 px-6 py-4 text-[24px]"
            >
              Sin red: el aviso <strong>NO ha salido</strong>. Avisa a la
              enfermera en persona. La tablet lo enviará sola cuando vuelva.
            </p>
          )}

          {aviso.servidor != null && salio && (
            <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 px-6 py-4 text-[22px]">
              Avisado en {aviso.servidor.avisadoEn.map(nombreDelCanal).join(" y ")}.
              {aviso.servidor.acusadoPor ? (
                <>
                  {" "}
                  <strong>
                    Aviso recibido por {aviso.servidor.acusadoPor}
                    {aviso.servidor.acusadoEn
                      ? ` · ${hhmm(aviso.servidor.acusadoEn)}`
                      : ""}
                  </strong>
                  .
                </>
              ) : (
                " Esperando a que alguien lo coja…"
              )}
            </p>
          )}

          {aviso.servidor != null && !salio && (
            <p className="mt-3 text-[20px] text-slate-600">
              No suena en ningún móvil: queda apuntado para el turno
              siguiente.
            </p>
          )}
        </div>
      )}

      <main className="flex-1 flex flex-col items-center justify-center px-8 py-8">
        <span
          aria-hidden="true"
          className="w-24 h-24 rounded-full bg-emerald-500 text-white text-[56px] leading-[96px] text-center font-bold"
        >
          ✓
        </span>
        <h1 className="mt-6 text-[52px] font-semibold">Apuntado</h1>
        <p className="mt-3 text-[24px] text-slate-600">
          Firmado por {firmadoPor} · {hora}
          {nombreDelTurno ? ` · turno de ${nombreDelTurno.toLowerCase()}` : ""}
        </p>

        <ul className="mt-8 w-full max-w-[720px] space-y-3">
          {lineas.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between rounded-xl bg-white border border-slate-200 px-6 py-4 text-[22px]"
            >
              <span>{l.texto}</span>
              <span
                className={
                  l.rechazo
                    ? "text-red-700"
                    : l.enLaTablet
                      ? "text-amber-700"
                      : "text-emerald-700"
                }
              >
                {l.rechazo
                  ? "no se pudo"
                  : l.enLaTablet
                    ? "en la tablet"
                    : "enviado"}
              </span>
            </li>
          ))}
        </ul>
      </main>

      <footer className="px-8 pb-8 flex flex-wrap items-center gap-4 justify-center">
        {onDeshacer && (
          <button
            type="button"
            onClick={onDeshacer}
            className="min-h-tap-puerta rounded-xl border-2 border-slate-400 px-8 text-[24px]"
          >
            Deshacer el último
          </button>
        )}
        <button
          type="button"
          onClick={onSeguir}
          className="min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white px-10 text-[26px] font-semibold active:bg-mipiace-coral-dark"
        >
          {/* «Seguir en la habitación 112» y no «Seguir en la 112»: lo
              encontró el bucle visual en la captura del N4, donde la banda
              roja dice «Llama al 112» justo encima. Con la habitación 112
              las dos frases se leen igual y el botón parecía el de llamar. */}
          Seguir en la habitación {numeroDeHabitacion}
        </button>
      </footer>
    </div>
  );
}

/** El color de la banda del nivel. El mismo criterio que la pantalla de
 *  la constante: rojo sólido para la emergencia, ámbar para lo que hay
 *  que ver ahora, gris para lo que espera al relevo. */
function bandaDelNivel(nivel: string): string {
  switch (nivel) {
    case "N4":
      return "bg-red-600 text-white font-semibold";
    case "N3":
      return "bg-red-100 text-red-900";
    case "N2":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

/** El nivel en palabras. El código va entre paréntesis porque es lo que
 *  aparece después en el libro y en el relevo, pero lo que se lee delante
 *  de una puerta es la frase. */
function nombreCortoDelNivel(nivel: string): string {
  switch (nivel) {
    case "N4":
      return "Emergencia (N4)";
    case "N3":
      return "Hay que decidir algo clínico (N3)";
    case "N2":
      return "Alguien tiene que verlo ahora (N2)";
    case "N1":
      return "Para el turno siguiente (N1)";
    default:
      return "Queda constancia (N0)";
  }
}

function nombreDelCanal(canal: string): string {
  return canal === "ENFERMERIA" ? "enfermería" : "dirección";
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
