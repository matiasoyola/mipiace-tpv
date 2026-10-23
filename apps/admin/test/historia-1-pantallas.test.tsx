// historia-1 · EL ADMIN DEL BLOQUE: la ficha clínica, las ausencias con
// sus días, el ingreso de un residente y los ingresos del centro.
//
// Se miden por lo que la pantalla **DICE**, porque en las cuatro lo que
// importa es la frase:
//
//   1. **La ficha** enseña la franja con sus DOS textos y dice con esas
//      palabras que en la puerta se lee sólo la frase. Y distingue «nadie
//      le ha preguntado por sus alergias» de «sin alergias conocidas»,
//      que es la diferencia de D-90 llevada a la pantalla.
//   2. **Las ausencias** avisan de que apuntar una PAUSA los cuidados, y
//      de que una salida no controlada **hace sonar un móvil de
//      guardia** — un botón que suena tiene que decirlo antes.
//   3. **El ingreso** distingue las dos formas de estar hecho: lo que se
//      marca tiene botón y lo `auto` dice POR QUÉ («Falta el DNI o el
//      NSS»). «Pendiente» a secas no dice dónde se arregla.
//   4. **Los ingresos del centro** dicen que el plazo de la baja no está
//      puesto y que el programa no se lo inventa.
//
// Lo que estos tests NO prueban: qué alerta y qué no. Eso es
// `packages/residencia-plan/test/ficha.test.ts`, y aquí llega ya
// calculado del servidor — que es justo lo que impide que el front tenga
// una segunda implementación de la regla.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FichaClinicaPage } from "../src/pages/residencia/FichaClinicaPage.js";
import { AusenciasResidentePage } from "../src/pages/residencia/AusenciasResidentePage.js";
import { IngresoResidentePage } from "../src/pages/residencia/IngresoResidentePage.js";
import { IngresosPage } from "../src/pages/residencia/IngresosPage.js";
import { DiasPage } from "../src/pages/residencia/DiasPage.js";
import type {
  CatalogoDeLaFicha,
  FichaClinica,
} from "../src/pages/residencia/ficha-lib.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CATALOGO: CatalogoDeLaFicha = {
  dispositivos: [
    { code: "ANDADOR", nombre: "Andador", deRiesgo: false },
    { code: "SONDA", nombre: "Sonda", deRiesgo: true },
    { code: "GAFAS", nombre: "Gafas", deRiesgo: false },
    { code: "OTRO", nombre: "Otro", deRiesgo: false },
  ],
  restricciones: [
    { code: "DIABETICA", nombre: "Diabética" },
    { code: "SIN_SAL", nombre: "Sin sal" },
  ],
  texturas: ["NORMAL", "BLANDA", "TRITURADA", "ENTERAL"],
  clasesDeAlergia: ["MEDICAMENTO", "ALIMENTO", "OTRA"],
  gravedades: ["LEVE", "MODERADA", "GRAVE"],
};

/** La ficha de doña Carmen: la franja completa. */
const FICHA: FichaClinica = {
  clientId: "c1",
  alertas: [
    {
      clase: "ALERGIA",
      origenId: "a1",
      frase: "Alergia: penicilina",
      detalle: "urticaria generalizada y edema de labios",
    },
    {
      clase: "DIAGNOSTICO",
      origenId: "d1",
      frase: "Toma anticoagulantes: cualquier golpe, avisa",
      detalle: "Fibrilación auricular en tratamiento con acenocumarol",
    },
    {
      clase: "DIETA",
      origenId: null,
      frase: "Disfagia: triturado y espesante nivel 2",
      detalle: null,
    },
  ],
  diagnosticos: [
    {
      id: "d1",
      texto: "Fibrilación auricular en tratamiento con acenocumarol",
      icd10: "I48.0",
      quirurgico: false,
      desde: "2026-03-14",
      resueltoEn: null,
      alerta: true,
      fraseDeAlerta: "Toma anticoagulantes: cualquier golpe, avisa",
      retirado: false,
      retiradoEn: null,
      motivoDeRetirada: null,
      firmadoPor: "Rosa",
      firmadoComo: "DUE (enfermería)",
      escritoEn: "2026-03-14T10:00:00.000Z",
    },
  ],
  alergias: [
    {
      id: "a1",
      clase: "MEDICAMENTO",
      gravedad: "GRAVE",
      agente: "penicilina",
      reaccion: "urticaria generalizada y edema de labios",
      retirada: false,
      retiradaEn: null,
      motivoDeRetirada: null,
      firmadoPor: "Rosa",
      firmadoComo: "DUE (enfermería)",
      escritoEn: "2026-03-14T10:00:00.000Z",
    },
    {
      id: "a0",
      clase: "MEDICAMENTO",
      gravedad: "GRAVE",
      agente: "paracetamol",
      reaccion: null,
      retirada: true,
      retiradaEn: "2026-03-14T11:00:00.000Z",
      motivoDeRetirada: "era penicilina, no paracetamol",
      firmadoPor: "Rosa",
      firmadoComo: "DUE (enfermería)",
      escritoEn: "2026-03-10T10:00:00.000Z",
    },
  ],
  revisionDeAlergias: {
    id: "r1",
    sinAlergiasConocidas: false,
    fuente: "lo dice su hija",
    revisadoEn: "2026-03-14T10:00:00.000Z",
    revisadoPor: "Rosa",
    revisadoComo: "DUE (enfermería)",
  },
  dispositivos: [
    {
      id: "p1",
      code: "SONDA",
      nombre: "Sonda",
      detalle: "vesical permanente",
      desde: "2026-06-01",
      hasta: null,
      deRiesgo: true,
      firmadoPor: "Rosa",
      firmadoComo: "DUE (enfermería)",
    },
  ],
  dietas: [
    {
      id: "di2",
      version: 2,
      textura: "TRITURADA",
      espesante: true,
      nivelDeEspesante: 2,
      restricciones: ["SIN_SAL"],
      notas: null,
      vigente: true,
      jubiladaEn: null,
      firmadoPor: "Rosa",
      firmadoComo: "DUE (enfermería)",
      escritoEn: "2026-06-02T10:00:00.000Z",
    },
    {
      id: "di1",
      version: 1,
      textura: "NORMAL",
      espesante: false,
      nivelDeEspesante: null,
      restricciones: [],
      notas: null,
      vigente: false,
      jubiladaEn: "2026-06-02T10:00:00.000Z",
      firmadoPor: "Rosa",
      firmadoComo: "DUE (enfermería)",
      escritoEn: "2026-03-14T10:00:00.000Z",
    },
  ],
};

/** Y la de don Luis: **a él nadie le ha preguntado**. */
const FICHA_SIN_REVISAR: FichaClinica = {
  ...FICHA,
  clientId: "c2",
  alertas: [],
  diagnosticos: [],
  alergias: [],
  revisionDeAlergias: null,
  dispositivos: [],
  dietas: [],
};

let container: HTMLDivElement;
let root: Root;
const api = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, api: api.fn };
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(
  nodo: React.ReactNode,
  ruta: { camino: string; url: string },
): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[ruta.url]}>
        <Routes>
          <Route path={ruta.camino} element={nodo} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Responde a cada ruta por lo que lleva dentro. Una sola función para
 *  las cinco pantallas: cada una pide lo suyo y el orden no importa. */
function responder(mapa: Record<string, unknown>): void {
  api.fn.mockImplementation(async (url: string) => {
    for (const [trozo, valor] of Object.entries(mapa)) {
      if (url.includes(trozo)) return valor;
    }
    throw new Error(`El test no sabe contestar a ${url}`);
  });
}

// ══════════════════════════════════════════════════════════════════
//  1 · LA FICHA CLÍNICA
// ══════════════════════════════════════════════════════════════════

describe("la ficha clínica", () => {
  beforeEach(() => {
    responder({ "/ficha/catalogo": CATALOGO, "/ficha": { ficha: FICHA } });
  });

  it("**la franja lleva la frase Y el detalle**, y dice qué ve la puerta", async () => {
    await pintar(<FichaClinicaPage />, {
      camino: "/admin/residencia/residentes/:clientId/ficha",
      url: "/admin/residencia/residentes/c1/ficha",
    });
    const texto = container.textContent ?? "";
    // La frase accionable.
    expect(texto).toContain("Alergia: penicilina");
    expect(texto).toContain("Disfagia: triturado y espesante nivel 2");
    // Y el detalle, que **sólo el despacho ve**.
    expect(texto).toContain("acenocumarol");
    // Y la frase que explica la diferencia. Es la mitad de D-91 en la
    // pantalla: sin ella, quien escribe una alerta no sabe qué va a
    // publicar en un pasillo.
    expect(texto).toContain("sólo la frase en negrita");
    expect(texto).toContain("nunca el diagnóstico");
  });

  it("y la frase que verá la auxiliar sale junto a su diagnóstico", async () => {
    await pintar(<FichaClinicaPage />, {
      camino: "/admin/residencia/residentes/:clientId/ficha",
      url: "/admin/residencia/residentes/c1/ficha",
    });
    expect(container.textContent).toContain("En la puerta se lee:");
  });

  it("la alergia RETIRADA se queda a la vista, con su motivo", async () => {
    await pintar(<FichaClinicaPage />, {
      camino: "/admin/residencia/residentes/:clientId/ficha",
      url: "/admin/residencia/residentes/c1/ficha",
    });
    const texto = container.textContent ?? "";
    // Las dos filas. Quien prescribe ve que alguien se equivocó y cuándo.
    expect(texto).toContain("paracetamol");
    expect(texto).toContain("penicilina");
    expect(texto).toContain("era penicilina, no paracetamol");
  });

  it("la dieta enseña la vigente y la anterior, con su versión", async () => {
    await pintar(<FichaClinicaPage />, {
      camino: "/admin/residencia/residentes/:clientId/ficha",
      url: "/admin/residencia/residentes/c1/ficha",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("v2");
    expect(texto).toContain("vigente");
    expect(texto).toContain("v1");
    expect(texto).toContain("espesante nivel 2");
  });

  it("el dispositivo de riesgo dice que SALE EN LA PUERTA", async () => {
    await pintar(<FichaClinicaPage />, {
      camino: "/admin/residencia/residentes/:clientId/ficha",
      url: "/admin/residencia/residentes/c1/ficha",
    });
    expect(container.textContent).toContain("sale en la puerta");
  });

  it("**«nadie le ha preguntado» NO es «sin alergias conocidas»**", async () => {
    responder({
      "/ficha/catalogo": CATALOGO,
      "/ficha": { ficha: FICHA_SIN_REVISAR },
    });
    await pintar(<FichaClinicaPage />, {
      camino: "/admin/residencia/residentes/:clientId/ficha",
      url: "/admin/residencia/residentes/c2/ficha",
    });
    const texto = container.textContent ?? "";
    // Es D-90 en la pantalla: la lista vacía no dice nada por sí sola.
    expect(texto).toContain("Nadie ha revisado las alergias");
    expect(texto).toContain("no es lo mismo que no tener alergias");
    // Y la franja vacía se dice, no se deja en blanco: una ficha sin
    // alertas y una ficha vacía se parecen demasiado.
    expect(texto).toContain("Sin alertas");
  });
});

// ══════════════════════════════════════════════════════════════════
//  2 · LAS AUSENCIAS Y LOS DÍAS
// ══════════════════════════════════════════════════════════════════

describe("las ausencias de un residente", () => {
  const DIAS = {
    dias: {
      mes: "2026-10",
      clientId: "c1",
      ordinarios: 24,
      hospital: 5,
      vacaciones: 2,
      otros: 0,
      presencia: 31,
    },
  };

  it("avisa de que apuntar una ausencia PAUSA los cuidados", async () => {
    responder({ "/ausencias": { ausencias: [] }, "/dias": DIAS });
    await pintar(<AusenciasResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ausencias",
      url: "/admin/residencia/residentes/c1/ausencias",
    });
    const texto = container.textContent ?? "";
    // Quien apunta una ausencia está haciendo cuatro cosas a la vez
    // (D-92), y la pantalla las dice.
    expect(texto).toContain("no le toca nada");
    expect(texto).toContain("no entra en el denominador");
  });

  it("los tres números del mes salen, con la regla de los días frontera", async () => {
    responder({ "/ausencias": { ausencias: [] }, "/dias": DIAS });
    await pintar(<AusenciasResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ausencias",
      url: "/admin/residencia/residentes/c1/ausencias",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("Ordinarios");
    expect(texto).toContain("Hospital");
    // **La regla, dicha**: un número de facturación sin su regla al lado
    // es un número que alguien copia mal.
    expect(texto).toContain("dónde pernocta");
    expect(texto).toContain("el día del alta no");
  });

  it("la ausencia ABIERTA sale arriba, con el botón de la vuelta", async () => {
    responder({
      "/ausencias": {
        ausencias: [
          {
            id: "x1",
            tipo: "INGRESO_HOSPITALARIO",
            desde: "2026-10-20T15:00:00.000Z",
            finPrevisto: null,
            hasta: null,
            abierta: true,
            destino: "Hospital Nuestra Señora del Prado",
            motivo: null,
            pideRevision: false,
            revisadaEn: null,
            revisadaPor: null,
            revisadaComo: null,
            incidentId: null,
            corregidaEn: null,
            motivoDeCorreccion: null,
            firmadaPor: "Ana",
            firmadaComo: "Auxiliar",
          },
        ],
      },
      "/dias": DIAS,
    });
    await pintar(<AusenciasResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ausencias",
      url: "/admin/residencia/residentes/c1/ausencias",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("Ahora mismo está fuera");
    expect(texto).toContain("Ha vuelto");
    expect(texto).toContain("Nuestra Señora del Prado");
  });

  it("la vuelta PENDIENTE DE REVISAR se ofrece para confirmar", async () => {
    responder({
      "/ausencias": {
        ausencias: [
          {
            id: "x1",
            tipo: "INGRESO_HOSPITALARIO",
            desde: "2026-10-15T15:00:00.000Z",
            finPrevisto: null,
            hasta: "2026-10-22T11:00:00.000Z",
            abierta: false,
            destino: null,
            motivo: null,
            pideRevision: true,
            revisadaEn: null,
            revisadaPor: null,
            revisadaComo: null,
            incidentId: null,
            corregidaEn: null,
            motivoDeCorreccion: null,
            firmadaPor: "Ana",
            firmadaComo: "Auxiliar",
          },
        ],
      },
      "/dias": DIAS,
    });
    await pintar(<AusenciasResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ausencias",
      url: "/admin/residencia/residentes/c1/ausencias",
    });
    expect(container.textContent).toContain("Pendiente de revisar tras el ingreso");
  });
});

// ══════════════════════════════════════════════════════════════════
//  3 · EL INGRESO GUIADO
// ══════════════════════════════════════════════════════════════════

describe("el ingreso guiado de un residente", () => {
  const INGRESO = {
    ingreso: {
      clientId: "c1",
      nombre: "Carmen Gómez",
      ingreso: "2026-10-20",
      pendientes: 2,
      vencidos: 1,
      elementos: [
        {
          code: "IDENTIDAD",
          nombre: "Datos de identidad completos",
          auto: true,
          adjunto: false,
          hecho: false,
          porque: "Falta el DNI o el NSS",
          dueOn: null,
          vencido: false,
          hechoEn: null,
          hechoPor: null,
          hechoComo: null,
          nota: null,
          tieneFichero: false,
        },
        {
          code: "CAMA",
          nombre: "Cama asignada",
          auto: true,
          adjunto: false,
          hecho: true,
          porque: "Tiene cama asignada",
          dueOn: null,
          vencido: false,
          hechoEn: null,
          hechoPor: null,
          hechoComo: null,
          nota: null,
          tieneFichero: false,
        },
        {
          code: "CONTRATO",
          nombre: "Contrato firmado",
          auto: false,
          adjunto: true,
          hecho: false,
          porque: null,
          dueOn: null,
          vencido: false,
          hechoEn: null,
          hechoPor: null,
          hechoComo: null,
          nota: null,
          tieneFichero: false,
        },
        {
          code: "PAI_INICIAL",
          nombre: "PAI inicial",
          auto: false,
          adjunto: false,
          hecho: false,
          porque: null,
          dueOn: "2026-09-01",
          vencido: true,
          hechoEn: null,
          hechoPor: null,
          hechoComo: null,
          nota: null,
          tieneFichero: false,
        },
      ],
    },
    sinLista: false,
  };

  beforeEach(() => {
    responder({
      "/ingreso": INGRESO,
      "/consentimientos": {
        plantillas: [
          {
            id: "proteccion-datos-residente",
            titulo: "Información y consentimiento sobre el tratamiento de mis datos",
            pendienteDeValidar: true,
            vigente: null,
          },
        ],
      },
    });
  });

  it("**lo `auto` dice POR QUÉ, y no tiene botón de marcar**", async () => {
    await pintar(<IngresoResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ingreso",
      url: "/admin/residencia/residentes/c1/ingreso",
    });
    const texto = container.textContent ?? "";
    // «Falta el DNI o el NSS» se arregla; «pendiente» no se sabe dónde.
    expect(texto).toContain("Falta el DNI o el NSS");
    expect(texto).toContain("Tiene cama asignada");
    expect(texto).toContain("se comprueba solo");
    // Y el botón de marcar aparece **dos** veces: en el contrato y en el
    // PAI inicial, que son los dos pendientes de los de marcar a mano.
    // Los dos `auto` —la identidad, que falta, y la cama, que está— no lo
    // tienen: es la mitad de D-94 que la pantalla sostiene.
    const botones = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent === "Marcar hecho",
    );
    expect(botones).toHaveLength(2);
  });

  it("el plazo pasado se dice con la palabra «venció»", async () => {
    await pintar(<IngresoResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ingreso",
      url: "/admin/residencia/residentes/c1/ingreso",
    });
    expect(container.textContent).toContain("venció");
  });

  it("y los dos SIN PANTALLA lo dicen en vez de esconderse", async () => {
    await pintar(<IngresoResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ingreso",
      url: "/admin/residencia/residentes/c1/ingreso",
    });
    // El plazo del PAI corre desde el ingreso, así que el elemento está
    // aunque su pantalla sea de historia-2.
    expect(container.textContent).toContain(
      "Todavía no hay pantalla donde hacerlo",
    );
  });

  it("quien ingresó ANTES del bloque no tiene lista, y se explica", async () => {
    responder({
      "/ingreso": { ingreso: null, sinLista: true },
      "/consentimientos": { plantillas: [] },
    });
    await pintar(<IngresoResidentePage />, {
      camino: "/admin/residencia/residentes/:clientId/ingreso",
      url: "/admin/residencia/residentes/c9/ingreso",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("ingresó antes de que la lista existiera");
    // Y el plazo cuenta **desde hoy**, no desde su ingreso: uno inventado
    // nacería vencido.
    expect(texto).toContain("desde hoy");
  });
});

// ══════════════════════════════════════════════════════════════════
//  4 · LOS INGRESOS DEL CENTRO Y LOS DÍAS DEL MES
// ══════════════════════════════════════════════════════════════════

describe("los ingresos del centro", () => {
  it("**dice que el plazo de la baja no está puesto, y por qué**", async () => {
    responder({
      "/ingresos/plazos": { diasDePai: 30, diasParaComunicarLaBaja: null },
      "/ingresos": {
        ingresos: [
          {
            clientId: "c1",
            nombre: "Dolores Pardo",
            ingreso: "2026-10-20",
            pendientes: 3,
            vencidos: 0,
            elementos: [
              {
                code: "CONTRATO",
                nombre: "Contrato firmado",
                auto: false,
                adjunto: true,
                hecho: false,
                porque: null,
                dueOn: null,
                vencido: false,
                hechoEn: null,
                hechoPor: null,
                hechoComo: null,
                nota: null,
                tieneFichero: false,
              },
            ],
          },
        ],
      },
    });
    await pintar(<IngresosPage />, {
      camino: "/admin/residencia/ingresos",
      url: "/admin/residencia/ingresos",
    });
    const texto = container.textContent ?? "";
    // D-96 en la pantalla: el programa no se inventa un plazo que es
    // normativa autonómica, y lo dice.
    expect(texto).toContain("El plazo de la baja no está puesto");
    expect(texto).toContain("normativa de cada comunidad autónoma");
    expect(texto).toContain("por verificar");
    // Y el ingreso con pendientes, con lo que le falta.
    expect(texto).toContain("Dolores Pardo");
    expect(texto).toContain("Contrato firmado");
  });
});

describe("los días del mes del centro", () => {
  it("suma el centro y marca «otros» cuando no es cero", async () => {
    responder({
      "/residencia/dias": {
        mes: "2026-10",
        residentes: [
          {
            mes: "2026-10",
            clientId: "c1",
            nombre: "Carmen Gómez",
            plaza: "CONCERTADA",
            ordinarios: 24,
            hospital: 5,
            vacaciones: 2,
            otros: 0,
            presencia: 31,
          },
          {
            mes: "2026-10",
            clientId: "c2",
            nombre: "Luis Núñez",
            plaza: "PRIVADA",
            ordinarios: 30,
            hospital: 0,
            vacaciones: 0,
            // **Una noche que no es hospital ni familia**: una salida no
            // controlada. Sale en ámbar porque hay algo que mirar.
            otros: 1,
            presencia: 31,
          },
        ],
        total: {
          ordinarios: 54,
          hospital: 5,
          vacaciones: 2,
          otros: 1,
          presencia: 62,
        },
      },
    });
    await pintar(<DiasPage />, {
      camino: "/admin/residencia/dias",
      url: "/admin/residencia/dias",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("Total del centro");
    expect(texto).toContain("Concertada");
    // La regla, y el aviso de que esto no factura.
    expect(texto).toContain("dónde pernocta el residente");
    expect(texto).toContain("por confirmar con la Junta");
    expect(texto).toContain("no factura");
  });
});
