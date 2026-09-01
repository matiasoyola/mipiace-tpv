package es.mipiace.tpv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileWriter;

/**
 * A4 · el rescate nativo, probado en la JVM.
 *
 * <p>{@link WebViewRescue} es Java puro a propósito (sólo {@code java.io.File})
 * para que estas dos cosas se puedan afirmar sin emulador y sin terminal:
 *
 * <ul>
 *   <li>que no se dispara dos veces con el mismo versionCode — si se disparara
 *       en cada arranque, el TPV borraría su caché cada vez que se abre;
 *   <li>que borra Service Worker y cachés y <b>NO</b> localStorage — borrarlo
 *       desvincula el terminal y obliga a pedir un código de 6 dígitos en la
 *       barra un lunes por la mañana.
 * </ul>
 *
 * <p>Correr con:
 * {@code (cd apps/tpv-android/android && ./gradlew :app:testDebugUnitTest)}
 */
public class WebViewRescueTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private File webViewDir;
    private File perfil;

    /**
     * Reproduce el perfil real del AP11 tal y como se leyó por adb la noche
     * del 01-09: el CacheStorage del Service Worker con el asset de
     * producción dentro, y al lado el Local Storage con la vinculación.
     */
    @Before
    public void montarPerfilEnvenenado() throws Exception {
        webViewDir = tmp.newFolder("app_webview");
        perfil = new File(webViewDir, "Default");

        escribir("Service Worker/ScriptCache/ba23d8ecda68de77_0", "index-CW8x8vhm.js");
        escribir(
                "Service Worker/CacheStorage/d52edff7ee9fe262f9fc84b6bbf6c614/8d5ce20b17eca125_0",
                "HTTP/1.1 200\nserver: Caddy\nlast-modified: Mon, 31 Aug 2026 10:45:52 GMT\n");
        escribir("Service Worker/Database/000003.log", "registro del sw de produccion");
        escribir("Cache/Cache_Data/index", "cache http del webview");
        escribir("Code Cache/js/index", "bytecode cacheado");

        escribir("Local Storage/leveldb/000004.log", "mipiacetpv-device-me");
        escribir("Session Storage/000005.log", "sesion de pestana");
        escribir("IndexedDB/https_mipiacetpv.com_0.indexeddb.leveldb/CURRENT", "outbox+auth");
        escribir("databases/Databases.db", "websql legado");
    }

    private void escribir(String rutaRelativa, String contenido) throws Exception {
        File f = new File(perfil, rutaRelativa);
        assertTrue("no pude crear " + f, f.getParentFile().mkdirs() || f.getParentFile().isDirectory());
        try (FileWriter w = new FileWriter(f)) {
            w.write(contenido);
        }
    }

    private boolean existe(String rutaRelativa) {
        return new File(perfil, rutaRelativa).exists();
    }

    // ── Sabotaje 3 · "fingir un versionCode sin cambios" ─────────────────────

    /**
     * Con el mismo versionCode que la última purga, el rescate NO se dispara.
     *
     * <p>Esta es la condición de idempotencia entera: {@code MainActivity}
     * llama a {@link WebViewRescue#purge(File)} sólo si esto devuelve true, y
     * anota el versionCode justo después. Si {@code shouldPurge} devolviera
     * true siempre, el terminal borraría su caché en cada arranque.
     */
    @Test
    public void noSeDisparaDosVecesConElMismoVersionCode() {
        long instalada = 11401L;

        // Primer arranque tras instalar: nunca se purgó → sí.
        assertTrue(
                "primera vez con esta versión: tiene que purgar",
                WebViewRescue.shouldPurge(instalada, WebViewRescue.NUNCA_PURGADO));

        // MainActivity anota `instalada`. Segundo arranque, misma versión.
        assertFalse(
                "mismo versionCode ya purgado: NO puede volver a purgar",
                WebViewRescue.shouldPurge(instalada, instalada));

        // Y sigue sin dispararse por muchos arranques que pasen.
        assertFalse(WebViewRescue.shouldPurge(instalada, instalada));
        assertFalse(WebViewRescue.shouldPurge(instalada, instalada));
    }

    /**
     * Bajar de versión también limpia. Se compara por desigualdad, no por
     * "mayor que": reinstalar una APK anterior para reproducir un fallo deja
     * el terminal con caché de otra versión igual que subir.
     */
    @Test
    public void seDisparaTambienAlBajarDeVersion() {
        assertTrue(WebViewRescue.shouldPurge(11400L, 11401L));
    }

    // ── Sabotaje 4 · "fingir un versionCode nuevo" ───────────────────────────

    /** Con versionCode nuevo, el rescate sí se dispara. */
    @Test
    public void seDisparaConVersionCodeNuevo() {
        assertTrue(WebViewRescue.shouldPurge(11401L, 11400L));
    }

    /** Borra Service Worker y las dos cachés del WebView. */
    @Test
    public void purgaBorraServiceWorkerYCaches() {
        int borrados = WebViewRescue.purge(webViewDir);

        assertEquals("tenía que borrar los 3 directorios objetivo", 3, borrados);
        assertFalse("el Service Worker sigue ahí", existe("Service Worker"));
        assertFalse("el sw.js de producción sigue cacheado", existe("Service Worker/ScriptCache"));
        assertFalse(
                "el asset de producción sigue en el CacheStorage del SW",
                existe("Service Worker/CacheStorage"));
        assertFalse("la caché HTTP sigue ahí", existe("Cache"));
        assertFalse("el Code Cache sigue ahí", existe("Code Cache"));
    }

    /**
     * Y NO borra localStorage. Es la mitad importante del test: un rescate que
     * limpiara de más desvincularía el terminal.
     */
    @Test
    public void purgaNoBorraLocalStorageNiElRestoDeDatos() {
        WebViewRescue.purge(webViewDir);

        assertTrue(
                "localStorage borrado: el terminal quedaría desvinculado y pediría código",
                existe("Local Storage/leveldb/000004.log"));
        assertTrue("IndexedDB borrado: outbox de cobros y auth offline perdidos",
                existe("IndexedDB/https_mipiacetpv.com_0.indexeddb.leveldb/CURRENT"));
        assertTrue(existe("Session Storage/000005.log"));
        assertTrue(existe("databases/Databases.db"));

        // Cinturón: ningún directorio declarado como preservado puede estar en
        // la lista de borrado. Un despiste al añadir una entrada nueva a
        // DIRECTORIOS_A_BORRAR cae aquí.
        for (String preservado : WebViewRescue.DIRECTORIOS_PRESERVADOS) {
            for (String aBorrar : WebViewRescue.DIRECTORIOS_A_BORRAR) {
                assertFalse(
                        "'" + preservado + "' está declarado preservado y también a borrar",
                        preservado.equals(aBorrar));
            }
            assertTrue(
                    "'" + preservado + "' no sobrevivió a la purga",
                    new File(perfil, preservado).exists());
        }
    }

    /** El perfil sigue siendo utilizable: la purga no borra `Default` entero. */
    @Test
    public void purgaDejaElPerfilEnPie() {
        WebViewRescue.purge(webViewDir);
        assertTrue("el directorio del perfil desapareció", perfil.isDirectory());
        assertTrue("app_webview desapareció", webViewDir.isDirectory());
    }

    /**
     * Segunda purga sobre un perfil ya limpio: cero borrados y sin excepción.
     * MainActivity la llama una sola vez por cambio de versión, pero el método
     * tiene que ser inofensivo si se repite.
     */
    @Test
    public void purgaEsIdempotenteSobreDiscoLimpio() {
        assertEquals(3, WebViewRescue.purge(webViewDir));
        assertEquals(0, WebViewRescue.purge(webViewDir));
    }

    /** Instalación limpia: no hay perfil todavía y no pasa nada. */
    @Test
    public void purgaSobrePerfilInexistenteNoRompe() throws Exception {
        File vacio = tmp.newFolder("app_webview_vacio");
        assertEquals(0, WebViewRescue.purge(vacio));
    }

    /** Defensa del camino de arranque: null no lanza. */
    @Test
    public void purgaConNullNoLanza() {
        assertEquals(0, WebViewRescue.purge(null));
    }
}
