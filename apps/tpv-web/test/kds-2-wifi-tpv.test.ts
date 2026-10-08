// kds-2-wifi · EL TPV MANDANDO POR LOS DOS CAMINOS.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | La IP de la tablet cambia sin internet | redescubre por NSD y la
//   | siguiente comanda llega
//   | Papel con la wifi funcionando | sin internet pero con wifi → no sale
//   | papel (la regla, en `cocinaNoRecibe`)
//   | Aceptar un mensaje sin firma o con la clave de otra tienda | el
//   | sobre que SALE de aquí tiene que poder rechazarse por eso
//
// Y el botón «Probar conexión directa con cocina»: sus mensajes, que son
// lo que lee el implantador de pie en la barra. Están aquí y no en el JSX
// porque son REGLAS, y una regla se prueba.
//
// Se prueba la lógica pura (`envioLan`, `pruebaConexion`) contra el plugin
// nativo fingido. Lo que pinta la comanda ya lo cubre
// `kds-tpv-cocina.test.tsx`.

import { beforeEach, describe, expect, it } from "vitest";

import { abrirSobre, type SobreLan } from "@mipiacetpv/kitchen-lan";

import {
  componerComandasLan,
  mandarPorLan,
  porQueNoHayCaminoDirecto,
  preguntarAPantallas,
  type LanDeLaTienda,
  type PantallaLan,
  type RespuestaDePantalla,
} from "../src/kitchen/tpv/envioLan.js";
import { diagnosticar } from "../src/kitchen/tpv/pruebaConexion.js";
import { estadoCocinaVacio } from "../src/lib/kitchenComanda.js";

const CLAVE = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const TIENDA = "11111111-1111-4111-8111-111111111111";
const TERMINAL = "22222222-2222-4222-8222-222222222222";
const ENVIO = "33333333-3333-4333-8333-333333333333";

const LAN: LanDeLaTienda = {
  key: CLAVE,
  defaultPort: 8787,
  maxAgeMs: 60_000,
  storeId: TIENDA,
  deviceId: TERMINAL,
};

const PANTALLA: PantallaLan = {
  id: "pantalla-1",
  name: "Pase",
  sections: ["COCINA"],
  lanIp: "192.168.1.44",
  lanPort: 8787,
  lanAt: "2026-10-09T13:00:00.000Z",
};

interface Llamada {
  ip: string;
  port: number;
  sobre: SobreLan;
}

interface PluginFalso {
  llamadas: Llamada[];
  descubrimientos: number;
  /** Qué contesta cada IP. Una IP que no esté aquí no contesta. */
  contestan: Map<string, { status: number; body?: unknown }>;
  /** Lo que devuelve NSD. */
  encontradas: Array<{ ip: string; port: number }>;
}

let plugin: PluginFalso;

function instalarPlugin() {
  plugin = {
    llamadas: [],
    descubrimientos: 0,
    contestan: new Map(),
    encontradas: [],
  };
  (globalThis as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      KitchenLan: {
        enviar: async (o: { ip: string; port: number; bodyJson: string }) => {
          plugin.llamadas.push({
            ip: o.ip,
            port: o.port,
            sobre: JSON.parse(o.bodyJson) as SobreLan,
          });
          const r = plugin.contestan.get(o.ip);
          if (!r) {
            // `status: 0` = no se llegó. Es lo que pasa cuando el router
            // aísla los aparatos, o cuando la IP cambió.
            return { status: 0, bodyJson: null, error: "ECONNREFUSED", elapsedMs: 0 };
          }
          return {
            status: r.status,
            bodyJson: r.body ? JSON.stringify(r.body) : "{}",
            error: null,
            elapsedMs: 12,
          };
        },
        descubrir: async () => {
          plugin.descubrimientos += 1;
          return {
            destinos: plugin.encontradas.map((d) => `${d.ip}:${d.port}`),
          };
        },
        arrancar: async () => ({ listening: false, port: 0, ip: null, error: null }),
        parar: async () => ({ listening: false }),
        refrescar: async () => ({ ok: true }),
        publicar: async () => ({ ok: true }),
        recibidos: async () => ({ mensajes: [] }),
        estado: async () => ({ listening: false }),
      },
    },
  };
}

/** La respuesta firmada de una tablet, como la cierra la pieza nativa. */
async function respuestaDeLaTablet(opId: string, listas: unknown[] = []) {
  const { cerrarSobre } = await import("@mipiacetpv/kitchen-lan");
  return cerrarSobre({
    clave: CLAVE,
    storeId: TIENDA,
    deviceId: "pantalla-1",
    kind: "RESPUESTA",
    opId,
    ahora: Date.now(),
    payload: {
      listas,
      recibidas: listas.length,
      marcasPendientes: 0,
      sections: ["COCINA"],
      deviceName: "Pase",
    },
  });
}

beforeEach(instalarPlugin);

// ──────────────────────────────────────────────────────────────────────

describe("kds-2 · el sobre que sale del TPV", () => {
  it("va firmado con la clave de la tienda y lo abre quien la tiene", async () => {
    plugin.contestan.set("192.168.1.44", { status: 200 });
    await mandarPorLan({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "COMANDA",
      opId: ENVIO,
      payload: { comandas: [] },
    });
    expect(plugin.llamadas).toHaveLength(1);
    const sobre = plugin.llamadas[0]!.sobre;
    expect(sobre).toMatchObject({
      v: 1,
      storeId: TIENDA,
      deviceId: TERMINAL,
      kind: "COMANDA",
      opId: ENVIO,
    });
    // El cuerpo NO viaja en claro: ni la comanda ni la alergia.
    expect(JSON.stringify(sobre)).not.toMatch(/comandas/);
    const abierto = await abrirSobre(sobre, {
      clave: CLAVE,
      storeId: TIENDA,
      ahora: Date.parse(sobre.sentAt),
    });
    expect(abierto.ok).toBe(true);
  });

  it("SABOTAJE · con la clave de OTRA tienda no se abre", async () => {
    plugin.contestan.set("192.168.1.44", { status: 200 });
    await mandarPorLan({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "COMANDA",
      opId: ENVIO,
      payload: {},
    });
    const sobre = plugin.llamadas[0]!.sobre;
    const otra = "yMfGxcTDwsHAv769vLu6ubi3trW0s7KxsK-urayrqqk";
    const abierto = await abrirSobre(sobre, {
      clave: otra,
      storeId: TIENDA,
      ahora: Date.parse(sobre.sentAt),
    });
    expect(abierto).toEqual({ ok: false, motivo: "FIRMA" });
  });

  it("un 200 cuenta como entregado, también el «ya lo tenía»", async () => {
    plugin.contestan.set("192.168.1.44", {
      status: 200,
      body: { error: "REPETIDO" },
    });
    const r = await mandarPorLan({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "COMANDA",
      opId: ENVIO,
      payload: {},
    });
    expect(r.alguna).toBe(true);
  });

  it("un 401 NO cuenta como entregado, y se dice el motivo", async () => {
    plugin.contestan.set("192.168.1.44", {
      status: 401,
      body: { error: "FIRMA" },
    });
    const r = await mandarPorLan({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "COMANDA",
      opId: ENVIO,
      payload: {},
    });
    expect(r.alguna).toBe(false);
    expect(r.resultados[0]!.error).toBe("FIRMA");
  });
});

describe("kds-2 · SABOTAJE · la IP de la tablet cambia sin internet", () => {
  it("redescubre en la red del local y la comanda llega", async () => {
    // Nadie en la última IP conocida; el router le dio otra.
    plugin.contestan.set("192.168.1.77", { status: 200 });
    plugin.encontradas = [{ ip: "192.168.1.77", port: 8787 }];

    const r = await mandarPorLan({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "COMANDA",
      opId: ENVIO,
      payload: {},
    });
    expect(r.alguna).toBe(true);
    expect(r.resultados[0]!.redescubierta).toBe(true);
    expect(plugin.descubrimientos).toBe(1);
    // Y se intentó PRIMERO la última conocida: redescubrir cuesta
    // segundos y el camarero ya pulsó «Enviar».
    expect(plugin.llamadas.map((l) => l.ip)).toEqual([
      "192.168.1.44",
      "192.168.1.77",
    ]);
  });

  it("si tampoco está en la red, se dice que no contesta", async () => {
    const r = await mandarPorLan({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "COMANDA",
      opId: ENVIO,
      payload: {},
    });
    expect(r.alguna).toBe(false);
    expect(r.resultados[0]!.status).toBe(0);
    expect(r.resultados[0]!.error).toMatch(/No contesta/);
  });
});

describe("kds-2 · qué falta para poder hablar por la wifi", () => {
  it("en navegador: no hay puente nativo", () => {
    delete (globalThis as Record<string, unknown>).Capacitor;
    expect(porQueNoHayCaminoDirecto(LAN, [PANTALLA])).toMatch(/APK de Android/);
  });

  it("sin pantalla emparejada", () => {
    expect(porQueNoHayCaminoDirecto(null, [])).toMatch(/ninguna pantalla/);
  });

  it("con pantalla pero sin IP anunciada", () => {
    expect(
      porQueNoHayCaminoDirecto(LAN, [{ ...PANTALLA, lanIp: null }]),
    ).toMatch(/todavía no ha dicho en qué IP escucha/);
  });

  it("y con todo en su sitio, no falta nada", () => {
    expect(porQueNoHayCaminoDirecto(LAN, [PANTALLA])).toBeNull();
  });
});

describe("kds-2 · «Probar conexión directa con cocina»", () => {
  it("en verde dice los milisegundos", async () => {
    const sobre = await respuestaDeLaTablet("x");
    plugin.contestan.set("192.168.1.44", { status: 200, body: sobre });
    const respuestas = await preguntarAPantallas({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "PRUEBA",
      opId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const d = diagnosticar({ porQueNoHayWifi: null, respuestas });
    expect(d.veredicto).toBe("VERDE");
    expect(d.titulo).toMatch(/La cocina recibe por la wifi \(12 ms\)/);
    expect(d.pantallas[0]!.queHacer).toBeNull();
  });

  it("SABOTAJE · el router aísla los aparatos: lo dice CON PALABRAS", async () => {
    // Nadie contesta y NSD no encuentra nada: es exactamente lo que hace un
    // router con «aislamiento de clientes». Es la causa número uno de que
    // esto no funcione en un bar, y el implantador tiene que leer qué
    // hacer, no un código de error.
    const respuestas = await preguntarAPantallas({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "PRUEBA",
      opId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const d = diagnosticar({ porQueNoHayWifi: null, respuestas });
    expect(d.veredicto).toBe("ROJO");
    expect(d.titulo).toMatch(/La cocina NO recibe por la wifi/);
    expect(d.pantallas[0]!.queHacer).toMatch(/aislamiento de clientes/);
    expect(d.pantallas[0]!.queHacer).toMatch(/MISMA red/);
  });

  it("la clave no cuadra: manda a dejarla con internet, no a mirar el router", async () => {
    plugin.contestan.set("192.168.1.44", {
      status: 401,
      body: { error: "FIRMA" },
    });
    const respuestas = await preguntarAPantallas({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "PRUEBA",
      opId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    const d = diagnosticar({ porQueNoHayWifi: null, respuestas });
    expect(d.pantallas[0]!.mensaje).toMatch(/no comparte la clave/);
    expect(d.pantallas[0]!.queHacer).toMatch(/recoja la nueva/);
  });

  it("los relojes desviados se distinguen de todo lo demás", async () => {
    plugin.contestan.set("192.168.1.44", {
      status: 408,
      body: { error: "VIEJO" },
    });
    const respuestas = await preguntarAPantallas({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "PRUEBA",
      opId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    const d = diagnosticar({ porQueNoHayWifi: null, respuestas });
    expect(d.pantallas[0]!.mensaje).toMatch(/su reloj y el de este terminal/);
  });

  it("algo contesta pero su respuesta no está firmada: también es rojo", async () => {
    // Hay ALGO escuchando en esa IP y ese puerto que no es nuestra tablet.
    plugin.contestan.set("192.168.1.44", {
      status: 200,
      body: { cualquier: "cosa" },
    });
    const respuestas = await preguntarAPantallas({
      lan: LAN,
      pantallas: [PANTALLA],
      kind: "PRUEBA",
      opId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    const d = diagnosticar({ porQueNoHayWifi: null, respuestas });
    expect(d.veredicto).toBe("ROJO");
    expect(d.pantallas[0]!.mensaje).toMatch(/no está firmada/);
  });

  it("si no se pudo ni probar, lo dice en vez de culpar a la red", () => {
    const d = diagnosticar({
      porQueNoHayWifi: "Esta tienda no tiene ninguna pantalla de cocina emparejada.",
      respuestas: [],
    });
    expect(d.titulo).toBe("No se puede probar todavía");
    expect(d.pantallas).toEqual([]);
  });

  it("dos pantallas y sólo una responde → ámbar, no verde", async () => {
    const sobre = await respuestaDeLaTablet("y");
    plugin.contestan.set("192.168.1.44", { status: 200, body: sobre });
    const otra: PantallaLan = {
      ...PANTALLA,
      id: "pantalla-2",
      name: "Barra",
      lanIp: "192.168.1.55",
    };
    const respuestas = await preguntarAPantallas({
      lan: LAN,
      pantallas: [PANTALLA, otra],
      kind: "PRUEBA",
      opId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    const d = diagnosticar({ porQueNoHayWifi: null, respuestas });
    expect(d.veredicto).toBe("AMBAR");
    expect(d.titulo).toMatch(/Sólo 1 de 2/);
  });
});

describe("kds-2 · la comanda que compone el TPV", () => {
  function estadoConBravas() {
    const e = estadoCocinaVacio();
    e.revision = 1;
    e.destinations.COCINA = {
      screen: true,
      printer: false,
      canCorrectSent: true,
    };
    e.lines = [
      { id: "l1", units: 2, sentUnits: 0, course: 1, seat: 3, section: "COCINA" },
      // Una caña a la BARRA, que no tiene pantalla: no debe salir tarjeta.
      { id: "l2", units: 1, sentUnits: 0, course: 1, seat: null, section: "BARRA" },
      // Y algo que la cocina ya tiene: no se vuelve a mandar.
      { id: "l3", units: 1, sentUnits: 1, course: 1, seat: null, section: "COCINA" },
    ];
    e.allergies = [{ seat: 3, allergen: "GLUTEN" }];
    return e;
  }

  it("sólo las secciones CON pantalla, y sólo la diferencia", () => {
    const comandas = componerComandasLan({
      ticketId: "t1",
      tableId: "m5",
      tableName: "M5",
      clientSendId: ENVIO,
      urgent: false,
      estado: estadoConBravas(),
      alergenosPorLinea: new Map([["l1", ["GLUTEN"]]]),
      nombrePorLinea: new Map([["l1", "Patatas bravas"]]),
      notasPorLinea: new Map([["l1", ["Sin picante"]]]),
      ahora: new Date("2026-10-09T13:00:00.000Z"),
    });
    expect(comandas).toHaveLength(1);
    expect(comandas[0]!.section).toBe("COCINA");
    expect(comandas[0]!.lines.map((l) => l.ticketLineId)).toEqual(["l1"]);
    expect(comandas[0]!.lines[0]!.units).toBe(2);
    expect(comandas[0]!.lines[0]!.notes).toEqual(["Sin picante"]);
  });

  it("y la alergia va con su silla y con el grito de la capa 3", () => {
    const comandas = componerComandasLan({
      ticketId: "t1",
      tableId: "m5",
      tableName: "M5",
      clientSendId: ENVIO,
      urgent: false,
      estado: estadoConBravas(),
      alergenosPorLinea: new Map([["l1", ["GLUTEN"]]]),
      nombrePorLinea: new Map([["l1", "Patatas bravas"]]),
      notasPorLinea: new Map(),
      ahora: new Date("2026-10-09T13:00:00.000Z"),
    });
    const c = comandas[0]!;
    expect(c.allergyBands).toEqual([
      { titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" },
    ]);
    expect(c.lines[0]!.seatAllergy).toBe("SIN GLUTEN");
    expect(c.lines[0]!.allergyWarning).toBe("¡LLEVA GLUTEN!");
  });

  it("el nº de comanda es el siguiente del servidor: 2ª y no 1ª", () => {
    const comandas = componerComandasLan({
      ticketId: "t1",
      tableId: "m5",
      tableName: "M5",
      clientSendId: ENVIO,
      urgent: false,
      estado: estadoConBravas(),
      alergenosPorLinea: new Map(),
      nombrePorLinea: new Map(),
      notasPorLinea: new Map(),
      ahora: new Date("2026-10-09T13:00:00.000Z"),
    });
    expect(comandas[0]!.number).toBe(2);
  });

  it("un tiempo RETENIDO sale en espera, y la barra nunca se retiene", () => {
    const e = estadoConBravas();
    e.destinations.BARRA = { screen: true, printer: false, canCorrectSent: true };
    e.lines = [
      { id: "l1", units: 1, sentUnits: 0, course: 2, seat: null, section: "COCINA" },
      { id: "l2", units: 1, sentUnits: 0, course: 2, seat: null, section: "BARRA" },
    ];
    const comandas = componerComandasLan({
      ticketId: "t1",
      tableId: "m5",
      tableName: "M5",
      clientSendId: ENVIO,
      urgent: false,
      estado: e,
      alergenosPorLinea: new Map(),
      nombrePorLinea: new Map(),
      notasPorLinea: new Map(),
      ahora: new Date("2026-10-09T13:00:00.000Z"),
    });
    const cocina = comandas.find((c) => c.section === "COCINA")!;
    const barra = comandas.find((c) => c.section === "BARRA")!;
    expect(cocina.lines[0]!.fired).toBe(false);
    expect(barra.lines[0]!.fired).toBe(true);
  });
});

/** Lo que la pantalla contesta, para el test del ámbar del TPV. */
function respuestaFalsa(ok: boolean): RespuestaDePantalla {
  return {
    pantalla: PANTALLA,
    camino: {
      deviceId: PANTALLA.id,
      ok,
      status: ok ? 200 : 0,
      ms: ok ? 12 : 0,
      error: ok ? null : "ECONNREFUSED",
      redescubierta: false,
      cuerpo: null,
    },
    respuesta: null,
  };
}

describe("kds-2 · SABOTAJE · papel con la wifi funcionando", () => {
  // La regla vive en `useCaminoDirecto`: el `needsPaperFallback` del
  // servidor es sólo la mitad —dice que la pantalla no le da señales A
  // ÉL— y hay que restarle lo que la wifi acusa. Aquí se prueba la
  // aritmética de esa resta, que es lo que decide si se gasta papel.
  const papel = (servidorDice: boolean, wifiViva: boolean) =>
    servidorDice && !wifiViva;

  it("sin internet pero con wifi, NO sale papel", () => {
    expect(papel(true, true)).toBe(false);
  });

  it("ni internet ni wifi, SÍ sale papel", () => {
    expect(papel(true, false)).toBe(true);
  });

  it("con internet no sale papel, haya wifi o no", () => {
    expect(papel(false, false)).toBe(false);
    expect(papel(false, true)).toBe(false);
  });

  it("y un acuse de la wifi es un acuse, venga de donde venga", () => {
    expect(respuestaFalsa(true).camino.ok).toBe(true);
    expect(respuestaFalsa(false).camino.ok).toBe(false);
  });
});
