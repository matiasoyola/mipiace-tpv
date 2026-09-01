// v1.14-la-comanda-se-ve · reparto tono↔categoría (hallazgo M2).
//
// Lo que se aprende de un chip de categoría es el color y la posición,
// no el nombre. Un reparto que cambia en cada sync es peor que no tener
// color, así que lo importante aquí es la ESTABILIDAD: lo ya asignado no
// se reasigna nunca, y el reparto se persiste por tenant.

import { beforeEach, describe, expect, it } from "vitest";

import {
  CATEGORY_TONES,
  iconNameForTag,
  loadToneAssignments,
  normalizeTag,
  resolveToneAssignments,
  TONE_STYLES,
  type CategoryTone,
} from "../src/lib/categoryTones.js";

const TENANT = "tenant-sirope";
const OTRO_TENANT = "tenant-cachitos";

beforeEach(() => {
  localStorage.clear();
});

describe("resolveToneAssignments · estabilidad", () => {
  it("el mismo catálogo devuelve el mismo reparto entre sesiones", () => {
    const tags = ["cafes", "refrescos", "vinos", "postres"];
    const primera = resolveToneAssignments(tags, TENANT);
    // Segunda sesión: el módulo relee de localStorage, no recalcula.
    const segunda = resolveToneAssignments(tags, TENANT);
    expect(segunda).toEqual(primera);
  });

  it("una categoría nueva NO reasigna las que ya tenían tono", () => {
    const antes = resolveToneAssignments(["cafes", "vinos"], TENANT);
    const despues = resolveToneAssignments(
      ["cafes", "vinos", "bocadillos", "ensaladas"],
      TENANT,
    );
    expect(despues.cafes).toBe(antes.cafes);
    expect(despues.vinos).toBe(antes.vinos);
    expect(despues.bocadillos).toBeDefined();
  });

  it("el orden en que llegan los tags no cambia el reparto", () => {
    const a = resolveToneAssignments(["zumos", "cafes", "menus"], TENANT);
    localStorage.clear();
    const b = resolveToneAssignments(["menus", "zumos", "cafes"], TENANT);
    expect(b).toEqual(a);
  });

  it("el reparto es por tenant: dos tenants no comparten claves", () => {
    resolveToneAssignments(["cafes"], TENANT);
    const otro = loadToneAssignments(OTRO_TENANT);
    expect(otro).toEqual({});
  });

  it("persiste en localStorage (no vive sólo en memoria)", () => {
    const asignado = resolveToneAssignments(["cafes", "vinos"], TENANT);
    expect(loadToneAssignments(TENANT)).toEqual(asignado);
  });

  it("localStorage corrupto o con tonos inventados no rompe nada", () => {
    localStorage.setItem(`mipiacetpv-category-tones:${TENANT}`, "{no es json");
    expect(loadToneAssignments(TENANT)).toEqual({});
    localStorage.setItem(
      `mipiacetpv-category-tones:${TENANT}`,
      JSON.stringify({ cafes: "fucsia" }),
    );
    expect(loadToneAssignments(TENANT)).toEqual({});
    const out = resolveToneAssignments(["cafes"], TENANT);
    expect(CATEGORY_TONES).toContain(out.cafes);
  });
});

describe("resolveToneAssignments · reparto", () => {
  it("sigue la heurística de tokens.md donde el nombre lo dice claro", () => {
    const out = resolveToneAssignments(
      ["cafes", "aguas", "ensaladas", "postres"],
      TENANT,
    );
    expect(out.cafes).toBe("amber");
    expect(out.aguas).toBe("sky");
    expect(out.ensaladas).toBe("green");
    expect(out.postres).toBe("rose");
  });

  it("no pinta el catálogo entero del mismo tono aunque la pista insista", () => {
    const out = resolveToneAssignments(
      ["cafes", "cafeteria", "cafe con leche", "cafe solo"],
      TENANT,
    );
    const usados = new Set<CategoryTone>(Object.values(out));
    expect(usados.size).toBeGreaterThan(1);
  });

  it("con más de seis categorías los tonos se reparten, no se agotan", () => {
    const tags = Array.from({ length: 18 }, (_, i) => `cat-${i}`);
    const out = resolveToneAssignments(tags, TENANT);
    expect(Object.keys(out)).toHaveLength(18);
    for (const tone of Object.values(out)) {
      expect(CATEGORY_TONES).toContain(tone);
    }
    // Reparto equilibrado: 18 entre 6 son 3 por tono.
    const cuenta = new Map<CategoryTone, number>();
    for (const t of Object.values(out)) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
    for (const n of cuenta.values()) expect(n).toBe(3);
  });

  it("el coral no está en la paleta: queda para la selección (m2)", () => {
    for (const tone of CATEGORY_TONES) {
      expect(TONE_STYLES[tone].icon).not.toContain("coral");
      expect(TONE_STYLES[tone].band).not.toContain("coral");
    }
  });

  // v1.14.1-el-catalogo-manda §2 · el tono ya NO pinta el fondo del chip.
  // En la captura del AP11 los seis fondos de color resultaron ser ruido
  // —se reparten por orden alfabético, así que no dicen nada del
  // contenido— y competían con la única señal que hay que leer en esa
  // fila, que es cuál está seleccionado. El tono se queda en el icono del
  // chip y en la banda de 4 px de la tarjeta de producto.
  it("el tono pinta icono y banda, nunca un fondo de chip", () => {
    for (const tone of CATEGORY_TONES) {
      expect(TONE_STYLES[tone].icon).toMatch(/^text-/);
      expect(TONE_STYLES[tone].band).toMatch(/^bg-/);
      // Si volviera a haber un fondo de color por tono, aquí estaría.
      expect(Object.keys(TONE_STYLES[tone])).toEqual(["icon", "band"]);
    }
  });

  it("los seis tonos usan los colores de docs/design/tokens.md §2", () => {
    expect(TONE_STYLES.amber.icon).toContain("amber");
    expect(TONE_STYLES.sky.icon).toContain("sky");
    expect(TONE_STYLES.red.icon).toContain("red");
    expect(TONE_STYLES.green.icon).toContain("emerald");
    expect(TONE_STYLES.rose.icon).toContain("rose");
    expect(TONE_STYLES.stone.icon).toContain("stone");
  });
});

describe("iconNameForTag", () => {
  it("acierta con los nombres sucios que vienen de Holded", () => {
    // El propio catálogo de Sirope: sin tildes, sin espacios y pegado.
    expect(iconNameForTag("Croissantysandwich", "amber")).toBe("Croissant");
    expect(iconNameForTag("Bolleria", "amber")).toBe("Croissant");
    expect(iconNameForTag("CAFES", "amber")).toBe("Coffee");
    expect(iconNameForTag("Cañas", "amber")).toBe("Beer");
  });

  it("ninguna categoría se queda sin icono", () => {
    for (const tone of CATEGORY_TONES) {
      expect(iconNameForTag("xyzzy-sin-pista", tone)).toBeTruthy();
    }
  });
});

describe("normalizeTag", () => {
  it("quita tildes y baja a minúsculas", () => {
    expect(normalizeTag("Bollería")).toBe("bolleria");
    expect(normalizeTag("CAFÉS")).toBe("cafes");
  });
});
