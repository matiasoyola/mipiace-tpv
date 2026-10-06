// clinica-2 · la tabla de casos de las alertas y de la validación.
//
// Son funciones puras, así que esto es una tabla de verdad y no una
// maqueta: entra el estado, sale la lista. Lo que se fija aquí es
// exactamente lo que el prompt del bloque pide probar — alertas con y sin
// correcciones, con seguimientos, y la validación con «No lo sé» o sin las
// tres confirmaciones.

import { describe, expect, it } from "vitest";

import {
  CONFIRMACIONES_VACIAS,
  CUESTIONARIO_V1,
  alertasDe,
  cuestionarioDeVersion,
  preguntasEnJuego,
  puedeValidarse,
  valorVigente,
  type Confirmaciones,
  type Correccion,
  type RespuestasPaciente,
} from "../src/index.js";

const TODO_NO: RespuestasPaciente = {
  diab: "NO",
  antic: "NO",
  circ: "NO",
  aler: "NO",
  marca: "NO",
  defen: "NO",
  sens: "NO",
  artr: "NO",
  oper: "NO",
  fuma: "NO",
};

const LAS_TRES: Confirmaciones = {
  alergias: true,
  medicacion: true,
  alertas: true,
};

function correccion(
  preguntaId: string,
  valor: Correccion["valor"],
  creadaEn = "2026-10-06T10:30:00.000Z",
): Correccion {
  return {
    preguntaId,
    valor,
    autorNombre: "Lucía Martín",
    autorUserId: "22222222-2222-2222-2222-222222222222",
    creadaEn,
  };
}

const sinCorrecciones = { correcciones: [] as Correccion[] };

// ── El cuestionario ──────────────────────────────────────────────────

describe("clinica-2 · el cuestionario está versionado", () => {
  it("la versión 1 son las diez preguntas del mockup, en su orden", () => {
    expect(CUESTIONARIO_V1.version).toBe(1);
    expect(CUESTIONARIO_V1.preguntas.map((p) => p.id)).toEqual([
      "diab",
      "antic",
      "circ",
      "aler",
      "marca",
      "defen",
      "sens",
      "artr",
      "oper",
      "fuma",
    ]);
  });

  it("una versión que no existe no se sirve con las preguntas de hoy", () => {
    // Pintar una valoración de 2031 con el cuestionario de 2026 es decir
    // que el paciente contestó algo que no se le preguntó.
    expect(cuestionarioDeVersion(99)).toBeNull();
    expect(cuestionarioDeVersion(1)).toBe(CUESTIONARIO_V1);
  });

  it("tres «Sí» son informativos y NO son alerta (artrosis, operaciones, tabaco)", () => {
    const sinAlerta = CUESTIONARIO_V1.preguntas
      .filter((p) => p.alerta == null)
      .map((p) => p.id);
    expect(sinAlerta).toEqual(["artr", "oper", "fuma"]);
  });

  it("las etiquetas de alerta están en NEUTRO (no «Diabética»)", () => {
    // La única divergencia declarada con el mockup: su paciente de ejemplo
    // es Carmen y escribe «Diabética». Una etiqueta en femenino sobre la
    // historia de un hombre es un error de dato.
    const etiquetas = CUESTIONARIO_V1.preguntas
      .map((p) => p.alerta)
      .filter((a): a is string => a != null);
    expect(etiquetas).toContain("Diabetes");
    expect(etiquetas).not.toContain("Diabética");
    expect(etiquetas).toContain("Anticoagulación");
    expect(etiquetas).toContain("Inmunodepresión");
  });
});

// ── Las preguntas en juego y el seguimiento ──────────────────────────

describe("clinica-2 · el seguimiento sólo cuenta si la madre es «Sí»", () => {
  it("con diabetes «No», la insulina no está en juego", () => {
    const enJuego = preguntasEnJuego(CUESTIONARIO_V1, (id) => TODO_NO[id]);
    expect(enJuego.map((p) => p.id)).not.toContain("insul");
    expect(enJuego).toHaveLength(10);
  });

  it("con diabetes «Sí», la insulina entra detrás", () => {
    const respuestas = { ...TODO_NO, diab: "SI" as const, insul: "SI" as const };
    const enJuego = preguntasEnJuego(CUESTIONARIO_V1, (id) => respuestas[id as keyof typeof respuestas]);
    expect(enJuego.map((p) => p.id).slice(0, 3)).toEqual([
      "diab",
      "insul",
      "antic",
    ]);
  });

  it("si la podóloga CORRIGE la diabetes a «No», la insulina sale de juego sola", () => {
    // Nadie borra la respuesta de la insulina: deja de estar en juego. Es
    // lo que impide que un «No lo sé» en una pregunta que ya no aplica
    // bloquee la validación para siempre.
    const estado = {
      respuestasPaciente: { ...TODO_NO, diab: "SI", insul: "NO_SE" } as RespuestasPaciente,
      correcciones: [correccion("diab", "NO")],
    };
    const enJuego = preguntasEnJuego(CUESTIONARIO_V1, (id) =>
      valorVigente(estado, id),
    );
    expect(enJuego.map((p) => p.id)).not.toContain("insul");
    expect(
      puedeValidarse({
        ...estado,
        cuestionario: CUESTIONARIO_V1,
        estado: "RESPONDIDA",
        confirmaciones: LAS_TRES,
      }),
    ).toEqual({ puede: true });
  });
});

// ── Las alertas ──────────────────────────────────────────────────────

describe("clinica-2 · las alertas salen de los «Sí» que cambian el tratamiento", () => {
  it("sin ningún «Sí», no hay alertas", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: TODO_NO,
      ...sinCorrecciones,
    });
    expect(r.alertas).toEqual([]);
    expect(r.sinResolver).toEqual([]);
  });

  it("el caso del mockup: diabetes, anticoagulación, alergia al látex y pies dormidos", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: {
        ...TODO_NO,
        diab: "SI",
        insul: "NO",
        antic: "SI",
        circ: "NO_SE",
        aler: "SI",
        defen: "NO_SE",
        sens: "SI",
        artr: "SI",
      },
      detalles: { aler: ["Látex"] },
      ...sinCorrecciones,
    });
    expect(r.alertas.map((a) => a.texto)).toEqual([
      "Diabetes",
      "Anticoagulación",
      "Alergia: látex",
      "Sensibilidad reducida",
    ]);
    // La artrosis es un «Sí» y NO sale en la franja.
    expect(r.alertas.map((a) => a.preguntaId)).not.toContain("artr");
    // Y los dos «No lo sé» quedan listados como lo que falta.
    expect(r.sinResolver).toEqual(["circ", "defen"]);
  });

  it("un «No lo sé» NO produce alerta: diría que el paciente lo declaró", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, antic: "NO_SE" },
      ...sinCorrecciones,
    });
    expect(r.alertas).toEqual([]);
    expect(r.sinResolver).toEqual(["antic"]);
  });

  it("la corrección del sanitario AÑADE la alerta, y queda marcada como suya", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, antic: "NO_SE" },
      correcciones: [correccion("antic", "SI")],
    });
    expect(r.alertas).toEqual([
      { preguntaId: "antic", texto: "Anticoagulación", deCorreccion: true },
    ]);
    expect(r.sinResolver).toEqual([]);
  });

  it("…y también la QUITA cuando el paciente se equivocó al decir «Sí»", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, marca: "SI" },
      correcciones: [correccion("marca", "NO")],
    });
    expect(r.alertas).toEqual([]);
  });

  it("corregir dos veces: manda la ÚLTIMA, y las dos se conservan", () => {
    const correcciones = [
      correccion("antic", "SI", "2026-10-06T10:00:00.000Z"),
      correccion("antic", "NO", "2026-10-06T10:05:00.000Z"),
    ];
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, antic: "NO_SE" },
      correcciones,
    });
    expect(r.alertas).toEqual([]);
    // El append-only es de la base; aquí lo que se fija es que la función
    // no necesita que nadie borre la primera.
    expect(correcciones).toHaveLength(2);
  });

  it("el seguimiento de la insulina es su propia alerta", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, diab: "SI", insul: "SI" },
      ...sinCorrecciones,
    });
    expect(r.alertas.map((a) => a.texto)).toEqual(["Diabetes", "Insulina"]);
  });

  it("varias alergias se juntan en una alerta, en minúscula", () => {
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, aler: "SI" },
      detalles: { aler: ["Látex", "Penicilina"] },
      ...sinCorrecciones,
    });
    expect(r.alertas[0]?.texto).toBe("Alergia: látex, penicilina");
  });

  it("alergia «Sí» sin detalle sigue siendo alerta", () => {
    // El mockup deja seguir sin marcar nada («si no lo sabe, siga»). Lo que
    // no puede pasar es que la alerta desaparezca por falta de detalle.
    const r = alertasDe({
      cuestionario: CUESTIONARIO_V1,
      respuestasPaciente: { ...TODO_NO, aler: "SI" },
      ...sinCorrecciones,
    });
    expect(r.alertas[0]?.texto).toBe("Alergias");
  });
});

// ── La validación ────────────────────────────────────────────────────

describe("clinica-2 · validar exige las tres y ningún «No lo sé»", () => {
  const base = {
    cuestionario: CUESTIONARIO_V1,
    respuestasPaciente: TODO_NO,
    correcciones: [] as Correccion[],
  };

  it("con todo resuelto y las tres marcadas, sí", () => {
    expect(
      puedeValidarse({ ...base, estado: "RESPONDIDA", confirmaciones: LAS_TRES }),
    ).toEqual({ puede: true });
  });

  it("un «No lo sé» sin resolver lo bloquea, y lo dice en singular", () => {
    const r = puedeValidarse({
      ...base,
      respuestasPaciente: { ...TODO_NO, circ: "NO_SE" },
      estado: "RESPONDIDA",
      confirmaciones: LAS_TRES,
    });
    expect(r).toEqual({
      puede: false,
      motivo: "SIN_RESOLVER",
      mensaje: "Queda 1 respuesta «No lo sé» por resolver con el paciente.",
    });
  });

  it("dos «No lo sé», en plural y con la cuenta", () => {
    const r = puedeValidarse({
      ...base,
      respuestasPaciente: { ...TODO_NO, circ: "NO_SE", defen: "NO_SE" },
      estado: "RESPONDIDA",
      confirmaciones: LAS_TRES,
    });
    expect(r).toMatchObject({
      motivo: "SIN_RESOLVER",
      mensaje: "Quedan 2 respuestas «No lo sé» por resolver con el paciente.",
    });
  });

  it("resolverlo con una corrección lo desbloquea", () => {
    const r = puedeValidarse({
      ...base,
      respuestasPaciente: { ...TODO_NO, circ: "NO_SE" },
      correcciones: [correccion("circ", "SI")],
      estado: "RESPONDIDA",
      confirmaciones: LAS_TRES,
    });
    expect(r).toEqual({ puede: true });
  });

  it("corregir un «No lo sé» a OTRO «No lo sé» NO lo resuelve", () => {
    const r = puedeValidarse({
      ...base,
      respuestasPaciente: { ...TODO_NO, circ: "NO_SE" },
      correcciones: [correccion("circ", "NO_SE")],
      estado: "RESPONDIDA",
      confirmaciones: LAS_TRES,
    });
    expect(r).toMatchObject({ motivo: "SIN_RESOLVER" });
  });

  it("sin las tres confirmaciones, no — y cada una falta por su cuenta", () => {
    for (const falta of ["alergias", "medicacion", "alertas"] as const) {
      const r = puedeValidarse({
        ...base,
        estado: "RESPONDIDA",
        confirmaciones: { ...LAS_TRES, [falta]: false },
      });
      expect(r).toEqual({
        puede: false,
        motivo: "FALTAN_CONFIRMACIONES",
        mensaje: "Marca las tres confirmaciones.",
      });
    }
  });

  it("sin ninguna confirmación, tampoco", () => {
    expect(
      puedeValidarse({
        ...base,
        estado: "RESPONDIDA",
        confirmaciones: CONFIRMACIONES_VACIAS,
      }),
    ).toMatchObject({ motivo: "FALTAN_CONFIRMACIONES" });
  });

  it("el «No lo sé» se pide ANTES que las casillas: es trabajo con el paciente delante", () => {
    const r = puedeValidarse({
      ...base,
      respuestasPaciente: { ...TODO_NO, circ: "NO_SE" },
      estado: "RESPONDIDA",
      confirmaciones: CONFIRMACIONES_VACIAS,
    });
    expect(r).toMatchObject({ motivo: "SIN_RESOLVER" });
  });

  it("si el paciente no ha contestado, no es que falte algo: no hay valoración", () => {
    expect(
      puedeValidarse({
        ...base,
        respuestasPaciente: {},
        estado: "PENDIENTE_PACIENTE",
        confirmaciones: LAS_TRES,
      }),
    ).toMatchObject({ motivo: "NO_RESPONDIDA" });
  });

  it("una valoración validada NO se re-valida: se repasa con una nueva", () => {
    expect(
      puedeValidarse({ ...base, estado: "VALIDADA", confirmaciones: LAS_TRES }),
    ).toMatchObject({ motivo: "YA_VALIDADA" });
  });

  it("una versión de cuestionario desconocida no se valida a ciegas", () => {
    expect(
      puedeValidarse({
        ...base,
        cuestionario: null,
        estado: "RESPONDIDA",
        confirmaciones: LAS_TRES,
      }),
    ).toMatchObject({ motivo: "VERSION_DESCONOCIDA" });
  });

  it("todas las negativas traen un mensaje que dice qué hacer", () => {
    const casos = [
      { estado: "PENDIENTE_PACIENTE" as const, confirmaciones: LAS_TRES },
      { estado: "VALIDADA" as const, confirmaciones: LAS_TRES },
      { estado: "RESPONDIDA" as const, confirmaciones: CONFIRMACIONES_VACIAS },
    ];
    for (const c of casos) {
      const r = puedeValidarse({ ...base, ...c });
      expect(r.puede).toBe(false);
      if (!r.puede) expect(r.mensaje.length).toBeGreaterThan(10);
    }
  });
});
