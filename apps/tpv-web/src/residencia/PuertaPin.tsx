// residencia-3 (D-64) · **PANTALLA 2: EL PIN.**
//
// A la izquierda «Habitación 112 · turno de mañana», «Tu PIN», la frase
// que dice qué va a pasar, los puntos y «Volver a la puerta». A la derecha
// un teclado 3×4 de teclas de 120 px.
//
// ── «Lo que registres queda firmado con tu nombre y la hora» ─────────
//
// Esa frase no es decoración: es el consentimiento informado de quien
// teclea. Lo que viene detrás del PIN escribe en la historia clínica de
// dos personas con su nombre encima, y eso tiene que decirse DONDE se
// teclea, no en un manual que nadie lee. Es la misma razón por la que la
// casilla del super-admin de la clínica dice las consecuencias y no un
// «¿seguro?» (residencia-1 §1).
//
// ── SÓLO EL PIN: ni email, ni elegir nombre de una lista ─────────────
//
// Es el mockup validado por Matías, y es lo correcto para el sitio: la
// auxiliar tiene las manos ocupadas y el presupuesto es de dos segundos
// (D-05). Lo que lo hace posible es que el PIN sea único por centro, y eso
// lo garantiza un índice del motor (`care_pins_tenant_id_pin_lookup_key`).
//
// ── Y SI LLEVA DOS ROLES DE CUIDADO VIVOS (D-31) ────────────────────
//
// Se le pregunta con cuál entra, y hasta que conteste no hay sesión. La
// capacidad es la mitad de la firma: elegirla por ella —«el primero de la
// lista»— sería firmar sus registros con un rol que no está ejerciendo.
// Con uno, no se le pregunta nada.
//
// ── Teclas de 120 px y nada que se anime ────────────────────────────
//
// Las 120 px son del mockup y son ~14 mm: se teclea de pie, de lado y con
// guantes de nitrilo. Y el punto que aparece al pulsar **no se anima**:
// cambia de estado. Es la regla del bloque para las acciones de alta
// frecuencia, y aquí además una animación de 150 ms por tecla son 600 ms
// de los dos segundos.

import { useEffect, useState } from "react";

export interface RolParaElegir {
  assignmentId: string;
  code: string;
  name: string;
}

export interface PuertaPinProps {
  numeroDeHabitacion: string;
  nombreDelTurno: string | null;
  /** `true` mientras se comprueba. Deja el teclado inerte sin vaciarlo. */
  comprobando?: boolean;
  /** El mensaje de un intento fallido, o del candado. */
  error?: string | null;
  /** Cuando la persona lleva dos roles: su nombre y la lista. */
  eligiendoRol?: { nombre: string; roles: RolParaElegir[] } | null;
  onPin: (pin: string) => void;
  onRol: (assignmentId: string) => void;
  onVolver: () => void;
}

/** Cuatro cifras es lo que la pantalla pide. El servidor acepta de 4 a 8
 *  para que un centro pueda alargarlo sin una migración, pero la pantalla
 *  envía sola al cuarto dígito: esperar un «Entrar» que nadie necesita
 *  cuesta un toque de los cuatro del presupuesto. */
const LARGO = 4;

export function PuertaPin({
  numeroDeHabitacion,
  nombreDelTurno,
  comprobando = false,
  error = null,
  eligiendoRol = null,
  onPin,
  onRol,
  onVolver,
}: PuertaPinProps) {
  const [pin, setPin] = useState("");

  // Un error vacía los puntos. Si no, el siguiente dígito se añadiría a un
  // PIN que ya falló y la segunda frase diría otra cosa sin que la persona
  // entienda por qué.
  useEffect(() => {
    if (error) setPin("");
  }, [error]);

  useEffect(() => {
    if (pin.length === LARGO && !comprobando) {
      onPin(pin);
    }
    // `onPin` fuera de las dependencias a propósito: con él dentro, un
    // padre que recree la función vuelve a mandar el mismo PIN y el
    // rate-limit cuenta dos intentos por uno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, comprobando]);

  if (eligiendoRol) {
    return (
      <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col items-center justify-center px-10">
        <p className="text-[24px] text-slate-500">
          Hola, {eligiendoRol.nombre}
        </p>
        <h1 className="mt-2 text-[44px] font-semibold">
          ¿Con qué rol entras?
        </h1>
        <p className="mt-3 text-[22px] text-slate-500 text-center max-w-[640px]">
          Lo que registres queda firmado con el rol que elijas. Si ahora
          estás de auxiliar, entra como auxiliar.
        </p>
        <div className="mt-10 flex flex-wrap gap-5 justify-center">
          {eligiendoRol.roles.map((r) => (
            <button
              key={r.assignmentId}
              type="button"
              onClick={() => onRol(r.assignmentId)}
              className="min-h-tap-puerta min-w-[260px] rounded-2xl bg-white border-2 border-slate-300 px-8 text-[30px] font-medium active:border-mipiace-coral"
            >
              {r.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onVolver}
          className="mt-12 min-h-touch-pad text-[20px] text-slate-500 underline"
        >
          Volver a la puerta
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex items-center gap-12 px-12">
      <div className="flex-1 max-w-[520px]">
        <p className="text-[22px] text-slate-500">
          Habitación {numeroDeHabitacion}
          {nombreDelTurno ? ` · turno de ${nombreDelTurno.toLowerCase()}` : ""}
        </p>
        <h1 className="mt-4 text-[52px] font-semibold leading-none">Tu PIN</h1>
        <p className="mt-4 text-[22px] text-slate-500">
          Lo que registres queda firmado con tu nombre y la hora.
        </p>

        {/* Los puntos. `aria-label` con cuántos hay, nunca el PIN. */}
        <div
          className="mt-10 flex gap-5"
          aria-label={`${pin.length} de ${LARGO} cifras`}
        >
          {Array.from({ length: LARGO }, (_, i) => (
            <span
              key={i}
              className={`w-6 h-6 rounded-full ${
                i < pin.length ? "bg-mipiace-coral" : "bg-slate-300"
              }`}
            />
          ))}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-7 rounded-xl bg-red-50 text-red-700 px-6 py-4 text-[22px]"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onVolver}
          className="mt-10 min-h-touch-pad text-[20px] text-slate-500 underline"
        >
          Volver a la puerta
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((t) => (
          <Tecla
            key={t}
            onClick={() => setPin((p) => (p.length < LARGO ? p + t : p))}
            disabled={comprobando}
          >
            {t}
          </Tecla>
        ))}
        {/* Fila de abajo: borrar · 0 · nada. El hueco va a la derecha
            porque la mano que teclea en una tablet de pared viene de ese
            lado, y porque poner «Entrar» ahí invitaría a pulsarlo cuando
            el PIN ya se ha enviado solo. */}
        <Tecla
          onClick={() => setPin((p) => p.slice(0, -1))}
          disabled={comprobando}
          etiqueta="Borrar una cifra"
        >
          ←
        </Tecla>
        <Tecla
          onClick={() => setPin((p) => (p.length < LARGO ? p + "0" : p))}
          disabled={comprobando}
        >
          0
        </Tecla>
        <span className="w-tap-puerta-tecla h-tap-puerta-tecla" />
      </div>
    </div>
  );
}

function Tecla({
  children,
  onClick,
  disabled,
  etiqueta,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  etiqueta?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      // 120 px de lado, y **sin transición**: lo que cambia es el fondo al
      // pulsar, no una animación. Ver la cabecera.
      className="w-tap-puerta-tecla h-tap-puerta-tecla rounded-2xl bg-white border border-slate-300 text-[40px] font-medium tabular-nums active:bg-slate-200 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
