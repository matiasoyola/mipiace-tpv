// residencia-1 (D-52) + residencia-3 (D-64) · **PANTALLA 1: EN REPOSO.**
//
// La MISMA APK en «modo puerta», igual que la tablet de cocina es la misma
// APK en «modo cocina». Lo que pinta, y nada más:
//
//   · la planta, el turno con su punto de color y la hora, arriba;
//   · el NÚMERO de la habitación, enorme;
//   · una tarjeta por cama con **foto, «Cama A» y el nombre**;
//   · abajo, un botón coral a todo el ancho: «Toca para registrar».
//
// ── NI UN DATO DE SALUD, dicho una vez más ──────────────────────────
//
// Esta tablet está colgada en la pared de un pasillo y está encendida las
// veinticuatro horas. La ve la familia de la 110 cuando pasa, el técnico
// del ascensor, el inspector de la Consejería y la nieta de la vecina. Un
// nivel de dependencia en la puerta de una habitación es un dato de salud
// publicado en un pasillo.
//
// El nombre, no: ya está en el timbre. Y la foto tampoco, **con
// consentimiento de imagen** — en un pasillo la cara la ve cualquiera, de
// ahí el consentimiento (D-64). Sin él, las iniciales.
//
// Lo que residencia-3 añade a esta pantalla es exactamente eso: la foto y
// el botón. Lo que hay detrás del botón —el PIN y las cuatro pantallas de
// registro— son ficheros aparte, y así esta se queda siendo lo que es: la
// que mira todo el mundo.
//
// ── Diseño ───────────────────────────────────────────────────────────
//
// 1280 × 800, que es una tablet de 10" en un soporte de pared y se lee de
// pie, a un metro, con gafas de cerca puestas o no. De ahí los tamaños: el
// número de habitación a 120 px y los nombres a 40. Fondo claro y no
// oscuro —al revés que cocina— porque un pasillo de residencia está
// iluminado.
//
// Y el botón a 96 px (por encima del `tap-puerta` de 72) porque es la
// única acción de la pantalla y porque se toca de lado, de pie y con
// guantes.

import { useEffect, useState } from "react";

import type { PuertaMeResponse } from "../hooks/useDeviceBootstrap.js";
import { PuertaFoto } from "./PuertaFoto.js";

export interface PuertaScreenProps {
  me: PuertaMeResponse;
  /** Vuelve a pedir `/residencia/puerta/me`. Lo usa el reintento. */
  onRefresh?: () => void;
  /** residencia-3 · «Toca para registrar». Ausente = la pantalla se queda
   *  como la dejó residencia-1, que es lo que ve un centro al que todavía
   *  no se le ha configurado ningún PIN. */
  onRegistrar?: () => void;
  /** Lo que la cola tiene pendiente de subir, para la banda ámbar. */
  pendientes?: number;
  /** residencia-3 · `clientId` → tiene foto servible (fichero +
   *  consentimiento). Viene del arranque; vacío = iniciales para todos. */
  fotos?: Record<string, boolean>;
}

export function PuertaScreen({
  me,
  onRefresh,
  onRegistrar,
  pendientes = 0,
  fotos = {},
}: PuertaScreenProps) {
  const [ahora, setAhora] = useState(() => new Date());

  // El reloj, cada 30 s. No cada segundo: nadie mira los segundos en la
  // puerta de una habitación y un re-render por segundo en una tablet de
  // 2019 colgada 24 h se nota en la batería y en el calor.
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // El turno, calculado EN LA TABLET con los turnos que trajo el arranque.
  // Aquí sólo se pinta; lo que importa es que la tablet ya sabe
  // calcularlo, porque al registrar sin red tiene que adscribir el
  // registro a un turno sin preguntarle a nadie.
  const turno = turnoDeLaTablet(ahora, me.turnos);

  const ocupados = me.ocupantes.filter((o) => o.nombre != null);

  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      <header className="flex items-baseline justify-between px-10 pt-8">
        <div>
          <p className="text-[18px] uppercase tracking-[0.18em] text-slate-400">
            {me.habitacion.plantaName}
          </p>
          <p className="text-[120px] leading-none font-semibold tabular-nums">
            {me.habitacion.number}
          </p>
          {me.habitacion.name && (
            <p className="mt-1 text-[24px] text-slate-500">
              {me.habitacion.name}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[56px] leading-none font-semibold tabular-nums text-slate-700">
            {ahora.toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="mt-2 text-[20px] text-slate-500 flex items-center justify-end gap-2">
            {/* residencia-3 · el punto de color del turno, que es lo que
                pide el mockup. Es un REFUERZO del nombre del turno, nunca
                su sustituto: un punto a secas no se lee de pie a un metro
                y no significa nada para quien entra por primera vez. */}
            <span
              aria-hidden="true"
              className={`inline-block w-3 h-3 rounded-full ${
                turno ? colorDelTurno(turno.code) : "bg-amber-500"
              }`}
            />
            {/* `null` = los turnos del centro no cubren esta hora. Se dice,
                no se esconde: es un hueco en el cuadrante que la dirección
                tiene que arreglar en la pantalla de Turnos. */}
            {turno ? turno.name : "Sin turno configurado"}
          </p>
        </div>
      </header>

      <main className="flex-1 px-10 py-6">
        {ocupados.length === 0 ? (
          <p className="text-[40px] text-slate-400">Habitación libre</p>
        ) : (
          <ul className="space-y-4">
            {ocupados.map((o) => (
              <li
                key={o.bedId}
                className="flex items-center gap-6 rounded-2xl bg-white px-7 py-5 border border-slate-200"
              >
                <PuertaFoto
                  clientId={o.clientId ?? o.bedId}
                  nombre={o.nombre ?? ""}
                  tieneFoto={
                    o.clientId != null && fotos[o.clientId] === true
                  }
                  lado={96}
                />
                <div>
                  {/* La letra de la cama sólo si la habitación tiene más de
                      una: en una individual, «Cama A» es ruido. */}
                  {me.ocupantes.length > 1 && (
                    <p className="text-[20px] uppercase tracking-[0.14em] text-slate-400">
                      Cama {o.bedLabel}
                    </p>
                  )}
                  <p className="text-[40px] leading-tight font-medium">
                    {o.nombre}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* residencia-3 · la banda de la cola. Va ARRIBA del botón y no en un
          rincón: dice que hay cuidados apuntados que todavía no han salido
          de esta tablet, y eso lo tiene que ver quien pase. Y dice lo
          único que importa: que no hay que repetir nada. */}
      {pendientes > 0 && (
        <p className="mx-10 mb-3 rounded-xl bg-amber-100 text-amber-900 px-6 py-3 text-[20px]">
          {pendientes === 1
            ? "1 registro guardado en la tablet, pendiente de enviar."
            : `${pendientes} registros guardados en la tablet, pendientes de enviar.`}{" "}
          Se envían solos cuando vuelva la red. No hay que repetir nada.
        </p>
      )}

      {onRegistrar && (
        <div className="px-10 pb-4">
          <button
            type="button"
            onClick={onRegistrar}
            className="w-full min-h-[96px] rounded-2xl bg-mipiace-coral text-white text-[34px] font-semibold active:bg-mipiace-coral-dark"
          >
            Toca para registrar
          </button>
        </div>
      )}

      <footer className="px-10 pb-7 flex items-center justify-between">
        <p className="text-[16px] text-slate-400">
          {me.device.name ?? "Tablet de la habitación"}
        </p>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-touch-pad rounded-xl border border-slate-300 bg-white px-5 text-[16px] text-slate-600"
          >
            Actualizar
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * El color del punto del turno. Mañana, tarde y noche de serie; cualquier
 * otro código, gris.
 *
 * Gris y no «un color cualquiera» para los códigos que no conoce: un
 * centro puede inventarse turnos (D-54), y asignarles un color a dedo
 * haría que dos turnos distintos salieran del mismo color sin que nadie
 * lo decidiera. El nombre del turno sigue estando al lado, que es lo que
 * de verdad se lee.
 */
export function colorDelTurno(code: string): string {
  switch (code) {
    case "M":
      return "bg-amber-400";
    case "T":
      return "bg-sky-500";
    case "N":
      return "bg-indigo-600";
    default:
      return "bg-slate-400";
  }
}

/**
 * «¿En qué turno estamos?», calculado por la tablet.
 *
 * Es la MISMA regla que `apps/api/src/residencia/turnos.ts` —semiabierto
 * por el final, y la noche cruza medianoche— y está escrita dos veces a
 * propósito, no por descuido: el servidor no puede contestarla cuando la
 * tablet no tiene red, que es justo el caso que residencia-3 resuelve. Las
 * dos copias son cinco líneas y las dos están testeadas.
 *
 * La diferencia con la del servidor: aquí la hora de pared sale del reloj
 * del propio dispositivo (`getHours`), que es el de la pared donde está
 * colgado. El servidor tiene que convertir desde UTC; la tablet ya está
 * en la zona del centro.
 */
export function turnoDeLaTablet<T extends { startsAt: string; endsAt: string }>(
  ahora: Date,
  turnos: T[],
): T | null {
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  for (const t of turnos) {
    const inicio = minutosDe(t.startsAt);
    const fin = minutosDe(t.endsAt);
    if (fin > inicio) {
      if (minutos >= inicio && minutos < fin) return t;
    } else if (minutos >= inicio || minutos < fin) {
      return t;
    }
  }
  return null;
}

/**
 * residencia-3 · **EL DÍA DEL TURNO**, calculado por la tablet.
 *
 * La tercera copia de una regla de cinco líneas, y la razón es la misma
 * que la de `turnoDeLaTablet`: la tablet tiene que decidirlo SIN RED y el
 * servidor no puede contestar. La de verdad vive en
 * `packages/residencia-plan/src/turnos.ts::diaDelTurno`, y un test
 * comprueba que las dos dicen lo mismo en los dos casos que importan: la
 * madrugada del turno de noche y los dos cambios de hora.
 *
 * Lo que decide: **si el turno cruza medianoche y la hora cae en la parte
 * de madrugada, el día es el de AYER**. Lo registrado a las 02:00 del
 * martes pertenece a la noche del lunes; sin esto, la ronda de la
 * madrugada saldría partida en dos días y las dos mitades contarían como
 * dos turnos a medias.
 */
export function diaDelTurnoEnLaTablet(
  ahora: Date,
  turno: { startsAt: string; endsAt: string } | null,
): string {
  const dia = fechaLocal(ahora);
  if (turno == null) return dia;
  const inicio = minutosDe(turno.startsAt);
  const fin = minutosDe(turno.endsAt);
  if (fin > inicio) return dia;
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  if (minutos < fin) {
    const ayer = new Date(ahora.getTime());
    ayer.setDate(ayer.getDate() - 1);
    return fechaLocal(ayer);
  }
  return dia;
}

/** «YYYY-MM-DD» del reloj de la tablet. `toISOString` daría el día UTC, y
 *  a las 00:30 de julio en España eso es el día anterior. */
function fechaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function minutosDe(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}
