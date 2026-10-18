// residencia-4 (D-66) · **EL MÓVIL DE GUARDIA, DE PRINCIPIO A FIN.**
//
// La misma APK en «modo guardia». Tres pantallas y ninguna más:
//
//   1. **En reposo** — «De guardia: Lucía · enfermería · turno de tarde»,
//      o «Nadie de guardia» con el botón de cogerlo.
//   2. **El aviso, a pantalla completa** — habitación, residente (con su
//      foto si hay consentimiento), qué pasa y nivel. «Voy» con PIN.
//   3. **La lista del turno** — lo que ha sonado, con quién lo acusó.
//
// ── LO QUE DE VERDAD HACE QUE SUENE ─────────────────────────────────
//
// Esta pantalla es la mitad visible. La otra mitad es la APK: un
// **servicio en primer plano** de Android que mantiene el socket abierto
// con la pantalla apagada y levanta una notificación de canal de alarma
// cuando llega un aviso. Está en `apps/tpv-android` y su porqué —y lo que
// depende o no de servicios de Google— está en el done del bloque.
//
// Aquí lo que importa es la regla: **el socket es el camino rápido, el
// GET es el que no falla**. Se pide `GET /residencia/guardia/avisos` al
// entrar, al volver del segundo plano, cada quince segundos y cada vez
// que el socket diga que algo cambió. Un socket caído RETRASA un aviso
// hasta el siguiente sondeo; no lo pierde. Es la regla de kds-1 («la
// verdad sigue estando en el GET») y aquí vale más.
//
// ── NADA DE SALUD ANTES DEL PIN ─────────────────────────────────────
//
// La pantalla 1 pinta el nombre del centro, el canal y quién está de
// guardia. Ni un aviso, ni una habitación, ni un nombre de residente: un
// móvil de guardia se queda en una mesa.

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiConGuardia, apiWithDevice } from "../api.js";
import { getDeviceToken } from "../storage.js";
import {
  alarmaDisponible,
  empezarLaAlarma,
  pararLaAlarma,
  permisoDeAlarma,
} from "../platform/GuardiaAlarma.js";
import type { GuardiaMeResponse } from "../hooks/useDeviceBootstrap.js";
import {
  guardarSesionDeGuardia,
  leerSesionDeGuardia,
  olvidarGuardia,
  type SesionDeGuardia,
} from "./guardia-cache.js";
import { GuardiaAviso, type AvisoDeGuardia } from "./GuardiaAviso.js";
import { PuertaPin, type RolParaElegir } from "./PuertaPin.js";

/** Cada cuánto se vuelve a preguntar. Quince segundos: con el socket
 *  caído, un aviso tarda como mucho eso en aparecer. */
const SONDEO_MS = 15_000;

export interface GuardiaAppProps {
  me: GuardiaMeResponse;
  onRefresh: () => void;
}

type Vista = { v: "reposo" } | { v: "pin" } | { v: "avisos" };

export function GuardiaApp({ me, onRefresh }: GuardiaAppProps) {
  const [vista, setVista] = useState<Vista>({ v: "reposo" });
  const [sesion, setSesion] = useState<SesionDeGuardia | null>(() =>
    leerSesionDeGuardia(),
  );
  const [eligiendoRol, setEligiendoRol] = useState<{
    nombre: string;
    roles: RolParaElegir[];
    pin: string;
  } | null>(null);
  const [errorDelPin, setErrorDelPin] = useState<string | null>(null);
  const [comprobando, setComprobando] = useState(false);
  const [avisos, setAvisos] = useState<AvisoDeGuardia[]>([]);
  const [servicio, setServicio] = useState(me.servicio);
  const [hayRed, setHayRed] = useState(() => navigator.onLine);
  /** `null` = en navegador (no hay APK debajo). `false` = Android 13+ con
   *  el permiso de notificaciones denegado: el servicio corre pero el
   *  móvil no sonará con la pantalla apagada, y eso hay que decirlo. */
  const [puedeSonar, setPuedeSonar] = useState<boolean | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    void permisoDeAlarma().then(setPuedeSonar);
  }, []);

  // Con una guardia guardada se entra directo a la lista: la app se va a
  // segundo plano cien veces en un turno y volver a pedir el PIN cada vez
  // haría que el aviso de las cuatro llegara a una pantalla de PIN.
  useEffect(() => {
    if (sesion) setVista({ v: "avisos" });
  }, [sesion]);

  useEffect(() => {
    const sube = () => setHayRed(true);
    const baja = () => setHayRed(false);
    window.addEventListener("online", sube);
    window.addEventListener("offline", baja);
    return () => {
      window.removeEventListener("online", sube);
      window.removeEventListener("offline", baja);
    };
  }, []);

  // ── EL GET, que es el que no falla ────────────────────────────────
  const pedirAvisos = useCallback(async () => {
    if (!leerSesionDeGuardia()) return;
    try {
      const res = await apiConGuardia<{
        canal: string;
        servicio: { nombre: string; telefono: string } | null;
        avisos: AvisoDeGuardia[];
      }>("/residencia/guardia/avisos");
      setAvisos(res.avisos);
      setServicio(res.servicio);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // La guardia caducó (doce horas). Se suelta y se vuelve a
        // reposo: lo que NO se puede hacer es quedarse enseñando una
        // lista de hace doce horas como si siguiera viva.
        olvidarGuardia();
        setSesion(null);
        setVista({ v: "reposo" });
        onRefresh();
      }
      /* sin red: se queda lo que había. El móvil no finge. */
    }
  }, [onRefresh]);

  useEffect(() => {
    if (vista.v !== "avisos") return;
    void pedirAvisos();
    const id = setInterval(() => void pedirAvisos(), SONDEO_MS);
    // Y al volver del segundo plano, sin esperar al siguiente sondeo.
    const alVolver = () => {
      if (document.visibilityState === "visible") void pedirAvisos();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [vista.v, pedirAvisos]);

  // ── EL SOCKET, que es el camino rápido ────────────────────────────
  //
  // Protocolo de `/ws/guardia`: se abre sin autenticar y el primer
  // mensaje es un `hello` con el device token. El token NO va en la URL
  // (acabaría en los logs de Caddy); ver la cabecera de la ruta.
  useEffect(() => {
    if (vista.v !== "avisos") return;
    let vivo = true;
    let reintento: ReturnType<typeof setTimeout> | null = null;

    const conectar = () => {
      if (!vivo) return;
      const device = getDeviceToken();
      if (!device) return;
      const base =
        (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env
          ?.VITE_API_URL ?? "/api";
      const url = new URL(
        `${base}/ws/guardia`,
        window.location.origin,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url.toString());
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: device }));
      ws.onmessage = () => {
        // **Lo que llega es un aviso de que algo cambió, no el dato.**
        // El evento no trae ni el residente ni qué le pasa (ver la
        // cabecera de la ruta: de ahí sale la notificación de la
        // pantalla bloqueada, y ahí no cabe salud). El detalle lo trae
        // el GET.
        void pedirAvisos();
      };
      ws.onclose = () => {
        socket.current = null;
        if (vivo) reintento = setTimeout(conectar, 5000);
      };
      ws.onerror = () => ws.close();
    };
    conectar();
    return () => {
      vivo = false;
      if (reintento) clearTimeout(reintento);
      socket.current?.close();
      socket.current = null;
    };
  }, [vista.v, pedirAvisos]);

  // ── El PIN: «estoy de guardia» ────────────────────────────────────
  const ponerseDeGuardia = useCallback(
    async (pin: string, assignmentId?: string) => {
      setComprobando(true);
      setErrorDelPin(null);
      try {
        const res = await apiWithDevice<{
          necesitaElegirRol?: boolean;
          nombre?: string;
          roles?: RolParaElegir[];
          token?: string;
          guardiaId?: string;
          canal?: "ENFERMERIA" | "RESPONSABLE";
          usuario?: { id: string; nombre: string };
          rol?: { assignmentId: string; code: string; name: string };
          turno?: { id: string; code: string; name: string } | null;
        }>("/residencia/guardia/pin", {
          method: "POST",
          body: assignmentId
            ? { pin, careRoleAssignmentId: assignmentId }
            : { pin },
        });
        if (res.necesitaElegirRol) {
          setEligiendoRol({
            nombre: res.nombre ?? "",
            roles: res.roles ?? [],
            pin,
          });
          return;
        }
        const s: SesionDeGuardia = {
          token: res.token!,
          // El TTL lo decide el servidor (el del centro, 12 h por
          // defecto); aquí se guarda ya resuelto para que la app no tenga
          // que decodificar un JWT.
          expiraEn: Date.now() + 12 * 3600_000,
          guardiaId: res.guardiaId!,
          canal: res.canal!,
          userId: res.usuario!.id,
          nombre: res.usuario!.nombre,
          careRoleAssignmentId: res.rol!.assignmentId,
          rolCode: res.rol!.code,
          rolName: res.rol!.name,
          turno: res.turno?.name ?? null,
        };
        guardarSesionDeGuardia(s);
        setSesion(s);
        setEligiendoRol(null);
        setVista({ v: "avisos" });
        // ── Y EL SERVICIO QUE HACE QUE SUENE DE VERDAD ─────────────
        //
        // Se enciende AQUÍ y no al arrancar la app: hasta que alguien se
        // pone de guardia no hay nada que sondear, y un servicio en
        // primer plano con una notificación permanente que dice «de
        // guardia» cuando no lo está nadie es una mentira en la barra.
        //
        // No se espera a que conteste para pintar la lista: que el
        // servicio no arranque no puede impedir ponerse de guardia.
        const alarma = await empezarLaAlarma({
          apiBase:
            (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env
              ?.VITE_API_URL ?? "/api",
          deviceToken: getDeviceToken() ?? "",
          sesion: s.token,
          canal: s.canal,
          quien: s.nombre,
        });
        if (alarma) setPuedeSonar(alarma.permisoDeNotificaciones);
        onRefresh();
      } catch (err) {
        // **Sin camino local.** Al revés que la puerta, que resuelve el
        // PIN contra el roster cacheado cuando no hay red: aquí no hay
        // nada que hacer sin red, porque los avisos vienen del servidor.
        // Un «estás de guardia» resuelto en local sería una pantalla que
        // dice que alguien cubre el turno cuando el servidor no lo sabe.
        setErrorDelPin(
          err instanceof ApiError
            ? err.message
            : "No se ha podido hablar con el servidor. Comprueba la conexión.",
        );
      } finally {
        setComprobando(false);
      }
    },
    [onRefresh],
  );

  const soltar = useCallback(async () => {
    try {
      await apiConGuardia("/residencia/guardia/terminar", { method: "POST" });
    } catch {
      /* sin red: se suelta igual en el móvil, y el servidor lo cerrará
         cuando el siguiente coja el aparato (el índice parcial
         `guard_shift_sessions_una_viva_key` lo garantiza). */
    }
    await pararLaAlarma();
    olvidarGuardia();
    setSesion(null);
    setAvisos([]);
    setVista({ v: "reposo" });
    onRefresh();
  }, [onRefresh]);

  const acusar = useCallback(
    async (alertId: string) => {
      try {
        await apiConGuardia(`/residencia/guardia/avisos/${alertId}/acuse`, {
          method: "POST",
        });
      } catch {
        /* lo dirá el GET siguiente: si otra persona lo acusó antes, el
           aviso desaparece de la lista con su nombre. */
      }
      await pedirAvisos();
    },
    [pedirAvisos],
  );

  const apuntarLlamada = useCallback(
    async (alertId: string, llamado: boolean) => {
      try {
        await apiConGuardia(`/residencia/guardia/avisos/${alertId}/llamada`, {
          method: "POST",
          body: { llamado },
        });
      } catch {
        /* se reintenta pulsando otra vez; no bloquea el aviso */
      }
      await pedirAvisos();
    },
    [pedirAvisos],
  );

  // ── Pantalla 2 · EL AVISO, A PANTALLA COMPLETA ────────────────────
  //
  // El más grave y el más antiguo. Uno solo y no una lista: quien saca el
  // móvil a las cuatro de la mañana tiene que ver UNA cosa y un botón.
  const sinAcusar = avisos.filter((a) => a.estado !== "ACKED");
  if (vista.v === "avisos" && sesion && sinAcusar.length > 0) {
    return (
      <GuardiaAviso
        aviso={sinAcusar[0]!}
        quedan={sinAcusar.length - 1}
        quien={{ nombre: sesion.nombre, rolName: sesion.rolName }}
        servicio={servicio}
        hayRed={hayRed}
        onVoy={() => void acusar(sinAcusar[0]!.id)}
        onLlamada={(llamado) => void apuntarLlamada(sinAcusar[0]!.id, llamado)}
      />
    );
  }

  if (vista.v === "pin") {
    return (
      <PuertaPin
        numeroDeHabitacion={me.canal === "ENFERMERIA" ? "Enfermería" : "Dirección"}
        nombreDelTurno={me.turno?.name ?? null}
        comprobando={comprobando}
        error={errorDelPin}
        eligiendoRol={eligiendoRol}
        onPin={(pin) => void ponerseDeGuardia(pin)}
        onRol={(assignmentId) =>
          void ponerseDeGuardia(eligiendoRol?.pin ?? "", assignmentId)
        }
        onVolver={() => setVista({ v: "reposo" })}
      />
    );
  }

  // ── Pantalla 1 · EN REPOSO, y la lista del turno ──────────────────
  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col">
      {!hayRed && (
        <p
          role="alert"
          className="bg-amber-100 text-amber-900 px-6 py-4 text-[20px]"
        >
          Sin conexión. <strong>Este móvil no está recibiendo avisos.</strong>
        </p>
      )}

      {/* El permiso de notificaciones, denegado. Se dice ANTES de que
          alguien se ponga de guardia, porque descubrirlo en un turno de
          noche es descubrirlo tarde. */}
      {puedeSonar === false && (
        <p
          role="alert"
          className="bg-red-100 text-red-900 px-6 py-4 text-[20px]"
        >
          Este móvil tiene las notificaciones desactivadas:{" "}
          <strong>no sonará con la pantalla apagada.</strong> Actívalas en los
          ajustes del teléfono.
        </p>
      )}

      {/* Y en navegador, lo mismo por el otro lado: esta pantalla vale
          para probar el flujo, no para cubrir un turno. */}
      {puedeSonar === null && !alarmaDisponible() && (
        <p className="bg-slate-200 text-slate-700 px-6 py-3 text-[18px]">
          Estás en el navegador: los avisos se ven mientras esta pantalla
          esté delante. Para que suene con el móvil guardado hace falta la
          app.
        </p>
      )}

      <header className="px-6 pt-8">
        <p className="text-[18px] uppercase tracking-[0.14em] text-slate-400">
          {me.centro.nombre}
        </p>
        <h1 className="mt-1 text-[34px] font-semibold leading-tight">
          Móvil de {me.canal === "ENFERMERIA" ? "enfermería" : "dirección"}
        </h1>
      </header>

      <main className="flex-1 px-6 py-7 flex flex-col gap-6">
        {sesion ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-6">
            <p className="text-[26px] font-semibold">
              De guardia: {sesion.nombre}
            </p>
            <p className="mt-1 text-[20px] text-slate-600">
              {sesion.rolName}
              {sesion.turno ? ` · turno de ${sesion.turno.toLowerCase()}` : ""}
            </p>
            <p className="mt-4 text-[20px] text-emerald-800">
              {avisos.length === 0
                ? "Nada pendiente. El móvil sonará si hace falta."
                : `${avisos.length} aviso(s) en este turno.`}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-6">
            <p className="text-[28px] font-semibold text-amber-900">
              Nadie de guardia
            </p>
            {/* La frase que explica la consecuencia, y no una genérica:
                lo que pasa de verdad es que los avisos de este canal
                escalan al momento al otro. Quien coge el móvil tiene que
                saber qué está arreglando. */}
            <p className="mt-2 text-[20px] text-amber-900">
              {me.canal === "ENFERMERIA"
                ? "Mientras nadie coja este móvil, los avisos de enfermería suenan directamente en el de dirección."
                : "Mientras nadie coja este móvil, los avisos que escalen no tienen dónde sonar."}
            </p>
          </div>
        )}

        {/* Quién está de guardia en el OTRO canal. La dirección tiene que
            poder ver desde su móvil que esta noche no hay enfermera, que
            es la mitad de por qué D-66 existe. */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6">
          <h2 className="text-[20px] font-semibold text-slate-700">
            Ahora mismo
          </h2>
          <ul className="mt-3 space-y-2 text-[20px]">
            {(["ENFERMERIA", "RESPONSABLE"] as const).map((c) => {
              const quienes = me.deGuardia.filter((g) => g.canal === c);
              return (
                <li key={c} className="flex justify-between gap-4">
                  <span className="text-slate-600">
                    {c === "ENFERMERIA" ? "Enfermería" : "Dirección"}
                  </span>
                  <span
                    className={
                      quienes.length > 0 ? "text-emerald-800" : "text-amber-800"
                    }
                  >
                    {quienes.length > 0
                      ? quienes.map((g) => g.nombre).join(", ")
                      : "nadie"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* La lista del turno: lo que ya se acusó. */}
        {sesion && avisos.length > 0 && (
          <div className="rounded-2xl bg-white border border-slate-200 p-6">
            <h2 className="text-[20px] font-semibold text-slate-700">
              Avisos de este turno
            </h2>
            <ul className="mt-3 space-y-3 text-[19px]">
              {avisos.map((a) => (
                <li key={a.id} className="flex justify-between gap-4">
                  <span>
                    {a.incidencia.nombreDelTipo}
                    {a.incidencia.habitacion
                      ? ` · hab. ${a.incidencia.habitacion.numero}`
                      : ""}
                  </span>
                  <span className="text-slate-500">
                    {a.nivel} · {hhmm(a.apuntadoEn)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      <footer className="px-6 pb-8 flex flex-col gap-3">
        {sesion ? (
          <button
            type="button"
            onClick={() => void soltar()}
            className="min-h-tap-puerta rounded-2xl border-2 border-slate-400 text-[22px]"
          >
            Dejar la guardia
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setErrorDelPin(null);
              setEligiendoRol(null);
              setVista({ v: "pin" });
            }}
            className="min-h-tap-puerta rounded-2xl bg-mipiace-coral text-white text-[26px] font-semibold active:bg-mipiace-coral-dark"
          >
            Estoy de guardia
          </button>
        )}
      </footer>
    </div>
  );
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
