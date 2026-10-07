// clinica-5 · «Hoy toca» y «Para la próxima visita».
//
// El sabotaje del prompt: **un pendiente que no se cierra**. Lo que estos
// tests guardan es la cadena entera —se apunta, sale, se cierra solo al
// hacerlo, se pregunta si no, y lo que no se hizo pasa a la siguiente— y
// sobre todo el eslabón que nunca puede romperse: **un pendiente sin hacer
// no se cae nunca.**

import { describe, expect, it } from "vitest";

import {
  PENDIENTES_V1,
  cierresAutomaticos,
  claseDePendiente,
  claveDePendiente,
  pendienteLegible,
  pendientesACrear,
  pendientesAbiertos,
  pendientesQuePreguntar,
  seCierraSolo,
  type PendienteCreado,
} from "../src/index.js";

const AYER = "2026-09-09T10:30:00.000Z";
const HOY = "2026-10-07T10:30:00.000Z";

const UNA: PendienteCreado = {
  id: "revisar_una",
  zona: "L:h",
  nota: null,
  desde: AYER,
};

const SIN_NADA = {
  zonasTocadas: [] as string[],
  herida: null,
  tipos: [] as never[],
};

describe("clinica-5 · la lista de pendientes", () => {
  it("son los cinco del prompt", () => {
    expect(PENDIENTES_V1.clases.map((c) => c.id)).toEqual([
      "revisar_una",
      "retirar_puntos",
      "revisar_plantillas",
      "control_riesgo",
      "otro",
    ]);
  });

  it("cada clase tiene su pregunta para el diálogo del cierre", () => {
    for (const c of PENDIENTES_V1.clases) {
      expect(c.pregunta.endsWith("?")).toBe(true);
    }
    expect(claseDePendiente("revisar_una")!.pregunta).toBe(
      "¿Has revisado la uña operada?",
    );
  });

  it("sólo «Otro» pide nota, y sólo lo de la uña y los puntos piden zona", () => {
    expect(claseDePendiente("otro")!.pideNota).toBe(true);
    expect(claseDePendiente("revisar_una")!.pideZona).toBe(true);
    expect(claseDePendiente("retirar_puntos")!.pideZona).toBe(true);
    expect(claseDePendiente("control_riesgo")!.pideZona).toBe(false);
  });
});

describe("clinica-5 · leer lo que está abierto", () => {
  it("son los que creó la última sesión", () => {
    expect(pendientesAbiertos({ pendientesCreados: [UNA] })).toEqual([UNA]);
  });

  it("una sesión v1 (clinica-3) no tiene pendientes: lista vacía", () => {
    // No es que no tuviera ninguno: es que el concepto no existía cuando
    // se escribió, y eso es lo honesto.
    expect(pendientesAbiertos({})).toEqual([]);
    expect(pendientesAbiertos(null)).toEqual([]);
  });

  it("un pendiente de una clase que ya no existe no se ofrece", () => {
    expect(
      pendientesAbiertos({
        pendientesCreados: [{ id: "levitar", zona: null, nota: null, desde: AYER }],
      }),
    ).toEqual([]);
  });
});

describe("clinica-5 · se cierra SOLO al hacerlo", () => {
  it("tocando la zona EXACTA que nombra", () => {
    expect(seCierraSolo(UNA, { ...SIN_NADA, zonasTocadas: ["L:h"] })).toBe(
      "ZONA",
    );
  });

  it("tocando OTRA zona NO se cierra", () => {
    // Cerrarlo por tocar el talón cuando lo que había que revisar era el
    // dedo gordo sería una revisión que consta hecha y no se hizo.
    expect(
      seCierraSolo(UNA, { ...SIN_NADA, zonasTocadas: ["L:talon", "R:h"] }),
    ).toBeNull();
  });

  it("valorando la herida, en cualquier estado", () => {
    // Valorarla ES revisarla, aunque el veredicto sea «signos de
    // infección».
    for (const herida of ["CICATRIZADA", "BIEN", "EXUDADO", "INFECCION"]) {
      expect(seCierraSolo(UNA, { ...SIN_NADA, herida })).toBe("HERIDA");
    }
  });

  it("los puntos se cierran con la herida, no con la zona", () => {
    const puntos: PendienteCreado = {
      id: "retirar_puntos",
      zona: "L:h",
      nota: null,
      desde: AYER,
    };
    expect(
      seCierraSolo(puntos, { ...SIN_NADA, zonasTocadas: ["L:h"] }),
    ).toBeNull();
    expect(seCierraSolo(puntos, { ...SIN_NADA, herida: "BIEN" })).toBe(
      "HERIDA",
    );
  });

  it("las plantillas, con una visita de biomecánica", () => {
    const p: PendienteCreado = {
      id: "revisar_plantillas",
      zona: null,
      nota: null,
      desde: AYER,
    };
    expect(seCierraSolo(p, { ...SIN_NADA, tipos: ["BIOMECANICA"] })).toBe(
      "TIPO",
    );
    expect(seCierraSolo(p, { ...SIN_NADA, tipos: ["QUIROPODIA"] })).toBeNull();
  });

  it("el control de riesgo, con una visita de pie de riesgo", () => {
    const p: PendienteCreado = {
      id: "control_riesgo",
      zona: null,
      nota: null,
      desde: AYER,
    };
    expect(seCierraSolo(p, { ...SIN_NADA, tipos: ["PIE_RIESGO"] })).toBe(
      "TIPO",
    );
  });

  it("«Otro» NO se cierra solo con nada: si no sabemos qué es, no sabemos cuándo está hecho", () => {
    const p: PendienteCreado = {
      id: "otro",
      zona: null,
      nota: "Pedirle la analítica",
      desde: AYER,
    };
    expect(
      seCierraSolo(p, {
        zonasTocadas: ["L:h", "R:talon"],
        herida: "BIEN",
        tipos: ["QUIROPODIA", "PIE_RIESGO", "BIOMECANICA"],
      }),
    ).toBeNull();
  });

  it("una quiropodia NO cierra lo de la uña operada por ser quiropodia", () => {
    // El «solo» del prompt es literal: tocar esa zona o valorar esa
    // herida. No vale que la visita sea del tipo que toca.
    expect(
      seCierraSolo(UNA, { ...SIN_NADA, tipos: ["QUIROPODIA", "CIRUGIA"] }),
    ).toBeNull();
  });

  it("la lista entera, con su forma de cierre", () => {
    const plantillas: PendienteCreado = {
      id: "revisar_plantillas",
      zona: null,
      nota: null,
      desde: AYER,
    };
    expect(
      cierresAutomaticos([UNA, plantillas], {
        zonasTocadas: ["L:h"],
        herida: null,
        tipos: ["BIOMECANICA"],
      }),
    ).toEqual([
      { id: "revisar_una", zona: "L:h", como: "ZONA" },
      { id: "revisar_plantillas", zona: null, como: "TIPO" },
    ]);
  });
});

// ── EL SABOTAJE: el pendiente que no se cierra ──────────────────────
describe("clinica-5 · el pendiente que NO se cierra (sabotaje)", () => {
  it("se pregunta al cerrar", () => {
    const preguntar = pendientesQuePreguntar([UNA], [], SIN_NADA);
    expect(preguntar).toEqual([UNA]);
    expect(pendienteLegible(preguntar[0]!).pregunta).toBe(
      "¿Has revisado la uña operada?",
    );
  });

  it("no se pregunta por lo que se cerró solo", () => {
    expect(
      pendientesQuePreguntar([UNA], [], { ...SIN_NADA, zonasTocadas: ["L:h"] }),
    ).toEqual([]);
  });

  it("no se pregunta por lo que ya se marcó a mano", () => {
    expect(
      pendientesQuePreguntar(
        [UNA],
        [{ id: "revisar_una", zona: "L:h", como: "MANO" }],
        SIN_NADA,
      ),
    ).toEqual([]);
  });

  it("CONTESTANDO «todavía no», PASA A LA SIGUIENTE con su fecha original", () => {
    // Es el eslabón que no se puede romper. La podóloga dice «todavía no»
    // y el pendiente aparece en `pendientesCreados` de hoy, con el `desde`
    // de hace un mes — que es lo que deja escribir «4 semanas desde la
    // cirugía» la próxima vez.
    const creados = pendientesACrear({
      nuevos: [],
      abiertos: [UNA],
      cerrados: [],
      hoy: HOY,
    });
    expect(creados).toEqual([UNA]);
    expect(creados[0]!.desde).toBe(AYER);
  });

  it("y se cae SOLO si de verdad se cerró", () => {
    expect(
      pendientesACrear({
        nuevos: [],
        abiertos: [UNA],
        cerrados: [{ id: "revisar_una", zona: "L:h", como: "PREGUNTA" }],
        hoy: HOY,
      }),
    ).toEqual([]);
  });

  it("el pendiente de OTRA zona no se cae al cerrar el de ésta", () => {
    const derecho: PendienteCreado = { ...UNA, zona: "R:h" };
    expect(
      pendientesACrear({
        nuevos: [],
        abiertos: [UNA, derecho],
        cerrados: [{ id: "revisar_una", zona: "L:h", como: "ZONA" }],
        hoy: HOY,
      }),
    ).toEqual([derecho]);
    expect(claveDePendiente(UNA)).not.toBe(claveDePendiente(derecho));
  });
});

describe("clinica-5 · lo que se apunta para la próxima", () => {
  it("lo heredado va primero y lo nuevo después, con la fecha de hoy", () => {
    const creados = pendientesACrear({
      nuevos: [{ id: "control_riesgo", zona: null, nota: null }],
      abiertos: [UNA],
      cerrados: [],
      hoy: HOY,
    });
    expect(creados).toEqual([
      UNA,
      { id: "control_riesgo", zona: null, nota: null, desde: HOY },
    ]);
  });

  it("apuntar hoy lo que ya venía arrastrado NO lo duplica", () => {
    const creados = pendientesACrear({
      nuevos: [{ id: "revisar_una", zona: "L:h", nota: null }],
      abiertos: [UNA],
      cerrados: [],
      hoy: HOY,
    });
    // Se queda el heredado, con su fecha de siempre.
    expect(creados).toEqual([UNA]);
  });

  it("la clase que no pide zona no la guarda, y la que no pide nota tampoco", () => {
    const creados = pendientesACrear({
      nuevos: [
        { id: "control_riesgo", zona: "L:h", nota: "pegote" },
        { id: "otro", zona: "R:h", nota: "  Pedirle la analítica  " },
      ],
      abiertos: [],
      cerrados: [],
      hoy: HOY,
    });
    expect(creados).toEqual([
      { id: "control_riesgo", zona: null, nota: null, desde: HOY },
      { id: "otro", zona: null, nota: "Pedirle la analítica", desde: HOY },
    ]);
  });

  it("una clase inventada no entra en la historia", () => {
    expect(
      pendientesACrear({
        nuevos: [{ id: "levitar", zona: null, nota: null }],
        abiertos: [],
        cerrados: [],
        hoy: HOY,
      }),
    ).toEqual([]);
  });
});

describe("clinica-5 · cómo se lee un pendiente", () => {
  it("con el nombre de su zona y su pregunta", () => {
    expect(pendienteLegible(UNA)).toEqual({
      id: "revisar_una",
      titulo: "Revisar la uña operada",
      zona: "Pie izq. · Dedo gordo",
      nota: null,
      pregunta: "¿Has revisado la uña operada?",
      desde: AYER,
    });
  });

  it("un pendiente de una versión desconocida SE SIGUE VIENDO", () => {
    const raro: PendienteCreado = {
      id: "levitar",
      zona: null,
      nota: null,
      desde: AYER,
    };
    const l = pendienteLegible(raro, { pendientes: 99 });
    expect(l.titulo).toBe("levitar");
    expect(l.pregunta).toBe("¿Lo has hecho?");
  });
});
