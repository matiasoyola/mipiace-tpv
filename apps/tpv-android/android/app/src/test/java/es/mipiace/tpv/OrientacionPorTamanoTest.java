package es.mipiace.tpv;

import static org.junit.Assert.assertEquals;

import android.content.pm.ActivityInfo;

import org.junit.Test;

/**
 * n1-vertical · la decisión de orientación, probada en la JVM.
 *
 * <p>{@link OrientacionPorTamano} no toca ningún objeto de Android a propósito
 * para que estas afirmaciones se puedan hacer sin emulador y sin terminal. Los
 * dos números que se prueban no son inventados: son los que devuelve
 * {@code adb shell am get-config} en el hierro que hay en la mesa.
 *
 * <ul>
 *   <li><b>N1</b> (el TPV portátil tipo móvil): {@code sw360dp}. Si esto sale
 *       horizontal, el aparato vuelve al viewport de 720×360 donde la hoja del
 *       ticket deja 24 px para las líneas: no se puede vender.
 *   <li><b>AP11-1006</b> (el de 10,1" de los pilotos): {@code sw800dp}. Si
 *       esto sale vertical, quince terminales en producción se ponen de canto
 *       un lunes por la mañana.
 * </ul>
 *
 * <p>Correr con:
 * {@code (cd apps/tpv-android/android && ./gradlew :app:testDebugUnitTest)}
 */
public class OrientacionPorTamanoTest {

    private static final int VERTICAL = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
    private static final int HORIZONTAL = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;

    @Test
    public void elN1_que_mide_360dp_va_en_vertical() {
        assertEquals(VERTICAL, OrientacionPorTamano.paraSmallestScreenWidthDp(360));
    }

    @Test
    public void elAP11_que_mide_800dp_sigue_en_horizontal() {
        assertEquals(HORIZONTAL, OrientacionPorTamano.paraSmallestScreenWidthDp(800));
    }

    /**
     * El umbral, por los dos lados. 600 dp YA es tablet: es el valor exacto
     * del calificador {@code sw600dp} de Android, y un umbral puesto más
     * arriba (720, por ejemplo) pondría de canto una tablet de 7" legítima.
     */
    @Test
    public void el_umbral_esta_en_600_y_600_es_tablet() {
        assertEquals(600, OrientacionPorTamano.UMBRAL_TABLET_DP);
        assertEquals(HORIZONTAL, OrientacionPorTamano.paraSmallestScreenWidthDp(600));
        assertEquals(VERTICAL, OrientacionPorTamano.paraSmallestScreenWidthDp(599));
    }

    @Test
    public void moviles_tipicos_en_vertical() {
        for (int dp : new int[] {320, 340, 360, 392, 411, 480, 540, 599}) {
            assertEquals("sw" + dp + "dp debería ser móvil", VERTICAL,
                    OrientacionPorTamano.paraSmallestScreenWidthDp(dp));
        }
    }

    @Test
    public void tablets_y_terminales_grandes_en_horizontal() {
        for (int dp : new int[] {600, 601, 720, 768, 800, 1024, 1280}) {
            assertEquals("sw" + dp + "dp debería ser tablet", HORIZONTAL,
                    OrientacionPorTamano.paraSmallestScreenWidthDp(dp));
        }
    }

    /**
     * {@code SMALLEST_SCREEN_WIDTH_DP_UNDEFINED} es 0. Sin medida fiable se
     * cae a lo conocido, que es el horizontal con el que funcionan los quince
     * terminales de producción.
     */
    @Test
    public void sin_medida_fiable_cae_a_horizontal() {
        assertEquals(HORIZONTAL, OrientacionPorTamano.paraSmallestScreenWidthDp(0));
        assertEquals(HORIZONTAL, OrientacionPorTamano.paraSmallestScreenWidthDp(-1));
        assertEquals(HORIZONTAL, OrientacionPorTamano.paraSmallestScreenWidthDp(Integer.MIN_VALUE));
    }

    @Test
    public void la_descripcion_para_el_log_dice_que_decidio() {
        assertEquals("móvil (360 dp)", OrientacionPorTamano.describir(360));
        assertEquals("tablet (800 dp)", OrientacionPorTamano.describir(800));
        assertEquals("tamaño desconocido", OrientacionPorTamano.describir(0));
    }
}
