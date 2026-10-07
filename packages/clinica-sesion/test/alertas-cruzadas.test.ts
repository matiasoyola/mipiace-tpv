// clinica-5 · las alertas cruzadas con lo que se está haciendo.
//
// El sabotaje del prompt: «alerta cruzada». Lo que estos tests guardan es
// que el cruce se hace por la ID de la alerta y no por su texto, que no
// salta de más, y que no se repite — porque un aviso de seguridad que
// aparece dos veces es un aviso que se deja de leer.

import { describe, expect, it } from "vitest";

import {
  ALERTAS_CRUZADAS_V1,
  alertasCruzadasDeVersion,
  avisosCruzados,
  type TablaDeAlertasCruzadas,
} from "../src/index.js";

const SIN_NADA = {
  alertaIds: [] as string[],
  tipos: [] as never[],
  actos: [] as string[],
  herida: null,
};

describe("clinica-5 · anticoagulada × lo que corta", () => {
  it("enucleación de helomas: avisa", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["antic"],
      tipos: ["QUIROPODIA"],
      actos: ["corte", "helomas"],
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.aviso).toMatch(/anticoagulada/i);
    expect(a[0]!.aviso).toMatch(/hemostático/i);
  });

  it("uña encarnada: avisa", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["antic"],
      tipos: ["QUIROPODIA"],
      actos: ["onico"],
    });
    expect(a).toHaveLength(1);
  });

  it("cirugía marcada, sin ningún acto: avisa igual", () => {
    // La revisión de cirugía no tiene actos, así que el disparador es el
    // TIPO. Sin esa fila, una anticoagulada con la uña recién operada no
    // vería el aviso.
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["antic"],
      tipos: ["CIRUGIA"],
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.disparador).toEqual({ clase: "TIPO", id: "CIRUGIA" });
  });

  it("corte y deslaminado SOLOS: no avisa (no cortan carne)", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["antic"],
      tipos: ["QUIROPODIA"],
      actos: ["corte", "durezas"],
    });
    expect(a).toEqual([]);
  });

  it("no está anticoagulada: no avisa aunque se enuclee", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["diab"],
      tipos: ["QUIROPODIA"],
      actos: ["helomas"],
    });
    expect(a).toEqual([]);
  });

  it("DOS disparadores de la misma alerta: UN aviso, no dos", () => {
    // Enuclear un heloma Y tratar una uña encarnada a la misma
    // anticoagulada es un aviso. Repetirlo sería ruido en una señal de
    // seguridad.
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["antic"],
      tipos: ["QUIROPODIA", "CIRUGIA"],
      actos: ["helomas", "onico"],
    });
    expect(a).toHaveLength(1);
  });
});

describe("clinica-5 · diabética × signos de infección", () => {
  it("avisa con el plazo dentro", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["diab"],
      tipos: ["CIRUGIA"],
      herida: "INFECCION",
    });
    expect(a).toHaveLength(1);
    expect(a[0]!.aviso).toMatch(/48 h/);
    expect(a[0]!.aviso).toMatch(/derivar/i);
  });

  it("la herida en otro estado: no avisa", () => {
    for (const herida of ["CICATRIZADA", "BIEN", "EXUDADO"]) {
      const a = avisosCruzados({
        ...SIN_NADA,
        alertaIds: ["diab"],
        tipos: ["CIRUGIA"],
        herida,
      });
      expect(a).toEqual([]);
    }
  });

  it("infección sin diabetes: no avisa de las 48 h", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["antic"],
      tipos: ["CIRUGIA"],
      herida: "INFECCION",
    });
    // Sí el de la anticoagulación, por el tipo CIRUGIA. Pero ni uno de
    // infección.
    expect(a).toHaveLength(1);
    expect(a[0]!.alertaId).toBe("antic");
  });
});

describe("clinica-5 · las dos a la vez", () => {
  it("diabética Y anticoagulada, con infección y enucleación: DOS avisos", () => {
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["diab", "antic", "aler"],
      tipos: ["QUIROPODIA", "CIRUGIA"],
      actos: ["helomas"],
      herida: "INFECCION",
    });
    expect(a).toHaveLength(2);
    // En el orden de la TABLA, no en el de las alertas del paciente: el de
    // sangrado es el que cambia lo que se hace ahora mismo.
    expect(a.map((x) => x.alertaId)).toEqual(["antic", "diab"]);
  });

  it("una alerta sin ninguna fila en la tabla no inventa aviso", () => {
    // «Alérgica al látex» está en la franja roja y no cruza con nada
    // todavía. Que no cruce no es un hueco: es que esa fila no se ha
    // escrito, y escribirla es añadir una línea.
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["aler"],
      tipos: ["QUIROPODIA"],
      actos: ["helomas"],
    });
    expect(a).toEqual([]);
  });
});

// ── EL SABOTAJE: la tabla es dato ───────────────────────────────────
describe("clinica-5 · la tabla de cruces es DATO (sabotaje)", () => {
  it("una fila nueva desde fuera dispara un aviso nuevo", () => {
    const conLatex: TablaDeAlertasCruzadas = {
      version: 99,
      reglas: [
        ...ALERTAS_CRUZADAS_V1.reglas,
        {
          alertaId: "aler",
          disparador: { clase: "ACTO", id: "corte" },
          aviso: "Alérgica: comprueba los guantes.",
        },
      ],
    };
    const a = avisosCruzados(
      { ...SIN_NADA, alertaIds: ["aler"], tipos: ["QUIROPODIA"], actos: ["corte"] },
      conLatex,
    );
    expect(a).toHaveLength(1);
    expect(a[0]!.aviso).toMatch(/guantes/);
  });

  it("quitar una fila apaga su aviso", () => {
    const sinSangrado: TablaDeAlertasCruzadas = {
      version: 99,
      reglas: ALERTAS_CRUZADAS_V1.reglas.filter(
        (r) => r.alertaId !== "antic",
      ),
    };
    const a = avisosCruzados(
      { ...SIN_NADA, alertaIds: ["antic"], tipos: ["QUIROPODIA"], actos: ["helomas"] },
      sinSangrado,
    );
    expect(a).toEqual([]);
  });

  it("la tabla se busca por versión, y una desconocida no cae a la de hoy", () => {
    expect(alertasCruzadasDeVersion(1)).toBe(ALERTAS_CRUZADAS_V1);
    expect(alertasCruzadasDeVersion(99)).toBeUndefined();
  });

  it("el cruce es por ID de alerta, nunca por su texto", () => {
    // Si alguien cruzara por el texto («Anticoagulación»), corregir una
    // tilde en el cuestionario apagaría la alerta en silencio. Este test
    // lo comprueba por el lado contrario: el texto de la alerta NO
    // dispara nada.
    const a = avisosCruzados({
      ...SIN_NADA,
      alertaIds: ["Anticoagulación"],
      tipos: ["QUIROPODIA"],
      actos: ["helomas"],
    });
    expect(a).toEqual([]);
    expect(ALERTAS_CRUZADAS_V1.reglas.map((r) => r.alertaId)).toEqual([
      "antic",
      "antic",
      "antic",
      "diab",
    ]);
  });
});
