// clinica-7 · LA RUTA PÚBLICA DEL INFORME. SIN SESIÓN, Y CON CÓDIGO.
//
//   GET  /informe/:token          — ¿este enlace sirve? (sin enseñar nada)
//   POST /informe/:token          — el código, y el PDF si cuadra
//
// ── Por qué dos rutas y no una ───────────────────────────────────────
//
// Porque la pantalla necesita saber si tiene que pedir el código ANTES de
// pedirlo, y el `GET` no puede traer el código (iría en la URL, y entonces
// el código no protegería nada — ver `informe-enlace.ts`).
//
// El `GET` contesta lo mínimo para pintar el formulario: el nombre de la
// clínica y «hace falta una clave de 6 cifras». **Ni el tipo de informe,
// ni el nombre del paciente, ni nada de la historia.** Si la URL se filtra
// sin el código, lo que se filtra es el nombre de una clínica — y el
// nombre de una clínica no dice de quién es el documento.
//
// Y el `GET` **no gasta** ni una apertura ni un intento de código: abrir la
// página no es leer el informe. Las tres aperturas se gastan en el `POST`,
// que es donde sale el documento.
//
// ── La seguridad NO está en este fichero ─────────────────────────────
//
// El formato del token, la huella, la caducidad, las tres aperturas, la
// revocación, el código y sus cinco fallos, los dos límites de peticiones,
// las tres cabeceras y la 404 común los decide **la puerta**
// (`enlaces/puerta.ts`) con las reglas del `purpose` `INFORME_CLINICO`.
// Lo que queda aquí es qué se sirve.
//
// Es el punto de `enlaces-publicos`: este es el segundo `purpose` y no ha
// vuelto a escribir seguridad.
//
// ── La misma 404 para todo, y ahora para seis casos ─────────────────
//
// «No existe», «caducado», «gastado», «anulado», «el código está mal» y
// «el código se agotó y el enlace se anuló» contestan lo mismo, carácter
// por carácter. El quinto y el sexto son los nuevos, y son los que más
// importan: decirle «el código está mal» a quien prueba códigos le
// confirma que el enlace existe y que iba por buen camino.
//
// ── Y cada apertura deja su línea ────────────────────────────────────
//
// `registraAccesoClinico: true` en el `purpose`, con el actor «paciente
// por enlace» de clinica-2 y `action = EXPORT`. Lo escribe la puerta, no
// esta ruta — «cada ruta se acuerda» es la forma de fallo que clinica-1
// cerró.
//
// Es lo que un adjunto no puede decir nunca: quién abrió el informe y
// cuándo.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { PATRON_CODIGO } from "../enlaces/codigo.js";
import {
  cabecerasDeEnlace,
  consumirEnlace,
  enlaceNoSirve,
  registrarAccesoDelEnlace,
  resolverEnlace,
} from "../enlaces/puerta.js";
import { REGLAS_INFORME, type EntregaDelEnlace } from "../enlaces/reglas.js";
import { dekONada } from "./claves.js";
import { leerFichero, MIME_DE_PDF } from "./ficheros.js";

const PARAMS = {
  type: "object",
  required: ["token"],
  additionalProperties: false,
  // 43 caracteres base64url. El formato se valida ADEMÁS en la puerta,
  // antes de tocar la base: aquí es para que Fastify descarte lo que no
  // tiene ni forma de token sin entrar al handler.
  properties: { token: { type: "string", minLength: 43, maxLength: 43 } },
} as const;

export async function registerInformePublicoRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── ¿Sirve este enlace? ─────────────────────────────────────────────
  //
  // Contesta sin enseñar nada del informe y SIN gastar nada. La puerta se
  // consulta con `reglas` cuyo `pideCodigo` se fuerza a `false` sólo para
  // esta comprobación: lo que se está preguntando es «¿el enlace está
  // vivo?», no «¿el código es bueno?».
  //
  // Es la única excepción al «lo decide el `purpose`» de todo el bloque, y
  // está acotada a una ruta que no devuelve ni un dato de salud. Sin ella,
  // la pantalla tendría que pedir el código a ciegas y un enlace caducado
  // se vería como «código incorrecto» cinco veces.
  app.get(
    "/informe/:token",
    { schema: { params: PARAMS } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const resuelto = await resolverEnlace<EntregaDelEnlace>(
        request,
        reply,
        { ...REGLAS_INFORME, pideCodigo: false },
      );
      if (!resuelto) return reply;

      // Lo MÍNIMO para pintar el formulario. Ni el tipo de informe, ni el
      // nombre del paciente, ni el id de nada.
      return cabecerasDeEnlace(reply).send({
        clinica: resuelto.objetivo.tenant.name,
        pideCodigo: true,
        /** Cuántas aperturas quedan. Se dice porque la pantalla tiene que
         *  poder avisar («le queda una»), y no cuenta nada de nadie. */
        aperturasRestantes: resuelto.usosRestantes,
      });
    },
  );

  // ── El código, y el PDF si cuadra ───────────────────────────────────
  app.post(
    "/informe/:token",
    {
      schema: {
        params: PARAMS,
        body: {
          type: "object",
          required: ["codigo"],
          additionalProperties: false,
          properties: {
            // Seis cifras. El patrón se comprueba ADEMÁS en
            // `codigoCuadra`: el schema descarta lo que no tiene forma
            // antes del handler, y la comparación en tiempo constante es
            // la que decide.
            codigo: { type: "string", pattern: PATRON_CODIGO.source },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // AQUÍ sí con el `pideCodigo` del `purpose`: la puerta comprueba el
      // código, cuenta el fallo en la fila y anula el enlace al quinto.
      const resuelto = await resolverEnlace<EntregaDelEnlace>(
        request,
        reply,
        REGLAS_INFORME,
      );
      if (!resuelto) return reply;

      const entrega = resuelto.objetivo;
      const prisma = getPrisma();

      // LA LÍNEA DEL REGISTRO, ANTES DE SERVIR. Igual que `conHistoria`:
      // si no se puede escribir, la petición falla. Trazabilidad por
      // encima de disponibilidad — nadie pierde nada si el informe no se
      // abre ahora; lo que no se puede perder es la prueba de que se
      // abrió.
      try {
        await registrarAccesoDelEnlace(prisma, REGLAS_INFORME, {
          tenantId: resuelto.tenantId,
          objetivo: entrega,
          route: "POST /informe/:token",
        });
      } catch (err) {
        request.log.error(
          { event: "informe_enlace_registro_fallido", err },
          "no se pudo registrar la apertura del informe por enlace — se corta",
        );
        return cabecerasDeEnlace(reply).code(500).send({
          error: "CLINICAL_ACCESS_LOG_FAILED",
          code: "CLINICAL_ACCESS_LOG_FAILED",
          message:
            "No se pudo abrir el documento. Inténtelo de nuevo; si sigue, llame a la clínica.",
        });
      }

      // EL FICHERO. Cifrado en el volumen, con la clave de su clínica.
      const leido = await leerFichero(
        "INFORME",
        entrega.pdfFileName!,
        entrega.pdfSha256,
        {
          tenantId: resuelto.tenantId,
          dek: await dekONada(resuelto.tenantId, prisma),
        },
      );
      if (!leido) {
        // El fichero no está, o no descifra. **No se gasta la apertura**:
        // el destinatario no ha podido leer nada, y gastársela sería
        // castigarle por un fallo nuestro.
        request.log.error(
          { event: "informe_enlace_sin_fichero", entregaId: entrega.id },
          "la entrega de un informe por enlace apunta a un fichero que no está o no descifra",
        );
        return cabecerasDeEnlace(reply).code(410).send({
          error: "INFORME_FILE_MISSING",
          code: "INFORME_FILE_MISSING",
          message:
            "El documento no está disponible. Llame a la clínica y se lo preparamos otra vez.",
        });
      }

      // GASTAR LA APERTURA, y sólo cuando hay documento que servir. El
      // `updateMany` con el tope en el WHERE es el cierre de la carrera
      // (dos pestañas a la vez): el segundo mueve cero filas y contesta la
      // misma 404.
      const gastado = await consumirEnlace(prisma, {
        enlaceId: resuelto.enlaceId,
        maxUsos: REGLAS_INFORME.maxUsos,
      });
      if (!gastado) {
        return enlaceNoSirve(
          reply,
          REGLAS_INFORME as never,
        );
      }

      return cabecerasDeEnlace(reply)
        .header("Content-Type", MIME_DE_PDF)
        .header("Content-Length", leido.bytes)
        .header("X-Content-Type-Options", "nosniff")
        // La huella del PDF en claro, comprobada después de descifrar. Si
        // no cuadra, el documento se sirve CON el aviso, igual que el
        // consentimiento de clinica-4: un documento que no cuadra es justo
        // el que alguien tiene que mirar.
        .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "NO")
        .header(
          "Content-Disposition",
          // Sin nada del paciente en el nombre: un fichero descargado se
          // queda en la carpeta de descargas, y ahí el nombre es lo único
          // que se lee.
          'inline; filename="documento-clinico.pdf"',
        )
        .send(leido.contenido);
    },
  );
}
