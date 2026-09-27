// declaracion-responsable · el armado de la declaración en el servidor.
//
// Aquí sólo se reúnen los TRES datos que varían con el despliegue y se los
// pasa al constructor del paquete. El contenido es de
// `packages/verifactu/src/declaracion.ts`; este módulo no escribe ni una
// frase de la declaración.
//
//   versión        → getAppVersion(), la misma que va en el campo `Version`
//                    de cada registro de facturación
//   fecha          → getAppVersionDate(), horneada junto a la versión
//   versión de APK → el `versionName` de la última release publicada
//
// La versión de la APK se lee del índice de releases porque el número de
// producto de la app Android no vive en el repo (lo pone Gradle al construir
// el bundle y lo apunta `infra/publicar-apk.sh` en `releases.json`). Ya es
// público: `/apk/latest.json` lo sirve sin sesión. Si no hay índice —
// desarrollo, CI, o ninguna release todavía — la declaración sale sólo con
// la versión del servidor, que es lo correcto: «media versión es peor que
// ninguna» (apps/tpv-web/src/platform/AppInfo.ts).

import {
  buildDeclaracionResponsable,
  type DeclaracionResponsable,
  type VersionApk,
} from "@mipiacetpv/verifactu";

import { loadEnv } from "../env.js";
import { latestRelease } from "../releases/store.js";
import { getAppVersion, getAppVersionDate } from "../version.js";

async function versionApkPublicada(): Promise<VersionApk | null> {
  try {
    const release = await latestRelease();
    if (!release) return null;
    return {
      versionName: release.versionName,
      versionCode: String(release.versionCode),
    };
  } catch {
    // `readReleases` ya devuelve [] en vez de lanzar si el índice no está o
    // está corrupto. El catch es el cinturón: este documento es una
    // obligación legal y no puede caerse porque falte un fichero en el VPS.
    return null;
  }
}

/** La declaración responsable de la versión EN EJECUCIÓN. */
export async function declaracionDeEstaVersion(): Promise<DeclaracionResponsable> {
  return buildDeclaracionResponsable({
    versionServidor: getAppVersion(),
    versionApk: await versionApkPublicada(),
    fechaSuscripcion: getAppVersionDate(),
    emailSoporte: loadEnv().SUPER_ADMIN_REPLY_TO_EMAIL,
  });
}
