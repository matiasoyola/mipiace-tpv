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

import { inspect, registerFailure, reset } from "../auth/rate-limit.js";
import { getPrisma } from "../context.js";
import { extractRequestSignals, writeAudit } from "../superadmin/audit.js";
import { requireSuperAdmin } from "../superadmin/middleware.js";

import { consumeDownloadCode, createDownloadCode } from "./codes.js";
import { renderApkPage, type ApkPageError } from "./page.js";
import { apkDownloadRateLimit } from "./rate-limit.js";
import {
  findRelease,
  latestRelease,
  openRelease,
  readReleases,
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
    const result = await consumeDownloadCode({ prisma, code: codigo, ip });

    // Código inexistente: NO va a SuperAdminAudit (no hay a quién atribuirlo).
    // Log estructurado + contador del limitador, y nada más.
    if (result.status === "desconocido") {
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
    }

    const signals = extractRequestSignals(request);

    // Auditoría de TODO intento contra un código existente, con éxito o sin
    // él. Va después del claim atómico y antes de abrir el stream.
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

    // Acierto: se limpia el contador de esa IP. El instalador que acaba de
    // acertar no arrastra los fallos de tecleo previos a la siguiente descarga
    // (el mismo código sirve hasta 3 veces, y el WiFi del bar corta).
    await reset(rlKey);

    const release: ReleaseEntry | null = await findRelease(result.versionCode);
    if (!release) {
      return renderPage(reply, { kind: "sin-version" }, 404);
    }
    const opened = await openRelease(release);
    if (!opened) {
      return renderPage(reply, { kind: "sin-version" }, 404);
    }
    return sendApk(reply, opened);
  });
}
