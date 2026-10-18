// residencia-4 (D-19, D-66) · **EL AVISO QUE TIENE QUE LLEGAR.**
//
// A quién suena, cuándo escala y qué pasa cuando alguien acusa. Fuera de
// las rutas, porque lo llaman cuatro sitios: la derivación por umbral, la
// declaración desde la puerta, la pasada de ausencias y la pasada del
// escalado.
//
// ── LA REGLA, EN TRES LÍNEAS (D-66) ─────────────────────────────────
//
//   · **N2** → `ENFERMERIA`. Si **no hay nadie de guardia en ese canal**,
//     suena en `RESPONSABLE` **al momento**; si hay alguien y no acusa en
//     los minutos del centro (5 por defecto), suena en `RESPONSABLE`
//     entonces.
//   · **N3 y N4** → los dos canales **a la vez**. No hay escalado que
//     esperar: ya han sonado los dos.
//   · **N0 y N1** → no suenan. N0 es constancia (D-27) y N1 va al relevo
//     (D-19, la velocidad lenta). Encender N1 aquí convertiría el móvil
//     de guardia en un aparato que suena ochenta veces por turno y que
//     nadie mira, que es la forma más segura de que un N2 pase
//     desapercibido.
//
// Los minutos y los destinatarios son configuración del centro (rama de
// controles §10), con esos valores por defecto. El MOTOR —que exista un
// escalado, que el acuse sea una firma, que no se cancele el primero— es
// del producto y no se toca.
//
// ── EL ESCALADO NO ES UN `setTimeout` ───────────────────────────────
//
// Es una columna (`guard_alerts.escalate_at`) con su índice parcial, y
// una pasada que pregunta «¿qué avisos sin acusar tienen la hora
// pasada?». Un temporizador en memoria se pierde al reiniciar la API, y
// un aviso que no escala porque alguien desplegó es exactamente lo que
// este bloque existe para evitar.
//
// ── Y EL PRIMERO NO SE CANCELA AL ESCALAR ───────────────────────────
//
// Cuando el de enfermería se agota, el de responsable se SUMA. La
// enfermera que saque el móvil treinta segundos después sigue viendo el
// aviso y lo puede acusar — y entonces la dirección ve en su móvil que ya
// va alguien. Cancelarlo habría significado que el aviso «se mueve» de
// una persona a otra, y en una residencia lo que hace falta es que vaya
// quien pueda, no quien tocaba.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  MINUTOS_DE_ESCALADO_DE_SERIE,
  canalesDe,
  type CanalDeGuardia,
  type Nivel,
} from "@mipiacetpv/residencia-plan";

/** La configuración de guardia de un centro, con lo de serie aplicado. */
export interface ConfiguracionDeGuardia {
  minutosDeEscalado: number;
  porNivel: Partial<Record<Nivel, CanalDeGuardia[]>>;
  servicio: { nombre: string; telefono: string } | null;
}

export const CONFIGURACION_DE_SERIE: ConfiguracionDeGuardia = {
  minutosDeEscalado: MINUTOS_DE_ESCALADO_DE_SERIE,
  porNivel: {},
  servicio: null,
};

/**
 * Lee la configuración del centro.
 *
 * Sin fila, **los valores de serie**. La tabla no se siembra al encender
 * el módulo a propósito: «no configurado» y «configurado igual que de
 * serie» son lo mismo para el motor.
 */
export async function configuracionDeGuardia(
  prisma: PrismaClient,
  tenantId: string,
): Promise<ConfiguracionDeGuardia> {
  const fila = await prisma.centerGuardSetting.findUnique({
    where: { tenantId },
    select: {
      escalationMinutes: true,
      levelN2Channels: true,
      levelN3Channels: true,
      levelN4Channels: true,
      healthServiceName: true,
      healthServicePhone: true,
    },
  });
  if (!fila) return CONFIGURACION_DE_SERIE;
  return {
    minutosDeEscalado: fila.escalationMinutes,
    porNivel: {
      N2: fila.levelN2Channels,
      N3: fila.levelN3Channels,
      N4: fila.levelN4Channels,
    },
    servicio:
      fila.healthServiceName && fila.healthServicePhone
        ? { nombre: fila.healthServiceName, telefono: fila.healthServicePhone }
        : null,
  };
}

/**
 * ¿Hay alguien de guardia en este canal AHORA?
 *
 * La pregunta que decide si un N2 escala al momento o a los cinco
 * minutos. La contesta `guard_shift_sessions`: alguien cogió el móvil y
 * tecleó su PIN, y no lo ha soltado (`ended_at IS NULL`).
 *
 * **No hay cuadrante** y eso es la decisión (D-66): quién está de guardia
 * no lo dice una planificación que alguien tiene que mantener, lo dice el
 * móvil que está en un bolsillo.
 */
export async function hayGuardiaEn(
  prisma: PrismaClient,
  tenantId: string,
  canal: CanalDeGuardia,
): Promise<boolean> {
  const n = await prisma.guardShiftSession.count({
    where: { tenantId, channel: canal, endedAt: null },
  });
  return n > 0;
}

/** Un aviso recién creado, para que quien llama pueda empujarlo por
 *  socket sin volver a leerlo. */
export interface AvisoCreado {
  id: string;
  canal: CanalDeGuardia;
  nivel: Nivel;
  incidentId: string;
  escalatedFromId: string | null;
}

/**
 * **Hace sonar lo que tenga que sonar** para una incidencia de este
 * nivel.
 *
 * Idempotente por construcción: el índice único `(incident_id, channel)`
 * del motor impide dos avisos del mismo canal para la misma incidencia,
 * así que reenviar el mismo lote o derivar dos veces la misma medida **no
 * hace sonar dos veces**. Y cuando el nivel SUBE —de N2 a N3— lo que
 * pasa es que se añade el canal que faltaba, no que se repita el que ya
 * estaba.
 *
 * `queuedAt` es **cuándo lo apuntó la tablet**, no cuándo llegó aquí. Un
 * aviso que sale con dos horas de retraso suena igual, con su hora
 * original y su retraso a la vista (alcance 8, «sin red no se finge»).
 */
export async function avisar(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    incidentId: string;
    nivel: Nivel;
    queuedAt: Date;
    ahora: Date;
    config: ConfiguracionDeGuardia;
  },
): Promise<AvisoCreado[]> {
  const canales = canalesDe(input.nivel, input.config.porNivel);
  if (canales.length === 0) return [];

  const yaHay = await prisma.guardAlert.findMany({
    where: { incidentId: input.incidentId },
    select: { channel: true },
  });
  const existentes = new Set(yaHay.map((a) => a.channel));

  const creados: AvisoCreado[] = [];
  for (const canal of canales) {
    if (existentes.has(canal)) continue;

    // ── ¿Escala este aviso, y cuándo? ──────────────────────────────
    //
    // Sólo el de enfermería escala, y sólo si el de responsable no va a
    // salir ya. Tres casos:
    //
    //   1. los dos canales a la vez (N3/N4) → no hay nada a lo que
    //      escalar;
    //   2. enfermería sola y **hay alguien de guardia** → se le dan los
    //      minutos del centro;
    //   3. enfermería sola y **no hay nadie** → no se espera: el de
    //      responsable sale AHORA, en este mismo bucle.
    let escalateAt: Date | null = null;
    if (canal === "ENFERMERIA" && !canales.includes("RESPONSABLE")) {
      const hayAlguien = await hayGuardiaEn(prisma, input.tenantId, canal);
      if (hayAlguien) {
        escalateAt = new Date(
          input.ahora.getTime() + input.config.minutosDeEscalado * 60_000,
        );
      }
    }

    const creado = await prisma.guardAlert.create({
      data: {
        tenantId: input.tenantId,
        incidentId: input.incidentId,
        channel: canal,
        severity: input.nivel,
        state: "PENDING",
        queuedAt: input.queuedAt,
        escalateAt,
      },
      select: { id: true },
    });
    existentes.add(canal);
    creados.push({
      id: creado.id,
      canal,
      nivel: input.nivel,
      incidentId: input.incidentId,
      escalatedFromId: null,
    });

    // Caso 3: nadie de guardia en enfermería. El de responsable sale al
    // momento, encadenado al primero para que se lea de un vistazo por
    // qué salió. Y el de enfermería queda `ESCALATED` —sin cancelarse—:
    // si la enfermera aparece y lo acusa, sigue valiendo.
    if (canal === "ENFERMERIA" && escalateAt == null && !canales.includes("RESPONSABLE")) {
      const siguiente = await prisma.guardAlert.create({
        data: {
          tenantId: input.tenantId,
          incidentId: input.incidentId,
          channel: "RESPONSABLE",
          severity: input.nivel,
          state: "PENDING",
          queuedAt: input.queuedAt,
          escalateAt: null,
          escalatedFromId: creado.id,
        },
        select: { id: true },
      });
      await prisma.guardAlert.update({
        where: { id: creado.id },
        data: { state: "ESCALATED" },
      });
      existentes.add("RESPONSABLE");
      creados.push({
        id: siguiente.id,
        canal: "RESPONSABLE",
        nivel: input.nivel,
        incidentId: input.incidentId,
        escalatedFromId: creado.id,
      });
    }
  }

  if (creados.length > 0) {
    // «Ya se avisó», en la incidencia. Sólo la primera vez: el instante
    // que interesa es cuándo salió el PRIMER aviso, no el último.
    await prisma.incident.updateMany({
      where: { id: input.incidentId, alertedAt: null },
      data: { alertedAt: input.ahora },
    });
  }
  return creados;
}

/**
 * **LA PASADA DEL ESCALADO.** Los avisos sin acusar cuya hora ya pasó.
 *
 * Global y no por tenant, igual que el corte de día (`shift-day-cut`):
 * la consulta sale del índice parcial y cada aviso lleva su tenant
 * dentro. Un repeatable por centro habría significado registrar y
 * desregistrar un job al encender y apagar el módulo.
 *
 * Qué hace con cada uno: crea el de `RESPONSABLE` —si no existe ya— y
 * marca el de enfermería como `ESCALATED`. **No lo cancela** (ver la
 * cabecera del fichero).
 */
export async function pasadaDeEscalado(
  prisma: PrismaClient,
  ahora: Date = new Date(),
): Promise<AvisoCreado[]> {
  const porEscalar = await prisma.guardAlert.findMany({
    where: {
      state: { in: ["PENDING", "DELIVERED"] },
      escalateAt: { not: null, lte: ahora },
    },
    select: {
      id: true,
      tenantId: true,
      incidentId: true,
      severity: true,
      queuedAt: true,
      channel: true,
    },
    // Acotado: si algo se atascara, lo que no se puede es que una pasada
    // tarde media hora y la siguiente se solape. Los que queden entran en
    // la pasada siguiente, que es un minuto después.
    take: 200,
  });

  const creados: AvisoCreado[] = [];
  for (const a of porEscalar) {
    const yaHay = await prisma.guardAlert.findFirst({
      where: { incidentId: a.incidentId, channel: "RESPONSABLE" },
      select: { id: true },
    });
    if (!yaHay) {
      const siguiente = await prisma.guardAlert.create({
        data: {
          tenantId: a.tenantId,
          incidentId: a.incidentId,
          channel: "RESPONSABLE",
          severity: a.severity,
          state: "PENDING",
          // La hora ORIGINAL, no la de ahora: el móvil de la dirección
          // tiene que ver que esto se apuntó hace cinco minutos.
          queuedAt: a.queuedAt,
          escalateAt: null,
          escalatedFromId: a.id,
        },
        select: { id: true },
      });
      creados.push({
        id: siguiente.id,
        canal: "RESPONSABLE",
        nivel: a.severity,
        incidentId: a.incidentId,
        escalatedFromId: a.id,
      });
    }
    // `escalate_at` a NULL para que la pasada siguiente no lo vuelva a
    // mirar. Sin eso, el índice parcial lo devolvería cada minuto hasta
    // que alguien lo acusara.
    await prisma.guardAlert.update({
      where: { id: a.id },
      data: { state: "ESCALATED", escalateAt: null },
    });
  }
  return creados;
}

/**
 * Los avisos que este móvil tiene que enseñar AHORA.
 *
 * Los de su canal, sin acusar y sin cancelar. Incluye los `ESCALATED`:
 * un aviso que escaló sigue siendo un aviso para el canal que lo recibió
 * primero, y esconderlo sería decirle a la enfermera que ya no es cosa
 * suya cuando la dirección puede estar en su casa.
 */
export async function avisosVivos(
  prisma: PrismaClient,
  tenantId: string,
  canal: CanalDeGuardia,
) {
  return prisma.guardAlert.findMany({
    where: {
      tenantId,
      channel: canal,
      state: { in: ["PENDING", "DELIVERED", "ESCALATED"] },
    },
    orderBy: [{ severity: "desc" }, { queuedAt: "asc" }],
    select: {
      id: true,
      channel: true,
      severity: true,
      state: true,
      queuedAt: true,
      createdAt: true,
      deliveredAt: true,
      escalatedFromId: true,
      incident: {
        select: {
          id: true,
          subject: true,
          clientId: true,
          incidentType: true,
          severity: true,
          origin: true,
          openedAt: true,
          descriptionCifrado: true,
          room: { select: { number: true, name: true } },
          client: { select: { firstName: true, lastName: true } },
          sourceRecord: {
            select: { id: true, controlCode: true, valueCifrado: true, tenantId: true },
          },
        },
      },
    },
  });
}

/**
 * **Cancela lo que quede sonando** de una incidencia que se cierra.
 *
 * Sólo lo que nadie acusó: un aviso acusado es la prueba de que alguien
 * se hizo cargo y no se toca. Y el estado es `CANCELLED` y no un borrado,
 * porque «sonó y nadie fue, y se cerró igual» es exactamente lo que una
 * auditoría quiere poder ver.
 */
export async function cancelarAvisos(
  prisma: PrismaClient,
  incidentId: string,
): Promise<number> {
  const { count } = await prisma.guardAlert.updateMany({
    where: {
      incidentId,
      state: { in: ["PENDING", "DELIVERED", "ESCALATED"] },
    },
    data: { state: "CANCELLED", escalateAt: null },
  });
  return count;
}
