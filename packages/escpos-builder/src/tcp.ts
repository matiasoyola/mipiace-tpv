// v1.4-Impresoras-Fase-1 Lote 2 · cliente TCP para impresoras WIFI.
//
// La impresora ESC/POS escucha en :9100 (raw socket). Abrimos TCP,
// drenamos el binary y cerramos. La impresora no devuelve ACK
// aplicativo; consideramos éxito si el FIN se entrega limpio.
//
// El timeout aplica a la fase de conexión + escritura: la mayoría de
// pilotos tiene la impresora en la misma LAN (latencia < 50ms), así
// que 5s default es generoso. Si está apagada o la IP cambió, la
// promise rechaza con `Timeout TCP` o `ECONNREFUSED`.

import net from "node:net";

export interface SendOverTcpOptions {
  host: string;
  port: number;
  timeoutMs: number;
  payload: Uint8Array;
}

export async function sendOverTcp(opts: SendOverTcpOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(opts.timeoutMs);
    socket.once("timeout", () => finish(new Error("Timeout TCP")));
    socket.once("error", (err) => finish(err));
    socket.once("close", () => finish());
    socket.connect(opts.port, opts.host, () => {
      socket.write(Buffer.from(opts.payload), (writeErr) => {
        if (writeErr) {
          finish(writeErr);
          return;
        }
        socket.end();
      });
    });
  });
}
