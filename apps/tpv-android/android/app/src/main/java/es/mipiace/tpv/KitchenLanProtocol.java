package es.mipiace.tpv;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * kds-2-wifi · EL SOBRE, en Java.
 *
 * <p>Espejo exacto de {@code packages/kitchen-lan/src/sobre.ts}. Las dos
 * implementaciones tienen que producir y aceptar los MISMOS bytes, y eso no
 * se puede garantizar leyendo: se garantiza con el vector congelado
 * {@code packages/kitchen-lan/test/vector.json}, que abren los dos tests.
 * Si alguien cambia el separador de la cabecera canónica en TypeScript, el
 * vector deja de abrirse y los dos tests se ponen rojos a la vez.
 *
 * <p><b>Esta clase NO importa nada de Android</b>, y es deliberado: así se
 * compila y se prueba con un {@code javac} suelto, sin emulador y sin SDK.
 * Lo que toca Android (el socket, NSD, el bridge de Capacitor) vive en
 * {@link KitchenLanServer} y {@link KitchenLanPlugin}; lo que decide si un
 * mensaje entra o no vive aquí, que es lo que hay que poder probar.
 *
 * <p>Tampoco toca JSON: recibe los campos de la cabecera ya separados y
 * devuelve los bytes del cuerpo. El JSON lo hace el plugin con
 * {@code org.json}, que sí es de Android.
 */
public final class KitchenLanProtocol {

    /** Versión del sobre. Tiene que coincidir con `SOBRE_VERSION` del TS. */
    public static final int VERSION = 1;

    /** Puerto por defecto. `PUERTO_LAN_POR_DEFECTO` del TS. */
    public static final int PUERTO_POR_DEFECTO = 8787;

    /** Ventana de edad de un mensaje. `EDAD_MAXIMA_MS` del TS. */
    public static final long EDAD_MAXIMA_MS = 60_000L;

    /** Techo de la memoria de operaciones. `MemoriaDeOperaciones` del TS. */
    public static final int MAX_OPERACIONES = 2_000;

    private KitchenLanProtocol() {}

    /** Por qué NO entra un mensaje. Mismos nombres que el `MotivoRechazo` del TS. */
    public enum Motivo {
        VERSION_DISTINTA("VERSION", 409),
        OTRA_TIENDA("OTRA_TIENDA", 403),
        VIEJO("VIEJO", 408),
        REPETIDO("REPETIDO", 200),
        FIRMA("FIRMA", 401),
        MALFORMADO("MALFORMADO", 401),
        /**
         * Este aparato no puede descifrar: no tiene AES-256 (política JCE
         * restringida en una JVM vieja) o le falta el proveedor.
         *
         * <p>Existe separado de {@link #FIRMA} y NO es un detalle: el día
         * que esto pase, lo que hay que ver en la tablet es «este aparato no
         * puede descifrar», no «alguien está metiendo comandas falsas». El
         * primer diagnóstico se arregla cambiando de tablet; el segundo
         * manda a mirar la wifi del bar. Confundirlos cuesta una tarde.
         *
         * <p>En Android no pasa (AES-256 va de serie desde siempre); en la
         * JVM del Mac de desarrollo con un JDK 8 antiguo, sí.
         */
        SIN_CIFRADO("SIN_CIFRADO", 500);

        public final String codigo;
        /**
         * El HTTP con el que contesta la tablet. `REPETIDO` es 200 a
         * propósito: el duplicado del doble camino no es un error, y el TPV
         * que manda por los dos caminos quiere oír «ya lo tenía».
         */
        public final int http;

        Motivo(String codigo, int http) {
            this.codigo = codigo;
            this.http = http;
        }
    }

    /** Lo que sale de abrir un sobre: o el cuerpo, o el motivo. */
    public static final class Apertura {
        public final byte[] cuerpo;
        public final Motivo motivo;

        private Apertura(byte[] cuerpo, Motivo motivo) {
            this.cuerpo = cuerpo;
            this.motivo = motivo;
        }

        public static Apertura ok(byte[] cuerpo) {
            return new Apertura(cuerpo, null);
        }

        public static Apertura no(Motivo motivo) {
            return new Apertura(null, motivo);
        }

        public boolean esOk() {
            return motivo == null;
        }
    }

    /** La cabecera del sobre, ya separada del JSON. */
    public static final class Cabecera {
        public final int v;
        public final String storeId;
        public final String deviceId;
        public final String kind;
        public final String opId;
        public final String sentAt;
        public final String nonce;

        public Cabecera(int v, String storeId, String deviceId, String kind,
                        String opId, String sentAt, String nonce) {
            this.v = v;
            this.storeId = storeId;
            this.deviceId = deviceId;
            this.kind = kind;
            this.opId = opId;
            this.sentAt = sentAt;
            this.nonce = nonce;
        }
    }

    /**
     * La cabecera canónica: siete campos separados por {@code \n}.
     *
     * <p>Ninguno puede llevar un salto de línea —son UUID, un enum y un
     * ISO-8601— así que la separación no es ambigua. Es el AAD de AES-GCM:
     * va en claro, pero cambiar un byte invalida la etiqueta.
     */
    public static String cabeceraCanonica(Cabecera c) {
        return c.v + "\n" + c.storeId + "\n" + c.deviceId + "\n" + c.kind
                + "\n" + c.opId + "\n" + c.sentAt + "\n" + c.nonce;
    }

    public static byte[] deBase64Url(String texto) {
        // `getUrlDecoder()` acepta con y sin relleno; el TS escribe sin.
        return Base64.getUrlDecoder().decode(texto);
    }

    public static String aBase64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * Abre un sobre, o dice por qué no.
     *
     * <p>EL ORDEN DE LOS RECHAZOS IMPORTA y es el mismo que en el TS:
     * versión, tienda, edad, repetido y, por último, la etiqueta. Los
     * cuatro primeros son baratos y no tocan la clave; el quinto es el que
     * de verdad cierra la puerta, y es el último porque es el caro.
     *
     * <p>{@code ahoraMs} es la hora del SERVIDOR corregida, no la del reloj
     * de la tablet: una tablet que lleva horas sin internet puede tener el
     * reloj desviado, y rechazar por eso dejaría la cocina sin comandas
     * justo el día que importa. Ver {@link KitchenLanServer}.
     *
     * <p>Nunca lanza: un mensaje roto en la wifi de un bar no puede tumbar
     * el servidor de la tablet.
     */
    public static Apertura abrir(String claveB64, String storeIdPropio, long ahoraMs,
                                 long edadMaximaMs, Cabecera c, String ctB64,
                                 MemoriaDeOperaciones memoria) {
        if (c == null || ctB64 == null) {
            return Apertura.no(Motivo.MALFORMADO);
        }
        if (c.v != VERSION) {
            return Apertura.no(Motivo.VERSION_DISTINTA);
        }
        if (storeIdPropio == null || !storeIdPropio.equals(c.storeId)) {
            return Apertura.no(Motivo.OTRA_TIENDA);
        }
        long sentAtMs;
        try {
            sentAtMs = Instant.parse(c.sentAt).toEpochMilli();
        } catch (DateTimeParseException | NullPointerException e) {
            return Apertura.no(Motivo.MALFORMADO);
        }
        if (Math.abs(ahoraMs - sentAtMs) > edadMaximaMs) {
            return Apertura.no(Motivo.VIEJO);
        }
        if (memoria != null && memoria.yaVisto(c.opId)) {
            return Apertura.no(Motivo.REPETIDO);
        }
        try {
            byte[] clave = deBase64Url(claveB64);
            if (clave.length != 32) {
                return Apertura.no(Motivo.MALFORMADO);
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(clave, "AES"),
                    new GCMParameterSpec(128, deBase64Url(c.nonce)));
            cipher.updateAAD(cabeceraCanonica(c).getBytes(StandardCharsets.UTF_8));
            return Apertura.ok(cipher.doFinal(deBase64Url(ctB64)));
        } catch (javax.crypto.BadPaddingException e) {
            // `AEADBadTagException` es hija de ésta: la etiqueta de GCM mala
            // cae aquí.
            // La etiqueta no cuadra: o no tiene la clave de la tienda, o
            // alguien tocó un byte. Las dos cosas son lo mismo desde aquí.
            return Apertura.no(Motivo.FIRMA);
        } catch (GeneralSecurityException e) {
            // Clave ilegal, algoritmo ausente, proveedor roto. NO es una
            // firma mala: es que este aparato no puede descifrar. Ver
            // `Motivo.SIN_CIFRADO`.
            return Apertura.no(Motivo.SIN_CIFRADO);
        } catch (IllegalArgumentException e) {
            return Apertura.no(Motivo.MALFORMADO);
        }
    }

    /**
     * Cierra un sobre: lo que la tablet contesta a un SONDEO o a una PRUEBA.
     *
     * <p>Lanza si la clave es inservible, que es un error de programación, y
     * no si el cuerpo es raro.
     */
    public static String cerrar(String claveB64, Cabecera c, byte[] cuerpo)
            throws GeneralSecurityException {
        byte[] clave = deBase64Url(claveB64);
        if (clave.length != 32) {
            throw new GeneralSecurityException("la clave de tienda no son 32 bytes");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(clave, "AES"),
                new GCMParameterSpec(128, deBase64Url(c.nonce)));
        cipher.updateAAD(cabeceraCanonica(c).getBytes(StandardCharsets.UTF_8));
        return aBase64Url(cipher.doFinal(cuerpo));
    }

    /**
     * Lo que la tablet apunta para no procesar dos veces el mismo {@code opId}.
     *
     * <p>Es el descarte del duplicado del doble camino: el mismo envío llega
     * por la nube y por la wifi y sólo cuenta una vez. Acotado a
     * {@link #MAX_OPERACIONES} y fuera la más antigua: la tablet no puede
     * crecer sin techo en un servicio de seis horas.
     *
     * <p>Sincronizada entera: la llaman los hilos del socket, uno por
     * petición.
     */
    public static final class MemoriaDeOperaciones {
        private final LinkedHashSet<String> vistos = new LinkedHashSet<>();
        private final int max;

        public MemoriaDeOperaciones() {
            this(MAX_OPERACIONES);
        }

        public MemoriaDeOperaciones(int max) {
            this.max = max;
        }

        public synchronized boolean yaVisto(String opId) {
            return vistos.contains(opId);
        }

        public synchronized void apuntar(String opId) {
            if (vistos.contains(opId)) {
                return;
            }
            vistos.add(opId);
            while (vistos.size() > max) {
                String viejo = vistos.iterator().next();
                vistos.remove(viejo);
            }
        }

        public synchronized int tamano() {
            return vistos.size();
        }

        public synchronized Set<String> copia() {
            return new LinkedHashSet<>(vistos);
        }
    }

    /** 12 bytes de nonce en base64url. Nunca se repite con la misma clave. */
    public static String nonceNuevo(java.security.SecureRandom azar) {
        byte[] n = new byte[12];
        azar.nextBytes(n);
        return aBase64Url(n);
    }
}
