package es.mipiace.tpv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONException;
import org.junit.Test;

import java.util.List;

/**
 * residencia-4 (D-66) · <b>LO QUE SE PUEDE LEER SIN DESBLOQUEAR EL
 * TELÉFONO.</b>
 *
 * <p>Este test existe por una frase del alcance: «nada de salud en la
 * notificación de la pantalla bloqueada más allá de "Aviso N2 · habitación
 * 112"». Es una regla que se rompe escribiendo una línea de más en el
 * {@code setContentTitle}, y que nadie vuelve a mirar.
 *
 * <p>Así que lo que se fija aquí es lo que el parser GUARDA —cuatro
 * campos, y ni el nombre del residente ni la medida— y lo que la frase
 * DICE. Si alguien añade el nombre al objeto para pintarlo, este test no
 * se entera; pero si lo añade a la frase, se pone rojo.
 */
public class GuardiaAvisoTest {

    /** Una respuesta del GET con todo lo que el servidor manda de verdad,
     *  incluido lo que el móvil **no** debe sacar a la pantalla. */
    private static final String RESPUESTA =
            "{\"canal\":\"ENFERMERIA\",\"servicio\":null,\"avisos\":["
                    + "{\"id\":\"a1\",\"canal\":\"ENFERMERIA\",\"nivel\":\"N2\",\"estado\":\"PENDING\","
                    + "\"apuntadoEn\":\"2026-10-18T09:41:00.000Z\",\"salidoEn\":\"2026-10-18T09:41:02.000Z\","
                    + "\"escalado\":false,\"incidencia\":{\"id\":\"i1\",\"tipo\":\"FIEBRE\","
                    + "\"nombreDelTipo\":\"Fiebre\",\"nivel\":\"N2\",\"origen\":\"DERIVED_THRESHOLD\","
                    + "\"abiertaEn\":\"2026-10-18T09:41:00.000Z\","
                    + "\"habitacion\":{\"numero\":\"112\",\"nombre\":null},"
                    + "\"residente\":{\"id\":\"c1\",\"nombre\":\"Carmen Díaz\"},"
                    + "\"descripcion\":null,"
                    + "\"medida\":{\"control\":\"TEMPERATURA\",\"numero\":38.6,\"unidad\":\"°C\"}}}"
                    + "]}";

    @Test
    public void laFraseDeLaPantallaBloqueadaNoDiceNiElNombreNiLaFiebre()
            throws JSONException {
        List<GuardiaAviso> avisos = GuardiaAviso.deLaRespuesta(RESPUESTA);
        assertEquals(1, avisos.size());
        GuardiaAviso a = avisos.get(0);

        assertEquals("Aviso N2 · habitación 112", a.textoDeLaNotificacion());
        // Y las dos cosas que NO pueden aparecer, dichas por su nombre.
        assertFalse(a.textoDeLaNotificacion().contains("Carmen"));
        assertFalse(a.textoDeLaNotificacion().contains("38"));
        assertFalse(a.textoDeLaNotificacion().contains("Fiebre"));
    }

    @Test
    public void sinHabitacionLaFraseSeQuedaEnElNivel() throws JSONException {
        String sinHabitacion =
                "{\"avisos\":[{\"id\":\"a2\",\"nivel\":\"N4\",\"estado\":\"PENDING\","
                        + "\"incidencia\":{\"habitacion\":null}}]}";
        GuardiaAviso a = GuardiaAviso.deLaRespuesta(sinHabitacion).get(0);
        assertNull(a.habitacion);
        assertEquals("Aviso N4", a.textoDeLaNotificacion());
    }

    @Test
    public void loAcusadoDejaDeSonar() throws JSONException {
        String acusado =
                "{\"avisos\":[{\"id\":\"a3\",\"nivel\":\"N2\",\"estado\":\"ACKED\","
                        + "\"incidencia\":{\"habitacion\":{\"numero\":\"201\"}}}]}";
        GuardiaAviso a = GuardiaAviso.deLaRespuesta(acusado).get(0);
        assertTrue(a.acusado);
    }

    /** N0 y N1 no suenan: N0 es constancia y N1 va al relevo (D-19). Si
     *  sonaran, el móvil de guardia sonaría ochenta veces por turno y
     *  nadie lo miraría — que es la forma más segura de que un N2 pase
     *  desapercibido. */
    @Test
    public void n1NoSacaAlMovilDeSuSilencio() throws JSONException {
        String n1 =
                "{\"avisos\":[{\"id\":\"a4\",\"nivel\":\"N1\",\"estado\":\"PENDING\","
                        + "\"incidencia\":{\"habitacion\":{\"numero\":\"110\"}}}]}";
        assertFalse(GuardiaAviso.deLaRespuesta(n1).get(0).esUrgente());
        String n2 =
                "{\"avisos\":[{\"id\":\"a5\",\"nivel\":\"N2\",\"estado\":\"PENDING\","
                        + "\"incidencia\":{\"habitacion\":{\"numero\":\"110\"}}}]}";
        assertTrue(GuardiaAviso.deLaRespuesta(n2).get(0).esUrgente());
    }

    /** Un aviso que el parser no entiende se SALTA, y los demás entran.
     *  La alternativa —tirar la lista entera— es que una versión nueva
     *  del servidor deje el móvil mudo durante un turno. */
    @Test
    public void unAvisoRotoNoSeLlevaALosDemas() throws JSONException {
        String mezcla =
                "{\"avisos\":[{\"nivel\":\"N2\"},"
                        + "{\"id\":\"a6\",\"nivel\":\"N3\",\"estado\":\"PENDING\","
                        + "\"incidencia\":{\"habitacion\":{\"numero\":\"305\"}}}]}";
        List<GuardiaAviso> avisos = GuardiaAviso.deLaRespuesta(mezcla);
        assertEquals(1, avisos.size());
        assertEquals("a6", avisos.get(0).id);
    }

    @Test
    public void unaRespuestaVaciaNoRompe() throws JSONException {
        assertEquals(0, GuardiaAviso.deLaRespuesta("{}").size());
        assertEquals(0, GuardiaAviso.deLaRespuesta("{\"avisos\":[]}").size());
    }
}
