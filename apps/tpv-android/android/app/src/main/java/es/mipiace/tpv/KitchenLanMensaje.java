package es.mipiace.tpv;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/**
 * kds-2-wifi · UN MENSAJE QUE LLEGA POR LA WIFI, de JSON a decisión.
 *
 * <p>Separado de {@link KitchenLanServer} porque son dos cosas distintas: el
 * servidor son sockets y hilos; esto es el protocolo, y es lo que decide si
 * una comanda entra en la cocina. Separado también de
 * {@link KitchenLanProtocol} porque éste usa {@code org.json}, que es de
 * Android, y aquél tiene que poder probarse con un {@code javac} suelto.
 *
 * <p>El orden de los rechazos es el del protocolo y no se puede cambiar
 * aquí: lo decide {@link KitchenLanProtocol#abrir}.
 */
final class KitchenLanMensaje {

    private static final SecureRandom AZAR = new SecureRandom();

    private KitchenLanMensaje() {}

    static final class Resultado {
        /** `true` si el sobre pasó y el mensaje cuenta. */
        final boolean aceptado;
        final int http;
        /** El JSON que se devuelve por el socket. */
        final String respuesta;
        /** El JSON que el WebView tiene que ver, o null si no le toca nada. */
        final String paraElJs;

        private Resultado(boolean aceptado, int http, String respuesta, String paraElJs) {
            this.aceptado = aceptado;
            this.http = http;
            this.respuesta = respuesta;
            this.paraElJs = paraElJs;
        }
    }

    /**
     * Procesa un cuerpo recibido por el socket.
     *
     * @param respuestaPublicada la instantánea que el JS dejó para contestar
     *     a un SONDEO o a una PRUEBA, o null si todavía no publicó ninguna.
     */
    static Resultado procesar(String cuerpo, String claveTienda, String storeIdPropio,
                              String deviceIdPropio, long ahoraCorregidaMs,
                              KitchenLanProtocol.MemoriaDeOperaciones memoria,
                              String respuestaPublicada) {
        JSONObject sobre;
        try {
            sobre = new JSONObject(cuerpo == null ? "" : cuerpo);
        } catch (JSONException e) {
            return rechazo(KitchenLanProtocol.Motivo.MALFORMADO);
        }
        KitchenLanProtocol.Cabecera c;
        String ct;
        try {
            c = new KitchenLanProtocol.Cabecera(
                    sobre.getInt("v"),
                    sobre.getString("storeId"),
                    sobre.getString("deviceId"),
                    sobre.getString("kind"),
                    sobre.getString("opId"),
                    sobre.getString("sentAt"),
                    sobre.getString("nonce"));
            ct = sobre.getString("ct");
        } catch (JSONException e) {
            return rechazo(KitchenLanProtocol.Motivo.MALFORMADO);
        }

        KitchenLanProtocol.Apertura abierto = KitchenLanProtocol.abrir(
                claveTienda, storeIdPropio, ahoraCorregidaMs,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, ct, memoria);
        if (!abierto.esOk()) {
            // REPETIDO contesta 200 y NO vuelve a entregar el mensaje al JS:
            // es el duplicado del doble camino, el que llega segundo. Es la
            // fila «quitar el descarte por id» de la tabla de sabotajes.
            return rechazo(abierto.motivo);
        }
        memoria.apuntar(c.opId);

        String payload = new String(abierto.cuerpo, StandardCharsets.UTF_8);

        // Un SONDEO o una PRUEBA no cambian nada en la pantalla: se contestan
        // aquí mismo con lo que el JS publicó, sin despertar al WebView. Es
        // lo que hace que el «LISTO» del TPV sin internet tarde
        // milisegundos y no un repintado.
        boolean soloLee = "SONDEO".equals(c.kind) || "PRUEBA".equals(c.kind);
        String paraElJs = soloLee ? null : envolverParaElJs(c, payload);

        String respuesta = respuestaCifrada(claveTienda, storeIdPropio,
                deviceIdPropio, c.opId, ahoraCorregidaMs, respuestaPublicada);
        return new Resultado(true, 200, respuesta, paraElJs);
    }

    /**
     * Lo que el WebView recibe: la cabecera en claro (ya verificada) más el
     * cuerpo. El JS no vuelve a comprobar la firma —ya está comprobada, y
     * repetirla significaría tener la clave en dos sitios— pero sí ve de qué
     * terminal y de qué operación viene, que es lo que necesita para
     * descartar por `opId` su propio duplicado.
     */
    private static String envolverParaElJs(KitchenLanProtocol.Cabecera c, String payload) {
        try {
            JSONObject out = new JSONObject();
            out.put("kind", c.kind);
            out.put("opId", c.opId);
            out.put("deviceId", c.deviceId);
            out.put("sentAt", c.sentAt);
            out.put("payload", new JSONObject(payload));
            return out.toString();
        } catch (JSONException e) {
            // El cuerpo descifrado no era un objeto JSON. Viene de nuestro
            // propio TPV y con la etiqueta válida, así que esto es un bug
            // nuestro, no un ataque: se entrega como texto para que el JS lo
            // pueda loguear en vez de perderlo.
            return "{\"kind\":\"" + c.kind + "\",\"opId\":\"" + c.opId
                    + "\",\"error\":\"PAYLOAD_NO_JSON\"}";
        }
    }

    /**
     * La respuesta de la tablet, cifrada con la misma clave.
     *
     * <p>Va cifrada también la vuelta, y no es simetría decorativa: lleva qué
     * mesas están listas, y eso es información del servicio. Si el TPV no
     * puede verificar lo que le contestan, cualquiera en la wifi podría
     * decirle «la M5 está lista» y el camarero llevaría a la mesa un plato
     * que no existe.
     *
     * <p>Si todavía no hay instantánea publicada (la pantalla acaba de
     * arrancar), se contesta un sobre con una respuesta vacía. Vacía y
     * firmada es mejor que nada: el TPV distingue «la cocina está ahí y no
     * tiene nada listo» de «la cocina no contesta».
     */
    private static String respuestaCifrada(String claveTienda, String storeId,
                                           String deviceId, String opId, long ahoraMs,
                                           String publicada) {
        String cuerpo = publicada != null ? publicada
                : "{\"listas\":[],\"recibidas\":0,\"marcasPendientes\":0,"
                        + "\"sections\":[],\"deviceName\":null}";
        try {
            KitchenLanProtocol.Cabecera c = new KitchenLanProtocol.Cabecera(
                    KitchenLanProtocol.VERSION, storeId, deviceId, "RESPUESTA",
                    // La respuesta lleva el `opId` de LA PREGUNTA: así el TPV
                    // sabe a qué sondeo contesta y no se puede confundir con
                    // la respuesta de otro terminal.
                    opId,
                    java.time.Instant.ofEpochMilli(ahoraMs).toString(),
                    KitchenLanProtocol.nonceNuevo(AZAR));
            String ct = KitchenLanProtocol.cerrar(
                    claveTienda, c, cuerpo.getBytes(StandardCharsets.UTF_8));
            JSONObject out = new JSONObject();
            out.put("v", c.v);
            out.put("storeId", c.storeId);
            out.put("deviceId", c.deviceId);
            out.put("kind", c.kind);
            out.put("opId", c.opId);
            out.put("sentAt", c.sentAt);
            out.put("nonce", c.nonce);
            out.put("ct", ct);
            return out.toString();
        } catch (Exception e) {
            return "{\"error\":\"SIN_CIFRADO\"}";
        }
    }

    private static Resultado rechazo(KitchenLanProtocol.Motivo motivo) {
        return new Resultado(false, motivo.http,
                "{\"error\":\"" + motivo.codigo + "\"}", null);
    }
}
