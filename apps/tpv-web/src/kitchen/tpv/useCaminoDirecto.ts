// kds-2-wifi · EL CAMINO DIRECTO, visto desde el TPV.
//
// Es de la TIENDA y no de una mesa, así que vive arriba (lo monta
// `TpvHome`) y lo consumen los dos que lo necesitan:
//
//   · `useKitchenMesa`, para mandar la comanda, la anulación, la marcha y
//     el urgente por los dos caminos;
//   · `useAvisosListo`, para que el «LISTO» siga llegando sin internet y
//     para que «Servido» también salga por la wifi.
//
// Antes `GET /kitchen/estado` lo pedía `useKitchenMesa`. Se sube aquí
// porque ahora hay dos consumidores y ese endpoint trae la **clave de la
// tienda**: dos peticiones con 30 s de desfase podrían dejar a la comanda
// firmando con una clave y a la banda «LISTO» con otra el minuto en que se
// rota (al revocar un aparato). Un solo sitio, una sola clave.
//
// ── LO QUE DECIDE SI HAY CAMINO DIRECTO ───────────────────────────────
//
// Tres cosas, y las tres vienen de fuera: que esto sea la APK (hay puente
// nativo), que la tienda tenga pantalla de cocina (hay clave), y que la
// tablet haya dicho dónde escucha (hay IP). Si falta alguna,
// `porQueNoHayWifi` lo dice **en palabras**, porque es lo que lee el
// implantador en el botón «Probar conexión directa con cocina».

import { useCallback, useEffect, useRef, useState } from "react";

import { apiWithCashier } from "../../api.js";
import { newId } from "../../lib/ids.js";
import type { KitchenSection } from "../secciones.js";
import {
  mandarPorLan,
  porQueNoHayCaminoDirecto,
  preguntarAPantallas,
  type EnvioLan,
  type LanDeLaTienda,
  type PantallaLan,
  type RespuestaDePantalla,
} from "./envioLan.js";

export interface EstadoPantallas {
  heartbeatWindowMs: number;
  /**
   * Con qué clave se le habla a la cocina por la wifi, y con qué identidad
   * firma este terminal. `null` en una tienda sin pantalla de cocina: una
   * clave repartida donde no hace falta es superficie gratis.
   */
  lan: LanDeLaTienda | null;
  screens: Array<{
    id: string;
    name: string | null;
    sections: KitchenSection[];
    alive: boolean;
    lastSeenAt: string | null;
    /** Dónde escuchaba la última vez que lo dijo. */
    lanIp?: string | null;
    lanPort?: number | null;
    lanAt?: string | null;
  }>;
  sections: Array<{
    section: KitchenSection;
    screen: boolean;
    printer: boolean;
    canCorrectSent: boolean;
    /** La sección tiene pantalla y NINGUNA de las suyas da señales. */
    needsPaperFallback: boolean;
  }>;
}

export type OperacionLan =
  | "COMANDA"
  | "ANULACION"
  | "MARCHA"
  | "URGENTE"
  | "SERVIDO";

export interface CaminoDirecto {
  pantallas: EstadoPantallas | null;
  /** Las pantallas de la tienda con su dirección en la wifi del local. */
  pantallasLan: PantallaLan[];
  lan: LanDeLaTienda | null;
  /** Qué falta para poder hablar por la wifi, en palabras. */
  porQueNoHayWifi: string | null;
  /** `true` si el último `GET /kitchen/estado` falló: la nube no contesta. */
  nubeCaida: boolean;
  /**
   * `true` cuando la cocina **no recibe por ningún camino**: alguna sección
   * con pantalla sin latido en el servidor Y sin acuse por la wifi. Es lo
   * que dispara el papel.
   */
  cocinaNoRecibe: boolean;
  /** `true` si la última conversación por la wifi fue bien. */
  wifiViva: boolean;
  /** Lo que las pantallas dicen por la wifi que tienen listo (sin internet). */
  listasPorWifi: RespuestaDePantalla[];
  recargarEstado: () => void;
  /** Manda una operación por el camino directo. **Nunca lanza.** */
  mandarPorWifi: (
    kind: OperacionLan,
    opId: string,
    payload: unknown,
  ) => Promise<EnvioLan | null>;
  /** El botón «Probar conexión directa con cocina». */
  probar: () => Promise<RespuestaDePantalla[]>;
}

/**
 * Cada 30 s se vuelve a preguntar si las pantallas viven.
 *
 * La ventana del servidor son 90 s, así que 30 da tres oportunidades de
 * enterarse antes de que el dato se quede viejo. Más a menudo sería pedirle
 * a la API un dato que cambia cada minuto y medio; menos, enterarse de que
 * la cocina no recibe tres minutos después de que dejara de recibir.
 */
export const LATIDO_REFRESCO_MS = 30_000;

/**
 * Cada cuánto se le pregunta a la tablet, SIN INTERNET, qué tiene listo.
 *
 * 4 s. Es lo que tarda un camarero en mirar la pantalla después de que el
 * cocinero cante «marchando»: más despacio y el «LISTO» llega tarde; más
 * deprisa se gasta batería de la tablet y de los terminales en una pregunta
 * que casi siempre se contesta «nada nuevo». Con internet esto no corre:
 * los eventos de la nube avisan solos y en el momento.
 */
export const SONDEO_MS = 4_000;

/**
 * Cuánto vale un acuse de la wifi antes de dar el camino por muerto.
 *
 * Dos sondeos más un respiro. Por debajo de esto, un bache de la wifi del
 * bar sacaría papel que nadie pidió en mitad del servicio.
 */
export const WIFI_VIVA_MS = SONDEO_MS * 2 + 4_000;

/**
 * **EL PAPEL SÓLO SALE SI FALLAN LOS DOS CAMINOS** (decisión 9).
 *
 * El servidor dice si la pantalla da señales por la nube; lo que el
 * servidor NO puede saber es si le está llegando por la wifi del local,
 * porque esa conversación no pasa por él. Así que su `needsPaperFallback`
 * es sólo la MITAD, y aquí se le resta lo que la wifi acusa.
 *
 * Es una función y no una línea dentro del hook por una razón concreta: es
 * la regla que decide si se gasta papel en mitad de un servicio, y una
 * regla tiene que poder sabotearse y ponerse roja. Escrita dentro del
 * hook, el test tenía que reimplementar la resta y entonces el sabotaje
 * pasaba en verde — que es la lección del §4.1 de kds-1, otra vez.
 *
 * Tiene su fila en la tabla de sabotajes: «papel con la wifi funcionando».
 */
export function saleElPapel(opts: {
  /** El servidor no ve latido de ninguna pantalla de esa sección. */
  servidorPidePapel: boolean;
  /** Alguna pantalla acusó recibo por la wifi hace poco. */
  wifiViva: boolean;
}): boolean {
  return opts.servidorPidePapel && !opts.wifiViva;
}

export function useCaminoDirecto(opts: {
  /** `Tenant.kitchenDisplayEnabled`. Apagado, no se pide nada. */
  moduloEncendido: boolean;
}): CaminoDirecto {
  const { moduloEncendido } = opts;
  const [pantallas, setPantallas] = useState<EstadoPantallas | null>(null);
  const [nubeCaida, setNubeCaida] = useState(false);
  const [listasPorWifi, setListasPorWifi] = useState<RespuestaDePantalla[]>([]);
  const [ultimoAcuse, setUltimoAcuse] = useState(0);

  const recargarEstado = useCallback(() => {
    if (!moduloEncendido) {
      setPantallas(null);
      return;
    }
    void apiWithCashier<EstadoPantallas>("/kitchen/estado")
      .then((d) => {
        setPantallas(d);
        setNubeCaida(false);
      })
      .catch(() => {
        // El aviso de «Cocina no recibe» no puede bloquear la venta.
        //
        // Pero SÍ hay que apuntar que la nube no contesta: desde ese momento
        // el «LISTO» no va a llegar por eventos y hay que preguntárselo a la
        // tablet. Se conserva el último `pantallas` conocido —con su IP y su
        // clave— porque es con lo que se habla por la wifi.
        setNubeCaida(true);
      });
  }, [moduloEncendido]);

  useEffect(() => {
    recargarEstado();
    if (!moduloEncendido) return;
    const id = setInterval(recargarEstado, LATIDO_REFRESCO_MS);
    return () => clearInterval(id);
  }, [recargarEstado, moduloEncendido]);

  const lan = pantallas?.lan ?? null;
  const pantallasLan: PantallaLan[] = (pantallas?.screens ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sections: p.sections,
    lanIp: p.lanIp ?? null,
    lanPort: p.lanPort ?? null,
    lanAt: p.lanAt ?? null,
  }));
  const porQueNoHayWifi = porQueNoHayCaminoDirecto(lan, pantallasLan);

  // Los refs son para que `mandarPorWifi` no cambie de identidad en cada
  // refresco: lo llaman efectos y temporizadores, y una dependencia que
  // cambia cada 30 s reiniciaría el sondeo y la cuenta del «Deshacer».
  const lanRef = useRef(lan);
  lanRef.current = lan;
  const pantallasLanRef = useRef(pantallasLan);
  pantallasLanRef.current = pantallasLan;

  const mandarPorWifi = useCallback(
    async (
      kind: OperacionLan,
      opId: string,
      payload: unknown,
    ): Promise<EnvioLan | null> => {
      const l = lanRef.current;
      const ps = pantallasLanRef.current;
      if (!l || ps.length === 0) return null;
      try {
        const r = await mandarPorLan({
          lan: l,
          pantallas: ps,
          kind,
          opId,
          payload,
        });
        if (r.alguna) setUltimoAcuse(Date.now());
        return r;
      } catch {
        // El camino directo NO puede tumbar una operación de cocina. Si
        // falla, queda la nube; y si las dos fallan, el papel.
        return null;
      }
    },
    [],
  );

  const probar = useCallback(async () => {
    const l = lanRef.current;
    const ps = pantallasLanRef.current;
    if (!l || ps.length === 0) return [];
    try {
      const r = await preguntarAPantallas({
        lan: l,
        pantallas: ps,
        kind: "PRUEBA",
        opId: newId(),
      });
      if (r.some((x) => x.camino.ok)) setUltimoAcuse(Date.now());
      return r;
    } catch {
      return [];
    }
  }, []);

  // El «LISTO» SIN INTERNET: se le pregunta a la tablet cada pocos
  // segundos. Con internet esto no corre.
  useEffect(() => {
    if (!moduloEncendido || !nubeCaida) {
      setListasPorWifi([]);
      return;
    }
    let vivo = true;
    const sondear = async () => {
      const l = lanRef.current;
      const ps = pantallasLanRef.current;
      if (!l || ps.length === 0) return;
      try {
        const r = await preguntarAPantallas({
          lan: l,
          pantallas: ps,
          kind: "SONDEO",
          opId: newId(),
        });
        if (!vivo) return;
        setListasPorWifi(r);
        if (r.some((x) => x.camino.ok)) setUltimoAcuse(Date.now());
      } catch {
        /* la siguiente vuelta lo intenta otra vez */
      }
    };
    void sondear();
    const id = setInterval(sondear, SONDEO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [moduloEncendido, nubeCaida]);

  const wifiViva = ultimoAcuse > 0 && Date.now() - ultimoAcuse < WIFI_VIVA_MS;

  const cocinaNoRecibe = saleElPapel({
    servidorPidePapel:
      pantallas?.sections.some((s) => s.needsPaperFallback) === true,
    wifiViva,
  });

  return {
    pantallas,
    pantallasLan,
    lan,
    porQueNoHayWifi,
    nubeCaida,
    cocinaNoRecibe,
    wifiViva,
    listasPorWifi,
    recargarEstado,
    mandarPorWifi,
    probar,
  };
}

/**
 * El camino directo APAGADO, como constante de módulo.
 *
 * Es lo que usa una `SalePage` montada sin camino: un banco de pruebas, un
 * test que sólo mira la comanda, o un llamador que no conoce el bloque.
 * Significa exactamente «este terminal no tiene camino directo», que es la
 * verdad en los tres casos y es cómo se comportaba el TPV antes de kds-2.
 *
 * Constante de módulo y no un objeto nuevo en cada render: si se creara al
 * vuelo, cambiaría de identidad en cada repintado y los efectos que
 * dependen de él (el sondeo, la cuenta del «Deshacer») se reiniciarían sin
 * parar.
 */
export const CAMINO_APAGADO: CaminoDirecto = {
  pantallas: null,
  pantallasLan: [],
  lan: null,
  porQueNoHayWifi:
    "Este terminal no tiene configurado el camino directo con la cocina.",
  nubeCaida: false,
  cocinaNoRecibe: false,
  wifiViva: false,
  listasPorWifi: [],
  recargarEstado: () => undefined,
  mandarPorWifi: async () => null,
  probar: async () => [],
};
