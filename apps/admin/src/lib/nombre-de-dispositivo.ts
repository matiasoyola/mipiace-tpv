// clinica-8 (fase B, 18) · UN DISPOSITIVO CON NOMBRE LEGIBLE.
//
// Auditoría del 18-10, punto 32: «Dispositivos: la tablet como
// "Mozilla/5.0…"». La lista pinta `device.name ?? device.userAgent`, y
// el `name` lo pone quien empareja —casi nadie—, así que lo que la
// dueña ve es:
//
//   Mozilla/5.0 (Linux; Android 14; TB311FU Build/UP1A.231005.007; wv)
//   AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/…
//
// Y lo tiene que leer para decidir cuál revocar. Con dos tablets
// iguales, imposible.
//
// Lo que hace esta función es sacar de esa cadena las dos cosas que
// distinguen un aparato de otro en un mostrador: **el modelo y el
// sistema**. No es un parser de user-agents y no pretende serlo: es una
// lectura para humanos, y cuando no entiende algo lo dice devolviendo
// `null` para que quien llama enseñe lo que ya enseñaba.
//
// El user-agent crudo NO se pierde: la lista lo deja en el `title` del
// elemento. Lo que se quita de delante es el ruido, no el dato.

export interface DispositivoLeido {
  /** Lo que se pinta: «Android 14 · TB311FU». */
  titulo: string;
  /** El modelo solo, si se pudo sacar. Para los tests y por si alguna
   *  pantalla lo quiere aparte. */
  modelo: string | null;
}

/** Trozos que Android mete dentro del modelo y que no son el modelo. */
const RUIDO_DEL_MODELO = /\s+Build\/.*$/i;

/**
 * Lee un user-agent y devuelve cómo llamar a ese aparato, o `null` si no
 * lo reconoce.
 */
export function leerDispositivo(
  userAgent: string | null | undefined,
): DispositivoLeido | null {
  if (!userAgent || userAgent.trim().length === 0) return null;
  const ua = userAgent;

  // ── Android: `(Linux; Android 14; TB311FU Build/…)` ────────────────
  //
  // El modelo es opcional: algunos WebView mandan sólo la versión. Y
  // `; wv` marca que es un WebView, o sea NUESTRA APK y no el Chrome del
  // aparato — que es justo la distinción que hace falta cuando alguien
  // emparejó desde el navegador por error.
  const android = /Android\s+([\d.]+)(?:;\s*([^;)]+))?/.exec(ua);
  if (android) {
    const version = android[1]!;
    const modelo = (android[2] ?? "").replace(RUIDO_DEL_MODELO, "").trim();
    const esWebView = /;\s*wv\b/.test(ua);
    const partes = [`Android ${version}`];
    if (modelo.length > 0 && modelo.toLowerCase() !== "k") partes.push(modelo);
    partes.push(esWebView ? "app" : "navegador");
    return { titulo: partes.join(" · "), modelo: modelo || null };
  }

  // ── iPad / iPhone: `(iPad; CPU OS 17_4 like Mac OS X)` ─────────────
  const ios = /\((iPad|iPhone|iPod)[^)]*?OS\s+([\d_]+)/.exec(ua);
  if (ios) {
    const aparato = ios[1]!;
    const version = ios[2]!.replace(/_/g, ".");
    return { titulo: `${aparato} · iOS ${version}`, modelo: aparato };
  }
  if (/\biPad\b/.test(ua)) return { titulo: "iPad", modelo: "iPad" };

  // ── Escritorio: el sistema basta para distinguirlos ────────────────
  const escritorio: Array<[RegExp, string]> = [
    [/Windows NT 10/, "Windows"],
    [/Windows NT/, "Windows"],
    [/Mac OS X/, "Mac"],
    [/CrOS/, "ChromeOS"],
    [/\bX11\b|\bLinux\b/, "Linux"],
  ];
  for (const [patron, sistema] of escritorio) {
    if (!patron.test(ua)) continue;
    const navegador = /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
    return {
      titulo: navegador ? `${sistema} · ${navegador}` : sistema,
      modelo: null,
    };
  }

  return null;
}

/**
 * El nombre con el que se pinta una fila de Dispositivos.
 *
 * El orden es el de siempre: manda el nombre que alguien le puso. Lo que
 * cambia es el respaldo.
 */
export function nombreDeDispositivo(d: {
  name?: string | null;
  userAgent?: string | null;
}): string {
  const puesto = d.name?.trim();
  if (puesto) return puesto;
  return leerDispositivo(d.userAgent)?.titulo ?? "Dispositivo sin nombre";
}
