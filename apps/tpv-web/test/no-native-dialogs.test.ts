// v1.12-manos-de-camarero · test de guardia (hallazgo H5 del
// 2026-08-27).
//
// En el terminal, un `confirm()` sale como *"mipiacetpv.com dice: ¿Vaciar
// la mesa?"* con botones azules de Chrome y dos "Cancelar" que
// significan cosas opuestas. Un `alert()` es igual de ajeno y además
// bloquea el hilo: en un TPV con cola en barra, eso es una caja parada.
//
// Este test recorre `src/` entero. Si alguien vuelve a meter uno, falla
// aquí y no en el terminal de un cliente. La alternativa está escrita:
// `components/ConfirmSheet.tsx` para confirmar, y un aviso inline (los
// bloques rojos/ámbar que ya usan todas las pantallas) para informar.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// El entorno de estos tests es jsdom, donde `import.meta.url` no es un
// `file:` — subimos desde el cwd hasta encontrar el árbol de tpv-web.
const SRC = findSrc(process.cwd());

function findSrc(from: string): string {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, "apps", "tpv-web", "src");
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, "src", "pages", "SalePage.tsx"))) {
      return join(dir, "src");
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("no encuentro apps/tpv-web/src");
    dir = parent;
  }
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// `confirm(`, `window.confirm(`, `alert(` y `prompt(` como LLAMADA.
// Deja pasar identificadores que sólo los contienen (`alertLevel`,
// `showAlert`, `<AlertCircle />`, `props.onAlert`) exigiendo que no haya
// letra, dígito, `_`, `$`, `.` ni `<` justo antes.
const NATIVE_DIALOG = /(?<![\w$.<])(?:window\s*\.\s*)?(confirm|alert|prompt)\s*\(/;

// Las líneas de comentario hablan de estos diálogos a propósito (este
// bloque entero va de quitarlos): sólo miramos código.
function codeLines(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlockComment = false;
  source.split("\n").forEach((raw, i) => {
    let text = raw;
    if (inBlockComment) {
      const end = text.indexOf("*/");
      if (end === -1) return;
      text = text.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = text.indexOf("/*");
    if (blockStart !== -1) {
      const end = text.indexOf("*/", blockStart + 2);
      if (end === -1) {
        inBlockComment = true;
        text = text.slice(0, blockStart);
      } else {
        text = text.slice(0, blockStart) + text.slice(end + 2);
      }
    }
    const lineComment = text.indexOf("//");
    if (lineComment !== -1) text = text.slice(0, lineComment);
    if (text.trim()) out.push({ line: i + 1, text });
  });
  return out;
}

describe("v1.12 · tpv-web no usa diálogos nativos del navegador", () => {
  const files = sourceFiles(SRC);

  it("recorre el árbol de verdad (si esto falla, el test no está mirando nada)", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith("SalePage.tsx"))).toBe(true);
  });

  it("no queda ningún confirm() / alert() / prompt() en src/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const { line, text } of codeLines(readFileSync(file, "utf8"))) {
        if (NATIVE_DIALOG.test(text)) {
          offenders.push(
            `${file.slice(SRC.length + 1)}:${line} · ${text.trim()}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("la regla detecta lo que tiene que detectar", () => {
    expect(NATIVE_DIALOG.test('if (confirm("¿Vaciar la mesa?")) {')).toBe(true);
    expect(NATIVE_DIALOG.test("window.confirm('x')")).toBe(true);
    expect(NATIVE_DIALOG.test("  alert(msg);")).toBe(true);
    expect(NATIVE_DIALOG.test("const name = prompt('nombre')")).toBe(true);
    // Y no confunde nombres propios nuestros con diálogos del sistema.
    expect(NATIVE_DIALOG.test("<AlertCircle className='w-4' />")).toBe(false);
    expect(NATIVE_DIALOG.test("showAlert(true)")).toBe(false);
    expect(NATIVE_DIALOG.test("props.onConfirm()")).toBe(false);
    expect(NATIVE_DIALOG.test("setConfirmAction(null)")).toBe(false);
  });
});
