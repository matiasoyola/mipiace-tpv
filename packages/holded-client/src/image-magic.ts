// v1.2-Lite-fix1 Bug-Imagenes-Holded: detector puro de tipo de imagen
// por magic bytes. Necesario porque `GET /invoicing/v1/products/{id}/image`
// devuelve siempre `content-type: text/html` en el HEAD aunque el body
// real sea JPEG/PNG. El detalle del spike 2026-05-22 está en
// `docs/auditorias/bug-imagenes-holded.md`.

export type DetectedImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "text/html"
  | "unknown";

// Devuelve el MIME real basándose en los primeros bytes del buffer:
//   - FF D8 FF                                   → image/jpeg
//   - 89 50 4E 47 0D 0A 1A 0A                    → image/png
//   - 47 49 46 38                                → image/gif
//   - 52 49 46 46 ?? ?? ?? ?? 57 45 42 50        → image/webp (RIFF + WEBP)
//   - '<' al principio (0x3C)                    → text/html (catch-all Next.js)
//   - cualquier otra cosa                        → "unknown" (caller decide)
//
// Magic bytes son una firma de unos pocos bytes al inicio de un archivo
// que identifican formato; en el flujo del backfill nos interesa
// distinguir SÓLO los 4 formatos válidos para producto + el catch-all
// HTML de Holded. Cualquier otra cosa se marca como `unknown` para que
// el caller la loguee como caso a investigar en lugar de silenciar.
export function detectImageMime(buf: Buffer): DetectedImageMime {
  if (buf.length === 0) return "unknown";
  // HTML catch-all: el frontend Next.js de Holded sirve `<!doctype...`
  // (o `<html`, `< body`, etc.). Cualquier byte `<` al inicio cuenta —
  // ningún formato de imagen empieza por `<`.
  if (buf[0] === 0x3c) return "text/html";

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF: 47 49 46 38 ("GIF8")
  if (
    buf.length >= 4 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38
  ) {
    return "image/gif";
  }

  // WEBP: "RIFF" .... "WEBP" (offset 8)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return "unknown";
}

// Helper trivial usado por el sync para mapear MIME → extensión en disco.
// Duplicado intencional con `image-cache-worker.extFromMime` para no
// crear un acoplamiento entre packages/holded-client y apps/api/workers.
export function extFromDetectedMime(
  mime: Exclude<DetectedImageMime, "text/html" | "unknown">,
): "jpg" | "png" | "gif" | "webp" {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
  }
}
