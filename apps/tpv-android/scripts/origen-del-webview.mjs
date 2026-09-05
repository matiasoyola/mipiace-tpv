// A5 · R5 · el origen del WebView es la vinculación del terminal.
//
// EL INCIDENTE (2026-09-04). Salió una APK con `androidScheme: "http"` y
// `hostname: "a5-lab.mipiacetpv.com"`, puestas a mano y marcadas TEMPORAL para
// una pasada de laboratorio de A5. El terminal instaló bien, arrancó bien, y
// pidió un código de emparejamiento de 6 dígitos en mitad del servicio. UN
// CLIENTE REAL SE QUEDÓ SIN COBRAR.
//
// POR QUÉ. El WebView guarda `localStorage` POR ORIGEN, y el origen es
// `androidScheme://hostname`. La vinculación del terminal
// —`mipiacetpv-device-token` y `mipiacetpv-device-me`— vive ahí. Cambiar
// cualquiera de los dos no "reconfigura" nada: le da al TPV un almacén vacío.
// El terminal no estaba roto ni desvinculado en el servidor; estaba mirando
// otro cajón.
//
// Es un fallo especialmente cruel porque NO da la cara en el build, ni en la
// instalación, ni en el primer arranque de un terminal nuevo (que no tiene
// vinculación que perder). Sólo la da al actualizar un terminal que YA estaba
// funcionando, que es el único caso que no se prueba en la mesa.
//
// QUÉ HACE ESTE MÓDULO. Fija los tres valores y sabe leerlos de los dos sitios
// donde importan:
//
//   1. `capacitor.config.ts` — la fuente. Se comprueba ANTES de compilar, para
//      que el build muera en dos segundos y no tras dos minutos de Vite.
//   2. `capacitor.config.json` — lo que `cap sync` deja en el proyecto nativo,
//      que es LO QUE SE EMPAQUETA DE VERDAD. Un `assets/` viejo de un build
//      anterior deja la fuente impecable y el APK apuntando a otro origen.
//
// Lo usan los dos scripts de release (APK y AAB) y el test de R5, para que la
// lista de valores esperados exista UNA sola vez.

import { readFileSync } from "node:fs";

/**
 * Los tres valores. No son configurables, ni por argumento ni por variable de
 * entorno: una guarda que se puede apagar con `VITE_TPV_URL=…` no es una
 * guarda. Si algún día hay que cambiar el origen de verdad, se cambia aquí, se
 * ve en el diff y se piensa qué pasa con los terminales ya entregados —
 * que es exactamente la conversación que no ocurrió el 04-09.
 */
export const ORIGEN_ESPERADO = Object.freeze({
  androidScheme: "https",
  hostname: "mipiacetpv.com",
  allowMixedContent: false,
});

/** El origen que ve el WebView, que es la clave del `localStorage`. */
export const ORIGEN_URL = `${ORIGEN_ESPERADO.androidScheme}://${ORIGEN_ESPERADO.hostname}`;

/**
 * Quita comentarios de TypeScript sin romper las cadenas.
 *
 * No vale un `replace(/\/\/.*$/gm)` a pelo: en cuanto alguien escriba una URL
 * con `https://` en un valor, el `//` de dentro de la cadena se comería el
 * resto de la línea. Y al revés importa más todavía — el propio
 * `capacitor.config.ts` EXPLICA en un comentario los valores malos del 04-09
 * (`androidScheme: "http"`), así que sin quitar comentarios la guarda leería
 * la explicación del incidente y lo daría por reincidencia.
 */
function sinComentarios(codigo) {
  let salida = "";
  let comilla = null; // comilla abierta, o null
  let i = 0;
  while (i < codigo.length) {
    const c = codigo[i];
    const siguiente = codigo[i + 1];
    if (comilla) {
      if (c === "\\") {
        salida += c + (siguiente ?? "");
        i += 2;
        continue;
      }
      if (c === comilla) comilla = null;
      salida += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      comilla = c;
      salida += c;
      i += 1;
      continue;
    }
    if (c === "/" && siguiente === "/") {
      while (i < codigo.length && codigo[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && siguiente === "*") {
      i += 2;
      while (i < codigo.length && !(codigo[i] === "*" && codigo[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    salida += c;
    i += 1;
  }
  return salida;
}

/** Lee los tres valores de `capacitor.config.ts` (la fuente). */
export function leerConfigTs(ruta) {
  const codigo = sinComentarios(readFileSync(ruta, "utf8"));
  const cadena = (clave) => codigo.match(new RegExp(`${clave}\\s*:\\s*["']([^"']*)["']`))?.[1];
  const booleano = (clave) => {
    const m = codigo.match(new RegExp(`${clave}\\s*:\\s*(true|false)`));
    return m ? m[1] === "true" : undefined;
  };
  return {
    androidScheme: cadena("androidScheme"),
    hostname: cadena("hostname"),
    allowMixedContent: booleano("allowMixedContent"),
    // `server.url` apunta el WebView a otro sitio ENTERO (hot-reload). En un
    // release no puede estar activo: es el mismo fallo que el origen, pero peor.
    serverUrl: cadena("url"),
  };
}

/** Lee los tres valores del JSON que `cap sync` deja en el proyecto nativo. */
export function leerConfigJson(ruta) {
  const c = JSON.parse(readFileSync(ruta, "utf8"));
  return {
    // Capacitor omite `androidScheme` del JSON cuando vale el default. El
    // default de Capacitor 6 es "https", así que ausente == "https"; lo que no
    // se puede es dar por bueno un valor distinto.
    androidScheme: c.server?.androidScheme ?? "https",
    hostname: c.server?.hostname,
    allowMixedContent: c.android?.allowMixedContent ?? false,
    serverUrl: c.server?.url,
  };
}

/**
 * Compara con lo esperado. Devuelve la lista de problemas (vacía = todo bien).
 * No lanza ni imprime: quien llama decide si eso es un test rojo o un build
 * abortado.
 */
export function comprobarOrigen(valores, procedencia) {
  const fallos = [];
  for (const [clave, esperado] of Object.entries(ORIGEN_ESPERADO)) {
    if (valores[clave] !== esperado) {
      fallos.push(
        `${procedencia}: ${clave} es ${JSON.stringify(valores[clave])} y tiene que ser ${JSON.stringify(esperado)}`,
      );
    }
  }
  if (valores.serverUrl) {
    fallos.push(
      `${procedencia}: server.url está activo (${JSON.stringify(valores.serverUrl)}). Eso es hot-reload de desarrollo: en un release el WebView cargaría desde otra máquina.`,
    );
  }
  return fallos;
}

/** El porqué, para pegarlo entero en la salida del build que aborta. */
export const EXPLICACION = `
       El WebView guarda localStorage POR ORIGEN, y el origen es
       androidScheme://hostname (${ORIGEN_URL}). La vinculación del terminal
       (mipiacetpv-device-token, mipiacetpv-device-me) vive ahí.

       Con otro esquema u otro host, el terminal arranca DESVINCULADO y pide un
       código de 6 dígitos. Pasó el 2026-09-04 con androidScheme=http y
       hostname=a5-lab.mipiacetpv.com: un cliente real se quedó sin cobrar.

       No da la cara al compilar, ni al instalar, ni en un terminal nuevo. Sólo
       al actualizar uno que YA funcionaba.

       Para probar contra una API local NO se toca esto: levanta la API con TLS,
       o usa server.url (hot-reload), que no cambia el origen del bundle
       instalado. Arregla apps/tpv-android/capacitor.config.ts.`;
