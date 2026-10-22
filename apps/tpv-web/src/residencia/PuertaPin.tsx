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
  // ── residencia-5 · LA MISMA PANTALLA EN LA TABLET DE LA SALA ──────
  //
  // Tercera pantalla que usa este teclado: la puerta (residencia-3), el
  // móvil de guardia (residencia-4) y ahora la sala (D-67). Se reutiliza
  // en vez de copiarse por una razón concreta: el solape de las teclas a
  // 390 px **lo encontró el bucle visual y no un test**, y una cuarta
  // copia sería un cuarto sitio donde volver a pagarlo.
  //
  // Lo único que cambia entre las tres es el texto. De ahí estos tres
  // opcionales, que por omisión dejan la pantalla de la puerta tal cual.
  /** Sustituye a «Habitación 112 · turno de mañana». */
  encabezado?: string;
  /** Sustituye a «Lo que registres queda firmado con tu nombre y la
   *  hora». En la sala es lo que se va a firmar allí: haberlo leído. */
  frase?: string;
  /** Sustituye a «Volver a la puerta». */
  volverTexto?: string;
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

// ── residencia-6 (D-68) · CUATRO CIFRAS, O SEIS ──────────────────────
//
// Cuatro es lo que la pantalla pide por defecto, y **la auxiliar no gana
// ni un toque**: sigue entrando sola al cuarto dígito. Esperar un
// «Entrar» que nadie necesita costaría un toque de los cuatro del
// presupuesto (D-05).
//
// Para el PIN de seis —la DUE, el médico, calidad, dirección— hay un
// botón discreto que cambia a seis casillas, y entonces entra sola al
// sexto.
//
// ── DÓNDE VA EL BOTÓN, Y POR QUÉ NO EN EL HUECO DEL TECLADO ─────────
//
// El teclado 3×4 tiene un hueco libre abajo a la derecha (borrar · 0 ·
// nada). Era el sitio obvio y **está mal**: ese hueco está donde aterriza
// el pulgar de quien teclea en una tablet de pared —es la razón por la
// que ahí no hay un «Entrar», ver abajo— y un roce cambiaría el teclado a
// seis casillas en mitad de un PIN de cuatro. El síntoma sería el peor
// posible: la auxiliar teclea sus cuatro cifras, no pasa nada, y no sabe
// por qué.
//
// Va **debajo de los puntos**, en la columna de la izquierda, junto a
// «Volver a la puerta»: fuera del camino de la mano que teclea, y a la
// vista de quien lo necesita. Quien tiene PIN de seis entra una vez por
// turno y lee la pantalla; quien tiene PIN de cuatro entra cuarenta veces
// y nunca pasa por ahí.
//
// Y es un INTERRUPTOR, no un camino de ida: vuelve a cuatro con el mismo
// toque. Si no, un roce dejaría la puerta en seis casillas para la
// siguiente persona.

const LARGO_CORTO = 4;
const LARGO_LARGO = 6;

export function PuertaPin({
  numeroDeHabitacion,
  nombreDelTurno,
  encabezado,
  frase,
  volverTexto,
  comprobando = false,
  error = null,
  eligiendoRol = null,
  onPin,
  onRol,
  onVolver,
}: PuertaPinProps) {
  const [pin, setPin] = useState("");
  const [largo, setLargo] = useState(LARGO_CORTO);

  // Un error vacía los puntos. Si no, el siguiente dígito se añadiría a un
  // PIN que ya falló y la segunda frase diría otra cosa sin que la persona
  // entienda por qué.
  //
  // El LARGO no se toca al fallar: quien tiene PIN de seis y se equivoca
  // de dígito no tiene que volver a pulsar el botón.
  useEffect(() => {
    if (error) setPin("");
  }, [error]);

  useEffect(() => {
    if (pin.length === largo && !comprobando) {
      onPin(pin);
    }
    // `onPin` fuera de las dependencias a propósito: con él dentro, un
    // padre que recree la función vuelve a mandar el mismo PIN y el
    // rate-limit cuenta dos intentos por uno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, largo, comprobando]);

  /** Cambia de cuatro a seis casillas y al revés. **Vacía lo tecleado**:
   *  dejar los dos primeros dígitos puestos al pasar a seis mandaría un
   *  PIN a medias en cuanto llegara al sexto, y la persona no sabría por
   *  qué le dice que no es correcto. */
  function cambiarElLargo(): void {
    setPin("");
    setLargo((l) => (l === LARGO_CORTO ? LARGO_LARGO : LARGO_CORTO));
  }

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
          {volverTexto ?? "Volver a la puerta"}
        </button>
      </div>
    );
  }

  return (
    // residencia-4 · **ESTA PANTALLA SE USA TAMBIÉN EN UN MÓVIL.**
    //
    // El mockup de D-64 la dibujó para una tablet de 10" en la pared:
    // dos columnas, el teclado a la derecha y teclas de 120 px. En
    // residencia-4 la misma pantalla la usa el móvil de guardia para
    // ponerse de guardia (D-66), y a 390 px de ancho `3 × 120 px + los
    // huecos + el padding` no caben: las teclas se pisaban entre sí y la
    // «1» quedaba debajo de la «2».
    //
    // **Lo encontró el bucle visual**, no un test: en jsdom no hay
    // layout, así que `puerta-pantallas.test.tsx` seguía verde contando
    // las doce teclas y mirando su clase.
    //
    // La solución es la del resto de la casa: se apila en estrecho y se
    // reparte en ancho. Las teclas bajan a 96 px en el móvil —el
    // `tap-valoracion` que ya existe, el que el test del paciente usa
    // con una persona de 78 años— y se quedan en 120 en la tablet.
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col lg:flex-row items-center justify-center lg:justify-start gap-8 lg:gap-12 px-6 lg:px-12 py-8">
      <div className="flex-1 w-full max-w-[520px]">
        <p className="text-[22px] text-slate-500">
          {encabezado ??
            `Habitación ${numeroDeHabitacion}${
              nombreDelTurno ? ` · turno de ${nombreDelTurno.toLowerCase()}` : ""
            }`}
        </p>
        <h1 className="mt-4 text-[40px] lg:text-[52px] font-semibold leading-none">
          Tu PIN
        </h1>
        <p className="mt-4 text-[22px] text-slate-500">
          {frase ?? "Lo que registres queda firmado con tu nombre y la hora."}
        </p>

        {/* Los puntos. `aria-label` con cuántos hay, nunca el PIN. */}
        <div
          className="mt-8 lg:mt-10 flex gap-4 lg:gap-5"
          aria-label={`${pin.length} de ${largo} cifras`}
        >
          {Array.from({ length: largo }, (_, i) => (
            <span
              key={i}
              className={`w-6 h-6 rounded-full ${
                i < pin.length ? "bg-mipiace-coral" : "bg-slate-300"
              }`}
            />
          ))}
        </div>

        {/* residencia-6 (D-68) · el interruptor de cuatro a seis. Ver la
            cabecera para por qué está aquí y no en el hueco del teclado.
            `min-h-touch-pad` porque se pulsa de pie: es discreto de peso
            visual, no de tamaño. */}
        {/* `block`: un `<button>` es inline, así que sin esto se pegaba a
            «Volver a la puerta» en la MISMA línea —«PIN de 6
            cifrasVolver a la puerta»— y los dos se leían como uno. **Lo
            encontró el bucle visual**: en jsdom no hay layout, y el test
            que cuenta las teclas y mira las clases seguía verde. Es la
            tercera vez que esta pantalla paga lo mismo (residencia-4, el
            solape de las teclas a 390 px). */}
        <button
          type="button"
          onClick={cambiarElLargo}
          disabled={comprobando}
          className="mt-5 block min-h-touch-pad text-[20px] text-slate-500 underline disabled:opacity-50"
        >
          {largo === LARGO_CORTO ? "PIN de 6 cifras" : "PIN de 4 cifras"}
        </button>

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
          className="mt-10 block min-h-touch-pad text-[20px] text-slate-500 underline"
        >
          {volverTexto ?? "Volver a la puerta"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 lg:gap-4 shrink-0">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((t) => (
          <Tecla
            key={t}
            onClick={() => setPin((p) => (p.length < largo ? p + t : p))}
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
          onClick={() => setPin((p) => (p.length < largo ? p + "0" : p))}
          disabled={comprobando}
        >
          0
        </Tecla>
        <span className="w-tap-valoracion h-tap-valoracion lg:w-tap-puerta-tecla lg:h-tap-puerta-tecla" />
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
      // 120 px de lado en la tablet y 96 en el móvil, y **sin
      // transición**: lo que cambia es el fondo al pulsar, no una
      // animación. Ver la cabecera para por qué hay dos tamaños.
      className="w-tap-valoracion h-tap-valoracion lg:w-tap-puerta-tecla lg:h-tap-puerta-tecla rounded-2xl bg-white border border-slate-300 text-[34px] lg:text-[40px] font-medium tabular-nums active:bg-slate-200 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
