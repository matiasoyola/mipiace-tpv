package es.mipiace.tpv;

import android.content.pm.ActivityInfo;

/**
 * n1-vertical · qué orientación le toca a un terminal según su TAMAÑO.
 *
 * <h3>El fallo que esto arregla</h3>
 *
 * Hasta este bloque la actividad llevaba {@code
 * android:screenOrientation="sensorLandscape"} en el manifiesto, pensado para
 * los terminales todo-en-uno de 10" y 15" que es lo único que había. En el N1
 * —un TPV portátil tipo móvil, 720×1440 físicos a densidad 320— eso deja un
 * viewport de <b>720×360 px CSS</b>: el layout que sale es el de móvil (sólo
 * aplica el breakpoint {@code sm}) pero con 360 px de alto. Medido en el
 * aparato el 2026-10-16: la hoja del ticket deja <b>24 px</b> para las líneas,
 * el cuerpo del cobro <b>70 px</b> para 651 px de contenido, y la búsqueda con
 * el teclado abierto no enseña ni un resultado.
 *
 * <p>En vertical el problema principal desaparece sin tocar una línea de CSS:
 * la hoja del ticket mide 390 px y las líneas caben enteras. El arreglo de raíz
 * es dejar que los móviles giren, no encajar el horizontal a la fuerza.
 *
 * <h3>El criterio es el tamaño, no la marca ni el modelo</h3>
 *
 * {@code smallestScreenWidthDp} es el ancho en dp del lado CORTO de la
 * pantalla, y no cambia al girar el aparato: es la medida con la que Android
 * mismo separa móvil de tablet ({@code sw600dp} es el calificador de recursos
 * de toda la vida). Medido por {@code adb shell am get-config}:
 *
 * <ul>
 *   <li>N1 (el móvil): {@code sw360dp} → vertical;
 *   <li>AP11-1006 (el de 10,1"): {@code sw800dp} → horizontal, como siempre.
 * </ul>
 *
 * <p>Una lista de modelos envejecería mal: el siguiente terminal portátil que
 * entre por la puerta no está en ella, y el fallo sería el de hoy otra vez.
 *
 * <h3>Lo desconocido cae a horizontal</h3>
 *
 * {@code Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED} es 0, y un valor
 * raro o negativo significa que no se pudo medir. En ese caso devolvemos
 * horizontal: es lo que han hecho los quince terminales en producción hasta
 * hoy. Equivocarse hacia lo conocido deja una caja funcionando como ayer;
 * equivocarse hacia lo nuevo podría dejar un AP11 en vertical en una barra.
 *
 * <p>Esta clase no toca ningún objeto de Android (los dos valores de
 * {@link ActivityInfo} son constantes de compilación, así que javac las
 * incrusta) justamente para poder probarla en la JVM sin emulador y sin
 * terminal: ver {@code OrientacionPorTamanoTest}.
 */
public final class OrientacionPorTamano {

    private OrientacionPorTamano() {}

    /**
     * A partir de aquí es tablet. 600 dp es el umbral de Android (el
     * calificador {@code sw600dp}), no un número nuestro: usar el mismo deja
     * la decisión nativa y la del CSS contando lo mismo.
     */
    public static final int UMBRAL_TABLET_DP = 600;

    /**
     * La orientación que hay que pedirle al sistema para un terminal cuyo lado
     * corto mide {@code smallestScreenWidthDp}.
     *
     * @param smallestScreenWidthDp de {@code Configuration}; 0 o negativo =
     *     no se pudo medir.
     * @return una constante {@code ActivityInfo.SCREEN_ORIENTATION_*}.
     */
    public static int paraSmallestScreenWidthDp(int smallestScreenWidthDp) {
        if (smallestScreenWidthDp <= 0) {
            // No se pudo medir: lo conocido.
            return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        }
        if (smallestScreenWidthDp < UMBRAL_TABLET_DP) {
            // Móvil. SENSOR_PORTRAIT y no PORTRAIT: deja el vertical del
            // revés, que es como se acaba sujetando un aparato con funda.
            return ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        }
        return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
    }

    /** Para los logs del arranque: "móvil (360 dp)" / "tablet (800 dp)". */
    public static String describir(int smallestScreenWidthDp) {
        if (smallestScreenWidthDp <= 0) return "tamaño desconocido";
        return (smallestScreenWidthDp < UMBRAL_TABLET_DP ? "móvil" : "tablet")
                + " (" + smallestScreenWidthDp + " dp)";
    }
}
