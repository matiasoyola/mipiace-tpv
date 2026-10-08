package es.mipiace.tpv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * kds-2-wifi · EL VECTOR CONGELADO, abierto desde Java.
 *
 * <p>Este test y {@code packages/kitchen-lan/test/sobre.test.ts} leen EL
 * MISMO fichero: {@code packages/kitchen-lan/test/vector.json}. Es la única
 * prueba posible de que el sobre que escribe el TPV (TypeScript, dentro del
 * WebView) es exactamente el que la tablet acepta (Java, en la pieza
 * nativa): misma cabecera canónica, mismo base64url, mismos parámetros de
 * AES-GCM.
 *
 * <p>Y no se queda en «se descifra»: vuelve a CIFRAR el cuerpo con la misma
 * clave, el mismo nonce y la misma cabecera, y comprueba que sale el MISMO
 * {@code ct} byte a byte. Descifrar sólo prueba que el AAD y la etiqueta
 * cuadran; re-cifrar prueba además que el orden de los campos de la
 * cabecera es idéntico, que es justo lo que alguien podría cambiar sin
 * darse cuenta.
 *
 * <p><b>Ojo con la JVM del Mac.</b> Un JDK 8 antiguo trae la política JCE
 * restringida (AES hasta 128 bits) y NO puede descifrar el vector, que es de
 * 256. Los tests que necesitan la clave se saltan solos con un
 * {@link Assume}, en vez de fallar y hacer creer que el protocolo está roto;
 * los que no la necesitan (la cabecera canónica, los cuatro rechazos
 * baratos, la memoria de operaciones) corren siempre. En Android y en
 * cualquier JDK moderno corren los diez.
 *
 * <p>Correr con:
 * {@code (cd apps/tpv-android/android && ./gradlew :app:testDebugUnitTest)}
 */
public class KitchenLanProtocolTest {

    /** `true` si esta JVM puede con AES-256. En Android, siempre. */
    private static boolean hayAes256() {
        try {
            return javax.crypto.Cipher.getMaxAllowedKeyLength("AES") >= 256;
        } catch (java.security.NoSuchAlgorithmException e) {
            return false;
        }
    }

    private void exigeAes256() {
        Assume.assumeTrue(
                "esta JVM tiene la politica JCE restringida (AES < 256): "
                        + "el vector no se puede descifrar aqui",
                hayAes256());
    }

    private static String leerVector() throws IOException {
        // El test corre con cwd en `apps/tpv-android/android` (gradle) o en
        // `apps/tpv-android/android/app` según la invocación: se sube hasta
        // encontrar la raíz del repo.
        File dir = new File("").getAbsoluteFile();
        for (int i = 0; i < 8 && dir != null; i++) {
            File v = new File(dir, "packages/kitchen-lan/test/vector.json");
            if (v.isFile()) {
                return new String(Files.readAllBytes(v.toPath()), StandardCharsets.UTF_8);
            }
            dir = dir.getParentFile();
        }
        throw new IOException("no encuentro packages/kitchen-lan/test/vector.json");
    }

    /** Un extractor mínimo: el vector es nuestro y no cambia de forma. */
    private static String campo(String json, String nombre) {
        Matcher m = Pattern.compile("\"" + nombre + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        if (!m.find()) {
            throw new IllegalStateException("falta el campo " + nombre);
        }
        return m.group(1);
    }

    private static KitchenLanProtocol.Cabecera cabecera(String json) {
        return new KitchenLanProtocol.Cabecera(
                KitchenLanProtocol.VERSION,
                campo(json, "storeId"),
                campo(json, "deviceId"),
                campo(json, "kind"),
                campo(json, "opId"),
                campo(json, "sentAt"),
                campo(json, "nonce"));
    }

    @Test
    public void elVectorSeAbreYSaleElCuerpo() throws Exception {
        exigeAes256();
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();

        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                campo(json, "clave"), c.storeId, ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, campo(json, "ct"), null);

        assertTrue("el vector tiene que abrirse", r.esOk());
        String cuerpo = new String(r.cuerpo, StandardCharsets.UTF_8);
        assertTrue(cuerpo.contains("\"tableName\":\"M5\""));
        assertTrue(cuerpo.contains("\"name\":\"Patatas bravas\""));
        assertTrue(cuerpo.contains("\"seatAllergy\":\"SIN GLUTEN\""));
    }

    @Test
    public void yVuelveASalirElMISMOSobre() throws Exception {
        exigeAes256();
        // La prueba de verdad de que las dos implementaciones son la misma:
        // re-cifrar con la misma clave, el mismo nonce y la misma cabecera
        // tiene que dar el mismo `ct` byte a byte.
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();
        String clave = campo(json, "clave");
        String ct = campo(json, "ct");

        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                clave, c.storeId, ahora, KitchenLanProtocol.EDAD_MAXIMA_MS, c, ct, null);
        assertTrue(r.esOk());
        assertEquals(ct, KitchenLanProtocol.cerrar(clave, c, r.cuerpo));
    }

    @Test
    public void laCabeceraCanonicaSonSieteCamposConSaltos() throws Exception {
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        String[] partes = KitchenLanProtocol.cabeceraCanonica(c).split("\n", -1);
        assertEquals(7, partes.length);
        assertEquals("1", partes[0]);
        assertEquals(c.storeId, partes[1]);
        assertEquals(c.deviceId, partes[2]);
        assertEquals(c.kind, partes[3]);
        assertEquals(c.opId, partes[4]);
        assertEquals(c.sentAt, partes[5]);
        assertEquals(c.nonce, partes[6]);
    }

    // ── SABOTAJES · lo que la tablet tiene que rechazar ──────────────────

    @Test
    public void sinFirmaValidaNoEntra() throws Exception {
        exigeAes256();
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();
        String ct = campo(json, "ct");
        String tocado = "A" + ct.substring(1);

        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                campo(json, "clave"), c.storeId, ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, tocado, null);
        assertFalse(r.esOk());
        assertNull(r.cuerpo);
        assertEquals(KitchenLanProtocol.Motivo.FIRMA, r.motivo);
        assertEquals(401, r.motivo.http);
    }

    @Test
    public void conLaClaveDeOtraTiendaNoEntra() throws Exception {
        exigeAes256();
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();
        // 32 bytes distintos, mismo largo.
        byte[] otra = new byte[32];
        for (int i = 0; i < 32; i++) {
            otra[i] = (byte) (i + 100);
        }
        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                KitchenLanProtocol.aBase64Url(otra), c.storeId, ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, campo(json, "ct"), null);
        assertEquals(KitchenLanProtocol.Motivo.FIRMA, r.motivo);
    }

    @Test
    public void deOtraTiendaSeRechazaSinTocarLaClave() throws Exception {
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();
        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                campo(json, "clave"), "99999999-9999-4999-8999-999999999999", ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, campo(json, "ct"), null);
        assertEquals(KitchenLanProtocol.Motivo.OTRA_TIENDA, r.motivo);
        assertEquals(403, r.motivo.http);
    }

    @Test
    public void firmadoHaceDiezMinutosNoEntra() throws Exception {
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long diezMinutosDespues = Instant.parse(c.sentAt).toEpochMilli() + 600_000L;
        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                campo(json, "clave"), c.storeId, diezMinutosDespues,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, campo(json, "ct"), null);
        assertEquals(KitchenLanProtocol.Motivo.VIEJO, r.motivo);
        assertEquals(408, r.motivo.http);
    }

    @Test
    public void otraVersionDelSobreDaVERSIONYNoFIRMA() throws Exception {
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        KitchenLanProtocol.Cabecera futura = new KitchenLanProtocol.Cabecera(
                KitchenLanProtocol.VERSION + 1, c.storeId, c.deviceId, c.kind,
                c.opId, c.sentAt, c.nonce);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();
        KitchenLanProtocol.Apertura r = KitchenLanProtocol.abrir(
                campo(json, "clave"), c.storeId, ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, futura, campo(json, "ct"), null);
        assertEquals(KitchenLanProtocol.Motivo.VERSION_DISTINTA, r.motivo);
    }

    @Test
    public void elMismoOpIdDosVecesEsREPETIDOYContesta200() throws Exception {
        exigeAes256();
        String json = leerVector();
        KitchenLanProtocol.Cabecera c = cabecera(json);
        long ahora = Instant.parse(c.sentAt).toEpochMilli();
        KitchenLanProtocol.MemoriaDeOperaciones memoria =
                new KitchenLanProtocol.MemoriaDeOperaciones();

        assertTrue(KitchenLanProtocol.abrir(campo(json, "clave"), c.storeId, ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, campo(json, "ct"), memoria).esOk());
        memoria.apuntar(c.opId);
        KitchenLanProtocol.Apertura otra = KitchenLanProtocol.abrir(
                campo(json, "clave"), c.storeId, ahora,
                KitchenLanProtocol.EDAD_MAXIMA_MS, c, campo(json, "ct"), memoria);
        assertEquals(KitchenLanProtocol.Motivo.REPETIDO, otra.motivo);
        // 200: el duplicado del doble camino NO es un error.
        assertEquals(200, otra.motivo.http);
    }

    @Test
    public void laMemoriaDeOperacionesEstaAcotada() {
        KitchenLanProtocol.MemoriaDeOperaciones m =
                new KitchenLanProtocol.MemoriaDeOperaciones(3);
        m.apuntar("a");
        m.apuntar("b");
        m.apuntar("c");
        m.apuntar("d");
        assertEquals(3, m.tamano());
        assertFalse(m.yaVisto("a"));
        assertTrue(m.yaVisto("d"));
        m.apuntar("d");
        assertEquals(3, m.tamano());
    }
}
