// clinica-4 · el doble de Prisma para los tres caminos del bloque:
// consentimientos, fotos e informe.
//
// Vive fuera de cada fichero de test porque los tres comparten el MISMO
// mundo —un paciente, su valoración, sus sesiones, sus consentimientos— y
// tres copias del doble serían tres mundos que se separan. Es el mismo
// argumento con el que `fake-z-reports.ts` salió de los dos ficheros que
// cierran un turno.
//
// Lo que este doble reproduce es sólo lo que el código de producción da
// por hecho:
//
//   · `client_consents` es de SOLO INSERCIÓN: este doble **no tiene
//     `update` ni `delete`**, así que un camino que lo intentara se cae
//     con «is not a function» antes de llegar a Postgres. (La garantía de
//     verdad es el trigger, y eso se prueba contra Postgres en el e2e.)
//   · `clinical_photos` admite UNA transición: la retirada.
//   · `clinical_report_deliveries` es de solo inserción.

import { randomUUID } from "node:crypto";

export const TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const OTRO_TENANT = "00000000-0000-0000-0000-000000000002";
export const DUENA_ID = "11111111-1111-1111-1111-111111111111";
export const SANITARIA_ID = "22222222-2222-2222-2222-222222222222";
export const RECEPCION_ID = "33333333-3333-3333-3333-333333333333";
export const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";
export const AJENA_ID = "44444444-4444-4444-4444-444444444446";
export const CITA_ID = "55555555-5555-5555-5555-555555555555";
export const SERVICIO_CIRUGIA = "66666666-6666-6666-6666-666666666661";
export const SERVICIO_QUIROPODIA = "66666666-6666-6666-6666-666666666662";

export interface FakeUser {
  id: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  isClinician: boolean;
  clinicalScope: "ALL" | "SELECTION";
  alias: string | null;
  email: string;
  clinicianLicense: string | null;
  deletedAt: Date | null;
  isSystemActor: boolean;
}

export interface FakeConsent {
  id: string;
  tenantId: string;
  clientId: string;
  kind: "DATA" | "TREATMENT";
  grantedAt: Date;
  docRef: string | null;
  templateId: string | null;
  templateVersion: number | null;
  textSha256: string | null;
  pdfSha256: string | null;
  pdfFileName: string | null;
  clinical: boolean;
  signer: string | null;
  signerName: string | null;
  signerRelation: string | null;
  informerUserId: string | null;
  revokesConsentId: string | null;
  revokeReason: string | null;
  createdByUserId: string | null;
}

export interface FakePhoto {
  id: string;
  tenantId: string;
  clientId: string;
  appointmentId: string | null;
  zona: string;
  mapaVersion: number;
  fileName: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  authorUserId: string;
  createdAt: Date;
  withdrawnAt: Date | null;
  withdrawnByUserId: string | null;
  withdrawReason: string | null;
}

export interface FakeDelivery {
  id: string;
  tenantId: string;
  clientId: string;
  report: string;
  channel: string;
  recipient: string;
  recipientEmail: string | null;
  pdfSha256: string;
  userId: string;
  at: Date;
}

export interface FakeEntry {
  id: string;
  tenantId: string;
  clientId: string;
  authorUserId: string;
  appointmentId: string | null;
  kind: string;
  body: Record<string, unknown>;
  createdAt: Date;
}

export interface FakeLog {
  userId: string;
  clientId: string;
  action: string;
  outcome: string;
  route: string | null;
}

export interface MundoDeLaClinica {
  clinicaEncendida: boolean;
  users: Map<string, FakeUser>;
  clientes: Map<string, any>;
  consents: FakeConsent[];
  photos: FakePhoto[];
  deliveries: FakeDelivery[];
  entradas: FakeEntry[];
  registro: FakeLog[];
  accesos: Array<{ clinicianUserId: string; clientId: string }>;
  /** `productId → ids de plantilla`. Lo que pide cada servicio. */
  pideElServicio: Map<string, string[]>;
  /** Los servicios de la cita de prueba. */
  serviciosDeLaCita: string[];
  valoracionValidada: boolean;
  prisma: any;
  reset(): void;
}

function usuarioVista(mundo: MundoDeLaClinica, id: string | null) {
  if (id == null) return null;
  const u = mundo.users.get(id);
  return {
    id,
    alias: u?.alias ?? null,
    email: u?.email ?? "x@x.com",
    clinicianLicense: u?.clinicianLicense ?? null,
  };
}

/** Crea el mundo y su doble de Prisma. */
export function crearMundo(): MundoDeLaClinica {
  const mundo: Partial<MundoDeLaClinica> = {
    clinicaEncendida: true,
    users: new Map(),
    clientes: new Map(),
    consents: [],
    photos: [],
    deliveries: [],
    entradas: [],
    registro: [],
    accesos: [],
    pideElServicio: new Map(),
    serviciosDeLaCita: [],
    valoracionValidada: true,
  };

  const m = mundo as MundoDeLaClinica;

  m.reset = () => {
    m.clinicaEncendida = true;
    m.users.clear();
    m.clientes.clear();
    m.consents = [];
    m.photos = [];
    m.deliveries = [];
    m.entradas = [];
    m.registro = [];
    m.accesos = [];
    m.pideElServicio = new Map();
    m.serviciosDeLaCita = [];
    m.valoracionValidada = true;

    m.users.set(DUENA_ID, {
      id: DUENA_ID,
      tenantId: TENANT_ID,
      role: "OWNER",
      isClinician: true,
      clinicalScope: "ALL",
      alias: "Rosario",
      email: "rosario@clinica.es",
      clinicianLicense: "45-0001",
      deletedAt: null,
      isSystemActor: false,
    });
    m.users.set(SANITARIA_ID, {
      id: SANITARIA_ID,
      tenantId: TENANT_ID,
      role: "CLINICIAN",
      isClinician: true,
      clinicalScope: "ALL",
      alias: "Lucía Martín",
      email: "lucia@clinica.es",
      clinicianLicense: "45-0312",
      deletedAt: null,
      isSystemActor: false,
    });
    m.users.set(RECEPCION_ID, {
      id: RECEPCION_ID,
      tenantId: TENANT_ID,
      role: "CASHIER",
      isClinician: false,
      clinicalScope: "SELECTION",
      alias: "Marta",
      email: "marta@clinica.es",
      clinicianLicense: null,
      deletedAt: null,
      isSystemActor: false,
    });
    m.clientes.set(PACIENTE_ID, {
      id: PACIENTE_ID,
      tenantId: TENANT_ID,
      firstName: "Carmen",
      lastName: "Rodríguez López",
      phone: "600111222",
      email: "carmen@ejemplo.com",
      birthdate: new Date("1948-03-02T00:00:00.000Z"),
      createdAt: new Date("2026-09-01T09:00:00.000Z"),
    });
    m.clientes.set(AJENA_ID, {
      id: AJENA_ID,
      tenantId: OTRO_TENANT,
      firstName: "Ajena",
      lastName: "DeOtroSitio",
      phone: null,
      email: null,
      birthdate: null,
      createdAt: new Date("2026-09-01T09:00:00.000Z"),
    });
  };

  function coincideConsent(c: FakeConsent, where: any): boolean {
    if (where.id != null && c.id !== where.id) return false;
    if (where.tenantId != null && c.tenantId !== where.tenantId) return false;
    if (where.clientId != null && c.clientId !== where.clientId) return false;
    return true;
  }

  function coincideFoto(f: FakePhoto, where: any): boolean {
    if (where.id != null && f.id !== where.id) return false;
    if (where.tenantId != null && f.tenantId !== where.tenantId) return false;
    if (where.clientId != null && f.clientId !== where.clientId) return false;
    return true;
  }

  function coincideEntrada(e: FakeEntry, where: any): boolean {
    if (where.id != null && e.id !== where.id) return false;
    if (where.tenantId != null && e.tenantId !== where.tenantId) return false;
    if (where.clientId != null && e.clientId !== where.clientId) return false;
    if (where.kind != null && e.kind !== where.kind) return false;
    return true;
  }

  function proyectar(fila: any, select: any, extras: Record<string, unknown>) {
    if (!select) return { ...fila, ...extras };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(select)) {
      if (!select[k]) continue;
      out[k] = k in extras ? extras[k] : fila[k];
    }
    return out;
  }

  m.prisma = {
    /**
     * La consulta cruda de `cargarCitaDeLaSesion` (clinica-3): la cita con
     * su paciente, su estado y su `timeslot`. Se contesta aquí porque es
     * la puerta por la que entra la ruta de hacer una foto, y sin ella el
     * doble daría un 500 que parece un fallo del bloque.
     */
    $queryRawUnsafe: async (_sql: string, tenantId: string, id: string) => {
      if (tenantId !== TENANT_ID || id !== CITA_ID) return [];
      return [
        {
          id: CITA_ID,
          client_id: PACIENTE_ID,
          status: "CONFIRMED",
          starts_at: new Date("2026-10-09T08:30:00.000Z"),
          ticket_id: null,
        },
      ];
    },
    tenant: {
      findUnique: async () => ({
        clinicalRecordsEnabled: m.clinicaEncendida,
        cajaEnabled: true,
        name: "Clínica Podológica Demo",
      }),
      findFirstOrThrow: async () => ({
        name: "Clínica Podológica Demo",
        fiscalProfile: {
          legalName: "Clínica Podológica Demo S.L.",
          taxId: "B12345678",
          address: "Calle de Ejemplo 1, Madrid",
          phone: "915551122",
        },
      }),
    },
    user: {
      findFirst: async ({ where }: any) => {
        for (const u of m.users.values()) {
          if (where.id != null && u.id !== where.id) continue;
          if (where.tenantId != null && u.tenantId !== where.tenantId) continue;
          return u;
        }
        return null;
      },
      findFirstOrThrow: async ({ where }: any) => {
        const u = m.users.get(where.id);
        if (!u || u.tenantId !== where.tenantId) throw new Error("no existe");
        return u;
      },
      findUnique: async ({ where }: any) => m.users.get(where.id) ?? null,
    },
    client: {
      findFirst: async ({ where }: any) => {
        const c = m.clientes.get(where.id);
        return c && c.tenantId === where.tenantId ? c : null;
      },
      findFirstOrThrow: async ({ where }: any) => {
        const c = m.clientes.get(where.id);
        if (!c || c.tenantId !== where.tenantId) throw new Error("no existe");
        return c;
      },
    },
    appointment: {
      findFirst: async ({ where }: any) => {
        if (where.id !== CITA_ID) return null;
        if (where.tenantId != null && where.tenantId !== TENANT_ID) return null;
        if (where.clientId != null && where.clientId !== PACIENTE_ID) {
          return null;
        }
        return {
          id: CITA_ID,
          items: m.serviciosDeLaCita.map((serviceId) => ({ serviceId })),
        };
      },
    },
    appointmentItem: {
      findMany: async () =>
        m.serviciosDeLaCita.map((serviceId) => ({ serviceId })),
    },
    appointmentAssignment: {
      findMany: async () => [{ staffUserId: SANITARIA_ID }],
    },
    product: {
      findMany: async ({ where }: any) =>
        (where?.id?.in ?? []).map((id: string) => ({
          id,
          name: id === SERVICIO_CIRUGIA ? "Cirugía de uña" : "Quiropodia",
        })),
    },
    serviceScheduling: {
      findMany: async ({ where }: any) =>
        (where.productId?.in ?? [])
          .filter((id: string) => m.pideElServicio.has(id))
          .map((id: string) => ({
            productId: id,
            consentimientos: m.pideElServicio.get(id) ?? [],
          })),
    },
    clinicalAccess: {
      findFirst: async ({ where }: any) =>
        m.accesos.find(
          (a) =>
            a.clinicianUserId === where.clinicianUserId &&
            a.clientId === where.clientId,
        )
          ? { id: "acc" }
          : null,
    },
    clinicalAccessLog: {
      create: async ({ data }: any) => {
        m.registro.push({
          userId: data.userId,
          clientId: data.clientId,
          action: data.action,
          outcome: data.outcome,
          route: data.route ?? null,
        });
        return { id: randomUUID() };
      },
    },
    clientConsent: {
      // NI `update` NI `delete`: la tabla es de solo inserción.
      findMany: async ({ where, orderBy, select }: any) => {
        let xs = m.consents.filter((c) => coincideConsent(c, where));
        if (orderBy?.grantedAt === "desc") {
          xs = xs.slice().sort((a, b) => +b.grantedAt - +a.grantedAt);
        }
        return xs.map((c) =>
          proyectar(c, select, { informer: usuarioVista(m, c.informerUserId) }),
        );
      },
      findFirst: async ({ where, select }: any) => {
        const c = m.consents.find((x) => coincideConsent(x, where));
        return c
          ? proyectar(c, select, {
              informer: usuarioVista(m, c.informerUserId),
            })
          : null;
      },
      create: async ({ data, select }: any) => {
        const fila: FakeConsent = {
          id: randomUUID(),
          tenantId: data.tenantId,
          clientId: data.clientId,
          kind: data.kind,
          grantedAt: data.grantedAt ?? new Date(),
          docRef: data.docRef ?? null,
          templateId: data.templateId ?? null,
          templateVersion: data.templateVersion ?? null,
          textSha256: data.textSha256 ?? null,
          pdfSha256: data.pdfSha256 ?? null,
          pdfFileName: data.pdfFileName ?? null,
          clinical: data.clinical ?? false,
          signer: data.signer ?? null,
          signerName: data.signerName ?? null,
          signerRelation: data.signerRelation ?? null,
          informerUserId: data.informerUserId ?? null,
          revokesConsentId: data.revokesConsentId ?? null,
          revokeReason: data.revokeReason ?? null,
          createdByUserId: data.createdByUserId ?? null,
        };
        m.consents.push(fila);
        return proyectar(fila, select, {
          informer: usuarioVista(m, fila.informerUserId),
        });
      },
    },
    clinicalPhoto: {
      findMany: async ({ where, orderBy, take, select }: any) => {
        let xs = m.photos.filter((f) => coincideFoto(f, where));
        if (orderBy?.createdAt === "desc") {
          xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
        }
        if (take != null) xs = xs.slice(0, take);
        return xs.map((f) =>
          proyectar(f, select, {
            author: usuarioVista(m, f.authorUserId),
            withdrawnBy: usuarioVista(m, f.withdrawnByUserId),
          }),
        );
      },
      findFirst: async ({ where, select }: any) => {
        const f = m.photos.find((x) => coincideFoto(x, where));
        return f
          ? proyectar(f, select, {
              author: usuarioVista(m, f.authorUserId),
              withdrawnBy: usuarioVista(m, f.withdrawnByUserId),
            })
          : null;
      },
      create: async ({ data, select }: any) => {
        const fila: FakePhoto = {
          id: randomUUID(),
          tenantId: data.tenantId,
          clientId: data.clientId,
          appointmentId: data.appointmentId ?? null,
          zona: data.zona,
          mapaVersion: data.mapaVersion,
          fileName: data.fileName,
          sha256: data.sha256,
          bytes: data.bytes,
          mimeType: data.mimeType,
          authorUserId: data.authorUserId,
          createdAt: data.createdAt ?? new Date(),
          withdrawnAt: null,
          withdrawnByUserId: null,
          withdrawReason: null,
        };
        m.photos.push(fila);
        return proyectar(fila, select, {
          author: usuarioVista(m, fila.authorUserId),
          withdrawnBy: null,
        });
      },
      /** La ÚNICA transición: la retirada. Como el guard de la tabla. */
      update: async ({ where, data, select }: any) => {
        const f = m.photos.find((x) => x.id === where.id);
        if (!f) throw new Error("no existe");
        const tocaOtraCosa = Object.keys(data).some(
          (k) =>
            !["withdrawnAt", "withdrawnByUserId", "withdrawReason"].includes(k),
        );
        if (tocaOtraCosa) {
          throw new Error(
            "HISTORIA_VIOLADA: la foto clínica no se reescribe (doble de test)",
          );
        }
        if (f.withdrawnAt != null) {
          throw new Error(
            "HISTORIA_VIOLADA: la foto ya está retirada (doble de test)",
          );
        }
        f.withdrawnAt = data.withdrawnAt;
        f.withdrawnByUserId = data.withdrawnByUserId;
        f.withdrawReason = data.withdrawReason;
        return proyectar(f, select, {
          author: usuarioVista(m, f.authorUserId),
          withdrawnBy: usuarioVista(m, f.withdrawnByUserId),
        });
      },
    },
    clinicalReportDelivery: {
      // Solo inserción: sin `update` ni `delete`.
      create: async ({ data, select }: any) => {
        const fila: FakeDelivery = {
          id: randomUUID(),
          tenantId: data.tenantId,
          clientId: data.clientId,
          report: data.report,
          channel: data.channel,
          recipient: data.recipient,
          recipientEmail: data.recipientEmail ?? null,
          pdfSha256: data.pdfSha256,
          userId: data.userId,
          at: data.at ?? new Date(),
        };
        m.deliveries.push(fila);
        return proyectar(fila, select, {});
      },
      findMany: async ({ where, orderBy, take, select }: any) => {
        let xs = m.deliveries.filter(
          (d) =>
            d.tenantId === where.tenantId && d.clientId === where.clientId,
        );
        if (orderBy?.at === "desc") {
          xs = xs.slice().sort((a, b) => +b.at - +a.at);
        }
        if (take != null) xs = xs.slice(0, take);
        return xs.map((d) =>
          proyectar(d, select, { user: usuarioVista(m, d.userId) }),
        );
      },
    },
    clinicalEntry: {
      findUnique: async ({ where }: any) => {
        const e = m.entradas.find((x) => x.id === where.id);
        return e ? { body: e.body } : null;
      },
      findFirst: async ({ where, orderBy }: any) => {
        let xs = m.entradas.filter((e) => coincideEntrada(e, where));
        if (orderBy?.createdAt === "desc") {
          xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
        }
        const e = xs[0];
        return e ? { ...e, author: usuarioVista(m, e.authorUserId) } : null;
      },
      findMany: async ({ where, orderBy, take }: any) => {
        let xs = m.entradas.filter((e) => coincideEntrada(e, where));
        if (orderBy?.createdAt === "desc") {
          xs = xs.slice().sort((a, b) => +b.createdAt - +a.createdAt);
        }
        if (take != null) xs = xs.slice(0, take);
        return xs.map((e) => ({ ...e, author: usuarioVista(m, e.authorUserId) }));
      },
      count: async ({ where }: any) =>
        m.entradas.filter((e) => coincideEntrada(e, where)).length,
    },
    clinicalAssessment: {
      findMany: async ({ where }: any) =>
        m.valoracionValidada
          ? [
              {
                id: "val-1",
                tenantId: TENANT_ID,
                clientId: where.clientId ?? PACIENTE_ID,
                status: "VALIDADA",
                channel: "TABLET",
                source: "MANUAL",
                createdAt: new Date("2026-09-01T10:00:00.000Z"),
                entryId: "entrada-val",
                answeredAt: new Date("2026-09-01T10:05:00.000Z"),
                answeredBy: "PACIENTE",
                validatedAt: new Date("2026-09-01T10:10:00.000Z"),
                questionnaireVersion: 1,
              },
            ]
          : [],
      findFirst: async () =>
        m.valoracionValidada
          ? {
              id: "val-1",
              tenantId: TENANT_ID,
              clientId: PACIENTE_ID,
              status: "VALIDADA",
              channel: "TABLET",
              source: "MANUAL",
              createdAt: new Date("2026-09-01T10:00:00.000Z"),
              entryId: "entrada-val",
              answeredAt: new Date("2026-09-01T10:05:00.000Z"),
              answeredBy: "PACIENTE",
              validatedAt: new Date("2026-09-01T10:10:00.000Z"),
              questionnaireVersion: 1,
              requestedBy: null,
              validatedBy: usuarioVista(m, SANITARIA_ID),
            }
          : null,
    },
    clinicalAssessmentCorrection: {
      findMany: async () => [],
    },
    publicLink: {
      findFirst: async () => null,
    },
    ticket: {
      findFirst: async () => null,
    },
  };

  m.reset();
  return m;
}

/** La entrada de la valoración, con sus respuestas: la lee el informe. */
export function sembrarValoracion(m: MundoDeLaClinica): void {
  m.entradas.push({
    id: "entrada-val",
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    authorUserId: SANITARIA_ID,
    appointmentId: null,
    kind: "ASSESSMENT",
    body: {
      v: 1,
      cuestionarioVersion: 1,
      // Los ids REALES del cuestionario de clinica-2 (`diab`, `antic`,
      // `aler`…). Con un id inventado la respuesta no entra en juego y la
      // sección de la valoración saldría corta sin que nada lo cante.
      respuestas: {
        diab: "SI",
        insul: "NO",
        antic: "SI",
        circ: "NO",
        aler: "SI",
        marca: "NO",
        defen: "NO",
        sens: "NO_SE",
        artr: "NO",
        oper: "NO",
        fuma: "NO",
      },
      detalles: {},
      respondioPor: "PACIENTE",
      canal: "TABLET",
    },
    createdAt: new Date("2026-09-01T10:05:00.000Z"),
  });
}

/** Una sesión cerrada, para que la historia y el informe tengan visitas. */
export function sembrarSesion(
  m: MundoDeLaClinica,
  dia: number,
  extra: Record<string, unknown> = {},
): FakeEntry {
  const fila: FakeEntry = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    clientId: PACIENTE_ID,
    authorUserId: SANITARIA_ID,
    appointmentId: randomUUID(),
    kind: "TREATMENT_SESSION",
    body: {
      v: 2,
      mapaVersion: 1,
      lesionesVersion: 1,
      tipos: ["QUIROPODIA"],
      bloques: { QUIROPODIA: { actos: ["corte"], nivelElegido: 1 } },
      marcas: { "L:h": { lesion: "onicocriptosis", gravedad: "MODERADA" } },
      tratamientos: [],
      tratamientosNombre: {},
      consejos: ["calzado"],
      consejosNombre: ["Calzado ancho"],
      dolor: 5,
      evolucion: "MEJOR",
      proximaCita: null,
      nota: null,
      listas: { pendientes: 1 },
      firma: {
        autorNombre: "Lucía Martín",
        colegiado: "45-0312",
        firmadaEn: "2026-09-07T10:00:00.000Z",
      },
      ...extra,
    },
    createdAt: new Date(Date.UTC(2026, 8, dia, 10, 0, 0)),
  };
  m.entradas.push(fila);
  return fila;
}

/** Un PNG de 1×1 válido, para hacer de firma del dedo. */
export const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** Un JPEG mínimo válido (cabecera SOI + EOI con un APP0 sencillo). */
export const JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]).toString("base64");
