// clinica-11 · EN UNA CLÍNICA NO SALE LA PANTALLA DE «ABRIR TURNO».
//
// Decisión de producto (Matías, 28-10): «la podóloga llega, atiende y
// cobra». La pantalla que le pide el fondo de caja le pide un dato que no
// tiene —no hay mostrador, no hay relevo, nadie cuenta el cajón al
// llegar— para desbloquear una pantalla que no quería.
//
// Lo que este banco fija son las DOS mitades, y hacen falta las dos:
//
//   · en una clínica la pantalla no aparece y la sesión sale con un turno
//     con el que operar, sin que nadie teclee nada;
//   · en los catorce comercios sin historia clínica **no cambia ni una
//     pantalla**: «Abrir turno» sigue ahí, con su campo y su botón.
//
// Y una tercera cosa que es la que hace que esto sea «al primer cobro» y
// no «al entrar»: el TPV **no llama a `POST /shift/open`**. El turno nace
// LOCAL y lo abre el servidor en el primer cobro (ver
// `src/lib/turnoDeClinica.ts` y `shift/apertura-automatica.ts`). Si este
// banco viera un `POST /shift/open`, el bloque estaría abriendo turnos los
// días en que no se cobra nada.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import { ShiftOpenWithDaySummary } from "../src/App.js";
import { getLocalShift } from "../src/lib/offlineShift.js";
import { __resetOutboxForTests, outboxList } from "../src/lib/outbox.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const FONDO = 130.5;

let container: HTMLDivElement;
let root: Root;
let llamadas: string[];

beforeEach(async () => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  llamadas = [];
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    llamadas.push(path);
    // Sin tarjeta del día pendiente: lo que se mide aquí es el paso
    // siguiente. La tarjeta tiene su propio banco desde v1.11.
    if (path === "/shift/last-closed") return { summary: null };
    // El fondo que el servidor dice que le toca al turno siguiente.
    if (path === "/shift/current") return { shift: null, fondoSugerido: FONDO };
    return {};
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function montar(clinica: boolean) {
  const abierto = vi.fn();
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ShiftOpenWithDaySummary
        cashierRole="OWNER"
        clinica={clinica}
        cashierLabel="Rosario"
        registerName="Caja 1"
        storeName="Clínica demo"
        onOpened={abierto}
        onBack={vi.fn()}
      />,
    );
  });
  await settle();
  return abierto;
}

/** ¿Está la pantalla de abrir turno? Su `<h1>` lo dice. */
function pantallaDeAbrirTurno(): boolean {
  return [...container.querySelectorAll("h1")].some(
    (h) => h.textContent?.trim() === "Abrir turno",
  );
}

describe("clinica-11 · la pantalla de «Abrir turno»", () => {
  it("EN UNA CLÍNICA no aparece, y la sesión sale con turno", async () => {
    const abierto = await montar(true);
    expect(pantallaDeAbrirTurno()).toBe(false);
    // Y no se queda en un spinner: la sesión sale con un turno con el que
    // operar.
    expect(abierto).toHaveBeenCalledTimes(1);
    const [shift, openedOffline] = abierto.mock.calls[0]!;
    expect(typeof shift.id).toBe("string");
    expect(shift.id.length).toBeGreaterThan(0);
    // El fondo es el que dijo el servidor, no uno inventado en el cliente:
    // dos fuentes para el mismo fondo son un descuadre que no es de nadie.
    expect(shift.cashOpening).toBe(String(FONDO));
    // `true` = el turno ya está escrito en local; `App` no vuelve a
    // espejarlo (lo pisaría con un turno del servidor que aún no existe).
    expect(openedOffline).toBe(true);
  });

  it("y el turno queda escrito EN LOCAL, con ese fondo", async () => {
    await montar(true);
    const local = await getLocalShift();
    expect(local).not.toBeNull();
    expect(local!.cashOpening).toBe(FONDO);
    // Sin `serverId`: el turno del servidor todavía no existe. Lo abrirá
    // el primer cobro.
    expect(local!.serverId).toBeNull();
  });

  it("NO se llama a POST /shift/open: eso sería abrirlo al entrar", async () => {
    // La diferencia no es de estilo. Abrir el turno al teclear el PIN
    // significa que un martes de sólo revisiones —atiende a cuatro
    // pacientes y no cobra a ninguna— deja un turno abierto que hay que
    // cerrar, y al día siguiente ese turno es de ayer: el login caería en
    // `forceClose` y saldría OTRA pantalla.
    await montar(true);
    expect(llamadas).not.toContain("/shift/open");
    // Y tampoco encolado, que es el otro camino de abrirlo.
    const cola = await outboxList();
    expect(cola.filter((i) => i.kind === "shift-open")).toHaveLength(0);
  });

  it("EN UN COMERCIO SIN CLÍNICA no cambia ni una pantalla", async () => {
    const abierto = await montar(false);
    expect(pantallaDeAbrirTurno()).toBe(true);
    // Nadie ha abierto nada: el fondo lo teclea una persona.
    expect(abierto).not.toHaveBeenCalled();
    // Y la rama de la clínica no ha corrido: no se ha preguntado el fondo.
    expect(llamadas).not.toContain("/shift/current");
  });
});

// ── clinica-11 · EL PASO 3: ADOPTAR EL TURNO DEL SERVIDOR ───────────
//
// El turno de una clínica nace local y lo abre el SERVIDOR en el primer
// cobro. Quien se entera del id real es `adoptarTurnoDelServidor`, y si
// no se entera nadie el cierre del día pide `/shift/<localId>/close-day`
// y recibe un 404: la podóloga no podría cerrar su propio día.
//
// Sabotajes: que `adoptarTurnoDelServidor` no llame a `resolverTurnoLocal`
// → cae 1; que llame a la red con el turno ya resuelto → cae 1.
describe("clinica-11 · adoptar el turno que abrió el servidor", () => {
  it("un turno local sin resolver adopta el id del servidor", async () => {
    const { abrirTurnoDeClinicaEnLocal, adoptarTurnoDelServidor } =
      await import("../src/lib/turnoDeClinica.js");
    const { getLocalShift } = await import("../src/lib/offlineShift.js");

    const local = await abrirTurnoDeClinicaEnLocal();
    expect((await getLocalShift())!.serverId).toBeNull();

    // El primer cobro ya pasó: el servidor tiene turno.
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      llamadas.push(path);
      if (path === "/shift/current") {
        return {
          shift: {
            id: "11111111-1111-4111-8111-111111111111",
            openedAt: "2026-10-29T08:05:00.000Z",
            lastActivityAt: "2026-10-29T08:05:00.000Z",
            cashOpening: String(FONDO),
            userId: "u-1",
            ticketsCount: 1,
          },
        };
      }
      return {};
    });

    const adoptado = await adoptarTurnoDelServidor();
    expect(adoptado).toBe("11111111-1111-4111-8111-111111111111");
    const tras = await getLocalShift();
    expect(tras!.serverId).toBe("11111111-1111-4111-8111-111111111111");
    // Y el localId no se pisa: es el que llevan los tickets que puedan
    // seguir en la cola, y es con lo que el outbox los reescribe.
    expect(tras!.localId).toBe(local.id);
  });

  it("con el turno ya resuelto no toca la red", async () => {
    // Es lo que hace que esto no cueste nada en los catorce comercios sin
    // clínica: su turno nace del servidor y nace resuelto.
    const { adoptarTurnoDelServidor } = await import(
      "../src/lib/turnoDeClinica.js"
    );
    const { mirrorServerShift } = await import("../src/lib/offlineShift.js");
    await mirrorServerShift({
      id: "22222222-2222-4222-8222-222222222222",
      openedAt: "2026-10-29T07:00:00.000Z",
      cashOpening: "0",
    });
    llamadas.length = 0;
    expect(await adoptarTurnoDelServidor()).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(llamadas).toEqual([]);
  });

  it("sin turno local no hace nada y no revienta", async () => {
    const { adoptarTurnoDelServidor } = await import(
      "../src/lib/turnoDeClinica.js"
    );
    const { clearLocalShift } = await import("../src/lib/offlineShift.js");
    await clearLocalShift();
    llamadas.length = 0;
    expect(await adoptarTurnoDelServidor()).toBeNull();
    expect(llamadas).toEqual([]);
  });
});
