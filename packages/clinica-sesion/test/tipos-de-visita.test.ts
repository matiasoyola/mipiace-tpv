// clinica-5 · los tipos de visita, la especialidad y las dos negativas de
// S5.
//
// El sabotaje que este fichero guarda: **un servicio con dos tipos
// distintos por sus etiquetas no se guarda**, y lo dice con un motivo que
// la dueña puede leer sin llamar a soporte.

import { describe, expect, it } from "vitest";

import {
  ESPECIALIDAD_DE_TIPO,
  NOMBRE_DE_TIPO_DE_VISITA,
  TIPOS_DE_VISITA,
  esEspecialidad,
  esTipoDeVisita,
  especialidadDeLosTipos,
  normalizarSlug,
  tipoDelServicio,
} from "../src/index.js";

describe("clinica-5 · la lista de tipos es cerrada y completa", () => {
  it("son los cinco de COGECOP, en su orden", () => {
    expect([...TIPOS_DE_VISITA]).toEqual([
      "QUIROPODIA",
      "PIE_RIESGO",
      "CIRUGIA",
      "BIOMECANICA",
      "GENERAL",
    ]);
  });

  it("los cinco tienen nombre y especialidad", () => {
    for (const t of TIPOS_DE_VISITA) {
      expect(NOMBRE_DE_TIPO_DE_VISITA[t]).toBeTruthy();
      // Decisión 2: los cinco son de podología.
      expect(ESPECIALIDAD_DE_TIPO[t]).toBe("PODOLOGIA");
    }
  });

  it("no admite un tipo inventado", () => {
    expect(esTipoDeVisita("QUIROPODIA")).toBe(true);
    expect(esTipoDeVisita("ORTOPEDIA")).toBe(false);
    expect(esTipoDeVisita(null)).toBe(false);
    expect(esEspecialidad("PODOLOGIA")).toBe(true);
    expect(esEspecialidad("DENTAL")).toBe(false);
  });
});

describe("clinica-5 · la especialidad de la sesión se congela (S5)", () => {
  it("sale de los tipos marcados", () => {
    expect(especialidadDeLosTipos(["CIRUGIA", "QUIROPODIA"])).toBe(
      "PODOLOGIA",
    );
  });

  it("sin tipos no hay especialidad que congelar", () => {
    expect(especialidadDeLosTipos([])).toBeNull();
  });
});

describe("clinica-5 · el tipo de un servicio sale de sus etiquetas", () => {
  const tipoPorTag = {
    podologia: "QUIROPODIA",
    cirugia: "CIRUGIA",
    biomecanica: "BIOMECANICA",
  } as const;

  it("una etiqueta con tipo: lo hereda, y la especialidad con él", () => {
    const r = tipoDelServicio({
      etiquetas: ["podologia"],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r).toEqual({
      ok: true,
      tipo: "QUIROPODIA",
      especialidad: "PODOLOGIA",
    });
  });

  it("las etiquetas transversales no estorban (S5, respuesta de clínica)", () => {
    // «Promoción» y «Novedad» no tienen tipo: conviven con «Podología» sin
    // chocar con la regla, que sólo rechaza dos tipos DISTINTOS.
    const r = tipoDelServicio({
      etiquetas: ["promocion", "podologia", "novedad"],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tipo).toBe("QUIROPODIA");
  });

  it("la etiqueta se cruza NORMALIZADA: Holded manda mayúsculas y espacios", () => {
    const r = tipoDelServicio({
      etiquetas: ["  Podologia  "],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tipo).toBe("QUIROPODIA");
    expect(normalizarSlug("  Podologia  ")).toBe("podologia");
  });

  // ── EL SABOTAJE ─────────────────────────────────────────────────────
  it("DOS TIPOS DISTINTOS: no se guarda, y el motivo se lee", () => {
    const r = tipoDelServicio({
      etiquetas: ["podologia", "cirugia"],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("DOS_TIPOS");
    // Nombra las dos categorías y dice qué hacer. Sin eso, la dueña ve un
    // «no se puede guardar» y no sabe qué quitar.
    expect(r.mensaje).toContain("Quiropodia");
    expect(r.mensaje).toContain("Cirugía");
    expect(r.mensaje).toMatch(/quita una/i);
  });

  it("TRES tipos distintos también se rechazan", () => {
    const r = tipoDelServicio({
      etiquetas: ["podologia", "cirugia", "biomecanica"],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(false);
  });

  it("dos etiquetas con el MISMO tipo sí se guardan", () => {
    const r = tipoDelServicio({
      etiquetas: ["podologia", "pod"],
      tipoPorTag: { podologia: "QUIROPODIA", pod: "QUIROPODIA" },
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(true);
  });

  // ── La segunda negativa de S5 ───────────────────────────────────────
  it("servicio de SESIÓN sin tipo, en centro clínico: no se guarda", () => {
    const r = tipoDelServicio({
      etiquetas: ["promocion"],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("SESION_SIN_TIPO");
    expect(r.mensaje).toMatch(/categoría/i);
  });

  it("un servicio NORMAL sin tipo, en centro clínico: sí se guarda", () => {
    // Una crema, un bono: no son de sesión y no tienen tipo de visita.
    const r = tipoDelServicio({
      etiquetas: ["cremas"],
      tipoPorTag,
      esCentroClinico: true,
      tratamientoSesion: false,
    });
    expect(r).toEqual({ ok: true, tipo: null, especialidad: null });
  });

  it("en la peluquería de Sole, un servicio sin tipo es lo normal", () => {
    // La negativa sólo vale en centros con la historia encendida: en un
    // centro no clínico, `tratamientoSesion` no debería ni poder marcarse,
    // y si llegara marcado no es motivo para no guardar un corte de pelo.
    const r = tipoDelServicio({
      etiquetas: ["cortes"],
      tipoPorTag: {},
      esCentroClinico: false,
      tratamientoSesion: true,
    });
    expect(r.ok).toBe(true);
  });
});
