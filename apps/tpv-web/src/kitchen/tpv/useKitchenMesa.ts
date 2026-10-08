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

import { useCallback, useEffect, useRef, useState } from "react";

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

export interface EstadoPantallas {
  heartbeatWindowMs: number;
  screens: Array<{
    id: string;
    name: string | null;
    sections: KitchenSection[];
    alive: boolean;
    lastSeenAt: string | null;
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
}

export function useKitchenMesa(opts: {
  ticketId: string | null;
  /** `Tenant.kitchenDisplayEnabled`. Apagado, el hook no pide nada. */
  moduloEncendido: boolean;
}): KitchenMesa {
  const { ticketId, moduloEncendido } = opts;
  const [estado, setEstado] = useState<EstadoCocinaMesa>(estadoCocinaVacio);
  const [pantallas, setPantallas] = useState<EstadoPantallas | null>(null);

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

  // El estado de las pantallas no depende de la mesa: es de la tienda. Se
  // pide al abrir y cada `LATIDO_REFRESCO_MS`, porque es lo que decide si
  // «Enviar» avisa y saca papel.
  useEffect(() => {
    if (!moduloEncendido) {
      setPantallas(null);
      return;
    }
    let vivo = true;
    const pedir = () => {
      void apiWithCashier<EstadoPantallas>("/kitchen/estado")
        .then((d) => {
          if (vivo) setPantallas(d);
        })
        .catch(() => {
          /* el aviso de «Cocina no recibe» no puede bloquear la venta */
        });
    };
    pedir();
    const id = setInterval(pedir, LATIDO_REFRESCO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [moduloEncendido]);

  // ── Las anulaciones, con su ventana de 5 s ──────────────────────────
  const ticketRef = useRef(ticketId);
  ticketRef.current = ticketId;
  const anular = useCallback(
    (a: AnulacionPendiente) => {
      const id = ticketRef.current;
      if (!id) return;
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
    [recargar],
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
      });
    },
    [cola],
  );

  const marcharTiempo = useCallback(
    async (course: number) => {
      if (!ticketId) return;
      await apiWithCashier(`/tickets/${ticketId}/kitchen/fire`, {
        method: "POST",
        body: { course },
      });
      recargar();
    },
    [ticketId, recargar],
  );

  const marcarUrgente = useCallback(
    async (urgent: boolean) => {
      if (!ticketId) return;
      await apiWithCashier(`/tickets/${ticketId}/kitchen/urgent`, {
        method: "POST",
        body: { urgent },
      });
      recargar();
    },
    [ticketId, recargar],
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

  const cocinaNoRecibe =
    pantallas?.sections.some((s) => s.needsPaperFallback) === true;

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
  };
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
