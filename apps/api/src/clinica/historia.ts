// clinica-6 · LA HISTORIA VIVA, en una sola llamada.
//
// Lo que la pantalla pinta al abrir la ficha de un paciente: la cabecera
// con la franja roja, «Carmen en 10 segundos», el pie vivo, la lista de
// visitas y los documentos. Todo **YA CALCULADO** por las funciones puras
// de `@mipiacetpv/clinica-sesion` (`historia.ts`), por la misma razón que
// clinica-5 dio: la pantalla no recalcula reglas clínicas por su cuenta,
// porque dos cálculos son dos verdades y la podóloga vería la del
// navegador.
//
// ── NO ESCRIBE NADA ───────────────────────────────────────────────────
//
// Ni una tabla, ni una columna, ni una migración. Todo sale de
// `clinical_entries` (clinica-3 y -5) y `clinical_assessments`
// (clinica-2). Si algo del mockup no tiene dato, la respuesta trae su
// hueco honesto (`null`, lista vacía) y la pantalla lo dice.
//
// ── Y NO LLEVA NI UN IMPORTE ─────────────────────────────────────────
//
// Decisión 8 del prompt: *sin importes en ningún sitio de esta pantalla;
// es historia, no caja.* Así que aquí no hay `verImportes` que ramificar:
// **nadie** ve precios, ni la dueña. Lo que se lee del cuerpo de cada
// sesión son los NOMBRES congelados (`tratamientosNombre`), que es lo que
// hace legible la historia y nunca llevó precio (clinica-3 §8.4).
//
// Un test recorre la respuesta entera buscando claves de dinero con valor
// numérico, igual que el de clinica-3.
//
// ── Una llamada y no cinco ───────────────────────────────────────────
//
// Mismo argumento que `vistaDeLaSesion`: es UNA pantalla, y la franja roja
// de alertas pintándose un instante después del pie es exactamente el modo
// de fallo que una señal de seguridad no puede tener.

import {
  estadoDeLasZonas,
  hoyToca,
  LESIONES_V1,
  MAPA_PIE_V1,
  marcasLegibles,
  ojoDeHoy,
  PENDIENTES_V1,
  pendientesAbiertos,
  tendenciaDelDolor,
  tipoRecomendado,
  TIPOS_DE_VISITA,
  tiposDeLaSesion,
  ultimaVisita,
  visitaDeLaHistoria,
  visitaLegible,
  type CuerpoDeSesionCualquiera,
  type HoyToca,
  type Marcas,
  type MarcaLegible,
  type OjoDeHoy,
  type PendienteCreado,
  type Recomendada,
  type TendenciaDelDolor,
  type VisitaLegible,
  type ZonaViva,
} from "@mipiacetpv/clinica-sesion";
import type { Alerta } from "@mipiacetpv/clinica-valoracion";
import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { edadDe, ultimaExploracion } from "./sesion.js";
import { vistaDeLaValoracion } from "./valoracion.js";

/**
 * Cuántas visitas entran en la historia viva.
 *
 * No es una página: es la VENTANA sobre la que se calcula el estado de
 * cada zona, y por eso tiene que ser generosa. Doscientas visitas son
 * ocho años de quiropodia cada dos semanas.
 *
 * Lo que NO se hace es callarse el recorte: la respuesta trae
 * `totalDeVisitas`, y la pantalla dice «y N más» cuando sobran. Un tope
 * silencioso se lee como «esto es todo lo que hay», que en una historia
 * clínica es la clase de mentira que este bloque existe para quitar.
 */
export const VISITAS_DE_LA_HISTORIA = 200;

/** Las últimas N para la mini-gráfica de dolor. Las mismas seis que la
 *  gráfica de clinica-3: más barras no son una gráfica, son una textura. */
const DOLOR_EN_LA_TARJETA = 6;

// ── La forma de la respuesta ─────────────────────────────────────────

export interface CabeceraDeLaHistoria {
  paciente: {
    id: string;
    nombre: string;
    /** Las dos iniciales del avatar. */
    iniciales: string;
    edad: number | null;
    telefono: string | null;
    /** ISO-8601 del alta del paciente. «Paciente desde sep 2026». */
    desde: string;
  };
  /** La franja roja, con el MISMO origen y los MISMOS ids que la sesión de
   *  clinica-3: `vistaDeLaValoracion` → `alertasDe`. Aquí no se calcula
   *  ninguna alerta nueva. */
  alertas: readonly string[];
  alertaIds: readonly string[];
  /** `true` mientras la valoración no esté validada. La franja se enseña
   *  igual (clinica-2: no esconderlas es la decisión segura) y lo dice. */
  alertasPorValidar: boolean;
}

export interface EnDiezSegundos {
  hoyToca: HoyToca | null;
  dolor: TendenciaDelDolor;
  ultimaVez: VisitaLegible | null;
  ojoHoy: OjoDeHoy | null;
}

export interface SensibilidadDeLaHistoria {
  fecha: string;
  autor: string;
  /** Las claves del mapa donde NO siente el monofilamento. */
  sinSensibilidad: readonly string[];
  pulsos: { L: string; R: string };
  tipoDePie: string;
  /** Cuántos puntos de los 22 siente. «9 de 9» del mockup, con el número
   *  de zonas de verdad del mapa de la casa. */
  puntosConSensibilidad: number;
  puntosTotales: number;
}

export interface DocumentoDeLaHistoria {
  clase: "VALORACION";
  titulo: string;
  fecha: string | null;
  /** Las dos líneas de abajo: quién respondió, cuántas correcciones. */
  detalles: readonly string[];
  /** Lo que se puede abrir. `null` = sólo se lee la fila. */
  abre: "VALORACION" | null;
}

export interface VistaDeLaHistoria {
  cabecera: CabeceraDeLaHistoria;
  enDiezSegundos: EnDiezSegundos;
  /** El pie vivo: una entrada por zona que haya tenido marca alguna vez. */
  zonas: readonly ZonaViva[];
  /** La capa de sensibilidad. `null` sin ninguna exploración. */
  sensibilidad: SensibilidadDeLaHistoria | null;
  /** Las visitas, de la más reciente a la más antigua. */
  visitas: readonly VisitaLegible[];
  totalDeVisitas: number;
  documentos: readonly DocumentoDeLaHistoria[];
  /** Cuál se recomienda al abrir «Nueva visita». */
  recomendada: Recomendada | null;
  /** Los pendientes abiertos, tal cual, para la hoja de «Nueva visita». */
  pendientes: readonly PendienteCreado[];
  /** Las listas con las que se pinta, con su versión — igual que en la
   *  sesión: la pantalla no importa «la que tiene compilada». */
  listas: {
    mapa: typeof MAPA_PIE_V1;
    lesiones: typeof LESIONES_V1;
    pendientes: typeof PENDIENTES_V1;
    tipos: readonly string[];
  };
  /** El momento con el que se calculó «hace N semanas». Viaja para que la
   *  pantalla no tenga que preguntarle la hora a la tablet, que puede
   *  estar mal puesta. */
  ahora: string;
}

/** El detalle de UNA visita, de solo lectura. Es lo que `SesionCerrada`
 *  pinta, **sin su bloque de caja**: aquí no hay importes. */
export interface DetalleDeVisita {
  entryId: string;
  cerradaEn: string;
  firma: { autorNombre: string; colegiado: string | null; firmadaEn: string };
  cuerpo: CuerpoDeSesionCualquiera;
  marcas: readonly MarcaLegible[];
}

// ── La lectura ───────────────────────────────────────────────────────

interface FilaDeVisita {
  id: string;
  body: Prisma.JsonValue;
  createdAt: Date;
}

function cuerpoDe(fila: FilaDeVisita): CuerpoDeSesionCualquiera | null {
  const b = fila.body as unknown;
  if (b == null || typeof b !== "object") return null;
  return b as CuerpoDeSesionCualquiera;
}

/**
 * Todo lo que la historia viva pinta, de una vez.
 *
 * `ahora` entra por la puerta y no se lee del reloj aquí dentro por lo de
 * siempre en este bloque: lo que decide «hace cuatro semanas» tiene que
 * poder fijarse en un test sin congelar el reloj del proceso.
 */
export async function vistaDeLaHistoria(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; ahora: Date },
): Promise<VistaDeLaHistoria> {
  const { tenantId, clientId } = input;

  const [paciente, valoracion, filas, totalDeVisitas, exploracion] =
    await Promise.all([
      prisma.client.findFirstOrThrow({
        where: { id: clientId, tenantId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          birthdate: true,
          createdAt: true,
        },
      }),
      // Las alertas salen de AQUÍ, igual que en la sesión: mismo origen,
      // mismos ids, misma función pura. No hay una segunda lista.
      vistaDeLaValoracion(prisma, { tenantId, clientId }),
      prisma.clinicalEntry.findMany({
        where: { tenantId, clientId, kind: "TREATMENT_SESSION" },
        orderBy: { createdAt: "desc" },
        take: VISITAS_DE_LA_HISTORIA,
        select: { id: true, body: true, createdAt: true },
      }),
      prisma.clinicalEntry.count({
        where: { tenantId, clientId, kind: "TREATMENT_SESSION" },
      }),
      ultimaExploracion(prisma, { tenantId, clientId }),
    ]);

  // De la más reciente a la más antigua, que es como se lee la lista.
  const visitas = filas.map((f: FilaDeVisita) =>
    visitaLegible(cuerpoDe(f), {
      entryId: f.id,
      fecha: f.createdAt.toISOString(),
    }),
  );
  const paraElPie = filas.map((f: FilaDeVisita) =>
    visitaDeLaHistoria(cuerpoDe(f), {
      entryId: f.id,
      fecha: f.createdAt.toISOString(),
    }),
  );

  // «Hoy toca» sale de los `pendientesCreados` de la ÚLTIMA sesión
  // cerrada, y de ninguna otra: al cerrar, lo que sigue abierto se vuelve
  // a crear, así que lo abierto está siempre en un solo sitio
  // (clinica-5 · `pendientes.ts`).
  const ultimaFila = filas[0] ?? null;
  const pendientes = pendientesAbiertos(
    ultimaFila ? (cuerpoDe(ultimaFila) as { pendientesCreados?: readonly PendienteCreado[] }) : null,
  );
  const versionesDeLaUltima = versionesDe(ultimaFila ? cuerpoDe(ultimaFila) : null);

  const puntos = [...visitas]
    .filter((v) => v.dolor != null)
    .slice(0, DOLOR_EN_LA_TARJETA)
    .reverse()
    .map((v) => ({ fecha: v.fecha, dolor: v.dolor as number }));

  const ultima = ultimaVisita(visitas);
  const alertas = valoracion.alertas.alertas;

  return {
    cabecera: {
      paciente: {
        id: paciente.id,
        nombre: `${paciente.firstName} ${paciente.lastName}`.trim(),
        iniciales: iniciales(paciente.firstName, paciente.lastName),
        edad: edadDe(paciente.birthdate),
        telefono: paciente.phone,
        desde: paciente.createdAt.toISOString(),
      },
      alertas: alertas.map((a: Alerta) => a.texto),
      alertaIds: alertas.map((a: Alerta) => a.preguntaId),
      alertasPorValidar: valoracion.valoracion?.estado !== "VALIDADA",
    },
    enDiezSegundos: {
      hoyToca: hoyToca(pendientes, versionesDeLaUltima),
      dolor: tendenciaDelDolor(puntos),
      ultimaVez: ultima,
      ojoHoy: ojoDeHoy(alertas),
    },
    zonas: estadoDeLasZonas(paraElPie),
    sensibilidad: exploracion
      ? {
          fecha: exploracion.fecha,
          autor: exploracion.autor,
          sinSensibilidad: exploracion.exploracion.sinSensibilidad,
          pulsos: exploracion.exploracion.pulsos,
          tipoDePie: exploracion.exploracion.tipoDePie,
          puntosConSensibilidad:
            MAPA_PIE_V1.zonas.length * 2 -
            exploracion.exploracion.sinSensibilidad.length,
          puntosTotales: MAPA_PIE_V1.zonas.length * 2,
        }
      : null,
    visitas,
    totalDeVisitas,
    documentos: documentosDe(valoracion),
    recomendada: tipoRecomendado({
      pendientes,
      alertaIds: alertas.map((a: Alerta) => a.preguntaId),
      ultimosTipos: ultima?.tipos ?? [],
    }),
    pendientes,
    listas: {
      mapa: MAPA_PIE_V1,
      lesiones: LESIONES_V1,
      pendientes: PENDIENTES_V1,
      tipos: TIPOS_DE_VISITA,
    },
    ahora: input.ahora.toISOString(),
  };
}

/**
 * Las DOS iniciales del avatar. Si sólo hay una palabra, la primera letra
 * y nada más: «CR» inventado de un «Carmen» a secas sería un apellido que
 * no se ha dicho.
 */
function iniciales(nombre: string, apellido: string): string {
  return [nombre, apellido]
    .map((x) => x.trim().charAt(0).toUpperCase())
    .filter((x) => x !== "")
    .join("");
}

function versionesDe(
  cuerpo: CuerpoDeSesionCualquiera | null,
): { pendientes?: number; mapa?: number } {
  const c = cuerpo as { listas?: { pendientes?: number }; mapaVersion?: number } | null;
  return {
    pendientes: c?.listas?.pendientes,
    mapa: c?.mapaVersion,
  };
}

/**
 * LOS DOCUMENTOS. Hoy sólo hay uno: la valoración.
 *
 * **Los consentimientos y el informe son de clinica-4**, y aquí NO
 * aparecen — ni siquiera desactivados con un «Llega pronto». El motivo es
 * de producto y no de código: una fila gris con el nombre de un documento
 * que no existe le dice a la podóloga que hay algo que no encuentra, y
 * durante las semanas que tarde clinica-4 esa fila es una pregunta de
 * soporte cada vez que alguien abra la pestaña. La pestaña enseña lo que
 * hay; cuando haya consentimientos, aparecerán.
 */
function documentosDe(
  valoracion: Awaited<ReturnType<typeof vistaDeLaValoracion>>,
): readonly DocumentoDeLaHistoria[] {
  const v = valoracion.valoracion;
  if (!v) return [];
  const detalles: string[] = [];
  if (v.respondioPor === "FAMILIAR") {
    // Y NO «Respondió su hija Ana», que es lo que pinta el mockup: el
    // cuestionario de clinica-2 pregunta si contesta el paciente o un
    // familiar, y **no pide el nombre ni el parentesco**. Escribir «su
    // hija Ana» aquí sería inventarse quién estuvo delante.
    detalles.push("Respondió un familiar");
  } else if (v.respondioPor === "PACIENTE") {
    detalles.push("Respondió el paciente");
  }
  if (valoracion.correcciones.length > 0) {
    detalles.push(
      valoracion.correcciones.length === 1
        ? "1 corrección"
        : `${valoracion.correcciones.length} correcciones`,
    );
  }
  return [
    {
      clase: "VALORACION",
      titulo:
        v.estado === "VALIDADA"
          ? "Valoración inicial · validada"
          : v.estado === "RESPONDIDA"
            ? "Valoración inicial · sin validar"
            : "Valoración inicial · sin responder",
      fecha: v.validadaEn ?? v.respondidaEn ?? v.creadaEn,
      detalles,
      abre: "VALORACION",
    },
  ];
}

/**
 * El detalle de UNA visita, para abrirla de solo lectura.
 *
 * Se lee por su `entryId` y se comprueba que es de este paciente y de este
 * tenant: la ruta cuelga del paciente, así que el id de la entrada no
 * puede elegir contra qué historia se comprueba el acceso (la misma
 * lección que las anotaciones de clinica-1).
 */
export async function detalleDeVisita(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string; entryId: string },
): Promise<DetalleDeVisita | null> {
  const fila = await prisma.clinicalEntry.findFirst({
    where: {
      id: input.entryId,
      tenantId: input.tenantId,
      clientId: input.clientId,
      kind: "TREATMENT_SESSION",
    },
    select: { id: true, body: true, createdAt: true },
  });
  if (!fila) return null;
  const cuerpo = cuerpoDe(fila);
  if (!cuerpo) return null;
  const c = cuerpo as {
    marcas?: Marcas;
    mapaVersion?: number;
    lesionesVersion?: number;
    firma?: { autorNombre: string; colegiado: string | null; firmadaEn: string };
  };
  return {
    entryId: fila.id,
    cerradaEn: fila.createdAt.toISOString(),
    firma: c.firma ?? {
      autorNombre: "—",
      colegiado: null,
      firmadaEn: fila.createdAt.toISOString(),
    },
    cuerpo,
    marcas: marcasLegibles({
      marcas: (c.marcas ?? {}) as Marcas,
      mapaVersion: c.mapaVersion ?? MAPA_PIE_V1.version,
      lesionesVersion: c.lesionesVersion ?? LESIONES_V1.version,
    }),
  };
}

/** Los tipos de una visita ya cerrada, para abrir la sesión siguiente con
 *  el mismo tipo marcado. Lo usa la hoja de «Nueva visita». */
export function tiposDeUnaVisita(
  cuerpo: CuerpoDeSesionCualquiera | null,
): readonly string[] {
  return tiposDeLaSesion(cuerpo).tipos;
}
