// A5 · Frente 3 · los comandos que el panel le puede mandar a un terminal.
//
// ── La lista es CERRADA ───────────────────────────────────────────────────
// No hay comando genérico, no hay evaluación de código, no hay ninguna ruta
// que acepte «ejecuta esto». Lo que no está en `COMANDOS` no se manda: se
// rechaza y se audita. Un canal permanente hacia quince cajas registradoras en
// casa de clientes sólo es defendible si lo que puede viajar por él está
// escrito y es corto.
//
// ── Ningún comando toca dinero ────────────────────────────────────────────
// Nada de cerrar turnos, anular tickets, cobrar ni tocar el arqueo desde el
// panel. Si el soporte necesita eso, se hace con un humano al teléfono. Los
// seis comandos son de mirar y de sacudir: recargar, volcar logs, capturar
// pantalla, forzar la subida de la cola, reiniciar la app y decir la versión.
//
// ── Sin registro no hay comando ───────────────────────────────────────────
// La auditoría se escribe ANTES de enviar nada. Si falla, el comando no sale.
// Es lo contrario del criterio de A3 para las descargas (allí el contador ya
// se había gastado y el instalador estaba delante de un cliente): aquí no hay
// nada consumido todavía y lo que está en juego es mirar la pantalla de un
// negocio ajeno. Sin traza, no se mira.
//
// Se escriben DOS trazas por comando, no una: `device_command` con quién, qué,
// a qué terminal y con qué motivo, antes de mandarlo; y `device_command_result`
// con lo que pasó. Con una sola escrita al final, un comando que no vuelve no
// dejaría ni rastro — y ese es exactamente el que hay que poder investigar.

import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { getDeviceChannelRegistry } from "./channel-registry.js";
import {
  extractRequestSignals,
  writeAudit,
  type RequestSignals,
} from "../superadmin/audit.js";

/**
 * La lista blanca. Añadir uno es un cambio de código con su revisión, su test
 * y su entrada en el done-doc; nunca configuración ni un string que llegue por
 * el body.
 */
export const COMANDOS = [
  /** Recarga el WebView. Lo primero que se prueba cuando «se ha quedado raro». */
  "recargar",
  /** Devuelve los últimos logs del terminal (consola del WebView + logcat propio). */
  "volcar-logs",
  /** Captura de la ventana de nuestra propia app. Frente 4. */
  "captura-de-pantalla",
  /** Fuerza el vaciado de la cola offline sin esperar al ciclo de 15 s. */
  "forzar-sync",
  /** Reinicia la app (no el terminal). La cola vive en IndexedDB y sobrevive. */
  "reiniciar-app",
  /** Pide una instantánea de estado ya, sin esperar al siguiente latido. */
  "decir-version",
] as const;

export type Comando = (typeof COMANDOS)[number];

export function esComandoConocido(value: string): value is Comando {
  return (COMANDOS as readonly string[]).includes(value);
}

/**
 * Cuánto se espera a que el terminal conteste.
 *
 * Un comando que no vuelve tiene que verse como que no volvió, no quedarse en
 * «enviando» para siempre. 25 s es holgado para un WebView ocupado en una hora
 * punta y corto para que quien está al teléfono no se quede colgado.
 */
export const COMMAND_TIMEOUT_MS = 25_000;

export type ResultadoComando =
  | { estado: "ok"; datos: unknown }
  | { estado: "error"; mensaje: string }
  | { estado: "sin-respuesta" };

interface Pendiente {
  deviceId: string;
  resolver: (r: ResultadoComando) => void;
  timer: NodeJS.Timeout;
}

const pendientes = new Map<string, Pendiente>();

/**
 * Encaja el resultado que manda el terminal con el comando que lo espera.
 *
 * Comprueba que el `commandId` sea de ESE device: un terminal no puede
 * contestar por otro, ni siquiera por error de versión. Un id desconocido (por
 * ejemplo, el de un comando que ya expiró) se ignora en silencio.
 */
export function resolverComando(
  deviceId: string,
  commandId: string,
  resultado: ResultadoComando,
): boolean {
  const p = pendientes.get(commandId);
  if (!p || p.deviceId !== deviceId) return false;
  clearTimeout(p.timer);
  pendientes.delete(commandId);
  p.resolver(resultado);
  return true;
}

/** Sólo para tests: no deja timers colgados entre casos. */
export function __resetComandosForTests(): void {
  for (const p of pendientes.values()) clearTimeout(p.timer);
  pendientes.clear();
}

export class ComandoRechazado extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface EnviarComandoParams {
  prisma: PrismaClient | Prisma.TransactionClient;
  superAdminId: string;
  deviceId: string;
  tenantId: string;
  /** Lo que llegó por el body. Puede NO ser un comando conocido: se valida aquí. */
  accion: string;
  /** Por qué. Obligatorio: un comando sin motivo no se puede revisar después. */
  motivo: string;
  signals: RequestSignals;
  timeoutMs?: number;
}

export interface ComandoEnviado {
  commandId: string;
  accion: Comando;
  resultado: ResultadoComando;
}

/**
 * Manda un comando a un terminal y espera su resultado.
 *
 * Orden deliberado: validar la lista blanca → comprobar que hay canal →
 * auditar → enviar. Auditar antes de enviar es lo que hace cierta la frase
 * «sin registro no hay comando»; comprobar el canal antes de auditar evita
 * llenar el registro de intentos contra terminales apagados, que no son un
 * acceso a nada.
 */
export async function enviarComando(
  params: EnviarComandoParams,
): Promise<ComandoEnviado> {
  const { prisma, superAdminId, deviceId, tenantId, accion, motivo, signals } =
    params;

  if (!esComandoConocido(accion)) {
    // Un comando desconocido SÍ se audita, aunque no llegue a salir: alguien
    // ha intentado mandar algo que no está en la lista, y eso es exactamente
    // lo que hay que poder ver después.
    await writeAudit({
      prisma,
      superAdminId,
      action: "device_command_rejected",
      tenantId,
      metadata: {
        ...signals,
        deviceId,
        accionSolicitada: accion.slice(0, 120),
        motivo: "comando fuera de la lista blanca",
      },
    });
    throw new ComandoRechazado(
      "COMANDO_DESCONOCIDO",
      "Ese comando no está en la lista blanca.",
    );
  }

  const registry = getDeviceChannelRegistry();
  const canal = registry.get(deviceId);
  if (!canal) {
    throw new ComandoRechazado(
      "TERMINAL_OFFLINE",
      "El terminal no tiene canal abierto ahora mismo.",
      409,
    );
  }

  const commandId = randomUUID();

  // ANTES de enviar. Si esto lanza, el comando no sale.
  await writeAudit({
    prisma,
    superAdminId,
    action: "device_command",
    tenantId,
    metadata: { ...signals, deviceId, commandId, accion, motivo },
  });

  const timeoutMs = params.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const espera = new Promise<ResultadoComando>((resolve) => {
    const timer = setTimeout(() => {
      pendientes.delete(commandId);
      resolve({ estado: "sin-respuesta" });
    }, timeoutMs);
    pendientes.set(commandId, { deviceId, resolver: resolve, timer });
  });

  if (!canal.send({ type: "command", commandId, action: accion })) {
    // El socket se cayó entre el `get` y el `send`. Se resuelve ya en vez de
    // esperar 25 s a un terminal que sabemos que no está.
    resolverComando(deviceId, commandId, {
      estado: "error",
      mensaje: "el canal se cerró al enviar",
    });
  }

  const resultado = await espera;

  await writeAudit({
    prisma,
    superAdminId,
    action: "device_command_result",
    tenantId,
    metadata: {
      ...signals,
      deviceId,
      commandId,
      accion,
      resultado: resultado.estado,
    },
  });

  return { commandId, accion, resultado };
}

export { extractRequestSignals };
