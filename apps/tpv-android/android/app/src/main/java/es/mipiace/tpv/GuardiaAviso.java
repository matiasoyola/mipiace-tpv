package es.mipiace.tpv;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * residencia-4 (D-66) · LO QUE EL SERVICIO SACA DE UN AVISO, Y NADA MÁS.
 *
 * <p>El servicio en primer plano sondea {@code GET
 * /residencia/guardia/avisos} con la pantalla apagada, y de la respuesta se
 * queda con <b>cuatro cosas</b>: el id, el nivel, la habitación y si ya
 * está acusado.
 *
 * <p><b>Ni el nombre del residente, ni qué le pasa, ni la medida.</b> Y no
 * es que «no haga falta»: es que de este objeto sale el texto de la
 * notificación del sistema, que se pinta <b>en la pantalla bloqueada</b> de
 * un teléfono que puede estar encima de una mesa del office. El alcance del
 * bloque lo dice con esas palabras: «nada de salud en la notificación de la
 * pantalla bloqueada más allá de "Aviso N2 · habitación 112"».
 *
 * <p>Que el objeto no tenga los campos es lo que hace que la frase no se
 * pueda escribir por descuido. Si el parser guardara el nombre, pintarlo
 * estaría a una línea de distancia y nadie se acordaría de por qué no se
 * hace. Lo demás lo pinta el WebView, que está detrás del desbloqueo y
 * detrás de la sesión de guardia.
 */
public final class GuardiaAviso {

    /** El id del `GuardAlert`. Es lo que distingue uno nuevo de uno visto. */
    public final String id;
    /** `N2`, `N3`, `N4`. */
    public final String nivel;
    /** «112», o `null` si la incidencia no es de una habitación (una
     *  avería del ascensor, una queja). */
    public final String habitacion;
    /** `true` si alguien ya pulsó «Voy»: entonces deja de sonar. */
    public final boolean acusado;

    public GuardiaAviso(String id, String nivel, String habitacion, boolean acusado) {
        this.id = id;
        this.nivel = nivel;
        this.habitacion = habitacion;
        this.acusado = acusado;
    }

    /**
     * Lee la respuesta del GET. Lo que no entienda, lo ignora.
     *
     * <p>Un aviso mal formado se salta en vez de tirar la lista entera: la
     * alternativa es que una versión nueva del servidor con un campo más
     * deje el móvil de guardia mudo, y eso es un turno sin avisos.
     */
    public static List<GuardiaAviso> deLaRespuesta(String json) throws JSONException {
        List<GuardiaAviso> salida = new ArrayList<>();
        JSONObject raiz = new JSONObject(json);
        JSONArray avisos = raiz.optJSONArray("avisos");
        if (avisos == null) return salida;
        for (int i = 0; i < avisos.length(); i++) {
            JSONObject a = avisos.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id", null);
            if (id == null || id.isEmpty()) continue;
            String nivel = a.optString("nivel", "N2");
            String habitacion = null;
            JSONObject inc = a.optJSONObject("incidencia");
            if (inc != null) {
                JSONObject hab = inc.optJSONObject("habitacion");
                if (hab != null) {
                    String numero = hab.optString("numero", null);
                    if (numero != null && !numero.isEmpty()) habitacion = numero;
                }
            }
            boolean acusado = "ACKED".equals(a.optString("estado", ""));
            salida.add(new GuardiaAviso(id, nivel, habitacion, acusado));
        }
        return salida;
    }

    /**
     * El texto de la notificación del sistema. <b>Esto es todo lo que se
     * puede leer sin desbloquear el teléfono.</b>
     *
     * <p>«Aviso N2 · habitación 112», o «Aviso N2» a secas cuando no hay
     * habitación. Es una función pura y tiene su test, porque es la línea
     * que separa «el móvil suena» de «el móvil publica un dato de salud en
     * la pantalla de bloqueo».
     */
    public String textoDeLaNotificacion() {
        if (habitacion == null || habitacion.isEmpty()) {
            return "Aviso " + nivel;
        }
        return "Aviso " + nivel + " · habitación " + habitacion;
    }

    /** ¿Este nivel saca al móvil de su silencio? N2 y por encima. */
    public boolean esUrgente() {
        return "N2".equals(nivel) || "N3".equals(nivel) || "N4".equals(nivel);
    }
}
