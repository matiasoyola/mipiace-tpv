// v1.4-Impresoras-Fase-1 Lote 2 · helpers ESC/POS de bajo nivel.
//
// La impresora ESC/POS (POS-80 y compatibles) interpreta secuencias de
// bytes que combinan texto plano + comandos de control. Aquí cada
// función pura devuelve los bytes correspondientes a un comando. El
// builder de tickets concatena helpers + texto para componer el binary
// final que se manda a la impresora (USB con WebUSB o WIFI con TCP a
// :9100).
//
// Codepage: usamos PC850 (multilingüe latino) porque cubre los
// acentos y ñ del español. Tras `escInit()` hay que mandar `escCodePagePc850()`
// y luego encodear el texto con la tabla equivalente.

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export function escInit(): Uint8Array {
  return new Uint8Array([ESC, 0x40]); // ESC @
}

export function escFeed(lines: number): Uint8Array {
  return new Uint8Array([ESC, 0x64, Math.max(0, Math.min(255, lines))]); // ESC d n
}

// Corte total. La POS-80 usa GS V 0 (corte full). Algunas usan GS V 1
// (corte parcial) — para impresoras sin cutter el comando se ignora.
export function escCut(): Uint8Array {
  return new Uint8Array([GS, 0x56, 0x00]);
}

export type Align = "left" | "center" | "right";

export function escAlign(a: Align): Uint8Array {
  const n = a === "center" ? 1 : a === "right" ? 2 : 0;
  return new Uint8Array([ESC, 0x61, n]); // ESC a n
}

export function escBold(on: boolean): Uint8Array {
  return new Uint8Array([ESC, 0x45, on ? 1 : 0]); // ESC E n
}

// width/height son multiplicadores 1..8. La POS-80 lo aplica con
// GS ! (selecciona caracter size): nibble alto = ancho-1, nibble bajo
// = alto-1.
export function escSize(width: 1 | 2 | 3 | 4, height: 1 | 2 | 3 | 4): Uint8Array {
  const w = (width - 1) & 0x0f;
  const h = (height - 1) & 0x0f;
  return new Uint8Array([GS, 0x21, (w << 4) | h]);
}

export function escResetSize(): Uint8Array {
  return escSize(1, 1);
}

// PC850 (multilingüe latino, español OK). Tras el reset hay que
// pegarla porque ESC @ deja la code page en 0 (PC437 — sin acentos).
export function escCodePagePc850(): Uint8Array {
  return new Uint8Array([ESC, 0x74, 0x02]);
}

// QR code estándar ESC/POS (GS k). Tamaño 1..16, valor sensato 6
// para 80mm que no satura el ancho.
export function escQrCode(data: string, moduleSize = 6): Uint8Array {
  const dataBytes = new TextEncoder().encode(data);
  const len = dataBytes.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;

  const parts: number[] = [];
  // Model 2
  parts.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  // Module size
  parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize & 0xff);
  // Error correction L
  parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30);
  // Store data
  parts.push(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30);
  for (const b of dataBytes) parts.push(b);
  // Print stored
  parts.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  return new Uint8Array(parts);
}

// Encoding texto → PC850. Hacemos una tabla limitada de los caracteres
// que aparecen en castellano. Caracteres fuera de tabla caen a `?`
// para no romper la impresora con un byte UTF-8 inválido.
const PC850_TABLE: Record<string, number> = {
  á: 0xa0,
  é: 0x82,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  Á: 0xb5,
  É: 0x90,
  Í: 0xd6,
  Ó: 0xe0,
  Ú: 0xe9,
  ñ: 0xa4,
  Ñ: 0xa5,
  ü: 0x81,
  Ü: 0x9a,
  ç: 0x87,
  Ç: 0x80,
  "¿": 0xa8,
  "¡": 0xad,
  "€": 0xd5,
  "·": 0xfa,
  "ª": 0xa6,
  º: 0xa7,
};

export function encodePc850(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const mapped = PC850_TABLE[ch];
    if (mapped !== undefined) out.push(mapped);
    else out.push(0x3f); // '?'
  }
  return new Uint8Array(out);
}

// Une varios buffers en un Uint8Array nuevo. Práctico para que el
// builder componga el binary final sin estado mutable expuesto.
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// Sugar útil en builders: emite el texto codificado en PC850 + LF.
export function escText(s: string): Uint8Array {
  return concatBytes([encodePc850(s), new Uint8Array([LF])]);
}

// Texto sin newline (cuando el caller necesita poner varios trozos en
// la misma línea — ej. nombre a la izq + precio a la derecha).
export function escTextNoLf(s: string): Uint8Array {
  return encodePc850(s);
}

// Línea separadora full-width 80mm (≈ 42 columnas con fuente normal).
export function escSeparator(width = 42): Uint8Array {
  return escText("-".repeat(width));
}
