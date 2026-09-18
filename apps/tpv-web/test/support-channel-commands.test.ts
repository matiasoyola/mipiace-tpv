// A5 · Frentes 3 y 4 · el lado terminal de los comandos.
//
// La lista blanca vive en el servidor y se repite aquí a propósito: una APK
// vieja no debe ejecutar un comando que se inventó después, y un servidor
// comprometido no debe poder pedirle al terminal nada que no esté escrito en su
// propio binario.
//
// Lo que se prueba: que un comando desconocido NO ejecuta nada, que ninguno de
// los seis toca dinero, y que el aviso de captura se pinta de verdad — porque
// es lo que permite que un cliente vea cuándo hemos mirado su pantalla.

import { beforeEach, describe, expect, it, vi } from "vitest";

const flushOutbox = vi.fn(async () => {});
const outboxCounts = vi.fn(async () => ({ pending: 2, rejected: 0 }));

vi.mock("../src/lib/outbox.js", () => ({
  flushOutbox,
  outboxCounts,
}));

vi.mock("../src/lib/supportChannel/status.js", () => ({
  collectDeviceStatus: async () => ({ bundleBuildHash: "a1b2c3d" }),
}));

const captureOwnWindow = vi.fn(async () => null as unknown);
const readSupportAgentLogs = vi.fn(async () => ({
  logcat: "I mipiacetpv: linea",
  error: null,
}));
const restartApp = vi.fn(async () => true);

vi.mock("../src/platform/SupportAgent.js", () => ({
  captureOwnWindow,
  readSupportAgentLogs,
  restartApp,
}));

const { ejecutarComando } = await import("../src/lib/supportChannel/commands.js");
const { mostrarAvisoCaptura } = await import("../src/lib/supportChannel/aviso.js");
const { appendLogLine, readLogBuffer, __resetLogBufferForTests, LOG_BUFFER_MAX_LINES } =
  await import("../src/lib/supportChannel/logBuffer.js");

beforeEach(() => {
  vi.clearAllMocks();
  __resetLogBufferForTests();
  document.body.innerHTML = "";
});

describe("ejecutarComando · la lista blanca del terminal", () => {
  it("un comando que este binario no conoce NO ejecuta nada", async () => {
    const r = await ejecutarComando("borrar-turno");
    expect(r.resultado.ok).toBe(false);
    expect(r.despues).toBeUndefined();
    expect(flushOutbox).not.toHaveBeenCalled();
    expect(captureOwnWindow).not.toHaveBeenCalled();
    expect(restartApp).not.toHaveBeenCalled();
  });

  it("tampoco cuela nada que suene a ejecutar código", async () => {
    for (const intento of ["eval", "exec", "sh -c ls", "__proto__", "toString"]) {
      const r = await ejecutarComando(intento);
      expect(r.resultado.ok, `«${intento}» no puede ejecutarse`).toBe(false);
    }
  });

  it("decir-version devuelve el estado sin tocar nada más", async () => {
    const r = await ejecutarComando("decir-version");
    expect(r.resultado).toEqual({
      ok: true,
      datos: { bundleBuildHash: "a1b2c3d" },
    });
    expect(flushOutbox).not.toHaveBeenCalled();
  });

  it("forzar-sync vacía la cola y contesta con lo que quedó", async () => {
    const r = await ejecutarComando("forzar-sync");
    expect(flushOutbox).toHaveBeenCalledTimes(1);
    expect(r.resultado).toEqual({ ok: true, datos: { pending: 2, rejected: 0 } });
  });

  it("un fallo al vaciar la cola no rompe el comando", async () => {
    flushOutbox.mockRejectedValueOnce(new Error("sin red"));
    const r = await ejecutarComando("forzar-sync");
    expect(r.resultado.ok).toBe(true);
  });

  it("volcar-logs junta consola, logcat y estado", async () => {
    appendLogLine("error", "algo se rompió");
    const r = await ejecutarComando("volcar-logs");
    expect(r.resultado.ok).toBe(true);
    const datos = (r.resultado as { datos: any }).datos;
    expect(datos.logcat).toContain("mipiacetpv");
    expect(datos.consola.at(-1).text).toBe("algo se rompió");
    expect(datos.estado).toEqual({ bundleBuildHash: "a1b2c3d" });
  });

  it("recargar y reiniciar-app contestan ANTES de irse", async () => {
    // Si la recarga ocurriera dentro del propio comando, la respuesta no
    // llegaría nunca y el panel pintaría "no volvió" en los dos comandos que
    // sí funcionaron.
    const recargar = await ejecutarComando("recargar");
    expect(recargar.resultado.ok).toBe(true);
    expect(typeof recargar.despues).toBe("function");

    const reiniciar = await ejecutarComando("reiniciar-app");
    expect(reiniciar.resultado.ok).toBe(true);
    expect(restartApp, "no se reinicia hasta que el `despues` se dispara").not
      .toHaveBeenCalled();
    reiniciar.despues!();
    expect(restartApp).toHaveBeenCalledTimes(1);
  });
});

describe("ejecutarComando · captura de pantalla", () => {
  it("fuera de la APK contesta que no puede, sin inventarse una imagen", async () => {
    const r = await ejecutarComando("captura-de-pantalla");
    expect(r.resultado.ok).toBe(false);
    expect(document.body.textContent).toBe("");
  });

  it("al capturar, el terminal AVISA de que se ha mirado", async () => {
    captureOwnWindow.mockResolvedValueOnce({
      pngBase64: "iVBORw0KGgo=",
      width: 1280,
      height: 800,
    });
    const r = await ejecutarComando("captura-de-pantalla");
    expect(r.resultado.ok).toBe(true);
    // Que un cliente pueda ver cuándo hemos mirado su pantalla no es una
    // concesión: es lo que separa esto de una cámara oculta en la barra.
    expect(document.body.textContent).toContain("captura de esta pantalla");
  });
});

describe("mostrarAvisoCaptura", () => {
  it("no captura toques: un camarero a media comanda tiene que poder pulsar", () => {
    mostrarAvisoCaptura(1_000);
    const el = document.getElementById("mipiacetpv-aviso-captura")!;
    expect(el.style.pointerEvents).toBe("none");
  });

  it("desaparece solo", async () => {
    mostrarAvisoCaptura(20);
    expect(document.getElementById("mipiacetpv-aviso-captura")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(document.getElementById("mipiacetpv-aviso-captura")).toBeNull();
  });

  it("dos capturas seguidas no dejan dos avisos apilados", () => {
    mostrarAvisoCaptura(1_000);
    mostrarAvisoCaptura(1_000);
    expect(
      document.querySelectorAll("#mipiacetpv-aviso-captura"),
    ).toHaveLength(1);
  });
});

describe("logBuffer", () => {
  it("es un anillo: no crece sin freno en una caja que lleva semanas encendida", () => {
    for (let i = 0; i < LOG_BUFFER_MAX_LINES + 50; i += 1) {
      appendLogLine("log", `linea ${i}`);
    }
    const lineas = readLogBuffer();
    expect(lineas).toHaveLength(LOG_BUFFER_MAX_LINES);
    expect(lineas[0]!.text).toBe("linea 50");
    expect(lineas.at(-1)!.text).toBe(`linea ${LOG_BUFFER_MAX_LINES + 49}`);
  });

  it("recorta las líneas enormes en vez de tragárselas enteras", () => {
    appendLogLine("error", "x".repeat(5_000));
    expect(readLogBuffer()[0]!.text.length).toBeLessThan(1_100);
    expect(readLogBuffer()[0]!.text).toContain("[recortado]");
  });
});
