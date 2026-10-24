// clinica-8 · NO SE ACTIVA UNA CLÍNICA QUE NO PUEDE COBRAR.
//
// La auditoría del 18-10 recorrió el alta entera de una clínica —CSV de
// Rosario cargado, 17 servicios exentos y reservables, cuenta activada— y
// la primera sesión cerró así:
//
//     Nivel de quiropodia: «sin servicio»
//     Nada que cobrar · no hay servicio en su categoría  →  0,00 €
//
// El catálogo estaba. Lo que faltaba eran las marcas de clínica, que hasta
// este bloque no entraban por el fichero y nadie comprobaba. Este check es
// la mitad que lo impide a tiempo: con la clínica encendida, la activación
// se bloquea hasta que el catálogo puede cobrar.
//
// Las tres preguntas y por qué cada una, en `medirCatalogoClinico`.

import { describe, expect, it } from "vitest";

import { computeOnboardingHealth } from "../src/superadmin/onboarding-health.js";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface Escenario {
  /** `false` = comercio sin historia clínica: el check no aplica. */
  clinica?: boolean;
  /** clinica-8 (fase B) · `true` = una residencia, que tiene la historia
   *  clínica encendida por diseño y no es una consulta que cobre por tipo
   *  de visita. El check tampoco aplica. */
  residencia?: boolean;
  categorias?: Array<{ slug: string; visitType: string }>;
  servicios?: Array<{
    tags: string[];
    nivelQuiropodia?: number | null;
    primeraValoracion?: boolean;
    /** clinica-9 (2) · «sale como botón dentro de la sesión». Sin esto,
     *  un servicio marcado como primera valoración no se puede cobrar en
     *  la visita en la que se usa. */
    tratamientoSesion?: boolean;
  }>;
}

// El catálogo de Rosario, ya configurado: cinco categorías con su tipo,
// los tres niveles de quiropodia y una primera valoración.
const ROSARIO: Required<Pick<Escenario, "categorias" | "servicios">> = {
  categorias: [
    { slug: "consulta", visitType: "GENERAL" },
    { slug: "quiropodia", visitType: "QUIROPODIA" },
    { slug: "cirugía", visitType: "CIRUGIA" },
    { slug: "biomecánica", visitType: "BIOMECANICA" },
    { slug: "órtesis", visitType: "GENERAL" },
  ],
  servicios: [
    { tags: ["consulta"], primeraValoracion: true, tratamientoSesion: true },
    { tags: ["quiropodia"], nivelQuiropodia: 1 },
    { tags: ["quiropodia"], nivelQuiropodia: 2 },
    { tags: ["quiropodia"], nivelQuiropodia: 3 },
    { tags: ["cirugía"] },
    { tags: ["biomecánica"] },
    { tags: ["órtesis"] },
  ],
};

function prismaFor(e: Escenario): any {
  return {
    tenant: {
      findUniqueOrThrow: async () => ({
        initialSyncStatus: "NOT_APPLICABLE",
        initialSyncCompletedAt: null,
        initialSyncStartedAt: null,
        initialSyncStats: null,
        cajaEnabled: true,
        crmEnabled: true,
        agendaEnabled: true,
        fichajeEnabled: false,
        holdedEnabled: false,
        holdedApiKeyCiphertext: null,
        clinicalRecordsEnabled: e.clinica ?? true,
        // clinica-8 (fase B) · una residencia tiene la historia clínica
        // encendida por diseño y NO es una clínica. Ver el último test.
        residenciaEnabled: e.residencia ?? false,
        fiscalProfile: {
          legalName: "Clínica de Podología Rosario SL",
          taxId: "B90000001",
        },
      }),
    },
    tenantTax: { count: async () => 0 },
    // Catálogo de sólo servicios, en verde (es el fallback de
    // `catalogo-servicios-csv`): lo único que puede bloquear aquí es el
    // check nuevo.
    product: {
      count: async (args: any) =>
        args?.where?.kind === "SERVICE" ? (e.servicios?.length ?? 0) : 0,
    },
    contact: { count: async () => 0 },
    ticket: { count: async () => 0, findFirst: async () => null },
    user: { findFirst: async () => ({ id: "u-test" }) },
    tagVisitType: { findMany: async () => e.categorias ?? [] },
    serviceScheduling: {
      findMany: async () =>
        (e.servicios ?? []).map((s) => ({
          nivelQuiropodia: s.nivelQuiropodia ?? null,
          primeraValoracion: s.primeraValoracion ?? false,
          tratamientoSesion: s.tratamientoSesion ?? false,
          product: { tags: s.tags },
        })),
    },
    $queryRaw: async () => [{ n: 0 }],
  };
}

async function check(e: Escenario) {
  const h = await computeOnboardingHealth(prismaFor(e) as never, TENANT_ID);
  const c = h.readinessChecks.find((x) => x.id === "catalogo-clinico");
  if (!c) throw new Error("el check del catálogo clínico no existe");
  return { c, ready: h.ready };
}

describe("clinica-8 · el check «Catálogo clínico completo»", () => {
  it("el catálogo de Rosario, completo: verde y la cuenta se puede activar", async () => {
    const { c, ready } = await check(ROSARIO);
    expect(c.applies).toBe(true);
    expect(c.ok).toBe(true);
    expect(c.value).toBe("completo");
    expect(ready).toBe(true);
  });

  it("SIN marcas de clínica —el catálogo del 18-10— BLOQUEA la activación", async () => {
    // Exactamente lo que la auditoría tenía delante: los 17 servicios
    // cargados, ninguna categoría con tipo, ningún nivel, ninguna
    // valoración. El TPV los vende; la sesión no cobra nada.
    const { c, ready } = await check({
      categorias: [],
      servicios: ROSARIO.servicios.map((s) => ({ tags: s.tags })),
    });
    expect(c.ok).toBe(false);
    expect(c.value).toContain("ninguna categoría tiene tipo de visita");
    expect(c.value).toContain("ningún servicio es la primera valoración");
    expect(ready).toBe(false);
  });

  it("con DOS niveles de quiropodia no basta: el tercero deja la sesión sin línea", async () => {
    const { c, ready } = await check({
      ...ROSARIO,
      servicios: ROSARIO.servicios.filter((s) => s.nivelQuiropodia !== 3),
    });
    expect(c.ok).toBe(false);
    expect(c.value).toContain("niveles de quiropodia sin servicio: 3");
    expect(ready).toBe(false);
  });

  it("una categoría con tipo y SIN servicio dentro: esa tarjeta no cobra nada", async () => {
    const { c } = await check({
      ...ROSARIO,
      servicios: ROSARIO.servicios.filter((s) => !s.tags.includes("cirugía")),
    });
    expect(c.ok).toBe(false);
    expect(c.value).toContain("cirugía (CIRUGIA)");
  });

  it("sin primera valoración, tampoco", async () => {
    const { c } = await check({
      ...ROSARIO,
      servicios: ROSARIO.servicios.map((s) => ({ ...s, primeraValoracion: false })),
    });
    expect(c.ok).toBe(false);
    expect(c.value).toContain("ningún servicio es la primera valoración");
  });

  // ── clinica-9 (2) · LA PRIMERA CONSULTA TIENE QUE PODER COBRARSE ──
  //
  // El CSV de Rosario traía «Consulta diagnóstico» con
  // `primera_valoracion=si` y `tratamiento_sesion=no`. Con el check de
  // clinica-8 eso salía COMPLETO: hay primera valoración. Y la pasada en
  // hierro del 24-10 cerró la primera visita de la paciente a 0 € porque
  // el servicio no salía en «Qué se cobra» de la sesión.
  //
  // Sabotaje: quítale el `else if` a `medirCatalogoClinico` y este test
  // se pone verde con el catálogo que no cobra.
  it("la primera valoración que NO es tratamiento de sesión bloquea", async () => {
    const { c, ready } = await check({
      ...ROSARIO,
      servicios: ROSARIO.servicios.map((s) =>
        s.primeraValoracion ? { ...s, tratamientoSesion: false } : s,
      ),
    });
    expect(c.ok).toBe(false);
    expect(c.value).toContain("la primera valoración no es tratamiento de sesión");
    expect(ready).toBe(false);
  });

  it("y el fichero corregido —las dos marcas— pasa", async () => {
    const { c, ready } = await check(ROSARIO);
    expect(c.ok).toBe(true);
    expect(ready).toBe(true);
  });

  it("un centro SIN quiropodia no tiene que inventarse los tres niveles", async () => {
    // Una fisioterapeuta no hace quiropodia. Exigirle los tres niveles
    // sería pedirle tres servicios falsos para poder activarse.
    const { c, ready } = await check({
      categorias: [{ slug: "fisio", visitType: "GENERAL" }],
      servicios: [
        { tags: ["fisio"], primeraValoracion: true, tratamientoSesion: true },
      ],
    });
    expect(c.ok).toBe(true);
    expect(ready).toBe(true);
  });

  it("y en un comercio SIN historia clínica el check NO APLICA", async () => {
    // Los catorce de hoy. «No aplica» no es ni cumplir ni fallar, y no
    // bloquea: es la misma forma que los checks de Holded en un comercio
    // sin Holded.
    const { c, ready } = await check({
      clinica: false,
      // Una peluquería con su catálogo en verde y sin nada clínico.
      servicios: [{ tags: ["peluqueria"] }],
    });
    expect(c.applies).toBe(false);
    expect(c.value).toBe("—");
    expect(ready).toBe(true);
  });

  // clinica-8 (fase B) · UNA RESIDENCIA NO ES UNA CLÍNICA.
  //
  // Lo encontró la CI al mergear master: `primer-acceso.e2e.ts` activa
  // una residencia desde cero y la activación se iba a
  // `ONBOARDING_NOT_READY · ["Catálogo clínico completo"]`. Y desde
  // dentro del check tenía razón: una residencia no declara tipos de
  // visita ni tiene servicios de podología, así que le faltaba TODO.
  //
  // El defecto era el ALCANCE del check, y era de la fase A:
  // `residenciaEnabled` enciende la historia clínica por diseño
  // (residencia-1), así que el check estaba bloqueando la activación de
  // **todas** las residencias. Jardín de Gredos entre ellas.
  it("y en una RESIDENCIA tampoco aplica, aunque tenga la historia clínica", async () => {
    const { c, ready } = await check({
      clinica: true,
      residencia: true,
      // Lo que de verdad tiene una residencia: ni una categoría con tipo
      // de visita, ni un servicio de podología. Sin esta puerta, las tres
      // preguntas del check fallan las tres.
      categorias: [],
      // Un servicio cualquiera, que es lo que el resto de los checks pide
      // (un catálogo con algo dentro). Lo que importa aquí es que NO es
      // de podología y no lleva marcas.
      servicios: [{ tags: ["cuidados"] }],
    });
    expect(c.applies).toBe(false);
    expect(c.value).toBe("—");
    expect(ready).toBe(true);
  });

  it("pero un centro MIXTO que no es residencia sigue midiéndose", async () => {
    // La puerta mira `residenciaEnabled`, no «tiene pocos servicios»: una
    // clínica a medias sigue bloqueada, que es para lo que existe.
    const { c, ready } = await check({
      clinica: true,
      residencia: false,
      categorias: [],
      servicios: [{ tags: ["cuidados"] }],
    });
    expect(c.applies).toBe(true);
    expect(c.ok).toBe(false);
    expect(ready).toBe(false);
  });
});
