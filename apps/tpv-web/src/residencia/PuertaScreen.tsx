// residencia-1 (D-52) · LA PANTALLA DE LA PUERTA, en su versión mínima.
//
// La MISMA APK en «modo puerta», igual que la tablet de cocina es la misma
// APK en «modo cocina». Lo que este bloque pinta y nada más:
//
//   · el NÚMERO de la habitación, grande;
//   · su planta;
//   · quién la ocupa — **nombre y cama, sin un dato de salud**.
//
// Lo que NO está aquí y es residencia-3: el PIN, el rol, la lista de lo
// que toca, «como siempre», «algo no va bien» y el registro sellado
// offline. Antes de eso van un mockup y la observación de un turno real,
// que es lo que el prompt pide.
//
// ── Por qué ni un dato de salud, dicho una vez más ───────────────────
//
// Esta tablet está colgada en la pared de un pasillo. La ve la familia de
// la 110 cuando pasa, el técnico del ascensor, el inspector de la
// Consejería y la nieta de la vecina. Un nivel de dependencia en la puerta
// de una habitación es un dato de salud publicado en un pasillo. El
// nombre, no: ya está en el timbre.
//
// ── Diseño ───────────────────────────────────────────────────────────
//
// 1280 × 800 vertical u horizontal, que es una tablet de 10" en un soporte
// de pared y se lee de pie, a un metro, con gafas de cerca puestas o no.
// De ahí los tamaños: el número de habitación a 120 px y los nombres a 40.
// Fondo claro y no oscuro —al revés que cocina— porque un pasillo de
// residencia está iluminado y la pantalla tiene que leerse sin acercarse.

import { useEffect, useState } from "react";

import type { PuertaMeResponse } from "../hooks/useDeviceBootstrap.js";

export interface PuertaScreenProps {
  me: PuertaMeResponse;
  /** Vuelve a pedir `/residencia/puerta/me`. Lo usa el reintento. */
  onRefresh?: () => void;
}

export function PuertaScreen({ me, onRefresh }: PuertaScreenProps) {
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
  // calcularlo, porque en residencia-3 tendrá que adscribir un registro a
  // un turno **sin red**.
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
          <p className="mt-2 text-[20px] text-slate-500">
            {/* `null` = los turnos del centro no cubren esta hora. Se dice,
                no se esconde: es un hueco en el cuadrante que la dirección
                tiene que arreglar en la pantalla de Turnos. */}
            {turno ? turno.name : "Sin turno configurado"}
          </p>
        </div>
      </header>

      <main className="flex-1 px-10 py-8">
        {ocupados.length === 0 ? (
          <p className="text-[40px] text-slate-400">Habitación libre</p>
        ) : (
          <ul className="space-y-4">
            {ocupados.map((o) => (
              <li
                key={o.bedId}
                className="flex items-baseline gap-5 rounded-2xl bg-white px-7 py-5 border border-slate-200"
              >
                {/* La letra de la cama sólo si la habitación tiene más de
                    una: en una individual, «A» es ruido. */}
                {me.ocupantes.length > 1 && (
                  <span className="text-[32px] font-semibold tabular-nums text-slate-400">
                    {o.bedLabel}
                  </span>
                )}
                <span className="text-[40px] leading-tight font-medium">
                  {o.nombre}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="px-10 pb-7 flex items-center justify-between">
        <p className="text-[16px] text-slate-400">
          {me.device.name ?? "Tablet de la habitación"}
        </p>
        {/* Un toque para refrescar, y nada más. No hay ninguna acción que
            cambie datos en esta pantalla: la que las tendrá es
            residencia-3, detrás de un PIN. */}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-5 text-[16px] text-slate-600"
          >
            Actualizar
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * «¿En qué turno estamos?», calculado por la tablet.
 *
 * Es la MISMA regla que `apps/api/src/residencia/turnos.ts` —semiabierto
 * por el final, y la noche cruza medianoche— y está escrita dos veces a
 * propósito, no por descuido: el servidor no puede contestarla cuando la
 * tablet no tiene red, que es justo el caso que residencia-3 necesita
 * resolver. Las dos copias son cinco líneas y las dos están testeadas.
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

function minutosDe(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}
