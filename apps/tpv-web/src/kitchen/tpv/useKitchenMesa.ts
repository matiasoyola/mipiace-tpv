// kds-1-cocina · EL ESTADO DE COCINA DE UNA MESA, en el TPV.
//
// Un hook y no estado repartido por `SalePage` porque son siete cosas que
// se mueven juntas: qué unidades tiene la cocina, qué tiempos están
// retenidos, qué comandas están listas, qué alergias hay declaradas, a
// dónde va cada sección, las anulaciones con su cuenta de 5 s, y el papel
// de respaldo. Separarlas dejaría la mitad de ellas desincronizadas tras
// cada envío.
//
// ── DE DÓNDE SALE LA VERDAD ───────────────────────────────────────────
//
// De `GET /tickets/:id/kitchen`. **Nada se guarda en el navegador**: es el
// cambio de fondo respecto a `kitchenSentLines.ts` de v2-H1, que lo llevaba
// en `localStorage` porque el servidor no lo sabía. Dos terminales ven lo
// mismo y recargar no inventa nada.
//
// Se recarga: al abrir la mesa, tras cada envío, tras cada anulación y
// cuando llega un evento de cocina por el bus de la tienda.
//
// ── kds-2-wifi · LOS DOS CAMINOS ──────────────────────────────────────
//
// Cada operación de cocina sale a la nube **y además** por la wifi del
// local a las pantallas de la tienda, con el mismo id. Las dos salidas van
// en paralelo y ninguna espera a la otra: con internet el directo es sólo
// refuerzo, y sin internet es lo único que hay.
//
// Lo que NO cambia: el «Deshacer» de 5 s sigue viviendo aquí y sin red (un
// deshacer que necesite red no es un deshacer), y el cobro, el turno y el
// offline de v1.10 no se tocan.

import { useCallback, useEffect, useRef, useState } from "react";

import { newId } from "../../lib/ids.js";

import { ApiError, apiWithCashier } from "../../api.js";
import {
  estadoCocinaVacio,
  normalizarEstado,
  type EstadoCocinaMesa,
} from "../../lib/kitchenComanda.js";
import { printEscposUsb } from "../../lib/escposPrint.js";
import type { KitchenSection } from "../secciones.js";
import {
  useAnulacionesPendientes,
  type AnulacionPendiente,
} from "./DeshacerToast.js";
import type { AlergiaDeclarada } from "./AlergiasSheet.js";
import type { EnvioLan, LanDeLaTienda, PantallaLan } from "./envioLan.js";
import type {
  CaminoDirecto,
  EstadoPantallas,
  OperacionLan,
} from "./useCaminoDirecto.js";

// `EstadoPantallas` se mudó a `useCaminoDirecto`: es de la TIENDA, no de
// una mesa, y ahora lo consumen dos sitios. Se re-exporta para no obligar a
// cambiar los imports de quien ya lo pedía aquí.
export type { EstadoPantallas } from "./useCaminoDirecto.js";

export interface EnvioRespuesta {
  revision: number;
  sentAt: string;
  nothingNew: boolean;
  replayed: boolean;
  sections: Array<{
    section: KitchenSection;
    destino: "PANTALLA" | "IMPRESORA" | "PANTALLA_E_IMPRESORA" | "NINGUNO";
    ok: boolean;
    lineCount: number;
    units: number;
    orderId?: string;
    error?: string;
  }>;
}

export interface KitchenMesa {
  estado: EstadoCocinaMesa;
  pantallas: EstadoPantallas | null;
  /** Anulaciones en su ventana de 5 s. */
  anulaciones: AnulacionPendiente[];
  /** «Cocina no recibe»: alguna sección con pantalla y sin latido. */
  cocinaNoRecibe: boolean;
  recargar: () => void;
  /** El `−` sobre una línea YA ENVIADA. Arranca la cuenta de 5 s. */
  anularEnviado: (lineId: string, nombre: string, units: number) => void;
  deshacerAnulacion: (key: string) => void;
  /** Manda ya lo pendiente. Antes de cobrar o de salir de la mesa. */
  vaciarAnulaciones: () => void;
  marcharTiempo: (course: number) => Promise<void>;
  marcarUrgente: (urgent: boolean) => Promise<void>;
  ponerSilla: (lineId: string, seat: number | null) => Promise<void>;
  ponerTiempo: (lineId: string, course: number) => Promise<void>;
  guardarAlergias: (alergias: AlergiaDeclarada[]) => Promise<void>;
  /** Saca el papel de respaldo de estas comandas por la USB del terminal. */
  sacarPapelDeRespaldo: (orderIds: string[]) => Promise<void>;

  // ── kds-2-wifi ──────────────────────────────────────────────────────
  /** Las pantallas de la tienda, con su dirección en la wifi del local. */
  pantallasLan: PantallaLan[];
  /** La clave y la identidad con la que se firma, o null. */
  lan: LanDeLaTienda | null;
  /** Manda una operación por el camino directo. **Nunca lanza.** */
  mandarPorWifi: (
    kind: OperacionLan,
    opId: string,
    payload: unknown,
  ) => Promise<EnvioLan | null>;
}

export function useKitchenMesa(opts: {
  ticketId: string | null;
  /** `Tenant.kitchenDisplayEnabled`. Apagado, el hook no pide nada. */
  moduloEncendido: boolean;
  /**
   * kds-2-wifi · el camino directo de la TIENDA, que lo monta `TpvHome`.
   * Aquí sólo se usa; quien decide si hay wifi, si la nube está caída y si
   * sale papel es él.
   */
  camino: CaminoDirecto;
}): KitchenMesa {
  // `moduloEncendido` ya no se lee aquí: lo que dependía de él (pedir el
  // estado de las pantallas) vive en `useCaminoDirecto`. Se conserva en la
  // firma porque es quien lo consume el que sabe si el módulo está
  // comprado, y quitarlo obligaría a que `SalePage` lo mirara dos veces.
  const { ticketId, camino } = opts;
  const [estado, setEstado] = useState<EstadoCocinaMesa>(estadoCocinaVacio);

  const recargar = useCallback(() => {
    if (!ticketId) {
      setEstado(estadoCocinaVacio());
      return;
    }
    // **SE PIDE TAMBIÉN CON EL MÓDULO APAGADO**, y es deliberado: el envío
    // por diferencias es un ARREGLO del servidor y aplica igual, así que
    // `sentUnits` es la verdad de «qué está en cocina» con módulo o sin él.
    // Es lo que hace que la comanda siga partiéndose en «EN COCINA» y «SIN
    // ENVIAR» en un bar que nunca compró la pantalla —que es como v2-H1 la
    // dejó— sin volver al conjunto de ids en `localStorage`.
    //
    // Lo que el módulo apaga es lo de arriba: `canCorrectSent` vuelve false
    // (lo decide el servidor), y el TPV no pinta «Urgente», «Espera»,
    // «Marchar» ni la banda «LISTO».
    void apiWithCashier<unknown>(`/tickets/${ticketId}/kitchen`)
      // `normalizarEstado` y no el objeto tal cual: la comanda es la
      // pantalla de la venta y no puede caerse por un 200 con la forma
      // incompleta (una API vieja durante un despliegue, un proxy que
      // contesta otra cosa). Ver su cabecera.
      .then((raw) => setEstado(normalizarEstado(raw)))
      .catch(() => {
        // Sin red, el TPV sigue vendiendo: es la regla de la casa («cobrar
        // siempre se puede»). Lo que no se puede es inventar que la cocina
        // tiene algo, así que se deja el estado anterior y la comanda
        // seguirá pintando lo último que se supo.
      });
  }, [ticketId]);

  useEffect(recargar, [recargar]);

  // kds-2-wifi · lo de la TIENDA (la clave, las IP, si la nube contesta,
  // si sale papel) lo lleva `useCaminoDirecto`, que lo monta `TpvHome`.
  // Aquí sólo se usa.
  const { pantallas, lan, pantallasLan, mandarPorWifi } = camino;

  // ── Las anulaciones, con su ventana de 5 s ──────────────────────────
  const ticketRef = useRef(ticketId);
  ticketRef.current = ticketId;
  const anular = useCallback(
    (a: AnulacionPendiente) => {
      const id = ticketRef.current;
      if (!id) return;
      // kds-2-wifi · LOS DOS CAMINOS. El id de la operación es la clave del
      // «Deshacer» (lleva la hora y un sufijo aleatorio, así que es único
      // por anulación), y es por él por lo que la tablet descarta el
      // duplicado si llegan los dos.
      void mandarPorWifi("ANULACION", a.opId ?? newId(), {
        ticketId: id,
        ticketLineId: a.lineId,
        units: a.units,
      });
      void apiWithCashier(`/tickets/${id}/kitchen/void-units`, {
        method: "POST",
        body: { lineId: a.lineId, units: a.units },
      })
        .catch((err) => {
          // Un 409 NOT_SENT_TO_KITCHEN significa que lo que se quería
          // anular ya no estaba en cocina (otro terminal se adelantó). No
          // es un error que el camarero pueda arreglar y la venta ya bajó
          // la unidad: se recarga y se calla.
          if (err instanceof ApiError && err.status === 409) return;
          throw err;
        })
        .finally(recargar);
    },
    [recargar, mandarPorWifi],
  );
  const cola = useAnulacionesPendientes(anular);

  const anularEnviado = useCallback(
    (lineId: string, nombre: string, units: number) => {
      cola.encolar({
        // La clave lleva la hora: dos `−` seguidos sobre la misma línea son
        // dos anulaciones pendientes, cada una con su «Deshacer».
        key: `${lineId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        lineId,
        nombre,
        units,
        // kds-2-wifi · el id con el que esta anulación viaja por los DOS
        // caminos. Se genera al encolar, no al mandar: si se generara al
        // mandar, la nube y la wifi llevarían ids distintos y la cocina
        // vería la anulación dos veces.
        opId: newId(),
      });
    },
    [cola],
  );

  const marcharTiempo = useCallback(
    async (course: number) => {
      if (!ticketId) return;
      // kds-2-wifi · los dos caminos, en paralelo y sin que uno espere al
      // otro. `allSettled` y no `all`: sin internet la nube falla y la
      // marcha TIENE que llegar igual por la wifi — si se usara `all`, el
      // rechazo de la nube se llevaría por delante el camino bueno.
      const opId = newId();
      await Promise.allSettled([
        apiWithCashier(`/tickets/${ticketId}/kitchen/fire`, {
          method: "POST",
          body: { course },
        }),
        mandarPorWifi("MARCHA", opId, {
          ticketId,
          course,
          firedAt: new Date().toISOString(),
        }),
      ]);
      recargar();
    },
    [ticketId, recargar, mandarPorWifi],
  );

  const marcarUrgente = useCallback(
    async (urgent: boolean) => {
      if (!ticketId) return;
      const opId = newId();
      await Promise.allSettled([
        apiWithCashier(`/tickets/${ticketId}/kitchen/urgent`, {
          method: "POST",
          body: { urgent },
        }),
        mandarPorWifi("URGENTE", opId, { ticketId, urgent }),
      ]);
      recargar();
    },
    [ticketId, recargar, mandarPorWifi],
  );

  const ponerSilla = useCallback(
    async (lineId: string, seat: number | null) => {
      if (!ticketId) return;
      await apiWithCashier(`/tickets/${ticketId}/lines/${lineId}/kitchen`, {
        method: "PUT",
        body: { seat },
      });
      recargar();
    },
    [ticketId, recargar],
  );

  const ponerTiempo = useCallback(
    async (lineId: string, course: number) => {
      if (!ticketId) return;
      await apiWithCashier(`/tickets/${ticketId}/lines/${lineId}/kitchen`, {
        method: "PUT",
        body: { course },
      });
      recargar();
    },
    [ticketId, recargar],
  );

  const guardarAlergias = useCallback(
    async (alergias: AlergiaDeclarada[]) => {
      if (!ticketId) return;
      await apiWithCashier(`/tickets/${ticketId}/allergies`, {
        method: "PUT",
        body: { allergies: alergias },
      });
      recargar();
    },
    [ticketId, recargar],
  );

  const sacarPapelDeRespaldo = useCallback(async (orderIds: string[]) => {
    for (const orderId of orderIds) {
      const res = await apiWithCashier<{ escposBase64: string }>(
        `/kitchen/comandas/${orderId}/escpos`,
      );
      const bin = atob(res.escposBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      await printEscposUsb(bytes);
    }
  }, []);

  // **EL PAPEL SÓLO SALE SI FALLAN LOS DOS CAMINOS** (decisión 9): lo
  // decide `useCaminoDirecto`, que es el único que sabe si la wifi acusó.
  const cocinaNoRecibe = camino.cocinaNoRecibe;

  return {
    estado,
    pantallas,
    anulaciones: cola.pendientes,
    cocinaNoRecibe,
    recargar,
    anularEnviado,
    deshacerAnulacion: cola.deshacer,
    vaciarAnulaciones: cola.vaciar,
    marcharTiempo,
    marcarUrgente,
    ponerSilla,
    ponerTiempo,
    guardarAlergias,
    sacarPapelDeRespaldo,
    pantallasLan,
    lan,
    mandarPorWifi,
  };
}

// `LATIDO_REFRESCO_MS` y `SONDEO_MS` se mudaron a `useCaminoDirecto` con
// el resto de lo que es de la TIENDA. Se re-exportan porque los tests y la
// comanda los nombran.
export { LATIDO_REFRESCO_MS, SONDEO_MS } from "./useCaminoDirecto.js";
