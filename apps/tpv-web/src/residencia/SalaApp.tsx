// residencia-5 (D-67) · **LA TABLET DE LA SALA, DE PRINCIPIO A FIN.**
//
// La misma APK en «modo relevo». Tres pantallas y ninguna más:
//
//   1. **En reposo** — centro, turno, hora y «Relevo de la mañana · 3 por
//      confirmar». **Nada de salud** (decisión de producto 3).
//   2. **El PIN** — el mismo teclado de la puerta y del móvil de guardia.
//   3. **El parte** — recortado al alcance de quien entró (D-51), con lo
//      que llegó tarde y el botón «Leído y recibido».
//
// ── POR QUÉ ESTÁ DONDE ESTÁ (D-67) ──────────────────────────────────
//
// El sistema **no crea una ceremonia nueva: alimenta la que ya hacen**
// (rama de controles §7). La reunión de cambio de turno existe, se hace en
// esa sala y hoy se apoya en una hoja de papel. Esta tablet es esa hoja,
// con la diferencia de que se genera sola y que quien la lee queda
// firmado.
//
// ── LA PANTALLA SE CIERRA A LOS DOS MINUTOS, NO AL MINUTO ───────────
//
// La puerta se cierra al minuto (residencia-3): es una tablet de pasillo
// con la historia de dos personas abierta. La sala son dos, y la
// diferencia es de uso: **el parte se LEE**, y una pantalla que se apaga
// a mitad de la lectura obliga a teclear el PIN otra vez con seis
// personas esperando — que es cómo se consigue que alguien deje el PIN
// apuntado en la pared.
//
// El número vive en la API (`MINUTOS_SIN_TOCAR_EN_LA_SALA`) y viaja en el
// arranque, para que la pantalla y el servidor no puedan decir dos cosas
// distintas.
//
// ── SIN RED ─────────────────────────────────────────────────────────
//
// Tres cosas, y las tres reutilizan lo que ya existe:
//
//   1. el **arranque** se cachea en IndexedDB (`sala-cache.ts`), igual
//      que el de la puerta, con el parte entero dentro;
//   2. el **PIN** se resuelve contra el roster cacheado recalculando la
//      huella con `crypto.subtle`, igual que en la puerta. Con red manda
//      el servidor;
//   3. la **confirmación va a la cola ANTES del POST**, igual que una
//      venta desde v1.5: lo que la pantalla dice no depende de que haya
//      red, depende de que esté escrito en la tablet.
//
// Y el recorte por alcance lo hace **la misma función que el servidor**
// (`recortarAlAlcance`, del paquete puro): si fueran dos, lo que una
// auxiliar ve sin red podría no ser lo que ve con red.

import { useCallback, useEffect, useRef, useState } from "react";

import { recortarAlAlcance } from "@mipiacetpv/residencia-plan";

import { ApiError, apiConSala, apiWithDevice } from "../api.js";
import { flushOutbox, outboxAdd } from "../lib/outbox.js";
import type { SalaReposo, SalaArranque, RelevoParaLeer } from "./sala-tipos.js";
import {
  guardarArranqueDeSala,
  guardarSesionDeSala,
  leerArranqueDeSala,
  leerSesionDeSala,
  type SesionDeSala,
} from "./sala-cache.js";
// **La misma función que la puerta**, no una copia: la huella del PIN
// tiene que salir idéntica en los dos sitios o el PIN de la plantilla
// abriría la puerta y no la sala.
import { huellaDePinEnLaTablet } from "./puerta-cache.js";
import { PuertaPin, type RolParaElegir } from "./PuertaPin.js";
import { SalaParte } from "./SalaParte.js";

/** Cada cuánto se refresca el reposo. Treinta segundos: lo que cambia es
 *  el reloj y el recuento de confirmaciones, no un aviso que corre. */
const SONDEO_MS = 30_000;

export interface SalaAppProps {
  me: SalaReposo;
  /** Lo pide `App.tsx` como los otros tres modos. Esta pantalla no lo
   *  usa: el reposo se refresca solo cada treinta segundos, y lo que
   *  `onRefresh` rehace es el bootstrap del dispositivo — que aquí sólo
   *  cambiaría si alguien revoca la tablet, y entonces el arranque lo
   *  detecta por su cuenta. */
  onRefresh?: () => void;
}

type Vista = { v: "reposo" } | { v: "pin" } | { v: "parte" };

export function SalaApp({ me }: SalaAppProps) {
  const [reposo, setReposo] = useState<SalaReposo>(me);
  const [vista, setVista] = useState<Vista>({ v: "reposo" });
  const [arranque, setArranque] = useState<SalaArranque | null>(null);
  const [sesion, setSesion] = useState<SesionDeSala | null>(() =>
    leerSesionDeSala(),
  );
  const [relevo, setRelevo] = useState<RelevoParaLeer["relevo"]>(null);
  const [eligiendoRol, setEligiendoRol] = useState<{
    nombre: string;
    roles: RolParaElegir[];
  } | null>(null);
  const [pinPendiente, setPinPendiente] = useState<string | null>(null);
  const [errorDePin, setErrorDePin] = useState<string | null>(null);
  const [comprobando, setComprobando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enLaCola, setEnLaCola] = useState(false);
  const [errorDelParte, setErrorDelParte] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => new Date());

  const minutos = arranque?.minutosSinTocar ?? reposo.minutosSinTocar ?? 2;

  // ── El arranque: con red se pide y se cachea; sin red se lee ──────
  const cargarArranque = useCallback(async () => {
    try {
      const a = await apiWithDevice<SalaArranque>("/residencia/sala/arranque");
      setArranque(a);
      await guardarArranqueDeSala(a);
    } catch {
      // Sin red: lo último que se guardó. Es lo que hace que el PIN se
      // pueda resolver y el parte se pueda leer con el wifi caído.
      const cacheado = await leerArranqueDeSala();
      if (cacheado) setArranque(cacheado);
    }
  }, []);

  useEffect(() => {
    void cargarArranque();
  }, [cargarArranque]);

  // ── El reposo se refresca, y el reloj cada diez segundos ──────────
  useEffect(() => {
    const t = setInterval(() => {
      setAhora(new Date());
      void apiWithDevice<SalaReposo>("/residencia/sala/me")
        .then(setReposo)
        .catch(() => {
          /* sin red: se queda lo último, y el reloj sigue andando. Es
             mejor que una pantalla en blanco en la sala. */
        });
    }, SONDEO_MS);
    return () => clearInterval(t);
  }, []);

  // ── Los dos minutos sin tocar ─────────────────────────────────────
  //
  // El temporizador se reinicia con CUALQUIER toque de la pantalla, no
  // sólo con los botones: alguien que está desplazando el parte para
  // leerlo está usándolo. Es el mismo criterio que el minuto de la
  // puerta.
  const ultimoToque = useRef(Date.now());
  useEffect(() => {
    if (vista.v === "reposo") return;
    const tocar = (): void => {
      ultimoToque.current = Date.now();
    };
    window.addEventListener("pointerdown", tocar);
    window.addEventListener("keydown", tocar);
    window.addEventListener("scroll", tocar, true);
    const t = setInterval(() => {
      if (Date.now() - ultimoToque.current > minutos * 60_000) {
        terminar();
      }
    }, 5_000);
    return () => {
      window.removeEventListener("pointerdown", tocar);
      window.removeEventListener("keydown", tocar);
      window.removeEventListener("scroll", tocar, true);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista.v, minutos]);

  /** Cierra la pantalla. **No borra el token**: la cola lo necesita. */
  function terminar(): void {
    setVista({ v: "reposo" });
    setRelevo(null);
    setErrorDelParte(null);
    setEnLaCola(false);
    setEligiendoRol(null);
    setPinPendiente(null);
    setErrorDePin(null);
  }

  // ── El PIN ────────────────────────────────────────────────────────
  const entrar = useCallback(
    async (pin: string, careRoleAssignmentId?: string) => {
      setComprobando(true);
      setErrorDePin(null);
      try {
        const r = await apiConSalaSinSesion<{
          necesitaElegirRol?: boolean;
          nombre?: string;
          roles?: RolParaElegir[];
          token?: string;
          usuario?: { id: string; nombre: string };
          rol?: { assignmentId: string; code: string; name: string };
          alcanceTotal?: boolean;
          zonas?: string[];
        }>("/residencia/sala/pin", { pin, careRoleAssignmentId });
        if (r.necesitaElegirRol) {
          setEligiendoRol({ nombre: r.nombre ?? "", roles: r.roles ?? [] });
          setPinPendiente(pin);
          return;
        }
        if (!r.token || !r.usuario || !r.rol) {
          setErrorDePin("No se pudo entrar. Vuelve a intentarlo.");
          return;
        }
        const s: SesionDeSala = {
          token: r.token,
          // Doce horas, como la de la puerta: lo que caduca a los dos
          // minutos es la PANTALLA, no el token.
          expiraEn: Date.now() + 12 * 3_600_000,
          userId: r.usuario.id,
          nombre: r.usuario.nombre,
          careRoleAssignmentId: r.rol.assignmentId,
          rolCode: r.rol.code,
          rolName: r.rol.name,
          alcanceTotal: r.alcanceTotal === true,
          zonas: r.zonas ?? [],
        };
        guardarSesionDeSala(s);
        setSesion(s);
        setEligiendoRol(null);
        setPinPendiente(null);
        await abrirElParte(s);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && err.code === "PIN_INCORRECTO") {
          setErrorDePin("Ese PIN no es correcto.");
          return;
        }
        if (err instanceof ApiError && err.status === 429) {
          setErrorDePin(err.message);
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setErrorDePin(err.message);
          return;
        }
        // ── SIN RED: el PIN se resuelve EN LA TABLET ───────────────
        //
        // Con el roster cacheado y la subclave del arranque,
        // recalculando la huella con `crypto.subtle`. Es exactamente lo
        // que hace la puerta y por lo mismo: sin esto, un corte de wifi
        // deja la reunión de cambio de turno sin parte.
        //
        // Lo que esto **no** da es una sesión del servidor, así que la
        // confirmación se encola y sale firmada cuando vuelva la red.
        const local = await entrarSinRed(pin, careRoleAssignmentId);
        if (local == null) {
          setErrorDePin(
            "Sin red y ese PIN no cuadra con lo que esta tablet tiene guardado.",
          );
          return;
        }
        if ("necesitaElegirRol" in local) {
          setEligiendoRol(local.necesitaElegirRol);
          setPinPendiente(pin);
          return;
        }
        setSesion(local.sesion);
        guardarSesionDeSala(local.sesion);
        setEligiendoRol(null);
        setPinPendiente(null);
        await abrirElParte(local.sesion);
      } finally {
        setComprobando(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arranque],
  );

  /** El PIN sin red: la huella contra el roster cacheado. */
  async function entrarSinRed(
    pin: string,
    careRoleAssignmentId?: string,
  ): Promise<
    | { sesion: SesionDeSala }
    | { necesitaElegirRol: { nombre: string; roles: RolParaElegir[] } }
    | null
  > {
    const a = arranque ?? (await leerArranqueDeSala());
    if (a?.pinSubclave == null) return null;
    const huella = await huellaDePinEnLaTablet(pin, a.pinSubclave, a.centro.id);
    const quien = a.roster.find((p) => p.pinLookup === huella);
    if (!quien || quien.roles.length === 0) return null;
    let rol = quien.roles[0]!;
    if (quien.roles.length > 1) {
      if (!careRoleAssignmentId) {
        return {
          necesitaElegirRol: {
            nombre: quien.nombre,
            roles: quien.roles.map((r) => ({
              assignmentId: r.assignmentId,
              code: r.code,
              name: r.name,
            })),
          },
        };
      }
      const elegido = quien.roles.find((r) => r.assignmentId === careRoleAssignmentId);
      if (!elegido) return null;
      rol = elegido;
    }
    const alcanceTotal = rol.alcanceTotal || quien.zonas.some((z) => z == null);
    return {
      sesion: {
        // **Sin token del servidor.** La cola lo detectará y la
        // confirmación esperará a que alguien entre con red — que es el
        // mismo 401 transitorio de la puerta.
        token: "",
        expiraEn: Date.now() + 12 * 3_600_000,
        userId: quien.userId,
        nombre: quien.nombre,
        careRoleAssignmentId: rol.assignmentId,
        rolCode: rol.code,
        rolName: rol.name,
        alcanceTotal,
        zonas: quien.zonas.filter((z): z is string => z != null),
      },
    };
  }

  // ── El parte ──────────────────────────────────────────────────────
  const abrirElParte = useCallback(
    async (s: SesionDeSala) => {
      setVista({ v: "parte" });
      ultimoToque.current = Date.now();
      try {
        const r = await apiConSala<RelevoParaLeer>("/residencia/sala/relevo");
        setRelevo(r.relevo);
        return;
      } catch {
        /* sin red: el de la caché, recortado aquí */
      }
      const a = arranque ?? (await leerArranqueDeSala());
      if (a?.relevo?.parte == null) {
        setRelevo(null);
        return;
      }
      const alcance = {
        alcanceTotal: s.alcanceTotal,
        floorIds: s.zonas,
      };
      const recortado = recortarAlAlcance(a.relevo.parte, alcance);
      setRelevo({
        id: a.relevo.id,
        careDay: a.relevo.careDay,
        turno: a.relevo.parte.turno,
        congeladoEn: a.relevo.congeladoEn,
        confirmado: a.relevo.confirmado,
        misZonasPorConfirmar: [],
        yaConfirmado: a.relevo.acuses.some((x) => x.userId === s.userId),
        acuses: a.relevo.acuses,
        tardios: a.relevo.tardios.filter(
          (t) =>
            s.alcanceTotal || (t.floorId != null && s.zonas.includes(t.floorId)),
        ),
        parte: recortado,
        ilegible: false,
      });
    },
    [arranque],
  );

  /** «Leído y recibido». **A la cola antes del POST.** */
  async function confirmar(): Promise<void> {
    if (relevo == null || sesion == null) return;
    setConfirmando(true);
    setErrorDelParte(null);
    const at = new Date().toISOString();
    try {
      await outboxAdd({
        externalId: nuevoId(),
        kind: "handover-ack",
        path: `/residencia/sala/relevo/${relevo.id}/confirmar`,
        body: { at },
        auth: "sala",
        label: `Relevo de ${relevo.turno.name.toLowerCase()}`,
        // `total` es del cobro y aquí no significa nada: va a 0 para no
        // inventarle un número que el chip de pendientes pintaría como
        // euros. Mismo criterio que el lote de la puerta.
        total: 0,
      });
      void flushOutbox();
      // Lo que la pantalla dice **no depende de que haya red**: depende
      // de que esté escrito en la tablet. La cola lo sube sola.
      setRelevo({
        ...relevo,
        yaConfirmado: true,
        acuses: [
          ...relevo.acuses,
          {
            userId: sesion.userId,
            nombre: sesion.nombre,
            rol: sesion.rolName,
            at,
            alcanceTotal: sesion.alcanceTotal,
            zonas: [],
          },
        ],
      });
      setEnLaCola(!navigator.onLine || sesion.token === "");
    } catch {
      setErrorDelParte(
        "No se pudo guardar tu «Leído y recibido». Vuelve a pulsarlo.",
      );
    } finally {
      setConfirmando(false);
    }
  }

  // ── Pantalla 2 · el PIN ───────────────────────────────────────────
  if (vista.v === "pin") {
    return (
      <PuertaPin
        numeroDeHabitacion=""
        nombreDelTurno={null}
        encabezado={`${reposo.centro.nombre}${
          reposo.relevo ? ` · relevo de ${reposo.relevo.turno.toLowerCase()}` : ""
        }`}
        frase="Lo que confirmes queda firmado con tu nombre, tu rol y la hora."
        volverTexto="Volver"
        comprobando={comprobando}
        error={errorDePin}
        eligiendoRol={eligiendoRol}
        onPin={(pin) => void entrar(pin)}
        onRol={(assignmentId) => {
          if (pinPendiente) void entrar(pinPendiente, assignmentId);
        }}
        onVolver={terminar}
      />
    );
  }

  // ── Pantalla 3 · el parte ─────────────────────────────────────────
  if (vista.v === "parte" && sesion != null) {
    if (relevo?.parte == null) {
      return (
        <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col items-center justify-center px-10 text-center">
          <h1 className="text-[36px] font-semibold">
            {relevo?.ilegible
              ? "Este parte no se puede leer"
              : "Todavía no hay ningún parte"}
          </h1>
          <p className="mt-4 text-[22px] text-slate-500 max-w-[640px]">
            {relevo?.ilegible
              ? "El parte está guardado pero no se ha podido descifrar. Avisa a dirección: tiene que mirarlo alguien."
              : "El primer parte se genera solo en cuanto cierre un turno. Si el turno ya cerró y no está, avisa a dirección."}
          </p>
          <button
            type="button"
            onClick={terminar}
            className="mt-10 min-h-tap-puerta px-10 rounded-2xl bg-white border-2 border-slate-300 text-[24px]"
          >
            Terminar
          </button>
        </div>
      );
    }
    return (
      <SalaParte
        parte={relevo.parte}
        tardios={relevo.tardios}
        acuses={relevo.acuses}
        confirmado={relevo.confirmado}
        yaConfirmado={relevo.yaConfirmado}
        confirmando={confirmando}
        enLaCola={enLaCola}
        error={errorDelParte}
        quien={{ nombre: sesion.nombre, rolName: sesion.rolName }}
        onConfirmar={() => void confirmar()}
        onTerminar={terminar}
      />
    );
  }

  // ── Pantalla 1 · EN REPOSO. Nada de salud. ────────────────────────
  return (
    <div className="min-h-screen bg-mipiace-stone text-mipiace-ink flex flex-col items-center justify-center px-10 text-center">
      <p className="text-[24px] text-slate-500">{reposo.centro.nombre}</p>
      <p className="mt-2 text-[72px] font-semibold leading-none tabular-nums">
        {ahora.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
      </p>
      <p className="mt-2 text-[24px] text-slate-500">
        {reposo.turno
          ? `Turno de ${reposo.turno.name.toLowerCase()}`
          : "Fuera de turno"}
      </p>

      {reposo.relevo ? (
        <div className="mt-12">
          <h1 className="text-[40px] font-semibold">
            Relevo de {reposo.relevo.turno.toLowerCase()}
          </h1>
          <p className="mt-3 text-[26px] text-slate-600">
            {/* **Cuántas zonas faltan, no de quién es nada.** Es el único
                número que sale antes del PIN, y es lo que hace que el
                turno que entra vea desde la puerta de la sala que tiene
                algo que leer. */}
            {reposo.relevo.confirmado
              ? "Confirmado"
              : reposo.relevo.zonasPorConfirmar === 0
                ? "Sin confirmar"
                : `${reposo.relevo.zonasPorConfirmar} ${
                    reposo.relevo.zonasPorConfirmar === 1 ? "zona" : "zonas"
                  } por confirmar`}
            {reposo.relevo.sinNovedades ? " · turno sin novedades" : ""}
          </p>
        </div>
      ) : (
        <p className="mt-12 text-[26px] text-slate-500 max-w-[640px]">
          Todavía no hay ningún parte de relevo. Se genera solo en cuanto
          cierre un turno.
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setVista({ v: "pin" });
          ultimoToque.current = Date.now();
        }}
        className="mt-12 min-h-tap-puerta px-12 rounded-2xl bg-mipiace-coral text-white text-[30px] font-semibold active:bg-mipiace-coral/80"
      >
        Leer el parte
      </button>
      <p className="mt-4 text-[20px] text-slate-500">
        Con tu PIN. Verás lo de tus zonas.
      </p>
    </div>
  );
}

/** Un id para el item de la cola. `crypto.randomUUID` donde esté, y una
 *  caída de dos líneas donde no: la cola necesita UNA clave, no
 *  criptografía. */
function nuevoId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `sala-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * El PIN va con el device token y SIN sesión —todavía no hay—, así que no
 * puede usar `apiConSala`. Es el mismo reparto que en la puerta.
 */
function apiConSalaSinSesion<T>(path: string, body: unknown): Promise<T> {
  return apiWithDevice<T>(path, { method: "POST", body });
}
