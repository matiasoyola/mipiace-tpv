// residencia-3 · **LA RESIDENCIA EN LA DEVOLUCIÓN DEL ART. 28.3.g.**
//
// Deuda anotada en residencia-1b §12.4: «el día que un centro de
// residencia pida sus datos, el ZIP no llevará la ficha del residente ni
// su plan. Es deuda de residencia, y conviene que residencia-3 la mire
// junto con el registro de cuidados». Esto es ese día.
//
// ── Qué se añade al paquete, por residente ──────────────────────────
//
//   · `residencia.json` — su ficha (con DNI y NSS **descifrados**), su
//     histórico de habitaciones, su plan de cuidados completo (vivo y
//     cerrado) y **todo su registro de cuidados**, con la firma de cada
//     fila y el estado de las correcciones y las anulaciones.
//   · `foto.jpg` — su foto, descifrada, si la tiene.
//   · `notas-de-voz/` — los audios de «algo no va bien», descifrados.
//   · residencia-4 · **sus incidencias**, con la cronología de acciones,
//     los avisos y sus acuses, los enlaces con otras y **lo que se le
//     dijo a la familia o por qué no** — todo descifrado. Y las
//     **excepciones de umbral** que le pautó la médica, con su motivo.
//
// ── Por qué el registro entero y no un resumen ──────────────────────
//
// Porque lo que se devuelve es la EVIDENCIA, y la evidencia de una
// residencia es precisamente que nada se borró: que la corrección está al
// lado de lo corregido, con quién y cuándo. Un resumen con «el valor de
// ahora» sería más fácil de leer y sería otro documento — uno que no
// prueba lo que este prueba.
//
// Y descifrado, como todo lo demás del ZIP: un paquete con ciphertext
// dentro es un paquete que el centro siguiente no puede abrir, y el art.
// 20 RGPD pide «formato estructurado, de uso común y lectura mecánica».
//
// ── Lo que NO se añade, y por qué ───────────────────────────────────
//
// El **PIN de la puerta**. Es una credencial del personal, no un dato del
// centro ni de ningún residente, y devolver hashes de PIN en un ZIP que
// viaja por correo es regalar la llave de las puertas del edificio que se
// acaba de entregar. Lo que sí va es quién firmó cada registro, que es el
// dato.
//
// Y las **plantas, habitaciones y camas** sin ocupante: son el edificio,
// que no se devuelve porque no se lleva nadie. Dónde durmió cada residente
// sí va, dentro de su ficha.

import type { PrismaClient } from "@mipiacetpv/db";

import { dekONada } from "../clinica/claves.js";
import {
  leerTexto,
  sitioContenidoAFamilia,
  sitioDescripcionDeIncidencia,
  sitioDniDeResidente,
  sitioMotivoDeAlta,
  sitioMotivoDeCierreDeLinea,
  sitioMotivoDeExcepcion,
  sitioMotivoDeLinea,
  sitioMotivoDeOcupacion,
  sitioNssDeResidente,
  sitioRespuestaDeFamilia,
  sitioTextoDeAccion,
} from "../clinica/cripto-campos.js";
import { leerFichero } from "../clinica/ficheros.js";
import { frecuenciaEnPalabras } from "@mipiacetpv/residencia-plan";
import { deColumnas, FRECUENCIA_SELECT } from "./frecuencia-columnas.js";
import { REGISTRO_SELECT, vistaDeRegistros } from "./registro.js";

/** Un fichero del volumen que hay que meter en el ZIP. */
export interface FicheroDeResidencia {
  /** Ruta DENTRO de la carpeta del residente. */
  ruta: string;
  contenido: Buffer;
  /** `false` si la huella no cuadra: va en el paquete igual, con su
   *  incidencia, como las fotos clínicas de clinica-7. */
  huellaCuadra: boolean;
}

export interface ParteDeResidencia {
  /** Lo que va a `residencia.json`, o `null` si este cliente no es
   *  residente (una clínica dentro de la residencia, por ejemplo). */
  json: unknown | null;
  ficheros: FicheroDeResidencia[];
  incidencias: string[];
}

/**
 * La parte de residencia del paquete de un residente.
 *
 * Devuelve `json: null` cuando el cliente no tiene perfil de residente: en
 * un centro mixto hay pacientes de la consulta que no viven aquí, y
 * meterles un `residencia.json` vacío sería decir que son residentes sin
 * datos.
 */
export async function parteDeResidencia(
  prisma: PrismaClient,
  input: { tenantId: string; clientId: string },
): Promise<ParteDeResidencia> {
  const { tenantId, clientId } = input;
  const perfil = await prisma.residentProfile.findFirst({
    where: { clientId, tenantId },
    select: {
      clientId: true,
      admissionDate: true,
      dischargeDate: true,
      dischargeReason: true,
      dischargeReasonCifrado: true,
      dependencyLevel: true,
      dependencyGrade: true,
      placeType: true,
      responsibleName: true,
      responsiblePhone: true,
      responsibleRelation: true,
      dni: true,
      dniCifrado: true,
      nss: true,
      nssCifrado: true,
      photoFileName: true,
      photoSha256: true,
      photoUploadedAt: true,
    },
  });
  if (!perfil) return { json: null, ficheros: [], incidencias: [] };

  const dek = await dekONada(tenantId, prisma);
  const incidencias: string[] = [];
  const ficheros: FicheroDeResidencia[] = [];

  const [
    ocupaciones,
    plan,
    registros,
    consentimientosDeImagen,
    incidenciasSuyas,
    excepciones,
  ] = await Promise.all([
      prisma.bedAssignment.findMany({
        where: { tenantId, clientId },
        orderBy: { fromAt: "asc" },
        select: {
          id: true,
          fromAt: true,
          toAt: true,
          reason: true,
          reasonCifrado: true,
          bed: {
            select: {
              label: true,
              room: {
                select: {
                  number: true,
                  name: true,
                  floor: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      prisma.carePlanItem.findMany({
        where: { tenantId, clientId },
        orderBy: { fromAt: "asc" },
        select: {
          id: true,
          controlCode: true,
          fromAt: true,
          toAt: true,
          source: true,
          sourceLevel: true,
          reason: true,
          reasonCifrado: true,
          closeReason: true,
          closeReasonCifrado: true,
          ...FRECUENCIA_SELECT,
        },
      }),
      // **Todo** el registro de cuidados, no el de hoy. Es lo que se
      // devuelve: la evidencia de cinco años.
      prisma.careRecord.findMany({
        where: { tenantId, clientId },
        orderBy: [{ careDay: "asc" }, { recordedAt: "asc" }],
        select: {
          ...REGISTRO_SELECT,
          voiceSha256: true,
          voiceMimeType: true,
          planItemId: true,
          occurrenceAt: true,
          receivedAt: true,
          voidedBy: { select: { alias: true, email: true } },
        },
      }),
      prisma.clientConsent.findMany({
        where: { tenantId, clientId, kind: "IMAGE" },
        orderBy: { grantedAt: "asc" },
        select: {
          id: true,
          grantedAt: true,
          signer: true,
          signerName: true,
          signerRelation: true,
          revokesConsentId: true,
        },
      }),
      // ── residencia-4 · SUS INCIDENCIAS, enteras ──────────────────
      //
      // Con la cronología, los avisos y la constancia de familia. **Todo
      // y no un resumen**, por lo mismo que el registro de cuidados: lo
      // que se devuelve es la evidencia, y la evidencia de una residencia
      // es que nada se borró — que la acción está al lado de la
      // incidencia, con quién y cuándo, y que el aviso que nadie acusó
      // consta como no acusado.
      prisma.incident.findMany({
        where: { tenantId, clientId },
        orderBy: { openedAt: "asc" },
        select: {
          id: true,
          subject: true,
          origin: true,
          incidentType: true,
          severity: true,
          templateVersion: true,
          open: true,
          descriptionCifrado: true,
          openedAt: true,
          closedAt: true,
          selfClosed: true,
          alertedAt: true,
          careDay: true,
          sourceRecordId: true,
          room: { select: { number: true } },
          centerShift: { select: { code: true } },
          openedBy: { select: { alias: true, email: true } },
          openedWith: { select: { careRole: { select: { code: true } } } },
          closedBy: { select: { alias: true, email: true } },
          closedWith: { select: { careRole: { select: { code: true } } } },
          actions: {
            orderBy: { at: "asc" },
            select: {
              id: true,
              kind: true,
              textCifrado: true,
              severityFrom: true,
              severityTo: true,
              careRecordId: true,
              called: true,
              at: true,
              by: { select: { alias: true, email: true } },
              byWith: { select: { careRole: { select: { code: true } } } },
            },
          },
          familyCommunications: {
            orderBy: { at: "asc" },
            select: {
              id: true,
              kind: true,
              channel: true,
              contactName: true,
              contactRelation: true,
              contentCifrado: true,
              responseCifrado: true,
              at: true,
              by: { select: { alias: true, email: true } },
              byWith: { select: { careRole: { select: { code: true } } } },
            },
          },
          alerts: {
            orderBy: { createdAt: "asc" },
            select: {
              channel: true,
              severity: true,
              state: true,
              queuedAt: true,
              createdAt: true,
              deliveredAt: true,
              ackedAt: true,
              ackedBy: { select: { alias: true, email: true } },
            },
          },
          linksFrom: { select: { bId: true } },
          linksTo: { select: { aId: true } },
        },
      }),
      // Y las excepciones de umbral que le pautó la médica, con su
      // motivo descifrado: es una prescripción suya.
      prisma.residentThresholdOverride.findMany({
        where: { tenantId, clientId },
        orderBy: { fromAt: "asc" },
        select: {
          id: true,
          controlCode: true,
          reasonCifrado: true,
          fromAt: true,
          toAt: true,
          revokedAt: true,
          signedAt: true,
          signedBy: { select: { alias: true, email: true } },
          signedWith: { select: { careRole: { select: { code: true } } } },
          rules: {
            orderBy: { sortOrder: "asc" },
            select: {
              comparator: true,
              value: true,
              severity: true,
              incidentType: true,
            },
          },
        },
      }),
    ]);

  const vista = vistaDeRegistros(registros, dek);
  const porId = new Map(registros.map((r) => [r.id, r]));

  // ── La foto, descifrada ───────────────────────────────────────────
  if (perfil.photoFileName) {
    const leido = await leerFichero(
      "RESIDENTE",
      perfil.photoFileName,
      perfil.photoSha256,
      { tenantId, dek },
    );
    if (!leido) {
      incidencias.push(
        "la foto del residente no se pudo leer del volumen clínico",
      );
    } else {
      if (!leido.huellaCuadra) {
        incidencias.push(
          `la foto del residente (${perfil.photoFileName}) NO cuadra con su huella — va en el paquete, con este aviso`,
        );
      }
      ficheros.push({
        ruta: "foto.jpg",
        contenido: leido.contenido,
        huellaCuadra: leido.huellaCuadra,
      });
    }
  }

  // ── Las notas de voz, descifradas ─────────────────────────────────
  for (const r of registros) {
    if (!r.voiceFileName) continue;
    const leido = await leerFichero("VOZ", r.voiceFileName, r.voiceSha256, {
      tenantId,
      dek,
    });
    if (!leido) {
      incidencias.push(
        `la nota de voz del ${r.careDay} (${r.id.slice(0, 8)}) no se pudo leer del volumen clínico`,
      );
      continue;
    }
    if (!leido.huellaCuadra) {
      incidencias.push(
        `la nota de voz ${r.voiceFileName} NO cuadra con su huella — va en el paquete, con este aviso`,
      );
    }
    // El nombre lo hace legible para una persona: día, hora y los ocho
    // primeros del id para que se cruce con el JSON. Y nada del
    // contenido, igual que el nombre del fichero del volumen.
    ficheros.push({
      ruta: `notas-de-voz/${r.careDay}-${r.recordedAt
        .toISOString()
        .slice(11, 16)
        .replace(":", "")}-${r.id.slice(0, 8)}.webm`,
      contenido: leido.contenido,
      huellaCuadra: leido.huellaCuadra,
    });
  }

  const revocados = new Set(
    consentimientosDeImagen
      .map((c) => c.revokesConsentId)
      .filter((x): x is string => x != null),
  );

  return {
    incidencias,
    ficheros,
    json: {
      ficha: {
        ingreso: perfil.admissionDate.toISOString().slice(0, 10),
        alta: perfil.dischargeDate?.toISOString().slice(0, 10) ?? null,
        motivoDelAlta: leerTexto(
          { cifrado: perfil.dischargeReasonCifrado, claro: perfil.dischargeReason },
          dek,
          sitioMotivoDeAlta(tenantId, clientId),
        ),
        nivelDeDependencia: perfil.dependencyLevel,
        gradoLey39: perfil.dependencyGrade,
        tipoDePlaza: perfil.placeType,
        familiarResponsable: {
          nombre: perfil.responsibleName,
          telefono: perfil.responsiblePhone,
          parentesco: perfil.responsibleRelation,
        },
        // Descifrados, como todo lo del ZIP. Es la devolución de SUS datos
        // a quien los puede pedir.
        dni: leerTexto(
          { cifrado: perfil.dniCifrado, claro: perfil.dni },
          dek,
          sitioDniDeResidente(tenantId, clientId),
        ),
        nss: leerTexto(
          { cifrado: perfil.nssCifrado, claro: perfil.nss },
          dek,
          sitioNssDeResidente(tenantId, clientId),
        ),
        foto: perfil.photoFileName
          ? { fichero: "foto.jpg", subidaEn: perfil.photoUploadedAt?.toISOString() ?? null }
          : null,
      },
      consentimientosDeImagen: consentimientosDeImagen.map((c) => ({
        id: c.id,
        anotadoEn: c.grantedAt.toISOString(),
        esRetirada: c.revokesConsentId != null,
        retiraA: c.revokesConsentId,
        vigente: c.revokesConsentId == null && !revocados.has(c.id),
        loDio: c.signer,
        nombreDeQuienLoDio: c.signerName,
        parentesco: c.signerRelation,
      })),
      habitaciones: ocupaciones.map((o) => ({
        desde: o.fromAt.toISOString(),
        hasta: o.toAt?.toISOString() ?? null,
        planta: o.bed.room.floor.name,
        habitacion: o.bed.room.number,
        nombreDeLaHabitacion: o.bed.room.name,
        cama: o.bed.label,
        motivo: leerTexto(
          { cifrado: o.reasonCifrado, claro: o.reason },
          dek,
          sitioMotivoDeOcupacion(tenantId, o.id),
        ),
      })),
      planDeCuidados: plan.map((l) => ({
        id: l.id,
        control: l.controlCode,
        frecuencia: frecuenciaEnPalabras(deColumnas(l)),
        desde: l.fromAt.toISOString(),
        hasta: l.toAt?.toISOString() ?? null,
        origen: l.source,
        nivelDeLaPlantilla: l.sourceLevel,
        motivo: leerTexto(
          { cifrado: l.reasonCifrado, claro: l.reason },
          dek,
          sitioMotivoDeLinea(tenantId, l.id),
        ),
        motivoDelCierre: leerTexto(
          { cifrado: l.closeReasonCifrado, claro: l.closeReason },
          dek,
          sitioMotivoDeCierreDeLinea(tenantId, l.id),
        ),
      })),
      // ── residencia-4 · las incidencias y las excepciones ─────────
      incidencias: incidenciasSuyas.map((i) => ({
        id: i.id,
        sujeto: i.subject,
        origen: i.origin,
        tipo: i.incidentType,
        nivel: i.severity,
        versionDeLaPlantilla: i.templateVersion,
        abierta: i.open,
        descripcion: leerTexto(
          { cifrado: i.descriptionCifrado, claro: null },
          dek,
          sitioDescripcionDeIncidencia(tenantId, i.id),
        ),
        dia: i.careDay,
        turno: i.centerShift?.code ?? null,
        habitacion: i.room?.number ?? null,
        medidaQueLaAbrio: i.sourceRecordId,
        abiertaEn: i.openedAt.toISOString(),
        abiertaPor: nombreCorto(i.openedBy),
        conElRol: i.openedWith.careRole.code,
        cerradaEn: i.closedAt?.toISOString() ?? null,
        cerradaPor: i.closedBy ? nombreCorto(i.closedBy) : null,
        cerradaConElRol: i.closedWith?.careRole.code ?? null,
        autocierre: i.selfClosed,
        avisadoEn: i.alertedAt?.toISOString() ?? null,
        enlazadaCon: [
          ...i.linksFrom.map((l) => l.bId),
          ...i.linksTo.map((l) => l.aId),
        ],
        acciones: i.actions.map((a) => ({
          id: a.id,
          clase: a.kind,
          texto: leerTexto(
            { cifrado: a.textCifrado, claro: null },
            dek,
            sitioTextoDeAccion(tenantId, a.id),
          ),
          nivelDesde: a.severityFrom,
          nivelHasta: a.severityTo,
          registro: a.careRecordId,
          llamado: a.called,
          en: a.at.toISOString(),
          por: nombreCorto(a.by),
          conElRol: a.byWith.careRole.code,
        })),
        comunicacionesALaFamilia: i.familyCommunications.map((c) => ({
          id: c.id,
          clase: c.kind,
          via: c.channel,
          contacto: c.contactName,
          parentesco: c.contactRelation,
          contenido: leerTexto(
            { cifrado: c.contentCifrado, claro: null },
            dek,
            sitioContenidoAFamilia(tenantId, c.id),
          ),
          respuesta: leerTexto(
            { cifrado: c.responseCifrado, claro: null },
            dek,
            sitioRespuestaDeFamilia(tenantId, c.id),
          ),
          en: c.at.toISOString(),
          por: nombreCorto(c.by),
          conElRol: c.byWith.careRole.code,
        })),
        // Los avisos, **incluidos los que nadie acusó**: es la prueba de
        // que sonó, y también la de que sonó y no fue nadie.
        avisos: i.alerts.map((a) => ({
          canal: a.channel,
          nivel: a.severity,
          estado: a.state,
          apuntadoEn: a.queuedAt.toISOString(),
          salidoEn: a.createdAt.toISOString(),
          entregadoEn: a.deliveredAt?.toISOString() ?? null,
          acusadoEn: a.ackedAt?.toISOString() ?? null,
          acusadoPor: a.ackedBy ? nombreCorto(a.ackedBy) : null,
        })),
      })),
      excepcionesDeUmbral: excepciones.map((e) => ({
        id: e.id,
        control: e.controlCode,
        motivo: leerTexto(
          { cifrado: e.reasonCifrado, claro: null },
          dek,
          sitioMotivoDeExcepcion(tenantId, e.id),
        ),
        desde: e.fromAt.toISOString(),
        hasta: e.toAt?.toISOString() ?? null,
        revocadaEn: e.revokedAt?.toISOString() ?? null,
        firmadaEn: e.signedAt.toISOString(),
        firmadaPor: nombreCorto(e.signedBy),
        conElRol: e.signedWith.careRole.code,
        reglas: e.rules.map((r) => ({
          comparador: r.comparator,
          valor: Number(r.value),
          nivel: r.severity,
          tipo: r.incidentType,
        })),
      })),
      registroDeCuidados: vista.map((r) => {
        const fila = porId.get(r.id)!;
        return {
          id: r.id,
          control: r.controlCode,
          dia: r.careDay,
          turno: r.shiftCode,
          sinTurno: r.sinTurno,
          // Los DOS instantes, que es la mitad de la evidencia offline:
          // cuándo se hizo y cuándo lo supo el servidor.
          hechoEn: r.recordedAt,
          recibidoEn: fila.receivedAt.toISOString(),
          ocurrencia: fila.occurrenceAt?.toISOString() ?? null,
          lineaDelPlan: fila.planItemId,
          valor: r.valor,
          nota: r.nota,
          notaDeVoz: fila.voiceFileName
            ? `notas-de-voz/${r.careDay}-${fila.recordedAt
                .toISOString()
                .slice(11, 16)
                .replace(":", "")}-${r.id.slice(0, 8)}.webm`
            : null,
          firmadoPor: r.firmadoPor,
          conElRol: r.rolCode,
          // Lo que prueba que nada se borró.
          corrigeA: r.corrigeA,
          anulado: r.anulado,
          anuladoPor: fila.voidedBy
            ? (fila.voidedBy.alias ?? fila.voidedBy.email.split("@")[0])
            : null,
          anuladoEn: fila.voidedAt?.toISOString() ?? null,
          /** `true` = es el valor de ahora de su ocurrencia. */
          vigente: r.vigente,
        };
      }),
    },
  };
}

/** El alias, o la parte local del email. El mismo criterio que
 *  `nombreDeQuienFirma`, repetido aquí porque el ZIP no debe llevar un
 *  email completo: es un dato personal del PERSONAL, y lo que se devuelve
 *  es la evidencia de quién firmó, no cómo escribirle. */
function nombreCorto(u: { alias: string | null; email: string }): string {
  return u.alias ?? (u.email.split("@")[0] ?? u.email);
}
