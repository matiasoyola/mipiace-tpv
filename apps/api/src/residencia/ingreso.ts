// historia-1 (D-94) · **EL INGRESO GUIADO.**
//
// Hoy el ingreso de un residente nuevo no tiene lista: lo que falta se
// descubre cuando lo pide un inspector (R20 de
// `registros-exigidos-inspeccion.md`). Este fichero es la lista, sus doce
// elementos de serie y —la mitad que de verdad vale— **la comprobación de
// los que el sistema ya sabe**.
//
// ── LAS DOS FORMAS DE ESTAR HECHO, Y POR QUÉ LA SEGUNDA ─────────────
//
//   · **A mano** (`auto: false`): alguien lo marca, con su firma y su
//     fecha. El contrato firmado, el consentimiento de imagen, los
//     dispositivos revisados.
//   · **Solo** (`auto: true`): el elemento está hecho **cuando el dato
//     existe**. La cama asignada, el consentimiento de datos, la dieta
//     vigente, el plan de cuidados.
//
// Pedirle a la dirección que marque «cama asignada» cuando la cama ya
// está en la base es pedirle que copie un dato que el sistema tiene — y
// una lista que se copia a mano es una lista que miente el día que
// alguien marca sin haberlo hecho. Por eso el CHECK
// `admission_checklist_items_hecho_completo` **prohíbe marcar a mano un
// `auto`**: no es una costumbre, lo para el motor.
//
// ── POR QUÉ ALERGIAS ES `auto` Y DISPOSITIVOS NO ───────────────────
//
// Es la asimetría que llama la atención, y tiene una razón concreta.
//
// «Sin alergias conocidas» **tiene su propia tabla** (`allergy_reviews`,
// D-90) porque medicación (Fase 2) va a bloquear sobre la diferencia
// entre «nadie preguntó» y «se preguntó y no tiene»: ahí hace falta un
// dato, no una marca. Con ese dato, el elemento se comprueba solo.
//
// Los dispositivos **no bloquean nada**. Darles una tabla de revisión
// propia sería una tabla más para contestar «alguien lo miró», que es
// exactamente lo que la firma de un elemento marcado a mano ya dice. Se
// marca a mano, con su nota («no lleva ninguno»).
//
// ── Y DOS ELEMENTOS SIN PANTALLA TODAVÍA ───────────────────────────
//
// `ESCALAS_INICIALES` (historia-3) y `PAI_INICIAL` (historia-2) entran
// **con su fecha límite** aunque su pantalla no exista. La razón está en
// D-94: el plazo de 30 días del PAI **corre desde el ingreso**, así que
// meterlos cuando haya pantalla sería empezar a contar tarde — y el
// primer PAI que la inspección pida sería de un residente que ingresó
// hace cuatro meses.

import type { Prisma, PrismaClient } from "@mipiacetpv/db";
import { addDays } from "@mipiacetpv/residencia-plan";

type Ejecutor = PrismaClient | Prisma.TransactionClient;

/** Un elemento de la lista, como dato del producto. */
export interface ElementoDeSerie {
  code: string;
  /** Como se lee en la pantalla del ingreso y en el panel. */
  name: string;
  /** `true` = se comprueba, no se marca. Ver la cabecera. */
  auto: boolean;
  /**
   * A cuántos días del ingreso vence, o `null` si no vence: falta, y
   * punto. Un contrato no caduca.
   *
   * `"PAI"` significa «el plazo que el centro configura»
   * (`CenterAdmissionSetting.initialCarePlanDays`, 30 de serie): es el
   * único que no es un número aquí, porque es el único que el centro
   * puede cambiar.
   */
  plazo: number | "PAI" | null;
  /** `true` = admite un fichero adjunto (el contrato en PDF). */
  adjunto: boolean;
  sortOrder: number;
}

/**
 * **LOS DOCE ELEMENTOS DE SERIE DEL PRODUCTO** (D-94).
 *
 * Los diez del prompt más los dos con fecha y sin pantalla. Son código y
 * no una tabla por centro, al contrario que las obligaciones de dirección
 * (`management_duties`), y la razón es la frontera de siempre: **el
 * expediente del residente lo exige la inspección, no lo elige el
 * centro** (R20). Las obligaciones son la agenda de una dirección
 * concreta; esto es el mínimo legal, y un centro que pudiera quitar
 * «consentimiento de protección de datos» de su lista tendría una lista
 * que pasa y un expediente que no.
 *
 * Añadir un elemento en 2028 es una fila de aquí. Los que ya ingresaron
 * **no lo tendrán**, y es correcto: su lista es la que había cuando
 * ingresaron. La pantalla lo dice.
 */
export const ELEMENTOS_DE_SERIE: readonly ElementoDeSerie[] = [
  {
    code: "IDENTIDAD",
    name: "Datos de identidad completos",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 10,
  },
  {
    code: "CAMA",
    name: "Cama asignada",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 20,
  },
  {
    code: "CONTRATO",
    name: "Contrato firmado",
    auto: false,
    plazo: null,
    adjunto: true,
    sortOrder: 30,
  },
  {
    code: "CONSENT_DATOS",
    name: "Consentimiento de protección de datos",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 40,
  },
  {
    // A mano, y no `auto`. Si fuera automático, un residente cuya familia
    // NO autoriza la imagen se quedaría pendiente para siempre y el panel
    // de dirección lo pediría cada día — que es cómo se deja de mirar un
    // panel. El elemento es «se ha pedido», y la firma con su nota («la
    // hija no lo autoriza») es la evidencia de que se pidió. Que la foto
    // se pinte o no en el pasillo lo gobierna el consentimiento, no esto
    // (D-64).
    code: "CONSENT_IMAGEN",
    name: "Consentimiento de imagen pedido",
    auto: false,
    plazo: null,
    adjunto: false,
    sortOrder: 50,
  },
  {
    code: "FAMILIAR",
    name: "Familiar responsable",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 60,
  },
  {
    code: "ALERGIAS",
    name: "Alergias revisadas",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 70,
  },
  {
    code: "DIETA",
    name: "Dieta",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 80,
  },
  {
    code: "DISPOSITIVOS",
    name: "Dispositivos y ayudas revisados",
    auto: false,
    plazo: null,
    adjunto: false,
    sortOrder: 90,
  },
  {
    code: "PLAN_CUIDADOS",
    name: "Plan de cuidados vigente",
    auto: true,
    plazo: null,
    adjunto: false,
    sortOrder: 100,
  },
  {
    // historia-3. Sin pantalla todavía, con fecha desde hoy.
    //
    // 30 días como el PAI y no «al ingreso», que es lo que dice `03` §3:
    // un Barthel el primer día lo pasa alguien que acaba de llegar, está
    // desorientado y no colabora. El plazo deja margen para pasarlo
    // cuando la escala mida algo.
    code: "ESCALAS_INICIALES",
    name: "Escalas iniciales (Barthel, Lobo, Tinetti, Norton)",
    auto: false,
    plazo: 30,
    adjunto: false,
    sortOrder: 110,
  },
  {
    // historia-2. Sin pantalla todavía, con el plazo del centro.
    code: "PAI_INICIAL",
    name: "PAI inicial",
    auto: false,
    plazo: "PAI",
    adjunto: false,
    sortOrder: 120,
  },
] as const;

const POR_CODIGO = new Map(ELEMENTOS_DE_SERIE.map((e) => [e.code, e]));

export function elementoDeSerie(code: string): ElementoDeSerie | undefined {
  return POR_CODIGO.get(code);
}

export const CODIGOS_DE_ELEMENTO: readonly string[] = ELEMENTOS_DE_SERIE.map(
  (e) => e.code,
);

/** El plazo del PAI de serie, cuando el centro no ha configurado el suyo
 *  (`03` §7 y D-94). */
export const DIAS_DE_PAI_DE_SERIE = 30;

/**
 * **Crea la lista de un residente que ingresa.**
 *
 * Se llama desde la transacción del alta del residente, con
 * `skipDuplicates`: volver a llamarla no duplica nada ni resucita lo que
 * se marcó. Es lo mismo que `sembrarResidencia` hace con los roles.
 *
 * `ingreso` es la fecha de pared «YYYY-MM-DD», no un instante: los dos
 * plazos se cuentan en días de calendario desde el día del ingreso, y
 * sumar milisegundos a un timestamp se va una hora en marzo y en octubre
 * (la lección de `addDays` del paquete puro).
 */
export async function crearChecklistDeIngreso(
  prisma: Ejecutor,
  input: {
    tenantId: string;
    clientId: string;
    /** «YYYY-MM-DD». */
    ingreso: string;
    /** El plazo del PAI del centro. `undefined` = el de serie. */
    diasDePai?: number;
  },
): Promise<{ insertados: number }> {
  const diasDePai = input.diasDePai ?? DIAS_DE_PAI_DE_SERIE;
  const data = ELEMENTOS_DE_SERIE.map((e) => ({
    tenantId: input.tenantId,
    clientId: input.clientId,
    code: e.code,
    auto: e.auto,
    dueOn:
      e.plazo == null
        ? null
        : addDays(input.ingreso, e.plazo === "PAI" ? diasDePai : e.plazo),
  }));
  const r = await prisma.admissionChecklistItem.createMany({
    data,
    skipDuplicates: true,
  });
  return { insertados: r.count };
}

// ── EL ESTADO DE LA LISTA ───────────────────────────────────────────

/** Un elemento, como lo ve la pantalla. */
export interface ElementoEnPantalla {
  code: string;
  nombre: string;
  auto: boolean;
  adjunto: boolean;
  hecho: boolean;
  /** Para los `auto`: **por qué** está hecho o qué falta. Es lo que hace
   *  que la pantalla no parezca magia. */
  porque: string | null;
  dueOn: string | null;
  /** `true` = tiene plazo y ya pasó. */
  vencido: boolean;
  hechoEn: string | null;
  hechoPor: string | null;
  hechoComo: string | null;
  nota: string | null;
  tieneFichero: boolean;
  sortOrder: number;
}

/** La lista de un residente. */
export interface IngresoEnPantalla {
  clientId: string;
  nombre: string;
  ingreso: string;
  elementos: ElementoEnPantalla[];
  pendientes: number;
  vencidos: number;
}

/**
 * Lo que hace falta de la base para decidir los `auto` de un residente.
 *
 * Es una estructura y no cinco parámetros porque la lista se calcula para
 * **un residente o para los 49**, y en el segundo caso las consultas son
 * una por tabla y no una por residente. Ver `estadoDeLosIngresos`.
 */
export interface RealidadDelResidente {
  tieneNombre: boolean;
  tieneDocumento: boolean;
  tieneFechaDeNacimiento: boolean;
  tieneCama: boolean;
  tieneConsentimientoDeDatos: boolean;
  tieneFamiliar: boolean;
  alergiasRevisadas: boolean;
  tieneDieta: boolean;
  tienePlan: boolean;
}

/**
 * ¿Está hecho este elemento `auto`, y por qué?
 *
 * Devuelve la razón también cuando NO está hecho, y es la mitad del valor
 * de la pantalla: «falta el DNI» se arregla; «pendiente» no se sabe
 * dónde se arregla.
 */
function autoHecho(
  code: string,
  r: RealidadDelResidente,
): { hecho: boolean; porque: string } {
  switch (code) {
    case "IDENTIDAD": {
      const falta: string[] = [];
      if (!r.tieneNombre) falta.push("el nombre completo");
      if (!r.tieneDocumento) falta.push("el DNI o el NSS");
      if (!r.tieneFechaDeNacimiento) falta.push("la fecha de nacimiento");
      return falta.length === 0
        ? { hecho: true, porque: "Nombre, documento y fecha de nacimiento" }
        : { hecho: false, porque: `Falta ${falta.join(", ")}` };
    }
    case "CAMA":
      return r.tieneCama
        ? { hecho: true, porque: "Tiene cama asignada" }
        : { hecho: false, porque: "No tiene cama: asígnasela en Edificio" };
    case "CONSENT_DATOS":
      return r.tieneConsentimientoDeDatos
        ? { hecho: true, porque: "Firmado y vigente" }
        : { hecho: false, porque: "Sin firmar: se firma en su ficha" };
    case "FAMILIAR":
      return r.tieneFamiliar
        ? { hecho: true, porque: "Con nombre y teléfono" }
        : { hecho: false, porque: "Falta el familiar responsable o su teléfono" };
    case "ALERGIAS":
      return r.alergiasRevisadas
        ? { hecho: true, porque: "Revisadas, con autor y fecha" }
        : {
            hecho: false,
            // Y se dice literalmente, porque es la decisión de D-90: no
            // tener filas de alergia **no** es tenerlas revisadas.
            porque:
              "Sin revisar. No tener alergias apuntadas no es lo mismo que no tener alergias: hay que registrar «sin alergias conocidas»",
          };
    case "DIETA":
      return r.tieneDieta
        ? { hecho: true, porque: "Con dieta vigente" }
        : { hecho: false, porque: "Sin dieta registrada" };
    case "PLAN_CUIDADOS":
      return r.tienePlan
        ? { hecho: true, porque: "Con plan de cuidados vigente" }
        : { hecho: false, porque: "Sin plan: no le toca nada en su puerta" };
    default:
      // Un `auto` sin regla aquí sería un elemento que nunca se puede
      // cumplir: ni se marca (el CHECK lo prohíbe) ni se comprueba. Se
      // devuelve «no hecho» con el motivo a la vista en vez de
      // silenciarlo, que es lo que haría un `return { hecho: false }`
      // mudo.
      return {
        hecho: false,
        porque: "Este elemento se comprueba solo y el programa no sabe cómo. Avisa a Mi Piace.",
      };
  }
}

/**
 * **El estado de los ingresos de un centro**, o de uno solo.
 *
 * Una consulta por tabla para TODOS los residentes, no una lista por
 * residente: el panel de dirección pide los 49 y cincuenta veces nueve
 * consultas es lo que convierte un panel en una espera.
 *
 * `clientIds` acota. Sin él, **los que viven aquí hoy**: a quien se fue
 * no se le reclama el contrato.
 */
export async function estadoDeLosIngresos(
  prisma: Ejecutor,
  tenantId: string,
  opciones: { clientIds?: string[]; hoy?: string } = {},
): Promise<IngresoEnPantalla[]> {
  const hoy = opciones.hoy ?? new Date().toISOString().slice(0, 10);
  const perfiles = await prisma.residentProfile.findMany({
    where: {
      tenantId,
      ...(opciones.clientIds
        ? { clientId: { in: opciones.clientIds } }
        : { dischargeDate: null }),
    },
    select: {
      clientId: true,
      admissionDate: true,
      dni: true,
      dniCifrado: true,
      nss: true,
      nssCifrado: true,
      responsibleName: true,
      responsiblePhone: true,
      client: { select: { firstName: true, lastName: true, birthdate: true } },
    },
  });
  if (perfiles.length === 0) return [];
  const ids = perfiles.map((p) => p.clientId);

  const [elementos, camas, consentimientos, revisiones, dietas, planes] =
    await Promise.all([
      prisma.admissionChecklistItem.findMany({
        where: { tenantId, clientId: { in: ids } },
        select: {
          id: true,
          clientId: true,
          code: true,
          auto: true,
          dueOn: true,
          doneAt: true,
          doneNoteCifrado: true,
          fileName: true,
          doneBy: { select: { alias: true, email: true } },
          doneWith: { select: { careRole: { select: { name: true } } } },
        },
      }),
      prisma.bedAssignment.findMany({
        where: { tenantId, clientId: { in: ids }, toAt: null },
        select: { clientId: true },
      }),
      // El consentimiento de datos VIGENTE: una fila `DATA` que no sea
      // una revocación y a la que nadie haya revocado. La cuenta la hace
      // `@mipiacetpv/consentimientos` para el resto de la casa; aquí
      // basta con la pregunta binaria, y hacerla en SQL evita traerse
      // todos los consentimientos de 49 residentes.
      prisma.clientConsent.findMany({
        where: {
          tenantId,
          clientId: { in: ids },
          kind: "DATA",
          revokesConsentId: null,
          revocadoPor: { none: {} },
        },
        select: { clientId: true },
      }),
      prisma.allergyReview.findMany({
        where: { tenantId, clientId: { in: ids } },
        select: { clientId: true },
      }),
      prisma.dietProfile.findMany({
        where: { tenantId, clientId: { in: ids }, supersededAt: null },
        select: { clientId: true },
      }),
      prisma.carePlanItem.findMany({
        where: { tenantId, clientId: { in: ids }, toAt: null },
        select: { clientId: true },
      }),
    ]);

  const conCama = new Set(camas.map((c) => c.clientId));
  const conConsentimiento = new Set(consentimientos.map((c) => c.clientId));
  const conRevision = new Set(revisiones.map((r) => r.clientId));
  const conDieta = new Set(dietas.map((d) => d.clientId));
  const conPlan = new Set(planes.map((p) => p.clientId));

  return perfiles
    .map((p): IngresoEnPantalla => {
      const realidad: RealidadDelResidente = {
        tieneNombre:
          p.client.firstName.trim() !== "" && p.client.lastName.trim() !== "",
        // El cifrado o el claro: las filas de antes de residencia-1b
        // siguen con el claro puesto, y exigir el cifrado dejaría a los
        // residentes viejos con la identidad «incompleta» para siempre.
        tieneDocumento:
          (p.dniCifrado ?? p.dni) != null || (p.nssCifrado ?? p.nss) != null,
        tieneFechaDeNacimiento: p.client.birthdate != null,
        tieneCama: conCama.has(p.clientId),
        tieneConsentimientoDeDatos: conConsentimiento.has(p.clientId),
        tieneFamiliar:
          (p.responsibleName?.trim() ?? "") !== "" &&
          (p.responsiblePhone?.trim() ?? "") !== "",
        alergiasRevisadas: conRevision.has(p.clientId),
        tieneDieta: conDieta.has(p.clientId),
        tienePlan: conPlan.has(p.clientId),
      };
      const mios = elementos.filter((e) => e.clientId === p.clientId);
      const enPantalla: ElementoEnPantalla[] = mios
        .map((e): ElementoEnPantalla => {
          const serie = elementoDeSerie(e.code);
          const auto = autoHecho(e.code, realidad);
          const hecho = e.auto ? auto.hecho : e.doneAt != null;
          return {
            code: e.code,
            // El código tal cual si el elemento ya no está en el fichero:
            // es la lista de un residente que ingresó con otra versión
            // del producto, y esconderla sería esconder su expediente.
            nombre: serie?.name ?? e.code,
            auto: e.auto,
            adjunto: serie?.adjunto ?? false,
            hecho,
            porque: e.auto ? auto.porque : null,
            dueOn: e.dueOn,
            vencido: !hecho && e.dueOn != null && e.dueOn < hoy,
            hechoEn: e.doneAt?.toISOString() ?? null,
            hechoPor:
              e.doneBy == null
                ? null
                : e.doneBy.alias?.trim() || e.doneBy.email,
            hechoComo: e.doneWith?.careRole.name ?? null,
            // La nota va cifrada y **no se descifra aquí**: la lee la
            // ruta, que es la que tiene la DEK. Esto es el estado, no el
            // contenido — y el panel de dirección pide el estado de 49
            // residentes sin necesitar ni una nota.
            nota: null,
            tieneFichero: e.fileName != null,
            sortOrder: serie?.sortOrder ?? 999,
          };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
      return {
        clientId: p.clientId,
        nombre: `${p.client.firstName} ${p.client.lastName}`.trim(),
        ingreso: p.admissionDate.toISOString().slice(0, 10),
        elementos: enPantalla,
        pendientes: enPantalla.filter((e) => !e.hecho).length,
        vencidos: enPantalla.filter((e) => e.vencido).length,
      };
    })
    // Los que más deben, arriba; y a igualdad, el ingreso más reciente
    // primero: es el orden del panel de dirección. Estable, para que dos
    // capturas se puedan comparar.
    .sort(
      (a, b) =>
        b.vencidos - a.vencidos ||
        b.pendientes - a.pendientes ||
        b.ingreso.localeCompare(a.ingreso) ||
        a.clientId.localeCompare(b.clientId),
    );
}

/** Los dos plazos del centro, con los de serie cuando no hay fila. */
export async function plazosDelCentro(
  prisma: Ejecutor,
  tenantId: string,
): Promise<{ diasDePai: number; diasParaComunicarLaBaja: number | null }> {
  const fila = await prisma.centerAdmissionSetting.findUnique({
    where: { tenantId },
    select: { initialCarePlanDays: true, dischargeNoticeDays: true },
  });
  return {
    diasDePai: fila?.initialCarePlanDays ?? DIAS_DE_PAI_DE_SERIE,
    // **NULL de serie, a propósito** (D-96): el plazo de comunicación de
    // una baja es normativa autonómica, y escribir «15 días» porque suena
    // bien es prometer un plazo que puede no ser el de la Junta.
    diasParaComunicarLaBaja: fila?.dischargeNoticeDays ?? null,
  };
}
