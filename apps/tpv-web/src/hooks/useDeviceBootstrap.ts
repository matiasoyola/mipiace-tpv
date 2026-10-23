import { useCallback, useEffect, useState } from "react";

import { ApiError, apiWithDevice } from "../api.js";
import {
  clearAllDeviceState,
  getDeviceToken,
} from "../storage.js";
import { decideAfterBootstrapError } from "./bootstrap-decision.js";
import {
  olvidarLaPuerta,
  olvidarSesion,
} from "../residencia/puerta-cache.js";
// residencia-4 · y la guardia del móvil, por lo mismo: un aparato
// desemparejado no se queda «de guardia».
import { olvidarGuardia } from "../residencia/guardia-cache.js";
// residencia-5 · y la de la sala: dentro hay el parte de un turno entero.
import {
  olvidarLaSala,
  olvidarSesionDeSala,
} from "../residencia/sala-cache.js";
import type { SalaReposo } from "../residencia/sala-tipos.js";

export interface DeviceMeResponse {
  device: { id: string; name: string | null; pairedAt: string };
  register: { id: string; name: string; numSerieHolded: string | null };
  store: { id: string; name: string };
  tenant: {
    id: string;
    name: string;
    cashierAutoLogoutMinutes: number;
    // v1.11-cierre-de-dia · el negocio exige cuadrar caja para cerrar.
    // Ausente en la caché de un device bootstrapeado antes de v1.11 →
    // se trata como false, que es el default nuevo.
    requireCashCountOnClose?: boolean;
    // kds-1-cocina · la capability del módulo «Cocina». Ausente en la
    // caché de un device bootstrapeado antes del bloque → se trata como
    // false, que es el default de la columna.
    kitchenDisplayEnabled?: boolean;
    // B-reservas-8 · la capability de los bonos y LA PALABRA del centro
    // («bono» por defecto; el spa dirá «programa»). Ausentes en la caché
    // de un device bootstrapeado antes del bloque → apagado y «bono», que
    // son los defaults de las columnas.
    bonosEnabled?: boolean;
    bonoEtiqueta?: string;
  };
  // kds-1-cocina · los ajustes de cocina de ESTA tienda, o `null` con el
  // módulo apagado. El TPV los necesita al arrancar para saber si pinta
  // «Espera» o la fila de tiempos y si el botón de silla va siempre
  // visible.
  kitchen?: {
    courseMode: "ESPERA" | "TIEMPOS";
    seatMode: "ALERGIA" | "SIEMPRE";
    greenMaxMin: number;
    amberMaxMin: number;
    readyBeep: boolean;
  } | null;
}

export type BootstrapState =
  | { kind: "loading" }
  | { kind: "unpaired" }
  // H1 (ADR-016) · la empresa no tiene caja. Estado terminal: no se
  // reintenta, no se desempareja y no se vuelve al PIN. `message` es la
  // frase que mandó el servidor, para no tener dos textos que mantener.
  | { kind: "cajaDisabled"; message: string }
  // kds-1-cocina · esta tablet es una PANTALLA DE COCINA. La misma APK,
  // otra pantalla (decisión 1). Se llega aquí porque `/devices/me`
  // devolvió 403 KITCHEN_DEVICE_NOT_ALLOWED, que es la respuesta correcta
  // y no un error: el corte vive en la puerta de todas las rutas del TPV.
  | { kind: "kitchen"; data: KitchenMeResponse }
  // residencia-1 (D-52) · esta tablet es LA PUERTA DE UNA HABITACIÓN. La
  // misma APK, otra pantalla. Se llega aquí porque `/devices/me` devolvió
  // 403 ROOM_DEVICE_NOT_ALLOWED, que es la respuesta correcta y no un
  // error: el corte vive en la puerta de todas las rutas del TPV.
  | { kind: "room"; data: PuertaMeResponse }
  // residencia-4 (D-66) · esta tablet es un MÓVIL DE GUARDIA. La misma
  // APK, otra pantalla. Se llega aquí porque `/devices/me` devolvió 403
  // GUARD_DEVICE_NOT_ALLOWED, que es la respuesta correcta y no un
  // error.
  | { kind: "guard"; data: GuardiaMeResponse }
  // residencia-5 (D-67) · esta tablet es LA DE LA SALA. La misma APK, otra
  // pantalla. Se llega aquí porque `/devices/me` devolvió 403
  // HANDOVER_DEVICE_NOT_ALLOWED, que es la respuesta correcta y no un
  // error.
  | { kind: "sala"; data: SalaReposo }
  | { kind: "paired"; data: DeviceMeResponse };

/**
 * residencia-4 · lo que contesta `GET /residencia/guardia/me`.
 *
 * Lo que NO lleva, y es la mitad de la decisión: ni un aviso, ni una
 * habitación, ni un nombre de residente. Un móvil de guardia es un
 * teléfono que se queda en una mesa y la pantalla en reposo la ve
 * cualquiera que pase. Todo lo demás va detrás del PIN.
 */
export interface GuardiaMeResponse {
  device: { id: string; name: string | null };
  centro: { id: string; nombre: string };
  canal: "ENFERMERIA" | "RESPONSABLE";
  turno: { id: string; code: string; name: string } | null;
  turnos: Array<{
    id: string;
    code: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
  /** Quién está de guardia AHORA, en todos los canales. */
  deGuardia: Array<{
    id: string;
    canal: "ENFERMERIA" | "RESPONSABLE";
    deviceId: string;
    nombre: string;
    rol: string;
    turno: string | null;
    desde: string;
  }>;
  /** Y si ESTE móvil está cogido, por quién. */
  esteMovil: {
    id: string;
    canal: "ENFERMERIA" | "RESPONSABLE";
    deviceId: string;
    nombre: string;
    rol: string;
    turno: string | null;
    desde: string;
  } | null;
  /** El servicio sanitario de guardia del centro (D-33). */
  servicio: { nombre: string; telefono: string } | null;
  serverTime: string;
}

/**
 * residencia-1 · lo que contesta `GET /residencia/puerta/me`.
 *
 * Lo que NO lleva, y es la mitad del bloque: ni nivel de dependencia, ni
 * grado, ni tipo de plaza, ni una alergia. Nombre y cama. Una tablet
 * colgada en un pasillo la ve cualquiera que pase.
 */
export interface PuertaMeResponse {
  device: { id: string; name: string | null };
  habitacion: {
    id: string;
    number: string;
    name: string | null;
    active: boolean;
    plantaId: string;
    plantaName: string;
  };
  ocupantes: Array<{
    bedId: string;
    bedLabel: string;
    /** residencia-3 (D-64) · con qué se pide la foto. `null` = cama libre.
     *  Un uuid no dice nada de nadie, y la foto que abre sigue exigiendo
     *  consentimiento de imagen vigente. */
    clientId?: string | null;
    /** `null` = cama libre. */
    nombre: string | null;
  }>;
  /**
   * Los turnos del centro, para que la tablet pueda decir en qué turno
   * está **sin red**. Es lo que residencia-3 necesitará para adscribir un
   * registro offline; mismo criterio que `serverTime` en `/kitchen/me`.
   */
  turnos: Array<{
    id: string;
    code: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
  /** La hora del servidor al arrancar, para medir el desvío del reloj. */
  serverTime: string;
}

export interface KitchenMeResponse {
  device: { id: string; name: string | null };
  store: { id: string; name: string };
  sections: Array<"BARRA" | "COCINA" | "SALON">;
  settings: { greenMaxMin: number; amberMaxMin: number; readyBeep: boolean };
  /**
   * kds-2-wifi · la hora del SERVIDOR al arrancar. Con ella la tablet
   * calcula su desvío de reloj, y con el desvío mide si un mensaje de la
   * wifi es «demasiado viejo». El reloj de una tablet que lleva horas sin
   * internet no vale para eso.
   *
   * Opcional: una pantalla contra una API de antes del bloque sigue
   * arrancando, sólo que sin camino directo.
   */
  serverTime?: string;
  /**
   * kds-2-wifi · con qué clave se firma y en qué puerto se escucha.
   *
   * Sin esto la tablet **no abre el servidor local**: una pantalla que
   * escuchara sin clave aceptaría cualquier cosa de cualquiera que esté en
   * la wifi del bar.
   */
  lan?: { key: string; port: number; maxAgeMs: number };
}

// v1.10-offline-un-terminal: cacheamos el device-me en localStorage. Un
// terminal ya bootstrapeado que recarga la PWA SIN red (modo avión, VPS
// caído) debe seguir operando el turno offline en vez de quedarse en el
// spinner "loading". Sólo datos no sensibles (ids + nombres +
// auto-logout). Se refresca en cada bootstrap online.
const DEVICE_ME_CACHE_KEY = "mipiacetpv-device-me";

function readCachedDeviceMe(): DeviceMeResponse | null {
  const raw = localStorage.getItem(DEVICE_ME_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceMeResponse;
  } catch {
    return null;
  }
}

function writeCachedDeviceMe(data: DeviceMeResponse): void {
  try {
    localStorage.setItem(DEVICE_ME_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* cuota llena o modo privado — no fatal */
  }
}

/**
 * auditoria-sirope (#20) · EL AVISO INTERNO DE «LOS AJUSTES CAMBIARON».
 *
 * El bus de la tienda lo recibe quien tiene el WebSocket abierto (la
 * pantalla de venta y la de sala) y quien tiene que reaccionar es el
 * bootstrap, que vive arriba del todo. En vez de bajar un callback por
 * cinco niveles de props, el que lo recibe lo RELANZA como evento del
 * navegador y el bootstrap lo escucha.
 *
 * Un `CustomEvent` y no un estado global: no hay nada que guardar, sólo
 * un «vuelve a preguntar».
 */
export const EVENTO_AJUSTES_CAMBIADOS = "mipiacetpv:ajustes-cambiados";

export function avisarAjustesCambiados(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_AJUSTES_CAMBIADOS));
}

/** Cada cuánto se repasan los ajustes del tenant con la app abierta.
 *  Un minuto: «encender Cocina se nota en la caja en menos de un
 *  minuto» es el criterio del bloque. */
const REPASO_MS = 60_000;

export function useDeviceBootstrap(): {
  state: BootstrapState;
  refresh: () => void;
  unpair: () => void;
} {
  const [state, setState] = useState<BootstrapState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    const token = getDeviceToken();
    if (!token) {
      setState({ kind: "unpaired" });
      return;
    }
    try {
      const data = await apiWithDevice<DeviceMeResponse>("/devices/me");
      writeCachedDeviceMe(data);
      setState({ kind: "paired", data });
    } catch (err) {
      const decision = decideAfterBootstrapError(err);
      // H1 · antes esto caía en la rama de abajo y, sin `device-me`
      // cacheado, dejaba el terminal en `loading` reintentando cada 3 s
      // para siempre. Ahora para y lo dice. NO purgamos el token: el
      // dispositivo sigue emparejado, y el día que le enciendan la caja
      // a la empresa arranca sin volver a emparejarlo.
      if (decision === "caja-disabled") {
        setState({
          kind: "cajaDisabled",
          message:
            err instanceof ApiError && err.message
              ? err.message
              : "Esta empresa no tiene el módulo de caja activado.",
        });
        return;
      }
      // kds-1-cocina · «modo cocina». Se pregunta a `/kitchen/me`, que es
      // la única puerta que acepta un `KITCHEN`. Si ESA también falla —el
      // módulo se apagó con la tablet emparejada— se cae a `retry`, que es
      // lo correcto: el aparato sigue emparejado y el día que lo
      // reenciendan arranca sin volver a emparejarlo. Mismo criterio que
      // `cajaDisabled`.
      if (decision === "kitchen") {
        try {
          const k = await apiWithDevice<KitchenMeResponse>("/kitchen/me");
          setState({ kind: "kitchen", data: k });
        } catch {
          setState({ kind: "loading" });
          setTimeout(refresh, 3000);
        }
        return;
      }
      // residencia-1 · «modo puerta». Se pregunta a
      // `/residencia/puerta/me`, que es la única ruta que acepta un `ROOM`.
      // Si ESA también falla —el módulo se apagó con la tablet
      // emparejada— se cae a `retry`, que es lo correcto: el aparato sigue
      // emparejado y el día que lo reenciendan arranca sin volver a
      // emparejarlo. Mismo criterio que `kitchen` y que `cajaDisabled`.
      if (decision === "room") {
        try {
          const p = await apiWithDevice<PuertaMeResponse>(
            "/residencia/puerta/me",
          );
          setState({ kind: "room", data: p });
        } catch {
          setState({ kind: "loading" });
          setTimeout(refresh, 3000);
        }
        return;
      }
      // residencia-4 · «modo guardia». Mismo criterio exacto que
      // `kitchen` y `room`: si `/residencia/guardia/me` también falla —el
      // módulo se apagó con el móvil emparejado— se cae a `retry`, que es
      // lo correcto. Un móvil de guardia que se desempareja solo a las
      // tres de la mañana es un centro sin avisos hasta que alguien lo
      // note.
      if (decision === "guard") {
        try {
          const g = await apiWithDevice<GuardiaMeResponse>(
            "/residencia/guardia/me",
          );
          setState({ kind: "guard", data: g });
        } catch {
          setState({ kind: "loading" });
          setTimeout(refresh, 3000);
        }
        return;
      }
      // residencia-5 · «modo relevo». Mismo criterio exacto que los tres
      // de arriba: si `/residencia/sala/me` también falla —el módulo se
      // apagó con la tablet emparejada— se cae a `retry`.
      if (decision === "sala") {
        try {
          const s = await apiWithDevice<SalaReposo>("/residencia/sala/me");
          setState({ kind: "sala", data: s });
        } catch {
          setState({ kind: "loading" });
          setTimeout(refresh, 3000);
        }
        return;
      }
      if (decision === "purge") {
        // Sólo borramos cuando el backend confirma que el dispositivo
        // está revocado o el JWT ha caducado — un 401 sin código (o con
        // código que no entendemos) probablemente es un proxy o un
        // restart transitorio y NO debe desemparejar al cliente.
        clearAllDeviceState();
        localStorage.removeItem(DEVICE_ME_CACHE_KEY);
        // residencia-3 (decisión 7) · **la caché de la puerta se vacía al
        // revocar el dispositivo.** Dentro hay el plan de cuidados de dos
        // personas y el roster del centro con las huellas de sus PIN: una
        // tablet desemparejada no se queda con eso.
        //
        // Va aquí y no dentro de `clearAllDeviceState` porque eso es
        // `localStorage` sincrónico y esto es IndexedDB; mezclarlos
        // obligaría a hacer asíncrona una función que llaman seis sitios.
        void olvidarLaPuerta();
        // residencia-5 · y la de la sala, por lo mismo: dentro hay el
        // parte de un turno entero y el roster del centro.
        void olvidarLaSala();
        olvidarSesion();
        olvidarGuardia();
        setState({ kind: "unpaired" });
      } else {
        // v1.10-offline: error de red (o 401 ambiguo). Si tenemos un
        // device-me cacheado de un arranque online previo, seguimos
        // operando OFFLINE con esos datos — el terminal ya estaba
        // bootstrapeado. Igualmente reintentamos en background para
        // revalidar cuando vuelva la red.
        const cached = readCachedDeviceMe();
        if (cached) {
          setState({ kind: "paired", data: cached });
        } else {
          // Sin cache no podemos operar: dejamos "loading" y reintentamos.
          setState({ kind: "loading" });
        }
        setTimeout(refresh, 3000);
      }
    }
  }, []);

  // auditoria-sirope (#20) · EL REPASO SILENCIOSO.
  //
  // `refresh` es el arranque: puede dejar el terminal en `loading`, en
  // `unpaired` o reintentando. Esto es otra cosa — el terminal ya está
  // funcionando y sólo queremos enterarnos de que el super-admin ha
  // tocado un módulo. Si la llamada falla, NO pasa nada: se queda lo que
  // había y se repasa al siguiente minuto. Una caja no se cae porque un
  // repaso de ajustes no llegue.
  const repasar = useCallback(async () => {
    if (!getDeviceToken()) return;
    try {
      const data = await apiWithDevice<DeviceMeResponse>("/devices/me");
      writeCachedDeviceMe(data);
      setState((prev) =>
        // Sólo pisa el estado de un terminal que YA está emparejado. Si
        // está arrancando, en modo cocina o en modo puerta, manda
        // `refresh` y este repaso no se mete.
        prev.kind === "paired" ? { kind: "paired", data } : prev,
      );
    } catch {
      /* el terminal sigue con lo que tenía */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    // Al volver al primer plano: es el caso del 18-10 (el super-admin
    // cambia el ajuste mientras el cajero mira el móvil).
    const alVolver = () => {
      if (document.visibilityState === "visible") void repasar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    // Y con un evento del bus, que es lo que hace que se note en
    // segundos con la app delante.
    const alAvisar = () => void repasar();
    window.addEventListener(EVENTO_AJUSTES_CAMBIADOS, alAvisar);
    const t = setInterval(() => void repasar(), REPASO_MS);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener(EVENTO_AJUSTES_CAMBIADOS, alAvisar);
      clearInterval(t);
    };
  }, [repasar]);

  return {
    state,
    refresh,
    unpair: () => {
      clearAllDeviceState();
      // residencia-3 · lo mismo al desemparejar A MANO, y por lo mismo:
      // la caché de la puerta lleva el plan de dos personas dentro.
      void olvidarLaPuerta();
      olvidarSesion();
      olvidarGuardia();
      void olvidarLaSala();
      olvidarSesionDeSala();
      setState({ kind: "unpaired" });
    },
  };
}
