// residencia-4 (D-66) · **EL AVISO, A PANTALLA COMPLETA.**
//
// Lo que ve quien saca el móvil del bolsillo a las cuatro de la mañana:
// habitación, residente, qué pasa, nivel, y **un botón**.
//
// ── UNO, Y NO UNA LISTA ─────────────────────────────────────────────
//
// Aunque haya tres avisos sin acusar, esta pantalla enseña el más grave y
// más antiguo, con «y 2 más» debajo en pequeño. Una lista obliga a elegir
// y elegir cuesta segundos que aquí no hay. El resto no se pierde: en
// cuanto se acusa éste, aparece el siguiente.
//
// ── «VOY» ES UNA FIRMA, NO UN «LEÍDO» ───────────────────────────────
//
// Firma persona + capacidad + hora (D-31), y la puerta que lo originó
// pinta «Aviso recibido por Lucía · 10:43». Por eso el botón dice «Voy» y
// no «Enterado»: lo que se está diciendo es que alguien va.
//
// La firma es la SESIÓN de guardia, no un PIN que se vuelva a teclear:
// quien tiene el móvil en la mano ya tecleó su PIN al empezar el turno, y
// pedírselo otra vez con una emergencia delante son cuatro segundos que
// no valen nada — la sesión está atada a este móvil y dura el turno.
//
// ── LA RECOMENDACIÓN DE LLAMAR (D-33) ───────────────────────────────
//
// En N3 y N4, debajo: «Recomendado: llamar a Centro de Salud de
// Buenaventura» con un botón que abre el marcador (`tel:`). **La llamada
// la hace la persona**; el sistema no llama ni escribe a nadie de fuera
// por su cuenta. Y se apunta si se llamó o no, porque las dos respuestas
// son constancia.
//
// ── N4 ──────────────────────────────────────────────────────────────
//
// «Llama al 112», arriba y en rojo sólido. Es lo mismo que pinta la
// puerta, y está en los dos sitios a propósito: el que está delante del
// residente y el que viene corriendo tienen que leer lo mismo.

import { PuertaFoto } from "./PuertaFoto.js";

export interface AvisoDeGuardia {
  id: string;
  canal: "ENFERMERIA" | "RESPONSABLE";
  nivel: "N0" | "N1" | "N2" | "N3" | "N4";
  estado: string;
  /** Cuándo lo apuntó la TABLET. */
  apuntadoEn: string;
  /** Y cuándo salió de verdad. Si se separan, hubo falta de red. */
  salidoEn: string;
  escalado: boolean;
  incidencia: {
    id: string;
    tipo: string;
    nombreDelTipo: string;
    nivel: string;
    origen: string;
    abiertaEn: string;
    habitacion: { numero: string; nombre: string | null } | null;
    residente: { id: string | null; nombre: string } | null;
    /** `true` = hay foto Y consentimiento de imagen vigente (D-64). Sin
     *  él, iniciales — exactamente igual que en la puerta. */
    tieneFoto?: boolean;
    descripcion: string | null;
    medida: { control: string; numero: number; unidad: string | null } | null;
  };
}

export interface GuardiaAvisoProps {
  aviso: AvisoDeGuardia;
  /** Cuántos más hay sin acusar detrás de éste. */
  quedan: number;
  quien: { nombre: string; rolName: string };
  servicio: { nombre: string; telefono: string } | null;
  hayRed: boolean;
  onVoy: () => void;
  onLlamada: (llamado: boolean) => void;
}

export function GuardiaAviso({
  aviso,
  quedan,
  quien,
  servicio,
  hayRed,
  onVoy,
  onLlamada,
}: GuardiaAvisoProps) {
  const recomendarLlamada =
    (aviso.nivel === "N3" || aviso.nivel === "N4") && servicio != null;
  // El retraso: la diferencia entre cuándo se apuntó y cuándo salió. Se
  // dice cuando pasa del minuto, porque es la mitad de «sin red no se
  // finge»: quien recibe un aviso de hace dos horas tiene que saberlo.
  const retrasoMin = Math.round(
    (new Date(aviso.salidoEn).getTime() - new Date(aviso.apuntadoEn).getTime()) /
      60_000,
  );

  return (
    <div className={`min-h-screen flex flex-col ${fondoDelNivel(aviso.nivel)}`}>
      {aviso.nivel === "N4" && (
        <p
          role="alert"
          className="bg-red-700 text-white px-6 py-5 text-[34px] font-bold text-center"
        >
          Llama al 112
        </p>
      )}

      {!hayRed && (
        <p className="bg-amber-200 text-amber-950 px-6 py-3 text-[18px]">
          Sin conexión: «Voy» no saldrá hasta que vuelva.
        </p>
      )}

      <header className="px-6 pt-7">
        <p className="text-[20px] uppercase tracking-[0.14em] opacity-70">
          Aviso {aviso.nivel}
          {aviso.escalado ? " · escalado" : ""}
        </p>
        <h1 className="mt-2 text-[46px] font-bold leading-tight">
          {aviso.incidencia.habitacion
            ? `Habitación ${aviso.incidencia.habitacion.numero}`
            : "Centro"}
        </h1>
        {aviso.incidencia.residente && (
          <div className="mt-3 flex items-center gap-4">
            {aviso.incidencia.residente.id && (
              <PuertaFoto
                clientId={aviso.incidencia.residente.id}
                nombre={aviso.incidencia.residente.nombre}
                tieneFoto={aviso.incidencia.tieneFoto === true}
                lado={72}
                ruta="guardia"
              />
            )}
            <p className="text-[30px] font-semibold">
              {aviso.incidencia.residente.nombre}
            </p>
          </div>
        )}
      </header>

      <main className="flex-1 px-6 py-6 flex flex-col gap-5">
        <div className="rounded-2xl bg-white/85 text-mipiace-ink p-6">
          <p className="text-[32px] font-semibold">
            {aviso.incidencia.nombreDelTipo}
          </p>
          {aviso.incidencia.medida && (
            <p className="mt-2 text-[40px] font-bold tabular-nums">
              {String(aviso.incidencia.medida.numero).replace(".", ",")}
              {aviso.incidencia.medida.unidad
                ? ` ${aviso.incidencia.medida.unidad}`
                : ""}
            </p>
          )}
          {aviso.incidencia.descripcion && (
            <p className="mt-3 text-[22px]">{aviso.incidencia.descripcion}</p>
          )}
          <p className="mt-4 text-[18px] text-slate-600">
            Apuntado a las {hhmm(aviso.apuntadoEn)}
            {retrasoMin >= 1
              ? ` · llegó ${retrasoMin} min más tarde (la tablet estaba sin red)`
              : ""}
          </p>
        </div>

        {recomendarLlamada && servicio && (
          <div className="rounded-2xl bg-white/85 text-mipiace-ink p-6">
            <p className="text-[22px] font-semibold">
              Recomendado: llamar a {servicio.nombre}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {/* Abre el MARCADOR. No marca: la llamada la hace la
                  persona (D-33). */}
              <a
                href={`tel:${servicio.telefono}`}
                onClick={() => onLlamada(true)}
                className="min-h-tap-puerta inline-flex items-center rounded-xl bg-mipiace-ink text-white px-7 text-[22px] font-semibold"
              >
                Llamar al {servicio.telefono}
              </a>
              <button
                type="button"
                onClick={() => onLlamada(false)}
                className="min-h-tap-puerta rounded-xl border-2 border-slate-400 px-7 text-[20px]"
              >
                No hace falta llamar
              </button>
            </div>
          </div>
        )}

        {quedan > 0 && (
          <p className="text-[20px] opacity-80">
            Y {quedan} aviso{quedan > 1 ? "s" : ""} más detrás de éste.
          </p>
        )}
      </main>

      <footer className="px-6 pb-8">
        <button
          type="button"
          onClick={onVoy}
          className="w-full min-h-[120px] rounded-3xl bg-emerald-600 text-white text-[40px] font-bold active:bg-emerald-700"
        >
          Voy
        </button>
        <p className="mt-3 text-center text-[18px] opacity-80">
          Firmará {quien.nombre} · {quien.rolName}
        </p>
      </footer>
    </div>
  );
}

/** El fondo entero del nivel. A pantalla completa y no una banda: lo que
 *  tiene que pasar es que, sin leer nada, se sepa si hay que correr. */
function fondoDelNivel(nivel: string): string {
  switch (nivel) {
    case "N4":
      return "bg-red-600 text-white";
    case "N3":
      return "bg-red-100 text-red-950";
    default:
      return "bg-amber-100 text-amber-950";
  }
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
