// Generador de iconos PWA (192 / 512 / maskable) desde el logo canónico de
// mipiacetpv (docs/design/tokens.md §1). Sin dependencias nativas: rasteriza
// las barras (pills) y el corazón (beziers flatten + scanline) con
// supersampling 4x y codifica PNG con zlib de Node. Reejecutable:
//
//   node apps/tpv-web/scripts/gen-pwa-icons.mjs
//
// El mismo set de PNG sirve para web (manifest) y como assets de marca. El
// icono nativo de Android es un VectorDrawable aparte (no rasteriza aquí).

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/icons");

// ---- Paleta (tokens.md §2) ----
const INK = [0x1f, 0x29, 0x37]; // barras (logo sobre fondo claro)
const CORAL = [0xe9, 0x70, 0x58]; // corazón
const STONE = [0xf8, 0xf6, 0xf3]; // fondo de superficie (mipiace.stone)

// ---- Geometría del logo en el viewBox nativo 0..28 (tokens.md §1) ----
// Barras: pills verticales de ancho 2.4 (r = 1.2).
const BARS = [
  { x: 4.0, y: 9.5, h: 14.5 },
  { x: 8.8, y: 6.0, h: 18.0 },
  { x: 13.6, y: 11.0, h: 13.0 },
  { x: 18.4, y: 8.0, h: 16.0 },
];
const BAR_W = 2.4;
const BAR_R = 1.2;

// Corazón: 4 cúbicas absolutas derivadas del path del SVG canónico.
// [x0,y0, cp1x,cp1y, cp2x,cp2y, x1,y1]
const HEART_CUBICS = [
  [5.2, 4.4, 4.35, 4.4, 3.65, 5.05, 3.65, 5.9],
  [3.65, 5.9, 3.65, 6.55, 5.2, 7.85, 5.2, 7.85],
  [5.2, 7.85, 5.2, 7.85, 6.75, 6.55, 6.75, 5.9],
  [6.75, 5.9, 6.75, 5.05, 6.05, 4.4, 5.2, 4.4],
];

// Bounding box del logo (para centrar): x 3.65..20.8, y 4.4..24.
const LOGO = { minX: 3.65, maxX: 20.8, minY: 4.4, maxY: 24.0 };

function flattenHeart(steps = 48) {
  const pts = [];
  for (const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] of HEART_CUBICS) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      pts.push([
        a * x0 + b * c1x + c * c2x + d * x1,
        a * y0 + b * c1y + c * c2y + d * y1,
      ]);
    }
  }
  return pts;
}
const HEART_POLY = flattenHeart();

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1],
      xj = poly[j][0],
      yj = poly[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function inBar(px, py, bar) {
  const lx = bar.x,
    rx = bar.x + BAR_W,
    r = BAR_R;
  if (px < lx || px > rx) return false;
  const topC = bar.y + r,
    botC = bar.y + bar.h - r,
    cx = bar.x + r;
  if (py >= topC && py <= botC) return true;
  const cy = py < topC ? topC : botC;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// Devuelve el color RGBA del logo (en coords 0..28) o null si transparente.
function logoColorAt(lx, ly) {
  if (pointInPoly(lx, ly, HEART_POLY)) return CORAL;
  for (const bar of BARS) if (inBar(lx, ly, bar)) return INK;
  return null;
}

// ---- Render ----
// coverage: fracción del icono que ocupa el logo (lado largo). maskable deja
// zona segura (~0.66) porque los launchers recortan hasta un círculo.
function renderIcon(size, { coverage, radiusRatio }) {
  const SS = 4; // supersampling
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);

  const logoW = LOGO.maxX - LOGO.minX;
  const logoH = LOGO.maxY - LOGO.minY;
  const target = S * coverage;
  const scale = target / Math.max(logoW, logoH);
  const offX = (S - logoW * scale) / 2 - LOGO.minX * scale;
  const offY = (S - logoH * scale) / 2 - LOGO.minY * scale;
  const rad = radiusRatio * S;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = (py * S + px) * 4;
      // Fondo stone con esquinas redondeadas (rad=0 → cuadrado full-bleed).
      let bg = true;
      if (rad > 0) {
        const cx = Math.min(px, S - 1 - px);
        const cy = Math.min(py, S - 1 - py);
        if (cx < rad && cy < rad)
          bg = (rad - cx) ** 2 + (rad - cy) ** 2 <= rad * rad;
      }
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      if (bg) {
        [r, g, b] = STONE;
        a = 255;
        const lx = (px - offX) / scale;
        const ly = (py - offY) / scale;
        const col = logoColorAt(lx, ly);
        if (col) [r, g, b] = col;
      }
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return downsample(buf, S, SS);
}

// Downsample SSxSS box filter → antialiasing.
function downsample(buf, S, SS) {
  const out = S / SS;
  const dst = Buffer.alloc(out * out * 4);
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < SS; dy++)
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          const af = buf[i + 3];
          r += buf[i] * af;
          g += buf[i + 1] * af;
          b += buf[i + 2] * af;
          a += af;
        }
      const n = SS * SS;
      const di = (y * out + x) * 4;
      dst[di] = a ? Math.round(r / a) : 0;
      dst[di + 1] = a ? Math.round(g / a) : 0;
      dst[di + 2] = a ? Math.round(b / a) : 0;
      dst[di + 3] = Math.round(a / n);
    }
  }
  return { data: dst, size: out };
}

// ---- PNG encoder (RGBA, sin filtro) ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePng(data, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
const jobs = [
  { name: "icon-192.png", size: 192, opt: { coverage: 0.7, radiusRatio: 0.18 } },
  { name: "icon-512.png", size: 512, opt: { coverage: 0.7, radiusRatio: 0.18 } },
  // maskable: full-bleed, logo dentro de la zona segura del recorte.
  { name: "maskable-512.png", size: 512, opt: { coverage: 0.52, radiusRatio: 0 } },
];
for (const j of jobs) {
  const { data, size } = renderIcon(j.size, j.opt);
  writeFileSync(resolve(OUT_DIR, j.name), encodePng(data, size));
  console.log(`  ${j.name} (${size}x${size})`);
}
console.log("Iconos PWA generados en apps/tpv-web/public/icons/");
