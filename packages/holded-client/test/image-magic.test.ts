import { describe, expect, it } from "vitest";

import { detectImageMime, extFromDetectedMime } from "../src/index.js";

describe("detectImageMime", () => {
  it("JPEG: FF D8 FF", () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])))
      .toBe("image/jpeg");
  });

  it("PNG: 89 50 4E 47 0D 0A 1A 0A", () => {
    expect(
      detectImageMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      ),
    ).toBe("image/png");
  });

  it("GIF: 47 49 46 38", () => {
    expect(detectImageMime(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])))
      .toBe("image/gif");
  });

  it("WEBP: RIFF .... WEBP", () => {
    // 4 bytes RIFF, 4 bytes file size, 4 bytes WEBP
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (irrelevante)
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x56, 0x50, 0x38, 0x20,
    ]);
    expect(detectImageMime(buf)).toBe("image/webp");
  });

  it("HTML catch-all: '<' al principio", () => {
    expect(detectImageMime(Buffer.from("<!doctype html><html><head>", "utf8")))
      .toBe("text/html");
    expect(detectImageMime(Buffer.from("<html>", "utf8"))).toBe("text/html");
  });

  it("buffer vacío → unknown", () => {
    expect(detectImageMime(Buffer.alloc(0))).toBe("unknown");
  });

  it("bytes random no reconocidos → unknown", () => {
    expect(
      detectImageMime(Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77])),
    ).toBe("unknown");
  });

  it("RIFF sin WEBP en offset 8 → unknown (no es webp)", () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // WAVE en lugar de WEBP
    ]);
    expect(detectImageMime(buf)).toBe("unknown");
  });
});

describe("extFromDetectedMime", () => {
  it("mapea cada MIME a su extensión canónica", () => {
    expect(extFromDetectedMime("image/jpeg")).toBe("jpg");
    expect(extFromDetectedMime("image/png")).toBe("png");
    expect(extFromDetectedMime("image/gif")).toBe("gif");
    expect(extFromDetectedMime("image/webp")).toBe("webp");
  });
});
