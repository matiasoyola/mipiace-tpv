// A3-distribución · Frentes 3 y 4 · API de releases y descarga de la APK.
//
// Dos superficies muy distintas en el mismo módulo:
//
//   /super-admin/releases*  → sesión de super-admin. Lista, emite códigos y
//                             descarga directa (para el Mac de Matías).
//   /apk*                   → PÚBLICO, sin sesión. La página del formulario,
//                             la descarga por código y latest.json.
//
// Un usuario sin código y sin sesión no puede descargar NI ENUMERAR nada: la
// única superficie pública que revela algo es /apk/latest.json, y sólo dice
// qué versión existe (decisión 4 del bloque) — nunca dónde está el binario.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { forgiveFailure, inspect, registerFailure } from "../auth/rate-limit.js";
import { getPrisma } from "../context.js";
import { extractRequestSignals, writeAudit } from "../superadmin/audit.js";
import { requireSuperAdmin } from "../superadmin/middleware.js";

import {
  consumeDownloadCode,
  createDownloadCode,
  peekDownloadCode,
} from "./codes.js";
import { renderApkPage, type ApkPageError } from "./page.js";
import { apkDownloadRateLimit } from "./rate-limit.js";
import {
  findRelease,
  latestRelease,
  openRelease,
  readReleases,
  releaseFileExists,
  toPublicMeta,
  type ReleaseEntry,
} from "./store.js";

/** Cabeceras del binario. */
function sendApk(
  reply: FastifyReply,
  opened: { stream: NodeJS.ReadableStream; size: number; fileName: string },
): FastifyReply {
  return reply
    .header("Content-Type", "application/vnd.android.package-archive")
    .header(
      "Content-Disposition",
      `attachment; filename="${opened.fileName}"`,
    )
    // Content-Length real y SIN compresión: un APK ya es un zip, comprimirlo
    // no gana nada y rompe el Content-Length que Android usa para pintar la
    // barra de progreso de la descarga.
    .header("Content-Length", String(opened.size))
    .header("Cache-Control", "no-store")
    .header("Content-Encoding", "identity")
    .send(opened.stream);
}

function clientIp(request: FastifyRequest): string {
  // `request.ip` con trustProxy:1 es el salto real que añade Caddy, no el
  // primer token falsificable de X-Forwarded-For.
  return request.ip || "desconocida";
}

async function renderPage(
  reply: FastifyReply,
  error?: ApkPageError,
  code = 200,
): Promise<FastifyReply> {
  const latest = await latestRelease();
  return reply
    .code(code)
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Cache-Control", "no-store")
    .send(renderApkPage({ latest: latest ? toPublicMeta(latest) : null, error }));
}

export async function registerReleasesRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── Super-admin ─────────────────────────────────────────────────────────

  app.get(
    "/super-admin/releases",
    { preHandler: requireSuperAdmin },
    async (_request, reply) => {
      const releases = await readReleases();
      const prisma = getPrisma();
      const now = new Date();

      // Códigos vivos por versión, para que la consola pueda pintarlos con su
      // cuenta atrás sin una segunda llamada.
      const codes = await prisma.apkDownloadCode.findMany({
        where: { expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        select: {
          code: true,
          versionCode: true,
          createdAt: true,
          expiresAt: true,
          maxDownloads: true,
          downloadCount: true,
          note: true,
        },
      });

      return reply.send({
        releases: releases.map((r) => ({
          versionCode: r.versionCode,
          versionName: r.versionName,
          fileName: r.fileName,
          sha256: r.sha256,
          size: r.size,
          publishedAt: r.publishedAt,
          gitSha: r.gitSha,
        })),
        activeCodes: codes
          .filter((c) => c.downloadCount < c.maxDownloads)
          .map((c) => ({
            code: c.code,
            versionCode: c.versionCode,
            createdAt: c.createdAt.toISOString(),
            expiresAt: c.expiresAt.toISOString(),
            maxDownloads: c.maxDownloads,
            downloadCount: c.downloadCount,
            note: c.note,
          })),
      });
    },
  );

  app.post(
    "/super-admin/releases/:versionCode/download-codes",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["versionCode"],
          properties: { versionCode: { type: "integer" } },
        },
        body: {
          type: "object",
          properties: { note: { type: "string", maxLength: 120 } },
        },
      },
    },
    async (request, reply) => {
      const { versionCode } = request.params as { versionCode: number };
      const body = (request.body ?? {}) as { note?: string };
      const superAdminId = request.superAdmin!.superAdminId;

      const release = await findRelease(versionCode);
      if (!release) {
        return reply.code(404).send({
          error: "RELEASE_NOT_FOUND",
          message: "Esa versión no está publicada.",
        });
      }

      const prisma = getPrisma();
      const note = body.note?.trim() ? body.note.trim() : null;
      const created = await createDownloadCode({
        prisma,
        versionCode,
        superAdminId,
        note,
      });
      if (!created) {
        return reply.code(503).send({
          error: "CODE_GENERATION_FAILED",
          message: "No se pudo generar un código libre. Reinténtalo.",
        });
      }

      await writeAudit({
        prisma,
        superAdminId,
        action: "create_apk_download_code",
        tenantId: null,
        metadata: {
          ...extractRequestSignals(request),
          versionCode,
          code: created.code,
          expiresAt: created.expiresAt.toISOString(),
          maxDownloads: created.maxDownloads,
          note,
        },
      });

      return reply.code(201).send({
        code: created.code,
        versionCode,
        versionName: release.versionName,
        expiresAt: created.expiresAt.toISOString(),
        maxDownloads: created.maxDownloads,
        note,
      });
    },
  );

  app.get(
    "/super-admin/releases/:versionCode/apk",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["versionCode"],
          properties: { versionCode: { type: "integer" } },
        },
      },
    },
    async (request, reply) => {
      const { versionCode } = request.params as { versionCode: number };
      const release = await findRelease(versionCode);
      if (!release) {
        return reply.code(404).send({
          error: "RELEASE_NOT_FOUND",
          message: "Esa versión no está publicada.",
        });
      }
      const opened = await openRelease(release);
      if (!opened) {
        return reply.code(404).send({
          error: "RELEASE_FILE_MISSING",
          message: "El índice la lista pero el fichero no está en disco.",
        });
      }
      return sendApk(reply, opened);
    },
  );

  // ─── Público ─────────────────────────────────────────────────────────────

  app.get("/apk", async (_request, reply) => renderPage(reply));

  // Metadatos de la última versión. Público a propósito (decisión 4): saber
  // que existe la 1.10.2 no es un secreto, y el binario sigue detrás del
  // código. Deja la puerta abierta a que la app compruebe actualizaciones más
  // adelante sin montar autenticación para eso. NUNCA lleva URL del binario.
  app.get("/apk/latest.json", async (_request, reply) => {
    const latest = await latestRelease();
    if (!latest) {
      return reply
        .code(404)
        .header("Cache-Control", "no-store")
        .send({ error: "NO_RELEASES", message: "No hay versiones publicadas." });
    }
    return reply
      .header("Cache-Control", "no-store")
      .send(toPublicMeta(latest));
  });

  app.post("/apk", async (request, reply) => {
    const ip = clientIp(request);
    const rlKey = apkDownloadRateLimit(ip);

    const pre = await inspect(rlKey);
    if (pre.locked) {
      return renderPage(
        reply,
        {
          kind: "bloqueado",
          retryAfterMinutes: Math.ceil(pre.retryAfterSeconds / 60),
        },
        429,
      );
    }

    // El body llega como application/x-www-form-urlencoded (un <form> sin JS).
    const body = (request.body ?? {}) as Record<string, unknown>;
    const raw = typeof body.codigo === "string" ? body.codigo.trim() : "";
    const codigo = raw.replace(/\s/g, "");

    // Un código con formato imposible cuenta como intento fallido igual: si no,
    // el limitador se esquiva mandando basura entre pruebas reales.
    if (!/^\d{6}$/.test(codigo)) {
      const state = await registerFailure(rlKey);
      return renderPage(
        reply,
        state.locked
          ? {
              kind: "bloqueado",
              retryAfterMinutes: Math.ceil(state.retryAfterSeconds / 60),
            }
          : { kind: "incorrecto" },
        state.locked ? 429 : 400,
      );
    }

    const prisma = getPrisma();

    const desconocido = async (): Promise<FastifyReply> => {
      // Código inexistente: NO va a SuperAdminAudit (no hay a quién
      // atribuirlo). Log estructurado + contador del limitador, y nada más.
      const state = await registerFailure(rlKey);
      request.log.warn(
        { ip, codigoLongitud: codigo.length, evento: "apk_codigo_desconocido" },
        "intento de descarga con código inexistente",
      );
      return renderPage(
        reply,
        state.locked
          ? {
              kind: "bloqueado",
              retryAfterMinutes: Math.ceil(state.retryAfterSeconds / 60),
            }
          : { kind: "incorrecto" },
        state.locked ? 429 : 400,
      );
    };

    // El binario se COMPRUEBA antes de gastar la descarga, pero sólo con un
    // stat: no se abre nada todavía. Un código bueno que apunta a una versión
    // que ya no está en disco es un problema nuestro, no del instalador: si el
    // claim fuera primero, el 404 se llevaría por delante uno de los 3 usos
    // del código y quien está montando un terminal se quedaría con dos
    // intentos y sin APK.
    //
    // Comprobar no es abrir. Un descriptor abierto aquí sobreviviría al claim
    // y a la auditoría, y la salida que no se ve venir —una excepción de
    // Prisma en el `updateMany` o en `writeAudit`— se saltaría cualquier
    // cierre a mano y fugaría el fd. En un endpoint público eso es un goteo de
    // descriptores en el proceso que además está cobrando.
    const pendiente = await peekDownloadCode({ prisma, code: codigo });
    if (!pendiente) return desconocido();

    const release: ReleaseEntry | null = await findRelease(
      pendiente.versionCode,
    );
    if (!release || !(await releaseFileExists(release))) {
      return renderPage(reply, { kind: "sin-version" }, 404);
    }

    const result = await consumeDownloadCode({ prisma, code: codigo, ip });

    // Carrera improbable: el código existía en el peek y ya no (lo borró la
    // emisión de otro código al reciclar el número).
    if (result.status === "desconocido") return desconocido();

    const signals = extractRequestSignals(request);

    // Auditoría de TODO intento contra un código existente, con éxito o sin
    // él. Va después del claim atómico.
    //
    // Si writeAudit falla, la descarga SIGUE: el contador ya se gastó y el
    // instalador está delante de un cliente. La metadata es determinista, así
    // que un fallo aquí es un bug nuestro, no una condición de runtime — se
    // registra a nivel error con todo el contexto para que se vea y se
    // arregle, pero no se le cae encima a quien está montando un terminal.
    try {
      await writeAudit({
        prisma,
        superAdminId: result.superAdminId,
        action: "apk_download",
        tenantId: null,
        metadata: {
          ...signals,
          versionCode: result.versionCode,
          code: codigo,
          result: result.status,
        },
      });
    } catch (err) {
      request.log.error(
        {
          err,
          evento: "apk_audit_fallido",
          superAdminId: result.superAdminId,
          versionCode: result.versionCode,
          code: codigo,
          resultado: result.status,
          ip,
          userAgent: signals.userAgent,
        },
        "no se pudo auditar la descarga de la APK; se sirve igualmente",
      );
    }

    // Misma carrera que arriba, con el número reciclado hacia OTRA versión
    // entre el peek y el claim: se ha abierto un binario que no es el de este
    // código. No se sirve.
    if (result.status === "ok" && result.versionCode !== pendiente.versionCode) {
      return renderPage(reply, { kind: "sin-version" }, 404);
    }

    if (result.status !== "ok") {
      const state = await registerFailure(rlKey);
      return renderPage(
        reply,
        state.locked
          ? {
              kind: "bloqueado",
              retryAfterMinutes: Math.ceil(state.retryAfterSeconds / 60),
            }
          : { kind: result.status },
        state.locked ? 429 : 400,
      );
    }

    // Acierto: se perdona UN fallo, no el contador entero. El instalador que
    // teclea mal un par de veces antes de acertar no arrastra esos fallos a la
    // siguiente descarga (el mismo código sirve hasta 3 veces, y el WiFi del
    // bar corta), pero un reset completo le regalaría la ventana de 10
    // intentos a quien tiene un código válido: 9 fallos + 1 acierto, y vuelta
    // a empezar tantas veces como usos le queden.
    await forgiveFailure(rlKey);

    // Y AHORA se abre, con la descarga ya cobrada y sin nada entre esto y el
    // `send`. Queda una ventana mínima —que el fichero desaparezca entre el
    // stat y el open— en la que el instalador pierde un uso del código; es el
    // precio de no tener el descriptor abierto durante el claim, y es un
    // cambio a peor sólo en el caso en que alguien borre el APK del VPS en
    // ese milisegundo.
    const opened = await openRelease(release);
    if (!opened) {
      return renderPage(reply, { kind: "sin-version" }, 404);
    }
    return sendApk(reply, opened);
  });
}
