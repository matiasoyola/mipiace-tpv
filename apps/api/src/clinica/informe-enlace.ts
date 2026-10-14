// clinica-7 · la URL del informe por enlace.
//
// Lo mismo que `enlace.ts` hace por la valoración: aquí se queda lo que es
// del informe y de nadie más — la URL que viaja en el email. Todo lo demás
// (el token, el código, la caducidad, los usos, la 404) vive en
// `enlaces/`, declarado por el `purpose` `INFORME_CLINICO`.
//
// ── La pinta la PWA del TPV, como la valoración ──────────────────────
//
// Y por la misma razón que clinica-2: el documento ES una pantalla, y la
// pantalla que pide el código y enseña el PDF es una del TPV. Montar un
// front aparte para dos pantallas habría sido un despliegue más que
// mantener.
//
// ── Y el token va en la RUTA, no en el querystring ──────────────────
//
// Como la valoración. Lo que va en el querystring se copia al pegar un
// enlace «hasta el interrogante» y acaba en más logs. Y la cabecera
// `Referrer-Policy: no-referrer` que pone la puerta es lo que impide que
// la URL entera viaje en el `Referer` de lo que la página cargue.
//
// **El CÓDIGO no va en la URL.** Ni en la ruta ni en el querystring: se
// teclea en la pantalla y viaja en el cuerpo o en una cabecera. Meterlo en
// la URL anularía justo lo que compra — que tener la URL no baste.

import { loadEnv } from "../env.js";

export function urlDelInforme(token: string): string {
  const base = loadEnv().PUBLIC_TPV_URL.replace(/\/+$/, "");
  return `${base}/informe/${token}`;
}
