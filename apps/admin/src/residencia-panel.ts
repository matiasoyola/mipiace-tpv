// cuadro-de-control · **EL PANEL, UNA SOLA VEZ, PARA LOS DOS QUE LO
// MIRAN.**
//
// Desde este bloque el panel de dirección lo lee gente nueva: ya no sólo
// `PanelPage`, sino también la **barra lateral**, que pinta el contador de
// cada una de sus cinco entradas («Incidencias 4», «Relevos 2»).
//
// Y los contadores del menú tienen que ser **el mismo número que el
// panel**, de la misma petición (decisión 1 del bloque). Con dos
// consultas distintas —una ruta de contadores y el panel— el día que una
// de las dos cambie de criterio el menú dirá 4 y la pantalla 3, y nadie
// sabrá cuál miente.
//
// Así que el mismo mecanismo que `capabilities.ts`: una caché de módulo,
// una petición en vuelo compartida y `useSyncExternalStore` para quien la
// mire. El shell y la pantalla no se pueden pasar props —la pantalla es el
// PADRE de su propio `AdminShell`, así que un contexto no llega al
// revés—, que es exactamente la razón por la que las capacidades viven
// igual.
//
// ── LA CACHÉ SE TIRA AL QUEDARSE SIN NADIE MIRANDO ──────────────────
//
// Mismo criterio que las capacidades, y por la misma razón: al navegar
// entre pantallas el shell se desmonta, así que se vuelve a pedir. Sin
// eso, un `logout` + `login` con otro centro heredaría los contadores del
// anterior — y un contador heredado de otra residencia es peor que no
// tener contador.
//
// ── Y SÓLO SE PIDE DONDE HAY RESIDENCIA ─────────────────────────────
//
// El hook recibe `activo`. En un comercio, en un bar o en una clínica no
// se pide nada: la ruta contesta 404 (es la puerta de `ensureResidenciaEnabled`)
// y pedirla sería un 404 por pantalla en los quince clientes que no
// tienen el módulo.

import { useEffect, useSyncExternalStore } from "react";

import { api, ApiError } from "./api.js";
import type { Panel } from "./pages/residencia/relevo-lib.js";

export interface EstadoDelPanel {
  /** `null` mientras no ha llegado, o si el servidor dijo que no. */
  panel: Panel | null;
  /** El mensaje del servidor cuando dijo que no. */
  error: string | null;
  /**
   * El código del fallo. `PANEL_ES_DE_DIRECCION` **no es un error que
   * haya que arreglar**: es la respuesta correcta para un encargado sin
   * rol directivo, y quien lo pinta (la pantalla) enseña la frase. La
   * barra lateral simplemente se queda sin contadores.
   */
  codigo: string | null;
}

const VACIO: EstadoDelPanel = { panel: null, error: null, codigo: null };

// Un objeto estable: `useSyncExternalStore` compara por identidad, así
// que devolver uno nuevo en cada lectura sería un bucle de renders.
let estado: EstadoDelPanel = VACIO;
let enVuelo: Promise<void> | null = null;
const suscritos = new Set<() => void>();

function avisar(): void {
  for (const fn of suscritos) fn();
}

async function pedir(): Promise<void> {
  try {
    estado = { panel: await api<Panel>("/residencia/panel"), error: null, codigo: null };
  } catch (err) {
    estado = {
      panel: null,
      error: err instanceof ApiError ? err.message : "Error inesperado",
      codigo: err instanceof ApiError ? (err.code ?? null) : null,
    };
  }
  avisar();
}

function cargarSiHaceFalta(): void {
  if (estado !== VACIO || enVuelo != null) return;
  enVuelo = pedir().finally(() => {
    enVuelo = null;
  });
}

/**
 * Vuelve a pedir el panel y avisa a todo el que lo esté mirando — la
 * pantalla **y la barra lateral**, que es lo que hace que al marcar una
 * obligación desde el panel el contador del menú baje sin recargar.
 *
 * Reentrante: si ya hay una petición en vuelo se engancha a ella.
 */
export function recargarPanel(): Promise<void> {
  if (enVuelo != null) return enVuelo;
  enVuelo = pedir().finally(() => {
    enVuelo = null;
  });
  return enVuelo;
}

function suscribir(fn: () => void): () => void {
  suscritos.add(fn);
  return () => {
    suscritos.delete(fn);
    // Nadie mirando: fuera la caché. Ver la cabecera del fichero.
    if (suscritos.size === 0) {
      estado = VACIO;
      enVuelo = null;
    }
  };
}

function leer(): EstadoDelPanel {
  return estado;
}

/**
 * El panel de dirección, compartido.
 *
 * `activo` decide si se pide: lo pone a `true` quien sabe que esta cuenta
 * tiene la residencia encendida (hoy, `caps?.residencia === true`). La
 * suscripción se hace siempre —así el consumidor se entera cuando otro lo
 * carga— pero la petición sólo sale si alguien la pide.
 */
export function usePanelDeResidencia(activo: boolean): EstadoDelPanel {
  const leido = useSyncExternalStore(suscribir, leer, leer);
  useEffect(() => {
    if (activo) cargarSiHaceFalta();
  }, [activo]);
  return leido;
}

/** Sólo para las pruebas: deja el módulo como recién importado. */
export function __resetPanelParaTests(): void {
  estado = VACIO;
  enVuelo = null;
  suscritos.clear();
}

// ── cuadro-de-control · LOS CONTADORES DEL MENÚ ──────────────────────
//
// Cuatro de las cinco entradas del menú de una residencia llevan su
// número, y los cuatro salen del panel que acaba de cargar este módulo:
// es lo que impide que el menú diga 4 y la pantalla 3.
//
// ── ROJO SI HAY ALGO GRAVE O VENCIDO, ÁMBAR SI NO ──────────────────
//
// Es la regla del bloque, y no es cosmética: un contador que siempre está
// rojo deja de significar nada. «Doce fichas incompletas» en ámbar es
// trabajo de oficina; «doce, y a tres les falta algo imprescindible» en
// rojo es un expediente que no pasa una inspección.
//
// ── Y SI NO HAY NADA, NO HAY CONTADOR ──────────────────────────────
//
// `null` cuando el número es cero, y es la misma decisión que el panel
// toma con sus secciones vacías: cinco ceros en la barra lateral enseñan
// a no mirarla. El menú tranquilo es un menú sin números.

export type ClaveDeContador = "fichas" | "incidencias" | "relevos" | "obligaciones";

export interface ContadorDelMenu {
  n: number;
  /** `true` = rojo (algo grave o vencido). `false` = ámbar. */
  grave: boolean;
  /** Para el lector de pantalla: «4 incidencias abiertas». El número
   *  solo no se lee: un `4` sin sustantivo no dice de qué. */
  texto: string;
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * ── Y UN PANEL RARO NO TUMBA EL MENÚ ────────────────────────────────
 *
 * Todas las lecturas van con `?.` y con su `?? []`, y no es paranoia: el
 * menú de este bloque se pinta en TODAS las pantallas de una residencia,
 * así que una respuesta que no tenga la forma esperada —una API anterior
 * a este bloque durante los minutos de un despliegue, un proxy que
 * devuelve otra cosa— dejaría a la directora sin barra lateral y sin
 * forma de llegar a ninguna parte. Un contador que falta es un contador
 * que no se pinta; nunca una pantalla en blanco.
 */
export function contadorDelMenu(
  clave: ClaveDeContador,
  panel: Panel | null,
): ContadorDelMenu | null {
  if (panel == null) return null;
  switch (clave) {
    case "fichas": {
      const fichas = panel.fichasIncompletas;
      if (fichas == null || fichas.incompletas === 0) return null;
      return {
        n: fichas.incompletas,
        // Grave cuando a alguna le falta algo IMPRESCINDIBLE: sin DNI,
        // sin grado o sin un familiar al que llamar (alta-minima).
        grave: fichas.conImprescindibles > 0,
        texto: plural(
          fichas.incompletas,
          "ficha de residente incompleta",
          "fichas de residentes incompletas",
        ),
      };
    }
    case "incidencias": {
      const n = panel.abierto?.total ?? 0;
      if (n === 0) return null;
      // Grave = hay alguna N3 o N4 abierta. Son las que cierra otra
      // persona (D-28) y las que suben al móvil de guardia.
      const graves = (panel.abierto?.porNivel ?? [])
        .filter((x) => x.nivel === "N3" || x.nivel === "N4")
        .reduce((t, x) => t + x.cuantas, 0);
      return {
        n,
        grave: graves > 0,
        texto: plural(n, "incidencia abierta", "incidencias abiertas"),
      };
    }
    case "relevos": {
      const n = panel.relevos?.sinConfirmar?.length ?? 0;
      if (n === 0) return null;
      // Ámbar siempre: un relevo sin confirmar es una firma que falta, no
      // un residente en el hospital. Lo que sube de nivel es que lo
      // vencido se mezcle con esto, y eso lo evita el color.
      return {
        n,
        grave: false,
        texto: plural(n, "relevo sin confirmar", "relevos sin confirmar"),
      };
    }
    default: {
      // Lo VENCIDO manda: si hay algo vencido el contador es eso, en
      // rojo. Si no, lo de hoy, en ámbar. Sumar las dos cosas daría un
      // número que no se puede llevar a cero —hoy siempre toca algo— y
      // esconder lo vencido detrás de la suma es justo lo contrario.
      const vencidas = panel.obligaciones?.vencidas?.length ?? 0;
      if (vencidas > 0) {
        return {
          n: vencidas,
          grave: true,
          texto: plural(vencidas, "obligación vencida", "obligaciones vencidas"),
        };
      }
      const hoy = (panel.obligaciones?.hoy ?? []).filter((o) => !o.hecha).length;
      if (hoy === 0) return null;
      return {
        n: hoy,
        grave: false,
        texto: plural(hoy, "obligación para hoy", "obligaciones para hoy"),
      };
    }
  }
}
