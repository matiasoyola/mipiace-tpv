// clinica-5 · el cuerpo de sesión v2: varios tipos, varias líneas a caja.
//
// Dos sabotajes del prompt viven aquí:
//
//   · **líneas a caja de dos tipos** · una visita con quiropodia y
//     revisión de cirugía pone DOS líneas, y la de quiropodia es la del
//     nivel elegido.
//   · **sesión v1 legible** · un cuerpo de clinica-3, tal cual, se sigue
//     leyendo y no finge tener tipos.

import { describe, expect, it } from "vitest";

import {
  normalizarSesionV2,
  productoDelNivel,
  resumenPorTipos,
  serviciosDeLaSesion,
  serviciosPorTipo,
  textoSinCobro,
  tiposDeLaSesion,
  esCuerpoV2,
  VERSION_DEL_CUERPO_V2,
  type CuerpoDeSesion,
  type CuerpoDeSesionV2,
  type EntradaDeCierreV2,
  type ServicioDeSesion,
} from "../src/index.js";

const HOY = "2026-10-07T10:30:00.000Z";

// El catálogo de Rosario, recortado: los tres niveles, dos extras de
// quiropodia, la cura de la revisión y la exploración biomecánica.
const BASICA = "11111111-1111-4111-8111-111111111111";
const COMPLETA = "22222222-2222-4222-8222-222222222222";
const EXTRA = "33333333-3333-4333-8333-333333333333";
const CURA = "44444444-4444-4444-8444-444444444444";
const PAPILOMA = "55555555-5555-4555-8555-555555555555";
const BIO = "66666666-6666-4666-8666-666666666666";

const CATALOGO: ServicioDeSesion[] = [
  { serviceId: BASICA, nombre: "Quiropodia básica", precio: 25, iva: 0, tipo: "QUIROPODIA", nivelQuiropodia: 1, causaExencion: "E1" },
  { serviceId: COMPLETA, nombre: "Quiropodia completa", precio: 26, iva: 0, tipo: "QUIROPODIA", nivelQuiropodia: 2, causaExencion: "E1" },
  { serviceId: EXTRA, nombre: "Quiropodia extra", precio: 27, iva: 0, tipo: "QUIROPODIA", nivelQuiropodia: 3, causaExencion: "E1" },
  { serviceId: PAPILOMA, nombre: "Tratamiento de papiloma", precio: 30, iva: 0, tipo: "QUIROPODIA", nivelQuiropodia: null, causaExencion: "E1" },
  { serviceId: CURA, nombre: "Cura", precio: 13, iva: 0, tipo: "CIRUGIA", nivelQuiropodia: null, causaExencion: "E1" },
  { serviceId: BIO, nombre: "Exploración biomecánica", precio: 35, iva: 0, tipo: "BIOMECANICA", nivelQuiropodia: null, causaExencion: "E1" },
];

function entrada(parche: Partial<EntradaDeCierreV2> = {}): EntradaDeCierreV2 {
  return {
    tipos: ["QUIROPODIA"],
    bloques: {},
    marcas: {},
    catalogo: CATALOGO,
    dolor: 4,
    evolucion: null,
    consejos: [],
    proximaCita: null,
    nota: null,
    alertaIds: [],
    pendientesAbiertos: [],
    pendientesCerradosAMano: [],
    pendientesNuevos: [],
    hoy: HOY,
    ...parche,
  };
}

describe("clinica-5 · el catálogo por tipo y por nivel", () => {
  it("cada nivel tiene su producto", () => {
    expect(productoDelNivel(CATALOGO, 1)).toBe(BASICA);
    expect(productoDelNivel(CATALOGO, 2)).toBe(COMPLETA);
    expect(productoDelNivel(CATALOGO, 3)).toBe(EXTRA);
  });

  it("un nivel sin producto en el catálogo: null, no un cobro a cero", () => {
    const sinExtra = CATALOGO.filter((s) => s.nivelQuiropodia !== 3);
    expect(productoDelNivel(sinExtra, 3)).toBeNull();
  });

  it("los botones de cada tipo NO incluyen los tres niveles", () => {
    // Un chip de «Quiropodia extra» al lado del selector de nivel sería la
    // misma línea cobrable por dos caminos.
    const porTipo = serviciosPorTipo(CATALOGO);
    expect(porTipo.QUIROPODIA.map((s) => s.serviceId)).toEqual([PAPILOMA]);
    expect(porTipo.CIRUGIA.map((s) => s.serviceId)).toEqual([CURA]);
    expect(porTipo.BIOMECANICA.map((s) => s.serviceId)).toEqual([BIO]);
    expect(porTipo.PIE_RIESGO).toEqual([]);
    expect(porTipo.GENERAL).toEqual([]);
  });
});

describe("clinica-5 · el cierre escribe un cuerpo v2", () => {
  it("con tipos, bloques, especialidad congelada y las versiones", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["QUIROPODIA"],
        bloques: { QUIROPODIA: { actos: ["corte", "helomas"] } },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo.v).toBe(VERSION_DEL_CUERPO_V2);
    expect(r.cuerpo.tipos).toEqual(["QUIROPODIA"]);
    // S5: la especialidad se congela en la entrada.
    expect(r.cuerpo.especialidad).toBe("PODOLOGIA");
    expect(r.cuerpo.listas.tipos).toBe(1);
    expect(r.cuerpo.listas.reglaDeNivel).toBe(1);
    // El nivel lo PROPONE el servidor con los mismos actos.
    expect(r.cuerpo.bloques.QUIROPODIA!.nivelPropuesto).toBe(2);
    expect(r.cuerpo.bloques.QUIROPODIA!.nivelElegido).toBe(2);
    expect(r.cuerpo.bloques.QUIROPODIA!.productoDelNivel).toBe(COMPLETA);
  });

  it("el nivel cambiado a mano se guarda con el propuesto al lado", () => {
    const r = normalizarSesionV2(
      entrada({
        bloques: { QUIROPODIA: { actos: ["corte", "helomas"], nivelElegido: 3 } },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // «Propuesto completa, cobrado extra» (decisión 4): las dos cosas
    // escritas, no una.
    expect(r.cuerpo.bloques.QUIROPODIA!.nivelPropuesto).toBe(2);
    expect(r.cuerpo.bloques.QUIROPODIA!.nivelElegido).toBe(3);
    expect(r.cuerpo.bloques.QUIROPODIA!.productoDelNivel).toBe(EXTRA);
  });

  it("un nivel inventado cae al propuesto", () => {
    const r = normalizarSesionV2(
      entrada({ bloques: { QUIROPODIA: { actos: ["fresado"], nivelElegido: 9 } } }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.bloques.QUIROPODIA!.nivelElegido).toBe(3);
  });

  it("el riesgo del pie se calcula y se CONGELA en el cuerpo", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["PIE_RIESGO"],
        bloques: {
          PIE_RIESGO: {
            sensibilidad: "PERDIDA",
            pulsos: { L: "AUSENTE", R: "PRESENTE" },
            ulcera: "SI",
            deformidad: "NO",
          },
        },
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    const b = r.cuerpo.bloques.PIE_RIESGO!;
    expect(b.riesgo!.categoria).toBe(3);
    expect(b.riesgo!.plazo).toBe("Revisión cada 1–3 meses");
    // Y las señales, para que la clasificación sea reproducible dentro de
    // cinco años aunque el criterio cambie.
    expect(b.riesgo!.senales.perdidaDeSensibilidad).toBe(true);
  });

  it("el riesgo sin las cuatro comprobaciones queda en null, no en 0", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["PIE_RIESGO"],
        bloques: { PIE_RIESGO: { sensibilidad: "NORMAL" } },
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.bloques.PIE_RIESGO!.riesgo).toBeNull();
  });

  it("sólo se escriben los bloques de los tipos marcados", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["CIRUGIA"],
        bloques: {
          CIRUGIA: { herida: "INFECCION", puntos: "RETIRADOS" },
          // Mandado de más por la pantalla: no se guarda, porque el tipo
          // no está marcado.
          BIOMECANICA: { tipoDePie: "PLANO", servicios: [BIO] },
        },
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(Object.keys(r.cuerpo.bloques)).toEqual(["CIRUGIA"]);
    expect(r.cuerpo.tratamientos).toEqual([]);
  });

  it("los tipos se guardan en el orden de la lista, no en el que se tocaron", () => {
    const r = normalizarSesionV2(
      entrada({ tipos: ["CIRUGIA", "QUIROPODIA", "QUIROPODIA"] }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.tipos).toEqual(["QUIROPODIA", "CIRUGIA"]);
  });

  it("un acto inventado no entra en la historia", () => {
    const r = normalizarSesionV2(
      entrada({ bloques: { QUIROPODIA: { actos: ["corte", "levitar"] } } }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.bloques.QUIROPODIA!.actos).toEqual(["corte"]);
  });

  it("un servicio de OTRO tipo no entra en el bloque", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["CIRUGIA"],
        // `PAPILOMA` es de quiropodia: no es una línea de la revisión.
        bloques: { CIRUGIA: { servicios: [CURA, PAPILOMA] } },
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.bloques.CIRUGIA!.servicios).toEqual([CURA]);
  });

  it("los avisos cruzados que se enseñaron quedan escritos", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["QUIROPODIA", "CIRUGIA"],
        alertaIds: ["antic", "diab"],
        bloques: {
          QUIROPODIA: { actos: ["helomas"] },
          CIRUGIA: { herida: "INFECCION" },
        },
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.avisos).toHaveLength(2);
    expect(r.cuerpo.avisos[0]).toMatch(/anticoagulada/i);
    expect(r.cuerpo.avisos[1]).toMatch(/48 h/);
  });

  it("sin tipos no se cierra (decisión 1: como mínimo uno)", () => {
    const r = normalizarSesionV2(entrada({ tipos: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("SIN_TIPOS");
    expect(r.mensaje).toMatch(/al menos un tipo/i);
  });

  it("sin dolor no se cierra, y el 0 SÍ es una respuesta", () => {
    expect(normalizarSesionV2(entrada({ dolor: null })).ok).toBe(false);
    expect(normalizarSesionV2(entrada({ dolor: 11 })).ok).toBe(false);
    expect(normalizarSesionV2(entrada({ dolor: 0 })).ok).toBe(true);
  });

  it("SÍ se cierra sin una sola línea de caja (regla 11)", () => {
    // Un control de pie de riesgo al que el centro no le ha puesto
    // servicio es una visita que PASÓ. Negarse a registrarla sería perder
    // la historia por una casilla del catálogo.
    const r = normalizarSesionV2(entrada({ tipos: ["PIE_RIESGO"] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuerpo.tratamientos).toEqual([]);
  });

  it("el cierre automático de un pendiente se recalcula en el servidor", () => {
    // No se cree lo que diga la pantalla: un pendiente cerrado sin haber
    // tocado la zona sería una revisión que consta hecha y no se hizo.
    const abierto = {
      id: "revisar_una",
      zona: "L:h",
      nota: null,
      desde: "2026-09-09T10:00:00.000Z",
    };
    const sinTocar = normalizarSesionV2(
      entrada({
        pendientesAbiertos: [abierto],
        pendientesCerradosAMano: [
          { id: "revisar_una", zona: "R:talon", como: "MANO" },
        ],
      }),
    );
    if (!sinTocar.ok) throw new Error("debería cerrar");
    // El cierre a mano de un pendiente que no estaba abierto no cuenta…
    expect(sinTocar.cuerpo.pendientesCerrados).toEqual([]);
    // …y el que sí estaba abierto se arrastra a hoy con su fecha.
    expect(sinTocar.cuerpo.pendientesCreados).toEqual([abierto]);

    const tocando = normalizarSesionV2(
      entrada({
        pendientesAbiertos: [abierto],
        marcas: { "L:h": { lesion: "unero", gravedad: "LEVE" } },
      }),
    );
    if (!tocando.ok) throw new Error("debería cerrar");
    expect(tocando.cuerpo.pendientesCerrados).toEqual([
      { id: "revisar_una", zona: "L:h", como: "ZONA" },
    ]);
    expect(tocando.cuerpo.pendientesCreados).toEqual([]);
  });
});

// ── EL SABOTAJE: líneas a caja de DOS tipos ─────────────────────────
describe("clinica-5 · dos tipos, dos líneas a caja (sabotaje)", () => {
  const dosTipos = entrada({
    tipos: ["QUIROPODIA", "CIRUGIA"],
    bloques: {
      QUIROPODIA: { actos: ["corte", "durezas", "helomas"] },
      CIRUGIA: { herida: "BIEN", puntos: "RETIRADOS", servicios: [CURA] },
    },
  });

  it("la derivación pone el producto del nivel Y el servicio tocado", () => {
    expect(
      serviciosDeLaSesion(
        ["QUIROPODIA", "CIRUGIA"],
        {
          QUIROPODIA: {
            actos: [],
            nivelPropuesto: 2,
            nivelElegido: 2,
            productoDelNivel: COMPLETA,
            servicios: [],
          },
          CIRUGIA: { herida: null, puntos: null, servicios: [CURA] },
        },
      ),
    ).toEqual([COMPLETA, CURA]);
  });

  it("y el cierre lo CONGELA en `tratamientos`, que es la puerta a caja", () => {
    const r = normalizarSesionV2(dosTipos);
    if (!r.ok) throw new Error("debería cerrar");
    expect(r.cuerpo.tratamientos).toEqual([COMPLETA, CURA]);
    // Y con su nombre, para que la historia se lea sin el catálogo.
    expect(r.cuerpo.tratamientosNombre).toEqual({
      [COMPLETA]: "Quiropodia completa",
      [CURA]: "Cura",
    });
  });

  it("la barra de caja las agrupa por tipo y suma", () => {
    const r = normalizarSesionV2(dosTipos);
    if (!r.ok) throw new Error("debería cerrar");
    const resumen = resumenPorTipos({
      tipos: r.cuerpo.tipos,
      bloques: r.cuerpo.bloques,
      catalogo: CATALOGO,
      dolor: 4,
      verImportes: true,
    });
    expect(resumen.lineas.map((l) => [l.tipo, l.nombre, l.precio])).toEqual([
      ["QUIROPODIA", "Quiropodia completa", 26],
      ["CIRUGIA", "Cura", 13],
    ]);
    expect(resumen.total).toBe(39);
    expect(resumen.sinCobro).toEqual([]);
    // iva-exento-sanitario: los dos son exentos, así que el pie lo dice
    // una vez y no «IVA 0 %».
    expect(resumen.ivaTexto).toBe("Exento · sanitario");
  });

  it("el MISMO servicio tocado en dos tipos es UNA línea", () => {
    // Dos líneas iguales en un ticket son dos cobros de lo mismo.
    const r = normalizarSesionV2(
      entrada({
        tipos: ["QUIROPODIA", "GENERAL"],
        bloques: {
          QUIROPODIA: { actos: ["corte"], servicios: [PAPILOMA] },
          GENERAL: { servicios: [PAPILOMA] },
        },
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    // `PAPILOMA` es de quiropodia, así que en GENERAL ni entra.
    expect(r.cuerpo.tratamientos).toEqual([BASICA, PAPILOMA]);
  });

  it("un tipo sin servicio se ve «sin cobro» y NO bloquea el cierre", () => {
    const resumen = resumenPorTipos({
      tipos: ["QUIROPODIA", "PIE_RIESGO"],
      bloques: {
        QUIROPODIA: {
          actos: ["corte"],
          nivelPropuesto: 1,
          nivelElegido: 1,
          productoDelNivel: BASICA,
          servicios: [],
        },
        PIE_RIESGO: {
          sensibilidad: null,
          pulsos: { L: null, R: null },
          ulcera: null,
          deformidad: null,
          riesgo: null,
          servicios: [],
        },
      },
      catalogo: CATALOGO,
      dolor: 3,
      verImportes: true,
    });
    // En este catálogo no hay NINGÚN servicio de la categoría de pie de
    // riesgo, así que el motivo es «sin servicio».
    expect(resumen.sinCobro).toEqual([
      { tipo: "PIE_RIESGO", motivo: "SIN_SERVICIO" },
    ]);
    expect(resumen.total).toBe(25);
    expect(resumen.puedeCerrar).toBe(true);
    expect(textoSinCobro(resumen.sinCobro)).toBe(
      "Pie de riesgo: sin cobro, no hay servicio en su categoría",
    );
    expect(textoSinCobro([])).toBeNull();
  });

  it("y «sin cobro» distingue «no hay servicio» de «no has marcado nada»", () => {
    // Lo encontró el BUCLE VISUAL, no un test: la barra decía «no hay
    // servicio asignado» de un pie de riesgo que tenía su consulta de
    // 20 € ahí al lado, sin marcar. Son dos cosas distintas y piden cosas
    // distintas: una es ir al catálogo, la otra es tocar un botón.
    const conConsulta: ServicioDeSesion[] = [
      ...CATALOGO,
      {
        serviceId: "99999999-9999-4999-8999-999999999999",
        nombre: "Consulta de pie de riesgo",
        precio: 20,
        iva: 0,
        tipo: "PIE_RIESGO",
        nivelQuiropodia: null,
      },
    ];
    const resumen = resumenPorTipos({
      // GENERAL y no BIOMECANICA: el catálogo de arriba SÍ tiene una
      // exploración biomecánica, así que ése saldría «no has marcado
      // nada». GENERAL no tiene ninguno.
      tipos: ["PIE_RIESGO", "GENERAL"],
      bloques: {
        PIE_RIESGO: {
          sensibilidad: null,
          pulsos: { L: null, R: null },
          ulcera: null,
          deformidad: null,
          riesgo: null,
          servicios: [],
        },
        GENERAL: { servicios: [] },
      },
      catalogo: conConsulta,
      dolor: 3,
      verImportes: true,
    });
    expect(resumen.sinCobro).toEqual([
      { tipo: "PIE_RIESGO", motivo: "NADA_MARCADO" },
      { tipo: "GENERAL", motivo: "SIN_SERVICIO" },
    ]);
    expect(textoSinCobro(resumen.sinCobro)).toBe(
      "General: sin cobro, no hay servicio en su categoría · Pie de riesgo: sin cobro, no has marcado nada",
    );
  });
});

describe("clinica-5 · la barra de caja y el sanitario sin caja", () => {
  const base = {
    tipos: ["QUIROPODIA"] as const,
    bloques: {
      QUIROPODIA: {
        actos: ["corte"],
        nivelPropuesto: 1 as const,
        nivelElegido: 1 as const,
        productoDelNivel: BASICA,
        servicios: [],
      },
    },
    catalogo: CATALOGO,
    dolor: 3,
  };

  it("quien NO ve importes no recibe ni un número que sea un precio", () => {
    const r = resumenPorTipos({ ...base, verImportes: false });
    expect(r.total).toBeNull();
    expect(r.ivaTexto).toBeNull();
    expect(r.lineas[0]!.precio).toBeNull();
    expect(r.lineas[0]!.iva).toBeNull();
    expect(r.lineas[0]!.causaExencion).toBeUndefined();
    // Y el botón no dice «cobrar»: quien no cobra no cobra.
    expect(r.textoDelBoton).toBe("Cerrar sesión");
  });

  it("quien los ve, sí, y su botón cobra", () => {
    const r = resumenPorTipos({ ...base, verImportes: true });
    expect(r.total).toBe(25);
    expect(r.textoDelBoton).toBe("Cerrar sesión y cobrar");
  });

  it("sin dolor, el botón no se puede pulsar", () => {
    const r = resumenPorTipos({ ...base, dolor: null, verImportes: true });
    expect(r.faltaDolor).toBe(true);
    expect(r.puedeCerrar).toBe(false);
  });

  it("sin tipos, tampoco", () => {
    const r = resumenPorTipos({
      tipos: [],
      bloques: {},
      catalogo: CATALOGO,
      dolor: 3,
      verImportes: true,
    });
    expect(r.faltaTipo).toBe(true);
    expect(r.puedeCerrar).toBe(false);
  });
});

// ── EL SABOTAJE: la sesión v1 se sigue leyendo ──────────────────────
describe("clinica-5 · una sesión v1 de clinica-3 se sigue leyendo (sabotaje)", () => {
  // Un cuerpo v1 REAL, con la forma exacta que escribe `normalizarSesion`
  // de clinica-3.
  const V1: CuerpoDeSesion = {
    v: 1,
    mapaVersion: 1,
    lesionesVersion: 1,
    consejosVersion: 1,
    marcas: { "L:h": { lesion: "callo", gravedad: "MODERADA" } },
    tratamientos: [BASICA, CURA],
    tratamientosNombre: {
      [BASICA]: "Quiropodia básica",
      [CURA]: "Cura",
    },
    dolor: 7,
    evolucion: "MEJOR",
    consejos: ["hidratar"],
    proximaCita: "S4",
    nota: null,
    firma: {
      autorNombre: "Lucía Martín",
      colegiado: "AST-123",
      firmadaEn: "2026-09-09T11:00:00.000Z",
    },
  };

  it("no se confunde con una v2", () => {
    expect(esCuerpoV2(V1)).toBe(false);
    expect(esCuerpoV2({ v: 2 })).toBe(true);
    // Una v3 futura se lee como v2 (tiene tipos y bloques), nunca como v1.
    expect(esCuerpoV2({ v: 3 })).toBe(true);
    expect(esCuerpoV2(null)).toBe(false);
    expect(esCuerpoV2({})).toBe(false);
  });

  it("al leer sus tipos, devuelve VACÍO y no finge", () => {
    expect(tiposDeLaSesion(V1)).toEqual({
      tipos: [],
      especialidad: null,
      bloques: {},
      pendientesCreados: [],
      pendientesCerrados: [],
      avisos: [],
    });
  });

  it("y lo que la v1 sí tiene se lee sin preguntar la versión", () => {
    // Es lo que hace que `lineas-de-la-sesion.ts`, `cobros-pendientes.ts`
    // y la pantalla de sesión cerrada no cambiaran una línea.
    expect(V1.tratamientos).toEqual([BASICA, CURA]);
    expect(V1.dolor).toBe(7);
    expect(V1.firma.colegiado).toBe("AST-123");
  });

  it("de una v2 se leen los tipos, los bloques y los pendientes", () => {
    const r = normalizarSesionV2(
      entrada({
        tipos: ["QUIROPODIA"],
        bloques: { QUIROPODIA: { actos: ["corte"] } },
        pendientesNuevos: [{ id: "control_riesgo", zona: null, nota: null }],
      }),
    );
    if (!r.ok) throw new Error("debería cerrar");
    const cuerpo: CuerpoDeSesionV2 = {
      ...r.cuerpo,
      firma: { autorNombre: "Lucía", colegiado: null, firmadaEn: HOY },
    };
    const leido = tiposDeLaSesion(cuerpo);
    expect(leido.tipos).toEqual(["QUIROPODIA"]);
    expect(leido.especialidad).toBe("PODOLOGIA");
    expect(leido.pendientesCreados).toHaveLength(1);
  });

  it("un cuerpo v2 roto (sin arrays) no revienta al leerse", () => {
    const roto = {
      v: 2,
      tipos: "QUIROPODIA",
      pendientesCreados: null,
    } as unknown as CuerpoDeSesionV2;
    expect(tiposDeLaSesion(roto)).toEqual({
      tipos: [],
      especialidad: null,
      bloques: {},
      pendientesCreados: [],
      pendientesCerrados: [],
      avisos: [],
    });
  });
});
