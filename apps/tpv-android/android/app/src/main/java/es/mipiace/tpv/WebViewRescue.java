package es.mipiace.tpv;

import java.io.File;

/**
 * A4 · rescate de terminales envenenados por el Service Worker de producción.
 *
 * <h3>Por qué esto es nativo y no JavaScript</h3>
 *
 * Hasta A4, el WebView corría bajo el origen real ({@code server.hostname =
 * mipiacetpv.com}) y Capacitor interceptaba las peticiones del WebView pero NO
 * las del Service Worker. El registro de {@code /sw.js} salía a internet,
 * traía el sw.js de producción, precacheaba los assets de producción y pasaba
 * a controlar la página. A partir de ahí el terminal servía producción para
 * siempre y el bundle de la APK quedaba de adorno.
 *
 * <p>A4 apaga el Service Worker en el build de Android, pero eso sólo arregla
 * las instalaciones limpias. Un terminal que YA tiene el SW de producción
 * registrado seguirá sirviendo producción aunque se le instale la APK nueva,
 * porque el JS que se ejecuta es el de producción: cualquier rescate escrito
 * en el front <b>no llegaría nunca a ejecutarse</b>. Por eso el rescate vive
 * aquí, en Java, y corre ANTES de que el WebView exista.
 *
 * <p>Se verificó esa noche, dos veces, que borrar el Service Worker a mano en
 * el terminal no arreglaba nada: al recargar se lo volvía a bajar. Con el SW
 * ya apagado en el bundle de la APK, este borrado sí es definitivo — no queda
 * nadie que lo vuelva a registrar.
 *
 * <h3>Lo que NO se toca</h3>
 *
 * {@code localStorage} se preserva a propósito. Ahí vive
 * {@code mipiacetpv-device-me}: borrarlo desvincula el terminal y obliga a
 * pedir un código de 6 dígitos en la barra un lunes por la mañana. Lo mismo
 * con IndexedDB, donde viven el outbox de cobros pendientes
 * ({@code mipiacetpv-outbox}) y el paquete offline de auth
 * ({@code mipiacetpv-auth}). El rescate limpia el transporte, no los datos.
 *
 * <p>Esta clase es Java puro (sólo {@link java.io.File}) justamente para poder
 * probarla en la JVM sin emulador: ver {@code WebViewRescueTest}.
 */
public final class WebViewRescue {

    private WebViewRescue() {}

    /** Fichero de SharedPreferences propio del rescate (no lo usa nadie más). */
    public static final String PREFS_NAME = "mipiacetpv-rescate-webview";

    /** Último versionCode para el que ya se purgó. Ausente = nunca se purgó. */
    public static final String KEY_LAST_PURGED_VERSION_CODE = "lastPurgedVersionCode";

    /** Valor centinela: no hay purga previa registrada. */
    public static final long NUNCA_PURGADO = -1L;

    /**
     * Directorios que se borran, relativos a {@code app_webview/Default}.
     *
     * <p>{@code Service Worker} contiene el registro, el ScriptCache (el
     * propio sw.js de producción) y su CacheStorage (los assets precacheados:
     * es donde apareció {@code index-B2g4RT4W.js} con la cabecera
     * {@code server: Caddy}). {@code Cache} y {@code Code Cache} son la caché
     * HTTP y de bytecode del WebView: sin ellas, una recarga podría volver a
     * servir el HTML de producción aunque el SW ya no exista.
     *
     * <p>No se usa {@code WebStorage.deleteAllData()}, que sería la vía
     * cómoda: borra TAMBIÉN localStorage e IndexedDB, y eso desvincularía el
     * terminal. No hay API pública que borre sólo Service Workers, así que se
     * borra por fichero — y por eso el borrado tiene que ocurrir antes de que
     * el WebView se inicialice, con los ficheros aún cerrados.
     */
    public static final String[] DIRECTORIOS_A_BORRAR = {
        "Service Worker",
        "Cache",
        "Code Cache",
    };

    /**
     * Directorios que el rescate NO puede tocar. No se usan para borrar: se
     * declaran para que el test los pueda afirmar uno a uno y para que quien
     * añada una entrada a {@link #DIRECTORIOS_A_BORRAR} vea contra qué choca.
     *
     * <ul>
     *   <li>{@code Local Storage} — {@code mipiacetpv-device-me}: la
     *       vinculación del terminal.
     *   <li>{@code IndexedDB} — outbox de cobros y paquete offline de auth.
     *   <li>{@code Session Storage}, {@code databases} — resto de estado del
     *       origen.
     * </ul>
     */
    public static final String[] DIRECTORIOS_PRESERVADOS = {
        "Local Storage",
        "Session Storage",
        "IndexedDB",
        "databases",
    };

    /**
     * ¿Toca purgar en este arranque?
     *
     * <p>Sólo cuando el versionCode instalado difiere del último para el que
     * se purgó. Es la condición de idempotencia: tras la primera purga se
     * anota el versionCode y los arranques siguientes de la MISMA versión no
     * hacen nada. Sin esto, cada arranque borraría la caché del WebView y el
     * TPV tardaría de más en pintar en cada apertura.
     *
     * <p>En una instalación limpia no hay anotación ({@link #NUNCA_PURGADO}) y
     * se purga: es barato, no hay nada que borrar, y cubre el caso real de
     * instalar la APK nueva encima de un terminal ya envenenado.
     *
     * <p>Se compara por desigualdad y no por "mayor que" a propósito: una
     * reinstalación hacia atrás (bajar de versión para reproducir un fallo)
     * también deja el terminal con caché de otra versión, y también hay que
     * limpiarla.
     */
    public static boolean shouldPurge(long installedVersionCode, long lastPurgedVersionCode) {
        return installedVersionCode != lastPurgedVersionCode;
    }

    /**
     * Borra los directorios de {@link #DIRECTORIOS_A_BORRAR} bajo
     * {@code <webViewDir>/Default}, dejando intacto todo lo demás.
     *
     * <p>Nunca lanza: un rescate que tumbe el arranque es peor que el fallo
     * que arregla. Si un fichero está bloqueado, se sigue con el resto y el
     * peor caso es que el terminal siga envenenado — exactamente donde estaba.
     *
     * @param webViewDir el {@code app_webview} de la app
     *     ({@code Context.getDir("webview", MODE_PRIVATE)}).
     * @return cuántos de los directorios objetivo existían y quedaron
     *     borrados. Sirve para el log de arranque y para el test.
     */
    public static int purge(File webViewDir) {
        if (webViewDir == null) {
            return 0;
        }
        File perfil = new File(webViewDir, "Default");
        int borrados = 0;
        for (String nombre : DIRECTORIOS_A_BORRAR) {
            File objetivo = new File(perfil, nombre);
            if (!objetivo.exists()) {
                continue;
            }
            if (deleteRecursively(objetivo)) {
                borrados++;
            }
        }
        return borrados;
    }

    /**
     * Borrado recursivo sin seguir enlaces simbólicos.
     *
     * <p>{@code listFiles()} sobre un symlink a directorio devolvería el
     * contenido del destino, así que un enlace dentro del perfil del WebView
     * podría llevarse por delante datos de fuera. En la práctica Chromium no
     * pone enlaces ahí, pero el rescate corre como root de su propio sandbox y
     * borra a ciegas: la comprobación cuesta una llamada y quita el riesgo.
     */
    private static boolean deleteRecursively(File objetivo) {
        if (!isSymlink(objetivo)) {
            File[] hijos = objetivo.listFiles();
            if (hijos != null) {
                for (File hijo : hijos) {
                    deleteRecursively(hijo);
                }
            }
        }
        return objetivo.delete();
    }

    private static boolean isSymlink(File f) {
        try {
            File padre = f.getParentFile();
            File canonicoPadre = (padre == null) ? f : padre.getCanonicalFile();
            File comparable = new File(canonicoPadre, f.getName());
            return !comparable.getCanonicalFile().equals(comparable.getAbsoluteFile());
        } catch (Exception e) {
            // Si no se puede resolver, se trata como enlace: no se desciende.
            return true;
        }
    }
}
