// clinica-7 · LA DEVOLUCIÓN DE DATOS DEL ART. 28.3.g.
//
// «Al terminar con una clínica, sus datos se pueden devolver y después
// destruir de verdad.» Esto es la primera mitad: un ZIP con TODO lo
// clínico de la clínica, descifrado, legible por una persona y legible por
// una máquina.
//
// Decisión 7 del prompt. Lo que lleva, por paciente:
//
//   · `historia.pdf` — el informe «historia completa» de clinica-4, que es
//     el del derecho de acceso;
//   · `fotos/` — sus fotos clínicas, DESCIFRADAS y en JPEG;
//   · `consentimientos/` — los PDF firmados, descifrados;
//   · y en la raíz, `centro.json` con todo en estructura.
//
// ── residencia-3 · Y SI ES UN RESIDENTE, SU PARTE DE RESIDENCIA ──────
//
// Deuda que residencia-1b §12.4 dejó anotada y que éste cierra: un centro
// de residencia que pidiera sus datos recibía un ZIP **sin la ficha del
// residente, sin su plan y sin su registro de cuidados**. Lo que exportaba
// seguía exportándose igual, así que no estaba roto: estaba incompleto, y
// en una devolución del art. 28.3.g incompleto es peor.
//
// Ahora, por residente:
//
//   · `residencia.json`  — ficha (con DNI y NSS descifrados), histórico de
//     habitaciones, plan completo y **todo el registro de cuidados**, con
//     la firma de cada fila y el estado de correcciones y anulaciones;
//   · `foto.jpg`         — su foto, descifrada, si la tiene;
//   · `notas-de-voz/`    — los audios de «algo no va bien», descifrados.
//
// Los clientes que NO son residentes —los pacientes de la consulta de un
// centro mixto— no ganan ningún fichero. Ver `parteDeResidencia`.
//
// ── Por qué el PDF Y el JSON, y no uno de los dos ───────────────────
//
// Porque contestan a dos personas distintas. El PDF lo lee Rosario, su
// abogado y el paciente que pide su historia: es el documento. El JSON lo
// lee el programa de la clínica siguiente: es el dato. Un paquete con solo
// PDF es un paquete que hay que teclear a mano para migrar; uno con solo
// JSON no se puede entregar a nadie.
//
// El art. 20 RGPD (portabilidad) pide «un formato estructurado, de uso
// común y lectura mecánica», y el art. 28.3.g pide devolver los datos. El
// JSON cubre el primero y el PDF el segundo.
//
// ── Funciona CON EL CONTRATO REVOCADO ───────────────────────────────
//
// Es lo que hace que la devolución sirva de algo: se revoca el contrato
// porque se termina la relación, y es justo entonces cuando hay que
// devolver los datos. Un export que dejara de funcionar al revocar sería
// un export que no se puede usar nunca para lo que existe.
//
// Técnicamente sale gratis: la ruta es `EXPORT` y el guard del 423 solo
// mira `WRITE`.
//
// ── Y QUEDA REGISTRADO, paciente a paciente ─────────────────────────
//
// Una línea de `ClinicalAccessLog` por paciente exportado, con
// `action = EXPORT`. No una sola línea «se exportó el centro»: la pregunta
// que alguien hará es «¿quién se llevó la historia de mi madre?», y esa se
// contesta con una línea en la historia de su madre.

import type { PrismaClient } from "@mipiacetpv/db";

import { Zip, ZipDemasiadoGrande, nombreSeguroEnZip } from "../lib/zip.js";
import { dekONada } from "./claves.js";
import { vistaDeConsentimientos } from "./consentimientos.js";
import { leerFichero } from "./ficheros.js";
import { fotosDelPaciente } from "./fotos.js";
import { armarInforme, pdfDelInforme } from "./informe.js";
import { entregasDelPaciente } from "./entregas.js";
import { apuntarAcceso } from "./registro.js";
import { vistaDeLaHistoria } from "./historia.js";
import { parteDeResidencia } from "../residencia/exportacion.js";

export { ZipDemasiadoGrande };

export interface ResumenDeLaExportacion {
  pacientes: number;
  ficheros: number;
  bytes: number;
  /** Los pacientes cuyo paquete salió incompleto, con qué faltó. Se dice
   *  en el JSON y en un `FALTAN.txt`: un paquete al que le falta algo en
   *  silencio es peor que uno que lo dice. */
  incidencias: string[];
}

/**
 * EL PAQUETE.
 *
 * Devuelve los trozos en orden para que quien llama los suelte a la
 * respuesta HTTP sin tener el ZIP entero en memoria dos veces. Los
 * ficheros sí se leen de uno en uno, y cada uno se suelta antes de leer el
 * siguiente — es lo que permite exportar un centro con mil fotos sin que
 * el proceso ocupe un giga.
 *
 * `onTrozo` se llama con cada trozo. Devuelve el resumen al final.
 */
export async function exportarElCentro(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    /** Quién lo pide. Va a cada línea del registro. */
    userId: string;
    deviceId: string | null;
    ahora: Date;
  },
  onTrozo: (trozo: Buffer) => void | Promise<void>,
): Promise<ResumenDeLaExportacion> {
  const zip = new Zip();
  const incidencias: string[] = [];
  let ficheros = 0;

  const dek = await dekONada(input.tenantId, prisma);

  const pacientes = await prisma.client.findMany({
    where: { tenantId: input.tenantId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, birthdate: true },
  });

  // Lo que va al JSON. Se acumula en memoria porque es estructura y no
  // binario: la historia de doscientas visitas de un paciente son unos
  // cientos de kilobytes, y el centro entero cabe de sobra.
  const json: unknown[] = [];

  for (const paciente of pacientes) {
    // LA LÍNEA, ANTES DE LEER NADA DE SU HISTORIA. Una por paciente, con
    // `EXPORT`. Si no se puede escribir, se corta: trazabilidad por
    // encima de disponibilidad, igual que `conHistoria`.
    await apuntarAcceso({
      tenantId: input.tenantId,
      userId: input.userId,
      clientId: paciente.id,
      action: "EXPORT",
      outcome: "ALLOWED",
      deviceId: input.deviceId,
      route: "GET /clinica/exportacion",
    });

    const carpeta = nombreSeguroEnZip(
      `${paciente.lastName}, ${paciente.firstName}`.trim() || paciente.id,
    );

    // ── La historia completa en PDF ──────────────────────────────────
    //
    // `armarInforme` con `tipo = COMPLETA`, que es exactamente el informe
    // del derecho de acceso de clinica-4. No se arma aquí un documento
    // nuevo: el que ya existe es el que la clínica entrega, y dos
    // documentos distintos para lo mismo serían dos sitios donde
    // divergir.
    try {
      const armado = await armarInforme(prisma, {
        tenantId: input.tenantId,
        clientId: paciente.id,
        tipo: "COMPLETA",
        userId: input.userId,
        motivoDeDerivacion: null,
        ahora: input.ahora,
      });
      const { pdf } = await pdfDelInforme(armado);
      await onTrozo(
        zip.anadir(`${carpeta}/historia.pdf`, Buffer.from(pdf), input.ahora),
      );
      ficheros += 1;
    } catch (err) {
      incidencias.push(
        `${carpeta}: no se pudo armar la historia completa en PDF (${(err as Error).message})`,
      );
    }

    // ── Las fotos, DESCIFRADAS ───────────────────────────────────────
    //
    // Las retiradas también. Están en la historia y el paciente tiene
    // derecho de acceso a lo que haya en ella (decisión 10 de clinica-4);
    // el nombre dice que está retirada para que nadie las confunda.
    const fotos = await fotosDelPaciente(prisma, {
      tenantId: input.tenantId,
      clientId: paciente.id,
    });
    const filasDeFoto = await prisma.clinicalPhoto.findMany({
      where: { tenantId: input.tenantId, clientId: paciente.id },
      select: { id: true, fileName: true, sha256: true },
    });
    const ficheroDeFoto = new Map(filasDeFoto.map((f) => [f.id, f]));

    for (const foto of fotos) {
      const fila = ficheroDeFoto.get(foto.id);
      if (!fila) continue;
      const leido = await leerFichero("FOTO", fila.fileName, fila.sha256, {
        tenantId: input.tenantId,
        dek,
      });
      if (!leido) {
        incidencias.push(
          `${carpeta}: la foto de ${foto.hecha.slice(0, 10)} (${foto.zonaNombre}) no se pudo leer del volumen`,
        );
        continue;
      }
      if (!leido.huellaCuadra) {
        // Se incluye IGUAL, con el aviso. Es la decisión de clinica-4 con
        // el PDF que no cuadra: un fichero que no cuadra es justo el que
        // alguien tiene que mirar, y dejarlo fuera del paquete borra la
        // única pista.
        incidencias.push(
          `${carpeta}: la foto ${fila.fileName} NO cuadra con su huella — va en el paquete, con este aviso`,
        );
      }
      const nombre = nombreSeguroEnZip(
        `${foto.hecha.slice(0, 10)}-${foto.zonaNombre}${foto.retirada ? "-RETIRADA" : ""}-${foto.id.slice(0, 8)}.jpg`,
      );
      await onTrozo(
        zip.anadir(`${carpeta}/fotos/${nombre}`, leido.contenido, input.ahora),
      );
      ficheros += 1;
    }

    // ── Los consentimientos firmados, DESCIFRADOS ───────────────────
    const consentimientos = await vistaDeConsentimientos(prisma, {
      tenantId: input.tenantId,
      clientId: paciente.id,
    });
    const filasDeConsentimiento = await prisma.clientConsent.findMany({
      where: { tenantId: input.tenantId, clientId: paciente.id },
      select: { id: true, pdfFileName: true, pdfSha256: true },
    });
    for (const fila of filasDeConsentimiento) {
      if (fila.pdfFileName == null) continue;
      const leido = await leerFichero(
        "CONSENTIMIENTO",
        fila.pdfFileName,
        fila.pdfSha256,
        { tenantId: input.tenantId, dek },
      );
      if (!leido) {
        incidencias.push(
          `${carpeta}: el consentimiento ${fila.id.slice(0, 8)} no se pudo leer del volumen`,
        );
        continue;
      }
      if (!leido.huellaCuadra) {
        incidencias.push(
          `${carpeta}: el consentimiento ${fila.pdfFileName} NO cuadra con su huella — va en el paquete, con este aviso`,
        );
      }
      const doc = consentimientos.firmados.find((f) => f.id === fila.id);
      const nombre = nombreSeguroEnZip(
        `${(doc?.firmadoEn ?? "").slice(0, 10)}-${doc?.titulo ?? "consentimiento"}-${fila.id.slice(0, 8)}.pdf`,
      );
      await onTrozo(
        zip.anadir(
          `${carpeta}/consentimientos/${nombre}`,
          leido.contenido,
          input.ahora,
        ),
      );
      ficheros += 1;
    }

    // ── residencia-3 · la parte de RESIDENCIA ───────────────────────
    //
    // Va antes del JSON porque sus incidencias tienen que caber en él, y
    // sus ficheros se sueltan de uno en uno como las fotos: un centro con
    // 49 residentes y mil notas de voz no puede tener el ZIP entero en
    // memoria dos veces.
    const residencia = await parteDeResidencia(prisma, {
      tenantId: input.tenantId,
      clientId: paciente.id,
    });
    for (const inc of residencia.incidencias) {
      incidencias.push(`${carpeta}: ${inc}`);
    }
    for (const fichero of residencia.ficheros) {
      await onTrozo(
        zip.anadir(
          `${carpeta}/${fichero.ruta}`,
          fichero.contenido,
          input.ahora,
        ),
      );
      ficheros += 1;
    }
    if (residencia.json != null) {
      await onTrozo(
        zip.anadir(
          `${carpeta}/residencia.json`,
          Buffer.from(JSON.stringify(residencia.json, null, 2), "utf8"),
          input.ahora,
        ),
      );
      ficheros += 1;
    }

    // ── Y la estructura, para el JSON ───────────────────────────────
    const historia = await vistaDeLaHistoria(prisma, {
      tenantId: input.tenantId,
      clientId: paciente.id,
      ahora: input.ahora,
    });
    const entregas = await entregasDelPaciente(prisma, {
      tenantId: input.tenantId,
      clientId: paciente.id,
      ahora: input.ahora,
    });
    json.push({
      paciente: {
        id: paciente.id,
        nombre: `${paciente.firstName} ${paciente.lastName}`.trim(),
        // El nombre EXACTO, con sus tildes, aunque la carpeta las haya
        // perdido por el `unzip` viejo de macOS. Ver `nombreSeguroEnZip`.
        carpeta,
        nacimiento: paciente.birthdate?.toISOString().slice(0, 10) ?? null,
      },
      historia,
      fotos,
      consentimientos,
      entregas,
      // `null` en los clientes que no son residentes de este centro.
      residencia: residencia.json,
    });
  }

  // ── Los dos ficheros de la raíz ───────────────────────────────────
  await onTrozo(
    zip.anadir(
      "centro.json",
      Buffer.from(
        JSON.stringify(
          {
            exportadoEn: input.ahora.toISOString(),
            tenantId: input.tenantId,
            pacientes: json,
            incidencias,
          },
          null,
          2,
        ),
        "utf8",
      ),
      input.ahora,
    ),
  );
  ficheros += 1;

  // Y LAS INCIDENCIAS EN UN `.txt`, para que se vean sin abrir el JSON.
  // Un paquete al que le falta algo en silencio es peor que uno que lo
  // dice: quien lo recibe tiene que saber que no está completo ANTES de
  // firmar que lo recibió.
  if (incidencias.length > 0) {
    await onTrozo(
      zip.anadir(
        "FALTAN.txt",
        Buffer.from(
          [
            "Este paquete NO está completo. Lo que falta o no cuadra:",
            "",
            ...incidencias.map((x) => `· ${x}`),
            "",
            "Avisa a Mi Piace con este fichero antes de dar la devolución por buena.",
          ].join("\n"),
          "utf8",
        ),
        input.ahora,
      ),
    );
    ficheros += 1;
  }

  await onTrozo(zip.cerrar());
  return { pacientes: pacientes.length, ficheros, bytes: zip.bytes, incidencias };
}
