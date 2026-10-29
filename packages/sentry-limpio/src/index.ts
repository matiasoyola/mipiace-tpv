// clinica-11 · LO QUE NO SALE DE NUESTRO SERVIDOR NI EN UN ERROR.
//
// `ClinicalEntry.body` lleva escrito en el esquema desde clinica-1:
//
//   «ESTE CAMPO NO SE ESCRIBE EN NINGÚN LOG. Ni en el de la aplicación,
//    ni en Sentry, ni en un mensaje de error.»
//
// Hasta este bloque esa frase era una intención. Las tres apps arrancaban
// Sentry sin `beforeSend`, y `@sentry/node` 10 **adjunta el cuerpo de la
// petición entrante al evento** (`requestDataIntegration`, cuyo `include.
// data` está puesto a `true` en el propio SDK con el comentario «Always
// attach body data that's already on the scope»). Un error 500 en
// `POST /clinica/clients/:id/entries` mandaba la exploración del pie —en
// claro, porque el cifrado pasa después— a un tercero. Y en el TPV los
// breadcrumbs de interfaz llevan el texto de lo que se pulsa, que en la
// agenda de una clínica es el nombre de la paciente.
//
// ── POR QUÉ UN PAQUETE Y NO TRES FUNCIONES ──────────────────────────
//
// La misma regla la necesitan la API, el TPV y el panel. Tres copias es
// tres sitios donde la lista blanca de cabeceras se queda corta en dos y
// nadie se entera: lo que se ve en Sentry es que **falta** un dato, no que
// sobra. Así que la decisión de qué se va vive en un fichero y los tres
// `init` la llaman. Es el mismo argumento exacto de `cripto-campos.ts`.
//
// El paquete no depende de `@sentry/node` ni de `@sentry/react`: trabaja
// sobre una forma mínima declarada aquí abajo. Los dos SDK comparten el
// tipo `Event` de `@sentry/core`, así que la forma encaja con los dos, y
// no importar ninguno de los dos es lo que permite que este paquete lo
// usen a la vez un proceso de Node y un bundle de navegador.
//
// ── QUÉ SE VA Y QUÉ SE QUEDA ────────────────────────────────────────
//
// Se va SIEMPRE, sin preguntar de qué ruta viene el evento:
//
//   · `request.data`      — el cuerpo. Es el dato de salud.
//   · `request.cookies`   — la sesión.
//   · `request.query_string` — `?nombre=…`, `?dni=…`.
//   · `request.headers`   — todas salvo `CABECERAS_PERMITIDAS`.
//   · `user`              — todo menos el id interno y el tenant.
//
// «Sin preguntar de qué ruta viene» es deliberado y es más fuerte que
// filtrar sólo lo clínico: una lista de rutas clínicas que haya que
// mantener es una lista que el día que alguien añada `/pacientes` se
// queda corta, y el fallo de esa lista no se ve en ninguna pantalla.
//
// De `extra` y `contexts` se va:
//
//   · toda clave que NOMBRE a una persona o a un dato clínico
//     (`LLAVES_PROHIBIDAS`);
//   · todo valor que no sea un primitivo. Un cuerpo de petición, una fila
//     clínica o una lista de líneas son objetos; un id, un contador y un
//     código de error son primitivos. Ésa es la frontera, y es la que
//     cierra el hueco de verdad: nadie mete a mano el nombre de una
//     paciente en un `extra`, lo que se mete es «el objeto que estaba
//     mirando» con la paciente dentro.
//   · lo que pase de `MAX_TEXTO` caracteres, recortado. Un identificador
//     no mide 300 caracteres; una anotación clínica sí.
//
// Y de las claves que son una URL o una ruta (`url`, `path`, `endpoint`,
// `ruta`) se va la query y se sustituye cada id por `:id`. Esta última no
// es teórica: `lib/error-handler.ts` registra `extra: { url: request.url }`
// en los dos `captureError` del manejador global, y `request.url` de
// Fastify **incluye la query**.
//
// Lo que se QUEDA, y se queda a propósito: el tipo y el mensaje de la
// excepción, el stack, los tags (`component`, `tenantId`, `requestId`) y
// la release. Sin eso Sentry no sirve para nada, y un stack no lleva datos
// de nadie. Que el MENSAJE no lleve valores del paciente no lo arregla un
// filtro —no hay forma de saber qué trozo de una cadena es un nombre—: lo
// arregla no concatenarlos al lanzar, y eso es código, no configuración.

// ── La forma mínima de un evento ─────────────────────────────────────

export interface PeticionDeSentry {
  url?: string;
  method?: string;
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
  headers?: Record<string, unknown>;
  [otro: string]: unknown;
}

export interface MigaDeSentry {
  type?: string;
  category?: string;
  message?: string;
  level?: string;
  data?: Record<string, unknown>;
  [otro: string]: unknown;
}

export interface UsuarioDeSentry {
  id?: string | number;
  [otro: string]: unknown;
}

export interface EventoDeSentry {
  request?: PeticionDeSentry;
  user?: UsuarioDeSentry | null;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: MigaDeSentry[];
  transaction?: string;
  [otro: string]: unknown;
}

// ── Las listas, declaradas ───────────────────────────────────────────

/**
 * Las cabeceras de la petición que SÍ viajan. Corta a propósito: cada una
 * está aquí porque sirve para diagnosticar y porque no identifica a nadie.
 *
 * `authorization`, `cookie` y `x-device-token` no están, y no por olvido:
 * son credenciales. Un `accept-language` tampoco — no ayuda a diagnosticar
 * nada y es huella.
 */
export const CABECERAS_PERMITIDAS: readonly string[] = [
  "host",
  "user-agent",
  "content-type",
  "content-length",
  "accept",
  "x-request-id",
  "sentry-trace",
  "baggage",
];

/**
 * Las claves de `extra` / `contexts` que se van por lo que NOMBRAN.
 *
 * Se compara por subcadena y sin acentos ni mayúsculas: `bodyCifrado`,
 * `nombrePaciente` y `DNI` caen las tres. Y se compara por subcadena
 * porque el riesgo no es la clave exacta, es la clave parecida que
 * alguien escribirá mañana.
 */
export const LLAVES_PROHIBIDAS: readonly string[] = [
  "body",
  "cuerpo",
  "note",
  "nota",
  "anotacion",
  "nombre",
  "apellido",
  "name",
  "email",
  "correo",
  "telefono",
  "phone",
  "dni",
  "nif",
  "nss",
  "paciente",
  "patient",
  "residente",
  "address",
  "direccion",
  "password",
  "contrasena",
  "pin",
  "token",
  "secret",
  "authorization",
  "cookie",
  "diagnostico",
  "descripcion",
  "correccion",
  "contenido",
  "resumen",
];

/** Las claves cuyo valor es una URL o una ruta y hay que recortar. */
const LLAVES_DE_RUTA: readonly string[] = ["url", "path", "endpoint", "ruta"];

/** Lo que mide como mucho un texto que viaja en `extra`. */
export const MAX_TEXTO = 200;

/**
 * Los segmentos que marcan una ruta clínica. Se usa SÓLO para decidir si
 * un breadcrumb de navegación del navegador se tira entero; el resto del
 * saneado no pregunta de qué ruta viene (ver la cabecera).
 */
const SEGMENTOS_CLINICOS: readonly string[] = [
  "clinica",
  "clinical",
  "residencia",
  "residentes",
  "historia",
  "pacientes",
  "sesion",
  "valoracion",
  "consentimientos",
  "fotos",
  "informe",
  "incidencias",
  "relevos",
  "no-conformidades",
  "personal",
  "clients",
];

// ── Utilidades ───────────────────────────────────────────────────────

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function llaveProhibida(llave: string): boolean {
  const l = sinAcentos(llave).toLowerCase();
  return LLAVES_PROHIBIDAS.some((p) => l.includes(p));
}

function llaveDeRuta(llave: string): boolean {
  const l = sinAcentos(llave).toLowerCase();
  return LLAVES_DE_RUTA.some((p) => l === p || l.endsWith(p));
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un segmento de ruta que identifica a ALGUIEN o a ALGO suyo. Un uuid, un
 * número, un token opaco (el del informe por enlace, el de la valoración
 * en la tablet) o cualquier cosa larga y sin pinta de palabra.
 */
function segmentoEsId(seg: string): boolean {
  if (UUID.test(seg)) return true;
  if (/^\d+$/.test(seg)) return true;
  if (seg.length >= 16 && !/^[a-z-]+$/i.test(seg)) return true;
  return false;
}

/**
 * La ruta sin query, sin hash y con cada id sustituido por `:id`.
 *
 * `https://api…/clinica/clients/7f3…/historia?pagina=2` →
 * `https://api…/clinica/clients/:id/historia`.
 *
 * Se conserva el origen cuando lo trae (ayuda a distinguir la API del
 * panel) y se tira la query ENTERA: filtrar parámetro a parámetro es la
 * misma lista que se queda corta, y de la query de una ruta clínica no se
 * necesita nada.
 */
export function recortarUrl(url: string): string {
  if (url === "") return url;
  const sinHash = url.split("#")[0] ?? "";
  const sinQuery = sinHash.split("?")[0] ?? "";
  // El origen, si lo hay, se deja intacto: no lleva datos y sitúa el error.
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*)?$/i.exec(sinQuery);
  const origen = m ? (m[1] ?? "") : "";
  const camino = m ? (m[2] ?? "") : sinQuery;
  const recortado = camino
    .split("/")
    .map((seg) => (segmentoEsId(seg) ? ":id" : seg))
    .join("/");
  return `${origen}${recortado}`;
}

/** ¿Esta ruta toca la historia de alguien? */
export function esRutaClinica(url: string): boolean {
  const camino = recortarUrl(url).toLowerCase();
  return camino
    .split("/")
    .some((seg) => SEGMENTOS_CLINICOS.includes(seg));
}

function recortarTexto(s: string): string {
  return s.length <= MAX_TEXTO ? s : `${s.slice(0, MAX_TEXTO)}…`;
}

/**
 * Un mapa de `extra` / `contexts`, saneado. Ver la cabecera: fuera las
 * claves que nombran, fuera lo que no es primitivo, recortado lo largo y
 * recortadas las rutas.
 */
export function limpiarMapa(
  mapa: Record<string, unknown>,
): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [llave, valor] of Object.entries(mapa)) {
    if (llaveProhibida(llave)) continue;
    if (valor === null || valor === undefined) continue;
    const t = typeof valor;
    if (t === "number" || t === "boolean" || t === "bigint") {
      salida[llave] = valor;
      continue;
    }
    if (t !== "string") continue;
    const texto = valor as string;
    salida[llave] = llaveDeRuta(llave)
      ? recortarUrl(texto)
      : recortarTexto(texto);
  }
  return salida;
}

/**
 * El usuario que viaja: el id interno y el tenant. Nada más — ni nombre,
 * ni email, ni IP, ni alias.
 *
 * `ip_address` se va aunque `sendDefaultPii` esté en `false`: la
 * `requestDataIntegration` lo pone desde las cabeceras cuando
 * `include.ip` queda encendido, y aquí no dependemos de haberlo apagado
 * bien en tres sitios.
 */
export function limpiarUsuario(
  usuario: UsuarioDeSentry | null | undefined,
): UsuarioDeSentry | undefined {
  if (!usuario) return undefined;
  const limpio: UsuarioDeSentry = {};
  if (typeof usuario.id === "string" || typeof usuario.id === "number") {
    limpio.id = usuario.id;
  }
  if (typeof usuario.tenantId === "string") limpio.tenantId = usuario.tenantId;
  return Object.keys(limpio).length > 0 ? limpio : undefined;
}

/**
 * Un breadcrumb del navegador, o `null` si no viaja.
 *
 * Se tiran:
 *
 *   · los de interfaz (`ui.click`, `ui.input`). El `message` de un
 *     `ui.click` es el árbol del DOM que se pulsó, con el `aria-label` y
 *     el texto dentro: en la agenda de una clínica eso es el nombre de la
 *     paciente, y en la historia es el título de una visita.
 *   · los de consola. Un `console.log` de depuración con la respuesta de
 *     `GET /clinica/clients/:id/historia` dentro es exactamente el
 *     accidente que este bloque viene a cerrar, y la consola no se audita.
 *   · los de navegación A UNA RUTA CLÍNICA. De los demás se recorta la
 *     URL.
 *
 * Y de todo lo que SÍ viaja se sanea el `data` con la misma regla que
 * `extra`: ahí es donde `fetch` y `xhr` dejan la URL y el cuerpo.
 */
export function limpiarMiga<B extends object>(migaDeSdk: B): B | null {
  // El genérico es `object` y no `MigaDeSentry` por una razón de TypeScript
  // y no de diseño: el `Breadcrumb` de `@sentry/core` es una INTERFAZ, y una
  // interfaz no es asignable a un tipo con firma de índice (TS sólo da la
  // firma implícita a los alias). Tipar el parámetro como `MigaDeSentry`
  // obligaría a los tres `beforeBreadcrumb` a castear. El cuerpo sí trabaja
  // con la forma declarada.
  const miga = migaDeSdk as unknown as MigaDeSentry;
  const cat = miga.category ?? "";
  // `ui.` ENTERO y no sólo `ui.click` / `ui.input`: son los dos que el SDK
  // emite hoy, y el prefijo cubre el que añada mañana.
  if (cat.startsWith("ui.") || cat === "console") return null;
  const limpia: MigaDeSentry = { ...miga };
  if (cat === "navigation") {
    const de = typeof miga.data?.from === "string" ? miga.data.from : "";
    const a = typeof miga.data?.to === "string" ? miga.data.to : "";
    if (esRutaClinica(de) || esRutaClinica(a)) return null;
  }
  if (miga.data) {
    limpia.data = limpiarMapa(miga.data);
    // `from` y `to` de un breadcrumb de navegación son rutas, pero sus
    // nombres no lo dicen y `limpiarMapa` sólo recorta las claves que se
    // llaman como una ruta. Aquí sí se sabe lo que son.
    if (cat === "navigation") {
      for (const llave of ["from", "to"] as const) {
        const v = miga.data[llave];
        if (typeof v === "string") limpia.data[llave] = recortarUrl(v);
      }
    }
  }
  if (typeof miga.message === "string") {
    limpia.message = recortarTexto(recortarUrl(miga.message));
  }
  return limpia as unknown as B;
}

/**
 * EL SANEADO DEL EVENTO. Lo llaman los `beforeSend` /
 * `beforeSendTransaction` de las tres apps, y es lo único que hay que
 * sabotear para ver los tests en rojo.
 *
 * Muta y devuelve el mismo objeto: es lo que espera `beforeSend`, y copiar
 * un evento entero para tirar la mitad no aporta nada.
 */
export function limpiarEvento<E extends object>(eventoDeSdk: E): E {
  // El genérico es `object` por lo mismo que en `limpiarMiga`: el `Event` de
  // `@sentry/core` es una interfaz y no encaja en un tipo con firma de
  // índice. Lo que se devuelve es EL MISMO objeto, saneado.
  const evento = eventoDeSdk as unknown as EventoDeSentry;
  const peticion = evento.request;
  if (peticion) {
    delete peticion.data;
    delete peticion.cookies;
    delete peticion.query_string;
    if (typeof peticion.url === "string") {
      peticion.url = recortarUrl(peticion.url);
    }
    if (peticion.headers) {
      const permitidas: Record<string, unknown> = {};
      for (const [nombre, valor] of Object.entries(peticion.headers)) {
        if (!CABECERAS_PERMITIDAS.includes(nombre.toLowerCase())) continue;
        permitidas[nombre] = valor;
      }
      peticion.headers = permitidas;
    }
  }
  const usuario = limpiarUsuario(evento.user);
  if (usuario) evento.user = usuario;
  else delete evento.user;
  if (evento.extra) evento.extra = limpiarMapa(evento.extra);
  if (evento.contexts) {
    const limpios: Record<string, unknown> = {};
    for (const [nombre, valor] of Object.entries(evento.contexts)) {
      if (llaveProhibida(nombre)) continue;
      // `contexts` es un mapa de mapas (`trace`, `runtime`, `os`, `app`…).
      // Cada uno se sanea como un `extra`; lo que no sea un mapa se va,
      // por la misma razón que los no-primitivos de `extra`.
      if (valor && typeof valor === "object" && !Array.isArray(valor)) {
        limpios[nombre] = limpiarMapa(valor as Record<string, unknown>);
      }
    }
    evento.contexts = limpios;
  }
  if (typeof evento.transaction === "string") {
    evento.transaction = recortarUrl(evento.transaction);
  }
  if (Array.isArray(evento.breadcrumbs)) {
    evento.breadcrumbs = evento.breadcrumbs
      .map((m) => limpiarMiga(m))
      .filter((m): m is MigaDeSentry => m !== null);
  }
  return eventoDeSdk;
}
