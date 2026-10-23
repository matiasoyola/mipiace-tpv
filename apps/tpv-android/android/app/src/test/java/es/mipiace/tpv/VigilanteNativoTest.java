package es.mipiace.tpv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * hierro-sirope (B) · la máquina de estados del vigilante nativo, en la JVM.
 *
 * <p>Lo que NO se puede probar aquí —y está dicho en el `-done`— es el fallo
 * de verdad: que AMS no pueda arrancar el proceso aislado del renderer. Eso
 * necesita el hierro, un {@code force-stop} y tres aperturas seguidas. Lo
 * que sí se puede probar es que la decisión no se vuelva loca: un intento de
 * recuperación y sólo uno, y que dos avisos del mismo fallo no gasten los
 * dos.
 *
 * <p>Correr con:
 * {@code (cd apps/tpv-android/android && ./gradlew :app:testDebugUnitTest)}
 */
public class VigilanteNativoTest {

    @Test
    public void si_pinta_a_tiempo_no_pasa_nada() {
        VigilanteNativo v = new VigilanteNativo();
        v.pintado();
        assertEquals(VigilanteNativo.Decision.NADA, v.noPinta());
        assertTrue(v.haPintado());
        assertFalse(v.seHaRendido());
    }

    @Test
    public void el_primer_fallo_intenta_recuperarse_y_el_segundo_se_rinde() {
        VigilanteNativo v = new VigilanteNativo();
        assertEquals(VigilanteNativo.Decision.RECREAR, v.noPinta());
        assertEquals(VigilanteNativo.Decision.RENDIRSE, v.noPinta());
        assertTrue(v.seHaRendido());
    }

    /**
     * El plazo y {@code onRenderProcessGone} pueden llegar los dos. Si el
     * segundo aviso del MISMO fallo gastara el intento, la pantalla de
     * «reinicia el terminal» saldría sin haber intentado nada — y, al revés,
     * un vigilante que no se rindiera nunca recrearía en bucle.
     */
    @Test
    public void rendido_ya_no_decide_mas() {
        VigilanteNativo v = new VigilanteNativo();
        v.noPinta();
        v.noPinta();
        assertEquals(VigilanteNativo.Decision.NADA, v.noPinta());
        assertEquals(VigilanteNativo.Decision.NADA, v.noPinta());
    }

    /**
     * El intento es por PROCESO, no por actividad: recuperarse es
     * {@code recreate()}, que construye una actividad nueva. Si el vigilante
     * de la actividad recreada naciera con el intento disponible, el D8 se
     * quedaría recreándose para siempre y el cajero no vería nunca el
     * mensaje que le dice cómo salir.
     */
    @Test
    public void el_vigilante_de_la_actividad_recreada_ya_no_tiene_intento() {
        VigilanteNativo primero = new VigilanteNativo();
        assertEquals(VigilanteNativo.Decision.RECREAR, primero.noPinta());
        assertTrue(primero.rescateGastado());

        VigilanteNativo trasRecrear = new VigilanteNativo(primero.rescateGastado());
        assertEquals(VigilanteNativo.Decision.RENDIRSE, trasRecrear.noPinta());
    }

    @Test
    public void tras_el_rescate_se_espera_menos() {
        VigilanteNativo v = new VigilanteNativo();
        assertEquals(VigilanteNativo.ESPERA_MS, v.esperaMs());
        v.noPinta();
        assertEquals(VigilanteNativo.ESPERA_TRAS_RESCATE_MS, v.esperaMs());
    }

    /**
     * El plazo del primer arranque tiene que ser más largo que el arranque
     * real del D8 con la caché recién purgada por el rescate de A4 (6-7 s
     * medidos). Un plazo corto enseña «reinicia el terminal» a una caja que
     * iba a abrir sola.
     */
    @Test
    public void el_plazo_deja_margen_al_arranque_frio_del_D8() {
        assertTrue(VigilanteNativo.ESPERA_MS >= 10_000L);
    }

    /** Lo que se lee detrás de una barra: qué pasa y qué hacer. */
    @Test
    public void el_mensaje_dice_como_salir() {
        assertTrue(VigilanteNativo.CUERPO_RENDICION.contains("Reinicia el terminal"));
        assertTrue(VigilanteNativo.CUERPO_RENDICION.contains("botón de encendido"));
        // Y dice que el dinero está a salvo, que es lo primero que piensa
        // quien ve una caja en blanco con gente delante.
        assertTrue(VigilanteNativo.CUERPO_RENDICION.contains("a salvo"));
    }
}
